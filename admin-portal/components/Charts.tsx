'use client';

import { useEffect, useRef, useState } from 'react';

export interface Bar {
  key: string;
  label: string;      // axis label
  tooltip: string;    // full description on hover/focus
  value: number;
}

/**
 * Single-series column chart: ≤24px columns with 4px rounded tops anchored to
 * the baseline, hairline gridlines, a per-column hover/focus tooltip, and a
 * screen-reader table. Every chart in the portal is one series, so color
 * carries no identity — the title names what's plotted.
 */
export function ColumnChart({ bars, height = 200, labelEvery = 1, unit }: {
  bars: Bar[]; height?: number; labelEvery?: number; unit: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const width = useWidth();
  const max = niceMax(Math.max(1, ...bars.map((b) => b.value)));
  const ticks = [0, max / 2, max];
  const left = 32;
  const bottom = 24;
  const plotH = height - bottom - 8;
  const slot = (width.value - left) / bars.length;
  const barW = Math.min(24, slot * 0.6);

  return (
    <figure ref={width.ref} className="relative">
      <svg viewBox={`0 0 ${width.value} ${height}`} width="100%" height={height} className="overflow-visible" role="img"
        aria-label={`${unit} chart`} onMouseLeave={() => setActive(null)}>
        {ticks.map((t) => {
          const y = 8 + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={left} x2={width.value} y1={y} y2={y} stroke="var(--grid)" strokeWidth={1} />
              <text x={left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--text-tertiary)">{fmt(t)}</text>
            </g>
          );
        })}
        {bars.map((b, i) => {
          const h = (b.value / max) * plotH;
          const x = left + i * slot + (slot - barW) / 2;
          const y = 8 + plotH - h;
          return (
            <g key={b.key} tabIndex={0} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
              className="outline-none">
              <rect x={left + i * slot} y={8} width={slot} height={plotH} fill="transparent" />
              {h > 0 && <path d={columnPath(x, y, barW, h)} fill="var(--series-1)" opacity={active === null || active === i ? 1 : 0.45} />}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--text-tertiary)">{b.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      {active !== null && (
        <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg bg-[var(--tooltip)] px-2.5 py-1.5 text-[12px] text-[var(--tooltip-text)] shadow-lg"
          style={{ left: left + active * slot + slot / 2, top: 0 }}>
          <div className="font-medium">{bars[active].tooltip}</div>
          <div>{bars[active].value.toLocaleString()} {unit}</div>
        </div>
      )}
      <table className="sr-only">
        <tbody>{bars.map((b) => <tr key={b.key}><th>{b.tooltip}</th><td>{b.value}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Single-series horizontal bars with the value at the tip. */
export function BarList({ rows, unit }: { rows: { key: string; label: string; value: number; detail?: string }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${r.value} ${unit}${r.detail ? ` · ${r.detail}` : ''}`}>
          <div className="mb-1 flex justify-between text-[13px]">
            <span>{r.label}</span>
            <span className="text-[var(--text-secondary)] tabular-nums">{r.value.toLocaleString()} {unit}{r.detail ? ` · ${r.detail}` : ''}</span>
          </div>
          <div className="h-2.5 rounded-r-[4px]" style={{ width: `${(r.value / max) * 100}%`, background: 'var(--series-1)' }} />
        </li>
      ))}
    </ul>
  );
}

/** Tracks the figure's pixel width so text and bars keep their real size at any card width. */
function useWidth() {
  const ref = useRef<HTMLElement>(null);
  const [value, setValue] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setValue(Math.max(200, entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, value };
}

/** Column with a 4px rounded top and a square base. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(v: number): number {
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / step) * step || 1;
}

function fmt(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1);
}
