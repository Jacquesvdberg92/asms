# Contributing to ASMS

Bug reports and pull requests are welcome. This is a hobby project run by people who would
rather be playing ARK, so the bar is "does it help someone run their server" rather than
anything ceremonial.

## Getting set up

You need [Node.js](https://nodejs.org) 20 or newer. Nothing else — ASMS deliberately has **no
native dependencies**, so `npm install` never needs a C compiler on a gaming PC.

```bash
git clone https://github.com/Jacquesvdberg92/asms.git
cd asms
npm install
npm run dev
```

`npm run dev` runs the API on `http://localhost:8787` and the Vite dev server on
`http://localhost:5173`, with hot reload on both. Open the Vite one.

ASMS writes everything it owns into `data/` — config, logs, pid files, and the SteamCMD it
downloads. That folder is gitignored and holds your admin and RCON passwords, so never commit
it. To run against a scratch config instead, set `ASMS_DATA`:

```bash
ASMS_DATA=/tmp/asms-scratch npm run dev
```

## Before you open a pull request

```bash
npm run typecheck
npm test
npm run build
```

All three must pass. CI runs them on Windows and Linux against Node 20 and 22, plus a Docker
build.

## How the code is laid out

| Path | What lives there |
| --- | --- |
| `apps/server/src/api` | HTTP routes and auth. Thin — logic belongs in `core`. |
| `apps/server/src/core` | Servers, backups, schedules, config, setups, self-update. |
| `apps/server/src/lib` | Hand-written primitives: RCON, INI, SteamCMD, process, paths. |
| `apps/web/src/pages` | One file per screen. |
| `apps/web/src/components` | Shared UI. `ui.tsx` holds the primitives. |
| `apps/web/src/lib` | Client-side helpers, plus mirrors of server types. |

Two mirrors need keeping in sync by hand, and both say so at the top of the file:
`apps/web/src/lib/types.ts` mirrors `apps/server/src/types.ts`, and
`apps/web/src/lib/paths.ts` mirrors the install-path rules in `apps/server/src/lib/paths.ts`.

## House style

- **No native dependencies.** The RCON client, INI reader/writer, cron engine and SteamCMD
  driver are all hand-written for this reason. Adding one that needs `node-gyp` will be
  declined.
- **Comments explain why, not what.** If a line looks strange, the comment should say what
  broke to make it that way. Most of the existing comments name a real failure.
- **Error messages are sentences.** "Install folder path is too long" is not enough; say what
  will happen, and what to do instead. Users of this software are mid-crisis with a server
  full of friends.
- **One way to do each thing.** Before adding a coloured `<div>` for a warning, check
  `Callout`. Before adding a length check, check `lib/paths.ts`.
- Match the surrounding code's naming and density rather than importing habits from elsewhere.

## Tests

`node --test` with no framework. Put new tests next to the ones they resemble in
`apps/server/src/tests/`. The most useful tests here are the ones that pin a real failure —
`paths.test.ts` reproduces an actual path Windows refused to create, character for character,
so the model can never silently drift from reality.

## Reporting bugs

Open an issue with the server's `ShooterGame.log` excerpt if ARK is involved, ASMS's own log
from `data/logs/`, and your OS. **Redact your admin and RCON passwords** — they appear in some
log lines and in `data/asms.json`.
