import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { data, save, settings, id as newId } from '../lib/store.js';
import { ark, ensureDir } from '../lib/paths.js';
import { bus } from '../lib/bus.js';
import { logger } from '../lib/log.js';
import { announce } from '../lib/notify.js';
import { need, runtime } from './servers.js';
import type { BackupEntry } from '../types.js';

const log = logger('backups');

function serverBackupDir(serverName: string): string {
  const slug = serverName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server';
  return ensureDir(path.join(settings().backupRoot, slug));
}

export function list(serverId?: string): BackupEntry[] {
  const all = data().backups;
  const rows = serverId ? all.filter((b) => b.serverId === serverId) : all;
  return [...rows].sort((a, b) => b.createdAt - a.createdAt);
}

export function get(backupId: string): BackupEntry | undefined {
  return data().backups.find((b) => b.id === backupId);
}

/**
 * Zip SavedArks plus the two INIs. Saves are what actually hurt to lose, and
 * bundling the config means a restore brings back a matching ruleset.
 */
export async function create(serverId: string, reason = 'manual', note = ''): Promise<BackupEntry> {
  const server = need(serverId);
  const saves = ark.savedArks(server.installPath);
  if (!fs.existsSync(saves)) throw new Error('Nothing to back up yet - this server has no SavedArks folder');

  const zip = new AdmZip();
  zip.addLocalFolder(saves, 'SavedArks');
  const configDir = ark.configDir(server.installPath);
  if (fs.existsSync(configDir)) {
    for (const name of ['GameUserSettings.ini', 'Game.ini']) {
      const file = path.join(configDir, name);
      if (fs.existsSync(file)) zip.addLocalFile(file, 'Config');
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(serverBackupDir(server.name), `${server.map}_${stamp}_${reason}.zip`);
  await new Promise<void>((resolve, reject) => {
    zip.writeZip(file, (err) => (err ? reject(err) : resolve()));
  });

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
  log.info(`backup written: ${file}`);
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
  if (!entry) throw new Error('That backup no longer exists');
  const server = need(entry.serverId);
  if (runtime(server.id).state !== 'stopped') throw new Error('Stop the server before restoring a backup');
  if (!fs.existsSync(entry.file)) throw new Error(`Backup file is missing: ${entry.file}`);

  const saves = ark.savedArks(server.installPath);
  if (fs.existsSync(saves)) {
    await create(server.id, 'pre-restore', `Safety copy taken before restoring ${path.basename(entry.file)}`);
  }

  const zip = new AdmZip(entry.file);
  ensureDir(saves);
  ensureDir(ark.configDir(server.installPath));
  for (const zipEntry of zip.getEntries()) {
    if (zipEntry.isDirectory) continue;
    const name = zipEntry.entryName.replace(/\\/g, '/');
    if (name.startsWith('SavedArks/')) {
      zip.extractEntryTo(zipEntry, saves, false, true, false, name.slice('SavedArks/'.length));
    } else if (name.startsWith('Config/')) {
      zip.extractEntryTo(zipEntry, ark.configDir(server.installPath), false, true, false, name.slice('Config/'.length));
    }
  }
  bus.emitEvent('backup:changed', { serverId: server.id });
  announce('backup', 'success', `${server.name} restored`, `From ${path.basename(entry.file)}`);
}

/** Drop database rows whose zip file vanished, and adopt zips we do not know about. */
export function reconcile(): void {
  const db = data();
  const before = db.backups.length;
  db.backups = db.backups.filter((b) => fs.existsSync(b.file));
  if (db.backups.length !== before) {
    log.warn(`forgot ${before - db.backups.length} backup(s) whose files were deleted outside ASMS`);
    save();
  }
}
