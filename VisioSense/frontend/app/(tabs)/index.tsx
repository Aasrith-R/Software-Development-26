import React, { useEffect, useMemo, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';

import { AccessibleText as Text } from '@/components/accessible-text';
import { AppHeader } from '@/components/app-header';
import { BottomNavPills } from '@/components/bottom-nav-pills';
import { ScreenContainer } from '@/components/screen-container';
import { Fonts, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/context/theme';
import { useAuth } from '@/context/auth';

const LOGO = require('@/assets/images/Visio-Logo.svg');

function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 12) return 'GOOD MORNING';
  if (h < 18) return 'GOOD AFTERNOON';
  return 'GOOD EVENING';
}

function formatTime(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export default function DashboardScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { palette, isDark } = useTheme();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const styles = useMemo(() => makeStyles(palette, isDark), [palette, isDark]);
  const userName = user?.email?.split('@')[0] || 'User';

  return (
    <ScreenContainer>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <AppHeader eyebrow={greetingFor(now)} title={`Hello, ${userName}`} />

        {/* Status pill */}
        <View style={styles.statusPill}>
          <View style={styles.statusItem}>
            <Ionicons name="time-outline" size={15} color={palette.onSurfaceVariant} />
            <Text style={styles.statusText}>{formatTime(now)}</Text>
          </View>
          <Text style={styles.statusDot}>·</Text>
          <View style={styles.statusItem}>
            <Ionicons name="location-outline" size={15} color={palette.onSurfaceVariant} />
            <Text style={styles.statusText}>Cumming, GA</Text>
          </View>
          <Text style={styles.statusDot}>·</Text>
          <View style={styles.statusItem}>
            <Ionicons name="sunny-outline" size={15} color={palette.onSurfaceVariant} />
            <Text style={styles.statusText}>72°</Text>
          </View>
        </View>

        {/* Logo */}
        <TouchableOpacity
          style={styles.orbWrap}
          activeOpacity={0.85}
          onPress={() => router.push('/detect' as any)}
          accessibilityRole="button"
          accessibilityLabel="Ask Visio. Tap to ask, or say Hey Visio"
        >
          <Image source={LOGO} style={styles.logo} contentFit="contain" />
        </TouchableOpacity>

        <View style={styles.askRow}>
          <Text style={styles.askText}>Tap to ask · or say </Text>
          <View style={styles.heyChip}>
            <Text style={styles.heyChipText}>Hey Visio</Text>
          </View>
        </View>

        {/* Primary action cards */}
        <View style={styles.cardsRow}>
          <TouchableOpacity
            activeOpacity={0.9}
            style={[styles.card, styles.cardDetect]}
            onPress={() => router.push('/detect' as any)}
            accessibilityRole="button"
            accessibilityLabel="VisioSight, Detect"
          >
            <View style={styles.cardIconDetect}>
              <Ionicons name="eye-outline" size={22} color="#FFFFFF" />
            </View>
            <Text style={styles.cardEyebrowDetect}>VISIOSIGHT</Text>
            <Text style={styles.cardTitleDetect}>Detect</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.9}
            style={[styles.card, styles.cardNavigate]}
            onPress={() => router.push('/(tabs)/paths')}
            accessibilityRole="button"
            accessibilityLabel="VisioPath, Navigate"
          >
            <View style={styles.cardIconNavigate}>
              <Ionicons name="navigate" size={20} color={palette.primary} />
            </View>
            <Text style={styles.cardEyebrowNavigate}>VISIOPATH</Text>
            <Text style={styles.cardTitleNavigate}>Navigate</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <BottomNavPills active="explore" />
    </ScreenContainer>
  );
}

function makeStyles(p: ThemePalette, isDark: boolean) {
  const cardBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(60,60,67,0.08)';
  const pillBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(60,60,67,0.08)';

  return StyleSheet.create({
    container: { flex: 1 },
    content: {
      paddingHorizontal: 20,
      paddingTop: Platform.OS === 'android' ? 24 : 8,
      paddingBottom: 16,
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
    },
    statusItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    statusText: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      fontWeight: '600',
      color: p.onSurface,
    },
    statusDot: { fontFamily: Fonts.sans, fontSize: 13, color: p.onSurfaceVariant },
    orbWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 32,
      marginBottom: 24,
      height: 240,
    },
    logo: { width: 220, height: 220 },
    askRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
    },
    askText: { fontFamily: Fonts.sans, fontSize: 14, color: p.onSurfaceVariant },
    heyChip: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: p.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: pillBorder,
    },
    heyChipText: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      fontWeight: '600',
      color: p.onSurface,
    },
    cardsRow: { flexDirection: 'row', gap: 14 },
    card: {
      flex: 1,
      borderRadius: 22,
      padding: 18,
      minHeight: 132,
      justifyContent: 'space-between',
    },
    cardDetect: {
      backgroundColor: p.primary,
      shadowColor: p.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 6,
    },
    cardNavigate: {
      backgroundColor: p.surfaceContainerLow,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    cardIconDetect: {
      width: 42,
      height: 42,
      borderRadius: 13,
      backgroundColor: 'rgba(255,255,255,0.22)',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
    cardIconNavigate: {
      width: 42,
      height: 42,
      borderRadius: 13,
      backgroundColor: isDark ? 'rgba(10,132,255,0.16)' : 'rgba(10,132,255,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
    cardEyebrowDetect: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1,
      color: 'rgba(255,255,255,0.85)',
      marginBottom: 2,
    },
    cardTitleDetect: {
      fontFamily: Fonts.sans,
      fontSize: 24,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    cardEyebrowNavigate: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1,
      color: p.onSurfaceVariant,
      marginBottom: 2,
    },
    cardTitleNavigate: {
      fontFamily: Fonts.sans,
      fontSize: 24,
      fontWeight: '700',
      color: p.onSurface,
    },
  });
}
