import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, useAction } from '../lib/store';
import { api } from '../lib/api';
import { TopBar } from '../components/Shell';
import { Button, Field, Toggle, Badge, Stat, CopyButton, Callout, SearchInput } from '../components/ui';
import { Icon } from '../components/Icons';
import { Help } from '../components/Tooltip';
import { AppUpdate } from '../components/AppUpdate';
import { matches } from '../lib/search';
import { useHashTarget } from '../lib/hash';
import { duration, memory } from '../lib/format';
import type { AppSettings } from '../lib/types';

const ACCENTS = [
  { id: 'ember', label: 'Ember', color: '#ff7a2f' },
  { id: 'cyan', label: 'Cyan', color: '#2fd8ff' },
  { id: 'violet', label: 'Violet', color: '#a37bff' },
  { id: 'lime', label: 'Lime', color: '#9fe322' },
];

const NOTIFY_KINDS = ['crash', 'update', 'restart', 'backup', 'start', 'stop'];

/** The three answers to "who should be able to open this dashboard?". */
const BIND_MODES: Array<{ id: string; label: string; host: string | null; help: string }> = [
  {
    id: 'local',
    label: 'This PC only',
    host: '127.0.0.1',
    help: 'Only a browser on this machine can reach ASMS. The safest option, and the right one if you never leave the desk.',
  },
  {
    id: 'network',
    label: 'Anything on my network',
    host: '0.0.0.0',
    help: 'Phones, tablets and laptops on the same network can open the dashboard. Set a password when you use this.',
  },
  {
    id: 'custom',
    label: 'Custom address',
    host: null,
    help: 'Bind to one specific network card — useful on a machine with several, or behind a reverse proxy.',
  },
];

/**
 * Nine cards is more than anyone scans, so each one is addressable: the chips
 * jump to it, the search box hides everything else, and the Ctrl-K palette
 * links straight to #folders, #access and the rest.
 */
const SECTIONS: Array<{ id: string; title: string; words: string }> = [
  { id: 'folders', title: 'Folders', words: 'install root path backup cluster steamcmd drive where files go' },
  { id: 'maintenance', title: 'Maintenance', words: 'update check interval retention how many backups keep delete oldest' },
  { id: 'startup', title: 'Starting up', words: 'autostart boot reboot power cut which servers come back delay' },
  { id: 'launching', title: 'Launching', words: 'proton wine wrapper linux docker command' },
  { id: 'access', title: 'Access', words: 'password bind host port network phone lan remote who can reach security vpn' },
  { id: 'notifications', title: 'Notifications', words: 'discord webhook alert crash update restart backup message' },
  { id: 'appearance', title: 'Appearance', words: 'accent colour color theme browser open on start' },
  { id: 'machine', title: 'This machine', words: 'host cpu cores memory ram uptime steamcmd data folder addresses' },
  { id: 'version', title: 'ASMS version', words: 'update upgrade check for updates version git pull install new release changelog' },
];

export default function Settings() {
  const { settings, system, refresh, refreshSystem, toast } = useStore();
  const [busy, run] = useAction();
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [find, setFind] = useState('');

  useEffect(() => setDraft(settings), [settings]);

  // The palette links to /settings#access and friends, so land on the card and
  // flash it.
  useHashTarget(true);

  if (!draft) return null;

  const shown = SECTIONS.filter((s) => matches(find, s.id, s.title, s.words));
  const box = (id: string) => (shown.some((s) => s.id === id) ? undefined : { display: 'none' });

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const bindMode = draft.bindHost === '127.0.0.1' || draft.bindHost === 'localhost' ? 'local' : draft.bindHost === '0.0.0.0' || !draft.bindHost ? 'network' : 'custom';
  const listenPort = system?.listen?.port ?? settings?.port ?? draft.port;
  const remoteUrls = (system?.addresses ?? []).map((address) => `http://${address}:${listenPort}`);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const save = () =>
    void run(async () => {
      const res = await api.put<AppSettings & { sessionsRevoked?: boolean }>('/settings', draft);
      if (res.sessionsRevoked) toast('warn', 'Password changed', 'Everyone signed in elsewhere has been signed out.');
      await refresh();
    }, 'Settings saved');

  return (
    <>
      <TopBar
        title="Settings"
        sub="Applies to ASMS itself — per-server options live on each server"
        actions={
          <>
            <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(settings)}>
              Discard
            </Button>
            <Button variant="primary" busy={busy} disabled={!dirty} onClick={save}>
              <Icon.Save /> Save settings
            </Button>
          </>
        }
      />

      <div className="content content-narrow stack">
        <div className="card card-pad stack" style={{ gap: 12 }}>
          <SearchInput
            value={find}
            onChange={setFind}
            placeholder="Find a setting — password, folder, Discord, autostart…"
            hint={find ? `${shown.length} of ${SECTIONS.length} sections` : undefined}
          />
          <div className="toc">
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                onClick={() => setFind('')}
                className={shown.some((s) => s.id === section.id) ? '' : 'faint'}
              >
                {section.title}
              </a>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <Callout tone="info" title={`Nothing here matches “${find}”`}>
            These are settings for ASMS itself. Rates, mods, ports and passwords belong to a server — press{' '}
            <span className="mono">Ctrl K</span> to search those too.
          </Callout>
        ) : null}

        <div className="card" id="folders" style={box('folders')}>
          <div className="card-head">
            <Icon.Package />
            <h3>Folders</h3>
          </div>
          <div className="card-body grid grid-2">
            <Field label="Default install root" help="Where new servers go unless you override the folder.">
              <input className="input input-mono" value={draft.defaultInstallRoot} onChange={(e) => set('defaultInstallRoot', e.target.value)} />
            </Field>
            <Field label="Backup folder">
              <input className="input input-mono" value={draft.backupRoot} onChange={(e) => set('backupRoot', e.target.value)} />
            </Field>
            <Field label="Cluster folder" help="Shared transfer data for clustered servers.">
              <input className="input input-mono" value={draft.clusterRoot} onChange={(e) => set('clusterRoot', e.target.value)} />
            </Field>
            <Field label="SteamCMD executable" help="Leave as-is to use the copy ASMS downloads for you.">
              <input className="input input-mono" value={draft.steamCmdPath} onChange={(e) => set('steamCmdPath', e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="card" id="maintenance" style={box('maintenance')}>
          <div className="card-head">
            <Icon.Clock />
            <h3>Maintenance</h3>
            <Help
              title="Automatic housekeeping"
              body="How often ASMS asks Steam whether a newer build exists, and how many backup zips to keep per server before deleting the oldest."
            />
          </div>
          <div className="card-body grid grid-2">
            <Field label="Update check interval (minutes)" help="0 turns automatic checking off.">
              <input className="input" type="number" min={0} max={1440} value={draft.updateCheckInterval} onChange={(e) => set('updateCheckInterval', Number(e.target.value))} />
            </Field>
            <Field label="Backups to keep per server" help="Older ones are deleted automatically after each new backup.">
              <input className="input" type="number" min={1} max={200} value={draft.backupRetention} onChange={(e) => set('backupRetention', Number(e.target.value))} />
            </Field>
          </div>
        </div>

        <div className="card" id="startup" style={box('startup')}>
          <div className="card-head">
            <Icon.Play />
            <h3>Starting up</h3>
            <Help
              title="Coming back after a reboot"
              body="Servers ticked here are launched by ASMS itself the moment it starts, so a power cut or an update-night reboot does not need anyone at the keyboard. ASMS has to be running for that — in Docker the restart policy handles it; on Windows the README shows how."
            />
          </div>
          <div className="card-body stack">
            <AutoStartList />
            <Field
              label="Wait between servers (seconds)"
              help="Each ARK server is ~30 GB off the same disk, so they go up one at a time with this gap between them. 0 starts them back to back."
            >
              <input
                className="input"
                type="number"
                min={0}
                max={600}
                value={draft.autoStartDelay ?? 20}
                onChange={(e) => set('autoStartDelay', Math.max(0, Number(e.target.value) || 0))}
                style={{ maxWidth: 160 }}
              />
            </Field>
          </div>
        </div>

        <div className="card" id="launching" style={box('launching')}>
          <div className="card-head">
            <Icon.Terminal />
            <h3>Launching</h3>
            <Help
              title="Only needed away from Windows"
              body="ARK's dedicated server is a Windows executable. On Linux — including inside Docker — it has to be started through Proton or Wine, and ASMS puts whatever you write here in front of the server binary. The full command is always visible on each server's Overview tab."
            />
          </div>
          <div className="card-body stack">
            <Field
              label="Launch wrapper"
              help="Leave empty on Windows. On Linux try a Proton or Wine command, for example: /usr/bin/proton run"
            >
              <input
                className="input input-mono"
                value={draft.launchWrapper}
                placeholder="empty — run the server executable directly"
                onChange={(e) => set('launchWrapper', e.target.value)}
              />
            </Field>
            {draft.launchWrapper.trim() ? (
              <span className="tiny faint mono truncate">
                {draft.launchWrapper.trim()} …ArkAscendedServer.exe TheIsland_WP?listen…
              </span>
            ) : null}
          </div>
        </div>

        <div className="card" id="access" style={box('access')}>
          <div className="card-head">
            <Icon.Shield />
            <h3>Access &amp; remote control</h3>
            <Help
              title="Who can reach this dashboard"
              body="ASMS listens on your whole network by default so you can manage servers from a phone. Set a password if anyone else can reach this machine, or bind to 127.0.0.1 to keep it local. Never forward this port to the internet."
            />
          </div>
          <div className="card-body stack">
            <Field label="Who can reach this dashboard" help="Takes effect the next time ASMS starts.">
              <div className="row row-wrap">
                {BIND_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    className={`btn btn-sm ${bindMode === mode.id ? 'btn-primary' : ''}`}
                    onClick={() => mode.host !== null && set('bindHost', mode.host)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </Field>
            <span className="small faint">{BIND_MODES.find((m) => m.id === bindMode)?.help}</span>

            <div className="grid grid-2">
              <Field label="Listen address" help="The exact address ASMS binds to.">
                <input className="input input-mono" value={draft.bindHost} onChange={(e) => set('bindHost', e.target.value)} />
              </Field>
              <Field
                label="Port"
                help={
                  system?.listen?.fromEnv
                    ? `Ignored while ASMS_HOST/ASMS_PORT are set — currently listening on ${system.listen.host}:${system.listen.port}.`
                    : 'Restart ASMS after changing this.'
                }
              >
                <input className="input" type="number" value={draft.port} onChange={(e) => set('port', Number(e.target.value))} />
              </Field>
            </div>

            <Field
              label="ASMS password"
              help="Set one if this machine is reachable by anyone else. Empty means no sign-in at all — fine for a single PC behind a router, not fine on a VPS."
            >
              <input className="input" type="password" value={draft.password} placeholder="No password set" onChange={(e) => set('password', e.target.value)} />
            </Field>
            {!draft.password && bindMode !== 'local' ? (
              <Callout tone="warn" title="No password, and open to the network">
                Anyone who can reach this port can start, stop, reconfigure and delete your servers — and read every password
                on this page. Set one above, or switch to <span className="strong">This PC only</span>.
              </Callout>
            ) : null}

            <div className="divider" />
            {bindMode === 'local' ? (
              <span className="small faint">
                ASMS is bound to this PC only. Switch to <span className="strong">Anything on my network</span> to open the
                dashboard from your phone or laptop.
              </span>
            ) : (
              <>
                <span className="small strong">Open ASMS from another device</span>
                {remoteUrls.length ? (
                  remoteUrls.map((url) => (
                    <div className="row" key={url}>
                      <span className="mono small truncate">{url}</span>
                      <div className="spacer" />
                      <CopyButton text={url} />
                    </div>
                  ))
                ) : (
                  <span className="small faint">No network address found yet — refresh below once you are connected.</span>
                )}
                <span className="tiny faint">
                  Same Wi-Fi or LAN as this machine. Do not forward this port on your router: put ASMS behind a VPN such as
                  Tailscale or WireGuard, or an authenticating HTTPS reverse proxy, and always set a password first.
                </span>
              </>
            )}
          </div>
        </div>

        <div className="card" id="notifications" style={box('notifications')}>
          <div className="card-head">
            <Icon.Bolt />
            <h3>Notifications</h3>
          </div>
          <div className="card-body stack">
            <Field label="Discord webhook URL" help="Server events get posted to this channel. Leave blank to disable.">
              <input className="input input-mono" value={draft.discordWebhook} onChange={(e) => set('discordWebhook', e.target.value)} placeholder="https://discord.com/api/webhooks/…" />
            </Field>
            <Field label="Notify about">
              <div className="row row-wrap">
                {NOTIFY_KINDS.map((kind) => (
                  <label key={kind} className="chip" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={draft.notifyOn.includes(kind)}
                      onChange={(e) =>
                        set('notifyOn', e.target.checked ? [...draft.notifyOn, kind] : draft.notifyOn.filter((k) => k !== kind))
                      }
                    />
                    {kind}
                  </label>
                ))}
              </div>
            </Field>
          </div>
        </div>

        <div className="card" id="appearance" style={box('appearance')}>
          <div className="card-head">
            <Icon.Settings />
            <h3>Appearance</h3>
          </div>
          <div className="card-body stack">
            <Field label="Accent colour">
              <div className="row row-wrap">
                {ACCENTS.map((accent) => (
                  <button
                    key={accent.id}
                    className={`btn btn-sm ${draft.accent === accent.id ? 'btn-primary' : ''}`}
                    onClick={() => {
                      set('accent', accent.id);
                      document.documentElement.setAttribute('data-accent', accent.id);
                    }}
                  >
                    <span className="dot" style={{ background: accent.color }} /> {accent.label}
                  </button>
                ))}
              </div>
            </Field>
            <Toggle
              checked={draft.openBrowserOnStart}
              onChange={(v) => set('openBrowserOnStart', v)}
              title="Open the dashboard when ASMS starts"
              help="Turn this off when running ASMS as a background service."
            />
          </div>
        </div>

        <div className="card card-pad row row-wrap" style={{ gap: 12 }}>
          <Icon.Archive />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="strong">Backup &amp; migrate</div>
            <span className="small faint">
              Export every server, mod, schedule and setting to one file, or restore one — including onto a different PC.
            </span>
          </div>
          <Link className="btn btn-primary" to="/backup">
            <Icon.Archive size={14} /> Open Backup &amp; migrate
          </Link>
        </div>

        <div className="card" id="machine" style={box('machine')}>
          <div className="card-head">
            <Icon.Server />
            <h3>This machine</h3>
            <div className="spacer" />
            <Button size="sm" variant="ghost" onClick={() => void refreshSystem()}>
              <Icon.Refresh size={14} /> Refresh
            </Button>
          </div>
          <div className="card-body stack">
            <div className="grid grid-3">
              <Stat label="Host" value={system?.hostname ?? '—'} sub={system?.platform} />
              <Stat label="CPU" value={`${system?.cores ?? 0} cores`} sub={system?.cpuModel} />
              <Stat label="Memory" value={memory(system?.memory.totalMB ?? 0)} sub={`${memory(system?.memory.freeMB ?? 0)} free`} />
              <Stat label="Host uptime" value={duration((system?.uptimeSeconds ?? 0) * 1000)} sub={`Node ${system?.nodeVersion ?? ''}`} />
            </div>
            <div className="divider" />
            <div className="row row-wrap">
              <div style={{ flex: 1, minWidth: 240 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="strong">SteamCMD</span>
                  {system?.steamCmd.installed ? <Badge tone="ok">installed</Badge> : <Badge tone="warn">missing</Badge>}
                </div>
                <div className="tiny faint mono">{system?.steamCmd.path}</div>
              </div>
              {!system?.steamCmd.installed ? (
                <Button
                  busy={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.post('/system/steamcmd/install');
                      await refreshSystem();
                    }, 'SteamCMD installed')
                  }
                >
                  <Icon.Download /> Install now
                </Button>
              ) : null}
            </div>
            <div className="divider" />
            <dl className="kv">
              <dt>ASMS data folder</dt>
              <dd className="mono">{system?.dataDir}</dd>
              <dt>LAN addresses</dt>
              <dd className="mono">{system?.addresses?.join(', ') || '—'}</dd>
            </dl>
          </div>
        </div>

        <div style={box('version')}>
          <AppUpdate />
        </div>
      </div>
    </>
  );
}

/**
 * Auto-start is a per-server flag, but "which of my servers come back after a
 * reboot?" is a question about all of them at once — so it is answered here as
 * well as on each server. These toggles save on the spot; they are not part of
 * the settings draft above.
 */
function AutoStartList() {
  const { servers, refresh } = useStore();
  const [busy, run] = useAction();

  if (!servers.length) {
    return <span className="small faint">No servers yet. The wizard asks about this when you add one.</span>;
  }

  const set = (id: string, autoStart: boolean) =>
    void run(async () => {
      await api.patch(`/servers/${id}`, { autoStart });
      await refresh();
    });

  const on = servers.filter((s) => s.autoStart).length;

  return (
    <Field
      label="Servers to start with ASMS"
      help={
        on
          ? `${on} of ${servers.length} will come back on their own.`
          : 'Nothing starts by itself right now — a reboot leaves every server down until someone presses Start.'
      }
    >
      <div className="stack" style={{ gap: 8, opacity: busy ? 0.6 : 1 }}>
        {servers.map((server) => (
          <Toggle
            key={server.id}
            checked={server.autoStart}
            onChange={(v) => set(server.id, v)}
            title={server.name}
            help={`${server.map} · port ${server.port}`}
          />
        ))}
      </div>
    </Field>
  );
}
