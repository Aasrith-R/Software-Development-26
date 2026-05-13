import { Coordinate } from './path-storage';
import {
  bearingBetween,
  bearingToDirection,
  distanceBetween,
  metersToFeet,
  metersToSteps,
  relativeBearing,
  relativeBearingToTurn,
} from './location-service';

export type Zone = 'left' | 'center' | 'right';

export type ZoneClearance = {
  blocked: boolean;
  score: number;
  nearest_obstacle_m: number | null;
};

export type ClearanceMap = {
  left: ZoneClearance;
  center: ZoneClearance;
  right: ZoneClearance;
};

export type DoorAnnotation = {
  zone: Zone;
  distance_m: number;
  confidence: number;
  /** "depth" = inferred from MiDaS depth contrast. "yolo" = real door object. */
  source?: 'depth' | 'yolo';
};

export type SteeringSource = 'gps' | 'depth-override' | 'door' | 'blocked';

export type NavInstruction = {
  direction: string;
  distanceFeet: number;
  distanceSteps: number;
  targetWaypoint: Coordinate;
  spokenText: string;
  steeringSource: SteeringSource;
  targetZone: Zone | null;
};

export type NavState = {
  currentWaypointIndex: number;
  instruction: NavInstruction;
  distanceToEndFeet: number;
  progress: number; // 0–1
  arrived: boolean;
};

const ARRIVAL_THRESHOLD_METERS = 5;
const WAYPOINT_REACHED_METERS = 8;

/**
 * Build the full waypoint list: [start, ...waypoints, end].
 */
export function buildRoute(
  start: Coordinate,
  end: Coordinate,
  waypoints: Coordinate[],
): Coordinate[] {
  return [start, ...waypoints, end];
}

/**
 * Hysteresis smoother for steering decisions. The raw per-frame decision
 * is noisy (compass jitter + YOLO/depth fluctuations); committing only after
 * `minAgreeingFrames` consecutive identical decisions prevents TTS flip-flop.
 *
 * Decision identity is the pair (steeringSource, targetZone). Distance/turn
 * magnitude changes do not count as a new decision.
 */
export function createSteeringSmoother(opts?: { minAgreeingFrames?: number }) {
  const minAgreeing = opts?.minAgreeingFrames ?? 2;
  let committed: { source: SteeringSource; zone: Zone | null } | null = null;
  let pending: { source: SteeringSource; zone: Zone | null; count: number } | null = null;

  function key(d: { source: SteeringSource; zone: Zone | null }): string {
    return `${d.source}:${d.zone ?? '-'}`;
  }

  return {
    /** Push a raw per-frame decision. Returns the *committed* decision to use. */
    update(raw: { source: SteeringSource; zone: Zone | null }): {
      source: SteeringSource;
      zone: Zone | null;
    } {
      if (committed == null) {
        committed = raw;
        pending = null;
        return committed;
      }
      if (key(raw) === key(committed)) {
        pending = null;
        return committed;
      }
      if (pending && key(raw) === key(pending)) {
        pending.count += 1;
      } else {
        pending = { ...raw, count: 1 };
      }
      if (pending.count >= minAgreeing) {
        committed = { source: pending.source, zone: pending.zone };
        pending = null;
      }
      return committed;
    },
    /** For debugging / UI. */
    state() {
      return { committed, pending };
    },
  };
}

/**
 * Map a relative bearing (-180..180) to a desired zone the user should aim
 * the camera at. Within ±30° = center, otherwise left or right.
 */
function bearingToZone(rel: number): Zone {
  if (rel < -30) return 'left';
  if (rel > 30) return 'right';
  return 'center';
}

function zoneToTurnLabel(zone: Zone): string {
  if (zone === 'left') return 'step left';
  if (zone === 'right') return 'step right';
  return 'continue straight';
}

/**
 * Decide which zone the user should aim for, given GPS direction and the
 * backend's per-zone walkability map.
 */
export function pickSteeringDirection(args: {
  userHeading: number | null;
  gpsBearing: number;
  clearance: ClearanceMap | null;
  doors: DoorAnnotation[] | null;
  recommendedZone: Zone | null;
}): { zone: Zone | null; source: SteeringSource; door?: DoorAnnotation } {
  const { userHeading, gpsBearing, clearance, doors, recommendedZone } = args;

  if (userHeading == null) {
    return { zone: null, source: 'gps' };
  }
  const rel = relativeBearing(gpsBearing, userHeading);
  const desired = bearingToZone(rel);

  if (!clearance) {
    return { zone: desired, source: 'gps' };
  }

  if (!clearance[desired].blocked) {
    return { zone: desired, source: 'gps' };
  }

  // Desired zone is blocked. Prefer a door near the GPS bearing.
  if (doors && doors.length > 0) {
    for (const d of doors) {
      if (!clearance[d.zone].blocked) {
        // Only prefer doors that are not wildly off the GPS direction.
        if (Math.abs(rel) < 90 || d.zone !== desired) {
          return { zone: d.zone, source: 'door', door: d };
        }
      }
    }
  }

  if (recommendedZone && !clearance[recommendedZone].blocked) {
    return { zone: recommendedZone, source: 'depth-override' };
  }

  return { zone: null, source: 'blocked' };
}

/**
 * Generate a spoken instruction for the next waypoint.
 *
 * If we have a `userHeading` (compass) and `clearance` (camera depth), the
 * instruction is phrased to steer the user toward open space. Without those
 * we fall back to GPS-only phrasing.
 */
function generateInstruction(
  current: Coordinate,
  target: Coordinate,
  isLast: boolean,
  userHeading: number | null,
  clearance: ClearanceMap | null,
  doors: DoorAnnotation[] | null,
  recommendedZone: Zone | null,
): NavInstruction {
  const dist = distanceBetween(current, target);
  const targetBearing = bearingBetween(current, target);
  const feet = metersToFeet(dist);
  const steps = metersToSteps(dist);
  const destinationWord = isLast ? 'to your destination' : '';

  if (isLast && feet <= 15) {
    return {
      direction: 'arrive',
      distanceFeet: feet,
      distanceSteps: steps,
      targetWaypoint: target,
      spokenText: 'You have arrived at your destination.',
      steeringSource: 'gps',
      targetZone: null,
    };
  }

  if (userHeading == null) {
    const cardinal = bearingToDirection(targetBearing);
    return {
      direction: `head ${cardinal}`,
      distanceFeet: feet,
      distanceSteps: steps,
      targetWaypoint: target,
      spokenText: `Start walking. Head ${cardinal} for ${feet} feet${destinationWord ? ', ' + destinationWord : ''}.`,
      steeringSource: 'gps',
      targetZone: null,
    };
  }

  const steer = pickSteeringDirection({
    userHeading,
    gpsBearing: targetBearing,
    clearance,
    doors,
    recommendedZone,
  });

  // No safe zone at all → stop.
  if (steer.source === 'blocked') {
    return {
      direction: 'blocked',
      distanceFeet: feet,
      distanceSteps: steps,
      targetWaypoint: target,
      spokenText: 'All paths blocked. Stop.',
      steeringSource: 'blocked',
      targetZone: null,
    };
  }

  // Door / opening target — encourage walking through the open passage.
  if (steer.source === 'door' && steer.door) {
    const doorFeet = metersToFeet(steer.door.distance_m);
    const noun = steer.door.source === 'yolo' ? 'door' : 'opening';
    return {
      direction: `${noun} ${steer.door.zone}`,
      distanceFeet: doorFeet,
      distanceSteps: metersToSteps(steer.door.distance_m),
      targetWaypoint: target,
      spokenText: `${capitalize(noun)} about ${doorFeet} feet ahead on your ${steer.door.zone}. Head toward the ${noun}.`,
      steeringSource: 'door',
      targetZone: steer.zone,
    };
  }

  // Depth override — the GPS direction would hit a wall; redirect.
  if (steer.source === 'depth-override' && steer.zone) {
    const turn = zoneToTurnLabel(steer.zone);
    return {
      direction: `redirect ${steer.zone}`,
      distanceFeet: feet,
      distanceSteps: steps,
      targetWaypoint: target,
      spokenText: `Path blocked ahead. ${capitalize(turn)} into open space, then continue.`,
      steeringSource: 'depth-override',
      targetZone: steer.zone,
    };
  }

  // Normal GPS-driven phrasing.
  const rel = relativeBearing(targetBearing, userHeading);
  const turn = relativeBearingToTurn(rel);
  const walkClause = `walk ${feet} feet${destinationWord ? ' ' + destinationWord : ''}`;
  const spokenText = turn.isStraight
    ? `${capitalize(walkClause)}, about ${steps} steps.`
    : `${capitalize(turn.turn)}, then ${walkClause}, about ${steps} steps.`;

  return {
    direction: turn.label,
    distanceFeet: feet,
    distanceSteps: steps,
    targetWaypoint: target,
    spokenText,
    steeringSource: 'gps',
    targetZone: steer.zone ?? null,
  };
}

/**
 * Given the user's current position and the full route, compute the navigation state.
 */
export function computeNavState(
  currentPosition: Coordinate,
  route: Coordinate[],
  currentWaypointIndex: number,
  userHeading: number | null = null,
  clearance: ClearanceMap | null = null,
  doors: DoorAnnotation[] | null = null,
  recommendedZone: Zone | null = null,
): NavState {
  const totalRouteDistance = computeTotalDistance(route);

  // Check if we've arrived at the final destination
  const finalPoint = route[route.length - 1];
  const distToEnd = distanceBetween(currentPosition, finalPoint);

  if (distToEnd <= ARRIVAL_THRESHOLD_METERS) {
    return {
      currentWaypointIndex: route.length - 1,
      instruction: generateInstruction(currentPosition, finalPoint, true, userHeading, clearance, doors, recommendedZone),
      distanceToEndFeet: metersToFeet(distToEnd),
      progress: 1,
      arrived: true,
    };
  }

  // Advance waypoint index if we're close enough to the current target
  let idx = currentWaypointIndex;
  while (
    idx < route.length - 1 &&
    distanceBetween(currentPosition, route[idx]) <= WAYPOINT_REACHED_METERS
  ) {
    idx++;
  }

  const target = route[idx];
  const isLast = idx === route.length - 1;
  const instruction = generateInstruction(
    currentPosition,
    target,
    isLast,
    userHeading,
    clearance,
    doors,
    recommendedZone,
  );

  // Calculate progress: distance covered / total route distance
  const distanceCovered = computeDistanceAlongRoute(route, 0, idx) -
    distanceBetween(currentPosition, route[idx]);
  const progress = Math.max(0, Math.min(1, distanceCovered / totalRouteDistance));

  return {
    currentWaypointIndex: idx,
    instruction,
    distanceToEndFeet: metersToFeet(distToEnd),
    progress,
    arrived: false,
  };
}

/**
 * Total distance of the route in meters.
 */
function computeTotalDistance(route: Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += distanceBetween(route[i - 1], route[i]);
  }
  return total;
}

/**
 * Distance along the route from index `from` to index `to`.
 */
function computeDistanceAlongRoute(
  route: Coordinate[],
  from: number,
  to: number,
): number {
  let total = 0;
  for (let i = from + 1; i <= to && i < route.length; i++) {
    total += distanceBetween(route[i - 1], route[i]);
  }
  return total;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
