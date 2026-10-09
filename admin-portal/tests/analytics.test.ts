import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  averageMinutes, buildSessions, dayKey, filterSessions, formatDuration, hourOf, lastDays,
  sessionsPerBatch, sessionsPerDay, sessionsPerHour, summarizeStudents, toCsv, uniqueStudents
} from '../lib/analytics.ts';
import { isAllowedEmail } from '../lib/access.ts';
import type { AttendanceEntry, Student } from '../lib/types.ts';

const students: Student[] = [
  { enrollment_no: '1', name: 'Alice Shah', email: 'a@x.edu', batch_tags: 'SCC/5-7', face_enrolled: true, photo_count: 5, consent_at: '' },
  { enrollment_no: '2', name: 'Bob Rao', email: 'b@x.edu', batch_tags: 'SCC/5-7, SCC/3-5', face_enrolled: false, photo_count: 0, consent_at: '' }
];

function entry(id: string, no: string | number, inAt: string, outAt = '', mins: number | string = '', notes = ''): AttendanceEntry {
  return { session_id: id, enrollment_no: no, entry_time: inAt, exit_time: outAt, duration_mins: mins,
    activity_form_status: 'pending', activity_description: '', email_sent: 'no', notes };
}

const entries = [
  entry('s1', '1', '2026-10-05T09:00:00+05:30', '2026-10-05T10:30:00+05:30', 90),
  entry('s2', 2, '2026-10-05T23:30:00+05:30', '', '', 'manual entry; no exit scan'),
  entry('s3', '1', '2026-10-04T17:10:00+05:30', '2026-10-04T17:40:00+05:30', '30'),
  entry('bad', '1', 'not a date')
];
const sessions = buildSessions(entries, students);
const now = new Date('2026-10-05T12:00:00+05:30');

test('days and hours are bucketed in lab time, not UTC', () => {
  assert.equal(dayKey(new Date('2026-10-05T23:30:00+05:30')), '2026-10-05'); // 18:00Z
  assert.equal(dayKey(new Date('2026-10-05T00:30:00+05:30')), '2026-10-05'); // previous day in UTC
  assert.equal(hourOf(new Date('2026-10-05T17:10:00+05:30')), 17);
});

test('buildSessions joins names and batches, parses durations and notes, drops bad rows', () => {
  assert.equal(sessions.length, 3);
  assert.deepEqual(sessions.map((s) => s.id), ['s2', 's1', 's3'], 'newest first');
  const bob = sessions.find((s) => s.id === 's2')!;
  assert.equal(bob.name, 'Bob Rao');
  assert.deepEqual(bob.batches, ['SCC/5-7', 'SCC/3-5']);
  assert.equal(bob.durationMins, null);
  assert.equal(bob.exit, null);
  assert.equal(bob.manual, true);
  assert.equal(bob.noExit, true);
  assert.equal(sessions.find((s) => s.id === 's3')!.durationMins, 30);
});

test('per-day counts include empty days', () => {
  assert.deepEqual(lastDays(3, now), ['2026-10-03', '2026-10-04', '2026-10-05']);
  assert.deepEqual(sessionsPerDay(sessions, 3, now).map((d) => d.count), [0, 1, 2]);
});

test('per-hour and per-batch counts', () => {
  const hours = sessionsPerHour(sessions);
  assert.equal(hours[9] + hours[17] + hours[23], 3);
  assert.deepEqual(sessionsPerBatch(sessions), [
    { batch: 'SCC/5-7', sessions: 3, students: 2 },
    { batch: 'SCC/3-5', sessions: 1, students: 1 }
  ]);
});

test('averages ignore open sessions', () => {
  assert.equal(averageMinutes(sessions), 60);
  assert.equal(averageMinutes([]), null);
  assert.equal(uniqueStudents(sessions), 2);
});

test('student summaries', () => {
  const [alice, bob] = summarizeStudents(students, sessions);
  assert.deepEqual([alice.sessions, alice.totalMins, alice.lastVisit], [2, 120, '2026-10-05']);
  assert.deepEqual([bob.sessions, bob.totalMins], [1, 0]);
});

test('filters', () => {
  assert.equal(filterSessions(sessions, { from: '2026-10-05' }).length, 2);
  assert.equal(filterSessions(sessions, { to: '2026-10-04' }).length, 1);
  assert.equal(filterSessions(sessions, { batch: 'SCC/3-5' }).length, 1);
  assert.equal(filterSessions(sessions, { query: 'alice' }).length, 2);
  assert.equal(filterSessions(sessions, { query: '2' }).length, 1);
});

test('formatDuration', () => {
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(45), '45 min');
  assert.equal(formatDuration(125), '2 h 05 min');
});

test('CSV quoting and formula protection', () => {
  assert.equal(toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['=SUM(A1)', null]]),
    'a,b\r\n"x,y","say ""hi"""\r\n\'=SUM(A1),');
});

test('admin access: domain or explicit list, nothing by default', () => {
  assert.equal(isAllowedEmail('Prof@PaRulUniversity.ac.in', 'paruluniversity.ac.in', ''), true);
  assert.equal(isAllowedEmail('x@paruluniversity.ac.in.evil.com', 'paruluniversity.ac.in', ''), false);
  assert.equal(isAllowedEmail('mentor@gmail.com', 'paruluniversity.ac.in', 'mentor@gmail.com, other@x.io'), true);
  assert.equal(isAllowedEmail('anyone@gmail.com', undefined, undefined), false);
});
