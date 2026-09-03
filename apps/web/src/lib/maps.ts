/**
 * A map code is the first thing on ARK's command line -
 * `TheIsland_WP?listen?Port=7777` - and everything after it is split on `?`.
 * So a stray space or question mark inside the code does not fail loudly: it
 * becomes a different option, and the server boots somewhere nobody asked for
 * or refuses to boot at all.
 *
 * Every real code, official or from a mod, is the level's asset name: letters,
 * digits and underscores.
 */
const MAP_CODE = /^[A-Za-z0-9_]+$/;

/** Empty when the code is usable, which is the only thing the form asks. */
export function mapCodeError(code: string): string {
  const value = code.trim();
  if (!value) return 'A map code is needed - it is the level ARK loads.';
  if (!MAP_CODE.test(value)) {
    return 'Map codes are letters, digits and underscores only, the way TheIsland_WP is. No spaces, no question marks, no folder path.';
  }
  return '';
}
