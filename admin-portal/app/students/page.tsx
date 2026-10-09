'use client';

import { useMemo, useState } from 'react';
import { useLab } from '@/components/LabProvider';
import { Badge, Card, Empty, ExportButton, PageHeader, SearchField, Segmented, Select, downloadCsv } from '@/components/ui';
import { allBatches, formatDuration, summarizeStudents, toCsv } from '@/lib/analytics';

export default function Students() {
  const { data, sessions } = useLab();
  const [batch, setBatch] = useState('');
  const [query, setQuery] = useState('');
  const [face, setFace] = useState<'all' | 'enrolled' | 'missing'>('all');

  const summaries = useMemo(() => summarizeStudents(data?.students ?? [], sessions), [data, sessions]);
  const q = query.trim().toLowerCase();
  const rows = summaries.filter((s) =>
    (!batch || s.batches.includes(batch)) &&
    (face === 'all' || (face === 'enrolled') === s.face_enrolled) &&
    (!q || s.name.toLowerCase().includes(q) || s.enrollment_no.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)));
  const enrolled = summaries.filter((s) => s.face_enrolled).length;

  const exportCsv = () => downloadCsv(`students${batch ? '-' + batch.replace(/\W+/g, '_') : ''}.csv`, toCsv(
    ['Name', 'Enrollment no', 'Email', 'Batches', 'Face enrolled', 'Photos', 'Sessions', 'Total minutes', 'Last visit'],
    rows.map((s) => [s.name, s.enrollment_no, s.email, s.batches.join('; '), s.face_enrolled ? 'yes' : 'no',
      s.photo_count, s.sessions, s.totalMins, s.lastVisit ?? ''])));

  return (
    <>
      <PageHeader title="Students"
        subtitle={data ? `${summaries.length} on the roster · ${enrolled} with face enrolled` : 'Roster and enrollment'}
        actions={<ExportButton onClick={exportCsv} />} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <SearchField value={query} onChange={setQuery} placeholder="Search name, number or email" />
        <Select label="Batch" value={batch} onChange={setBatch}
          options={[{ value: '', label: 'All batches' }, ...allBatches(data?.students ?? []).map((b) => ({ value: b, label: b }))]} />
        <Segmented value={face} onChange={setFace}
          options={[{ value: 'all', label: 'All' }, { value: 'enrolled', label: 'Face enrolled' }, { value: 'missing', label: 'Not enrolled' }]} />
      </div>

      <Card className="overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[14px]">
            <thead className="text-[12px] text-[var(--text-secondary)]">
              <tr className="border-b border-[var(--separator)]">
                {['Student', 'Batch', 'Face', 'Sessions', 'Time in lab', 'Last visit'].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--separator)]">
              {rows.map((s) => (
                <tr key={s.enrollment_no}>
                  <td className="px-5 py-3">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-[12px] text-[var(--text-secondary)]">{s.enrollment_no} · {s.email}</div>
                  </td>
                  <td className="px-5 py-3">{s.batches.join(', ') || '—'}</td>
                  <td className="px-5 py-3">{s.face_enrolled ? <Badge tone="good">✓ {s.photo_count} photos</Badge> : <Badge>Not enrolled</Badge>}</td>
                  <td className="px-5 py-3 tabular-nums">{s.sessions}</td>
                  <td className="whitespace-nowrap px-5 py-3 tabular-nums">{formatDuration(s.totalMins)}</td>
                  <td className="whitespace-nowrap px-5 py-3">
                    {s.lastVisit ? new Date(s.lastVisit + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && rows.length === 0 && <Empty>No matching students.</Empty>}
      </Card>
    </>
  );
}
