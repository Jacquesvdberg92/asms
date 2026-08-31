import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { TopBar, openSearch } from '../components/Shell';
import { Button, CopyButton, Badge, ExternalLink } from '../components/ui';
import { MOD_SOURCES } from '../lib/mods';
import { useHashTarget } from '../lib/hash';
import { Icon } from '../components/Icons';

/** Indented to paste straight under `ports:` in docker-compose.yml. */
const PORT_SNIPPET = [
  '      - "7779:7779/udp"   # second server - game',
  '      - "7780:7780/udp"   # ASA also binds game port + 1',
  '      - "27016:27016/udp" # its Steam query port',
].join('\n');

/**
 * The manual, in the app rather than in a README nobody opens. Written for
 * someone who has never run a dedicated server before.
 */
export default function Guide() {
  const { system, servers, settings } = useStore();
  const lan = system?.addresses?.[0] ?? 'YOUR-PC-IP';
  const example = servers[0];
  const port = example?.port ?? 7777;
  const queryPort = example?.queryPort ?? 27015;
  const rconPort = example?.rconPort ?? 27020;
  const joinLine = `open ${lan}:${port}${example?.serverPassword ? `?Password=${example.serverPassword}` : ''}`;

  useHashTarget();

  return (
    <>
      <TopBar
        title="Setup guide"
        sub="From nothing to friends joining your server"
        actions={
          <Link className="btn btn-primary" to="/servers/new">
            <Icon.Plus /> New server
          </Link>
        }
      />

      <div className="content content-narrow stack">
        <div className="card card-pad">
          <div className="toc">
            <a href="#before">Before you start</a>
            <a href="#steamcmd">SteamCMD</a>
            <a href="#create">Create a server</a>
            <a href="#files">Download the files</a>
            <a href="#ports">Ports &amp; firewall</a>
            <a href="#join">Start &amp; join</a>
            <a href="#settings">Rates &amp; rules</a>
            <a href="#setups">Presets &amp; setups</a>
            <a href="#mods">Mods</a>
            <a href="#care">Backups &amp; restarts</a>
            <a href="#cluster">Clusters</a>
            <a href="#security">Security</a>
            <a href="#trouble">When things break</a>
            <a href="#docker">Docker</a>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <Icon.Search />
            <h2>Finding your way around</h2>
          </div>
          <div className="card-body stack">
            <div className="row row-wrap" style={{ gap: 12 }}>
              <span className="small dim" style={{ flex: 1, minWidth: 260 }}>
                <strong>Press Ctrl K anywhere.</strong> One box searches every server and tab, every game setting and launch
                flag, your saved mods and setups, every action, and this guide. Typing a mod name offers a CurseForge search;
                typing a setting name jumps straight to that control on a server.
              </span>
              <Button onClick={openSearch}>
                <Icon.Search size={14} /> Try it
              </Button>
            </div>
            <div className="divider" />
            <div className="small dim">
              The sidebar is grouped the same way the app is: <strong>one server at a time</strong> in the middle,{' '}
              <strong>things you set up once and reuse</strong> — presets, your mod library, clusters — above{' '}
              <strong>ASMS itself</strong>, where settings and{' '}
              <Link to="/backup" className="strong">
                Backup &amp; migrate
              </Link>{' '}
              live.
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <Icon.Shield />
            <h2>Getting started</h2>
          </div>
          <div className="card-body">
            <section className="guide-step" id="before">
              <span className="guide-num">0</span>
              <div className="guide-body">
                <h3>Before you start</h3>
                <p>What an ARK: Survival Ascended server actually needs from the machine it runs on:</p>
                <ul>
                  <li>
                    <strong>~30 GB of disk per server.</strong> Each server is its own full copy of the game files. Two maps means
                    two installs.
                  </li>
                  <li>
                    <strong>6–10 GB of RAM per server</strong> once players are on. ASA is memory-hungry; four servers on 16 GB will
                    thrash.
                  </li>
                  <li>
                    <strong>A wired connection and a router you can configure.</strong> You will need to forward ports.
                  </li>
                  <li>
                    <strong>Windows.</strong> ASA's dedicated server is a Windows binary.
                  </li>
                </ul>
                <div className="callout">
                  <Icon.Alert size={15} />
                  <div>
                    Running the server on the same PC you play on works, but the game and the server compete for RAM and CPU. If you
                    have a spare machine, use it.
                  </div>
                </div>
              </div>
            </section>

            <section className="guide-step" id="steamcmd">
              <span className="guide-num">1</span>
              <div className="guide-body">
                <h3>Install SteamCMD</h3>
                <p>
                  SteamCMD is Valve's command-line downloader — it is how server files get onto your machine. ASMS downloads and
                  unpacks it for you; it is about 50 MB and lives inside the ASMS data folder.
                </p>
                <p>
                  Click <strong>Install SteamCMD</strong> on the dashboard.{' '}
                  {system?.steamCmd.installed ? (
                    <Badge tone="ok">already installed</Badge>
                  ) : (
                    <Badge tone="warn">not installed yet</Badge>
                  )}
                </p>
                <div className="callout">
                  <Icon.Alert size={15} />
                  <div>
                    Some antivirus tools flag SteamCMD's first run while it updates itself. It is Valve's own tool; if it is
                    quarantined, allow it and try again.
                  </div>
                </div>
              </div>
            </section>

            <section className="guide-step" id="create">
              <span className="guide-num">2</span>
              <div className="guide-body">
                <h3>Create a server</h3>
                <p>
                  <Link to="/servers/new">New server</Link> walks four short steps. The only decision that is awkward to change later
                  is the install folder, because moving 30 GB is slow — everything else is editable any time.
                </p>
                <ul>
                  <li>
                    <strong>Name</strong> is what you see in ASMS. <strong>Session name</strong> is what players see in game.
                  </li>
                  <li>
                    <strong>Map</strong> can be changed later, but each map keeps its own save, so switching maps means starting
                    fresh on that map.
                  </li>
                  <li>
                    <strong>Ports</strong> are pre-filled with ones nothing else on this machine is using. Leave them unless you have
                    a reason.
                  </li>
                  <li>
                    <strong>Admin password</strong> doubles as the RCON password. ASMS generates a strong one if you leave it blank.
                  </li>
                </ul>
              </div>
            </section>

            <section className="guide-step" id="files">
              <span className="guide-num">3</span>
              <div className="guide-body">
                <h3>Download the server files</h3>
                <p>
                  Around 30 GB through SteamCMD. Progress streams into the server's <strong>Console</strong> tab, and you can cancel
                  it at any point — a cancelled download resumes where it left off next time.
                </p>
                <div className="callout ok">
                  <Icon.Check size={15} />
                  <div>
                    If a download finishes but the server refuses to start, use <strong>Verify integrity</strong> on the Overview
                    tab. It re-checks every file against Steam and repairs what is wrong.
                  </div>
                </div>
              </div>
            </section>

            <section className="guide-step" id="ports">
              <span className="guide-num">4</span>
              <div className="guide-body">
                <h3>Open the ports</h3>
                <p>This is where most people get stuck. There are two separate things to do.</p>
                <p>
                  <strong>On this machine</strong> — Windows Firewall must allow the traffic in. The <strong>Add firewall rules</strong>{' '}
                  button on a server's Overview tab does it for you, but ASMS has to be running as administrator; if it is not, the
                  button tells you so.
                </p>
                <p>
                  <strong>On your router</strong> — forward these to this PC ({lan}). ASMS cannot do this part; every router's admin
                  page is different, but look for "Port forwarding" or "Virtual server".
                </p>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Port</th>
                        <th>Protocol</th>
                        <th>Forward it?</th>
                        <th>What it does</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="mono">{port}</td>
                        <td>UDP</td>
                        <td>
                          <Badge tone="ok">yes</Badge>
                        </td>
                        <td>Game traffic</td>
                      </tr>
                      <tr>
                        <td className="mono">{port + 1}</td>
                        <td>UDP</td>
                        <td>
                          <Badge tone="ok">yes</Badge>
                        </td>
                        <td>ASA also binds game port + 1</td>
                      </tr>
                      <tr>
                        <td className="mono">{queryPort}</td>
                        <td>UDP</td>
                        <td>
                          <Badge tone="ok">yes</Badge>
                        </td>
                        <td>Steam query — how the server list sees you</td>
                      </tr>
                      <tr>
                        <td className="mono">{rconPort}</td>
                        <td>TCP</td>
                        <td>
                          <Badge tone="bad">never</Badge>
                        </td>
                        <td>Remote admin. Keep it on your LAN only</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="callout danger">
                  <Icon.Alert size={15} />
                  <div>
                    <strong>Do not forward the RCON port.</strong> Anyone who reaches it and guesses your admin password owns your
                    server.
                  </div>
                </div>
              </div>
            </section>

            <section className="guide-step" id="join">
              <span className="guide-num">5</span>
              <div className="guide-body">
                <h3>Start it, then join</h3>
                <p>
                  Press <strong>Start</strong>. The first boot takes several minutes — ASA is slow to load, and it is slower still
                  the first time after adding mods. ASMS shows <em>Starting</em> until the server says it has finished booting —
                  whichever comes first out of its own log, an RCON reply, or its console output — then flips to <em>Running</em>.
                </p>
                <p>
                  ASA's in-game server browser is unreliable and often will not show your server even when it is perfectly healthy.
                  The dependable way to join is the in-game console:
                </p>
                <div className="row" style={{ marginBottom: 10 }}>
                  <code className="code" style={{ flex: 1 }}>
                    {joinLine}
                  </code>
                  <CopyButton text={joinLine} />
                </div>
                <ul>
                  <li>Press <span className="mono">Tab</span> in game to open the console, type the line above, press Enter.</li>
                  <li>People on your network use that address. People outside use your public IP instead.</li>
                  <li>
                    A join password goes on the same line as{' '}
                    <span className="mono">?Password=yourpassword</span> — ASMS fills it in above when the server has one. That
                    is more reliable than waiting for ARK to prompt for it.
                  </li>
                </ul>
              </div>
            </section>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <Icon.Sliders />
            <h2>Running it day to day</h2>
          </div>
          <div className="card-body">
            <section className="guide-step" id="settings">
              <span className="guide-num">6</span>
              <div className="guide-body">
                <h3>Rates and rules</h3>
                <p>
                  <strong>Settings → Game settings</strong> covers the roughly ninety options people actually change, grouped by
                  topic with a slider or a switch each. Every row shows the real INI key it writes, so you can always match it to a
                  guide you found online.
                </p>
                <ul>
                  <li>Anything not on that list is editable under <strong>Raw INI</strong>.</li>
                  <li>
                    Switches that live on the command line rather than in a file — crossplay, BattlEye, whitelist-only,{' '}
                    <span className="mono">allow flyers in caves</span> — are under <strong>Server &amp; launch</strong>.
                  </li>
                  <li>
                    ARK reads these files <strong>only when it boots</strong>, and rewrites them when it shuts down. Change settings
                    while the server is stopped, or restart afterwards — otherwise your edits get overwritten.
                  </li>
                  <li>ASMS keeps a <span className="mono">.asms.bak</span> copy next to each file every time it saves.</li>
                </ul>
                <div className="callout ok">
                  <Icon.Bolt size={15} />
                  <div>
                    Rather not tune ninety numbers? The <strong>play style presets</strong> at the top of that tab set a coherent
                    lot of them in one click — see the next step. Official rates are all ×1 and assume you play like it is a job.
                  </div>
                </div>
              </div>
            </section>

            <section className="guide-step" id="setups">
              <span className="guide-num">7</span>
              <div className="guide-body">
                <h3>Presets and setups</h3>
                <p>
                  You do not have to reason about sixty multipliers. <strong>Presets &amp; setups</strong> in the sidebar — and the
                  strip at the top of every server's Game settings tab — offers four ready-made play styles:
                </p>
                <ul>
                  <li>
                    <strong>🎨 Creative</strong> — everything unlocked, nothing decays, instant taming. For building and testing.
                  </li>
                  <li>
                    <strong>🌤️ Easy</strong> — ×5 harvest, ×10 taming, fast breeding. ARK without the grind.
                  </li>
                  <li>
                    <strong>⚖️ Medium</strong> — ×3 harvest, ×5 taming. The usual sweet spot for a friends server; pick this if you
                    are unsure.
                  </li>
                  <li>
                    <strong>🔥 Hard</strong> — PvP, level 180 wilds, no offline raid protection, faster spoiling.
                  </li>
                </ul>
                <p>
                  Choosing one on the Game settings tab <em>stages</em> the changes — every affected row is marked{' '}
                  <em>edited</em> so you can look through them and adjust before pressing Save. <strong>🎯 Official</strong> puts
                  everything back to vanilla. Presets never touch mods, ports, passwords or launch flags.
                </p>
                <p>
                  A <strong>setup</strong> goes further: it is your whole configuration — mods and their load order, every game
                  setting, launch flags, optionally your scheduled tasks — saved as one bundle you can re-apply to another server,
                  keep as a checkpoint before experimenting, or download as a file and send to a friend. Import theirs by dropping
                  the file on the same page.
                </p>
                <div className="callout ok">
                  <Icon.Shield size={15} />
                  <div>
                    Setup files never contain your passwords, ports, folder paths or cluster IDs — those are stripped on the way
                    out, including from the raw INI text. A setup is safe to post in a Discord as-is.
                  </div>
                </div>
              </div>
            </section>

            <section className="guide-step" id="mods">
              <span className="guide-num">8</span>
              <div className="guide-body">
                <h3>Mods</h3>
                <p>
                  ASA mods come from CurseForge — there is no Steam Workshop for Survival Ascended. The number in a mod's
                  CurseForge URL is its project ID, and that is what goes in the <strong>Mods</strong> tab.
                </p>
                <div className="row row-wrap" style={{ gap: 8, marginBottom: 12 }}>
                  {MOD_SOURCES.map((source) => (
                    <ExternalLink key={source.href} href={source.href} className="btn btn-sm" title={source.help}>
                      {source.label}
                    </ExternalLink>
                  ))}
                </div>
                <ul>
                  <li>Load order runs top to bottom. Map mods and total conversions first, cosmetics last.</li>
                  <li>
                    Give each one a name and author in the table — six months later, twelve bare numbers mean nothing. Paste a
                    whole list at once as <span className="mono">Name,ID,URL</span> rows if you have one.
                  </li>
                  <li>
                    Turning a mod <strong>off</strong> keeps it in the list but drops it from the launch command. That is the
                    fastest way to find which mod is stopping a server from starting.
                  </li>
                  <li>The server downloads mods on its next boot, so that start is much slower than usual. This is normal.</li>
                  <li>Every player needs the same mods; ARK downloads them on join.</li>
                  <li>Using a modded map? Set the map <em>and</em> add its mod ID here.</li>
                </ul>
              </div>
            </section>

            <section className="guide-step" id="care">
              <span className="guide-num">9</span>
              <div className="guide-body">
                <h3>Backups and scheduled restarts</h3>
                <p>Two things worth setting up on day one, from the server's <strong>Schedule</strong> tab:</p>
                <ul>
                  <li>
                    <strong>A daily backup.</strong> Zips the saves and both config files. ASMS keeps the newest {settings?.backupRetention ?? 20}{' '}
                    and deletes older ones.
                  </li>
                  <li>
                    <strong>A nightly restart.</strong> ASA leaks memory over long uptimes; a daily restart keeps it healthy.
                  </li>
                </ul>
                <p>
                  Warnings are broadcast in game before a scheduled action, and ASMS starts the countdown early so the restart lands
                  exactly on the scheduled minute rather than several minutes after it. You can call a countdown off mid-flight — the
                  players get told it is cancelled.
                </p>
                <div className="callout ok">
                  <Icon.Check size={15} />
                  <div>
                    Restoring a backup takes a fresh safety backup of the current state first, so a restore you regret is itself
                    reversible.
                  </div>
                </div>
              </div>
            </section>

            <section className="guide-step" id="cluster">
              <span className="guide-num">10</span>
              <div className="guide-body">
                <h3>Clusters</h3>
                <p>
                  Give two or more servers the same <strong>cluster ID</strong> and they share an upload bank — walk into an obelisk
                  on one map and come out on another with your gear and dinos.
                </p>
                <ul>
                  <li>The ID must match exactly on every member. Use the Clusters page to set them all at once.</li>
                  <li>They share one transfer folder, which ASMS creates for you.</li>
                  <li>All members must be running for transfers to work in both directions.</li>
                </ul>
              </div>
            </section>

            <section className="guide-step" id="security">
              <span className="guide-num">11</span>
              <div className="guide-body">
                <h3>Who can reach ASMS</h3>
                <p>
                  ASMS listens on your whole network by default so you can manage servers from a laptop or phone. That is convenient
                  and it is also a door.
                </p>
                <ul>
                  <li>
                    <strong>Shared house or office?</strong> Set a password under <Link to="/settings">Settings → Access</Link>.
                  </li>
                  <li>
                    <strong>Only ever use it on this PC?</strong> Set the listen address to <span className="mono">127.0.0.1</span>.
                  </li>
                  <li>
                    <strong>Want it from outside the house?</strong> Use a VPN or Tailscale. Do not forward the ASMS port to the
                    internet.
                  </li>
                </ul>
                <div className="callout danger">
                  <Icon.Alert size={15} />
                  <div>
                    Without a password, anyone who can reach this port can start, stop, reconfigure and delete your servers. There is
                    no second confirmation protecting you from that.
                  </div>
                </div>
              </div>
            </section>

            <section className="guide-step" id="trouble">
              <span className="guide-num">12</span>
              <div className="guide-body">
                <h3>When things break</h3>
                <p>
                  Two places tell you almost everything: the <strong>Console</strong> tab (what the server is saying right now) and
                  the <strong>Logs</strong> tab (what it said earlier, including ASMS's own log).
                </p>
                <ul>
                  <li>
                    <strong>Crashes instantly.</strong> Nearly always a port already in use, or a corrupt install. Check the console,
                    then run Verify integrity.
                  </li>
                  <li>
                    <strong>Stuck on "Starting".</strong> First boots genuinely take minutes. If it never turns green, RCON is not
                    answering — check that RCON is enabled and the admin password is set.
                  </li>
                  <li>
                    <strong>Friends cannot connect.</strong> The server is almost certainly fine; the ports are not. Re-check
                    forwarding and give them your public IP, not your LAN one.
                  </li>
                  <li>
                    <strong>Settings do nothing.</strong> You changed them while the server was running. Restart.
                  </li>
                  <li>
                    <strong>Mods will not load.</strong> Check the ID is right and give the next boot several extra minutes.
                  </li>
                </ul>
                <div className="row">
                  <Link className="btn" to="/">
                    Back to dashboard
                  </Link>
                  {example ? (
                    <Link className="btn" to={`/servers/${example.id}/logs`}>
                      Open logs
                    </Link>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        </div>

        <DockerSection />

        <div className="card card-pad row row-wrap">
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="strong">Still stuck?</div>
            <div className="small faint">
              The Logs tab has a Download button. That file plus what the Console showed is usually enough for someone to tell you
              exactly what went wrong.
            </div>
          </div>
          <Button onClick={() => window.dispatchEvent(new CustomEvent('asms:palette'))}>
            <Icon.Bolt /> Command palette
          </Button>
        </div>
      </div>
    </>
  );
}

/** A command you are meant to run, with the button that saves retyping it. */
function Cmd({ children }: { children: string }) {
  return (
    <div className="row cmd-row">
      <code className="code" style={{ flex: 1 }}>
        {children}
      </code>
      <CopyButton text={children} />
    </div>
  );
}

/**
 * Docker is a different way to run ASMS rather than a step in the Windows
 * walkthrough, so it gets its own card instead of a number in the middle of
 * the sequence. It is written for someone with the compose file in front of
 * them who wants the commands, and it leads with the caveat that decides
 * whether any of it is worth doing: the container runs ASMS, not ARK.
 */
function DockerSection() {
  return (
    <div className="card" id="docker">
      <div className="card-head">
        <Icon.Layers />
        <h2>Running ASMS in Docker</h2>
        <div className="spacer" />
        <span className="card-hint">Optional — on Windows, start.cmd is simpler</span>
      </div>

      <div className="card-body">
        <div className="callout warn">
          <Icon.Alert size={15} />
          <div>
            <strong>The container runs ASMS, not ARK.</strong> ARK&rsquo;s dedicated server is a Windows executable and there
            is no Linux build, so on a Linux host the game server itself has to be started through Proton or Wine — step 5.
            Everything else — the manager, SteamCMD, RCON, backups, schedules, the whole dashboard — works exactly as it does
            on Windows.
          </div>
        </div>

        <section className="guide-step" id="docker-start">
          <span className="guide-num">1</span>
          <div className="guide-body">
            <h3>Start it</h3>
            <p>
              Run this from the folder holding <span className="mono">docker-compose.yml</span>. The first run builds the
              image, which takes a couple of minutes; after that it is seconds.
            </p>
            <Cmd>docker compose up -d</Cmd>
            <p>
              Then open <span className="mono">http://localhost:8787</span>, or the host&rsquo;s LAN address from another
              device. There is no SteamCMD step: it is already in the image, so the dashboard goes straight to{' '}
              <strong>New server</strong>.
            </p>
          </div>
        </section>

        <section className="guide-step" id="docker-day">
          <span className="guide-num">2</span>
          <div className="guide-body">
            <h3>The commands you will actually use</h3>
            <p>Watch what it is doing — SteamCMD progress and ARK&rsquo;s own output both land here:</p>
            <Cmd>docker compose logs -f asms</Cmd>
            <p>Stop it. Your servers, saves and settings live in volumes and survive this:</p>
            <Cmd>docker compose down</Cmd>
            <p>Update ASMS itself after pulling new code, rebuilding the image in place:</p>
            <Cmd>docker compose up -d --build</Cmd>
            <p>Get a shell inside, for the rare moment you want to look at the files yourself:</p>
            <Cmd>docker compose exec asms bash</Cmd>
          </div>
        </section>

        <section className="guide-step" id="docker-volumes">
          <span className="guide-num">3</span>
          <div className="guide-body">
            <h3>Where everything lives</h3>
            <p>Two volumes, and the second one is the big one:</p>
            <ul>
              <li>
                <span className="mono">asms-data</span> → <span className="mono">/data</span> — ASMS&rsquo;s own database and
                its copy of SteamCMD. Small. This is what <strong>Backup &amp; migrate</strong> exports.
              </li>
              <li>
                <span className="mono">asms-ark</span> → <span className="mono">/ark</span> — server installs, backups and
                cluster files. <strong>Around 30 GB per server</strong>, so point it at a disk with room.
              </li>
            </ul>
            <Cmd>docker volume ls</Cmd>
            <p>
              To use a folder you already have instead of a managed volume, swap that line in{' '}
              <span className="mono">docker-compose.yml</span> for a bind mount:
            </p>
            <Cmd>      - /srv/ark:/ark</Cmd>
            <div className="callout ok">
              <Icon.Check size={15} />
              <div>
                <span className="mono">docker compose down</span> never touches volumes. Only{' '}
                <span className="mono">docker compose down -v</span> deletes them — that is the one command that would take
                your worlds with it.
              </div>
            </div>
          </div>
        </section>

        <section className="guide-step" id="docker-ports">
          <span className="guide-num">4</span>
          <div className="guide-body">
            <h3>Publish a port per server</h3>
            <p>
              The compose file ships with the ports for <em>one</em> server. A container forwards nothing you have not asked
              for, so a second server needs its own three lines under <span className="mono">ports:</span> — this is the usual
              reason a server that looks perfectly healthy cannot be joined.
            </p>
            <Cmd>{PORT_SNIPPET}</Cmd>
            <ul>
              <li>
                Each ARK server uses <strong>three</strong>: its game port, that port plus one, and its query port. All three
                are on the server&rsquo;s Overview tab.
              </li>
              <li>
                <strong>Leave RCON unpublished.</strong> ASMS reaches it from inside the container; exposing it hands your
                admin console to anyone who finds it.
              </li>
              <li>
                Your router still needs the same ports forwarded to this machine — the container only gets them as far as the
                host.
              </li>
            </ul>
            <Cmd>docker compose up -d</Cmd>
            <p className="small faint">Re-run that after editing ports; compose recreates the container in place.</p>
          </div>
        </section>

        <section className="guide-step" id="docker-proton">
          <span className="guide-num">5</span>
          <div className="guide-body">
            <h3>Proton or Wine, on Linux</h3>
            <p>
              Because the server binary is a Windows one, something has to run it. Mount a Proton or Wine install into the
              container and tell ASMS what to put in front of the executable, either in the compose file:
            </p>
            <Cmd>      ASMS_LAUNCH_WRAPPER: "/usr/bin/proton run"</Cmd>
            <p>
              …or under <strong>Settings → Launching</strong>, which does the same thing. Either way the complete command being
              run stays visible on each server&rsquo;s Overview tab, so you can see exactly what the wrapper turned it into.
            </p>
            <p className="small faint">
              If the host is Windows, this is the point at which Docker stops being worth it — <span className="mono">
              start.cmd
              </span>{' '}
              runs the server natively and needs none of this.
            </p>
          </div>
        </section>

        <section className="guide-step" id="docker-secure">
          <span className="guide-num">6</span>
          <div className="guide-body">
            <h3>Set a password, and survive a reboot</h3>
            <p>
              A container is configured by environment rather than by clicking, so{' '}
              <span className="mono">ASMS_PASSWORD</span> in the compose file wins on every start. The file stays the source of
              truth and the setting cannot drift.
            </p>
            <Cmd>      ASMS_PASSWORD: "something-only-you-know"</Cmd>
            <div className="callout danger">
              <Icon.Alert size={15} />
              <div>
                Without one, anyone who can reach port 8787 can start, stop and reconfigure your servers — and read every
                password on the Settings page. Set it before the container is reachable beyond your own machine.
              </div>
            </div>
            <p>
              <span className="mono">restart: unless-stopped</span> is already in the compose file, so Docker brings ASMS back
              by itself — but only once the Docker daemon is running:
            </p>
            <Cmd>sudo systemctl enable docker</Cmd>
            <p>
              Then tick <strong>Start with ASMS</strong> on each server, listed together under{' '}
              <strong>Settings → Starting up</strong>, and a reboot puts the whole cluster back with nobody at the keyboard.
            </p>
          </div>
        </section>
      </div>

      <div className="card-foot">
        <span className="card-hint">
          The README covers the same ground with the compose file beside it, including every environment variable ASMS reads
          at boot.
        </span>
      </div>
    </div>
  );
}
