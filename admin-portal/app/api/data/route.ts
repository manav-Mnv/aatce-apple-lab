import { NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth-server';
import { BackendError, callBackend } from '@/lib/backend';
import type { AttendanceEntry, LabData, OccupancyPerson, Student, WorkshopAttendee } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Everything the dashboard shows, fetched in parallel. One lab's data is small enough to send whole. */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const [occupancy, log, roster, workshops] = await Promise.all([
      callBackend<{ people: OccupancyPerson[] }>('occupancy'),
      callBackend<{ entries: AttendanceEntry[] }>('attendance_log'),
      callBackend<{ students: Student[] }>('students'),
      callBackend<{ attendees: WorkshopAttendee[] }>('workshop_attendees')
    ]);
    const data: LabData = {
      fetchedAt: new Date().toISOString(),
      occupancy: occupancy.people,
      entries: log.entries,
      students: roster.students,
      workshops: workshops.attendees
    };
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
