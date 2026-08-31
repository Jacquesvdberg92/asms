import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DB_FILE, DATA_DIR, ROOT, STEAMCMD_DIR, ensureDirs } from './paths.js';
import type { AppSettings, DbShape } from '../types.js';
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
    password: '',
    bindHost: '0.0.0.0',
    port: 8787,
    updateCheckInterval: 30,
    autoStartDelay: 20,
    backupRetention: 20,
    theme: 'dark',
    accent: 'ember',
    discordWebhook: '',
    notifyOn: ['crash', 'update', 'restart'],
    openBrowserOnStart: true,
  };
}

function defaults(): DbShape {
  return {
    version: 1,
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

export function load(): DbShape {
  ensureDirs();
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as Partial<DbShape>;
      db = {
        ...defaults(),
        ...raw,
        settings: { ...defaultSettings(), ...(raw.settings ?? {}) },
        // Servers saved before a field existed get its default rather than undefined.
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
    } catch (err) {
      const bak = `${DB_FILE}.corrupt-${Date.now()}`;
      fs.copyFileSync(DB_FILE, bak);
      log.error('database unreadable, starting fresh; old copy kept at', bak, err);
      db = defaults();
    }
  } else {
    db = defaults();
    saveNow();
  }
  // A container is configured by environment, not by clicking: when this is
  // set it wins on every start, so the compose file stays the source of truth.
  if (process.env.ASMS_PASSWORD) db.settings.password = process.env.ASMS_PASSWORD;
  return db;
}

export function data(): DbShape {
  return db;
}

export function settings(): AppSettings {
  return db.settings;
}

/**
 * Where ASMS really listens. Environment wins over the saved settings so a
 * container can be configured without editing the database, and the UI can
 * point at the address that actually works rather than the one on file.
 */
export function listenConfig(): { host: string; port: number; fromEnv: boolean } {
  const envHost = process.env.ASMS_HOST;
  const envPort = process.env.ASMS_PORT;
  return {
    host: envHost ?? db.settings.bindHost,
    port: Number(envPort ?? db.settings.port),
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

export function saveNow(): void {
  ensureDirs();
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function id(prefix = ''): string {
  return prefix + crypto.randomBytes(6).toString('hex');
}

export { DATA_DIR, ROOT };
