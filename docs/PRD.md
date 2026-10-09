# Product Requirements Document (PRD)
## AATCE — Apple Lab Attendance System
**Swift Coding Club, Parul University**

---

## 1. Problem
Lab attendance in the Apple Lab is currently tracked manually (hand-ticked grids in a shared Google Sheet). This is error-prone, gives no record of what students actually did during a session, and doesn't scale as the club grows or runs additional workshops.

## 2. Goal
Replace manual tracking with an automated, face-recognition-based check-in/check-out system that also captures what each student worked on — at zero hosting cost, buildable and maintainable by a small student team.

## 3. Non-Goals (v1)
- Multiple labs (only Apple Lab exists right now)
- True biometric iris/retina verification
- Real-time/instant model retraining
- Payment, scheduling, or room-booking features

## 4. Users
- **Students (SCC members & workshop attendees)** — scan in/out, occasionally fill a quick activity form.
- **Lab admins / faculty (e.g. Prof. Umang Panchal)** — view who's in the lab, review logs and activity forms, export data.
- **Maintainers (Mnv + SCC dev team)** — build, deploy, and operate the system; own the face dataset and retraining pipeline.

## 5. User Stories
- As a student, I want to check in by just looking at the camera, so I don't need a card or app.
- As a student enrolling for the first time, I want my name/email auto-filled from my existing registration, so I don't re-type anything.
- As a student, I want a quick way to log what I worked on, so my lab time is documented without extra effort.
- As an admin, I want to see who's currently in the lab and pull historical logs, so I can report on usage and attendance.
- As an admin, I want batch-specific attendance (e.g. "SCC/5-7"), so I can track a specific cohort without a separate manual sheet.
- As a maintainer, I want the face-matching model to improve over time from corrections, so accuracy doesn't degrade as the student body grows.

## 6. Success Criteria
- A student can complete first-time enrollment in under 30 seconds.
- A routine scan resolves to a result (recognized / not recognized) in under 2 seconds.
- Zero manual attendance entry required once the backlog is cleared.
- Admin can answer "who was in the lab on date X" and "what did they work on" without opening a hand-kept sheet.
- $0 recurring hosting cost at current scale.

## 7. Constraints
- Must run on existing hardware: one iMac with a standard webcam (no infrared/depth camera).
- Must work within Google Sheets/Apps Script and GitHub Actions free-tier quotas.
- Biometric data (faces) requires explicit student consent before capture.

## 8. Out-of-the-Box Risks (carried into SRS v2.1 as hardening requirements)
- Concurrent writes to the same Sheet from multiple sources — mitigated via Apps Script `LockService`.
- Apps Script cold-start latency — mitigated by keeping matching on-device and Apps Script off the critical path.
- Shared-secret leakage — mitigated via Keychain storage + a rotation runbook.
- Embedding dataset growing large over time — mitigated via a versioned `embeddings.json` the kiosk only re-downloads on change.

## 9. Milestones
Maps directly to SRS v2.1 section 8's five phases: Core loop → Activity form/email → Admin portal → ML pipeline → Hardening. See the SRS for technical detail on each.

## 10. Open Questions
- Exact `Master_Students` column layout for the lookup formula.
- Logistics for the one-time bulk face-capture session for the ~150-student backlog.
- Confidence threshold — needs tuning once real match data exists.
