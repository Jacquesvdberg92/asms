# Security

## What ASMS is, in security terms

ASMS is a control panel for processes on your own machine. Anyone who can reach its web UI can
start and stop your ARK servers, read and write their configuration, run arbitrary RCON
commands, and read your admin passwords. Treat access to the dashboard as equivalent to access
to the machine's game servers.

## Running it safely

- **Default is local-only.** Out of the box ASMS binds to `127.0.0.1`, reachable only from the
  PC it runs on. This is the right setting if you never leave the desk.
- **Set a password before you widen it.** If you switch the bind address to `0.0.0.0` so you can
  manage servers from your phone, set a dashboard password in **Settings → Access** first.
  ASMS will warn you, but it will not stop you.
- **Do not port-forward the dashboard.** ASMS is designed for your LAN. To reach it from
  outside the house, use a VPN (Tailscale, WireGuard) rather than exposing port 8787 to the
  internet. It has no rate limiting, no account system, and no audit log.
- **`data/` holds secrets.** `data/asms.json` contains your ARK admin, spectator and RCON
  passwords in plain text, because ARK itself needs them in plain text in its INI files. The
  folder is gitignored. Redact it before attaching anything from it to an issue.
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
and plain-text passwords in `data/`, which ARK's own file formats require.
