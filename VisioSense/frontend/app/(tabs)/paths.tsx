import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';

import { AccessibleText as Text } from '@/components/accessible-text';
import { AppHeader } from '@/components/app-header';
import { BottomNavPills } from '@/components/bottom-nav-pills';
import { ScreenContainer } from '@/components/screen-container';
import { useAccessibilitySettings } from '@/context/accessibility-settings';
import { useTheme } from '@/context/theme';
import { Fonts, type ThemePalette } from '@/constants/theme';
import {
  Coordinate,
  ObstacleAnnotation,
  SavedPath,
  getAllPaths,
  subscribePaths,
  savePath,
  deletePath,
  renamePath,
} from '@/services/path-storage';
import { NAV_DETECT_URL } from '../../config';
import {
  requestLocationPermission,
  getCurrentLocation,
  startLocationTracking,
  findNearbyPaths,
  distanceBetween,
  metersToFeet,
} from '@/services/location-service';

type Screen = 'home' | 'create' | 'navigate';

const PLACE_ICON_KEYS = ['home', 'work', 'school', 'grocery', 'bus'] as const;
const PLACE_ICON_NAMES: Record<(typeof PLACE_ICON_KEYS)[number], string> = {
  home: 'home',
  work: 'briefcase',
  school: 'school',
  grocery: 'cart',
  bus: 'bus',
};

function getPlaceIcon(pathName: string, accent: string) {
  const lower = pathName.toLowerCase();
  for (const key of PLACE_ICON_KEYS) {
    if (lower.includes(key)) return { name: PLACE_ICON_NAMES[key], color: accent };
  }
  return { name: 'location', color: accent };
}

export default function PathsScreen() {
  const router = useRouter();
  const { accentColor } = useAccessibilitySettings();
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(palette, isDark), [palette, isDark]);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [screen, setScreen] = useState<Screen>('home');
  const [paths, setPaths] = useState<SavedPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [locationGranted, setLocationGranted] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<Coordinate | null>(null);
  const [nearbyPaths, setNearbyPaths] = useState<SavedPath[]>([]);
  const [nearbyPrompted, setNearbyPrompted] = useState<Set<string>>(new Set());

  const [pathName, setPathName] = useState('');
  const [startCoord, setStartCoord] = useState<Coordinate | null>(null);
  const [endCoord, setEndCoord] = useState<Coordinate | null>(null);
  const [settingEnd, setSettingEnd] = useState(false);
  const [saving, setSaving] = useState(false);
  const recordedWaypointsRef = useRef<Coordinate[]>([]);
  const waypointTrackerRef = useRef<{ stop: () => void } | null>(null);
  const lastWaypointCoordRef = useRef<Coordinate | null>(null);
  const [waypointCount, setWaypointCount] = useState(0);

  const cameraRef = useRef<CameraView | null>(null);
  const obstaclesRef = useRef<ObstacleAnnotation[]>([]);
  const obstacleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sampleInFlightRef = useRef(false);
  const [obstacleSampleCount, setObstacleSampleCount] = useState(0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const speak = useCallback((text: string) => {
    Speech.stop();
    Speech.speak(text, { language: 'en-US', rate: 1.0, pitch: 1.0 });
  }, []);

  useEffect(() => {
    loadPaths();
    const unsub = subscribePaths((fresh) => {
      setPaths(fresh);
      setLoading(false);
    });
    return unsub;
  }, []);

  const loadPaths = async () => {
    setLoading(true);
    const allPaths = await getAllPaths();
    setPaths(allPaths);
    setLoading(false);
  };

  useEffect(() => {
    let tracker: { stop: () => void } | null = null;
    (async () => {
      const granted = await requestLocationPermission();
      setLocationGranted(granted);
      if (granted) {
        const loc = await getCurrentLocation();
        if (loc) setCurrentLocation(loc);
        tracker = startLocationTracking((coord) => setCurrentLocation(coord), 3000);
      }
    })();
    return () => tracker?.stop();
  }, []);

  useEffect(() => {
    if (!currentLocation || paths.length === 0) return;
    const nearby = findNearbyPaths(currentLocation, paths);
    setNearbyPaths(nearby);
    for (const p of nearby) {
      if (!nearbyPrompted.has(p.id)) {
        speak(`You're near your saved path "${p.name}". Tap to start navigating.`);
        setNearbyPrompted((prev) => new Set(prev).add(p.id));
      }
    }
  }, [currentLocation, paths, nearbyPrompted, speak]);

  const handleStartCreate = async () => {
    if (!locationGranted) {
      const granted = await requestLocationPermission();
      if (!granted) {
        speak('Location permission is required to create a path.');
        return;
      }
      setLocationGranted(true);
    }
    const loc = await getCurrentLocation();
    if (!loc) {
      speak('Unable to get your current location. Please try again.');
      return;
    }
    setStartCoord(loc);
    setEndCoord(null);
    setPathName('');
    setSettingEnd(false);
    setScreen('create');
    speak('Path creation started. Your current location is set as the start point.');
  };

  const sampleObstacleFrame = async () => {
    if (sampleInFlightRef.current) return;
    if (!cameraRef.current) return;
    sampleInFlightRef.current = true;
    try {
      const raw = await cameraRef.current.takePictureAsync({ quality: 1, skipProcessing: true });
      const photo = await ImageManipulator.manipulateAsync(
        raw.uri,
        [{ resize: { width: 640 } }],
        { compress: 0.65, format: ImageManipulator.SaveFormat.JPEG }
      );
      const formData = new FormData();
      formData.append('file', {
        uri: photo.uri,
        name: 'sample.jpg',
        type: 'image/jpeg',
      } as any);
      const response = await fetch(NAV_DETECT_URL, {
        method: 'POST',
        body: formData,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (!response.ok) return;
      const json = await response.json();
      const objects: {
        label: string;
        distance: number;
        direction: string;
        risk: string;
      }[] = json.objects ?? [];

      const waypointIndex = Math.max(0, recordedWaypointsRef.current.length - 1);
      const tail = obstaclesRef.current.slice(-3);
      const recentLabels = new Set(tail.map((o) => o.label));
      for (const o of objects) {
        const risk = o.risk === 'danger' ? 'high' : o.risk === 'caution' ? 'medium' : null;
        if (!risk) continue;
        if (recentLabels.has(o.label)) continue;
        const dir = (o.direction ?? '').toLowerCase();
        const zone: 'left' | 'center' | 'right' = dir.includes('left')
          ? 'left'
          : dir.includes('right')
            ? 'right'
            : 'center';
        obstaclesRef.current.push({
          waypointIndex,
          label: o.label,
          zone,
          risk,
          distance_m: o.distance,
          capturedAt: Date.now(),
        });
        recentLabels.add(o.label);
      }
      setObstacleSampleCount(obstaclesRef.current.length);
    } catch (err) {
      console.warn('obstacle sample failed:', err);
    } finally {
      sampleInFlightRef.current = false;
    }
  };

  const startObstacleSampling = () => {
    if (obstacleTimerRef.current) return;
    obstaclesRef.current = [];
    setObstacleSampleCount(0);
    sampleObstacleFrame();
    obstacleTimerRef.current = setInterval(sampleObstacleFrame, 5000);
  };

  const stopObstacleSampling = () => {
    if (obstacleTimerRef.current) {
      clearInterval(obstacleTimerRef.current);
      obstacleTimerRef.current = null;
    }
  };

  const handleSetEndPoint = async () => {
    recordedWaypointsRef.current = [];
    lastWaypointCoordRef.current = startCoord;
    setWaypointCount(0);

    if (!cameraPermission?.granted) await requestCameraPermission();

    waypointTrackerRef.current = startLocationTracking((coord) => {
      const last = lastWaypointCoordRef.current;
      if (!last || distanceBetween(last, coord) >= 10) {
        recordedWaypointsRef.current.push(coord);
        lastWaypointCoordRef.current = coord;
        setWaypointCount(recordedWaypointsRef.current.length);
      }
    }, 2000);

    startObstacleSampling();
    setSettingEnd(true);
    speak('Walk to your destination, then tap Confirm End Location.');
  };

  const handleConfirmEnd = async () => {
    waypointTrackerRef.current?.stop();
    waypointTrackerRef.current = null;
    stopObstacleSampling();

    const loc = await getCurrentLocation();
    if (!loc) {
      speak('Unable to get location. Try again.');
      setSettingEnd(false);
      return;
    }
    setEndCoord(loc);
    setSettingEnd(false);
    const wc = recordedWaypointsRef.current.length;
    speak(
      `End location set. Recorded ${wc} waypoint${wc !== 1 ? 's' : ''}. Give this path a name and save it.`
    );
  };

  const handleSavePath = async () => {
    if (!startCoord || !endCoord) return speak('Please set both start and end locations.');
    if (!pathName.trim()) return speak('Please enter a name for this path.');

    setSaving(true);
    await savePath(
      pathName.trim(),
      startCoord,
      endCoord,
      recordedWaypointsRef.current,
      obstaclesRef.current
    );
    recordedWaypointsRef.current = [];
    obstaclesRef.current = [];
    setWaypointCount(0);
    setObstacleSampleCount(0);
    await loadPaths();
    setSaving(false);
    setScreen('home');
    speak(`Path "${pathName.trim()}" saved successfully.`);
  };

  const handleDeletePath = (path: SavedPath) => {
    Alert.alert('Delete Path', `Delete "${path.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deletePath(path.id);
          await loadPaths();
          speak(`Path "${path.name}" deleted.`);
        },
      },
    ]);
  };

  const handleStartRename = (path: SavedPath) => {
    setEditingId(path.id);
    setEditName(path.name);
  };

  const handleConfirmRename = async () => {
    if (editingId && editName.trim()) {
      await renamePath(editingId, editName.trim());
      await loadPaths();
      speak(`Path renamed to "${editName.trim()}".`);
    }
    setEditingId(null);
    setEditName('');
  };

  const handleStartNavigation = (path: SavedPath) => {
    router.push({ pathname: '/navigate', params: { pathId: path.id } });
  };

  // ─── Create flow ───
  if (screen === 'create') {
    return (
      <ScreenContainer>
        <View style={styles.container}>
          <AppHeader
            eyebrow="VISIOPATH"
            title="New Route"
            onBack={() => {
              waypointTrackerRef.current?.stop();
              waypointTrackerRef.current = null;
              stopObstacleSampling();
              recordedWaypointsRef.current = [];
              obstaclesRef.current = [];
              setWaypointCount(0);
              setObstacleSampleCount(0);
              setScreen('home');
              speak('Cancelled path creation.');
            }}
            showMenu={false}
          />

          <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.placeIconBg, { backgroundColor: `${accentColor}1A` }]}>
                  <Ionicons name="location" size={20} color={accentColor} />
                </View>
                <Text style={styles.cardTitle}>Start Location</Text>
              </View>
              {startCoord ? (
                <Text style={styles.coordText}>
                  {startCoord.latitude.toFixed(6)}, {startCoord.longitude.toFixed(6)}
                </Text>
              ) : (
                <Text style={styles.dimText}>Not set</Text>
              )}
              <View style={[styles.statusChip, { backgroundColor: `${accentColor}1A` }]}>
                <Text style={[styles.statusChipText, { color: accentColor }]}>
                  Set to current location
                </Text>
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.placeIconBg, { backgroundColor: `${palette.error}22` }]}>
                  <Ionicons name="flag" size={20} color={palette.error} />
                </View>
                <Text style={styles.cardTitle}>End Location</Text>
              </View>
              {endCoord ? (
                <>
                  <Text style={styles.coordText}>
                    {endCoord.latitude.toFixed(6)}, {endCoord.longitude.toFixed(6)}
                  </Text>
                  {startCoord && (
                    <Text style={styles.dimText}>
                      {metersToFeet(distanceBetween(startCoord, endCoord))} ft from start
                    </Text>
                  )}
                </>
              ) : settingEnd ? (
                <View>
                  <View style={styles.settingEndRow}>
                    <ActivityIndicator size="small" color={palette.primary} />
                    <Text style={styles.settingEndText}>Walk to your destination…</Text>
                  </View>
                  {waypointCount > 0 && (
                    <Text style={[styles.dimText, { marginTop: 6 }]}>
                      {waypointCount} waypoint{waypointCount !== 1 ? 's' : ''} recorded
                    </Text>
                  )}
                </View>
              ) : (
                <Text style={styles.dimText}>Not set yet</Text>
              )}

              {!endCoord && !settingEnd && (
                <TouchableOpacity
                  style={[
                    styles.actionButton,
                    { backgroundColor: `${accentColor}1A`, borderColor: `${accentColor}30` },
                  ]}
                  onPress={handleSetEndPoint}
                  accessibilityRole="button"
                >
                  <Text style={[styles.actionButtonText, { color: accentColor }]}>
                    Start Walking to End Point
                  </Text>
                </TouchableOpacity>
              )}

              {settingEnd && (
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: palette.error }]}
                  onPress={handleConfirmEnd}
                  accessibilityRole="button"
                >
                  <Text style={[styles.actionButtonText, { color: '#fff' }]}>
                    Confirm End Location
                  </Text>
                </TouchableOpacity>
              )}

              {settingEnd && cameraPermission?.granted && (
                <View style={styles.miniCameraWrap}>
                  <CameraView
                    ref={(node) => {
                      cameraRef.current = node;
                    }}
                    style={styles.miniCamera}
                    facing="back"
                    animateShutter={false}
                  />
                  <View style={styles.miniCameraBadge}>
                    <Ionicons name="scan" size={12} color={accentColor} />
                    <Text style={[styles.miniCameraBadgeText, { color: accentColor }]}>
                      Scanning hazards • {obstacleSampleCount} logged
                    </Text>
                  </View>
                </View>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.placeIconBg, { backgroundColor: `${palette.primary}22` }]}>
                  <Ionicons name="pencil" size={20} color={palette.primary} />
                </View>
                <Text style={styles.cardTitle}>Path Name</Text>
              </View>
              <TextInput
                style={styles.textInput}
                placeholder="e.g., Home to Office"
                placeholderTextColor={palette.outline}
                value={pathName}
                onChangeText={setPathName}
                accessibilityLabel="Path name input"
              />
            </View>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                !startCoord || !endCoord || !pathName.trim()
                  ? styles.disabledButton
                  : { backgroundColor: accentColor, shadowColor: accentColor },
              ]}
              onPress={handleSavePath}
              disabled={!startCoord || !endCoord || !pathName.trim() || saving}
              accessibilityRole="button"
            >
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Save Path</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </ScreenContainer>
    );
  }

  // ─── Home (list) ───
  const renderPathRow = (p: SavedPath, isLast: boolean) => {
    const icon = getPlaceIcon(p.name, accentColor);
    if (editingId === p.id) {
      return (
        <View key={p.id} style={styles.listRow}>
          <TextInput
            style={styles.editInput}
            value={editName}
            onChangeText={setEditName}
            autoFocus
            onSubmitEditing={handleConfirmRename}
            returnKeyType="done"
          />
          <TouchableOpacity onPress={handleConfirmRename} style={styles.rowAction}>
            <Ionicons name="checkmark" size={22} color={palette.primary} />
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View key={p.id}>
        <TouchableOpacity
          style={styles.listRow}
          onPress={() => handleStartNavigation(p)}
          onLongPress={() => handleStartRename(p)}
          accessibilityRole="button"
          accessibilityLabel={`Navigate ${p.name}`}
          activeOpacity={0.6}
        >
          <View style={[styles.rowIconBg, { backgroundColor: `${icon.color}1A` }]}>
            <Ionicons name={icon.name as any} size={18} color={icon.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{p.name}</Text>
            <Text style={styles.rowSubtitle}>
              {metersToFeet(distanceBetween(p.start, p.end))} ft •{' '}
              {new Date(p.createdAt).toLocaleDateString()}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => handleDeletePath(p)}
            accessibilityLabel={`Delete ${p.name}`}
            hitSlop={10}
            style={styles.rowDeleteHit}
          >
            <Ionicons name="trash-outline" size={18} color={palette.error} />
          </TouchableOpacity>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={palette.outline}
            style={{ marginLeft: 6 }}
          />
        </TouchableOpacity>
        {!isLast && <View style={styles.rowDivider} />}
      </View>
    );
  };

  return (
    <ScreenContainer>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <AppHeader eyebrow="VISIOPATH" title="Routes" />

        {/* Status pill */}
        <View style={styles.statusPill}>
          <View
            style={[
              styles.statusDot,
              locationGranted && { backgroundColor: '#34C759' },
            ]}
          />
          <Text style={styles.statusPillText}>
            {locationGranted ? 'Location active' : 'Location off'} · {paths.length} saved
            {nearbyPaths.length > 0 ? ` · ${nearbyPaths.length} nearby` : ''}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.addRouteCta, { backgroundColor: palette.primary }]}
          onPress={handleStartCreate}
          accessibilityRole="button"
          activeOpacity={0.9}
        >
          <Ionicons name="add" size={20} color="#FFFFFF" />
          <Text style={styles.addRouteCtaText}>Add Route</Text>
        </TouchableOpacity>

        {nearbyPaths.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>NEARBY</Text>
            <View style={styles.group}>
              {nearbyPaths.map((p, i) => (
                <View key={p.id}>
                  <TouchableOpacity
                    style={styles.listRow}
                    onPress={() => handleStartNavigation(p)}
                    activeOpacity={0.6}
                  >
                    <View
                      style={[styles.rowIconBg, { backgroundColor: `${accentColor}1A` }]}
                    >
                      <Ionicons
                        name={getPlaceIcon(p.name, accentColor).name as any}
                        size={18}
                        color={accentColor}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{p.name}</Text>
                      <Text style={styles.rowSubtitle}>
                        {currentLocation
                          ? `${metersToFeet(distanceBetween(currentLocation, p.start))} ft away`
                          : 'Calculating…'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={palette.outline} />
                  </TouchableOpacity>
                  {i < nearbyPaths.length - 1 && <View style={styles.rowDivider} />}
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionHeader}>ALL ROUTES</Text>
        {loading ? (
          <View style={[styles.group, styles.centered]}>
            <ActivityIndicator color={palette.primary} />
          </View>
        ) : paths.length === 0 ? (
          <View style={styles.emptyState}>
            <View
              style={[
                styles.emptyMark,
                { backgroundColor: isDark ? 'rgba(10,132,255,0.16)' : 'rgba(10,132,255,0.10)' },
              ]}
            >
              <Ionicons name="map-outline" size={28} color={palette.primary} />
            </View>
            <Text style={styles.emptyTitle}>No routes yet</Text>
            <Text style={styles.emptyBody}>
              Walk a path once and we&apos;ll save the way. Tap Add Route above to begin.
            </Text>
          </View>
        ) : (
          <View style={styles.group}>
            {paths.map((p, i) => renderPathRow(p, i === paths.length - 1))}
          </View>
        )}

        <Text style={styles.groupFootnote}>Long-press a route to rename it.</Text>
        <View style={{ height: 8 }} />
      </ScrollView>

      <BottomNavPills active="routes" />
    </ScreenContainer>
  );
}

function makeStyles(p: ThemePalette, isDark: boolean) {
  const cardBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(60,60,67,0.06)';
  const divider = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(60,60,67,0.08)';
  return StyleSheet.create({
    container: { flex: 1, paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 16 : 8 },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: Platform.OS === 'android' ? 16 : 8,
      paddingBottom: 24,
    },
    scrollArea: { flex: 1 },

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
      marginBottom: 16,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: p.outline,
    },
    statusPillText: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      fontWeight: '600',
      color: p.onSurface,
    },

    addRouteCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 16,
      borderRadius: 18,
      marginBottom: 8,
      shadowColor: p.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 6,
    },
    addRouteCtaText: {
      fontFamily: Fonts.sans,
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '700',
    },

    sectionHeader: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      fontWeight: '600',
      color: p.onSurfaceVariant,
      letterSpacing: 0.8,
      marginBottom: 8,
      marginTop: 16,
      marginLeft: 16,
    },
    group: {
      backgroundColor: p.surfaceContainerLow,
      borderRadius: 20,
      overflow: 'hidden',
      marginBottom: 4,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    groupFootnote: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      color: p.onSurfaceVariant,
      marginLeft: 16,
      marginTop: 4,
    },
    listRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    rowIconBg: {
      width: 36,
      height: 36,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowTitle: {
      fontFamily: Fonts.sans,
      fontSize: 16,
      color: p.onSurface,
      fontWeight: '600',
    },
    rowSubtitle: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: p.onSurfaceVariant,
      marginTop: 2,
    },
    rowDivider: {
      height: 1,
      backgroundColor: divider,
      marginLeft: 64,
    },
    rowAction: { padding: 6 },
    rowDeleteHit: { padding: 6 },

    emptyState: {
      padding: 28,
      alignItems: 'center',
      backgroundColor: p.surfaceContainerLow,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    emptyMark: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
    emptyTitle: {
      fontFamily: Fonts.sans,
      fontSize: 17,
      fontWeight: '700',
      color: p.onSurface,
      marginBottom: 4,
    },
    emptyBody: {
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: p.onSurfaceVariant,
      textAlign: 'center',
      lineHeight: 20,
    },

    // Create flow
    card: {
      backgroundColor: p.surfaceContainerLow,
      borderRadius: 20,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 8,
    },
    placeIconBg: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardTitle: {
      fontFamily: Fonts.sans,
      fontSize: 17,
      fontWeight: '700',
      color: p.onSurface,
    },
    coordText: {
      fontSize: 13,
      color: p.onSurfaceVariant,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    dimText: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: p.outline,
    },
    statusChip: {
      alignSelf: 'flex-start',
      marginTop: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
    },
    statusChipText: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      fontWeight: '600',
    },
    settingEndRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    settingEndText: {
      color: p.primary,
      fontSize: 14,
      fontFamily: Fonts.sans,
      fontWeight: '600',
    },
    textInput: {
      backgroundColor: p.surfaceContainerHigh,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: p.onSurface,
      fontSize: 16,
      fontFamily: Fonts.sans,
    },
    actionButton: {
      marginTop: 12,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: 'transparent',
    },
    actionButtonText: {
      color: p.primary,
      fontSize: 16,
      fontWeight: '700',
      fontFamily: Fonts.sans,
    },
    primaryButton: {
      flexDirection: 'row',
      backgroundColor: p.primary,
      paddingVertical: 16,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 12,
      marginBottom: 16,
      shadowColor: p.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 6,
    },
    primaryButtonText: {
      color: '#FFFFFF',
      fontSize: 17,
      fontWeight: '700',
      fontFamily: Fonts.sans,
    },
    disabledButton: { opacity: 0.4 },
    editInput: {
      flex: 1,
      backgroundColor: p.surfaceContainerHigh,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: p.onSurface,
      fontSize: 16,
      fontFamily: Fonts.sans,
    },
    centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
    miniCameraWrap: {
      marginTop: 12,
      height: 90,
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: '#000',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.outlineVariant,
    },
    miniCamera: { flex: 1 },
    miniCameraBadge: {
      position: 'absolute',
      bottom: 6,
      left: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: 'rgba(0,0,0,0.7)',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    miniCameraBadgeText: { fontSize: 11, fontWeight: '600', fontFamily: Fonts.sans },
  });
}
