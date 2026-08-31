/**
 * Cluster IDs are a shared name in a namespace nobody owns: ARK matches
 * servers on this string and nothing else, so "1" is the same "1" that a
 * hundred other people used for their own test cluster, and the transfer
 * screen fills up with servers that are not yours.
 *
 * A generated ID is twelve random characters - about 60 bits - which nobody
 * else is going to type by accident.
 */

// No l/1/I/0/O: this gets read off a screen and retyped on a friend's PC.
const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

export function randomClusterId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `ark-${out}`;
}

/** IDs everybody reaches for first, and so the ones most likely to collide. */
const OBVIOUS = new Set([
  '0',
  '1',
  '2',
  '12',
  '123',
  'abc',
  'ark',
  'asa',
  'asms',
  'cluster',
  'default',
  'main',
  'server',
  'test',
]);

/**
 * Empty unless the ID is one somebody else is plausibly using too. Deliberately
 * a nudge rather than a block - it is a valid ID, it is just a crowded one.
 */
export function clusterIdWarning(id: string): string {
  const value = id.trim().toLowerCase();
  if (!value) return '';
  if (OBVIOUS.has(value) || value.length < 5) {
    return 'Short, obvious IDs like this are the ones everyone else picks too — and ARK has no other way of telling clusters apart. Roll a random one instead.';
  }
  return '';
}
