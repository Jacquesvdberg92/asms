import type { ArchiveParts } from './types';

/** What a full backup carries, in the order the dialog lists it. */
export const ARCHIVE_PART_LABELS: Array<{ key: keyof ArchiveParts; title: string; help: string }> = [
  {
    key: 'servers',
    title: 'Servers',
    help: 'Every server with its ports, passwords, mods, launch flags, both INI files, its schedules and its backup list.',
  },
  { key: 'library', title: 'Mod & cluster library', help: 'The mods and cluster IDs you keep re-using.' },
  { key: 'setups', title: 'Saved setups', help: 'The setup bundles saved under Presets & setups.' },
  {
    key: 'settings',
    title: 'ASMS settings',
    help: 'Folders, password, Discord webhook, update and backup policy, appearance.',
  },
];

export function defaultArchiveParts(): ArchiveParts {
  return { servers: true, library: true, setups: true, settings: true };
}

/** Mirrors core/archive.ts so the saved file is named the same either way. */
export function archiveFileName(bundle: { host?: string; exportedAt?: number }): string {
  const host = String(bundle.host ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'asms';
  const day = new Date(bundle.exportedAt ?? Date.now()).toISOString().slice(0, 10);
  return `asms-backup-${host}-${day}.asms-archive.json`;
}
