export function bytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function duration(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return '-';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function when(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (Math.abs(diff) < 60_000) return diff >= 0 ? 'just now' : 'in a moment';
  const future = diff < 0;
  const text = duration(Math.abs(diff));
  return future ? `in ${text}` : `${text} ago`;
}

export function dateTime(ts: number | null): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function memory(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** Stable colour per string, used for cluster chips and avatars. */
export function hueFor(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  return hash;
}
