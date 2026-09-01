import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { settings } from '../lib/store.js';
import { verifyPassword } from '../lib/password.js';
import { logger } from '../lib/log.js';

const log = logger('auth');

/** Tokens live in memory only, so restarting ASMS signs everyone out. */
const tokens = new Map<string, { issuedAt: number; lastSeen: number }>();

/** A session nobody has used for this long is dropped. */
const IDLE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Short-lived, single-use tickets for downloads.
 *
 * A browser cannot put an Authorization header on a plain navigation, so
 * downloads used to carry the session token in the query string - where it
 * lands in access logs, browser history and any reverse proxy in between. A
 * ticket is good for one file, once, for a minute.
 */
const tickets = new Map<string, { path: string; expires: number }>();
const TICKET_MS = 60_000;

export function authRequired(): boolean {
  // Defensive: a database hand-edited to hold a non-string here used to throw
  // out of this function on every request, which meant a 500 on every route
  // including sign-in, with no way back except editing the JSON.
  return String(settings().passwordHash ?? '').length > 0;
}

/**
 * Nobody has answered the password question yet.
 *
 * ASMS used to invent a password on first run and print it to the console -
 * which, for anyone who started it from a shortcut, closed the window, or ran
 * it as a service, meant a sign-in screen asking for a password that existed
 * nowhere. Now first run asks instead, and until it is answered the API is shut
 * apart from the two routes that answer it: an install waiting to be set up is
 * otherwise a remote control for the machine it is on.
 */
export function setupRequired(): boolean {
  return !authRequired() && settings().signInDisabled !== true;
}

// -------------------------------------------------------------- rate limiting

interface Attempts {
  failures: number;
  blockedUntil: number;
}

const attempts = new Map<string, Attempts>();
const FREE_ATTEMPTS = 5;

function clientKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** How long this client must wait, in ms. Zero when they may try now. */
export function loginBlockedFor(req: Request): number {
  const entry = attempts.get(clientKey(req));
  if (!entry) return 0;
  return Math.max(0, entry.blockedUntil - Date.now());
}

function noteFailure(req: Request): void {
  const key = clientKey(req);
  const entry = attempts.get(key) ?? { failures: 0, blockedUntil: 0 };
  entry.failures += 1;
  if (entry.failures > FREE_ATTEMPTS) {
    // 1 minute, then 2, 4, 8… capped at an hour. Long enough that guessing is
    // pointless, short enough that a fat-fingered owner is not locked out.
    const steps = Math.min(entry.failures - FREE_ATTEMPTS - 1, 6);
    entry.blockedUntil = Date.now() + Math.min(60 * 60_000, 60_000 * 2 ** steps);
  }
  attempts.set(key, entry);
  log.warn(`failed sign-in from ${key} (${entry.failures} in a row)`);
}

function noteSuccess(req: Request): void {
  attempts.delete(clientKey(req));
}

// -------------------------------------------------------------------- sessions

export async function login(req: Request, password: string): Promise<string | null> {
  const expected = settings().passwordHash;
  const ok = await verifyPassword(password, expected);
  if (!ok) {
    noteFailure(req);
    return null;
  }
  noteSuccess(req);
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  tokens.set(token, { issuedAt: now, lastSeen: now });
  return token;
}

export function isValid(token: string | undefined): boolean {
  if (!authRequired()) return true;
  if (!token) return false;
  const entry = tokens.get(token);
  if (!entry) return false;
  if (Date.now() - entry.lastSeen > IDLE_TIMEOUT_MS) {
    tokens.delete(token);
    return false;
  }
  entry.lastSeen = Date.now();
  return true;
}

export function logout(token: string | undefined): void {
  if (token) tokens.delete(token);
}

/** Invalidate every session — used when the password changes. */
export function revokeAll(): void {
  tokens.clear();
}

export function tokenFrom(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return undefined;
}

// --------------------------------------------------------------------- tickets

export function issueTicket(path: string): string {
  sweepTickets();
  const ticket = crypto.randomBytes(24).toString('hex');
  tickets.set(ticket, { path, expires: Date.now() + TICKET_MS });
  return ticket;
}

/** Spend a ticket. Returns the path it was issued for, or null. */
export function redeemTicket(ticket: string | undefined, path: string): boolean {
  // The websocket handshake calls this directly, without passing the guard.
  if (setupRequired()) return false;
  if (!authRequired()) return true;
  if (!ticket) return false;
  const entry = tickets.get(ticket);
  if (!entry) return false;
  tickets.delete(ticket); // single use, spent either way
  if (entry.expires < Date.now()) return false;
  return entry.path === path;
}

function sweepTickets(): void {
  const now = Date.now();
  for (const [key, entry] of tickets) if (entry.expires < now) tickets.delete(key);
}

// ----------------------------------------------------------------------- guard

/** Routes reachable without a session. */
const OPEN_PATHS = new Set(['/auth/login', '/auth/status']);

/** All that is reachable before the first-run question has been answered. */
const SETUP_PATHS = new Set(['/auth/status', '/auth/setup']);

export function guard(req: Request, res: Response, next: NextFunction): void {
  if (setupRequired()) {
    if (SETUP_PATHS.has(req.path)) return next();
    res.status(401).json({ error: 'ASMS has not been set up yet. Open the dashboard to choose a password.' });
    return;
  }
  if (!authRequired()) return next();
  if (OPEN_PATHS.has(req.path)) return next();

  // Downloads arrive as plain navigations and carry a one-shot ticket instead.
  if (req.method === 'GET' && typeof req.query.ticket === 'string') {
    if (redeemTicket(req.query.ticket, req.path)) return next();
    res.status(401).json({ error: 'That download link has expired. Try it again from the dashboard.' });
    return;
  }

  if (isValid(tokenFrom(req))) return next();
  res.status(401).json({ error: 'Not signed in' });
}
