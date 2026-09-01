# Security

## What ASMS is, in security terms

ASMS is a control panel for processes on your own machine. Anyone who can reach its web UI can
start and stop your ARK servers, read and write their configuration, run arbitrary RCON
commands, and read your admin passwords. Treat access to the dashboard as equivalent to access
to the machine's game servers.

## Running it safely

- **Default is local-only.** Out of the box ASMS binds to `127.0.0.1`, reachable only from the
  PC it runs on. This is the right setting if you never leave the desk. The Docker image binds
  `0.0.0.0` inside the container and publishes on `127.0.0.1`, which comes to the same thing.
- **A password is set for you on first run.** ASMS generates one, prints it to the console once,
  and stores only a scrypt hash of it. Change it or clear it under **Settings → Access**.
  Clearing it switches sign-in off entirely, which is yours to choose.
- **Set a password before you widen it.** If you switch the bind address to `0.0.0.0` so you can
  manage servers from your phone, make sure a dashboard password is set first. ASMS will warn
  you, but it will not stop you.
- **Do not port-forward the dashboard.** ASMS is designed for your LAN. To reach it from
  outside the house, use a VPN (Tailscale, WireGuard) rather than exposing port 8787 to the
  internet. Sign-ins are rate limited and failures are logged, but there is still no account
  system and no audit trail of what was done once someone is in.
- **`data/` holds secrets.** `data/asms.json` contains your ARK admin, spectator and RCON
  passwords in plain text, because ARK itself needs them in plain text in its INI files. The
  dashboard password is the exception — that one is a hash. The folder is gitignored. Redact it
  before attaching anything from it to an issue.
- **Backups contain the same secrets.** An exported archive from **Backup & migrate** carries
  your server configuration. Treat the file accordingly.

## Reporting a vulnerability

Please report security issues privately rather than in a public issue: open a
[security advisory](../../security/advisories/new) on this repository.

Include what an attacker would need (LAN access? a valid session? nothing?) and what they get.
Expect a reply within a week or so — this is a hobby project, not a funded one.

## Scope

In scope: authentication bypass, remote code execution, path traversal out of the configured
folders, secrets leaking to somewhere they should not be, and cross-site scripting in the
dashboard.

Out of scope: anything that requires already having administrator access to the host machine,
and the deliberate design decisions above — local-only-by-default with an opt-in to LAN access,
and plain-text *ARK* passwords in `data/`, which ARK's own file formats require. The dashboard
password itself is hashed; a report that it is recoverable from `data/` is in scope.
