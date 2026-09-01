import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useAction } from '../lib/store';
import { api, download } from '../lib/api';
import { TopBar } from '../components/Shell';
import { Button, Badge, Confirm, Empty, Field, Modal, Toggle, Callout, SearchInput } from '../components/ui';
import { Icon } from '../components/Icons';
import { Help } from '../components/Tooltip';
import { PresetGrid } from '../components/Presets';
import { dateTime } from '../lib/format';
import { matches } from '../lib/search';
import {
  PART_LABELS,
  availableParts,
  defaultParts,
  downloadJson,
  fileNameFor,
  readJsonFile,
  sortSetups,
  summarise,
} from '../lib/setups';
import type { PresetDef, SavedSetup, SetupBundle, SetupParts } from '../lib/types';

/**
 * Presets and setups in one place: the four built-in play styles, and the
 * bundles you have saved from your own servers. Everything here is a file you
 * own - a setup can be downloaded, sent to a friend and imported back.
 */
export default function Setups() {
  const { setups, servers } = useStore();
  const [find, setFind] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [applyTarget, setApplyTarget] = useState<SavedSetup | null>(null);
  const [presetTarget, setPresetTarget] = useState<PresetDef | null>(null);
  const [renameTarget, setRenameTarget] = useState<SavedSetup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedSetup | null>(null);

  const ordered = useMemo(() => sortSetups(setups), [setups]);
  const shown = useMemo(
    () => ordered.filter((setup) => matches(find, setup.bundle.name, setup.bundle.description, setup.bundle.map)),
    [ordered, find],
  );

  return (
    <>
      <TopBar
        title="Presets & setups"
        sub="Four ready-made play styles, and your own saved server setups"
        actions={
          <Button variant="primary" disabled={!servers.length} onClick={() => setSaveOpen(true)}>
            <Icon.Save /> Save a server as a setup
          </Button>
        }
      />

      <div className="content stack">
        <div className="card">
          <div className="card-head">
            <Icon.Wand />
            <h3>Play style presets</h3>
            <Help
              title="One click, sixty settings"
              body="Each preset writes a coherent set of rates and rules into a server's INI files. Mods, ports, passwords and launch flags are never touched, and you can fine-tune everything afterwards on the Settings tab."
            />
            <div className="spacer" />
            <span className="card-hint">Pick one to apply it to a server</span>
          </div>
          <div className="card-body">
            <PresetGrid onPick={setPresetTarget} />
          </div>
          <div className="card-foot">
            <span className="card-hint">
              Presets change game settings only. ARK reads them at boot, so a running server needs a restart.
            </span>
          </div>
        </div>

        <ImportCard />

        <div className="card">
          <div className="card-head">
            <Icon.Layers />
            <h3>Saved setups</h3>
            <span className="badge">{ordered.length}</span>
            <div className="spacer" />
            {ordered.length > 3 ? (
              <SearchInput
                value={find}
                onChange={setFind}
                width={240}
                placeholder="Find a setup…"
                hint={find ? `${shown.length} of ${ordered.length}` : undefined}
              />
            ) : (
              <span className="card-hint">Mods, settings, launch flags — never passwords or ports</span>
            )}
          </div>
          {ordered.length === 0 ? (
            <Empty
              icon="📦"
              title="No saved setups yet"
              body="A setup is a snapshot of how a server is configured — its mods, its settings and its launch flags — that you can re-apply to another server, keep as a backup before experimenting, or send to a friend as a file."
              action={
                servers.length ? (
                  <Button variant="primary" onClick={() => setSaveOpen(true)}>
                    <Icon.Save /> Save a server as a setup
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="card-body grid grid-cards">
              {shown.map((setup) => (
                <SetupCard
                  key={setup.id}
                  setup={setup}
                  onApply={() => setApplyTarget(setup)}
                  onRename={() => setRenameTarget(setup)}
                  onDelete={() => setDeleteTarget(setup)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {saveOpen ? <SaveDialog onClose={() => setSaveOpen(false)} /> : null}
      {applyTarget ? <ApplyDialog setup={applyTarget} onClose={() => setApplyTarget(null)} /> : null}
      {presetTarget ? <PresetDialog preset={presetTarget} onClose={() => setPresetTarget(null)} /> : null}
      {renameTarget ? <RenameDialog setup={renameTarget} onClose={() => setRenameTarget(null)} /> : null}
      {deleteTarget ? <DeleteDialog setup={deleteTarget} onClose={() => setDeleteTarget(null)} /> : null}
    </>
  );
}

// ------------------------------------------------------------------- card

function SetupCard({
  setup,
  onApply,
  onRename,
  onDelete,
}: {
  setup: SavedSetup;
  onApply: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { bundle } = setup;
  return (
    <div className="card setup-card">
      <div className="setup-title">
        <Icon.Layers size={15} />
        <h3 className="truncate">{bundle.name}</h3>
        {bundle.presetId ? <Badge tone="accent">{bundle.presetId}</Badge> : null}
      </div>
      {bundle.description ? <div className="small dim">{bundle.description}</div> : null}
      <div className="setup-meta">
        {bundle.map ? <Badge>{bundle.map}</Badge> : null}
        <span className="tiny faint">{summarise(bundle)}</span>
      </div>
      <div className="tiny faint">
        {bundle.sourceServer ? `From ${bundle.sourceServer} · ` : ''}
        {dateTime(setup.updatedAt)}
      </div>
      <div className="setup-actions">
        <Button size="sm" variant="primary" onClick={onApply}>
          <Icon.Check size={13} /> Apply to…
        </Button>
        <button className="btn btn-sm" onClick={() => void download(`/setups/${setup.id}/download`)}>
          <Icon.Download size={13} /> Download
        </button>
        <Button size="sm" variant="ghost" onClick={onRename}>
          Rename
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          <Icon.Trash size={13} />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pickers

function ServerPicker({
  value,
  onChange,
  label = 'Server',
  help,
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  help?: string;
}) {
  const { servers, runtimes } = useStore();
  return (
    <Field label={label} help={help}>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {servers.map((server) => (
          <option key={server.id} value={server.id}>
            {server.name} ({server.map})
            {runtimes[server.id]?.state === 'running' ? ' — running' : ''}
          </option>
        ))}
      </select>
    </Field>
  );
}

function PartsPicker({
  parts,
  onChange,
  available,
}: {
  parts: SetupParts;
  onChange: (parts: SetupParts) => void;
  available?: SetupParts;
}) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      {PART_LABELS.map(({ key, title, help }) => {
        const missing = available ? !available[key] : false;
        return (
          <Toggle
            key={key}
            checked={parts[key] && !missing}
            disabled={missing}
            onChange={(v) => onChange({ ...parts, [key]: v })}
            title={missing ? `${title} — not in this setup` : title}
            help={help}
          />
        );
      })}
    </div>
  );
}

function RunningWarning({ serverId }: { serverId: string }) {
  const { runtimes } = useStore();
  if (runtimes[serverId]?.state !== 'running') return null;
  return (
    <Callout tone="warn" title="That server is running">
      ARK reads these files only at boot and rewrites them on shutdown, so nothing here takes effect - and could be undone -
      until you restart it.
    </Callout>
  );
}

// ----------------------------------------------------------- save dialog

function SaveDialog({ onClose, serverId: fixedServer }: { onClose: () => void; serverId?: string }) {
  const { servers, serverOf } = useStore();
  const [busy, run] = useAction();
  const [serverId, setServerId] = useState(fixedServer ?? servers[0]?.id ?? '');
  const server = serverOf(serverId);
  const [name, setName] = useState(server ? `${server.name} setup` : 'My setup');
  const [description, setDescription] = useState('');
  const [parts, setParts] = useState<SetupParts>(defaultParts());

  const body = () => ({ serverId, name, description, parts });

  return (
    <Modal
      title="Save a setup"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="ghost"
            busy={busy}
            onClick={() =>
              void run(async () => {
                const bundle = await api.post<SetupBundle>(`/servers/${serverId}/setup`, body());
                downloadJson(fileNameFor(bundle), bundle);
              }, 'Setup file downloaded')
            }
          >
            <Icon.Download size={14} /> Download only
          </Button>
          <div className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!serverId || !name.trim()}
            onClick={() => void run(() => api.post('/setups', body()), 'Setup saved').then(onClose)}
          >
            <Icon.Save /> Save setup
          </Button>
        </>
      }
    >
      <div className="stack">
        {fixedServer ? null : <ServerPicker value={serverId} onChange={setServerId} label="Copy the setup from" />}
        <Field label="Name">
          <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" help="What makes this setup worth keeping — for you, or whoever you send it to.">
          <input
            className="input"
            value={description}
            placeholder="e.g. x5 rates, 40 QoL mods, weekly restarts"
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="divider" />
        <span className="small dim">What to include</span>
        <PartsPicker parts={parts} onChange={setParts} />
        <div className="tiny faint">
          Passwords, ports, install folders and cluster IDs are never included — a setup file is safe to share as-is.
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------- apply dialog

function ApplyDialog({ setup, onClose }: { setup: SavedSetup; onClose: () => void }) {
  const { servers } = useStore();
  const [busy, run] = useAction();
  const navigate = useNavigate();
  const [serverId, setServerId] = useState(servers[0]?.id ?? '');
  const available = useMemo(() => availableParts(setup.bundle), [setup]);
  const [parts, setParts] = useState<SetupParts>({ ...defaultParts(), ...available, rawIni: false });

  const apply = () =>
    void run(async () => {
      const result = await api.post<{ applied: string[]; restartNeeded: boolean }>(`/servers/${serverId}/apply-setup`, {
        setupId: setup.id,
        parts,
      });
      onClose();
      navigate(`/servers/${serverId}/settings`);
      return result;
    }, `"${setup.bundle.name}" applied`);

  return (
    <Modal
      title={`Apply "${setup.bundle.name}"`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} disabled={!serverId} onClick={apply}>
            <Icon.Check /> Apply setup
          </Button>
        </>
      }
    >
      <div className="stack">
        {setup.bundle.description ? <div className="small dim">{setup.bundle.description}</div> : null}
        {setup.bundle.map ? (
          <div className="small faint">
            Captured on <span className="mono">{setup.bundle.map}</span> — applying a setup never changes the target's map.
          </div>
        ) : null}
        <ServerPicker value={serverId} onChange={setServerId} label="Apply to" />
        <RunningWarning serverId={serverId} />
        <div className="divider" />
        <span className="small dim">What to apply</span>
        <PartsPicker parts={parts} onChange={setParts} available={available} />
      </div>
    </Modal>
  );
}

// --------------------------------------------------------- preset dialog

function PresetDialog({ preset, onClose }: { preset: PresetDef; onClose: () => void }) {
  const { servers } = useStore();
  const [busy, run] = useAction();
  const navigate = useNavigate();
  const [serverId, setServerId] = useState(servers[0]?.id ?? '');

  if (!servers.length) {
    return (
      <Modal
        title={`${preset.icon} ${preset.name}`}
        onClose={onClose}
        footer={
          <Button variant="primary" onClick={() => navigate('/servers/new')}>
            Create a server
          </Button>
        }
      >
        <div className="stack">
          <p className="dim">{preset.description}</p>
          <p className="small faint">You have no servers yet — presets are offered again in the new server wizard.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`${preset.icon} ${preset.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!serverId}
            onClick={() =>
              void run(
                () => api.post(`/servers/${serverId}/config/preset`, { presetId: preset.id }),
                `${preset.name} applied`,
              ).then(() => {
                onClose();
                navigate(`/servers/${serverId}/settings`);
              })
            }
          >
            <Icon.Wand /> Apply {preset.name}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="dim">{preset.description}</p>
        <ul className="preset-points" style={{ paddingLeft: 18 }}>
          {preset.highlights.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <div className="divider" />
        <ServerPicker value={serverId} onChange={setServerId} label="Apply to" />
        <RunningWarning serverId={serverId} />
        <div className="tiny faint">
          This overwrites {Object.keys(preset.values).length} game settings on that server. ASMS keeps a{' '}
          <span className="mono">.asms.bak</span> copy of each INI file beside it, and mods, ports, passwords and launch flags
          are left alone.
        </div>
      </div>
    </Modal>
  );
}

// -------------------------------------------------------- rename / delete

function RenameDialog({ setup, onClose }: { setup: SavedSetup; onClose: () => void }) {
  const [busy, run] = useAction();
  const [name, setName] = useState(setup.bundle.name);
  const [description, setDescription] = useState(setup.bundle.description);

  return (
    <Modal
      title="Rename setup"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!name.trim()}
            onClick={() => void run(() => api.patch(`/setups/${setup.id}`, { name, description }), 'Renamed').then(onClose)}
          >
            <Icon.Save /> Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Name">
          <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function DeleteDialog({ setup, onClose }: { setup: SavedSetup; onClose: () => void }) {
  const [, run] = useAction();
  return (
    <Confirm
      title="Delete this setup"
      danger
      confirmLabel="Delete"
      onClose={onClose}
      onConfirm={() => void run(() => api.del(`/setups/${setup.id}`), 'Setup deleted')}
      body={
        <>
          "{setup.bundle.name}" will be removed from ASMS. Servers you already applied it to are not affected, and any file
          you downloaded still works.
        </>
      }
    />
  );
}

// ------------------------------------------------------------ import card

function ImportCard() {
  const [busy, run] = useAction();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const take = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      const bundle = await readJsonFile(file);
      // A full backup dropped here is a near miss, not a mistake worth a stack.
      if ((bundle as { kind?: string } | null)?.kind === 'asms.archive') {
        throw new Error('That is a full ASMS backup, not a setup — restore it under Settings → Backup & migrate.');
      }
      return api.post('/setups/import', { bundle });
    }, `Imported ${file.name}`);
  };

  return (
    <div className="card">
      <div className="card-head">
        <Icon.Upload />
        <h3>Import a setup</h3>
        <Help
          title="Setups are just files"
          body="Anything exported from ASMS - by you or by someone else - can be dropped here. ASMS checks every field on the way in and ignores anything it does not recognise."
        />
      </div>
      <div className="card-body">
        <div
          className={`drop-zone ${over ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            take(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="stack" style={{ alignItems: 'center', gap: 8 }}>
            <span>Drop an .asms-setup.json file here</span>
            <Button size="sm" busy={busy} onClick={() => input.current?.click()}>
              <Icon.File size={13} /> Choose a file
            </Button>
          </div>
        </div>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

export { SaveDialog as SaveSetupDialog };
