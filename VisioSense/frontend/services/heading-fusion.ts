/**
 * Fused heading source for navigation.
 *
 * Indoors the magnetometer alone is too noisy and bias-prone to drive
 * steering — it can be 90–180° off. This module:
 *   1. Smooths the raw compass with a circular EMA so jitter doesn't flip
 *      the steering decision frame-to-frame.
 *   2. Rejects implausible spikes (>90° in <200 ms).
 *   3. When the user is actively walking (GPS course is fresh and consistent),
 *      overrides the smoothed compass with GPS course-over-ground, which has
 *      no magnetometer drift.
 *   4. Exposes an accuracy signal so the UI can prompt calibration.
 */

import { bearingBetween } from './location-service';
import { Coordinate } from './path-storage';

const EMA_ALPHA = 0.25;
const JITTER_FLOOR_DEG = 3;
const SPIKE_MAX_DEG = 90;
const SPIKE_MAX_DT_MS = 200;
const GPS_OVERRIDE_MIN_M = 3;          // total distance moved within the window
const GPS_OVERRIDE_WINDOW_MS = 5000;
const GPS_OVERRIDE_CONSISTENCY_DEG = 25; // course samples must agree within this

/**
 * Compute the smallest signed difference between two angles in degrees.
 * Result is in (-180, 180].
 */
function angleDiff(a: number, b: number): number {
  let d = ((a - b + 540) % 360) - 180;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Circular EMA: smooths `prev` toward `next` by `alpha` while respecting
 * wrap-around at 0/360.
 */
function emaCircular(prev: number, next: number, alpha: number): number {
  const delta = angleDiff(next, prev);
  return (prev + alpha * delta + 360) % 360;
}

export type FusedHeading = {
  /** Best-estimate heading in degrees clockwise from true north. */
  value: number;
  /** Which source is currently driving the heading. */
  source: 'compass-ema' | 'gps-course';
  /** Lower is better. Reflects compass accuracy and/or GPS course stability. */
  uncertaintyDeg: number;
};

type Listener = (h: FusedHeading) => void;

export function createHeadingFusion() {
  let smoothed: number | null = null;
  let lastRaw: number | null = null;
  let lastRawAt = 0;
  let compassAccuracy: number = 30; // worst-case until we see a real one
  let listeners = new Set<Listener>();

  // GPS-course window
  type Sample = { coord: Coordinate; t: number };
  let samples: Sample[] = [];

  function emit() {
    if (smoothed == null) return;
    const fused = computeFused();
    for (const l of listeners) l(fused);
  }

  function computeFused(): FusedHeading {
    const course = computeGpsCourse();
    if (course != null) {
      return {
        value: course,
        source: 'gps-course',
        uncertaintyDeg: 10,
      };
    }
    return {
      value: smoothed ?? 0,
      source: 'compass-ema',
      uncertaintyDeg: compassAccuracy,
    };
  }

  function computeGpsCourse(): number | null {
    const now = Date.now();
    samples = samples.filter((s) => now - s.t <= GPS_OVERRIDE_WINDOW_MS);
    if (samples.length < 2) return null;

    const first = samples[0];
    const last = samples[samples.length - 1];
    const totalDistance = haversine(first.coord, last.coord);
    if (totalDistance < GPS_OVERRIDE_MIN_M) return null;

    const courseEndToEnd = bearingBetween(first.coord, last.coord);

    // Consistency check: every consecutive pair-bearing must be within tol.
    for (let i = 1; i < samples.length; i++) {
      const segDist = haversine(samples[i - 1].coord, samples[i].coord);
      if (segDist < 0.5) continue; // skip stationary pairs (noise)
      const segBearing = bearingBetween(samples[i - 1].coord, samples[i].coord);
      if (Math.abs(angleDiff(segBearing, courseEndToEnd)) > GPS_OVERRIDE_CONSISTENCY_DEG) {
        return null;
      }
    }
    return courseEndToEnd;
  }

  return {
    /** Feed a raw compass reading (degrees CW from north + reported accuracy). */
    pushCompass(rawDeg: number, accuracyDeg?: number) {
      if (rawDeg < 0 || rawDeg >= 360) return;
      const now = Date.now();
      if (lastRaw != null) {
        const dDeg = Math.abs(angleDiff(rawDeg, lastRaw));
        const dt = now - lastRawAt;
        if (dDeg > SPIKE_MAX_DEG && dt < SPIKE_MAX_DT_MS) {
          return; // reject spike
        }
      }
      lastRaw = rawDeg;
      lastRawAt = now;
      if (typeof accuracyDeg === 'number' && accuracyDeg > 0) {
        compassAccuracy = accuracyDeg;
      }
      if (smoothed == null) {
        smoothed = rawDeg;
      } else {
        const delta = Math.abs(angleDiff(rawDeg, smoothed));
        if (delta < JITTER_FLOOR_DEG) {
          // tiny — keep smoothed where it is
        } else {
          smoothed = emaCircular(smoothed, rawDeg, EMA_ALPHA);
        }
      }
      emit();
    },
    /** Feed a fresh GPS coord — used to derive a course-over-ground override. */
    pushGps(coord: Coordinate) {
      samples.push({ coord, t: Date.now() });
      emit();
    },
    /** Current best estimate; returns null until first compass reading. */
    get(): FusedHeading | null {
      if (smoothed == null) return null;
      return computeFused();
    },
    subscribe(cb: Listener): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    reset() {
      smoothed = null;
      lastRaw = null;
      samples = [];
    },
  };
}

function haversine(a: Coordinate, b: Coordinate): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
