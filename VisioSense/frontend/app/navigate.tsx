import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Speech from 'expo-speech';

import { AccessibleText as Text } from '@/components/accessible-text';
import { AppHeader } from '@/components/app-header';
import { ScreenContainer } from '@/components/screen-container';
import { useTheme } from '@/context/theme';
import { Fonts, type ThemePalette } from '@/constants/theme';
import { Coordinate, ObstacleAnnotation, SavedPath, getPathById } from '@/services/path-storage';
import {
  startLocationTracking,
  startHeadingTracking,
  getCurrentLocation,
  metersToFeet,
  distanceBetween,
} from '@/services/location-service';
import {
  buildRoute,
  computeNavState,
  createSteeringSmoother,
  ClearanceMap,
  DoorAnnotation,
  NavState,
  Zone,
} from '@/services/navigation-engine';
import { startOdometry } from '@/services/odometry';
import { createHeadingFusion } from '@/services/heading-fusion';
import { NAV_DETECT_URL } from '../config';

const REASSURE_INTERVAL_MS = 5000;
const MIN_SPEAK_INTERVAL_MS = 3000;

function capitalizeFirst(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

type DoorAtBlock = {
  present: boolean;
  zone: 'left' | 'center' | 'right' | null;
  action: 'open' | 'push' | 'pull' | null;
};

type ObstacleState = {
  detected: boolean;
  alertText: string;
  objects: { label: string; distance: number; direction: string; risk: string }[];
  clearance: ClearanceMap | null;
  doors: DoorAnnotation[];
  recommendedZone: Zone | null;
  openPathAvailable: boolean;
  doorAtBlock: DoorAtBlock;
  cached: boolean;
};

export default function NavigateScreen() {
  const router = useRouter();
  const { pathId } = useLocalSearchParams<{ pathId: string }>();
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(palette, isDark), [palette, isDark]);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [path, setPath] = useState<SavedPath | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Coordinate | null>(null);
  const [navState, setNavState] = useState<NavState | null>(null);
  const [route, setRoute] = useState<Coordinate[]>([]);
  const waypointIndexRef = useRef(0);
  const trackerRef = useRef<{ stop: () => void } | null>(null);
  const userHeadingRef = useRef<number | null>(null);
  const headingTrackerRef = useRef<{ stop: () => void } | null>(null);
  const odometryRef = useRef<ReturnType<typeof startOdometry> | null>(null);
  const [headingTick, setHeadingTick] = useState(0);

  const cameraRef = useRef<CameraView | null>(null);
  const [obstacle, setObstacle] = useState<ObstacleState>({
    detected: false,
    alertText: '',
    objects: [],
    clearance: null,
    doors: [],
    recommendedZone: null,
    openPathAvailable: true,
    doorAtBlock: { present: false, zone: null, action: null },
    cached: false,
  });
  const [scanning, setScanning] = useState(false);
  const detectionLoopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSendingRef = useRef(false);

  const lastSpokenRef = useRef('');
  const lastSpokenAtRef = useRef(0);
  const lastCommittedKeyRef = useRef('');
  const speakQueueRef = useRef<'gps' | 'obstacle'>('gps');

  const headingFusionRef = useRef(createHeadingFusion());
  const steeringSmootherRef = useRef(createSteeringSmoother({ minAgreeingFrames: 2 }));

  const announcedIndicesRef = useRef<Set<number>>(new Set());
  const lastAnnouncedWaypointRef = useRef<number>(-1);

  const obstaclesByWaypoint = useMemo(() => {
    const map = new Map<number, ObstacleAnnotation[]>();
    if (!path) return map;
    for (const o of path.obstacles ?? []) {
      const list = map.get(o.waypointIndex) ?? [];
      list.push(o);
      map.set(o.waypointIndex, list);
    }
    return map;
  }, [path]);

  const speak = useCallback(
    (text: string, priority: 'gps' | 'obstacle', force?: boolean) => {
      if (!text) return;
      if (priority === 'gps' && speakQueueRef.current === 'obstacle' && !force) return;
      if (text === lastSpokenRef.current && !force) return;

      Speech.stop();
      const isUrgent = priority === 'obstacle';
      Speech.speak(text, {
        language: 'en-US',
        rate: isUrgent ? 1.15 : 1.0,
        pitch: isUrgent ? 1.05 : 1.0,
      });
      lastSpokenRef.current = text;
      lastSpokenAtRef.current = Date.now();
      speakQueueRef.current = priority;
    },
    []
  );

  useEffect(() => {
    if (!cameraPermission?.granted) requestCameraPermission();
  }, [cameraPermission]);

  useEffect(() => {
    if (!pathId) return;
    (async () => {
      const p = await getPathById(pathId);
      if (p) {
        setPath(p);
        const r = buildRoute(p.start, p.end, p.waypoints);
        setRoute(r);
        speak(
          `Starting navigation for "${p.name}". Camera scanning for obstacles.`,
          'gps',
          true
        );
      }
    })();
  }, [pathId]);

  useEffect(() => {
    (async () => {
      const loc = await getCurrentLocation();
      if (loc) setCurrentLocation(loc);
    })();

    const odo = startOdometry({
      onPositionEstimate: (coord) => setCurrentLocation(coord),
    });
    odometryRef.current = odo;

    const fusion = headingFusionRef.current;

    const tracker = startLocationTracking((coord) => {
      fusion.pushGps(coord);
      const fused = fusion.get();
      if (fused) userHeadingRef.current = fused.value;
      odo.setAnchor(coord);
    }, 2000);
    trackerRef.current = tracker;

    const headingTracker = startHeadingTracking((heading, accuracy) => {
      fusion.pushCompass(heading, accuracy);
      const fused = fusion.get();
      if (fused) {
        userHeadingRef.current = fused.value;
        odo.setHeading(fused.value);
      }
      setHeadingTick((t) => t + 1);
    }, 3);
    headingTrackerRef.current = headingTracker;

    return () => {
      tracker.stop();
      headingTracker.stop();
      odo.stop();
    };
  }, []);

  useEffect(() => {
    if (!currentLocation || route.length === 0) return;

    const state = computeNavState(
      currentLocation,
      route,
      waypointIndexRef.current,
      userHeadingRef.current,
      obstacle.clearance,
      obstacle.doors,
      obstacle.recommendedZone
    );
    waypointIndexRef.current = state.currentWaypointIndex;

    const dab = obstacle.doorAtBlock;
    if (
      dab.present &&
      (state.instruction.steeringSource === 'blocked' ||
        state.instruction.steeringSource === 'depth-override')
    ) {
      const verb = dab.action ?? 'open';
      const zoneText = dab.zone && dab.zone !== 'center' ? ` on your ${dab.zone}` : ' ahead';
      state.instruction = {
        ...state.instruction,
        steeringSource: 'door',
        targetZone: (dab.zone ?? 'center') as Zone,
        direction: `door ${verb}`,
        spokenText: `There is a door${zoneText}. ${capitalizeFirst(verb)} it to continue.`,
      };
    }

    const committed = steeringSmootherRef.current.update({
      source: state.instruction.steeringSource,
      zone: state.instruction.targetZone,
    });
    if (
      committed.source !== state.instruction.steeringSource ||
      committed.zone !== state.instruction.targetZone
    ) {
      state.instruction = {
        ...state.instruction,
        steeringSource: committed.source,
        targetZone: committed.zone,
      };
    }
    setNavState(state);

    const idx = state.currentWaypointIndex;
    if (
      !state.arrived &&
      !obstacle.detected &&
      idx !== lastAnnouncedWaypointRef.current &&
      !announcedIndicesRef.current.has(idx)
    ) {
      const prior = obstaclesByWaypoint.get(idx);
      if (prior && prior.length > 0) {
        const top = prior[0];
        const msg = `Heads up: previously detected ${top.label} on the ${top.zone}.`;
        announcedIndicesRef.current.add(idx);
        lastAnnouncedWaypointRef.current = idx;
        speak(msg, 'gps', true);
        return;
      }
      lastAnnouncedWaypointRef.current = idx;
    }

    if (state.arrived) {
      speak('You have arrived at your destination.', 'gps', true);
    } else if (!obstacle.detected) {
      const committedKey = `${committed.source}:${committed.zone ?? '-'}`;
      const changed = committedKey !== lastCommittedKeyRef.current;
      const elapsed = Date.now() - lastSpokenAtRef.current;
      const stale = elapsed >= REASSURE_INTERVAL_MS;
      const allowedByRate = elapsed >= MIN_SPEAK_INTERVAL_MS;
      const skipDueToCache = obstacle.cached && !changed;

      if ((changed || stale) && allowedByRate && !skipDueToCache) {
        speak(state.instruction.spokenText, 'gps', changed);
        lastCommittedKeyRef.current = committedKey;
      }
    }
  }, [
    currentLocation,
    route,
    obstacle.detected,
    obstacle.clearance,
    obstacle.doors,
    obstacle.recommendedZone,
    obstacle.doorAtBlock,
    obstacle.cached,
    obstaclesByWaypoint,
    headingTick,
  ]);

  const captureAndDetect = useCallback(async () => {
    if (!cameraRef.current || isSendingRef.current || !navState) return;
    isSendingRef.current = true;
    setScanning(true);

    try {
      const raw = await cameraRef.current.takePictureAsync({
        quality: 1,
        skipProcessing: true,
      });
      const photo = await ImageManipulator.manipulateAsync(
        raw.uri,
        [{ resize: { width: 640 } }],
        { compress: 0.65, format: ImageManipulator.SaveFormat.JPEG }
      );
      const formData = new FormData();
      formData.append('file', {
        uri: photo.uri,
        name: 'nav_frame.jpg',
        type: 'image/jpeg',
      } as any);

      const url = `${NAV_DETECT_URL}?nav_direction=${encodeURIComponent(
        navState.instruction.direction
      )}&nav_distance_ft=${navState.instruction.distanceFeet}`;

      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      const json = await response.json();
      const hasObstacle = json.obstacle_detected === true;

      const yoloDoors = (json.doors as DoorAnnotation[] | undefined) ?? [];
      const depthOpenings = (json.openings as DoorAnnotation[] | undefined) ?? [];
      const preferredTargets: DoorAnnotation[] = [...depthOpenings, ...yoloDoors];

      const doorAtBlock: DoorAtBlock =
        json.door_at_block && typeof json.door_at_block === 'object'
          ? {
              present: !!json.door_at_block.present,
              zone: (json.door_at_block.zone ?? null) as DoorAtBlock['zone'],
              action: (json.door_at_block.action ?? null) as DoorAtBlock['action'],
            }
          : { present: false, zone: null, action: null };

      setObstacle({
        detected: hasObstacle,
        alertText: json.alert_text ?? '',
        objects: json.objects ?? [],
        clearance: (json.clearance as ClearanceMap | undefined) ?? null,
        doors: preferredTargets,
        recommendedZone: (json.recommended_zone as Zone | null | undefined) ?? null,
        openPathAvailable: json.open_path_available !== false,
        doorAtBlock,
        cached: !!json.perf?.cached,
      });

      if (hasObstacle) speak(json.alert_text, 'obstacle', true);
      else speakQueueRef.current = 'gps';
    } catch (err) {
      console.error('Nav detection error:', err);
    } finally {
      isSendingRef.current = false;
      setScanning(false);
    }
  }, [navState, speak]);

  useEffect(() => {
    if (!cameraPermission?.granted || !navState || navState.arrived) {
      if (detectionLoopRef.current) {
        clearTimeout(detectionLoopRef.current);
        detectionLoopRef.current = null;
      }
      return;
    }
    let cancelled = false;
    const runCycle = async () => {
      if (cancelled) return;
      await captureAndDetect();
      if (cancelled) return;
      detectionLoopRef.current = setTimeout(runCycle, 3000);
    };
    runCycle();
    return () => {
      cancelled = true;
      if (detectionLoopRef.current) {
        clearTimeout(detectionLoopRef.current);
        detectionLoopRef.current = null;
      }
    };
  }, [cameraPermission?.granted, navState?.arrived, captureAndDetect]);

  const handleStop = () => {
    trackerRef.current?.stop();
    headingTrackerRef.current?.stop();
    odometryRef.current?.stop();
    if (detectionLoopRef.current) clearTimeout(detectionLoopRef.current);
    Speech.stop();
    speak('Navigation stopped.', 'gps', true);
    setTimeout(() => router.back(), 800);
  };

  const handleRepeat = () => {
    if (obstacle.detected && obstacle.alertText) {
      speak(obstacle.alertText, 'obstacle', true);
    } else if (navState) {
      speak(navState.instruction.spokenText, 'gps', true);
    }
  };

  const progressPercent = navState ? Math.round(navState.progress * 100) : 0;
  const dangerObjects = obstacle.objects.filter((o) => o.risk === 'danger');
  const cautionObjects = obstacle.objects.filter((o) => o.risk === 'caution');

  const arrivedColor = '#34C759';
  const cautionColor = '#FF9F0A';

  const stateColor = navState?.arrived
    ? arrivedColor
    : obstacle.detected && dangerObjects.length > 0
      ? palette.error
      : obstacle.detected
        ? cautionColor
        : palette.primary;

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <AppHeader
          eyebrow="VISIOPATH"
          title={path ? path.name : 'Navigation'}
          onBack={handleStop}
          showMenu={false}
        />

        {/* Status pill */}
        <View style={[styles.statusPill, { borderColor: `${stateColor}40` }]}>
          <View style={[styles.statusDot, { backgroundColor: stateColor }]} />
          <Text style={[styles.statusPillText, { color: stateColor }]}>
            {obstacle.detected
              ? dangerObjects.length > 0
                ? 'STOP — OBSTACLE'
                : 'CAUTION'
              : navState?.arrived
                ? 'ARRIVED'
                : 'GUIDANCE ACTIVE'}
          </Text>
        </View>

        {/* Camera preview */}
        {cameraPermission?.granted && (
          <View
            style={[
              styles.cameraContainer,
              obstacle.detected && { borderColor: `${palette.error}66` },
            ]}
          >
            <CameraView
              ref={(node) => {
                cameraRef.current = node;
              }}
              style={styles.camera}
              facing="back"
              animateShutter={false}
            >
              <View style={styles.cameraOverlay}>
                <View style={styles.cameraBadge}>
                  <View
                    style={[
                      styles.cameraDot,
                      scanning && { backgroundColor: '#FFFFFF' },
                    ]}
                  />
                  <Text style={styles.cameraBadgeText}>
                    {scanning ? 'Scanning…' : 'Environment scan'}
                  </Text>
                </View>
                {obstacle.detected && (
                  <View
                    style={[
                      styles.obstacleOverlayBadge,
                      {
                        backgroundColor:
                          dangerObjects.length > 0
                            ? 'rgba(255,59,48,0.7)'
                            : 'rgba(255,159,10,0.7)',
                      },
                    ]}
                  >
                    <Ionicons name="warning" size={14} color="#FFFFFF" />
                    <Text style={styles.obstacleOverlayText}>
                      {dangerObjects.length > 0
                        ? `${dangerObjects.length} danger`
                        : `${cautionObjects.length} caution`}
                    </Text>
                  </View>
                )}
              </View>
            </CameraView>
          </View>
        )}

        {/* Instruction card */}
        <View
          style={[
            styles.instructionCard,
            navState?.arrived && { backgroundColor: `${arrivedColor}1A`, borderColor: `${arrivedColor}55` },
            obstacle.detected && dangerObjects.length > 0 && {
              backgroundColor: `${palette.error}1A`,
              borderColor: `${palette.error}55`,
            },
            obstacle.detected && dangerObjects.length === 0 && {
              backgroundColor: `${cautionColor}1A`,
              borderColor: `${cautionColor}55`,
            },
          ]}
        >
          {navState?.arrived ? (
            <View style={styles.arrivedContainer}>
              <Ionicons name="checkmark-circle" size={48} color={arrivedColor} />
              <Text style={[styles.arrivedText, { color: arrivedColor }]}>
                You have arrived!
              </Text>
              <Text style={styles.arrivedSub}>{path?.name ?? 'Destination reached'}</Text>
            </View>
          ) : obstacle.detected ? (
            <>
              <View style={styles.obstacleHeader}>
                <Ionicons
                  name={dangerObjects.length > 0 ? 'alert-circle' : 'warning'}
                  size={22}
                  color={dangerObjects.length > 0 ? palette.error : cautionColor}
                />
                <Text
                  style={[
                    styles.directionLabel,
                    { color: dangerObjects.length > 0 ? palette.error : cautionColor },
                  ]}
                >
                  {dangerObjects.length > 0 ? 'STOP — OBSTACLE' : 'CAUTION'}
                </Text>
              </View>
              <Text style={styles.instructionText}>{obstacle.alertText}</Text>
              {navState && (
                <View style={styles.resumeHint}>
                  <Ionicons name="navigate" size={14} color={palette.primary} />
                  <Text style={[styles.resumeHintText, { color: palette.primary }]}>
                    Route resumes: {navState.instruction.direction} for{' '}
                    {navState.instruction.distanceFeet} ft
                  </Text>
                </View>
              )}
            </>
          ) : navState ? (
            <>
              <Text style={[styles.directionLabel, { color: palette.primary }]}>
                {navState.instruction.direction.toUpperCase()}
              </Text>
              <Text style={styles.instructionText}>
                {navState.instruction.spokenText}
              </Text>
              <View style={styles.metricsRow}>
                <View style={styles.metric}>
                  <Text style={styles.metricValue}>
                    {navState.instruction.distanceFeet}
                  </Text>
                  <Text style={styles.metricLabel}>feet</Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricValue}>
                    {navState.instruction.distanceSteps}
                  </Text>
                  <Text style={styles.metricLabel}>steps</Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricValue}>{navState.distanceToEndFeet}</Text>
                  <Text style={styles.metricLabel}>ft to end</Text>
                </View>
              </View>
            </>
          ) : (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={palette.primary} />
              <Text style={styles.loadingText}>Acquiring GPS signal…</Text>
            </View>
          )}
        </View>

        {/* Progress */}
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>Progress</Text>
            <Text style={[styles.progressPercent, { color: stateColor }]}>
              {progressPercent}%
            </Text>
          </View>
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${progressPercent}%`, backgroundColor: stateColor },
              ]}
            />
          </View>
          {path && currentLocation && (
            <View style={styles.progressStats}>
              <Text style={styles.progressStatText}>
                Start: {metersToFeet(distanceBetween(currentLocation, path.start))} ft
              </Text>
              <Text style={styles.progressStatText}>
                End: {navState ? navState.distanceToEndFeet : '…'} ft
              </Text>
            </View>
          )}
        </View>

        {obstacle.detected && obstacle.objects.length > 0 && (
          <View style={styles.obstacleCard}>
            <Text style={styles.sectionLabel}>Obstacles detected</Text>
            {obstacle.objects
              .filter((o) => o.risk !== 'clear')
              .slice(0, 3)
              .map((o, i) => (
                <View key={`${o.label}-${i}`} style={styles.obstacleRow}>
                  <View>
                    <Text style={styles.obstacleName}>{o.label}</Text>
                    <Text style={styles.obstacleDetail}>
                      {o.direction} • {(o.distance * 3.28).toFixed(0)} ft
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.riskBadge,
                      {
                        backgroundColor:
                          o.risk === 'danger'
                            ? `${palette.error}22`
                            : `${cautionColor}22`,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.riskBadgeText,
                        { color: o.risk === 'danger' ? palette.error : cautionColor },
                      ]}
                    >
                      {o.risk}
                    </Text>
                  </View>
                </View>
              ))}
          </View>
        )}

        <View style={{ flex: 1 }} />

        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleRepeat}
            accessibilityRole="button"
            accessibilityLabel="Repeat last instruction"
          >
            <Ionicons
              name="volume-high"
              size={20}
              color={palette.onSurface}
              style={{ marginRight: 6 }}
            />
            <Text style={styles.secondaryButtonText}>Repeat</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.stopButton, { backgroundColor: palette.error, shadowColor: palette.error }]}
            onPress={handleStop}
            accessibilityRole="button"
            accessibilityLabel="Stop navigation"
          >
            <Ionicons
              name="stop-circle"
              size={20}
              color="#FFFFFF"
              style={{ marginRight: 6 }}
            />
            <Text style={styles.stopButtonText}>Stop</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScreenContainer>
  );
}

function makeStyles(p: ThemePalette, isDark: boolean) {
  const cardBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(60,60,67,0.08)';
  return StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: 20,
      paddingTop: Platform.OS === 'android' ? 16 : 8,
      paddingBottom: Platform.OS === 'android' ? 16 : 12,
    },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 999,
      backgroundColor: p.surfaceContainerLow,
      borderWidth: 1,
      borderColor: cardBorder,
      marginBottom: 14,
    },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    statusPillText: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
    },

    cameraContainer: {
      height: 140,
      borderRadius: 20,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: cardBorder,
      backgroundColor: '#000',
      marginBottom: 12,
    },
    camera: { flex: 1 },
    cameraOverlay: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      padding: 10,
    },
    cameraBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: 9999,
      paddingVertical: 4,
      paddingHorizontal: 10,
    },
    cameraDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: 'rgba(255,255,255,0.4)',
      marginRight: 6,
    },
    cameraBadgeText: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '600',
      fontFamily: Fonts.sans,
    },
    obstacleOverlayBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderRadius: 9999,
      paddingVertical: 4,
      paddingHorizontal: 10,
    },
    obstacleOverlayText: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '700',
      fontFamily: Fonts.sans,
    },

    instructionCard: {
      borderRadius: 22,
      padding: 18,
      borderWidth: 1,
      borderColor: cardBorder,
      backgroundColor: p.surfaceContainerLow,
      minHeight: 150,
      marginBottom: 12,
      justifyContent: 'center',
    },
    obstacleHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    directionLabel: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    instructionText: {
      fontFamily: Fonts.sans,
      fontSize: 19,
      fontWeight: '600',
      color: p.onSurface,
      lineHeight: 26,
      marginTop: 4,
    },
    resumeHint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 14,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: p.outlineVariant,
    },
    resumeHintText: { fontSize: 13, fontFamily: Fonts.sans, fontWeight: '500' },
    metricsRow: { flexDirection: 'row', marginTop: 16, gap: 10 },
    metric: {
      flex: 1,
      backgroundColor: p.surfaceContainerHigh,
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: 'center',
    },
    metricValue: {
      fontFamily: Fonts.sans,
      fontSize: 20,
      fontWeight: '700',
      color: p.onSurface,
    },
    metricLabel: {
      fontFamily: Fonts.sans,
      fontSize: 10,
      color: p.onSurfaceVariant,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 2,
      fontWeight: '600',
    },
    arrivedContainer: { alignItems: 'center', paddingVertical: 8 },
    arrivedText: {
      fontFamily: Fonts.sans,
      fontSize: 24,
      fontWeight: '700',
      marginTop: 12,
    },
    arrivedSub: {
      fontFamily: Fonts.sans,
      fontSize: 15,
      color: p.onSurfaceVariant,
      marginTop: 4,
    },
    loadingContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    loadingText: {
      fontFamily: Fonts.sans,
      fontSize: 16,
      color: p.onSurfaceVariant,
    },

    progressCard: {
      padding: 14,
      borderRadius: 18,
      backgroundColor: p.surfaceContainerLow,
      borderWidth: 1,
      borderColor: cardBorder,
      marginBottom: 10,
    },
    progressHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    progressLabel: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      color: p.onSurfaceVariant,
      fontWeight: '600',
    },
    progressPercent: {
      fontFamily: Fonts.sans,
      fontSize: 14,
      fontWeight: '700',
    },
    progressBarBg: {
      height: 8,
      borderRadius: 4,
      backgroundColor: p.surfaceContainerHigh,
      overflow: 'hidden',
    },
    progressBarFill: { height: '100%', borderRadius: 4 },
    progressStats: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 8,
    },
    progressStatText: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      color: p.onSurfaceVariant,
    },

    obstacleCard: {
      padding: 14,
      borderRadius: 18,
      backgroundColor: p.surfaceContainerLow,
      borderWidth: 1,
      borderColor: `${p.error}33`,
      marginBottom: 10,
    },
    sectionLabel: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      color: p.onSurfaceVariant,
      marginBottom: 8,
      fontWeight: '600',
    },
    obstacleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: p.outlineVariant,
    },
    obstacleName: {
      fontFamily: Fonts.sans,
      color: p.onSurface,
      fontSize: 15,
      fontWeight: '600',
      textTransform: 'capitalize',
    },
    obstacleDetail: {
      fontFamily: Fonts.sans,
      color: p.onSurfaceVariant,
      fontSize: 12,
      marginTop: 2,
    },
    riskBadge: {
      borderRadius: 9999,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    riskBadgeText: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
    },

    controlsRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
    secondaryButton: {
      flex: 1,
      flexDirection: 'row',
      backgroundColor: p.surfaceContainerLow,
      borderWidth: 1,
      borderColor: cardBorder,
      paddingVertical: 16,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButtonText: {
      fontFamily: Fonts.sans,
      color: p.onSurface,
      fontSize: 14,
      fontWeight: '600',
    },
    stopButton: {
      flex: 1,
      flexDirection: 'row',
      paddingVertical: 16,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      shadowOpacity: 0.35,
      shadowOffset: { width: 0, height: 8 },
      shadowRadius: 16,
      elevation: 6,
    },
    stopButtonText: {
      fontFamily: Fonts.sans,
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
    },
  });
}
