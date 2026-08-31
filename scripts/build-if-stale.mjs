/**
 * Rebuild only when something actually changed.
 *
 * start.cmd used to build only when dist/ was missing entirely, so editing the
 * code and running start.cmd again silently launched the previous build - the
 * new setting you just added simply would not be there.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCES = [
  'apps/server/src',
  'apps/web/src',
  'apps/web/index.html',
  'apps/web/vite.config.ts',
  'apps/server/package.json',
  'apps/web/package.json',
  'package.json',
];

const BUILT = ['apps/server/dist/index.js', 'apps/web/dist/index.html'];

function newestMtime(target) {
  const full = path.join(root, target);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of fs.readdirSync(full, { withFileTypes: true, recursive: true })) {
    if (entry.isDirectory()) continue;
    const child = path.join(entry.parentPath ?? entry.path ?? full, entry.name);
    try {
      newest = Math.max(newest, fs.statSync(child).mtimeMs);
    } catch {
      /* vanished mid-scan */
    }
  }
  return newest;
}

const newestSource = Math.max(...SOURCES.map(newestMtime));
const oldestBuild = Math.min(...BUILT.map(newestMtime));

if (oldestBuild === 0) {
  console.log('Building the interface and the server for the first time...');
} else if (newestSource > oldestBuild) {
  console.log('Code has changed since the last build - rebuilding...');
} else {
  process.exit(0);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
