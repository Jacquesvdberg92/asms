import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, useAction } from '../lib/store';
import { api } from '../lib/api';
import { TopBar } from '../components/Shell';
import { Button, Confirm, Empty, Field, Modal, StateBadge, Badge } from '../components/ui';
import { Icon } from '../components/Icons';
import { ClusterIdInput } from '../components/ClusterIdInput';
import { hueFor } from '../lib/format';

export default function Clusters() {
  const { servers, runtimes, settings } = useStore();
  const [busy, run] = useAction();
  const [assigning, setAssigning] = useState(false);
  const [leaving, setLeaving] = useState<{ ids: string[]; label: string } | null>(null);

  const clusters = useMemo(() => {
    const map = new Map<string, typeof servers>();
    for (const server of servers) {
      if (!server.clusterId.trim()) continue;
      map.set(server.clusterId, [...(map.get(server.clusterId) ?? []), server]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [servers]);

  const standalone = servers.filter((s) => !s.clusterId.trim());

  /**
   * Every failure here used to be swallowed and the toast still said the
   * command was sent, so a cluster that ignored "Stop all" looked exactly like
   * one that obeyed. Name what refused instead.
   */
  const bulk = (ids: string[], action: 'start' | 'stop' | 'restart') =>
    void run(async () => {
      const failed: string[] = [];
      for (const id of ids) {
        try {
          await api.post(`/servers/${id}/${action}`);
        } catch (err) {
          const name = servers.find((s) => s.id === id)?.name ?? id;
          failed.push(`${name} - ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (!failed.length) return;
      throw new Error(
        failed.length === ids.length
          ? failed.join('; ')
          : `${ids.length - failed.length} of ${ids.length} took it. ${failed.join('; ')}`,
      );
    }, `${action} sent to ${ids.length} server${ids.length === 1 ? '' : 's'}`);

  /**
   * Joining a cluster was a button; leaving it meant knowing the ID lived on
   * each server's own settings page and clearing it there by hand.
   */
  const leave = (ids: string[]) =>
    void run(
      async () => {
        for (const id of ids) await api.patch(`/servers/${id}`, { clusterId: '', clusterDir: '' });
      },
      ids.length > 1
        ? 'Cluster disbanded - restart those servers to apply'
        : 'Taken out of the cluster - restart that server to apply',
    );

  return (
    <>
      <TopBar
        title="Clusters"
        sub="Servers sharing a cluster ID let players and dinos transfer between maps"
        actions={
          <Button variant="primary" onClick={() => setAssigning(true)}>
            <Icon.Cluster /> Assign servers
          </Button>
        }
      />
      <div className="content stack">
        {clusters.length === 0 ? (
          <div className="card">
            <Empty
              icon="🔗"
              title="No clusters yet"
              body="Give two or more servers the same cluster ID and they share an upload/download bank — walk into an obelisk on The Island and pop out on Ragnarok."
              action={
                <Button variant="primary" onClick={() => setAssigning(true)}>
                  Assign servers to a cluster
                </Button>
              }
            />
          </div>
        ) : (
          clusters.map(([id, members]) => {
            const hue = hueFor(id);
            const running = members.filter((m) => runtimes[m.id]?.state === 'running').length;
            return (
              <div className="card" key={id}>
                <div className="card-head">
                  <span className="dot" style={{ background: `hsl(${hue} 70% 55%)` }} />
                  <h3 className="mono">{id}</h3>
                  <Badge tone={running === members.length ? 'ok' : running ? 'warn' : undefined}>
                    {running}/{members.length} running
                  </Badge>
                  <div className="spacer" />
                  <div className="btn-group">
                    <Button size="sm" busy={busy} onClick={() => bulk(members.map((m) => m.id), 'start')}>
                      <Icon.Play size={13} /> Start all
                    </Button>
                    <Button size="sm" busy={busy} onClick={() => bulk(members.map((m) => m.id), 'restart')}>
                      <Icon.Restart size={13} /> Restart all
                    </Button>
                    <Button size="sm" variant="danger" busy={busy} onClick={() => bulk(members.map((m) => m.id), 'stop')}>
                      <Icon.Stop size={13} /> Stop all
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      busy={busy}
                      title="Take every server out of this cluster"
                      onClick={() => setLeaving({ ids: members.map((m) => m.id), label: id })}
                    >
                      <Icon.Cluster size={13} /> Disband
                    </Button>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Server</th>
                        <th>Map</th>
                        <th>Port</th>
                        <th>Players</th>
                        <th>State</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((member) => (
                        <tr key={member.id}>
                          <td>
                            <Link to={`/servers/${member.id}`} className="strong">
                              {member.name}
                            </Link>
                          </td>
                          <td className="dim">{member.map}</td>
                          <td className="num dim">{member.port}</td>
                          <td className="num">
                            {runtimes[member.id]?.players ?? 0}/{member.maxPlayers}
                          </td>
                          <td>
                            <StateBadge state={runtimes[member.id]?.state ?? 'stopped'} />
                          </td>
                          <td>
                            <Button
                              size="sm"
                              variant="ghost"
                              busy={busy}
                              title={`Take ${member.name} out of this cluster`}
                              onClick={() => setLeaving({ ids: [member.id], label: member.name })}
                            >
                              Remove
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card-foot">
                  <span className="card-hint mono truncate">
                    {members[0].clusterDir || `${settings?.clusterRoot ?? ''}\\${id}`}
                  </span>
                </div>
              </div>
            );
          })
        )}

        {standalone.length ? (
          <div className="card">
            <div className="card-head">
              <Icon.Server />
              <h3>Standalone servers</h3>
              <span className="badge">{standalone.length}</span>
            </div>
            <div className="card-body row row-wrap">
              {standalone.map((server) => (
                <Link key={server.id} to={`/servers/${server.id}/settings`} className="chip">
                  {server.name} · {server.map}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {assigning ? <AssignModal onClose={() => setAssigning(false)} /> : null}
      {leaving ? (
        <Confirm
          title={leaving.ids.length > 1 ? 'Disband this cluster?' : `Take ${leaving.label} out of the cluster?`}
          danger
          confirmLabel={leaving.ids.length > 1 ? 'Disband' : 'Remove'}
          body={
            <>
              <p>
                {leaving.ids.length > 1
                  ? 'Every server here goes back to standalone. '
                  : `${leaving.label} goes back to standalone. `}
                The transfer bank on disk is left where it is, but anything sitting in it has nowhere to come
                back to until the cluster ID goes on again.
              </p>
              <p className="small faint">
                Takes effect on the next restart of {leaving.ids.length > 1 ? 'those servers' : 'that server'}.
              </p>
            </>
          }
          onConfirm={() => leave(leaving.ids)}
          onClose={() => setLeaving(null)}
        />
      ) : null}
    </>
  );
}

function AssignModal({ onClose }: { onClose: () => void }) {
  const { servers } = useStore();
  const [busy, run] = useAction();
  const [clusterId, setClusterId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (id: string) => setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  return (
    <Modal
      title="Assign servers to a cluster"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!clusterId.trim() || !picked.length}
            onClick={() =>
              void run(async () => {
                for (const id of picked) await api.patch(`/servers/${id}`, { clusterId: clusterId.trim() });
                onClose();
              }, 'Cluster assigned — restart the servers to apply')
            }
          >
            Assign {picked.length || ''}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Cluster ID" help="Every server in the cluster must use exactly the same one.">
          <ClusterIdInput value={clusterId} onChange={setClusterId} autoFocus placeholder="ark-…" />
        </Field>
        <Field label="Servers">
          <div className="stack" style={{ gap: 6 }}>
            {servers.map((server) => (
              <label key={server.id} className="row" style={{ gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.includes(server.id)} onChange={() => toggle(server.id)} />
                <span className="strong">{server.name}</span>
                <span className="small faint">{server.map}</span>
                {server.clusterId ? <Badge>currently {server.clusterId}</Badge> : null}
              </label>
            ))}
          </div>
        </Field>
        <p className="small faint">
          ASMS also passes <span className="mono">-NoTransferFromFiltering</span> if you enable it per server under Settings → Server &amp;
          launch, which allows uploads from any server in the cluster.
        </p>
      </div>
    </Modal>
  );
}
