'use client';

import { useState } from 'react';
import { useLab } from '@/components/LabProvider';
import { Badge, Card, DateField, Empty, ExportButton, PageHeader, SearchField, Segmented, Select, downloadCsv } from '@/components/ui';
import { allBatches, dayKey, filterSessions, formatDuration, toCsv } from '@/lib/analytics';

const time = (d: Date | null) => (d ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—');

export default function Sessions() {
  const { data, sessions } = useLab();
  const [view, setView] = useState<'members' | 'workshops'>('members');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [batch, setBatch] = useState('');
  const [query, setQuery] = useState('');

  const rows = filterSessions(sessions, { from, to, batch, query });
  const today = dayKey(data ? new Date(data.fetchedAt) : new Date());
  const workshops = (data?.workshops ?? []).filter((w) =>
    !query || `${w.name} ${w.enrollment_no} ${w.workshop_name}`.toLowerCase().includes(query.toLowerCase()));

  const exportCsv = () => {
    if (view === 'members') {
      downloadCsv(`sessions-${from || 'all'}-${to || 'all'}.csv`, toCsv(
        ['Date', 'Name', 'Enrollment no', 'Batches', 'Entry', 'Exit', 'Duration (min)', 'Activity', 'Notes'],
        rows.map((s) => [s.date, s.name, s.enrollmentNo, s.batches.join('; '), s.entry.toISOString(), s.exit?.toISOString() ?? '',
          s.durationMins, s.activity, [s.manual && 'manual', s.noExit && 'no exit scan'].filter(Boolean).join('; ')])));
    } else {
      downloadCsv('workshop-attendees.csv', toCsv(['Date', 'Name', 'Enrollment no', 'Email', 'Workshop'],
        workshops.map((w) => [w.date, w.name, String(w.enrollment_no), w.email, w.workshop_name])));
    }
  };

  return (
    <>
      <PageHeader title="Sessions" subtitle="Every check-in and check-out" actions={<ExportButton onClick={exportCsv} />} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Segmented value={view} onChange={setView} options={[{ value: 'members', label: 'Members' }, { value: 'workshops', label: 'Workshop attendees' }]} />
        <SearchField value={query} onChange={setQuery} placeholder="Search name, number or activity" />
        {view === 'members' && (
          <>
            <DateField label="From" value={from} onChange={setFrom} />
            <DateField label="To" value={to} onChange={setTo} />
            <Select label="Batch" value={batch} onChange={setBatch}
              options={[{ value: '', label: 'All batches' }, ...allBatches(data?.students ?? []).map((b) => ({ value: b, label: b }))]} />
          </>
        )}
      </div>

      <Card className="overflow-hidden !p-0">
        <div className="overflow-x-auto">
          {view === 'members' ? (
            <table className="w-full min-w-[820px] text-left text-[14px]">
              <thead className="text-[12px] text-[var(--text-secondary)]">
                <tr className="border-b border-[var(--separator)]">
                  {['Student', 'Date', 'In', 'Out', 'Duration', 'Activity'].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--separator)]">
                {rows.slice(0, 500).map((s) => (
                  <tr key={s.id} className="align-top">
                    <td className="px-5 py-3">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-[12px] text-[var(--text-secondary)]">{s.enrollmentNo}{s.batches.length ? ` · ${s.batches.join(', ')}` : ''}</div>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3">{s.entry.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums">{time(s.entry)}{s.manual && <> <Badge tone="warning">manual</Badge></>}</td>
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums">
                      {s.noExit ? <Badge>no exit scan</Badge> : s.exit ? time(s.exit) : s.date === today ? <Badge tone="good">In lab</Badge> : '—'}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums">{formatDuration(s.durationMins)}</td>
                    <td className="max-w-[320px] px-5 py-3 text-[var(--text-secondary)]">{s.activity || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <thead className="text-[12px] text-[var(--text-secondary)]">
                <tr className="border-b border-[var(--separator)]">
                  {['Name', 'Workshop', 'Date', 'Email'].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--separator)]">
                {workshops.map((w) => (
                  <tr key={w.id}>
                    <td className="px-5 py-3"><div className="font-medium">{w.name}</div><div className="text-[12px] text-[var(--text-secondary)]">{w.enrollment_no}</div></td>
                    <td className="px-5 py-3">{w.workshop_name}</td>
                    <td className="whitespace-nowrap px-5 py-3">{new Date(w.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td className="px-5 py-3 text-[var(--text-secondary)]">{w.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {data && (view === 'members' ? rows.length === 0 : workshops.length === 0) && <Empty>No matching sessions.</Empty>}
        {view === 'members' && rows.length > 500 && (
          <p className="border-t border-[var(--separator)] px-5 py-3 text-[13px] text-[var(--text-secondary)]">
            Showing 500 of {rows.length.toLocaleString()} — narrow the filters or export the full list as CSV.
          </p>
        )}
      </Card>
    </>
  );
}
