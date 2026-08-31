import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  checkInstallPath,
  deepestModPath,
  INSTALL_PATH_LIMIT,
  INSTALL_PATH_SAFE,
  WIN_DIR_LIMIT,
  WIN_FILE_LIMIT,
} from '../lib/paths.js';

// ------------------------------------------------------- install path length

/**
 * The layout is modelled rather than counted, so the model has to keep matching
 * reality. These two came off a real machine: the first is a mod that installed
 * fine, the second is the exact directory ARK failed to create.
 */
test('paths: reproduces a real installed mod file, character for character', () => {
  const built = deepestModPath('C:\\ASA\\servers\\qwer', 'TG_Stack_1000_50').replace('\\.temp\\9999999_99999999', '\\929800_7739804');
  assert.equal(
    built,
    'C:\\ASA\\servers\\qwer\\ShooterGame\\Binaries\\Win64\\ShooterGame\\Mods\\83374\\929800_7739804\\TG_Stack_1000_50\\Content\\Paks\\WindowsServer\\TG_Stack_1000_50ShooterGame-WindowsServer.utoc',
  );
  assert.equal(built.length, 175);
});

test('paths: reproduces the directory Windows refused to create', () => {
  // A real server was created 140 characters deep, in a temp folder carrying a
  // workspace hash and a session id one after the other. Super Spyglass then
  // downloaded, unpacked three files, and died on the fourth directory.
  const head = 'C:/Users/example/AppData/Local/Temp/';
  const tail = '/servers/island';
  const root = head + 'w'.repeat(140 - head.length - tail.length) + tail;
  assert.equal(root.length, 140);

  const dir = path.win32.dirname(deepestModPath(root, 'SuperSpyglassMod')).replace('9999999_99999999', '928988_6570486');
  assert.equal(dir.length, 255, 'the exact length Windows rejected');
  assert.ok(dir.length > WIN_DIR_LIMIT, 'the failure this guard exists for must land over the limit');
  assert.equal(checkInstallPath(root).level, 'blocked');
});

test('paths: thresholds leave room for a real mod and stay under the Windows limits', () => {
  assert.ok(INSTALL_PATH_SAFE < INSTALL_PATH_LIMIT);
  // At the safe ceiling, even a 28-character mod folder fits both limits.
  const roomy = deepestModPath('R'.repeat(INSTALL_PATH_SAFE), 'M'.repeat(28));
  assert.ok(roomy.length <= WIN_FILE_LIMIT, `file path ${roomy.length} > ${WIN_FILE_LIMIT}`);
  assert.ok(path.win32.dirname(roomy).length <= WIN_DIR_LIMIT);
  // One character past the hard limit, an ordinary 16-character mod does not.
  const over = deepestModPath('R'.repeat(INSTALL_PATH_LIMIT + 1), 'M'.repeat(16));
  assert.ok(over.length > WIN_FILE_LIMIT || path.win32.dirname(over).length > WIN_DIR_LIMIT);
});

test('paths: grades ordinary install folders as ok', () => {
  for (const root of ['C:\\ASA\\servers\\island', 'C:\\ASA\\servers\\ragnarok-ragers', 'D:\\Games\\ARK Servers\\the-center']) {
    assert.equal(checkInstallPath(root).level, 'ok', root);
    assert.equal(checkInstallPath(root).message, null);
  }
});

test('paths: warns in the band where only long mod names break', () => {
  const check = checkInstallPath('C:\\' + 'x'.repeat(INSTALL_PATH_SAFE));
  assert.equal(check.level, 'warn');
  assert.equal(check.over, 3);
  assert.match(check.message ?? '', /3 characters/);
});

test('paths: an empty or blank folder is not judged', () => {
  assert.equal(checkInstallPath('').level, 'ok');
  assert.equal(checkInstallPath('   ').level, 'ok');
});

test('paths: a trailing separator is not counted against the budget', () => {
  const bare = 'C:\\' + 'x'.repeat(INSTALL_PATH_SAFE - 3);
  assert.equal(checkInstallPath(bare).level, 'ok');
  assert.equal(checkInstallPath(bare + '\\').level, 'ok');
  assert.equal(checkInstallPath(bare + '/').length, INSTALL_PATH_SAFE);
});
