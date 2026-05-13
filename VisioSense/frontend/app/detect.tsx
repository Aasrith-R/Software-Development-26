import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Speech from 'expo-speech';

import { AccessibleText as Text } from '@/components/accessible-text';
import { AppHeader } from '@/components/app-header';
import { ScreenContainer } from '@/components/screen-container';
import { useAccessibilitySettings } from '@/context/accessibility-settings';
import { useTheme } from '@/context/theme';
import { Fonts, type ThemePalette } from '@/constants/theme';
import { BACKEND_URL } from '../config';

type Detection = {
  label: string;
  distance: number;
  direction: string;
  risk: string;
};

export default function DetectScreen() {
  const router = useRouter();
  const { voiceSpeed, accentColor } = useAccessibilitySettings();
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(palette, isDark), [palette, isDark]);

  const [permission, requestPermission] = useCameraPermissions();
  const [isSending, setIsSending] = useState(false);
  const [alertText, setAlertText] = useState('');
  const [error, setError] = useState('');
  const [cameraType, setCameraType] = useState<'back' | 'front'>('back');
  const [isDetecting, setIsDetecting] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const cameraRef = useRef<CameraView | null>(null);
  const detectionLoopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpokenTextRef = useRef('');
  const lastSpokenAtRef = useRef(0);
  const COOLDOWN_MS = 3000;
  const [perfStats, setPerfStats] = useState<{ roundTripMs: number; yoloMs: number } | null>(null);
  const perfSamplesRef = useRef<number[]>([]);

  useEffect(() => {
    if (!permission) requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    if (!permission?.granted && isDetecting) setIsDetecting(false);
  }, [permission?.granted, isDetecting]);

  const speakAlert = (text: string, urgent?: boolean) => {
    if (!text) return;
    const now = Date.now();
    const isSameText = text === lastSpokenTextRef.current;
    const withinCooldown = now - lastSpokenAtRef.current < COOLDOWN_MS;
    if (!urgent && isSameText && withinCooldown) return;

    Speech.stop();
    Speech.speak(text, {
      language: 'en-US',
      rate: urgent ? voiceSpeed * 1.15 : voiceSpeed,
      pitch: urgent ? 1.05 : 1.0,
    });
    lastSpokenTextRef.current = text;
    lastSpokenAtRef.current = now;
  };

  const captureAndSend = async () => {
    if (!cameraRef.current || isSending) return;
    setError('');
    setIsSending(true);
    const t0 = Date.now();

    try {
      const raw = await cameraRef.current.takePictureAsync({
        quality: 1,
        skipProcessing: true,
      });
      const photo = await ImageManipulator.manipulateAsync(
        raw.uri,
        [{ resize: { width: 640 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      const formData = new FormData();
      formData.append('file', {
        uri: photo.uri,
        name: 'photo.jpg',
        type: 'image/jpeg',
      } as any);

      const response = await fetch(BACKEND_URL, {
        method: 'POST',
        body: formData,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      const roundTripMs = Date.now() - t0;
      const json = await response.json();
      const yoloMs = json.perf?.yolo_ms ?? 0;
      const samples = perfSamplesRef.current;
      samples.push(roundTripMs);
      if (samples.length > 10) samples.shift();
      setPerfStats({ roundTripMs, yoloMs });

      const parsedDetections: Detection[] = (Array.isArray(json.objects) ? json.objects : [])
        .map((item: Partial<Detection>) => ({
          label: item?.label ?? 'Unknown',
          distance: Number(item?.distance ?? 0),
          direction: item?.direction ?? 'center',
          risk: item?.risk ?? 'clear',
        }))
        .sort((a: Detection, b: Detection) => a.distance - b.distance);

      setDetections(parsedDetections);

      const newAlert = json.alert_text ?? '';
      setAlertText(newAlert);
      const hasDanger = parsedDetections.some((d: Detection) => d.risk === 'danger');
      speakAlert(newAlert, hasDanger);
    } catch (err) {
      console.error(err);
      setError((err as Error)?.message ?? 'Unable to contact backend.');
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    if (!isDetecting || !permission?.granted) {
      if (detectionLoopRef.current) {
        clearTimeout(detectionLoopRef.current);
        detectionLoopRef.current = null;
      }
      return;
    }
    let cancelled = false;
    const runCycle = async () => {
      if (cancelled) return;
      await captureAndSend();
      if (cancelled || !isDetecting) return;
      detectionLoopRef.current = setTimeout(runCycle, 1500);
    };
    runCycle();
    return () => {
      cancelled = true;
      if (detectionLoopRef.current) {
        clearTimeout(detectionLoopRef.current);
        detectionLoopRef.current = null;
      }
    };
  }, [isDetecting, permission?.granted]);

  const toggleCameraType = () =>
    setCameraType((prev) => (prev === 'back' ? 'front' : 'back'));

  const handleToggleDetection = async () => {
    if (!permission) {
      await requestPermission();
      return;
    }
    if (!permission.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    setIsDetecting((prev) => !prev);
  };

  const handleStop = () => {
    setIsDetecting(false);
    Speech.stop();
    router.back();
  };

  const getRiskColors = (risk: string) => {
    switch (risk) {
      case 'danger':
        return { backgroundColor: 'rgba(255,59,48,0.18)', color: palette.error };
      case 'caution':
        return { backgroundColor: 'rgba(255,159,10,0.20)', color: '#FF9F0A' };
      default:
        return { backgroundColor: 'rgba(52,199,89,0.18)', color: '#34C759' };
    }
  };

  const hasDetections = detections.length > 0;

  const statusText = !isDetecting
    ? 'STANDBY'
    : hasDetections
      ? detections.some((d) => d.risk === 'danger')
        ? 'DANGER'
        : detections.some((d) => d.risk === 'caution')
          ? 'CAUTION'
          : 'PATH CLEAR'
      : 'PATH CLEAR';

  const statusColor =
    statusText === 'DANGER'
      ? palette.error
      : statusText === 'CAUTION'
        ? '#FF9F0A'
        : '#34C759';

  if (Platform.OS === 'web') {
    return (
      <ScreenContainer>
        <View style={styles.centered}>
          <Text style={styles.title}>Camera view isn&apos;t available on Expo web.</Text>
          <Text style={[styles.subtitle, { marginTop: 8 }]}>
            Open this project in Expo Go on iOS/Android or run it in a simulator to access the
            camera.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!permission) {
    return (
      <ScreenContainer>
        <View style={styles.centered}>
          <Text style={styles.title}>Requesting camera access…</Text>
          <ActivityIndicator size="large" color={palette.primary} style={{ marginTop: 16 }} />
        </View>
      </ScreenContainer>
    );
  }

  if (!permission.granted) {
    return (
      <ScreenContainer>
        <View style={styles.centered}>
          <Text style={styles.title}>Camera access is required</Text>
          <Text style={styles.subtitle}>
            Enable camera permissions in settings and relaunch the app.
          </Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <AppHeader
          eyebrow="VISIOSIGHT"
          title="Detect"
          onBack={handleStop}
          showMenu={false}
        />

        {/* Status pill */}
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusPillText, { color: statusColor }]}>{statusText}</Text>
          {perfStats ? (
            <Text style={styles.statusPillMeta}>· {perfStats.roundTripMs}ms</Text>
          ) : null}
        </View>

        {/* Camera */}
        <View style={styles.cameraContainer}>
          <CameraView
            ref={(node) => {
              cameraRef.current = node;
            }}
            style={styles.camera}
            facing={cameraType}
            animateShutter={false}
          >
            <View style={styles.cameraOverlay}>
              <View style={styles.focusBox} />
            </View>
            <View style={styles.cameraMetaBar}>
              <Text style={styles.cameraMetaText}>
                {cameraType === 'back' ? 'Rear camera' : 'Front camera'}
              </Text>
              <View style={styles.cameraMetaChip}>
                <View
                  style={[
                    styles.cameraMetaDot,
                    isDetecting && { backgroundColor: '#FFFFFF' },
                  ]}
                />
                <Text style={styles.cameraMetaChipText}>
                  {isDetecting ? 'Streaming' : 'Paused'}
                </Text>
              </View>
            </View>
          </CameraView>
        </View>

        {/* Detections */}
        {hasDetections && (
          <View style={styles.detectionsArea}>
            {detections.slice(0, 3).map((item) => {
              const { backgroundColor, color } = getRiskColors(item.risk);
              const isWarning = item.risk === 'danger' || item.risk === 'caution';
              return (
                <View key={`${item.label}-${item.distance}`} style={styles.detectionCard}>
                  <View style={styles.detectionCardRow}>
                    <View style={[styles.detectionIconBg, { backgroundColor }]}>
                      <Ionicons
                        name={isWarning ? 'warning' : 'checkmark-circle'}
                        size={20}
                        color={color}
                      />
                    </View>
                    <View style={styles.detectionInfo}>
                      <Text style={styles.detectionCardLabel}>
                        {item.risk === 'danger'
                          ? 'Obstacle'
                          : item.risk === 'caution'
                            ? 'Warning'
                            : 'Clear'}
                      </Text>
                      <Text style={styles.detectionCardName}>{item.label}</Text>
                    </View>
                    <View style={styles.detectionMeta}>
                      <Text style={styles.detectionMetaDir}>{item.direction}</Text>
                      <Text style={[styles.detectionMetaDist, { color }]}>
                        {(item.distance * 3.28).toFixed(0)}ft{' '}
                        {item.risk === 'danger'
                          ? 'STOP'
                          : item.risk === 'caution'
                            ? 'CAUTION'
                            : 'CLEAR'}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {!hasDetections && alertText ? (
          <View style={styles.infoCard}>
            <Text style={styles.sectionLabel}>Navigation guidance</Text>
            <Text style={styles.alertText}>{alertText}</Text>
          </View>
        ) : !hasDetections && !isDetecting ? (
          <View style={styles.infoCard}>
            <Text style={styles.placeholderText}>
              Tap Start Detection to begin scanning your environment for obstacles and receive
              real-time guidance.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTextLine}>{error}</Text>
          </View>
        ) : null}

        <View style={{ flex: 1 }} />

        {/* Controls */}
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[styles.secondaryButton, isSending && styles.disabledButton]}
            onPress={toggleCameraType}
            disabled={isSending}
          >
            <Ionicons
              name="camera-reverse"
              size={20}
              color={palette.onSurface}
              style={{ marginRight: 6 }}
            />
            <Text style={styles.secondaryButtonText}>Flip</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              isDetecting
                ? { backgroundColor: palette.error, shadowColor: palette.error }
                : { backgroundColor: accentColor, shadowColor: accentColor },
            ]}
            onPress={handleToggleDetection}
            disabled={isSending && !isDetecting}
            activeOpacity={0.85}
          >
            <Ionicons
              name={isDetecting ? 'stop-circle' : 'scan'}
              size={20}
              color="#FFFFFF"
              style={{ marginRight: 8 }}
            />
            <Text style={styles.primaryButtonText}>
              {isDetecting ? 'Stop Detection' : isSending ? 'Starting…' : 'Start Detection'}
            </Text>
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
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    title: {
      fontFamily: Fonts.sans,
      fontSize: 20,
      fontWeight: '700',
      color: p.onSurface,
      textAlign: 'center',
    },
    subtitle: {
      marginTop: 12,
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: p.onSurfaceVariant,
      textAlign: 'center',
    },
    backBtn: {
      marginTop: 20,
      backgroundColor: p.surfaceContainerLow,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 9999,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    backBtnText: {
      color: p.onSurface,
      fontSize: 15,
      fontWeight: '600',
      fontFamily: Fonts.sans,
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
      marginBottom: 16,
    },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    statusPillText: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
    },
    statusPillMeta: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      color: p.onSurfaceVariant,
    },

    cameraContainer: {
      height: 280,
      borderRadius: 24,
      overflow: 'hidden',
      backgroundColor: '#000',
      borderWidth: 1,
      borderColor: cardBorder,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowOffset: { width: 0, height: 10 },
      shadowRadius: 20,
      elevation: 8,
    },
    camera: { flex: 1 },
    cameraOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    focusBox: {
      width: '65%',
      height: '55%',
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.85)',
      borderRadius: 16,
    },
    cameraMetaBar: {
      position: 'absolute',
      bottom: 12,
      left: 12,
      right: 12,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: 14,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    cameraMetaText: {
      color: 'rgba(255,255,255,0.9)',
      fontSize: 13,
      fontFamily: Fonts.sans,
    },
    cameraMetaChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.16)',
      borderRadius: 9999,
      paddingVertical: 4,
      paddingHorizontal: 10,
    },
    cameraMetaDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: 'rgba(255,255,255,0.4)',
      marginRight: 6,
    },
    cameraMetaChipText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '600',
      fontFamily: Fonts.sans,
    },

    detectionsArea: { marginTop: 16, gap: 10 },
    detectionCard: {
      backgroundColor: p.surfaceContainerLow,
      borderRadius: 18,
      padding: 14,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    detectionCardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    detectionIconBg: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    detectionInfo: { flex: 1 },
    detectionCardLabel: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.8,
      color: p.onSurfaceVariant,
      textTransform: 'uppercase',
    },
    detectionCardName: {
      fontFamily: Fonts.sans,
      fontSize: 16,
      fontWeight: '700',
      color: p.onSurface,
      textTransform: 'capitalize',
      marginTop: 2,
    },
    detectionMeta: { alignItems: 'flex-end' },
    detectionMetaDir: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      fontWeight: '600',
      color: p.onSurfaceVariant,
      textTransform: 'capitalize',
    },
    detectionMetaDist: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.5,
      marginTop: 2,
    },

    infoCard: {
      marginTop: 16,
      padding: 16,
      borderRadius: 18,
      backgroundColor: p.surfaceContainerLow,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    sectionLabel: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      color: p.onSurfaceVariant,
      marginBottom: 4,
      fontWeight: '600',
    },
    alertText: {
      fontFamily: Fonts.sans,
      fontSize: 18,
      color: p.onSurface,
      lineHeight: 24,
      fontWeight: '500',
    },
    placeholderText: {
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: p.onSurfaceVariant,
      lineHeight: 20,
    },
    errorCard: {
      marginTop: 12,
      padding: 14,
      borderRadius: 14,
      backgroundColor: p.errorContainer,
    },
    errorTextLine: {
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: p.error,
      fontWeight: '500',
    },

    controlsRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 12,
    },
    primaryButton: {
      flex: 2,
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
    primaryButtonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '700',
      fontFamily: Fonts.sans,
    },
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
      color: p.onSurface,
      fontSize: 14,
      fontWeight: '600',
      fontFamily: Fonts.sans,
    },
    disabledButton: { opacity: 0.6 },
  });
}
