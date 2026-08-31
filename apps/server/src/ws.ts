import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { bus } from './lib/bus.js';
import { logger } from './lib/log.js';
import { isValid } from './api/auth.js';
import * as servers from './core/servers.js';
import * as scheduler from './core/scheduler.js';
import { data } from './lib/store.js';

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
    const token = url.searchParams.get('token') ?? undefined;
    if (!isValid(token)) {
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
      settings: data().settings,
    });

    const ping = setInterval(() => {
      if (client.readyState === WebSocket.OPEN) client.ping();
    }, 30_000);

    client.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type: string; payload?: { id?: string } };
        if (msg.type === 'console:subscribe' && msg.payload?.id) {
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
