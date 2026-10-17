# AATCE Apple Lab Attendance System

![Status](https://img.shields.io/badge/status-in%20development-dbab09?style=flat-square)

Face-recognition check-in/check-out for the **Swift Coding Club's Apple Lab, Parul University**.
Students look at the lab iMac to check in and out; the kiosk recognises them on-device, attendance
lands in a Supabase database, students get a short "what did you work on?" email, and faculty see
everything in a web dashboard. Hosting cost: **$0**.

```
 Lab iMac ── AATCE Kiosk (SwiftUI)                 Faculty ── Admin portal (Next.js on Vercel)
   camera → Vision → FaceNet (Core ML)                Google sign-in (Firebase)
   → match on-device → head-turn liveness                    │
            │ kiosk secret                                    │ admin secret (server-side)
            ▼                                                 ▼
        Supabase Postgres (Mumbai) — one API function, private tables, scheduled emails
            ▲
            │ pipeline secret — GitHub Actions weekly: photos → FaceNet embeddings → publish
```

## Start here

| I want to… | Read |
|---|---|
| Understand how it works, the tech stack and the algorithms | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Set up the roster, GitHub, email, Firebase, Vercel | [docs/SETUP.md](docs/SETUP.md) |
| Install and run the kiosk on the lab iMac / any Mac | [docs/MAC_SETUP.md](docs/MAC_SETUP.md) |
| Call the backend | [supabase/API_CONTRACT.md](supabase/API_CONTRACT.md) |
| See what was fixed and what is still open | [docs/BUILD_REPORT.md](docs/BUILD_REPORT.md) |

## Repository

| Folder | What | Tech |
|---|---|---|
| [`macos-app/`](macos-app) | Kiosk app for the lab iMac | Swift 5.9, SwiftUI, AVFoundation, Vision, Core ML (macOS 13+) |
| [`supabase/`](supabase) | The backend: database, API, emails, schedules, tests | Postgres 17 (PL/pgSQL), pg_cron, pg_net, Vault |
| [`ml-training/`](ml-training) | Weekly embedding pipeline + Core ML export | Python 3.11, PyTorch, facenet-pytorch, coremltools |
| [`admin-portal/`](admin-portal) | Faculty dashboard + student activity form | Next.js 16, React 19, Tailwind 4, Firebase Auth |
| [`docs/`](docs) | PRD, SRS, architecture, setup guides, reports | Markdown |
| `.github/workflows/` | CI, weekly retrain, kiosk app build, Supabase keep-alive | GitHub Actions |

## Tests

| Component | Command | Where it runs |
|---|---|---|
| Backend (SQL) | paste `supabase/tests/api_test.sql` in the Supabase SQL editor → `TESTS PASSED: 70` | live project (rolls back) and CI |
| ML pipeline | `cd ml-training && pip install -r requirements-dev.txt && python -m pytest` | any OS |
| Admin portal | `cd admin-portal && npm test && npm run typecheck && npm run build` | any OS |
| Kiosk | `cd macos-app && swift test` | macOS (CI runs it) |

## Principles
- **Enrollment number is the key for everything.** A face is never stored on its own.
- **Biometric data stays private.** Photos and embeddings live only in the private database schema and move only through authenticated calls. Nothing biometric is committed to this (public) repo.
- **Consent first.** Nobody is enrolled without agreeing on the kiosk.
