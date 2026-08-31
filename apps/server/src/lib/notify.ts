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
