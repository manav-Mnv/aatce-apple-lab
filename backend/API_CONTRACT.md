# API Contract — AATCE Backend (Apps Script Web App)

> **Version:** 1.1.0  
> **Base URL:** `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`  
> **Auth:** `X-Shared-Secret` header on every request (see Authentication below)

---

## Authentication (FR-13, NFR-4)

Every request must include the shared secret via the `X-Shared-Secret` HTTP header:

```
X-Shared-Secret: <YOUR_SECRET>
```

**Example (curl):**
```bash
curl -H "X-Shared-Secret: $SECRET" \
     "https://script.google.com/macros/s/.../exec?action=status"
```

> **Apps Script limitation:** Google Apps Script web apps do not expose custom
> request headers in the `doPost`/`doGet` event object. As a workaround, the
> backend also accepts the secret in the POST body `{ "secret": "..." }`.
> Callers should always send the header; the body fallback exists only for
> compatibility with the Apps Script platform.

**Error responses:**
```json
{ "success": false, "error": "Missing authentication: send X-Shared-Secret header", "error_code": "auth_missing" }
{ "success": false, "error": "Invalid authentication secret", "error_code": "auth_invalid" }
```

---

## Error Responses

All errors include a machine-readable `error_code` so callers can branch without string-matching:

```json
{
  "success": false,
  "error": "<human-readable message>",
  "error_code": "<machine-readable code>"
}
```

| error_code | Meaning | HTTP-equivalent |
|---|---|---|
| `auth_missing` | No secret provided | 401 |
| `auth_invalid` | Wrong secret | 403 |
| `auth_misconfigured` | Server-side secret not set | 500 |
| `validation_error` | Missing/invalid required fields | 400 |
| `cooldown` | Scan cooldown active (FR-11) — includes `cooldown_remaining_seconds` | 429 |
| `unknown_action` | Unrecognized `action` parameter | 400 |
| `invalid_json` | POST body is not valid JSON | 400 |
| `server_error` | Internal server error | 500 |

---

## POST Endpoints

### `POST /exec` — Enroll (FR-1 through FR-6)

**Headers:** `X-Shared-Secret: <secret>`  
**Body:**
```json
{
  "action": "enroll",
  "enrollment_no": "2021001",
  "name": "Alice Student",
  "email": "alice@paruluniversity.ac.in"
}
```
- `name` and `email` required only for new students (not in Master_Students)

**Response (existing student):**
```json
{
  "success": true,
  "enrollment_no": "2021001",
  "name": "Alice Student",
  "email": "alice@paruluniversity.ac.in",
  "is_new": false,
  "face_dataset_path": "/Face-Dataset/2021001/",
  "registered_at": "2026-10-01T10:00:00+05:30"
}
```

**Response (new student):**
```json
{
  "success": true,
  "enrollment_no": "2025999",
  "name": "New Person",
  "email": "new@test.com",
  "is_new": true,
  "face_dataset_path": "/Face-Dataset/2025999/",
  "registered_at": "2026-10-01T14:30:00+05:30"
}
```

**Errors:** `validation_error` (missing enrollment_no, or missing name/email for new student)

---

### `POST /exec` — Scan (FR-7 through FR-12)

**Headers:** `X-Shared-Secret: <secret>`  
**Body:**
```json
{
  "action": "scan",
  "enrollment_no": "2021001"
}
```

**Response (entry — no open session today):**
```json
{
  "success": true,
  "action": "entry",
  "session_id": "a1b2c3d4-uuid",
  "enrollment_no": "2021001",
  "entry_time": "2026-10-01T09:00:00+05:30"
}
```

**Response (exit — open session found):**
```json
{
  "success": true,
  "action": "exit",
  "session_id": "a1b2c3d4-uuid",
  "enrollment_no": "2021001",
  "entry_time": "2026-10-01T09:00:00+05:30",
  "exit_time": "2026-10-01T11:30:00+05:30",
  "duration_mins": 150
}
```

**Response (cooldown — FR-11):**
```json
{
  "success": false,
  "error": "Cooldown active. Please wait 85 seconds.",
  "error_code": "cooldown",
  "cooldown_remaining_seconds": 85
}
```

**Response (not in Master_Students — FR-12):**
```json
{
  "success": true,
  "action": "workshop_attendee",
  "enrollment_no": "9999999",
  "message": "Logged as workshop attendee (not in Master_Students roster)"
}
```

**Errors:** `validation_error`, `cooldown`

---

### `POST /exec` — Update Embeddings Metadata

**Headers:** `X-Shared-Secret: <secret>`  
**Body:**
```json
{
  "action": "update_embeddings_meta",
  "version": 2,
  "generated_at": "2026-10-01T12:00:00+05:30",
  "model_version": "facenet-v2",
  "drive_file_id": "1AbCdEfGhIjKlMnOpQrStUvWxYz",
  "entry_count": 152
}
```
Called by the ML pipeline after uploading `embeddings.json` to Drive.

**Response:**
```json
{
  "success": true,
  "message": "Embeddings metadata updated",
  "version": 2
}
```

---

## GET Endpoints

### `GET /exec?action=embeddings_version` — Embeddings Version Check

**Headers:** `X-Shared-Secret: <secret>`

The kiosk calls this to check whether a newer `embeddings.json` is available.
If `version > local_version`, the kiosk downloads the file directly from Drive
using `download_url`. The full embedding vectors are **never** routed through
Apps Script (NFR-7).

**Response:**
```json
{
  "success": true,
  "version": 3,
  "generated_at": "2026-10-01T12:00:00+05:30",
  "model_version": "facenet-v1",
  "drive_file_id": "1AbCdEfGhIjKlMnOpQrStUvWxYz",
  "entry_count": 152,
  "download_url": "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz"
}
```

---

### `GET /exec?action=status` — Health Check

**Headers:** `X-Shared-Secret: <secret>`

**Response:**
```json
{
  "success": true,
  "status": "online",
  "timestamp": "2026-10-01T14:00:00+05:30",
  "version": "1.0.0"
}
```

---

### `GET /exec?action=attendance_log` — Attendance Log (FR-20)

**Headers:** `X-Shared-Secret: <secret>`  
**Optional filters:** `&date=2026-10-01` `&enrollment_no=2021001`

**Response:**
```json
{
  "success": true,
  "count": 2,
  "entries": [
    {
      "session_id": "...",
      "enrollment_no": "2021001",
      "entry_time": "2026-10-01T09:00:00+05:30",
      "exit_time": "2026-10-01T11:30:00+05:30",
      "duration_mins": 150,
      "activity_form_status": "completed",
      "activity_description": "Worked on SwiftUI tutorial",
      "email_sent": "yes",
      "notes": ""
    }
  ]
}
```

---

### `GET /exec?action=students` — Student Roster (FR-20)

**Headers:** `X-Shared-Secret: <secret>`  
**Optional filters:** `&batch=SCC/5-7` `&enrollment_no=2021001`

**Response:**
```json
{
  "success": true,
  "count": 2,
  "students": [
    {
      "enrollment_no": "2021001",
      "name": "Alice Student",
      "email": "alice@paruluniversity.ac.in",
      "batch_tags": "SCC/5-7",
      "face_dataset_path": "/Face-Dataset/2021001/",
      "registered_at": "2026-01-15T10:00:00+05:30"
    }
  ]
}
```

---

## Embeddings Architecture

```
ML Pipeline (GitHub Actions)
  │
  ├─ generates embeddings.json
  ├─ uploads to Google Drive ──────────────────────┐
  └─ calls POST update_embeddings_meta             │
       │                                           │
       v                                           v
  Apps Script (Embeddings Sheet tab)         Google Drive
  stores: version, drive_file_id            stores: embeddings.json
       │                                           │
       v                                           v
  Kiosk: GET embeddings_version ──► if new ──► download from Drive
```

**embeddings.json schema** (stored in Drive, generated by ML pipeline):
```json
{
  "version": "<integer, auto-incrementing>",
  "generated_at": "<ISO 8601 timestamp>",
  "model_version": "<string, e.g. 'facenet-v1'>",
  "entries": [
    {
      "enrollment_no": "<string>",
      "embedding_vector": ["<array of floats, 512 dimensions>"]
    }
  ]
}
```
