/**
 * The one place a settings object is rebuilt from untrusted input.
 *
 * `PUT /api/settings` used to be `Object.assign(current, req.body)` with no
 * validation at all, which meant `{"password": 12345}` was saved to disk and
 * then threw out of `authRequired()` on every request from the next boot on -
 * a permanent 500 on every route, sign-in included, fixable only by hand-editing
 * asms.json. Every field is rebuilt with a typed clamp instead, and the archive
 * importer shares the same function so the two can never drift apart.
 */

import { hashPassword, isHash } from '../lib/password.js';
import { checkWebhook } from '../lib/notify.js';
import type { AppSettings } from '../types.js';

const MAX_PATH = 400;

const ACCENTS = new Set(['ember', 'cyan', 'violet', 'lime']);
const NOTIFY_KINDS = new Set(['crash', 'update', 'restart', 'backup', 'start', 'stop']);

const text = (value: unknown, fallback: string, max = MAX_PATH): string =>
  typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : fallback;

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const int = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/**
 * A bind address ASMS could actually listen on. Anything else would make the
 * next start fail with EADDRNOTAVAIL, after the browser that set it is gone.
 */
function bindHost(value: unknown, fallback: string): string {
  const raw = text(value, '', 60).toLowerCase();
  if (!raw) return fallback;
  if (raw === 'localhost' || raw === '0.0.0.0' || raw === '::' || raw === '::1') return raw;
  // Dotted IPv4, or a bare IPv6 literal. Hostnames are refused: they resolve
  // differently from where you typed them and are never what someone means here.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw) && raw.split('.').every((part) => Number(part) <= 255)) return raw;
  if (/^[0-9a-f:]+$/.test(raw) && raw.includes(':')) return raw;
  return fallback;
}

/**
 * Rebuild a full settings object from whatever arrived.
 *
 * `passwordHash` is deliberately never taken from `input` here - a plaintext
 * password needs hashing, which is async, and the archive importer carries an
 * already-hashed value. Both are handled by their own callers.
 */
export function validateSettings(input: unknown, current: AppSettings): AppSettings {
  const raw = (input ?? {}) as Record<string, unknown>;
  return {
    steamCmdPath: text(raw.steamCmdPath, current.steamCmdPath),
    launchWrapper: text(raw.launchWrapper, current.launchWrapper),
    defaultInstallRoot: text(raw.defaultInstallRoot, current.defaultInstallRoot),
    backupRoot: text(raw.backupRoot, current.backupRoot),
    clusterRoot: text(raw.clusterRoot, current.clusterRoot),
    passwordHash: current.passwordHash,
    bindHost: bindHost(raw.bindHost, current.bindHost),
    port: int(raw.port, current.port, 1, 65535),
    updateCheckInterval: int(raw.updateCheckInterval, current.updateCheckInterval, 0, 1440),
    autoStartDelay: int(raw.autoStartDelay, current.autoStartDelay, 0, 600),
    backupRetention: int(raw.backupRetention, current.backupRetention, 1, 200),
    accent: ACCENTS.has(String(raw.accent)) ? String(raw.accent) : current.accent,
    discordWebhook: text(raw.discordWebhook, current.discordWebhook),
    notifyOn: Array.isArray(raw.notifyOn)
      ? [...new Set(raw.notifyOn.map((kind) => String(kind)).filter((kind) => NOTIFY_KINDS.has(kind)))]
      : current.notifyOn,
    openBrowserOnStart: bool(raw.openBrowserOnStart, current.openBrowserOnStart),
  };
}

/**
 * Settings as the browser is allowed to see them.
 *
 * The hash never leaves the server: there is nothing the UI can do with it, and
 * every field of this object is sent on `/api/state`, which the dashboard calls
 * on every load.
 */
export type PublicSettings = Omit<AppSettings, 'passwordHash'> & { passwordSet: boolean };

export function publicSettings(settings: AppSettings): PublicSettings {
  const { passwordHash, ...rest } = settings;
  return { ...rest, passwordSet: passwordHash.length > 0 };
}

export interface SettingsPatchResult {
  settings: AppSettings;
  /** True when the password actually changed, so sessions can be revoked. */
  passwordChanged: boolean;
}

/**
 * Apply a settings patch from the dashboard.
 *
 * `password` is a plaintext field the UI only sends when somebody typed in it:
 * absent means "leave it alone", empty string means "turn sign-in off". That is
 * what lets the Settings page stop round-tripping the password on every save.
 */
export async function applySettingsPatch(current: AppSettings, patch: unknown): Promise<SettingsPatchResult> {
  const raw = (patch ?? {}) as Record<string, unknown>;
  const next = validateSettings(raw, current);

  const webhook = checkWebhook(next.discordWebhook);
  if (!webhook.ok) throw new Error(webhook.error);

  let passwordChanged = false;
  if (typeof raw.password === 'string') {
    const wanted = raw.password;
    if (!wanted) {
      passwordChanged = current.passwordHash.length > 0;
      next.passwordHash = '';
    } else if (wanted.length < 4) {
      throw new Error('A dashboard password needs at least 4 characters. Leave it empty to turn sign-in off entirely.');
    } else {
      next.passwordHash = await hashPassword(wanted);
      passwordChanged = true;
    }
  }

  return { settings: next, passwordChanged };
}

/**
 * Bring a settings object read off disk up to date.
 *
 * Two migrations live here: `password` used to be stored in the clear, and
 * `theme` was a field nothing ever read.
 */
export async function migrateSettings(raw: Record<string, unknown>, base: AppSettings): Promise<AppSettings> {
  const settings = validateSettings(raw, base);

  const stored = raw.passwordHash ?? raw.password;
  if (isHash(stored)) {
    settings.passwordHash = String(stored);
  } else if (typeof stored === 'string' && stored.length) {
    // A database from before hashing. Hash what is there and carry on; nobody
    // has to re-enter anything.
    settings.passwordHash = await hashPassword(stored);
  } else {
    settings.passwordHash = '';
  }

  return settings;
}
