'use client';

import { useLab } from './LabProvider';
import { Icon } from './Icon';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  const { refresh, loading, data } = useLab();
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[34px] font-bold leading-tight tracking-tight sm:text-[40px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[17px] text-[var(--text-secondary)]">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <button
          onClick={refresh}
          disabled={loading}
          title={data ? `Updated ${new Date(data.fetchedAt).toLocaleTimeString()}` : undefined}
          className="flex h-9 items-center gap-2 rounded-full bg-[var(--fill)] px-4 text-[14px] transition hover:bg-[var(--fill-strong)] disabled:opacity-50"
        >
          <Icon name="refresh" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Updating' : 'Refresh'}
        </button>
      </div>
    </header>
  );
}

export function Card({ title, subtitle, children, className = '' }: {
  title?: string; subtitle?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-[20px] bg-[var(--card)] p-5 shadow-[var(--card-shadow)] sm:p-6 ${className}`}>
      {title && (
        <div className="mb-4">
          <h2 className="text-[17px] font-semibold">{title}</h2>
          {subtitle && <p className="text-[13px] text-[var(--text-secondary)]">{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card>
      <div className="text-[13px] text-[var(--text-secondary)]">{label}</div>
      <div className="mt-1 text-[32px] font-semibold tracking-tight">{value}</div>
      {detail && <div className="text-[13px] text-[var(--text-secondary)]">{detail}</div>}
    </Card>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-[15px] text-[var(--text-secondary)]">{children}</p>;
}

const control = 'h-9 rounded-[10px] border border-[var(--separator)] bg-[var(--card)] px-3 text-[14px] outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--focus-ring)]';

export function SearchField(props: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input type="search" value={props.value} placeholder={props.placeholder} aria-label={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)} className={`${control} w-full sm:w-64`} />
  );
}

export function Select(props: { value: string; onChange: (v: string) => void; label: string; options: { value: string; label: string }[] }) {
  return (
    <select value={props.value} aria-label={props.label} onChange={(e) => props.onChange(e.target.value)} className={control}>
      {props.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function DateField(props: { value: string; onChange: (v: string) => void; label: string }) {
  return <input type="date" value={props.value} aria-label={props.label} onChange={(e) => props.onChange(e.target.value)} className={control} />;
}

export function Segmented<T extends string>(props: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-[10px] bg-[var(--fill)] p-0.5">
      {props.options.map((o) => (
        <button key={o.value} role="radio" aria-checked={props.value === o.value} onClick={() => props.onChange(o.value)}
          className={`rounded-[8px] px-3.5 py-1.5 text-[13px] transition ${
            props.value === o.value ? 'bg-[var(--card)] font-medium shadow-sm' : 'text-[var(--text-secondary)]'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-9 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-[14px] text-white transition hover:brightness-110">
      <Icon name="download" className="h-4 w-4" /> Export CSV
    </button>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'warning' | 'good' | 'critical' }) {
  const tones = {
    neutral: 'bg-[var(--fill)] text-[var(--text-secondary)]',
    warning: 'bg-[var(--warning-bg)] text-[var(--warning-text)]',
    good: 'bg-[var(--good-bg)] text-[var(--good-text)]',
    critical: 'bg-[var(--critical-bg)] text-[var(--critical-text)]'
  };
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] ${tones[tone]}`}>{children}</span>;
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

/** The macOS / iOS activity indicator. */
export function Spinner({ size = 28 }: { size?: number }) {
  return (
    <span className="activity-indicator inline-block" style={{ '--size': `${size}px` } as React.CSSProperties}
      role="progressbar" aria-label="Loading">
      {Array.from({ length: 12 }, (_, i) => (
        <i key={i} style={{ transform: `rotate(${i * 30}deg)`, animationDelay: `${(i - 12) / 12}s` }} />
      ))}
    </span>
  );
}
