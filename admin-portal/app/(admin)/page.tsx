'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ColumnChart } from '@/components/Charts';
import { useLab } from '@/components/LabProvider';
import { Badge, Card, Empty, PageHeader, Stat } from '@/components/ui';
import { averageMinutes, dayKey, formatDuration, inLastDays, sessionsPerDay, splitBatches, uniqueStudents } from '@/lib/analytics';

export default function Overview() {
  const { data, sessions } = useLab();
  const now = useMemo(() => (data ? new Date(data.fetchedAt) : new Date()), [data]);

  const today = dayKey(now);
  const todays = sessions.filter((s) => s.date === today);
  const week = inLastDays(sessions, 7, now);
  const formsDone = week.filter((s) => s.activityStatus === 'completed').length;
  // Forms are only asked for after a session ends; people still in the lab don't count yet.
  const formsAsked = week.filter((s) => s.activityStatus === 'completed' ||
    (s.activityStatus === 'pending' && (s.exit !== null || s.noExit))).length;
  const perDay = sessionsPerDay(sessions, 14, now);
  const recent = sessions.filter((s) => s.activity).slice(0, 6);
  const occupancy = data?.occupancy ?? [];
  const kiosk = data?.kiosk;
  const visitorsToday = (data?.workshops ?? []).filter((w) => dayKey(new Date(w.date)) === today).length;

  return (
    <>
      <PageHeader title="Overview" subtitle={now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} />

      {kiosk && (
        <Link href="/kiosk" className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[20px] bg-[var(--card)] px-5 py-3.5 text-[14px] shadow-[var(--card-shadow)] transition hover:bg-[var(--fill)]">
          <span className="flex items-center gap-2 font-medium">
            <span className={`h-2 w-2 rounded-full ${kiosk.online ? 'bg-[var(--good-text)]' : 'bg-[var(--critical-text)]'}`} />
            Kiosk {kiosk.online ? 'online' : 'offline'}
          </span>
          <span className="text-[var(--text-secondary)]">{kiosk.today.recognized} recognised · {kiosk.today.unrecognized} not recognised today</span>
          {visitorsToday > 0 && <span className="text-[var(--text-secondary)]">{visitorsToday} workshop visitors today</span>}
          {kiosk.problem && <Badge tone="critical">needs attention</Badge>}
          <span className="ml-auto text-[var(--accent)]">Details ›</span>
        </Link>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="text-[13px] text-[var(--text-secondary)]">In the lab now</div>
          <div className="text-[64px] font-semibold leading-none tracking-tight">{data ? occupancy.length : '—'}</div>
          <ul className="mt-5 divide-y divide-[var(--separator)]">
            {occupancy.map((p) => (
              <li key={p.session_id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-medium">{p.name || p.enrollment_no}</div>
                  <div className="truncate text-[12px] text-[var(--text-secondary)]">{splitBatches(p.batch_tags).join(' · ') || p.enrollment_no}</div>
                </div>
                <span className="shrink-0 text-[13px] tabular-nums text-[var(--text-secondary)]">
                  {formatDuration(Math.max(0, Math.round((now.getTime() - new Date(p.entry_time).getTime()) / 60000)))}
                </span>
              </li>
            ))}
          </ul>
          {data && occupancy.length === 0 && <Empty>Nobody is checked in.</Empty>}
        </Card>

        <div className="grid gap-5 sm:grid-cols-2 lg:col-span-2">
          <Stat label="Check-ins today" value={String(todays.length)} detail={`${uniqueStudents(todays)} students`} />
          <Stat label="Students this week" value={String(uniqueStudents(week))} detail={`${week.length} sessions`} />
          <Stat label="Average session" value={formatDuration(averageMinutes(week))} detail="Last 7 days" />
          <Stat label="Activity forms" value={formsAsked ? `${Math.round((formsDone / formsAsked) * 100)}%` : '—'}
            detail={`${formsDone} of ${formsAsked} completed this week`} />
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <Card title="Sessions per day" subtitle="Last 14 days" className="lg:col-span-3">
          <ColumnChart unit="sessions" labelEvery={2} bars={perDay.map((d) => ({
            key: d.date,
            value: d.count,
            label: new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
            tooltip: new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
          }))} />
        </Card>

        <Card title="What students worked on" subtitle="Latest activity forms" className="lg:col-span-2">
          <ul className="space-y-4">
            {recent.map((s) => (
              <li key={s.id}>
                <p className="text-[15px] leading-snug">{s.activity}</p>
                <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                  {s.name} · {s.entry.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  {s.manual && <> · <Badge tone="warning">manual</Badge></>}
                </p>
              </li>
            ))}
          </ul>
          {data && recent.length === 0 && <Empty>No activity forms yet.</Empty>}
        </Card>
      </div>
    </>
  );
}
