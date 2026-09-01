/**
 * Archives: the whole of ASMS in one file.
 *
 * A setup bundle (core/setups.ts) is deliberately shareable — it carries no
 * secrets and applies to one server. An archive is the opposite: it is a
 * migration, so it carries everything needed to be running again on another
 * machine. Servers with their ports and passwords, both INI files of each,
 * schedules, the mod and cluster library, saved setups and ASMS's own
 * settings.
 *
 * Three rules shape this file:
 *
 *  1. It is a backup, not a post. Passwords travel by default, because a
 *     restore that loses admin access to four servers is not a restore. The
 *     UI says so, and exporting without secrets is one toggle away.
 *  2. A file coming back in is untrusted, exactly like a setup: every field is
 *     rebuilt rather than spread, because these values end up on a command
 *     line and inside INI files.
 *  3. Nothing on disk is ever deleted by an import. Replacing wipes what ASMS
 *     remembers, never a server install, a save game or a backup zip.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { data, save, settings as appSettings, id as newId } from '../lib/store.js';
import { bus } from '../lib/bus.js';
import { logger } from '../lib/log.js';
import * as config from './config.js';
import * as servers from './servers.js';
import * as scheduler from './scheduler.js';
import * as setupsCore from './setups.js';
import { cleanClusterId } from './library.js';
import { validateSettings } from './settings.js';
import { isHash } from '../lib/password.js';
import { revokeAll } from '../api/auth.js';
import type {
  AppSettings,
  ArchiveBundle,
  ArchiveImportOptions,
  ArchiveImportResult,
  ArchiveParts,
  ArchiveSummary,
  BackupEntry,
  LaunchFlags,
  Library,
  SavedCluster,
  SavedMod,
  SavedSetup,
  ScheduleTask,
  ServerConfigFiles,
  ServerInstance,
} from '../types.js';

const log = logger('archive');

export const ARCHIVE_VERSION = 1;

const MAX_SERVERS = 50;
const MAX_SCHEDULES = 500;
const MAX_SETUPS = 200;
const MAX_LIBRARY = 300;
const MAX_INI_BYTES = 512 * 1024;
const MAX_PATH = 400;
const MAX_TEXT = 400;

/** Folder settings that describe this machine rather than this cluster. */
const LOCAL_FOLDER_KEYS: Array<keyof AppSettings> = ['defaultInstallRoot', 'backupRoot', 'clusterRoot', 'steamCmdPath'];

const text = (value: unknown, max = MAX_TEXT): string =>
  String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, max);

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const int = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

const stamp = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : Date.now();
};

export function defaultParts(): ArchiveParts {
  return { servers: true, library: true, setups: true, settings: true };
}

function partsFrom(input: unknown): ArchiveParts {
  const raw = (input ?? {}) as Partial<Record<keyof ArchiveParts, unknown>>;
  const base = defaultParts();
  const pick = (key: keyof ArchiveParts) => (typeof raw[key] === 'boolean' ? (raw[key] as boolean) : base[key]);
  return { servers: pick('servers'), library: pick('library'), setups: pick('setups'), settings: pick('settings') };
}

// ------------------------------------------------------------- exporting

export interface ExportInput {
  /** Off strips passwords and the Discord webhook. Defaults to on. */
  includeSecrets?: boolean;
}

/**
 * Read the INI files a server actually has. A server that is configured but
 * not installed yet has none, and inventing them would restore a skeleton over
 * whatever the target machine already had.
 */
function readConfigs(server: ServerInstance): ServerConfigFiles | null {
  const gusPath = config.iniPath(server, 'gus');
  const gamePath = config.iniPath(server, 'game');
  if (!fs.existsSync(gusPath) && !fs.existsSync(gamePath)) return null;
  return {
    gus: fs.existsSync(gusPath) ? fs.readFileSync(gusPath, 'utf8').slice(0, MAX_INI_BYTES) : '',
    game: fs.existsSync(gamePath) ? fs.readFileSync(gamePath, 'utf8').slice(0, MAX_INI_BYTES) : '',
  };
}

export function exportArchive(input: ExportInput = {}): ArchiveBundle {
  const includeSecrets = input.includeSecrets !== false;
  const db = data();

  const configs: Record<string, ServerConfigFiles> = {};
  for (const server of db.servers) {
    let files: ServerConfigFiles | null = null;
    try {
      files = readConfigs(server);
    } catch (err) {
      log.warn(`could not read INI files for ${server.name}:`, err);
    }
    if (!files) continue;
    // Without secrets the INI has to lose the same fields the record does, or
    // the passwords would simply travel one file deeper.
    configs[server.id] = includeSecrets
      ? files
      : { gus: setupsCore.scrubIni(files.gus), game: setupsCore.scrubIni(files.game) };
  }

  const bundle: ArchiveBundle = {
    kind: 'asms.archive',
    version: ARCHIVE_VERSION,
    exportedAt: Date.now(),
    exportedBy: 'ASMS',
    host: os.hostname(),
    hasSecrets: includeSecrets,
    // The password travels as its scrypt hash, never as itself — a restore
    // still signs you in with the password you already know.
    settings: includeSecrets ? { ...db.settings } : { ...db.settings, passwordHash: '', discordWebhook: '' },
    servers: db.servers.map((server) => ({
      ...server,
      mods: server.mods.map((mod) => ({ ...mod })),
      flags: { ...server.flags },
      ...(includeSecrets ? {} : { serverPassword: '', adminPassword: '', spectatorPassword: '' }),
    })),
    schedules: db.schedules.map((task) => ({ ...task })),
    backups: db.backups.map((entry) => ({ ...entry })),
    setups: db.setups.map((setup) => ({ ...setup, bundle: { ...setup.bundle } })),
    library: {
      mods: db.library.mods.map((mod) => ({ ...mod })),
      clusters: db.library.clusters.map((cluster) => ({ ...cluster })),
    },
    configs,
  };

  log.info(
    `exported ${bundle.servers.length} servers, ${bundle.schedules.length} tasks, ${bundle.setups.length} setups` +
      `${includeSecrets ? '' : ' (secrets stripped)'}`,
  );
  return bundle;
}

/** A filename that says which machine and which day, for a folder full of them. */
export function fileName(bundle: ArchiveBundle): string {
  const host = bundle.host.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'asms';
  const day = new Date(bundle.exportedAt).toISOString().slice(0, 10);
  return `asms-backup-${host}-${day}.asms-archive.json`;
}

// ------------------------------------------------------------ validating

function validateServer(input: unknown): ServerInstance | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const name = text(raw.name, 80) || 'Imported server';
  const map = text(raw.map, 64);
  const rawId = text(raw.id, 40);

  const flags = servers.defaultFlags();
  const rawFlags = (raw.flags ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(flags) as Array<keyof LaunchFlags>) {
    if (typeof rawFlags[key] === 'boolean') flags[key] = rawFlags[key] as boolean;
  }

  return {
    id: /^[A-Za-z0-9_-]{3,40}$/.test(rawId) ? rawId : newId('srv_'),
    name,
    map: /^[A-Za-z0-9_]+$/.test(map) ? map : 'TheIsland_WP',
    installPath: text(raw.installPath, MAX_PATH),
    sessionName: text(raw.sessionName, 80) || name,
    serverPassword: text(raw.serverPassword, 80),
    adminPassword: text(raw.adminPassword, 80),
    spectatorPassword: text(raw.spectatorPassword, 80),
    motd: text(raw.motd, 500),
    port: int(raw.port, 7777, 1, 65535),
    queryPort: int(raw.queryPort, 27015, 1, 65535),
    rconPort: int(raw.rconPort, 27020, 1, 65535),
    rconEnabled: bool(raw.rconEnabled, true),
    maxPlayers: int(raw.maxPlayers, 70, 1, 255),
    multihome: text(raw.multihome, 60),
    clusterId: cleanClusterId(raw.clusterId),
    clusterDir: text(raw.clusterDir, MAX_PATH),
    mods: servers.normaliseMods(raw.mods),
    flags,
    activeEvent: text(raw.activeEvent, 40).replace(/[^A-Za-z0-9_]/g, ''),
    extraArgs: text(raw.extraArgs, 1000),
    extraQuery: text(raw.extraQuery, 1000),
    autoStart: bool(raw.autoStart, false),
    autoRestartOnCrash: bool(raw.autoRestartOnCrash, true),
    updateOnStart: bool(raw.updateOnStart, true),
    createdAt: stamp(raw.createdAt),
    updatedAt: stamp(raw.updatedAt),
  };
}

function validateSchedule(input: unknown, knownServers: Set<string>): ScheduleTask | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const serverId = text(raw.serverId, 40);
  if (!knownServers.has(serverId)) return null;
  const cron = text(raw.cron, 60);
  if (!scheduler.validateCron(cron).ok) return null;
  const action = ['restart', 'backup', 'update', 'stop', 'start', 'rcon'].includes(String(raw.action))
    ? (raw.action as ScheduleTask['action'])
    : null;
  if (!action) return null;
  return {
    id: newId('job_'),
    serverId,
    name: text(raw.name, 80) || 'Imported task',
    action,
    cron,
    enabled: bool(raw.enabled, true),
    warnMinutes: Array.isArray(raw.warnMinutes)
      ? raw.warnMinutes
          .map((n) => Math.round(Number(n)))
          .filter((n) => Number.isFinite(n) && n > 0 && n <= 1440)
          .slice(0, 10)
      : [],
    command: text(raw.command, 500),
    lastRun: null,
    lastResult: null,
    nextRun: null,
  };
}

function validateBackup(input: unknown, knownServers: Set<string>): BackupEntry | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const serverId = text(raw.serverId, 40);
  const file = text(raw.file, MAX_PATH);
  if (!knownServers.has(serverId) || !file) return null;
  return {
    id: text(raw.id, 40) || newId('bak_'),
    serverId,
    file,
    sizeBytes: int(raw.sizeBytes, 0, 0, Number.MAX_SAFE_INTEGER),
    createdAt: stamp(raw.createdAt),
    reason: text(raw.reason, 40),
    note: text(raw.note, 200),
  };
}

function validateLibrary(input: unknown): Library {
  const raw = (input ?? {}) as { mods?: unknown; clusters?: unknown };
  const sourceMods = Array.isArray(raw.mods) ? raw.mods : [];
  const mods: SavedMod[] = servers
    .normaliseMods(sourceMods)
    .slice(0, MAX_LIBRARY)
    .map((mod) => {
      const source = (sourceMods.find(
        (entry) => entry && typeof entry === 'object' && String((entry as Partial<SavedMod>).id ?? '') === mod.id,
      ) ?? {}) as Partial<SavedMod>;
      return { ...mod, note: text(source.note, 200), addedAt: stamp(source.addedAt) };
    });

  const clusters: SavedCluster[] = [];
  for (const entry of Array.isArray(raw.clusters) ? raw.clusters : []) {
    const source = (typeof entry === 'string' ? { id: entry } : (entry ?? {})) as Partial<SavedCluster>;
    const id = cleanClusterId(source.id);
    if (!id || clusters.some((c) => c.id === id)) continue;
    clusters.push({ id, name: text(source.name, 60), note: text(source.note, 200), addedAt: stamp(source.addedAt) });
    if (clusters.length >= MAX_LIBRARY) break;
  }
  return { mods, clusters };
}

function validateSetup(input: unknown): SavedSetup | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  try {
    return {
      id: text(raw.id, 40) || newId('set_'),
      createdAt: stamp(raw.createdAt),
      updatedAt: stamp(raw.updatedAt),
      // The setup validator is the authority on what a bundle may contain.
      bundle: setupsCore.validateBundle(raw.bundle),
    };
  } catch {
    return null;
  }
}

/**
 * Settings out of an archive.
 *
 * The field-by-field rebuild lives in core/settings.ts so this and
 * `PUT /api/settings` can never drift apart — that endpoint used to have no
 * validation at all while this one did. Only the password hash is handled here,
 * because it is the one field an archive may legitimately carry and a browser
 * may not.
 */
function settingsFromArchive(input: unknown, current: AppSettings): AppSettings {
  const raw = (input ?? {}) as Record<string, unknown>;
  const merged = validateSettings(raw, current);
  const incoming = raw.passwordHash;
  merged.passwordHash = isHash(incoming) ? String(incoming) : '';
  return merged;
}

/**
 * Rebuild an archive from untrusted JSON. Anything unrecognised is dropped
 * rather than trusted — the same contract as a setup file, applied to a much
 * bigger document.
 */
export function validateArchive(input: unknown): ArchiveBundle {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('That does not look like an ASMS backup file.');
  }
  const raw = input as Record<string, unknown>;
  if (raw.kind === 'asms.setup') {
    throw new Error('That is a setup file, not a full backup. Import it under Presets & setups instead.');
  }
  if (raw.kind !== 'asms.archive') {
    throw new Error('That file is not an ASMS backup (its "kind" field is missing or wrong).');
  }
  const version = Number(raw.version);
  if (!Number.isFinite(version) || version < 1) throw new Error('That backup file has no usable version number.');
  if (version > ARCHIVE_VERSION) {
    throw new Error(`That backup was made by a newer ASMS (format ${version}). Update ASMS and try again.`);
  }

  const serverList: ServerInstance[] = [];
  for (const entry of Array.isArray(raw.servers) ? raw.servers.slice(0, MAX_SERVERS) : []) {
    const server = validateServer(entry);
    if (!server || serverList.some((s) => s.id === server.id)) continue;
    serverList.push(server);
  }
  const knownServers = new Set(serverList.map((s) => s.id));

  const schedules: ScheduleTask[] = [];
  for (const entry of Array.isArray(raw.schedules) ? raw.schedules.slice(0, MAX_SCHEDULES) : []) {
    const task = validateSchedule(entry, knownServers);
    if (task) schedules.push(task);
  }

  const backups: BackupEntry[] = [];
  for (const entry of Array.isArray(raw.backups) ? raw.backups.slice(0, MAX_SCHEDULES) : []) {
    const backup = validateBackup(entry, knownServers);
    if (backup && !backups.some((b) => b.id === backup.id)) backups.push(backup);
  }

  const setups: SavedSetup[] = [];
  for (const entry of Array.isArray(raw.setups) ? raw.setups.slice(0, MAX_SETUPS) : []) {
    const setup = validateSetup(entry);
    if (setup && !setups.some((s) => s.id === setup.id)) setups.push(setup);
  }

  const configs: Record<string, ServerConfigFiles> = {};
  const rawConfigs = raw.configs;
  if (rawConfigs && typeof rawConfigs === 'object' && !Array.isArray(rawConfigs)) {
    for (const [serverId, value] of Object.entries(rawConfigs as Record<string, unknown>)) {
      if (!knownServers.has(serverId) || !value || typeof value !== 'object') continue;
      const files = value as { gus?: unknown; game?: unknown };
      const gus = typeof files.gus === 'string' ? files.gus : '';
      const game = typeof files.game === 'string' ? files.game : '';
      if (gus.length > MAX_INI_BYTES || game.length > MAX_INI_BYTES) {
        throw new Error('That backup carries an INI file larger than 512 KB, which is not plausible.');
      }
      if (gus || game) configs[serverId] = { gus, game };
    }
  }

  return {
    kind: 'asms.archive',
    version: ARCHIVE_VERSION,
    exportedAt: stamp(raw.exportedAt),
    exportedBy: text(raw.exportedBy, 40) || 'unknown',
    host: text(raw.host, 60) || 'unknown',
    hasSecrets: bool(raw.hasSecrets, true),
    settings: settingsFromArchive(raw.settings, appSettings()),
    servers: serverList,
    schedules,
    backups,
    setups,
    library: validateLibrary(raw.library),
    configs,
  };
}

// --------------------------------------------------------------- summary

/** What is in this file, and what it would land on top of. */
export function summarise(bundle: ArchiveBundle): ArchiveSummary {
  const existing = data().servers;
  const warnings: string[] = [];

  const serverRows = bundle.servers.map((server) => {
    const sameId = existing.find((s) => s.id === server.id);
    const portClash = existing.find(
      (s) =>
        s.id !== server.id && (s.port === server.port || s.queryPort === server.queryPort || s.rconPort === server.rconPort),
    );
    return {
      id: server.id,
      name: server.name,
      map: server.map,
      installPath: server.installPath,
      mods: server.mods.length,
      hasConfig: Boolean(bundle.configs[server.id]),
      conflict: sameId ? `replaces "${sameId.name}"` : portClash ? `port clash with "${portClash.name}"` : '',
    };
  });

  if (!bundle.hasSecrets && bundle.servers.length) {
    warnings.push('This backup was exported without secrets — admin and join passwords will be blank after restoring.');
  }
  const missingInstalls = bundle.servers.filter((server) => server.installPath && !fs.existsSync(server.installPath));
  if (missingInstalls.length) {
    warnings.push(
      `${missingInstalls.length} of ${bundle.servers.length} install folders do not exist on this machine — restore first, then press Install on each.`,
    );
  }
  const liveBackups = bundle.backups.filter((entry) => fs.existsSync(entry.file)).length;
  if (bundle.backups.length && liveBackups < bundle.backups.length) {
    warnings.push(
      `${bundle.backups.length - liveBackups} backup zips listed in this file are not on this machine; those entries are skipped.`,
    );
  }

  return {
    exportedAt: bundle.exportedAt,
    exportedBy: bundle.exportedBy,
    host: bundle.host,
    hasSecrets: bundle.hasSecrets,
    counts: {
      servers: bundle.servers.length,
      schedules: bundle.schedules.length,
      setups: bundle.setups.length,
      mods: bundle.library.mods.length,
      clusters: bundle.library.clusters.length,
      backups: bundle.backups.length,
    },
    servers: serverRows,
    warnings,
  };
}

// -------------------------------------------------------------- importing

/**
 * Point a server at this machine's folders. Only the last part of the old path
 * is kept, so `D:\ASA\island` from another PC lands under whatever install
 * root is configured here.
 */
function rebase(server: ServerInstance): void {
  const cfg = appSettings();
  const leaf =
    path.basename(server.installPath.replace(/[\\/]+$/, '')) ||
    server.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
    'server';
  server.installPath = path.join(cfg.defaultInstallRoot, leaf);
  // Blank means "the default under the cluster root", which is what we want.
  server.clusterDir = '';
}

export function importArchive(
  bundle: ArchiveBundle,
  optionsInput: Partial<ArchiveImportOptions> = {},
): ArchiveImportResult {
  const parts = partsFrom(optionsInput.parts);
  const mode: 'merge' | 'replace' = optionsInput.mode === 'replace' ? 'replace' : 'merge';
  const rebasePaths = optionsInput.rebasePaths === true;

  // Every one of these fields is read at boot. Rewriting them under a running
  // server would leave the dashboard describing a process that no longer
  // matches it, so the answer is "stop them first" rather than a guess.
  const busy = data().servers.filter((server) => servers.runtime(server.id).state !== 'stopped');
  if (busy.length) {
    throw new Error(
      `Stop ${busy.map((s) => s.name).join(', ')} before restoring a backup — ASMS is about to rewrite what those servers are.`,
    );
  }

  const db = data();
  const applied: string[] = [];
  const warnings: string[] = [];
  let added = 0;
  let replaced = 0;
  let passwordChanged = false;

  if (parts.settings) {
    const keepLocal = rebasePaths ? LOCAL_FOLDER_KEYS.map((key) => [key, db.settings[key] as string] as const) : [];
    const previousHash = db.settings.passwordHash;
    /**
     * Where ASMS listens is a fact about this machine, not about the cluster
     * being restored. Carrying the other PC's bind address across is how a
     * restore ends with a dashboard that will not come back up on the next
     * start, long after the browser that did it has gone.
     */
    const localHost = db.settings.bindHost;
    const localPort = db.settings.port;

    db.settings = { ...db.settings, ...bundle.settings, bindHost: localHost, port: localPort };
    for (const [key, value] of keepLocal) (db.settings[key] as string) = value;

    if (db.settings.passwordHash !== previousHash) {
      passwordChanged = true;
      warnings.push(
        db.settings.passwordHash
          ? 'The dashboard password came from the backup — sign in with the password from the machine it was exported on. Everyone signed in here has been signed out.'
          : 'That backup had no dashboard password, so sign-in is now switched off. Set one under Settings → Access.',
      );
    }
    applied.push(rebasePaths ? "ASMS settings (this machine's folders kept)" : 'ASMS settings');
  }

  if (parts.servers) {
    if (mode === 'replace') {
      db.servers = [];
      db.schedules = [];
      db.backups = [];
    }

    for (const incoming of bundle.servers) {
      const server: ServerInstance = {
        ...incoming,
        mods: incoming.mods.map((mod) => ({ ...mod })),
        flags: { ...incoming.flags },
      };
      if (rebasePaths) rebase(server);

      const at = db.servers.findIndex((s) => s.id === server.id);
      if (at >= 0) {
        db.servers[at] = server;
        replaced += 1;
      } else {
        db.servers.push(server);
        added += 1;
      }

      const clash = db.servers.find(
        (other) =>
          other.id !== server.id &&
          (other.port === server.port || other.queryPort === server.queryPort || other.rconPort === server.rconPort),
      );
      if (clash) {
        warnings.push(`"${server.name}" and "${clash.name}" want the same ports — change one before starting both.`);
      }
    }
    if (added || replaced) applied.push(`${added + replaced} servers (${added} new, ${replaced} replaced)`);

    // The INI files are where every game setting actually lives, so a restore
    // without them would hand back servers running at default rates.
    let written = 0;
    for (const server of db.servers) {
      const files = bundle.configs[server.id];
      if (!files) continue;
      try {
        if (files.gus.trim()) config.writeRaw(server, 'gus', files.gus);
        if (files.game.trim()) config.writeRaw(server, 'game', files.game);
        // Ports and passwords belong to the record, not to the file just laid
        // down — this is also what fills them back in after a no-secrets export.
        config.syncIdentity(server);
        written += 1;
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        warnings.push(`Could not write the INI files for "${server.name}": ${why}`);
      }
    }
    if (written) applied.push(`INI files for ${written} server${written === 1 ? '' : 's'}`);

    let tasks = 0;
    for (const task of bundle.schedules) {
      if (!db.servers.some((s) => s.id === task.serverId)) continue;
      const duplicate = db.schedules.some(
        (t) => t.serverId === task.serverId && t.action === task.action && t.cron === task.cron && t.command === task.command,
      );
      if (duplicate) continue;
      // Through create() so nextRun is computed rather than restored stale.
      scheduler.create(task);
      tasks += 1;
    }
    if (tasks) applied.push(`${tasks} scheduled task${tasks === 1 ? '' : 's'}`);

    let restored = 0;
    for (const entry of bundle.backups) {
      if (!db.servers.some((s) => s.id === entry.serverId)) continue;
      if (db.backups.some((b) => b.id === entry.id || b.file === entry.file)) continue;
      // A listing for a zip that is not here would only fail on restore.
      if (!fs.existsSync(entry.file)) continue;
      db.backups.push(entry);
      restored += 1;
    }
    if (restored) applied.push(`${restored} backup${restored === 1 ? '' : 's'}`);
  }

  if (parts.library) {
    if (mode === 'replace') db.library = { mods: [], clusters: [] };
    for (const mod of bundle.library.mods) {
      const existing = db.library.mods.find((m) => m.id === mod.id);
      if (existing) {
        existing.name = mod.name || existing.name;
        existing.author = mod.author || existing.author;
        existing.url = mod.url || existing.url;
        existing.note = mod.note || existing.note;
      } else {
        db.library.mods.push(mod);
      }
    }
    for (const cluster of bundle.library.clusters) {
      if (!db.library.clusters.some((c) => c.id === cluster.id)) db.library.clusters.push(cluster);
    }
    // Cluster IDs that only exist on the imported servers are worth keeping too.
    for (const server of bundle.servers) {
      const id = server.clusterId.trim();
      if (id && !db.library.clusters.some((c) => c.id === id)) {
        db.library.clusters.push({ id, name: '', note: '', addedAt: Date.now() });
      }
    }
    applied.push(`${db.library.mods.length} mods and ${db.library.clusters.length} cluster IDs in the library`);
  }

  if (parts.setups) {
    if (mode === 'replace') db.setups = [];
    let stored = 0;
    for (const setup of bundle.setups) {
      if (db.setups.some((s) => s.id === setup.id)) continue;
      db.setups.push(setup);
      stored += 1;
    }
    if (stored) applied.push(`${stored} saved setup${stored === 1 ? '' : 's'}`);
  }

  save();
  // A password that arrived with the archive must not leave old sessions open:
  // they were authenticated against a password that no longer exists.
  if (passwordChanged) revokeAll();
  // New servers need runtimes, and replaced ones need their build id read
  // again from whatever is on this machine's disk.
  servers.resyncRuntimes();
  servers.scheduleUpdateCheck();
  scheduler.resetCache();
  bus.emitEvent('server:changed', { id: null });
  bus.emitEvent('schedule:changed', {});
  bus.emitEvent('backup:changed', { serverId: null });
  bus.emitEvent('setup:changed', {});
  bus.emitEvent('library:changed', {});

  log.info(`imported archive from ${bundle.host}: ${applied.join(', ') || 'nothing'}`);
  return { applied, warnings, servers: { added, replaced } };
}
