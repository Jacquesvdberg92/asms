/**
 * Setups: a server's whole personality - mods, launch flags and every curated
 * setting - captured as one JSON bundle that can be saved, re-applied to
 * another server, or handed to a friend as a file.
 *
 * Two rules shape this file:
 *
 *  1. A bundle never carries a secret. Passwords, ports, install paths and
 *     multihome addresses are stripped on the way out, including out of the
 *     raw INI text, so an exported file is safe to post in a Discord.
 *  2. A bundle coming back in is untrusted. validateBundle() rebuilds it field
 *     by field - unknown settings keys, non-numeric mod ids, bad cron
 *     expressions and oversized blobs are dropped rather than trusted.
 */

import { data, save, id as newId } from '../lib/store.js';
import { bus } from '../lib/bus.js';
import { logger } from '../lib/log.js';
import { parseIni, stringifyIni, removeKey } from '../lib/ini.js';
import { SETTINGS } from './catalog.js';
import * as config from './config.js';
import * as servers from './servers.js';
import * as scheduler from './scheduler.js';
import { getPreset } from './presets.js';
import type { LaunchFlags, ModEntry, SavedSetup, ScheduleAction, SetupBundle, SetupParts, SetupSchedule } from '../types.js';

const log = logger('setups');

export const BUNDLE_VERSION = 1;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 400;
const MAX_MODS = 200;
const MAX_INI_BYTES = 512 * 1024;
const MAX_SCHEDULES = 100;
const MAX_ARGS = 1000;
const MAX_VALUE = 400;

const SCHEDULE_ACTIONS: ScheduleAction[] = ['restart', 'backup', 'update', 'stop', 'start', 'rcon'];

/**
 * Identity ASMS stamps into GameUserSettings.ini before every launch. All of
 * it is either secret or specific to one machine, so it is cut out of any
 * exported INI - and syncIdentity() puts the target server's own values back
 * after an import.
 */
const IDENTITY_KEYS: Array<[string, string]> = [
  ['ServerSettings', 'ServerPassword'],
  ['ServerSettings', 'ServerAdminPassword'],
  ['ServerSettings', 'SpectatorPassword'],
  ['ServerSettings', 'RCONPort'],
  ['ServerSettings', 'RCONEnabled'],
  ['SessionSettings', 'SessionName'],
  ['SessionSettings', 'Port'],
  ['SessionSettings', 'QueryPort'],
  ['SessionSettings', 'MultiHome'],
];

const SETTING_IDS = new Set(SETTINGS.map((def) => config.settingId(def)));

export function defaultParts(): SetupParts {
  return { settings: true, mods: true, launch: true, rawIni: false, schedules: false };
}

function partsFrom(input: unknown): SetupParts {
  const raw = (input ?? {}) as Partial<Record<keyof SetupParts, unknown>>;
  const base = defaultParts();
  const pick = (key: keyof SetupParts) => (typeof raw[key] === 'boolean' ? (raw[key] as boolean) : base[key]);
  return { settings: pick('settings'), mods: pick('mods'), launch: pick('launch'), rawIni: pick('rawIni'), schedules: pick('schedules') };
}

/** Strip passwords, ports and session identity out of raw INI text. */
export function scrubIni(text: string): string {
  const doc = parseIni(text);
  for (const [section, key] of IDENTITY_KEYS) removeKey(doc, section, key);
  return stringifyIni(doc);
}

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '';

// ------------------------------------------------------------- capturing

export interface CaptureInput {
  name?: string;
  description?: string;
  parts?: unknown;
  presetId?: string;
}

/** Snapshot a live server as a bundle. Nothing here reaches the filesystem. */
export function capture(serverId: string, input: CaptureInput = {}): SetupBundle {
  const server = servers.need(serverId);
  const parts = partsFrom(input.parts);

  const bundle: SetupBundle = {
    kind: 'asms.setup',
    version: BUNDLE_VERSION,
    name: clean(input.name, MAX_NAME) || `${server.name} setup`,
    description: clean(input.description, MAX_DESCRIPTION),
    exportedAt: Date.now(),
    exportedBy: 'ASMS',
    sourceServer: server.name,
    presetId: getPreset(String(input.presetId ?? ''))?.id ?? '',
    map: server.map,
    maxPlayers: server.maxPlayers,
    mods: parts.mods ? server.mods.map((mod) => ({ ...mod })) : [],
    flags: parts.launch ? { ...server.flags } : servers.defaultFlags(),
    extraArgs: parts.launch ? server.extraArgs : '',
    extraQuery: parts.launch ? server.extraQuery : '',
    settings: parts.settings ? config.readCurated(server) : {},
    rawIni: parts.rawIni
      ? {
          gus: scrubIni(config.readRaw(server, 'gus')),
          game: scrubIni(config.readRaw(server, 'game')),
        }
      : null,
    schedules: parts.schedules
      ? scheduler.list(serverId).map((task) => ({
          name: task.name,
          action: task.action,
          cron: task.cron,
          enabled: task.enabled,
          warnMinutes: [...task.warnMinutes],
          command: task.command,
        }))
      : [],
  };

  return bundle;
}

/** A filename a human can recognise six months later. */
export function fileName(bundle: SetupBundle): string {
  const slug = bundle.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'setup';
  const day = new Date(bundle.exportedAt).toISOString().slice(0, 10);
  return `${slug}-${day}.asms-setup.json`;
}

// ------------------------------------------------------------ validating

/**
 * Rebuild a bundle from untrusted JSON. Anything unrecognised is dropped, not
 * trusted: these values end up on a command line and inside INI files.
 */
export function validateBundle(input: unknown): SetupBundle {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('That does not look like a setup file.');
  }
  const raw = input as Record<string, unknown>;
  if (raw.kind !== 'asms.setup') {
    throw new Error('That file is not an ASMS setup export (its "kind" field is missing or wrong).');
  }
  const version = Number(raw.version);
  if (!Number.isFinite(version) || version < 1) throw new Error('That setup file has no usable version number.');
  if (version > BUNDLE_VERSION) {
    throw new Error(`That setup was made by a newer ASMS (format ${version}). Update ASMS and try again.`);
  }

  const flags = servers.defaultFlags();
  const rawFlags = (raw.flags ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(flags) as Array<keyof LaunchFlags>) {
    if (typeof rawFlags[key] === 'boolean') flags[key] = rawFlags[key] as boolean;
  }

  // normaliseMods takes both the current shape and the id-only lists that
  // older versions of ASMS exported.
  const mods: ModEntry[] = servers.normaliseMods(raw.mods).slice(0, MAX_MODS);

  const settings: Record<string, string> = {};
  if (raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)) {
    for (const [key, value] of Object.entries(raw.settings as Record<string, unknown>)) {
      if (!SETTING_IDS.has(key)) continue;
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
      settings[key] = clean(String(value), MAX_VALUE);
    }
  }

  let rawIni: SetupBundle['rawIni'] = null;
  const ini = raw.rawIni as { gus?: unknown; game?: unknown } | null | undefined;
  if (ini && typeof ini === 'object' && typeof ini.gus === 'string' && typeof ini.game === 'string') {
    if (ini.gus.length > MAX_INI_BYTES || ini.game.length > MAX_INI_BYTES) {
      throw new Error('That setup carries an INI file larger than 512 KB, which is not plausible.');
    }
    // Scrubbed again on the way in: never trust that the exporter did it.
    rawIni = { gus: scrubIni(ini.gus), game: scrubIni(ini.game) };
  }

  const schedules: SetupSchedule[] = [];
  if (Array.isArray(raw.schedules)) {
    for (const entry of raw.schedules.slice(0, MAX_SCHEDULES)) {
      const task = (entry ?? {}) as Record<string, unknown>;
      const cron = clean(task.cron, 60);
      const action = SCHEDULE_ACTIONS.includes(task.action as ScheduleAction) ? (task.action as ScheduleAction) : null;
      if (!action || !scheduler.validateCron(cron).ok) continue;
      schedules.push({
        name: clean(task.name, MAX_NAME) || 'Imported task',
        action,
        cron,
        enabled: task.enabled !== false,
        warnMinutes: Array.isArray(task.warnMinutes)
          ? task.warnMinutes
              .map((n) => Math.round(Number(n)))
              .filter((n) => Number.isFinite(n) && n > 0 && n <= 1440)
              .slice(0, 10)
          : [],
        command: clean(task.command, 500),
      });
    }
  }

  const maxPlayers = Math.round(Number(raw.maxPlayers));
  const map = clean(raw.map, 64);

  return {
    kind: 'asms.setup',
    version: BUNDLE_VERSION,
    name: clean(raw.name, MAX_NAME) || 'Imported setup',
    description: clean(raw.description, MAX_DESCRIPTION),
    exportedAt: Number.isFinite(Number(raw.exportedAt)) ? Number(raw.exportedAt) : Date.now(),
    exportedBy: clean(raw.exportedBy, 40) || 'unknown',
    sourceServer: clean(raw.sourceServer, MAX_NAME),
    presetId: getPreset(clean(raw.presetId, 40))?.id ?? '',
    map: /^[A-Za-z0-9_]+$/.test(map) ? map : '',
    maxPlayers: Number.isFinite(maxPlayers) && maxPlayers >= 1 && maxPlayers <= 255 ? maxPlayers : 70,
    mods,
    flags,
    extraArgs: clean(raw.extraArgs, MAX_ARGS),
    extraQuery: clean(raw.extraQuery, MAX_ARGS),
    settings,
    rawIni,
    schedules,
  };
}

// -------------------------------------------------------------- applying

export interface ApplyResult {
  applied: string[];
  /** True when the server is up: ARK only reads these files at boot. */
  restartNeeded: boolean;
}

/**
 * Write a bundle onto an existing server. The map is deliberately never
 * applied - changing it would point a running world at different terrain -
 * and identity is re-stamped afterwards so an imported INI cannot smuggle in
 * someone else's ports or passwords.
 */
export function apply(serverId: string, bundle: SetupBundle, partsInput?: unknown): ApplyResult {
  const server = servers.need(serverId);
  const parts = partsFrom(partsInput);
  const applied: string[] = [];

  // Raw first: it replaces whole files, so curated values must land on top.
  if (parts.rawIni && bundle.rawIni) {
    config.writeRaw(server, 'gus', bundle.rawIni.gus);
    config.writeRaw(server, 'game', bundle.rawIni.game);
    applied.push('both INI files, verbatim');
  }

  if (parts.settings && Object.keys(bundle.settings).length) {
    config.writeCurated(server, bundle.settings);
    applied.push(`${Object.keys(bundle.settings).length} game settings`);
  }

  // A replaced INI would otherwise carry the exporter's (scrubbed) identity.
  if (parts.rawIni && bundle.rawIni) config.syncIdentity(server);

  const patch: Parameters<typeof servers.update>[1] = {};
  if (parts.mods) {
    patch.mods = bundle.mods.map((mod) => ({ ...mod }));
    applied.push(bundle.mods.length ? `${bundle.mods.length} mods` : 'an empty mod list');
  }
  if (parts.launch) {
    patch.flags = { ...bundle.flags };
    patch.extraArgs = bundle.extraArgs;
    patch.extraQuery = bundle.extraQuery;
    patch.maxPlayers = bundle.maxPlayers;
    applied.push('launch flags and extra arguments');
  }
  // A mods-only apply must not clobber the flags the server already has.
  if (parts.mods && !parts.launch) {
    patch.flags = { ...server.flags, automanagedmods: bundle.flags.automanagedmods };
  }
  if (Object.keys(patch).length) servers.update(serverId, patch);

  if (parts.schedules && bundle.schedules.length) {
    const existing = scheduler.list(serverId);
    let added = 0;
    for (const task of bundle.schedules) {
      const duplicate = existing.some((t) => t.action === task.action && t.cron === task.cron && t.command === task.command);
      if (duplicate) continue;
      scheduler.create({ ...task, serverId });
      added += 1;
    }
    if (added) applied.push(`${added} scheduled task${added === 1 ? '' : 's'}`);
  }

  log.info(`applied setup "${bundle.name}" to ${server.name}: ${applied.join(', ') || 'nothing'}`);
  return { applied, restartNeeded: servers.runtime(serverId).state === 'running' };
}

// ----------------------------------------------------------------- store

export function list(): SavedSetup[] {
  return data().setups;
}

export function get(id: string): SavedSetup | undefined {
  return data().setups.find((s) => s.id === id);
}

export function need(id: string): SavedSetup {
  const setup = get(id);
  if (!setup) throw new Error('That saved setup no longer exists');
  return setup;
}

export function store(bundle: SetupBundle): SavedSetup {
  const setup: SavedSetup = { id: newId('set_'), createdAt: Date.now(), updatedAt: Date.now(), bundle };
  data().setups.push(setup);
  save();
  bus.emitEvent('setup:changed', {});
  return setup;
}

export function rename(id: string, name?: string, description?: string): SavedSetup {
  const setup = need(id);
  if (name !== undefined) setup.bundle.name = clean(name, MAX_NAME) || setup.bundle.name;
  if (description !== undefined) setup.bundle.description = clean(description, MAX_DESCRIPTION);
  setup.updatedAt = Date.now();
  save();
  bus.emitEvent('setup:changed', {});
  return setup;
}

export function remove(id: string): void {
  const db = data();
  const before = db.setups.length;
  db.setups = db.setups.filter((s) => s.id !== id);
  if (db.setups.length === before) throw new Error('That saved setup no longer exists');
  save();
  bus.emitEvent('setup:changed', {});
}
