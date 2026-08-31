import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, useAction } from '../../lib/store';
import { api } from '../../lib/api';
import { Button, Empty, Field, Toggle, Badge, CopyButton, Modal, Callout, SearchInput, ExternalLink } from '../../components/ui';
import { Icon } from '../../components/Icons';
import { Help } from '../../components/Tooltip';
import { formatModList, modLabel, modLink, modSearchLink, parseModList } from '../../lib/mods';
import { matches } from '../../lib/search';
import { useUnsavedGuard } from '../../lib/guard';
import { LibraryPicker } from '../../components/LibraryPicker';
import { ModSources } from '../../components/ModSources';
import type { ModDiagnosis, ModEntry, ModReport, ServerInstance, ServerRuntime } from '../../lib/types';

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

  return (
    <div className="stack">
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
          <div className="spacer" />
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
            <Button size="sm" onClick={() => setDoctor(true)}>
              <Icon.Shield size={13} /> Check mods
            </Button>
          }
        >
          ARK will not say which one. Check mods compares this list against the folders ARK actually unpacked, which usually
          names the culprit in a couple of seconds.
        </Callout>
      ) : null}

      {doctor ? <ModDoctor server={server} onClose={() => setDoctor(false)} /> : null}
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
 * ARK's own message names no mod, so this does: it compares the list ASMS asked
 * for against the folders ARK actually unpacked.
 */
function ModDoctor({ server, onClose }: { server: ServerInstance; onClose: () => void }) {
  const [busy, run] = useAction();
  const [result, setResult] = useState<ModDiagnosis | null>(null);

  useEffect(() => {
    void run(async () => {
      const res = await api.post<ModDiagnosis>(`/servers/${server.id}/mods/diagnose`);
      setResult(res);
      return res;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  const mark = (mod: ModReport) => {
    if (!mod.enabled) return { icon: '–', tone: 'var(--text-faint)', text: 'switched off, not requested' };
    if (mod.downloaded === null) return { icon: '?', tone: 'var(--text-faint)', text: 'no mods folder to check against yet' };
    return mod.downloaded
      ? { icon: '✓', tone: 'var(--ok)', text: 'downloaded and present' }
      : { icon: '✕', tone: 'var(--bad)', text: 'never downloaded' };
  };

  return (
    <Modal title="Check mods" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
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
            return (
              <div key={mod.id} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <span className="strong" style={{ color: state.tone, width: 14, flex: 'none' }}>
                  {state.icon}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="small strong truncate">{mod.name}</div>
                  <div className="tiny faint">
                    <span className="mono">{mod.id}</span> — {state.text}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="divider" />
          <div className="callout">
            <Icon.Bolt size={15} />
            <div>{result.verdict}</div>
          </div>
          {result.root ? <div className="tiny faint mono truncate">Checked {result.root}</div> : null}
        </div>
      )}
    </Modal>
  );
}
