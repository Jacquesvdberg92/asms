import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import express from 'express';
import cors from 'cors';
import { load, settings, saveNow, listenConfig } from './lib/store.js';
import { ensureDirs, WEB_DIST, DATA_DIR } from './lib/paths.js';
import { logger } from './lib/log.js';
import { createApi } from './api/index.js';
import { attachWebsocket } from './ws.js';
import * as servers from './core/servers.js';
import * as scheduler from './core/scheduler.js';
import * as backups from './core/backups.js';

const log = logger('asms');

/**
 * Two ASMS processes sharing one data folder would fight over asms.json and
 * could both manage the same game server. A pid lock makes the second one say
 * so plainly instead of silently corrupting state.
 */
function claimSingleInstance(): void {
  const lockFile = path.join(DATA_DIR, 'asms.lock');
  if (fs.existsSync(lockFile)) {
    const holder = Number(fs.readFileSync(lockFile, 'utf8').trim());
    let alive = false;
    try {
      process.kill(holder, 0);
      alive = true;
    } catch (err) {
      alive = (err as NodeJS.ErrnoException).code === 'EPERM';
    }
    if (alive && holder !== process.pid) {
      log.error(`Another ASMS is already running (pid ${holder}) using ${DATA_DIR}.`);
      log.error('Close it first, or start this one with a different ASMS_DATA folder.');
      process.exit(1);
    }
  }
  fs.writeFileSync(lockFile, String(process.pid));
  const release = () => {
    try {
      if (fs.readFileSync(lockFile, 'utf8').trim() === String(process.pid)) fs.rmSync(lockFile, { force: true });
    } catch {
      /* already gone */
    }
  };
  process.on('exit', release);
}

async function main(): Promise<void> {
  ensureDirs();
  claimSingleInstance();
  load();
  backups.reconcile();

  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '8mb' }));
  app.use('/api', createApi());

  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('html')
        .send(
          '<h1>ASMS API is running</h1><p>The web UI has not been built yet. Run <code>npm run build</code>, or use <code>npm run dev</code> and open <a href="http://localhost:5173">http://localhost:5173</a>.</p>',
        );
    });
  }

  const cfg = settings();
  const { host, port } = listenConfig();

  const server = http.createServer(app);
  attachWebsocket(server);

  await new Promise<void>((resolve) => server.listen(port, host, resolve));

  log.info(`ASMS listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  log.info(`data directory: ${DATA_DIR}`);
  for (const url of lanUrls(port)) log.info(`reachable at ${url}`);
  if (!cfg.password) {
    log.warn('No UI password set. Anyone on your network can control these servers - set one under Settings.');
  }

  await servers.init();
  scheduler.start();

  // ASMS_NO_OPEN keeps the browser closed when running headless or as a service.
  if (cfg.openBrowserOnStart && !process.env.ASMS_NO_OPEN && fs.existsSync(WEB_DIST)) {
    openBrowser(`http://localhost:${port}`);
  }

  const shutdown = async (signal: string) => {
    log.info(`${signal} received - shutting ASMS down (game servers keep running)`);
    scheduler.stop();
    await servers.shutdown();
    saveNow();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => log.error('uncaught exception', err));
  process.on('unhandledRejection', (err) => log.error('unhandled rejection', err));
}

function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(`http://${addr.address}:${port}`);
    }
  }
  return out;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, { windowsHide: true }, () => {});
}

void main().catch((err) => {
  log.error('failed to start', err);
  process.exit(1);
});
