import { useEffect, useState } from 'react';
import { useAction, useStore } from '../../lib/store';
import { api } from '../../lib/api';
import { Button, Empty, Field, Modal, CopyButton } from '../../components/ui';
import { Icon } from '../../components/Icons';
import { Help } from '../../components/Tooltip';
import { hueFor } from '../../lib/format';
import type { PlayerEntry, ServerInstance, ServerRuntime } from '../../lib/types';

export default function Players({ server, runtime }: { server: ServerInstance; runtime?: ServerRuntime }) {
  const { toast } = useStore();
  const [busy, run] = useAction();
  const [players, setPlayers] = useState<PlayerEntry[]>(runtime?.playerList ?? []);
  const [target, setTarget] = useState<PlayerEntry | null>(null);
  const [manualId, setManualId] = useState('');

  useEffect(() => {
    setPlayers(runtime?.playerList ?? []);
  }, [runtime?.playerList]);

  const refresh = () =>
    void run(async () => {
      const res = await api.get<{ players: PlayerEntry[] }>(`/servers/${server.id}/players`);
      setPlayers(res.players);
    });

  const act = (action: string, playerId: string, message?: string) =>
    void run(async () => {
      const res = await api.post<{ response: string }>(`/servers/${server.id}/players/action`, { action, playerId, message });
      toast('success', `${action} sent`, res.response.trim() || 'The server accepted the command.');
      setTarget(null);
    });

  const live = runtime?.state === 'running';

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <Icon.Users />
          <h3>Online now</h3>
          <Help
            title="Where this comes from"
            body="ASMS asks the server over RCON every 20 seconds. An empty list while people are clearly playing means RCON has dropped - check the Overview tab."
          />
          <span className="badge">{players.length}/{server.maxPlayers}</span>
          <div className="spacer" />
          <Button size="sm" busy={busy} disabled={!live} onClick={refresh}>
            <Icon.Refresh size={14} /> Refresh
          </Button>
        </div>
        {players.length === 0 ? (
          <Empty
            icon={live ? '🏝️' : '💤'}
            title={live ? 'Nobody is on' : 'Server is not running'}
            body={
              live
                ? 'The player list refreshes automatically every 20 seconds while the server is up.'
                : 'Start the server to see who is connected.'
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 46 }}>#</th>
                  <th>Player</th>
                  <th>Platform ID</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.id || p.slot}>
                    <td className="num faint">{p.slot}</td>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <span
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 99,
                            background: `hsl(${hueFor(p.name)} 60% 30%)`,
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {p.name.slice(0, 1).toUpperCase()}
                        </span>
                        {p.name}
                      </span>
                    </td>
                    <td className="mono small faint">
                      <span className="row" style={{ gap: 4 }}>
                        {p.id}
                        <CopyButton text={p.id} label="" />
                      </span>
                    </td>
                    <td className="right">
                      <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
                        <Button size="sm" onClick={() => setTarget(p)}>
                          Message
                        </Button>
                        <Button size="sm" onClick={() => act('kick', p.id)}>
                          Kick
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => act('ban', p.id)}>
                          Ban
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <Icon.Shield />
          <h3>Act on a platform ID</h3>
        </div>
        <div className="card-body stack">
          <Field label="Platform ID" help="Ban, unban or whitelist someone who is not currently connected.">
            <input className="input input-mono" value={manualId} onChange={(e) => setManualId(e.target.value)} placeholder="0002abc123def456" />
          </Field>
          <div className="btn-group">
            <Button disabled={!live || !manualId.trim()} onClick={() => act('ban', manualId.trim())}>
              Ban
            </Button>
            <Button disabled={!live || !manualId.trim()} onClick={() => act('unban', manualId.trim())}>
              Unban
            </Button>
            <Button disabled={!live || !manualId.trim()} onClick={() => act('whitelist', manualId.trim())}>
              Whitelist
            </Button>
            <Button disabled={!live || !manualId.trim()} onClick={() => act('unwhitelist', manualId.trim())}>
              Remove from whitelist
            </Button>
          </div>
          <span className="tiny faint">
            The whitelist only gates joining when the <span className="mono">-exclusivejoin</span> launch flag is on (Settings → Server &amp; launch).
          </span>
        </div>
      </div>

      {target ? <MessageModal player={target} onClose={() => setTarget(null)} onSend={(msg) => act('message', target.id, msg)} /> : null}
    </div>
  );
}

function MessageModal({ player, onClose, onSend }: { player: PlayerEntry; onClose: () => void; onSend: (message: string) => void }) {
  const [message, setMessage] = useState('');
  return (
    <Modal
      title={`Message ${player.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!message.trim()} onClick={() => onSend(message)}>
            Send
          </Button>
        </>
      }
    >
      <Field label="Private message" help="Delivered in their chat window only.">
        <input className="input" autoFocus value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
    </Modal>
  );
}
