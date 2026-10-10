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

/** Everything the dashboard shows, in one backend call (each Apps Script call costs ~1.5 s). */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const dashboard = await callBackend<Dashboard>('dashboard');
    const data: LabData = {
      fetchedAt: new Date().toISOString(),
      occupancy: dashboard.occupancy,
      entries: dashboard.entries,
      students: dashboard.students,
      workshops: dashboard.workshops
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
