import { data, save, id as newId } from '../lib/store.js';
import { bus } from '../lib/bus.js';
import { logger } from '../lib/log.js';
import { announce } from '../lib/notify.js';
import * as servers from './servers.js';
import * as backups from './backups.js';
import type { ScheduleTask } from '../types.js';

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

export function validateCron(expr: string): { ok: true } | { ok: false; error: string } {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return { ok: false, error: 'A cron expression needs exactly 5 fields: minute hour day month weekday' };
  try {
    fields.forEach((f, i) => parseField(f, RANGES[i][0], RANGES[i][1]));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function cronMatches(expr: string, when: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  let sets: Set<number>[];
  try {
    sets = fields.map((f, i) => parseField(f, RANGES[i][0], RANGES[i][1]));
  } catch {
    return false;
  }
  const [minute, hour, dom, month, dow] = sets;
  if (!minute.has(when.getMinutes())) return false;
  if (!hour.has(when.getHours())) return false;
  if (!month.has(when.getMonth() + 1)) return false;

  // Standard cron: when both day fields are restricted, either may match.
  const domRestricted = fields[2] !== '*';
  const dowRestricted = fields[4] !== '*';
  const domHit = dom.has(when.getDate());
  const dowHit = dow.has(when.getDay());
  if (domRestricted && dowRestricted) return domHit || dowHit;
  if (domRestricted) return domHit;
  if (dowRestricted) return dowHit;
  return true;
}

/** Next matching instant after `from`, or null if nothing matches within a year. */
export function nextRun(expr: string, from = new Date()): number | null {
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit; i += 1) {
    if (cronMatches(expr, cursor)) return cursor.getTime();
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

export function describeCron(expr: string): string {
  const next = nextRun(expr);
  if (!next) return 'never';
  return new Date(next).toLocaleString();
}

// ------------------------------------------------------------------- CRUD

export function list(serverId?: string): ScheduleTask[] {
  const rows = serverId ? data().schedules.filter((t) => t.serverId === serverId) : data().schedules;
  return rows.map((t) => ({ ...t, nextRun: t.enabled ? nextRun(t.cron) : null }));
}

export function create(input: Partial<ScheduleTask>): ScheduleTask {
  const cron = input.cron ?? '0 6 * * *';
  const check = validateCron(cron);
  if (!check.ok) throw new Error(check.error);
  const task: ScheduleTask = {
    id: newId('job_'),
    serverId: input.serverId ?? '',
    name: input.name ?? 'Scheduled task',
    action: input.action ?? 'restart',
    cron,
    enabled: input.enabled ?? true,
    warnMinutes: input.warnMinutes ?? [15, 10, 5, 1],
    command: input.command ?? '',
    lastRun: null,
    lastResult: null,
    nextRun: nextRun(cron),
  };
  data().schedules.push(task);
  save();
  bus.emitEvent('schedule:changed', {});
  return task;
}

export function update(id: string, patch: Partial<ScheduleTask>): ScheduleTask {
  const task = data().schedules.find((t) => t.id === id);
  if (!task) throw new Error('No such scheduled task');
  if (patch.cron) {
    const check = validateCron(patch.cron);
    if (!check.ok) throw new Error(check.error);
  }
  Object.assign(task, patch, { id: task.id });
  task.nextRun = task.enabled ? nextRun(task.cron) : null;
  save();
  bus.emitEvent('schedule:changed', {});
  return task;
}

export function remove(id: string): void {
  const db = data();
  db.schedules = db.schedules.filter((t) => t.id !== id);
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
  if (!task) throw new Error('No such scheduled task');
  await execute(task, true);
}

async function execute(task: ScheduleTask, immediate = false): Promise<void> {
  if (inFlight.has(task.id)) return;
  inFlight.add(task.id);
  const server = servers.get(task.serverId);
  const label = `${task.name} (${server?.name ?? 'unknown server'})`;
  log.info(`running ${label}`);

  const finish = (result: string, ok: boolean) => {
    task.lastRun = Date.now();
    task.lastResult = result;
    task.nextRun = task.enabled ? nextRun(task.cron) : null;
    save();
    bus.emitEvent('schedule:changed', {});
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

  for (const task of data().schedules) {
    if (!task.enabled) continue;
    const lead = Math.max(0, ...(task.warnMinutes ?? []));
    if (lead > 0 && task.action !== 'backup' && task.action !== 'rcon') {
      // Start the countdown early so the action itself lands on the cron time.
      const target = new Date(now.getTime() + lead * 60_000);
      target.setSeconds(0, 0);
      if (cronMatches(task.cron, target)) void execute(task);
    } else if (cronMatches(task.cron, now)) {
      void execute(task);
    }
  }
}

export function start(): void {
  if (ticker) return;
  ticker = setInterval(tick, 15_000);
  tick();
  log.info(`scheduler started with ${data().schedules.length} task(s)`);
}

export function stop(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}
