import Constants from 'expo-constants';

// Backend configuration
//
// IMPORTANT:
// - When running on a physical phone, `http://localhost:8001` points at the phone, not your computer.
// - If you don't set `EXPO_PUBLIC_BACKEND_URL`, we try to infer your dev machine's IP from the Expo dev server
//   (so QR scans "just work" on LAN).
//
// You can always override with `frontend/.env`:
//   ngrok:    EXPO_PUBLIC_BACKEND_URL=https://your-subdomain.ngrok-free.app
//   local:    EXPO_PUBLIC_BACKEND_URL=http://192.168.1.100:8001
//   deployed: EXPO_PUBLIC_BACKEND_URL=https://your-server.com

function looksLikeLocalhost(url: string) {
  return /\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/i.test(url);
}

function extractHost(hostUri: string) {
  const withoutScheme = hostUri.replace(/^[a-z]+:\/\//i, '');
  const hostPort = withoutScheme.split('/')[0] ?? '';
  const host = hostPort.split(':')[0] ?? '';
  return host.trim();
}

function inferBackendBaseFromExpoDevServer(): string | null {
  // Expo Go commonly provides one of these (varies by SDK / runtime).
  const hostUri =
    (Constants.expoConfig as { hostUri?: string } | undefined)?.hostUri ??
    // Legacy field (still present in some runtimes).
    (Constants as unknown as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost ??
    // Newer manifest format (best-effort).
    (Constants as unknown as { manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } } }).manifest2?.extra
      ?.expoGo?.debuggerHost;

  if (!hostUri) return null;

  const host = extractHost(hostUri);
  if (!host || host.toLowerCase() === 'localhost') return null;

  return `http://${host}:8001`;
}

const envBackendBase = process.env.EXPO_PUBLIC_BACKEND_URL?.trim();
const inferredBackendBase = inferBackendBaseFromExpoDevServer();

const BACKEND_BASE =
  envBackendBase && !looksLikeLocalhost(envBackendBase)
    ? envBackendBase
    : inferredBackendBase ?? envBackendBase ?? 'http://localhost:8001';

export const BACKEND_URL = `${BACKEND_BASE}/detect/`;
export const NAV_DETECT_URL = `${BACKEND_BASE}/detect-navigate/`;

// Telegram bot used to deliver fall-detection alerts. The contact must message
// the bot once (e.g. /start at t.me/Patient231_bot) so it has a chat_id to send
// to. Override with EXPO_PUBLIC_TELEGRAM_BOT_TOKEN in frontend/.env.
//
// SECURITY: shipping a bot token in the client lets anyone with the bundle send
// messages as this bot. Move to a Supabase Edge Function before production.
export const TELEGRAM_BOT_TOKEN =
  process.env.EXPO_PUBLIC_TELEGRAM_BOT_TOKEN?.trim() ||
  '8992975323:AAHw8iuCUttReh7F2xkm7-loKHwNxztSEoI';
export const TELEGRAM_BOT_USERNAME = 'Patient231_bot';
