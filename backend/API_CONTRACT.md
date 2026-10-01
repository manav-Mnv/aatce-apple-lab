# API Contract — AATCE Backend (Apps Script Web App)

> **Version:** 1.0.0  
> **Base URL:** `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`  
> **Auth:** All requests require a shared secret (see Authentication below)

---

## Authentication (FR-13, NFR-4)

Every request must include the shared secret. Two methods:

1. **Query parameter:** `?secret=<YOUR_SECRET>`
2. **JSON body field:** `{ "secret": "<YOUR_SECRET>", ... }`

Requests without a valid secret receive:
```json
{ "success": false, "error": "Missing authentication secret" }
```

---

## POST Endpoints

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
- `name` and `email` are required only for new students (not in Master_Students)

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

**Response (cooldown active — FR-11):**
```json
{
  "success": false,
  "error": "Cooldown active. Please wait 85 seconds.",
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

---

### `POST /exec` — Update Embeddings

**Body:**
```json
{
  "secret": "<secret>",
  "action": "update_embeddings",
  "embeddings": {
    "version": 2,
    "generated_at": "2026-10-01T12:00:00+05:30",
    "model_version": "facenet-v2",
    "entries": [
      { "enrollment_no": "2021001", "embedding_vector": [0.1, -0.2, 0.3, ...] },
      { "enrollment_no": "2021002", "embedding_vector": [0.4, 0.5, -0.6, ...] }
    ]
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Embeddings updated",
  "version": 2,
  "entry_count": 2
}
```

---

## GET Endpoints

### `GET /exec?action=embeddings` — Get Embeddings

**Query:** `?secret=<secret>&action=embeddings`

**Response:**
```json
{
  "success": true,
  "embeddings": {
    "version": 1,
    "generated_at": "2026-09-30T12:00:00+05:30",
    "model_version": "facenet-v1",
    "entries": [
      { "enrollment_no": "2021001", "embedding_vector": [0.1, 0.2, 0.3] }
    ]
  }
}
```

---

### `GET /exec?action=status` — Health Check

**Query:** `?secret=<secret>&action=status`

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

**Query:** `?secret=<secret>&action=attendance_log`  
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

**Query:** `?secret=<secret>&action=students`  
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

## embeddings.json Schema

This is the canonical schema used by:
- **ML pipeline** (writes it)
- **Backend** (stores/serves it)
- **Kiosk app** (consumes it for on-device matching)

```json
{
  "version": "<integer, auto-incrementing>",
  "generated_at": "<ISO 8601 timestamp>",
  "model_version": "<string, e.g. 'facenet-v1'>",
  "entries": [
    {
      "enrollment_no": "<string>",
      "embedding_vector": ["<array of floats, 128 or 512 dimensions>"]
    }
  ]
}
```

---

## Error Responses

All errors follow this shape:
```json
{
  "success": false,
  "error": "<human-readable error message>"
}
```
