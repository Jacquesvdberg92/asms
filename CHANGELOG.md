# Changelog

Notable changes to ASMS. Dates are the day the change landed.

## [0.3.4] — 2026-09-02

0.3.3 stopped ASMS from corrupting the player id. This one stops it sending the wrong id
altogether: `GiveItemToPlayer` takes the numeric Player ID, and nothing on the player list is it.

### Fixed
- **Gear is aimed with the numeric Player ID, which is the only id the command takes.** ARK keeps
  two per player: the nine or ten digit Player ID the in-game Admin Manager shows, and the
  thirty-two character EOS id `ListPlayers` reports. `GiveItemToPlayer` takes the first and refuses
  the second, and Ascended has no RCON command that converts one into the other — 0.3.3 had ASMS
  handing over the EOS id, which could never have worked. Picking a name now asks for their Player ID
  once, says where to read it (`cheat showadminmanager` → click the player → **Player ID**), and
  remembers it for as long as the tab is open
- **An id that cannot work is refused with the reason, before the command goes out.** Paste a long
  id full of letters and ASMS says that is the EOS one and this command will not take it, rather than
  sending it and leaving you with `Server received, But no response!!` to interpret
- **A second form of the give, for RCON stacks that mangle nested quotes.** Some choke on the single
  quotes inside the double ones in `"Blueprint'…'"`, and ARK accepts the bare asset path too, so the
  give dialog offers **Copy without the wrapper** alongside the normal one

## [0.3.3] — 2026-09-02

Gear could never have arrived. ASMS was deleting the letters out of the player id before it sent
it, so every give went out addressed to a number that was nobody.

### Fixed
- **The box for pasting a player id was stripping every letter out of it.** Ascended identifies
  players by a thirty-two character EOS id — hex, so roughly a third of it is letters — and the input
  quietly dropped all of them as you pasted. What survived was a twenty-three digit number belonging
  to no one, and `GiveItemToPlayer` was then sent that, answered `Server received, But no response!!`
  and delivered nothing. It keeps what you paste now
- **Picking a player off the live list said "That does not look like a platform id".** ASMS asked the
  server to translate the id first, with `GetPlayerIDForSteamID` — an Evolved-era command that expects
  a Steam id and has nothing to do with an EOS one. It never got that far: the id failed ASMS's own
  check on the way out, which only accepted digits while the id it was checking was hex. So clicking a
  name always failed, and blamed the name. Nothing is translated now — the id `ListPlayers` reported
  is used exactly as it stands
- The same digits-only rule is gone from the API, which now takes a player id of 5 to 40 hex
  characters and quotes back what it rejected instead of a flat refusal

## [0.3.2] — 2026-09-02

The first server anybody added failed to download. Every time, on every fresh install. SteamCMD
needs one run to finish installing itself, and ASMS was asking it for a 12 GB game on that run.

### Fixed
- **Adding a server no longer fails the first time you do it.** The `steamcmd.exe` inside Valve's zip
  is a 2013-era updater, not the client: its first run downloads the real client, unpacks it, restarts
  into it and carries on with whatever it was handed — but the client it has only just unpacked has no
  app configuration yet, so the `app_update` in that same run died with `Failed to install app
  '2430930' (Missing configuration)`. So every brand-new ASMS met **SteamCMD failed** on the first
  server it was asked for, and worked the moment you pressed the button again, which is not something
  anybody should have to discover for themselves. ASMS now runs SteamCMD once with nothing riding on
  it, right after unpacking it, so the download that follows is the second run
- A SteamCMD that was already on disk — pointed at by hand under **Settings → Folders**, or left by an
  older ASMS that never warmed one up — gets one automatic retry when it reports that same
  "Missing configuration", instead of an error nobody can act on. Every other failure is reported the
  first time, exactly as before

- **RCON commands and their replies are written to the Console tab.** Pressing Give, Send or a kit
  button left no trace anywhere — not in the console, not in the log — so a command that silently did
  nothing looked exactly like one that was never sent, and there was nothing to go back and read
  afterwards. Every command a person sets off is now echoed with its reply. ASMS's own polling
  (`ListPlayers` every few seconds, the readiness knock while a server boots) stays out of it
- **`Server received, But no response!!` is explained instead of just printed.** That is ARK saying it
  ran the command and printed nothing — its normal answer to most admin commands, and equally what
  comes back when the command could not do anything at all. The Spawn tab now says so where the reply
  is shown, rather than leaving a sentence that reads like a fault
- **The Spawn tab stops leading with a button that cannot work.** `GMSummon` places the creature at
  whoever ran the command, and an RCON session is not standing anywhere on the map — so **Copy for the
  in-game console** is now the primary action on a creature, the RCON attempt is a quiet secondary, and
  the reason is spelled out in the dialog instead of hidden in a tooltip. The dialog also covers handing
  a spawned creature to somebody else with `cheat GiveToMe`
- **A player whose id will not translate is no longer told they picked wrong.** `GetPlayerIDForSteamID`
  is an Evolved-era command that expects a Steam id, and Ascended lists players by their EOS id, so it
  cannot convert one. ASMS now says where the UE4 Player ID actually comes from — the in-game pause
  menu, or `cheat showadminmanager` — rather than reporting that the name could not be resolved

### Added
- **Tagging a version now publishes the release.** 0.3.0 and 0.3.1 were tagged and pushed, and neither
  ever appeared on the Releases page — so anyone following the Quick start downloaded 0.2.1 while the
  repository was two releases ahead of it. Pushing a `v*` tag now typechecks, tests and builds that
  tag and then publishes a GitHub release, with that version's section of this changelog as the notes


## [0.3.1] — 2026-09-02

Every page with a switch on it could be scrolled off the screen entirely, sidebar and all, into
blank space below. One missing CSS property, present since the first public release.

### Fixed
- **You could scroll the whole app off the screen into blank space.** Every page with a switch on it
  — Settings worst of all, but also Console, Mods, Logs and the dashboard — could be scrolled past
  the end of its content until the sidebar and everything else had gone and nothing was left. The
  hidden checkbox inside each toggle is positioned off the visible track, but the label around it was
  never marked as its positioning parent, so the browser measured it against the whole document
  instead. A switch far down a long page therefore parked an invisible box at that depth in page
  coordinates and stretched the document to reach it — on Settings, 1209px of nothing below the fold.
  Present since the first public release
- **The Spawn tab had a scrollbar inside a scrollbar.** The creature and gear grids capped themselves
  at 58% of the window height and scrolled internally, so the wheel moved the grid until it bottomed
  out and then jumped the page, and the box sat mostly below the fold — you scrolled the page to
  reach a list you then had to scroll again. They now flow with the page and it scrolls once, the way
  the ninety game settings and the setup guide already did

## [0.3.0] — 2026-09-02

A creative server run for a child should not require anybody to memorise
`Rex_Character_BP_C`. This release adds a Spawn tab that turns the two admin commands nobody
enjoys typing — `GMSummon` and the give family — into a searchable list you click.

### Added
- **A Spawn tab on every server**, for the creative servers people run for their kids: 237 creatures
  and 325 pieces of gear, picked from a searchable, grouped list rather than typed from memory.
  Choose Rex, set the level, and ASMS writes `cheat GMSummon "Rex_Character_BP_C" 150` — no
  hunting for a class name, no typo that spawns nothing and says nothing
- **Gear is handed over, not dictated.** Pick a connected player and press Give: ASMS asks the
  server to translate their platform id into the internal UE4 id ARK actually wants, then runs
  `GiveItemToPlayer`. The item lands in their inventory and nobody has typed anything. A box for
  pasting an id covers someone who is offline or will not resolve
- **Creatures are honest about the limit ARK imposes.** `GMSummon` spawns at whoever ran it, and
  an RCON session is nobody standing anywhere, so the tab writes the line out to paste into the
  in-game console instead of pretending. Send is still offered, and the server's reply is always
  shown verbatim — ARK answers most admin commands with silence, which reads as failure otherwise
- **Kits** — starter, taming, builder, flak, full Tek, explorer — send a dozen gives in one press.
  New `POST /servers/:id/rcon/batch` runs them in order down the one RCON socket and reports which
  landed, rather than stopping at the first refusal
- Level presets at 5 / 30 / 75 / 150 / 224 / 300, a tamed-or-wild switch, quality and blueprint
  options on every give, and a Dododex link on every creature
- The Spawn tab is on Ctrl-K like every other tab, and reachable at `/servers/:id/spawn`
- Items whose blueprint path could not be confirmed are marked *console only*: a wrong path makes
  `GiveItemToPlayer` report success and deliver nothing, so ASMS offers the reliable `GFI` line
  for those instead of a give that quietly fails
- Credit where it is due: the Spawn tab and the README both name their sources. The ids are ARK's
  own, checked against the ARK Official Community Wiki; [Dododex](https://www.dododex.com/) is
  linked from every creature rather than copied, since taming times and stats are theirs


## [0.2.1] — 2026-09-01

Two ways a brand-new install could stop before it started: a first run that asked for a
password nobody had been given, and a `start.cmd` that failed on npm's own error message
when it was launched from inside the downloaded zip.

### Fixed
- **`start.cmd` explains an unextracted zip instead of failing at `npm install`.** Windows
  browses a zip as though it were a folder, and double-clicking `start.cmd` there copies out
  that one file to a temp folder and runs it with nothing else beside it. All you saw was npm's
  own complaint — `ENOENT ... asms-main.zip.4d7\asms-main\package.json` under "Something went
  wrong during setup" — which says nothing about the actual mistake. start.cmd now checks that
  `package.json` is next to it before doing anything, prints the folder it ran from, and says
  to extract the zip first
- **First run asks for a password instead of inventing one.** ASMS used to generate a password and
  print it to the console once. Anyone who started it from a shortcut, ran it as a service, or
  pulled a fresh copy from GitHub met a sign-in screen asking for a password that existed nowhere,
  with hand-editing `data/asms.json` as the only way in. Now the first time the dashboard is opened
  it asks you to choose one — or to say out loud that you want to run without one
- Until that question is answered every route except it answers 401, so an install waiting to be
  set up is not a remote control for the machine it is on
- Forgetting the password now has a documented way back: empty the `passwordHash` field in
  `data/asms.json`, restart, and ASMS offers to set a new one rather than coming back up open
- A database that predates this — including one where the password was cleared by hand — is asked
  the question once on the next start. Answering "no password" is remembered
- `ASMS_NO_PASSWORD=1` for containers that are meant to run open, where nobody is at a browser to
  answer. `ASMS_PASSWORD` is unchanged and still wins on every start

## [0.2.0] — 2026-09-01

Two halves. The mod and quick-action work that had been sitting unreleased,
and a hardening pass: a full read of the codebase turned up 29 issues and this
fixes all of them. Nothing in the second half changes what ASMS does — it
changes what happens when something goes wrong.

### Quick actions
- A Quick actions card on Overview and Console: save the world, list players, read server info
  and the MOTD, jump the in-game clock to dawn, morning, noon, dusk, night or any time you pick,
  broadcast to everyone, and wipe wild creatures, every tame, or one species
- Four of the same actions on each dashboard card — save, broadcast, set the time, wipe wild —
  shown only while RCON is answering
- `DestroyAllTamedDinos` and `DestroyAllEnemies` added to the RCON command reference

### Mods
- **Download mods now** boots the server purely to fetch its mods, reports how many have landed,
  and shuts it down again as soon as they are all on disk. Cancellable
- **Force re-download** deletes what ARK unpacked for one mod, including anything stranded in
  `.temp`, so it stops mistaking a dead download for a finished one
- A Files column showing what is actually on disk per mod: size, CurseForge build id and date,
  or whether it is missing, half-downloaded, or stuck in `.temp`
- An empty mod folder now reads as a half-download rather than a success — the state that let a
  broken mod hide in plain sight
- Failure messages name the mods: "a mod would not load" is now "Better Breeding (941697) is only
  half-downloaded". Check mods adds ordered next steps and quotes ARK's own words from its log
- A mod ARK **refused outright** is now told apart from one that merely failed to arrive. ASMS
  reads `Mods not installed: <id>` out of ARK's log and says so plainly: CurseForge served nothing
  for that id, so re-downloading cannot help. Force re-download is hidden for those, replaced by a
  link to `curseforge.com/projects/<id>`, which redirects to whatever that id really is
- **PC-only server** (`-ServerPlatform=PC`) added to the launch flags. CurseForge never serves a
  mod marked `[PC Only]` to a cross-platform server, which is the most common reason an id that
  looks perfectly valid never downloads and takes the server down with it

### Updating ASMS itself
- **Update and restart** — pulls, reinstalls, rebuilds and restarts ASMS on its own. The page
  waits out the gap and reloads itself once ASMS answers again. ARK servers keep running
  throughout, and ASMS reattaches to them when it comes back
- **Restart ASMS** on its own, for when you just want a clean restart
- **Update only** is still there for anyone who would rather choose their own moment

### Fixed
- Updating on Windows failed at `npm install` with "spawn EINVAL" — Node will not spawn a `.cmd`
  shim without a shell — leaving the tree pulled but not built
- `package-lock.json` was committed with entries no manifest asks for, so `npm install` pruned
  them and every install looked like a folder with local changes, which the updater refused to
  touch. It also no longer counts that generated file as your work
- The launch wrapper split on the letter "s" instead of on whitespace, breaking Proton and Wine
  wrapper paths that contained one

### Security

- **The API no longer sends `Access-Control-Allow-Origin: *`.** The dashboard is
  served from the same origin and never needed CORS. With it, any page in any
  tab could call the API and read the answer — list your servers, read admin and
  RCON passwords out of `/api/state`, stop or delete things. It also made
  "bind to 127.0.0.1" no protection at all, because the attacking page runs on
  this machine too
- **A password is set on first run** and printed once to the console, rather than
  starting wide open with a warning nobody running detached would see. Clear it
  under Settings → Access if you genuinely want it open
- **`docker-compose.yml` publishes the dashboard on `127.0.0.1` by default.**
  Change it to `8787:8787` to reach it from a phone — after setting `ASMS_PASSWORD`
- **The dashboard password is stored as a scrypt hash**, not in the clear, and is
  never sent to a browser. Existing passwords are hashed automatically on first
  start; nobody has to re-enter anything. The Settings page only sends a password
  when you type a new one
- **Failed sign-ins are rate limited** — five free attempts, then a doubling
  lockout capped at an hour, and every failure is logged
- **Downloads and the websocket use one-shot tickets** instead of putting the
  session token in a URL, where it lands in access logs and browser history
- Backup restore refuses any archive entry that would write outside the
  destination
- A malformed or oversized request body no longer answers with an HTML stack
  trace carrying the filesystem paths of the install. `express.json()` rejects
  the body before the router is reached, so the router's own error handling
  never saw it; `/api` now has the last word and replies in JSON

### Fixed

- **Backups are streamed to disk** instead of being built in memory. The old
  writer held every save file *and* the finished archive as Buffers, which does
  not degrade on a real world — it kills the process, unattended, on the
  scheduled-backup path
- **`PUT /api/settings` validates its input.** `{"password": 12345}` used to be
  saved to disk and then throw out of the auth check on every request from the
  next boot on: a permanent 500 on every route, sign-in included, fixable only
  by hand-editing `asms.json`
- **Pid files carry a process fingerprint.** After an unclean shutdown the OS
  recycles pids, and ASMS would adopt whatever now held the number — showing a
  stopped server as running, and killing an unrelated process tree on Stop
- **"Port already in use" says so** instead of exiting on a raw Node stack trace
- **Schedules are validated on the way in.** An unknown action reported "ok" and
  did nothing, a missing server was only found at run time, and a malformed
  `warnMinutes` either skipped the player countdown entirely or threw out of the
  tick loop — silently stopping every task after it
- **A cron that can never fire is refused**, e.g. the 31st of February. It used
  to save fine and cost 1.3 seconds of blocked event loop per dashboard load
- `killTree` kills the whole process group on Linux, so a Proton-wrapped server
  no longer survives being stopped and keeps the game port
- The RCON read buffer is reset on reconnect, so leftover bytes from a dropped
  connection cannot desync the next reply
- `start()` cannot spawn two servers on one port when two requests land together
- An uncaught exception now flushes the database and exits instead of carrying on
- Restoring a backup warns when it replaces your dashboard password, revokes
  open sessions, and keeps this machine's listen address and port
- The dashboard no longer opens a second websocket on reconnect, which was
  printing every console line twice
- Clearing the port field no longer saves port 0
- The Discord webhook honours a port in the URL, is validated when saved, and has
  a **Send test** button

### Changed

- ASMS's own log rolls over at midnight and prunes anything older than 30 days
- The mod status check is cached, and the stats poll reuses one PowerShell
  process instead of spawning a fresh one every five seconds forever
- The Logs tab stops polling while the tab is hidden or the server is stopped
- Deleting a server's files refuses anything that is not plainly a server folder
- `findFreePort` throws instead of returning a port it just found to be busy
- The SteamCMD download caps redirects, checks the host, and writes to a `.part`
  file so a failed attempt cannot leave a truncated zip behind
- Backup reconciliation now adopts zips it finds in the backup folder, which is
  what its comment always claimed — so copying a backups folder across works
- `asms.json` is fsynced before the rename, so a power cut cannot leave it empty
- API errors carry a real status: 404 for missing, 409 for wrong state, and a
  logged 500 for anything unexpected instead of leaking internals as a 400
- The unused `theme` setting is gone; only `accent` was ever read
- ESLint runs in CI, and the `eslint-disable` comments scattered through the code
  finally mean something
- 21 new tests covering settings validation, password hashing, cron, the delete
  guard and zip extraction — the perimeter where every bug above lived
- `adm-zip` replaced with `yazl`/`yauzl`; the dashboard shows the version number
  an update would bring, not just a commit count
- The dashboard says "Cannot reach ASMS" instead of spinning forever when the
  server is not answering

### Verified

Beyond the 109 unit tests, this release was exercised against a running ASMS:

- **A 2.11 GB world, 603 files, backed up and restored under a 470 MB heap
  cap.** Peak RSS 231 MB, and every file came back byte-for-byte. The old
  in-memory writer would have needed several gigabytes; this is the change with
  the most to lose and it is now measured rather than assumed.
- **The same 2 GB world over HTTP**, through the real endpoints: create a
  server, write a curated setting and confirm it in the INI on disk, back up,
  delete a 0.94 GB map file, restore it, then delete the server and confirm the
  world was left alone. The ASMS process sat at 156 MB throughout.
- **A real RCON conversation** over a socket: handshake, a reply reassembled
  from two packets, player parsing, and a wrong password reported as an
  authentication failure rather than "not listening".
- **A scheduled backup firing on the clock** — the unattended path, end to end,
  landing a zip on disk and recording `ok`.
- **A 0.1.x database migrating**: it boots, the existing password still signs
  in, and the file is rewritten hashed with every other setting preserved.

Not covered: a live ARK server, a real SteamCMD run, and the Linux
process-group kill, which needs a Linux host. CI builds the Docker image on
every push.

## [0.1.0] — 2026-08-31

First public release.

### Servers
- Create servers with a five-step wizard that picks free ports and warns about conflicts
- Install, update and verify server files through SteamCMD, with live cancellable progress
- Start, stop and restart, with a graceful shutdown that saves the world over RCON first
- Scheduled restarts with in-game countdown warnings that land exactly on the scheduled time
- Auto-start after a reboot, and auto-restart after a crash
- The full launch command is always visible, never hidden behind the UI

### Mods
- Reorderable load order with per-mod enable, name, author, project ID and link
- Paste and copy whole mod lists; a saved library of the mods you reuse
- A diagnosis that names which mod never downloaded, instead of ARK's "requested mods failed
  to load"

### Cluster, config and data
- Cluster IDs and transfer folders across servers
- All ~90 game settings with search, plus raw INI editing
- Saved setups and play-style presets
- Backups with retention, and a full export/import for moving to another PC

### Interface
- Web dashboard reachable from a phone on the LAN, optional password
- Ctrl-K searches every server, setting, launch flag, RCON command and guide section
- Live console and log tailing over websockets
- Docker image and compose file alongside the Windows `start.cmd`

### Fixed before release
- **Mod installs failed silently on long install paths.** ARK unpacks a CurseForge mod about
  164 characters below the install folder, and Windows refuses to create a directory past 247.
  A server installed somewhere deep would install, boot and run perfectly while every mod
  download died with "Unable to create a directory". ASMS now measures the folder when you
  choose it, warns past 71 characters and refuses past 95, and the mod diagnosis blames the
  path rather than the mods.
- **Every mod reported as "never downloaded".** The installed-mod scan read one directory level
  too shallow for CurseForge layouts, finding CurseForge's game id (`83374`) and mistaking it
  for a mod id. Both the CurseForge and SteamCMD layouts are now read correctly.

### Added before release
- **Settings → ASMS version**, which checks the repository for newer commits and can pull,
  reinstall and rebuild in place.

### Fixed by the first CI run
- **`npm test` did not run at all on Windows with Node 20.** The test script relied on the shell
  expanding `src/tests/*.test.ts`; cmd.exe does not, and Node only began expanding globs itself in
  v22. On the most likely setup for a gaming PC inside our supported range, the whole suite failed
  with "Could not find". The file list is now built by `scripts/run-tests.mjs`, which behaves the
  same everywhere.
- **Log filename sanitising differed by platform.** `path.basename` only treats `\` as a separator
  on Windows, so a Windows-style name reaching the Linux build was kept whole instead of being
  reduced to its last segment. Nothing escaped the log directory either way — the prefix check
  held — but the two hosts no longer disagree about what the same input means.
