// Latency over a window (the detail drawer): the median and the 95th percentile per period, on one axis from zero.
// Two series, so a legend; a crosshair with both values on hover. Periods without data are gaps, never zero.
import { useState } from 'react';
import type { UptimeBucket } from '../../shared/api';
import { millis, shortTime } from '../lib/format';

const W = 400;
const H = 96;
const PAD = { l: 34, r: 6, t: 8, b: 6 };

/** The axis top: a round number at or above `v`, and never under 10 ms, so a fast local app's axis isn't 0–1 ms. */
function niceMax(v: number) {
  if (v <= 10) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

function path(values: (number | null)[], x: (i: number) => number, y: (v: number) => number) {
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) return (pen = false);
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

export function LatencyChart({ buckets }: { buckets: UptimeBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const p50 = buckets.map((b) => b.latencyP50);
  const p95 = buckets.map((b) => b.latencyP95);
  const top = niceMax(Math.max(0, ...p95.filter((v): v is number => v !== null), ...p50.filter((v): v is number => v !== null)));
  if (!buckets.length || [...p50, ...p95].every((v) => v === null)) return <p className="hw-quiet">No latency measured in this window yet.</p>;
  const n = buckets.length;
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * (i + 0.5)) / n;
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / top);
  const b = hover !== null ? buckets[hover] : null;
  return (
    <figure className="hw-latency">
      <figcaption className="hw-legend-row">
        <span className="hw-key hw-key--p50">p50</span>
        <span className="hw-key hw-key--p95">p95</span>
        {b ? (
          <span className="hw-latency-read hw-num">
            {shortTime(b.start)} · p50 {millis(b.latencyP50)} · p95 {millis(b.latencyP95)}
          </span>
        ) : null}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="hw-latency-svg"
        role="img"
        aria-label={`Latency: median up to ${millis(Math.max(...p50.filter((v): v is number => v !== null)))}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const fx = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((fx - PAD.l) / (W - PAD.l - PAD.r)) * n - 0.5);
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="hw-latency-grid" x1={PAD.l} x2={W - PAD.r} y1={y(top * f)} y2={y(top * f)} />
            <text className="hw-latency-axis" x={PAD.l - 6} y={y(top * f) + 3} textAnchor="end">
              {millis(top * f)}
            </text>
          </g>
        ))}
        <path className="hw-latency-line hw-latency-line--p95" d={path(p95, x, y)} />
        <path className="hw-latency-line hw-latency-line--p50" d={path(p50, x, y)} />
        {/* a period with data between two without is a point, not a line: draw it */}
        {p50.map((v, i) => (v !== null && p50[i - 1] == null && p50[i + 1] == null ? <circle key={i} className="hw-latency-dot hw-latency-dot--p50" cx={x(i)} cy={y(v)} r={2.5} /> : null))}
        {hover !== null && (
          <g>
            <line className="hw-latency-cross" x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} />
            {p95[hover] !== null && <circle className="hw-latency-dot hw-latency-dot--p95" cx={x(hover)} cy={y(p95[hover]!)} r={4} />}
            {p50[hover] !== null && <circle className="hw-latency-dot hw-latency-dot--p50" cx={x(hover)} cy={y(p50[hover]!)} r={4} />}
          </g>
        )}
      </svg>
    </figure>
  );
}
