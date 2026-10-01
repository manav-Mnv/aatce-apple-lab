# Backend — AATCE Apple Lab Attendance System

Google Apps Script Web App serving as the server-side glue for the AATCE attendance system (per [SRS v2.0 §2–3](../docs/SRS.md)).

## Architecture

- **Runtime:** Google Apps Script (V8)
- **Data store:** Google Sheets (no separate DB)
- **Auth:** Shared-secret header on every request ([NFR-4](../docs/SRS.md))
- **Writes:** All Sheet writes wrapped in `LockService` to prevent concurrent-write corruption

## Project Structure

```
backend/
├── appsscript.json          # Apps Script manifest (OAuth scopes, webapp config)
├── src/
│   ├── Main.gs              # doPost/doGet router — entry points
│   ├── Auth.gs              # Shared-secret validation
│   ├── Config.gs            # Central configuration (sheet names, columns, constants)
│   ├── SheetHelpers.gs      # Data access layer (batch reads, safe writes)
│   ├── Enroll.gs            # /enroll endpoint (FR-1 through FR-6)
│   ├── Scan.gs              # /scan endpoint (FR-7 through FR-12)
│   └── Embeddings.gs        # /embeddings endpoint (read/write embedding store)
├── tests/
│   └── test_backend.js      # Node.js unit tests (mocks Apps Script globals)
└── API_CONTRACT.md          # Full API documentation for consumers
```

## Setup

### 1. Google Sheets
Create two Google Sheets:
- **Master Sheet** — tab: `Master_Students` (columns: `enrollment_no, name, email, batch_tags, face_dataset_path, registered_at`)
- **AATCE Sheet** — tabs: `Attendance_Log`, `Other_Workshop_Attendees`, `Embeddings`

### 2. Script Properties
In the Apps Script editor → Project Settings → Script Properties, set:
- `SHARED_SECRET` — a random string (never committed to repo)
- `MASTER_SHEET_ID` — the Spreadsheet ID of the Master Sheet
- `ATTENDANCE_SHEET_ID` — the Spreadsheet ID of the AATCE Sheet

### 3. Deploy
Deploy as a web app (Execute as: Me, Access: Anyone).

### 4. `clasp` (optional, for local dev)
```bash
npm install -g @google/clasp
clasp login
clasp clone <SCRIPT_ID>
# Edit locally, then:
clasp push
```

## Testing

```bash
# Run unit tests (no Google account needed):
node tests/test_backend.js
```

## API

See [API_CONTRACT.md](API_CONTRACT.md) for full endpoint documentation.
