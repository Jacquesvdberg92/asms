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

let stream: fs.WriteStream | null = null;

function file(): fs.WriteStream {
  if (!stream) {
    ensureDirs();
    const name = `asms-${new Date().toISOString().slice(0, 10)}.log`;
    stream = fs.createWriteStream(path.join(LOG_DIR, name), { flags: 'a' });
  }
  return stream;
}

function write(level: Level, scope: string, args: unknown[]): void {
  const ts = new Date().toISOString();
  const text = args
    .map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  const line = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${text}`;
  // eslint-disable-next-line no-console
  console.log(`${COLORS[level]}${line}\x1b[0m`);
  file().write(line + '\n');
}

export function logger(scope: string) {
  return {
    debug: (...a: unknown[]) => process.env.ASMS_DEBUG && write('debug', scope, a),
    info: (...a: unknown[]) => write('info', scope, a),
    warn: (...a: unknown[]) => write('warn', scope, a),
    error: (...a: unknown[]) => write('error', scope, a),
  };
}
