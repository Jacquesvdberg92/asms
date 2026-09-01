import crypto from 'node:crypto';

/**
 * The dashboard password, stored as a hash rather than as itself.
 *
 * It used to sit in asms.json in the clear, and travel back out in every
 * `/api/state` and every websocket hello - so it was in the response of a
 * routinely-called endpoint, in browser memory, and one mistake away from being
 * readable. A hash cannot be handed back by accident.
 *
 * scrypt because it ships with Node: no dependency, and deliberately slow
 * enough that a stolen asms.json is not a password list.
 */

const N = 16384;
const R = 8;
const P = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

/** Empty means "no password set", which is how auth is switched off. */
export type PasswordHash = string;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem has to be raised by hand: the default is below what N=16384 needs.
    crypto.scrypt(password, salt, KEY_BYTES, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  if (!password) return '';
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Check a candidate against a stored hash.
 *
 * Returns false for anything it cannot parse, so a corrupted or hand-edited
 * hash locks the dashboard rather than opening it.
 */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) return false;

  let expected: Buffer;
  let salt: Buffer;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(keyB64, 'base64');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;

  const actual = await new Promise<Buffer | null>((resolve) => {
    crypto.scrypt(password, salt, expected.length, { ...cost, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      resolve(err ? null : key),
    );
  });
  if (!actual || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/** Is this string already one of our hashes, or a plaintext password to migrate? */
export function isHash(value: unknown): boolean {
  return typeof value === 'string' && /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/.test(value);
}
