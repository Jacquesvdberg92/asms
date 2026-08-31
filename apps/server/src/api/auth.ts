import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { settings } from '../lib/store.js';

/** Tokens live in memory only, so restarting ASMS signs everyone out. */
const tokens = new Set<string>();
const SESSION_SECRET = crypto.randomBytes(32);

export function authRequired(): boolean {
  return settings().password.trim().length > 0;
}

export function login(password: string): string | null {
  const expected = settings().password;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const token = crypto.createHmac('sha256', SESSION_SECRET).update(crypto.randomBytes(16)).digest('hex');
  tokens.add(token);
  return token;
}

export function isValid(token: string | undefined): boolean {
  if (!authRequired()) return true;
  return !!token && tokens.has(token);
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
  const q = req.query.token;
  return typeof q === 'string' ? q : undefined;
}

export function guard(req: Request, res: Response, next: NextFunction): void {
  if (!authRequired()) return next();
  if (req.path === '/auth/login' || req.path === '/auth/status') return next();
  if (isValid(tokenFrom(req))) return next();
  res.status(401).json({ error: 'Not signed in' });
}
