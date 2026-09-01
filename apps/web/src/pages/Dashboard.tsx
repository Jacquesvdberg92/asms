import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, useAction } from '../lib/store';
import { api } from '../lib/api';
import { TopBar } from '../components/Shell';
import { Button, Empty, Meter, StateBadge, Stat, Badge, Toggle, SearchInput } from '../components/ui';
import { Tooltip, Help } from '../components/Tooltip';
import { AreaChart, Sparkline, type Point } from '../components/charts';
import { Icon } from '../components/Icons';
import { QuickActionsRow } from '../components/QuickActions';
import { duration, memory } from '../lib/format';
import { matches } from '../lib/search';
import type { MetricPoint, ServerInstance, ServerRuntime } from '../lib/types';

export default function Dashboard() {
  const { servers, runtimes, system, metrics, toast } = useStore();
  const [, run] = useAction();
  const [now, setNow] = useState(Date.now());
  const [find, setFind] = useState('');
  const navigate = useNavigate();

  const visibleServers = servers.filter((s) => matches(find, s.name, s.map, s.sessionName, String(s.port)));

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const running = servers.filter((s) => runtimes[s.id]?.state === 'running');
  const players = servers.reduce((sum, s) => sum + (runtimes[s.id]?.players ?? 0), 0);
  const slots = servers.reduce((sum, s) => sum + s.maxPlayers, 0);
  const ramMB = servers.reduce((sum, s) => sum + (runtimes[s.id]?.memMB ?? 0), 0);
  const needUpdate = servers.filter((s) => runtimes[s.id]?.updateAvailable).length;

  /** Sum every server's player count onto one shared 5-second timeline. */
  const combined = useMemo<Point[]>(() => {
    const buckets = new Map<number, number>();
    for (const series of Object.values(metrics)) {
      for (const point of series as MetricPoint[]) {
        const bucket = Math.round(point.t / 5000) * 5000;
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + point.players);
      }
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
  }, [metrics]);

  return (
    <>
      <TopBar
        title="Dashboard"
        sub={system ? `${system.hostname} · ${system.cores} cores · ${memory(system.memory.totalMB)} RAM` : undefined}
        actions={
          <>
            <Tooltip
              title="Check Steam for a new build"
              body="Compares the build id installed on each server against the public branch on Steam. It does not install anything."
            >
              <Button
                onClick={() =>
                  void run(async () => {
                    const res = await api.post<{ latest: string | null }>('/system/check-updates');
                    toast(
                      'info',
                      res.latest ? `Steam is on build ${res.latest}` : 'Could not reach Steam',
                      res.latest ? 'Servers behind that build now show an Update badge.' : 'Check that SteamCMD is installed.',
                    );
                  })
                }
              >
                <Icon.Refresh /> Check for updates
              </Button>
            </Tooltip>
            <Button variant="primary" onClick={() => navigate('/servers/new')}>
              <Icon.Plus /> New server
            </Button>
          </>
        }
      />

      <div className="content stack">
        <SetupChecklist />

        {servers.length === 0 ? (
          <div className="card">
            <Empty
              icon="🦖"
              title="No servers yet"
              body="Create your first ARK: Survival Ascended server. ASMS fetches SteamCMD, installs the server files, picks free ports and writes the config for you."
              action={
                <div className="btn-group">
                  <Button variant="primary" onClick={() => navigate('/servers/new')}>
                    <Icon.Plus /> Create a server
                  </Button>
                  <Link className="btn" to="/guide">
                    Read the setup guide
                  </Link>
                </div>
              }
            />
          </div>
        ) : (
          <>
            <div className="grid grid-hero">
              <div className="card card-body stack" style={{ justifyContent: 'space-between' }}>
                <div className="row">
                  <span className="stat-label">Players online</span>
                  <Help body="Live count from every running server, refreshed over RCON every 20 seconds." />
                </div>
                <div>
                  <div style={{ fontSize: 52, fontWeight: 680, letterSpacing: '-0.03em', lineHeight: 1 }}>{players}</div>
                  <div className="stat-sub" style={{ marginTop: 6 }}>
                    of {slots} slots across {servers.length} server{servers.length === 1 ? '' : 's'}
                  </div>
                </div>
                <Meter value={players} max={Math.max(1, slots)} />
              </div>

              <div className="card">
                <div className="card-head">
                  <Icon.Users />
                  <h3>Players over the last 15 minutes</h3>
                  <div className="spacer" />
                  <span className="card-hint">hover for a reading</span>
                </div>
                <div className="card-body">
                  <AreaChart
                    points={combined}
                    label="players"
                    ceiling={slots}
                    height={168}
                    emptyText="Collecting data — the chart fills in over the first minute."
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-3">
              <div className="card card-pad">
                <Stat label="Servers running" value={`${running.length}/${servers.length}`} sub={running.length ? 'all good' : 'nothing is up'} />
              </div>
              <div className="card card-pad">
                <Stat label="Memory in use" value={memory(ramMB)} sub={system ? `host has ${memory(system.memory.totalMB)}` : ''} />
              </div>
              <div className="card card-pad">
                <Stat
                  label="Updates"
                  value={needUpdate ? `${needUpdate} pending` : 'Up to date'}
                  sub={needUpdate ? 'Steam has a newer build' : 'matches the public branch'}
                />
              </div>
              <div className="card card-pad">
                <Stat
                  label="SteamCMD"
                  value={system?.steamCmd.installed ? 'Ready' : 'Missing'}
                  sub={system?.steamCmd.installed ? 'installs and updates work' : 'install it to add servers'}
                />
              </div>
            </div>

            {servers.length > 3 ? (
              <div className="row row-wrap">
                <SearchInput
                  value={find}
                  onChange={setFind}
                  width={320}
                  placeholder="Find a server — name, map or port…"
                  hint={find ? `${visibleServers.length} of ${servers.length}` : undefined}
                />
                <span className="spacer" />
                <span className="tiny faint">
                  Press <span className="mono">Ctrl K</span> to search settings, mods and help as well
                </span>
              </div>
            ) : null}

            <div className="grid grid-cards">
              {visibleServers.map((server) => (
                <ServerCard key={server.id} server={server} runtime={runtimes[server.id]} history={metrics[server.id] ?? []} now={now} />
              ))}
            </div>

            {find && !visibleServers.length ? (
              <div className="card card-pad center dim">No server matches “{find}”.</div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

/**
 * First-run guidance. Each step reflects real state, so it ticks itself off as
 * the user goes, and disappears entirely once everything is done.
 */
function SetupChecklist() {
  const { system, servers, runtimes, settings, refreshSystem } = useStore();
  const [busy, run] = useAction();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('asms.setupDismissed') === '1');
  const navigate = useNavigate();

  const steamReady = !!system?.steamCmd.installed;
  const hasServer = servers.length > 0;
  const installed = servers.some((s) => runtimes[s.id]?.buildId);
  const hasRun = servers.some((s) => {
    const rt = runtimes[s.id];
    return rt?.state === 'running' || rt?.lastExitCode !== null;
  });
  const secured = !!settings?.passwordSet || settings?.bindHost === '127.0.0.1';

  const steps = [
    {
      done: steamReady,
      title: 'Install SteamCMD',
      body: 'Valve’s downloader. ASMS fetches it for you — about 50 MB.',
      action: steamReady ? null : (
        <Button
          size="sm"
          variant="primary"
          busy={busy}
          onClick={() =>
            void run(async () => {
              await api.post('/system/steamcmd/install');
              await refreshSystem();
            }, 'SteamCMD installed')
          }
        >
          Install now
        </Button>
      ),
    },
    {
      done: hasServer,
      title: 'Create a server',
      body: 'Name it, pick a map, and ASMS chooses free ports for you.',
      action: hasServer ? null : (
        <Button size="sm" variant="primary" onClick={() => navigate('/servers/new')}>
          New server
        </Button>
      ),
    },
    {
      done: installed,
      title: 'Download the server files',
      body: 'Roughly 30 GB through SteamCMD. Watch it in the Console tab; you can cancel any time.',
      action: null,
    },
    {
      done: hasRun,
      title: 'Start it once and open the ports',
      body: 'Forward the game and query ports on your router, then use the Add firewall rules button on the server’s Overview tab.',
      action: null,
    },
    {
      done: secured,
      title: 'Decide who can reach ASMS',
      body: 'Set a password, or bind to 127.0.0.1 if you only ever use it on this PC.',
      action: secured ? null : (
        <Button size="sm" onClick={() => navigate('/settings')}>
          Open settings
        </Button>
      ),
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (dismissed || doneCount === steps.length) return null;
  const currentIndex = steps.findIndex((s) => !s.done);

  return (
    <div className="card">
      <div className="card-head">
        <Icon.Check />
        <h3>Getting set up</h3>
        <Badge tone="accent">
          {doneCount}/{steps.length}
        </Badge>
        <div className="spacer" />
        <Link className="btn btn-sm btn-ghost" to="/guide">
          Full guide
        </Link>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            localStorage.setItem('asms.setupDismissed', '1');
            setDismissed(true);
          }}
        >
          Hide
        </Button>
      </div>
      <div className="card-body">
        <div className="checklist">
          {steps.map((step, i) => (
            <div key={step.title} className={`check-row ${step.done ? 'done' : ''} ${i === currentIndex ? 'current' : ''}`}>
              <span className="check-mark">{step.done ? '✓' : i + 1}</span>
              <span className="check-text">
                <span className="check-title">{step.title}</span>
                <span className="check-body">{step.body}</span>
              </span>
              {step.action}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ServerCard({
  server,
  runtime,
  history,
  now,
}: {
  server: ServerInstance;
  runtime?: ServerRuntime;
  history: MetricPoint[];
  now: number;
}) {
  const [busy, run] = useAction();
  // Its own action state, so flicking auto-start does not grey out Start/Stop.
  const [autoBusy, runAuto] = useAction();
  const { refresh } = useStore();
  const state = runtime?.state ?? 'stopped';
  const busyState = state === 'starting' || state === 'stopping' || state === 'installing' || state === 'updating';
  const accent =
    state === 'running' ? 'var(--ok)' : state === 'crashed' ? 'var(--bad)' : busyState ? 'var(--warn)' : 'var(--line-strong)';

  return (
    <div className="card server-card">
      <span className="accentbar" style={{ background: accent }} />
      <div className="card-body stack" style={{ gap: 14 }}>
        <div className="row">
          <div style={{ minWidth: 0, flex: 1 }}>
            <Link to={`/servers/${server.id}`} className="strong truncate" style={{ fontSize: 15, display: 'block' }}>
              {server.name}
            </Link>
            <div className="small faint truncate">
              {server.map} · port {server.port}
              {server.clusterId ? ` · cluster ${server.clusterId}` : ''}
            </div>
          </div>
          <StateBadge state={state} />
        </div>

        {runtime?.pending ? (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row small">
              {runtime.pending.kind === 'countdown' ? <Icon.Clock size={13} /> : <span className="spinner" />}
              <span>{runtime.pending.label}</span>
              <div className="spacer" />
              <Button size="sm" variant="danger" busy={busy} onClick={() => void run(() => api.post(`/servers/${server.id}/cancel`), 'Cancelled')}>
                Cancel
              </Button>
            </div>
            {runtime.pending.kind === 'install' ? (
              <>
                <div className={`progress ${runtime.progress ? '' : 'indeterminate'}`}>
                  <span style={{ width: `${runtime.progress ?? 30}%` }} />
                </div>
                <div className="tiny faint">{runtime.progressText ?? 'Working…'}</div>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="row" style={{ gap: 18, alignItems: 'flex-end' }}>
          <Stat label="Players" value={`${runtime?.players ?? 0}/${server.maxPlayers}`} />
          <Stat label="CPU" value={`${runtime?.cpu?.toFixed(0) ?? 0}%`} />
          <Stat label="RAM" value={memory(runtime?.memMB ?? 0)} />
          <div className="spacer" />
          <Tooltip title="Players, last 15 minutes" body="Each point is one 5-second sample. Hover the big chart above for exact readings.">
            <Sparkline values={history.map((p) => p.players)} ceiling={server.maxPlayers} />
          </Tooltip>
        </div>

        <Meter value={runtime?.players ?? 0} max={Math.max(1, server.maxPlayers)} />

        <div className="row row-wrap" style={{ gap: 6 }}>
          <Badge>{state === 'running' && runtime ? `up ${duration(now - runtime.since)}` : 'not running'}</Badge>
          {runtime?.updateAvailable ? (
            <Tooltip title="A newer build is on Steam" body="Stop the server and run Update files from its Overview tab, or let Update before start handle it.">
              <Badge tone="warn">Update available</Badge>
            </Tooltip>
          ) : null}
          {runtime?.rconConnected ? (
            <Tooltip title="RCON connected" body="ASMS can read the player list and shut the server down gracefully.">
              <Badge tone="ok">RCON</Badge>
            </Tooltip>
          ) : server.rconEnabled ? (
            <Badge>RCON idle</Badge>
          ) : (
            <Tooltip title="RCON is off" body="Without it there is no console, no player list and no graceful restart. Turn it on under Settings → Server & launch.">
              <Badge tone="warn">RCON off</Badge>
            </Tooltip>
          )}
          {server.mods.some((m) => m.enabled) ? (
            <Badge tone="info">{server.mods.filter((m) => m.enabled).length} mods</Badge>
          ) : null}
          {runtime?.buildId ? <Badge>build {runtime.buildId}</Badge> : <Badge tone="warn">not installed</Badge>}
        </div>

        {runtime?.lastError ? <div className="small bad-text">{runtime.lastError}</div> : null}

        <Toggle
          checked={server.autoStart}
          disabled={autoBusy}
          onChange={(v) =>
            void runAuto(async () => {
              await api.patch(`/servers/${server.id}`, { autoStart: v });
              await refresh();
            }, v ? `${server.name} will start with ASMS` : `${server.name} will stay down until you start it`)
          }
          title="Auto-start"
          help={
            server.autoStart
              ? 'Comes back on its own when ASMS starts — including after a reboot'
              : 'Stays down after a reboot until someone presses Start'
          }
        />

        <QuickActionsRow server={server} runtime={runtime} />

        <div className="row" style={{ gap: 6 }}>
          {state === 'running' || state === 'starting' ? (
            <>
              <Tooltip title="Stop the server" body="Saves the world over RCON first, then waits up to two minutes for a clean exit.">
                <Button size="sm" variant="danger" busy={busy} onClick={() => void run(() => api.post(`/servers/${server.id}/stop`), 'Stopping…')}>
                  <Icon.Stop /> Stop
                </Button>
              </Tooltip>
              <Button size="sm" busy={busy} onClick={() => void run(() => api.post(`/servers/${server.id}/restart`), 'Restarting…')}>
                <Icon.Restart /> Restart
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ok"
              busy={busy}
              disabled={busyState}
              onClick={() => void run(() => api.post(`/servers/${server.id}/start`), 'Starting…')}
            >
              <Icon.Play /> Start
            </Button>
          )}
          <div className="spacer" />
          <Link to={`/servers/${server.id}/console`} className="btn btn-sm btn-ghost">
            <Icon.Terminal size={14} /> Console
          </Link>
          <Link to={`/servers/${server.id}`} className="btn btn-sm btn-ghost">
            Manage <Icon.Chevron size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}
