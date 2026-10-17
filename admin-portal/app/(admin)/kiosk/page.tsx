'use client';

import { useLab } from '@/components/LabProvider';
import { Badge, Card, Empty, PageHeader, Stat } from '@/components/ui';
import type { KioskEvent, KioskInfo } from '@/lib/types';

const KIND: Record<KioskEvent['kind'], { label: string; tone: 'good' | 'warning' | 'critical' | 'neutral' }> = {
  recognized: { label: 'Recognised', tone: 'good' },
  unrecognized: { label: 'Not recognised', tone: 'warning' },
  liveness_failed: { label: 'No head turn', tone: 'warning' },
  queued: { label: 'Saved offline', tone: 'neutral' },
  error: { label: 'Error', tone: 'critical' }
};

export default function Kiosk() {
  const { data } = useLab();
  const kiosk = data?.kiosk;

  return (
    <>
      <PageHeader title="Kiosk" subtitle="Live status and every scan attempt on the iMac" />
      {data && !kiosk && <Card><Empty>The backend doesn’t report kiosk status yet.</Empty></Card>}
      {kiosk && <KioskDetails kiosk={kiosk} />}
    </>
  );
}

function KioskDetails({ kiosk }: { kiosk: KioskInfo }) {
  const attempts = kiosk.today.recognized + kiosk.today.unrecognized + kiosk.today.liveness_failed;
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Status" value={kiosk.online ? 'Online' : kiosk.last_seen ? 'Offline' : '—'}
          detail={kiosk.last_seen ? `Last heartbeat ${since(kiosk.last_seen)}` : 'Update the kiosk app to 2.1 or later'} />
        <Stat label="Recognised today" value={String(kiosk.today.recognized)}
          detail={attempts ? `${Math.round((kiosk.today.recognized / attempts) * 100)}% of ${attempts} attempts` : 'No attempts yet'} />
        <Stat label="Not recognised today" value={String(kiosk.today.unrecognized)}
          detail={`${kiosk.today.liveness_failed} didn’t turn their head`} />
        <Stat label="Faces loaded" value={String(kiosk.faces)}
          detail={`${kiosk.queued} scans waiting to sync · v${kiosk.app_version || '?'}`} />
      </div>

      {(kiosk.problem || kiosk.workshop_name) && (
        <div className="mt-5 space-y-2">
          {kiosk.problem && (
            <p role="alert" className="rounded-xl bg-[var(--critical-bg)] px-4 py-2.5 text-[13px] text-[var(--critical-text)]">{kiosk.problem}</p>
          )}
          {kiosk.workshop_name && (
            <p className="rounded-xl bg-[var(--warning-bg)] px-4 py-2.5 text-[13px] text-[var(--warning-text)]">
              Workshop mode is on (“{kiosk.workshop_name}”): people who aren’t on the student roster are logged as workshop
              attendees under that name. Clear it in the kiosk’s Settings when the workshop ends.
            </p>
          )}
        </div>
      )}

      <Card title="Recent scan attempts" subtitle={`Latest 50 · match threshold ${kiosk.match_threshold?.toFixed(2) ?? '—'}`} className="mt-5 overflow-hidden">
        <div className="-mx-5 overflow-x-auto sm:-mx-6">
          <table className="w-full min-w-[640px] text-left text-[14px]">
            <thead className="text-[12px] text-[var(--text-secondary)]">
              <tr className="border-b border-[var(--separator)]">
                {['Time', 'Result', 'Closest match', 'Score', 'Detail'].map((h) => <th key={h} className="px-5 py-3 font-medium sm:px-6">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--separator)]">
              {kiosk.events.map((e, i) => (
                <tr key={`${e.at}-${i}`}>
                  <td className="whitespace-nowrap px-5 py-3 tabular-nums sm:px-6">
                    {new Date(e.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  </td>
                  <td className="px-5 py-3 sm:px-6"><Badge tone={KIND[e.kind].tone}>{KIND[e.kind].label}</Badge></td>
                  <td className="px-5 py-3 sm:px-6">{e.name || e.enrollment_no || '—'}</td>
                  <td className="px-5 py-3 tabular-nums sm:px-6">{e.score === null ? '—' : e.score.toFixed(2)}</td>
                  <td className="px-5 py-3 text-[var(--text-secondary)] sm:px-6">{e.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {kiosk.events.length === 0 && <Empty>No scan attempts yet.</Empty>}
      </Card>
    </>
  );
}

function since(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
