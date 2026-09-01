import { spawn, execFile, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import dgram from 'node:dgram';
import os from 'node:os';
import { logger } from './log.js';

const log = logger('proc');
const isWin = process.platform === 'win32';

export function isAlive(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Identity of a running process, used to tell "the server we launched" apart
 * from "whatever inherited that pid after a reboot". Start time is the part
 * that cannot be faked by pid reuse: a recycled pid always starts later.
 */
export interface ProcIdentity {
  pid: number;
  /** Executable name, lowercased. Empty when it could not be read. */
  name: string;
  /** Process start time in epoch ms, rounded to the second. */
  startedAt: number;
}

/**
 * Read a process's name and start time.
 *
 * This is what makes an adopted pid trustworthy. Without it a pid file that
 * outlived an unclean shutdown points at whatever the OS has since given that
 * number to - and stopping "the server" would kill a stranger.
 */
export async function identify(pid: number): Promise<ProcIdentity | null> {
  if (!isAlive(pid)) return null;
  try {
    if (isWin) {
      /**
       * Epoch milliseconds are computed in PowerShell rather than parsed here.
       * Windows PowerShell serialises a DateTime as `/Date(1788267817056)/`,
       * which `new Date()` reads as NaN - so the start time silently came back
       * as 0, and a check that compares start times is worthless when both
       * sides are 0.
       */
      const text = await runPowerShell(
        `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | ` +
          `Select-Object Name,@{n='StartMs';e={[int64]($_.StartTime.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds}} | ` +
          `ConvertTo-Json -Compress`,
      );
      if (!text.trim()) return null;
      const row = JSON.parse(text) as { Name?: string; StartMs?: number };
      const started = Number(row.StartMs);
      return {
        pid,
        name: String(row.Name ?? '').toLowerCase(),
        startedAt: Number.isFinite(started) && started > 0 ? Math.round(started / 1000) * 1000 : 0,
      };
    }
    // ps prints elapsed seconds, which is stabler across clock changes than an
    // absolute start time read from /proc.
    const text = await run('ps', ['-o', 'comm=,etimes=', '-p', String(pid)]);
    const m = /^\s*(\S+)\s+(\d+)/.exec(text);
    if (!m) return null;
    return {
      pid,
      name: m[1].toLowerCase().replace(/^.*\//, ''),
      startedAt: Math.round((Date.now() - Number(m[2]) * 1000) / 1000) * 1000,
    };
  } catch {
    return null;
  }
}

/**
 * Do two identities describe the same run of the same program?
 *
 * Written to fail closed. An earlier version skipped each comparison when
 * either side was missing the value, which meant two identities carrying no
 * start time at all "matched" - and the whole point of this check is to catch a
 * pid the OS has handed to something else.
 */
export function sameProcess(a: ProcIdentity | null, b: ProcIdentity | null): boolean {
  if (!a || !b) return false;
  if (a.pid !== b.pid) return false;

  // The executable has to match whenever both sides know it.
  if (a.name && b.name && a.name !== b.name) return false;

  if (a.startedAt && b.startedAt) {
    // Clocks drift and ps rounds to the second, so allow a little slack. A
    // recycled pid is minutes or hours out, never seconds.
    return Math.abs(a.startedAt - b.startedAt) <= 5000;
  }

  // No start time to compare. A matching executable name is weaker evidence but
  // still real — a recycled pid landing on the same binary is unlikely. With
  // neither, there is nothing to go on and the answer is no.
  return Boolean(a.name && b.name && a.name === b.name);
}

/**
 * Kill a process and everything it spawned.
 *
 * On Windows taskkill /T walks the tree. On POSIX there is no tree to walk, so
 * the caller spawns detached - which makes the child a process group leader -
 * and we signal the negative pid to take the whole group. That matters most in
 * Docker, where ARK runs behind a Proton wrapper: signalling only the wrapper
 * leaves the real server holding the game port.
 */
export function killTree(pid: number, force = false): Promise<void> {
  return new Promise((resolve) => {
    if (!isAlive(pid)) return resolve();
    if (isWin) {
      const args = ['/PID', String(pid), '/T'];
      if (force) args.push('/F');
      execFile('taskkill', args, { windowsHide: true }, () => resolve());
      return;
    }
    const signal = force ? 'SIGKILL' : 'SIGTERM';
    try {
      // Negative pid = the process group. Falls back to the bare pid for a
      // child that never became a group leader.
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        /* already gone */
      }
    }
    resolve();
  });
}

interface Sample {
  cpuSeconds: number;
  memMB: number;
  at: number;
}

const lastSample = new Map<number, Sample>();
const cores = Math.max(1, os.cpus().length);

export interface ProcStats {
  cpu: number;
  memMB: number;
}

// ------------------------------------------------------ the PowerShell worker

/**
 * One long-lived PowerShell, fed commands on stdin.
 *
 * Sampling used to spawn a fresh `powershell -Command ...` every five seconds
 * for the life of the process. PowerShell costs 80-200 ms of CPU just to start,
 * so a manager whose whole job is leaving cycles for ARK was burning a slice of
 * a core in perpetuity - awake or idle, dashboard open or not. Keeping one
 * process alive and writing to its stdin removes all of it.
 *
 * Each command is followed by a sentinel echo, so a reply is complete the
 * moment the sentinel arrives rather than when some timeout expires.
 */
const SENTINEL = '<<<ASMS-EOF>>>';

interface Waiting {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

let worker: ChildProcess | null = null;
let workerBuffer = '';
let workerQueue: Waiting[] = [];
let workerBroken = false;

function stopWorker(): void {
  const dying = worker;
  worker = null;
  workerBuffer = '';
  const pending = workerQueue;
  workerQueue = [];
  for (const entry of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error('PowerShell worker stopped'));
  }
  dying?.stdin?.end();
  dying?.kill();
}

function startWorker(): ChildProcess | null {
  if (workerBroken) return null;
  try {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      workerBuffer += chunk;
      let at = workerBuffer.indexOf(SENTINEL);
      while (at >= 0) {
        const text = workerBuffer.slice(0, at);
        workerBuffer = workerBuffer.slice(at + SENTINEL.length);
        const entry = workerQueue.shift();
        if (entry) {
          clearTimeout(entry.timer);
          entry.resolve(text);
        }
        at = workerBuffer.indexOf(SENTINEL);
      }
    });
    child.on('error', () => stopWorker());
    child.on('exit', () => {
      if (worker === child) stopWorker();
    });
    child.unref();
    worker = child;
    return child;
  } catch (err) {
    // No PowerShell on this box, or spawn refused. Say so once and fall back.
    workerBroken = true;
    log.warn('could not start the PowerShell worker, falling back to one-shot calls', err);
    return null;
  }
}

/** Run one PowerShell command, reusing the worker when it is healthy. */
function runPowerShell(script: string): Promise<string> {
  const child = worker ?? startWorker();
  if (!child?.stdin?.writable) {
    // Fallback path: a fresh process, the way this used to work throughout.
    return run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
  }
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      // A wedged worker must not wedge the caller. Drop it; the next call
      // starts a fresh one.
      stopWorker();
      reject(new Error('PowerShell worker timed out'));
    }, 15_000);
    workerQueue.push({ resolve, reject, timer });
    // The trailing echo is what marks the end of this reply.
    child.stdin?.write(script + "\nWrite-Output '" + SENTINEL + "'\n");
  });
}

/** Let go of the worker on the way out, so nothing is left running. */
export function shutdownProcTools(): void {
  stopWorker();
}

/**
 * CPU and memory for every tracked pid, in one round trip. CPU is derived from
 * the delta in total processor seconds, so the first sample always reads 0.
 */
export async function sampleStats(pids: number[]): Promise<Map<number, ProcStats>> {
  const out = new Map<number, ProcStats>();
  const live = pids.filter((p) => p && isAlive(p));
  if (!live.length) return out;

  if (!isWin) {
    // ps gives us %cpu and RSS in one shot on POSIX.
    const text = await run('ps', ['-o', 'pid=,pcpu=,rss=', '-p', live.join(',')]).catch(() => '');
    for (const line of text.split('\n')) {
      const m = /^\s*(\d+)\s+([\d.]+)\s+(\d+)/.exec(line);
      if (m) out.set(Number(m[1]), { cpu: Number(m[2]), memMB: Number(m[3]) / 1024 });
    }
    return out;
  }

  const script = `Get-Process -Id ${live.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,CPU,WorkingSet64 | ConvertTo-Json -Compress`;
  const text = await runPowerShell(script).catch(() => '');
  if (!text.trim()) return out;
  let rows: Array<{ Id: number; CPU: number | null; WorkingSet64: number }>;
  try {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return out;
  }

  const now = Date.now();
  for (const row of rows) {
    const memMB = row.WorkingSet64 / 1024 / 1024;
    const cpuSeconds = row.CPU ?? 0;
    const prev = lastSample.get(row.Id);
    let cpu = 0;
    if (prev && now > prev.at) {
      const elapsed = (now - prev.at) / 1000;
      cpu = Math.max(0, ((cpuSeconds - prev.cpuSeconds) / elapsed / cores) * 100);
    }
    lastSample.set(row.Id, { cpuSeconds, memMB, at: now });
    out.set(row.Id, { cpu: Math.round(cpu * 10) / 10, memMB: Math.round(memMB) });
  }
  for (const pid of [...lastSample.keys()]) if (!isAlive(pid)) lastSample.delete(pid);
  return out;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) reject(err);
      else resolve(stdout);
    });
  });
}

/** True when nothing is listening/bound on the port. */
export function isPortFree(port: number, proto: 'tcp' | 'udp' = 'tcp'): Promise<boolean> {
  return new Promise((resolve) => {
    if (proto === 'tcp') {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(port, '0.0.0.0');
    } else {
      const sock = dgram.createSocket('udp4');
      sock.once('error', () => {
        sock.close();
        resolve(false);
      });
      sock.bind(port, '0.0.0.0', () => sock.close(() => resolve(true)));
    }
  });
}

/**
 * Walk upward from `start` until a free port is found.
 *
 * Throws rather than returning `start` when the range is exhausted: handing
 * back a port already known to be busy only moves the failure to ARK's own
 * startup, minutes later and with a far worse message.
 */
export async function findFreePort(start: number, proto: 'tcp' | 'udp', taken: number[] = []): Promise<number> {
  const end = Math.min(65536, start + 200);
  for (let port = start; port < end; port += 1) {
    if (taken.includes(port)) continue;
    if (await isPortFree(port, proto)) return port;
  }
  throw new Error(
    `No free ${proto.toUpperCase()} port between ${start} and ${end - 1}. Stop whatever is using them, or set the port by hand.`,
  );
}

/** Add inbound Windows Firewall rules for a server's ports. Needs admin. */
export async function addFirewallRules(name: string, ports: { game: number; query: number; rcon: number }): Promise<string> {
  if (!isWin) return 'Firewall rules are only managed on Windows.';
  const rules: Array<[string, string, number]> = [
    [`ASMS ${name} Game UDP`, 'UDP', ports.game],
    [`ASMS ${name} Game+1 UDP`, 'UDP', ports.game + 1],
    [`ASMS ${name} Query UDP`, 'UDP', ports.query],
    [`ASMS ${name} RCON TCP`, 'TCP', ports.rcon],
  ];
  const results: string[] = [];
  for (const [ruleName, proto, port] of rules) {
    try {
      await run('netsh', [
        'advfirewall',
        'firewall',
        'add',
        'rule',
        `name=${ruleName}`,
        'dir=in',
        'action=allow',
        `protocol=${proto}`,
        `localport=${port}`,
      ]);
      results.push(`ok  ${ruleName} (${proto}/${port})`);
    } catch (err) {
      log.warn('firewall rule failed', ruleName, err);
      results.push(`FAILED ${ruleName} - run ASMS as administrator`);
    }
  }
  return results.join('\n');
}

export { spawn };

/**
 * Can we open a TCP connection to this endpoint? Used to tell "RCON is not
 * listening" apart from "RCON is listening and rejected the password", which
 * are two completely different problems with the same symptom.
 */
export function canConnect(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}
