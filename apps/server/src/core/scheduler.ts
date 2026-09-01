import { data, save, id as newId } from '../lib/store.js';
import { bus } from '../lib/bus.js';
import { logger } from '../lib/log.js';
import { announce } from '../lib/notify.js';
import { notFound } from '../api/errors.js';
import * as servers from './servers.js';
import * as backups from './backups.js';
import type { ScheduleAction, ScheduleTask } from '../types.js';

const log = logger('scheduler');

// ------------------------------------------------------------ cron parsing
// A deliberately small 5-field cron implementation (minute hour dom month dow).
// Supports *, */n, a-b, a-b/n and comma lists - which covers every schedule an
// ARK server actually needs, without pulling in a dependency.

const RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (0 = Sunday)
];

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step in "${part}"`);
    let lo = min;
    let hi = max;
    if (rangePart !== '*') {
      const bounds = rangePart.split('-');
      lo = Number(bounds[0]);
      hi = bounds.length > 1 ? Number(bounds[1]) : lo;
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error(`Bad range in "${part}"`);
      if (lo < min || hi > max || lo > hi) throw new Error(`"${part}" is outside ${min}-${max}`);
      if (bounds.length === 1 && !stepPart) {
        out.add(lo);
        continue;
      }
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/**
 * A cron expression parsed once.
 *
 * Everything below used to re-parse all five fields for every candidate minute,
 * and `nextRun` walks up to a year of them - so one schedule cost a full second
 * of blocked event loop per call, on every dashboard load. Parsing once and
 * caching the result is most of the fix; skipping whole days is the rest.
 */
interface Cron {
  sets: Set<number>[];
  domRestricted: boolean;
  dowRestricted: boolean;
}

const parsed = new Map<string, Cron | null>();

function compile(expr: string): Cron | null {
  const key = expr.trim();
  const cached = parsed.get(key);
  if (cached !== undefined) return cached;

  let result: Cron | null = null;
  const fields = key.split(/\s+/);
  if (fields.length === 5) {
    try {
      result = {
        sets: fields.map((f, i) => parseField(f, RANGES[i][0], RANGES[i][1])),
        domRestricted: fields[2] !== '*',
        dowRestricted: fields[4] !== '*',
      };
    } catch {
      result = null;
    }
  }
  // Bounded so a stream of junk expressions cannot grow this without limit.
  if (parsed.size > 500) parsed.clear();
  parsed.set(key, result);
  return result;
}

export function validateCron(expr: string): { ok: true } | { ok: false; error: string } {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return { ok: false, error: 'A cron expression needs exactly 5 fields: minute hour day month weekday' };
  try {
    fields.forEach((f, i) => parseField(f, RANGES[i][0], RANGES[i][1]));
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  /**
   * Valid but impossible is still worth refusing. "0 0 31 2 *" parses cleanly
   * and never comes round, so it saved as a task that silently never fires -
   * and cost a full year's search on every schedule listing to work that out.
   */
  if (nextRun(expr) === null) {
    return { ok: false, error: 'That is a valid expression but it never comes round - check the day and month, e.g. the 31st of February.' };
  }
  return { ok: true };
}

export function cronMatches(expr: string, when: Date): boolean {
  const cron = compile(expr);
  if (!cron) return false;
  return matches(cron, when);
}

function matches(cron: Cron, when: Date): boolean {
  const [minute, hour, dom, month, dow] = cron.sets;
  if (!minute.has(when.getMinutes())) return false;
  if (!hour.has(when.getHours())) return false;
  if (!month.has(when.getMonth() + 1)) return false;

  // Standard cron: when both day fields are restricted, either may match.
  const domHit = dom.has(when.getDate());
  const dowHit = dow.has(when.getDay());
  if (cron.domRestricted && cron.dowRestricted) return domHit || dowHit;
  if (cron.domRestricted) return domHit;
  if (cron.dowRestricted) return dowHit;
  return true;
}

/** Can this date's day-of-month and month match at all? Lets us skip a whole day. */
function dayPossible(cron: Cron, when: Date): boolean {
  const [, , dom, month, dow] = cron.sets;
  if (!month.has(when.getMonth() + 1)) return false;
  const domHit = dom.has(when.getDate());
  const dowHit = dow.has(when.getDay());
  if (cron.domRestricted && cron.dowRestricted) return domHit || dowHit;
  if (cron.domRestricted) return domHit;
  if (cron.dowRestricted) return dowHit;
  return true;
}

/**
 * Next matching instant after `from`, or null if nothing matches within a year.
 *
 * Days that cannot match are skipped whole rather than a minute at a time,
 * which turns the worst case from ~527,000 checks into ~366.
 */
export function nextRun(expr: string, from = new Date()): number | null {
  const cron = compile(expr);
  if (!cron) return null;

  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const limit = new Date(from.getTime());
  limit.setFullYear(limit.getFullYear() + 1);

  while (cursor.getTime() <= limit.getTime()) {
    if (!dayPossible(cron, cursor)) {
      // Jump to 00:00 tomorrow. setDate handles month and year rollover.
      cursor.setHours(0, 0, 0, 0);
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }
    const endOfDay = cursor.getDate();
    while (cursor.getDate() === endOfDay && cursor.getTime() <= limit.getTime()) {
      if (matches(cron, cursor)) return cursor.getTime();
      cursor.setMinutes(cursor.getMinutes() + 1);
    }
  }
  return null;
}

export function describeCron(expr: string): string {
  const next = nextRun(expr);
  if (!next) return 'never';
  return new Date(next).toLocaleString();
}

// ------------------------------------------------------------- validation

const ACTIONS: ScheduleAction[] = ['restart', 'backup', 'update', 'stop', 'start', 'rcon'];

/**
 * Rebuild a task from untrusted input.
 *
 * All three of these used to be taken on trust. An unknown `action` fell through
 * the switch and reported "ok" having done nothing; a `serverId` that did not
 * exist was only discovered at run time; and a `warnMinutes` that was not an
 * array either produced NaN - a scheduled restart with no player warning at all
 * - or threw out of the tick loop, silently stopping every task after it.
 */
function validateTask(input: unknown, current?: ScheduleTask): ScheduleTask {
  const raw = (input ?? {}) as Record<string, unknown>;
  const pick = <T>(value: unknown, fallback: T, ok: (v: unknown) => boolean): T =>
    ok(value) ? (value as T) : fallback;

  const cron = typeof raw.cron === 'string' ? raw.cron.trim() : (current?.cron ?? '0 6 * * *');
  const check = validateCron(cron);
  if (!check.ok) throw new Error(check.error);

  const action = ACTIONS.includes(raw.action as ScheduleAction)
    ? (raw.action as ScheduleAction)
    : current?.action;
  if (!action) {
    throw new Error(`A scheduled task needs one of these actions: ${ACTIONS.join(', ')}.`);
  }

  const serverId = typeof raw.serverId === 'string' ? raw.serverId : (current?.serverId ?? '');
  if (!servers.get(serverId)) throw new Error('That scheduled task does not point at a server that exists.');

  const command = pick(raw.command, current?.command ?? '', (v) => typeof v === 'string') as string;
  if (action === 'rcon' && !command.trim()) {
    throw new Error('An RCON task needs a command to send.');
  }

  const warnMinutes = Array.isArray(raw.warnMinutes)
    ? [...new Set(raw.warnMinutes.map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n) && n > 0 && n <= 1440))]
        .sort((a, b) => b - a)
        .slice(0, 10)
    : (current?.warnMinutes ?? [15, 10, 5, 1]);

  return {
    id: current?.id ?? newId('job_'),
    serverId,
    name: (typeof raw.name === 'string' ? raw.name : (current?.name ?? '')).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80) || 'Scheduled task',
    action,
    cron,
    enabled: pick(raw.enabled, current?.enabled ?? true, (v) => typeof v === 'boolean') as boolean,
    warnMinutes,
    command: command.slice(0, 500),
    lastRun: current?.lastRun ?? null,
    lastResult: current?.lastResult ?? null,
    nextRun: null,
  };
}

// ------------------------------------------------------------------- CRUD

/**
 * nextRun is cached per task, because `list()` runs on every `/state`, every
 * `/schedules` and every websocket hello.
 */
const nextRunCache = new Map<string, { cron: string; computedAt: number; value: number | null }>();

function nextRunFor(task: ScheduleTask): number | null {
  if (!task.enabled) return null;
  const now = Date.now();
  const cached = nextRunCache.get(task.id);
  // Reuse while the answer is still in the future and no more than a minute
  // old — recomputing on every listing is what made this expensive.
  if (cached && cached.cron === task.cron && cached.value !== null && cached.value > now && now - cached.computedAt < 60_000) {
    return cached.value;
  }
  const value = nextRun(task.cron);
  nextRunCache.set(task.id, { cron: task.cron, computedAt: now, value });
  return value;
}

export function list(serverId?: string): ScheduleTask[] {
  const rows = serverId ? data().schedules.filter((t) => t.serverId === serverId) : data().schedules;
  return rows.map((t) => ({ ...t, nextRun: nextRunFor(t) }));
}

export function create(input: Partial<ScheduleTask>): ScheduleTask {
  const task = validateTask(input);
  data().schedules.push(task);
  nextRunCache.delete(task.id);
  save();
  bus.emitEvent('schedule:changed', {});
  return { ...task, nextRun: nextRunFor(task) };
}

export function update(id: string, patch: Partial<ScheduleTask>): ScheduleTask {
  const db = data();
  const at = db.schedules.findIndex((t) => t.id === id);
  if (at < 0) throw notFound('No such scheduled task');
  const next = validateTask({ ...patch, id }, db.schedules[at]);
  db.schedules[at] = next;
  nextRunCache.delete(id);
  save();
  bus.emitEvent('schedule:changed', {});
  return { ...next, nextRun: nextRunFor(next) };
}

export function remove(id: string): void {
  const db = data();
  db.schedules = db.schedules.filter((t) => t.id !== id);
  nextRunCache.delete(id);
  save();
  bus.emitEvent('schedule:changed', {});
}

// ------------------------------------------------------------- the runner

/** Tasks whose warning countdown is already under way. */
const inFlight = new Set<string>();
let ticker: NodeJS.Timeout | null = null;
let lastMinute = '';

export async function runNow(id: string): Promise<void> {
  const task = data().schedules.find((t) => t.id === id);
  if (!task) throw notFound('No such scheduled task');
  await execute(task, true);
}

async function execute(task: ScheduleTask, immediate = false): Promise<void> {
  if (inFlight.has(task.id)) return;
  inFlight.add(task.id);
  const server = servers.get(task.serverId);
  const label = `${task.name} (${server?.name ?? 'unknown server'})`;
  log.info(`running ${label}`);

  const finish = (result: string, ok: boolean) => {
    // The task may have been edited or deleted while this ran; write to the
    // record that is actually in the database, if it is still there.
    const live = data().schedules.find((t) => t.id === task.id);
    if (live) {
      live.lastRun = Date.now();
      live.lastResult = result;
      nextRunCache.delete(live.id);
      save();
      bus.emitEvent('schedule:changed', {});
    }
    if (!ok) announce('restart', 'error', `Scheduled task failed: ${task.name}`, result);
  };

  try {
    if (!server) throw new Error('The server this task belongs to no longer exists');
    const warn = immediate ? [] : task.warnMinutes;

    switch (task.action) {
      case 'restart':
        await servers.withWarnings(server.id, warn, () => servers.restart(server.id, { reason: task.name }), 'restart');
        break;
      case 'stop':
        await servers.withWarnings(server.id, warn, () => servers.stop(server.id, { reason: task.name }), 'shutdown');
        break;
      case 'start':
        await servers.start(server.id);
        break;
      case 'backup':
        await backups.create(server.id, 'scheduled', task.name);
        break;
      case 'update':
        await servers.withWarnings(
          server.id,
          warn,
          async () => {
            const wasRunning = servers.runtime(server.id).state === 'running';
            if (wasRunning) await servers.stop(server.id, { reason: 'update' });
            await servers.installServer(server.id, false);
            if (wasRunning) await servers.start(server.id);
          },
          'update',
        );
        break;
      case 'rcon':
        if (!task.command.trim()) throw new Error('This task has no RCON command set');
        await servers.rconExec(server.id, task.command.trim());
        break;
    }
    finish('ok', true);
  } catch (err) {
    finish((err as Error).message, false);
    log.error(`task ${label} failed`, err);
  } finally {
    inFlight.delete(task.id);
  }
}

function tick(): void {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  if (stamp === lastMinute) return;
  lastMinute = stamp;

  // A snapshot, because executing a task can edit the list underneath us.
  for (const task of [...data().schedules]) {
    /**
     * One malformed task must never stop the others. This loop used to throw
     * straight out of the interval callback, so every task after the bad one in
     * the array silently never fired again.
     */
    try {
      if (!task.enabled) continue;
      const lead = Array.isArray(task.warnMinutes) && task.warnMinutes.length ? Math.max(0, ...task.warnMinutes) : 0;
      if (lead > 0 && task.action !== 'backup' && task.action !== 'rcon') {
        // Start the countdown early so the action itself lands on the cron time.
        const target = new Date(now.getTime() + lead * 60_000);
        target.setSeconds(0, 0);
        if (cronMatches(task.cron, target)) void execute(task);
      } else if (cronMatches(task.cron, now)) {
        void execute(task);
      }
    } catch (err) {
      log.error(`scheduled task "${task.name}" could not be evaluated`, err);
    }
  }
}

export function start(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    try {
      tick();
    } catch (err) {
      log.error('scheduler tick failed', err);
    }
  }, 15_000);
  tick();
  log.info(`scheduler started with ${data().schedules.length} task(s)`);
}

export function stop(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

/** Drop cached next-run times — used after an archive import rewrites the list. */
export function resetCache(): void {
  nextRunCache.clear();
}
