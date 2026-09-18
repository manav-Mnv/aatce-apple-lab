# Backend — Google Apps Script API

## Setup

```bash
cd backend

# Install clasp globally if you haven't
npm install -g @anthropic/clasp

# Login to Google
clasp login

# Create a new Apps Script project (or set scriptId in .clasp.json)
clasp create --type webapp

# Push code to the Apps Script project
clasp push

# Deploy as Web App
# In Google Apps Script editor: Deploy > New deployment > Web app
# Execute as: Me, Access: Anyone
```

## Configure Script Properties

In the Apps Script editor, go to **Project Settings > Script properties** and add:

| Key                  | Value                  |
|----------------------|------------------------|
| `API_SHARED_SECRET`  | your-secure-secret-here|

Also replace the placeholder Sheet IDs in `Config.gs` with your real Google Sheet IDs.

## API

All requests are POST to the Web App URL.

### `route: "enroll"`

Single:
```json
{
  "route": "enroll",
  "studentId": "STU-001",
  "firstName": "Alice",
  "lastName": "Johnson",
  "email": "alice@example.com",
  "grade": "10"
}
```

Batch:
```json
{
  "route": "enroll",
  "students": [
    {"studentId": "STU-002", "firstName": "Bob", "lastName": "Smith", "grade": "11"},
    {"studentId": "STU-003", "firstName": "Carol", "lastName": "Lee", "grade": "9"}
  ]
}
```

Response:
```json
{
  "success": true,
  "enrolled": [
    {
      "token": "a1b2c3d4-e5f6-...",
      "pin": "123456",
      "studentId": "STU-001",
      "name": "Alice Johnson",
      "enrolledAt": "2026-09-18T..."
    }
  ],
  "count": 1
}
```

### `route: "scan"`

```json
{
  "route": "scan",
  "token": "a1b2c3d4-e5f6-...",
  "location": "main-gate"
}
```

Response (valid):
```json
{
  "success": true,
  "result": "valid",
  "student": {
    "studentId": "STU-001",
    "firstName": "Alice",
    "lastName": "Johnson",
    "grade": "10"
  },
  "scannedAt": "2026-09-18T..."
}
```

Response (invalid):
```json
{
  "success": true,
  "result": "invalid",
  "message": "Token not recognized"
}
```

Response (cooldown):
```json
{
  "success": true,
  "result": "duplicate",
  "message": "Scan rejected — within cooldown window"
}
```

## Auth

All requests must include the shared secret via:
- Header: `X-API-Secret: <secret>`, OR
- Query param: `?secret=<secret>`

## Testing with curl

```bash
chmod +x tests/test_curl.sh
# Edit the WEBAPP_URL and API_SECRET in the script
./tests/test_curl.sh
```
