import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR, ensureDirs } from './paths.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const COLORS: Record<Level, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

/** How many days of ASMS's own logs to keep. */
const KEEP_DAYS = 30;

let stream: fs.WriteStream | null = null;
/** The day the open stream belongs to, so a long run rolls over at midnight. */
let streamDay = '';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The log file for right now.
 *
 * The stream used to be opened once and reused for the life of the process,
 * which meant a machine left up for a month wrote the whole month into the file
 * named after the day it booted. The date is checked on every write instead -
 * it is a string compare, and it is the only thing that makes the daily
 * filename mean what it says.
 */
function file(): fs.WriteStream {
  const day = today();
  if (stream && streamDay === day) return stream;
  stream?.end();
  ensureDirs();
  stream = fs.createWriteStream(path.join(LOG_DIR, `asms-${day}.log`), { flags: 'a' });
  // A write error must never take the process down; the console still has it.
  stream.on('error', () => {});
  streamDay = day;
  prune();
  return stream;
}

/**
 * Delete logs older than KEEP_DAYS. Called on every rollover, so an unattended
 * machine tidies up after itself rather than filling the disk one day at a time.
 */
function prune(): void {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  try {
    for (const name of fs.readdirSync(LOG_DIR)) {
      const match = /^asms-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
      if (!match) continue;
      if (new Date(`${match[1]}T00:00:00Z`).getTime() >= cutoff) continue;
      fs.rmSync(path.join(LOG_DIR, name), { force: true });
    }
  } catch {
    /* the directory will be there next time */
  }
}

function write(level: Level, scope: string, args: unknown[]): void {
  const ts = new Date().toISOString();
  const text = args
    .map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === 'string' ? a : safeJson(a)))
    .join(' ');
  const line = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${text}`;
  // eslint-disable-next-line no-console
  console.log(`${COLORS[level]}${line}\x1b[0m`);
  file().write(line + '\n');
}

/** A circular object in a log argument must not throw from inside the logger. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function logger(scope: string) {
  return {
    debug: (...a: unknown[]) => process.env.ASMS_DEBUG && write('debug', scope, a),
    info: (...a: unknown[]) => write('info', scope, a),
    warn: (...a: unknown[]) => write('warn', scope, a),
    error: (...a: unknown[]) => write('error', scope, a),
  };
}

/** Flush and release the log file on the way out. */
export function closeLog(): void {
  stream?.end();
  stream = null;
  streamDay = '';
}
