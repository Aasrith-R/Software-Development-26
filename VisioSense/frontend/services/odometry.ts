import { Pedometer } from 'expo-sensors';

import { Coordinate } from './path-storage';
import { offsetCoordinate } from './location-service';

const STEP_LENGTH_M = 0.75;
const EMIT_HZ = 5;

type OdometryOptions = {
  onPositionEstimate: (coord: Coordinate, source: 'gps' | 'pedometer') => void;
};

/**
 * Pedometer-based dead reckoning between GPS fixes.
 *
 * Callers feed in fresh GPS anchors and a live heading (degrees clockwise
 * from north). Between anchors we project forward by `steps * step_length`
 * along the current heading. On each GPS fix we re-anchor and zero out the
 * step counter so drift never compounds.
 *
 * Returns control object: { stop, setAnchor, setHeading }.
 */
export function startOdometry({ onPositionEstimate }: OdometryOptions) {
  let anchor: Coordinate | null = null;
  let anchorAt = 0;
  let stepsAtAnchor = 0;
  let stepsNow = 0;
  let heading: number | null = null;
  let pedoSub: { remove: () => void } | null = null;
  let emitTimer: ReturnType<typeof setInterval> | null = null;

  Pedometer.isAvailableAsync()
    .then((ok) => {
      if (!ok) return;
      pedoSub = Pedometer.watchStepCount((res) => {
        stepsNow = (res.steps ?? 0) + stepsAtAnchor;
      });
    })
    .catch(() => {
      // Pedometer not available — odometry simply re-emits the last GPS anchor.
    });

  function emit() {
    if (!anchor) return;
    const stepsSince = Math.max(0, stepsNow - stepsAtAnchor);
    if (stepsSince === 0 || heading == null) {
      onPositionEstimate(anchor, 'gps');
      return;
    }
    const meters = stepsSince * STEP_LENGTH_M;
    const estimated = offsetCoordinate(anchor, heading, meters);
    onPositionEstimate(estimated, 'pedometer');
  }

  emitTimer = setInterval(emit, Math.round(1000 / EMIT_HZ));

  return {
    setAnchor(coord: Coordinate) {
      anchor = coord;
      anchorAt = Date.now();
      stepsAtAnchor = stepsNow;
      onPositionEstimate(coord, 'gps');
    },
    setHeading(deg: number) {
      heading = deg;
    },
    stop() {
      pedoSub?.remove();
      pedoSub = null;
      if (emitTimer) clearInterval(emitTimer);
      emitTimer = null;
    },
    /** For debugging / UI. */
    getState() {
      return { anchor, anchorAt, stepsSinceAnchor: Math.max(0, stepsNow - stepsAtAnchor), heading };
    },
  };
}
