import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { AccessibleText as Text } from '@/components/accessible-text';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/context/theme';

type Props = {
  /** Small uppercase eyebrow above the title (e.g. "VISIOSENSE"). Optional. */
  eyebrow?: string;
  /** Big page title. */
  title: string;
  /** Show a back button on the left instead of nothing. */
  onBack?: () => void;
  /** Optional extra right-side icon button (e.g. menu). */
  rightAction?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label: string };
  /** When true (default), the menu button navigates to /settings. */
  showMenu?: boolean;
};

/**
 * Standard header used across the app: optional eyebrow, large title, plus
 * a back/menu icon button on the right. The theme toggle lives in /settings
 * only — see `Appearance` row there.
 */
export function AppHeader({
  eyebrow,
  title,
  onBack,
  rightAction,
  showMenu = true,
}: Props) {
  const router = useRouter();
  const { palette, isDark } = useTheme();

  const iconBg = {
    backgroundColor: palette.surfaceContainerLow,
    borderColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(60,60,67,0.08)',
  };

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        {onBack ? (
          <TouchableOpacity
            onPress={onBack}
            style={[styles.iconButton, iconBg, { marginRight: 12 }]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color={palette.onSurface} />
          </TouchableOpacity>
        ) : null}
        <View style={{ flex: 1 }}>
          {eyebrow ? (
            <Text style={[styles.eyebrow, { color: palette.onSurfaceVariant }]}>
              {eyebrow}
            </Text>
          ) : null}
          <Text style={[styles.title, { color: palette.onSurface }]}>{title}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        {rightAction ? (
          <TouchableOpacity
            style={[styles.iconButton, iconBg]}
            onPress={rightAction.onPress}
            accessibilityRole="button"
            accessibilityLabel={rightAction.label}
          >
            <Ionicons name={rightAction.icon} size={20} color={palette.onSurface} />
          </TouchableOpacity>
        ) : showMenu ? (
          <TouchableOpacity
            style={[styles.iconButton, iconBg]}
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            accessibilityLabel="Open menu"
          >
            <Ionicons name="menu" size={22} color={palette.onSurface} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  eyebrow: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  title: {
    fontFamily: Fonts.sans,
    fontSize: 30,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
