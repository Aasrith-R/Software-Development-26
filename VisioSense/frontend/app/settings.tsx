import React, { useMemo } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { AccessibleText as Text } from '@/components/accessible-text';
import { AppHeader } from '@/components/app-header';
import { ScreenContainer } from '@/components/screen-container';
import {
  FontSizePreset,
  HapticPreset,
  useAccessibilitySettings,
} from '@/context/accessibility-settings';
import { useAuth } from '@/context/auth';
import { useProfile } from '@/context/profile';
import { useTheme } from '@/context/theme';
import { Fonts, TypeScale, type ThemePalette } from '@/constants/theme';
import { clearPathCache } from '@/services/path-storage';

const FONT_OPTIONS: { key: FontSizePreset; label: string }[] = [
  { key: 'small', label: 'Small' },
  { key: 'default', label: 'Default' },
  { key: 'large', label: 'Large' },
];

const HAPTIC_OPTIONS: { key: HapticPreset; label: string }[] = [
  { key: 'soft', label: 'Soft' },
  { key: 'medium', label: 'Medium' },
  { key: 'strong', label: 'Strong' },
];

function maskChatId(chatId: string): string {
  if (!chatId) return 'Not set';
  if (chatId.length <= 4) return chatId;
  return `••• ${chatId.slice(-4)}`;
}

export default function SettingsScreen() {
  const router = useRouter();
  const { emergencyChatId, fallDetectionEnabled } = useProfile();
  const { signOut } = useAuth();
  const { palette, isDark, toggleTheme } = useTheme();
  const styles = useMemo(() => makeStyles(palette, isDark), [palette, isDark]);

  const handleSignOut = () => {
    Alert.alert('Sign out?', 'You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          clearPathCache();
          await signOut();
        },
      },
    ]);
  };

  const {
    highContrast,
    fontSizePreset,
    voiceSpeed,
    hapticIntensity,
    detectionSensitivity,
    setFontSizePreset,
    setHighContrast,
    setVoiceSpeed,
    setHapticIntensity,
    setDetectionSensitivity,
    accentColor,
  } = useAccessibilitySettings();

  const accentBg = `${accentColor}1A`;

  return (
    <ScreenContainer>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <AppHeader
          eyebrow="VISIOSENSE"
          title="Settings"
          onBack={() => router.back()}
          showMenu={false}
        />
        <Text style={styles.sub}>Tune VisioSense to feel right for you.</Text>

        {/* ── Appearance ── */}
        <Text style={styles.sectionHeader}>APPEARANCE</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: accentBg }]}>
              <Ionicons
                name={isDark ? 'moon-outline' : 'sunny-outline'}
                size={18}
                color={accentColor}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Dark Mode</Text>
              <Text style={styles.rowHelper}>
                {isDark ? 'On — dark UI across the app.' : 'Off — light UI across the app.'}
              </Text>
            </View>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: palette.surfaceContainerHigh, true: palette.primary }}
              ios_backgroundColor={palette.surfaceContainerHigh}
            />
          </View>
        </View>

        {/* ── Voice ── */}
        <Text style={styles.sectionHeader}>VOICE</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: accentBg }]}>
              <Ionicons name="volume-high-outline" size={18} color={accentColor} />
            </View>
            <Text style={styles.rowLabel}>Speed</Text>
            <Text style={styles.rowValue}>{voiceSpeed.toFixed(1)}×</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.sliderRow}>
            <TouchableOpacity
              onPress={() => setVoiceSpeed(Math.max(0.5, voiceSpeed - 0.1))}
              style={[styles.stepper, { backgroundColor: accentBg }]}
            >
              <Ionicons name="remove" size={16} color={accentColor} />
            </TouchableOpacity>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  {
                    backgroundColor: accentColor,
                    width: `${((voiceSpeed - 0.5) / 1.5) * 100}%`,
                  },
                ]}
              />
            </View>
            <TouchableOpacity
              onPress={() => setVoiceSpeed(Math.min(2.0, voiceSpeed + 0.1))}
              style={[styles.stepper, { backgroundColor: accentBg }]}
            >
              <Ionicons name="add" size={16} color={accentColor} />
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.footnote}>How fast spoken instructions are read aloud.</Text>

        {/* ── Vision ── */}
        <Text style={styles.sectionHeader}>VISION</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: accentBg }]}>
              <Ionicons name="contrast-outline" size={18} color={accentColor} />
            </View>
            <Text style={styles.rowLabel}>High Contrast</Text>
            <Switch
              value={highContrast}
              onValueChange={setHighContrast}
              trackColor={{ false: palette.surfaceContainerHigh, true: palette.primary }}
              ios_backgroundColor={palette.surfaceContainerHigh}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: accentBg }]}>
              <Ionicons name="text-outline" size={18} color={accentColor} />
            </View>
            <Text style={styles.rowLabel}>Font Size</Text>
          </View>
          <View style={styles.segmentWrap}>
            <View style={styles.segment}>
              {FONT_OPTIONS.map((option) => {
                const isActive = option.key === fontSizePreset;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[styles.segmentItem, isActive && styles.segmentItemActive]}
                    onPress={() => setFontSizePreset(option.key)}
                  >
                    <Text
                      style={[styles.segmentText, isActive && styles.segmentTextActive]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* ── Feedback ── */}
        <Text style={styles.sectionHeader}>FEEDBACK</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: accentBg }]}>
              <Ionicons name="phone-portrait-outline" size={18} color={accentColor} />
            </View>
            <Text style={styles.rowLabel}>Haptics</Text>
          </View>
          <View style={styles.segmentWrap}>
            <View style={styles.segment}>
              {HAPTIC_OPTIONS.map((option) => {
                const isActive = option.key === hapticIntensity;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[styles.segmentItem, isActive && styles.segmentItemActive]}
                    onPress={() => setHapticIntensity(option.key)}
                  >
                    <Text
                      style={[styles.segmentText, isActive && styles.segmentTextActive]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* ── Detection ── */}
        <Text style={styles.sectionHeader}>DETECTION</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: accentBg }]}>
              <Ionicons name="radio-outline" size={18} color={accentColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Higher Sensitivity</Text>
              <Text style={styles.rowHelper}>Catch smaller obstacles, more chatter.</Text>
            </View>
            <Switch
              value={detectionSensitivity}
              onValueChange={setDetectionSensitivity}
              trackColor={{ false: palette.surfaceContainerHigh, true: palette.primary }}
              ios_backgroundColor={palette.surfaceContainerHigh}
            />
          </View>
        </View>

        {/* ── Safety ── */}
        <Text style={styles.sectionHeader}>SAFETY</Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/emergency-contact' as any)}
            accessibilityRole="button"
          >
            <View style={[styles.iconWrap, { backgroundColor: accentBg }]}>
              <Ionicons name="medkit-outline" size={18} color={accentColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Emergency Contact</Text>
              <Text style={styles.rowHelper}>
                {fallDetectionEnabled ? 'Fall detection on' : 'Fall detection off'}
              </Text>
            </View>
            <Text style={styles.rowValue}>{maskChatId(emergencyChatId)}</Text>
            <Ionicons name="chevron-forward" size={18} color={palette.onSurfaceVariant} />
          </TouchableOpacity>
        </View>

        {/* ── About ── */}
        <Text style={styles.sectionHeader}>ABOUT</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: accentBg }]}>
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={accentColor}
              />
            </View>
            <Text style={styles.rowLabel}>Version</Text>
            <Text style={styles.rowValue}>1.0</Text>
          </View>
        </View>
        <Text style={styles.footnote}>VisioSense AI</Text>

        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={handleSignOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <View style={{ height: 24 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

function makeStyles(p: ThemePalette, isDark: boolean) {
  const cardBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(60,60,67,0.06)';
  const segmentTrack = p.surfaceContainerHigh;
  const segmentActiveBg = isDark ? p.surfaceContainerHighest : '#FFFFFF';
  return StyleSheet.create({
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: Platform.OS === 'android' ? 16 : 8,
      paddingBottom: 16,
    },
    sub: {
      ...TypeScale.subhead,
      color: p.onSurfaceVariant,
      marginTop: -8,
      marginBottom: 20,
    },
    sectionHeader: {
      ...TypeScale.footnote,
      fontWeight: '600',
      color: p.onSurfaceVariant,
      letterSpacing: 0.8,
      marginLeft: 16,
      marginBottom: 8,
      marginTop: 16,
    },
    group: {
      backgroundColor: p.surfaceContainerLow,
      borderRadius: 20,
      overflow: 'hidden',
      marginBottom: 4,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      minHeight: 50,
      paddingVertical: 10,
    },
    iconWrap: {
      width: 30,
      height: 30,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowLabel: {
      ...TypeScale.body,
      color: p.onSurface,
      flex: 1,
      fontWeight: '500',
    },
    rowHelper: {
      ...TypeScale.caption1,
      color: p.onSurfaceVariant,
      marginTop: 1,
    },
    rowValue: {
      ...TypeScale.body,
      color: p.onSurfaceVariant,
      fontWeight: '600',
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: p.outlineVariant,
      marginLeft: 56,
    },
    footnote: {
      ...TypeScale.caption1,
      color: p.onSurfaceVariant,
      marginLeft: 16,
      marginTop: 6,
      marginBottom: 8,
      lineHeight: 16,
    },
    sliderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    stepper: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    track: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: p.surfaceContainerHigh,
      overflow: 'hidden',
    },
    fill: { height: '100%' },
    segmentWrap: { paddingHorizontal: 14, paddingBottom: 14 },
    segment: {
      flexDirection: 'row',
      backgroundColor: segmentTrack,
      borderRadius: 10,
      padding: 2,
    },
    segmentItem: {
      flex: 1,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
    },
    segmentItemActive: {
      backgroundColor: segmentActiveBg,
      ...(Platform.OS === 'ios'
        ? {
            shadowColor: '#000',
            shadowOpacity: isDark ? 0 : 0.1,
            shadowOffset: { width: 0, height: 1 },
            shadowRadius: 2,
          }
        : { elevation: isDark ? 0 : 1 }),
    },
    segmentText: {
      fontSize: 13,
      fontWeight: '500',
      color: p.onSurface,
      fontFamily: Fonts.sans,
    },
    segmentTextActive: { fontWeight: '700' },
    signOutBtn: {
      marginTop: 16,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      borderRadius: 16,
      backgroundColor: p.surfaceContainerLow,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    signOutText: {
      fontFamily: Fonts.sans,
      fontSize: 16,
      fontWeight: '600',
      color: p.error,
    },
  });
}
