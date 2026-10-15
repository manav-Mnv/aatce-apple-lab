# Backend — Supabase (Postgres)

The whole backend is SQL inside the Supabase project `aatce-apple-lab` (Mumbai, free plan):
tables in the private schema `lab`, and one public function `public.api(jsonb)` that every app
calls at `/rest/v1/rpc/api`. API reference: [API_CONTRACT.md](API_CONTRACT.md).

| Path | |
|---|---|
| `migrations/…_core.sql` | Tables, helpers, all actions (scan, enroll, embeddings, admin, activity form), `public.api` |
| `migrations/…_email_and_schedules.sql` | Brevo activity emails via `pg_net` + Vault, `pg_cron` jobs (emails every 5 min, stale sessions 01:00 IST) |
| `migrations/…_harden.sql` | Security-advisor fixes (pinned `search_path`, no `authenticated` access) |
| `tests/api_test.sql` | 70 assertions in one block that always rolls back — safe on the live project |
| `tests/ci_setup.sql` | Roles Supabase normally provides, for running the tests on plain Postgres in CI |

## Why this shape
- **Fast:** a call is ~0.1–0.3 s (Apps Script was 1.5–3 s); all logic runs next to the data.
- **Safe:** tables are not exposed by the Data API at all; each role secret unlocks only its actions; a call's changes are all-or-nothing; per-student advisory locks stop double sessions.
- **Same contract:** the iMac app, pipeline and portal send exactly the bodies they sent to Apps Script.

## Everyday tasks (Supabase dashboard)
| Task | Where |
|---|---|
| Add / edit students | **Table Editor** → schema `lab` → `students` (or **Insert → Import CSV**) |
| See sessions, enrollments | Table Editor → `lab.sessions`, `lab.face_enrollments` |
| Copy a role secret | **Integrations → Vault** → `aatce_kiosk_secret` / `aatce_pipeline_secret` / `aatce_admin_secret` |
| Rotate a secret | SQL editor: `select lab.set_secret('kiosk', '<new>');` then update Vault and the app using it |
| Run the tests | SQL editor: paste `tests/api_test.sql` → expect `TESTS PASSED: 70` |
| Scheduled jobs | **Integrations → Cron** |

Applying a new migration: paste it into the SQL editor (or `supabase db push` with the Supabase CLI).
