import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { data, save, id as newId, settings } from '../lib/store.js';
import { ark, ensureDir, checkInstallPath, DATA_DIR, type InstallPathCheck } from '../lib/paths.js';
import { bus, notice } from '../lib/bus.js';
import { logger } from '../lib/log.js';
import { announce } from '../lib/notify.js';
import { isAlive, killTree, sampleStats, findFreePort, canConnect } from '../lib/proc.js';
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
  if (!server) throw new Error(`No server with id ${id}`);
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

/** ARK's fatal line when -mods= names something it cannot mount. */
export const MODS_FAILED = /Requested mods failed to load|mods failed to load on server/i;

/** Servers whose last run died because of a mod. */
const modFailures = new Set<string>();

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
export function installedMods(server: ServerInstance): { root: string | null; ids: string[] } {
  const modIds = (dir: string): string[] => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isDirectory())
      // CurseForge appends _<fileId>, SteamCMD does not; both start with the id.
      .map((e) => /^(\d{1,12})(?:_\d{1,12})?$/.exec(e.name)?.[1])
      .filter((id): id is string => Boolean(id));
  };

  for (const root of ark.modRoots(server.installPath)) {
    const top = modIds(root);
    // The game id is a folder, not a mod - descend through it rather than
    // reporting it as one, and keep any sibling ids a mixed install left behind.
    const ids = top.flatMap((id) =>
      id === CURSEFORGE_GAME_ID ? modIds(path.join(root, CURSEFORGE_GAME_ID)) : [id],
    );
    if (ids.length) return { root, ids: [...new Set(ids)] };
  }
  return { root: null, ids: [] };
}

export interface ModReport {
  id: string;
  name: string;
  enabled: boolean;
  /** null when ASMS cannot tell — no mods folder exists yet. */
  downloaded: boolean | null;
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
  /** Whether the install folder leaves ARK room to unpack mods at all. */
  pathCheck: InstallPathCheck;
}

export function diagnoseMods(id: string): ModDiagnosis {
  return reportMods(need(id), modFailures.has(id));
}

export function reportMods(server: ServerInstance, lastRunFailed = false): ModDiagnosis {
  const { root, ids } = installedMods(server);
  const known = new Set(ids);
  const pathCheck = checkInstallPath(server.installPath);

  const mods: ModReport[] = server.mods.map((mod) => ({
    id: mod.id,
    name: mod.name || `Mod ${mod.id}`,
    enabled: mod.enabled,
    downloaded: root ? known.has(mod.id) : null,
  }));

  const requested = mods.filter((m) => m.enabled);
  const missing = requested.filter((m) => m.downloaded === false);
  const present = requested.filter((m) => m.downloaded === true);

  let verdict: string;
  if (!requested.length) {
    verdict = 'No mods are switched on, so a mod cannot be what is stopping this server.';
  } else if (!root) {
    verdict =
      'ARK has not created a mods folder yet, so there is nothing to compare against. Start the server once and let it download, then check again.';
  } else if (missing.length && pathCheck.level !== 'ok') {
    // A path this long explains every missing mod at once, so naming individual
    // mods here would send someone off disabling innocent ones.
    const names = missing.map((m) => `${m.name} (${m.id})`).join(', ');
    verdict = `${missing.length === 1 ? names + ' has' : missing.length + ' mods have'} not downloaded, and the install folder is the likely reason rather than the mods themselves. ${pathCheck.message} Moving this server to a shorter folder should bring ${missing.length === 1 ? 'it' : 'them'} back.`;
  } else if (missing.length) {
    const names = missing.map((m) => `${m.name} (${m.id})`).join(', ');
    verdict =
      missing.length === 1
        ? `${names} never downloaded, so it is almost certainly the one ARK is refusing to load. Switch it off to get the server up, then check the mod still exists on CurseForge.`
        : `These never downloaded: ${names}. Switch them off to get the server up, then add them back one at a time.`;
  } else if (lastRunFailed) {
    verdict = `All ${present.length} mods are downloaded, so the failure is inside one of them rather than a missing file - a mod that does not support this ARK build, or two that conflict. Switch off the half you trust least and start again; the list halves each time.`;
  } else {
    verdict = `All ${present.length} enabled mods are downloaded and present.`;
  }

  // Say it even when nothing has broken yet: the folder is easy to change now
  // and painful to change once a server has saves and players on it.
  if (pathCheck.level !== 'ok' && !verdict.includes(String(pathCheck.length))) {
    verdict = `${verdict} Worth knowing either way: ${pathCheck.message?.charAt(0).toLowerCase()}${pathCheck.message?.slice(1)}`;
  }

  return { mods, root, lastRunFailed, verdict, pathCheck };
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
  save();
  // Force a fresh RCON client if the endpoint or password moved.
  dropClient(id);
  refreshIdentityDrift(id);
  bus.emitEvent('server:changed', { id });
  return server;
}

export async function remove(id: string, deleteFiles = false): Promise<void> {
  const server = need(id);
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
  if (deleteFiles && server.installPath && fs.existsSync(server.installPath)) {
    fs.rmSync(server.installPath, { recursive: true, force: true });
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
  const wrapper = settings().launchWrapper.trim().split(/s+/).filter(Boolean);
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

export async function start(id: string): Promise<void> {
  const server = need(id);
  const rt = runtime(id);
  if (rt.state !== 'stopped' && rt.state !== 'crashed') throw new Error(`Server is ${rt.state}`);
  if (!isInstalled(server)) throw new Error('Server files are not installed yet - run Install first');

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
  });
  procs.set(id, child);
  modFailures.delete(id);
  patchRuntime(id, { pid: child.pid ?? null, identityStale: false });
  launchedIdentity.set(id, identityOf(server));
  writePid(id, child.pid ?? 0);

  const onChunk = (stream: 'out' | 'err') => (buf: Buffer) => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      pushConsole(id, line, stream);
      if (READY_LINE.test(line)) {
        if (runtime(id).state === 'starting') markRunning(id);
      }
      if (MODS_FAILED.test(line)) {
        modFailures.add(id);
        pushConsole(id, 'ARK refused to start because a mod would not load - see Mods → Check mods.', 'sys');
      }
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
        patchRuntime(id, { lastError: 'A mod would not load - ARK stopped before the world opened.' });
        announce(
          'crash',
          'error',
          `${server.name}: a mod would not load`,
          'ARK refused to start. Open the Mods tab and press Check mods - it names the ones that never downloaded.',
        );
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

function writePid(id: string, pid: number): void {
  ensureDir(PID_DIR);
  const server = get(id);
  fs.writeFileSync(pidFile(id), `${pid}
${server ? identityOf(server) : ''}`);
}

function clearPid(id: string): void {
  fs.rmSync(pidFile(id), { force: true });
}

/**
 * If ASMS was restarted while servers were running, pick them back up rather
 * than showing them as stopped or double-starting them.
 */
function adoptOrphans(): void {
  ensureDir(PID_DIR);
  for (const server of list()) {
    const file = pidFile(server.id);
    if (!fs.existsSync(file)) continue;
    const [pidLine, identity] = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const pid = Number(pidLine.trim());
    if (isAlive(pid)) {
      // Knowing what it launched with survives an ASMS restart, so a password
      // changed in the meantime is still reported honestly.
      if (identity?.trim()) launchedIdentity.set(server.id, identity.trim());
      patchRuntime(server.id, { state: 'running', pid });
      refreshIdentityDrift(server.id);
      pushConsole(server.id, `Reattached to running server process (pid ${pid}).`, 'sys');
      log.info(`adopted running server ${server.name} (pid ${pid})`);
    } else {
      fs.rmSync(file, { force: true });
    }
  }
}

// -------------------------------------------------------------- poll loops

let statsTimer: NodeJS.Timeout | null = null;
let playerTimer: NodeJS.Timeout | null = null;
let updateTimer: NodeJS.Timeout | null = null;

function startLoops(): void {
  statsTimer = setInterval(async () => {
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
  }, 5000);

  playerTimer = setInterval(async () => {
    for (const rt of runtimes_all()) {
      if (rt.state !== 'running') continue;
      try {
        await refreshPlayers(rt.id);
      } catch {
        patchRuntime(rt.id, { rconConnected: false });
      }
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
        `${server.name} has an unusable password`,
        'A question mark in a password or session name stops RCON and in-game admin from working. Fix it under Settings, then restart the server.',
      );
    }
  }
  adoptOrphans();
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
  // Leave the game servers running; the pid files let us reattach on next boot.
  for (const [id] of procs) {
    const child = procs.get(id);
    child?.unref();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type { ServerState };
