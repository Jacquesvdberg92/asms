import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { spawn } from 'node:child_process';
import AdmZip from 'adm-zip';
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

function download(url: string, dest: string, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'ASMS' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        download(res.headers.location, dest, onProgress).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download failed (HTTP ${res.statusCode}) for ${url}`));
        return;
      }
      const total = Number(res.headers['content-length'] ?? 0);
      let seen = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (c: Buffer) => {
        seen += c.length;
        if (total && onProgress) onProgress(Math.round((seen / total) * 100));
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('Download timed out')));
  });
}

/** Fetch and unpack SteamCMD into data/tools/steamcmd if it is not there yet. */
export async function ensureSteamCmd(onLine?: (line: string) => void): Promise<string> {
  const exe = steamCmdPath();
  if (fs.existsSync(exe)) return exe;
  ensureDir(STEAMCMD_DIR);
  onLine?.('SteamCMD not found - downloading from Valve...');

  if (process.platform === 'win32') {
    const zip = path.join(TOOLS_DIR, 'steamcmd.zip');
    await download(WIN_ZIP, zip, (p) => onLine?.(`Downloading SteamCMD... ${p}%`));
    new AdmZip(zip).extractAllTo(STEAMCMD_DIR, true);
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
  onLine?.('SteamCMD installed.');
  return target;
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
  const { code, output } = await runSteamCmd(args, opts.onLine, opts.onProgress, opts.onChild);
  const ok = new RegExp(`Success! App '${ASA_APP_ID}'`, 'i').test(output);
  if (!ok) {
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
