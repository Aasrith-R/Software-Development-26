import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts, Inter_400Regular, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from '@expo-google-fonts/inter';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';

import { AccessibilitySettingsProvider } from '@/context/accessibility-settings';
import { AuthProvider, useAuth } from '@/context/auth';
import { ProfileProvider, useProfile } from '@/context/profile';
import { ThemeProvider as AppThemeProvider, useTheme } from '@/context/theme';
import { refreshPaths } from '@/services/path-storage';
import { startFallDetection, stopFallDetection } from '@/services/fall-detection';
import { sendFallAlertTelegram } from '@/services/telegram';

export const unstable_settings = {
  anchor: '(tabs)',
};

const ONBOARDING_KEY = '@visiosense_onboarded';

function RouteGuard({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const { palette } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const [onboardChecked, setOnboardChecked] = useState(false);
  const [onboarded, setOnboarded] = useState(false);

  // Re-read the onboarding flag on every navigation change. The welcome
  // screen writes to AsyncStorage right before navigating away, so we need
  // a fresh read here or the guard bounces the user back to /welcome.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ONBOARDING_KEY).then((v) => {
      if (cancelled) return;
      setOnboarded(v === 'true');
      setOnboardChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [segments]);

  useEffect(() => {
    if (loading || !onboardChecked) return;

    const first = segments[0] as string | undefined;
    const inAuthGroup = first === '(auth)';
    const onWelcome = first === 'welcome';

    if (!onboarded) {
      if (!onWelcome) router.replace('/welcome');
      return;
    }
    if (!session) {
      if (!inAuthGroup) router.replace('/(auth)/login' as any);
      return;
    }
    if (inAuthGroup || onWelcome) {
      router.replace('/(tabs)');
    }
  }, [loading, onboardChecked, onboarded, session, segments, router]);

  useEffect(() => {
    if (session) {
      refreshPaths().catch(() => {});
    }
  }, [session?.user?.id]);

  if (loading || !onboardChecked) {
    return (
      <View
        style={{ flex: 1, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' }}
      >
        <ActivityIndicator size="large" color={palette.primary} />
      </View>
    );
  }

  return <>{children}</>;
}

function FallDetectionRunner() {
  const { session } = useAuth();
  const { emergencyChatId, emergencyName, fallDetectionEnabled } = useProfile();

  useEffect(() => {
    if (!session || !fallDetectionEnabled || !emergencyChatId) {
      stopFallDetection();
      return;
    }
    const det = startFallDetection({
      onFall: () => {
        sendFallAlertTelegram(emergencyChatId, emergencyName).catch((err) =>
          console.warn('[fall] sendFallAlertTelegram failed', err),
        );
      },
    });
    return () => det.stop();
  }, [session?.user?.id, fallDetectionEnabled, emergencyChatId, emergencyName]);

  return null;
}

function ThemedApp() {
  const { isDark } = useTheme();

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <RouteGuard>
        <FallDetectionRunner />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
          <Stack.Screen
            name="detect"
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
            }}
          />
          <Stack.Screen name="settings" options={{ headerShown: false }} />
          <Stack.Screen name="emergency-contact" options={{ headerShown: false }} />
          <Stack.Screen
            name="navigate"
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
            }}
          />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
      </RouteGuard>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter: Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <AppThemeProvider>
      <AccessibilitySettingsProvider>
        <AuthProvider>
          <ProfileProvider>
            <ThemedApp />
          </ProfileProvider>
        </AuthProvider>
      </AccessibilitySettingsProvider>
    </AppThemeProvider>
  );
}
