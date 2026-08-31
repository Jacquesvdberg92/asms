import { data, save } from '../lib/store.js';
import { bus } from '../lib/bus.js';
import { normaliseMods } from './servers.js';
import type { Library, SavedCluster, SavedMod } from '../types.js';

/**
 * The library is the answer to "what were those six mod IDs again?". It holds
 * nothing a server needs to run - it exists purely so setting up the *next*
 * server is a few clicks instead of a dig through Discord history.
 *
 * Everything in here is user-typed and ends up on a launch command line, so it
 * is validated on the way in exactly as strictly as a server's own mod list.
 */

const MAX_MODS = 300;
const MAX_CLUSTERS = 100;

function lib(): Library {
  const store = data();
  // A database written before the library existed.
  if (!store.library) store.library = { mods: [], clusters: [] };
  if (!Array.isArray(store.library.mods)) store.library.mods = [];
  if (!Array.isArray(store.library.clusters)) store.library.clusters = [];
  return store.library;
}

function text(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, max);
}

export function get(): Library {
  return lib();
}

function changed(): Library {
  save();
  bus.emitEvent('library:changed', {});
  return lib();
}

// -------------------------------------------------------------------- mods

/**
 * Reuses the server mod parser so a library entry can never carry an id ARK
 * would choke on, or a `javascript:` link pretending to be a mod page.
 */
function cleanMods(input: unknown): SavedMod[] {
  const now = Date.now();
  const source = Array.isArray(input) ? input : [];
  return normaliseMods(source).map((mod, i) => {
    const raw = (source[i] ?? {}) as Partial<SavedMod>;
    return {
      id: mod.id,
      name: mod.name,
      author: mod.author,
      url: mod.url,
      note: text(raw.note, 200),
      addedAt: typeof raw.addedAt === 'number' && raw.addedAt > 0 ? raw.addedAt : now,
    };
  });
}

/** Replaces the whole list — what the library editor saves. */
export function setMods(input: unknown): Library {
  lib().mods = cleanMods(input).slice(0, MAX_MODS);
  return changed();
}

/**
 * Adds without disturbing what is already there. Saving a server's mod list to
 * the library must never renumber or drop the entries already saved, so an id
 * that already exists only fills in blanks - a name learnt later is worth
 * keeping, a name overwritten with an empty string is not.
 */
export function addMods(input: unknown): Library {
  const current = lib().mods;
  for (const mod of cleanMods(input)) {
    const existing = current.find((m) => m.id === mod.id);
    if (existing) {
      existing.name = mod.name || existing.name;
      existing.author = mod.author || existing.author;
      existing.url = mod.url || existing.url;
      existing.note = mod.note || existing.note;
    } else if (current.length < MAX_MODS) {
      current.push(mod);
    }
  }
  return changed();
}

export function removeMod(id: string): Library {
  lib().mods = lib().mods.filter((mod) => mod.id !== String(id));
  return changed();
}

// ---------------------------------------------------------------- clusters

/** ARK passes this on the command line, so keep it to characters that survive. */
export function cleanClusterId(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '')
    .slice(0, 40);
}

function cleanClusters(input: unknown): SavedCluster[] {
  if (!Array.isArray(input)) return [];
  const out: SavedCluster[] = [];
  const now = Date.now();
  for (const raw of input) {
    const entry = (typeof raw === 'string' ? { id: raw } : (raw ?? {})) as Partial<SavedCluster>;
    const id = cleanClusterId(entry.id);
    if (!id || out.some((c) => c.id === id)) continue;
    out.push({
      id,
      name: text(entry.name, 60),
      note: text(entry.note, 200),
      addedAt: typeof entry.addedAt === 'number' && entry.addedAt > 0 ? entry.addedAt : now,
    });
    if (out.length >= MAX_CLUSTERS) break;
  }
  return out;
}

export function setClusters(input: unknown): Library {
  lib().clusters = cleanClusters(input);
  return changed();
}

export function addClusters(input: unknown): Library {
  const current = lib().clusters;
  for (const cluster of cleanClusters(input)) {
    const existing = current.find((c) => c.id === cluster.id);
    if (existing) {
      existing.name = cluster.name || existing.name;
      existing.note = cluster.note || existing.note;
    } else if (current.length < MAX_CLUSTERS) {
      current.push(cluster);
    }
  }
  return changed();
}

export function removeCluster(id: string): Library {
  const wanted = cleanClusterId(id);
  lib().clusters = lib().clusters.filter((cluster) => cluster.id !== wanted);
  return changed();
}

/**
 * Called whenever a server is given a cluster ID. Typing an ID once is enough
 * to have it offered on the next server, which is the whole point - a cluster
 * only works if every member spells it identically.
 */
export function rememberCluster(id: unknown): void {
  const wanted = cleanClusterId(id);
  if (!wanted) return;
  if (lib().clusters.some((cluster) => cluster.id === wanted)) return;
  if (lib().clusters.length >= MAX_CLUSTERS) return;
  lib().clusters.push({ id: wanted, name: '', note: '', addedAt: Date.now() });
  changed();
}
