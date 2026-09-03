import type { ModEntry } from './types';
import { formatModList, modLabel, modLink } from './mods';

/**
 * The mod list on its own.
 *
 * The configuration archive (lib/archive.ts) carries mods too, but it carries
 * them buried in a file full of passwords and install paths — no use at all
 * when what you want is to hand someone the list, post it in Discord, or keep
 * a note of what a server was running before you changed it. So this writes
 * the same mods out in the three shapes people actually need:
 *
 *   asms      Name,ID,URL rows — the format ASMS's own paste boxes read back,
 *             so a list exported here goes straight into another server.
 *   ids       Bare project IDs, comma separated — what a launch line and every
 *             other server manager understands.
 *   markdown  Names, links and load order, for a post someone has to read.
 *
 * Only the markdown one is prose. The other two must survive a round trip
 * through parseModList, which is why the header is comment lines and nothing
 * else — parseModList skips those on the way back in.
 */
export type ModListFormat = 'asms' | 'ids' | 'markdown';

export const MOD_LIST_FORMATS: Array<{ id: ModListFormat; label: string; help: string }> = [
  {
    id: 'asms',
    label: 'ASMS list',
    help: 'Name, ID and link per row. Pastes straight back into any server’s Mods tab or into the library — this is the one to keep.',
  },
  {
    id: 'ids',
    label: 'Project IDs only',
    help: 'Just the numbers, comma separated. What a launch line wants, and what other server managers can read.',
  },
  {
    id: 'markdown',
    label: 'Markdown for a post',
    help: 'Names, links and load order written out for Discord, a forum or a README. For people to read, not for ASMS to import.',
  },
];

/** One source of mods: a server with its load order, or the library shelf. */
export interface ModGroup {
  /** Server name, or "Mod library". */
  title: string;
  /** Map name or similar — context for the heading, never for the parser. */
  sub: string;
  /** True when the order of these mods is a load order worth preserving. */
  ordered: boolean;
  mods: ModEntry[];
}

const day = (when: number) => new Date(when).toISOString().slice(0, 10);

/**
 * Every mod once, first appearance wins. A merged list cannot honour two load
 * orders at the same time, so it keeps the first one it saw and the UI says so
 * rather than pretending the result is ready to run.
 */
export function flattenGroups(groups: ModGroup[]): ModEntry[] {
  const out: ModEntry[] = [];
  for (const group of groups) {
    for (const mod of group.mods) {
      const seen = out.find((m) => m.id === mod.id);
      if (seen) {
        // A later group may know the name the first one was missing.
        if (!seen.name && mod.name) seen.name = mod.name;
        if (!seen.url && mod.url) seen.url = mod.url;
        continue;
      }
      out.push({ ...mod });
    }
  }
  return out;
}

function markdown(groups: ModGroup[], when: number): string {
  const flat = flattenGroups(groups);
  const lines = [
    '# ARK mod list',
    '',
    `${flat.length} mod${flat.length === 1 ? '' : 's'}, exported from ASMS on ${day(when)}.`,
  ];

  for (const group of groups) {
    lines.push('', `## ${group.title}${group.sub ? ` — ${group.sub}` : ''}`, '');
    if (!group.mods.length) {
      lines.push('_No mods._');
      continue;
    }
    group.mods.forEach((mod, index) => {
      const bullet = group.ordered ? `${index + 1}.` : '-';
      const off = mod.enabled ? '' : ' _(switched off)_';
      lines.push(`${bullet} [${modLabel(mod)}](${modLink(mod)}) — \`${mod.id}\`${off}`);
    });
    if (group.ordered && group.mods.length > 1) {
      lines.push('', '_Listed in load order._');
    }
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Build the file. `groups` is what to write; the header on the two importable
 * formats is comment lines only, so they still parse.
 */
export function buildModList(groups: ModGroup[], format: ModListFormat, when = Date.now()): string {
  if (format === 'markdown') return markdown(groups, when);

  const flat = flattenGroups(groups);
  const where = groups.length === 1 ? groups[0].title : `${groups.length} sources`;

  if (format === 'ids') {
    return [
      `# ARK mod IDs from ${where} — exported by ASMS on ${day(when)}`,
      '',
      flat.map((mod) => mod.id).join(','),
      '',
    ].join('\n');
  }

  return [
    `# ARK mod list from ${where} — exported by ASMS on ${day(when)}`,
    '# Paste the whole file into a server’s Mods tab under “Paste a whole list”.',
    '',
    formatModList(flat),
    '',
  ].join('\n');
}

export function modListFileName(scope: string, format: ModListFormat, when = Date.now()): string {
  const slug =
    scope
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'mods';
  return `asms-mods-${slug}-${day(when)}.${format === 'markdown' ? 'md' : 'txt'}`;
}
