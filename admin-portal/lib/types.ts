/** Shapes returned by the backend's admin actions (supabase/API_CONTRACT.md). */

export interface AttendanceEntry {
  session_id: string;
  enrollment_no: string | number;
  entry_time: string;
  exit_time: string;
  duration_mins: number | string;
  activity_form_status: string;
  activity_description: string;
  email_sent: string;
  notes: string;
}

export interface Student {
  enrollment_no: string;
  name: string;
  email: string;
  batch_tags: string;
  face_enrolled: boolean;
  photo_count: number;
  consent_at: string;
}

export interface OccupancyPerson {
  session_id: string;
  enrollment_no: string;
  name: string;
  batch_tags: string;
  entry_time: string;
}

export interface WorkshopAttendee {
  id: string;
  name: string;
  enrollment_no: string | number;
  email: string;
  workshop_name: string;
  date: string;
}

export interface LabData {
  fetchedAt: string;
  occupancy: OccupancyPerson[];
  entries: AttendanceEntry[];
  students: Student[];
  workshops: WorkshopAttendee[];
  /** Missing in data cached before backend v3.1. */
  kiosk?: KioskInfo;
}

export interface KioskEvent {
  at: string;
  kind: 'recognized' | 'unrecognized' | 'liveness_failed' | 'queued' | 'error';
  enrollment_no: string;
  name: string;
  score: number | null;
  detail: string;
}

/** The kiosk's last heartbeat and its recent scan attempts. */
export interface KioskInfo {
  last_seen: string;
  online: boolean;
  app_version: string;
  queued: number;
  faces: number;
  embeddings_version: number;
  workshop_name: string;
  match_threshold: number | null;
  problem: string;
  today: { recognized: number; unrecognized: number; liveness_failed: number };
  events: KioskEvent[];
}
