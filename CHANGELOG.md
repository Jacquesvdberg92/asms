# Changelog

Notable changes to ASMS. Dates are the day the change landed.

## [Unreleased]

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
