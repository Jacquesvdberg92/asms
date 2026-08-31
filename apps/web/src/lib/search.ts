/**
 * The ranking behind the Ctrl-K box.
 *
 * It has to cope with three quite different habits at once: people who know
 * the exact name ("Backups"), people who half remember a word from the middle
 * of it ("taming"), and people who type the thing they are trying to achieve
 * rather than its label ("port forward", "wipe", "lag"). The first two are
 * substring work; the third is why every entry carries keywords, and why a
 * keyword hit still ranks below a real name hit.
 */

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Are the query's letters spread through the text in order? Cheap fuzzy match
 * that catches "gmsts" for "Game settings", scored by how tightly packed the
 * hits are so a coincidental scatter loses to a real abbreviation.
 */
function subsequence(query: string, text: string): number {
  let ti = 0;
  let gaps = 0;
  let last = -1;
  for (const ch of query) {
    const found = text.indexOf(ch, ti);
    if (found === -1) return 0;
    if (last >= 0) gaps += found - last - 1;
    last = found;
    ti = found + 1;
  }
  return Math.max(1, 40 - gaps);
}

/**
 * 0 means "do not show this at all". Anything above is a rank, and the bands
 * are deliberately far apart so a name match can never be pushed under a
 * keyword match by length alone.
 */
export function score(query: string, label: string, keywords = ''): number {
  const q = norm(query);
  if (!q) return 1;
  const text = norm(label);
  const keys = norm(keywords);

  if (text === q) return 1000;
  if (text.startsWith(q)) return 820 - Math.min(60, text.length);
  if (text.split(/[^a-z0-9]+/).some((word) => word.startsWith(q))) return 700 - Math.min(60, text.length);

  const at = text.indexOf(q);
  if (at >= 0) return 560 - Math.min(50, at);
  if (keys.split(/[^a-z0-9]+/).some((word) => word.startsWith(q))) return 420;
  if (keys.includes(q)) return 380;

  // Several words typed at once: they may be split across name and keywords.
  const terms = q.split(' ');
  if (terms.length > 1) {
    const both = `${text} ${keys}`;
    if (terms.every((term) => both.includes(term))) return 340;
  }

  const fuzzy = subsequence(q.replace(/ /g, ''), text);
  return fuzzy ? 150 + fuzzy : 0;
}

/** Rank a list, drop the misses, and keep ties in the order they were given. */
export function rank<T>(query: string, items: T[], of: (item: T) => { label: string; keywords?: string }): T[] {
  return items
    .map((item, index) => {
      const { label, keywords } = of(item);
      return { item, index, points: score(query, label, keywords) };
    })
    .filter((row) => row.points > 0)
    .sort((a, b) => b.points - a.points || a.index - b.index)
    .map((row) => row.item);
}

/** Plain substring filter for the in-page find boxes, which want no cleverness. */
export function matches(query: string, ...fields: Array<string | undefined>): boolean {
  const q = norm(query);
  if (!q) return true;
  const hay = norm(fields.filter(Boolean).join(' '));
  return q.split(' ').every((term) => hay.includes(term));
}
