import * as Location from 'expo-location';
import { Coordinate, SavedPath } from './path-storage';

const NEARBY_THRESHOLD_METERS = 50;

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function getCurrentLocation(): Promise<Coordinate | null> {
  const hasPermission = await requestLocationPermission();
  if (!hasPermission) return null;

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });

  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  };
}

/**
 * Subscribe to device compass heading (magnetometer + accelerometer fused).
 * Returns degrees clockwise from true north (0..360). Falls back to magnetic
 * heading on devices where true heading isn't available. The callback fires
 * only when the heading changes by at least `minDeltaDeg` to avoid render
 * thrash.
 */
export function startHeadingTracking(
  onUpdate: (heading: number, accuracy: number) => void,
  minDeltaDeg: number = 5,
): { stop: () => void } {
  let subscriptionPromise: Promise<Location.LocationSubscription> | null = null;
  let lastHeading: number | null = null;

  subscriptionPromise = Location.watchHeadingAsync((h) => {
    const heading = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
    if (heading < 0) return;
    if (lastHeading == null || Math.abs(heading - lastHeading) >= minDeltaDeg) {
      lastHeading = heading;
      onUpdate(heading, h.accuracy);
    }
  });

  return {
    stop: () => {
      subscriptionPromise?.then((sub) => sub.remove());
    },
  };
}

export function startLocationTracking(
  onUpdate: (coord: Coordinate) => void,
  intervalMs: number = 2000,
): { stop: () => void } {
  let subscriptionPromise: Promise<Location.LocationSubscription> | null = null;

  subscriptionPromise = Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: intervalMs,
      distanceInterval: 1,
    },
    (location) => {
      onUpdate({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
    },
  );

  return {
    stop: () => {
      subscriptionPromise?.then((sub) => sub.remove());
    },
  };
}

/**
 * Haversine formula — distance between two GPS coordinates in meters.
 */
export function distanceBetween(a: Coordinate, b: Coordinate): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);

  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLon * sinLon;

  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Bearing from point A to point B in degrees (0 = north, 90 = east, etc.).
 */
export function bearingBetween(from: Coordinate, to: Coordinate): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Convert an absolute compass bearing (0-360, 0=N) to a cardinal label.
 * Used only as a fallback when we don't yet know which way the user is facing.
 */
export function bearingToDirection(bearing: number): string {
  if (bearing >= 337.5 || bearing < 22.5) return 'north';
  if (bearing < 67.5) return 'northeast';
  if (bearing < 112.5) return 'east';
  if (bearing < 157.5) return 'southeast';
  if (bearing < 202.5) return 'south';
  if (bearing < 247.5) return 'southwest';
  if (bearing < 292.5) return 'west';
  return 'northwest';
}

/**
 * Normalize an angle to (-180, 180].
 */
export function relativeBearing(targetBearing: number, userHeading: number): number {
  let diff = ((targetBearing - userHeading + 540) % 360) - 180;
  if (diff <= -180) diff += 360;
  return diff;
}

/**
 * Map a relative bearing (-180..180, where 0 = directly ahead of user) to a
 * human-friendly turn instruction.
 */
export function relativeBearingToTurn(rel: number): {
  /** Short label shown in the UI (e.g. "STRAIGHT", "TURN RIGHT"). */
  label: string;
  /** Imperative phrase used to build the spoken instruction. */
  turn: string;
  /** True when the user can keep walking without turning first. */
  isStraight: boolean;
} {
  const a = Math.abs(rel);
  if (a < 20) return { label: 'straight', turn: 'continue straight', isStraight: true };
  if (a < 45) {
    return rel > 0
      ? { label: 'slight right', turn: 'veer slightly right', isStraight: false }
      : { label: 'slight left', turn: 'veer slightly left', isStraight: false };
  }
  if (a < 135) {
    return rel > 0
      ? { label: 'turn right', turn: 'turn right', isStraight: false }
      : { label: 'turn left', turn: 'turn left', isStraight: false };
  }
  return { label: 'turn around', turn: 'turn around', isStraight: false };
}

/**
 * Project a coordinate forward by `meters` along `bearingDeg`. Flat-earth
 * approximation; accurate to <1 m for distances under ~100 m.
 */
export function offsetCoordinate(
  from: Coordinate,
  bearingDeg: number,
  meters: number,
): Coordinate {
  if (meters === 0) return from;
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;

  const lat1 = toRad(from.latitude);
  const lon1 = toRad(from.longitude);
  const brng = toRad(bearingDeg);
  const dR = meters / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(brng),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(dR) * Math.cos(lat1),
      Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { latitude: toDeg(lat2), longitude: toDeg(lon2) };
}

/**
 * Convert meters to feet.
 */
export function metersToFeet(meters: number): number {
  return Math.round(meters * 3.28);
}

/**
 * Convert meters to approximate walking steps.
 */
export function metersToSteps(meters: number): number {
  return Math.max(1, Math.round(meters / 0.75));
}

/**
 * Check which saved paths have a start point near the user's current location.
 */
export function findNearbyPaths(
  currentLocation: Coordinate,
  paths: SavedPath[],
  thresholdMeters: number = NEARBY_THRESHOLD_METERS,
): SavedPath[] {
  return paths.filter(
    (p) => distanceBetween(currentLocation, p.start) <= thresholdMeters,
  );
}
