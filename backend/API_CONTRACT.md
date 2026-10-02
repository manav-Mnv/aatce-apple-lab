# API Contract — AATCE Backend (Apps Script Web App)

> **Version:** 1.2.0  
> **Base URL:** `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`  
> **Auth:** JSON body `secret` on every request (see Authentication below)
> **Methods:** POST only (GET is disabled)

---

## Authentication (FR-13, NFR-4)

Due to Google Apps Script platform limitations, custom HTTP headers (like `X-Shared-Secret`) are not exposed to the `doPost` or `doGet` event objects in deployed web apps. 

To ensure the secret is not logged in URL query parameters (which appear in server logs and browser history), **all requests must be sent as HTTP POST** with the secret embedded directly in the JSON body payload.

**Example:**
```json
{
  "secret": "<YOUR_SECRET>",
  "action": "status"
}
```

**Error responses:**
```json
{ "success": false, "error": "Missing authentication: include \"secret\" in JSON body", "error_code": "auth_missing" }
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
| `method_not_allowed` | Request sent via GET instead of POST | 405 |

---

## Endpoints (All POST)

### `POST /exec` — Enroll (FR-1 through FR-6)

**Body:**
```json
{
  "secret": "<secret>",
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

**Body:**
```json
{
  "secret": "<secret>",
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

**Body:**
```json
{
  "secret": "<secret>",
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

### `POST /exec` — Embeddings Version Check

The kiosk calls this to check whether a newer `embeddings.json` is available.
If `version > local_version`, the kiosk downloads the file directly from Drive
using `download_url`. The full embedding vectors are **never** routed through
Apps Script (NFR-7).

**Body:**
```json
{
  "secret": "<secret>",
  "action": "embeddings_version"
}
```

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

### `POST /exec` — Health Check

**Body:**
```json
{
  "secret": "<secret>",
  "action": "status"
}
```

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

### `POST /exec` — Attendance Log (FR-20)

**Body:**
```json
{
  "secret": "<secret>",
  "action": "attendance_log",
  "date": "2026-10-01",
  "enrollment_no": "2021001"
}
```
(Both `date` and `enrollment_no` are optional filters)

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

### `POST /exec` — Student Roster (FR-20)

**Body:**
```json
{
  "secret": "<secret>",
  "action": "students",
  "batch": "SCC/5-7",
  "enrollment_no": "2021001"
}
```
(Both `batch` and `enrollment_no` are optional filters)

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
  Kiosk: POST embeddings_version ──► if new ──► download from Drive
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
