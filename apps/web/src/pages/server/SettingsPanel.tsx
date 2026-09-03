import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore, useAction } from '../../lib/store';
import { api } from '../../lib/api';
import { Button, Field, Toggle, Badge, Callout, SearchInput } from '../../components/ui';
import { Icon } from '../../components/Icons';
import { Help } from '../../components/Tooltip';
import { ClusterIdInput } from '../../components/ClusterIdInput';
import { MapPicker } from '../../components/MapPicker';
import { checkInstallPath } from '../../lib/paths';
import { mapCodeError } from '../../lib/maps';
import { PresetGrid, resolvePresetValues } from '../../components/Presets';
import { SaveSetupDialog } from '../Setups';
import type { PresetDef, ServerInstance, ServerRuntime, SettingDef } from '../../lib/types';

type SubTab = 'game' | 'server' | 'raw';

const idOf = (def: SettingDef) => `${def.file}:${def.section}:${def.key}`;

/**
 * Three panels behind one tab, addressable from outside: the Ctrl-K palette
 * links to ?sub=game&find=TamingSpeed or ?sub=server&flag=crossplay so a search
 * lands on the actual control rather than on the tab that contains it.
 */
export default function SettingsPanel({ server, runtime }: { server: ServerInstance; runtime?: ServerRuntime }) {
  const [params, setParams] = useSearchParams();
  const wanted = params.get('sub');
  const [sub, setSub] = useState<SubTab>(wanted === 'server' || wanted === 'raw' ? wanted : 'game');
  // One box above the tabs rather than one inside Game settings: a launch flag
  // and an INI setting are the same question to whoever is looking, and the
  // answer used to be findable from only one of the two tabs.
  const [search, setSearch] = useState(params.get('find') ?? '');

  useEffect(() => {
    if (wanted === 'game' || wanted === 'server' || wanted === 'raw') setSub(wanted);
  }, [wanted]);

  // Arriving from the palette a second time has to move the box again.
  const deepLink = params.get('find');
  useEffect(() => {
    if (deepLink) setSearch(deepLink);
  }, [deepLink]);

  const pick = (next: SubTab) => {
    setSub(next);
    // Drop the deep-link parameters once the user steers by hand, so a later
    // reload does not drag them back to where the search put them.
    if (params.has('sub') || params.has('find') || params.has('flag')) setParams({}, { replace: true });
  };

  return (
    <div className="stack">
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="segmented">
          <button className={sub === 'game' ? 'active' : ''} onClick={() => pick('game')}>
            Game settings
          </button>
          <button className={sub === 'server' ? 'active' : ''} onClick={() => pick('server')}>
            Server &amp; launch
          </button>
          <button className={sub === 'raw' ? 'active' : ''} onClick={() => pick('raw')}>
            Raw INI
          </button>
        </div>
        <div className="spacer" />
        {sub === 'raw' ? null : (
          <SearchInput
            value={search}
            onChange={setSearch}
            width={300}
            placeholder="Search settings and launch flags…"
          />
        )}
      </div>
      {sub === 'game' ? (
        <GameSettings
          server={server}
          runtime={runtime}
          search={search}
          onSearch={setSearch}
          onShowLaunch={() => pick('server')}
        />
      ) : null}
      {sub === 'server' ? (
        <ServerSettings
          server={server}
          highlightFlag={params.get('flag') ?? ''}
          search={search}
          onShowSettings={() => pick('game')}
        />
      ) : null}
      {sub === 'raw' ? <RawIni server={server} /> : null}
    </div>
  );
}

// ------------------------------------------------------------ game settings

function GameSettings({
  server,
  runtime,
  search,
  onSearch,
  onShowLaunch,
}: {
  server: ServerInstance;
  runtime?: ServerRuntime;
  /** Owned by the panel above, so the same box serves both tabs. */
  search: string;
  onSearch: (value: string) => void;
  onShowLaunch: () => void;
}) {
  const { catalog, toast } = useStore();
  const [busy, run] = useAction();
  const [values, setValues] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [group, setGroup] = useState('Rates');
  const [advanced, setAdvanced] = useState(false);
  const [preset, setPreset] = useState('');

  const load = useCallback(
    () =>
      void run(async () => {
        const res = await api.get<{ curated: Record<string, string> }>(`/servers/${server.id}/config`);
        setValues(res.curated);
        setOriginal(res.curated);
      }),
    [server.id, run],
  );

  useEffect(() => load(), [load]);

  const dirty = useMemo(
    () => Object.keys(values).filter((k) => values[k] !== original[k]),
    [values, original],
  );

  // Memoised because it feeds the `visible` memo below: a fresh [] on every
  // render would make that recompute every time regardless of the real inputs.
  const defs = useMemo(() => catalog?.settings ?? [], [catalog]);
  const flagHits = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return (catalog?.launchFlags ?? []).filter((flag) =>
      `${flag.label} ${flag.arg} ${flag.help}`.toLowerCase().includes(needle),
    );
  }, [catalog, search]);

  // A search looks everywhere, including the advanced shelf: a setting that
  // exists but is filtered out reads as a setting ASMS does not support, and
  // people go and edit the INI by hand instead.
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle) {
      return defs.filter(
        (d) =>
          d.label.toLowerCase().includes(needle) ||
          d.key.toLowerCase().includes(needle) ||
          (d.help ?? '').toLowerCase().includes(needle),
      );
    }
    return defs.filter((d) => (advanced || !d.advanced) && d.group === group);
  }, [defs, group, search, advanced]);

  const applyPreset = (chosen: PresetDef) => {
    setValues((prev) => ({ ...prev, ...resolvePresetValues(chosen, defs) }));
    setPreset(chosen.id);
    onSearch('');
    toast('info', `${chosen.name} loaded`, 'Nothing is written yet — look through the changes, then press Save.');
  };

  const save = () =>
    void run(async () => {
      const patch: Record<string, string> = {};
      for (const key of dirty) patch[key] = values[key];
      await api.put(`/servers/${server.id}/config`, { curated: patch });
      setOriginal(values);
      if (runtime?.state === 'running') {
        toast('info', 'Saved — restart to apply', 'ARK only reads these files at boot.');
      }
    }, 'Settings written to disk');

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <Icon.Wand />
          <h3>Play style presets</h3>
          <Help
            title="A sensible starting point"
            body="Each preset stages a coherent set of rates and rules in the form below. Look through what changed, adjust anything you disagree with, then press Save. Mods, ports, passwords and launch flags are never touched."
          />
          <div className="spacer" />
          {preset ? <Badge tone="accent">{preset} staged</Badge> : null}
        </div>
        <div className="card-body">
          <PresetGrid compact selected={preset} onPick={applyPreset} />
        </div>
      </div>

      <div className="card">
      <div className="card-head">
        <Icon.Sliders />
        <h3>Game settings</h3>
        <Help
          title="These take effect on the next start"
          body="ARK reads its INI files only when it boots, and rewrites them when it shuts down. Edit while the server is stopped, or restart afterwards."
        />
        <div className="spacer" />
        <Toggle
          checked={advanced}
          onChange={setAdvanced}
          title="Advanced"
          disabled={!!search}
        />
      </div>

      {search ? (
        <div className="card-head" style={{ gap: 8 }}>
          <span className="small faint">
            {visible.length} of {defs.length} settings match, advanced ones included. Clear the box to browse by group.
          </span>
        </div>
      ) : (
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 6 }}>
          {(catalog?.groups ?? []).map((g) => (
            <button key={g} className={`btn btn-sm ${group === g ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setGroup(g)}>
              {g}
            </button>
          ))}
        </div>
      )}

      <div className="card-body">
        {visible.length === 0 && flagHits.length === 0 ? (
          <Callout tone="info" title={`No setting matches “${search}”`}>
            ASMS puts a friendly control on the settings people actually change. Anything else in ARK&rsquo;s INI files can
            still be edited by hand under <span className="strong">Raw INI</span> — and if it is a command-line switch rather
            than a setting, look under <span className="strong">Server &amp; launch</span>.
          </Callout>
        ) : (
          visible.map((def) => (
            <SettingRow
              key={idOf(def)}
              def={def}
              value={values[idOf(def)] ?? def.default}
              dirty={dirty.includes(idOf(def))}
              onChange={(v) => setValues((prev) => ({ ...prev, [idOf(def)]: v }))}
            />
          ))
        )}
      </div>

      {flagHits.length ? (
        <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="small dim" style={{ marginBottom: 10 }}>
            {flagHits.length === 1 ? 'This one is a launch flag' : `${flagHits.length} of these are launch flags`} rather than an
            INI setting — ARK takes them on the command line, so they live on the Server &amp; launch tab.
          </div>
          {flagHits.map((flag) => (
            <div className="setting-row" key={flag.key}>
              <div className="setting-meta">
                <div className="setting-name">
                  {flag.label}
                  <Badge>launch flag</Badge>
                  <span className="setting-key">{flag.arg}</span>
                </div>
                <div className="setting-help">{flag.help}</div>
              </div>
              <div className="setting-control">
                <Button size="sm" onClick={onShowLaunch}>
                  Open Server &amp; launch
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {dirty.length && runtime?.state === 'running' ? (
        <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
          <Callout tone="warn" title="This server is running">
            Saving writes the INI files, but ARK read them at boot and rewrites them on shutdown — so the change does nothing
            until you restart, and a restart without saving first would throw these edits away.
          </Callout>
        </div>
      ) : null}

      <div className="card-foot">
        <span className="card-hint">
          {dirty.length ? `${dirty.length} unsaved change${dirty.length === 1 ? '' : 's'}` : 'No unsaved changes'}
        </span>
        <div className="spacer" />
        <Button
          variant="ghost"
          disabled={!dirty.length}
          onClick={() => {
            setValues(original);
            setPreset('');
          }}
        >
          Discard
        </Button>
        <Button variant="primary" busy={busy} disabled={!dirty.length} onClick={save}>
          <Icon.Save /> Save
        </Button>
      </div>
      </div>
    </div>
  );
}

function SettingRow({
  def,
  value,
  dirty,
  onChange,
}: {
  def: SettingDef;
  value: string;
  dirty: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="setting-row">
      <div className="setting-meta">
        <div className="setting-name">
          {def.label}
          {dirty ? <Badge tone="accent">edited</Badge> : null}
          {def.advanced ? <Badge tone="warn">advanced</Badge> : null}
          <span className="setting-key">
            {def.group} · {def.file === 'gus' ? 'GameUserSettings' : 'Game'}.ini · {def.key}
          </span>
        </div>
        {def.help ? <div className="setting-help">{def.help}</div> : null}
      </div>
      <div className="setting-control">
        {def.type === 'bool' ? (
          <Toggle checked={/^true$/i.test(value)} onChange={(v) => onChange(v ? 'True' : 'False')} />
        ) : def.type === 'float' && def.min !== undefined && def.max !== undefined ? (
          <div className="slider-cell">
            <input
              type="range"
              min={def.min}
              max={def.max}
              step={def.step ?? 0.1}
              value={Number(value) || 0}
              onChange={(e) => onChange(e.target.value)}
            />
            <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
          </div>
        ) : def.type === 'int' ? (
          <input className="input" type="number" min={def.min} max={def.max} value={value} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------- server & launch

function ServerSettings({
  server,
  highlightFlag,
  search,
  onShowSettings,
}: {
  server: ServerInstance;
  highlightFlag: string;
  search: string;
  onShowSettings: () => void;
}) {
  const { catalog } = useStore();
  const [busy, run] = useAction();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ServerInstance>(server);
  const [sharing, setSharing] = useState(false);
  const flagRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(server), [server]);

  // Surfaced here as well as in the wizard, because this is where a server that
  // predates the check - or one restored from a backup - gets to find out.
  const installPathCheck = checkInstallPath(draft.installPath);

  // Searching for a launch flag should put your eyes on the switch itself -
  // there are forty of them across five groups.
  useEffect(() => {
    if (highlightFlag) flagRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightFlag]);

  const set = <K extends keyof ServerInstance>(key: K, value: ServerInstance[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(server);
  // A half-typed custom map code would be saved as the level ARK boots.
  const mapError = mapCodeError(draft.map);

  const needle = search.trim().toLowerCase();
  const flags = useMemo(() => {
    const all = catalog?.launchFlags ?? [];
    if (!needle) return all;
    return all.filter((f) => `${f.label} ${f.arg} ${f.help}`.toLowerCase().includes(needle));
  }, [catalog, needle]);
  // The mirror of what Game settings does for flags: a search that finds an INI
  // setting from this tab says so and offers the door, rather than nothing.
  const settingHits = useMemo(() => {
    if (!needle) return [];
    return (catalog?.settings ?? []).filter((d) =>
      `${d.label} ${d.key} ${d.help ?? ''}`.toLowerCase().includes(needle),
    );
  }, [catalog, needle]);
  const activeFlagCount = Object.values(draft.flags as unknown as Record<string, boolean>).filter(Boolean).length;

  const save = () =>
    void run(async () => {
      await api.patch(`/servers/${server.id}`, { ...draft, map: draft.map.trim() });
    }, 'Server updated — restart to apply');

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <Icon.Server />
          <h3>Identity</h3>
        </div>
        <div className="card-body grid grid-2">
          <Field label="Server name">
            <input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Session name" help="What shows in the in-game server list.">
            <input className="input" value={draft.sessionName} onChange={(e) => set('sessionName', e.target.value)} />
          </Field>
          <Field label="Map">
            <MapPicker maps={catalog?.maps ?? []} value={draft.map} onChange={(code) => set('map', code)} />
          </Field>
          <Field label="Player slots" help="Written as -WinLiveMaxPlayers, which is what ASA actually honours.">
            <input className="input" type="number" min={1} max={255} value={draft.maxPlayers} onChange={(e) => set('maxPlayers', Number(e.target.value))} />
          </Field>
          <Field label="Join password">
            <input className="input" value={draft.serverPassword} onChange={(e) => set('serverPassword', e.target.value)} />
          </Field>
          <Field
            label="Admin / RCON password"
            help="Used by RCON and by enablecheats in game. No question marks — ARK would cut the value short at one."
            error={/[?]/.test(draft.adminPassword) ? 'A question mark here breaks admin access entirely.' : undefined}
          >
            <input className="input input-mono" value={draft.adminPassword} onChange={(e) => set('adminPassword', e.target.value)} />
          </Field>
          <Field label="Spectator password">
            <input className="input" value={draft.spectatorPassword} onChange={(e) => set('spectatorPassword', e.target.value)} />
          </Field>
          <Field label="Message of the day">
            <input className="input" value={draft.motd} onChange={(e) => set('motd', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <Icon.Globe />
          <h3>Network &amp; storage</h3>
        </div>
        <div className="card-body grid grid-2">
          <Field label="Game port (UDP)" help={`ASA also uses ${draft.port + 1}.`}>
            <input className="input" type="number" value={draft.port} onChange={(e) => set('port', Number(e.target.value))} />
          </Field>
          <Field label="Query port (UDP)">
            <input className="input" type="number" value={draft.queryPort} onChange={(e) => set('queryPort', Number(e.target.value))} />
          </Field>
          <Field label="RCON port (TCP)">
            <input className="input" type="number" value={draft.rconPort} onChange={(e) => set('rconPort', Number(e.target.value))} />
          </Field>
          <Field label="Multihome IP" help="Bind to one NIC. Leave blank on a normal machine.">
            <input className="input input-mono" value={draft.multihome} onChange={(e) => set('multihome', e.target.value)} />
          </Field>
          <Field
            label="Install folder"
            help={installPathCheck.level === 'warn' ? installPathCheck.message ?? undefined : undefined}
            error={installPathCheck.level === 'blocked' ? installPathCheck.message ?? undefined : undefined}
          >
            <input className="input input-mono" value={draft.installPath} onChange={(e) => set('installPath', e.target.value)} />
          </Field>
          <Field label="Cluster ID" help="Same ID on several servers enables transfers between them.">
            <ClusterIdInput value={draft.clusterId} onChange={(id) => set('clusterId', id)} />
          </Field>
          <Field label="Cluster folder" help="Leave blank to use the default under your cluster root.">
            <input className="input input-mono" value={draft.clusterDir} onChange={(e) => set('clusterDir', e.target.value)} />
          </Field>
          <Field label="RCON">
            <Toggle checked={draft.rconEnabled} onChange={(v) => set('rconEnabled', v)} title="Enable RCON" help="Required for the console, player list and graceful restarts." />
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <Icon.Bolt />
          <h3>Launch flags</h3>
          <Help
            title="Switches, not settings"
            body="These go on ARK's command line rather than into an INI file, which is why they are here and not under Game settings. The full command is shown on the Overview tab."
          />
          <div className="spacer" />
          <span className="card-hint">
            {needle ? `${flags.length} of ${catalog?.launchFlags?.length ?? 0} match · ` : ''}
            {activeFlagCount} on
          </span>
        </div>
        <div className="card-body stack">
          {needle && !flags.length ? (
            <Callout tone="info" title={`No launch flag matches “${search}”`}>
              Flags are the switches ARK takes on its command line. If what you are after is a rate or a rule, it is an INI
              setting — look under <span className="strong">Game settings</span>.
            </Callout>
          ) : null}
          {(catalog?.launchFlagGroups ?? []).map((group) => {
            const inGroup = flags.filter((f) => f.group === group);
            if (!inGroup.length) return null;
            const onHere = inGroup.filter((f) => (draft.flags as unknown as Record<string, boolean>)[f.key]).length;
            return (
              <div key={group} className="flag-group">
                <div className="flag-group-head">
                  <span className="stat-label">{group}</span>
                  <span className="flag-group-rule" />
                  {onHere ? <span className="small faint">{onHere} on</span> : null}
                </div>
                <div className="flag-grid">
                  {inGroup.map((flagDef) => {
                    const on = Boolean((draft.flags as unknown as Record<string, boolean>)[flagDef.key]);
                    return (
                      <div
                        key={flagDef.key}
                        ref={flagDef.key === highlightFlag ? flagRef : undefined}
                        className={`flag-card${on ? ' on' : ''}${flagDef.key === highlightFlag ? ' highlight-target' : ''}`}
                      >
                        <Toggle
                          checked={on}
                          onChange={(v) => set('flags', { ...draft.flags, [flagDef.key]: v })}
                          title={
                            <>
                              {flagDef.label}
                              {flagDef.recommended ? <Badge tone="ok">recommended</Badge> : null}
                              {flagDef.danger ? <Badge tone="warn">careful</Badge> : null}
                            </>
                          }
                          help={
                            <>
                              <span className="flag-arg">{flagDef.arg}</span>
                              <span className="flag-help">{flagDef.help}</span>
                            </>
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {settingHits.length ? (
            <div className="stack" style={{ gap: 0, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <div className="small dim" style={{ marginBottom: 6 }}>
                {settingHits.length === 1 ? 'This one is an INI setting' : `${settingHits.length} of these are INI settings`} rather
                than a launch flag — ARK reads them out of a file, so they live on the Game settings tab.
              </div>
              {settingHits.slice(0, 8).map((def) => (
                <div className="setting-row" key={idOf(def)}>
                  <div className="setting-meta">
                    <div className="setting-name">
                      {def.label}
                      <Badge>{def.group}</Badge>
                      <span className="setting-key">
                        {def.file === 'gus' ? 'GameUserSettings' : 'Game'}.ini · {def.key}
                      </span>
                    </div>
                    {def.help ? <div className="setting-help">{def.help}</div> : null}
                  </div>
                  <div className="setting-control">
                    <Button size="sm" onClick={onShowSettings}>
                      Open Game settings
                    </Button>
                  </div>
                </div>
              ))}
              {settingHits.length > 8 ? (
                <div className="small faint" style={{ paddingTop: 10 }}>
                  and {settingHits.length - 8} more on the Game settings tab.
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="divider" />
          <Field
            label="Seasonal event"
            help="Runs one of ARK's events out of season — coloured creatures, event drops and skins. Applied as -ActiveEvent."
          >
            <select className="select" value={draft.activeEvent} onChange={(e) => set('activeEvent', e.target.value)}>
              {(catalog?.activeEvents ?? [{ id: '', label: 'None' }]).map((event) => (
                <option key={event.id} value={event.id}>
                  {event.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <Icon.Settings />
          <h3>Behaviour &amp; extras</h3>
        </div>
        <div className="card-body stack">
          <div className="grid grid-2">
            <Toggle checked={draft.autoStart} onChange={(v) => set('autoStart', v)} title="Start with ASMS" help="Launch this server whenever ASMS itself starts." />
            <Toggle checked={draft.autoRestartOnCrash} onChange={(v) => set('autoRestartOnCrash', v)} title="Restart after a crash" help="Pauses itself after five crashes in 30 minutes." />
            <Toggle checked={draft.updateOnStart} onChange={(v) => set('updateOnStart', v)} title="Update before starting" help="Runs SteamCMD on every start." />
          </div>
          <Field label="Extra command line arguments" help="Appended verbatim, space separated.">
            <input className="input input-mono" value={draft.extraArgs} onChange={(e) => set('extraArgs', e.target.value)} placeholder="-ForceAllowCaveFlyers" />
          </Field>
          <Field label="Extra URL parameters" help="Added to the ?map?listen? query string. Separate with ?">
            <input className="input input-mono" value={draft.extraQuery} onChange={(e) => set('extraQuery', e.target.value)} placeholder="AltSaveDirectoryName=Season3" />
          </Field>
        </div>
        <div className="card-foot">
          <span className="card-hint">{dirty ? 'Unsaved changes' : 'Saved'}</span>
          <div className="spacer" />
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(server)}>
            Discard
          </Button>
          <Button variant="primary" busy={busy} disabled={!dirty || !!mapError} onClick={save}>
            <Icon.Save /> Save
          </Button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <Icon.Layers />
          <h3>Share this setup</h3>
          <Help
            title="Your configuration, as a file"
            body="A setup bundles this server's mods, game settings and launch flags. Keep it as a checkpoint before experimenting, apply it to a second server, or send the file to a friend. Passwords, ports and folder paths are never included."
          />
        </div>
        <div className="card-body row row-wrap">
          <span className="small dim" style={{ flex: 1, minWidth: 240 }}>
            Save what this server looks like right now, so you can put it back — or put it somewhere else.
          </span>
          <Button onClick={() => setSharing(true)}>
            <Icon.Save /> Save as setup
          </Button>
          <Button variant="ghost" onClick={() => navigate('/setups')}>
            <Icon.Layers size={14} /> Browse setups
          </Button>
        </div>
      </div>

      {sharing ? <SaveSetupDialog serverId={server.id} onClose={() => setSharing(false)} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ raw ini

function RawIni({ server }: { server: ServerInstance }) {
  const [busy, run] = useAction();
  const [which, setWhich] = useState<'gus' | 'game'>('gus');
  const [files, setFiles] = useState<Record<string, { path: string; text: string }>>({});
  const [text, setText] = useState('');

  const load = useCallback(
    () =>
      void run(async () => {
        const res = await api.get<{ files: Record<string, { path: string; text: string }> }>(`/servers/${server.id}/config`);
        setFiles(res.files);
        // The effect below syncs the textarea from `files`, so setting the text
        // here as well would race it — and lose an edit made while it loaded.
      }),
    [server.id, run],
  );

  useEffect(() => load(), [load]);
  useEffect(() => setText(files[which]?.text ?? ''), [which, files]);

  const dirty = text !== (files[which]?.text ?? '');

  return (
    <div className="card">
      <div className="card-head">
        <Icon.File />
        <h3>Raw configuration</h3>
        <Help
          title="Anything not on the friendly list"
          body="The full INI files, edited as text. ASMS keeps a .asms.bak copy beside each file every time you save."
        />
        <div className="spacer" />
        <div className="segmented">
          <button className={which === 'gus' ? 'active' : ''} onClick={() => setWhich('gus')}>
            GameUserSettings.ini
          </button>
          <button className={which === 'game' ? 'active' : ''} onClick={() => setWhich('game')}>
            Game.ini
          </button>
        </div>
      </div>
      <div className="card-body stack">
        <div className="small faint mono truncate">{files[which]?.path}</div>
        <textarea className="textarea" style={{ minHeight: '48vh' }} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} />
        <span className="tiny faint">
          ASMS keeps a <span className="mono">.asms.bak</span> copy next to the file on every save. ARK rewrites these files when it shuts
          down, so edit while the server is stopped.
        </span>
      </div>
      <div className="card-foot">
        <span className="card-hint">{dirty ? 'Unsaved changes' : 'Saved'}</span>
        <div className="spacer" />
        <Button variant="ghost" onClick={load}>
          <Icon.Refresh size={14} /> Reload from disk
        </Button>
        <Button
          variant="primary"
          busy={busy}
          disabled={!dirty}
          onClick={() =>
            void run(async () => {
              await api.put(`/servers/${server.id}/config`, { [which]: text });
              setFiles((f) => ({ ...f, [which]: { ...f[which], text } }));
            }, 'File written')
          }
        >
          <Icon.Save /> Save file
        </Button>
      </div>
    </div>
  );
}
