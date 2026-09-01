/**
 * Shared domain types. A trimmed copy lives at apps/web/src/lib/types.ts —
 * keep the two in sync when changing anything here.
 */

export type ServerState =
  | 'stopped'
  | 'installing'
  | 'updating'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'crashed';

/** Launch-time toggles rendered as switches in the UI. */
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
  pcOnlyServer: boolean;
  automanagedmods: boolean;
}

/**
 * One mod in the load order. ASMS only needs the id; the name, author and link
 * are there so a list of twelve numbers is still readable in six months, and
 * they travel with a setup so a friend gets the names too.
 */
export interface ModEntry {
  /** CurseForge project id — the only part ARK sees. */
  id: string;
  name: string;
  author: string;
  url: string;
  /** Off keeps it in the list but out of -mods=. */
  enabled: boolean;
}

export interface ServerInstance {
  id: string;
  name: string;
  /** Map code, e.g. TheIsland_WP */
  map: string;
  /** Root of the server install (contains ShooterGame/). */
  installPath: string;

  sessionName: string;
  serverPassword: string;
  adminPassword: string;
  spectatorPassword: string;
  /** Message of the day, written to GameUserSettings.ini. */
  motd: string;

  port: number;
  queryPort: number;
  rconPort: number;
  rconEnabled: boolean;
  maxPlayers: number;
  multihome: string;

  clusterId: string;
  clusterDir: string;

  /** Load order, top to bottom. Only the enabled ones reach -mods=. */
  mods: ModEntry[];
  flags: LaunchFlags;
  /** Seasonal event to run, as -ActiveEvent=. Empty for none. */
  activeEvent: string;
  /** Free-form args appended verbatim to the command line. */
  extraArgs: string;
  /** Free-form ?Key=Value query params appended to the map URL. */
  extraQuery: string;

  autoStart: boolean;
  autoRestartOnCrash: boolean;
  updateOnStart: boolean;

  createdAt: number;
  updatedAt: number;
}

export interface ServerRuntime {
  id: string;
  state: ServerState;
  pid: number | null;
  /** epoch ms the current state began */
  since: number;
  players: number;
  playerList: PlayerEntry[];
  cpu: number;
  memMB: number;
  buildId: string | null;
  rconConnected: boolean;
  /** 0-100 while installing/updating */
  progress: number | null;
  progressText: string | null;
  lastError: string | null;
  lastExitCode: number | null;
  updateAvailable: boolean;
  /** Passwords or ports were changed after this server was launched. */
  identityStale: boolean;
  /** A long-running operation the user is allowed to call off. */
  pending: PendingAction | null;
}

export interface PendingAction {
  kind: 'install' | 'countdown';
  label: string;
  startedAt: number;
}

export interface PlayerEntry {
  slot: number;
  name: string;
  /** EOS / platform id as reported by RCON */
  id: string;
}

export interface BackupEntry {
  id: string;
  serverId: string;
  file: string;
  sizeBytes: number;
  createdAt: number;
  /** manual | scheduled | pre-restore | pre-update */
  reason: string;
  note: string;
}

export type ScheduleAction = 'restart' | 'backup' | 'update' | 'stop' | 'start' | 'rcon';

export interface ScheduleTask {
  id: string;
  serverId: string;
  name: string;
  action: ScheduleAction;
  /** 5-field cron expression */
  cron: string;
  enabled: boolean;
  /** minutes before the action to start broadcasting warnings */
  warnMinutes: number[];
  /** payload for action === 'rcon' */
  command: string;
  lastRun: number | null;
  lastResult: string | null;
  nextRun: number | null;
}

export interface AppSettings {
  steamCmdPath: string;
  /** Prefixed to the server executable, e.g. a Proton wrapper on Linux. */
  launchWrapper: string;
  defaultInstallRoot: string;
  backupRoot: string;
  clusterRoot: string;
  /**
   * scrypt hash of the dashboard password, or empty to disable sign-in.
   * Never sent to a client — see core/settings.ts publicSettings().
   */
  passwordHash: string;
  bindHost: string;
  port: number;
  /** minutes; 0 disables */
  updateCheckInterval: number;
  /** Seconds left between servers when ASMS auto-starts them on boot. */
  autoStartDelay: number;
  backupRetention: number;
  accent: string;
  discordWebhook: string;
  notifyOn: string[];
  openBrowserOnStart: boolean;
}

// ----------------------------------------------------------------- library

/**
 * A mod worth keeping. Mod lists are the thing people rebuild by hand on every
 * new server - digging the same six project IDs out of a Discord again - so the
 * library remembers them once, with the names attached.
 */
export interface SavedMod {
  /** CurseForge project id — the only part ARK sees. */
  id: string;
  name: string;
  author: string;
  url: string;
  /** Free-form reminder: what it does, who asked for it. */
  note: string;
  addedAt: number;
}

/**
 * A cluster ID worth remembering. Every ID a server has actually used is
 * recorded automatically, so joining an existing cluster is a pick rather than
 * a retyping exercise — one typo and the transfer bank silently splits in two.
 */
export interface SavedCluster {
  id: string;
  /** Human label, e.g. "the crew's 2026 season". Falls back to the id. */
  name: string;
  note: string;
  addedAt: number;
}

export interface Library {
  mods: SavedMod[];
  clusters: SavedCluster[];
}

export interface DbShape {
  version: number;
  settings: AppSettings;
  servers: ServerInstance[];
  schedules: ScheduleTask[];
  backups: BackupEntry[];
  setups: SavedSetup[];
  library: Library;
}

// ------------------------------------------------------------------ setups

/** A schedule as it travels inside a setup: no ids, no run history. */
export interface SetupSchedule {
  name: string;
  action: ScheduleAction;
  cron: string;
  enabled: boolean;
  warnMinutes: number[];
  command: string;
}

/**
 * A shareable snapshot of how a server is set up: mods, launch flags and
 * every curated setting. Deliberately carries no passwords, ports, paths or
 * cluster ids, so a bundle is safe to hand to a friend verbatim.
 */
export interface SetupBundle {
  /** Marker so an unrelated .json is rejected with a sentence, not a stack. */
  kind: 'asms.setup';
  version: number;
  name: string;
  description: string;
  exportedAt: number;
  exportedBy: string;
  /** Name of the server it was captured from, for display only. */
  sourceServer: string;
  /** Preset it started from, when one was used. */
  presetId: string;
  /** Suggested map — applied when creating a server, never to an existing one. */
  map: string;
  maxPlayers: number;
  mods: ModEntry[];
  flags: LaunchFlags;
  extraArgs: string;
  extraQuery: string;
  /** file:section:key -> value, matching the settings catalogue. */
  settings: Record<string, string>;
  /** Verbatim INI text, passwords and ports stripped. Null unless asked for. */
  rawIni: { gus: string; game: string } | null;
  schedules: SetupSchedule[];
}

/** Which halves of a bundle to capture, or to apply. */
export interface SetupParts {
  settings: boolean;
  mods: boolean;
  launch: boolean;
  rawIni: boolean;
  schedules: boolean;
}

/** A bundle kept in ASMS's own database so it can be re-applied later. */
export interface SavedSetup {
  id: string;
  createdAt: number;
  updatedAt: number;
  bundle: SetupBundle;
}

// ----------------------------------------------------------------- archive

/** Both INI files of one server, verbatim. */
export interface ServerConfigFiles {
  gus: string;
  game: string;
}

/**
 * Everything ASMS knows, in one file. Unlike a setup bundle this is *not*
 * meant to be shared: it carries passwords, ports and paths on purpose, so
 * that restoring it on another machine gives back working servers rather than
 * a shape to fill in by hand.
 */
export interface ArchiveBundle {
  /** Marker so an unrelated .json is rejected with a sentence, not a stack. */
  kind: 'asms.archive';
  version: number;
  exportedAt: number;
  exportedBy: string;
  /** Machine it came from, so two archives are told apart at a glance. */
  host: string;
  /** False when passwords and the webhook were stripped on the way out. */
  hasSecrets: boolean;
  settings: AppSettings;
  servers: ServerInstance[];
  schedules: ScheduleTask[];
  /** Metadata only — the zip files themselves stay where they are. */
  backups: BackupEntry[];
  setups: SavedSetup[];
  library: Library;
  /** server id -> its two INI files, where they exist on disk. */
  configs: Record<string, ServerConfigFiles>;
}

/** Which halves of an archive to restore. */
export interface ArchiveParts {
  /** Servers, their INI files, their schedules and their backup entries. */
  servers: boolean;
  library: boolean;
  setups: boolean;
  /** ASMS's own settings: folders, password, notifications, appearance. */
  settings: boolean;
}

export interface ArchiveImportOptions {
  parts: ArchiveParts;
  /** merge keeps what is here already; replace wipes it first. */
  mode: 'merge' | 'replace';
  /** Put install and cluster folders under this machine's roots. */
  rebasePaths: boolean;
}

export interface ArchiveImportResult {
  applied: string[];
  warnings: string[];
  servers: { added: number; replaced: number };
}

/** What an uploaded archive contains, for the confirm dialog. */
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
    /** Empty unless this server already exists here, or clashes with one. */
    conflict: string;
  }>;
  warnings: string[];
}
