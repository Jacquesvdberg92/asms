import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore, useAction, APP_UPDATE_CONSOLE } from '../lib/store';
import { api } from '../lib/api';
import { Button, Badge, Callout, ExternalLink } from './ui';
import { Icon } from './Icons';

interface UpdateStatus {
  current: string;
  latest: string | null;
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
  restarting?: boolean;
}

/**
 * Waits for ASMS to answer again after it has restarted itself, then reloads.
 *
 * The page it is running in was served by the process that just went away, so
 * it has to sit out the gap and come back on its own - otherwise the update
 * ends on a dead tab and looks like a crash.
 */
async function waitForRestart(onTick: (seconds: number) => void): Promise<boolean> {
  const started = Date.now();
  // Give the old process a moment to let go of the port before believing an
  // answer, or the very first poll succeeds against the version being replaced.
  await new Promise((r) => setTimeout(r, 3000));
  while (Date.now() - started < 180_000) {
    try {
      const res = await fetch('/api/system', { cache: 'no-store' });
      if (res.ok) return true;
    } catch {
      /* still down, which is the expected state for a while */
    }
    onTick(Math.round((Date.now() - started) / 1000));
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
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
  const [waiting, setWaiting] = useState<string | null>(null);
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
    (restart: boolean) =>
      void run(async () => {
        const result = await api.post<UpdateResult>('/system/app-update/apply', { restart });
        setDone(result);
        if (result.restarting) {
          setWaiting('ASMS is restarting…');
          const back = await waitForRestart((s) => setWaiting(`ASMS is restarting… ${s}s`));
          if (back) window.location.reload();
          else setWaiting(null);
          return;
        }
        setStatus(await api.get<UpdateStatus>('/system/app-update'));
      }),
    [run],
  );

  const restartOnly = useCallback(
    () =>
      void run(async () => {
        await api.post<{ how: string }>('/system/restart');
        setWaiting('ASMS is restarting…');
        const back = await waitForRestart((s) => setWaiting(`ASMS is restarting… ${s}s`));
        if (back) window.location.reload();
        else setWaiting(null);
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
                /* A version number when the remote has one, because "0.2.0 to 0.3.0"
                   says more than a commit count to anyone not reading the log. */
                <Badge tone="warn">
                  {status.latest && status.latest !== status.current ? `${status.latest} available` : `${status.behind} behind`}
                </Badge>
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
            <div className="btn-group">
              <Button variant="primary" busy={busy} onClick={() => install(true)}>
                <Icon.Download /> Update and restart
              </Button>
              <Button
                busy={busy}
                title="Pull and build now, and restart ASMS yourself later"
                onClick={() => install(false)}
              >
                Update only
              </Button>
            </div>
          ) : status && !status.blocker && !done ? (
            <Button size="sm" variant="ghost" busy={busy} onClick={restartOnly} title="Restart ASMS. Your ARK servers keep running.">
              <Icon.Restart size={14} /> Restart ASMS
            </Button>
          ) : null}
        </div>

        {waiting ? (
          <Callout tone="info" title={waiting}>
            The page comes back on its own as soon as ASMS answers again. Your ARK servers are untouched — they keep running
            through this, and ASMS reattaches to them when it returns.
          </Callout>
        ) : null}

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

        {done && !waiting ? (
          <Callout
            tone={done.ok ? 'ok' : done.restartRequired ? 'warn' : 'danger'}
            title={done.ok ? (done.restarting ? 'Updated' : 'Updated — restart to finish') : 'Update did not complete'}
          >
            {done.message} {done.restartRequired && !done.restarting ? 'Your ARK servers keep running while ASMS restarts.' : ''}
          </Callout>
        ) : null}
      </div>
    </div>
  );
}
