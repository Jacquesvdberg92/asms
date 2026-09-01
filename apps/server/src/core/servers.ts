import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { data, save, id as newId, settings, ROOT } from '../lib/store.js';
import { ark, ensureDir, checkInstallPath, DATA_DIR, type InstallPathCheck } from '../lib/paths.js';
import { bus, notice } from '../lib/bus.js';
import { logger } from '../lib/log.js';
import { notFound } from '../api/errors.js';
import { announce } from '../lib/notify.js';
import {
  isAlive,
  killTree,
  sampleStats,
  findFreePort,
  canConnect,
  identify,
  sameProcess,
  shutdownProcTools,
  type ProcIdentity,
} from '../lib/proc.js';
import { getClient, dropClient, once } from '../lib/rcon.js';
import { installOrUpdate, installedBuildId, latestBuildId } from '../lib/steamcmd.js';
import { syncIdentity, readDoc } from './config.js';
import { getValue } from '../lib/ini.js';
import * as metrics from './metrics.js';
import { LAUNCH_FLAGS } from './catalog.js';
import type { LaunchFlags, ModEntry, PlayerEntry, ServerInstance, ServerRuntime, ServerState } from '../types.js';

const log = logger('servers');
const PID_DIR = path.join(DATA_DIR, 'pids');
const CONSOLE_LINES = 800;

const runtimes = new Map<string, ServerRuntime>();
const procs = new Map<string, ChildProcess>();
const consoles = new Map<string, string[]>();
const crashHistory = new Map<string, number[]>();
/** Cancels the "is it up yet" poll when a start is aborted. */
const startWatchers = new Map<string, NodeJS.Timeout>();
/** How far into each server's own log the readiness probe has read. */
const logCursors = new Map<string, number>();
/** The identity each running server was actually launched with. */
const launchedIdentity = new Map<string, string>();
/** Long operations the user can call off: a SteamCMD run, a restart countdown. */
const cancellers = new Map<string, () => void>();

export class Cancelled extends Error {
  constructor(what: string) {
    super(`${what} was cancelled`);
    this.name = 'Cancelled';
  }
}

// --------------------------------------------------------------- defaults

export function defaultFlags(): LaunchFlags {
  return {
    noBattlEye: false,
    crossplay: false,
    serverGameLog: true,
    includeTribeLogs: true,
    rconOutputTribeLogs: false,
    useDynamicConfig: false,
    noTransferFromFiltering: false,
    forceRespawnDinos: false,
    forceAllowCaveFlyers: false,
    noWildBabies: false,
    unstasisDinoObstruction: false,
    noAI: false,
    noDinos: false,
    disableCustomCosmetics: false,
    autoDestroyStructures: false,
    noHangDetection: false,
    stasisKeepControllers: false,
    alwaysTickDedicatedSkeletalMeshes: false,
    useServerNetSpeedCheck: false,
    noAntiSpeedHack: false,
    ignoreDupedItems: false,
    exclusiveJoin: false,
    pcOnlyServer: false,
    automanagedmods: false,
  };
}

function blankRuntime(id: string): ServerRuntime {
  return {
    id,
    state: 'stopped',
    pid: null,
    since: Date.now(),
    players: 0,
    playerList: [],
    cpu: 0,
    memMB: 0,
    buildId: null,
    rconConnected: false,
    progress: null,
    progressText: null,
    lastError: null,
    lastExitCode: null,
    updateAvailable: false,
    identityStale: false,
    pending: null,
  };
}

/** Register a cancellable operation and expose it on the runtime snapshot. */
function beginPending(id: string, kind: 'install' | 'countdown', label: string, cancel: () => void): void {
  cancellers.set(id, cancel);
  patchRuntime(id, { pending: { kind, label, startedAt: Date.now() } });
}

function endPending(id: string): void {
  cancellers.delete(id);
  patchRuntime(id, { pending: null });
}

/** Call off whatever long operation is running for this server. */
export function cancelPending(id: string): boolean {
  const cancel = cancellers.get(id);
  if (!cancel) return false;
  pushConsole(id, 'Cancelled by request.', 'sys');
  cancel();
  endPending(id);
  return true;
}

/** A sleep that a cancel can cut short. */
function sleepUntil(ms: number, signal: AbortSignal, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Cancelled(what));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Cancelled(what));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ----------------------------------------------------------------- lookups

export function list(): ServerInstance[] {
  return data().servers;
}

export function get(id: string): ServerInstance | undefined {
  return data().servers.find((s) => s.id === id);
}

export function need(id: string): ServerInstance {
  const server = get(id);
  if (!server) throw notFound(`No server with id ${id}`);
  return server;
}

export function runtime(id: string): ServerRuntime {
  let rt = runtimes.get(id);
  if (!rt) {
    rt = blankRuntime(id);
    runtimes.set(id, rt);
  }
  return rt;
}

export function runtimes_all(): ServerRuntime[] {
  return list().map((s) => runtime(s.id));
}

/**
 * Re-seed runtime state after the server list is rewritten wholesale - which
 * only an archive import does. Servers that arrived need a runtime and a build
 * id read from this machine's disk; servers that went need their console and
 * charts dropped rather than left behind as ghosts.
 */
export function resyncRuntimes(): void {
  for (const id of [...runtimes.keys()]) {
    if (get(id)) continue;
    runtimes.delete(id);
    consoles.delete(id);
    metrics.forget(id);
    dropClient(id);
  }
  for (const server of list()) {
    if (!runtimes.has(server.id)) runtimes.set(server.id, blankRuntime(server.id));
    refreshBuildId(server.id);
  }
}

function patchRuntime(id: string, patch: Partial<ServerRuntime>): void {
  const rt = runtime(id);
  if (patch.state && patch.state !== rt.state) patch.since = Date.now();
  Object.assign(rt, patch);
  bus.emitEvent('server:runtime', { id });
}

// ----------------------------------------------------------------- console

export function consoleLines(id: string): string[] {
  return consoles.get(id) ?? [];
}

function pushConsole(id: string, line: string, stream: 'out' | 'err' | 'sys' = 'out'): void {
  const buf = consoles.get(id) ?? [];
  const stamped = `${new Date().toLocaleTimeString()} ${line}`;
  buf.push(stamped);
  if (buf.length > CONSOLE_LINES) buf.splice(0, buf.length - CONSOLE_LINES);
  consoles.set(id, buf);
  bus.emitEvent('server:console', { id, line: stamped, stream });
}

export function clearConsole(id: string): void {
  consoles.set(id, []);
}

/**
 * These values are written into GameUserSettings.ini as `Key=Value` lines, so
 * a line break in one would inject whatever follows it as its own setting.
 *
 * A "?" used to be refused here too, back when passwords travelled in the
 * launch URL; buildLaunchPlan explains why they no longer do.
 */
const UNSAFE_IN_OPTION = /[\r\n]/;

const LAUNCH_FIELDS: Array<[keyof ServerInstance, string]> = [
  ['sessionName', 'Session name'],
  ['serverPassword', 'Join password'],
  ['adminPassword', 'Admin password'],
  ['spectatorPassword', 'Spectator password'],
  ['multihome', 'Multihome address'],
];

export function assertLaunchSafe(patch: Partial<ServerInstance>): void {
  for (const [key, label] of LAUNCH_FIELDS) {
    const value = patch[key];
    if (typeof value === 'string' && UNSAFE_IN_OPTION.test(value)) {
      throw new Error(
        `${label} cannot contain a line break — it is written as one line of GameUserSettings.ini, and everything after the break would become a separate setting.`,
      );
    }
  }
}

/**
 * A too-long install folder does not fail loudly - the server installs, boots
 * and runs, and only mod downloads die, deep in a log nobody reads. Catching it
 * at the point the path is chosen is the only place it is cheap to fix.
 */
export function assertInstallPathSafe(installPath: string | undefined): void {
  if (!installPath) return;
  const check = checkInstallPath(installPath);
  if (check.level === 'blocked') throw new Error(check.message ?? 'Install folder path is too long.');
}

/**
 * The identity ARK baked into the running process. Everything here is read at
 * boot only, so changing it in the dashboard has no effect until a restart -
 * and if we did not say so, a changed admin password would look like broken
 * admin commands.
 */
function identityOf(server: ServerInstance): string {
  const parts = [
    server.adminPassword,
    server.serverPassword,
    server.spectatorPassword,
    server.sessionName,
    server.rconEnabled ? 'rcon' : 'norcon',
    server.rconPort,
    server.port,
    server.queryPort,
  ].join('\u0000');
  // Hashed because this ends up in a file: the passwords need no second home.
  return crypto.createHash('sha256').update(parts).digest('hex');
}

/**
 * Does the config file the server booted from still say what ASMS says?
 *
 * Catches the cases the launch snapshot cannot: a server ASMS adopted rather
 * than started, and a value ARK mangled and wrote back on its last shutdown.
 */
function iniDisagrees(server: ServerInstance): boolean {
  try {
    const doc = readDoc(server, 'gus');
    const expected: Array<[string, string, string]> = [
      ['ServerSettings', 'ServerAdminPassword', server.adminPassword],
      ['ServerSettings', 'ServerPassword', server.serverPassword],
      ['SessionSettings', 'SessionName', server.sessionName || server.name],
    ];
    return expected.some(([section, key, want]) => (getValue(doc, section, key) ?? '') !== want);
  } catch {
    return false; // No readable INI yet is not evidence of anything.
  }
}

/** Flag the runtime when what is running no longer matches what is saved. */
function refreshIdentityDrift(id: string): void {
  const launched = launchedIdentity.get(id);
  const server = get(id);
  const state = runtime(id).state;
  const live = state === 'running' || state === 'starting' || state === 'stopping';
  const drifted = Boolean(launched && server && launched !== identityOf(server));
  const stale = Boolean(server && live && (drifted || iniDisagrees(server)));
  if (runtime(id).identityStale !== stale) patchRuntime(id, { identityStale: stale });
}

// -------------------------------------------------------------------- mods

/** Only http(s) survives: these end up as links in the browser. */
function safeUrl(value: unknown): string {
  const raw = String(value ?? '').trim().slice(0, 300);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

/**
 * Accepts every shape a mod list has ever arrived in - a bare id, a list of
 * ids saved by an older ASMS, or a full entry from a setup file - and returns
 * clean entries. Ids are the only part ARK sees, so they are the only part
 * validated strictly.
 */
export function normaliseMods(input: unknown): ModEntry[] {
  if (!Array.isArray(input)) return [];
  const out: ModEntry[] = [];
  for (const raw of input) {
    const entry = (typeof raw === 'string' || typeof raw === 'number' ? { id: String(raw) } : (raw ?? {})) as Partial<ModEntry>;
    const id = String(entry.id ?? '').trim();
    if (!/^\d{1,12}$/.test(id)) continue;
    if (out.some((m) => m.id === id)) continue;
    const text = (value: unknown, max: number) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
    out.push({
      id,
      name: text(entry.name, 80),
      author: text(entry.author, 60),
      url: safeUrl(entry.url),
      enabled: entry.enabled !== false,
    });
    if (out.length >= 250) break;
  }
  return out;
}

/**
 * ARK's fatal lines when -mods= names something it cannot mount.
 *
 * There are two different failures behind one symptom. "Requested mods failed
 * to load" is a mod that came down and would not mount; "Not all mods were
 * installed" is CurseForge never handing the file over in the first place, and
 * ARK follows it with `Mods not installed: <ids>`. Only the second one names
 * the mod, which is why it is worth matching separately.
 */
export const MODS_FAILED = /Requested mods failed to load|mods failed to load on server|Not all mods were installed|^\s*Mods not installed:/im;

/** `Mods not installed: 893657, 947033` — the ids CurseForge would not serve. */
const MODS_NOT_INSTALLED = /Mods not installed:\s*([\d,\s]+)/i;

/**
 * The ids ARK named as never installed, read out of its own complaint.
 *
 * This is the one message that says which mod is at fault, and it means
 * something quite specific: CurseForge returned nothing for that id against
 * ARK's game id. Retrying cannot change that - the id is wrong for ASA, or the
 * mod is flagged PC-only and this server also accepts consoles.
 */
export function rejectedModIds(lines: string[]): string[] {
  const out = new Set<string>();
  for (const line of lines) {
    const match = MODS_NOT_INSTALLED.exec(line);
    if (!match) continue;
    for (const id of match[1].split(',')) {
      const trimmed = id.trim();
      if (/^\d{1,12}$/.test(trimmed)) out.add(trimmed);
    }
  }
  return [...out];
}

/**
 * Lines worth keeping when a mod will not download. ARK buries these in a log
 * nobody reads, and each names a different cause - a directory Windows refused
 * to create, a file CurseForge no longer serves, a disk with nothing left. One
 * quoted line beats any amount of guessing, so they are collected as they go
 * past and shown with the diagnosis.
 */
const MOD_TROUBLE: RegExp[] = [
  /unable to create a directory/i,
  /Requested mods failed to load|mods failed to load on server/i,
  // CurseForge never served the file. ARK prints these four lines together and
  // every one of them carries part of the answer, including the two hints that
  // name the only two causes it knows of.
  /Not all mods were installed/i,
  /Mods not installed:/i,
  /Custom Cosmetics in the mod list/i,
  /pc-only mods on a cross-platform server/i,
  /\bmod\b[^.\n]{0,80}(?:failed|could not be|unable to)[^.\n]{0,80}(?:download|install|extract|load|mount)/i,
  /(?:download|extract|install)[^.\n]{0,50}\bmod\b[^.\n]{0,80}(?:fail|error)/i,
  /no space left|not enough space|disk (?:is )?full/i,
];

export function isModTrouble(line: string): boolean {
  return MOD_TROUBLE.some((re) => re.test(line));
}

/** Servers whose last run died because of a mod. */
const modFailures = new Set<string>();

/** The most recent complaints ARK made about mods, newest last, per server. */
const modTrouble = new Map<string, string[]>();

function noteModTrouble(id: string, line: string): void {
  const trimmed = line.trim().replace(/\s+/g, ' ').slice(0, 280);
  if (!trimmed) return;
  const kept = modTrouble.get(id) ?? [];
  // ARK repeats the same complaint once per retry; one copy carries the news.
  if (kept.includes(trimmed)) return;
  modTrouble.set(id, [...kept, trimmed].slice(-8));
}

/**
 * The same complaints, read out of ARK's own log rather than its stdout.
 *
 * Mod download errors often land only in ShooterGame.log, and a server that
 * failed before ASMS was restarted has no stdout left to search - so the tail
 * of the log is read on demand as well.
 */
function modTroubleFromLog(server: ServerInstance, bytes = 512 * 1024): string[] {
  const file = ark.serverLog(server.installPath);
  let text: string;
  try {
    const size = fs.statSync(file).size;
    const length = Math.min(size, bytes);
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      text = buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return []; // No log yet, or -servergamelog is switched off.
  }
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!isModTrouble(line)) continue;
    const trimmed = line.trim().replace(/\s+/g, ' ').slice(0, 280);
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out.slice(-8);
}

/** CurseForge's project id for ARK: Survival Ascended, used as a folder name. */
const CURSEFORGE_GAME_ID = '83374';

/**
 * The mod ids ASA has actually unpacked, and where it put them.
 *
 * Two layouts exist. SteamCMD puts each mod id straight under the root, while
 * CurseForge nests them one level further, under its own game id, and names the
 * folder `<projectId>_<fileId>`:
 *
 *   Mods/83374/929800_7739804/TG_Stack_1000_50/...
 *
 * Reading only the top level finds `83374` - which looks like a mod id, so the
 * scan stopped there and every real mod came back as "never downloaded".
 */
export interface FoundMod {
  id: string;
  /** Full path to the folder ARK unpacked it into. */
  folder: string;
  /** CurseForge's file id, when the folder name carries one. */
  fileId: string | null;
  /** Still in ARK's .temp staging folder — an extraction that never finished. */
  staging: boolean;
}

export function installedMods(server: ServerInstance): { root: string | null; ids: string[]; found: FoundMod[] } {
  const modFolders = (dir: string, staging = false): FoundMod[] => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: FoundMod[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // CurseForge appends _<fileId>, SteamCMD does not; both start with the id.
      const match = /^(\d{1,12})(?:_(\d{1,12}))?$/.exec(entry.name);
      if (!match) continue;
      out.push({ id: match[1], fileId: match[2] ?? null, folder: path.join(dir, entry.name), staging });
    }
    return out;
  };

  // A mods folder that exists but is empty still counts as somewhere to look:
  // "none of them downloaded" is a real answer, and a much more useful one than
  // "nothing to compare against".
  let empty: string | null = null;

  for (const root of ark.modRoots(server.installPath)) {
    if (empty === null && fs.existsSync(root)) empty = root;
    const top = modFolders(root);
    // The game id is a folder, not a mod - descend through it rather than
    // reporting it as one, and keep any sibling ids a mixed install left behind.
    const found = top.flatMap((entry) =>
      entry.id === CURSEFORGE_GAME_ID
        ? [
            ...modFolders(entry.folder),
            // Anything still under .temp is a download ARK never finished.
            ...modFolders(path.join(entry.folder, '.temp'), true),
          ]
        : [entry],
    );
    if (found.length) {
      // A finished unpack always wins over a .temp leftover of the same mod.
      const best = new Map<string, FoundMod>();
      for (const entry of found) {
        const existing = best.get(entry.id);
        if (!existing || (existing.staging && !entry.staging)) best.set(entry.id, entry);
      }
      return { root, ids: [...best.keys()], found: [...best.values()] };
    }
  }
  return { root: empty, ids: [], found: [] };
}

/**
 * How much actually landed in a mod folder.
 *
 * A folder on its own proves nothing: the failure that started all of this
 * leaves an empty directory behind, which the old check read as "downloaded"
 * and cleared the mod of any blame.
 */
function measureFolder(dir: string): { bytes: number; files: number; updatedAt: number | null } {
  let bytes = 0;
  let files = 0;
  let updatedAt: number | null = null;
  const walk = (at: string, depth: number): void => {
    if (depth > 8 || files > 5000) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          bytes += stat.size;
          files += 1;
          if (updatedAt === null || stat.mtimeMs > updatedAt) updatedAt = stat.mtimeMs;
        } catch {
          /* vanished mid-walk */
        }
      }
      if (files > 5000) return;
    }
  };
  walk(dir, 0);
  return { bytes, files, updatedAt };
}

/**
 * ok        — unpacked, with files in it
 * partial   — a folder exists but nothing usable is inside, or ARK left it
 *             half-extracted in .temp. This is what a mod that "downloaded"
 *             and still broke the server actually looks like on disk.
 * missing   — no folder at all
 * rejected  — no folder, and ARK named this id in "Mods not installed". A
 *             download that was never attempted rather than one that failed,
 *             so retrying it is the one thing that cannot help.
 * unknown   — no mods folder yet, so there is nothing to compare against
 */
export type ModStatus = 'ok' | 'partial' | 'missing' | 'rejected' | 'unknown';

export interface ModReport {
  id: string;
  name: string;
  enabled: boolean;
  /** null when ASMS cannot tell — no mods folder exists yet. */
  downloaded: boolean | null;
  status: ModStatus;
  /** Half-extracted in ARK’s .temp folder rather than unpacked beside it. */
  staging: boolean;
  /** Where ARK unpacked it, when it got that far. */
  folder: string | null;
  /** CurseForge's file id, which changes every time the mod updates. */
  fileId: string | null;
  sizeMB: number;
  files: number;
  updatedAt: number | null;
}

/**
 * "Requested mods failed to load on server" names no mod, which leaves people
 * bisecting a list of twelve numbers by hand. ARK downloads each mod into a
 * folder named after its id, so the ones missing a folder are the candidates.
 */
export interface ModDiagnosis {
  mods: ModReport[];
  root: string | null;
  lastRunFailed: boolean;
  verdict: string;
  /** What to do next, in the order worth trying. */
  advice: string[];
  /** ARK's own words about the failure, quoted from stdout and its log. */
  evidence: string[];
  /** Whether the install folder leaves ARK room to unpack mods at all. */
  pathCheck: InstallPathCheck;
}

/**
 * Diagnoses are cached, because working one out is not cheap.
 *
 * reportMods walks every mod folder with a statSync per file, capped at 5,000
 * files each, and reads half a megabyte off the tail of ShooterGame.log. With a
 * dozen mods that is tens of thousands of synchronous filesystem calls - and the
 * Mods tab polls it. Nothing else is served while it runs, so the answer is kept
 * for a few seconds and thrown away whenever something could have changed it.
 */
const modStatusCache = new Map<string, { at: number; value: ModDiagnosis }>();
const MOD_STATUS_TTL_MS = 8000;

export function forgetModStatus(id: string): void {
  modStatusCache.delete(id);
}

export function diagnoseMods(id: string, fresh = false): ModDiagnosis {
  const server = need(id);
  const cached = modStatusCache.get(id);
  if (!fresh && cached && Date.now() - cached.at < MOD_STATUS_TTL_MS) return cached.value;

  const evidence = [...(modTrouble.get(id) ?? [])];
  for (const line of modTroubleFromLog(server)) if (!evidence.includes(line)) evidence.push(line);
  const value = reportMods(server, modFailures.has(id), evidence);
  modStatusCache.set(id, { at: Date.now(), value });
  return value;
}

export function reportMods(server: ServerInstance, lastRunFailed = false, evidence: string[] = []): ModDiagnosis {
  const { root, found } = installedMods(server);
  const onDisk = new Map(found.map((entry) => [entry.id, entry]));
  const pathCheck = checkInstallPath(server.installPath);
  // Only believed about a mod that is also absent: the log tail can outlive the
  // failure it describes, and a mod sitting on disk has plainly since arrived.
  const rejected = new Set(rejectedModIds(evidence));

  const mods: ModReport[] = server.mods.map((mod) => {
    const entry = onDisk.get(mod.id);
    const size = entry ? measureFolder(entry.folder) : { bytes: 0, files: 0, updatedAt: null };
    // An empty folder is not a download. Neither is one still sitting in .temp.
    const status: ModStatus = entry
      ? entry.staging || size.bytes === 0
        ? 'partial'
        : 'ok'
      : // ARK naming the id beats having no folder to look in: it is the one
        // answer that does not depend on what did or did not land on disk.
        rejected.has(mod.id)
        ? 'rejected'
        : !root
          ? 'unknown'
          : 'missing';
    return {
      id: mod.id,
      name: mod.name || `Mod ${mod.id}`,
      enabled: mod.enabled,
      downloaded: status === 'unknown' ? null : status === 'ok',
      status,
      staging: Boolean(entry?.staging),
      folder: entry?.folder ?? null,
      fileId: entry?.fileId ?? null,
      sizeMB: Math.round((size.bytes / 1024 / 1024) * 10) / 10,
      files: size.files,
      updatedAt: size.updatedAt,
    };
  });

  const requested = mods.filter((m) => m.enabled);
  const missing = requested.filter((m) => m.status === 'missing');
  const refused = requested.filter((m) => m.status === 'rejected');
  const partial = requested.filter((m) => m.status === 'partial');
  const present = requested.filter((m) => m.status === 'ok');
  const broken = [...missing, ...refused, ...partial];
  const names = (list: ModReport[]) => list.map((m) => `${m.name} (${m.id})`).join(', ');
  const advice: string[] = [];

  let verdict: string;
  if (!requested.length) {
    verdict = 'No mods are switched on, so a mod cannot be what is stopping this server.';
  } else if (refused.length) {
    // Said first and said plainly, because every other branch ends in "try the
    // download again" and this is the one case where that is a waste of twenty
    // minutes: ARK asked CurseForge for the mod and CurseForge had nothing.
    verdict = `ARK refused ${refused.length === 1 ? names(refused) : `these: ${names(refused)}`} outright — it asked CurseForge for ${refused.length === 1 ? 'it' : 'them'} and got nothing back, then quit rather than start without ${refused.length === 1 ? 'it' : 'them'}. That is not a download that failed, it is one that was never possible, so re-downloading cannot fix it. ARK knows of two causes: the mod is flagged PC-only while this server also accepts consoles, or the id is not an ARK: Survival Ascended mod at all.`;
    for (const mod of refused) {
      advice.push(
        `Open https://www.curseforge.com/projects/${mod.id} — it redirects to whatever that id really is, so you can see at a glance whether it is the mod you meant${mod.name && !/^Mod \d+$/.test(mod.name) ? ` rather than ${mod.name}` : ''}. The number in a CurseForge URL is not the project id; the id is on the mod page under About.`,
      );
    }
    advice.push(
      'If the mod page says [PC Only], switch on “PC-only server” under Launch flags — that is the switch that makes CurseForge serve it. Console players can no longer join once it is on.',
    );
    advice.push(`Switching ${refused.length === 1 ? 'it' : 'them'} off gets the server up in the meantime.`);
  } else if (!root) {
    verdict =
      'ARK has not created a mods folder yet, so there is nothing to compare against. Press Download mods now and let it fetch them, then check again.';
    advice.push('Press Download mods now — it boots the server just far enough to pull every mod down, then shuts it again.');
  } else if (broken.length && pathCheck.level !== 'ok') {
    // A path this long explains every missing mod at once, so naming individual
    // mods here would send someone off disabling innocent ones.
    verdict = `${broken.length === 1 ? names(broken) + ' has' : broken.length + ' mods have'} not downloaded properly, and the install folder is the likely reason rather than the mods themselves. ${pathCheck.message} Moving this server to a shorter folder should bring ${broken.length === 1 ? 'it' : 'them'} back.`;
    advice.push(`Move this server to a shorter folder — ${pathCheck.over} character${pathCheck.over === 1 ? '' : 's'} shorter is enough. Backup & migrate does it without losing the saves.`);
    advice.push('Then press Force re-download on the affected mods so ARK fetches them again on the next start.');
  } else if (partial.length) {
    // Which half-download it is matters: one is an empty folder, the other is
    // an extraction ARK abandoned, and they read very differently on disk.
    const detail = partial
      .map(
        (m) =>
          `${m.name} (${m.id}) is half-downloaded - ${m.staging ? 'ARK extracted it into its .temp staging folder and never moved it into place' : 'the folder is there with nothing in it'}`,
      )
      .join('; ');
    verdict = `${detail}. ARK sees a folder either way, decides the mod is already there, and never tries again - so this repeats every start until the folder is cleared.${missing.length ? ` ${names(missing)} never downloaded at all.` : ''}`;
    advice.push(`Press Force re-download on ${partial.length === 1 ? names(partial) : 'each half-downloaded mod'} — it deletes the stale folder so ARK fetches the mod cleanly.`);
    advice.push('Then Download mods now, and watch it land before you start the server for real.');
  } else if (missing.length) {
    verdict =
      missing.length === 1
        ? `${names(missing)} never downloaded, so it is almost certainly the one ARK is refusing to load.`
        : `These never downloaded: ${names(missing)}.`;
    advice.push('Press Download mods now — most of the time a mod that missed one boot arrives on the next attempt.');
    advice.push(`If it still does not arrive, open the mod on CurseForge: an id that 404s is a mod that was deleted or made private, and no amount of retrying will fetch it.`);
    advice.push('Switching it off gets the server up in the meantime.');
  } else if (lastRunFailed) {
    verdict = `All ${present.length} mods are downloaded, so the failure is inside one of them rather than a missing file - a mod that does not support this ARK build, or two that conflict. Switch off the half you trust least and start again; the list halves each time.`;
    advice.push('Check each mod on CurseForge for a build newer than what is on disk — the file id in this list is the one you have.');
  } else {
    verdict = `All ${present.length} enabled mods are downloaded and present.`;
  }

  // Say it even when nothing has broken yet: the folder is easy to change now
  // and painful to change once a server has saves and players on it.
  if (pathCheck.level !== 'ok' && !verdict.includes(String(pathCheck.length))) {
    verdict = `${verdict} Worth knowing either way: ${pathCheck.message?.charAt(0).toLowerCase()}${pathCheck.message?.slice(1)}`;
  }

  return { mods, root, lastRunFailed, verdict, advice, evidence, pathCheck };
}

/**
 * What ARK's own refusal should have said.
 *
 * "Requested mods failed to load on server" names nothing, so this names the
 * mods that are actually not on disk and says what state they are in.
 */
export function modFailureMessage(server: ServerInstance): string {
  const diagnosis = reportMods(server, true, modTroubleFromLog(server));
  const broken = diagnosis.mods.filter((m) => m.enabled && m.status !== 'ok' && m.status !== 'unknown');
  if (!broken.length) {
    return 'A mod would not load. Every enabled mod is on disk, so one of them does not match this ARK build, or two of them conflict.';
  }
  const said = (m: ModReport): string =>
    m.status === 'partial'
      ? 'is only half-downloaded'
      : m.status === 'rejected'
        ? 'was refused by CurseForge, so it never downloaded'
        : 'never downloaded';
  const named = broken.map((m) => `${m.name} (${m.id}) ${said(m)}`).join(', ');
  return `A mod would not load: ${named}. Mods → Check mods has the fix.`;
}

// --------------------------------------------------------- forcing a download

/**
 * Delete what ARK unpacked for one mod, so the next boot fetches it again.
 *
 * This is the whole trick behind "force a download". ARK decides a mod is
 * present by looking for its folder, not by looking inside it - so a download
 * that died half way leaves a folder that stops it ever trying again. Removing
 * the folder is the only way to change its mind.
 */
export function clearModFiles(id: string, modId: string): { removed: string[] } {
  const server = need(id);
  if (!/^\d{1,12}$/.test(modId)) throw new Error(`${modId} is not a mod id`);
  const state = runtime(id).state;
  if (state !== 'stopped' && state !== 'crashed') {
    throw new Error(`Stop the server first — ARK holds its mod files open while it is ${state}`);
  }

  const installRoot = path.resolve(server.installPath);
  const removed: string[] = [];
  const remove = (target: string): void => {
    const full = path.resolve(target);
    // Never delete outside this server, and never anything but this mod's own
    // folder: the name must be the id, optionally with CurseForge's file id.
    if (!full.startsWith(installRoot + path.sep)) return;
    if (!new RegExp(`^${modId}(?:_\\d{1,12})?$`).test(path.basename(full))) return;
    if (!fs.existsSync(full)) return;
    fs.rmSync(full, { recursive: true, force: true });
    removed.push(full);
  };

  const siblings = (dir: string): string[] => {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && new RegExp(`^${modId}(?:_\\d{1,12})?$`).test(e.name))
        .map((e) => path.join(dir, e.name));
    } catch {
      return [];
    }
  };

  for (const root of ark.modRoots(server.installPath)) {
    for (const target of siblings(root)) remove(target);
    const game = path.join(root, CURSEFORGE_GAME_ID);
    for (const target of siblings(game)) remove(target);
    for (const target of siblings(path.join(game, '.temp'))) remove(target);
  }

  if (removed.length) {
    pushConsole(id, `Cleared ${removed.length} folder${removed.length === 1 ? '' : 's'} for mod ${modId} - ARK will download it again on the next start.`, 'sys');
  } else {
    pushConsole(id, `Nothing on disk for mod ${modId} - ARK will download it on the next start.`, 'sys');
  }
  return { removed };
}

/** How long a mod fetch is allowed to run before ASMS gives up on it. */
const MOD_FETCH_TIMEOUT_MS = 20 * 60_000;

/**
 * Boot the server purely to make it download its mods, then shut it down.
 *
 * ASA has no downloader of its own - the server executable is the only thing
 * that can fetch a CurseForge mod - so the only honest way to "force a
 * download" is to start it, watch the folders appear, and stop it again the
 * moment they all have. Which beats the alternative: starting the real server,
 * waiting ten minutes, and finding out from a crash that one mod is still
 * missing.
 */
export function assertCanDownloadMods(id: string): void {
  const server = need(id);
  const state = runtime(id).state;
  if (state !== 'stopped' && state !== 'crashed') throw new Error(`Server is ${state} - stop it first`);
  if (!isInstalled(server)) throw new Error('Server files are not installed yet - run Install first');
  if (!activeModIds(server).length) throw new Error('No mods are switched on, so there is nothing to download');
}

export async function downloadMods(id: string): Promise<ModDiagnosis> {
  assertCanDownloadMods(id);
  const server = need(id);
  const wanted = activeModIds(server);

  const plan = buildLaunchPlan(server);
  patchRuntime(id, { state: 'updating', progress: 0, progressText: `0 of ${wanted.length} mods on disk`, lastError: null });
  pushConsole(id, `--- Fetching ${wanted.length} mod${wanted.length === 1 ? '' : 's'} ---`, 'sys');
  pushConsole(id, 'The server starts, downloads its mods and is shut down again as soon as they are all on disk.', 'sys');
  modTrouble.delete(id);

  let settled = false;
  let cancelled = false;
  let failedOnMods = false;
  let child: ChildProcess | undefined;

  const stop = (): void => {
    const pid = child?.pid;
    if (!pid) return;
    void (async () => {
      await killTree(pid, false).catch(() => {});
      await sleep(5000);
      // ARK ignores a polite close when it has no window to close.
      if (isAlive(pid)) await killTree(pid, true).catch(() => {});
    })();
  };

  // Everything from the spawn on lives in the try: a server left saying
  // "updating" forever because something threw before the handler existed is
  // worse than the failure that caused it.
  try {
    child = spawn(plan.exe, plan.args, { cwd: plan.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const proc = child;
    // Recorded like a real start, so an ASMS restart mid-fetch reattaches to
    // the process instead of leaving it orphaned on the game port.
    void writePid(id, proc.pid ?? 0);
    beginPending(id, 'install', `Downloading mods for ${server.name}`, () => {
      cancelled = true;
      stop();
    });

    const onChunk = (stream: 'out' | 'err') => (buf: Buffer) => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        pushConsole(id, line, stream);
        if (isModTrouble(line)) noteModTrouble(id, line);
        if (MODS_FAILED.test(line)) failedOnMods = true;
      }
    };
    proc.stdout?.on('data', onChunk('out'));
    proc.stderr?.on('data', onChunk('err'));

    await new Promise<void>((resolve, reject) => {
      let last = -1;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(timer);
        fn();
      };

      const poll = setInterval(() => {
        const { found } = installedMods(server);
        const usable = new Set(
          found.filter((entry) => !entry.staging && measureFolder(entry.folder).bytes > 0).map((entry) => entry.id),
        );
        const have = wanted.filter((mod) => usable.has(mod)).length;
        if (have !== last) {
          last = have;
          patchRuntime(id, {
            progress: Math.round((have / wanted.length) * 100),
            progressText: `${have} of ${wanted.length} mods on disk`,
          });
          if (have) pushConsole(id, `${have} of ${wanted.length} mods downloaded.`, 'sys');
        }
        // Every mod is down: no reason to let it finish loading the world.
        if (have === wanted.length) finish(() => { stop(); resolve(); });
        // ARK has given up on one of them; nothing more will arrive.
        else if (failedOnMods) finish(() => { stop(); resolve(); });
      }, 2000);

      const timer = setTimeout(() => {
        finish(() => {
          pushConsole(id, 'Giving up on the mod download after 20 minutes.', 'err');
          stop();
          resolve();
        });
      }, MOD_FETCH_TIMEOUT_MS);

      proc.on('error', (err) => finish(() => reject(err)));
      // A server that exits on its own has either finished or fallen over; the
      // report that follows says which, so this is not an error either way.
      proc.on('exit', () => finish(resolve));
    });

    // Measuring folders ARK still has open reads half a mod as a whole one, so
    // wait for it to actually be gone before believing anything on disk.
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
      const timer = setTimeout(resolve, 45_000);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await sleep(1500);
    clearPid(id);
    endPending(id);
    patchRuntime(id, { state: 'stopped', progress: null, progressText: null, pid: null });

    const evidence = [...(modTrouble.get(id) ?? [])];
    for (const line of modTroubleFromLog(server)) if (!evidence.includes(line)) evidence.push(line);
    const diagnosis = reportMods(server, failedOnMods, evidence);
    const broken = diagnosis.mods.filter((m) => m.enabled && m.status !== 'ok');

    if (cancelled) {
      pushConsole(id, 'Mod download cancelled.', 'sys');
    } else if (!broken.length) {
      pushConsole(id, `--- All ${wanted.length} mods are on disk ---`, 'sys');
      announce('update', 'success', `${server.name}: mods downloaded`, `All ${wanted.length} mods are on disk. The server can start.`);
    } else {
      const message = broken.map((m) => `${m.name} (${m.id})`).join(', ');
      patchRuntime(id, { lastError: `Mods still missing after a download run: ${message}` });
      pushConsole(id, `--- Still missing: ${message} ---`, 'err');
      announce('update', 'error', `${server.name}: mods still missing`, `${message}. Mods → Check mods explains why.`);
    }
    return diagnosis;
  } catch (err) {
    stop();
    clearPid(id);
    endPending(id);
    const raw = err instanceof Error ? err.message : String(err);
    // "spawn UNKNOWN" is what Windows says when the file it was pointed at is
    // not a program it can run, which in practice means a broken install.
    const message = /spawn/i.test(raw)
      ? `${raw} — Windows would not run ${ark.exe(server.installPath)}. The server files look broken; Verify integrity on the Overview tab repairs that.`
      : raw;
    patchRuntime(id, { state: 'stopped', progress: null, progressText: null, lastError: message });
    pushConsole(id, `Mod download failed: ${message}`, 'err');
    throw err;
  }
}

/** The ids ARK is actually told to load, in order. */
export function activeModIds(server: ServerInstance): string[] {
  return server.mods.filter((mod) => mod.enabled).map((mod) => mod.id);
}

// ------------------------------------------------------------------- CRUD

export async function create(input: Partial<ServerInstance>): Promise<ServerInstance> {
  assertLaunchSafe(input);
  const cfg = settings();
  const taken = list().flatMap((s) => [s.port, s.port + 1, s.queryPort, s.rconPort]);
  const name = (input.name ?? 'New Server').trim();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server';
  // Checked after defaulting, because the default root is just as able to be too long.
  const installPath = input.installPath?.trim() || path.join(cfg.defaultInstallRoot, slug);
  assertInstallPathSafe(installPath);

  const server: ServerInstance = {
    id: newId('srv_'),
    name,
    map: input.map ?? 'TheIsland_WP',
    installPath,
    sessionName: input.sessionName?.trim() || name,
    serverPassword: input.serverPassword ?? '',
    adminPassword: input.adminPassword || newId().slice(0, 10),
    spectatorPassword: input.spectatorPassword ?? '',
    motd: input.motd ?? `Welcome to ${name}!`,
    port: input.port ?? (await findFreePort(7777, 'udp', taken)),
    queryPort: input.queryPort ?? (await findFreePort(27015, 'udp', taken)),
    rconPort: input.rconPort ?? (await findFreePort(27020, 'tcp', taken)),
    rconEnabled: input.rconEnabled ?? true,
    maxPlayers: input.maxPlayers ?? 70,
    multihome: input.multihome ?? '',
    clusterId: input.clusterId ?? '',
    clusterDir: input.clusterDir ?? '',
    mods: normaliseMods(input.mods),
    flags: { ...defaultFlags(), ...(input.flags ?? {}) },
    activeEvent: input.activeEvent ?? '',
    extraArgs: input.extraArgs ?? '',
    extraQuery: input.extraQuery ?? '',
    autoStart: input.autoStart ?? false,
    autoRestartOnCrash: input.autoRestartOnCrash ?? true,
    updateOnStart: input.updateOnStart ?? true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  data().servers.push(server);
  save();
  runtimes.set(server.id, blankRuntime(server.id));
  refreshBuildId(server.id);
  bus.emitEvent('server:changed', { id: server.id });
  return server;
}

export function update(id: string, patch: Partial<ServerInstance>): ServerInstance {
  const server = need(id);
  assertLaunchSafe(patch);
  if (patch.installPath !== undefined) assertInstallPathSafe(patch.installPath.trim());
  const { id: _ignored, createdAt: _created, ...rest } = patch;
  Object.assign(server, rest, { updatedAt: Date.now() });
  if (patch.flags) server.flags = { ...defaultFlags(), ...patch.flags };
  if (patch.mods) server.mods = normaliseMods(patch.mods);
  forgetModStatus(id);
  save();
  // Force a fresh RCON client if the endpoint or password moved.
  dropClient(id);
  refreshIdentityDrift(id);
  bus.emitEvent('server:changed', { id });
  return server;
}

/**
 * Is this folder safe to delete recursively?
 *
 * "Delete the files too" used to be guarded only by "the string is non-empty and
 * the path exists". installPath is free text on the server form, so a typo, a
 * paste, or an archive imported without rebasing could leave it pointing at a
 * drive root, a Steam library or a home directory - and one click removed it.
 */
export function assertSafeToDelete(installPath: string): void {
  const full = path.resolve(installPath);
  const parts = full.split(path.sep).filter(Boolean);
  const root = path.parse(full).root;

  if (full === root || parts.length < 2) {
    throw new Error(`Refusing to delete ${full} - that is a drive root, not a server folder.`);
  }
  for (const guarded of [os.homedir(), DATA_DIR, ROOT]) {
    const at = path.resolve(guarded);
    if (full === at) throw new Error(`Refusing to delete ${full} - that is not a server folder.`);
  }
  // The one positive signal that this really is an ASA install. A server that
  // was never installed has no files to delete anyway.
  const looksLikeArk = fs.existsSync(path.join(full, 'ShooterGame'));
  const underInstallRoot = full
    .toLowerCase()
    .startsWith(path.resolve(settings().defaultInstallRoot).toLowerCase() + path.sep);
  if (!looksLikeArk && !underInstallRoot) {
    throw new Error(
      `Refusing to delete ${full}: it has no ShooterGame folder and is not under the install root, so it does not look like an ARK server. Delete it by hand if that is really what you want.`,
    );
  }
}

export async function remove(id: string, deleteFiles = false): Promise<void> {
  const server = need(id);
  // Checked before anything is removed from the database, so a refusal leaves
  // the server exactly as it was rather than half-deleted.
  if (deleteFiles && server.installPath && fs.existsSync(server.installPath)) {
    assertSafeToDelete(server.installPath);
  }
  if (runtime(id).state !== 'stopped') await stop(id, { force: true });
  dropClient(id);
  const db = data();
  db.servers = db.servers.filter((s) => s.id !== id);
  db.schedules = db.schedules.filter((t) => t.serverId !== id);
  db.backups = db.backups.filter((b) => b.serverId !== id);
  save();
  runtimes.delete(id);
  consoles.delete(id);
  metrics.forget(id);
  forgetModStatus(id);
  if (deleteFiles && server.installPath && fs.existsSync(server.installPath)) {
    fs.rmSync(server.installPath, { recursive: true, force: true });
    log.info(`deleted server files at ${server.installPath}`);
  }
  bus.emitEvent('server:changed', { id: null });
}

// ------------------------------------------------------------ command line

export interface LaunchPlan {
  exe: string;
  args: string[];
  cwd: string;
  /** The full command as a copy-pasteable string, for the UI. */
  display: string;
}

export function buildLaunchPlan(server: ServerInstance): LaunchPlan {
  /**
   * Only numbers and fixed keywords go in the launch URL.
   *
   * Observed on a real server: `?ServerAdminPassword=1234?Port=7777?QueryPort=27015?RCONEnabled=True?RCONPort=27020`
   * produced a server whose admin password was the whole string from "1234"
   * onwards, which ARK then wrote back into GameUserSettings.ini on shutdown.
   * Everything else worked - players joined, RCON listened - but no admin
   * command was accepted anywhere, in game or over RCON.
   *
   * Names and passwords therefore travel in GameUserSettings.ini instead, where
   * syncIdentity() writes them before every launch and each value has a line of
   * its own. It also keeps the launch command free of secrets, so it is safe to
   * copy into a support thread.
   */
  const query: string[] = [server.map, 'listen'];
  query.push(`Port=${server.port}`);
  query.push(`QueryPort=${server.queryPort}`);
  if (server.rconEnabled) {
    query.push('RCONEnabled=True');
    query.push(`RCONPort=${server.rconPort}`);
  }
  if (server.multihome.trim()) query.push(`MultiHome=${server.multihome.trim()}`);
  // Whatever the user adds goes last, where it cannot eat anything of ours.
  for (const extra of server.extraQuery.split('?').map((s) => s.trim()).filter(Boolean)) query.push(extra);

  const args: string[] = [query.join('?')];
  // ASA reads the real slot count from this switch, not from ?MaxPlayers=.
  args.push(`-WinLiveMaxPlayers=${server.maxPlayers}`);
  args.push('-server', '-log');

  const modIds = activeModIds(server);
  if (modIds.length) args.push(`-mods=${modIds.join(',')}`);
  if (server.clusterId.trim()) {
    args.push(`-clusterid=${server.clusterId.trim()}`);
    const dir = server.clusterDir.trim() || path.join(settings().clusterRoot, server.clusterId.trim());
    ensureDir(dir);
    args.push(`-ClusterDirOverride=${dir}`);
  }

  for (const def of LAUNCH_FLAGS) {
    if (server.flags[def.key as keyof LaunchFlags]) args.push(def.arg);
  }
  if (server.activeEvent?.trim()) args.push(`-ActiveEvent=${server.activeEvent.trim()}`);
  for (const extra of server.extraArgs.split(/\s+/).filter(Boolean)) args.push(extra);

  const serverExe = ark.exe(server.installPath);

  // On Linux (and so in Docker) the ASA binary is a Windows executable, which
  // needs a Proton or Wine wrapper in front of it. Keeping that in settings
  // rather than in code means the launch command stays one visible string.
  const wrapper = settings().launchWrapper.trim().split(/\s+/).filter(Boolean);
  const exe = wrapper.length ? wrapper[0] : serverExe;
  const argv = wrapper.length ? [...wrapper.slice(1), serverExe, ...args] : args;

  return {
    exe,
    args: argv,
    cwd: ark.binDir(server.installPath),
    display: [`"${exe}"`, ...argv.map((a) => (a.includes(' ') ? `"${a}"` : a))].join(' '),
  };
}

export function isInstalled(server: ServerInstance): boolean {
  return fs.existsSync(ark.exe(server.installPath));
}

// ---------------------------------------------------------------- install

export async function installServer(id: string, validate = false): Promise<void> {
  const server = need(id);
  const rt = runtime(id);
  if (rt.state !== 'stopped') throw new Error('Stop the server before updating it');

  patchRuntime(id, { state: isInstalled(server) ? 'updating' : 'installing', progress: 0, progressText: 'Starting SteamCMD', lastError: null });
  pushConsole(id, `--- ${validate ? 'Validating' : 'Updating'} server files ---`, 'sys');

  try {
    await installOrUpdate({
      installPath: server.installPath,
      validate,
      onLine: (line) => {
        bus.emitEvent('steam:console', { id, line });
        pushConsole(id, line, 'sys');
      },
      onProgress: (pct, text) => {
        patchRuntime(id, { progress: pct >= 0 ? pct : runtime(id).progress, progressText: text });
      },
      onChild: (kill) => beginPending(id, 'install', validate ? 'Verifying files' : 'Downloading server files', kill),
    });
    endPending(id);
    patchRuntime(id, { state: 'stopped', progress: null, progressText: null });
    refreshBuildId(id);
    announce('update', 'success', `${server.name} updated`, `Build ${installedBuildId(server.installPath) ?? 'unknown'} is installed.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    endPending(id);
    patchRuntime(id, { state: 'stopped', progress: null, progressText: null, lastError: message });
    pushConsole(id, `SteamCMD failed: ${message}`, 'err');
    announce('update', 'error', `${server.name} update failed`, message);
    throw err;
  }
}

export function refreshBuildId(id: string): void {
  const server = get(id);
  if (!server) return;
  patchRuntime(id, { buildId: installedBuildId(server.installPath) });
}

export async function checkForUpdates(): Promise<{ latest: string | null; servers: Record<string, boolean> }> {
  const latest = await latestBuildId(true);
  const map: Record<string, boolean> = {};
  for (const server of list()) {
    const local = installedBuildId(server.installPath);
    const behind = !!latest && !!local && local !== latest;
    map[server.id] = behind;
    patchRuntime(server.id, { buildId: local, updateAvailable: behind });
    if (behind) {
      announce('update', 'info', `Update available for ${server.name}`, `Installed ${local}, Steam has ${latest}.`);
    }
  }
  return { latest, servers: map };
}

// ------------------------------------------------------------------ start

/**
 * Servers with a start already under way.
 *
 * The state check below is not enough on its own: `start` awaits before it sets
 * anything, so two calls landing together - a double-tap on a phone, the
 * auto-restart timer firing as somebody presses Start - both read "stopped" and
 * both go on to spawn. The second ARK loses the port bind but keeps running,
 * and only the last pid is remembered. This claim is synchronous, so the second
 * caller loses the race in the same tick it entered.
 */
const starting = new Set<string>();

export async function start(id: string): Promise<void> {
  const server = need(id);
  const rt = runtime(id);
  if (starting.has(id)) throw new Error('This server is already starting');
  if (rt.state !== 'stopped' && rt.state !== 'crashed') throw new Error(`Server is ${rt.state}`);
  if (!isInstalled(server)) throw new Error('Server files are not installed yet - run Install first');

  starting.add(id);
  try {
    await launch(id, server);
  } finally {
    starting.delete(id);
  }
}

async function launch(id: string, server: ServerInstance): Promise<void> {
  if (server.updateOnStart) {
    try {
      await installServer(id, false);
    } catch {
      pushConsole(id, 'Update failed, starting with the files already on disk.', 'err');
    }
  }

  syncIdentity(server);
  const plan = buildLaunchPlan(server);
  pushConsole(id, `--- Launching ---`, 'sys');
  pushConsole(id, plan.display, 'sys');

  patchRuntime(id, { state: 'starting', lastError: null, lastExitCode: null, players: 0, playerList: [] });
  try {
    logCursors.set(id, fs.statSync(ark.serverLog(server.installPath)).size);
  } catch {
    logCursors.set(id, 0);
  }

  const child = spawn(plan.exe, plan.args, {
    cwd: plan.cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    // On POSIX this makes the child a process group leader, which is what lets
    // killTree signal the whole group. Under a Proton wrapper the pid we hold
    // is the wrapper's, and killing only that leaves ARK on the game port.
    detached: process.platform !== 'win32',
  });
  procs.set(id, child);
  modFailures.delete(id);
  modTrouble.delete(id);
  forgetModStatus(id);
  patchRuntime(id, { pid: child.pid ?? null, identityStale: false });
  launchedIdentity.set(id, identityOf(server));
  void writePid(id, child.pid ?? 0);

  const onChunk = (stream: 'out' | 'err') => (buf: Buffer) => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      pushConsole(id, line, stream);
      if (READY_LINE.test(line)) {
        if (runtime(id).state === 'starting') markRunning(id);
      }
      if (isModTrouble(line)) noteModTrouble(id, line);
      // Only noted here. ARK spreads its refusal over several lines - the one
      // naming the mod comes last - so the message that names it is built once
      // the process is gone and the whole complaint is on record.
      if (MODS_FAILED.test(line)) modFailures.add(id);
    }
  };
  child.stdout?.on('data', onChunk('out'));
  child.stderr?.on('data', onChunk('err'));

  child.on('error', (err) => {
    pushConsole(id, `Failed to launch: ${err.message}`, 'err');
    patchRuntime(id, { state: 'crashed', lastError: err.message, pid: null });
  });

  child.on('exit', (code, signal) => {
    procs.delete(id);
    clearPid(id);
    launchedIdentity.delete(id);
    const wasState = runtime(id).state;
    const clean = wasState === 'stopping' || code === 0;
    patchRuntime(id, {
      state: clean ? 'stopped' : 'crashed',
      pid: null,
      players: 0,
      playerList: [],
      cpu: 0,
      memMB: 0,
      rconConnected: false,
      identityStale: false,
      lastExitCode: code,
    });
    dropClient(id);
    stopStartWatcher(id);
    pushConsole(id, `--- Process exited (code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''}) ---`, 'sys');
    if (clean) {
      announce('stop', 'info', `${server.name} stopped`, 'The server shut down cleanly.');
    } else {
      if (modFailures.has(id)) {
        const message = modFailureMessage(server);
        patchRuntime(id, { lastError: message });
        // Named in the console too, so it is there without opening a modal.
        pushConsole(id, message, 'err');
        announce('crash', 'error', `${server.name}: a mod would not load`, message);
      } else {
        announce('crash', 'error', `${server.name} crashed`, `Exit code ${code}. ${server.autoRestartOnCrash ? 'Auto-restart is armed.' : ''}`);
      }
      if (server.autoRestartOnCrash && !modFailures.has(id)) scheduleCrashRestart(id);
      else if (modFailures.has(id) && server.autoRestartOnCrash) {
        pushConsole(id, 'Not auto-restarting: the same mod would fail again. Fix the mod list first.', 'sys');
      }
    }
  });

  watchForReady(id);
  announce('start', 'info', `${server.name} starting`, `${server.map} on port ${server.port}.`);
}

function markRunning(id: string, because?: string): void {
  stopStartWatcher(id);
  patchRuntime(id, { state: 'running' });
  refreshIdentityDrift(id);
  if (because) pushConsole(id, `Server is up - ${because}.`, 'sys');
  const server = get(id);
  if (server) announce('start', 'success', `${server.name} is up`, `${server.map} - ${server.maxPlayers} slots on port ${server.port}.`);
}

/** The line ARK writes once the world is loaded and it is accepting players. */
export const READY_LINE = /completed startup|is now advertising for join|full startup/i;

/**
 * Read whatever the server has appended to its own log since the last look,
 * and say whether the startup banner is in it.
 *
 * The cursor starts at the log's size at launch, so a banner left over from a
 * previous boot can never make a still-loading server look ready.
 */
function logSaysReady(id: string, server: ServerInstance): boolean {
  const file = ark.serverLog(server.installPath);
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return false; // No log yet, or -servergamelog is off.
  }
  let cursor = logCursors.get(id) ?? 0;
  if (size < cursor) cursor = 0; // ARK started a fresh log for this run.
  if (size <= cursor) return false;

  const length = Math.min(size - cursor, 1024 * 1024);
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, cursor);
      // Leave a little overlap so a banner straddling two reads is still seen.
      logCursors.set(id, Math.max(cursor, cursor + length - 256));
      return READY_LINE.test(buffer.toString('utf8'));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * Decide when "starting" becomes "running".
 *
 * No single signal is dependable: ASA does not always put its startup banner on
 * stdout, RCON is optional and comes up minutes after the server is playable,
 * and a healthy server can be quiet on both. So three signals race - stdout
 * (handled at the spawn site), the server's own log, and an RCON round trip -
 * and if none of them ever arrives we stop pretending and say the server is up
 * anyway rather than leaving the dashboard on "Starting" forever.
 */
function watchForReady(id: string): void {
  stopStartWatcher(id);
  const started = Date.now();
  // Long enough for a first boot with mods; short when there is no RCON to wait on.
  const giveUpAfter = get(id)?.rconEnabled ? 20 * 60_000 : 8 * 60_000;

  const timer = setInterval(async () => {
    const rt = runtime(id);
    if (rt.state !== 'starting') return stopStartWatcher(id);
    const server = get(id);
    if (!server) return stopStartWatcher(id);

    // If the process is gone, the exit handler owns the state, not this probe.
    if (!procs.has(id) && !isAlive(rt.pid)) return stopStartWatcher(id);

    if (logSaysReady(id, server)) return markRunning(id, 'its log says startup finished');

    if (server.rconEnabled) {
      try {
        await rconExec(id, 'ListPlayers');
        return markRunning(id, 'RCON answered');
      } catch {
        /* not up yet */
      }
    }

    if (Date.now() - started > giveUpAfter) {
      const minutes = Math.round(giveUpAfter / 60_000);
      pushConsole(
        id,
        server.rconEnabled
          ? `No startup banner and no RCON reply after ${minutes} minutes, but the process is alive - treating it as running. If players cannot join, check the Logs tab.`
          : `RCON is off and no startup banner appeared within ${minutes} minutes - treating it as running. Turn RCON on for a reliable readiness check.`,
        'err',
      );
      markRunning(id);
    }
  }, 5000);
  startWatchers.set(id, timer);
}

function stopStartWatcher(id: string): void {
  const timer = startWatchers.get(id);
  if (timer) clearInterval(timer);
  startWatchers.delete(id);
}

function scheduleCrashRestart(id: string): void {
  const history = (crashHistory.get(id) ?? []).filter((t) => Date.now() - t < 30 * 60_000);
  history.push(Date.now());
  crashHistory.set(id, history);
  if (history.length > 5) {
    pushConsole(id, 'Five crashes in 30 minutes - auto-restart paused. Fix the cause and start manually.', 'err');
    const server = get(id);
    if (server) announce('crash', 'error', `${server.name}: auto-restart paused`, 'Five crashes within 30 minutes.');
    return;
  }
  pushConsole(id, 'Auto-restart in 15 seconds...', 'sys');
  setTimeout(() => {
    if (runtime(id).state === 'crashed') void start(id).catch((err) => pushConsole(id, `Auto-restart failed: ${err.message}`, 'err'));
  }, 15_000);
}

// ------------------------------------------------------------------- stop

export interface StopOptions {
  /** Skip the graceful SaveWorld + DoExit and kill immediately. */
  force?: boolean;
  /** Seconds to wait for a graceful exit before killing. */
  graceSeconds?: number;
  reason?: string;
}

export async function stop(id: string, opts: StopOptions = {}): Promise<void> {
  const server = need(id);
  const rt = runtime(id);
  const child = procs.get(id);
  if (!child && !isAlive(rt.pid)) {
    patchRuntime(id, { state: 'stopped', pid: null });
    return;
  }
  const grace = opts.graceSeconds ?? 120;
  patchRuntime(id, { state: 'stopping' });
  pushConsole(id, `--- Stopping${opts.reason ? ` (${opts.reason})` : ''} ---`, 'sys');
  stopStartWatcher(id);

  if (!opts.force && server.rconEnabled) {
    try {
      pushConsole(id, 'Saving world via RCON...', 'sys');
      await rconExec(id, 'SaveWorld');
      await rconExec(id, 'DoExit');
    } catch (err) {
      pushConsole(id, `Graceful shutdown over RCON failed (${(err as Error).message}) - falling back to terminate.`, 'err');
    }
  }

  const pid = rt.pid ?? child?.pid ?? 0;
  const deadline = Date.now() + grace * 1000;
  while (Date.now() < deadline && isAlive(pid)) {
    await sleep(1000);
  }
  if (isAlive(pid)) {
    pushConsole(id, 'Still running - terminating process tree.', 'sys');
    await killTree(pid, false);
    await sleep(5000);
    if (isAlive(pid)) await killTree(pid, true);
  }
  dropClient(id);
  patchRuntime(id, { state: 'stopped', pid: null, players: 0, playerList: [], cpu: 0, memMB: 0, rconConnected: false });
  clearPid(id);
}

export async function restart(id: string, opts: StopOptions = {}): Promise<void> {
  const rt = runtime(id);
  if (rt.state !== 'stopped' && rt.state !== 'crashed') await stop(id, { ...opts, reason: opts.reason ?? 'restart' });
  await sleep(3000);
  await start(id);
}

/**
 * Broadcast a countdown, then run `action`. Used by the scheduler and by the
 * UI. The whole countdown can be called off with cancelPending().
 */
export async function withWarnings(id: string, minutes: number[], action: () => Promise<void>, what = 'restart'): Promise<void> {
  const sorted = [...new Set(minutes)].filter((m) => m > 0).sort((a, b) => b - a);
  if (!sorted.length) return action();

  const controller = new AbortController();
  beginPending(id, 'countdown', `${what} in ${sorted[0]} min`, () => controller.abort());
  try {
    let previous = sorted[0];
    for (const m of sorted) {
      const wait = (previous - m) * 60_000;
      if (wait > 0) await sleepUntil(wait, controller.signal, `The ${what}`);
      previous = m;
      patchRuntime(id, { pending: { kind: 'countdown', label: `${what} in ${m} min`, startedAt: Date.now() } });
      await broadcast(id, `Server ${what} in ${m} minute${m === 1 ? '' : 's'}`).catch(() => {});
    }
    await sleepUntil(previous * 60_000, controller.signal, `The ${what}`);
    await broadcast(id, `Server ${what} now - back shortly!`).catch(() => {});
    endPending(id);
    await action();
  } catch (err) {
    endPending(id);
    if (err instanceof Cancelled) {
      pushConsole(id, `${what} cancelled - telling players.`, 'sys');
      await broadcast(id, `Scheduled ${what} cancelled.`).catch(() => {});
      return;
    }
    throw err;
  }
}

export async function broadcast(id: string, message: string): Promise<string> {
  return rconExec(id, `Broadcast ${message}`);
}

// ------------------------------------------------------------------- RCON

export async function rconExec(id: string, command: string): Promise<string> {
  const server = need(id);
  if (!server.rconEnabled) throw new Error('RCON is disabled for this server');
  const client = getClient(id, {
    host: server.multihome.trim() || '127.0.0.1',
    port: server.rconPort,
    password: server.adminPassword,
  });
  const wasConnected = client.connected;
  try {
    const result = await client.exec(command);
    if (!wasConnected) patchRuntime(id, { rconConnected: true });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/authentication failed/i.test(message) && runtime(id).identityStale) {
      throw new Error(
        'RCON rejected the admin password. It was changed after this server started, so the running server is still using the old one - restart the server to apply it.',
      );
    }
    throw err;
  }
}

const PLAYER_LINE = /^\s*(\d+)\.\s*(.+?),\s*([0-9a-fx]+)\s*$/i;

export function parsePlayers(text: string): PlayerEntry[] {
  if (/no players/i.test(text)) return [];
  const out: PlayerEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = PLAYER_LINE.exec(line.trim());
    if (m) out.push({ slot: Number(m[1]), name: m[2].trim(), id: m[3] });
  }
  return out;
}

export async function refreshPlayers(id: string): Promise<PlayerEntry[]> {
  const text = await rconExec(id, 'ListPlayers');
  const players = parsePlayers(text);
  patchRuntime(id, { players: players.length, playerList: players, rconConnected: true });
  return players;
}

// -------------------------------------------------------- RCON diagnosis

export interface RconCheck {
  name: string;
  status: 'ok' | 'bad' | 'warn' | 'skip';
  detail: string;
}

/** What ARK itself will read out of a launch URL for one option. */
export function optionFromUrl(url: string, key: string): string | undefined {
  for (const part of url.split('?').slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).toLowerCase() === key.toLowerCase()) return part.slice(eq + 1);
  }
  return undefined;
}

/**
 * "Wrong admin password" is the same message whether the password is wrong,
 * the server booted with a different one, or the value got cut short on the
 * command line. This walks every link in that chain and reports which one is
 * broken, rather than making somebody guess.
 */
export async function diagnoseRcon(id: string): Promise<{ checks: RconCheck[]; verdict: string }> {
  const server = need(id);
  const rt = runtime(id);
  const checks: RconCheck[] = [];
  const add = (name: string, status: RconCheck['status'], detail: string) => checks.push({ name, status, detail });
  const host = server.multihome.trim() || '127.0.0.1';

  const live = rt.state === 'running' || rt.state === 'starting';
  add(
    'Server process',
    live ? 'ok' : 'bad',
    live ? `Running as pid ${rt.pid ?? 'unknown'}.` : `The server is ${rt.state}. RCON only answers while it is running.`,
  );

  if (!server.rconEnabled) {
    add('RCON enabled', 'bad', 'RCON is switched off for this server, under Settings → Server & launch.');
    return { checks, verdict: 'RCON is disabled, so nothing can connect. Turn it on and restart the server.' };
  }
  add('RCON enabled', 'ok', `Port ${server.rconPort} on ${host}.`);

  const reachable = live ? await canConnect(host, server.rconPort) : false;
  add(
    'Port reachable',
    reachable ? 'ok' : live ? 'bad' : 'skip',
    reachable
      ? 'The port accepted a TCP connection.'
      : live
        ? `Nothing is listening on ${host}:${server.rconPort}. ARK opens RCON late in startup, so give it a few minutes - and check RCONPort in the launch command.`
        : 'Not checked while the server is down.',
  );

  // ARK mangles text values in the launch URL, so there should be nothing to
  // find here at all. If there is, that is the fault.
  const launched = optionFromUrl(buildLaunchPlan(server).args[0], 'ServerAdminPassword');
  add(
    'Password source',
    launched === undefined ? 'ok' : 'bad',
    launched === undefined
      ? 'GameUserSettings.ini, one value per line. ARK can glue the trailing launch options onto a password passed in the URL, so ASMS keeps them out of it.'
      : `The launch command is still carrying "${launched}", which ARK can mangle.`,
  );

  // What the server's own config file says - what it booted with.
  let iniPassword: string | undefined;
  try {
    iniPassword = getValue(readDoc(server, 'gus'), 'ServerSettings', 'ServerAdminPassword');
  } catch {
    iniPassword = undefined;
  }
  if (iniPassword === undefined) {
    add('Password in GameUserSettings.ini', 'warn', 'No ServerAdminPassword line found. ASMS writes one before every launch.');
  } else {
    const same = iniPassword === server.adminPassword;
    add(
      'Password in GameUserSettings.ini',
      same ? 'ok' : 'warn',
      same
        ? 'Matches the password saved in ASMS.'
        : `The file on disk says "${iniPassword}". ARK rewrites this file when it shuts down, so this is what the server last booted with.`,
    );
  }

  if (rt.identityStale) {
    add(
      'Changed since launch',
      'bad',
      'Passwords or ports were edited after this server started. ARK read the old ones at boot and keeps using them until a restart.',
    );
  }

  if (!live || !reachable) {
    return {
      checks,
      verdict: live
        ? 'RCON is not listening yet. Wait for startup to finish, then try again.'
        : 'The server is not running, so there is nothing to authenticate against.',
    };
  }

  let authed = false;
  let authError = '';
  try {
    await once({ host, port: server.rconPort, password: server.adminPassword }, 'ListPlayers');
    authed = true;
  } catch (err) {
    authError = err instanceof Error ? err.message : String(err);
  }
  add('Authentication', authed ? 'ok' : 'bad', authed ? 'The saved password was accepted.' : authError);

  if (authed) return { checks, verdict: 'RCON is working. Admin commands should go through.' };

  // The password is wrong - so find out which one is right.
  for (const [label, candidate] of [
    ['the launch command', launched ?? ''],
    ['GameUserSettings.ini', iniPassword ?? ''],
  ] as const) {
    if (!candidate || candidate === server.adminPassword) continue;
    try {
      await once({ host, port: server.rconPort, password: candidate }, 'ListPlayers');
      add(
        'Password the server is really using',
        'bad',
        candidate.startsWith(`${server.adminPassword}?`)
          ? `"${candidate}" — your password with the rest of the launch options glued onto it, which is an ARK parsing quirk ASMS now avoids.`
          : `"${candidate}", from ${label}.`,
      );
      // Three different causes, three different fixes. Suggesting the wrong
      // one here is worse than saying nothing.
      const swallowed = candidate.startsWith(`${server.adminPassword}?`);
      const fix = swallowed
        ? 'ARK glued the rest of the launch options onto the password. ASMS no longer puts passwords on the command line, so restarting this server fixes it for good.'
        : label === 'the launch command'
          ? 'The launch command should not be carrying a password at all — this looks like a stale build of ASMS.'
          : `Restart the server to apply the saved password, or set ASMS back to "${candidate}" to match what is running.`;
      return {
        checks,
        verdict: `The running server's admin password is "${candidate}", not the "${server.adminPassword}" ASMS has saved. ${fix}`,
      };
    } catch {
      /* not that one either */
    }
  }

  return {
    checks,
    verdict:
      'RCON is listening but rejected every password ASMS knows about. Something else changed it - check GameUserSettings.ini and the launch command, then restart the server.',
  };
}

// -------------------------------------------------------------- pid files

function pidFile(id: string): string {
  return path.join(PID_DIR, `${id}.pid`);
}

/**
 * Record a running server.
 *
 * Three lines: the pid, the identity hash it launched with, and a fingerprint
 * of the process itself. The third one is what makes the first trustworthy -
 * see adoptOrphans.
 */
async function writePid(id: string, pid: number): Promise<void> {
  ensureDir(PID_DIR);
  const server = get(id);
  const proc = pid ? await identify(pid) : null;
  const fingerprint = proc ? `${proc.name}|${proc.startedAt}` : '';
  fs.writeFileSync(pidFile(id), `${pid}\n${server ? identityOf(server) : ''}\n${fingerprint}`);
}

function clearPid(id: string): void {
  fs.rmSync(pidFile(id), { force: true });
}

function parseFingerprint(pid: number, line: string | undefined): ProcIdentity | null {
  if (!line?.trim()) return null;
  const [name, startedAt] = line.trim().split('|');
  return { pid, name: name ?? '', startedAt: Number(startedAt) || 0 };
}

/**
 * If ASMS was restarted while servers were running, pick them back up rather
 * than showing them as stopped or double-starting them.
 *
 * A pid on its own is not evidence. clearPid only runs on a clean exit, so a
 * power cut, a taskkill or an OOM leaves the file behind - and after the reboot
 * that follows, the OS has recycled that number onto something else entirely.
 * ASMS would then show a stopped server as running and, on Stop, taskkill /T /F
 * whatever now holds the number, and its children. So the recorded fingerprint
 * has to match the live process before the pid is believed.
 */
async function adoptOrphans(): Promise<void> {
  ensureDir(PID_DIR);
  for (const server of list()) {
    const file = pidFile(server.id);
    if (!fs.existsSync(file)) continue;
    const [pidLine, identity, fingerprint] = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const pid = Number(pidLine.trim());

    if (!isAlive(pid)) {
      fs.rmSync(file, { force: true });
      continue;
    }

    const recorded = parseFingerprint(pid, fingerprint);
    const live = await identify(pid);
    if (recorded && !sameProcess(recorded, live)) {
      log.warn(
        `pid ${pid} for ${server.name} now belongs to ${live?.name || 'another process'} - not adopting it. ` +
          'This is a stale pid file from an unclean shutdown.',
      );
      pushConsole(
        server.id,
        `Ignored a stale pid file: process ${pid} is no longer this server. ASMS will not touch it. Start the server when you are ready.`,
        'sys',
      );
      fs.rmSync(file, { force: true });
      continue;
    }
    if (!recorded) {
      // A pid file written by an older ASMS has no fingerprint to check.
      log.warn(`pid file for ${server.name} predates fingerprinting - adopting pid ${pid} on trust`);
    }

    // Knowing what it launched with survives an ASMS restart, so a password
    // changed in the meantime is still reported honestly.
    if (identity?.trim()) launchedIdentity.set(server.id, identity.trim());
    patchRuntime(server.id, { state: 'running', pid });
    refreshIdentityDrift(server.id);
    pushConsole(server.id, `Reattached to running server process (pid ${pid}).`, 'sys');
    log.info(`adopted running server ${server.name} (pid ${pid})`);
    // Rewrite so an old file gains a fingerprint for next time.
    await writePid(server.id, pid);
  }
}

// -------------------------------------------------------------- poll loops

let statsTimer: NodeJS.Timeout | null = null;
let playerTimer: NodeJS.Timeout | null = null;
let updateTimer: NodeJS.Timeout | null = null;

/** Guards against a slow poll overlapping the next tick of the same loop. */
let statsBusy = false;
let playersBusy = false;

function startLoops(): void {
  statsTimer = setInterval(async () => {
    if (statsBusy) return;
    statsBusy = true;
    try {
      const all = runtimes_all();
      const live = all.filter((r) => r.pid && (r.state === 'running' || r.state === 'starting'));
      if (live.length) {
        const stats = await sampleStats(live.map((r) => r.pid as number));
        for (const rt of live) {
          const s = stats.get(rt.pid as number);
          if (s) patchRuntime(rt.id, { cpu: s.cpu, memMB: s.memMB });
          else if (!isAlive(rt.pid)) patchRuntime(rt.id, { state: 'crashed', pid: null });
        }
      }
      // Sample every server, running or not - a flat zero line is the honest
      // shape for downtime, and it keeps every series on the same x-axis.
      for (const rt of runtimes_all()) {
        metrics.record(rt.id, { cpu: rt.cpu, memMB: rt.memMB, players: rt.players });
      }
    } catch (err) {
      log.warn('stats sample failed', err);
    } finally {
      statsBusy = false;
    }
  }, 5000);

  playerTimer = setInterval(async () => {
    if (playersBusy) return;
    playersBusy = true;
    try {
      for (const rt of runtimes_all()) {
        if (rt.state !== 'running') continue;
        try {
          await refreshPlayers(rt.id);
        } catch {
          patchRuntime(rt.id, { rconConnected: false });
        }
      }
    } finally {
      playersBusy = false;
    }
  }, 20_000);

  scheduleUpdateCheck();
}

export function scheduleUpdateCheck(): void {
  if (updateTimer) clearInterval(updateTimer);
  const minutes = settings().updateCheckInterval;
  if (!minutes) return;
  updateTimer = setInterval(() => void checkForUpdates().catch(() => {}), minutes * 60_000);
}

export async function init(): Promise<void> {
  for (const server of list()) {
    runtimes.set(server.id, blankRuntime(server.id));
    refreshBuildId(server.id);
    // Servers saved before this check existed can still be carrying a value
    // that breaks admin access, and the symptom gives no hint of the cause.
    try {
      assertLaunchSafe(server);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      log.warn(`${server.name}: ${why}`);
      pushConsole(server.id, `Configuration problem: ${why}`, 'err');
      notice(
        'warn',
        `${server.name} has an unusable name or password`,
        // Says what the check actually tests. It used to blame a question mark,
        // which has been legal since passwords stopped travelling in the launch
        // URL — sending people hunting for a character that was not the problem.
        'A line break in a name or password splits it into two settings in GameUserSettings.ini, so everything after the break is lost. Fix it under Settings, then restart the server.',
      );
    }
  }
  await adoptOrphans();
  startLoops();

  // Deliberately not awaited: the dashboard has to be usable while a queue of
  // servers takes several minutes to come up, and every step of it is visible
  // there anyway.
  void autoStartAll();
}

/**
 * What makes a reboot unattended: every server marked "Start with ASMS" comes
 * back on its own. They go up one at a time with a gap in between, because each
 * one is 30 GB of assets off the same disk - and with "Update before starting"
 * on, a SteamCMD run each - so launching four at once turns a two-minute boot
 * into a ten-minute thrash.
 */
async function autoStartAll(): Promise<void> {
  const queue = list().filter((server) => server.autoStart && runtime(server.id).state === 'stopped');
  if (!queue.length) return;

  const gap = Math.max(0, Math.round(settings().autoStartDelay ?? 0)) * 1000;
  log.info(`auto-starting ${queue.length} server${queue.length === 1 ? '' : 's'}`);

  for (const [i, queued] of queue.entries()) {
    if (i && gap) await sleep(gap);
    // Deleted, or started by hand while the queue was waiting.
    const server = get(queued.id);
    if (!server || runtime(server.id).state !== 'stopped') continue;
    log.info(`autostarting ${server.name}`);
    pushConsole(server.id, 'Auto-starting with ASMS.', 'sys');
    try {
      await start(server.id);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      log.error(`autostart failed for ${server.name}: ${why}`);
      pushConsole(server.id, `Auto-start failed: ${why}`, 'err');
      notice('warn', `${server.name} did not auto-start`, why);
    }
  }
}

export async function shutdown(): Promise<void> {
  if (statsTimer) clearInterval(statsTimer);
  if (playerTimer) clearInterval(playerTimer);
  if (updateTimer) clearInterval(updateTimer);
  for (const id of [...startWatchers.keys()]) stopStartWatcher(id);
  // Leave the game servers running; the pid files let us reattach on next boot.
  for (const [id] of procs) {
    const child = procs.get(id);
    child?.unref();
  }
  shutdownProcTools();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type { ServerState };
