import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../lib/paths.js';
import { bus, notice } from '../lib/bus.js';
import { logger } from '../lib/log.js';
import { shutdownApp } from '../lib/lifecycle.js';

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
  /** Version at the top of the tracked branch, when it can be read. */
  latest: string | null;
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
    /**
     * Those shims are batch files, and since the fix for CVE-2024-27980 Node
     * refuses to spawn one directly - it throws EINVAL before the process
     * exists, which is not an event any handler here would ever see. A shell
     * is the supported way to run them, and safe for these two calls because
     * every argument is a literal written above.
     *
     * git is a real executable and stays shell-free: its arguments carry
     * branch names off a remote, and a shell would give those a way to mean
     * something other than an argument.
     */
    const viaShell = process.platform === 'win32' && WINDOWS_SHIMS.has(cmd);
    let child;
    try {
      child = spawn(cmd, args, { cwd: ROOT, windowsHide: true, shell: viaShell });
    } catch (err) {
      // A throw here would escape applyUpdate and surface as a bare "spawn
      // EINVAL", losing the step that failed and what to do about it.
      resolve({ code: -1, out: '', err: err instanceof Error ? err.message : String(err) });
      return;
    }

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
    latest: null,
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

  const [head, remote, count, subjects, manifest] = await Promise.all([
    git('rev-parse', '--short', 'HEAD'),
    git('rev-parse', '--short', `origin/${branch}`),
    git('rev-list', '--count', `HEAD..origin/${branch}`),
    git('log', '--no-merges', '--format=%s', '--max-count=20', `HEAD..origin/${branch}`),
    // The released version number, not just a commit count. "0.2.0 → 0.3.0"
    // means far more to the people this is built for than "14 commits behind".
    git('show', `origin/${branch}:package.json`),
  ]);

  const behind = count.code === 0 ? Number(count.out) : null;
  let latest: string | null = null;
  if (manifest.code === 0) {
    try {
      latest = (JSON.parse(manifest.out) as { version?: string }).version ?? null;
    } catch {
      latest = null; // Not worth failing an update check over.
    }
  }
  lastStatus = {
    ...base,
    latest,
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
  /** Set when the update was asked to restart ASMS and did. */
  restarting?: boolean;
}

// ---------------------------------------------------------------- restarting

/** Inside a container, exiting *is* the restart - the orchestrator brings it back. */
function inContainer(): boolean {
  return fs.existsSync('/.dockerenv') || process.env.ASMS_IN_CONTAINER === '1';
}

export interface RelaunchPlan {
  /** Whether ASMS arranged to start itself again, or is relying on something else to. */
  relaunched: boolean;
  how: string;
}

/**
 * Arrange for ASMS to be running again shortly after this process exits.
 *
 * The trick is that nothing inside a dying process can start its replacement:
 * the port is still held, and anything it spawns as a child is at the mercy of
 * how it was killed. So a tiny detached node process is started first, whose
 * only job is to watch this pid, wait for it to go, and start ASMS again.
 *
 * On Windows it relaunches start.cmd where there is one, because that is how
 * people start ASMS and it puts the console window back where they expect it.
 */
export function relaunch(): RelaunchPlan {
  if (inContainer()) {
    return {
      relaunched: false,
      how: 'ASMS is in a container, so it exits and Docker starts it again - that is what restart: unless-stopped is for.',
    };
  }

  const starter = path.join(ROOT, 'start.cmd');
  const useStarter = process.platform === 'win32' && fs.existsSync(starter);
  // `start` needs an empty title first, or it reads the path as the title.
  const spec = useStarter
    ? { exe: 'cmd.exe', args: ['/c', 'start', '', 'start.cmd'] }
    : { exe: process.execPath, args: process.argv.slice(1) };

  const waiter = `
    const { spawn } = require('child_process');
    const parent = ${process.pid};
    const alive = () => { try { process.kill(parent, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
    let waited = 0;
    const timer = setInterval(() => {
      waited += 250;
      if (alive() && waited < 30000) return;
      clearInterval(timer);
      spawn(${JSON.stringify(spec.exe)}, ${JSON.stringify(spec.args)}, {
        cwd: ${JSON.stringify(ROOT)},
        detached: true,
        stdio: 'ignore',
      }).unref();
      setTimeout(() => process.exit(0), 1000);
    }, 250);
  `;

  try {
    const child = spawn(process.execPath, ['-e', waiter], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    log.info(`relaunch armed via ${spec.exe} ${spec.args.join(' ')}`);
    return {
      relaunched: true,
      how: useStarter
        ? 'ASMS will close and start.cmd opens it again in a fresh window.'
        : 'ASMS will close and start itself again a moment later.',
    };
  } catch (err) {
    log.error('could not arrange a relaunch', err);
    return {
      relaunched: false,
      how: `ASMS could not arrange to start itself again (${err instanceof Error ? err.message : String(err)}). Start it by hand after it closes.`,
    };
  }
}

/**
 * Pulls, reinstalls dependencies and rebuilds. It deliberately stops short of
 * restarting: ASMS is started in too many ways - start.cmd, npm start, Docker,
 * a service - for a self-restart to be safe in all of them, and a manager that
 * fails to come back up is worse than one that asks to be restarted.
 */
export async function applyUpdate(opts: { restart?: boolean } = {}): Promise<UpdateResult> {
  if (running) return { ok: false, restartRequired: false, message: 'An update is already running.' };

  const status = await checkForUpdate();
  if (status.blocker) return { ok: false, restartRequired: false, message: status.blocker };
  if (!status.available) return { ok: false, restartRequired: false, message: 'ASMS is already up to date.' };

  // Refuse to touch a tree with local edits rather than throwing away work or
  // stopping half way through a merge conflict.
  const dirty = await git('status', '--porcelain', '--untracked-files=no');
  const changed =
    dirty.code === 0 && dirty.out
      ? dirty.out.split('\n').map((line) => line.slice(3).trim()).filter(Boolean)
      : [];
  /**
   * Except the lockfile. npm rewrites it whenever it disagrees with the
   * manifests - a stale entry, a different npm version, an optional dependency
   * that does not apply to this platform - and it does that during install,
   * which every ASMS install has run. Counting that as "your work" locked a
   * perfectly ordinary machine out of every future update, and npm regenerates
   * it on the next install anyway.
   */
  const edited = changed.filter((file) => file !== 'package-lock.json');
  if (edited.length) {
    return {
      ok: false,
      restartRequired: false,
      message: `This folder has local changes to ${edited.length} tracked file(s) - ${edited.slice(0, 4).join(', ')}${edited.length > 4 ? ', …' : ''}. Commit or discard them first: updating would overwrite them.`,
    };
  }

  running = true;
  const step = (line: string) => bus.emitEvent('app:update', { line });
  try {
    step(`Updating from ${status.currentSha ?? '?'} to ${status.latestSha ?? '?'} (${status.behind} commits)...`);

    if (changed.length) {
      step('Setting package-lock.json back to the committed one - npm rewrites it on install.');
      await git('checkout', '--', 'package-lock.json');
    }

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

    log.info(`updated to ${status.latestSha}`);
    await checkForUpdate();

    if (!opts.restart) {
      step('Done. Restart ASMS to finish.');
      notice('success', 'ASMS updated', 'Restart ASMS to load the new version. Your ARK servers keep running.');
      return { ok: true, restartRequired: true, message: 'Updated. Restart ASMS to load the new version.' };
    }

    const plan = restartApp(2000);
    step(`Done. ${plan.how}`);
    notice('success', 'ASMS updated', `${plan.how} Your ARK servers keep running.`);
    return {
      ok: true,
      restartRequired: true,
      restarting: true,
      message: `Updated to ${status.latestSha}. ${plan.how}`,
    };
  } finally {
    running = false;
  }
}

/**
 * Shut ASMS down cleanly, having already arranged for it to come back.
 *
 * The delay exists so the answer to the request that asked for this reaches the
 * browser before the socket it came in on is closed underneath it.
 */
export function restartApp(delayMs = 600): RelaunchPlan {
  const plan = relaunch();
  // Deliberately not unref'd: this timer is the restart, and nothing else
  // should be able to let the process settle before it fires.
  setTimeout(() => {
    void shutdownApp('restart requested from the dashboard');
  }, delayMs);
  return plan;
}

export function updateRunning(): boolean {
  return running;
}
