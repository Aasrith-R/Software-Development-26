import { Platform, StyleSheet } from 'react-native';

/* ── Modern Light Theme (White & Blue) ─────────────────────────── */
export const LightPalette = {
  // Surfaces
  surface: '#F2F4F8',              // Main background (light gray-blue)
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#FFFFFF',  // Card background
  surfaceContainer: '#FFFFFF',
  surfaceContainerHigh: '#EEF1F6', // Input background
  surfaceContainerHighest: '#E4E8F0',
  surfaceBright: '#FFFFFF',

  // Primary — Blue (main accent)
  primary: '#0A84FF',
  primaryLight: '#4DA6FF',
  primaryContainer: '#0A84FF',
  primaryFixed: '#D6E9FF',
  onPrimary: '#FFFFFF',
  onPrimaryContainer: '#003066',

  // Secondary — Deep Blue
  secondary: '#0A84FF',
  secondaryContainer: '#D6E9FF',
  onSecondary: '#FFFFFF',

  // Tertiary — Light Blue accent
  tertiary: '#5AC8FA',
  tertiaryContainer: '#D8F2FC',

  // Error
  error: '#FF3B30',
  errorContainer: '#FFE5E3',
  onErrorContainer: '#7A1410',

  // Text
  onSurface: '#1C1C1E',
  onSurfaceVariant: 'rgba(60, 60, 67, 0.6)',
  onBackground: '#1C1C1E',

  // Outlines
  outline: 'rgba(60, 60, 67, 0.18)',
  outlineVariant: 'rgba(60, 60, 67, 0.1)',

  // Inverses
  inverseSurface: '#1C1C1E',
  inverseOnSurface: '#FFFFFF',

  // High-contrast accessibility overrides
  hcBackground: '#000000',
  hcForeground: '#FFFFFF',
} as const;

/* ── Modern Dark Theme (Near-black & Blue) ─────────────────────── */
export const DarkPalette = {
  // Surfaces
  surface: '#0B0C10',              // Main background (near-black, slight blue)
  surfaceContainerLowest: '#0F1117',
  surfaceContainerLow: '#16181F',  // Card background
  surfaceContainer: '#1A1D26',
  surfaceContainerHigh: '#21242F', // Input background
  surfaceContainerHighest: '#2A2E3B',
  surfaceBright: '#1E2230',

  // Primary — Blue (main accent)
  primary: '#0A84FF',
  primaryLight: '#4DA6FF',
  primaryContainer: '#0A84FF',
  primaryFixed: '#11335C',
  onPrimary: '#FFFFFF',
  onPrimaryContainer: '#CFE5FF',

  // Secondary — Deep Blue
  secondary: '#0A84FF',
  secondaryContainer: '#11335C',
  onSecondary: '#FFFFFF',

  // Tertiary — Light Blue accent
  tertiary: '#5AC8FA',
  tertiaryContainer: '#123243',

  // Error
  error: '#FF453A',
  errorContainer: '#3A1512',
  onErrorContainer: '#FFD9D5',

  // Text
  onSurface: '#F5F6FA',
  onSurfaceVariant: 'rgba(235, 238, 245, 0.6)',
  onBackground: '#F5F6FA',

  // Outlines
  outline: 'rgba(235, 238, 245, 0.18)',
  outlineVariant: 'rgba(235, 238, 245, 0.1)',

  // Inverses
  inverseSurface: '#F5F6FA',
  inverseOnSurface: '#0B0C10',

  // High-contrast accessibility overrides
  hcBackground: '#000000',
  hcForeground: '#FFFFFF',
} as const;

export type ThemeMode = 'light' | 'dark';
export type ThemePalette = Record<keyof typeof LightPalette, string>;

export const Palettes: Record<ThemeMode, ThemePalette> = {
  light: LightPalette,
  dark: DarkPalette,
};

/**
 * Default palette export. Kept for backward compatibility with screens that
 * import `Palette` statically; equals the light theme. Theme-aware screens
 * should read the active palette via `useTheme()` instead.
 */
export const Palette = LightPalette;

/* ── Legacy navigation theme ───────────────────────────────────── */
export const Colors = {
  light: {
    text: '#1C1C1E',
    background: '#F2F4F8',
    tint: Palette.primary,
    icon: 'rgba(60, 60, 67, 0.5)',
    tabIconDefault: 'rgba(60, 60, 67, 0.5)',
    tabIconSelected: Palette.primary,
  },
  dark: {
    text: '#1C1C1E',
    background: '#F2F4F8',
    tint: Palette.primary,
    icon: 'rgba(60, 60, 67, 0.5)',
    tabIconDefault: 'rgba(60, 60, 67, 0.5)',
    tabIconSelected: Palette.primary,
  },
};

/* ── Typography ─────────────────────────────────────────────────── */
export const Fonts = {
  sans: 'Inter',
  serif: 'serif',
  rounded: 'Inter',
  mono: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
};

/* ── Type ramp ────────────────────────────── */
export const TypeScale = {
  largeTitle: { fontFamily: 'Inter', fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.37 },
  title1:     { fontFamily: 'Inter', fontSize: 28, fontWeight: '700' as const, letterSpacing: 0.36 },
  title2:     { fontFamily: 'Inter', fontSize: 22, fontWeight: '700' as const, letterSpacing: 0.35 },
  title3:     { fontFamily: 'Inter', fontSize: 20, fontWeight: '600' as const, letterSpacing: 0.38 },
  headline:   { fontFamily: 'Inter', fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.41 },
  body:       { fontFamily: 'Inter', fontSize: 17, fontWeight: '400' as const, letterSpacing: -0.41 },
  callout:    { fontFamily: 'Inter', fontSize: 16, fontWeight: '400' as const, letterSpacing: -0.32 },
  subhead:    { fontFamily: 'Inter', fontSize: 15, fontWeight: '400' as const, letterSpacing: -0.24 },
  footnote:   { fontFamily: 'Inter', fontSize: 13, fontWeight: '400' as const, letterSpacing: -0.08 },
  caption1:   { fontFamily: 'Inter', fontSize: 12, fontWeight: '400' as const, letterSpacing: 0 },
  caption2:   { fontFamily: 'Inter', fontSize: 11, fontWeight: '400' as const, letterSpacing: 0.07 },
};

export const Hairline = StyleSheet.hairlineWidth;
