import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ArchiveBundle, ServerInstance } from '../types.js';

/**
 * An archive touches the real database and the real data folder, so this file
 * points ASMS at a scratch directory *before* anything that reads DATA_DIR is
 * loaded. Hence the dynamic imports: a static one would be hoisted above this
 * line and the tests would save over the user's own asms.json.
 */
process.env.ASMS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-archive-data-'));

const archive = await import('../core/archive.js');
const store = await import('../lib/store.js');
const servers = await import('../core/servers.js');
const config = await import('../core/config.js');
const scheduler = await import('../core/scheduler.js');

const installDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'asms-archive-install-'));

function fakeServer(overrides: Partial<ServerInstance> = {}): ServerInstance {
  return {
    id: 'srv_island',
    name: 'Island',
    map: 'TheIsland_WP',
    installPath: installDir(),
    sessionName: 'The Crew - Island',
    serverPassword: 'joinme',
    adminPassword: 'hunter2',
    spectatorPassword: '',
    motd: 'Welcome!',
    port: 7777,
    queryPort: 27015,
    rconPort: 27020,
    rconEnabled: true,
    maxPlayers: 20,
    multihome: '',
    clusterId: 'ark-k3m9xq7p2wds',
    clusterDir: '',
    mods: [{ id: '928988', name: 'Structures Plus', author: 'orionsun', url: '', enabled: true }],
    flags: servers.defaultFlags(),
    activeEvent: '',
    extraArgs: '',
    extraQuery: '',
    autoStart: true,
    autoRestartOnCrash: true,
    updateOnStart: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** Put one server with real INI files on disk into the (scratch) database. */
function seed(): ServerInstance {
  const db = store.data();
  // Keep every folder an import might write into inside the scratch directory.
  db.settings.defaultInstallRoot = path.join(process.env.ASMS_DATA as string, 'servers');
  db.settings.backupRoot = path.join(process.env.ASMS_DATA as string, 'backups');
  db.settings.clusterRoot = path.join(process.env.ASMS_DATA as string, 'clusters');
  // 0 keeps the update poller - and the interval that would hold this process
  // open after the last test - out of the way.
  db.settings.updateCheckInterval = 0;
  const server = fakeServer();
  db.servers = [server];
  db.schedules = [];
  db.backups = [];
  db.setups = [];
  db.library = { mods: [], clusters: [] };
  config.writeCurated(server, {});
  config.writeRaw(server, 'game', '[/script/shootergame.shootergamemode]\r\nBabyMatureSpeedMultiplier=25.0\r\n');
  config.syncIdentity(server);
  servers.resyncRuntimes();
  return server;
}

// -------------------------------------------------------------- validating

test('archive: a setup file is turned away with the sentence that helps', () => {
  assert.throws(() => archive.validateArchive({ kind: 'asms.setup', version: 1 }), /setup file, not a full backup/);
});

test('archive: unrelated JSON and newer formats are refused', () => {
  assert.throws(() => archive.validateArchive({ hello: 'world' }), /not an ASMS backup/);
  assert.throws(() => archive.validateArchive([1, 2, 3]), /does not look like/);
  assert.throws(() => archive.validateArchive({ kind: 'asms.archive', version: 99 }), /newer ASMS/);
});

test('archive: junk inside a valid archive is dropped rather than trusted', () => {
  const clean = archive.validateArchive({
    kind: 'asms.archive',
    version: 1,
    servers: [
      {
        id: 'srv_ok',
        name: 'Fine',
        map: 'Ragnarok_WP',
        port: 999_999, // out of range
        maxPlayers: -4,
        clusterId: 'bad id!!;rm -rf',
        mods: ['928988', { id: 'not-a-number' }, { id: '928988' }],
        flags: { noBattlEye: true, madeUpFlag: true },
        activeEvent: 'Summer; echo pwned',
      },
    ],
    schedules: [
      { serverId: 'srv_ok', action: 'restart', cron: '0 6 * * *' },
      { serverId: 'srv_ok', action: 'restart', cron: 'not a cron' },
      { serverId: 'srv_missing', action: 'restart', cron: '0 6 * * *' },
      { serverId: 'srv_ok', action: 'launch-nukes', cron: '0 6 * * *' },
    ],
    configs: { srv_ghost: { gus: '[ServerSettings]', game: '' } },
  });

  const server = clean.servers[0];
  assert.equal(server.port, 7777, 'an impossible port falls back to the default');
  assert.equal(server.maxPlayers, 70);
  assert.equal(server.clusterId, 'badidrm-rf', 'cluster ids keep only command-line-safe characters');
  assert.deepEqual(
    server.mods.map((mod) => mod.id),
    ['928988'],
    'non-numeric and duplicate mod ids are dropped',
  );
  assert.equal(server.flags.noBattlEye, true);
  assert.equal('madeUpFlag' in server.flags, false);
  assert.equal(server.activeEvent, 'Summerechopwned');
  assert.equal(clean.schedules.length, 1, 'only the valid task for a known server survives');
  assert.deepEqual(clean.configs, {}, 'INI text for a server that is not in the file is dropped');
});

test('archive: an implausibly large INI is refused outright', () => {
  assert.throws(
    () =>
      archive.validateArchive({
        kind: 'asms.archive',
        version: 1,
        servers: [{ id: 'srv_ok', name: 'Fine' }],
        configs: { srv_ok: { gus: 'x'.repeat(600 * 1024), game: '' } },
      }),
    /larger than 512 KB/,
  );
});

// --------------------------------------------------------------- exporting

test('archive: an export carries the servers, their INI files and the passwords', () => {
  const server = seed();
  const bundle = archive.exportArchive();

  assert.equal(bundle.kind, 'asms.archive');
  assert.equal(bundle.hasSecrets, true);
  assert.equal(bundle.servers.length, 1);
  assert.equal(bundle.servers[0].adminPassword, 'hunter2');
  assert.match(bundle.configs[server.id].gus, /ServerAdminPassword=hunter2/);
  assert.match(bundle.configs[server.id].game, /BabyMatureSpeedMultiplier=25\.0/);
});

test('archive: exporting without secrets strips them from the record and the INI', () => {
  const server = seed();
  const bundle = archive.exportArchive({ includeSecrets: false });

  assert.equal(bundle.hasSecrets, false);
  assert.equal(bundle.servers[0].adminPassword, '');
  assert.equal(bundle.servers[0].serverPassword, '');
  assert.equal(bundle.settings.password, '');
  assert.doesNotMatch(bundle.configs[server.id].gus, /hunter2|joinme/);
  // Game settings are not secret and must survive the scrub.
  assert.match(bundle.configs[server.id].game, /BabyMatureSpeedMultiplier=25\.0/);
});

test('archive: the filename says which machine and which day', () => {
  const bundle = archive.exportArchive();
  assert.match(archive.fileName(bundle), /^asms-backup-.+-\d{4}-\d{2}-\d{2}\.asms-archive\.json$/);
});

// -------------------------------------------------------------- importing

test('archive: a round trip through JSON puts the servers back', () => {
  const server = seed();
  const bundle = archive.exportArchive();
  const onTheWire = JSON.parse(JSON.stringify(bundle)) as unknown;

  // Wipe, as a fresh install on another machine would be.
  const db = store.data();
  db.servers = [];
  db.schedules = [];
  servers.resyncRuntimes();

  const result = archive.importArchive(archive.validateArchive(onTheWire), { mode: 'replace' });

  assert.equal(result.servers.added, 1);
  assert.equal(store.data().servers.length, 1);
  const restored = store.data().servers[0];
  assert.equal(restored.id, server.id);
  assert.equal(restored.adminPassword, 'hunter2');
  assert.equal(restored.clusterId, 'ark-k3m9xq7p2wds');
  assert.deepEqual(restored.mods.map((mod) => mod.id), ['928988']);
  assert.match(config.readRaw(restored, 'game'), /BabyMatureSpeedMultiplier=25\.0/);
  assert.equal(servers.runtime(restored.id).state, 'stopped', 'a restored server gets a runtime of its own');
});

test('archive: importing without secrets still leaves a usable INI identity', () => {
  const server = seed();
  const bundle = JSON.parse(JSON.stringify(archive.exportArchive({ includeSecrets: false }))) as unknown;
  store.data().servers = [];
  servers.resyncRuntimes();

  archive.importArchive(archive.validateArchive(bundle), { mode: 'replace' });
  const restored = store.data().servers[0];
  assert.equal(restored.id, server.id);
  assert.equal(restored.adminPassword, '', 'a stripped password stays stripped');
  // syncIdentity still has to run, or the INI would keep no RCON port at all.
  assert.match(config.readRaw(restored, 'gus'), /RCONPort=27020/);
});

test('archive: rebasing paths moves an install under this machine’s root', () => {
  seed();
  const bundle = JSON.parse(JSON.stringify(archive.exportArchive())) as unknown;
  store.data().servers = [];
  servers.resyncRuntimes();

  archive.importArchive(archive.validateArchive(bundle), { mode: 'replace', rebasePaths: true });
  const restored = store.data().servers[0];
  assert.equal(path.dirname(restored.installPath), store.settings().defaultInstallRoot);
  assert.equal(restored.clusterDir, '', 'the cluster folder falls back to the local default');
});

test('archive: merging twice does not duplicate servers or schedules', () => {
  const server = seed();
  scheduler.create({ serverId: server.id, action: 'restart', cron: '0 6 * * *', name: 'Nightly' });

  const bundle = JSON.parse(JSON.stringify(archive.exportArchive())) as unknown;
  archive.importArchive(archive.validateArchive(bundle), { mode: 'merge' });
  archive.importArchive(archive.validateArchive(bundle), { mode: 'merge' });

  assert.equal(store.data().servers.length, 1);
  assert.equal(store.data().schedules.length, 1, 'an identical task is recognised rather than added again');
});

test('archive: a running server blocks an import instead of being rewritten under', () => {
  const server = seed();
  const bundle = archive.exportArchive() as ArchiveBundle;
  servers.runtime(server.id).state = 'running';
  try {
    assert.throws(() => archive.importArchive(bundle), /Stop Island/);
  } finally {
    servers.runtime(server.id).state = 'stopped';
  }
});

// ---------------------------------------------------------------- summary

test('archive: the summary says what would land on what', () => {
  const server = seed();
  const bundle = archive.exportArchive();
  const summary = archive.summarise(bundle);

  assert.equal(summary.counts.servers, 1);
  assert.equal(summary.servers[0].hasConfig, true);
  assert.match(summary.servers[0].conflict, /replaces "Island"/);

  // The same file read on a machine that has never seen this server.
  store.data().servers = [];
  servers.resyncRuntimes();
  fs.rmSync(server.installPath, { recursive: true, force: true });
  const fresh = archive.summarise(bundle);
  assert.equal(fresh.servers[0].conflict, '');
  assert.ok(fresh.warnings.some((line) => /install folders do not exist/.test(line)));
});
