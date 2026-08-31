// Mirror of the install-path length rules in apps/server/src/lib/paths.ts -
// keep in sync, wording included. Duplicated rather than fetched so the
// new-server wizard can warn as you type, before a folder exists to inspect.

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

const SEP = '\\';
const MOD_LEAF = 'ShooterGame-WindowsServer.utoc';

/**
 * The longest path ASA writes while unpacking a CurseForge mod:
 * `<root>\ShooterGame\Binaries\Win64\ShooterGame\Mods\83374\.temp\<ids>\<Mod>\Content\Paks\WindowsServer\<Mod>ShooterGame-WindowsServer.utoc`
 * The mod folder name lands in it twice, and `.temp` exists only during
 * extraction - which is why a server can look fine until the moment it tries to
 * add a mod.
 */
function deepestModPath(root: string, modFolder: string): string {
  return [
    root,
    'ShooterGame', 'Binaries', 'Win64', 'ShooterGame', 'Mods', '83374',
    '.temp',
    '9999999_99999999', // widest CurseForge <projectId>_<fileId> pair
    modFolder,
    'Content', 'Paks', 'WindowsServer',
    `${modFolder}${MOD_LEAF}`,
  ].join(SEP);
}

/** How far below the install root a mod of this name length ends up. */
function modPathOverhead(modNameLength: number): number {
  // Root is '', so the joined string already starts with the separator that
  // would follow a real root - the length is the overhead as-is.
  return deepestModPath('', 'M'.repeat(modNameLength)).length;
}

/** The longest install root that still lets a mod of this name length unpack. */
function rootBudget(modNameLength: number): number {
  const file = modPathOverhead(modNameLength);
  const dir = file - ('M'.repeat(modNameLength).length + MOD_LEAF.length + SEP.length);
  return Math.min(WIN_FILE_LIMIT - file, WIN_DIR_LIMIT - dir);
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
