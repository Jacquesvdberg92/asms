import https from 'node:https';
import { settings } from './store.js';
import { logger } from './log.js';
import { notice } from './bus.js';

const log = logger('notify');

export type NotifyKind = 'crash' | 'update' | 'restart' | 'backup' | 'start' | 'stop';

const COLORS: Record<NotifyKind, number> = {
  crash: 0xef4444,
  update: 0x38bdf8,
  restart: 0xf59e0b,
  backup: 0x22c55e,
  start: 0x22c55e,
  stop: 0x94a3b8,
};

/**
 * Push an event to the configured Discord webhook. Fire-and-forget: a webhook
 * failure must never take a server action down with it.
 */
export function discord(kind: NotifyKind, title: string, description: string): void {
  const { discordWebhook, notifyOn } = settings();
  if (!discordWebhook || !notifyOn.includes(kind)) return;

  const body = JSON.stringify({
    username: 'ASMS',
    embeds: [
      {
        title,
        description,
        color: COLORS[kind],
        footer: { text: 'Ark Server Management Suite' },
        timestamp: new Date().toISOString(),
      },
    ],
  });

  try {
    const url = new URL(discordWebhook);
    const req = https.request(
      {
        hostname: url.hostname,
        // Without this a webhook URL carrying a port silently went to 443
        // instead, and the user saw no notifications and no reason why.
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => res.resume(),
    );
    req.on('error', (err) => log.warn('discord webhook failed', err.message));
    req.setTimeout(8000, () => req.destroy());
    req.write(body);
    req.end();
  } catch (err) {
    log.warn('invalid discord webhook url', err);
  }
}

/**
 * Is this a webhook URL worth saving?
 *
 * Checked when it is typed rather than when an event fires: a webhook that goes
 * nowhere is otherwise discovered three days later, by the crash notification
 * that never arrived.
 */
export function checkWebhook(value: string): { ok: true } | { ok: false; error: string } {
  const raw = value.trim();
  if (!raw) return { ok: true }; // Empty is the documented way to switch it off.
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'That is not a URL. A Discord webhook starts with https://discord.com/api/webhooks/' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'A webhook URL has to be https - Discord does not accept anything else.' };
  }
  if (!/(^|\.)discord(app)?\.com$/i.test(url.hostname)) {
    return { ok: false, error: `That points at ${url.hostname}, not Discord. Copy the URL from Server Settings - Integrations - Webhooks.` };
  }
  if (!/^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname)) {
    return { ok: false, error: 'That is a Discord link but not a webhook URL. The one you want ends in /api/webhooks/<id>/<token>.' };
  }
  return { ok: true };
}

/** Post a message and wait for Discord's answer. Used by the Test button. */
export function sendTest(webhook: string, content: string): Promise<void> {
  const check = checkWebhook(webhook);
  if (!check.ok) return Promise.reject(new Error(check.error));
  if (!webhook.trim()) return Promise.reject(new Error('There is no webhook URL to test yet.'));

  const body = JSON.stringify({ username: 'ASMS', content });
  return new Promise((resolve, reject) => {
    const url = new URL(webhook.trim());
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        const code = res.statusCode ?? 0;
        if (code >= 200 && code < 300) resolve();
        else if (code === 401 || code === 403 || code === 404) {
          reject(new Error(`Discord rejected that webhook (HTTP ${code}). It was probably deleted - make a new one and paste it again.`));
        } else reject(new Error(`Discord answered HTTP ${code}.`));
      },
    );
    req.on('error', (err) => reject(new Error(`Could not reach Discord: ${err.message}`)));
    req.setTimeout(8000, () => req.destroy(new Error('Discord did not answer within 8 seconds.')));
    req.write(body);
    req.end();
  });
}

/** Send to both the UI toast stream and Discord. */
export function announce(
  kind: NotifyKind,
  level: 'info' | 'success' | 'warn' | 'error',
  title: string,
  body: string,
): void {
  notice(level, title, body);
  discord(kind, title, body);
}
