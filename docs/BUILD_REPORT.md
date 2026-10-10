# AATCE Apple Lab — Build Report (branch `feature/full-build`)

Date: 2026-10-10. Companion to `docs/AUDIT_REPORT.md`.

## Verified results
| Component | Result |
|---|---|
| Backend (Apps Script, real `.gs` on in-memory Google services) | 51/51 tests |
| ML pipeline | 61/61 tests; real FaceNet weights run in WSL → valid 512-d unit vectors |
| Core ML export (macOS CI) | Core ML vs PyTorch cosine = 1.000000 |
| Kiosk app (macOS CI) | builds with 0 warnings, 24/24 Swift tests, `.app` bundled with model (artifact `AATCE-Kiosk`) |
| Admin portal | 10/10 tests, typecheck, production build; tested in browser (dark, light, mobile); prod API rejects unauthenticated and forged tokens |

## Issues fixed (audit IDs)
| Issue | Fix |
|---|---|
| S1 biometric data public | No commits/artifacts/caches of faces or embeddings; embeddings downloaded via authenticated `embeddings_download`; Drive files stay private |
| K1 kiosk POST redirect | Custom redirect handler removed; URLSession follows 302 as GET |
| A1 one secret for everything | `KIOSK_SECRET`, `PIPELINE_SECRET`, `ADMIN_SECRET` with per-role action lists (`forbidden`) |
| A2 portal auth | Next.js server routes hold the admin secret and verify Firebase ID tokens with Google's public keys and domain/allow-list |
| M1 model mismatch | Kiosk uploads its own 160×160 crops; pipeline embeds the same crops; same model exported to Core ML (parity check in CI) |
| E1 no photo upload | `upload_faces` action → `Face-Dataset/<enrollment_no>/` |
| B1 non-members written to roster | `Master_Students` is read-only; enrollments in new `Face_Enrollments` tab |
| B2 sessions never closed | Nightly `closeStaleSessions` trigger marks “no exit scan” and still sends the activity email |
| C1 no consent | `enroll` requires `consent: true`; `consent_at` recorded |
| W1/W2 retrain workflow | Rewritten: sync → pipeline → publish; skips cleanly if secrets are missing |
| NEW manifest `ANYONE` | Changed to `ANYONE_ANONYMOUS` (otherwise the kiosk hits a Google login page) |
| NEW `google.script.run` exposure | All internal functions are private (`_`); test asserts the public surface |
| NEW formula injection | User text starting with `= + - @` is stored as text (sheets and CSV export) |
| NEW offline replay time | `scanned_at` honoured (≤24 h); durable queue on kiosk |
| NEW proxy check-ins | Manual scans noted (`manual entry/exit`) and badged in the portal |
| NEW activity link in trigger emails | Optional `WEB_APP_URL` property |
| NEW coremltools + numpy 2.4 crash | Pinned in `requirements-export.txt` |
| NEW portal hydration mismatch | Portal renders after mount (all data is client-side) |

## Decisions taken on your behalf
- No Google Cloud project needed: the pipeline talks only to Apps Script.
- Activity email only for sessions ≥ 15 minutes; one combined head-turn liveness check (not spoof-proof against video; acceptable for attendance).
- Match threshold 0.65 plus a 0.05 lead over the next person.

## Known limitations / open
- MailApp limit is 100 emails/day on a personal Gmail account (use a Workspace account for more).
- `Attendance_Log` is read in full on every scan; archive it yearly beyond ~30k rows.
- `npm audit` flags Firestore's gRPC inside `firebase`; the portal only uses Auth.
- Two roles must not share the same secret.
- Docs refreshed (README, ARCHITECTURE, SETUP, MAC_SETUP, API_CONTRACT v2.0.0, SRS v2.1); unused orchestration skeleton and empty logs removed.
- Still open: create the real Google resources and secrets (SETUP.md), merge `feature/full-build` into `master`, first real-device test of the kiosk.

## What you need to provide — step by step in [SETUP.md](SETUP.md)
Script Properties: `KIOSK_SECRET`, `PIPELINE_SECRET`, `ADMIN_SECRET` (each `openssl rand -hex 32`), `MASTER_SHEET_ID`, `ATTENDANCE_SHEET_ID`, `FACE_DATASET_FOLDER_ID`, `EMBEDDINGS_FOLDER_ID`, `WEB_APP_URL`. Then run `setupSheets()` and `installTriggers()` in the editor.
GitHub secrets: `APPS_SCRIPT_URL`, `PIPELINE_SECRET`.
Vercel env: `APPS_SCRIPT_URL`, `ADMIN_SECRET`, `NEXT_PUBLIC_FIREBASE_*` (4), `NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN` and/or `ADMIN_EMAILS`.
Kiosk: Settings (⌘,) → web app URL + kiosk secret.

## Run locally
```
node backend/dev/server.js          # real backend logic, seeded data, :8787
cd admin-portal && npm run dev      # portal on :3000 (.env.local: APPS_SCRIPT_URL, ADMIN_SECRET=dev-admin-secret)
```
