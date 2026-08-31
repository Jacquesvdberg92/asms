import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore, useAction } from '../lib/store';
import { api } from '../lib/api';
import { TopBar } from '../components/Shell';
import { Button, Callout, Confirm, Empty, StateBadge, Tabs } from '../components/ui';
import { Icon } from '../components/Icons';
import { duration } from '../lib/format';
import Overview from './server/Overview';
import ConsolePanel from './server/Console';
import Players from './server/Players';
import SettingsPanel from './server/SettingsPanel';
import Mods from './server/Mods';
import Backups from './server/Backups';
import Schedule from './server/Schedule';
import Logs from './server/Logs';

type TabId = 'overview' | 'console' | 'players' | 'settings' | 'mods' | 'backups' | 'schedule' | 'logs';

const TAB_IDS: TabId[] = ['overview', 'console', 'players', 'settings', 'mods', 'backups', 'schedule', 'logs'];

export default function ServerDetail() {
  const { id = '', tab } = useParams();
  const navigate = useNavigate();
  const { serverOf, runtimeOf, backups, schedules } = useStore();
  const [busy, run] = useAction();
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const server = serverOf(id);
  const runtime = runtimeOf(id);
  const active: TabId = TAB_IDS.includes(tab as TabId) ? (tab as TabId) : 'overview';

  if (!server) {
    return (
      <>
        <TopBar title="Server not found" />
        <div className="content">
          <div className="card">
            <Empty icon="🤔" title="That server is gone" body="It may have been deleted from another browser tab." action={<Button onClick={() => navigate('/')}>Back to dashboard</Button>} />
          </div>
        </div>
      </>
    );
  }

  const state = runtime?.state ?? 'stopped';
  const live = state === 'running' || state === 'starting';
  const transitioning = state === 'starting' || state === 'stopping' || state === 'installing' || state === 'updating';

  return (
    <>
      <TopBar
        title={
          <span className="row" style={{ gap: 10 }}>
            {server.name} <StateBadge state={state} />
          </span>
        }
        sub={
          <>
            {server.map} · {server.port} · {runtime?.players ?? 0}/{server.maxPlayers} players
            {state === 'running' && runtime ? ` · up ${duration(now - runtime.since)}` : ''}
            {state === 'starting' && runtime ? ` · starting for ${duration(now - runtime.since)}` : ''}
          </>
        }
        actions={
          <>
            {live ? (
              <>
                <Button variant="danger" busy={busy} onClick={() => void run(() => api.post(`/servers/${id}/stop`), 'Stopping…')}>
                  <Icon.Stop /> Stop
                </Button>
                <Button busy={busy} onClick={() => setConfirmRestart(true)}>
                  <Icon.Restart /> Restart
                </Button>
                <Button busy={busy} onClick={() => void run(() => api.post(`/servers/${id}/save`), 'World saved')}>
                  <Icon.Save /> Save world
                </Button>
              </>
            ) : (
              <Button variant="ok" busy={busy} disabled={transitioning} onClick={() => void run(() => api.post(`/servers/${id}/start`), 'Starting…')}>
                <Icon.Play /> Start
              </Button>
            )}
          </>
        }
      />

      <div className="content stack">
        {runtime?.identityStale ? (
          <Callout
            tone="warn"
            title="Restart needed — the running server has different credentials"
            action={
              <Button size="sm" busy={busy} onClick={() => setConfirmRestart(true)}>
                <Icon.Restart size={13} /> Restart
              </Button>
            }
          >
            ARK reads passwords, names and ports once at boot. This one is running with something other than what ASMS shows
            here, so both the join password and in-game <span className="mono">enablecheats</span> will reject it — which
            looks exactly like admin commands being broken.
          </Callout>
        ) : null}

        <Tabs
          active={active}
          onChange={(next) => navigate(`/servers/${id}/${next}`)}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'console', label: 'Console' },
            { id: 'players', label: 'Players', count: runtime?.players ?? 0 },
            { id: 'settings', label: 'Settings' },
            { id: 'mods', label: 'Mods', count: server.mods.filter((m) => m.enabled).length },
            { id: 'backups', label: 'Backups', count: backups.filter((b) => b.serverId === id).length },
            { id: 'schedule', label: 'Schedule', count: schedules.filter((s) => s.serverId === id).length },
            { id: 'logs', label: 'Logs' },
          ]}
        />

        {active === 'overview' ? <Overview server={server} runtime={runtime} /> : null}
        {active === 'console' ? <ConsolePanel server={server} runtime={runtime} /> : null}
        {active === 'players' ? <Players server={server} runtime={runtime} /> : null}
        {active === 'settings' ? <SettingsPanel server={server} runtime={runtime} /> : null}
        {active === 'mods' ? <Mods server={server} runtime={runtime} /> : null}
        {active === 'backups' ? <Backups server={server} runtime={runtime} /> : null}
        {active === 'schedule' ? <Schedule server={server} /> : null}
        {active === 'logs' ? <Logs server={server} /> : null}
      </div>

      {confirmRestart ? (
        <RestartDialog serverId={id} onClose={() => setConfirmRestart(false)} />
      ) : null}
    </>
  );
}

function RestartDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const [, run] = useAction();
  const [warn, setWarn] = useState('15,10,5,1');

  const fire = (minutes: number[]) =>
    void run(
      () => api.post(`/servers/${serverId}/restart`, { warnMinutes: minutes }),
      minutes.length ? `Countdown started — restarting in ${Math.max(...minutes)} minutes` : 'Restarting now',
    ).then(onClose);

  return (
    <Confirm
      title="Restart server"
      confirmLabel="Restart now"
      danger
      onConfirm={() => fire([])}
      onClose={onClose}
      body={
        <div className="stack">
          <Callout tone="warn" title="Restarting now kicks everyone off immediately">
            Anything not yet saved to the world — the last few minutes of building, taming and loot — is lost with them. Give
            players a countdown instead: ASMS broadcasts a warning at each mark, saves the world, and restarts exactly on
            time.
          </Callout>
          <div className="row">
            <input
              className="input input-mono"
              value={warn}
              onChange={(e) => setWarn(e.target.value)}
              style={{ maxWidth: 180 }}
              aria-label="Warning marks in minutes"
            />
            <Button
              variant="primary"
              onClick={() =>
                fire(
                  warn
                    .split(/[,\s]+/)
                    .map((n) => Number(n.trim()))
                    .filter((n) => Number.isFinite(n) && n > 0),
                )
              }
            >
              <Icon.Clock size={14} /> Warn, then restart
            </Button>
          </div>
          <span className="tiny faint">
            Minutes before the restart to broadcast a warning, comma separated. The first number is when the countdown
            starts — 15,10,5,1 means the server goes down in fifteen minutes.
          </span>
        </div>
      }
    />
  );
}
