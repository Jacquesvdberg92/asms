/**
 * A forgiving INI reader/writer for ARK config files.
 *
 * ARK's INIs are not standard INI: keys repeat (OverrideNamedEngramEntries,
 * ConfigOverrideItemMaxQuantity, ...), values contain '=' and unbalanced
 * punctuation, and Wildcard rewrites the file on shutdown. So we keep the file
 * as an ordered line list and only touch the lines we actually change —
 * comments, ordering and unknown keys survive a round trip untouched.
 */

export type IniLine =
  | { kind: 'section'; name: string; raw: string }
  | { kind: 'kv'; section: string; key: string; value: string; raw: string }
  | { kind: 'raw'; section: string; raw: string };

export interface IniDoc {
  lines: IniLine[];
  eol: string;
}

export function parseIni(text: string): IniDoc {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines: IniLine[] = [];
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    const sec = /^\[(.*)\]$/.exec(trimmed);
    if (sec) {
      section = sec[1];
      lines.push({ kind: 'section', name: section, raw });
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (trimmed && !trimmed.startsWith(';') && !trimmed.startsWith('#') && eq > 0) {
      lines.push({
        kind: 'kv',
        section,
        key: trimmed.slice(0, eq).trim(),
        value: trimmed.slice(eq + 1),
        raw,
      });
      continue;
    }
    lines.push({ kind: 'raw', section, raw });
  }
  // Drop a single trailing blank so round trips do not grow the file.
  const last = lines[lines.length - 1];
  if (last && last.kind === 'raw' && last.raw === '') lines.pop();
  return { lines, eol };
}

export function stringifyIni(doc: IniDoc): string {
  return doc.lines.map((l) => l.raw).join(doc.eol) + doc.eol;
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function getValue(doc: IniDoc, section: string, key: string): string | undefined {
  const hit = doc.lines.find((l) => l.kind === 'kv' && eq(l.section, section) && eq(l.key, key));
  return hit && hit.kind === 'kv' ? hit.value : undefined;
}

export function getAll(doc: IniDoc, section: string, key: string): string[] {
  return doc.lines
    .filter((l): l is Extract<IniLine, { kind: 'kv' }> => l.kind === 'kv' && eq(l.section, section) && eq(l.key, key))
    .map((l) => l.value);
}

export function listSections(doc: IniDoc): string[] {
  return [...new Set(doc.lines.filter((l) => l.kind === 'section').map((l) => (l as { name: string }).name))];
}

function ensureSection(doc: IniDoc, section: string): number {
  const idx = doc.lines.findIndex((l) => l.kind === 'section' && eq((l as { name: string }).name, section));
  if (idx >= 0) return idx;
  if (doc.lines.length && doc.lines[doc.lines.length - 1].raw !== '') {
    doc.lines.push({ kind: 'raw', section: '', raw: '' });
  }
  doc.lines.push({ kind: 'section', name: section, raw: `[${section}]` });
  return doc.lines.length - 1;
}

/** Index just past the last line belonging to `section`. */
function sectionEnd(doc: IniDoc, startIdx: number): number {
  let end = doc.lines.length;
  for (let i = startIdx + 1; i < doc.lines.length; i++) {
    if (doc.lines[i].kind === 'section') {
      end = i;
      break;
    }
  }
  while (end - 1 > startIdx && doc.lines[end - 1].kind === 'raw' && doc.lines[end - 1].raw.trim() === '') end--;
  return end;
}

export function setValue(doc: IniDoc, section: string, key: string, value: string): void {
  const existing = doc.lines.find((l) => l.kind === 'kv' && eq(l.section, section) && eq(l.key, key));
  if (existing && existing.kind === 'kv') {
    existing.value = value;
    existing.raw = `${existing.key}=${value}`;
    return;
  }
  const secIdx = ensureSection(doc, section);
  const at = sectionEnd(doc, secIdx);
  doc.lines.splice(at, 0, { kind: 'kv', section, key, value, raw: `${key}=${value}` });
}

export function removeKey(doc: IniDoc, section: string, key: string): void {
  doc.lines = doc.lines.filter((l) => !(l.kind === 'kv' && eq(l.section, section) && eq(l.key, key)));
}

/** Replace every occurrence of a repeating key with the supplied list. */
export function setMulti(doc: IniDoc, section: string, key: string, values: string[]): void {
  removeKey(doc, section, key);
  if (!values.length) return;
  const secIdx = ensureSection(doc, section);
  const at = sectionEnd(doc, secIdx);
  doc.lines.splice(
    at,
    0,
    ...values.map((value) => ({ kind: 'kv' as const, section, key, value, raw: `${key}=${value}` })),
  );
}

/** Flatten to { section: { key: value | value[] } } for the settings UI. */
export function toObject(doc: IniDoc): Record<string, Record<string, string | string[]>> {
  const out: Record<string, Record<string, string | string[]>> = {};
  for (const line of doc.lines) {
    if (line.kind !== 'kv') continue;
    const sec = (out[line.section] ??= {});
    const prev = sec[line.key];
    if (prev === undefined) sec[line.key] = line.value;
    else if (Array.isArray(prev)) prev.push(line.value);
    else sec[line.key] = [prev, line.value];
  }
  return out;
}
