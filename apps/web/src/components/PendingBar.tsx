import { useAction } from '../lib/store';
import { api } from '../lib/api';
import { Button } from './ui';
import { Icon } from './Icons';
import type { ServerRuntime } from '../lib/types';

/**
 * Shown whenever something long-running is under way that the user is allowed
 * to call off — a SteamCMD download, or a restart countdown ticking towards
 * kicking everyone off.
 */
export default function PendingBar({ serverId, runtime }: { serverId: string; runtime?: ServerRuntime }) {
  const [busy, run] = useAction();
  const pending = runtime?.pending;
  if (!pending) return null;

  const countdown = pending.kind === 'countdown';
  const progress = runtime?.progress ?? null;

  return (
    <div className="card card-pad stack" style={{ gap: 10, borderColor: countdown ? 'var(--warn)' : 'var(--accent-line)' }}>
      <div className="row row-wrap">
        {countdown ? <Icon.Clock className="dim" /> : <span className="spinner" />}
        <span className="strong">{pending.label}</span>
        {runtime?.progressText ? <span className="small faint">{runtime.progressText}</span> : null}
        <div className="spacer" />
        <Button
          size="sm"
          variant="danger"
          busy={busy}
          onClick={() => void run(() => api.post(`/servers/${serverId}/cancel`), countdown ? 'Countdown cancelled' : 'Stopped SteamCMD')}
        >
          <Icon.X size={13} /> Cancel
        </Button>
      </div>
      {!countdown ? (
        <div className={`progress ${progress ? '' : 'indeterminate'}`}>
          <span style={{ width: `${progress ?? 30}%` }} />
        </div>
      ) : (
        <div className="small faint">Players are being warned in game. Cancelling tells them it is off.</div>
      )}
    </div>
  );
}
