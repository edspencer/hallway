// The uptime bar (docs/05-ui.md, "Uptime bar"): one thin bar per period, coloured by the period's worst significant
// state; stopped periods hatched, periods with no data an empty outline. Hovering a bar shows its time range, uptime
// and median latency. With no history at all (no uptime store, or a brand-new app) it is all outlines.
import { useState } from 'react';
import type { AppHistory, UptimeBucket } from '../../shared/api';
import { millis, percent, shortTime } from '../lib/format';

const EMPTY = 48;

function describe(b: UptimeBucket) {
  const range = `${shortTime(b.start)}–${new Date(b.end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  if (b.state === 'nodata') return { range, text: 'no data' };
  if (b.state === 'stopped') return { range, text: 'stopped' };
  return { range, text: `${percent(b.uptime)} up${b.latencyP50 !== null ? ` · p50 ${millis(b.latencyP50)}` : ''}${b.state === 'down' || b.state === 'unhealthy' ? ` · ${b.state}` : ''}` };
}

/** Near either end the tip hangs inwards from its bar, so it never runs off the card. */
const tipSide = (i: number, n: number) => (i < n * 0.25 ? 'start' : i >= n * 0.75 ? 'end' : 'mid');

export function UptimeBar({ history, size = 'card', label, onClick }: { history: AppHistory | null; size?: 'card' | 'large'; label: string; onClick?: (e: React.MouseEvent) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const buckets = history?.buckets ?? [];
  const n = buckets.length || EMPTY;
  const summary = !history || !buckets.length ? `${label}: no history yet` : `${label}: ${percent(history.uptime)} up`;
  const tip = hover !== null && buckets[hover] ? describe(buckets[hover]) : null;
  return (
    <div className={`hw-bar hw-bar--${size}`} role="img" aria-label={summary} onMouseLeave={() => setHover(null)} onClick={onClick}>
      <div className="hw-bar-track" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {buckets.length
          ? buckets.map((b, i) => <i key={b.start} className={`hw-bar-b hw-bar-b--${b.state}${hover === i ? ' is-hover' : ''}`} onMouseEnter={() => setHover(i)} />)
          : Array.from({ length: EMPTY }, (_, i) => <i key={i} className="hw-bar-b hw-bar-b--nodata" />)}
      </div>
      {tip && hover !== null && (
        <div className={`hw-bar-tip hw-bar-tip--${tipSide(hover, n)}`} style={{ left: `${((hover + 0.5) / n) * 100}%` }} aria-hidden="true">
          <span className="hw-bar-tip-range">{tip.range}</span>
          <span>{tip.text}</span>
        </div>
      )}
    </div>
  );
}
