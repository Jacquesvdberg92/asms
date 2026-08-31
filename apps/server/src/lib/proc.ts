import { spawn, execFile } from 'node:child_process';
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

/** Kill a process and everything it spawned. */
export function killTree(pid: number, force = false): Promise<void> {
  return new Promise((resolve) => {
    if (!isAlive(pid)) return resolve();
    if (isWin) {
      const args = ['/PID', String(pid), '/T'];
      if (force) args.push('/F');
      execFile('taskkill', args, { windowsHide: true }, () => resolve());
    } else {
      try {
        process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
      } catch {
        /* already gone */
      }
      resolve();
    }
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

/**
 * One PowerShell round trip for every tracked pid. CPU is derived from the
 * delta in total processor seconds, so the first sample always reads 0.
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
  const text = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]).catch(() => '');
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

/** Walk upward from `start` until a free port is found. */
export async function findFreePort(start: number, proto: 'tcp' | 'udp', taken: number[] = []): Promise<number> {
  for (let port = start; port < start + 200; port += 1) {
    if (taken.includes(port)) continue;
    if (await isPortFree(port, proto)) return port;
  }
  return start;
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
