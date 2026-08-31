import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore, useAction, APP_UPDATE_CONSOLE } from '../lib/store';
import { api } from '../lib/api';
import { Button, Badge, Callout, ExternalLink } from './ui';
import { Icon } from './Icons';

interface UpdateStatus {
  current: string;
  currentSha: string | null;
  latestSha: string | null;
  behind: number | null;
  available: boolean;
  repo: string | null;
  branch: string | null;
  changes: string[];
  blocker: string | null;
  checkedAt: number;
}

interface UpdateResult {
  ok: boolean;
  restartRequired: boolean;
  message: string;
}

/**
 * Updating ASMS itself. Kept apart from the ARK server update button, which
 * lives on each server and means something completely different - conflating
 * the two is how you end up reinstalling a 30 GB game to fix a dashboard bug.
 */
export function AppUpdate() {
  const { consoleFor, onConsole } = useStore();
  const [busy, run] = useAction();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState<UpdateResult | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    void api.get<UpdateStatus>('/system/app-update').then(setStatus).catch(() => {});
  }, []);

  // Output arrives over the websocket, so it keeps coming even if this card is
  // re-rendered mid-install.
  useEffect(() => {
    setLines(consoleFor(APP_UPDATE_CONSOLE));
    return onConsole(APP_UPDATE_CONSOLE, () => setLines([...consoleFor(APP_UPDATE_CONSOLE)]));
  }, [consoleFor, onConsole]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  const check = useCallback(
    () => void run(async () => setStatus(await api.post<UpdateStatus>('/system/app-update/check')), undefined),
    [run],
  );

  const install = useCallback(
    () =>
      void run(async () => {
        const result = await api.post<UpdateResult>('/system/app-update/apply');
        setDone(result);
        setStatus(await api.get<UpdateStatus>('/system/app-update'));
      }),
    [run],
  );

  const version = status ? `v${status.current}${status.currentSha ? ` · ${status.currentSha}` : ''}` : '—';

  return (
    <div className="card" id="version">
      <div className="card-head">
        <Icon.Package />
        <h3>ASMS version</h3>
        <div className="spacer" />
        <Button size="sm" variant="ghost" busy={busy} onClick={check}>
          <Icon.Refresh size={14} /> Check for updates
        </Button>
      </div>
      <div className="card-body stack">
        <div className="row row-wrap">
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="strong mono">{version}</span>
              {status?.available ? (
                <Badge tone="warn">{status.behind} behind</Badge>
              ) : status && !status.blocker ? (
                <Badge tone="ok">up to date</Badge>
              ) : null}
            </div>
            <div className="tiny faint">
              {status?.repo ? (
                <>
                  <ExternalLink href={`https://github.com/${status.repo}`}>{status.repo}</ExternalLink>
                  {status.branch ? ` · ${status.branch}` : ''}
                </>
              ) : (
                'Updates the manager, not your ARK servers — those update from each server’s own page.'
              )}
            </div>
          </div>
          {status?.available && !done?.ok ? (
            <Button busy={busy} onClick={install}>
              <Icon.Download /> Install update
            </Button>
          ) : null}
        </div>

        {status?.blocker ? (
          <Callout tone="warn" title="Cannot update from here">
            {status.blocker}
          </Callout>
        ) : null}

        {status?.available && status.changes.length ? (
          <>
            <div className="divider" />
            <div className="small strong">What is waiting</div>
            <ul className="small dim" style={{ margin: 0, paddingLeft: 18 }}>
              {status.changes.slice(0, 10).map((subject, i) => (
                <li key={i}>{subject}</li>
              ))}
              {status.changes.length > 10 ? <li className="faint">…and {status.changes.length - 10} more</li> : null}
            </ul>
            {status.repo && status.currentSha && status.latestSha ? (
              <ExternalLink href={`https://github.com/${status.repo}/compare/${status.currentSha}...${status.latestSha}`}>
                See the full diff on GitHub
              </ExternalLink>
            ) : null}
          </>
        ) : null}

        {lines.length ? (
          <>
            <div className="divider" />
            <pre ref={logRef} className="console console-inline">
              {lines.join('\n')}
            </pre>
          </>
        ) : null}

        {done ? (
          <Callout
            tone={done.ok ? 'ok' : done.restartRequired ? 'warn' : 'danger'}
            title={done.ok ? 'Updated — restart to finish' : 'Update did not complete'}
          >
            {done.message} {done.restartRequired ? 'Your ARK servers keep running while ASMS restarts.' : ''}
          </Callout>
        ) : null}
      </div>
    </div>
  );
}
