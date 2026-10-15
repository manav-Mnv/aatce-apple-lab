/**
 * Pure functions that turn backend rows into what the portal shows (FR-19).
 * No React, no I/O — unit-tested in tests/analytics.test.ts.
 * All dates are bucketed in the lab's time zone.
 */
import type { AttendanceEntry, Student } from './types.ts';

export const LAB_TIME_ZONE = 'Asia/Kolkata';

export interface Session {
  id: string;
  enrollmentNo: string;
  name: string;
  batches: string[];
  date: string;            // yyyy-mm-dd (lab time)
  entry: Date;
  exit: Date | null;
  durationMins: number | null;
  activity: string;
  activityStatus: string;
  manual: boolean;
  noExit: boolean;
}

export interface StudentSummary extends Student {
  batches: string[];
  sessions: number;
  totalMins: number;
  lastVisit: string | null;
}

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: LAB_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
});
const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: LAB_TIME_ZONE, hour: '2-digit', hourCycle: 'h23' });

export function dayKey(date: Date): string {
  return dayFormat.format(date);
}

export function hourOf(date: Date): number {
  return Number(hourFormat.format(date));
}

export function splitBatches(tags: string): string[] {
  return String(tags || '').split(',').map((t) => t.trim()).filter(Boolean);
}

export function buildSessions(entries: AttendanceEntry[], students: Student[]): Session[] {
  const byId = new Map(students.map((s) => [String(s.enrollment_no).trim(), s]));
  const sessions: Session[] = [];
  for (const e of entries) {
    const entry = new Date(e.entry_time);
    if (Number.isNaN(entry.getTime())) continue;
    const enrollmentNo = String(e.enrollment_no).trim();
    const student = byId.get(enrollmentNo);
    const exit = e.exit_time ? new Date(e.exit_time) : null;
    const duration = e.duration_mins === '' ? NaN : Number(e.duration_mins);
    const notes = String(e.notes || '');
    sessions.push({
      id: e.session_id,
      enrollmentNo,
      name: student?.name || enrollmentNo,
      batches: splitBatches(student?.batch_tags || ''),
      date: dayKey(entry),
      entry,
      exit: exit && !Number.isNaN(exit.getTime()) ? exit : null,
      durationMins: Number.isFinite(duration) ? duration : null,
      activity: String(e.activity_description || ''),
      activityStatus: String(e.activity_form_status || ''),
      manual: notes.includes('manual'),
      noExit: notes.includes('no exit scan')
    });
  }
  return sessions.sort((a, b) => b.entry.getTime() - a.entry.getTime());
}

/** The last `days` lab days ending today (inclusive), oldest first. */
export function lastDays(days: number, today: Date): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(new Date(today.getTime() - i * 86_400_000)));
  return keys;
}

export function inLastDays(sessions: Session[], days: number, today: Date): Session[] {
  const first = lastDays(days, today)[0];
  return sessions.filter((s) => s.date >= first);
}

export function sessionsPerDay(sessions: Session[], days: number, today: Date): { date: string; count: number }[] {
  const counts = new Map(lastDays(days, today).map((d) => [d, 0]));
  for (const s of sessions) if (counts.has(s.date)) counts.set(s.date, counts.get(s.date)! + 1);
  return [...counts].map(([date, count]) => ({ date, count }));
}

/** Check-ins by hour of day (0–23). */
export function sessionsPerHour(sessions: Session[]): number[] {
  const hours = new Array(24).fill(0);
  for (const s of sessions) hours[hourOf(s.entry)]++;
  return hours;
}

export function sessionsPerBatch(sessions: Session[]): { batch: string; sessions: number; students: number }[] {
  const map = new Map<string, { sessions: number; students: Set<string> }>();
  for (const s of sessions) {
    for (const batch of s.batches.length ? s.batches : ['No batch']) {
      const row = map.get(batch) ?? { sessions: 0, students: new Set<string>() };
      row.sessions++;
      row.students.add(s.enrollmentNo);
      map.set(batch, row);
    }
  }
  return [...map]
    .map(([batch, row]) => ({ batch, sessions: row.sessions, students: row.students.size }))
    .sort((a, b) => b.sessions - a.sessions);
}

/** Mean length of completed sessions, in minutes (null if none). */
export function averageMinutes(sessions: Session[]): number | null {
  const done = sessions.filter((s) => s.durationMins !== null);
  if (!done.length) return null;
  return Math.round(done.reduce((sum, s) => sum + s.durationMins!, 0) / done.length);
}

export function totalMinutes(sessions: Session[]): number {
  return sessions.reduce((sum, s) => sum + (s.durationMins ?? 0), 0);
}

export function uniqueStudents(sessions: Session[]): number {
  return new Set(sessions.map((s) => s.enrollmentNo)).size;
}

export function summarizeStudents(students: Student[], sessions: Session[]): StudentSummary[] {
  const stats = new Map<string, { sessions: number; totalMins: number; lastVisit: string | null }>();
  for (const s of sessions) {
    const row = stats.get(s.enrollmentNo) ?? { sessions: 0, totalMins: 0, lastVisit: null };
    row.sessions++;
    row.totalMins += s.durationMins ?? 0;
    if (!row.lastVisit || s.date > row.lastVisit) row.lastVisit = s.date;
    stats.set(s.enrollmentNo, row);
  }
  return students
    .map((st) => ({
      ...st,
      batches: splitBatches(st.batch_tags),
      ...(stats.get(String(st.enrollment_no).trim()) ?? { sessions: 0, totalMins: 0, lastVisit: null })
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface SessionFilter {
  from?: string;
  to?: string;
  batch?: string;
  query?: string;
}

export function filterSessions(sessions: Session[], f: SessionFilter): Session[] {
  const q = (f.query || '').trim().toLowerCase();
  return sessions.filter((s) =>
    (!f.from || s.date >= f.from) &&
    (!f.to || s.date <= f.to) &&
    (!f.batch || s.batches.includes(f.batch)) &&
    (!q || s.name.toLowerCase().includes(q) || s.enrollmentNo.toLowerCase().includes(q) || s.activity.toLowerCase().includes(q)));
}

export function allBatches(students: Student[]): string[] {
  return [...new Set(students.flatMap((s) => splitBatches(s.batch_tags)))].sort();
}

export function formatDuration(mins: number | null): string {
  if (mins === null) return '—';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
}

/** RFC 4180 CSV; cells that start with = + - @ are prefixed so spreadsheets don't run them as formulas. */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (value: string | number | null) => {
    let s = value === null ? '' : String(value);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
