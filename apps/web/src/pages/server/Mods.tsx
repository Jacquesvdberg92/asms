import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore, useAction } from '../../lib/store';
import { api } from '../../lib/api';
import { Button, Empty, Field, Toggle, Badge, CopyButton, Modal, Callout, SearchInput, ExternalLink } from '../../components/ui';
import { Icon } from '../../components/Icons';
import { Help, Tooltip } from '../../components/Tooltip';
import PendingBar from '../../components/PendingBar';
import { formatModList, modLabel, modLink, modSearchLink, parseModList } from '../../lib/mods';
import { matches } from '../../lib/search';
import { useUnsavedGuard } from '../../lib/guard';
import { LibraryPicker } from '../../components/LibraryPicker';
import { ModSources } from '../../components/ModSources';
import { dateTime } from '../../lib/format';
import type { ModDiagnosis, ModEntry, ModReport, ModStatus, ServerInstance, ServerRuntime } from '../../lib/types';

/**
 * What each on-disk state means, in the words someone staring at a server that
 * will not start actually needs. "Half-downloaded" is the one that matters:
 * ARK looks for the folder, not what is in it, so a download that died leaves
 * a folder that stops it ever trying again.
 */
const MOD_STATE: Record<ModStatus, { tone?: 'ok' | 'warn' | 'bad' | 'info'; label: string; help: string }> = {
  ok: { tone: 'ok', label: 'On disk', help: 'ARK unpacked this one and there are real files in the folder.' },
  partial: {
    tone: 'bad',
    label: 'Half-downloaded',
    help: 'The folder exists but nothing usable is in it — a download that died part way, or one ARK left in its .temp staging folder. ARK will not retry on its own: it sees the folder and assumes the mod is there. Force re-download clears it so the next start fetches it properly.',
  },
  missing: {
    tone: 'warn',
    label: 'Not downloaded',
    help: 'No folder for this mod at all. Either it has never been fetched, or the download failed outright. Download mods now is the quickest way to find out which.',
  },
  rejected: {
    tone: 'bad',
    label: 'Refused by CurseForge',
    help: 'ARK asked CurseForge for this id and got nothing back, then named it in “Mods not installed” and quit. Downloading again cannot help — either the id is not an ASA mod, or the mod is marked [PC Only] and this server also accepts consoles.',
  },
  unknown: { label: 'Not checked', help: 'ARK has not made a mods folder yet, so there is nothing to compare against.' },
};

/**
 * A mod list is a load order, not a set: what matters is which mods are on, in
 * what order, and which number belongs to which name. Twelve bare ids tell you
 * none of that, so names, authors and links are editable here and travel with
 * the server's setup.
 */
export default function Mods({ server, runtime }: { server: ServerInstance; runtime?: ServerRuntime }) {
  const { toast, library } = useStore();
  const [busy, run] = useAction();
  const [picker, setPicker] = useState(false);
  const [mods, setMods] = useState<ModEntry[]>(server.mods);
  const [auto, setAuto] = useState(server.flags.automanagedmods);
  const [entry, setEntry] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [doctor, setDoctor] = useState(false);
  const [find, setFind] = useState('');
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState<ModDiagnosis | null>(null);

  const state = runtime?.state ?? 'stopped';
  // ARK holds its mod files open, so anything that touches them waits for the
  // process to be gone.
  const idle = state === 'stopped' || state === 'crashed';

  /** What is actually on disk, refreshed whenever that could have changed. */
  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.get<ModDiagnosis>(`/servers/${server.id}/mods/status`));
    } catch {
      setStatus(null); // Not being able to look is not worth a toast.
    }
  }, [server.id]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus, server.updatedAt, state]);

  const onDisk = useMemo(() => new Map((status?.mods ?? []).map((m) => [m.id, m])), [status]);

  // Keyed on the saved list's *contents*, not its identity: every store refresh
  // hands over a freshly parsed array, and re-syncing on that alone quietly
  // threw away whatever the user was in the middle of editing.
  const saved = useMemo(
    () => JSON.stringify([server.mods, server.flags.automanagedmods]),
    [server.mods, server.flags.automanagedmods],
  );

  useEffect(() => {
    setMods(server.mods);
    setAuto(server.flags.automanagedmods);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const dirty = useMemo(
    () => JSON.stringify([mods, auto]) !== saved,
    [mods, auto, saved],
  );

  const enabled = mods.filter((m) => m.enabled);
  const launchLine = `-mods=${enabled.map((m) => m.id).join(',') || '(none)'}`;

  // Filtering a load order must never reorder it: the rows keep their real
  // position number so a filtered view cannot be mistaken for the whole list.
  const shown = useMemo(
    () => mods.filter((mod) => matches(find, mod.name, mod.id, mod.author)),
    [mods, find],
  );

  /** Typed something that is plainly a name rather than an ID. */
  const nameNotId = entry.trim().length > 2 && !parseModList(entry).length;

  const add = (text: string) => {
    const parsed = parseModList(text);
    if (!parsed.length) {
      toast('warn', 'That is not a project ID', 'ARK identifies mods by number. Search CurseForge for the name below.');
      return;
    }
    const fresh = parsed.filter((mod) => !mods.some((m) => m.id === mod.id));
    setMods((prev) => [...prev, ...fresh]);
    setEntry('');
    if (fresh.length < parsed.length) {
      toast('info', `Added ${fresh.length}`, `${parsed.length - fresh.length} were already in the list.`);
    }
  };

  const patch = (id: string, change: Partial<ModEntry>) =>
    setMods((prev) => prev.map((mod) => (mod.id === id ? { ...mod, ...change } : mod)));

  const move = (index: number, to: number) =>
    setMods((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [lifted] = next.splice(index, 1);
      next.splice(to, 0, lifted);
      return next;
    });

  /**
   * The force in "force a download": delete what ARK unpacked so it has no
   * folder to mistake for a finished mod, and fetches it again next start.
   */
  const forceRedownload = (mod: { id: string; name?: string }) =>
    void run(async () => {
      const res = await api.post<{ removed: string[] }>(`/servers/${server.id}/mods/${mod.id}/refresh`);
      await loadStatus();
      toast(
        'success',
        `${modLabel(mod)} will be fetched again`,
        res.removed.length
          ? `Cleared ${res.removed.length} folder${res.removed.length === 1 ? '' : 's'}. Press Download mods now, or just start the server.`
          : 'Nothing of it was on disk, so the next download starts clean anyway.',
      );
      return res;
    });

  const downloadNow = () =>
    void run(
      () => api.post(`/servers/${server.id}/mods/download`),
      'Fetching mods — progress is at the top of this tab',
    );

  const save = async () => {
    const saved = await run(
      () => api.patch(`/servers/${server.id}`, { mods, flags: { ...server.flags, automanagedmods: auto } }),
      'Mod list saved',
    );
    // run() turns a failure into a toast and undefined; the guard needs to know
    // so a save that did not land does not still throw the draft away.
    return saved !== undefined;
  };

  const guard = useUnsavedGuard({
    when: dirty,
    title: 'Your mod list is not saved',
    body: (
      <>
        The load order you edited here only exists in this page. Leaving now throws it away, and the
        server keeps starting with the list it had before.
      </>
    ),
    onSave: save,
  });

  // Only the saved list is on disk, so unsaved additions have no status yet.
  const broken = (status?.mods ?? []).filter((m) => m.enabled && (m.status === 'missing' || m.status === 'partial' || m.status === 'rejected'));

  return (
    <div className="stack">
      <PendingBar serverId={server.id} runtime={runtime} />

      <div className="card">
        <div className="card-head">
          <Icon.Package />
          <h3>Mods</h3>
          <Help
            title="Finding a project ID"
            body="Open the mod on CurseForge - the number in its URL is the project ID. That number is the only thing ARK needs; the name and author are for you."
          />
          <Badge>{enabled.length} on</Badge>
          {mods.length !== enabled.length ? <Badge tone="warn">{mods.length - enabled.length} off</Badge> : null}
          {broken.length ? (
            <Tooltip
              title="Not every mod is on disk"
              body="ARK will refuse to start until each of these is downloaded. The Files column says which, and what state each one is in."
            >
              <Badge tone="bad">{broken.length} not downloaded</Badge>
            </Tooltip>
          ) : null}
          <div className="spacer" />
          <Tooltip
            title="Make ARK download its mods now"
            body="ASA has no downloader of its own — the server executable is the only thing that can fetch a CurseForge mod. So this starts the server, watches the mods land, and shuts it down again the moment they are all there. It is the same thing a normal start does, without the ten-minute wait before you find out one is missing."
          >
            <Button
              size="sm"
              variant="primary"
              busy={busy}
              disabled={!idle || !enabled.length || dirty}
              title={dirty ? 'Save the list first' : undefined}
              onClick={downloadNow}
            >
              <Icon.Download size={13} /> Download mods now
            </Button>
          </Tooltip>
          <Button size="sm" onClick={() => setPicker(true)}>
            <Icon.Package size={13} /> From library{library.mods.length ? ` (${library.mods.length})` : ''}
          </Button>
          <Button
            size="sm"
            busy={busy}
            disabled={!mods.length}
            title="Keep these mods for the next server you make"
            onClick={() =>
              void run(
                () => api.post('/library/mods', { mods }),
                `${mods.length} mod${mods.length === 1 ? '' : 's'} saved to your library`,
              )
            }
          >
            <Icon.Save size={13} /> To library
          </Button>
          <Button size="sm" onClick={() => setDoctor(true)}>
            <Icon.Shield size={13} /> Check mods
          </Button>
          <CopyButton text={formatModList(mods)} label="Copy list" />
        </div>

        {dirty ? (
          <div className="card-body row row-wrap" style={{ borderBottom: '1px solid var(--line)', gap: 10 }}>
            <Icon.Alert className="dim" />
            <span className="small" style={{ flex: 1, minWidth: 200 }}>
              These changes are not live yet — the server still starts with the old list until you save.
            </span>
            <Button size="sm" variant="ghost" onClick={() => { setMods(server.mods); setAuto(server.flags.automanagedmods); }}>
              Discard
            </Button>
            <Button size="sm" variant="primary" busy={busy} onClick={() => void save()}>
              <Icon.Save size={13} /> Save
            </Button>
          </div>
        ) : null}

        <div className="card-body stack">
          <Field
            label="Add mods by CurseForge project ID"
            help="One ID, several at once, or Name,ID,URL rows separated by semicolons. Do not know the ID? Open “Where do I find mods?” below."
          >
            <div className="input-group">
              <input
                className="input input-mono"
                value={entry}
                placeholder="893657   or   Better Breeding,941697,https://..."
                onChange={(e) => setEntry(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && add(entry)}
              />
              <Button onClick={() => add(entry)}>
                <Icon.Plus /> Add
              </Button>
              <Button variant="ghost" onClick={() => setShowPaste((v) => !v)}>
                <Icon.File size={14} /> Paste a list
              </Button>
            </div>
            {nameNotId ? (
              <div className="row small" style={{ marginTop: 8, gap: 8 }}>
                <Icon.Search size={13} className="dim" />
                <span className="dim">
                  That looks like a name, and ARK only understands the number.{' '}
                  <ExternalLink href={modSearchLink(entry)} className="strong">
                    Search CurseForge for “{entry.trim()}”
                  </ExternalLink>{' '}
                  — then copy the number out of the mod&rsquo;s URL.
                </span>
              </div>
            ) : null}
          </Field>

          {showPaste ? (
            <Field
              label="Paste a whole list"
              help="One mod per line, or ModName,ModID,URL;ModName,ModID,URL. Anything already in the list is skipped."
            >
              <textarea ref={pasteRef} className="textarea" style={{ minHeight: 120 }} />
              <div className="row" style={{ marginTop: 8 }}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    add(pasteRef.current?.value ?? '');
                    if (pasteRef.current) pasteRef.current.value = '';
                    setShowPaste(false);
                  }}
                >
                  Add them all
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowPaste(false)}>
                  Cancel
                </Button>
              </div>
            </Field>
          ) : null}

          {mods.length === 0 ? (
            <Empty
              icon="🧩"
              title="No mods yet — this is a vanilla server"
              body="Paste a CurseForge project ID above to add one. Load order runs top to bottom: map mods and total conversions first, cosmetics last. Not sure where to get them? Open “Where do I find mods?” below."
            />
          ) : (
            <>
              {mods.length > 5 ? (
                <SearchInput
                  value={find}
                  onChange={setFind}
                  placeholder="Find a mod in this list…"
                  hint={find ? `${shown.length} of ${mods.length}` : undefined}
                />
              ) : null}
              <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44 }} title="Off keeps the mod in your list but out of the launch command">
                      On
                    </th>
                    <th style={{ width: 40 }} title="Position in the load order">
                      #
                    </th>
                    <th>Mod name — yours to fill in</th>
                    <th style={{ width: 130 }}>Project ID</th>
                    <th style={{ width: 190 }}>
                      <span className="row" style={{ gap: 5 }}>
                        Files
                        <Help
                          title="What is actually on disk"
                          body="Read from the folders ARK unpacked, not from what it says. A mod with no folder never downloaded; a folder with nothing in it is a download that died part way — and ARK will not retry that one on its own."
                        />
                      </span>
                    </th>
                    <th style={{ width: 150 }}>Author</th>
                    <th className="right" style={{ width: 196 }}>
                      Load order
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((mod) => {
                    const i = mods.indexOf(mod);
                    return (
                    <tr key={mod.id} style={mod.enabled ? undefined : { opacity: 0.5 }}>
                      <td>
                        <Toggle checked={mod.enabled} onChange={(v) => patch(mod.id, { enabled: v })} />
                      </td>
                      <td className="num faint">{mod.enabled ? enabled.indexOf(mod) + 1 : '-'}</td>
                      <td>
                        <input
                          className="input"
                          value={mod.name}
                          placeholder={`Mod ${mod.id}`}
                          onChange={(e) => patch(mod.id, { name: e.target.value })}
                        />
                      </td>
                      <td className="mono">
                        <a href={modLink(mod)} target="_blank" rel="noreferrer noopener" title={modLabel(mod)}>
                          {mod.id} &#8599;
                        </a>
                      </td>
                      <td>
                        <ModFiles
                          report={onDisk.get(mod.id)}
                          idle={idle}
                          busy={busy}
                          onForce={() => forceRedownload(mod)}
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          value={mod.author}
                          placeholder="-"
                          onChange={(e) => patch(mod.id, { author: e.target.value })}
                        />
                      </td>
                      <td className="right">
                        <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
                          <Button size="sm" disabled={i === 0} onClick={() => move(i, 0)} title="Move to top">
                            &#8670;
                          </Button>
                          <Button size="sm" disabled={i === 0} onClick={() => move(i, i - 1)}>
                            &#8593;
                          </Button>
                          <Button size="sm" disabled={i === mods.length - 1} onClick={() => move(i, i + 1)}>
                            &#8595;
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            title={`Remove ${modLabel(mod)} from this server`}
                            onClick={() => setMods((prev) => prev.filter((m) => m.id !== mod.id))}
                          >
                            <Icon.Trash size={13} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              {find && shown.length === 0 ? (
                <span className="small faint">No mod in this list matches “{find}”.</span>
              ) : null}
            </>
          )}

          <div className="row row-wrap">
            <span className="card-hint" style={{ flex: 1, minWidth: 200 }}>
              What ARK will be told to load:{' '}
              <span className="mono">{launchLine}</span>
            </span>
            <CopyButton text={launchLine} label="Copy" />
          </div>

          <Toggle
            checked={auto}
            onChange={setAuto}
            title="Let the server manage mod downloads"
            help="Adds -automanagedmods so the server pulls mod updates itself on boot."
          />
        </div>

        <div className="card-foot">
          <span className="card-hint">{dirty ? 'Unsaved changes - a restart applies them' : 'Saved'}</span>
          <div className="spacer" />
          <Button
            variant="ghost"
            disabled={!dirty}
            onClick={() => {
              setMods(server.mods);
              setAuto(server.flags.automanagedmods);
            }}
          >
            Discard
          </Button>
          <Button variant="primary" busy={busy} disabled={!dirty} onClick={() => void save()}>
            <Icon.Save /> Save
          </Button>
        </div>
      </div>

      {runtime?.lastError && /mod/i.test(runtime.lastError) ? (
        <Callout
          tone="danger"
          title="The last start failed on a mod"
          action={
            <div className="btn-group">
              <Button size="sm" variant="primary" busy={busy} disabled={!idle || !enabled.length} onClick={downloadNow}>
                <Icon.Download size={13} /> Download mods now
              </Button>
              <Button size="sm" onClick={() => setDoctor(true)}>
                <Icon.Shield size={13} /> Check mods
              </Button>
            </div>
          }
        >
          {/* ARK's own message names nothing; this one names the mods. */}
          {runtime.lastError}
        </Callout>
      ) : null}

      {doctor ? (
        <ModDoctor
          server={server}
          idle={idle}
          onForce={forceRedownload}
          onDownload={downloadNow}
          onClose={() => {
            setDoctor(false);
            void loadStatus();
          }}
        />
      ) : null}
      {picker ? (
        <LibraryPicker
          exclude={mods.map((m) => m.id)}
          onAdd={(picked) => setMods((prev) => [...prev, ...picked])}
          onClose={() => setPicker(false)}
        />
      ) : null}
      {guard}

      <ModSources open={mods.length === 0} />

      <div className="card card-pad small dim">
        <div className="strong" style={{ marginBottom: 4 }}>
          A note on load order
        </div>
        Map mods and total conversions belong first; cosmetic and QoL mods last. Turning one off keeps it in the list but takes
        it out of the launch command, which is the quick way to find the mod that is breaking a start. Every client needs the
        same mods, and the server downloads them on first boot - so the start after a change takes noticeably longer.
      </div>
    </div>
  );
}

/**
 * One mod's on-disk state, small enough to live in a table cell, with the
 * button that fixes the two states worth fixing.
 */
function ModFiles({
  report,
  idle,
  busy,
  onForce,
}: {
  report?: ModReport;
  idle: boolean;
  busy: boolean;
  onForce: () => void;
}) {
  if (!report) return <span className="tiny faint">save the list to check</span>;
  const state = MOD_STATE[report.status];
  const staged = report.status === 'partial' && report.staging;
  const where = report.folder ? ` ASMS looked in ${report.folder}.` : '';
  const body = staged
    ? `ARK extracted this one into its .temp staging folder and never moved it into place — the usual sign of a download that ran out of room or was interrupted. It will not retry on its own.${where}`
    : state.help + where;

  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row" style={{ gap: 6 }}>
        <Tooltip title={staged ? 'Stuck in .temp' : state.label} body={body}>
          {/* A mod that is switched off is not a problem, so it is not coloured like one. */}
          <Badge tone={report.enabled ? state.tone : undefined}>{staged ? 'Stuck in .temp' : state.label}</Badge>
        </Tooltip>
        {/* Nothing to clear, and offering it reads as a promise ARK cannot keep:
            a mod CurseForge refuses does not come back on the next attempt. */}
        {report.status === 'unknown' || report.status === 'rejected' ? null : (
          <Tooltip
            title="Force a re-download"
            body={
              idle
                ? 'Deletes what ARK unpacked for this mod, so there is no folder left for it to mistake for a finished download, and it fetches the whole thing again on the next start.'
                : 'Stop the server first — ARK holds its mod files open while it is running.'
            }
          >
            <Button
              size="sm"
              variant="ghost"
              disabled={!idle || busy}
              onClick={onForce}
              aria-label={`Force re-download ${report.name}`}
            >
              <Icon.Refresh size={13} />
            </Button>
          </Tooltip>
        )}
      </div>
      {report.status === 'ok' ? (
        <span className="tiny faint">
          {report.sizeMB} MB{report.fileId ? ` · build ${report.fileId}` : ''}
          {report.updatedAt ? ` · ${dateTime(report.updatedAt)}` : ''}
        </span>
      ) : null}
    </div>
  );
}

/**
 * ARK's own message names no mod, so this does: it compares the list ASMS asked
 * for against the folders ARK actually unpacked, quotes what ARK said about it,
 * and offers the two things that fix it.
 */
function ModDoctor({
  server,
  idle,
  onForce,
  onDownload,
  onClose,
}: {
  server: ServerInstance;
  idle: boolean;
  onForce: (mod: { id: string; name?: string }) => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const [busy, run] = useAction();
  const [result, setResult] = useState<ModDiagnosis | null>(null);

  const check = useCallback(async () => {
    await run(async () => {
      const res = await api.post<ModDiagnosis>(`/servers/${server.id}/mods/diagnose`);
      setResult(res);
      return res;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  const mark = (mod: ModReport) => {
    if (!mod.enabled) return { icon: '–', tone: 'var(--text-faint)', text: 'switched off, not requested' };
    switch (mod.status) {
      case 'ok':
        return {
          icon: '✓',
          tone: 'var(--ok)',
          text: `on disk — ${mod.sizeMB} MB in ${mod.files} file${mod.files === 1 ? '' : 's'}${mod.fileId ? `, build ${mod.fileId}` : ''}`,
        };
      case 'partial':
        return {
          icon: '!',
          tone: 'var(--bad)',
          text: mod.staging
            ? 'stuck in ARK’s .temp folder — extracted, never moved into place'
            : 'half-downloaded — the folder is there but nothing is in it',
        };
      case 'missing':
        return { icon: '✕', tone: 'var(--bad)', text: 'never downloaded — no folder for it at all' };
      case 'rejected':
        return { icon: '⊘', tone: 'var(--bad)', text: 'refused by CurseForge — ARK named this id in “Mods not installed”' };
      default:
        return { icon: '?', tone: 'var(--text-faint)', text: 'no mods folder to check against yet' };
    }
  };

  const broken = (result?.mods ?? []).filter((m) => m.enabled && (m.status === 'missing' || m.status === 'partial' || m.status === 'rejected'));

  return (
    <Modal
      title="Check mods"
      wide
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" busy={busy} onClick={() => void check()}>
            <Icon.Refresh size={13} /> Check again
          </Button>
          <div className="spacer" />
          <Button
            variant="primary"
            disabled={!idle || !result?.mods.some((m) => m.enabled)}
            onClick={() => {
              onDownload();
              onClose();
            }}
          >
            <Icon.Download size={13} /> Download mods now
          </Button>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {busy || !result ? (
        <div className="row dim">
          <span className="spinner" /> Comparing your list against what ARK unpacked…
        </div>
      ) : (
        <div className="stack">
          {result.lastRunFailed ? (
            <div className="callout danger">
              <Icon.Alert size={15} />
              <div>The last start ended with ARK refusing to load a mod.</div>
            </div>
          ) : null}

          {result.mods.map((mod) => {
            const state = mark(mod);
            // A mod CurseForge refused has nothing on disk to clear, and the
            // fix is on its mod page rather than here.
            const fixable = mod.enabled && mod.status !== 'unknown' && mod.status !== 'rejected';
            const lookup = mod.status === 'rejected' ? `https://www.curseforge.com/projects/${mod.id}` : null;
            return (
              <div key={mod.id} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <span className="strong" style={{ color: state.tone, width: 14, flex: 'none' }}>
                  {state.icon}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="small strong truncate">{mod.name}</div>
                  <div className="tiny faint">
                    <span className="mono">{mod.id}</span> — {state.text}
                  </div>
                </div>
                {fixable ? (
                  <Button
                    size="sm"
                    variant={mod.status === 'ok' ? 'ghost' : 'danger'}
                    disabled={!idle}
                    title={idle ? undefined : 'Stop the server first'}
                    onClick={() => {
                      onForce(mod);
                      void check();
                    }}
                  >
                    <Icon.Refresh size={13} /> Force re-download
                  </Button>
                ) : lookup ? (
                  <ExternalLink href={lookup} className="small">
                    What is this id?
                  </ExternalLink>
                ) : null}
              </div>
            );
          })}

          <div className="divider" />
          <div className="callout">
            <Icon.Bolt size={15} />
            <div>{result.verdict}</div>
          </div>

          {result.advice.length ? (
            <div className="stack" style={{ gap: 6 }}>
              <span className="stat-label">What to try, in this order</span>
              <ol className="small dim" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                {result.advice.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {result.evidence.length ? (
            <div className="stack" style={{ gap: 6 }}>
              <span className="stat-label">What ARK said</span>
              <div className="console" style={{ maxHeight: 150, minHeight: 0, height: 'auto' }}>
                {result.evidence.map((line, i) => (
                  <div key={i} className="console-line err">
                    {line}
                  </div>
                ))}
              </div>
              <span className="tiny faint">
                Pulled from the server&rsquo;s own output and ShooterGame.log. “Unable to create a directory” means the install
                folder is too long, not that the mod is broken.
              </span>
            </div>
          ) : null}

          {broken.length && idle ? (
            <Callout tone="warn" title={`${broken.length} mod${broken.length === 1 ? '' : 's'} to fetch`}>
              Force re-download clears what is on disk for a mod; Download mods now makes the server go and get everything that
              is missing. Doing both, in that order, is the fix for a mod that will not download.
            </Callout>
          ) : null}

          {result.root ? <div className="tiny faint mono truncate">Checked {result.root}</div> : null}
        </div>
      )}
    </Modal>
  );
}
