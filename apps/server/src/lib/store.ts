import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DB_FILE, DATA_DIR, ROOT, STEAMCMD_DIR, ensureDirs } from './paths.js';
import type { AppSettings, DbShape } from '../types.js';
import { hashPassword, suggestPassword } from './password.js';
import { migrateSettings } from '../core/settings.js';
import { logger } from './log.js';

const log = logger('store');

function defaultSettings(): AppSettings {
  // ASMS_ARK_ROOT keeps a container (or a second drive) from having to reset
  // three folder settings by hand on first run.
  const base = process.env.ASMS_ARK_ROOT
    ? path.resolve(process.env.ASMS_ARK_ROOT)
    : process.platform === 'win32'
      ? path.join('C:', 'ASA')
      : path.join(os.homedir(), 'asa');
  return {
    steamCmdPath: path.join(STEAMCMD_DIR, process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd.sh'),
    launchWrapper: process.env.ASMS_LAUNCH_WRAPPER ?? '',
    defaultInstallRoot: path.join(base, 'servers'),
    backupRoot: path.join(base, 'backups'),
    clusterRoot: path.join(base, 'clusters'),
    passwordHash: '',
    /**
     * Local-only until somebody chooses otherwise, which is what SECURITY.md
     * has always promised and what the code did not do. Settings → Access
     * switches it to the whole network in one click, with the warning attached.
     * Docker sets ASMS_HOST=0.0.0.0 explicitly, because there the container
     * boundary is what limits exposure.
     */
    bindHost: '127.0.0.1',
    port: 8787,
    updateCheckInterval: 30,
    autoStartDelay: 20,
    backupRetention: 20,
    accent: 'ember',
    discordWebhook: '',
    notifyOn: ['crash', 'update', 'restart'],
    openBrowserOnStart: true,
  };
}

function defaults(): DbShape {
  return {
    version: 2,
    settings: defaultSettings(),
    servers: [],
    schedules: [],
    backups: [],
    setups: [],
    library: { mods: [], clusters: [] },
  };
}

let db: DbShape = defaults();
let writeTimer: NodeJS.Timeout | null = null;

/**
 * A password ASMS generated for you because none was set. Held only long enough
 * for index.ts to print it once - it is a hash from then on, and unrecoverable.
 */
let generatedPassword: string | null = null;

export function takeGeneratedPassword(): string | null {
  const value = generatedPassword;
  generatedPassword = null;
  return value;
}

export async function load(): Promise<DbShape> {
  ensureDirs();
  let raw: Partial<DbShape> & { settings?: Record<string, unknown> } = {};
  let existed = false;

  if (fs.existsSync(DB_FILE)) {
    try {
      raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      existed = true;
    } catch (err) {
      const bak = `${DB_FILE}.corrupt-${Date.now()}`;
      fs.copyFileSync(DB_FILE, bak);
      log.error('database unreadable, starting fresh; old copy kept at', bak, err);
      raw = {};
    }
  }

  db = {
    ...defaults(),
    ...raw,
    version: 2,
    settings: await migrateSettings(raw.settings ?? {}, defaultSettings()),
    // Servers saved before a field existed get its default rather than
    // undefined; mods used to be a plain list of id strings.
    servers: (raw.servers ?? []).map((server) => ({
      ...server,
      activeEvent: server.activeEvent ?? '',
      mods: (server.mods ?? []).map((mod) =>
        typeof mod === 'string'
          ? { id: mod, name: '', author: '', url: '', enabled: true }
          : {
              ...mod,
              name: mod.name ?? '',
              author: mod.author ?? '',
              url: mod.url ?? '',
              enabled: mod.enabled ?? true,
            },
      ),
    })),
    schedules: raw.schedules ?? [],
    backups: raw.backups ?? [],
    setups: raw.setups ?? [],
    library: {
      mods: raw.library?.mods ?? [],
      clusters: raw.library?.clusters ?? [],
    },
  };

  // A container is configured by environment, not by clicking: when this is
  // set it wins on every start, so the compose file stays the source of truth.
  if (process.env.ASMS_PASSWORD) {
    db.settings.passwordHash = await hashPassword(process.env.ASMS_PASSWORD);
  } else if (!existed && !db.settings.passwordHash) {
    /**
     * First run with nothing configured. ASMS used to start wide open on
     * 0.0.0.0 with no sign-in and only a line in the log about it - which
     * nobody running it detached ever saw. Now it picks one, prints it, and
     * the owner can clear it in Settings if they genuinely want it open.
     */
    generatedPassword = suggestPassword();
    db.settings.passwordHash = await hashPassword(generatedPassword);
  }

  /**
   * Write back immediately when the file on disk is an older shape.
   *
   * Without this the migration only ever lived in memory: a database written by
   * 0.1.x kept its plaintext `password` field on disk until something else
   * happened to save, which for a machine nobody touches could be never. The
   * point of hashing it is that it stops being readable, so it has to land now.
   */
  const staleOnDisk =
    !existed || raw.version !== db.version || (raw.settings !== undefined && 'password' in raw.settings);
  if (staleOnDisk) {
    saveNow();
    if (existed) log.info('database migrated to version 2 (the dashboard password is now stored hashed)');
  }
  return db;
}

export function data(): DbShape {
  return db;
}

export function settings(): AppSettings {
  return db.settings;
}

/** Replace the settings object wholesale, after validation. */
export function setSettings(next: AppSettings): void {
  db.settings = next;
}

/**
 * Where ASMS really listens. Environment wins over the saved settings so a
 * container can be configured without editing the database, and the UI can
 * point at the address that actually works rather than the one on file.
 */
export function listenConfig(): { host: string; port: number; fromEnv: boolean } {
  const envHost = process.env.ASMS_HOST;
  const envPort = process.env.ASMS_PORT;
  const port = Number(envPort ?? db.settings.port);
  return {
    host: envHost ?? db.settings.bindHost,
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 8787,
    fromEnv: Boolean(envHost || envPort),
  };
}

/** Debounced write — call after any mutation. */
export function save(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    saveNow();
  }, 150);
}

/**
 * Write the database now, durably.
 *
 * Temp file, fsync, rename. Without the fsync a rename can land before the
 * bytes do, so a power cut leaves an empty file where the database was - which
 * on this app means every server, schedule and backup record is gone.
 */
export function saveNow(): void {
  ensureDirs();
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const tmp = `${DB_FILE}.tmp`;
  const text = JSON.stringify(db, null, 2);
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  fs.renameSync(tmp, DB_FILE);
}

export function id(prefix = ''): string {
  return prefix + crypto.randomBytes(6).toString('hex');
}

export { DATA_DIR, ROOT };
