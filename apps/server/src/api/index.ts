import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { data, saveNow, settings, listenConfig } from '../lib/store.js';
import { ark, checkInstallPath, ASA_APP_ID, DATA_DIR } from '../lib/paths.js';
import { addFirewallRules, isPortFree, findFreePort } from '../lib/proc.js';
import { ensureSteamCmd, isSteamCmdInstalled, steamCmdPath, latestBuildId } from '../lib/steamcmd.js';
import { once as rconOnce } from '../lib/rcon.js';
import * as servers from '../core/servers.js';
import * as backups from '../core/backups.js';
import * as scheduler from '../core/scheduler.js';
import * as logs from '../core/logs.js';
import * as metrics from '../core/metrics.js';
import * as config from '../core/config.js';
import * as setups from '../core/setups.js';
import * as archive from '../core/archive.js';
import * as library from '../core/library.js';
import * as presets from '../core/presets.js';
import * as updates from '../core/updates.js';
import * as spawn from '../core/spawn.js';
import { MAPS, SETTINGS, SETTING_GROUPS, RCON_COMMANDS, LAUNCH_FLAGS, LAUNCH_FLAG_GROUPS, ACTIVE_EVENTS } from '../core/catalog.js';
import {
  authRequired,
  setupRequired,
  guard,
  login,
  logout,
  revokeAll,
  tokenFrom,
  issueTicket,
  loginBlockedFor,
} from './auth.js';
import { applySettingsPatch, publicSettings } from '../core/settings.js';
import { sendTest } from '../lib/notify.js';
import { setSettings } from '../lib/store.js';
import { logger } from '../lib/log.js';
import { HttpError, badRequest, notFound, tooManyRequests } from './errors.js';

const log = logger('api');

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;

/**
 * Sends whatever the handler resolves to as JSON, and turns thrown errors into
 * a JSON error body instead of a stack trace in the browser. Handlers that
 * write the response themselves (downloads, explicit status codes) just return
 * undefined or the Response, and are left alone.
 *
 * An HttpError carries its own status and message. Anything else is a bug, so
 * it is logged in full here and answered with something generic - the message
 * of an unexpected error is as likely to be a filesystem path as it is to be
 * useful.
 */
const wrap =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res))
      .then((result) => {
        if (res.headersSent || result === undefined || result === res) return;
        res.json(result);
      })
      .catch((err: unknown) => {
        if (res.headersSent) return next(err);
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        // Errors thrown by the core modules are written for people, so they are
        // still worth showing - they just do not get to claim a status.
        if (err instanceof Error && err.name === 'Error') {
          res.status(400).json({ error: err.message });
          return;
        }
        log.error(`${req.method} ${req.path} failed`, err);
        res.status(500).json({ error: 'Something went wrong inside ASMS. The details are in the log.' });
      });
  };

export function createApi(): Router {
  const api = Router();
  api.use(guard);

  // ------------------------------------------------------------------ auth
  api.get('/auth/status', (_req, res) => {
    res.json({ required: authRequired(), setupRequired: setupRequired() });
  });

  /**
   * First run: choose a password, or say out loud that you do not want one.
   *
   * Open to anyone who can reach ASMS, and it has to be - there is nothing to
   * sign in with yet. It only answers while nothing is set, which is why the
   * guard keeps the rest of the API shut until it has been answered: the window
   * where this is claimable is the window where the machine is exposed, so it
   * lasts as long as it takes to open the dashboard, not as long as the install.
   */
  api.post(
    '/auth/setup',
    wrap(async (req, res) => {
      if (!setupRequired()) {
        throw badRequest('ASMS is already set up. Change the password under Settings → Access.');
      }
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const { settings: next } = await applySettingsPatch(settings(), { password });
      setSettings(next);
      saveNow();
      revokeAll();
      if (!password) {
        log.warn('first run: sign-in left switched off - anyone who can reach ASMS can control these servers');
        return res.json({ token: null, required: false });
      }
      log.info('first run: dashboard password set');
      // Straight in, rather than bouncing somebody who just typed it twice.
      return res.json({ token: await login(req, password), required: true });
    }),
  );

  api.post(
    '/auth/login',
    wrap(async (req, res) => {
      if (!authRequired()) return res.json({ token: null, required: false });
      // Guessing is slowed down here rather than left to run at LAN speed.
      const wait = loginBlockedFor(req);
      if (wait > 0) {
        throw tooManyRequests(
          `Too many failed sign-ins. Try again in ${Math.ceil(wait / 1000)} second${wait >= 2000 ? 's' : ''}.`,
        );
      }
      const token = await login(req, String(req.body?.password ?? ''));
      if (!token) return res.status(401).json({ error: 'Wrong password' });
      return res.json({ token, required: true });
    }),
  );

  /**
   * A one-shot ticket for a download.
   *
   * Downloads are plain navigations, which cannot carry an Authorization
   * header. They used to carry the session token in the query string instead,
   * where it lands in access logs, browser history and any reverse proxy in the
   * way. A ticket is good for one path, once, for a minute.
   */
  api.post(
    '/auth/ticket',
    wrap(async (req) => {
      const path = String(req.body?.path ?? '');
      if (!path.startsWith('/')) throw badRequest('A ticket needs the path it is for.');
      return { ticket: issueTicket(path) };
    }),
  );

  api.post('/auth/logout', (req, res) => {
    logout(tokenFrom(req));
    res.json({ ok: true });
  });

  // --------------------------------------------------------------- catalog
  api.get('/catalog', (_req, res) => {
    res.json({
      maps: MAPS,
      settings: SETTINGS,
      groups: SETTING_GROUPS,
      rconCommands: RCON_COMMANDS,
      launchFlags: LAUNCH_FLAGS,
      launchFlagGroups: LAUNCH_FLAG_GROUPS,
      activeEvents: ACTIVE_EVENTS,
      presets: presets.PRESETS,
      appId: ASA_APP_ID,
    });
  });

  /**
   * The spawn catalogue is an order of magnitude bigger than the rest of the
   * catalogue and only the Spawn tab wants it, so it is fetched on demand
   * rather than loaded into every session at sign-in.
   */
  api.get('/spawn/catalog', (_req, res) => {
    res.json({
      creatures: spawn.CREATURES,
      creatureGroups: spawn.CREATURE_GROUPS,
      items: spawn.ITEMS,
      itemGroups: spawn.ITEM_GROUPS,
      kits: spawn.KITS,
      sources: spawn.SPAWN_SOURCES,
    });
  });

  // ----------------------------------------------------------------- state
  api.get('/state', (_req, res) => {
    res.json({
      settings: publicSettings(data().settings),
      servers: servers.list(),
      runtimes: servers.runtimes_all(),
      schedules: scheduler.list(),
      backups: backups.list(),
      setups: setups.list(),
      library: library.get(),
    });
  });

  // --------------------------------------------------------------- system
  api.get(
    '/system',
    wrap(async () => {
      const mem = { totalMB: Math.round(os.totalmem() / 1048576), freeMB: Math.round(os.freemem() / 1048576) };
      const addresses: string[] = [];
      for (const list of Object.values(os.networkInterfaces())) {
        for (const addr of list ?? []) {
          if (addr.family === 'IPv4' && !addr.internal) addresses.push(addr.address);
        }
      }
      return {
        hostname: os.hostname(),
        addresses,
        platform: `${os.type()} ${os.release()}`,
        cpuModel: os.cpus()[0]?.model ?? 'unknown',
        cores: os.cpus().length,
        uptimeSeconds: os.uptime(),
        memory: mem,
        nodeVersion: process.version,
        dataDir: DATA_DIR,
        listen: listenConfig(),
        steamCmd: { installed: isSteamCmdInstalled(), path: steamCmdPath() },
      };
    }),
  );

  api.post(
    '/system/steamcmd/install',
    wrap(async () => {
      const exe = await ensureSteamCmd();
      return { ok: true, path: exe };
    }),
  );

  api.get(
    '/system/latest-build',
    wrap(async () => ({ buildId: await latestBuildId(true) })),
  );

  api.post(
    '/system/check-updates',
    wrap(async () => servers.checkForUpdates()),
  );

  // ASMS updating itself, as opposed to the ARK servers it manages.
  api.get(
    '/system/app-update',
    wrap(async () => updates.lastCheck() ?? (await updates.checkForUpdate())),
  );

  api.post(
    '/system/app-update/check',
    wrap(async () => updates.checkForUpdate()),
  );

  api.post(
    '/system/app-update/apply',
    wrap(async (req) => updates.applyUpdate({ restart: req.body?.restart === true })),
  );

  /** Restart ASMS itself. The ARK servers it manages keep running. */
  api.post(
    '/system/restart',
    wrap(async () => {
      const plan = updates.restartApp();
      return { ok: true, ...plan };
    }),
  );

  api.post(
    '/system/port-check',
    wrap(async (req) => {
      const port = Number(req.body?.port);
      const proto = req.body?.proto === 'tcp' ? 'tcp' : 'udp';
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535');
      const free = await isPortFree(port, proto);
      const usedByServer = servers
        .list()
        .find((s) => s.port === port || s.port + 1 === port || s.queryPort === port || s.rconPort === port);
      return { port, proto, free, conflictsWith: usedByServer?.name ?? null };
    }),
  );

  api.get(
    '/system/suggest-ports',
    wrap(async () => {
      const taken = servers.list().flatMap((s) => [s.port, s.port + 1, s.queryPort, s.rconPort]);
      return {
        port: await findFreePort(7777, 'udp', taken),
        queryPort: await findFreePort(27015, 'udp', taken),
        rconPort: await findFreePort(27020, 'tcp', taken),
      };
    }),
  );

  api.get('/settings', (_req, res) => res.json(publicSettings(data().settings)));

  /**
   * This used to be `Object.assign(current, req.body)` with no validation of
   * any kind, so `{"password": 12345}` was saved to disk and then threw out of
   * authRequired() on every request from the next boot on - a permanent 500 on
   * every route, sign-in included. Every field is rebuilt with a typed clamp.
   */
  api.put(
    '/settings',
    wrap(async (req) => {
      const { settings: next, passwordChanged } = await applySettingsPatch(data().settings, req.body);
      setSettings(next);
      saveNow();
      if (passwordChanged) revokeAll();
      servers.scheduleUpdateCheck();
      return { ...publicSettings(next), sessionsRevoked: passwordChanged };
    }),
  );

  /** Post to the configured webhook now, so a bad URL is found today. */
  api.post(
    '/settings/test-webhook',
    wrap(async (req) => {
      const url = typeof req.body?.webhook === 'string' ? req.body.webhook : data().settings.discordWebhook;
      await sendTest(url, 'Test message from ASMS. Notifications are working.');
      return { ok: true };
    }),
  );

  // -------------------------------------------------------------- clusters
  api.get('/clusters', (_req, res) => {
    const grouped = new Map<string, string[]>();
    for (const server of servers.list()) {
      if (!server.clusterId.trim()) continue;
      const members = grouped.get(server.clusterId) ?? [];
      members.push(server.id);
      grouped.set(server.clusterId, members);
    }
    res.json(
      [...grouped.entries()].map(([id, members]) => ({
        id,
        members,
        dir: servers.get(members[0])?.clusterDir || path.join(settings().clusterRoot, id),
      })),
    );
  });

  // --------------------------------------------------------------- servers
  api.get('/servers', (_req, res) => {
    res.json(servers.list().map((s) => ({ ...s, runtime: servers.runtime(s.id) })));
  });

  // A cluster ID typed once is offered on every server after it: the transfer
  // bank only works if all of them spell it identically, so remembering it is
  // the difference between picking from a list and retyping from memory.
  api.post(
    '/servers',
    wrap(async (req) => {
      const server = await servers.create(req.body ?? {});
      library.rememberCluster(server.clusterId);
      return server;
    }),
  );

  api.get(
    '/servers/:id',
    wrap(async (req) => {
      const server = servers.need(req.params.id);
      return {
        ...server,
        runtime: servers.runtime(server.id),
        installed: servers.isInstalled(server),
        launch: servers.buildLaunchPlan(server),
      };
    }),
  );

  api.patch(
    '/servers/:id',
    wrap(async (req) => {
      const server = servers.update(req.params.id, req.body ?? {});
      library.rememberCluster(server.clusterId);
      return server;
    }),
  );

  api.delete(
    '/servers/:id',
    wrap(async (req) => {
      await servers.remove(req.params.id, req.query.deleteFiles === 'true');
      return { ok: true };
    }),
  );

  api.post(
    '/servers/:id/start',
    wrap(async (req) => {
      await servers.start(req.params.id);
      return { ok: true };
    }),
  );

  api.post(
    '/servers/:id/stop',
    wrap(async (req) => {
      await servers.stop(req.params.id, { force: req.body?.force === true, reason: req.body?.reason });
      return { ok: true };
    }),
  );

  api.post(
    '/servers/:id/restart',
    wrap(async (req) => {
      const warn: number[] = Array.isArray(req.body?.warnMinutes) ? req.body.warnMinutes : [];
      if (warn.length) {
        void servers.withWarnings(req.params.id, warn, () => servers.restart(req.params.id), 'restart');
        return { ok: true, scheduled: true, warnMinutes: warn };
      }
      await servers.restart(req.params.id);
      return { ok: true };
    }),
  );

  api.post(
    '/servers/:id/install',
    wrap(async (req) => {
      void servers.installServer(req.params.id, req.body?.validate === true).catch(() => {});
      return { ok: true, started: true };
    }),
  );

  api.post(
    '/servers/:id/cancel',
    wrap(async (req) => {
      const cancelled = servers.cancelPending(req.params.id);
      if (!cancelled) throw new Error('Nothing is running that can be cancelled');
      return { ok: true };
    }),
  );

  api.post(
    '/servers/:id/firewall',
    wrap(async (req) => {
      const server = servers.need(req.params.id);
      const output = await addFirewallRules(server.name, {
        game: server.port,
        query: server.queryPort,
        rcon: server.rconPort,
      });
      return { output };
    }),
  );

  api.get(
    '/servers/:id/console',
    wrap(async (req) => ({ lines: servers.consoleLines(req.params.id) })),
  );

  api.delete(
    '/servers/:id/console',
    wrap(async (req) => {
      servers.clearConsole(req.params.id);
      return { ok: true };
    }),
  );

  // ------------------------------------------------------------------ RCON
  api.post(
    '/servers/:id/rcon',
    wrap(async (req) => {
      const command = String(req.body?.command ?? '').trim();
      if (!command) throw new Error('No command given');
      const response = await servers.rconExec(req.params.id, command);
      return { response };
    }),
  );

  /**
   * A kit is a dozen separate gives, and ARK will not take them as one string.
   * Running them from the browser would mean a dozen round trips over a socket
   * that only answers one command at a time, so the sequencing happens here.
   *
   * Failures do not abort the rest: handing over nine of twelve items and
   * saying which three missed is more useful than stopping halfway with no
   * record of where.
   */
  api.post(
    '/servers/:id/rcon/batch',
    wrap(async (req) => {
      const raw: unknown = req.body?.commands;
      if (!Array.isArray(raw)) throw badRequest('Expected a list of commands');
      const commands = raw.map((c) => String(c ?? '').trim()).filter(Boolean);
      if (!commands.length) throw badRequest('No commands given');
      if (commands.length > 60) throw badRequest('Too many commands in one batch (60 max)');

      const results: Array<{ command: string; response: string; error?: string }> = [];
      for (const command of commands) {
        try {
          results.push({ command, response: await servers.rconExec(req.params.id, command) });
        } catch (err) {
          results.push({ command, response: '', error: err instanceof Error ? err.message : String(err) });
        }
      }
      return { results };
    }),
  );

  /**
   * ARK keeps two ids per player and GiveItemToPlayer accepts only one: the
   * numeric Player ID. ListPlayers reports the other, a thirty-two character
   * EOS id, and Ascended has no RCON command that converts between them -
   * GetPlayerIDForSteamID is an Evolved-era command expecting a Steam id, and
   * asking it here got silence that read as a broken server.
   *
   * The server has been writing the pair down all along though, in every
   * AdminCmd line it logs, so the answer is read out of its own log.
   */
  api.post(
    '/servers/:id/players/resolve',
    wrap((req) => {
      const platformId = String(req.body?.platformId ?? '').trim();
      // Hex, because Ascended lists players by a thirty-two character EOS id.
      // Digits only rejected every id the game actually reports, so picking a
      // player off the live list always answered "not a platform id".
      if (!/^[0-9a-fA-F]{5,40}$/.test(platformId)) {
        throw badRequest(`"${platformId}" does not look like a player id - expected 5 to 40 letters and digits.`);
      }
      const known = servers.arkIdsFor(servers.need(req.params.id));
      const hit = known[platformId.toLowerCase()];
      return {
        ue4Id: hit?.arkId ?? null,
        name: hit?.name ?? null,
        source: hit ? 'log' : null,
        /** How many players ASMS could name, for a message worth reading. */
        seen: Object.keys(known).length,
      };
    }),
  );

  api.post(
    '/servers/:id/rcon/test',
    wrap(async (req) => {
      const server = servers.need(req.params.id);
      const started = Date.now();
      const response = await rconOnce(
        { host: server.multihome.trim() || '127.0.0.1', port: server.rconPort, password: server.adminPassword },
        'ListPlayers',
      );
      return { ok: true, ms: Date.now() - started, response };
    }),
  );

  api.post(
    '/servers/:id/mods/diagnose',
    wrap(async (req) => servers.diagnoseMods(req.params.id)),
  );

  // Cheap enough to poll: it only walks the mod folders on disk.
  api.get(
    '/servers/:id/mods/status',
    wrap(async (req) => servers.diagnoseMods(req.params.id)),
  );

  /**
   * Boot the server just far enough to pull its mods down. Fire and forget, the
   * way an install is - it can take twenty minutes, and the runtime feed
   * already carries the progress.
   */
  api.post(
    '/servers/:id/mods/download',
    wrap(async (req) => {
      // Checked here so a server that is running, or has no mods on, answers
      // with the reason rather than a cheerful "started".
      servers.assertCanDownloadMods(req.params.id);
      void servers.downloadMods(req.params.id).catch(() => {});
      return { ok: true, started: true };
    }),
  );

  /** Delete what ARK unpacked for one mod, so the next start fetches it again. */
  api.post(
    '/servers/:id/mods/:modId/refresh',
    wrap(async (req) => servers.clearModFiles(req.params.id, req.params.modId)),
  );

  api.post(
    '/servers/:id/rcon/diagnose',
    wrap(async (req) => servers.diagnoseRcon(req.params.id)),
  );

  api.get(
    '/servers/:id/players',
    wrap(async (req) => ({ players: await servers.refreshPlayers(req.params.id) })),
  );

  api.post(
    '/servers/:id/players/action',
    wrap(async (req) => {
      const { action, playerId, message } = req.body ?? {};
      const target = String(playerId ?? '').trim();
      switch (action) {
        case 'kick':
          return { response: await servers.rconExec(req.params.id, `KickPlayer ${target}`) };
        case 'ban':
          return { response: await servers.rconExec(req.params.id, `BanPlayer ${target}`) };
        case 'unban':
          return { response: await servers.rconExec(req.params.id, `UnbanPlayer ${target}`) };
        case 'whitelist':
          return { response: await servers.rconExec(req.params.id, `AllowPlayerToJoinNoCheck ${target}`) };
        case 'unwhitelist':
          return { response: await servers.rconExec(req.params.id, `DisallowPlayerToJoinNoCheck ${target}`) };
        // The only one here aimed with the numeric Player ID rather than the
        // EOS id ListPlayers reports: GiveCreativeModeToPlayer takes what the
        // in-game Admin Manager calls the Player ID, same as GiveItemToPlayer.
        // It toggles, so the same call takes creative mode away again.
        case 'creative':
          return { response: await servers.rconExec(req.params.id, `GiveCreativeModeToPlayer ${target}`) };
        case 'message':
          return { response: await servers.rconExec(req.params.id, `ServerChatTo "${target}" ${message ?? ''}`) };
        default:
          throw new Error(`Unknown player action: ${action}`);
      }
    }),
  );

  api.post(
    '/servers/:id/broadcast',
    wrap(async (req) => ({ response: await servers.broadcast(req.params.id, String(req.body?.message ?? '')) })),
  );

  api.post(
    '/servers/:id/save',
    wrap(async (req) => ({ response: await servers.rconExec(req.params.id, 'SaveWorld') })),
  );

  // ---------------------------------------------------------------- config
  api.get(
    '/servers/:id/config',
    wrap(async (req) => {
      const server = servers.need(req.params.id);
      return {
        curated: config.readCurated(server),
        files: {
          gus: { path: config.iniPath(server, 'gus'), text: config.readRaw(server, 'gus') },
          game: { path: config.iniPath(server, 'game'), text: config.readRaw(server, 'game') },
        },
      };
    }),
  );

  api.put(
    '/servers/:id/config',
    wrap(async (req) => {
      const server = servers.need(req.params.id);
      if (req.body?.curated) config.writeCurated(server, req.body.curated as Record<string, string>);
      if (typeof req.body?.gus === 'string') config.writeRaw(server, 'gus', req.body.gus);
      if (typeof req.body?.game === 'string') config.writeRaw(server, 'game', req.body.game);
      return { ok: true, appliedAfterRestart: servers.runtime(server.id).state === 'running' };
    }),
  );

  api.post(
    '/servers/:id/config/sync-identity',
    wrap(async (req) => {
      config.syncIdentity(servers.need(req.params.id));
      return { ok: true };
    }),
  );

  // --------------------------------------------------------------- metrics
  api.get(
    '/servers/:id/metrics',
    wrap(async (req) => ({ points: metrics.history(req.params.id) })),
  );

  api.get(
    '/metrics',
    wrap(async () => ({
      players: metrics.combinedPlayers(servers.list().map((s) => s.id)),
      perServer: Object.fromEntries(servers.list().map((s) => [s.id, metrics.history(s.id)])),
    })),
  );

  // ------------------------------------------------------------------ logs
  const logSource = (req: Request): logs.LogSource => (req.query.source === 'asms' ? 'asms' : 'server');

  api.get(
    '/servers/:id/logs',
    wrap(async (req) => ({ files: logs.listFiles(req.params.id, logSource(req)) })),
  );

  api.get(
    '/servers/:id/logs/read',
    wrap(async (req) => {
      const file = String(req.query.file ?? 'ShooterGame.log');
      const offset = Number(req.query.offset ?? 0);
      return logs.readChunk(req.params.id, file, Number.isFinite(offset) ? offset : 0, logSource(req));
    }),
  );

  api.get(
    '/servers/:id/logs/download',
    wrap(async (req, res) => {
      const file = String(req.query.file ?? 'ShooterGame.log');
      const target = logs.fullPath(req.params.id, file, logSource(req));
      if (!fs.existsSync(target)) throw notFound('That log file no longer exists');
      return res.download(target, path.basename(target));
    }),
  );

  // --------------------------------------------------------------- backups
  api.get(
    '/backups',
    wrap(async (req) => ({ backups: backups.list(req.query.serverId as string | undefined) })),
  );

  api.post(
    '/servers/:id/backup',
    wrap(async (req) => backups.create(req.params.id, 'manual', String(req.body?.note ?? ''))),
  );

  api.post(
    '/backups/:id/restore',
    wrap(async (req) => {
      await backups.restore(req.params.id);
      return { ok: true };
    }),
  );

  api.delete(
    '/backups/:id',
    wrap(async (req) => {
      backups.remove(req.params.id);
      return { ok: true };
    }),
  );

  api.get(
    '/backups/:id/download',
    wrap(async (req, res) => {
      const entry = backups.get(req.params.id);
      if (!entry || !fs.existsSync(entry.file)) throw notFound('That backup file is gone');
      return res.download(entry.file, path.basename(entry.file));
    }),
  );

  // ------------------------------------------------------------- schedules
  api.get(
    '/schedules',
    wrap(async (req) => ({ schedules: scheduler.list(req.query.serverId as string | undefined) })),
  );

  api.post(
    '/schedules',
    wrap(async (req) => scheduler.create(req.body ?? {})),
  );

  api.patch(
    '/schedules/:id',
    wrap(async (req) => scheduler.update(req.params.id, req.body ?? {})),
  );

  api.delete(
    '/schedules/:id',
    wrap(async (req) => {
      scheduler.remove(req.params.id);
      return { ok: true };
    }),
  );

  api.post(
    '/schedules/:id/run',
    wrap(async (req) => {
      void scheduler.runNow(req.params.id).catch(() => {});
      return { ok: true, started: true };
    }),
  );

  api.post(
    '/schedules/validate',
    wrap(async (req) => {
      const expr = String(req.body?.cron ?? '');
      const result = scheduler.validateCron(expr);
      return result.ok ? { ok: true, next: scheduler.describeCron(expr) } : { ok: false, error: result.error };
    }),
  );

  // --------------------------------------------------------------- presets
  api.get('/presets', (_req, res) => res.json({ presets: presets.PRESETS }));

  api.get(
    '/presets/:id/values',
    wrap(async (req) => ({ values: presets.resolveById(req.params.id) })),
  );

  api.post(
    '/servers/:id/config/preset',
    wrap(async (req) => {
      const server = servers.need(req.params.id);
      const preset = presets.getPreset(String(req.body?.presetId ?? ''));
      if (!preset) throw new Error('Pick one of the built-in presets');
      const values = presets.resolve(preset);
      config.writeCurated(server, values);
      return {
        ok: true,
        preset: preset.id,
        changed: Object.keys(values).length,
        restartNeeded: servers.runtime(server.id).state === 'running',
      };
    }),
  );

  // --------------------------------------------------------------- library
  api.get('/library', (_req, res) => res.json(library.get()));

  api.put('/library/mods', wrap(async (req) => library.setMods(req.body?.mods ?? req.body)));
  api.post('/library/mods', wrap(async (req) => library.addMods(req.body?.mods ?? req.body)));
  api.delete('/library/mods/:id', wrap(async (req) => library.removeMod(req.params.id)));

  api.put('/library/clusters', wrap(async (req) => library.setClusters(req.body?.clusters ?? req.body)));
  api.post('/library/clusters', wrap(async (req) => library.addClusters(req.body?.clusters ?? req.body)));
  api.delete('/library/clusters/:id', wrap(async (req) => library.removeCluster(req.params.id)));

  // ---------------------------------------------------------------- setups
  api.get('/setups', (_req, res) => res.json({ setups: setups.list() }));

  /** Snapshot a server without saving it — the UI turns this into a file. */
  api.post(
    '/servers/:id/setup',
    wrap(async (req) => setups.capture(req.params.id, req.body ?? {})),
  );

  api.post(
    '/setups',
    wrap(async (req) => {
      const serverId = String(req.body?.serverId ?? '');
      return setups.store(setups.capture(serverId, req.body ?? {}));
    }),
  );

  api.post(
    '/setups/import',
    wrap(async (req) => setups.store(setups.validateBundle(req.body?.bundle ?? req.body))),
  );

  api.patch(
    '/setups/:id',
    wrap(async (req) => setups.rename(req.params.id, req.body?.name, req.body?.description)),
  );

  api.delete(
    '/setups/:id',
    wrap(async (req) => {
      setups.remove(req.params.id);
      return { ok: true };
    }),
  );

  api.get(
    '/setups/:id/download',
    wrap(async (req, res) => {
      const setup = setups.need(req.params.id);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${setups.fileName(setup.bundle)}"`);
      return res.send(JSON.stringify(setup.bundle, null, 2));
    }),
  );

  api.post(
    '/servers/:id/apply-setup',
    wrap(async (req) => {
      const bundle = req.body?.setupId
        ? setups.need(String(req.body.setupId)).bundle
        : setups.validateBundle(req.body?.bundle);
      return setups.apply(req.params.id, bundle, req.body?.parts);
    }),
  );

  // --------------------------------------------------------------- archive
  // One file with everything in it: the answer to "I am moving this to another
  // PC". Export hands the whole database back as JSON and the browser saves
  // it; preview says what an uploaded file would do before anything is touched.
  api.post(
    '/archive/export',
    wrap(async (req) => archive.exportArchive({ includeSecrets: req.body?.includeSecrets !== false })),
  );

  api.post(
    '/archive/preview',
    wrap(async (req) => archive.summarise(archive.validateArchive(req.body?.archive ?? req.body))),
  );

  api.post(
    '/archive/import',
    wrap(async (req) => {
      const bundle = archive.validateArchive(req.body?.archive);
      return archive.importArchive(bundle, {
        parts: req.body?.parts,
        mode: req.body?.mode === 'replace' ? 'replace' : 'merge',
        rebasePaths: req.body?.rebasePaths === true,
      });
    }),
  );

  // Convenience for the UI: does this install actually look like an ASA server?
  api.post(
    '/system/inspect-path',
    wrap(async (req) => {
      const root = String(req.body?.path ?? '').trim();
      if (!root) throw new Error('No path given');
      return {
        path: root,
        exists: fs.existsSync(root),
        hasServer: fs.existsSync(ark.exe(root)),
        hasSaves: fs.existsSync(ark.savedArks(root)),
        hasConfig: fs.existsSync(ark.gameUserSettings(root)),
        length: checkInstallPath(root),
      };
    }),
  );

  return api;
}
