import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../lib/store';
import { api, download } from '../../lib/api';
import { Button, Empty, Toggle, Badge, SearchInput } from '../../components/ui';
import { Tooltip, Help } from '../../components/Tooltip';
import { Icon } from '../../components/Icons';
import { bytes, when } from '../../lib/format';
import type { LogFileInfo, ServerInstance } from '../../lib/types';

type Source = 'server' | 'asms';
type Severity = 'error' | 'warn' | 'info' | 'plain';

/** Mirrors severityOf() in apps/server/src/core/logs.ts - keep the two in step. */
function severityOf(line: string): Severity {
  if (/\bwarn(ing)?\s*:/i.test(line)) return 'warn';
  if (/\b(error|fatal|exception|failed|failure|critical)\b/i.test(line)) return 'error';
  if (/\bwarn(ing)?\b|\bdeprecated\b/i.test(line)) return 'warn';
  if (/\b(log[a-z]*|display|info)\s*:/i.test(line)) return 'info';
  return 'plain';
}

const MAX_RENDERED = 3000;

export default function Logs({ server }: { server: ServerInstance }) {
  const { runtimeOf } = useStore();
  // A stopped server's log cannot change, so there is nothing to poll for.
  const state = runtimeOf(server.id)?.state ?? 'stopped';
  const live = state === 'running' || state === 'starting' || state === 'stopping' || state === 'updating' || state === 'installing';
  const lastPoll = useRef(0);
  const [source, setSource] = useState<Source>('server');
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [active, setActive] = useState('');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState('');
  const [levels, setLevels] = useState<Record<Severity, boolean>>({ error: true, warn: true, info: true, plain: true });
  const [follow, setFollow] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [loading, setLoading] = useState(true);
  const offset = useRef(0);
  const viewRef = useRef<HTMLDivElement>(null);

  // --- file list -----------------------------------------------------------
  const loadFiles = useCallback(
    (which: Source) => {
      setLoading(true);
      void api
        .get<{ files: LogFileInfo[] }>(`/servers/${server.id}/logs?source=${which}`)
        .then((res) => {
          setFiles(res.files);
          setActive((current) => (res.files.some((f) => f.name === current) ? current : (res.files[0]?.name ?? '')));
        })
        .catch(() => setFiles([]))
        .finally(() => setLoading(false));
    },
    [server.id],
  );

  useEffect(() => loadFiles(source), [loadFiles, source]);

  // Pick up newly created log files without a manual refresh. Paused while the
  // tab is hidden — a backgrounded dashboard has nobody to show them to.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') loadFiles(source);
    }, 20_000);
    return () => clearInterval(t);
  }, [loadFiles, source]);

  // --- incremental tail ----------------------------------------------------
  useEffect(() => {
    offset.current = 0;
    setText('');
    if (!active) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await api.get<{ offset: number; text: string; rotated: boolean }>(
          `/servers/${server.id}/logs/read?source=${source}&file=${encodeURIComponent(active)}&offset=${offset.current}`,
        );
        if (cancelled) return;
        offset.current = res.offset;
        if (res.rotated) setText(res.text);
        else if (res.text) setText((prev) => (prev + res.text).slice(-600_000));
      } catch {
        /* the file may not exist yet */
      }
    };

    void poll();
    /**
     * Every three seconds costs a stat and a read on a file that may be
     * gigabytes. Skipped while the tab is hidden, and slowed right down when the
     * server is not running — a stopped server's log cannot change.
     */
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (!live && Date.now() - lastPoll.current < 30_000) return;
      lastPoll.current = Date.now();
      void poll();
    }, 3000);
    // Catch up the moment the tab comes back rather than waiting for the timer.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [server.id, active, source, live]);

  // --- follow --------------------------------------------------------------
  useEffect(() => {
    if (follow && viewRef.current) viewRef.current.scrollTop = viewRef.current.scrollHeight;
  }, [text, follow]);

  const onScroll = () => {
    const el = viewRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAtBottom(bottom);
    // Scrolling up to read something turns following off, as you would expect.
    if (!bottom && follow) setFollow(false);
  };

  const jumpToLatest = () => {
    setFollow(true);
    if (viewRef.current) viewRef.current.scrollTop = viewRef.current.scrollHeight;
  };

  // --- filtering -----------------------------------------------------------
  const rows = useMemo(() => {
    const all = text.split(/\r?\n/);
    const needle = filter.trim().toLowerCase();
    const out: Array<{ n: number; line: string; sev: Severity }> = [];
    for (let i = 0; i < all.length; i += 1) {
      const line = all[i];
      if (!line && i === all.length - 1) continue;
      const sev = severityOf(line);
      if (!levels[sev]) continue;
      if (needle && !line.toLowerCase().includes(needle)) continue;
      out.push({ n: i + 1, line, sev });
    }
    return out.slice(-MAX_RENDERED);
  }, [text, filter, levels]);

  const counts = useMemo(() => {
    const c = { error: 0, warn: 0, info: 0, plain: 0 };
    for (const line of text.split(/\r?\n/)) if (line) c[severityOf(line)] += 1;
    return c;
  }, [text]);

  const currentFile = files.find((f) => f.name === active);

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <Icon.File />
          <h3>Logs</h3>
          <Help
            title="Where these come from"
            body={
              <>
                <strong>Server logs</strong> are written by ARK into its own <code>Saved/Logs</code> folder. <strong>ASMS logs</strong> are
                this app’s own record of what it did — useful when a start or an update fails.
              </>
            }
          />
          <div className="spacer" />
          <div className="segmented">
            <button className={source === 'server' ? 'active' : ''} onClick={() => setSource('server')}>
              Server logs
            </button>
            <button className={source === 'asms' ? 'active' : ''} onClick={() => setSource('asms')}>
              ASMS logs
            </button>
          </div>
        </div>

        <div className="card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
          <select className="select" style={{ maxWidth: 320 }} value={active} onChange={(e) => setActive(e.target.value)} disabled={!files.length}>
            {files.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} · {bytes(f.sizeBytes)} · {when(f.modifiedAt)}
              </option>
            ))}
            {!files.length ? <option>No log files</option> : null}
          </select>

          <SearchInput value={filter} onChange={setFilter} width={240} placeholder="Search this log…" />

          <div className="btn-group">
            {(['error', 'warn', 'info'] as const).map((level) => (
              <Tooltip key={level} title={`${levels[level] ? 'Hide' : 'Show'} ${level} lines`} body={`${counts[level]} in this file.`}>
                <button
                  className={`btn btn-sm ${levels[level] ? '' : 'btn-ghost'}`}
                  onClick={() => setLevels((l) => ({ ...l, [level]: !l[level] }))}
                  style={{ opacity: levels[level] ? 1 : 0.45 }}
                >
                  <span className={`dot dot-${level === 'error' ? 'bad' : level === 'warn' ? 'warn' : 'info'}`} />
                  {counts[level]}
                </button>
              </Tooltip>
            ))}
          </div>

          <div className="spacer" />
          <Tooltip title="Follow new lines" body="Keeps the view pinned to the bottom. Scrolling up switches it off automatically.">
            <Toggle checked={follow} onChange={setFollow} title="Follow" />
          </Tooltip>
          {currentFile ? (
            <Tooltip title="Download this log" body="Saves the whole file, not just the tail on screen — handy for sharing when asking for help.">
              <button className="btn btn-sm btn-ghost" onClick={() => void download(`/servers/${server.id}/logs/download?source=${source}&file=${encodeURIComponent(active)}`)}>
                <Icon.Download size={13} /> Download
              </button>
            </Tooltip>
          ) : null}
        </div>

        <div className="card-body" style={{ padding: 12, position: 'relative' }}>
          {loading && !files.length ? (
            <div className="stack" style={{ gap: 8 }}>
              {[...Array(8)].map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 14, width: `${90 - i * 6}%` }} />
              ))}
            </div>
          ) : !files.length ? (
            <Empty
              icon="📄"
              title={source === 'asms' ? 'No ASMS logs yet' : 'No server logs yet'}
              body={
                source === 'asms'
                  ? 'ASMS writes a log file per day under its data folder. One appears as soon as anything is logged.'
                  : 'ARK creates these the first time the server runs. Start the server once, then come back — and make sure the "Write game log" launch flag is on for the fullest output.'
              }
            />
          ) : (
            <>
              <div className="logview" ref={viewRef} onScroll={onScroll} style={{ height: '58vh' }}>
                {rows.length === 0 ? (
                  <div className="log-empty">
                    {text ? 'Nothing matches those filters.' : 'Waiting for the first line…'}
                  </div>
                ) : (
                  <div className="logrows">
                    {rows.map((row) => (
                      <div key={`${row.n}-${row.line.slice(0, 12)}`} className={`logrow ${row.sev}`}>
                        <span className="n">{row.n}</span>
                        <span className="t">{highlight(row.line, filter)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {!atBottom ? (
                <Button className="jump-latest" size="sm" variant="primary" onClick={jumpToLatest}>
                  ↓ Jump to latest
                </Button>
              ) : null}
            </>
          )}
        </div>

        <div className="card-foot" style={{ flexWrap: 'wrap' }}>
          <span className="card-hint">
            Polls every 3 seconds and fetches only new bytes.
            {rows.length >= MAX_RENDERED ? ` Showing the newest ${MAX_RENDERED} matching lines.` : ''}
          </span>
          <div className="spacer" />
          {currentFile ? <Badge>{bytes(currentFile.sizeBytes)} on disk</Badge> : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              offset.current = 0;
              setText('');
              loadFiles(source);
            }}
          >
            <Icon.Refresh size={14} /> Reload
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Wrap search hits in <mark> without touching the rest of the line. */
function highlight(line: string, needle: string) {
  const term = needle.trim();
  if (!term) return line;
  const lower = line.toLowerCase();
  const target = term.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let found = lower.indexOf(target);
  let key = 0;
  while (found !== -1) {
    if (found > cursor) parts.push(line.slice(cursor, found));
    parts.push(<mark key={key++}>{line.slice(found, found + term.length)}</mark>);
    cursor = found + term.length;
    found = lower.indexOf(target, cursor);
  }
  parts.push(line.slice(cursor));
  return parts;
}
