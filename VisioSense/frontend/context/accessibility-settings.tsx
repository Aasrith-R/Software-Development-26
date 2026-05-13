import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type FontSizePreset = 'small' | 'default' | 'large';
type HapticPreset = 'soft' | 'medium' | 'strong';

type AccessibilitySettingsContextValue = {
  highContrast: boolean;
  fontSizePreset: FontSizePreset;
  fontScale: number;
  voiceSpeed: number;
  hapticIntensity: HapticPreset;
  detectionSensitivity: boolean;
  
  // Personalized Hardware Settings
  glassesName: string;
  accentColor: string;
  activeLedColor: string;
  cameraCalibration: number;
  singleTapAction: string;
  doubleTapAction: string;

  setHighContrast: (value: boolean) => void;
  setFontSizePreset: (preset: FontSizePreset) => void;
  setVoiceSpeed: (speed: number) => void;
  setHapticIntensity: (preset: HapticPreset) => void;
  setDetectionSensitivity: (value: boolean) => void;

  // Personalized Setters
  setGlassesName: (name: string) => void;
  setAccentColor: (color: string) => void;
  setActiveLedColor: (color: string) => void;
  setCameraCalibration: (val: number) => void;
  setSingleTapAction: (action: string) => void;
  setDoubleTapAction: (action: string) => void;
};

const FONT_SCALE_BY_PRESET: Record<FontSizePreset, number> = {
  small: 0.9,
  default: 1,
  large: 1.2,
};

const AccessibilitySettingsContext = createContext<AccessibilitySettingsContextValue | undefined>(
  undefined
);

export function AccessibilitySettingsProvider({ children }: { children: React.ReactNode }) {
  const [highContrast, setHighContrast] = useState(false);
  const [fontSizePreset, setFontSizePreset] = useState<FontSizePreset>('default');
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [hapticIntensity, setHapticIntensity] = useState<HapticPreset>('medium');
  const [detectionSensitivity, setDetectionSensitivity] = useState(false);

  // Personalized Hardware States
  const [glassesName, setGlassesNameState] = useState("Aasrith's VisioSense");
  const [accentColor, setAccentColorState] = useState('#007AFF');
  const [activeLedColor, setActiveLedColorState] = useState('Green');
  const [cameraCalibration, setCameraCalibrationState] = useState(0);
  const [singleTapAction, setSingleTapActionState] = useState('Read Scene');
  const [doubleTapAction, setDoubleTapActionState] = useState('Start Route');

  // Load persisted settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const hc = await AsyncStorage.getItem('@visiosense_high_contrast');
        if (hc !== null) setHighContrast(hc === 'true');

        const fs = await AsyncStorage.getItem('@visiosense_font_preset');
        if (fs !== null) setFontSizePreset(fs as FontSizePreset);

        const vs = await AsyncStorage.getItem('@visiosense_voice_speed');
        if (vs !== null) setVoiceSpeed(parseFloat(vs));

        const hi = await AsyncStorage.getItem('@visiosense_haptic_intensity');
        if (hi !== null) setHapticIntensity(hi as HapticPreset);

        const ds = await AsyncStorage.getItem('@visiosense_detection_sensitivity');
        if (ds !== null) setDetectionSensitivity(ds === 'true');

        const name = await AsyncStorage.getItem('@visiosense_glasses_name');
        if (name !== null) setGlassesNameState(name);

        const color = await AsyncStorage.getItem('@visiosense_accent_color');
        if (color !== null) setAccentColorState(color);

        const led = await AsyncStorage.getItem('@visiosense_active_led');
        if (led !== null) setActiveLedColorState(led);

        const cal = await AsyncStorage.getItem('@visiosense_camera_cal');
        if (cal !== null) setCameraCalibrationState(parseInt(cal));

        const tap1 = await AsyncStorage.getItem('@visiosense_tap_single');
        if (tap1 !== null) setSingleTapActionState(tap1);

        const tap2 = await AsyncStorage.getItem('@visiosense_tap_double');
        if (tap2 !== null) setDoubleTapActionState(tap2);
      } catch (err) {
        console.error('Failed to load accessibility settings', err);
      }
    };
    loadSettings();
  }, []);

  // Setters with Persistence
  const handleSetHighContrast = async (val: boolean) => {
    setHighContrast(val);
    await AsyncStorage.setItem('@visiosense_high_contrast', val ? 'true' : 'false');
  };

  const handleSetFontSizePreset = async (val: FontSizePreset) => {
    setFontSizePreset(val);
    await AsyncStorage.setItem('@visiosense_font_preset', val);
  };

  const handleSetVoiceSpeed = async (val: number) => {
    setVoiceSpeed(val);
    await AsyncStorage.setItem('@visiosense_voice_speed', val.toString());
  };

  const handleSetHapticIntensity = async (val: HapticPreset) => {
    setHapticIntensity(val);
    await AsyncStorage.setItem('@visiosense_haptic_intensity', val);
  };

  const handleSetDetectionSensitivity = async (val: boolean) => {
    setDetectionSensitivity(val);
    await AsyncStorage.setItem('@visiosense_detection_sensitivity', val ? 'true' : 'false');
  };

  const setGlassesName = async (name: string) => {
    setGlassesNameState(name);
    await AsyncStorage.setItem('@visiosense_glasses_name', name);
  };

  const setAccentColor = async (color: string) => {
    setAccentColorState(color);
    await AsyncStorage.setItem('@visiosense_accent_color', color);
  };

  const setActiveLedColor = async (color: string) => {
    setActiveLedColorState(color);
    await AsyncStorage.setItem('@visiosense_active_led', color);
  };

  const setCameraCalibration = async (val: number) => {
    setCameraCalibrationState(val);
    await AsyncStorage.setItem('@visiosense_camera_cal', val.toString());
  };

  const setSingleTapAction = async (action: string) => {
    setSingleTapActionState(action);
    await AsyncStorage.setItem('@visiosense_tap_single', action);
  };

  const setDoubleTapAction = async (action: string) => {
    setDoubleTapActionState(action);
    await AsyncStorage.setItem('@visiosense_tap_double', action);
  };

  const value = useMemo(
    () => ({
      highContrast,
      fontSizePreset,
      fontScale: FONT_SCALE_BY_PRESET[fontSizePreset],
      voiceSpeed,
      hapticIntensity,
      detectionSensitivity,
      
      glassesName,
      accentColor,
      activeLedColor,
      cameraCalibration,
      singleTapAction,
      doubleTapAction,

      setHighContrast: handleSetHighContrast,
      setFontSizePreset: handleSetFontSizePreset,
      setVoiceSpeed: handleSetVoiceSpeed,
      setHapticIntensity: handleSetHapticIntensity,
      setDetectionSensitivity: handleSetDetectionSensitivity,
      
      setGlassesName,
      setAccentColor,
      setActiveLedColor,
      setCameraCalibration,
      setSingleTapAction,
      setDoubleTapAction,
    }),
    [
      fontSizePreset,
      highContrast,
      voiceSpeed,
      hapticIntensity,
      detectionSensitivity,
      glassesName,
      accentColor,
      activeLedColor,
      cameraCalibration,
      singleTapAction,
      doubleTapAction,
    ]
  );

  return (
    <AccessibilitySettingsContext.Provider value={value}>
      {children}
    </AccessibilitySettingsContext.Provider>
  );
}

export function useAccessibilitySettings() {
  const context = useContext(AccessibilitySettingsContext);
  if (!context) {
    throw new Error('useAccessibilitySettings must be used within AccessibilitySettingsProvider');
  }
  return context;
}

export type { FontSizePreset, HapticPreset };
