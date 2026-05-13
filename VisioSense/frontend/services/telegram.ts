import { TELEGRAM_BOT_TOKEN } from '../config';
import { getCurrentLocation } from './location-service';

const TG_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

async function tgPost<T = any>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${TG_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Telegram ${method} ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function tgGet<T = any>(method: string): Promise<T> {
  const res = await fetch(`${TG_BASE}/${method}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Telegram ${method} ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function sendFallAlertTelegram(chatId: string, contactName?: string): Promise<void> {
  if (!chatId) return;

  let body = '🚨 VisioSense detected a possible fall. Please check on me.';
  try {
    const loc = await getCurrentLocation();
    if (loc) {
      const link = `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`;
      body =
        `🚨 *VisioSense fall alert*\n\n` +
        (contactName ? `Hi ${contactName}, ` : '') +
        `a possible fall was detected.\n\n` +
        `📍 Last known location: ${link}\n\n` +
        `_Sent automatically by VisioSense._`;
    }
  } catch {
    // location optional
  }

  await tgPost('sendMessage', {
    chat_id: chatId,
    text: body,
    parse_mode: 'Markdown',
    disable_web_page_preview: false,
  });
}

export async function sendTestTelegram(chatId: string): Promise<void> {
  if (!chatId) return;
  await tgPost('sendMessage', {
    chat_id: chatId,
    text:
      '✅ VisioSense test message. Your emergency contact is set up correctly. ' +
      'If a fall is detected, you will receive an alert here with location.',
  });
}

type TgUpdate = {
  update_id: number;
  message?: {
    chat: { id: number; first_name?: string; last_name?: string; username?: string };
    text?: string;
    date: number;
  };
};

/**
 * Watches Telegram `getUpdates` for a `/start <token>` message and resolves
 * with the chat_id + display name of whoever sent it. Returns null on timeout.
 * Cancellable via the returned `cancel()` function.
 */
export function watchForConnectToken(
  token: string,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
): { promise: Promise<{ chatId: string; displayName: string } | null>; cancel: () => void } {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;
  let cancelled = false;
  let offset = 0;
  const target = `/start ${token}`;

  const promise = (async () => {
    const deadline = Date.now() + timeoutMs;
    while (!cancelled && Date.now() < deadline) {
      try {
        const url = `${TG_BASE}/getUpdates?timeout=0&offset=${offset}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = (await res.json()) as { ok: boolean; result: TgUpdate[] };
          if (data.ok && data.result.length) {
            for (const u of data.result) {
              if (u.update_id >= offset) offset = u.update_id + 1;
              const text = u.message?.text?.trim();
              if (text === target && u.message) {
                const chat = u.message.chat;
                const name =
                  [chat.first_name, chat.last_name].filter(Boolean).join(' ').trim() ||
                  chat.username ||
                  `Chat ${chat.id}`;
                return { chatId: String(chat.id), displayName: name };
              }
            }
          }
        }
      } catch {
        // network blip — keep polling
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    return null;
  })();

  return { promise, cancel: () => { cancelled = true; } };
}

export function makeConnectToken(): string {
  // 16-char URL-safe random token. Good enough for one-off pairing.
  const bytes = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 16; i++) out += bytes[Math.floor(Math.random() * bytes.length)];
  return out;
}
