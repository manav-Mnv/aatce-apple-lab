'use client';

import { useMemo, useState } from 'react';
import { BarList, ColumnChart } from '@/components/Charts';
import { useLab } from '@/components/LabProvider';
import { Card, Empty, PageHeader, Segmented, Stat } from '@/components/ui';
import {
  averageMinutes, formatDuration, inLastDays, sessionsPerBatch, sessionsPerDay, sessionsPerHour, totalMinutes, uniqueStudents
} from '@/lib/analytics';

const RANGES = { '7': 7, '30': 30, '90': 90 } as const;
type Range = keyof typeof RANGES;
const FIRST_HOUR = 7;
const LAST_HOUR = 22;

export default function Analytics() {
  const { data, sessions } = useLab();
  const [range, setRange] = useState<Range>('30');
  const now = useMemo(() => (data ? new Date(data.fetchedAt) : new Date()), [data]);
  const days = RANGES[range];
  const scoped = inLastDays(sessions, days, now);
  const hours = sessionsPerHour(scoped);
  const batches = sessionsPerBatch(scoped);
  const perDay = sessionsPerDay(scoped, days, now);

  return (
    <>
      <PageHeader title="Analytics" subtitle="How the lab is used"
        actions={<Segmented value={range} onChange={setRange}
          options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />} />

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Sessions" value={scoped.length.toLocaleString()} />
        <Stat label="Students" value={uniqueStudents(scoped).toLocaleString()} />
        <Stat label="Time in lab" value={`${Math.round(totalMinutes(scoped) / 60).toLocaleString()} h`} />
        <Stat label="Average session" value={formatDuration(averageMinutes(scoped))} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Peak hours" subtitle="Check-ins by time of day">
          <ColumnChart unit="check-ins" labelEvery={3} bars={hours.slice(FIRST_HOUR, LAST_HOUR + 1).map((count, i) => {
            const hour = FIRST_HOUR + i;
            const label = new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: 'numeric' });
            return { key: String(hour), value: count, label, tooltip: `${label} – ${new Date(2000, 0, 1, hour + 1).toLocaleTimeString(undefined, { hour: 'numeric' })}` };
          })} />
        </Card>

        <Card title="Attendance by batch" subtitle="Sessions and unique students">
          {batches.length ? (
            <BarList unit="sessions" rows={batches.map((b) => ({ key: b.batch, label: b.batch, value: b.sessions, detail: `${b.students} students` }))} />
          ) : <Empty>No sessions in this range.</Empty>}
        </Card>
      </div>

      <Card title="Daily sessions" subtitle={`Last ${days} days`} className="mt-5">
        <ColumnChart unit="sessions" labelEvery={Math.ceil(days / 10)} bars={perDay.map((d) => ({
          key: d.date,
          value: d.count,
          label: new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
          tooltip: new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
        }))} />
      </Card>
    </>
  );
}
