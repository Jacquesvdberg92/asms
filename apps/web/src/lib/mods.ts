import type { ModEntry } from './types';

const ID = /^\d{1,12}$/;

const blank = (id: string): ModEntry => ({ id, name: '', author: '', url: '', enabled: true });

/**
 * Reads the shapes people actually paste:
 *
 *   893657
 *   893657, 928567 941697
 *   Better Breeding,941697,https://www.curseforge.com/.../better-breeding
 *   Name,ID,URL;Name,ID,URL
 *   # a line opening with a hash is a note, and is skipped
 *
 * One entry per line or per semicolon; commas separate the fields within an
 * entry. Whichever field looks like an id is the id, so the column order in
 * someone else's export does not matter. Comment lines are what let an
 * exported list say what it is at the top and still paste straight back in.
 */
export function parseModList(text: string): ModEntry[] {
  const out: ModEntry[] = [];
  const add = (entry: ModEntry) => {
    if (!ID.test(entry.id) || out.some((m) => m.id === entry.id)) return;
    out.push(entry);
  };

  for (const chunk of text.split(/[;\n\r]+/)) {
    if (chunk.trim().startsWith('#')) continue;
    // A run of bare ids, however they happen to be separated.
    const tokens = chunk.split(/[\s,]+/).filter(Boolean);
    if (tokens.length && tokens.every((token) => ID.test(token))) {
      for (const token of tokens) add(blank(token));
      continue;
    }

    const fields = chunk.split(',').map((f) => f.trim()).filter(Boolean);
    if (!fields.length) continue;

    const id = fields.find((f) => ID.test(f));
    if (!id) continue;
    const url = fields.find((f) => /^https?:\/\//i.test(f)) ?? '';
    const words = fields.filter((f) => f !== id && f !== url);
    add({ id, name: words[0] ?? '', author: words[1] ?? '', url, enabled: true });
  }
  return out;
}

/** The format the "add manually" box accepts, so a list can round trip. */
export function formatModList(mods: ModEntry[]): string {
  return mods.map((mod) => [mod.name || `Mod ${mod.id}`, mod.id, mod.url].filter(Boolean).join(',')).join(';\n');
}

/**
 * CurseForge redirects a bare project id to the right page. Structural on
 * purpose: a mod on a server, a mod in the library and a mod inside a setup
 * are three different types that all point at the same page.
 */
export function modLink(mod: { id: string; url?: string }): string {
  return mod.url || `https://www.curseforge.com/projects/${mod.id}`;
}

export const modLabel = (mod: { id: string; name?: string }): string => mod.name || `Mod ${mod.id}`;

// ------------------------------------------------------------ finding mods

/** Where ASA mods actually live. One place, so a moved URL is one edit. */
export const CURSEFORGE_ASA = 'https://www.curseforge.com/ark-survival-ascended';

/**
 * CurseForge's browse page is a search with the filters in the query string,
 * and the short /mods and /maps aliases throw away any parameter you add to
 * them - so anything that needs a sort or a category is written the long way.
 */
const browse = (params: string) => `${CURSEFORGE_ASA}/search?class=mods&page=1&pageSize=20&${params}`;

export const MOD_SOURCES: Array<{ label: string; help: string; href: string }> = [
  {
    label: 'Browse all ASA mods',
    help: 'CurseForge is the only place ARK: Survival Ascended loads mods from - there is no Steam Workshop for ASA.',
    href: `${CURSEFORGE_ASA}/mods`,
  },
  {
    label: 'Most popular',
    help: 'What is being installed right now. A busy mod is a maintained mod, which is most of what matters on a server.',
    href: browse('sortBy=popularity'),
  },
  {
    label: 'Most downloaded',
    help: 'The established ones. Your players have probably already got half of them.',
    href: browse('sortBy=totalDownloads'),
  },
  {
    label: 'Maps & total conversions',
    help: 'These replace the map itself, so they go first in the load order - and a map mod wants a server of its own.',
    href: browse('sortBy=relevancy&categories=maps'),
  },
];

/** CurseForge's own search, for when you know the name but not the number. */
export function modSearchLink(query: string): string {
  return browse(`sortBy=relevancy&search=${encodeURIComponent(query.trim())}`);
}

/** True when the text is a bare project id, so the UI can stop guessing. */
export const looksLikeModId = (text: string): boolean => ID.test(text.trim());
