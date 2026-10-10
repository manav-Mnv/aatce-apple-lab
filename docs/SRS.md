# Software Requirements Specification (SRS) — v2.1
## AATCE — Apple Lab Attendance System
**Swift Coding Club, Parul University** · **Repo:** https://github.com/manav-Mnv/aatce-apple-lab

*v2.1 (2026-10-10) supersedes v2.0: adds per-role secrets, private biometric storage, a dedicated
enrollment/consent tab, the hardening requirements carried over from the PRD, and the
implementation decisions. Technical detail: [ARCHITECTURE.md](ARCHITECTURE.md).*

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
   POST + KIOSK_SECRET
        │
        ▼
 Google Apps Script web app ──► Google Sheets: Master_Students (read-only roster),
   per-role auth, script lock       Attendance_Log, Other_Workshop_Attendees,
   MailApp activity form            Face_Enrollments, Embeddings (metadata)
        ▲          ▲            ──► Google Drive (private): Face-Dataset/<enrollment_no>/, Embeddings/
        │          │
        │   GitHub Actions weekly: sync photos → FaceNet embeddings → publish (PIPELINE_SECRET)
        │
 Admin portal (Next.js on Vercel) — Firebase Google sign-in; server calls the backend with ADMIN_SECRET
```

## 3. Tech stack
| Layer | Choice | Cost |
|---|---|---|
| Kiosk | Swift + SwiftUI (macOS 13+), AVFoundation, Vision, Core ML | Free |
| Server | Google Apps Script web app | Free |
| Data | Google Sheets; files in Google Drive | Free |
| Email | MailApp + HtmlService form | Free |
| Model | FaceNet InceptionResnetV1 (VGGFace2), PyTorch, exported to Core ML | Free |
| Pipeline | Python 3.11 on GitHub Actions (weekly) | Free |
| Portal | Next.js + Tailwind on Vercel; Firebase Authentication | Free |

Matching is on-device: Apps Script cannot run Core ML, and comparing one embedding against a few hundred is trivial on the Mac and keeps working during network drops.

## 4. Functional requirements
### 4.1 Enrollment (self-serve kiosk flow)
- **FR-1** Enter enrollment number.
- **FR-2** Look it up in `Master_Students`; show the name and a masked email to confirm. Non-members enter name and email.
- **FR-3** Capture 5 face crops (3 frontal, 2 with the head turned — doubles as liveness).
- **FR-4** Upload the crops to `Face-Dataset/<enrollment_no>/`; store the averaged embedding locally so the student is recognised immediately.
- **FR-5** Re-enrollment adds photos, never overwrites.
- **FR-6** Fully self-serve.
- **FR-6a** Biometric consent is required and recorded (`Face_Enrollments.consent_at`). `Master_Students` is never written.

### 4.2 Routine scan
- **FR-7** Face → 3-frame probe → cosine match against cached templates (threshold 0.65, plus a 0.05 lead over the runner-up) → head-turn liveness.
- **FR-8** No match → manual enrollment-number entry, marked `manual` for audit.
- **FR-9/10** No open session today → entry (UUID `session_id`); open session → exit with `duration_mins`.
- **FR-11** 2-minute cooldown between scans.
- **FR-12** Enrolled non-members → `Other_Workshop_Attendees`, once per day.
- **FR-13** Every API call is a POST with a role secret in the JSON body; GET only serves the activity form.

### 4.3 Activity form and email
- **FR-14** On exit after ≥ 15 minutes, email the activity-form link. Sessions never exited are closed nightly and still emailed.
- **FR-15** The answer is written to the same `Attendance_Log` row by `session_id`.

### 4.4 Batch tagging
- **FR-16** `batch_tags` on `Master_Students` (comma-separated).
- **FR-17** Batch attendance is computed from `Attendance_Log` × `Master_Students` (portal), no separate roster.

### 4.5 Admin portal
- **FR-18** Google sign-in via Firebase, restricted to the university domain and/or an allow list, verified server-side.
- **FR-19** Live occupancy, filterable session log, activity answers, roster with enrollment status, CSV export, analytics (peak hours, average session, per-batch attendance, daily trend).
- **FR-20** The portal reads only through the backend's admin actions.

## 5. Non-functional requirements
| ID | Requirement |
|---|---|
| NFR-1 | On-device recognition well under 2 s; backend calls 1–3 s, off the matching path |
| NFR-2 | Scans made offline are queued durably on the kiosk with their real time and replayed in order |
| NFR-3 | Consent recorded; photos and embeddings stay in private Drive and move only through authenticated calls; nothing biometric in the repo, CI caches or artifacts |
| NFR-4 | Per-role secrets (kiosk / pipeline / admin) in Script Properties with per-role action lists; portal tokens verified server-side |
| NFR-5 | Matching lives on-device; the kiosk updates independently of backend deploys |
| NFR-6 | Schema can take a future `lab_id` without rework |
| NFR-7 | Sheets read in one batch per request; writes under `LockService` from read to write |
| NFR-8 | Secrets only in Script Properties, GitHub secrets, Vercel env, macOS Keychain |
| NFR-9 | Kiosk and pipeline use the same model and the same 160×160 crop; the Core ML export is checked against PyTorch |
| NFR-10 | User-typed text cannot become a spreadsheet formula |

## 6. Data model
**Master_Students** (existing SCC sheet, read-only): `enrollment_no, name, email, batch_tags` (+ any other columns, ignored).
**Attendance_Log**: `session_id, enrollment_no, entry_time, exit_time, duration_mins, activity_form_status, activity_description, email_sent, notes`.
**Other_Workshop_Attendees**: `id, name, enrollment_no, email, workshop_name, date`.
**Face_Enrollments**: `enrollment_no, name, email, is_member, consent_at, photo_count, enrolled_at, updated_at`.
**Embeddings**: `version, generated_at, model_version, drive_file_id, entry_count` (one row); the file `embeddings-v<N>.json` = `{version, generated_at, model_version, entries[{enrollment_no, embedding_vector[512]}]}` in private Drive.

## 7. Deployment and environments
- **Apps Script:** dev deployment on copies of the sheets, prod deployment on live data. Update with *Manage deployments → New version* to keep the URL. Step-by-step: [SETUP.md](SETUP.md).
- **Vercel:** preview per PR, production on merge.
- **Firebase:** one project, Google provider, authorized Vercel domain.
- **GitHub Actions:** CI on every push; weekly retrain; kiosk release (model export + app bundle).
- **Kiosk:** `AATCE Kiosk.app` from the CI artifact, ad-hoc signed ([MAC_SETUP.md](MAC_SETUP.md)).

## 8. Phased roadmap — status
1. **Core loop** — done (backend, kiosk, matching, liveness).
2. **Activity form + email** — done.
3. **Admin portal** — done (needs Firebase + Vercel configuration).
4. **ML pipeline** — done (needs GitHub secrets).
5. **Hardening** — offline queue, batch analytics, CSV, secret rotation runbook done; bulk-capture session for the ~150-student backlog and threshold tuning remain (need real use).

## 9. Open items
- Confirm the real `Master_Students` headers (map them in `MASTER_COLUMNS`).
- Bulk-capture logistics; threshold tuning with real data.
- Mail quota: 100/day on a personal Gmail; use a Workspace account if the lab exceeds it.
- Liveness is a head-turn check; a video replay could pass (no depth camera).
