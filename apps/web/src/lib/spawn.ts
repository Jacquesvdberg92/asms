// Mirror of apps/server/src/core/spawn.ts types - keep in sync.

export interface SpawnCreature {
  name: string;
  cls: string;
  group: string;
  saddle?: string;
  tags?: string;
  fav?: boolean;
  boss?: boolean;
}

export interface SpawnItem {
  name: string;
  gfi: string;
  /** Absent where the blueprint path could not be confirmed - GFI only. */
  path?: string;
  group: string;
  qty?: number;
  tags?: string;
}

export interface SpawnKitItem {
  gfi: string;
  qty: number;
  quality?: number;
}

export interface SpawnKit {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  items: SpawnKitItem[];
}

export interface SpawnSource {
  name: string;
  url: string;
  note: string;
}

export interface SpawnCatalog {
  creatures: SpawnCreature[];
  creatureGroups: string[];
  items: SpawnItem[];
  itemGroups: string[];
  kits: SpawnKit[];
  sources: SpawnSource[];
}

/**
 * Levels worth one press. 150 is the wild cap on default settings, 224 is what
 * a perfect tame reaches after its bonus levels, and the rest are the rungs
 * people actually ask for.
 */
export const LEVEL_PRESETS = [5, 30, 75, 150, 224, 300];

// ---------------------------------------------------------------- commands

/**
 * ARK's admin commands come in two dialects. Typed into the in-game console
 * they need a `cheat` prefix; sent down RCON they must not have one, because
 * the RCON session is already the admin. Everything below builds the bare
 * form, and `asConsole` puts the prefix back for the copy button.
 */
export function asConsole(command: string): string {
  return `cheat ${command}`;
}

/**
 * GMSummon drops a tamed, saddle-ready creature at the level you ask for.
 * Summon spawns a wild one and ignores level entirely - ARK rolls it from the
 * map's own spawn table - which is why the UI hides the level box for wild.
 */
export function summonCommand(cls: string, level: number, tamed: boolean): string {
  return tamed ? `GMSummon "${cls}" ${clampLevel(level)}` : `Summon ${cls}`;
}

/** GFI matches on a fragment of the class name and gives to whoever ran it. */
export function giveSelfCommand(gfi: string, qty: number, quality: number, blueprint: boolean): string {
  return `GFI ${gfi} ${Math.max(1, Math.round(qty))} ${clampQuality(quality)} ${blueprint ? 1 : 0}`;
}

/**
 * The only give that names its recipient, and the reason the Gear tab can work
 * without anyone typing in game. It wants the full blueprint path and the
 * player's internal UE4 id - not the platform id ListPlayers reports.
 */
export function givePlayerCommand(
  path: string,
  ue4Id: string,
  qty: number,
  quality: number,
  blueprint: boolean,
): string {
  return `GiveItemToPlayer ${ue4Id} "Blueprint'${path}'" ${Math.max(1, Math.round(qty))} ${clampQuality(quality)} ${blueprint ? 1 : 0}`;
}

export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(9999, Math.max(1, Math.round(level)));
}

export function clampQuality(quality: number): number {
  if (!Number.isFinite(quality)) return 0;
  return Math.min(100, Math.max(0, Math.round(quality)));
}

/** Dododex slugs are the creature name, lower case and hyphenated. */
export function dododexUrl(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `https://www.dododex.com/taming/${slug}`;
}

/** Turn a kit into the commands that deliver it, for the target in hand. */
export function kitCommands(
  kit: SpawnKit,
  items: SpawnItem[],
  target: { ue4Id: string } | null,
): Array<{ command: string; label: string; deliverable: boolean }> {
  const byGfi = new Map(items.map((i) => [i.gfi, i]));
  return kit.items.map((entry) => {
    const found = byGfi.get(entry.gfi);
    const label = found ? `${entry.qty} x ${found.name}` : `${entry.qty} x ${entry.gfi}`;
    if (target && found?.path) {
      return {
        command: givePlayerCommand(found.path, target.ue4Id, entry.qty, entry.quality ?? 0, false),
        label,
        deliverable: true,
      };
    }
    return { command: giveSelfCommand(entry.gfi, entry.qty, entry.quality ?? 0, false), label, deliverable: false };
  });
}
