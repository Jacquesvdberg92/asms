import fs from 'node:fs';
import path from 'node:path';
import { ark, ensureDir } from '../lib/paths.js';
import { parseIni, stringifyIni, getValue, setValue, type IniDoc } from '../lib/ini.js';
import { SETTINGS, type SettingDef } from './catalog.js';
import type { ServerInstance } from '../types.js';

export type IniFile = 'gus' | 'game';

const SKELETON: Record<IniFile, string> = {
  gus: '[ServerSettings]\r\n\r\n[SessionSettings]\r\n\r\n[/Script/Engine.GameSession]\r\n\r\n[MessageOfTheDay]\r\n',
  game: '[/script/shootergame.shootergamemode]\r\n',
};

export function iniPath(server: ServerInstance, which: IniFile): string {
  return which === 'gus' ? ark.gameUserSettings(server.installPath) : ark.gameIni(server.installPath);
}

export function readRaw(server: ServerInstance, which: IniFile): string {
  const file = iniPath(server, which);
  if (!fs.existsSync(file)) return SKELETON[which];
  return fs.readFileSync(file, 'utf8');
}

export function writeRaw(server: ServerInstance, which: IniFile, text: string): void {
  const file = iniPath(server, which);
  ensureDir(path.dirname(file));
  if (fs.existsSync(file)) {
    // Keep one rolling backup so a bad hand-edit is always recoverable.
    fs.copyFileSync(file, `${file}.asms.bak`);
  }
  fs.writeFileSync(file, text, 'utf8');
}

export function readDoc(server: ServerInstance, which: IniFile): IniDoc {
  return parseIni(readRaw(server, which));
}

export function writeDoc(server: ServerInstance, which: IniFile, doc: IniDoc): void {
  writeRaw(server, which, stringifyIni(doc));
}

/** Current value of every catalogued setting, falling back to its default. */
export function readCurated(server: ServerInstance): Record<string, string> {
  const docs: Record<IniFile, IniDoc> = { gus: readDoc(server, 'gus'), game: readDoc(server, 'game') };
  const out: Record<string, string> = {};
  for (const def of SETTINGS) {
    const found = getValue(docs[def.file], def.section, def.key);
    out[settingId(def)] = (found ?? def.default).trim();
  }
  return out;
}

/** Write back only the keys present in `values`. */
export function writeCurated(server: ServerInstance, values: Record<string, string>): void {
  const docs: Record<IniFile, IniDoc> = { gus: readDoc(server, 'gus'), game: readDoc(server, 'game') };
  const touched = new Set<IniFile>();
  for (const def of SETTINGS) {
    const id = settingId(def);
    if (!(id in values)) continue;
    const raw = String(values[id] ?? '').trim();
    setValue(docs[def.file], def.section, def.key, normalise(def, raw));
    touched.add(def.file);
  }
  for (const which of touched) writeDoc(server, which, docs[which]);
}

function normalise(def: SettingDef, raw: string): string {
  switch (def.type) {
    case 'bool':
      return /^(true|1|yes|on)$/i.test(raw) ? 'True' : 'False';
    case 'int': {
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? String(n) : def.default;
    }
    case 'float': {
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n)) return def.default;
      return Number.isInteger(n) ? n.toFixed(1) : String(n);
    }
    default:
      // A newline here would inject whole extra lines into the file.
      return raw.replace(/[\r\n]+/g, ' ');
  }
}

export function settingId(def: SettingDef): string {
  return `${def.file}:${def.section}:${def.key}`;
}

/**
 * Push the identity fields ASMS owns (names, passwords, ports, MOTD) into
 * GameUserSettings.ini. Called right before every launch so the INI never
 * drifts from what the dashboard shows.
 */
export function syncIdentity(server: ServerInstance): void {
  const doc = readDoc(server, 'gus');
  setValue(doc, 'SessionSettings', 'SessionName', server.sessionName || server.name);
  setValue(doc, 'SessionSettings', 'Port', String(server.port));
  setValue(doc, 'SessionSettings', 'QueryPort', String(server.queryPort));
  if (server.multihome.trim()) setValue(doc, 'SessionSettings', 'MultiHome', server.multihome.trim());

  setValue(doc, 'ServerSettings', 'ServerPassword', server.serverPassword);
  setValue(doc, 'ServerSettings', 'ServerAdminPassword', server.adminPassword);
  setValue(doc, 'ServerSettings', 'SpectatorPassword', server.spectatorPassword);
  setValue(doc, 'ServerSettings', 'RCONEnabled', server.rconEnabled ? 'True' : 'False');
  setValue(doc, 'ServerSettings', 'RCONPort', String(server.rconPort));

  setValue(doc, '/Script/Engine.GameSession', 'MaxPlayers', String(server.maxPlayers));

  setValue(doc, 'MessageOfTheDay', 'Message', server.motd.replace(/\r?\n/g, ' '));
  if (getValue(doc, 'MessageOfTheDay', 'Duration') === undefined) {
    setValue(doc, 'MessageOfTheDay', 'Duration', '20');
  }
  writeDoc(server, 'gus', doc);
}
