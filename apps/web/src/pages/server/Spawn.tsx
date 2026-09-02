import { useEffect, useMemo, useState } from 'react';
import { useStore, useAction } from '../../lib/store';
import { api } from '../../lib/api';
import { Badge, Button, Callout, Confirm, CopyButton, Empty, ExternalLink, Field, Modal, SearchInput, Toggle } from '../../components/ui';
import { Icon } from '../../components/Icons';
import { Help, Tooltip } from '../../components/Tooltip';
import { rconReady } from '../../components/QuickActions';
import {
  asConsole,
  clampLevel,
  clampQuality,
  dododexUrl,
  giveSelfCommand,
  givePlayerCommand,
  givePlayerCommandPlain,
  kitCommands,
  summonCommand,
  LEVEL_PRESETS,
  type SpawnCatalog,
  type SpawnCreature,
  type SpawnItem,
  type SpawnKit,
} from '../../lib/spawn';
import type { PlayerEntry, ServerInstance, ServerRuntime } from '../../lib/types';

/**
 * A point-and-click front end for the two admin commands nobody enjoys typing:
 * GMSummon and the give family. It exists for creative servers - the ones run
 * for a child who wants a level 150 Rex and a full set of flak, and where
 * "just open the console and type this" is the wrong answer.
 *
 * The tab is honest about a split ARK forces on it. Gear has a command that
 * names its recipient (GiveItemToPlayer), so ASMS can hand it over down RCON
 * with nobody typing anything. Creatures have no such command: GMSummon places
 * the creature at whoever ran it, and an RCON session is not standing anywhere
 * on the map. So for creatures the tab writes the line out, ready to paste.
 * Both routes are always offered, and the server's reply is always shown -
 * ARK answers most of these with silence, which reads as failure otherwise.
 */

type Panel = 'creatures' | 'gear' | 'kits';

/**
 * Where a give is aimed. `null` means "whoever runs the command in game".
 *
 * `typed` marks an id someone pasted in rather than picked off the live list -
 * it is the escape hatch for a player who is not connected, so it must survive
 * the check that drops targets who have logged off.
 */
type Target = { player: PlayerEntry; ue4Id: string; typed?: boolean } | null;

export default function Spawn({ server, runtime }: { server: ServerInstance; runtime?: ServerRuntime }) {
  const { toast } = useStore();
  const [catalog, setCatalog] = useState<SpawnCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [panel, setPanel] = useState<Panel>('creatures');
  const [target, setTarget] = useState<Target>(null);
  const ready = rconReady(server, runtime);

  useEffect(() => {
    let live = true;
    void api
      .get<SpawnCatalog>('/spawn/catalog')
      .then((res) => live && setCatalog(res))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  // A target picked off the live list and then gone cannot receive anything,
  // and a stale name in the picker is worse than none. A typed id is exempt:
  // it is the way to reach someone who was never in that list.
  useEffect(() => {
    if (!target || target.typed) return;
    const stillOn = (runtime?.playerList ?? []).some((p) => p.id === target.player.id);
    if (!stillOn) setTarget(null);
  }, [runtime?.playerList, target]);

  /** One command, run over RCON, with the reply handed back for display. */
  const [, run] = useAction();
  const [reply, setReply] = useState<{ cmd: string; text: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const send = async (command: string, successMessage?: string) => {
    setPending(command);
    const res = await run(() => api.post<{ response: string }>(`/servers/${server.id}/rcon`, { command }), successMessage);
    setPending(null);
    if (res) setReply({ cmd: command, text: res.response.trim() || NO_REPLY });
  };

  const sendBatch = async (commands: string[], successMessage: string) => {
    setPending(commands[0] ?? '');
    const res = await run(
      () => api.post<{ results: BatchResult[] }>(`/servers/${server.id}/rcon/batch`, { commands }),
      successMessage,
    );
    setPending(null);
    if (!res) return;
    const failures = res.results.filter((r) => r.error);
    if (failures.length) toast('warn', `${failures.length} of ${res.results.length} did not go through`, failures[0].error);
    setReply({
      cmd: `${res.results.length} commands`,
      text: res.results.map((r) => `${r.command}\n  ${r.error ? `! ${r.error}` : r.response.trim() || NO_REPLY}`).join('\n'),
    });
  };

  if (failed) {
    return (
      <div className="card">
        <Empty
          icon="📦"
          title="The spawn catalogue did not load"
          body="ASMS could not fetch the creature and item list from its own API. Reload the page, and check the Logs tab if it keeps happening."
        />
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="card">
        <div className="card-body">
          <div className="skeleton" style={{ height: 220 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <Icon.Paw />
          <h3>Spawn</h3>
          <Help
            title="Built for creative servers"
            body="Everything here is an ordinary admin command - the same ones you could type on the Console tab. Nothing is queued: it happens the moment you press the button."
          />
          <div className="spacer" />
          <div className="segmented" role="tablist">
            {(
              [
                ['creatures', 'Creatures'],
                ['gear', 'Gear'],
                ['kits', 'Kits'],
              ] as Array<[Panel, string]>
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={panel === id} className={panel === id ? 'active' : ''} onClick={() => setPanel(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="card-body stack">
          <RouteNote ready={ready} rconEnabled={server.rconEnabled} />
          <TargetPicker

            players={runtime?.playerList ?? []}
            target={target}
            onChange={setTarget}
            ready={ready}
          />
        </div>
      </div>

      {panel === 'creatures' ? (
        <Creatures catalog={catalog} ready={ready} pending={pending} onSend={send} />
      ) : null}
      {panel === 'gear' ? (
        <Gear catalog={catalog} ready={ready} target={target} pending={pending} onSend={send} />
      ) : null}
      {panel === 'kits' ? (
        <Kits catalog={catalog} ready={ready} target={target} pending={pending} onSendBatch={sendBatch} />
      ) : null}

      {reply ? <ReplyCard reply={reply} onClear={() => setReply(null)} /> : null}

      <Credits catalog={catalog} />
    </div>
  );
}

const NO_REPLY = '(no reply — ARK stays quiet on most admin commands, which is not the same as "it worked")';

/**
 * ARK's stock answer when a command produced no output. It is not an error and
 * not a confirmation, and reading it as either is how "nothing happened" gets
 * mistaken for "the server is broken".
 */
const ARK_SILENT = /^\s*server received,\s*but no response!*\s*$/i;

interface BatchResult {
  command: string;
  response: string;
  error?: string;
}

// ------------------------------------------------------------- shared bits

/** The one thing someone has to understand before the buttons make sense. */
function RouteNote({ ready, rconEnabled }: { ready: boolean; rconEnabled: boolean }) {
  if (!ready) {
    return (
      <Callout tone="info" title="Sending needs a live RCON connection">
        {!rconEnabled
          ? 'RCON is off for this server. Turn it on under Settings → Server & launch and restart — ARK only opens the RCON port at boot. Until then the Copy buttons still work: paste the line into the in-game console.'
          : 'Start the server and let it finish loading the map. Until then the Copy buttons still work — paste the line into the in-game console.'}
      </Callout>
    );
  }
  return (
    <Callout tone="info" title="Gear can be delivered from here. Creatures have to be pasted in game.">
      Pick a player below and <span className="strong">Give</span> puts gear straight into their inventory — nobody types
      anything. Creatures are different: <span className="mono">GMSummon</span> spawns at whoever runs it, and an RCON
      session is not standing anywhere on the map, so ASMS writes the line out for you to paste into the in-game console
      instead. Press <span className="mono">Tab</span> in game, paste, Enter. You need{' '}
      <span className="mono">enablecheats</span> first if you are not the host.
    </Callout>
  );
}

/**
 * Who receives gear.
 *
 * ARK keeps two ids per player and GiveItemToPlayer takes only one of them:
 * the numeric Player ID, nine or ten digits, the one the in-game Admin Manager
 * shows. ListPlayers reports the other - a thirty-two character hex EOS id -
 * and Ascended has no RCON command that turns one into the other. GMSummon's
 * old partner GetPlayerIDForSteamID is an Evolved-era command expecting a
 * Steam id, and answers nothing here.
 *
 * So a name off the live list says who, and their Player ID has to be read out
 * of the game once and pasted. It is remembered per player while the tab is
 * open, so it is asked for once rather than before every give.
 */
function TargetPicker({
  players,
  target,
  onChange,
  ready,
}: {
  players: PlayerEntry[];
  target: Target;
  onChange: (target: Target) => void;
  ready: boolean;
}) {
  const { toast } = useStore();
  const [manual, setManual] = useState('');
  /** Player IDs supplied this session, keyed by the id ListPlayers gave. */
  const [known, setKnown] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<PlayerEntry | null>(null);

  const pick = (player: PlayerEntry) => {
    const remembered = known[player.id];
    if (remembered) {
      setAsking(null);
      onChange({ player, ue4Id: remembered });
      return;
    }
    // Nothing usable for them yet. Ask, rather than sending the EOS id and
    // letting ARK answer with silence that reads as a broken server.
    onChange(null);
    setAsking(player);
    setManual('');
  };

  const use = () => {
    const id = manual.trim();
    if (!/^\d{6,12}$/.test(id)) {
      toast(
        'warn',
        'That is not the id GiveItemToPlayer takes',
        `ARK wants the numeric Player ID — nine or ten digits, like 194756294. "${id}" is not that. A long id with letters in it is the EOS one off the player list, and this command will not take it. Open the Admin Manager in game with "cheat showadminmanager", click the player, and read the Player ID field.`,
      );
      return;
    }
    const player = asking ?? { slot: 0, name: `id ${id}`, id };
    if (asking) setKnown((prev) => ({ ...prev, [asking.id]: id }));
    onChange({ player, ue4Id: id, typed: !asking });
    setAsking(null);
    setManual('');
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 6 }}>
        <span className="stat-label">Give gear to</span>
        <Help
          title="Why a name is not enough on its own"
          body="GiveItemToPlayer takes the numeric Player ID the in-game Admin Manager shows — nine or ten digits. ListPlayers reports a thirty-two character EOS id instead, and Ascended has no RCON command that converts one to the other, so the number has to be read out of the game once. ASMS remembers it for as long as this tab is open."
        />
      </div>
      {players.length === 0 ? (
        <span className="tiny faint">
          Nobody is connected. Gear can still be built into a command below and pasted in game — pick a player once they
          are on to hand it over directly.
        </span>
      ) : (
        <div className="btn-group">
          {players.map((player) => (
            <Button
              key={player.id}
              size="sm"
              disabled={!ready}
              variant={target?.player.id === player.id ? 'primary' : asking?.id === player.id ? 'ok' : 'default'}
              onClick={() => (target?.player.id === player.id ? onChange(null) : pick(player))}
            >
              {player.name}
            </Button>
          ))}
        </div>
      )}

      {asking ? (
        <Callout tone="info" title={`${asking.name}'s Player ID, once`}>
          In game, open the Admin Manager — <span className="mono">cheat showadminmanager</span> — click {asking.name},
          and read the <b>Player ID</b> field. Nine or ten digits. Paste it below and ASMS remembers it while this tab
          is open. The long id on the player list above is their EOS id, which{' '}
          <span className="mono">GiveItemToPlayer</span> will not take.
        </Callout>
      ) : null}

      <div className="row row-wrap" style={{ gap: 6 }}>
        <div className="input-group" style={{ maxWidth: 320 }}>
          <input
            className="input input-mono"
            value={manual}
            placeholder={asking ? `${asking.name}'s Player ID` : '…or paste a Player ID'}
            aria-label="Player ID"
            /**
             * Letters are kept as typed. The old filter stripped every non-digit
             * as you pasted, which turned a thirty-two character EOS id into a
             * twenty-three digit number belonging to nobody, with nothing to
             * show that it had happened. They are refused on Use instead, where
             * there is room to say why.
             */
            onChange={(e) => setManual(e.target.value.replace(/[^0-9a-zA-Z]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && manual.length >= 4) use();
            }}
          />
          <Button size="sm" disabled={manual.length < 4} onClick={use}>
            Use
          </Button>
        </div>
        <span className="tiny faint">
          Nine or ten digits, off the Admin Manager in game — not the long id on the player list.
        </span>
      </div>

      {/* Always visible, however the target was set - a give with no visible
          recipient is how you hand a full Tek set to the wrong person. */}
      {target ? (
        <div className="row row-wrap" style={{ gap: 8 }}>
          <Badge tone="ok">Gear goes to {target.player.name}</Badge>
          <span className="tiny faint mono">Player ID {target.ue4Id}</span>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            <Icon.X size={12} /> Clear
          </Button>
        </div>
      ) : (
        <span className="tiny faint">Nobody picked — commands are written for whoever runs them in game.</span>
      )}
    </div>
  );
}

/** Whatever the server said back, verbatim. */
function ReplyCard({ reply, onClear }: { reply: { cmd: string; text: string }; onClear: () => void }) {
  return (
    <div className="card">
      <div className="card-head">
        <Icon.Terminal />
        <h3>Last reply</h3>
        <div className="spacer" />
        <Button size="sm" variant="ghost" onClick={onClear}>
          <Icon.X size={13} /> Clear
        </Button>
      </div>
      <div className="card-body">
        <div className="console" style={{ maxHeight: 200, minHeight: 0, height: 'auto' }}>
          <div className="console-line echo">&gt;&gt;&gt; {reply.cmd}</div>
          {reply.text.split(/\r?\n/).map((line, i) => (
            <div key={i} className="console-line">
              {line}
            </div>
          ))}
        </div>
        {reply.text.split(/\r?\n/).some((line) => ARK_SILENT.test(line)) ? (
          <p className="tiny faint" style={{ marginTop: 8 }}>
            <b>Server received, But no response!!</b> is ARK saying it ran the command and printed nothing. It is the
            normal answer to most admin commands — and it is also what you get when a command could not do anything,
            such as a GMSummon with nobody standing anywhere to spawn at. Every command and reply is also written to
            the <b>Console</b> tab now, so there is a record to go back to.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Visible credit, not a footnote. */
function Credits({ catalog }: { catalog: SpawnCatalog }) {
  return (
    <div className="card">
      <div className="card-head">
        <Icon.Book />
        <h3>Where these codes come from</h3>
      </div>
      <div className="card-body stack" style={{ gap: 10 }}>
        <p className="dim" style={{ fontSize: 13 }}>
          The entity ids and blueprint paths below are ARK's own — the class names Wildcard ships inside the game files,
          which is why every tool quotes the same strings. ASMS carries those identifiers and nothing else: taming times,
          food counts, stats and strategy stay where they were written.
        </p>
        {catalog.sources.map((source) => (
          <div key={source.url} className="stack" style={{ gap: 2 }}>
            <ExternalLink href={source.url} className="strong">
              {source.name}
            </ExternalLink>
            <span className="tiny faint">{source.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- creatures

function Creatures({
  catalog,
  ready,
  pending,
  onSend,
}: {
  catalog: SpawnCatalog;
  ready: boolean;
  pending: string | null;
  onSend: (command: string, successMessage?: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>('');
  const [chosen, setChosen] = useState<SpawnCreature | null>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.creatures.filter((creature) => {
      if (group && creature.group !== group) return false;
      if (!needle) return true;
      return `${creature.name} ${creature.cls} ${creature.tags ?? ''}`.toLowerCase().includes(needle);
    });
  }, [catalog.creatures, query, group]);

  // With no filter on, the ones people actually ask for lead - otherwise a
  // hundred aberrant variants sit between you and the Rex.
  const ordered = useMemo(() => {
    if (query.trim() || group) return shown;
    return [...shown].sort((a, b) => Number(b.fav ?? false) - Number(a.fav ?? false));
  }, [shown, query, group]);

  return (
    <div className="card">
      <div className="card-head">
        <Icon.Paw />
        <h3>Creatures</h3>
        <span className="badge">{catalog.creatures.length}</span>
        <div className="spacer" />
        <SearchInput
          value={query}
          onChange={setQuery}
          width={260}
          placeholder="Search creatures…"
          hint={query ? `${shown.length} of ${catalog.creatures.length}` : undefined}
        />
      </div>

      <div className="card-body stack">
        <div className="row row-wrap" style={{ gap: 6 }}>
          <div className="btn-group">
            <Button size="sm" variant={group === '' ? 'primary' : 'default'} onClick={() => setGroup('')}>
              All
            </Button>
            {catalog.creatureGroups.map((name) => (
              <Button key={name} size="sm" variant={group === name ? 'primary' : 'default'} onClick={() => setGroup(name)}>
                {name}
              </Button>
            ))}
          </div>
        </div>

        {ordered.length === 0 ? (
          <Empty
            icon="🔍"
            title="Nothing matches that"
            body="Try a shorter word, or clear the group filter. Anything missing from this list still spawns from the Console tab."
          />
        ) : (
          <div className="spawn-grid">
            {ordered.map((creature) => (
              <button key={`${creature.group}-${creature.name}`} className="spawn-tile" onClick={() => setChosen(creature)}>
                <span className="spawn-tile-name">
                  {creature.name}
                  {creature.fav ? <span className="spawn-star" title="Popular pick">★</span> : null}
                </span>
                <span className="spawn-tile-sub mono">{creature.cls}</span>
                <span className="spawn-tile-meta">
                  {creature.group}
                  {creature.boss ? ' · boss' : ''}
                  {creature.saddle ? ' · saddle' : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {chosen ? (
        <SummonDialog
          creature={chosen}
          items={catalog.items}
          ready={ready}
          pending={pending}
          onSend={onSend}
          onClose={() => setChosen(null)}
        />
      ) : null}
    </div>
  );
}

function SummonDialog({
  creature,
  items,
  ready,
  pending,
  onSend,
  onClose,
}: {
  creature: SpawnCreature;
  items: SpawnItem[];
  ready: boolean;
  pending: string | null;
  onSend: (command: string, successMessage?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [level, setLevel] = useState(150);
  const [tamed, setTamed] = useState(true);
  const [confirmBoss, setConfirmBoss] = useState(false);

  const command = summonCommand(creature.cls, level, tamed);
  const saddle = items.find((i) => i.gfi === creature.saddle);

  const fire = () => void onSend(command, tamed ? `${creature.name} summoned at level ${clampLevel(level)}` : `${creature.name} summoned`);

  return (
    <>
      <Modal
        title={`Spawn ${creature.name}`}
        onClose={onClose}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Tooltip
              title="This almost never lands"
              body="GMSummon puts the creature down at whoever ran it, and an RCON session is not standing anywhere on the map. ARK replies “Server received, But no response!!” and nothing appears. Left here because the reply is always shown, so you can see for yourself."
            >
              <Button
                variant="ghost"
                disabled={!ready}
                busy={pending === command}
                onClick={() => (creature.boss ? setConfirmBoss(true) : fire())}
              >
                Try over RCON anyway
              </Button>
            </Tooltip>
            <CopyButton variant="primary" size="md" text={asConsole(command)} label="Copy for the in-game console" />
          </>
        }
      >
        <div className="stack">
          <Callout tone="info" title="Creatures have to be spawned from inside the game">
            <p>
              Copy the line below, open the in-game console with <b>Tab</b> and paste it. GMSummon places the creature
              at whoever ran the command, so it has to be run by somebody standing where you want it — sending it down
              RCON gets <span className="mono">Server received, But no response!!</span> and nothing appears.
            </p>
            <p>
              To hand a tamed one to somebody else: spawn it, have them look straight at it and run{' '}
              <span className="mono">cheat GiveToMe</span>. If they are not an admin, take them into your tribe for the
              moment it takes.
            </p>
          </Callout>

          {creature.boss ? (
            <Callout tone="warn" title="This one is a boss">
              Bosses arrive at full strength and do not care whose base they landed in. On a creative server that is
              usually the point — just be somewhere you do not mind losing.
            </Callout>
          ) : null}

          <Field
            label="Tamed or wild"
            help={
              tamed
                ? 'GMSummon spawns it already tamed, rideable and at exactly the level you set.'
                : 'Summon spawns a wild one. ARK rolls the level from the map’s own spawn table, so the level box does not apply.'
            }
          >
            <div className="btn-group">
              <Button size="sm" variant={tamed ? 'primary' : 'default'} onClick={() => setTamed(true)}>
                Tamed
              </Button>
              <Button size="sm" variant={!tamed ? 'primary' : 'default'} onClick={() => setTamed(false)}>
                Wild
              </Button>
            </div>
          </Field>

          {tamed ? (
            <Field label="Level" help="150 is the wild cap on default settings. 224 is where a perfect tame lands after its bonus levels.">
              <div className="row row-wrap" style={{ gap: 6 }}>
                <div className="btn-group">
                  {LEVEL_PRESETS.map((preset) => (
                    <Button key={preset} size="sm" variant={level === preset ? 'primary' : 'default'} onClick={() => setLevel(preset)}>
                      {preset}
                    </Button>
                  ))}
                </div>
                <input
                  className="input input-mono"
                  type="number"
                  min={1}
                  max={9999}
                  value={level}
                  aria-label="Level"
                  style={{ maxWidth: 110 }}
                  onChange={(e) => setLevel(clampLevel(Number(e.target.value)))}
                />
              </div>
            </Field>
          ) : null}

          <Field label="The command" help="Copy this and paste it into the in-game console. The cheat prefix is only needed in game — over RCON ASMS drops it.">
            <div className="input-group">
              <input className="input input-mono" readOnly value={asConsole(command)} onFocus={(e) => e.target.select()} />
              <CopyButton text={asConsole(command)} />
            </div>
          </Field>

          <div className="row row-wrap" style={{ gap: 10 }}>
            <ExternalLink href={dododexUrl(creature.name)}>Taming and stats on Dododex</ExternalLink>
            {saddle ? <span className="tiny faint">Wears the {saddle.name} — it is on the Gear tab.</span> : null}
          </div>
        </div>
      </Modal>

      {confirmBoss ? (
        <Confirm
          title={`Summon ${creature.name}?`}
          danger
          confirmLabel="Summon it"
          onClose={() => setConfirmBoss(false)}
          onConfirm={fire}
          body={
            <p>
              Bosses spawn hostile and at full strength. Whatever is standing nearby — tames, players, a half-built base —
              is in range the moment it lands.
            </p>
          }
        />
      ) : null}
    </>
  );
}

// --------------------------------------------------------------------- gear

function Gear({
  catalog,
  ready,
  target,
  pending,
  onSend,
}: {
  catalog: SpawnCatalog;
  ready: boolean;
  target: Target;
  pending: string | null;
  onSend: (command: string, successMessage?: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [chosen, setChosen] = useState<SpawnItem | null>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.items.filter((entry) => {
      if (group && entry.group !== group) return false;
      if (!needle) return true;
      return `${entry.name} ${entry.gfi} ${entry.tags ?? ''}`.toLowerCase().includes(needle);
    });
  }, [catalog.items, query, group]);

  return (
    <div className="card">
      <div className="card-head">
        <Icon.Gift />
        <h3>Gear</h3>
        <span className="badge">{catalog.items.length}</span>
        <div className="spacer" />
        <SearchInput
          value={query}
          onChange={setQuery}
          width={260}
          placeholder="Search armour, saddles, weapons…"
          hint={query ? `${shown.length} of ${catalog.items.length}` : undefined}
        />
      </div>

      <div className="card-body stack">
        <div className="btn-group">
          <Button size="sm" variant={group === '' ? 'primary' : 'default'} onClick={() => setGroup('')}>
            All
          </Button>
          {catalog.itemGroups.map((name) => (
            <Button key={name} size="sm" variant={group === name ? 'primary' : 'default'} onClick={() => setGroup(name)}>
              {name}
            </Button>
          ))}
        </div>

        {shown.length === 0 ? (
          <Empty icon="🔍" title="Nothing matches that" body="Try a shorter word, or clear the group filter." />
        ) : (
          <div className="spawn-grid">
            {shown.map((entry) => (
              <button key={entry.gfi} className="spawn-tile" onClick={() => setChosen(entry)}>
                <span className="spawn-tile-name">{entry.name}</span>
                <span className="spawn-tile-sub mono">{entry.gfi}</span>
                <span className="spawn-tile-meta">
                  {entry.group}
                  {entry.path ? '' : ' · console only'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {chosen ? (
        <GiveDialog item={chosen} target={target} ready={ready} pending={pending} onSend={onSend} onClose={() => setChosen(null)} />
      ) : null}
    </div>
  );
}

function GiveDialog({
  item,
  target,
  ready,
  pending,
  onSend,
  onClose,
}: {
  item: SpawnItem;
  target: Target;
  ready: boolean;
  pending: string | null;
  onSend: (command: string, successMessage?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [qty, setQty] = useState(item.qty ?? 1);
  const [quality, setQuality] = useState(0);
  const [blueprint, setBlueprint] = useState(false);

  // Only a path-carrying item can be aimed at somebody. Without one the give
  // would report success and deliver nothing, so it is not offered.
  const canDeliver = Boolean(target && item.path);
  const deliverCommand = canDeliver ? givePlayerCommand(item.path!, target!.ue4Id, qty, quality, blueprint) : null;
  const plainDeliverCommand = canDeliver
    ? givePlayerCommandPlain(item.path!, target!.ue4Id, qty, quality, blueprint)
    : null;
  const consoleCommand = giveSelfCommand(item.gfi, qty, quality, blueprint);

  return (
    <Modal
      title={`Give ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <CopyButton text={asConsole(consoleCommand)} label="Copy for the in-game console" />
          <Button
            variant="primary"
            disabled={!ready || !deliverCommand}
            busy={pending === deliverCommand}
            onClick={() => deliverCommand && void onSend(deliverCommand, `${qty} × ${item.name} → ${target!.player.name}`)}
          >
            Give to {target ? target.player.name : 'a player'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {!target ? (
          <Callout tone="info" title="Pick a player above to hand this over directly">
            Without a recipient there is nobody for ARK to give it to, so only the console line is available. Choose a
            connected player at the top of the tab and the Give button wakes up.
          </Callout>
        ) : null}
        {target && !item.path ? (
          <Callout tone="warn" title="This one can only go through the console">
            ASMS could not confirm this item's blueprint path against the wiki, and{' '}
            <span className="mono">GiveItemToPlayer</span> answers a wrong path by cheerfully handing over nothing. The{' '}
            <span className="mono">GFI</span> line below matches on the class name instead and is reliable in game.
          </Callout>
        ) : null}

        <div className="row row-wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <Field label="How many">
            <input
              className="input input-mono"
              type="number"
              min={1}
              max={10000}
              value={qty}
              style={{ maxWidth: 120 }}
              onChange={(e) => setQty(Math.max(1, Math.round(Number(e.target.value) || 1)))}
            />
          </Field>
          <Field label="Quality" help="0 is primitive, 100 is ascendant. Ignored by anything that does not have quality.">
            <input
              className="input input-mono"
              type="number"
              min={0}
              max={100}
              value={quality}
              style={{ maxWidth: 120 }}
              onChange={(e) => setQuality(clampQuality(Number(e.target.value)))}
            />
          </Field>
          <Toggle checked={blueprint} onChange={setBlueprint} title="As a blueprint" help="Hands over the recipe rather than the item." />
        </div>

        <Field
          label="In-game console"
          help="Works for whoever types it, wherever they are standing. Press Tab in game, paste, Enter."
        >
          <div className="input-group">
            <input className="input input-mono" readOnly value={asConsole(consoleCommand)} onFocus={(e) => e.target.select()} />
            <CopyButton text={asConsole(consoleCommand)} />
          </div>
        </Field>

        {deliverCommand ? (
          <Field label={`Sent to ${target!.player.name} over RCON`} help="This is what the Give button runs.">
            <div className="input-group">
              <input className="input input-mono" readOnly value={deliverCommand} onFocus={(e) => e.target.select()} />
              <CopyButton text={deliverCommand} />
              <Tooltip
                title="If the give comes back silent"
                body="Some RCON stacks mangle the single quotes nested inside the double ones, and ARK takes the bare asset path too. Same command, without the Blueprint'…' wrapper."
              >
                <CopyButton text={plainDeliverCommand!} label="Copy without the wrapper" />
              </Tooltip>
            </div>
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------- kits

function Kits({
  catalog,
  ready,
  target,
  pending,
  onSendBatch,
}: {
  catalog: SpawnCatalog;
  ready: boolean;
  target: Target;
  pending: string | null;
  onSendBatch: (commands: string[], successMessage: string) => Promise<void>;
}) {
  const [open, setOpen] = useState<SpawnKit | null>(null);

  return (
    <div className="card">
      <div className="card-head">
        <Icon.Package />
        <h3>Kits</h3>
        <Help
          title="One press, a dozen gives"
          body="ARK will not take a bundle as one command, so ASMS runs them in order down the same RCON connection and reports which ones landed."
        />
        <div className="spacer" />
        {target ? (
          <span className="tiny faint">Going to {target.player.name}</span>
        ) : (
          <span className="tiny faint">Pick a player above to deliver these</span>
        )}
      </div>

      <div className="card-body">
        <div className="preset-grid">
          {catalog.kits.map((kit) => (
            <button key={kit.id} className="preset-card" onClick={() => setOpen(kit)}>
              <div className="preset-top">
                <span className="preset-icon">{kit.icon}</span>
                <span className="preset-name">{kit.name}</span>
              </div>
              <span className="preset-tag">{kit.blurb}</span>
              <span className="tiny faint">{kit.items.length} items</span>
            </button>
          ))}
        </div>
      </div>

      {open ? (
        <KitDialog
          kit={open}
          items={catalog.items}
          target={target}
          ready={ready}
          pending={pending}
          onSendBatch={onSendBatch}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

function KitDialog({
  kit,
  items,
  target,
  ready,
  pending,
  onSendBatch,
  onClose,
}: {
  kit: SpawnKit;
  items: SpawnItem[];
  target: Target;
  ready: boolean;
  pending: string | null;
  onSendBatch: (commands: string[], successMessage: string) => Promise<void>;
  onClose: () => void;
}) {
  const lines = useMemo(() => kitCommands(kit, items, target), [kit, items, target]);
  const deliverable = lines.filter((line) => line.deliverable);
  const consoleText = lines.map((line) => asConsole(line.command)).join('\n');

  return (
    <Modal
      title={`${kit.icon} ${kit.name}`}
      wide
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <CopyButton text={consoleText} label="Copy all for the console" />
          <Button
            variant="primary"
            disabled={!ready || deliverable.length === 0}
            busy={pending !== null && deliverable.some((line) => line.command === pending)}
            onClick={() => {
              void onSendBatch(
                deliverable.map((line) => line.command),
                `${kit.name} sent to ${target!.player.name}`,
              );
              onClose();
            }}
          >
            Send {deliverable.length || ''} to {target ? target.player.name : 'a player'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="dim">{kit.blurb}</p>

        {!target ? (
          <Callout tone="info" title="Pick a player above to send this kit">
            Without a recipient ASMS can only write the lines out. Copy them and paste the block into the in-game console
            — it accepts one line at a time.
          </Callout>
        ) : deliverable.length < lines.length ? (
          <Callout tone="warn" title={`${lines.length - deliverable.length} of these can only go through the console`}>
            Their blueprint paths could not be confirmed, and an unconfirmed path delivers nothing without saying so. The
            rest go over RCON as normal; copy the block for the remainder.
          </Callout>
        ) : null}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Command</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.command}>
                  <td>
                    {line.label}
                    {line.deliverable ? null : <span className="tiny faint"> · console</span>}
                  </td>
                  <td className="mono small faint">{line.command}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
