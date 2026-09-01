import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import express from 'express';
import { load, settings, saveNow, listenConfig, takeGeneratedPassword } from './lib/store.js';
import { ensureDirs, WEB_DIST, DATA_DIR } from './lib/paths.js';
import { logger, closeLog } from './lib/log.js';
import { onShutdown } from './lib/lifecycle.js';
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

/**
 * Bind the port, or explain why not.
 *
 * `listen` reports failure as an event, not as a rejected promise, so without
 * this the await below never settled and the process died on a raw Node stack
 * trace - for the single most likely first-run problem there is.
 */
function listen(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${port} is already in use, so ASMS cannot start. Something else is on it - another copy of ASMS, or another program. Close it, or set a different port under Settings - Access (or with ASMS_PORT).`,
          ),
        );
      } else if (err.code === 'EADDRNOTAVAIL') {
        reject(
          new Error(
            `This machine has no address ${host}, so ASMS cannot listen on it. Set the listen address back to 0.0.0.0 under Settings - Access (or with ASMS_HOST).`,
          ),
        );
      } else if (err.code === 'EACCES') {
        reject(new Error(`Not allowed to listen on port ${port}. Ports below 1024 need administrator rights - pick a higher one.`));
      } else {
        reject(err);
      }
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function main(): Promise<void> {
  ensureDirs();
  claimSingleInstance();

  /**
   * Registered before anything else can fail. An uncaught exception means the
   * process is in a state Node itself does not trust; carrying on regardless is
   * how a half-written asms.json happens. Flush what we have and let start.cmd
   * or Docker bring us back.
   */
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception - shutting down', err);
    try {
      saveNow();
    } catch {
      /* nothing more we can do */
    }
    closeLog();
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => log.error('unhandled rejection', err));

  await load();
  backups.reconcile();

  const app = express();
  app.disable('x-powered-by');
  /**
   * No CORS middleware, deliberately.
   *
   * The dashboard is served from this same origin, so it never needed one. A
   * bare `cors()` answered every route with `Access-Control-Allow-Origin: *`,
   * which meant any page in any tab could call this API and read the reply -
   * enumerate servers, read admin passwords out of /api/state, stop or delete
   * things. It also made "bind to 127.0.0.1" no protection at all, because the
   * attacking page runs on this machine too.
   */
  app.use(express.json({ limit: '8mb' }));
  app.use('/api', createApi());

  /**
   * The last word on any error under /api.
   *
   * express.json() rejects a malformed or oversized body before the router is
   * ever reached, so the router's own handler never saw it - and Express's
   * default reply is an HTML page carrying a stack trace and the filesystem
   * paths of this install. A JSON API answers in JSON, and says only what the
   * caller can act on.
   */
  app.use('/api', (err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'That request body is not valid JSON.' });
      return;
    }
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'That request is too large. The limit is 8 MB.' });
      return;
    }
    log.error('unhandled API error', err);
    res.status(err?.status && err.status < 500 ? err.status : 500).json({
      error: 'Something went wrong inside ASMS. The details are in the log.',
    });
  });

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

  await listen(server, port, host);
  // From here on a socket error is not fatal; log it rather than let it throw.
  server.on('error', (err) => log.error('http server error', err));

  log.info(`ASMS listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  log.info(`data directory: ${DATA_DIR}`);
  for (const url of lanUrls(port)) log.info(`reachable at ${url}`);

  const generated = takeGeneratedPassword();
  if (generated) {
    // Printed once, and only once: it is a hash from here on. Loud, because it
    // is the only time anybody will see it.
    log.warn('─'.repeat(64));
    log.warn(`ASMS set a dashboard password for you:   ${generated}`);
    log.warn('Write it down. Change or clear it under Settings - Access.');
    log.warn('─'.repeat(64));
  } else if (!cfg.passwordHash) {
    log.warn('No UI password set. Anyone on your network can control these servers - set one under Settings.');
  }

  await servers.init();
  scheduler.start();

  // ASMS_NO_OPEN keeps the browser closed when running headless or as a service.
  if (cfg.openBrowserOnStart && !process.env.ASMS_NO_OPEN && fs.existsSync(WEB_DIST)) {
    openBrowser(`http://localhost:${port}`);
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal} received - shutting ASMS down (game servers keep running)`);
    scheduler.stop();
    await servers.shutdown();
    saveNow();
    closeLog();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  // The Restart button on the Settings page wants exactly this sequence.
  onShutdown((reason) => shutdown(reason));
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
  // A startup failure is the one place a bare message beats a stack trace: it
  // is almost always a port or a folder, and the message above says which.
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
