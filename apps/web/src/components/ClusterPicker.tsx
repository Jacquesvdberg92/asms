import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { Field } from './ui';
import { Icon } from './Icons';
import { ClusterIdInput } from './ClusterIdInput';
import { randomClusterId } from '../lib/cluster';

/**
 * Joining and leaving a cluster, in the language people actually use.
 *
 * A cluster is only a shared string, and getting it subtly wrong is the classic
 * way to end up with two clusters that look like one - so the ones that already
 * exist are offered as buttons and typing is the fallback, not the default.
 * Standalone is a button too, because "clear this box" is not a thing anybody
 * guesses is how you leave.
 *
 * Shared between the new-server wizard and a server's own settings, so neither
 * can quietly go back to being a text field somebody has to retype an ID into.
 */
export function ClusterPicker({
  value,
  onChange,
  label = 'Connect to your other servers?',
  help = 'Servers sharing a cluster ID share an upload/download bank — walk into an obelisk on one map and pop out on another.',
  selfId,
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  help?: string;
  /** The server being edited, so it is not counted as one of its own neighbours. */
  selfId?: string;
}) {
  const { servers, library } = useStore();
  const [typing, setTyping] = useState(false);

  const known = useMemo(() => {
    const counts = new Map<string, number>();
    for (const server of servers) {
      const id = server.clusterId.trim();
      if (!id || server.id === selfId) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    // The one being edited still belongs on the list even if it is the only
    // member - otherwise the button for the cluster you are in is missing.
    if (value.trim() && !counts.has(value.trim())) counts.set(value.trim(), 0);
    for (const cluster of library.clusters) if (!counts.has(cluster.id)) counts.set(cluster.id, 0);
    return [...counts.entries()]
      .map(([id, others]) => ({ id, others, name: library.clusters.find((c) => c.id === id)?.name ?? '' }))
      .sort((a, b) => b.others - a.others || a.id.localeCompare(b.id));
  }, [servers, library.clusters, selfId, value]);

  const joined = known.find((c) => c.id === value.trim());

  return (
    <Field label={label} help={help}>
      {known.length ? (
        <div className="row row-wrap" style={{ gap: 6, marginBottom: 8 }}>
          <button
            className={`btn btn-sm ${!value.trim() ? 'btn-primary' : ''}`}
            type="button"
            title="Not in a cluster - nothing transfers in or out"
            onClick={() => {
              onChange('');
              setTyping(false);
            }}
          >
            Standalone
          </button>
          {known.map((cluster) => (
            <button
              key={cluster.id}
              className={`btn btn-sm ${value.trim() === cluster.id ? 'btn-primary' : ''}`}
              type="button"
              title={cluster.name || undefined}
              onClick={() => {
                onChange(cluster.id);
                setTyping(false);
              }}
            >
              <span className="mono">{cluster.id}</span>
              <span className="tiny faint" style={{ marginLeft: 6 }}>
                {cluster.others ? `${cluster.others} server${cluster.others === 1 ? '' : 's'}` : 'unused'}
              </span>
            </button>
          ))}
          <button
            className={`btn btn-sm ${typing ? 'btn-primary' : ''}`}
            type="button"
            onClick={() => {
              setTyping(true);
              onChange(randomClusterId());
            }}
          >
            <Icon.Plus size={13} /> New cluster
          </button>
        </div>
      ) : null}

      {typing || !known.length ? <ClusterIdInput value={value} onChange={onChange} autoFocus={typing} /> : null}

      <span className="tiny faint">
        {joined && joined.others
          ? `Shares ${joined.id} with ${joined.others} other server${joined.others === 1 ? '' : 's'}. Every one of them needs a restart before transfers work.`
          : value.trim()
            ? `Cluster ${value.trim()} — give the same ID to another server to link them.`
            : 'Standalone: nothing transfers in or out.'}
      </span>
    </Field>
  );
}
