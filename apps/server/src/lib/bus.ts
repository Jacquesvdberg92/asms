import { EventEmitter } from 'node:events';

/**
 * One process-wide event bus. Everything pushed here is mirrored to connected
 * websocket clients by ws.ts, so the UI never has to poll.
 */
export interface BusEvents {
  /** Runtime snapshot for one server changed. */
  'server:runtime': { id: string };
  /** A server's stored configuration changed (or it was created/deleted). */
  'server:changed': { id: string | null };
  /** A line of stdout/stderr from a managed process. */
  'server:console': { id: string; line: string; stream: 'out' | 'err' | 'sys' };
  /** SteamCMD output while installing or updating. */
  'steam:console': { id: string; line: string };
  /** Progress while ASMS updates itself. */
  'app:update': { line: string };
  /** Backups list changed. */
  'backup:changed': { serverId: string | null };
  /** Schedule list changed. */
  'schedule:changed': Record<string, never>;
  /** Saved setups changed. */
  'setup:changed': Record<string, never>;
  /** The saved mod / cluster library changed. */
  'library:changed': Record<string, never>;
  /** Toast-worthy notification. */
  notice: { level: 'info' | 'success' | 'warn' | 'error'; title: string; body?: string };
}

class Bus extends EventEmitter {
  emitEvent<K extends keyof BusEvents>(type: K, payload: BusEvents[K]): void {
    this.emit('*', { type, payload, at: Date.now() });
    this.emit(type as string, payload);
  }
}

export const bus = new Bus();
bus.setMaxListeners(200);

export function notice(level: BusEvents['notice']['level'], title: string, body?: string): void {
  bus.emitEvent('notice', { level, title, body });
}
