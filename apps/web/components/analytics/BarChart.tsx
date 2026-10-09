'use client';

import { useId, useState } from 'react';

export interface Point {
  date: string;
  value: number;
}

const W = 720;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 56 };

/** "Nice" axis max so ticks land on round numbers. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= v)!;
}

/**
 * Single-series column chart (one hue: palette slot 1, light/dark steps). Bars ≤ 24px with a 4px rounded data end,
 * recessive grid, hover/focus tooltip per bar, and a table view for screen readers and exact values.
 */
export function BarChart({ title, points, format }: { title: string; points: Point[]; format: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / Math.max(points.length, 1);
  const barW = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const labelEvery = Math.ceil(points.length / 8);
  const h = hover !== null ? points[hover] : null;

  return (
    <figure className="if-chart" style={{ margin: 0 }} aria-labelledby={`${id}-t`}>
      <style>{`
        .if-chart { --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --grid: #e6e5e0; --series-1: #2a78d6; }
        @media (prefers-color-scheme: dark) { .if-chart { --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --grid: #3a3a37; --series-1: #3987e5; } }
        .if-chart .bar { fill: var(--series-1); } .if-chart .bar:focus { outline: none; stroke: var(--ink); stroke-width: 2px; }
      `}</style>
      <figcaption id={`${id}-t`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', color: 'var(--ink)' }}>
        <strong>{title}</strong>
        <button onClick={() => setTable((v) => !v)}>{table ? 'Show chart' : 'Show table'}</button>
      </figcaption>
      {table ? (
        <table cellPadding={4}>
          <thead><tr><th align="left">Date</th><th align="right">{title}</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.date}><td>{p.date}</td><td align="right">{format(p.value)}</td></tr>)}</tbody>
        </table>
      ) : (
        <div style={{ position: 'relative', background: 'var(--surface)', borderRadius: 8 }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title} by day`} onMouseLeave={() => setHover(null)}>
            {ticks.map((tv) => (
              <g key={tv}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(tv)} y2={y(tv)} stroke="var(--grid)" strokeWidth={1} />
                <text x={PAD.left - 6} y={y(tv) + 4} textAnchor="end" fontSize={11} fill="var(--ink-2)">{format(tv)}</text>
              </g>
            ))}
            {points.map((p, i) => {
              const x = PAD.left + i * band + (band - barW) / 2;
              const top = y(p.value);
              const hgt = PAD.top + innerH - top;
              const r = Math.min(4, hgt, barW / 2);
              // Rounded data end (top), square at the baseline.
              const d = hgt <= 0 ? '' : `M${x},${top + hgt} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + hgt} Z`;
              return (
                <g key={p.date}>
                  {/* Hit target spans the whole band, larger than the mark. */}
                  <rect x={PAD.left + i * band} y={PAD.top} width={band} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
                  {d && <path className="bar" d={d} tabIndex={0} aria-label={`${p.date}: ${format(p.value)}`} onFocus={() => setHover(i)} onBlur={() => setHover(null)} onMouseEnter={() => setHover(i)} opacity={hover === null || hover === i ? 1 : 0.55} />}
                  {i % labelEvery === 0 && <text x={PAD.left + i * band + band / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--ink-2)">{p.date.slice(5)}</text>}
                </g>
              );
            })}
          </svg>
          {h && hover !== null && (
            <div role="status" style={{ position: 'absolute', top: 4, left: `${Math.min(80, ((PAD.left + hover * band) / W) * 100)}%`, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--grid)', borderRadius: 6, padding: '4px 8px', fontSize: 12, pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,.12)' }}>
              <div style={{ color: 'var(--ink-2)' }}>{h.date}</div>
              <strong>{format(h.value)}</strong>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
