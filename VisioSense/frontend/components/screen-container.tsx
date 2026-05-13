import React from 'react';
import { SafeAreaView, StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '@/context/theme';

type Props = {
  children: React.ReactNode;
  /** Hide the gradient background (for camera/full-bleed screens). */
  plain?: boolean;
  style?: ViewStyle;
};

/**
 * App-wide screen wrapper. Renders the same soft blue→gray gradient (light)
 * or near-black gradient (dark) used on the homepage, so every screen reads as
 * part of the same app.
 */
export function ScreenContainer({ children, plain, style }: Props) {
  const { isDark, palette } = useTheme();

  if (plain) {
    return (
      <View style={[styles.root, { backgroundColor: palette.surface }, style]}>
        <SafeAreaView style={styles.safe}>{children}</SafeAreaView>
      </View>
    );
  }

  const colors = isDark
    ? (['#0B0C10', '#0E1018', '#0B0C10'] as const)
    : (['#EFF4FC', '#E1EAF8', '#DBE6F6'] as const);

  return (
    <View style={[styles.root, { backgroundColor: palette.surface }, style]}>
      <LinearGradient colors={colors} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safe}>{children}</SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
});
