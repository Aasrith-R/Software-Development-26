import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { AccessibleText as Text } from '@/components/accessible-text';
import { AppHeader } from '@/components/app-header';
import { ScreenContainer } from '@/components/screen-container';
import { useProfile } from '@/context/profile';
import { useTheme } from '@/context/theme';
import {
  makeConnectToken,
  sendTestTelegram,
  watchForConnectToken,
} from '@/services/telegram';
import { TELEGRAM_BOT_USERNAME } from '../config';
import { Fonts, TypeScale, type ThemePalette } from '@/constants/theme';

export default function EmergencyContactScreen() {
  const router = useRouter();
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(palette, isDark), [palette, isDark]);
  const {
    emergencyName,
    emergencyChatId,
    fallDetectionEnabled,
    setEmergencyContact,
    setFallDetectionEnabled,
  } = useProfile();

  const [connecting, setConnecting] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      cancelRef.current?.();
    };
  }, []);

  const connected = !!emergencyChatId;

  const onConnect = async () => {
    if (connecting) {
      cancelRef.current?.();
      setConnecting(false);
      return;
    }
    setConnecting(true);
    const token = makeConnectToken();
    const url = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Could not open Telegram', 'Install Telegram and try again.');
      setConnecting(false);
      return;
    }

    const watcher = watchForConnectToken(token, { timeoutMs: 120_000 });
    cancelRef.current = watcher.cancel;
    const result = await watcher.promise;
    cancelRef.current = null;
    setConnecting(false);

    if (!result) {
      Alert.alert(
        'Connection timed out',
        "We didn't see a Start message from Telegram. Open the bot and tap Start, then try again."
      );
      return;
    }
    await setEmergencyContact(result.displayName, result.chatId);
    Alert.alert('Connected', `${result.displayName} will receive fall alerts.`);
  };

  const onDisconnect = async () => {
    await setEmergencyContact('', '');
  };

  return (
    <ScreenContainer>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <AppHeader
          eyebrow="SAFETY"
          title="Emergency Contact"
          onBack={() => router.back()}
          showMenu={false}
        />
        <Text style={styles.sub}>
          Connect a Telegram account that will receive a message — with your last known
          location — if VisioSense detects a fall.
        </Text>

        <Text style={styles.sectionHeader}>TELEGRAM</Text>
        {connected ? (
          <View style={styles.connectedCard}>
            <View style={styles.connectedAvatar}>
              <Ionicons name="checkmark" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.connectedName}>{emergencyName || 'Connected'}</Text>
              <Text style={styles.connectedSub}>
                Telegram chat linked · alerts deliver silently
              </Text>
            </View>
            <TouchableOpacity
              onPress={onDisconnect}
              accessibilityRole="button"
              style={styles.disconnectBtn}
            >
              <Text style={styles.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.primaryBtn, connecting && styles.btnPending]}
            onPress={onConnect}
            accessibilityRole="button"
          >
            {connecting ? (
              <>
                <ActivityIndicator color="#fff" />
                <Text style={styles.primaryBtnText}>
                  Waiting for Telegram… tap to cancel
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="paper-plane" size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>Connect Telegram</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {!connected && (
          <Text style={styles.footnote}>
            Telegram will open with our bot. Tap Start and you&apos;ll be linked automatically —
            no copying codes.
          </Text>
        )}

        <Text style={styles.sectionHeader}>FALL DETECTION</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <Ionicons name="alert-circle-outline" size={18} color={palette.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Enabled</Text>
              <Text style={styles.rowHelper}>
                Monitor for a sudden fall while the app is open.
              </Text>
            </View>
            <Switch
              value={fallDetectionEnabled}
              onValueChange={setFallDetectionEnabled}
              trackColor={{ false: palette.surfaceContainerHigh, true: palette.primary }}
              ios_backgroundColor={palette.surfaceContainerHigh}
            />
          </View>
        </View>
        <Text style={styles.footnote}>
          On detection, the alert sends silently in the background — no confirmation prompt.
        </Text>

        {connected && (
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={async () => {
              try {
                await sendTestTelegram(emergencyChatId);
                Alert.alert('Sent', 'Test message delivered.');
              } catch (err) {
                Alert.alert('Send failed', String(err));
              }
            }}
            accessibilityRole="button"
          >
            <Ionicons name="paper-plane-outline" size={16} color={palette.primary} />
            <Text style={styles.secondaryBtnText}>Send Test Message</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

function makeStyles(p: ThemePalette, isDark: boolean) {
  const cardBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(60,60,67,0.06)';
  return StyleSheet.create({
    scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32 },
    sub: {
      ...TypeScale.subhead,
      color: p.onSurfaceVariant,
      marginTop: -8,
      marginBottom: 20,
    },
    sectionHeader: {
      ...TypeScale.footnote,
      fontWeight: '600',
      color: p.onSurfaceVariant,
      letterSpacing: 0.8,
      marginLeft: 16,
      marginBottom: 8,
      marginTop: 12,
    },
    group: {
      backgroundColor: p.surfaceContainerLow,
      borderRadius: 20,
      overflow: 'hidden',
      marginBottom: 4,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      minHeight: 56,
      paddingVertical: 10,
    },
    iconWrap: {
      width: 30,
      height: 30,
      borderRadius: 9,
      backgroundColor: isDark ? 'rgba(10,132,255,0.16)' : 'rgba(10,132,255,0.10)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowLabel: {
      ...TypeScale.body,
      color: p.onSurface,
      flex: 1,
      fontWeight: '500',
    },
    rowHelper: { ...TypeScale.caption1, color: p.onSurfaceVariant, marginTop: 1 },
    footnote: {
      ...TypeScale.caption1,
      color: p.onSurfaceVariant,
      marginLeft: 16,
      marginTop: 6,
      marginBottom: 16,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      backgroundColor: p.primary,
      borderRadius: 16,
      paddingVertical: 16,
      marginBottom: 8,
      shadowColor: p.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 8,
    },
    btnPending: { opacity: 0.8 },
    primaryBtnText: { ...TypeScale.body, color: '#fff', fontWeight: '700', fontFamily: Fonts.sans },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: p.surfaceContainerLow,
      borderWidth: 1,
      borderColor: cardBorder,
      borderRadius: 16,
      paddingVertical: 14,
      marginTop: 8,
    },
    secondaryBtnText: {
      ...TypeScale.body,
      color: p.primary,
      fontWeight: '600',
      fontFamily: Fonts.sans,
    },
    connectedCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: p.surfaceContainerLow,
      borderRadius: 20,
      padding: 14,
      marginBottom: 4,
      borderWidth: 1,
      borderColor: cardBorder,
    },
    connectedAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: p.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    connectedName: {
      ...TypeScale.body,
      color: p.onSurface,
      fontWeight: '700',
      fontFamily: Fonts.sans,
    },
    connectedSub: { ...TypeScale.caption1, color: p.onSurfaceVariant, marginTop: 2 },
    disconnectBtn: { paddingHorizontal: 10, paddingVertical: 6 },
    disconnectText: {
      ...TypeScale.caption1,
      color: p.primary,
      fontWeight: '700',
      fontFamily: Fonts.sans,
    },
  });
}
