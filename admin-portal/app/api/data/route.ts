import { NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth-server';
import { BackendError, callBackend } from '@/lib/backend';
import type { AttendanceEntry, LabData, OccupancyPerson, Student, WorkshopAttendee } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface Dashboard {
  occupancy: OccupancyPerson[];
  entries: AttendanceEntry[];
  students: Student[];
  workshops: WorkshopAttendee[];
}

/**
 * One `dashboard` call (each Apps Script call costs ~1.5 s). If the deployed backend
 * is older and doesn't know `dashboard` yet, fall back to the four separate actions,
 * so a portal deployed ahead of the backend keeps working.
 */
async function loadDashboard(): Promise<Dashboard> {
  try {
    return await callBackend<Dashboard>('dashboard');
  } catch (error) {
    if (!(error instanceof BackendError) || error.code !== 'unknown_action') throw error;
    const [occupancy, log, roster, workshops] = await Promise.all([
      callBackend<{ people: OccupancyPerson[] }>('occupancy'),
      callBackend<{ entries: AttendanceEntry[] }>('attendance_log'),
      callBackend<{ students: Student[] }>('students'),
      callBackend<{ attendees: WorkshopAttendee[] }>('workshop_attendees')
    ]);
    return { occupancy: occupancy.people, entries: log.entries, students: roster.students, workshops: workshops.attendees };
  }
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const dashboard = await loadDashboard();
    const data: LabData = { fetchedAt: new Date().toISOString(), ...dashboard };
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof BackendError) {
      console.error(`Backend ${error.code}: ${error.message}`);
      return NextResponse.json({ error: `Backend unavailable (${error.code})` }, { status: 502 });
    }
    console.error(error);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
