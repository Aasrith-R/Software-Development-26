import React from 'react';
import { Platform, StyleSheet, Text as RNText, TextProps } from 'react-native';

import { useAccessibilitySettings } from '@/context/accessibility-settings';

const SYSTEM_FONT = Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' })!;

/**
 * Default text component. Uses the OS system font (SF on iOS, Roboto on
 * Android) and respects the user's font-scale + high-contrast accessibility
 * preferences.
 */
export function AccessibleText({ style, ...props }: TextProps) {
  const { fontScale, highContrast } = useAccessibilitySettings();
  const flattenedStyle = StyleSheet.flatten(style);
  const hasNumericFontSize = typeof flattenedStyle?.fontSize === 'number';

  return (
    <RNText
      {...props}
      style={[
        { fontFamily: SYSTEM_FONT },
        style,
        hasNumericFontSize && typeof flattenedStyle?.fontSize === 'number'
          ? { fontSize: flattenedStyle.fontSize * fontScale }
          : null,
        highContrast ? { color: '#FFFFFF' } : null,
      ]}
    />
  );
}
