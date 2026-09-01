import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { bus } from './lib/bus.js';
import { logger } from './lib/log.js';
import { redeemTicket } from './api/auth.js';
import * as servers from './core/servers.js';
import * as scheduler from './core/scheduler.js';
import { data } from './lib/store.js';
import { publicSettings } from './core/settings.js';

const log = logger('ws');

/**
 * Every bus event is mirrored to connected browsers, so the UI is push-driven
 * and never polls for status.
 */
export function attachWebsocket(http: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') return;
    /**
     * A browser cannot put an Authorization header on a WebSocket handshake, so
     * this takes a one-shot ticket instead of the session token - the token in
     * a URL ends up in access logs and browser history, and this URL is opened
     * on every reconnect.
     */
    const ticket = url.searchParams.get('ticket') ?? undefined;
    if (!redeemTicket(ticket, '/ws')) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req));
  });

  const send = (client: WebSocket, type: string, payload: unknown) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type, payload }));
  };

  wss.on('connection', (client) => {
    send(client, 'hello', {
      servers: servers.list(),
      runtimes: servers.runtimes_all(),
      schedules: scheduler.list(),
      settings: publicSettings(data().settings),
    });

    /**
     * A ping nobody answers means the far end is gone without having closed -
     * a laptop lid, a dropped wifi link. Without the pong check those sockets
     * accumulate and every broadcast writes into them forever.
     */
    let alive = true;
    client.on('pong', () => {
      alive = true;
    });
    const ping = setInterval(() => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (!alive) {
        client.terminate();
        return;
      }
      alive = false;
      client.ping();
    }, 30_000);

    client.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type: string; payload?: { id?: string } };
        if (msg.type === 'console:subscribe' && typeof msg.payload?.id === 'string') {
          send(client, 'console:backlog', { id: msg.payload.id, lines: servers.consoleLines(msg.payload.id) });
        }
      } catch {
        /* ignore malformed client frames */
      }
    });

    client.on('close', () => clearInterval(ping));
    client.on('error', (err) => log.warn('client socket error', err.message));
  });

  const forward = (event: { type: string; payload: unknown }) => {
    // Runtime changes go out below as a fully hydrated snapshot instead.
    if (event.type === 'server:runtime') return;
    const frame = JSON.stringify({ type: event.type, payload: event.payload });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(frame);
    }
  };
  bus.on('*', forward);

  // Runtime snapshots are the one event the UI wants fully hydrated.
  bus.on('server:runtime', ({ id }: { id: string }) => {
    const frame = JSON.stringify({ type: 'runtime', payload: servers.runtime(id) });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(frame);
    }
  });

  return wss;
}
