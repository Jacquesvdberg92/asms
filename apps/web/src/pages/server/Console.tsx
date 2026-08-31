import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore, useAction } from '../../lib/store';
import { api } from '../../lib/api';
import { Button, Field, Toggle, SearchInput, Callout } from '../../components/ui';
import { Icon } from '../../components/Icons';
import type { ServerInstance, ServerRuntime } from '../../lib/types';

const HISTORY_KEY = 'asms.rcon.history';

/**
 * ARK ships with the GameAnalytics SDK and narrates it several times a minute -
 * empty event queues, gzip sizes, and complaints about item names it does not
 * like the look of. None of it is actionable, and on stderr it arrives coloured
 * like a fault, so it is hidden by default with the count kept visible.
 */
const CHATTER = /GameAnalytics|Gzip stats|Event queue: No events|sdk error content/i;

export default function ConsolePanel({ server, runtime }: { server: ServerInstance; runtime?: ServerRuntime }) {
  const { catalog, consoleFor, onConsole } = useStore();
  const [, run] = useAction();
  const [lines, setLines] = useState<string[]>(() => consoleFor(server.id));
  const [filter, setFilter] = useState('');
  const [hideChatter, setHideChatter] = useState(true);
  const [follow, setFollow] = useState(true);
  // The palette can send you here with a command already in hand
  // (/console?cmd=SaveWorld) - it is loaded, never fired, because "search for
  // it" and "run it on a live server" are not the same intent.
  const [params] = useSearchParams();
  const wantedCommand = params.get('cmd') ?? '';
  const [command, setCommand] = useState(wantedCommand);
  const inputRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const [histIndex, setHistIndex] = useState(-1);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [showSuggest, setShowSuggest] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);

  // Live tail: seed from the buffer we already have, then append as they arrive.
  useEffect(() => {
    setLines(consoleFor(server.id));
    const off = onConsole(server.id, (line) => setLines((prev) => [...prev.slice(-799), line]));
    void api
      .get<{ lines: string[] }>(`/servers/${server.id}/console`)
      .then((res) => setLines(res.lines))
      .catch(() => {});
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  useEffect(() => {
    if (follow && viewRef.current) viewRef.current.scrollTop = viewRef.current.scrollHeight;
  }, [lines, follow]);

  useEffect(() => {
    if (!wantedCommand) return;
    setCommand(wantedCommand);
    inputRef.current?.focus();
  }, [wantedCommand]);

  const visible = useMemo(() => (hideChatter ? lines.filter((l) => !CHATTER.test(l)) : lines), [lines, hideChatter]);
  const hidden = lines.length - visible.length;

  const shown = useMemo(() => {
    if (!filter.trim()) return visible;
    const needle = filter.toLowerCase();
    return visible.filter((l) => l.toLowerCase().includes(needle));
  }, [visible, filter]);

  const suggestions = useMemo(() => {
    const head = command.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!head || command.includes(' ')) return [];
    return (catalog?.rconCommands ?? []).filter((c) => c.cmd.toLowerCase().startsWith(head)).slice(0, 8);
  }, [command, catalog]);

  const send = (raw?: string) => {
    const cmd = (raw ?? command).trim();
    if (!cmd) return;
    setCommand('');
    setShowSuggest(false);
    setHistIndex(-1);
    const next = [cmd, ...history.filter((h) => h !== cmd)].slice(0, 60);
    setHistory(next);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
    setLines((prev) => [...prev, `>>> ${cmd}`]);
    void run(async () => {
      const res = await api.post<{ response: string }>(`/servers/${server.id}/rcon`, { command: cmd });
      const text = res.response.trim() || '(no output)';
      setLines((prev) => [...prev, ...text.split(/\r?\n/)]);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSuggest && suggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && suggestions[suggestIndex] && command.trim() !== suggestions[suggestIndex].cmd)) {
        e.preventDefault();
        setCommand(suggestions[suggestIndex].cmd + (suggestions[suggestIndex].args ? ' ' : ''));
        setShowSuggest(false);
        return;
      }
    }
    if (e.key === 'Enter') return send();
    if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      const next = Math.min(history.length - 1, histIndex + 1);
      setHistIndex(next);
      setCommand(history[next]);
    }
    if (e.key === 'ArrowDown' && histIndex >= 0) {
      e.preventDefault();
      const next = histIndex - 1;
      setHistIndex(next);
      setCommand(next < 0 ? '' : history[next]);
    }
  };

  const rconReady = server.rconEnabled && runtime?.state === 'running';

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <Icon.Terminal />
          <h3>Console</h3>
          <div className="spacer" />
          <SearchInput
            value={filter}
            onChange={setFilter}
            width={240}
            placeholder="Filter output…"
            hint={filter ? `${shown.length} of ${visible.length} lines` : undefined}
          />
          <Toggle checked={hideChatter} onChange={setHideChatter} title="Hide chatter" />
          <Toggle checked={follow} onChange={setFollow} title="Follow" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setLines([]);
              void api.del(`/servers/${server.id}/console`).catch(() => {});
            }}
          >
            <Icon.Trash size={14} /> Clear
          </Button>
        </div>
        <div className="card-body" style={{ padding: 12 }}>
          <div className="console" ref={viewRef} style={{ height: '52vh' }}>
            {shown.length === 0 ? (
              <div className="console-empty">
                Nothing here yet. Server output, SteamCMD progress and your RCON replies all land in this window.
              </div>
            ) : (
              shown.map((line, i) => <div key={i} className={`console-line ${lineClass(line)}`}>{line}</div>)
            )}
          </div>
          {hideChatter && hidden > 0 ? (
            <div className="tiny faint" style={{ marginTop: 8 }}>
              {hidden} telemetry line{hidden === 1 ? '' : 's'} hidden — ARK's own GameAnalytics chatter, not a problem with your
              server. Turn off <span className="strong">Hide chatter</span> to see everything.
            </div>
          ) : null}
        </div>
        {!rconReady ? (
          <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
            <Callout tone="info" title="The command box is switched off">
              {!server.rconEnabled
                ? 'RCON is disabled on this server. Turn it on under Settings → Server & launch, then restart — ARK only opens the RCON port at boot.'
                : 'RCON needs a running server. Start it, wait for the console to settle, and the box below wakes up.'}
            </Callout>
          </div>
        ) : null}

        <div className="card-foot" style={{ display: 'block' }}>
          <div className="console-input" style={{ position: 'relative', marginTop: 0 }}>
            {showSuggest && suggestions.length ? (
              <div className="cmd-suggest">
                {suggestions.map((s, i) => (
                  <button
                    key={s.cmd}
                    className={i === suggestIndex ? 'active' : ''}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setCommand(s.cmd + (s.args ? ' ' : ''));
                      setShowSuggest(false);
                    }}
                  >
                    <div>
                      <span className="cmd-name">{s.cmd}</span>
                      {s.args ? <span className="cmd-args">{s.args}</span> : null}
                    </div>
                    <div className="cmd-help">{s.help}</div>
                  </button>
                ))}
              </div>
            ) : null}
            <input
              ref={inputRef}
              className="input input-mono"
              placeholder={rconReady ? 'Type an RCON command — Tab completes, ↑ recalls history' : 'RCON available once the server is running'}
              value={command}
              disabled={!rconReady}
              onChange={(e) => {
                setCommand(e.target.value);
                setShowSuggest(true);
                setSuggestIndex(0);
              }}
              onKeyDown={onKeyDown}
              onBlur={() => setTimeout(() => setShowSuggest(false), 120)}
            />
            <Button variant="primary" disabled={!rconReady} onClick={() => send()}>
              Send
            </Button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <Icon.Bolt />
          <h3>Quick actions</h3>
        </div>
        <div className="card-body stack">
          <div className="btn-group">
            {['ListPlayers', 'SaveWorld', 'GetChat', 'GetServerInfo', 'ShowMessageOfTheDay'].map((cmd) => (
              <Button key={cmd} size="sm" disabled={!rconReady} onClick={() => send(cmd)}>
                {cmd}
              </Button>
            ))}
          </div>
          <BroadcastBox serverId={server.id} disabled={!rconReady} />
        </div>
      </div>
    </div>
  );
}

function BroadcastBox({ serverId, disabled }: { serverId: string; disabled: boolean }) {
  const [, run] = useAction();
  const [message, setMessage] = useState('');
  return (
    <Field label="Broadcast to everyone" help="Shows as a large centre-screen message in game.">
      <div className="input-group">
        <input
          className="input"
          value={message}
          disabled={disabled}
          placeholder="Restarting in 10 minutes — find a safe spot!"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && message.trim()) {
              void run(() => api.post(`/servers/${serverId}/broadcast`, { message }), 'Broadcast sent');
              setMessage('');
            }
          }}
        />
        <Button
          disabled={disabled || !message.trim()}
          onClick={() => {
            void run(() => api.post(`/servers/${serverId}/broadcast`, { message }), 'Broadcast sent');
            setMessage('');
          }}
        >
          Send
        </Button>
      </div>
    </Field>
  );
}

function lineClass(line: string): string {
  if (line.includes('>>> ')) return 'echo';
  if (/---|SteamCMD|Auto-restart|Reattached|Launching|Stopping/.test(line)) return 'sys';
  if (/error|failed|fatal|exception|crash/i.test(line)) return 'err';
  return '';
}
