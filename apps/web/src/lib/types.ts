// Mirror of apps/server/src/types.ts - keep in sync.

import type { InstallPathCheck } from './paths';

export type { InstallPathCheck };

export type ServerState = 'stopped' | 'installing' | 'updating' | 'starting' | 'running' | 'stopping' | 'crashed';

export interface LaunchFlags {
  noBattlEye: boolean;
  crossplay: boolean;
  serverGameLog: boolean;
  includeTribeLogs: boolean;
  rconOutputTribeLogs: boolean;
  useDynamicConfig: boolean;
  noTransferFromFiltering: boolean;
  forceRespawnDinos: boolean;
  forceAllowCaveFlyers: boolean;
  noWildBabies: boolean;
  unstasisDinoObstruction: boolean;
  noAI: boolean;
  noDinos: boolean;
  disableCustomCosmetics: boolean;
  autoDestroyStructures: boolean;
  noHangDetection: boolean;
  stasisKeepControllers: boolean;
  alwaysTickDedicatedSkeletalMeshes: boolean;
  useServerNetSpeedCheck: boolean;
  noAntiSpeedHack: boolean;
  ignoreDupedItems: boolean;
  exclusiveJoin: boolean;
  automanagedmods: boolean;
}

export interface ModEntry {
  id: string;
  name: string;
  author: string;
  url: string;
  enabled: boolean;
}

export interface ServerInstance {
  id: string;
  name: string;
  map: string;
  installPath: string;
  sessionName: string;
  serverPassword: string;
  adminPassword: string;
  spectatorPassword: string;
  motd: string;
  port: number;
  queryPort: number;
  rconPort: number;
  rconEnabled: boolean;
  maxPlayers: number;
  multihome: string;
  clusterId: string;
  clusterDir: string;
  mods: ModEntry[];
  flags: LaunchFlags;
  activeEvent: string;
  extraArgs: string;
  extraQuery: string;
  autoStart: boolean;
  autoRestartOnCrash: boolean;
  updateOnStart: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PlayerEntry {
  slot: number;
  name: string;
  id: string;
}

export interface ServerRuntime {
  id: string;
  state: ServerState;
  pid: number | null;
  since: number;
  players: number;
  playerList: PlayerEntry[];
  cpu: number;
  memMB: number;
  buildId: string | null;
  rconConnected: boolean;
  progress: number | null;
  progressText: string | null;
  lastError: string | null;
  lastExitCode: number | null;
  updateAvailable: boolean;
  identityStale: boolean;
  pending: PendingAction | null;
}

export interface PendingAction {
  kind: 'install' | 'countdown';
  label: string;
  startedAt: number;
}

export interface BackupEntry {
  id: string;
  serverId: string;
  file: string;
  sizeBytes: number;
  createdAt: number;
  reason: string;
  note: string;
}

export type ScheduleAction = 'restart' | 'backup' | 'update' | 'stop' | 'start' | 'rcon';

export interface ScheduleTask {
  id: string;
  serverId: string;
  name: string;
  action: ScheduleAction;
  cron: string;
  enabled: boolean;
  warnMinutes: number[];
  command: string;
  lastRun: number | null;
  lastResult: string | null;
  nextRun: number | null;
}

export interface AppSettings {
  steamCmdPath: string;
  launchWrapper: string;
  defaultInstallRoot: string;
  backupRoot: string;
  clusterRoot: string;
  password: string;
  bindHost: string;
  port: number;
  updateCheckInterval: number;
  /** Seconds left between servers when ASMS auto-starts them on boot. */
  autoStartDelay: number;
  backupRetention: number;
  theme: string;
  accent: string;
  discordWebhook: string;
  notifyOn: string[];
  openBrowserOnStart: boolean;
}

export interface MapDef {
  code: string;
  name: string;
  official: boolean;
  note?: string;
}

export interface SettingDef {
  key: string;
  file: 'gus' | 'game';
  section: string;
  type: 'float' | 'int' | 'bool' | 'string' | 'text';
  default: string;
  label: string;
  group: string;
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  advanced?: boolean;
}

export interface RconCommandDef {
  cmd: string;
  args?: string;
  help: string;
  danger?: boolean;
}

export interface LaunchFlagDef {
  key: string;
  arg: string;
  label: string;
  group: string;
  help: string;
  recommended?: boolean;
  danger?: boolean;
}

export interface Catalog {
  maps: MapDef[];
  settings: SettingDef[];
  groups: string[];
  rconCommands: RconCommandDef[];
  launchFlags: LaunchFlagDef[];
  launchFlagGroups: string[];
  activeEvents: Array<{ id: string; label: string }>;
  presets: PresetDef[];
  appId: string;
}

export interface SystemInfo {
  hostname: string;
  addresses: string[];
  platform: string;
  cpuModel: string;
  cores: number;
  uptimeSeconds: number;
  memory: { totalMB: number; freeMB: number };
  nodeVersion: string;
  dataDir: string;
  /** Where the API is really listening — environment can override settings. */
  listen: { host: string; port: number; fromEnv: boolean };
  steamCmd: { installed: boolean; path: string };
}

export interface MetricPoint {
  t: number;
  cpu: number;
  memMB: number;
  players: number;
}

export interface LogFileInfo {
  name: string;
  sizeBytes: number;
  modifiedAt: number;
}

export interface Toast {
  id: number;
  level: 'info' | 'success' | 'warn' | 'error';
  title: string;
  body?: string;
}

export interface PresetDef {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  description: string;
  highlights: string[];
  values: Record<string, string>;
}

export interface SetupSchedule {
  name: string;
  action: ScheduleAction;
  cron: string;
  enabled: boolean;
  warnMinutes: number[];
  command: string;
}

export interface SetupBundle {
  kind: 'asms.setup';
  version: number;
  name: string;
  description: string;
  exportedAt: number;
  exportedBy: string;
  sourceServer: string;
  presetId: string;
  map: string;
  maxPlayers: number;
  mods: ModEntry[];
  flags: LaunchFlags;
  extraArgs: string;
  extraQuery: string;
  settings: Record<string, string>;
  rawIni: { gus: string; game: string } | null;
  schedules: SetupSchedule[];
}

export interface SetupParts {
  settings: boolean;
  mods: boolean;
  launch: boolean;
  rawIni: boolean;
  schedules: boolean;
}

export interface SavedSetup {
  id: string;
  createdAt: number;
  updatedAt: number;
  bundle: SetupBundle;
}

export interface ModReport {
  id: string;
  name: string;
  enabled: boolean;
  downloaded: boolean | null;
}

export interface ModDiagnosis {
  mods: ModReport[];
  root: string | null;
  lastRunFailed: boolean;
  verdict: string;
  pathCheck: InstallPathCheck;
}

export interface RconCheck {
  name: string;
  status: 'ok' | 'bad' | 'warn' | 'skip';
  detail: string;
}

// ----------------------------------------------------------------- library

/** A mod kept for re-use, independent of any server. */
export interface SavedMod {
  id: string;
  name: string;
  author: string;
  url: string;
  note: string;
  addedAt: number;
}

/** A cluster ID worth remembering, so joining one is a pick, not a retype. */
export interface SavedCluster {
  id: string;
  name: string;
  note: string;
  addedAt: number;
}

export interface Library {
  mods: SavedMod[];
  clusters: SavedCluster[];
}

// ----------------------------------------------------------------- archive

/** Everything ASMS knows, in one file. Carries secrets unless stripped. */
export interface ArchiveParts {
  servers: boolean;
  library: boolean;
  setups: boolean;
  settings: boolean;
}

export interface ArchiveSummary {
  exportedAt: number;
  exportedBy: string;
  host: string;
  hasSecrets: boolean;
  counts: { servers: number; schedules: number; setups: number; mods: number; clusters: number; backups: number };
  servers: Array<{
    id: string;
    name: string;
    map: string;
    installPath: string;
    mods: number;
    hasConfig: boolean;
    conflict: string;
  }>;
  warnings: string[];
}

export interface ArchiveImportResult {
  applied: string[];
  warnings: string[];
  servers: { added: number; replaced: number };
}
