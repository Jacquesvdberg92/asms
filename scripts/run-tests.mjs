/**
 * Runs the test suite.
 *
 * `node --test src/tests/*.test.ts` looks like it should be enough, but the
 * glob has to be expanded by somebody: a POSIX shell does it, cmd.exe does not,
 * and Node only started expanding globs itself in v22. On Windows with Node 20 -
 * inside our supported range, and the most likely combination for someone
 * running ASMS on their gaming PC - nothing expanded it and the whole suite
 * failed with "Could not find src/tests/*.test.ts".
 *
 * So the file list is built here and passed explicitly, which behaves the same
 * on every supported version and platform.
 */
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = path.join(repoRoot, 'apps', 'server');
const testDir = path.join(serverRoot, 'src', 'tests');

const files = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => path.join('src', 'tests', name));

if (!files.length) {
  console.error(`No *.test.ts files found in ${testDir}`);
  process.exit(1);
}

const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...files, ...process.argv.slice(2)], {
  cwd: serverRoot,
  stdio: 'inherit',
});

child.on('close', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error(err.message);
  process.exit(1);
});
