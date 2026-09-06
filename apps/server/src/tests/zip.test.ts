import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeZip, extractZip, walkFolder } from '../lib/zip.js';

const scratch = (label: string) => fs.mkdtempSync(path.join(os.tmpdir(), `asms-zip-${label}-`));

test('zip: a folder of files survives the round trip intact', async () => {
  const src = scratch('round');
  fs.mkdirSync(path.join(src, 'nested'));
  fs.writeFileSync(path.join(src, 'world.ark'), 'A'.repeat(200_000));
  fs.writeFileSync(path.join(src, 'nested', 'player.arkprofile'), 'profile bytes');

  const zipFile = path.join(scratch('out'), 'backup.zip');
  await writeZip(walkFolder(src, 'SavedArks'), zipFile);

  const dest = scratch('dest');
  const count = await extractZip(zipFile, dest);
  assert.equal(count, 2);
  assert.equal(fs.readFileSync(path.join(dest, 'SavedArks', 'world.ark'), 'utf8').length, 200_000);
  assert.equal(fs.readFileSync(path.join(dest, 'SavedArks', 'nested', 'player.arkprofile'), 'utf8'), 'profile bytes');
});

test('zip: a file that vanished before the run is skipped, the rest still archived', async () => {
  const src = scratch('gone');
  fs.writeFileSync(path.join(src, 'keep.ark'), 'kept');
  fs.writeFileSync(path.join(src, 'rotating.arkrbf'), 'about to rotate');

  const entries = walkFolder(src, 'SavedArks');
  fs.rmSync(path.join(src, 'rotating.arkrbf'));

  const zipFile = path.join(scratch('out'), 'backup.zip');
  await writeZip(entries, zipFile);

  const dest = scratch('dest');
  assert.equal(await extractZip(zipFile, dest), 1);
  assert.equal(fs.readFileSync(path.join(dest, 'SavedArks', 'keep.ark'), 'utf8'), 'kept');
});

test('zip: a save pulled out from under the run fails the backup, not the process', async () => {
  /**
   * This is the one that took ASMS down. yazl reports a bad entry by emitting
   * 'error' on the ZipFile, and with nothing listening that is an uncaught
   * exception - which is a dead manager, not a failed backup. Under the old
   * code this test does not fail, it kills the runner.
   */
  const src = scratch('pulled');
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(src, `save-${i}.ark`), 'X'.repeat(200_000));

  const zipFile = path.join(scratch('out'), 'backup.zip');
  const running = writeZip(walkFolder(src, 'SavedArks'), zipFile);
  // Every stat is done by the time writeZip has handed back its promise, so
  // this lands between the walk and that file's turn at the pump.
  fs.rmSync(path.join(src, 'save-39.ark'));

  // Either outcome is correct - what matters is that it settles at all, and
  // that a run which gave up leaves no half-written zip pretending otherwise.
  await running.then(
    () => assert.ok(fs.existsSync(zipFile), 'a run that finished should leave its archive'),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(!fs.existsSync(zipFile), 'a failed run must not leave a partial archive behind');
    },
  );
});
