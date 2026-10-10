# AATCE Apple Lab Attendance System

Face-recognition check-in/check-out for the **Swift Coding Club's Apple Lab, Parul University**.
Students look at the lab iMac to check in and out; the kiosk recognises them on-device, the
attendance lands in Google Sheets, students get a short "what did you work on?" email, and
faculty see everything in a web dashboard. Hosting cost: **$0**.

```
 Lab iMac ── AATCE Kiosk (SwiftUI)                 Faculty ── Admin portal (Next.js on Vercel)
   camera → Vision face box → FaceNet (Core ML)        Google sign-in (Firebase)
   → match on-device → liveness head-turn                    │
            │  POST + kiosk secret                            │ POST + admin secret (server-side)
            ▼                                                 ▼
        Google Apps Script web app  ──────────────►  Google Sheets  (attendance, roster, enrollments)
            │      ▲                               ►  Google Drive   (face photos, embeddings.json)
            │      │ POST + pipeline secret        ►  Gmail          (activity-form emails)
            │      │
            │   GitHub Actions, weekly: download photos → FaceNet embeddings → publish
            ▼
        kiosk downloads the new embeddings when the version changes
```

## Start here

| I want to… | Read |
|---|---|
| Understand how it works, the tech stack and the algorithms | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Set up Google Sheets, Apps Script, GitHub secrets, Firebase, Vercel | [docs/SETUP.md](docs/SETUP.md) |
| Install and run the kiosk on the lab iMac / any Mac | [docs/MAC_SETUP.md](docs/MAC_SETUP.md) |
| Call the backend | [backend/API_CONTRACT.md](backend/API_CONTRACT.md) |
| See what was fixed and what is still open | [docs/BUILD_REPORT.md](docs/BUILD_REPORT.md) |

## Repository

| Folder | What | Tech |
|---|---|---|
| [`macos-app/`](macos-app) | Kiosk app for the lab iMac | Swift 5.9, SwiftUI, AVFoundation, Vision, Core ML (macOS 13+) |
| [`backend/`](backend) | The only server: API, activity form, nightly job | Google Apps Script (V8), Sheets, Drive, MailApp |
| [`ml-training/`](ml-training) | Weekly embedding pipeline + Core ML export | Python 3.11, PyTorch, facenet-pytorch, coremltools |
| [`admin-portal/`](admin-portal) | Faculty dashboard | Next.js 16, React 19, Tailwind 4, Firebase Auth, jose |
| [`docs/`](docs) | PRD, SRS, architecture, setup guides, reports | Markdown |
| `.github/workflows/` | CI, weekly retrain, kiosk app build | GitHub Actions |

## Run everything locally (no Google account needed)

```bash
node backend/dev/server.js
```
This runs the **real** backend code against in-memory Google services with three weeks of
fictional data, on `http://localhost:8787/exec` (secrets: `dev-kiosk-secret`, `dev-pipeline-secret`, `dev-admin-secret`).

```bash
cd admin-portal && cp .env.example .env.local && npm install && npm run dev
```
Open http://localhost:3000.

## Tests

| Component | Command | Where it runs |
|---|---|---|
| Backend | `node backend/tests/test_backend.js` | any OS |
| ML pipeline | `cd ml-training && pip install -r requirements-dev.txt && python -m pytest` | any OS |
| Admin portal | `cd admin-portal && npm test && npm run typecheck && npm run build` | any OS |
| Kiosk | `cd macos-app && swift test` | macOS only (CI runs it) |

## Principles
- **Enrollment number is the key for everything.** A face is never stored on its own.
- **Biometric data stays private.** Photos and embeddings live only in the club's private Drive and move only through authenticated calls. Nothing biometric is committed to this (public) repo.
- **Consent first.** Nobody is enrolled without agreeing on the kiosk.
