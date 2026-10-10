# Backend — Google Apps Script web app

The only server in the system: JSON API for the kiosk, the ML pipeline and the admin portal; the
student activity form; the nightly stale-session job. Reads/writes Google Sheets and Drive and
sends mail as the deploying account.

- API: [API_CONTRACT.md](API_CONTRACT.md) (v2.0.0)
- Setup and deployment: [../docs/SETUP.md](../docs/SETUP.md) Part 1–3
- Design and algorithms: [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)

## Files (`src/` is exactly what gets pushed to Apps Script)

| File | Responsibility |
|---|---|
| `appsscript.json` | Manifest: V8, Asia/Kolkata, web app *execute as me / anyone (anonymous)*, OAuth scopes |
| `Main.gs` | `doPost` router (auth → role check → lock for writes), `doGet` (activity form only) |
| `Auth.gs` | Per-role secrets, constant-time comparison |
| `Config.gs` | Tab names, headers, `MASTER_COLUMNS`, `ROLE_ACTIONS`, limits and thresholds |
| `Sheets.gs` | Table read by header name, append/update, formula-injection guard, script lock, time helpers |
| `Enroll.gs` | `lookup`, `enroll` (consent), `upload_faces` |
| `Scan.gs` | `scan`: entry/exit, cooldown, workshop attendees, offline `scanned_at`, manual audit |
| `Activity.gs` + `ActivityForm.html` | Activity email, form page, `submitActivity`, nightly `closeStaleSessions` |
| `Embeddings.gs` | `embeddings_version`, `embeddings_download`, `face_manifest`, `face_images`, `publish_embeddings` |
| `Admin.gs` | `occupancy`, `attendance_log`, `students`, `workshop_attendees` |
| `Setup.gs` | Owner-only `setupSheets()` and `installTriggers()` |

Internal functions end in `_` (private in Apps Script), so the activity-form page cannot call them.

## Develop and test

```bash
node tests/test_backend.js
```
51 tests run the real `src/*.gs` files against in-memory Sheets/Drive/Mail/Lock/clock (`tests/gas-mocks.js`).

```bash
node dev/server.js
```
Local backend on `http://localhost:8787/exec` with seeded fictional data (secrets `dev-kiosk-secret`, `dev-pipeline-secret`, `dev-admin-secret`).

Deploy with clasp: copy `.clasp.json.example` to `.clasp.json`, add your Script ID, then `clasp push --force` and **Deploy → Manage deployments → Edit → New version** (keeps the URL).
