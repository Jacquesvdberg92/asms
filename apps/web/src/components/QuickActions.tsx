import { useState } from 'react';
import { useAction } from '../lib/store';
import { api } from '../lib/api';
import { Button, Callout, Confirm, Field, Modal } from './ui';
import { Icon } from './Icons';
import { Help, Tooltip } from './Tooltip';
import type { ServerInstance, ServerRuntime } from '../lib/types';

/**
 * The handful of admin commands that get typed over and over: push the clock
 * somewhere useful, clear the map, save before touching anything. They are all
 * plain RCON — nothing here you could not type on the Console tab — but
 * spelling DestroyWildDinos correctly at 2am is not the interesting part of
 * running a server.
 */

/** ARK takes SetTimeOfDay as hh:mm:ss on a 24 hour clock. */
export const TIME_PRESETS = [
  { label: 'Dawn', time: '05:30:00' },
  { label: 'Morning', time: '08:30:00' },
  { label: 'Noon', time: '12:00:00' },
  { label: 'Dusk', time: '17:45:00' },
  { label: 'Night', time: '22:00:00' },
];

/** RCON only answers while the server is up — ARK opens the port at boot. */
export function rconReady(server: ServerInstance, runtime?: ServerRuntime): boolean {
  return server.rconEnabled && runtime?.state === 'running';
}

/**
 * One command in flight at a time, with the reply kept so the card can show
 * what came back. ARK answers most of these with silence, which reads as a
 * failure unless something says otherwise.
 */
export function useQuickActions(serverId: string) {
  const [, run] = useAction();
  const [pending, setPending] = useState<string | null>(null);
  const [reply, setReply] = useState<{ cmd: string; text: string } | null>(null);

  const send = async (command: string, successMessage?: string) => {
    setPending(command);
    const res = await run(() => api.post<{ response: string }>(`/servers/${serverId}/rcon`, { command }), successMessage);
    setPending(null);
    if (res) setReply({ cmd: command, text: res.response.trim() || '(no reply — ARK stays quiet on most of these)' });
  };

  return { send, pending, reply };
}

// ------------------------------------------------------------- the full card

export default function QuickActions({ server, runtime }: { server: ServerInstance; runtime?: ServerRuntime }) {
  const { send, pending, reply } = useQuickActions(server.id);
  const [, run] = useAction();
  const [confirm, setConfirm] = useState<null | 'wild' | 'tamed' | 'class'>(null);
  const [customTime, setCustomTime] = useState('12:00');
  const [className, setClassName] = useState('');
  const [message, setMessage] = useState('');
  const ready = rconReady(server, runtime);

  const broadcast = () => {
    if (!message.trim()) return;
    void run(() => api.post(`/servers/${server.id}/broadcast`, { message }), 'Broadcast sent');
    setMessage('');
  };

  return (
    <div className="card">
      <div className="card-head">
        <Icon.Bolt />
        <h3>Quick actions</h3>
        <Help
          title="The commands admins actually repeat"
          body="Every button here sends one RCON command to this server — the same ones you could type on the Console tab. Nothing is queued: they take effect the moment you press them."
        />
      </div>

      {!ready ? (
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <Callout tone="info" title="These need a live RCON connection">
            {!server.rconEnabled
              ? 'RCON is disabled on this server. Turn it on under Settings → Server & launch, then restart — ARK only opens the RCON port at boot.'
              : 'Start the server and give it a minute to finish loading the map, and these wake up.'}
          </Callout>
        </div>
      ) : null}

      <div className="card-body stack">
        <div className="stack" style={{ gap: 8 }}>
          <span className="stat-label">World</span>
          <div className="btn-group">
            <Tooltip title="Write the save to disk now" body="Worth doing before a wipe, a settings change, or anything you might want back.">
              <Button size="sm" disabled={!ready} busy={pending === 'SaveWorld'} onClick={() => void send('SaveWorld', 'World saved')}>
                <Icon.Save size={14} /> Save world
              </Button>
            </Tooltip>
            <Button size="sm" disabled={!ready} busy={pending === 'ListPlayers'} onClick={() => void send('ListPlayers')}>
              <Icon.Users size={14} /> List players
            </Button>
            <Button size="sm" disabled={!ready} busy={pending === 'GetServerInfo'} onClick={() => void send('GetServerInfo')}>
              <Icon.Info size={14} /> Server info
            </Button>
            <Button size="sm" disabled={!ready} busy={pending === 'ShowMessageOfTheDay'} onClick={() => void send('ShowMessageOfTheDay')}>
              Show MOTD
            </Button>
          </div>
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="stat-label">Time of day</span>
            <Help
              title="Jumps the in-game clock"
              body="The clock keeps running from wherever you drop it, so night still follows dusk. Handy for a building session, a boss fight, or dragging everyone out of a dark cave."
            />
          </div>
          <div className="row row-wrap" style={{ gap: 6 }}>
            <div className="btn-group">
              {TIME_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  size="sm"
                  disabled={!ready}
                  busy={pending === `SetTimeOfDay ${preset.time}`}
                  onClick={() => void send(`SetTimeOfDay ${preset.time}`, `Clock set to ${preset.label.toLowerCase()}`)}
                >
                  {preset.label} <span className="faint">{preset.time.slice(0, 5)}</span>
                </Button>
              ))}
            </div>
            <div className="spacer" />
            <div className="input-group" style={{ width: 190 }}>
              <input
                className="input input-mono"
                type="time"
                value={customTime}
                disabled={!ready}
                onChange={(e) => setCustomTime(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!ready || !customTime}
                busy={pending === `SetTimeOfDay ${customTime}:00`}
                onClick={() => void send(`SetTimeOfDay ${customTime}:00`, `Clock set to ${customTime}`)}
              >
                Set
              </Button>
            </div>
          </div>
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <span className="stat-label">Announce</span>
          <div className="input-group">
            <input
              className="input"
              value={message}
              disabled={!ready}
              placeholder="Restarting in 10 minutes — find a safe spot!"
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && broadcast()}
            />
            <Button disabled={!ready || !message.trim()} onClick={broadcast}>
              Broadcast
            </Button>
          </div>
          <span className="tiny faint">Shows as a large centre-screen message to everyone on the server.</span>
        </div>

        <div className="divider" />

        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="stat-label">Wipes</span>
            <Help
              title="There is no undo"
              body="Save the world first if you want a way back. A wild wipe is routine — it is how you clear a map choked with low-level spawns, or make a new mod's creatures appear. The other two are not."
            />
          </div>
          <div className="btn-group">
            <Tooltip
              title="Wild creatures only"
              body="Tames are untouched. The map repopulates over the next few minutes and can stutter while it does, so avoid it at peak time."
            >
              <Button size="sm" variant="danger" disabled={!ready} busy={pending === 'DestroyWildDinos'} onClick={() => setConfirm('wild')}>
                <Icon.Trash size={14} /> Wipe wild creatures
              </Button>
            </Tooltip>
            <Tooltip title="Every tame on the map" body="Every player's tames, everywhere, gone. Usually only wanted on a fresh season or a creative server.">
              <Button size="sm" variant="danger" disabled={!ready} busy={pending === 'DestroyAllTamedDinos'} onClick={() => setConfirm('tamed')}>
                <Icon.Trash size={14} /> Wipe all tames
              </Button>
            </Tooltip>
            <Button size="sm" variant="ghost" disabled={!ready} onClick={() => setConfirm('class')}>
              Wipe one species…
            </Button>
          </div>
        </div>

        {reply ? (
          <div className="stack" style={{ gap: 6 }}>
            <span className="stat-label">Last reply</span>
            <div className="console" style={{ maxHeight: 140, minHeight: 0, height: 'auto' }}>
              <div className="console-line echo">&gt;&gt;&gt; {reply.cmd}</div>
              {reply.text.split(/\r?\n/).map((line, i) => (
                <div key={i} className="console-line">
                  {line}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {confirm === 'wild' ? (
        <Confirm
          title="Wipe every wild creature?"
          danger
          confirmLabel="Wipe wild creatures"
          onClose={() => setConfirm(null)}
          body={
            <p>
              Tamed creatures are left alone. The map repopulates itself over the next few minutes with fresh levels and
              species — which is exactly why you would do this after changing spawn settings or adding a creature mod.
            </p>
          }
          onConfirm={() => void send('DestroyWildDinos', 'Wild creatures wiped — repopulating')}
        />
      ) : null}

      {confirm === 'tamed' ? (
        <Confirm
          title="Wipe every tamed creature?"
          danger
          confirmLabel="Wipe all tames"
          requireText={server.name}
          onClose={() => setConfirm(null)}
          body={
            <p>
              This destroys every tame belonging to every tribe on {server.name}. There is no undo short of restoring a
              backup — take one from the Backups tab first if you are not certain.
            </p>
          }
          onConfirm={() => void send('DestroyAllTamedDinos', 'Every tame destroyed')}
        />
      ) : null}

      {confirm === 'class' ? (
        <Modal
          title="Wipe one species"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={!className.trim()}
                onClick={() => {
                  void send(`DestroyAll ${className.trim()}`, `Destroyed every ${className.trim()}`);
                  setConfirm(null);
                }}
              >
                Destroy them all
              </Button>
            </>
          }
        >
          <Field
            label="Class name"
            help="DestroyAll takes ARK's internal class name and removes every one of them — wild and tamed alike. The ARK wiki and Dododex list them; they almost always end in _Character_BP_C."
          >
            <input
              className="input input-mono"
              autoFocus
              value={className}
              placeholder="Dodo_Character_BP_C"
              onChange={(e) => setClassName(e.target.value)}
            />
          </Field>
        </Modal>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------- the dashboard strip

/**
 * Four of the same actions, sized for a dashboard card. It renders only while
 * RCON is actually answering — a row of dead buttons under a stopped server is
 * worse than no row at all.
 */
export function QuickActionsRow({ server, runtime }: { server: ServerInstance; runtime?: ServerRuntime }) {
  const { send, pending } = useQuickActions(server.id);
  const [, run] = useAction();
  const [dialog, setDialog] = useState<null | 'time' | 'say' | 'wild'>(null);
  const [message, setMessage] = useState('');

  if (!rconReady(server, runtime)) return null;

  const broadcast = () => {
    if (!message.trim()) return;
    void run(() => api.post(`/servers/${server.id}/broadcast`, { message }), 'Broadcast sent');
    setMessage('');
    setDialog(null);
  };

  return (
    <>
      <div className="row row-wrap" style={{ gap: 6 }}>
        <span className="stat-label" style={{ marginRight: 2 }}>
          Quick
        </span>
        <Tooltip title="Save the world now" body="Writes the save to disk. Worth a click before anything you might regret.">
          <Button size="sm" variant="ghost" busy={pending === 'SaveWorld'} onClick={() => void send('SaveWorld', 'World saved')}>
            <Icon.Save size={14} /> Save
          </Button>
        </Tooltip>
        <Tooltip title="Message everyone" body="Big centre-screen broadcast to every player on this server.">
          <Button size="sm" variant="ghost" onClick={() => setDialog('say')}>
            <Icon.Users size={14} /> Say
          </Button>
        </Tooltip>
        <Tooltip title="Move the in-game clock" body="Jump to dawn, noon, dusk or night. The clock carries on from there.">
          <Button size="sm" variant="ghost" onClick={() => setDialog('time')}>
            <Icon.Clock size={14} /> Time
          </Button>
        </Tooltip>
        <Tooltip title="Wipe wild creatures" body="Tames are untouched. The map repopulates over the next few minutes.">
          <Button size="sm" variant="ghost" busy={pending === 'DestroyWildDinos'} onClick={() => setDialog('wild')}>
            <Icon.Trash size={14} /> Wipe wild
          </Button>
        </Tooltip>
      </div>

      {dialog === 'time' ? (
        <Modal
          title={`Set the clock on ${server.name}`}
          onClose={() => setDialog(null)}
          footer={
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Close
            </Button>
          }
        >
          <div className="stack">
            <p className="dim">Jumps the in-game clock. It keeps running from wherever you drop it.</p>
            <div className="btn-group">
              {TIME_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  onClick={() => {
                    void send(`SetTimeOfDay ${preset.time}`, `Clock set to ${preset.label.toLowerCase()}`);
                    setDialog(null);
                  }}
                >
                  {preset.label} <span className="faint">{preset.time.slice(0, 5)}</span>
                </Button>
              ))}
            </div>
          </div>
        </Modal>
      ) : null}

      {dialog === 'say' ? (
        <Modal
          title={`Broadcast to ${server.name}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!message.trim()} onClick={broadcast}>
                Send
              </Button>
            </>
          }
        >
          <Field label="Message" help="Shows as a large centre-screen message to everyone on the server.">
            <input
              className="input"
              autoFocus
              value={message}
              placeholder="Restarting in 10 minutes — find a safe spot!"
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && broadcast()}
            />
          </Field>
        </Modal>
      ) : null}

      {dialog === 'wild' ? (
        <Confirm
          title={`Wipe every wild creature on ${server.name}?`}
          danger
          confirmLabel="Wipe wild creatures"
          onClose={() => setDialog(null)}
          body={
            <p>
              Tamed creatures are left alone. The map repopulates over the next few minutes and can stutter while it does, so
              it is worth avoiding at peak time.
            </p>
          }
          onConfirm={() => void send('DestroyWildDinos', 'Wild creatures wiped — repopulating')}
        />
      ) : null}
    </>
  );
}
