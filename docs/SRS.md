# Software Requirements Specification (SRS) — v3.0
## AATCE — Apple Lab Attendance System
**Swift Coding Club, Parul University** · **Repo:** https://github.com/manav-Mnv/aatce-apple-lab

*v3.0 (2026-10-10) supersedes v2.1: the backend moves from Google Apps Script + Sheets + Drive to
Supabase (Postgres) for speed (≈0.1–0.3 s per call instead of 1.5–3 s); requirements are otherwise
unchanged. Technical detail: [ARCHITECTURE.md](ARCHITECTURE.md).*

---

## 1. Introduction
### 1.1 Purpose
Production specification for a face-recognition attendance system for the Apple Lab.
### 1.2 Scope
Kiosk scan/enrollment, session logging, activity-form emails, batch attendance, admin portal, and a retrainable face dataset — entirely on free-tier infrastructure.
**Out of scope for v1:** multiple labs, iris/retina hardware, instant model retraining.
### 1.3 Key principle
**The enrollment number is the permanent key.** A face is never stored on its own.

## 2. Architecture
```
 Kiosk app (SwiftUI, lab iMac)
   Vision detection → FaceNet (Core ML) → on-device matching → liveness
   POST /rest/v1/rpc/api + kiosk secret
        │
        ▼
 Supabase Postgres — public.api(jsonb) ──► schema lab: students (roster), sessions,
   per-role secrets, transactions           face_enrollments, face_photos, workshop_attendees,
   pg_cron + pg_net → Brevo emails          embeddings, secrets, settings
        ▲
        │ pipeline secret — GitHub Actions weekly: photos → FaceNet embeddings → publish
        │
 Admin portal (Next.js on Vercel) — Firebase Google sign-in; server calls the API with the admin
 secret; public /activity/<session_id> page for the activity form
```

## 3. Tech stack
| Layer | Choice | Cost |
|---|---|---|
| Kiosk | Swift + SwiftUI (macOS 13+), AVFoundation, Vision, Core ML | Free |
| Backend + data | Supabase Postgres (free plan, Mumbai): PL/pgSQL API, pg_cron, pg_net, Vault | Free |
| Email | Brevo transactional API (300/day) | Free |
| Model | FaceNet InceptionResnetV1 (VGGFace2), PyTorch, exported to Core ML | Free |
| Pipeline | Python 3.11 on GitHub Actions (weekly) | Free |
| Portal | Next.js + Tailwind on Vercel; Firebase Authentication | Free |

Matching is on-device: comparing one embedding against a few hundred is trivial on the Mac, keeps
working during network drops, and keeps faces off the network except at enrollment.

## 4. Functional requirements
### 4.1 Enrollment (self-serve kiosk flow)
- **FR-1** Enter enrollment number.
- **FR-2** Look it up in the roster (`lab.students`); show the name and a masked email to confirm. Non-members enter name and email.
- **FR-3** Capture 5 face crops (3 frontal, 2 with the head turned — doubles as liveness).
- **FR-4** Upload the crops; store the averaged embedding locally so the student is recognised immediately.
- **FR-5** Re-enrollment adds photos, never overwrites.
- **FR-6** Fully self-serve.
- **FR-6a** Biometric consent is required and recorded (`face_enrollments.consent_at`). The roster is never written by the kiosk.

### 4.2 Routine scan
- **FR-7** Face → 3-frame probe → cosine match against cached templates (threshold 0.65, plus a 0.05 lead over the runner-up) → head-turn liveness → instant on-screen confirmation.
- **FR-8** No match → manual enrollment-number entry, marked `manual` for audit.
- **FR-9/10** No open session today → entry (UUID `session_id`); open session → exit with `duration_mins`.
- **FR-11** 2-minute cooldown between scans.
- **FR-12** Enrolled non-members → `workshop_attendees`, once per day.
- **FR-13** Every API call is a POST with a role secret in the JSON body; tables are never directly reachable.

### 4.3 Activity form and email
- **FR-14** On exit after ≥ 15 minutes, email the activity-form link (sent within 5 minutes). Sessions never exited are closed nightly and still emailed.
- **FR-15** The answer is written to the same session by `session_id`.

### 4.4 Batch tagging
- **FR-16** `batch_tags` on the roster (comma-separated).
- **FR-17** Batch attendance is computed from sessions × roster (portal), no separate table.

### 4.5 Admin portal
- **FR-18** Google sign-in via Firebase, restricted to the university domain and/or an allow list, verified server-side.
- **FR-19** Live occupancy, filterable session log, activity answers, roster with enrollment status, CSV export, analytics (peak hours, average session, per-batch attendance, daily trend).
- **FR-20** The portal reads only through the API's admin actions.

## 5. Non-functional requirements
| ID | Requirement |
|---|---|
| NFR-1 | On-device recognition well under 2 s; API calls ~0.1–0.3 s warm |
| NFR-2 | Scans made offline are queued durably on the kiosk with their real time and replayed in order |
| NFR-3 | Consent recorded; photos and embeddings stay in the private schema and move only through authenticated calls; nothing biometric in the repo, CI caches or artifacts |
| NFR-4 | Per-role secrets (kiosk / pipeline / admin) stored hashed, with per-role action lists; portal tokens verified server-side |
| NFR-5 | Matching lives on-device; the kiosk updates independently of backend changes |
| NFR-6 | Schema can take a future `lab_id` without rework |
| NFR-7 | Each API call is one transaction; per-student advisory locks prevent duplicate sessions |
| NFR-8 | Secrets only in Supabase Vault, GitHub secrets, Vercel env, macOS Keychain |
| NFR-9 | Kiosk and pipeline use the same model and the same 160×160 crop; the Core ML export is checked against PyTorch |
| NFR-10 | Free project kept awake (kiosk pings; GitHub keep-alive every 3 days) |

## 6. Data model
See [ARCHITECTURE.md §4](ARCHITECTURE.md). Tables in schema `lab`: `students`, `face_enrollments`,
`face_photos`, `sessions`, `workshop_attendees`, `embeddings`, `secrets`, `settings`.

## 7. Deployment and environments
- **Supabase:** project `aatce-apple-lab`; schema changes are migrations in `supabase/migrations/`; `supabase/tests/api_test.sql` runs safely against the live project (rolls back) and in CI.
- **Vercel:** preview per PR, production on merge.
- **Firebase:** one project, Google provider, authorized Vercel domain.
- **GitHub Actions:** CI on every push; weekly retrain; kiosk release (model export + app bundle); keep-alive.
- **Kiosk:** `AATCE Kiosk.app` from the CI artifact, ad-hoc signed ([MAC_SETUP.md](MAC_SETUP.md)).

## 8. Phased roadmap — status
1. **Core loop** — done (backend, kiosk, matching, liveness).
2. **Activity form + email** — done (needs a Brevo key).
3. **Admin portal** — done (needs Firebase + Vercel configuration).
4. **ML pipeline** — done (needs GitHub secrets).
5. **Hardening** — offline queue, batch analytics, CSV, secret rotation, speed work done; bulk-capture session for the ~150-student backlog and threshold tuning remain (need real use).

## 9. Open items
- Import the real SCC roster into `lab.students`.
- Bulk-capture logistics; threshold tuning with real data.
- Liveness is a head-turn check; a video replay could pass (no depth camera).
