import net from 'node:net';
import { EventEmitter } from 'node:events';

/**
 * Minimal Source RCON client, written here rather than pulled from npm so the
 * app has no native or abandoned dependencies. ARK quirks handled:
 *  - it never uses the multi-packet "empty follow-up" trick, so we instead
 *    settle a response once the socket goes quiet for `settleMs`;
 *  - it drops idle connections, so we keepalive with a cheap command.
 */

const SERVERDATA_AUTH = 3;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_AUTH_RESPONSE = 2;
const SERVERDATA_RESPONSE_VALUE = 0;

export interface RconOptions {
  host: string;
  port: number;
  password: string;
  timeoutMs?: number;
  settleMs?: number;
}

interface Pending {
  resolve: (v: string) => void;
  reject: (e: Error) => void;
  chunks: string[];
  timer: NodeJS.Timeout;
  settle: NodeJS.Timeout | null;
}

export class RconClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private authed = false;
  private closing = false;
  /** In-flight connect, shared by every caller that asks while it runs. */
  private connecting: Promise<void> | null = null;

  constructor(readonly opts: RconOptions) {
    super();
  }

  get connected(): boolean {
    return this.authed && !!this.socket && !this.socket.destroyed;
  }

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    // A refused server gets probed from several places at once - the readiness
    // watcher, the player poll, a console command. Without this they would
    // each open their own socket and leave their own listener behind.
    if (this.connecting) return this.connecting;
    this.connecting = this.openSocket().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private openSocket(): Promise<void> {
    const { host, port, password, timeoutMs = 5000 } = this.opts;
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      this.socket = socket;
      this.closing = false;
      let settled = false;

      const cleanup = (): void => {
        clearTimeout(timer);
        this.off('auth', onAuth);
      };

      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.destroy();
        if (this.socket === socket) this.socket = null;
        this.authed = false;
        reject(err);
      };

      const succeed = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        this.authed = true;
        this.emit('connect');
        resolve();
      };

      const onAuth = (packetId: number, type: number): void => {
        if (type !== SERVERDATA_AUTH_RESPONSE) return;
        if (packetId === -1) return fail(new Error('RCON authentication failed — wrong admin password'));
        succeed();
      };

      const timer = setTimeout(() => fail(new Error(`RCON connect timed out (${host}:${port})`)), timeoutMs);

      socket.setNoDelay(true);
      socket.on('data', (d) => this.onData(d));
      socket.on('error', (err) => {
        this.authed = false;
        // EventEmitter throws an unhandled 'error' straight out of the event
        // loop, so a refused connection would crash the process rather than
        // reject this promise. Only forward it if somebody is listening.
        if (this.listenerCount('error')) this.emit('error', err);
        fail(err);
        if (!this.closing) this.emit('close');
      });
      socket.on('close', () => {
        this.authed = false;
        this.failAll(new Error('RCON connection closed'));
        fail(new Error('RCON connection closed before authenticating'));
        this.emit('close');
      });

      socket.once('connect', () => {
        const id = this.nextId++;
        this.on('auth', onAuth);
        socket.write(this.encode(id, SERVERDATA_AUTH, password));
      });
    });
  }

  async exec(command: string): Promise<string> {
    if (!this.connected) await this.connect();
    const socket = this.socket;
    if (!socket) throw new Error('RCON not connected');
    const id = this.nextId++;
    const { timeoutMs = 5000 } = this.opts;

    return new Promise<string>((resolve, reject) => {
      const entry: Pending = {
        resolve,
        reject,
        chunks: [],
        timer: setTimeout(() => {
          this.pending.delete(id);
          if (entry.chunks.length) resolve(entry.chunks.join(''));
          else reject(new Error(`RCON command timed out: ${command}`));
        }, timeoutMs),
        settle: null,
      };
      this.pending.set(id, entry);
      socket.write(this.encode(id, SERVERDATA_EXECCOMMAND, command));
    });
  }

  close(): void {
    this.closing = true;
    this.connecting = null;
    this.failAll(new Error('RCON closed'));
    this.socket?.destroy();
    this.socket = null;
    this.authed = false;
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      if (p.settle) clearTimeout(p.settle);
      p.reject(err);
    }
    this.pending.clear();
  }

  private encode(id: number, type: number, body: string): Buffer {
    const payload = Buffer.from(body, 'utf8');
    const buf = Buffer.alloc(14 + payload.length);
    buf.writeInt32LE(payload.length + 10, 0);
    buf.writeInt32LE(id, 4);
    buf.writeInt32LE(type, 8);
    payload.copy(buf, 12);
    buf.writeInt16LE(0, 12 + payload.length);
    return buf;
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readInt32LE(0);
      if (size < 10 || size > 8 * 1024 * 1024) {
        this.buffer = Buffer.alloc(0); // desynced; drop rather than loop forever
        return;
      }
      if (this.buffer.length < size + 4) return;
      const id = this.buffer.readInt32LE(4);
      const type = this.buffer.readInt32LE(8);
      const body = this.buffer.subarray(12, 4 + size - 2).toString('utf8');
      this.buffer = this.buffer.subarray(4 + size);
      this.dispatch(id, type, body);
    }
  }

  private dispatch(id: number, type: number, body: string): void {
    if (type === SERVERDATA_AUTH_RESPONSE && !this.authed) {
      this.emit('auth', id, type);
      return;
    }
    const entry = this.pending.get(id);
    if (!entry) {
      if (type === SERVERDATA_RESPONSE_VALUE && body.trim()) this.emit('unsolicited', body);
      return;
    }
    entry.chunks.push(body);
    // ARK sends one packet per command, but long output can be split. Wait a
    // beat for stragglers before settling.
    if (entry.settle) clearTimeout(entry.settle);
    entry.settle = setTimeout(() => {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.resolve(entry.chunks.join(''));
    }, this.opts.settleMs ?? 120);
  }
}

/** One long-lived client per server id, reconnected lazily. */
const pool = new Map<string, RconClient>();

export function getClient(serverId: string, opts: RconOptions): RconClient {
  const existing = pool.get(serverId);
  if (existing) {
    const same =
      existing.opts.host === opts.host && existing.opts.port === opts.port && existing.opts.password === opts.password;
    if (same) return existing;
    existing.close();
    pool.delete(serverId);
  }
  const client = new RconClient(opts);
  pool.set(serverId, client);
  return client;
}

export function dropClient(serverId: string): void {
  pool.get(serverId)?.close();
  pool.delete(serverId);
}

/** One-shot command against an arbitrary endpoint (used by the connectivity test). */
export async function once(opts: RconOptions, command: string): Promise<string> {
  const client = new RconClient(opts);
  try {
    await client.connect();
    return await client.exec(command);
  } finally {
    client.close();
  }
}
