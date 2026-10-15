# AATCE Apple Lab — Build Report (branch `feature/full-build`)

Date: 2026-10-10. Companion to `docs/AUDIT_REPORT.md`.

## Verified results
| Component | Result |
|---|---|
| Backend (Supabase, live project `aatce-apple-lab`) | 70/70 SQL tests on the live database (rolled back), also in CI on Postgres 17; security advisor clean except intended notes |
| Live API speed (PC → Mumbai, warm) | `status` 0.15 s, full `dashboard` 0.3 s (Apps Script was 1.5–3 s) |
| Portal ↔ live Supabase | Activity page renders the real session, form saves, "Already logged" on reload; warm page 0.1 s |
| ML pipeline | 62/62 tests; real FaceNet weights run in WSL → valid 512-d unit vectors |
| Core ML export (macOS CI) | Core ML vs PyTorch cosine = 1.000000 |
| Kiosk app (macOS CI) | builds with 0 warnings, Swift tests pass, `.app` bundled with model (artifact `AATCE-Kiosk`) |
| Admin portal | 10/10 tests, typecheck, production build; browser-tested (dark, light, mobile); prod API rejects unauthenticated and forged tokens |

## Backend move: Apps Script → Supabase (v3.0.0)
Why: every Apps Script request cost ~1.5 s before doing any work, and deploys were manual
copy-paste (the live backend drifted from the code once and the portal broke).

- All logic is PL/pgSQL behind one function, `public.api(jsonb)`; clients send the **same request bodies** as before, so the iMac app, pipeline and portal only changed their address and one header.
- Data in the private schema `lab` (not exposed by the Data API); roster in `lab.students` (Table Editor / CSV import).
- Photos and embeddings in Postgres (no Drive); emails via Brevo from `pg_net`, scheduled by `pg_cron`; the activity form is now a portal page.
- Secrets generated inside the database, stored hashed + in Vault; nobody had to paste them anywhere.
- GitHub keep-alive every 3 days so the free project never pauses.

## Issues fixed (audit IDs)
| Issue | Fix |
|---|---|
| S1 biometric data public | No commits/artifacts/caches of faces or embeddings; photos and embeddings only in the private schema, only via authenticated actions |
| K1 kiosk POST redirect | Custom redirect handler removed (and no redirect at all on Supabase) |
| A1 one secret for everything | Three role secrets with per-role action lists (`forbidden`) |
| A2 portal auth | Next.js server routes hold the admin secret and verify Firebase ID tokens with Google's public keys and domain/allow-list |
| M1 model mismatch | Kiosk uploads its own 160×160 crops; pipeline embeds the same crops; same model exported to Core ML (parity check in CI) |
| E1 no photo upload | `upload_faces` action |
| B1 non-members written to roster | Roster is never written by the kiosk; enrollments in `face_enrollments` |
| B2 sessions never closed | Nightly job marks "no exit scan" and still sends the activity email |
| C1 no consent | `enroll` requires `consent: true`; `consent_at` recorded |
| W1/W2 retrain workflow | Rewritten: sync → pipeline → publish; skips cleanly without secrets or photos |
| NEW slow backend | Supabase (above); portal 1 call + cached reloads; kiosk shows ✓ instantly |
| NEW manual deploys drifting | Backend is migrations + tests; nothing to copy by hand |
| NEW offline replay time | `scanned_at` honoured (≤ 24 h); durable queue on kiosk |
| NEW proxy check-ins | Manual scans noted (`manual entry/exit`) and badged in the portal |
| NEW duplicate sessions under concurrency | Per-student advisory lock inside each transaction |
| NEW formula injection | CSV export escapes `= + - @` |
| NEW coremltools + numpy 2.4 crash | Pinned in `requirements-export.txt` |
| NEW portal hydration mismatch | Portal renders after mount (all data is client-side) |

## Decisions taken on your behalf
- Supabase region Mumbai (closest to Parul University); free plan.
- Activity email only for sessions ≥ 15 minutes; one combined head-turn liveness check (not spoof-proof against video; acceptable for attendance).
- Match threshold 0.65 plus a 0.05 lead over the next person.
- Brevo for email (free, no card, no domain needed — a verified sender address is enough).

## Known limitations / open
- Free Supabase pauses after 7 idle days (mitigated by the kiosk and the keep-alive job; "Restore project" in the dashboard if it ever happens).
- Brevo free plan: 300 emails/day.
- `npm audit` flags Firestore's gRPC inside `firebase`; the portal only uses Auth.
- Still open: Brevo key + `lab.settings` (SETUP Part 3), Firebase + Vercel (Parts 4–5), GitHub secrets (Part 2), import the real roster, merge into `master`, first real-device test of the kiosk.

## What you need to provide — step by step in [SETUP.md](SETUP.md)
- GitHub secrets: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `PIPELINE_SECRET` (Vault → `aatce_pipeline_secret`).
- Brevo: API key → Vault `brevo_api_key`; `lab.settings` rows `sender_email`, `sender_name`, `portal_url`.
- Vercel env: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `ADMIN_SECRET` (Vault → `aatce_admin_secret`), `NEXT_PUBLIC_FIREBASE_*` (4), `NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN` and/or `ADMIN_EMAILS`.
- Kiosk Settings (⌘,): project URL, publishable key, Vault → `aatce_kiosk_secret`.

## Run locally
```
cd admin-portal && npm run dev      # portal on :3000 against the live Supabase (.env.local: ADMIN_SECRET from Vault)
```
