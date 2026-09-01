/**
 * Tests for the perimeter the rest of the suite never touched.
 *
 * Every one of these covers a bug that shipped: the settings endpoint that
 * could brick sign-in, the scheduler that accepted anything, the cron that
 * validated as fine and never fired, the password stored in the clear, and the
 * zip that escaped its destination on restore.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { hashPassword, verifyPassword, isHash } from '../lib/password.js';
import { validateSettings, publicSettings, applySettingsPatch, migrateSettings } from '../core/settings.js';
import { validateCron, nextRun } from '../core/scheduler.js';
import { checkWebhook } from '../lib/notify.js';
import { writeZip, extractZip, walkFolder } from '../lib/zip.js';
import { assertSafeToDelete } from '../core/servers.js';
import { identify, sameProcess, shutdownProcTools } from '../lib/proc.js';
import type { AppSettings } from '../types.js';

const baseSettings = (): AppSettings => ({
  steamCmdPath: 'C:\\ASA\\steamcmd.exe',
  launchWrapper: '',
  defaultInstallRoot: 'C:\\ASA\\servers',
  backupRoot: 'C:\\ASA\\backups',
  clusterRoot: 'C:\\ASA\\clusters',
  passwordHash: '',
  signInDisabled: false,
  bindHost: '0.0.0.0',
  port: 8787,
  updateCheckInterval: 30,
  autoStartDelay: 20,
  backupRetention: 20,
  accent: 'ember',
  discordWebhook: '',
  notifyOn: ['crash'],
  openBrowserOnStart: true,
});

// ------------------------------------------------------------------ settings

test('settings: a non-string password cannot reach the database', async () => {
  // This is the exact payload that used to brick every route: it was assigned,
  // saved, and then threw out of authRequired() on every request thereafter.
  const { settings } = await applySettingsPatch(baseSettings(), { password: 12345 });
  assert.equal(settings.passwordHash, '', 'a numeric password is ignored, not stored');
});

test('settings: junk types fall back to what was there instead of being trusted', () => {
  const next = validateSettings(
    { port: 'abc', backupRetention: -5, updateCheckInterval: 99999, accent: 'chartreuse', notifyOn: 'everything' },
    baseSettings(),
  );
  assert.equal(next.port, 8787);
  assert.equal(next.backupRetention, 20);
  assert.equal(next.updateCheckInterval, 30);
  assert.equal(next.accent, 'ember', 'an accent the UI cannot render is refused');
  assert.deepEqual(next.notifyOn, ['crash'], 'a non-array notifyOn keeps the previous list');
});

test('settings: an empty port field cannot become port zero', () => {
  assert.equal(validateSettings({ port: '' }, baseSettings()).port, 8787);
  assert.equal(validateSettings({ port: 0 }, baseSettings()).port, 8787);
  assert.equal(validateSettings({ port: 70000 }, baseSettings()).port, 8787);
  assert.equal(validateSettings({ port: 9000 }, baseSettings()).port, 9000);
});

test('settings: a bind address this machine could never listen on is refused', () => {
  assert.equal(validateSettings({ bindHost: 'my-pc.local' }, baseSettings()).bindHost, '0.0.0.0');
  assert.equal(validateSettings({ bindHost: '999.1.1.1' }, baseSettings()).bindHost, '0.0.0.0');
  assert.equal(validateSettings({ bindHost: '127.0.0.1' }, baseSettings()).bindHost, '127.0.0.1');
  assert.equal(validateSettings({ bindHost: 'localhost' }, baseSettings()).bindHost, 'localhost');
});

test('settings: the password never leaves the server', async () => {
  const current = { ...baseSettings(), passwordHash: await hashPassword('hunter2') };
  const shown = publicSettings(current) as Record<string, unknown>;
  assert.equal(shown.passwordHash, undefined, 'the hash is not sent to a client');
  assert.equal(shown.password, undefined, 'nor is anything called password');
  assert.equal(shown.passwordSet, true, 'only whether one is set');
});

test('settings: an omitted password leaves the existing one alone', async () => {
  const current = { ...baseSettings(), passwordHash: await hashPassword('hunter2') };
  const { settings, passwordChanged } = await applySettingsPatch(current, { accent: 'cyan' });
  assert.equal(settings.passwordHash, current.passwordHash);
  assert.equal(passwordChanged, false);
  assert.equal(settings.accent, 'cyan');
});

test('settings: an empty password clears it, and says so', async () => {
  const current = { ...baseSettings(), passwordHash: await hashPassword('hunter2') };
  const { settings, passwordChanged } = await applySettingsPatch(current, { password: '' });
  assert.equal(settings.passwordHash, '');
  assert.equal(passwordChanged, true, 'sessions have to be revoked');
});

test('settings: a webhook that is not a Discord webhook is refused on save', async () => {
  await assert.rejects(
    () => applySettingsPatch(baseSettings(), { discordWebhook: 'http://evil.example/hook' }),
    /Discord/,
  );
  const { settings } = await applySettingsPatch(baseSettings(), {
    discordWebhook: 'https://discord.com/api/webhooks/123456789/abcDEF-ghi_JKL',
  });
  assert.match(settings.discordWebhook, /^https:\/\/discord\.com/);
});

test('notify: webhook validation explains what is wrong', () => {
  assert.equal(checkWebhook('').ok, true, 'empty is how you switch it off');
  assert.equal(checkWebhook('https://discord.com/api/webhooks/1/abc').ok, true);
  const wrongHost = checkWebhook('https://example.com/api/webhooks/1/abc');
  assert.equal(wrongHost.ok, false);
  assert.match(wrongHost.ok === false ? wrongHost.error : '', /example\.com/);
  assert.equal(checkWebhook('https://discord.com/channels/1/2').ok, false, 'a channel link is not a webhook');
});

// ------------------------------------------------------------------ password

test('password: a stored hash is not the password', async () => {
  const hash = await hashPassword('hunter2');
  assert.ok(!hash.includes('hunter2'));
  assert.ok(isHash(hash));
  assert.equal(await verifyPassword('hunter2', hash), true);
  assert.equal(await verifyPassword('hunter3', hash), false);
  assert.equal(await verifyPassword('', hash), false);
});

test('password: two hashes of the same password differ', async () => {
  assert.notEqual(await hashPassword('same'), await hashPassword('same'), 'salted');
});

test('password: a corrupt or hand-edited hash locks up rather than opening', async () => {
  for (const bad of ['', 'plaintext', 'scrypt$x$8$1$aa$bb', 'scrypt$16384$8$1$$', 'not$even$close']) {
    assert.equal(await verifyPassword('anything', bad), false, `${bad} should not verify`);
  }
});

// -------------------------------------------------------------- first-run setup

/**
 * The question ASMS asks on first run, and the flag that remembers the answer.
 *
 * It used to invent a password and print it to the console instead - so anyone
 * who started ASMS from a shortcut, or pulled a fresh copy, met a sign-in
 * screen asking for a password that existed nowhere.
 */

test('setup: a fresh database has not answered the password question', async () => {
  const settings = await migrateSettings({}, baseSettings());
  assert.equal(settings.passwordHash, '', 'nothing is invented on our behalf');
  assert.equal(settings.signInDisabled, false, 'so first run asks');
});

test('setup: a database from before the flag is asked rather than left open', async () => {
  // 0.2.0 wrote no signInDisabled. An empty password there is not evidence that
  // anybody chose to run without one.
  const settings = await migrateSettings({ passwordHash: '' }, baseSettings());
  assert.equal(settings.signInDisabled, false);
});

test('setup: choosing no password is remembered, so it is only asked once', async () => {
  const { settings } = await applySettingsPatch(baseSettings(), { password: '' });
  assert.equal(settings.passwordHash, '');
  assert.equal(settings.signInDisabled, true);
  const reloaded = await migrateSettings({ ...settings }, baseSettings());
  assert.equal(reloaded.signInDisabled, true, 'the choice survives a restart');
});

test('setup: setting a password answers the question too', async () => {
  const { settings } = await applySettingsPatch(baseSettings(), { password: 'hunter2' });
  assert.equal(settings.signInDisabled, false);
  assert.equal(await verifyPassword('hunter2', settings.passwordHash), true);
});

test('setup: clearing the hash by hand is the way back in after a forgotten password', async () => {
  const withPassword = { ...baseSettings(), passwordHash: await hashPassword('hunter2') };
  // What the sign-in screen tells people to do: empty the field, restart.
  const cleared = await migrateSettings({ ...withPassword, passwordHash: '' }, baseSettings());
  assert.equal(cleared.signInDisabled, false, 'ASMS offers to set a new one instead of opening up');
});

// ----------------------------------------------------------------- scheduler

test('cron: an expression that never comes round is refused, not saved', () => {
  // Valid on every field and impossible as a date. This used to save happily as
  // a task that silently never fired.
  const result = validateCron('0 0 31 2 *');
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : '', /never comes round/);
  assert.equal(nextRun('0 0 31 2 *'), null);
});

test('cron: an impossible expression is cheap to reject', () => {
  // It used to walk 527,040 minutes re-parsing five fields on each one, which
  // cost 1.3 seconds of blocked event loop per call - on every dashboard load.
  const started = Date.now();
  for (let i = 0; i < 20; i += 1) nextRun('0 0 31 2 *');
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 500, `20 impossible-cron lookups took ${elapsed}ms, which is too slow`);
});

test('cron: ordinary expressions still land on the right minute', () => {
  const from = new Date('2026-03-10T05:30:00');
  assert.equal(new Date(nextRun('0 6 * * *', from)!).getHours(), 6);
  // 29 February exists in 2028, so this is possible - just far away.
  assert.notEqual(nextRun('0 0 29 2 *', new Date('2027-06-01T00:00:00')), null);
});

// ------------------------------------------------------------- pid identity

test('proc: a live process reports a real start time', async () => {
  const me = await identify(process.pid);
  assert.ok(me, 'our own process should be identifiable');
  assert.equal(me.pid, process.pid);
  assert.ok(me.name.length > 0, 'the executable name is readable');
  // Windows PowerShell serialises a DateTime as /Date(...)/, which parsed as
  // NaN and left this at 0 - making every comparison below meaningless.
  assert.ok(me.startedAt > 1_600_000_000_000, `startedAt should be epoch ms, got ${me.startedAt}`);
  assert.ok(me.startedAt <= Date.now() + 5000, 'and not in the future');
});

test('proc: sameProcess tells a recycled pid apart, and fails closed', async () => {
  const me = await identify(process.pid);
  assert.ok(me);
  assert.equal(sameProcess(me, await identify(process.pid)), true, 'the same run matches itself');

  // The case this exists for: after a reboot the OS hands the number to
  // something else, which always started later.
  assert.equal(sameProcess(me, { ...me, startedAt: me.startedAt + 600_000 }), false);
  assert.equal(sameProcess(me, { ...me, name: 'notepad' }), false);
  assert.equal(sameProcess(me, { ...me, pid: me.pid + 1 }), false);
  assert.equal(sameProcess(me, null), false);

  // Knowing nothing about either side is not a match. This used to return true,
  // which is what made the whole check worthless when the lookup failed.
  assert.equal(sameProcess({ pid: 1, name: '', startedAt: 0 }, { pid: 1, name: '', startedAt: 0 }), false);
  // A matching executable with no times is weaker evidence, but still evidence.
  assert.equal(sameProcess({ pid: 1, name: 'ark', startedAt: 0 }, { pid: 1, name: 'ark', startedAt: 0 }), true);
});

// -------------------------------------------------------------------- delete

test('servers: a recursive delete refuses anything that is not a server folder', () => {
  const root = path.parse(process.cwd()).root;
  assert.throws(() => assertSafeToDelete(root), /drive root/);
  assert.throws(() => assertSafeToDelete(os.homedir()), /not a server folder/i);
  // A real folder with nothing ARK-shaped in it, outside the install root.
  const stray = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-stray-'));
  assert.throws(() => assertSafeToDelete(stray), /does not look like an ARK server/);
  // The same folder passes once it looks like an install.
  fs.mkdirSync(path.join(stray, 'ShooterGame'));
  assert.doesNotThrow(() => assertSafeToDelete(stray));
  fs.rmSync(stray, { recursive: true, force: true });
});

// ----------------------------------------------------------------------- zip

test('zip: a round trip through a real archive keeps the files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-zip-'));
  const source = path.join(dir, 'SavedArks');
  fs.mkdirSync(path.join(source, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(source, 'TheIsland.ark'), 'world');
  fs.writeFileSync(path.join(source, 'nested', 'player.arkprofile'), 'profile');

  const zipFile = path.join(dir, 'out.zip');
  await writeZip(walkFolder(source, 'SavedArks'), zipFile);
  assert.ok(fs.statSync(zipFile).size > 0);

  const dest = path.join(dir, 'restored');
  fs.mkdirSync(dest);
  const written = await extractZip(zipFile, dest, {
    rename: (name) => (name.startsWith('SavedArks/') ? name.slice('SavedArks/'.length) : null),
  });
  assert.equal(written, 2);
  assert.equal(fs.readFileSync(path.join(dest, 'TheIsland.ark'), 'utf8'), 'world');
  assert.equal(fs.readFileSync(path.join(dest, 'nested', 'player.arkprofile'), 'utf8'), 'profile');
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A hand-built zip holding one stored (uncompressed) entry under whatever name
 * we like. yazl refuses to write a traversing name — sensible of it, and the
 * reason this has to be assembled by hand: the archive under test is the sort
 * an attacker writes, not the sort ASMS writes.
 */
function zipWithEntryName(entryName: string, body: string): Buffer {
  const name = Buffer.from(entryName, 'utf8');
  const data = Buffer.from(body, 'utf8');
  // CRC-32 of the payload, computed the long way to keep this dependency-free.
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  crc = ~crc >>> 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // local file header
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(0, 8); // method: stored
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); // central directory header
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);

  const localBlock = Buffer.concat([local, name, data]);
  const centralBlock = Buffer.concat([central, name]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralBlock.length, 12);
  end.writeUInt32LE(localBlock.length, 16);

  return Buffer.concat([localBlock, centralBlock, end]);
}

const savedArksOnly = (name: string) => (name.startsWith('SavedArks/') ? name.slice('SavedArks/'.length) : null);

test('zip: an entry that would write outside the destination is refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-slip-'));
  // An entry name that climbs out of wherever it is extracted. The old restore
  // took the prefix check at face value and passed the rest to the extractor.
  const zipFile = path.join(dir, 'evil.zip');
  fs.writeFileSync(zipFile, zipWithEntryName('SavedArks/../../escaped.txt', 'payload'));

  const dest = path.join(dir, 'a', 'b');
  fs.mkdirSync(dest, { recursive: true });
  await assert.rejects(() => extractZip(zipFile, dest, { rename: savedArksOnly }));
  assert.equal(fs.existsSync(path.join(dir, 'escaped.txt')), false, 'nothing was written outside');
  fs.rmSync(dir, { recursive: true, force: true });
});

test("zip: a rename that escapes the destination is refused by extractZip's own check", async () => {
  /**
   * yauzl rejects an absolute or traversing entry name before we ever see it,
   * so the test above never reaches extractZip's own guard. This one does: the
   * destination is also decided by the caller's `rename`, and that guard is
   * what holds the contract when a caller gets it wrong.
   */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-slip2-'));
  const zipFile = path.join(dir, 'plain.zip');
  fs.writeFileSync(zipFile, zipWithEntryName('SavedArks/TheIsland.ark', 'payload'));

  const dest = path.join(dir, 'a', 'b');
  fs.mkdirSync(dest, { recursive: true });
  await assert.rejects(
    () => extractZip(zipFile, dest, { rename: () => path.join('..', '..', 'escaped.txt') }),
    /outside the destination/,
  );
  assert.equal(fs.existsSync(path.join(dir, 'escaped.txt')), false, 'nothing was written outside');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('zip: an ordinary entry in the same archive still extracts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-ok-'));
  const zipFile = path.join(dir, 'fine.zip');
  fs.writeFileSync(zipFile, zipWithEntryName('SavedArks/TheIsland.ark', 'world'));
  const dest = path.join(dir, 'dest');
  fs.mkdirSync(dest);
  const written = await extractZip(zipFile, dest, {
    rename: (name) => (name.startsWith('SavedArks/') ? name.slice('SavedArks/'.length) : null),
  });
  assert.equal(written, 1);
  assert.equal(fs.readFileSync(path.join(dest, 'TheIsland.ark'), 'utf8'), 'world');
  fs.rmSync(dir, { recursive: true, force: true });
});

// The stats worker is a long-lived child; without this the suite would not exit.
test('proc: the PowerShell worker shuts down cleanly', () => {
  shutdownProcTools();
  assert.ok(true);
});
