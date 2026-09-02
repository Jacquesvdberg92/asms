/**
 * Prints one version's section of CHANGELOG.md.
 *
 * The release workflow uses this for the GitHub release notes, so that what
 * people read on the Releases page is the same text that is in the repository
 * rather than a second description written by hand and drifting from it.
 *
 * Usage: node scripts/changelog-section.mjs 0.3.2
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = (process.argv[2] ?? '').trim().replace(/^v/, '');
if (!version) {
  console.error('Usage: node scripts/changelog-section.mjs <version>');
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lines = readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);

// Headings look like "## [0.3.2] — 2026-09-02". The version is matched exactly,
// so 0.3.1 can never be answered with 0.3.10.
const isHeading = (line) => /^##\s+\[/.test(line);
const wanted = (line) => isHeading(line) && line.slice(line.indexOf('[') + 1, line.indexOf(']')) === version;

const start = lines.findIndex(wanted);
if (start === -1) {
  console.error(`CHANGELOG.md has no section for ${version}.`);
  process.exit(1);
}

const rest = lines.slice(start + 1);
const end = rest.findIndex(isHeading);
const body = (end === -1 ? rest : rest.slice(0, end))
  // A "---" rule between entries belongs to the file, not to the release.
  .filter((line) => line.trim() !== '---')
  .join('\n')
  .trim();

console.log(body);
