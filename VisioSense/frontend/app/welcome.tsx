import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';

import { AccessibleText as Text } from '@/components/accessible-text';
import { ScreenContainer } from '@/components/screen-container';
import { Fonts, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/context/theme';

const LOGO = require('@/assets/images/Visio-Logo.svg');

const ONBOARDING_KEY = '@visiosense_onboarded';

export async function hasSeenOnboarding(): Promise<boolean> {
  const val = await AsyncStorage.getItem(ONBOARDING_KEY);
  return val === 'true';
}

export async function markOnboarded(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
}

const FEATURES = [
  {
    icon: 'eye-outline',
    title: 'See with sound',
    body: 'Real-time scene description spoken naturally as you walk.',
  },
  {
    icon: 'navigate-outline',
    title: 'Routes you remember',
    body: 'Save the way to anywhere. Walk it once, take it forever.',
  },
  {
    icon: 'shield-checkmark-outline',
    title: 'Aware of obstacles',
    body: 'Camera and depth sensing keep you clear of what is ahead.',
  },
] as const;

export default function WelcomeScreen() {
  const router = useRouter();
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(palette, isDark), [palette, isDark]);

  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(slide, { toValue: 0, friction: 8, useNativeDriver: true }),
    ]).start();
  }, [fade, slide]);

  const handleGetStarted = async () => {
    await markOnboarded();
    router.replace('/(auth)/login' as any);
  };

  return (
    <ScreenContainer>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[styles.hero, { opacity: fade, transform: [{ translateY: slide }] }]}
        >
          <View style={styles.orbWrap}>
            <Image source={LOGO} style={styles.logo} contentFit="contain" />
          </View>

          <Text style={styles.eyebrow}>VISIOSENSE AI</Text>
          <Text style={styles.title} accessibilityRole="header">
            See more.{'\n'}Travel further.
          </Text>
          <Text style={styles.lede}>
            Your intelligent camera companion that turns live environments into clear, spoken
            guidance. Custom-configured for your smart glasses.
          </Text>
        </Animated.View>

        <Animated.View style={[styles.featureGroup, { opacity: fade }]}>
          {FEATURES.map((f, idx) => (
            <View key={f.title}>
              <View style={styles.featureRow}>
                <View style={styles.featureIconWrap}>
                  <Ionicons name={f.icon as any} size={20} color={palette.primary} />
                </View>
                <View style={styles.featureText}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureBody}>{f.body}</Text>
                </View>
              </View>
              {idx < FEATURES.length - 1 && <View style={styles.featureDivider} />}
            </View>
          ))}
        </Animated.View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.cta}
            onPress={handleGetStarted}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Get started"
          >
            <Text style={styles.ctaText}>Get Started</Text>
          </TouchableOpacity>

          <Text style={styles.finePrint}>
            By continuing you agree to our{' '}
            <Text style={styles.fineLink}>Terms</Text> and{' '}
            <Text style={styles.fineLink}>Privacy</Text>.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function makeStyles(p: ThemePalette, isDark: boolean) {
  const cardBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(60,60,67,0.08)';
  return StyleSheet.create({
    container: {
      paddingHorizontal: 24,
      paddingTop: Platform.OS === 'android' ? 16 : 8,
      paddingBottom: 32,
      minHeight: '100%',
    },
    hero: { alignItems: 'center', marginTop: 24, marginBottom: 32 },
    orbWrap: {
      height: 200,
      width: 200,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    logo: { width: 200, height: 200 },
    eyebrow: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.6,
      color: p.primary,
      marginBottom: 10,
    },
    title: {
      fontFamily: Fonts.sans,
      fontSize: 36,
      fontWeight: '800',
      letterSpacing: -1,
      lineHeight: 42,
      color: p.onSurface,
      textAlign: 'center',
    },
    lede: {
      fontFamily: Fonts.sans,
      fontSize: 15,
      color: p.onSurfaceVariant,
      marginTop: 16,
      lineHeight: 22,
      textAlign: 'center',
      maxWidth: 360,
    },
    featureGroup: {
      backgroundColor: p.surfaceContainerLow,
      borderRadius: 22,
      paddingHorizontal: 4,
      marginBottom: 28,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      paddingHorizontal: 14,
      gap: 14,
    },
    featureIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(10,132,255,0.16)' : 'rgba(10,132,255,0.10)',
    },
    featureText: { flex: 1 },
    featureTitle: {
      fontFamily: Fonts.sans,
      fontSize: 16,
      fontWeight: '600',
      color: p.onSurface,
    },
    featureBody: {
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: p.onSurfaceVariant,
      marginTop: 2,
      lineHeight: 20,
    },
    featureDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: p.outlineVariant,
      marginLeft: 68,
    },
    footer: { marginTop: 'auto' },
    cta: {
      backgroundColor: p.primary,
      borderRadius: 16,
      paddingVertical: 17,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: p.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.4,
      shadowRadius: 16,
      elevation: 8,
    },
    ctaText: {
      color: '#FFFFFF',
      fontSize: 17,
      fontWeight: '700',
      letterSpacing: -0.4,
      fontFamily: Fonts.sans,
    },
    finePrint: {
      marginTop: 14,
      fontFamily: Fonts.sans,
      fontSize: 12,
      color: p.onSurfaceVariant,
      textAlign: 'center',
    },
    fineLink: { fontWeight: '600', color: p.primary },
  });
}
