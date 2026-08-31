# Changelog

Notable changes to ASMS. Dates are the day the change landed.

## [Unreleased]

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
