import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { parseIni, stringifyIni, getValue, getAll, setValue, setMulti, removeKey } from '../lib/ini.js';
import { cronMatches, nextRun, validateCron } from '../core/scheduler.js';
import { parsePlayers, parseArkIds, RCON_SILENT } from '../core/servers.js';
import { RconClient } from '../lib/rcon.js';
import { CREATURES, ITEMS, KITS, danglingSpawnRefs } from '../core/spawn.js';
import { worthAnotherRun } from '../lib/steamcmd.js';

// ------------------------------------------------------------------- INI

test('ini: round trips an untouched file byte for byte', () => {
  const source = ['[ServerSettings]', '; a comment', 'XPMultiplier=2.0', '', '[SessionSettings]', 'SessionName=My Server'].join('\r\n');
  const doc = parseIni(source);
  assert.equal(stringifyIni(doc).trimEnd(), source);
});

test('ini: reads values, including ones containing = and commas', () => {
  const doc = parseIni('[A]\nKey=Value\nOverride=(Level=1,Amount=2.5)\n');
  assert.equal(getValue(doc, 'A', 'Key'), 'Value');
  assert.equal(getValue(doc, 'A', 'Override'), '(Level=1,Amount=2.5)');
});

test('ini: section and key lookup is case insensitive', () => {
  const doc = parseIni('[ServerSettings]\nXPMultiplier=5.0\n');
  assert.equal(getValue(doc, 'serversettings', 'xpmultiplier'), '5.0');
});

test('ini: keeps repeated keys and can replace the whole set', () => {
  const doc = parseIni('[Game]\nEngram=A\nEngram=B\nOther=1\n');
  assert.deepEqual(getAll(doc, 'Game', 'Engram'), ['A', 'B']);
  setMulti(doc, 'Game', 'Engram', ['X', 'Y', 'Z']);
  assert.deepEqual(getAll(doc, 'Game', 'Engram'), ['X', 'Y', 'Z']);
  assert.equal(getValue(doc, 'Game', 'Other'), '1');
});

test('ini: setValue edits in place and appends inside the right section', () => {
  const doc = parseIni('[A]\nOne=1\n\n[B]\nTwo=2\n');
  setValue(doc, 'A', 'One', '99');
  setValue(doc, 'A', 'Three', '3');
  const text = stringifyIni(doc);
  assert.match(text, /\[A\]\r?\nOne=99\r?\nThree=3/);
  assert.match(text, /\[B\]\r?\nTwo=2/);
});

test('ini: creates a missing section rather than losing the value', () => {
  const doc = parseIni('[A]\nOne=1\n');
  setValue(doc, 'MessageOfTheDay', 'Message', 'hello');
  assert.equal(getValue(doc, 'MessageOfTheDay', 'Message'), 'hello');
});

test('ini: removeKey drops every occurrence', () => {
  const doc = parseIni('[A]\nX=1\nX=2\nY=3\n');
  removeKey(doc, 'A', 'X');
  assert.deepEqual(getAll(doc, 'A', 'X'), []);
  assert.equal(getValue(doc, 'A', 'Y'), '3');
});

// ------------------------------------------------------------------ cron

test('cron: validates field counts and ranges', () => {
  assert.equal(validateCron('0 6 * * *').ok, true);
  assert.equal(validateCron('*/15 * * * *').ok, true);
  assert.equal(validateCron('0 6 * *').ok, false);
  assert.equal(validateCron('99 6 * * *').ok, false);
});

test('cron: matches minute and hour', () => {
  const at = (h: number, m: number) => new Date(2026, 0, 5, h, m);
  assert.equal(cronMatches('0 6 * * *', at(6, 0)), true);
  assert.equal(cronMatches('0 6 * * *', at(6, 1)), false);
  assert.equal(cronMatches('0 */6 * * *', at(12, 0)), true);
  assert.equal(cronMatches('0 6,18 * * *', at(18, 0)), true);
});

test('cron: weekday field uses 0 for Sunday', () => {
  const monday = new Date(2026, 0, 5, 5, 0);
  assert.equal(monday.getDay(), 1);
  assert.equal(cronMatches('0 5 * * 1', monday), true);
  assert.equal(cronMatches('0 5 * * 0', monday), false);
});

test('cron: nextRun lands on the next matching minute', () => {
  const from = new Date(2026, 0, 5, 5, 30);
  const next = nextRun('0 6 * * *', from);
  assert.ok(next);
  const when = new Date(next);
  assert.equal(when.getHours(), 6);
  assert.equal(when.getMinutes(), 0);
  assert.equal(when.getDate(), 5);
});

test('cron: nextRun rolls over to tomorrow when today has passed', () => {
  const from = new Date(2026, 0, 5, 7, 0);
  const when = new Date(nextRun('0 6 * * *', from) as number);
  assert.equal(when.getDate(), 6);
  assert.equal(when.getHours(), 6);
});

// --------------------------------------------------------------- players

test('players: parses the ListPlayers response', () => {
  const text = '0. Smokey, 0002abc123def456\n1. Jax, 0002fff999aaa111\n';
  assert.deepEqual(parsePlayers(text), [
    { slot: 0, name: 'Smokey', id: '0002abc123def456' },
    { slot: 1, name: 'Jax', id: '0002fff999aaa111' },
  ]);
});

test('players: an empty server reports nobody', () => {
  assert.deepEqual(parsePlayers('No Players Connected'), []);
});

test('players: names containing punctuation survive', () => {
  assert.deepEqual(parsePlayers('3. Dr. Bones Jr, 0002deadbeef0001'), [
    { slot: 3, name: 'Dr. Bones Jr', id: '0002deadbeef0001' },
  ]);
});

// ------------------------------------------------------------------ RCON
// A stand-in RCON server lets us prove the wire format without ARK running.

function fakeRcon(password: string, reply: (cmd: string) => string): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
          const size = buffer.readInt32LE(0);
          if (buffer.length < size + 4) return;
          const id = buffer.readInt32LE(4);
          const type = buffer.readInt32LE(8);
          const body = buffer.subarray(12, 4 + size - 2).toString('utf8');
          buffer = buffer.subarray(4 + size);

          const send = (respId: number, respType: number, text: string) => {
            const payload = Buffer.from(text, 'utf8');
            const out = Buffer.alloc(14 + payload.length);
            out.writeInt32LE(payload.length + 10, 0);
            out.writeInt32LE(respId, 4);
            out.writeInt32LE(respType, 8);
            payload.copy(out, 12);
            socket.write(out);
          };

          if (type === 3) send(body === password ? id : -1, 2, '');
          else if (type === 2) send(id, 0, reply(body));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo;
      resolve({ port: address.port, close: () => server.close() });
    });
  });
}

test('rcon: authenticates and runs a command', async () => {
  const fake = await fakeRcon('hunter2', (cmd) => (cmd === 'ListPlayers' ? '0. Smokey, 0002abc' : `echo:${cmd}`));
  const client = new RconClient({ host: '127.0.0.1', port: fake.port, password: 'hunter2' });
  try {
    await client.connect();
    assert.equal(client.connected, true);
    assert.equal(await client.exec('ListPlayers'), '0. Smokey, 0002abc');
    assert.equal(await client.exec('SaveWorld'), 'echo:SaveWorld');
  } finally {
    client.close();
    fake.close();
  }
});

test('rcon: a wrong password fails loudly instead of hanging', async () => {
  const fake = await fakeRcon('correct', () => '');
  const client = new RconClient({ host: '127.0.0.1', port: fake.port, password: 'wrong', timeoutMs: 2000 });
  try {
    await assert.rejects(() => client.connect(), /authentication failed/i);
  } finally {
    client.close();
    fake.close();
  }
});

test('rcon: survives a response split across TCP packets', async () => {
  // Long output is exactly where a naive framing implementation breaks.
  const long = Array.from({ length: 200 }, (_, i) => `${i}. Player${i}, 0002${i}`).join('\n');
  const fake = await fakeRcon('pw', () => long);
  const client = new RconClient({ host: '127.0.0.1', port: fake.port, password: 'pw' });
  try {
    await client.connect();
    assert.equal(await client.exec('ListPlayers'), long);
    assert.equal(parsePlayers(await client.exec('ListPlayers')).length, 200);
  } finally {
    client.close();
    fake.close();
  }
});

test('rcon: a refused connection rejects instead of crashing the process', async () => {
  // EventEmitter rethrows an unhandled 'error' out of the event loop, which
  // turned every probe of a server that was not up yet into an uncaught
  // exception in the log.
  const port = await freePort();
  const client = new RconClient({ host: '127.0.0.1', port, password: 'x', timeoutMs: 2000 });
  const started = Date.now();
  await assert.rejects(() => client.connect(), /ECONNREFUSED|closed|refused/i);
  assert.ok(Date.now() - started < 1500, 'should fail on refusal, not wait for the timeout');
  client.close();
});

test('rcon: repeated failed connects do not pile up listeners', async () => {
  const port = await freePort();
  const client = new RconClient({ host: '127.0.0.1', port, password: 'x', timeoutMs: 1000 });
  for (let i = 0; i < 12; i += 1) {
    await client.connect().catch(() => {});
  }
  // The readiness probe retries every five seconds for up to twenty minutes;
  // one leaked listener per attempt is what produced MaxListenersExceeded.
  assert.equal(client.listenerCount('auth'), 0, 'auth listeners must be cleaned up on failure');
  client.close();
});

test('rcon: concurrent callers share one connection attempt', async () => {
  const port = await freePort();
  const client = new RconClient({ host: '127.0.0.1', port, password: 'x', timeoutMs: 1000 });
  const results = await Promise.allSettled([client.connect(), client.connect(), client.connect()]);
  assert.ok(results.every((r) => r.status === 'rejected'));
  assert.equal(client.listenerCount('auth'), 0);
  client.close();
});

// ------------------------------------------------------------------ spawn

test('spawn: every kit item and creature saddle resolves to a real item', () => {
  assert.deepEqual(danglingSpawnRefs(), []);
});

test('spawn: entity ids and gfi codes are unique and shaped like ARK class names', () => {
  const seen = new Set<string>();
  for (const creature of CREATURES) {
    assert.match(creature.cls, /^[A-Za-z0-9_]+$/, `${creature.name} has a suspicious entity id`);
    assert.ok(!seen.has(creature.name), `duplicate creature name: ${creature.name}`);
    seen.add(creature.name);
  }
  const codes = new Set<string>();
  for (const entry of ITEMS) {
    assert.match(entry.gfi, /^[A-Za-z0-9_]+$/, `${entry.name} has a suspicious gfi code`);
    assert.ok(!codes.has(entry.gfi), `duplicate gfi code: ${entry.gfi}`);
    codes.add(entry.gfi);
  }
});

test('spawn: blueprint paths are rooted and repeat the class name, as ARK expects', () => {
  for (const entry of ITEMS) {
    if (!entry.path) continue;
    assert.ok(entry.path.startsWith('/Game/'), `${entry.name} path is not rooted at /Game/`);
    assert.ok(!entry.path.includes('..'), `${entry.name} path is not resolved`);
    const tail = entry.path.slice(entry.path.lastIndexOf('/') + 1);
    const [asset, cls] = tail.split('.');
    assert.equal(cls, asset, `${entry.name} path does not repeat its class name`);
  }
});

test('spawn: no kit is empty', () => {
  for (const kit of KITS) assert.ok(kit.items.length > 0, `${kit.id} is empty`);
});

// ------------------------------------------------------------------ RCON

test('rcon: ARK\u2019s silent answer is recognised in the shapes it is written in', () => {
  assert.ok(RCON_SILENT.test('Server received, But no response!!'));
  assert.ok(RCON_SILENT.test('server received, but no response!'));
  assert.ok(RCON_SILENT.test('  Server received, But no response!!  '));
});

test('rcon: a real reply is not mistaken for silence', () => {
  assert.ok(!RCON_SILENT.test('No Players Connected'));
  assert.ok(!RCON_SILENT.test('0. Mark, 0002a1b3c4d5e6f7'));
  assert.ok(!RCON_SILENT.test('Server received, But no response!! and then some'));
});

// --------------------------------------------------------- player ids

test('players: the numeric Player ID is read out of an AdminCmd log line', () => {
  // Verbatim from a real ASA server log.
  const line =
    '[2026.09.02-10.29.11:686][822]2026.09.02_10.29.11: AdminCmd: showAdminManager (PlayerName: AFP_Smokey, ARKID: 827627995, PlatformID: 000283de23c04f9f81016833cce8691d)';
  assert.deepEqual(parseArkIds(line), {
    '000283de23c04f9f81016833cce8691d': { name: 'AFP_Smokey', arkId: '827627995' },
  });
});

test('players: a command with quotes and spaces in it does not swallow the ids', () => {
  const line =
    'AdminCmd: GMSummon "Gigant_Character_BP_C" 300 (PlayerName: AFP_Smokey, ARKID: 827627995, PlatformID: 000283DE23C04F9F81016833CCE8691D)';
  // Lower-cased, because ARK writes the same id in both cases across lines.
  assert.equal(parseArkIds(line)['000283de23c04f9f81016833cce8691d'].arkId, '827627995');
});

test('players: a join line carries no Player ID, so it contributes nothing', () => {
  const line = 'AFP_Smokey [UniqueNetId:000283de23c04f9f81016833cce8691d Platform:None] joined this ARK!';
  assert.deepEqual(parseArkIds(line), {});
});

test('players: the newest line wins when an id has been recorded more than once', () => {
  const text = [
    'AdminCmd: a (PlayerName: Old, ARKID: 111111111, PlatformID: aabbcc)',
    'AdminCmd: b (PlayerName: New, ARKID: 222222222, PlatformID: aabbcc)',
  ].join('\n');
  assert.deepEqual(parseArkIds(text).aabbcc, { name: 'New', arkId: '222222222' });
});

// -------------------------------------------------------------- SteamCMD

test('steamcmd: a first run that had not finished unpacking itself is worth another go', () => {
  // Copied from a real first install, where this failed every brand-new ASMS.
  const output = [
    'Connecting anonymously to Steam Public...OK',
    'Waiting for client config...OK',
    'Waiting for user info...OK',
    `ERROR! Failed to install app '2430930' (Missing configuration)`,
  ].join('\n');
  assert.equal(worthAnotherRun(output), true);
});

test('steamcmd: a failure that says something about the app is reported, not retried', () => {
  assert.equal(worthAnotherRun(`ERROR! Failed to install app '2430930' (No subscription)`), false);
  assert.equal(worthAnotherRun(`ERROR! Failed to install app '2430930' (Disk write failure)`), false);
  assert.equal(worthAnotherRun('ERROR! Timed out waiting for AppInfo update.'), false);
});

test('steamcmd: a run that reported success is never retried', () => {
  assert.equal(worthAnotherRun(`Success! App '2430930' fully installed.`), false);
});

/** A port with nothing on it, so a connection is refused rather than hanging. */
async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}
