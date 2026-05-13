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

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp, signIn } = useAuth();
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(palette, isDark), [palette, isDark]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      const msg = 'Enter your email and a password.';
      setError(msg);
      Speech.speak(msg);
      return;
    }
    if (password.length < 6) {
      const msg = 'Password must be at least 6 characters.';
      setError(msg);
      Speech.speak(msg);
      return;
    }
    if (password !== confirm) {
      const msg = 'Passwords do not match.';
      setError(msg);
      Speech.speak(msg);
      return;
    }

    setBusy(true);
    setError(null);
    const { error: err } = await signUp(email.trim(), password);
    if (err) {
      setBusy(false);
      setError(err.message);
      Speech.speak(`Sign up failed. ${err.message}`);
      return;
    }
    const { error: signInErr } = await signIn(email.trim(), password);
    setBusy(false);
    if (signInErr) {
      setError('Account created. Check your email to confirm, then sign in.');
      router.replace('/(auth)/login' as any);
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
          <AppHeader title="Sign Up" onBack={() => router.back()} showMenu={false} />

          <View style={styles.hero}>
            <View style={styles.logoBadge}>
              <Image source={LOGO} style={styles.logoImage} contentFit="contain" />
            </View>
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.subtitle}>
              Your saved routes sync privately and securely to your smart glasses profile.
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
                textContentType="newPassword"
                placeholder="Password (6+ chars)"
                placeholderTextColor={placeholderColor}
              />
            </View>

            <View style={styles.inputContainer}>
              <Ionicons
                name="shield-checkmark-outline"
                size={20}
                color={palette.onSurfaceVariant}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoCapitalize="none"
                placeholder="Confirm password"
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
              <Text style={styles.ctaText}>Create Account</Text>
            )}
          </TouchableOpacity>

          <Link href={'/(auth)/login' as any} replace asChild>
            <TouchableOpacity style={styles.linkRow} activeOpacity={0.7}>
              <Text style={styles.linkMuted}>Already have one? </Text>
              <Text style={styles.linkAccent}>Sign in</Text>
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
    hero: { alignItems: 'center', marginTop: 12, marginBottom: 32 },
    logoBadge: {
      width: 116,
      height: 116,
      borderRadius: 58,
      backgroundColor: p.surfaceContainerLow,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
      borderWidth: 1,
      borderColor: cardBorder,
      shadowColor: p.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: isDark ? 0.4 : 0.15,
      shadowRadius: 26,
      elevation: 6,
    },
    logoImage: { width: 76, height: 76 },
    title: {
      fontFamily: Fonts.sans,
      fontSize: 26,
      fontWeight: '700',
      color: p.onSurface,
      marginBottom: 8,
    },
    subtitle: {
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: p.onSurfaceVariant,
      textAlign: 'center',
      lineHeight: 20,
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
