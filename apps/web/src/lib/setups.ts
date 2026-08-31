import type { SavedSetup, SetupBundle, SetupParts } from './types';

export function defaultParts(): SetupParts {
  return { settings: true, mods: true, launch: true, rawIni: false, schedules: false };
}

export const PART_LABELS: Array<{ key: keyof SetupParts; title: string; help: string }> = [
  { key: 'settings', title: 'Game settings', help: 'Every curated rate, multiplier and switch from the Settings tab.' },
  { key: 'mods', title: 'Mods', help: 'The CurseForge project IDs and their load order.' },
  { key: 'launch', title: 'Launch flags & extras', help: 'Command-line switches, extra arguments and player slots.' },
  { key: 'schedules', title: 'Scheduled tasks', help: 'Restart, backup and update jobs. Added alongside any you already have.' },
  { key: 'rawIni', title: 'Raw INI files (advanced)', help: 'Both INI files verbatim, minus passwords and ports. Replaces the target files entirely.' },
];

/** One line describing what is actually inside a bundle. */
export function summarise(bundle: SetupBundle): string {
  const bits: string[] = [];
  const settings = Object.keys(bundle.settings).length;
  if (settings) bits.push(`${settings} settings`);
  if (bundle.mods.length) bits.push(`${bundle.mods.length} mod${bundle.mods.length === 1 ? '' : 's'}`);
  if (bundle.schedules.length) bits.push(`${bundle.schedules.length} task${bundle.schedules.length === 1 ? '' : 's'}`);
  if (bundle.rawIni) bits.push('raw INI');
  return bits.join(' · ') || 'nothing yet';
}

/** Parts a bundle actually carries — so the apply dialog cannot offer nothing. */
export function availableParts(bundle: SetupBundle): SetupParts {
  return {
    settings: Object.keys(bundle.settings).length > 0,
    mods: bundle.mods.length > 0,
    launch: true,
    rawIni: bundle.rawIni !== null,
    schedules: bundle.schedules.length > 0,
  };
}

export function fileNameFor(bundle: SetupBundle): string {
  const slug = bundle.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'setup';
  return `${slug}-${new Date(bundle.exportedAt).toISOString().slice(0, 10)}.asms-setup.json`;
}

/** Hand the browser a file without a round trip through the server. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch {
        reject(new Error(`${file.name} is not valid JSON`));
      }
    };
    reader.readAsText(file);
  });
}

export const sortSetups = (setups: SavedSetup[]): SavedSetup[] =>
  [...setups].sort((a, b) => b.updatedAt - a.updatedAt);
