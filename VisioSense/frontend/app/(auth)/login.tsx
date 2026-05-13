import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import { Image } from 'expo-image';

import { AccessibleText as Text } from '@/components/accessible-text';
import { AppHeader } from '@/components/app-header';
import { ScreenContainer } from '@/components/screen-container';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/context/theme';
import { Fonts, type ThemePalette } from '@/constants/theme';

const LOGO = require('@/assets/images/Visio-Logo.svg');

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(palette, isDark), [palette, isDark]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      const msg = 'Please enter your email and password.';
      setError(msg);
      Speech.speak(msg);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await signIn(email.trim(), password);
    setBusy(false);
    if (err) {
      setError(err.message);
      Speech.speak(`Sign in failed. ${err.message}`);
      return;
    }
    router.replace('/(tabs)');
  };

  const placeholderColor = isDark ? 'rgba(235,238,245,0.4)' : 'rgba(60,60,67,0.4)';

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <AppHeader title="Sign In" onBack={() => router.back()} showMenu={false} />

          <View style={styles.hero}>
            <View style={styles.logoBadge}>
              <Image source={LOGO} style={styles.logoImage} contentFit="contain" />
            </View>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>
              Sign in to sync your personalized smart glasses profiles and routes.
            </Text>
          </View>

          <View style={styles.formGroup}>
            <View style={styles.inputContainer}>
              <Ionicons
                name="mail-outline"
                size={20}
                color={palette.onSurfaceVariant}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholder="Email address"
                placeholderTextColor={placeholderColor}
              />
            </View>

            <View style={styles.inputContainer}>
              <Ionicons
                name="lock-closed-outline"
                size={20}
                color={palette.onSurfaceVariant}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                textContentType="password"
                placeholder="Password"
                placeholderTextColor={placeholderColor}
              />
            </View>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={palette.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.cta, busy && styles.disabled]}
            onPress={handleSubmit}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.ctaText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <Link href={'/(auth)/signup' as any} replace asChild>
            <TouchableOpacity style={styles.linkRow} activeOpacity={0.7}>
              <Text style={styles.linkMuted}>New here? </Text>
              <Text style={styles.linkAccent}>Create an account</Text>
            </TouchableOpacity>
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

function makeStyles(p: ThemePalette, isDark: boolean) {
  const cardBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(60,60,67,0.08)';
  return StyleSheet.create({
    container: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 40,
      flexGrow: 1,
    },
    hero: { alignItems: 'center', marginTop: 12, marginBottom: 36 },
    logoBadge: {
      width: 132,
      height: 132,
      borderRadius: 66,
      backgroundColor: p.surfaceContainerLow,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
      borderWidth: 1,
      borderColor: cardBorder,
      shadowColor: p.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: isDark ? 0.4 : 0.15,
      shadowRadius: 30,
      elevation: 6,
    },
    logoImage: { width: 90, height: 90 },
    title: {
      fontFamily: Fonts.sans,
      fontSize: 28,
      fontWeight: '700',
      color: p.onSurface,
      marginBottom: 8,
    },
    subtitle: {
      fontFamily: Fonts.sans,
      fontSize: 15,
      color: p.onSurfaceVariant,
      textAlign: 'center',
      lineHeight: 22,
      paddingHorizontal: 20,
    },
    formGroup: { gap: 14, marginBottom: 20 },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: p.surfaceContainerLow,
      borderRadius: 16,
      paddingHorizontal: 16,
      height: 56,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    inputIcon: { marginRight: 12 },
    input: {
      flex: 1,
      fontFamily: Fonts.sans,
      fontSize: 16,
      color: p.onSurface,
    },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: p.errorContainer,
      padding: 12,
      borderRadius: 12,
      marginBottom: 20,
      gap: 8,
    },
    errorText: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: p.error,
      flex: 1,
    },
    cta: {
      backgroundColor: p.primary,
      borderRadius: 16,
      height: 56,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: p.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.4,
      shadowRadius: 16,
      elevation: 8,
    },
    ctaText: {
      fontFamily: Fonts.sans,
      color: p.onPrimary,
      fontSize: 17,
      fontWeight: '600',
    },
    disabled: { opacity: 0.5 },
    linkRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 28,
    },
    linkMuted: {
      fontFamily: Fonts.sans,
      fontSize: 15,
      color: p.onSurfaceVariant,
    },
    linkAccent: {
      fontFamily: Fonts.sans,
      fontSize: 15,
      fontWeight: '600',
      color: p.primary,
    },
  });
}
