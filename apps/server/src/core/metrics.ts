/**
 * A small in-memory time series per server, so the dashboard can draw real
 * trend lines instead of a single instantaneous number. Deliberately not
 * persisted: it is glanceable context, not a monitoring system, and keeping it
 * in memory means no database and no disk churn every five seconds.
 */

export interface MetricPoint {
  t: number;
  cpu: number;
  memMB: number;
  players: number;
}

/** 15 minutes at one sample every 5 seconds. */
const CAPACITY = 180;

const series = new Map<string, MetricPoint[]>();

export function record(id: string, point: Omit<MetricPoint, 't'>): void {
  const buf = series.get(id) ?? [];
  buf.push({ t: Date.now(), ...point });
  if (buf.length > CAPACITY) buf.splice(0, buf.length - CAPACITY);
  series.set(id, buf);
}

export function history(id: string): MetricPoint[] {
  return series.get(id) ?? [];
}

export function forget(id: string): void {
  series.delete(id);
}

/**
 * Player counts across every server, summed into one series. Samples are
 * bucketed to the nearest 5 seconds so servers sampled a few milliseconds apart
 * still line up on one x-axis.
 */
export function combinedPlayers(ids: string[]): Array<{ t: number; players: number }> {
  const buckets = new Map<number, number>();
  for (const id of ids) {
    for (const point of history(id)) {
      const bucket = Math.round(point.t / 5000) * 5000;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + point.players);
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-CAPACITY)
    .map(([t, players]) => ({ t, players }));
}
