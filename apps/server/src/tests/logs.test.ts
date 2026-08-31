import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileChunk, severityOf, fullPath } from '../core/logs.js';
import * as metrics from '../core/metrics.js';

function tempLog(contents = ''): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-log-'));
  const file = path.join(dir, 'ShooterGame.log');
  fs.writeFileSync(file, contents);
  return file;
}

// ------------------------------------------------------------- log tailing

test('logs: a missing file reads as empty rather than throwing', () => {
  const chunk = readFileChunk(path.join(os.tmpdir(), 'definitely-not-here.log'), 0);
  assert.deepEqual(chunk, { offset: 0, size: 0, text: '', rotated: false });
});

test('logs: offset 0 returns the whole file when it is small', () => {
  const file = tempLog('line one\nline two\nline three\n');
  const chunk = readFileChunk(file, 0);
  assert.equal(chunk.text, 'line one\nline two\nline three\n');
  assert.equal(chunk.offset, chunk.size);
});

test('logs: a second poll returns only what was appended', () => {
  const file = tempLog('first\n');
  const first = readFileChunk(file, 0);
  assert.equal(first.text, 'first\n');

  fs.appendFileSync(file, 'second\n');
  const second = readFileChunk(file, first.offset);
  assert.equal(second.text, 'second\n');
  assert.equal(second.rotated, false);

  // Nothing new: an empty chunk, and the offset does not move backwards.
  const third = readFileChunk(file, second.offset);
  assert.equal(third.text, '');
  assert.equal(third.offset, second.offset);
});

test('logs: only the tail is read when the file is larger than the window', () => {
  const body = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n') + '\n';
  const file = tempLog(body);
  const chunk = readFileChunk(file, 0, 2048);
  assert.ok(chunk.text.length <= 2048);
  assert.ok(chunk.text.includes('line 4999'), 'the newest lines must be present');
  assert.ok(!chunk.text.includes('line 0\n'), 'the oldest lines must be skipped');
});

test('logs: a tail never starts mid-line', () => {
  const body = Array.from({ length: 500 }, (_, i) => `line ${String(i).padStart(4, '0')}`).join('\n') + '\n';
  const file = tempLog(body);
  const chunk = readFileChunk(file, 0, 300);
  for (const line of chunk.text.split('\n').filter(Boolean)) {
    assert.match(line, /^line \d{4}$/, `partial line leaked through: ${JSON.stringify(line)}`);
  }
});

test('logs: rotation is detected and the viewer is told to restart', () => {
  const file = tempLog('old content that is fairly long\n');
  const first = readFileChunk(file, 0);
  assert.equal(first.rotated, false);

  // ARK rotates by truncating and starting over.
  fs.writeFileSync(file, 'new\n');
  const second = readFileChunk(file, first.offset);
  assert.equal(second.rotated, true);
  assert.equal(second.text, 'new\n');
});

test('logs: path traversal cannot escape the log directory', () => {
  // basename() neutralises the traversal and the prefix check backstops it, so
  // a crafted name resolves to a harmless file inside the log directory.
  const attempts = [
    '../../../../Windows/System32/drivers/etc/hosts',
    '..\\..\\..\\asms.json',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
  ];
  const logDir = path.dirname(fullPath('any', 'asms.log', 'asms'));
  for (const attempt of attempts) {
    const resolved = fullPath('any', attempt, 'asms');
    assert.equal(path.dirname(resolved), logDir, `"${attempt}" escaped to ${resolved}`);
    assert.ok(!resolved.includes('..'), `"${attempt}" left traversal in the path`);
  }
});

// ------------------------------------------------------ severity colouring

test('logs: severity classification matches what ARK actually writes', () => {
  assert.equal(severityOf('[2026.08.30-13.00.00:000][  0]LogTemp: Error: could not bind port'), 'error');
  assert.equal(severityOf('Warning: mod 893657 failed to mount'), 'warn');
  assert.equal(severityOf('[2026.08.30-13.00.00:000][  0]LogInit: Build: ++UE5+Release'), 'info');
  assert.equal(severityOf('Full Startup: 92.20 seconds'), 'plain');
});

test('logs: a line that names its own level is taken at its word', () => {
  // ARK's bundled GameAnalytics SDK logs the word "error" inside lines it has
  // itself labelled Debug, several times a minute. Colouring those red made a
  // perfectly healthy server look like it was on fire.
  assert.equal(severityOf('21:29:55 3456 10864 D Debug/GameAnalytics : sdk error content : {}'), 'plain');
  assert.equal(severityOf('21:29:54 3456 1716 W Warning/GameAnalytics : Validation fail - design event'), 'warn');
  assert.equal(severityOf('21:29:38 3456 1716 I Info/GameAnalytics : Event queue: No events to send'), 'info');
  // A real error still reads as one.
  assert.equal(severityOf('21:30:01 3456 1716 E Error/GameAnalytics : upload failed'), 'error');
});

// ----------------------------------------------------------------- metrics

test('metrics: history is capped and keeps the newest samples', () => {
  const id = 'srv_metrics_test';
  for (let i = 0; i < 250; i += 1) metrics.record(id, { cpu: i, memMB: i * 2, players: i % 10 });
  const points = metrics.history(id);
  assert.equal(points.length, 180, 'ring buffer must cap at 180 samples');
  assert.equal(points[points.length - 1].cpu, 249, 'the newest sample must survive');
  metrics.forget(id);
  assert.equal(metrics.history(id).length, 0);
});

test('metrics: combined player counts sum servers into one series', () => {
  metrics.record('a', { cpu: 0, memMB: 0, players: 3 });
  metrics.record('b', { cpu: 0, memMB: 0, players: 4 });
  const combined = metrics.combinedPlayers(['a', 'b']);
  assert.ok(combined.length >= 1);
  assert.equal(combined[combined.length - 1].players, 7, 'samples in the same bucket must add up');
  metrics.forget('a');
  metrics.forget('b');
});
