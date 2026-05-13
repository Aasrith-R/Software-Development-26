import React from 'react';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';

import { AccessibleText as Text } from '@/components/accessible-text';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/context/theme';

type Active = 'explore' | 'routes' | null;

type Props = {
  /** Override the active pill. Otherwise inferred from the route segments. */
  active?: Active;
};

/**
 * Bottom navigation pills replacing the tab bar across the app.
 * Always shows two destinations:
 *  • Explore  → home dashboard (`/(tabs)`)
 *  • Routes   → saved paths    (`/(tabs)/paths`)
 *
 * Theme-aware: filled pill uses the inverse surface (dark in light mode,
 * light in dark mode), outline pill uses the muted surface.
 */
export function BottomNavPills({ active }: Props) {
  const router = useRouter();
  const segments = useSegments();
  const { palette, isDark } = useTheme();

  const last = segments[segments.length - 1] as string | undefined;
  const inferred: Active =
    active ??
    (last === 'paths'
      ? 'routes'
      : last === 'index' || last === '(tabs)' || last === undefined
        ? 'explore'
        : null);

  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(60,60,67,0.08)';

  const PillFilled = ({ icon, label, onPress, isActive }: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    isActive: boolean;
  }) => (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isActive }}
      style={[
        styles.pill,
        isActive
          ? { backgroundColor: palette.inverseSurface }
          : { backgroundColor: palette.surfaceContainerLow, borderWidth: 1, borderColor },
      ]}
    >
      <Ionicons
        name={icon}
        size={18}
        color={isActive ? palette.inverseOnSurface : palette.onSurfaceVariant}
      />
      <Text
        style={[
          styles.pillText,
          { color: isActive ? palette.inverseOnSurface : palette.onSurface },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.row} pointerEvents="box-none">
      <PillFilled
        icon="camera-outline"
        label="Explore"
        isActive={inferred === 'explore'}
        onPress={() => router.push('/(tabs)')}
      />
      <PillFilled
        icon="git-branch-outline"
        label="Routes"
        isActive={inferred === 'routes'}
        onPress={() => router.push('/(tabs)/paths')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 12 : 16,
    paddingTop: 8,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
  },
  pillText: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    fontWeight: '600',
  },
});
