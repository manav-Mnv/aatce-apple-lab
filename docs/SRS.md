# Software Requirements Specification (SRS) — v2.0 (Production)
## AATCE — Apple Lab Attendance System
**Swift Coding Club, Parul University**
**Repo:** https://github.com/manav-Mnv/aatce-apple-lab

*Supersedes v1.0 — reflects the final $0-hosting-cost architecture.*

---

## 1. Introduction

### 1.1 Purpose
Full production specification for a face-recognition attendance system for the Apple Lab: architecture, requirements, data schema, security, deployment, and a phased build roadmap.

### 1.2 Scope
Covers: kiosk-based scan/enrollment, session logging, activity-form emails, batch attendance, an admin portal, and a retrainable face dataset — running entirely on free-tier infrastructure.

**Out of scope for v1:** multi-lab support, true iris/retina hardware scanning, live/instant model retraining.

### 1.3 Key Principle
**Enrollment number is the permanent key for everything.** A face is never stored as new data on its own — always linked to an enrollment number, existing (SCC roster) or newly created (non-SCC workshop attendee).

---

## 2. Final Architecture

```
 Swift Kiosk App (Apple Lab iMac)
   - matches faces locally/on-device against a cached embedding set
   - calls Apps Script over HTTPS (POST) with a shared secret in the JSON body
        |
        v
 Google Apps Script Web App (doGet / doPost)
   - sends activity-form emails via MailApp
   - reads/writes directly to Google Sheets
        |
        v
 Google Sheets (single source of truth)
   - Master_Students (existing SCC registration sheet)
   - Attendance_Log / Other_Workshop_Attendees (AATCE Apple Lab sheet)
        ^
        |
 Google Drive: Face-Dataset (per-enrollment subfolders, raw images)
        |
        v
 Python retraining pipeline (scheduled via GitHub Actions)
   - generates new embeddings, pushes them back for kiosk apps to re-sync

 Admin Portal (Next.js, hosted on Vercel)
   - Google sign-in via Firebase Authentication
   - reads/writes by calling the same Apps Script Web App
```

---

## 3. Final Tech Stack

| Layer | Choice | Cost |
|---|---|---|
| Kiosk app | Swift + SwiftUI, Vision (detection + liveness), CoreML (embeddings + on-device matching) | Free (Xcode) |
| Server-side glue | Google Apps Script Web App | Free |
| Data store | Google Sheets (no separate DB) | Free |
| Raw face images | Google Drive folder | Free (within quota) |
| Email | Apps Script `MailApp` | Free |
| Model training | Python, scheduled via GitHub Actions | Free (2,000 min/month) |
| Admin portal | Next.js + Tailwind | Free |
| Admin portal hosting | Vercel | Free |
| Admin portal auth | Firebase Authentication (Google sign-in) | Free |
| Version control / CI | GitHub | Free |

**Why matching moved on-device:** Apps Script can't run CoreML inference. At this scale (a few hundred students), comparing one embedding against all cached embeddings is trivial math — the kiosk app does it locally after pulling the current embedding set from Apps Script periodically. This also means matching still works through brief network drops.

---

## 4. Functional Requirements

### 4.1 Enrollment (self-serve, one combined kiosk flow)
- FR-1 Enter enrollment number → FR-2 lookup in `Master_Students`, confirm or manually enter Name/Email → FR-3 capture 3–5 face frames immediately, gated by liveness check → FR-4 frames sync to `/Face-Dataset/<enrollment_no>/`, embedding cached locally and pushed to the Sheet's embedding store → FR-5 re-enrollment appends, never overwrites → FR-6 fully self-serve, no staff gate.

### 4.2 Routine scan (entry/exit)
- FR-7 Face detected → liveness check → matched locally against the cached embedding set (cosine similarity, threshold 0.65 default).
- FR-8 Below threshold → manual enrollment-number fallback.
- FR-9/10 No open session today → entry (new `session_id` UUID, `entry_time`); open session exists → exit (`exit_time`, `duration`).
- FR-11 2–3 minute cooldown after any scan.
- FR-12 Enrollment number not in `Master_Students` → logged to `Other_Workshop_Attendees`, not `Attendance_Log`.
- FR-13 Every call to Apps Script is a POST request containing a shared secret in the JSON body; requests without it or via GET are rejected.

### 4.3 Activity form & email
- FR-14 On exit / 1-hour threshold, Apps Script sends the activity-form email via `MailApp`.
- FR-15 Form response written back to the matching row in `Attendance_Log` by `session_id`.

### 4.4 Batch tagging
- FR-16 `Batch` column on `Master_Students` (comma-separated for multi-batch students).
- FR-17 Batch attendance = filtered `QUERY` on `Attendance_Log` x `Master_Students`, no separate roster table.

### 4.5 Admin portal
- FR-18 Google sign-in via Firebase Auth (staff only — restrict by university email domain if possible).
- FR-19 Live occupancy, full session log (filterable), activity form responses, CSV export, basic analytics (peak hours, avg. session length, per-batch attendance).
- FR-20 Portal reads data by calling the same Apps Script Web App as a read-only API, not by touching Sheets directly.

---

## 5. Non-Functional / Production Requirements

| ID | Requirement |
|---|---|
| NFR-1 | Scan-to-result under 2s for on-device matching; Apps Script sync calls may take 1-3s (cold start) — acceptable since they're outside the critical scan path |
| NFR-2 | Kiosk queues scans locally if Apps Script is unreachable, syncs on reconnect — no data loss |
| NFR-3 | Biometric consent recorded at enrollment; `/Face-Dataset/` access restricted to maintainers |
| NFR-4 | Every Apps Script endpoint checks a shared secret sent in the JSON body (stored in Apps Script "Script Properties," never hardcoded); admin portal auth via Firebase, restricted to university domain |
| NFR-5 | Matching lives on-device — kiosk app updates independently of any backend deploy |
| NFR-6 | Architecture supports a future `lab_id` field for multi-lab, without schema rework |
| NFR-7 | Apps Script and Google API quotas are generous for one lab's volume, but code should batch Sheet reads/writes (not per-row) to stay well under limits |
| NFR-8 | All secrets (shared secret, Firebase config) live in environment variables / Script Properties — never committed to the repo |

---

## 6. Data Model (Sheet Schema)

**Master_Students** (existing sheet, new tab)
`enrollment_no, name, email, batch_tags, face_dataset_path, registered_at`

**Attendance_Log** (AATCE Apple Lab sheet)
`session_id, enrollment_no, entry_time, exit_time, duration_mins, activity_form_status, activity_description, email_sent, notes`

**Other_Workshop_Attendees**
`id, name, enrollment_no, email, workshop_name, date`

**Embeddings store** (new tab or a lightweight JSON file in Drive, synced to kiosk apps)
`enrollment_no, embedding_vector, model_version, generated_at`

---

## 7. Deployment & Environments

- **Apps Script:** maintain two deployments — a "dev" deployment (testing, points at a copy of the Sheets) and a "prod" deployment (live data). Never test against the real `Attendance_Log`.
- **Vercel:** GitHub integration gives automatic preview deployments per PR, and a production deployment on merge to `main` — use this as a review step before anything goes live.
- **Firebase:** one project, Authentication enabled with Google provider, domain-restricted if possible.
- **GitHub Actions:** scheduled workflow (e.g. weekly) runs the Python retraining pipeline; secrets (Drive/Sheets service account credentials) stored as GitHub encrypted secrets, never in the repo.
- **Kiosk app distribution:** Xcode build to .dmg via `create-dmg` — ideally notarized with an Apple Developer account for a smooth install on the lab iMac.

---

## 8. Phased Build Roadmap

1. **Phase 1 - Core loop:** Apps Script `doPost`/`doGet` (enroll + scan endpoints) reading/writing `Attendance_Log` and `Master_Students`, shared-secret auth. Kiosk app: camera, Vision detection, liveness check, local embedding matching, calls to Apps Script. Get one full entry-to-exit cycle working end to end.
2. **Phase 2 - Activity form + email:** Apps Script `MailApp` trigger on exit/1-hour mark, response write-back.
3. **Phase 3 - Admin portal:** Next.js app, Firebase Auth login, calls Apps Script as a read API, deployed on Vercel.
4. **Phase 4 - ML pipeline:** Python embedding generation + retraining script, GitHub Actions schedule, model version sync back to kiosk apps.
5. **Phase 5 - Hardening:** batch tagging/filtering, CSV export, analytics, offline queueing on the kiosk, bulk-capture session for the ~150-student backlog.

---

## 9. Open Items
- Exact `Master_Students` formula/columns against the real sheet layout.
- Bulk-capture session logistics for the existing backlog.
- Confidence-threshold tuning once real match data exists.
- Firebase domain-restriction setup (confirm university email enforcement is configured).
