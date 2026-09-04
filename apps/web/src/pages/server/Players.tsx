import { useEffect, useState } from 'react';
import { useAction, useStore } from '../../lib/store';
import { api } from '../../lib/api';
import { Button, Callout, Empty, Field, Modal, CopyButton } from '../../components/ui';
import { Icon } from '../../components/Icons';
import { Help } from '../../components/Tooltip';
import { hueFor } from '../../lib/format';
import type { PlayerEntry, ServerInstance, ServerRuntime } from '../../lib/types';

export default function Players({ server, runtime }: { server: ServerInstance; runtime?: ServerRuntime }) {
  const { toast } = useStore();
  const [busy, run] = useAction();
  const [players, setPlayers] = useState<PlayerEntry[]>(runtime?.playerList ?? []);
  const [target, setTarget] = useState<PlayerEntry | null>(null);
  const [admin, setAdmin] = useState<PlayerEntry | null>(null);
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
                        <Button size="sm" onClick={() => setAdmin(p)}>
                          Admin
                        </Button>
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
      {admin ? <AdminModal server={server} player={admin} onClose={() => setAdmin(null)} /> : null}
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

/**
 * Ascended has no command that makes an account an admin, and it is worth
 * saying why rather than shipping a button that quietly does nothing.
 *
 * Checked against the shipped ArkAscendedServer.exe, ASCII and UTF-16: the
 * only AddAdmin/RemoveAdmin strings in it belong to ServerAddAdminPlayer on
 * the console-hosted server's own UI, not to RCON. Evolved's
 * AllowedCheaterSteamIDs.txt is gone too - the only id list files the binary
 * knows are PlayersJoinNoCheckList.txt, PlayersExclusiveJoinList.txt and
 * BanList.txt. Admin hangs entirely off ServerAdminPassword and the player
 * typing enablecheats into their own console.
 *
 * So this offers the two things that do work, and is clear about the
 * difference: hand over the password for real admin, or grant creative mode
 * over RCON for most of the powers and none of the keys.
 */
function AdminModal({ server, player, onClose }: { server: ServerInstance; player: PlayerEntry; onClose: () => void }) {
  const { toast } = useStore();
  const [busy, run] = useAction();
  const [arkId, setArkId] = useState<string | null>(null);
  const [looked, setLooked] = useState(false);
  const [manual, setManual] = useState('');

  // Creative mode is aimed with the numeric Player ID, the same id the Spawn
  // tab needs and the same place it comes from: the server's own log.
  useEffect(() => {
    let live = true;
    api
      .post<{ ue4Id: string | null }>(`/servers/${server.id}/players/resolve`, { platformId: player.id })
      .then((res) => live && (setArkId(res.ue4Id), setLooked(true)))
      .catch(() => live && setLooked(true));
    return () => {
      live = false;
    };
  }, [server.id, player.id]);

  const line = `enablecheats ${server.adminPassword}`;

  const sendPassword = () =>
    void run(
      () =>
        api.post<{ response: string }>(`/servers/${server.id}/players/action`, {
          action: 'message',
          playerId: player.id,
          message: line,
        }),
      `Sent to ${player.name}`,
    );

  const grantCreative = (id: string) =>
    void run(
      () =>
        api.post<{ response: string }>(`/servers/${server.id}/players/action`, { action: 'creative', playerId: id }),
      `Creative mode toggled for ${player.name}`,
    );

  const applyTyped = () => {
    const id = manual.trim();
    if (!/^\d{6,12}$/.test(id)) {
      toast(
        'warn',
        'That is not the id this command takes',
        `GiveCreativeModeToPlayer wants the numeric Player ID - nine or ten digits, like 194756294. "${id}" is not that. The long id with letters in it is the EOS one off the player list, and this command will not take it.`,
      );
      return;
    }
    setArkId(id);
    grantCreative(id);
  };

  return (
    <Modal
      title={`Admin for ${player.name}`}
      wide
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="stack">
        <Callout tone="info" title="Ascended has no command that promotes an account">
          <p>
            Admin is one shared password, not a list of people. A player becomes an admin by typing{' '}
            <span className="mono">enablecheats</span> into their own console, and stays one until they disconnect.
            There is no RCON command for it and no file of admin ids on the server, so the two ways below are the
            whole of it.
          </p>
        </Callout>

        <div className="stack" style={{ gap: 8 }}>
          <span className="stat-label">Full admin — give them the password</span>
          <span className="tiny faint">
            Everything: spawning, destroying, flying, other people's tribes, and the same password RCON logs in with.
            Only hand it to someone you would trust with this whole server.
          </span>
          <div className="row row-wrap" style={{ gap: 6 }}>
            <span className="mono small" style={{ userSelect: 'all' }}>
              {line}
            </span>
            <CopyButton text={line} label="Copy the line" />
            <Button size="sm" busy={busy} onClick={sendPassword}>
              Send it to them in game
            </Button>
          </div>
          <span className="tiny faint">
            Sending it puts the password in their chat window, where anything reading chat — the game log,{' '}
            <span className="mono">GetChat</span> over RCON, a Discord bridge, their own stream — sees it too. Taking it
            back later means changing the password in Settings → Server &amp; launch and restarting, which locks out
            every other admin at the same time.
          </span>
        </div>

        <div className="divider" />

        <div className="stack" style={{ gap: 8 }}>
          <span className="stat-label">Creative mode — the powers without the password</span>
          <span className="tiny faint">
            Flight, no clip, infinite resources and an unlimited inventory for this one player.{' '}
            <span className="mono">GiveCreativeModeToPlayer</span> is a toggle: run it again to take it back. They stay
            an ordinary player otherwise — no console, no commands of their own.
          </span>
          {arkId ? (
            <div className="row row-wrap" style={{ gap: 6 }}>
              <Button variant="primary" busy={busy} onClick={() => grantCreative(arkId)}>
                Toggle creative mode
              </Button>
              <span className="tiny faint mono">Player ID {arkId}</span>
            </div>
          ) : looked ? (
            <>
              <Callout tone="warn" title={`ASMS has not seen ${player.name}'s Player ID yet`}>
                <p>
                  This command is aimed with the numeric Player ID, not the EOS id on the player list, and Ascended has
                  no command that converts one to the other. ASMS reads the number out of the server's own log, which
                  writes both ids on one line — but only when somebody runs an admin command in game, and{' '}
                  {player.name} has not.
                </p>
                <p>
                  Have them run <span className="mono">cheat showadminmanager</span> once and ASMS will find it by
                  itself from then on, or read the <b>Player ID</b> off that same Admin Manager and paste it here.
                </p>
              </Callout>
              <div className="row row-wrap" style={{ gap: 6 }}>
                <div className="input-group" style={{ maxWidth: 280 }}>
                  <input
                    className="input input-mono"
                    value={manual}
                    aria-label="Player ID"
                    placeholder={`${player.name}'s Player ID`}
                    onChange={(e) => setManual(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && applyTyped()}
                  />
                </div>
                <Button busy={busy} disabled={!manual.trim()} onClick={applyTyped}>
                  Toggle creative mode
                </Button>
              </div>
            </>
          ) : (
            <span className="tiny faint">Looking up their Player ID…</span>
          )}
        </div>
      </div>
    </Modal>
  );
}
