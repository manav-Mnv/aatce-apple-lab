# API Contract — AATCE backend (Supabase)

> **Version 3.0.0** · Endpoint `POST https://<project-ref>.supabase.co/rest/v1/rpc/api`
> Headers: `Content-Type: application/json`, `apikey: <publishable key>`
> Body: `{ "secret": "...", "action": "...", ...params }`

The whole API is one Postgres function, `public.api(jsonb)` (`supabase/migrations/…_core.sql`).
The publishable key only identifies the project; the **role secret** in the body authorises the call.
Responses always carry `success`; failures return HTTP 200 with
`{ "success": false, "error": "<text>", "error_code": "<code>" }`. Requests the Data API itself
rejects (bad JSON, wrong key) return a non-2xx status with a `PGRST…` body.

## Roles
| Role | Secret (Vault name) | Actions |
|---|---|---|
| kiosk | `aatce_kiosk_secret` | `status`, `lookup`, `enroll`, `upload_faces`, `scan`, `embeddings_version`, `embeddings_download` |
| pipeline | `aatce_pipeline_secret` | `status`, `embeddings_version`, `face_manifest`, `face_images`, `publish_embeddings` |
| admin | `aatce_admin_secret` | `status`, `embeddings_version`, `dashboard`, `occupancy`, `attendance_log`, `students`, `workshop_attendees`, `activity_get`, `activity_submit` |

Secrets are stored as SHA-256 hashes in `lab.secrets`; change one with
`select lab.set_secret('<role>', '<new secret>');` in the SQL editor.

## Error codes
| `error_code` | Meaning | Kiosk treats as |
|---|---|---|
| `auth_missing` / `auth_invalid` / `auth_misconfigured` | no / wrong secret, or none configured | permanent |
| `forbidden` | action not allowed for this role | permanent |
| `validation_error` | missing or malformed input | permanent |
| `consent_required` | `enroll` without `consent: true` | permanent |
| `not_enrolled` | unknown enrollment number / photos before enroll | permanent |
| `not_found` | nothing published yet / unknown photo or session | permanent |
| `cooldown` | scan within 2 min of the last one; adds `cooldown_remaining_seconds` | permanent |
| `version_conflict` | published version not greater than current | permanent |
| `unknown_action` / `invalid_json` | malformed request | permanent |
| `server_error` | unexpected database error (the call's changes are rolled back) | **retryable** |

`enrollment_no` must match `^[A-Za-z0-9_-]{1,32}$` (surrounding spaces trimmed). Times are ISO 8601 in Asia/Kolkata (`2026-10-05T09:00:00+05:30`).

## Any role
- **`status`** → `{ success, status: "online", timestamp, version: "3.0.0" }`
- **`embeddings_version`** → `{ success, version, generated_at, model_version, entry_count }` (`version: 0` before the first publish)

## Kiosk
- **`lookup`** `{ enrollment_no }` → `{ success, enrollment_no, is_member, is_enrolled, name, email_hint, photo_count }` (email masked `al•••@uni.ac.in`)
- **`enroll`** `{ enrollment_no, consent: true, name?, email? }` — members' identity comes from `lab.students`; non-members need `name` + valid `email`. Records consent; re-enrolling updates the same row. → `{ success, enrollment_no, name, email_hint, is_member, is_new, photo_count }`
- **`upload_faces`** `{ enrollment_no, images: [base64 JPEG ×1–5, each ≤ 200 KB] }` → `{ success, enrollment_no, saved, photo_count }` (appends, never replaces)
- **`scan`** `{ enrollment_no, method?: "face"|"manual", scanned_at?, workshop_name? }`
  - entry → `{ success, action: "entry", session_id, enrollment_no, name, entry_time }`
  - exit → `{ ..., action: "exit", entry_time, exit_time, duration_mins, activity_email_sent }` (email queued when ≥ 15 min)
  - non-member → `{ success, action: "workshop_attendee", enrollment_no, name, already_logged }` (once per day)
  - `scanned_at`: original time of an offline-queued scan, within the last 24 h (≤ 2 min ahead is clamped). `method: "manual"` adds `manual entry/exit` to the session notes.
- **`embeddings_download`** → `{ success, embeddings: { version, generated_at, model_version, entries: [{ enrollment_no, embedding_vector[512] }] } }`

## Pipeline
- **`face_manifest`** → `{ success, people: [{ enrollment_no, files: [{ id, name, size }] }] }`
- **`face_images`** `{ file_ids: [1–25 ids] }` → `{ success, images: [{ file_id, data: base64 }] }`
- **`publish_embeddings`** `{ embeddings }` — `version` integer > current; non-empty `generated_at`, `model_version`; every entry a unique valid `enrollment_no` with exactly 512 numbers. Keeps the last three versions. → `{ success, version, entry_count }`

## Admin
- **`dashboard`** → `{ success, occupancy, entries, students, workshops }` (the four lists below in one call)
- **`occupancy`** → `{ success, count, people: [{ session_id, enrollment_no, name, batch_tags, entry_time }] }`
- **`attendance_log`** `{ date?: "yyyy-mm-dd", enrollment_no? }` → `{ success, count, entries: [{ session_id, enrollment_no, entry_time, exit_time, duration_mins, activity_form_status, activity_description, email_sent, notes }] }` (`duration_mins` and `exit_time` are `""` while a session is open)
- **`students`** `{ batch? }` → `{ success, count, students: [{ enrollment_no, name, email, batch_tags, face_enrolled, photo_count, consent_at }] }`
- **`workshop_attendees`** → `{ success, count, attendees: [{ id, name, enrollment_no, email, workshop_name, date }] }`
- **`activity_get`** `{ session_id }` → `{ success, state: "form"|"done"|"invalid", name, entry_time, duration_mins }`
- **`activity_submit`** `{ session_id, text (1–1000 chars) }` → `{ success, result: "saved"|"already_submitted" }`

The last two back the portal's public page `/activity/<session_id>`, linked from the activity email.

## Changes from 2.1.0 (Apps Script)
Same actions and response shapes; new transport (Supabase RPC instead of `script.google.com/…/exec`),
`activity_get`/`activity_submit` replace the Apps Script form page, and emails are queued in the
database and sent by a scheduled job.
