import fs from 'node:fs';
import path from 'node:path';
import { ark, LOG_DIR } from '../lib/paths.js';
import { need } from './servers.js';

export interface LogFileInfo {
  name: string;
  sizeBytes: number;
  modifiedAt: number;
}

export interface LogChunk {
  /** Byte offset to pass back on the next poll. */
  offset: number;
  size: number;
  text: string;
  /** True when the file shrank, meaning it was rotated or truncated. */
  rotated: boolean;
}

/** Logs written by ARK itself. */
export type LogSource = 'server' | 'asms';

const MAX_CHUNK = 512 * 1024;

function dirFor(serverId: string, source: LogSource): string {
  if (source === 'asms') return LOG_DIR;
  return ark.logDir(need(serverId).installPath);
}

/** Never let a crafted name escape the directory it belongs to. */
function resolveLog(dir: string, file: string): string {
  const resolved = path.resolve(dir, path.basename(file));
  if (!resolved.startsWith(path.resolve(dir) + path.sep) && resolved !== path.resolve(dir)) {
    throw new Error('Invalid log file name');
  }
  return resolved;
}

export function listFiles(serverId: string, source: LogSource = 'server'): LogFileInfo[] {
  let dir: string;
  try {
    dir = dirFor(serverId, source);
  } catch {
    return [];
  }
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /\.(log|txt)$/i.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, sizeBytes: stat.size, modifiedAt: stat.mtimeMs };
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/**
 * Incremental read used by the Logs tab: pass offset 0 for the tail of the
 * file, then hand back the offset you were given to stream only new bytes.
 *
 * A file that shrank means ARK rotated it, so we restart from its new tail and
 * say so, rather than reading garbage from a stale offset.
 */
export function readChunk(
  serverId: string,
  file: string,
  offset: number,
  source: LogSource = 'server',
  tailBytes = 96 * 1024,
): LogChunk {
  return readFileChunk(resolveLog(dirFor(serverId, source), file), offset, tailBytes);
}

/** The tailing core, on an absolute path. Exported so it can be tested directly. */
export function readFileChunk(target: string, offset: number, tailBytes = 96 * 1024): LogChunk {
  if (!fs.existsSync(target)) return { offset: 0, size: 0, text: '', rotated: false };
  const size = fs.statSync(target).size;

  let rotated = false;
  let from = offset;
  if (offset <= 0) from = Math.max(0, size - tailBytes);
  if (offset > size) {
    rotated = true;
    from = Math.max(0, size - tailBytes);
  }
  const length = Math.min(size - from, MAX_CHUNK);
  if (length <= 0) return { offset: size, size, text: '', rotated };

  const fd = fs.openSync(target, 'r');
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, from);
    let text = buffer.toString('utf8');
    // A tail can land mid-line; drop the partial first line so the viewer never
    // shows a truncated fragment.
    if (from > 0 && offset <= 0) {
      const firstBreak = text.indexOf('\n');
      if (firstBreak >= 0) text = text.slice(firstBreak + 1);
    }
    return { offset: from + length, size, text, rotated };
  } finally {
    fs.closeSync(fd);
  }
}

export function fullPath(serverId: string, file: string, source: LogSource = 'server'): string {
  return resolveLog(dirFor(serverId, source), file);
}

/**
 * Classify a log line so the viewer can colour it.
 *
 * An explicit level marker wins over loose keyword matching, because
 * "Warning: mod X failed to mount" is a warning, not an error - and lines like
 * that are common enough in ARK's log to matter.
 */
export function severityOf(line: string): 'error' | 'warn' | 'info' | 'plain' {
  // A "Level/Category :" tag is the line telling us its own severity, and it
  // beats every guess below: ARK's GameAnalytics chatter puts the word error
  // inside lines it has itself labelled Debug.
  const tagged = /\b(error|warning|warn|info|display|debug|verbose)\s*\/\s*\w+\s*:/i.exec(line);
  if (tagged) {
    const level = tagged[1].toLowerCase();
    if (level === 'error') return 'error';
    if (level === 'warn' || level === 'warning') return 'warn';
    if (level === 'debug' || level === 'verbose') return 'plain';
    return 'info';
  }
  if (/\bwarn(ing)?\s*:/i.test(line)) return 'warn';
  if (/\b(error|fatal|exception|failed|failure|critical)\b/i.test(line)) return 'error';
  if (/\bwarn(ing)?\b|\bdeprecated\b/i.test(line)) return 'warn';
  if (/\b(log[a-z]*|display|info)\s*:/i.test(line)) return 'info';
  return 'plain';
}
