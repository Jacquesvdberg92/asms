import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useAction } from '../../lib/store';
import { api } from '../../lib/api';
import { Button, Confirm, CopyButton, Modal, Stat, Badge, Toggle } from '../../components/ui';
import { Icon } from '../../components/Icons';
import { Help } from '../../components/Tooltip';
import PendingBar from '../../components/PendingBar';
import { duration, memory, dateTime } from '../../lib/format';
import type { RconCheck, ServerInstance, ServerRuntime } from '../../lib/types';

export default function Overview({ server, runtime }: { server: ServerInstance; runtime?: ServerRuntime }) {
  const { system, toast } = useStore();
  const [busy, run] = useAction();
  const navigate = useNavigate();
  const [launch, setLaunch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [doctor, setDoctor] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    void api
      .get<{ launch: { display: string } }>(`/servers/${server.id}`)
      .then((s) => setLaunch(s.launch.display))
      .catch(() => {});
  }, [server.id, server.updatedAt]);

  const state = runtime?.state ?? 'stopped';
  const lan = system?.addresses?.[0] ?? '127.0.0.1';
  // ARK takes the join password on the connect line itself; leaving it off
  // sends players to a password prompt that fails more often than it works.
  const joinCommand = `open ${lan}:${server.port}${server.serverPassword ? `?Password=${server.serverPassword}` : ''}`;
  const busyState = state === 'installing' || state === 'updating';

  return (
    <div className="stack">
      <PendingBar serverId={server.id} runtime={runtime} />
      {busyState && !runtime?.pending ? (
        <div className="card card-pad stack" style={{ gap: 10 }}>
          <div className="row">
            <span className="spinner" />
            <span className="strong">{state === 'installing' ? 'Installing server files' : 'Updating server files'}</span>
            <div className="spacer" />
            <span className="small faint">{runtime?.progressText}</span>
          </div>
          <div className={`progress ${runtime?.progress ? '' : 'indeterminate'}`}>
            <span style={{ width: `${runtime?.progress ?? 30}%` }} />
          </div>
        </div>
      ) : null}

      <div className="grid grid-3">
        <div className="card card-pad">
          <Stat label="Uptime" value={state === 'running' && runtime ? duration(now - runtime.since) : '—'} sub={runtime?.pid ? `pid ${runtime.pid}` : 'not running'} />
        </div>
        <div className="card card-pad">
          <Stat label="Players" value={`${runtime?.players ?? 0}/${server.maxPlayers}`} sub={runtime?.rconConnected ? 'live via RCON' : 'RCON not connected'} />
        </div>
        <div className="card card-pad">
          <Stat label="CPU" value={`${runtime?.cpu?.toFixed(1) ?? '0.0'}%`} sub={system ? `${system.cores} cores` : ''} />
        </div>
        <div className="card card-pad">
          <Stat label="Memory" value={memory(runtime?.memMB ?? 0)} sub={system ? `of ${memory(system.memory.totalMB)}` : ''} />
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <Icon.Globe />
            <h3>How players join</h3>
            <Help
              title="Why not the server browser?"
              body="ASA's in-game browser is unreliable and often hides healthy servers. Pasting this line into the in-game console (Tab key) always works."
            />
          </div>
          <div className="card-body stack">
            <div className="stack" style={{ gap: 6 }}>
              <span className="stat-label">In-game console (works past the broken server browser)</span>
              <div className="row">
                <code className="code" style={{ flex: 1 }}>
                  {joinCommand}
                </code>
                <CopyButton text={joinCommand} />
              </div>
              <span className="tiny faint">
                {server.serverPassword
                  ? 'The join password is part of this line — whoever you send it to can get straight in.'
                  : 'Press Tab in game to open the console, paste, press Enter.'}
              </span>
            </div>
            <dl className="kv">
              <dt>Session name</dt>
              <dd>{server.sessionName || server.name}</dd>
              <dt>Join password</dt>
              <dd>{server.serverPassword ? server.serverPassword : <span className="faint">none — open server</span>}</dd>
              <dt>Ports</dt>
              <dd>
                {server.port}–{server.port + 1} UDP · {server.queryPort} query · {server.rconPort} RCON
              </dd>
              <dt>LAN address</dt>
              <dd className="mono">{system?.addresses?.join(', ') || 'unknown'}</dd>
            </dl>
            <div className="row row-wrap">
              <Button
                size="sm"
                busy={busy}
                onClick={() =>
                  void run(async () => {
                    const res = await api.post<{ output: string }>(`/servers/${server.id}/firewall`);
                    toast('info', 'Firewall rules', res.output);
                  })
                }
              >
                <Icon.Shield /> Add firewall rules
              </Button>
              <Help
                title="Windows Firewall only"
                body="Adds inbound rules for the game, query and RCON ports. ASMS must be running as administrator, and this does not touch your router - you still forward ports there yourself."
              />
              <Button
                size="sm"
                busy={busy}
                onClick={() =>
                  void run(async () => {
                    const res = await api.post<{ ms: number }>(`/servers/${server.id}/rcon/test`);
                    toast('success', 'RCON is reachable', `Round trip ${res.ms} ms`);
                    return res;
                  }).then((ok) => {
                    // A failed test is exactly when the diagnosis is wanted.
                    if (!ok) setDoctor(true);
                  })
                }
              >
                <Icon.Bolt /> Test RCON
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDoctor(true)}>
                Diagnose
              </Button>
              <Help
                title="Check the admin connection"
                body="Test runs ListPlayers over a fresh connection. Diagnose goes further when it fails: it checks the port, what the launch command actually gave ARK, what the config file says, and which password the running server really accepts."
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <Icon.Package />
            <h3>Files &amp; build</h3>
          </div>
          <div className="card-body stack">
            <dl className="kv">
              <dt>Install folder</dt>
              <dd className="mono">{server.installPath}</dd>
              <dt>Installed build</dt>
              <dd>
                {runtime?.buildId ?? 'not installed'}{' '}
                {runtime?.updateAvailable ? <Badge tone="warn">update available</Badge> : null}
              </dd>
              <dt>Created</dt>
              <dd>{dateTime(server.createdAt)}</dd>
              <dt>Last edited</dt>
              <dd>{dateTime(server.updatedAt)}</dd>
            </dl>
            <div className="row row-wrap">
              <Button
                size="sm"
                busy={busy}
                disabled={state !== 'stopped' && state !== 'crashed'}
                onClick={() => void run(() => api.post(`/servers/${server.id}/install`), 'SteamCMD started')}
              >
                <Icon.Download /> {runtime?.buildId ? 'Update files' : 'Install files'}
              </Button>
              <Button
                size="sm"
                busy={busy}
                disabled={state !== 'stopped' && state !== 'crashed'}
                onClick={() => void run(() => api.post(`/servers/${server.id}/install`, { validate: true }), 'Validating files')}
              >
                <Icon.Check /> Verify integrity
              </Button>
              <Help
                title="Re-check every file against Steam"
                body="Slow, because it walks the whole install - but it repairs a corrupt download, which is the usual cause of a server that dies the moment it starts."
              />
            </div>
            <span className="tiny faint">Verifying re-checks every file against Steam. Slow, but it fixes a corrupt install.</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <Icon.Terminal />
          <h3>Launch command</h3>
          <Help
            title="Exactly what ASMS runs"
            body="Every part of this comes from the Settings and Mods tabs. Nothing is hidden - you could paste it into a command prompt and get the same server."
          />
          <div className="spacer" />
          <CopyButton text={launch} />
        </div>
        <div className="card-body">
          <code className="code">{launch || 'Loading…'}</code>
          <p className="tiny faint" style={{ marginTop: 8 }}>
            This is exactly what ASMS runs. Everything in it comes from the Settings and Mods tabs — nothing is hidden.
            Names and passwords are deliberately not here: ARK mangles text values in this string, so they go into
            GameUserSettings.ini instead. That also makes this line safe to paste into a support thread.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <Icon.Alert />
          <h3>Danger zone</h3>
        </div>
        <div className="card-body row row-wrap">
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="strong">Delete this server</div>
            <div className="small faint">Removes it from ASMS, along with its schedules and backup records.</div>
          </div>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <Icon.Trash /> Delete server
          </Button>
        </div>
      </div>

      {doctor ? <RconDoctor server={server} onClose={() => setDoctor(false)} /> : null}

      {confirmDelete ? (
        <Confirm
          title={`Delete ${server.name}?`}
          danger
          confirmLabel="Delete server"
          requireText={server.name}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() =>
            void run(async () => {
              await api.del(`/servers/${server.id}?deleteFiles=${deleteFiles}`);
              navigate('/');
            }, 'Server deleted')
          }
          body={
            <div className="stack">
              <p>This removes the server from ASMS. Its schedules and backup records go with it.</p>
              <Toggle
                checked={deleteFiles}
                onChange={setDeleteFiles}
                title="Also delete the install folder"
                help={`Permanently erases ${server.installPath} — including every save in it.`}
              />
            </div>
          }
        />
      ) : null}
    </div>
  );
}

/**
 * "Wrong admin password" on its own sends people hunting through INI files.
 * This walks the chain — process, port, what the command line gave ARK, what
 * the config file says, what the server actually accepts — and names the link
 * that is broken.
 */
function RconDoctor({ server, onClose }: { server: ServerInstance; onClose: () => void }) {
  const [busy, run] = useAction();
  const [result, setResult] = useState<{ checks: RconCheck[]; verdict: string } | null>(null);

  useEffect(() => {
    void run(async () => {
      const res = await api.post<{ checks: RconCheck[]; verdict: string }>(`/servers/${server.id}/rcon/diagnose`);
      setResult(res);
      return res;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  const ICONS: Record<RconCheck['status'], string> = { ok: '✓', bad: '✕', warn: '!', skip: '–' };
  const TONES: Record<RconCheck['status'], string> = { ok: 'var(--ok)', bad: 'var(--bad)', warn: 'var(--warn)', skip: 'var(--text-faint)' };

  return (
    <Modal title="RCON check" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      {busy || !result ? (
        <div className="row dim">
          <span className="spinner" /> Working through the connection…
        </div>
      ) : (
        <div className="stack">
          {result.checks.map((check) => (
            <div key={check.name} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
              <span className="strong" style={{ color: TONES[check.status], width: 14, flex: 'none' }}>
                {ICONS[check.status]}
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="small strong">{check.name}</div>
                <div className="tiny faint" style={{ lineHeight: 1.5 }}>
                  {check.detail}
                </div>
              </div>
            </div>
          ))}
          <div className="divider" />
          <div className="callout">
            <Icon.Bolt size={15} />
            <div>{result.verdict}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
