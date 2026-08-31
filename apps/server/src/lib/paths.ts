import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root: <root>/apps/server/{src,dist}/lib -> up four. */
export const ROOT = path.resolve(here, '..', '..', '..', '..');
export const DATA_DIR = process.env.ASMS_DATA ? path.resolve(process.env.ASMS_DATA) : path.join(ROOT, 'data');
export const DB_FILE = path.join(DATA_DIR, 'asms.json');
export const LOG_DIR = path.join(DATA_DIR, 'logs');
export const TOOLS_DIR = path.join(DATA_DIR, 'tools');
export const STEAMCMD_DIR = path.join(TOOLS_DIR, 'steamcmd');
export const WEB_DIST = path.join(ROOT, 'apps', 'web', 'dist');

export function ensureDirs(): void {
  for (const dir of [DATA_DIR, LOG_DIR, TOOLS_DIR]) fs.mkdirSync(dir, { recursive: true });
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Paths inside an ARK: Survival Ascended server install. */
export const ark = {
  exe: (root: string) => path.join(root, 'ShooterGame', 'Binaries', 'Win64', 'ArkAscendedServer.exe'),
  binDir: (root: string) => path.join(root, 'ShooterGame', 'Binaries', 'Win64'),
  configDir: (root: string) => path.join(root, 'ShooterGame', 'Saved', 'Config', 'WindowsServer'),
  gameUserSettings: (root: string) => path.join(root, 'ShooterGame', 'Saved', 'Config', 'WindowsServer', 'GameUserSettings.ini'),
  gameIni: (root: string) => path.join(root, 'ShooterGame', 'Saved', 'Config', 'WindowsServer', 'Game.ini'),
  savedArks: (root: string) => path.join(root, 'ShooterGame', 'Saved', 'SavedArks'),
  logDir: (root: string) => path.join(root, 'ShooterGame', 'Saved', 'Logs'),
  serverLog: (root: string) => path.join(root, 'ShooterGame', 'Saved', 'Logs', 'ShooterGame.log'),
  /**
   * Where ASA unpacks mods. It has moved between builds and differs between a
   * CurseForge install and a SteamCMD one, so every known location is checked
   * and whichever exists wins.
   */
  modRoots: (root: string) => [
    path.join(root, 'ShooterGame', 'Binaries', 'Win64', 'ShooterGame', 'Mods'),
    path.join(root, 'ShooterGame', 'Content', 'Mods'),
    path.join(root, 'ShooterGame', 'Mods'),
  ],
  appManifest: (root: string) => path.join(root, 'steamapps', 'appmanifest_2430930.acf'),
};

/** Steam app id of the ASA dedicated server. */
export const ASA_APP_ID = '2430930';

// ------------------------------------------------------- install path length

/**
 * Windows will not create a directory at 248 characters or more, nor a file at
 * 260 or more, unless every program in the chain opts into long paths.
 * ArkAscendedServer.exe does not, and the machine-wide LongPathsEnabled switch
 * does not rescue it. The directory ceiling is the lower of the two because the
 * OS reserves twelve characters for an 8.3 name inside whatever it creates.
 */
export const WIN_DIR_LIMIT = 247;
export const WIN_FILE_LIMIT = 259;

/**
 * Mod folder name lengths to budget for. Measured from real CurseForge
 * installs: SuperSpyglassMod and TG_Stack_1000_50 are 16, BetterBreeding 14,
 * MPlus 5. ROOMY leaves headroom for the long ones.
 */
const TYPICAL_MOD_NAME = 16;
const ROOMY_MOD_NAME = 28;

/**
 * The longest path ASA writes while unpacking a CurseForge mod, built from the
 * real layout rather than counted, so it cannot drift. Two details do the
 * damage: the mod folder name appears twice, and `.temp` exists only during
 * extraction - which is why a server can look fine until the moment it tries to
 * add a mod.
 *
 * Reproduces on-disk paths exactly, e.g. for root `C:\ASA\servers\qwer` and
 * mod folder `TG_Stack_1000_50`.
 */
export function deepestModPath(root: string, modFolder: string): string {
  return path.win32.join(
    root,
    'ShooterGame', 'Binaries', 'Win64', 'ShooterGame', 'Mods', '83374',
    '.temp',
    '9999999_99999999', // widest CurseForge <projectId>_<fileId> pair
    modFolder,
    'Content', 'Paks', 'WindowsServer',
    `${modFolder}ShooterGame-WindowsServer.utoc`,
  );
}

/** How far below the install root a mod of this name length ends up. */
function modPathOverhead(modNameLength: number): number {
  const sentinel = 'R:';
  return deepestModPath(sentinel, 'M'.repeat(modNameLength)).length - sentinel.length;
}

/** The longest install root that still lets a mod of this name length unpack. */
function rootBudget(modNameLength: number): number {
  const sentinel = 'R:';
  const file = deepestModPath(sentinel, 'M'.repeat(modNameLength));
  return Math.min(
    WIN_FILE_LIMIT - (file.length - sentinel.length),
    WIN_DIR_LIMIT - (path.win32.dirname(file).length - sentinel.length),
  );
}

/** Root length above which even a modestly named mod cannot unpack. */
export const INSTALL_PATH_LIMIT = rootBudget(TYPICAL_MOD_NAME);
/** Root length below which any mod we would expect to see fits. */
export const INSTALL_PATH_SAFE = rootBudget(ROOMY_MOD_NAME);

export interface InstallPathCheck {
  path: string;
  length: number;
  /** ok: any mod fits. warn: long-named mods will fail. blocked: most will. */
  level: 'ok' | 'warn' | 'blocked';
  /** Characters that must come off before mods are safe again, 0 when they are. */
  over: number;
  /** Plain-language explanation, or null when there is nothing to say. */
  message: string | null;
}

/**
 * Judges an install root by how much room it leaves for mod extraction. The
 * string is measured as typed, the way ARK will use it - no resolving against
 * the current directory, so the web UI and the API agree on the same answer.
 */
export function checkInstallPath(input: string): InstallPathCheck {
  const trimmed = input.trim().replace(/[\\/]+$/, '');
  const length = trimmed.length;

  if (!trimmed || length <= INSTALL_PATH_SAFE) {
    return { path: trimmed, length, level: 'ok', over: 0, message: null };
  }

  const level = length > INSTALL_PATH_LIMIT ? 'blocked' : 'warn';
  const over = length - INSTALL_PATH_SAFE;
  const message =
    level === 'blocked'
      ? `This install folder is ${length} characters long, and ARK unpacks a mod around ${modPathOverhead(TYPICAL_MOD_NAME)} characters below it. Windows refuses to create a directory past ${WIN_DIR_LIMIT} characters, so mod downloads will die part-way with "Unable to create a directory" while the server itself installs, boots and runs perfectly. Use a folder of ${INSTALL_PATH_SAFE} characters or fewer - somewhere like C:\\ASA\\servers - and it will not come up again.`
      : `This install folder is ${length} characters long, which leaves little room for ARK to unpack mods. Mods with longer folder names will fail to download with "Unable to create a directory". Trimming ${over} character${over === 1 ? '' : 's'} off puts it back in the clear.`;

  return { path: trimmed, length, level, over, message };
}
