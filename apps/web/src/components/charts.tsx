import { useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * Renders at the container's real pixel width rather than scaling a fixed
 * viewBox, so stroke weights and axis labels never stretch.
 */
function useElementWidth(fallback = 640): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Single-series charts only, on purpose.
 *
 * Every measure ASMS plots (players, CPU%, memory) has its own scale, and a
 * second y-axis is the classic way to make a chart lie - so each measure gets
 * its own chart rather than sharing one. With one series there is no legend to
 * draw: the card title already names what is plotted.
 */

export interface Point {
  t: number;
  v: number;
}

const PAD = { top: 10, right: 10, bottom: 18, left: 34 };

function niceTicks(max: number, count = 3): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

const clockOf = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export interface AreaChartProps {
  points: Point[];
  height?: number;
  /** Formats the value in the tooltip and on the y-axis. */
  format?: (v: number) => string;
  /** What one point means, e.g. "players online". Used in the tooltip. */
  label: string;
  /** Force the top of the scale (e.g. total slots) instead of using the max. */
  ceiling?: number;
  emptyText?: string;
}

export function AreaChart({
  points,
  height = 170,
  format = (v) => String(Math.round(v)),
  label,
  ceiling,
  emptyText = 'Collecting data…',
}: AreaChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [wrapRef, width] = useElementWidth();

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const maxV = Math.max(ceiling ?? 0, ...points.map((p) => p.v), 1);
    const ticks = niceTicks(maxV);
    const top = Math.max(maxV, ticks[ticks.length - 1]);
    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
    const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
    const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = `${PAD.left},${PAD.top + plotH} ${line} ${PAD.left + plotW},${PAD.top + plotH}`;
    return { x, y, line, area, ticks, top, plotH, plotW };
  }, [points, height, ceiling, width]);

  if (!geometry) {
    return (
      <div ref={wrapRef} className="chart-empty">
        {emptyText}
      </div>
    );
  }

  const { x, y, line, area, ticks, plotH, plotW } = geometry;
  const last = points[points.length - 1];
  const active = hover === null ? null : points[hover];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const ratio = (px - PAD.left) / plotW;
    const index = Math.round(ratio * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, index)));
  };

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`${label} over the last ${Math.round(((last.t - points[0].t) / 60000) || 1)} minutes`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <g className="chart-grid">
          {ticks.map((tick) => (
            <line key={tick} x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} />
          ))}
        </g>
        {ticks.map((tick) => (
          <text key={tick} className="chart-axis-text" x={PAD.left - 6} y={y(tick) + 3} textAnchor="end">
            {format(tick)}
          </text>
        ))}
        <text className="chart-axis-text" x={PAD.left} y={height - 4}>
          {clockOf(points[0].t)}
        </text>
        <text className="chart-axis-text" x={width - PAD.right} y={height - 4} textAnchor="end">
          {clockOf(last.t)}
        </text>

        <polygon className="chart-area" points={area} />
        <polyline className="chart-line" points={line} />

        {active ? (
          <>
            <line className="chart-crosshair" x1={x(hover as number)} x2={x(hover as number)} y1={PAD.top} y2={PAD.top + plotH} />
            <circle className="chart-dot" cx={x(hover as number)} cy={y(active.v)} r={4.5} />
          </>
        ) : (
          <circle className="chart-dot" cx={x(points.length - 1)} cy={y(last.v)} r={4.5} />
        )}
      </svg>

      {active ? (
        <div
          className="tip"
          style={{
            position: 'absolute',
            left: x(hover as number),
            top: 0,
            transform: 'translate(-50%, -108%)',
            whiteSpace: 'nowrap',
          }}
        >
          <div className="tip-title">
            {format(active.v)} {label}
          </div>
          <div className="tip-body">{clockOf(active.t)}</div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The stat-tile trend: a bare 12-to-60 point line, no axes, no hover. It exists
 * to show shape next to a number, not to be read for values.
 */
export function Sparkline({
  values,
  width = 84,
  height = 26,
  ceiling,
}: {
  values: number[];
  width?: number;
  height?: number;
  ceiling?: number;
}) {
  if (values.length < 2) {
    return (
      <svg className="spark" width={width} height={height} aria-hidden>
        <line className="spark-line spark-flat" x1={1} x2={width - 1} y1={height / 2} y2={height / 2} strokeWidth={1} opacity={0.3} />
      </svg>
    );
  }
  const max = Math.max(ceiling ?? 0, ...values, 1);
  const step = (width - 4) / (values.length - 1);
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  const pts = values.map((v, i) => `${(2 + i * step).toFixed(1)},${y(v).toFixed(1)}`);
  const lastX = 2 + (values.length - 1) * step;

  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polygon className="spark-area" points={`2,${height} ${pts.join(' ')} ${lastX.toFixed(1)},${height}`} />
      <polyline className="spark-line" points={pts.join(' ')} />
      <circle className="spark-dot" cx={lastX} cy={y(values[values.length - 1])} r={2.6} />
    </svg>
  );
}
