import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useAction } from '../lib/store';
import { api } from '../lib/api';
import { TopBar } from '../components/Shell';
import { Button, Field, Toggle, ExternalLink, Callout } from '../components/ui';
import { Icon } from '../components/Icons';
import { PresetGrid } from '../components/Presets';
import { sortSetups, summarise } from '../lib/setups';
import { modLabel, modSearchLink, parseModList } from '../lib/mods';
import { ModSources } from '../components/ModSources';
import { LibraryPicker } from '../components/LibraryPicker';
import { ClusterIdInput } from '../components/ClusterIdInput';
import { randomClusterId } from '../lib/cluster';
import { checkInstallPath } from '../lib/paths';
import type { ModEntry, ServerInstance } from '../lib/types';

interface Draft {
  name: string;
  map: string;
  installPath: string;
  port: number;
  queryPort: number;
  rconPort: number;
  maxPlayers: number;
  sessionName: string;
  serverPassword: string;
  adminPassword: string;
  motd: string;
  clusterId: string;
  mods: ModEntry[];
  autoStart: boolean;
  autoRestartOnCrash: boolean;
  updateOnStart: boolean;
  installNow: boolean;
  /** Play style preset to write once the server exists. */
  presetId: string;
  /** A saved setup, which wins over the preset when both are set. */
  setupId: string;
}

const STEPS = ['Identity', 'Play style', 'Network', 'Access', 'Review'];

export default function NewServer() {
  const { settings, catalog, setups, toast } = useStore();
  const [busy, run] = useAction();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [portInfo, setPortInfo] = useState<Record<string, string>>({});

  const [draft, setDraft] = useState<Draft>({
    name: '',
    map: 'TheIsland_WP',
    installPath: '',
    port: 7777,
    queryPort: 27015,
    rconPort: 27020,
    maxPlayers: 70,
    sessionName: '',
    serverPassword: '',
    adminPassword: '',
    motd: '',
    clusterId: '',
    mods: [],
    autoStart: true,
    autoRestartOnCrash: true,
    updateOnStart: true,
    installNow: true,
    presetId: 'medium',
    setupId: '',
  });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // Pre-fill with ports nothing else is using.
  useEffect(() => {
    void api
      .get<{ port: number; queryPort: number; rconPort: number }>('/system/suggest-ports')
      .then((p) => setDraft((d) => ({ ...d, ...p })))
      .catch(() => {});
  }, []);

  const slug = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const suggestedPath = settings ? `${settings.defaultInstallRoot}\\${slug || 'server'}` : '';
  // Judge the folder that will actually be created, which is the suggestion
  // until someone overrides it — a too-long default install root counts too.
  const pathCheck = checkInstallPath(draft.installPath.trim() || suggestedPath);

  const checkPort = async (port: number, proto: 'tcp' | 'udp', field: string) => {
    try {
      const res = await api.post<{ free: boolean; conflictsWith: string | null }>('/system/port-check', { port, proto });
      setPortInfo((p) => ({
        ...p,
        [field]: res.conflictsWith
          ? `Already used by "${res.conflictsWith}"`
          : res.free
            ? 'Free'
            : 'Something on this machine is already listening here',
      }));
    } catch {
      /* ignore */
    }
  };

  const chosenSetup = setups.find((s) => s.id === draft.setupId) ?? null;
  const presetName = catalog?.presets.find((p) => p.id === draft.presetId)?.name ?? 'None';

  const pickSetup = (id: string) => {
    const saved = setups.find((s) => s.id === id);
    if (!saved) {
      setDraft((d) => ({ ...d, setupId: '' }));
      return;
    }
    // Pull the setup into the visible form rather than applying it invisibly.
    setDraft((d) => ({
      ...d,
      setupId: id,
      presetId: '',
      map: saved.bundle.map || d.map,
      maxPlayers: saved.bundle.maxPlayers || d.maxPlayers,
      mods: saved.bundle.mods.length ? saved.bundle.mods : d.mods,
    }));
  };

  // Blocked on the step that owns the folder, not at submit: a wizard that lets
  // you reach Review and then refuses has wasted four steps of typing.
  const canAdvance = step === 0 ? draft.name.trim().length > 0 && pathCheck.level !== 'blocked' : true;

  const create = () =>
    void run(async () => {
      const payload: Partial<ServerInstance> = {
        name: draft.name.trim(),
        map: draft.map,
        installPath: draft.installPath.trim() || undefined,
        sessionName: draft.sessionName.trim() || draft.name.trim(),
        serverPassword: draft.serverPassword,
        adminPassword: draft.adminPassword.trim() || undefined,
        motd: draft.motd,
        port: draft.port,
        queryPort: draft.queryPort,
        rconPort: draft.rconPort,
        maxPlayers: draft.maxPlayers,
        clusterId: draft.clusterId.trim(),
        mods: draft.mods,
        autoStart: draft.autoStart,
        autoRestartOnCrash: draft.autoRestartOnCrash,
        updateOnStart: draft.updateOnStart,
      };
      const server = await api.post<ServerInstance>('/servers', payload);

      // The server exists from here on: a failed preset must not read as a
      // failed create, so it is reported separately rather than rethrown.
      try {
        if (draft.setupId) {
          await api.post(`/servers/${server.id}/apply-setup`, {
            setupId: draft.setupId,
            // Mods came across into the wizard's own field, which wins.
            parts: { settings: true, mods: false, launch: true, rawIni: false, schedules: true },
          });
        } else if (draft.presetId) {
          await api.post(`/servers/${server.id}/config/preset`, { presetId: draft.presetId });
        }
      } catch (err) {
        toast('warn', 'Server created, but the play style did not apply', err instanceof Error ? err.message : String(err));
      }

      if (draft.installNow) {
        await api.post(`/servers/${server.id}/install`);
        toast('info', 'Downloading server files', 'Follow along in the Console tab — this takes a while the first time.');
      }
      navigate(`/servers/${server.id}${draft.installNow ? '/console' : ''}`);
    });

  return (
    <>
      <TopBar title="New server" sub="Five short steps — everything is editable afterwards" />
      <div className="content content-narrow stack">
        <div className="steps">
          {STEPS.map((label, i) => (
            <div key={label} className="row" style={{ gap: 8 }}>
              <div className={`step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}>
                <span className="step-num">{i < step ? '✓' : i + 1}</span>
                {label}
              </div>
              {i < STEPS.length - 1 ? <span className="step-line" /> : null}
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-body stack">
            {step === 0 ? (
              <>
                <Field label="Server name" help="Shown in ASMS and used as the default session name.">
                  <input
                    className="input"
                    value={draft.name}
                    autoFocus
                    placeholder="e.g. Ragnarok Ragers"
                    onChange={(e) => set('name', e.target.value)}
                  />
                </Field>
                <Field label="Map">
                  <select className="select" value={draft.map} onChange={(e) => set('map', e.target.value)}>
                    <optgroup label="Official">
                      {catalog?.maps.filter((m) => m.official).map((m) => (
                        <option key={m.code} value={m.code}>
                          {m.name} ({m.code})
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Community">
                      {catalog?.maps.filter((m) => !m.official).map((m) => (
                        <option key={m.code} value={m.code}>
                          {m.name} ({m.code})
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </Field>
                {catalog?.maps.find((m) => m.code === draft.map)?.note ? (
                  <div className="small faint">{catalog.maps.find((m) => m.code === draft.map)?.note}</div>
                ) : null}
                <Field
                  label="Install folder"
                  help={`Leave blank to use ${suggestedPath || 'the default install root'}. Each server needs its own folder — around 30 GB.`}
                >
                  <input
                    className="input input-mono"
                    value={draft.installPath}
                    placeholder={suggestedPath}
                    onChange={(e) => set('installPath', e.target.value)}
                  />
                </Field>
                {pathCheck.message ? (
                  <Callout
                    tone={pathCheck.level === 'blocked' ? 'danger' : 'warn'}
                    title={
                      pathCheck.level === 'blocked'
                        ? 'ARK cannot install mods into a folder this deep'
                        : 'This folder is close to the limit for mods'
                    }
                  >
                    {pathCheck.message}
                  </Callout>
                ) : null}
              </>
            ) : null}

            {step === 1 ? (
              <>
                <Field
                  label="Play style"
                  help="Sets the game rates and rules for this server. Every value stays editable afterwards on its Settings tab."
                >
                  <PresetGrid
                    selected={draft.setupId ? '' : draft.presetId}
                    onPick={(preset) => setDraft((d) => ({ ...d, presetId: preset.id, setupId: '' }))}
                  />
                </Field>
                {setups.length ? (
                  <>
                    <div className="divider" />
                    <Field
                      label="…or start from a saved setup"
                      help="Applies its mods, game settings and launch flags to the new server instead."
                    >
                      <select className="select" value={draft.setupId} onChange={(e) => pickSetup(e.target.value)}>
                        <option value="">No setup — use the play style above</option>
                        {sortSetups(setups).map((saved) => (
                          <option key={saved.id} value={saved.id}>
                            {saved.bundle.name} — {summarise(saved.bundle)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </>
                ) : null}
                {chosenSetup ? (
                  <div className="card card-pad small dim">
                    <span className="strong">{chosenSetup.bundle.name}</span> brings {summarise(chosenSetup.bundle)}
                    {chosenSetup.bundle.map ? <> and was captured on {chosenSetup.bundle.map}</> : null}. Passwords and ports
                    always come from this wizard, never from the setup.
                  </div>
                ) : null}
              </>
            ) : null}

            {step === 2 ? (
              <>
                <div className="grid grid-2">
                  <Field label="Game port (UDP)" help={portInfo.port}>
                    <input
                      className="input"
                      type="number"
                      value={draft.port}
                      onChange={(e) => set('port', Number(e.target.value))}
                      onBlur={() => void checkPort(draft.port, 'udp', 'port')}
                    />
                  </Field>
                  <Field label="Query port (UDP)" help={portInfo.queryPort}>
                    <input
                      className="input"
                      type="number"
                      value={draft.queryPort}
                      onChange={(e) => set('queryPort', Number(e.target.value))}
                      onBlur={() => void checkPort(draft.queryPort, 'udp', 'queryPort')}
                    />
                  </Field>
                  <Field label="RCON port (TCP)" help={portInfo.rconPort}>
                    <input
                      className="input"
                      type="number"
                      value={draft.rconPort}
                      onChange={(e) => set('rconPort', Number(e.target.value))}
                      onBlur={() => void checkPort(draft.rconPort, 'tcp', 'rconPort')}
                    />
                  </Field>
                  <Field label="Player slots">
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={255}
                      value={draft.maxPlayers}
                      onChange={(e) => set('maxPlayers', Number(e.target.value))}
                    />
                  </Field>
                </div>
                <div className="card card-pad small dim">
                  ASA also binds <span className="mono">{draft.port + 1}</span> (game port + 1). Forward{' '}
                  <span className="mono">{draft.port}</span>–<span className="mono">{draft.port + 1}</span> and{' '}
                  <span className="mono">{draft.queryPort}</span> as UDP on your router. RCON{' '}
                  <span className="mono">{draft.rconPort}</span> is TCP and should stay on your LAN.
                </div>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <Field label="Session name" help="What players see in the server browser. Defaults to the server name.">
                  <input
                    className="input"
                    value={draft.sessionName}
                    placeholder={draft.name}
                    onChange={(e) => set('sessionName', e.target.value)}
                  />
                </Field>
                <div className="grid grid-2">
                  <Field label="Join password" help="Leave blank for an open server.">
                    <input className="input" value={draft.serverPassword} onChange={(e) => set('serverPassword', e.target.value)} />
                  </Field>
                  <Field
                    label="Admin password"
                    help="Also used for RCON and for enablecheats in game. A strong one is generated if you leave this blank. No question marks."
                    error={/[?]/.test(draft.adminPassword) ? 'ARK cuts launch options at a question mark — admin access would silently break.' : undefined}
                  >
                    <input className="input input-mono" value={draft.adminPassword} onChange={(e) => set('adminPassword', e.target.value)} />
                  </Field>
                </div>
                <Field label="Message of the day">
                  <input className="input" value={draft.motd} placeholder={`Welcome to ${draft.name || 'the server'}!`} onChange={(e) => set('motd', e.target.value)} />
                </Field>
                <div className="divider" />
                <ClusterStep value={draft.clusterId} onChange={(id) => set('clusterId', id)} />
                <div className="divider" />
                <ModStep value={draft.mods} onChange={(mods) => set('mods', mods)} />
              </>
            ) : null}

            {step === 4 ? (
              <>
                <dl className="kv">
                  <dt>Name</dt>
                  <dd>{draft.name}</dd>
                  <dt>Map</dt>
                  <dd>{draft.map}</dd>
                  <dt>Folder</dt>
                  <dd className="mono">{draft.installPath || suggestedPath}</dd>
                  <dt>Ports</dt>
                  <dd>
                    {draft.port}–{draft.port + 1} game · {draft.queryPort} query · {draft.rconPort} RCON
                  </dd>
                  <dt>Slots</dt>
                  <dd>{draft.maxPlayers}</dd>
                  <dt>Play style</dt>
                  <dd>{chosenSetup ? `Setup — ${chosenSetup.bundle.name}` : presetName}</dd>
                  <dt>Cluster</dt>
                  <dd>{draft.clusterId || 'standalone'}</dd>
                  <dt>Mods</dt>
                  <dd>{draft.mods.length ? draft.mods.map(modLabel).join(', ') : 'none'}</dd>
                </dl>
                <div className="divider" />
                <Toggle
                  checked={draft.installNow}
                  onChange={(v) => set('installNow', v)}
                  title="Download server files now"
                  help="Roughly 30 GB via SteamCMD. You can watch progress in the Console tab."
                />
                <Toggle
                  checked={draft.updateOnStart}
                  onChange={(v) => set('updateOnStart', v)}
                  title="Update before every start"
                  help="Keeps you on the current build so players are never version-blocked."
                />
                <Toggle
                  checked={draft.autoRestartOnCrash}
                  onChange={(v) => set('autoRestartOnCrash', v)}
                  title="Restart automatically after a crash"
                  help="Backs off after five crashes in 30 minutes."
                />
                <Toggle
                  checked={draft.autoStart}
                  onChange={(v) => set('autoStart', v)}
                  title="Start whenever ASMS starts"
                  help="Brings this server back on its own after a reboot, without anyone opening the dashboard."
                />
              </>
            ) : null}
          </div>

          <div className="card-foot">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
            <div className="spacer" />
            {step < STEPS.length - 1 ? (
              <Button variant="primary" disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>
                Continue <Icon.Chevron size={14} />
              </Button>
            ) : (
              <Button variant="primary" busy={busy} onClick={create}>
                <Icon.Check /> Create server
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// --------------------------------------------------------------- cluster

/**
 * "Connect to other servers" in the language people actually use. A cluster is
 * just a shared string, and getting it subtly wrong is the classic way to end
 * up with two clusters that look like one - so the ones you already have are
 * offered as buttons, and typing is the fallback rather than the default.
 */
function ClusterStep({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { servers, library } = useStore();
  const [typing, setTyping] = useState(false);

  const known = useMemo(() => {
    const counts = new Map<string, number>();
    for (const server of servers) {
      const id = server.clusterId.trim();
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const cluster of library.clusters) if (!counts.has(cluster.id)) counts.set(cluster.id, 0);
    return [...counts.entries()]
      .map(([id, members]) => ({ id, members, name: library.clusters.find((c) => c.id === id)?.name ?? '' }))
      .sort((a, b) => b.members - a.members || a.id.localeCompare(b.id));
  }, [servers, library.clusters]);

  const joined = known.find((c) => c.id === value);

  return (
    <Field
      label="Connect to your other servers?"
      help="Servers sharing a cluster ID share an upload/download bank — walk into an obelisk on one map and pop out on another."
    >
      {known.length ? (
        <div className="row row-wrap" style={{ gap: 6, marginBottom: 8 }}>
          <button className={`btn btn-sm ${!value ? 'btn-primary' : ''}`} onClick={() => { onChange(''); setTyping(false); }}>
            Standalone
          </button>
          {known.map((cluster) => (
            <button
              key={cluster.id}
              className={`btn btn-sm ${value === cluster.id ? 'btn-primary' : ''}`}
              title={cluster.name || undefined}
              onClick={() => { onChange(cluster.id); setTyping(false); }}
            >
              <span className="mono">{cluster.id}</span>
              <span className="tiny faint" style={{ marginLeft: 6 }}>
                {cluster.members ? `${cluster.members} server${cluster.members === 1 ? '' : 's'}` : 'unused'}
              </span>
            </button>
          ))}
          <button
            className={`btn btn-sm ${typing ? 'btn-primary' : ''}`}
            onClick={() => { setTyping(true); onChange(randomClusterId()); }}
          >
            <Icon.Plus size={13} /> New cluster
          </button>
        </div>
      ) : null}

      {typing || !known.length ? <ClusterIdInput value={value} onChange={onChange} autoFocus={typing} /> : null}

      <span className="tiny faint">
        {joined && joined.members
          ? `Joins ${joined.members} server${joined.members === 1 ? '' : 's'} already in ${joined.id}. They all need to be restarted before transfers work.`
          : value
            ? `New cluster ${value} — give the same ID to another server to link them.`
            : 'Standalone: nothing transfers in or out. You can join a cluster later from the Clusters page.'}
      </span>
    </Field>
  );
}

// ------------------------------------------------------------------ mods

/**
 * The library exists so this step is a tick rather than a hunt through Discord
 * for six project IDs, so it leads with the offer instead of an empty box.
 */
function ModStep({ value, onChange }: { value: ModEntry[]; onChange: (mods: ModEntry[]) => void }) {
  const { library, toast } = useStore();
  const [entry, setEntry] = useState('');
  const [picker, setPicker] = useState(false);

  const merge = (incoming: ModEntry[]) => {
    const fresh = incoming.filter((mod) => !value.some((m) => m.id === mod.id));
    onChange([...value, ...fresh]);
    return fresh.length;
  };

  const addTyped = () => {
    const parsed = parseModList(entry);
    if (!parsed.length) {
      toast('warn', 'Nothing to add', 'Paste a CurseForge project ID, or a Name,ID,URL line.');
      return;
    }
    merge(parsed);
    setEntry('');
  };

  const unsaved = library.mods.filter((mod) => !value.some((m) => m.id === mod.id));

  return (
    <Field label="Mods" help="Load order runs top to bottom — map mods and total conversions first, cosmetics last.">
      {unsaved.length ? (
        <div className="card card-pad row row-wrap" style={{ gap: 10, marginBottom: 10 }}>
          <Icon.Package />
          <span className="small" style={{ flex: 1, minWidth: 200 }}>
            <span className="strong">Add your usual mods?</span> Your library has {unsaved.length} not on this server yet
            {unsaved.length <= 4 ? <> — {unsaved.map(modLabel).join(', ')}</> : null}.
          </span>
          <Button size="sm" variant="ghost" onClick={() => setPicker(true)}>
            Pick some
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              const added = merge(unsaved.map((mod) => ({ ...mod, enabled: true })));
              toast('success', `Added ${added} mod${added === 1 ? '' : 's'}`, 'Reorder them on the server’s Mods tab.');
            }}
          >
            <Icon.Plus size={13} /> Add all {unsaved.length}
          </Button>
        </div>
      ) : null}

      <div className="input-group">
        <input
          className="input input-mono"
          value={entry}
          placeholder="893657, 928567   or   Better Breeding,941697,https://..."
          onChange={(e) => setEntry(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTyped();
            }
          }}
        />
        <Button onClick={addTyped}>
          <Icon.Plus /> Add
        </Button>
        {library.mods.length ? (
          <Button variant="ghost" onClick={() => setPicker(true)}>
            <Icon.Package size={14} /> Library
          </Button>
        ) : null}
      </div>

      {entry.trim().length > 2 && !parseModList(entry).length ? (
        <div className="row small" style={{ marginTop: 8, gap: 8 }}>
          <Icon.Search size={13} className="dim" />
          <span className="dim">
            ARK identifies mods by number, not by name.{' '}
            <ExternalLink href={modSearchLink(entry)} className="strong">
              Search CurseForge for “{entry.trim()}”
            </ExternalLink>{' '}
            and copy the number out of the URL.
          </span>
        </div>
      ) : null}

      {value.length ? (
        <div className="row row-wrap" style={{ gap: 6, marginTop: 8 }}>
          {value.map((mod, i) => (
            <span key={mod.id} className="chip">
              <span className="faint">{i + 1}.</span> {modLabel(mod)}
              <button title="Remove" onClick={() => onChange(value.filter((m) => m.id !== mod.id))}>
                <Icon.X size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <span className="tiny faint">No mods — a vanilla server. You can add them any time on the Mods tab.</span>
      )}

      <div style={{ marginTop: 12 }}>
        <ModSources />
      </div>

      {picker ? (
        <LibraryPicker exclude={value.map((m) => m.id)} onAdd={(picked) => merge(picked)} onClose={() => setPicker(false)} />
      ) : null}
    </Field>
  );
}
