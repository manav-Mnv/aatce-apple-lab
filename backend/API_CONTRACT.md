# API Contract — AATCE backend (Apps Script web app)

> **Version 2.0.0** · Base URL `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`
> Every call: **HTTP POST**, `Content-Type: application/json`, body `{ "secret": "...", "action": "...", ...params }`.

## Transport rules
- Apps Script cannot read custom headers, so the secret is in the JSON body — never in the URL.
- Apps Script answers a POST with **302** to `script.googleusercontent.com/...`, which must be fetched with **GET** (browsers, `fetch`, `urllib`, `URLSession` and `curl -L` without `-X POST` all do this). Do not re-POST the redirect.
- The HTTP status is always 200; success or failure is in the body. Every response has `success`.
- GET is only used for the student activity-form link (`?session=<uuid>`); any other GET returns `method_not_allowed`.

## Roles
The secret decides the role. Each role may only call its own actions; others return `forbidden`.

| Role | Script Property | Actions |
|---|---|---|
| kiosk | `KIOSK_SECRET` | `status`, `lookup`, `enroll`, `upload_faces`, `scan`, `embeddings_version`, `embeddings_download` |
| pipeline | `PIPELINE_SECRET` | `status`, `embeddings_version`, `face_manifest`, `face_images`, `publish_embeddings` |
| admin | `ADMIN_SECRET` | `status`, `embeddings_version`, `dashboard`, `occupancy`, `attendance_log`, `students`, `workshop_attendees` |

## Errors
```json
{ "success": false, "error": "<human-readable>", "error_code": "<code>" }
```
| `error_code` | Meaning | Kiosk treats as |
|---|---|---|
| `auth_missing` / `auth_invalid` | no / wrong secret | permanent |
| `auth_misconfigured` | no secrets set on the server | permanent |
| `forbidden` | action not allowed for this role | permanent |
| `validation_error` | missing or malformed input | permanent |
| `consent_required` | `enroll` without `consent: true` | permanent |
| `not_enrolled` | unknown enrollment number (scan) / photos before enroll | permanent |
| `not_found` | nothing published yet / file not in Face-Dataset | permanent |
| `cooldown` | scan within 2 min of the last one; adds `cooldown_remaining_seconds` | permanent |
| `version_conflict` | published version not greater than current | permanent |
| `unknown_action` / `invalid_json` / `method_not_allowed` | malformed request | permanent |
| `server_error` | exception (sheet missing, lock timeout, Google outage) | **retryable** |

`enrollment_no` everywhere must match `^[A-Za-z0-9_-]{1,32}$` (surrounding spaces are trimmed). Times are ISO 8601 in Asia/Kolkata (`2026-10-05T09:00:00+05:30`).

---

## Any role

### `status`
→ `{ "success": true, "status": "online", "timestamp": "...", "version": "2.0.0" }`

### `embeddings_version`
→ `{ "success": true, "version": 3, "generated_at": "2026-10-05T03:00:00+00:00", "model_version": "facenet-inceptionresnetv1-vggface2", "entry_count": 152 }`
(`version: 0` and empty strings before the first publish.)

## Kiosk

### `lookup` — `{ enrollment_no }`
Shows who is enrolling before consent. Email is masked.
→ `{ "success": true, "enrollment_no": "2021001", "is_member": true, "is_enrolled": false, "name": "Alice Student", "email_hint": "al•••@paruluniversity.ac.in", "photo_count": 0 }`

### `enroll` — `{ enrollment_no, consent: true, name?, email? }`
Members: identity comes from `Master_Students` (`name`/`email` ignored). Non-members: `name` and a valid `email` required. Records consent time in `Face_Enrollments`; re-enrolling updates the same row.
→ `{ "success": true, "enrollment_no": "W100", "name": "Guest User", "email_hint": "gu•••@gmail.com", "is_member": false, "is_new": true, "photo_count": 0 }`
Errors: `consent_required`, `validation_error`.

### `upload_faces` — `{ enrollment_no, images: [base64 JPEG, …] }`
1–5 JPEGs, each ≤ 200 KB (the kiosk sends 160×160 face crops). Saved to `Face-Dataset/<enrollment_no>/<yyyyMMdd-HHmmss>-<n>.jpg`; never overwrites.
→ `{ "success": true, "enrollment_no": "W100", "saved": 5, "photo_count": 5 }`
Errors: `not_enrolled` (call `enroll` first), `validation_error`.

### `scan` — `{ enrollment_no, method?: "face"|"manual", scanned_at?, workshop_name? }`
- `scanned_at`: original time of a scan replayed from the offline queue; must be within 24 h (≤ 2 min in the future is clamped).
- `method: "manual"` → `notes` gets `manual entry` / `manual exit`.

Entry → `{ "success": true, "action": "entry", "session_id": "uuid", "enrollment_no": "2021001", "name": "Alice Student", "entry_time": "..." }`
Exit → `{ ..., "action": "exit", "entry_time": "...", "exit_time": "...", "duration_mins": 90, "activity_email_sent": true }` (email only when ≥ 15 min)
Workshop attendee → `{ "success": true, "action": "workshop_attendee", "enrollment_no": "W100", "name": "Guest User", "already_logged": false }`
Errors: `cooldown` (+ `cooldown_remaining_seconds`), `not_enrolled`, `validation_error`.

### `embeddings_download`
→ `{ "success": true, "embeddings": { "version": 3, "generated_at": "...", "model_version": "...", "entries": [ { "enrollment_no": "2021001", "embedding_vector": [512 floats] } ] } }`
Error: `not_found` before the first publish.

## Pipeline

### `face_manifest`
→ `{ "success": true, "people": [ { "enrollment_no": "2021001", "files": [ { "id": "<drive id>", "name": "20261005-100000-1.jpg", "size": 8123 } ] } ] }`

### `face_images` — `{ file_ids: [1–25 ids] }`
Only files inside `Face-Dataset/<enrollment_no>/` are served.
→ `{ "success": true, "images": [ { "file_id": "...", "data": "<base64 JPEG>" } ] }`
Errors: `not_found`, `validation_error`.

### `publish_embeddings` — `{ embeddings: {embeddings.json object} }`
Validated: `version` integer > current, `generated_at` and `model_version` non-empty strings, every entry a valid unique `enrollment_no` with exactly **512** finite numbers. Stored as `Embeddings/embeddings-v<N>.json` (private).
→ `{ "success": true, "version": 4, "entry_count": 152 }`
Errors: `validation_error`, `version_conflict`.

## Admin

### `dashboard`
Everything the portal shows in **one** call (each Apps Script call costs ~1.5 s of startup):
→ `{ "success": true, "occupancy": [...], "entries": [...], "students": [...], "workshops": [...] }` — the same arrays as the four actions below.

### `occupancy`
Today's sessions without an exit.
→ `{ "success": true, "count": 2, "people": [ { "session_id": "...", "enrollment_no": "...", "name": "...", "batch_tags": "SCC/5-7", "entry_time": "..." } ] }`

### `attendance_log` — `{ date?: "yyyy-MM-dd", enrollment_no? }`
→ `{ "success": true, "count": N, "entries": [ { session_id, enrollment_no, entry_time, exit_time, duration_mins, activity_form_status, activity_description, email_sent, notes } ] }`

### `students` — `{ batch? }`
Roster joined with enrollment status (only the mapped `Master_Students` columns are returned).
→ `{ "success": true, "count": N, "students": [ { enrollment_no, name, email, batch_tags, face_enrolled, photo_count, consent_at } ] }`

### `workshop_attendees`
→ `{ "success": true, "count": N, "attendees": [ { id, name, enrollment_no, email, workshop_name, date } ] }`

---

## Activity form (students, no secret)
`GET <WEB_APP_URL>?session=<session_id>` renders the form; it submits through `google.script.run.submitActivity(sessionId, text)` (1–1000 characters, once per session).

## Changes from v1.2.0
New roles and `forbidden`; new `lookup`, `upload_faces`, `embeddings_download`, `face_manifest`, `face_images`, `publish_embeddings`, `occupancy`, `workshop_attendees`; `enroll` requires consent and no longer writes `Master_Students`; `scan` gains `name`, `method`, `scanned_at`, `not_enrolled`; `embeddings_version` no longer returns a public Drive download URL; `update_embeddings_meta` removed.
