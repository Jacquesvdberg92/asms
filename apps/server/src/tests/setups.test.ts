import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PRESETS, getPreset, resolve, resolveById } from '../core/presets.js';
import { SETTINGS } from '../core/catalog.js';
import { readCurated, writeCurated, settingId, readRaw, writeRaw, syncIdentity } from '../core/config.js';
import { scrubIni, validateBundle } from '../core/setups.js';
import { READY_LINE, assertLaunchSafe, assertInstallPathSafe, buildLaunchPlan, defaultFlags, normaliseMods, installedMods, isModTrouble, modFailureMessage, rejectedModIds, reportMods } from '../core/servers.js';
import { INSTALL_PATH_LIMIT } from '../lib/paths.js';
import type { ServerInstance } from '../types.js';

const scratch = (): ServerInstance => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-setup-'));
  return { id: 'srv_test', name: 'Test', map: 'TheIsland_WP', installPath: dir } as unknown as ServerInstance;
};

const idFor = (key: string): string => {
  const def = SETTINGS.find((d) => d.key === key);
  if (!def) throw new Error(`no such setting ${key}`);
  return settingId(def);
};

// --------------------------------------------------------------- presets

test('presets: every preset names settings that exist in the catalogue', () => {
  for (const preset of PRESETS) {
    assert.doesNotThrow(() => resolve(preset), `preset ${preset.id} refers to an unknown setting`);
  }
});

test('presets: the four play styles and the official reset are all present', () => {
  assert.deepEqual(
    PRESETS.map((p) => p.id),
    ['creative', 'easy', 'medium', 'hard', 'official'],
  );
  for (const preset of PRESETS) {
    assert.ok(preset.highlights.length >= 3, `${preset.id} should explain itself in at least three lines`);
  }
});

test('presets: official puts every curated setting back to its default', () => {
  const values = resolveById('official');
  for (const [id, value] of Object.entries(values)) {
    const def = SETTINGS.find((d) => settingId(d) === id);
    assert.equal(value, def?.default, `${id} should be the catalogue default`);
  }
});

test('presets: hard is genuinely harder than easy where it matters', () => {
  const easy = getPreset('easy')!.values;
  const hard = getPreset('hard')!.values;
  assert.ok(Number(easy.HarvestAmountMultiplier) > Number(hard.HarvestAmountMultiplier));
  assert.ok(Number(easy.TamingSpeedMultiplier) > Number(hard.TamingSpeedMultiplier));
  assert.equal(easy.serverPVE, 'True');
  assert.equal(hard.serverPVE, 'False');
});

test('presets: applying one writes real values into both INI files', () => {
  const server = scratch();
  writeCurated(server, resolveById('hard'));
  const back = readCurated(server);
  assert.equal(back[idFor('OverrideOfficialDifficulty')], '6.0');
  assert.equal(back[idFor('serverPVE')], 'False');
  // Game.ini keys travel too, not just GameUserSettings.ini.
  assert.equal(back[idFor('BabyMatureSpeedMultiplier')], '1.0');
  assert.match(readRaw(server, 'game'), /BabyMatureSpeedMultiplier=1\.0/);
});

test('presets: swapping preset overwrites the previous one rather than merging', () => {
  const server = scratch();
  writeCurated(server, resolveById('creative'));
  assert.equal(readCurated(server)[idFor('XPMultiplier')], '25.0');
  writeCurated(server, resolveById('official'));
  assert.equal(readCurated(server)[idFor('XPMultiplier')], '1.0');
});

// ---------------------------------------------------------------- setups

const goodBundle = (): Record<string, unknown> => ({
  kind: 'asms.setup',
  version: 1,
  name: 'Friends server',
  description: 'x5 rates',
  exportedAt: 1_700_000_000_000,
  exportedBy: 'ASMS',
  sourceServer: 'Ragnarok Ragers',
  presetId: 'medium',
  map: 'Ragnarok_WP',
  maxPlayers: 20,
  mods: ['893657', '928567'],
  flags: { crossplay: true, forceAllowCaveFlyers: true },
  extraArgs: '-ForceAllowCaveFlyers',
  extraQuery: 'AltSaveDirectoryName=Season3',
  settings: { [idFor('XPMultiplier')]: '3.0' },
  rawIni: null,
  schedules: [{ name: 'Nightly restart', action: 'restart', cron: '0 6 * * *', enabled: true, warnMinutes: [10, 5], command: '' }],
});

test('setups: a well-formed bundle survives a round trip intact', () => {
  const bundle = validateBundle(goodBundle());
  assert.equal(bundle.name, 'Friends server');
  // A bundle written by an older ASMS carries bare ids; they come back as
  // full entries, switched on, in the order they were listed.
  assert.deepEqual(
    bundle.mods.map((mod) => mod.id),
    ['893657', '928567'],
  );
  assert.ok(bundle.mods.every((mod) => mod.enabled));
  assert.equal(bundle.flags.crossplay, true);
  assert.equal(bundle.flags.forceAllowCaveFlyers, true);
  // Flags the file did not mention fall back to the defaults, not undefined.
  assert.equal(bundle.flags.serverGameLog, true);
  assert.equal(bundle.schedules.length, 1);
  assert.equal(bundle.settings[idFor('XPMultiplier')], '3.0');
});

test('setups: an unrelated json file is refused with a sentence', () => {
  assert.throws(() => validateBundle({ hello: 'world' }), /not an ASMS setup/);
  assert.throws(() => validateBundle('nope'), /does not look like a setup/);
  assert.throws(() => validateBundle({ ...goodBundle(), version: 99 }), /newer ASMS/);
});

test('setups: junk inside a bundle is dropped rather than trusted', () => {
  const bundle = validateBundle({
    ...goodBundle(),
    mods: ['893657', 'rm -rf /', '', '12; DROP', '893657'],
    settings: {
      [idFor('XPMultiplier')]: '3.0',
      'gus:ServerSettings:NotARealSetting': '9',
      __proto__: 'polluted',
    },
    schedules: [
      { name: 'bad cron', action: 'restart', cron: 'every tuesday', enabled: true, warnMinutes: [], command: '' },
      { name: 'bad action', action: 'launch-missiles', cron: '0 6 * * *', enabled: true, warnMinutes: [], command: '' },
    ],
    flags: { crossplay: 'yes please', madeUpFlag: true },
  });
  assert.deepEqual(
    bundle.mods.map((mod) => mod.id),
    ['893657'],
    'only plausible project ids survive, deduplicated',
  );
  assert.deepEqual(Object.keys(bundle.settings), [idFor('XPMultiplier')]);
  assert.deepEqual(bundle.schedules, [], 'a bad cron or unknown action is not worth keeping');
  assert.equal(bundle.flags.crossplay, false, 'a non-boolean flag falls back to the default');
  assert.equal((bundle.flags as unknown as Record<string, unknown>).madeUpFlag, undefined);
});

test('setups: a setting value cannot smuggle extra INI lines in', () => {
  const bundle = validateBundle({
    ...goodBundle(),
    settings: { [idFor('BanListURL')]: 'http://x\r\nServerAdminPassword=hunter2' },
  });
  const value = bundle.settings[idFor('BanListURL')];
  assert.ok(!/[\r\n]/.test(value), 'newlines are stripped on the way in');
});

test('setups: exported INI text carries no passwords or ports', () => {
  const raw = [
    '[ServerSettings]',
    'ServerAdminPassword=hunter2',
    'ServerPassword=letmein',
    'RCONPort=27020',
    'XPMultiplier=3.0',
    '[SessionSettings]',
    'SessionName=Private Server',
    'Port=7777',
    'MultiHome=192.168.0.9',
  ].join('\r\n');
  const scrubbed = scrubIni(raw);
  for (const secret of ['hunter2', 'letmein', '27020', '7777', '192.168.0.9', 'Private Server']) {
    assert.ok(!scrubbed.includes(secret), `${secret} should not survive scrubbing`);
  }
  assert.match(scrubbed, /XPMultiplier=3\.0/, 'real settings are kept');
});

test('setups: an imported raw INI is scrubbed again on the way in', () => {
  const bundle = validateBundle({
    ...goodBundle(),
    rawIni: { gus: '[ServerSettings]\r\nServerAdminPassword=sneaky\r\nXPMultiplier=2.0\r\n', game: '[/script/shootergame.shootergamemode]\r\n' },
  });
  assert.ok(bundle.rawIni);
  assert.ok(!bundle.rawIni.gus.includes('sneaky'));
  assert.match(bundle.rawIni.gus, /XPMultiplier=2\.0/);
});

test('setups: an implausibly large INI blob is rejected outright', () => {
  const huge = 'x'.repeat(600 * 1024);
  assert.throws(() => validateBundle({ ...goodBundle(), rawIni: { gus: huge, game: '' } }), /larger than 512 KB/);
});

// ------------------------------------------------------------- readiness

test('servers: the readiness banner is recognised in every shape ARK writes it', () => {
  const hits = [
    '[2026.08.30-19.10.02:123][  0]LogServerStats: Server has completed startup and is now advertising for join.',
    'Full Startup: 92.20 seconds',
    'LogInit: Display: Server has completed startup',
  ];
  for (const line of hits) assert.ok(READY_LINE.test(line), `should match: ${line}`);

  const misses = [
    '[2026.08.30-19.09.00:000]LogInit: Display: Starting up...',
    '21:29:38 3456 1716 I Info/GameAnalytics : Event queue: No events to send',
  ];
  for (const line of misses) assert.ok(!READY_LINE.test(line), `should not match: ${line}`);
});

// ----------------------------------------------------- launch option safety

test('servers: a line break in an identity field is refused', () => {
  // These land in GameUserSettings.ini as one Key=Value line each, so a break
  // would turn the rest of the value into its own setting.
  assert.throws(() => assertLaunchSafe({ adminPassword: 'two\nlines' }), /line break/i);
  assert.throws(() => assertLaunchSafe({ sessionName: 'a\r\nServerAdminPassword=hunter2' }), /Session name/);

  // A "?" is fine now that passwords no longer travel in the launch URL, and
  // so is everything else a password might reasonably contain.
  for (const ok of ['hunter2', 'my pass?word', 'correct horse battery staple', 'p@ss-w0rd!', 'aB3$%^&*()_+', 'ünïcøde']) {
    assert.doesNotThrow(() => assertLaunchSafe({ adminPassword: ok }), `should allow ${ok}`);
  }
});;

test('servers: an install folder too deep for mods is refused', () => {
  // The depth a real server was created at, which broke every mod download.
  const head = 'C:/Users/example/AppData/Local/Temp/';
  const tail = '/servers/island';
  assert.throws(
    () => assertInstallPathSafe(head + 'w'.repeat(140 - head.length - tail.length) + tail),
    /Unable to create a directory/,
  );

  // A tight-but-workable folder only warns in the UI - it must not block, or
  // people with deep drive layouts could never create a server at all.
  assert.doesNotThrow(() => assertInstallPathSafe('C:\\' + 'x'.repeat(INSTALL_PATH_LIMIT - 3)));
  assert.doesNotThrow(() => assertInstallPathSafe('C:\\ASA\\servers\\ragnarok-ragers'));
  assert.doesNotThrow(() => assertInstallPathSafe(undefined));
  assert.doesNotThrow(() => assertInstallPathSafe(''));
});

test('servers: the launch command carries no names or passwords', () => {
  // A real server ended up with the admin password "1234?Port=7777?QueryPort=
  // 27015?RCONEnabled=True?RCONPort=27020" because ARK glued the trailing
  // options onto it. Text values live in GameUserSettings.ini now.
  const server = {
    ...({} as ServerInstance),
    name: 'T', map: 'Ragnarok_WP', installPath: 'C:/asa/t', sessionName: 'Ragnarok Ragers',
    serverPassword: 'joinpw', adminPassword: '1234', spectatorPassword: 'spectate', motd: '',
    multihome: '', port: 7777, queryPort: 27015, rconPort: 27020, rconEnabled: true, maxPlayers: 70,
    clusterId: '', clusterDir: '', mods: [], flags: defaultFlags(), extraArgs: '', extraQuery: '',
  } as ServerInstance;
  const plan = buildLaunchPlan(server);

  for (const secret of ['1234', 'joinpw', 'spectate', 'ServerAdminPassword', 'SessionName']) {
    assert.ok(!plan.display.includes(secret), `the launch command must not contain ${secret}`);
  }
  // What ARK does need from the command line is still there.
  assert.match(plan.args[0], /^Ragnarok_WP\?listen\?Port=7777\?QueryPort=27015\?RCONEnabled=True\?RCONPort=27020$/);
});

test('servers: identity that left the command line is written to the INI instead', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-identity-'));
  const server = {
    ...({} as ServerInstance),
    name: 'T', map: 'Ragnarok_WP', installPath: dir, sessionName: 'Ragnarok Ragers',
    serverPassword: 'joinpw', adminPassword: '1234', spectatorPassword: 'spectate', motd: 'Welcome',
    multihome: '', port: 7777, queryPort: 27015, rconPort: 27020, rconEnabled: true, maxPlayers: 24,
    clusterId: '', clusterDir: '', mods: [], flags: defaultFlags(), extraArgs: '', extraQuery: '',
  } as ServerInstance;

  syncIdentity(server);
  const ini = readRaw(server, 'gus');
  assert.match(ini, /ServerAdminPassword=1234\r?\n/, 'the password needs a line of its own');
  assert.match(ini, /ServerPassword=joinpw/);
  assert.match(ini, /SpectatorPassword=spectate/);
  assert.match(ini, /SessionName=Ragnarok Ragers/);
  assert.match(ini, /RCONPort=27020/);
});

test('servers: a password ARK corrupted last run is repaired before the next one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-repair-'));
  const server = {
    ...({} as ServerInstance),
    name: 'T', map: 'TheIsland_WP', installPath: dir, sessionName: 'T', serverPassword: '',
    adminPassword: '1234', spectatorPassword: '', motd: '', multihome: '', port: 7777,
    queryPort: 27015, rconPort: 27020, rconEnabled: true, maxPlayers: 70, clusterId: '',
    clusterDir: '', mods: [], flags: defaultFlags(), extraArgs: '', extraQuery: '',
  } as ServerInstance;

  writeRaw(server, 'gus', '[ServerSettings]\r\nServerAdminPassword=1234?Port=7777?QueryPort=27015?RCONEnabled=True?RCONPort=27020\r\n');
  syncIdentity(server);
  assert.match(readRaw(server, 'gus'), /ServerAdminPassword=1234\r?\n/);
  assert.ok(!readRaw(server, 'gus').includes('1234?Port'), 'the mangled value must be gone');
});

test('servers: a password containing "?" survives into the INI intact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-qmark-'));
  const server = {
    ...({} as ServerInstance),
    name: 'T', map: 'TheIsland_WP', installPath: dir, sessionName: 'T', serverPassword: '',
    adminPassword: 'my pass?word', spectatorPassword: '', motd: '', multihome: '', port: 7777,
    queryPort: 27015, rconPort: 27020, rconEnabled: true, maxPlayers: 70, clusterId: '',
    clusterDir: '', mods: [], flags: defaultFlags(), extraArgs: '', extraQuery: '',
  } as ServerInstance;
  syncIdentity(server);
  assert.match(readRaw(server, 'gus'), /ServerAdminPassword=my pass\?word\r?\n/);
  assert.ok(!buildLaunchPlan(server).display.includes('my pass'), 'and it never reaches the command line');
});

// ---------------------------------------------------------------- mods

test('mods: every shape a mod list has arrived in normalises to entries', () => {
  // Bare ids are what older ASMS versions saved and what people paste.
  assert.deepEqual(normaliseMods(['893657', 928567]), [
    { id: '893657', name: '', author: '', url: '', enabled: true },
    { id: '928567', name: '', author: '', url: '', enabled: true },
  ]);

  const rich = normaliseMods([
    { id: '941697', name: 'Better Breeding', author: 'Silentrizz', url: 'https://www.curseforge.com/x', enabled: false },
  ]);
  assert.equal(rich[0].name, 'Better Breeding');
  assert.equal(rich[0].enabled, false, 'a disabled mod stays disabled');
});

test('mods: junk is dropped and links cannot smuggle a script in', () => {
  const mods = normaliseMods([
    '893657',
    '893657',
    'not-an-id',
    { id: '12; DROP' },
    { id: '941697', url: 'javascript:alert(1)' },
    { id: '950914', url: 'https://ok.test/mod' },
  ]);
  assert.deepEqual(mods.map((m) => m.id), ['893657', '941697', '950914'], 'deduplicated, non-numeric ids gone');
  assert.equal(mods[1].url, '', 'a javascript: link is not a link');
  assert.equal(mods[2].url, 'https://ok.test/mod');
});

test('mods: only the enabled ones reach the launch command, in order', () => {
  const server = {
    ...({} as ServerInstance),
    name: 'T', map: 'TheIsland_WP', installPath: 'C:/asa/t', sessionName: 'T', serverPassword: '',
    adminPassword: 'x', spectatorPassword: '', motd: '', multihome: '', port: 7777, queryPort: 27015,
    rconPort: 27020, rconEnabled: true, maxPlayers: 70, clusterId: '', clusterDir: '', activeEvent: '',
    mods: normaliseMods([
      { id: '111', enabled: true },
      { id: '222', enabled: false },
      { id: '333', enabled: true },
    ]),
    flags: defaultFlags(), extraArgs: '', extraQuery: '',
  } as ServerInstance;
  const args = buildLaunchPlan(server).args;
  assert.ok(args.includes('-mods=111,333'), `expected -mods=111,333 in ${args.join(' ')}`);
});

test('servers: a seasonal event reaches the command line', () => {
  const base = {
    ...({} as ServerInstance),
    name: 'T', map: 'TheIsland_WP', installPath: 'C:/asa/t', sessionName: 'T', serverPassword: '',
    adminPassword: 'x', spectatorPassword: '', motd: '', multihome: '', port: 7777, queryPort: 27015,
    rconPort: 27020, rconEnabled: true, maxPlayers: 70, clusterId: '', clusterDir: '', mods: [],
    flags: defaultFlags(), extraArgs: '', extraQuery: '', activeEvent: '',
  } as ServerInstance;
  assert.ok(!buildLaunchPlan(base).args.some((a) => a.startsWith('-ActiveEvent')));
  assert.ok(buildLaunchPlan({ ...base, activeEvent: 'FearEvolved' }).args.includes('-ActiveEvent=FearEvolved'));
});

test('mods: the diagnosis names the mod that never downloaded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-moddiag-'));
  // ARK unpacks each mod into a folder named after its id.
  const modsDir = path.join(dir, 'ShooterGame', 'Binaries', 'Win64', 'ShooterGame', 'Mods');
  for (const id of ['929800', '933899']) {
    fs.mkdirSync(path.join(modsDir, id), { recursive: true });
    fs.writeFileSync(path.join(modsDir, id, 'mod.pak'), 'x'.repeat(2048));
  }

  const server = {
    ...({} as ServerInstance),
    id: 'srv_moddiag', name: 'T', map: 'TheIsland_WP', installPath: dir, sessionName: 'T',
    serverPassword: '', adminPassword: 'x', spectatorPassword: '', motd: '', multihome: '',
    port: 7777, queryPort: 27015, rconPort: 27020, rconEnabled: true, maxPlayers: 70,
    clusterId: '', clusterDir: '', activeEvent: '', extraArgs: '', extraQuery: '',
    flags: defaultFlags(),
    mods: normaliseMods([
      { id: '929800', name: 'TG Stacking' },
      { id: '933899', name: 'Super Cryo Storage' },
      { id: '999999', name: 'Deleted From CurseForge' },
      { id: '111111', name: 'Switched Off', enabled: false },
    ]),
  } as ServerInstance;

  const found = installedMods(server);
  assert.equal(found.root, modsDir);
  assert.deepEqual(found.ids.sort(), ['929800', '933899']);

  const report = new Map(reportMods(server).mods.map((m) => [m.id, m]));
  assert.equal(report.get('929800')?.downloaded, true);
  assert.equal(report.get('999999')?.downloaded, false, 'the missing one is spotted');
  assert.equal(report.get('111111')?.enabled, false, 'a switched-off mod is not requested');
  assert.match(reportMods(server).verdict, /Deleted From CurseForge \(999999\)/);
});

test('mods: the CurseForge layout nests ids a level deeper and is still read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-modcf-'));
  // Copied from a real install: CurseForge puts its own game id in the way,
  // then names each mod folder <projectId>_<fileId>.
  const modsDir = path.join(dir, 'ShooterGame', 'Binaries', 'Win64', 'ShooterGame', 'Mods');
  for (const folder of ['929800_7739804', '941697_6570902', '979566_8442174']) {
    fs.mkdirSync(path.join(modsDir, '83374', folder), { recursive: true });
    fs.writeFileSync(path.join(modsDir, '83374', folder, 'mod.pak'), 'x'.repeat(2048));
  }

  const server = {
    ...({} as ServerInstance),
    id: 'srv_modcf', name: 'T', map: 'TheIsland_WP', installPath: dir, sessionName: 'T',
    serverPassword: '', adminPassword: 'x', spectatorPassword: '', motd: '', multihome: '',
    port: 7777, queryPort: 27015, rconPort: 27020, rconEnabled: true, maxPlayers: 70,
    clusterId: '', clusterDir: '', activeEvent: '', extraArgs: '', extraQuery: '',
    flags: defaultFlags(),
    mods: normaliseMods([
      { id: '929800', name: 'TG Stacking' },
      { id: '941697', name: 'Better Breeding' },
      { id: '928988', name: 'Super Spyglass' },
    ]),
  } as ServerInstance;

  const found = installedMods(server);
  // 83374 is CurseForge's id for ARK itself and must never be read as a mod.
  assert.ok(!found.ids.includes('83374'), 'the game id is not a mod');
  assert.deepEqual(found.ids.sort(), ['929800', '941697', '979566']);

  const report = new Map(reportMods(server).mods.map((m) => [m.id, m]));
  assert.equal(report.get('929800')?.downloaded, true, 'an installed mod reads as installed');
  assert.equal(report.get('941697')?.downloaded, true);
  assert.equal(report.get('928988')?.downloaded, false, 'the one that never unpacked is spotted');
});

/** A server shaped just enough for the mod checks to run against. */
const modServer = (installPath: string, mods: unknown[]): ServerInstance =>
  ({
    ...({} as ServerInstance),
    id: 'srv_modfixture', name: 'T', map: 'TheIsland_WP', installPath, sessionName: 'T',
    serverPassword: '', adminPassword: 'x', spectatorPassword: '', motd: '', multihome: '',
    port: 7777, queryPort: 27015, rconPort: 27020, rconEnabled: true, maxPlayers: 70,
    clusterId: '', clusterDir: '', activeEvent: '', extraArgs: '', extraQuery: '',
    flags: defaultFlags(),
    mods: normaliseMods(mods),
  }) as ServerInstance;

test('mods: an empty folder is a half-download, not a download', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-modempty-'));
  const modsDir = path.join(dir, 'ShooterGame', 'Binaries', 'Win64', 'ShooterGame', 'Mods', '83374');
  // The real failure: ARK made the folder, the download died, and every later
  // start saw the folder and decided the mod was already there.
  fs.mkdirSync(path.join(modsDir, '929800_7739804'), { recursive: true });
  fs.writeFileSync(path.join(modsDir, '929800_7739804', 'mod.pak'), 'x'.repeat(2048));
  fs.mkdirSync(path.join(modsDir, '941697_6570902'), { recursive: true });

  const server = modServer(dir, [
    { id: '929800', name: 'TG Stacking' },
    { id: '941697', name: 'Better Breeding' },
  ]);

  const report = new Map(reportMods(server).mods.map((m) => [m.id, m]));
  assert.equal(report.get('929800')?.status, 'ok');
  assert.ok((report.get('929800')?.sizeMB ?? 0) >= 0, 'a real mod reports a size');
  assert.equal(report.get('929800')?.fileId, '7739804', 'the CurseForge file id is read off the folder');
  assert.equal(report.get('941697')?.status, 'partial', 'an empty folder is not a download');
  assert.equal(report.get('941697')?.downloaded, false);
  assert.match(reportMods(server).verdict, /Better Breeding \(941697\)/);
  assert.match(reportMods(server).verdict, /half-downloaded/);
});

test('mods: a download stuck in .temp is reported as half-finished', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-modtemp-'));
  const modsDir = path.join(dir, 'ShooterGame', 'Binaries', 'Win64', 'ShooterGame', 'Mods', '83374');
  fs.mkdirSync(path.join(modsDir, '.temp', '941697_6570902'), { recursive: true });
  // Even with bytes in it, .temp means ARK never moved it into place.
  fs.writeFileSync(path.join(modsDir, '.temp', '941697_6570902', 'mod.pak'), 'x'.repeat(2048));
  fs.mkdirSync(path.join(modsDir, '929800_7739804'), { recursive: true });
  fs.writeFileSync(path.join(modsDir, '929800_7739804', 'mod.pak'), 'x'.repeat(2048));

  const server = modServer(dir, [
    { id: '929800', name: 'TG Stacking' },
    { id: '941697', name: 'Better Breeding' },
  ]);

  const report = new Map(reportMods(server).mods.map((m) => [m.id, m]));
  assert.equal(report.get('941697')?.status, 'partial');
  assert.ok(reportMods(server).advice.some((line) => /Force re-download/.test(line)), 'it says what to do next');
});

test('mods: the failure message names the mod instead of blaming "a mod"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-modmsg-'));
  const modsDir = path.join(dir, 'ShooterGame', 'Binaries', 'Win64', 'ShooterGame', 'Mods', '83374');
  fs.mkdirSync(path.join(modsDir, '929800_7739804'), { recursive: true });
  fs.writeFileSync(path.join(modsDir, '929800_7739804', 'mod.pak'), 'x'.repeat(2048));

  const server = modServer(dir, [
    { id: '929800', name: 'TG Stacking' },
    { id: '999999', name: 'Deleted From CurseForge' },
  ]);

  const message = modFailureMessage(server);
  assert.match(message, /Deleted From CurseForge \(999999\) never downloaded/);
  assert.ok(!message.includes('TG Stacking'), 'a mod that is fine is not named as a suspect');
});

test('mods: ARK\u2019s own complaints are recognised, ordinary log noise is not', () => {
  assert.ok(isModTrouble(String.raw`[2026.08.31-16.02.11:993][  0]Unable to create a directory C:\ASA\...`));
  assert.ok(isModTrouble('Requested mods failed to load on server'));
  assert.ok(isModTrouble('LogMods: Error: Mod 941697 failed to download after 3 attempts'));
  assert.ok(!isModTrouble('LogMods: Mounting mod 929800'));
  assert.ok(!isModTrouble('Full startup: 42.11 seconds (BP compile: 0.00 seconds)'));
});

test('mods: an id ARK refused is told apart from one that merely failed to arrive', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-modrefused-'));
  const modsDir = path.join(dir, 'ShooterGame', 'Binaries', 'Win64', 'ShooterGame', 'Mods', '83374');
  fs.mkdirSync(path.join(modsDir, '929800_7739804'), { recursive: true });
  fs.writeFileSync(path.join(modsDir, '929800_7739804', 'mod.pak'), 'x'.repeat(2048));

  const server = modServer(dir, [
    { id: '929800', name: 'TG Stacking' },
    { id: '893657', name: 'Awesome SpyGlass!' },
    { id: '999999', name: 'Just Missing' },
  ]);

  // The four lines ARK actually writes when CurseForge serves it nothing.
  const evidence = [
    'ASAMods: Error: Not all mods were installed. Check the log for CFCore errors.',
    'If you have any Custom Cosmetics in the mod list please remove them.',
    'Attempting to install pc-only mods on a cross-platform server will also fail to install.',
    'Mods not installed: 893657',
  ];
  for (const line of evidence) assert.ok(isModTrouble(line), `not recognised: ${line}`);
  assert.deepEqual(rejectedModIds(evidence), ['893657']);

  const diagnosis = reportMods(server, true, evidence);
  const report = new Map(diagnosis.mods.map((m) => [m.id, m]));
  assert.equal(report.get('929800')?.status, 'ok');
  assert.equal(report.get('893657')?.status, 'rejected', 'ARK named this one, so it is not just missing');
  assert.equal(report.get('999999')?.status, 'missing', 'a mod ARK said nothing about stays missing');

  // The whole point: it must not send someone off to re-download for twenty
  // minutes when the mod was never CurseForge's to hand over.
  assert.match(diagnosis.verdict, /Awesome SpyGlass! \(893657\)/);
  assert.ok(diagnosis.advice.some((line) => line.includes('curseforge.com/projects/893657')), 'it says how to check the id');
  assert.ok(diagnosis.advice.some((line) => /PC Only/i.test(line)), 'it names the switch that fixes a PC-only mod');
  assert.ok(!diagnosis.advice.some((line) => /Press Download mods now/.test(line)), 'it does not promise a retry that cannot work');
});

test('mods: a rejected id sitting in a stale log is ignored once the mod is on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-modrefixed-'));
  const modsDir = path.join(dir, 'ShooterGame', 'Binaries', 'Win64', 'ShooterGame', 'Mods', '83374');
  fs.mkdirSync(path.join(modsDir, '893657_1234567'), { recursive: true });
  fs.writeFileSync(path.join(modsDir, '893657_1234567', 'mod.pak'), 'x'.repeat(2048));

  const server = modServer(dir, [{ id: '893657', name: 'Awesome SpyGlass!' }]);
  const report = new Map(reportMods(server, false, ['Mods not installed: 893657']).mods.map((m) => [m.id, m]));
  assert.equal(report.get('893657')?.status, 'ok');
});

test('mods: the PC-only switch reaches the command line', () => {
  const server = modServer('C:/asa/t', []);
  assert.ok(!buildLaunchPlan(server).args.includes('-ServerPlatform=PC'));
  const pcOnly = { ...server, flags: { ...server.flags, pcOnlyServer: true } } as ServerInstance;
  assert.ok(buildLaunchPlan(pcOnly).args.includes('-ServerPlatform=PC'));
});
