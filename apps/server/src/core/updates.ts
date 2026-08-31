import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../lib/paths.js';
import { bus, notice } from '../lib/bus.js';
import { logger } from '../lib/log.js';

const log = logger('updates');

/**
 * Updating ASMS itself, as opposed to the ARK servers it manages.
 *
 * This works through git rather than the GitHub API, because a git checkout is
 * how ASMS is installed and because it needs no token for a public repository.
 * A copy unpacked from a zip has no `.git` to pull into, so it is detected and
 * told plainly to re-download rather than left with a button that cannot work.
 */

export interface UpdateStatus {
  /** Version from the root package.json. */
  current: string;
  /** Short commit currently checked out, when this is a git install. */
  currentSha: string | null;
  /** Short commit at the top of the tracked branch. */
  latestSha: string | null;
  /** Commits between here and there, or null when it cannot be worked out. */
  behind: number | null;
  available: boolean;
  /** `owner/repo` when the remote is a GitHub one, for linking to the diff. */
  repo: string | null;
  branch: string | null;
  /** Subject lines of what would arrive, newest first. */
  changes: string[];
  /** Why updating is not possible right now, when it is not. */
  blocker: string | null;
  checkedAt: number;
}

let running = false;
let lastStatus: UpdateStatus | null = null;

// --------------------------------------------------------------- running git

interface RunResult {
  code: number;
  out: string;
  err: string;
}

/**
 * Runs a command in the ASMS folder. Output is streamed to the UI as it
 * arrives, because `npm install` is long enough that a silent button looks
 * broken.
 */
/**
 * Commands that are batch shims on Windows rather than real executables.
 * CreateProcess appends `.exe` by itself, so git needs no help - but appending
 * `.cmd` to it produces `git.cmd`, which does not exist, and every git call
 * fails as though this were not a git checkout at all.
 */
const WINDOWS_SHIMS = new Set(['npm', 'npx', 'yarn', 'pnpm']);

function run(cmd: string, args: string[], opts: { stream?: boolean } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const exe = process.platform === 'win32' && WINDOWS_SHIMS.has(cmd) ? `${cmd}.cmd` : cmd;
    // No shell: the arguments carry branch names off a remote, and a shell
    // would give those a way to mean something other than an argument.
    const child = spawn(exe, args, { cwd: ROOT, windowsHide: true });

    let out = '';
    let err = '';
    const feed = (chunk: string, into: 'out' | 'err') => {
      if (into === 'out') out += chunk;
      else err += chunk;
      if (!opts.stream) return;
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim()) bus.emitEvent('app:update', { line: line.trimEnd() });
      }
    };

    child.stdout?.on('data', (d: Buffer) => feed(d.toString(), 'out'));
    child.stderr?.on('data', (d: Buffer) => feed(d.toString(), 'err'));
    child.on('error', (e) => resolve({ code: -1, out, err: `${err}${e.message}` }));
    child.on('close', (code) => resolve({ code: code ?? -1, out: out.trim(), err: err.trim() }));
  });
}

const git = (...args: string[]) => run('git', args);

// ------------------------------------------------------------------ checking

/** Whether ASMS is a git checkout that git can actually operate on. */
async function gitInstall(): Promise<boolean> {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return false;
  return (await git('rev-parse', '--is-inside-work-tree')).code === 0;
}

function localVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** `owner/repo` out of any of the URL shapes git remotes come in. */
function parseRepo(url: string): string | null {
  const m = /github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export function lastCheck(): UpdateStatus | null {
  return lastStatus;
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  const base: UpdateStatus = {
    current: localVersion(),
    currentSha: null,
    latestSha: null,
    behind: null,
    available: false,
    repo: null,
    branch: null,
    changes: [],
    blocker: null,
    checkedAt: Date.now(),
  };

  if (!(await gitInstall())) {
    lastStatus = {
      ...base,
      blocker:
        'This copy of ASMS was not installed with git, so there is nothing to pull into. Download the latest release and unpack it over this folder, keeping your data folder as it is.',
    };
    return lastStatus;
  }

  const branchRes = await git('rev-parse', '--abbrev-ref', 'HEAD');
  const branch = branchRes.code === 0 ? branchRes.out : null;
  if (!branch || branch === 'HEAD') {
    lastStatus = { ...base, branch, blocker: 'This checkout is not on a branch, so ASMS cannot tell what to update to.' };
    return lastStatus;
  }

  const remoteRes = await git('remote', 'get-url', 'origin');
  const repo = remoteRes.code === 0 ? parseRepo(remoteRes.out) : null;

  // Fetch is the only step that needs the network; a machine with no route out
  // should say so rather than silently reporting "up to date".
  const fetched = await git('fetch', '--quiet', 'origin', branch);
  if (fetched.code !== 0) {
    lastStatus = {
      ...base,
      branch,
      repo,
      blocker: `Could not reach the update server: ${fetched.err.split('\n')[0] || 'git fetch failed'}`,
    };
    return lastStatus;
  }

  const [head, remote, count, subjects] = await Promise.all([
    git('rev-parse', '--short', 'HEAD'),
    git('rev-parse', '--short', `origin/${branch}`),
    git('rev-list', '--count', `HEAD..origin/${branch}`),
    git('log', '--no-merges', '--format=%s', '--max-count=20', `HEAD..origin/${branch}`),
  ]);

  const behind = count.code === 0 ? Number(count.out) : null;
  lastStatus = {
    ...base,
    currentSha: head.code === 0 ? head.out : null,
    latestSha: remote.code === 0 ? remote.out : null,
    behind,
    available: (behind ?? 0) > 0,
    repo,
    branch,
    changes: subjects.code === 0 ? subjects.out.split('\n').filter(Boolean) : [],
  };
  return lastStatus;
}

// ------------------------------------------------------------------ applying

export interface UpdateResult {
  ok: boolean;
  /** True once files have changed and only a restart is outstanding. */
  restartRequired: boolean;
  message: string;
}

/**
 * Pulls, reinstalls dependencies and rebuilds. It deliberately stops short of
 * restarting: ASMS is started in too many ways - start.cmd, npm start, Docker,
 * a service - for a self-restart to be safe in all of them, and a manager that
 * fails to come back up is worse than one that asks to be restarted.
 */
export async function applyUpdate(): Promise<UpdateResult> {
  if (running) return { ok: false, restartRequired: false, message: 'An update is already running.' };

  const status = await checkForUpdate();
  if (status.blocker) return { ok: false, restartRequired: false, message: status.blocker };
  if (!status.available) return { ok: false, restartRequired: false, message: 'ASMS is already up to date.' };

  // Refuse to touch a tree with local edits rather than throwing away work or
  // stopping half way through a merge conflict.
  const dirty = await git('status', '--porcelain', '--untracked-files=no');
  if (dirty.code === 0 && dirty.out) {
    return {
      ok: false,
      restartRequired: false,
      message: `This folder has local changes to ${dirty.out.split('\n').length} tracked file(s). Commit or discard them first - updating would overwrite them.`,
    };
  }

  running = true;
  const step = (line: string) => bus.emitEvent('app:update', { line });
  try {
    step(`Updating from ${status.currentSha ?? '?'} to ${status.latestSha ?? '?'} (${status.behind} commits)...`);

    const pull = await run('git', ['merge', '--ff-only', `origin/${status.branch}`], { stream: true });
    if (pull.code !== 0) {
      const message = `Update failed while pulling: ${pull.err.split('\n')[0] || 'git merge failed'}`;
      notice('error', 'Update failed', message);
      return { ok: false, restartRequired: false, message };
    }

    step('Installing dependencies...');
    const install = await run('npm', ['install', '--no-audit', '--no-fund'], { stream: true });
    if (install.code !== 0) {
      const message = 'Files were updated but npm install failed. Run it by hand in the ASMS folder, then restart.';
      notice('error', 'Update incomplete', message);
      return { ok: false, restartRequired: true, message };
    }

    step('Rebuilding...');
    const build = await run('npm', ['run', 'build'], { stream: true });
    if (build.code !== 0) {
      const message = 'Files were updated but the build failed. Run "npm run build" in the ASMS folder, then restart.';
      notice('error', 'Update incomplete', message);
      return { ok: false, restartRequired: true, message };
    }

    step('Done. Restart ASMS to finish.');
    log.info(`updated to ${status.latestSha}`);
    notice('success', 'ASMS updated', 'Restart ASMS to load the new version. Your ARK servers keep running.');
    await checkForUpdate();
    return { ok: true, restartRequired: true, message: 'Updated. Restart ASMS to load the new version.' };
  } finally {
    running = false;
  }
}

export function updateRunning(): boolean {
  return running;
}
