import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { extractZip } from './zip.js';
import { STEAMCMD_DIR, TOOLS_DIR, ASA_APP_ID, ark, ensureDir } from './paths.js';
import { settings } from './store.js';
import { logger } from './log.js';

const log = logger('steamcmd');

const WIN_ZIP = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';
const LINUX_TGZ = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz';

export function steamCmdPath(): string {
  const configured = settings().steamCmdPath;
  if (configured && fs.existsSync(configured)) return configured;
  return path.join(STEAMCMD_DIR, process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd.sh');
}

export function isSteamCmdInstalled(): boolean {
  return fs.existsSync(steamCmdPath());
}

/** Hosts Valve actually serves SteamCMD from. A redirect anywhere else is refused. */
const ALLOWED_HOSTS = /(^|\.)(akamaihd\.net|steamstatic\.com|steampowered\.com|valvesoftware\.com)$/i;

const MAX_REDIRECTS = 5;

/**
 * Fetch a file to disk.
 *
 * Redirects are followed but counted, and the destination host is checked each
 * hop: an unbounded redirect chain used to recurse until the stack gave out,
 * and nothing stopped a hop leaving Valve's CDN entirely. The download lands on
 * a `.part` file and is only renamed once it finishes, so a failed attempt can
 * never leave a truncated zip where the next run expects an archive.
 */
function download(url: string, dest: string, onProgress?: (pct: number) => void, hops = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      reject(new Error(`Not a usable download URL: ${url}`));
      return;
    }
    if (!ALLOWED_HOSTS.test(host)) {
      reject(new Error(`Refusing to download SteamCMD from ${host} - that is not one of Valve's servers.`));
      return;
    }

    const part = `${dest}.part`;
    const req = https.get(url, { headers: { 'User-Agent': 'ASMS' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (hops >= MAX_REDIRECTS) {
          reject(new Error(`Gave up after ${MAX_REDIRECTS} redirects fetching SteamCMD.`));
          return;
        }
        const next = new URL(res.headers.location, url).toString();
        download(next, dest, onProgress, hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download failed (HTTP ${res.statusCode}) for ${url}`));
        return;
      }
      const total = Number(res.headers['content-length'] ?? 0);
      let seen = 0;
      const out = fs.createWriteStream(part);
      const fail = (err: Error) => {
        out.destroy();
        fs.rmSync(part, { force: true });
        reject(err);
      };
      res.on('data', (c: Buffer) => {
        seen += c.length;
        if (total && onProgress) onProgress(Math.round((seen / total) * 100));
      });
      res.on('error', fail);
      res.pipe(out);
      out.on('finish', () =>
        out.close(() => {
          try {
            fs.renameSync(part, dest);
            resolve();
          } catch (err) {
            fail(err instanceof Error ? err : new Error(String(err)));
          }
        }),
      );
      out.on('error', fail);
    });
    req.on('error', (err) => {
      fs.rmSync(`${dest}.part`, { force: true });
      reject(err);
    });
    req.setTimeout(60_000, () => req.destroy(new Error('Download timed out')));
  });
}

/** In-flight install, shared so two callers cannot download over each other. */
let installing: Promise<string> | null = null;

/**
 * Fetch and unpack SteamCMD into data/tools/steamcmd if it is not there yet.
 *
 * Pressing Install on two servers at once, or pressing it while the automatic
 * one is already running, used to start two downloads writing the same file.
 */
export function ensureSteamCmd(onLine?: (line: string) => void): Promise<string> {
  const exe = steamCmdPath();
  if (fs.existsSync(exe)) return Promise.resolve(exe);
  if (installing) return installing;
  installing = doInstall(onLine).finally(() => {
    installing = null;
  });
  return installing;
}

async function doInstall(onLine?: (line: string) => void): Promise<string> {
  ensureDir(STEAMCMD_DIR);
  onLine?.('SteamCMD not found - downloading from Valve...');

  if (process.platform === 'win32') {
    const zip = path.join(TOOLS_DIR, 'steamcmd.zip');
    await download(WIN_ZIP, zip, (p) => onLine?.(`Downloading SteamCMD... ${p}%`));
    // extractZip refuses any entry that would resolve outside the destination.
    await extractZip(zip, STEAMCMD_DIR);
    fs.rmSync(zip, { force: true });
  } else {
    const tgz = path.join(TOOLS_DIR, 'steamcmd.tar.gz');
    await download(LINUX_TGZ, tgz, (p) => onLine?.(`Downloading SteamCMD... ${p}%`));
    await new Promise<void>((resolve, reject) => {
      const p = spawn('tar', ['-xzf', tgz, '-C', STEAMCMD_DIR], { stdio: 'ignore' });
      p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`tar exited ${c}`))));
      p.on('error', reject);
    });
    fs.rmSync(tgz, { force: true });
    fs.chmodSync(path.join(STEAMCMD_DIR, 'steamcmd.sh'), 0o755);
  }

  const target = path.join(STEAMCMD_DIR, process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd.sh');
  if (!fs.existsSync(target)) throw new Error('SteamCMD unpacked but the executable is missing');
  await bootstrap(onLine);
  onLine?.('SteamCMD installed.');
  return target;
}

/**
 * Run SteamCMD once with nothing riding on it, so it can finish installing itself.
 *
 * What Valve's zip holds is a 2013-era updater, not the client. Its first run
 * downloads the real client, unpacks it, restarts into it and carries on with
 * whatever commands it was handed - but the client it has just unpacked has no
 * app configuration yet, so an `app_update` in that same first run dies with
 * `Failed to install app '2430930' (Missing configuration)`.
 *
 * Every brand-new ASMS therefore failed on the first server it was asked to
 * download, and worked the moment you pressed the button again - which is not
 * something anybody should have to discover for themselves. Getting the
 * bootstrap over with here makes the download that follows the second run.
 */
async function bootstrap(onLine?: (line: string) => void): Promise<void> {
  onLine?.('Letting SteamCMD finish installing itself before the first download...');
  try {
    await runSteamCmd(['+login', 'anonymous', '+quit'], (line) => onLine?.(line));
  } catch (err) {
    // Never fatal: the run that matters comes next, and it reports its own failure.
    log.warn('SteamCMD warm-up run failed', err);
  }
}

export interface SteamRun {
  code: number;
  output: string;
}

/** Run SteamCMD, streaming every line back as it arrives. */
export function runSteamCmd(
  args: string[],
  onLine: (line: string) => void,
  onProgress?: (pct: number, text: string) => void,
  onChild?: (kill: () => void) => void,
): Promise<SteamRun> {
  const exe = steamCmdPath();
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true });
    onChild?.(() => child.kill());
    let output = '';
    let buffer = '';

    const handle = (text: string) => {
      output += text;
      buffer += text;
      // SteamCMD redraws its progress line with CR, so split on that too.
      const parts = buffer.split(/\r\n|\n|\r/);
      buffer = parts.pop() ?? '';
      for (const line of parts) {
        if (!line.trim()) continue;
        onLine(line);
        const m = /progress:\s*([\d.]+)\s*\(([\d]+)\s*\/\s*([\d]+)\)/i.exec(line);
        if (m && onProgress) {
          const done = Number(m[2]);
          const total = Number(m[3]);
          const mb = (n: number) => (n / 1024 / 1024).toFixed(0);
          onProgress(Number(m[1]), total ? `${mb(done)} MB / ${mb(total)} MB` : line.trim());
        } else if (/^Update state/i.test(line) && onProgress) {
          onProgress(-1, line.replace(/^Update state \(0x[0-9a-f]+\)\s*/i, '').trim());
        }
      }
    };

    child.stdout.on('data', (d: Buffer) => handle(d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => handle(d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      if (buffer.trim()) onLine(buffer);
      resolve({ code: code ?? -1, output });
    });
  });
}

export interface UpdateOptions {
  installPath: string;
  validate?: boolean;
  onLine: (line: string) => void;
  onProgress?: (pct: number, text: string) => void;
  /** Receives a function that kills the SteamCMD process, so the UI can cancel. */
  onChild?: (kill: () => void) => void;
}

/** SteamCMD saying it has not finished setting itself up, rather than that anything is wrong. */
const NOT_READY = /\(Missing configuration\)/i;

function reportedSuccess(output: string): boolean {
  return new RegExp(`Success! App '${ASA_APP_ID}'`, 'i').test(output);
}

/**
 * Was this run lost to SteamCMD still unpacking itself, rather than to anything
 * about the app it was asked for? Only that is worth going round again.
 */
export function worthAnotherRun(output: string): boolean {
  return !reportedSuccess(output) && NOT_READY.test(output);
}

/** Install or update the ASA dedicated server into installPath. */
export async function installOrUpdate(opts: UpdateOptions): Promise<void> {
  await ensureSteamCmd(opts.onLine);
  ensureDir(opts.installPath);
  const args = [
    '+force_install_dir',
    opts.installPath,
    '+login',
    'anonymous',
    '+app_update',
    ASA_APP_ID,
    ...(opts.validate ? ['validate'] : []),
    '+quit',
  ];
  opts.onLine(`> steamcmd ${args.join(' ')}`);
  let { code, output } = await runSteamCmd(args, opts.onLine, opts.onProgress, opts.onChild);

  /**
   * ensureSteamCmd warms up the copy it installs itself, but one that was
   * already on disk - pointed at by hand under Settings, or left behind by an
   * older ASMS that never warmed one up - has never had that done.
   * "Missing configuration" is precisely that state, and it clears itself, so
   * it is worth one more go rather than an error nobody can act on.
   */
  if (worthAnotherRun(output)) {
    opts.onLine('SteamCMD had not finished setting itself up. Trying again...');
    ({ code, output } = await runSteamCmd(args, opts.onLine, opts.onProgress, opts.onChild));
  }

  if (!reportedSuccess(output)) {
    const err = /Error!\s*(.+)/i.exec(output)?.[1]?.trim();
    throw new Error(err || `SteamCMD exited with code ${code} without reporting success`);
  }
  if (!fs.existsSync(ark.exe(opts.installPath))) {
    throw new Error('SteamCMD reported success but ArkAscendedServer.exe is missing - try a validate run');
  }
}

/** buildid recorded in the local appmanifest, or null if not installed. */
export function installedBuildId(installPath: string): string | null {
  const manifest = ark.appManifest(installPath);
  if (!fs.existsSync(manifest)) return null;
  const text = fs.readFileSync(manifest, 'utf8');
  return /"buildid"\s+"(\d+)"/i.exec(text)?.[1] ?? null;
}

let latestCache: { id: string; at: number } | null = null;

/**
 * Latest public buildid, straight from Steam via SteamCMD (no third-party API).
 * Cached for five minutes because app_info_print is slow.
 */
export async function latestBuildId(force = false): Promise<string | null> {
  if (!force && latestCache && Date.now() - latestCache.at < 5 * 60_000) return latestCache.id;
  if (!isSteamCmdInstalled()) return null;
  const args = ['+login', 'anonymous', '+app_info_update', '1', '+app_info_print', ASA_APP_ID, '+quit'];
  try {
    const { output } = await runSteamCmd(args, () => {});
    const branches = output.slice(output.search(/"branches"/i));
    const pub = branches.slice(branches.search(/"public"/i));
    const id = /"buildid"\s+"(\d+)"/i.exec(pub)?.[1] ?? null;
    if (id) latestCache = { id, at: Date.now() };
    return id;
  } catch (err) {
    log.warn('could not read latest build id', err);
    return null;
  }
}
