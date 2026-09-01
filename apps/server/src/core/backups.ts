import fs from 'node:fs';
import path from 'node:path';
import { data, save, settings, id as newId } from '../lib/store.js';
import { ark, ensureDir } from '../lib/paths.js';
import { bus } from '../lib/bus.js';
import { logger } from '../lib/log.js';
import { announce } from '../lib/notify.js';
import { walkFolder, totalBytes, writeZip, extractZip, type ZipEntry } from '../lib/zip.js';
import { need, runtime, rconExec } from './servers.js';
import { notFound, conflict } from '../api/errors.js';
import type { BackupEntry } from '../types.js';

const log = logger('backups');

function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server';
}

function serverBackupDir(serverName: string): string {
  return ensureDir(path.join(settings().backupRoot, slugOf(serverName)));
}

export function list(serverId?: string): BackupEntry[] {
  const all = data().backups;
  const rows = serverId ? all.filter((b) => b.serverId === serverId) : all;
  return [...rows].sort((a, b) => b.createdAt - a.createdAt);
}

export function get(backupId: string): BackupEntry | undefined {
  return data().backups.find((b) => b.id === backupId);
}

/** Roughly how much room is left on the volume holding `dir`. */
function freeBytes(dir: string): number | null {
  try {
    const stat = fs.statfsSync(dir);
    return stat.bavail * stat.bsize;
  } catch {
    return null; // Not available on every platform; skip the check rather than guess.
  }
}

/**
 * Zip SavedArks plus the two INIs. Saves are what actually hurt to lose, and
 * bundling the config means a restore brings back a matching ruleset.
 *
 * The archive is streamed entry by entry, so a fifteen-gigabyte world costs one
 * file's worth of memory rather than all of it.
 */
export async function create(serverId: string, reason = 'manual', note = ''): Promise<BackupEntry> {
  const server = need(serverId);
  const saves = ark.savedArks(server.installPath);
  if (!fs.existsSync(saves)) throw new Error('Nothing to back up yet - this server has no SavedArks folder');

  /**
   * Ask a running server to flush first. Zipping underneath a live ARK captures
   * whatever was mid-write, which is exactly the backup you do not want to
   * discover is torn on the day you need it.
   */
  if (runtime(serverId).state === 'running' && server.rconEnabled) {
    try {
      await rconExec(serverId, 'SaveWorld');
    } catch (err) {
      log.warn(`could not SaveWorld before backing up ${server.name}:`, err);
    }
  }

  const entries: ZipEntry[] = walkFolder(saves, 'SavedArks');
  const configDir = ark.configDir(server.installPath);
  if (fs.existsSync(configDir)) {
    for (const name of ['GameUserSettings.ini', 'Game.ini']) {
      const file = path.join(configDir, name);
      if (fs.existsSync(file)) entries.push({ name: `Config/${name}`, file });
    }
  }
  if (!entries.length) throw new Error('The SavedArks folder is empty - there is nothing to back up yet');

  const dir = serverBackupDir(server.name);
  const raw = totalBytes(entries);
  const free = freeBytes(dir);
  // Saves compress to roughly half, but a backup that fills the disk is worse
  // than one that refuses, so budget for the pessimistic case.
  if (free !== null && free < raw * 0.6) {
    throw new Error(
      `Not enough room in ${dir}: this world is ${(raw / 1e9).toFixed(1)} GB and only ${(free / 1e9).toFixed(1)} GB is free. Free some space, or point the backup folder at a bigger drive under Settings.`,
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `${server.map}_${stamp}_${reason}.zip`);
  await writeZip(entries, file);

  const entry: BackupEntry = {
    id: newId('bak_'),
    serverId,
    file,
    sizeBytes: fs.statSync(file).size,
    createdAt: Date.now(),
    reason,
    note,
  };
  data().backups.push(entry);
  save();
  prune(serverId);
  bus.emitEvent('backup:changed', { serverId });
  announce('backup', 'success', `${server.name} backed up`, `${(entry.sizeBytes / 1024 / 1024).toFixed(1)} MB - ${reason}`);
  log.info(`backup written: ${file} (${entries.length} files)`);
  return entry;
}

/** Delete the oldest backups beyond the retention limit (manual ones included). */
export function prune(serverId: string): number {
  const keep = settings().backupRetention;
  if (!keep || keep < 1) return 0;
  const rows = list(serverId);
  const doomed = rows.slice(keep);
  for (const entry of doomed) remove(entry.id, true);
  if (doomed.length) bus.emitEvent('backup:changed', { serverId });
  return doomed.length;
}

export function remove(backupId: string, quiet = false): void {
  const entry = get(backupId);
  if (!entry) return;
  fs.rmSync(entry.file, { force: true });
  const db = data();
  db.backups = db.backups.filter((b) => b.id !== backupId);
  save();
  if (!quiet) bus.emitEvent('backup:changed', { serverId: entry.serverId });
}

/**
 * Restore a backup over the live save folder. Always takes a safety backup of
 * the current state first, so a mistaken restore is itself undoable.
 */
export async function restore(backupId: string): Promise<void> {
  const entry = get(backupId);
  if (!entry) throw notFound('That backup no longer exists');
  const server = need(entry.serverId);
  if (runtime(server.id).state !== 'stopped') throw conflict('Stop the server before restoring a backup');
  if (!fs.existsSync(entry.file)) throw new Error(`Backup file is missing: ${entry.file}`);

  const saves = ark.savedArks(server.installPath);
  if (fs.existsSync(saves)) {
    await create(server.id, 'pre-restore', `Safety copy taken before restoring ${path.basename(entry.file)}`);
  }

  ensureDir(saves);
  ensureDir(ark.configDir(server.installPath));

  // Two roots come out of one archive, so extraction runs twice with a filter
  // rather than once into a guessed common parent. extractZip refuses any entry
  // whose resolved path leaves the destination, whatever the name claims.
  const installRoot = path.resolve(server.installPath);
  await extractZip(entry.file, saves, {
    rename: (name) => (name.startsWith('SavedArks/') ? name.slice('SavedArks/'.length) : null),
  });
  await extractZip(entry.file, ark.configDir(installRoot), {
    rename: (name) => (name.startsWith('Config/') ? name.slice('Config/'.length) : null),
  });

  bus.emitEvent('backup:changed', { serverId: server.id });
  announce('backup', 'success', `${server.name} restored`, `From ${path.basename(entry.file)}`);
}

/**
 * Reconcile the database with what is actually in the backup folder.
 *
 * Both directions, which is what the name has always promised: rows whose zip
 * was deleted outside ASMS are dropped, and zips ASMS does not know about are
 * adopted. The second half is what makes "copy the backups folder to the new
 * PC" a supported move rather than a folder of files the dashboard cannot see.
 */
export function reconcile(): void {
  const db = data();

  const before = db.backups.length;
  db.backups = db.backups.filter((b) => fs.existsSync(b.file));
  const dropped = before - db.backups.length;
  if (dropped) log.warn(`forgot ${dropped} backup(s) whose files were deleted outside ASMS`);

  const known = new Set(db.backups.map((b) => path.resolve(b.file)));
  const bySlug = new Map(db.servers.map((s) => [slugOf(s.name), s.id]));
  let adopted = 0;

  const root = settings().backupRoot;
  let folders: fs.Dirent[];
  try {
    folders = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    folders = []; // No backup root yet - nothing to adopt.
  }

  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const serverId = bySlug.get(folder.name);
    if (!serverId) continue; // A folder for a server this ASMS does not have.
    const dir = path.join(root, folder.name);
    for (const name of fs.readdirSync(dir)) {
      if (!name.toLowerCase().endsWith('.zip')) continue;
      const file = path.join(dir, name);
      if (known.has(path.resolve(file))) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      // Filenames are <map>_<iso stamp>_<reason>.zip; fall back to the file's
      // own mtime when it was named by something other than ASMS.
      const parsed = /_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})_([a-z-]+)\.zip$/i.exec(name);
      const createdAt = parsed
        ? new Date(parsed[1].replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3') + 'Z').getTime()
        : stat.mtimeMs;
      db.backups.push({
        id: newId('bak_'),
        serverId,
        file,
        sizeBytes: stat.size,
        createdAt: Number.isFinite(createdAt) ? createdAt : stat.mtimeMs,
        reason: parsed?.[2] ?? 'adopted',
        note: 'Found in the backup folder on startup',
      });
      adopted += 1;
    }
  }

  if (adopted) log.info(`adopted ${adopted} backup zip(s) already in ${root}`);
  if (dropped || adopted) {
    save();
    bus.emitEvent('backup:changed', { serverId: null });
  }
}
