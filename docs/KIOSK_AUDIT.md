# Kiosk audit — 17 Oct 2026

Two complaints from the lab:

1. The admin portal doesn't show what is happening on the iMac kiosk.
2. The kiosk is laggy and doesn't recognise people well.

The evidence below comes from the live Supabase project (the tables and the request logs) and from reading the kiosk code.

## What the live data shows

| Check | Result |
|---|---|
| Kiosk reaching Supabase | Yes. About 1 request a minute since 10:15 UTC (user agent `AATCE Kiosk/1`, macOS 27), all HTTP 200. |
| Face enrolments | 6 people, 5 photos each, on 16–17 Oct. All 6 are **non-members**. |
| Member roster (`lab.students`) | 3 rows, all sample data (`22030510501xx`). None of them has enrolled a face. |
| Sessions (check-in/out) | **0** |
| Workshop attendees | **6**. One per person per day, which matches the 6 enrolments. |
| Published embeddings | 0. The kiosk matches with its own local templates (expected until the retrain job runs). |

**Recognition is working.** Every enrolled person was recognised and logged. Nobody shows up as checked in because none of them is on the member roster.

## Findings

| # | Severity | Finding | Evidence | Fix |
|---|---|---|---|---|
| 1 | **High** | The real students aren't on the roster, so their scans go to "Workshop attendees" (once a day, with no check-in or check-out). The Overview page never counts them. | `lab.students` holds only 3 sample rows; all 6 enrolments are `is_member = false` | **You:** import the real roster (Supabase → Table Editor → `lab.students`, or a CSV import), then delete the 3 sample rows. People who are already enrolled keep their faces: the enrolment number links them. |
| 2 | **High** | The portal had no view of the kiosk at all: no way to tell whether it is online, and no record of failed scans. | The kiosk only called `status`, which stores nothing | **Fixed:** new `heartbeat` action every 30 s. It records health and every scan attempt (recognised / not recognised with the closest match and score / no head turn / saved offline / error). New **Kiosk** page and an Overview strip. |
| 3 | **High** | **Lag.** FaceNet (InceptionResnetV1, about 27 M parameters) ran on the main thread, 3 times per scan and 5 times per enrolment. Camera frames queued up behind it while the screen froze. | `KioskModel.addProbe` and `EnrollmentModel.save` called `embedder.embedding` on `@MainActor` | **Fixed:** the model runs on its own background queue, and frames that arrive while it's busy are skipped. |
| 4 | Medium | **Lag.** The scan screen redrew 10 times a second while idle, because the same phase was re-published on every camera frame. | `phase = .idle(hint(...))` on every reading | **Fixed:** the screen only redraws when something changes, and the liveness ring moves in 5 % steps. |
| 5 | Medium | **Speed.** Core ML was limited to CPU and GPU. On Apple Silicon the Neural Engine is several times faster. | `computeUnits = .cpuAndGPU` | **Fixed:** `.all`. Running in float16 changes the match score by about 0.001, which is negligible next to the 0.65 threshold. |
| 6 | Medium | **Accuracy.** The kiosk made its decision after exactly 3 frames, including blurred or turned frames, then locked the screen for 8 s on any miss. | `probeCount = 3`, no pose check, `scheduleReset(after: 8)` | **Fixed:** only frontal frames (≤ 20° yaw) are used. The kiosk keeps trying with the newest 3 frames, up to 8, and gives up quietly after 4 s if it never gets a clear view. A miss now pauses for 5 s. |
| 7 | Medium | **Tuning was blind.** A failed match left no trace, so the 0.65 threshold couldn't be tuned. | — | **Fixed:** each "not recognised" event stores the closest person and their score, and the Kiosk page shows them. If real students regularly miss at 0.55–0.64, lower the threshold in the kiosk's Settings to about 0.60. |
| 8 | Low | The kiosk's **workshop name** is set to `smtyhs mth` (17 Oct), so non-member scans are filed under that name. | `lab.workshop_attendees.workshop_name` | **You:** clear the Workshop field in the kiosk's Settings (⌘,), or set it to a real workshop name. The Kiosk page now warns while workshop mode is on. |
| 9 | Low | The retrain job has never published embeddings, so each face lives only on this iMac (in `local-enrollments.json`). Reinstalling the app or switching Macs would lose them. | `lab.embeddings` is empty | **You:** run **Actions → Retrain embeddings → Run workflow** once. The kiosk downloads the result within 10 minutes. |

## What changed

- **Supabase** (`supabase/migrations/20261017120000_kiosk_telemetry.sql`, API 3.1.0, already applied live):
  - Adds the `lab.kiosk_status` and `lab.kiosk_events` tables. Events are kept for 30 days.
  - Adds the kiosk-only `heartbeat` action.
  - `dashboard` now also returns `kiosk`.
  - Older kiosks keep working, because `status` is unchanged.
- **Kiosk 2.1.0:**
  - The model runs off the main thread and uses the Neural Engine.
  - The screen redraws only when something changes.
  - Scanning uses frontal frames only, with retries.
  - Sends a heartbeat with buffered events, which survive being offline; up to 500 are kept.
- **Portal:**
  - New **Kiosk** page: status, today's recognised / not-recognised counts, faces loaded, queue, any problem, a workshop-mode warning, and the latest 50 attempts with scores.
  - An Overview strip shows the kiosk's status and today's workshop visitors.
- **Tests:**
  - 6 new SQL assertions for the heartbeat (role check, event filtering, the dashboard summary, bad input).
  - Swift tests for `heartbeat` and `FaceMatcher.evaluate`.

## To do on the lab side

1. **Install kiosk 2.1.0:** GitHub → Actions → **Kiosk release** → Run workflow, then download `AATCE-Kiosk` and replace the app on the iMac. Settings and faces are kept, because they live in Application Support and the Keychain.
2. **Import the real student roster** into `lab.students` (finding 1).
3. **Clear or correct the workshop name** in the kiosk's Settings (finding 8).
4. **Run the Retrain embeddings workflow once** (finding 9).
5. **After a day of use**, open Portal → **Kiosk**. If many "Not recognised" rows show the right person with a score between 0.55 and 0.64, lower the threshold to 0.60.
