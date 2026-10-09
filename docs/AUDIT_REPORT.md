# AATCE Apple Lab — Project Audit Report

**Date:** 2026-10-10 · **Branch:** `master` (in sync with `origin/master`, last push 2026-10-02) · **Repo visibility:** PUBLIC

---

## 1. What we are building

A **face-recognition check-in/check-out system** for the Swift Coding Club's Apple Lab at Parul University. It replaces the hand-ticked Google Sheet with:

| Piece | Tech | Job |
|---|---|---|
| **Kiosk app** (`macos-app/`) | Swift / SwiftUI, Vision, CoreML | Runs on the lab iMac. Detects a face, checks liveness, matches it **on-device** against a cached embeddings file, then tells the backend "entry" or "exit". Also does self-serve enrollment. |
| **Backend** (`backend/`) | Google Apps Script web app | The only server. POST-only JSON API with a shared secret. Reads/writes Google Sheets. Will send activity-form emails. |
| **Data store** | Google Sheets + Google Drive | Sheets = `Master_Students`, `Attendance_Log`, `Other_Workshop_Attendees`, `Embeddings` (metadata). Drive = raw face photos + `embeddings.json`. |
| **ML pipeline** (`ml-training/`) | Python, FaceNet (facenet-pytorch), GitHub Actions | Weekly: turns face photos into 512-d embeddings → `embeddings.json`. |
| **Admin portal** (`admin-portal/`) | Next.js + Tailwind on Vercel, Firebase Auth | Faculty view: live occupancy, logs, activity forms, CSV export, analytics. |
| **Orchestration** (`orchestration/`) | LangGraph skeleton | Optional tooling idea for running multiple AI coding agents. Not part of the product. |

Ground rules from the PRD/SRS: **enrollment number is the key for everything**, **$0 hosting**, one iMac with a normal webcam, explicit biometric consent.

---

## 2. What has happened so far (timeline)

| When | Commit / event | What |
|---|---|---|
| — | `3e46b1d` | Monorepo scaffold. Original plan was a **Go** backend + React portal. |
| 2026-10-02 02:47 | `9e04fff` | Antigravity agent builds the **Apps Script backend** (Phase 1): enroll, scan, embeddings, read endpoints, LockService writes. |
| 2026-10-02 02:52 | `544a5d4` | Antigravity agent builds the **ML embedding pipeline** (Phase 4) + weekly `retrain.yml`. |
| 2026-10-02 03:10 | `4ca46a8`, `4ebdfea` | Backend switched to header auth, Drive-hosted embeddings, `error_code` on errors. |
| 2026-10-02 11:32 | `f500016`, `f59159d` | Discovered Apps Script can't read custom headers → **everything moved to POST with `secret` in the JSON body**. SRS updated. API contract now **v1.2.0**. |
| After that (uncommitted) | working tree | A second agent (opencode session — its build log `docs/BUILD_LOG_OPENCODE.md` is empty) wrote the **Swift `KioskNetworking` package** + tests, switched CI to `swift test`, and added `docs/PRD.md`, `docs/multi-agent-orchestration.md`, `orchestration/orchestrator.py`. |

> **Uncommitted work at risk:** `macos-app/Package.swift`, `macos-app/Sources/`, `macos-app/Tests/`, `docs/PRD.md`, `docs/multi-agent-orchestration.md`, `orchestration/`, plus edits to `ci.yml`, `.gitignore`, `macos-app/README.md`. None of this is on GitHub yet.

---

## 3. Current state by component

### Verified test results (run during this audit)

| Suite | Result |
|---|---|
| Backend (`node backend/tests/test_backend.js`) | ✅ **28 / 28 pass** |
| ML (`ml-training/.venv` → `pytest`) | ✅ **48 / 48 pass** (synthetic data only, no real model run) |
| Swift (`swift test`) | ⚪ Not runnable on this Windows machine; the macOS CI job runs it once pushed |

### Completion by SRS phase

| Phase | Scope | Status |
|---|---|---|
| **1 – Core loop** | Backend enroll/scan/auth | ✅ Code done, ❌ not deployed |
| | Kiosk app | 🟡 **Networking layer only** (uncommitted). No Xcode app, UI, camera, Vision detection, liveness, CoreML model, matching, Keychain, offline queue |
| **2 – Activity form + email** | MailApp, form, write-back | ❌ Not started (`script.send_mail` scope is the only trace) |
| **3 – Admin portal** | Next.js, Firebase, Vercel | ❌ Not started (README only; CI step is `echo`) |
| **4 – ML pipeline** | Embedding generation | ✅ Done & tested |
| | Drive download of photos, Drive upload of `embeddings.json`, `update_embeddings_meta` call, CoreML export | ❌ Not done (workflow steps are placeholders) |
| **5 – Hardening** | Offline queue, batch analytics, CSV, bulk-capture of ~150 students | ❌ Not started (only `students?batch=` filter exists) |

**Rough overall: ~25–30 % of v1.** The backend contract is the solid foundation; the kiosk (the hardest part) is mostly ahead of us.

---

## 4. Every scenario, end to end — what happens today vs. what's missing

| # | Scenario | Designed behaviour | Today |
|---|---|---|---|
| 1 | **First-time enrollment (SCC member)** | Type enrollment no → name/email auto-filled → capture 3–5 frames with liveness → frames go to `Face-Dataset/<no>/` → recognised immediately | Backend fills `face_dataset_path`, returns name/email ✅. **No way to upload photos anywhere** (no endpoint, kiosk has no Drive creds). **New student isn't recognisable until the next weekly retrain** — SRS FR-4 says the kiosk should cache its own embedding; not built. No consent recorded (NFR-3). |
| 2 | **First-time enrollment (non-SCC workshop attendee)** | Should land in `Other_Workshop_Attendees` | ⚠️ `handleEnroll` **appends them to `Master_Students`**, so they become "members" and FR-12 routing never fires for them. |
| 3 | **Routine scan – entry** | Match locally → POST `scan` → new session row | Backend ✅. Kiosk matching ❌. |
| 4 | **Routine scan – exit** | Open session today → set exit time & duration | Backend ✅. |
| 5 | **Double scan within 2 min** | Rejected with `cooldown` + seconds left | ✅ backend + Swift decodes it. |
| 6 | **Scan 3 min after entering (accidental)** | — | Closes the session with a 3-minute duration. No minimum session length; decide if that's acceptable. |
| 7 | **Student forgets to scan out / session crosses midnight** | 1-hour auto-exit / form trigger (FR-14) | ⚠️ `SESSION_TIMEOUT_MS` is defined but **never used**. Yesterday's session stays open forever; next day starts a new one. No time-based trigger exists. |
| 8 | **Face not recognised (below 0.65)** | Fallback to typing enrollment no | Kiosk UI ❌. |
| 9 | **Unknown enrollment no scanned** | Logged to `Other_Workshop_Attendees` | ✅, but every scan appends a new row (no cooldown/entry-exit pairing for these people). |
| 10 | **Network down at the kiosk** | Queue scans locally, replay later (NFR-2) | ❌ Not built. |
| 11 | **Weekly retrain** | Pull photos from Drive → embeddings → upload to Drive → call `update_embeddings_meta` | ❌ Download/upload steps are `echo` placeholders. **The workflow will fail every Sunday** (no `Face-Dataset/`, pipeline exits 1). Also it commits `embeddings.json` into this **public** repo. |
| 12 | **Kiosk embeddings sync** | POST `embeddings_version` → download from Drive if newer | Swift side ✅ (tested with stubs). Needs a public Drive link — see security finding S1. |
| 13 | **Activity-form email on exit** | MailApp email + response write-back by `session_id` | ❌ |
| 14 | **Admin views live occupancy / exports CSV** | Portal → Apps Script read API | Backend has `attendance_log` + `students` ✅. Portal ❌. No "currently in lab" endpoint (derivable from open sessions). |
| 15 | **Concurrent writes** | LockService | ✅ around writes; the read→decide→write in `scan` isn't inside the lock (low risk with one kiosk). |
| 16 | **Secret leaked / rotated** | Rotation runbook (PRD §8) | ❌ No runbook; one secret is shared by every client. |

---

## 5. Findings — bugs, risks, and gaps (most severe first)

### 🔴 Critical / high

**S1 — Biometric data would be published.** The repo is **public**. `retrain.yml` commits `ml-training/output/embeddings.json` to it, and the kiosk download design (`drive.google.com/uc?export=download&id=…`) only works if the Drive file is shared "anyone with the link". Face embeddings are biometric personal data (consent + India's DPDP Act 2023 apply). **Fix:** never commit embeddings (drop the commit step, add to `.gitignore`); encrypt `embeddings.json` (e.g. AES-GCM, key in the kiosk Keychain + a GitHub secret) before upload, or make the repo private.

**K1 — Kiosk POST redirect handling is very likely wrong for real Apps Script.** A `POST` to `/exec` returns a `302` to `script.googleusercontent.com/macros/echo?...`, which must be fetched with **GET**. `PostRedirectHandler.swift` re-sends it as POST with the original body (including the secret). The unit tests use stubs, so they can't catch this. Verify against a real deployment, e.g. compare `curl -L -d '{"secret":"…","action":"status"}' <URL>` (works: curl switches to GET) with the same plus `-X POST` (forces POST on the redirect). If confirmed, let the redirect follow as GET without the body.

**A1 — One shared secret unlocks everything.** The same `SHARED_SECRET` lets any holder read every student's name and email (`students`), and call `update_embeddings_meta` to point all kiosks at a different embeddings file. The secret will live on a shared lab iMac. **Fix:** separate secrets per role (`KIOSK_SECRET`, `PIPELINE_SECRET`, `PORTAL_SECRET`) and restrict actions per role.

**A2 — Admin portal auth has no backend enforcement yet.** Firebase sign-in happens in the browser, but Apps Script never verifies who's calling. If the portal calls Apps Script from the browser, the secret is exposed to every visitor. **Fix:** the portal must call Apps Script only from Next.js server routes that verify the Firebase ID token (firebase-admin) and the email domain, holding the portal secret server-side.

**M1 — Model mismatch between pipeline and kiosk.** Embeddings are made with FaceNet InceptionResnetV1 (VGGFace2) + MTCNN alignment at 160×160. The kiosk must compute live embeddings with **the same model and the same preprocessing**, otherwise cosine similarity is meaningless. No CoreML conversion of this model exists yet.

**E1 — No photo upload path.** Nothing moves enrollment frames from the kiosk into `Face-Dataset/` on Drive. Likely fix: an Apps Script `upload_faces` action (base64 images → `DriveApp`), which is also what the currently unused `drive` OAuth scope would be for.

### 🟠 Medium

- **B1** Non-SCC enrollees are written into `Master_Students` (scenario 2) — breaks FR-12.
- **B2** No auto-close for open sessions / midnight rollover; `SESSION_TIMEOUT_MS` unused (scenario 7).
- **W1** `retrain.yml`: fails weekly as is; the service-account step's `if: env.GOOGLE_SERVICE_ACCOUNT_KEY != ''` reads a step-level `env`, which isn't visible to that step's own `if`, so the step never runs; `git push` needs `permissions: contents: write`.
- **W2** Pipeline never uploads to Drive or calls `update_embeddings_meta`, so the kiosk can never see a new version.
- **C1** Consent is not captured anywhere (NFR-3): no column, no field in `enroll`.

### 🟡 Low

- `appsscript.json` requests full `drive` scope that no code uses yet.
- Secret comparison isn't constant-time (minor for this threat model).
- `update_embeddings_meta` clears/rewrites the tab without `LockService`.
- `ml-training/pyproject.toml` has an invalid `build-backend` (`setuptools.backends._legacy:_Backend`); `pip install .` would fail. `requirements.txt` still works. Should be `setuptools.build_meta`.
- `MATCH_THRESHOLD` in backend `Config.gs` is unused (matching is on-device). Harmless, but it belongs in the kiosk config.
- `orchestration/orchestrator.py` is a non-runnable skeleton (`NotImplementedError`) with an old model id.

### 📄 Documentation drift

- Root `README.md` still says the backend is **Go** and the portal is **React**. Actually Apps Script / Next.js.
- `docs/README.md` says "schemas to be defined". They're defined in SRS §6.
- PRD and orchestration doc cite **SRS v2.1**, plus FR-21/22, NFR-9 and §4.6. The SRS is **v2.0** and none of those IDs exist.
- `backend/README.md` still says "shared-secret **header**" and describes Embeddings.gs as "read/write embedding store". Both are stale.
- `ml-training/README.md` claims `output/` is gitignored except `embeddings.json`. There's no such rule.
- `.gitignore` still has a Go section.
- `docs/BUILD_LOG_OPENCODE.md` is empty even though that session produced the Swift package.

---

## 6. What's left to build (ordered)

1. **Commit & push** the Swift package + docs (CI will then run `swift test` on macOS).
2. **Fix S1, K1, A1** before any real data exists.
3. **Deploy backend (dev)**: create the Sheets, set Script Properties, `clasp push`, smoke-test every action with curl.
4. **Kiosk app**: Xcode project, camera + Vision face detection, liveness (blink/head-turn, since there's no depth camera), CoreML FaceNet model, cosine matching, enrollment flow with consent + photo upload, manual fallback, Keychain secret, durable offline queue, embeddings cache.
5. **Backend additions**: `upload_faces`, consent field, workshop-attendee enroll path, time-driven trigger to auto-close sessions, `occupancy` endpoint, per-role secrets.
6. **Pipeline completion**: Drive download/upload via service account, encrypted output, `update_embeddings_meta` call, CoreML export of the same model, fix workflow.
7. **Phase 2**: Google Form (or a form page) + MailApp email on exit + `onFormSubmit` write-back by `session_id`.
8. **Phase 3**: Next.js portal with server-side token verification, occupancy, logs, CSV, analytics.
9. **Phase 5**: batch analytics, bulk-capture day for the ~150-student backlog, threshold tuning, `.dmg` packaging.

---

## 7. Accounts, IDs, secrets and tokens you need to provide or create

> Never paste real values into the repo, chat, or commit messages. They go into Script Properties, GitHub encrypted secrets, Vercel env vars, or the macOS Keychain.

### Google (backend + data) — required now
| Item | Where it's used | How to get it |
|---|---|---|
| A **Google account to own everything** (ideally a club account, not personal) | Apps Script, Sheets, Drive | — |
| **Master Sheet ID** (the existing SCC registration sheet, tab `Master_Students`) | Script Property `MASTER_SHEET_ID` | From the sheet URL `/d/<ID>/edit` |
| **AATCE Sheet ID** (tabs `Attendance_Log`, `Other_Workshop_Attendees`, `Embeddings`) | Script Property `ATTENDANCE_SHEET_ID` | Create sheet, copy ID. Also make a **dev copy** of both sheets. |
| **The real `Master_Students` column layout** | `Config.gs` column indexes | Open question in PRD/SRS. Confirm it matches `enrollment_no, name, email, batch_tags, face_dataset_path, registered_at`. |
| **Shared secret(s)** | Script Property `SHARED_SECRET` (later per-role) + kiosk Keychain + GitHub secret | Generate yourself: `openssl rand -hex 32` |
| **Apps Script Script ID** + `clasp login` | Pushing code | Enable the Apps Script API at script.google.com/home/usersettings |
| **Web App URL / Deployment ID** (dev + prod) | Kiosk `baseURL`, portal, pipeline | Deploy → Web app, Execute as *Me*, Access *Anyone* |

### Google Cloud / Drive (ML pipeline) — required for Phase 4
| Item | Where | How |
|---|---|---|
| **Google Cloud project** + **Drive API** enabled | Pipeline | console.cloud.google.com |
| **Service account JSON key** | GitHub secret `GOOGLE_SERVICE_ACCOUNT_KEY` | IAM → Service accounts → Keys. Share the Drive folders with the SA's email. |
| **`Face-Dataset` Drive folder ID** | Pipeline download / backend upload | From folder URL |
| **Embeddings output folder/file ID** | Pipeline upload | From folder URL |
| **Apps Script URL + pipeline secret** | GitHub secrets (e.g. `APPS_SCRIPT_URL`, `PIPELINE_SECRET`) | From above |
| **Embeddings encryption key** (if you take the S1 fix) | GitHub secret + kiosk Keychain | `openssl rand -base64 32` |

### Admin portal — Phase 3
| Item | Where | How |
|---|---|---|
| **Firebase project** with Google sign-in enabled | Portal | console.firebase.google.com |
| Firebase web config: `apiKey`, `authDomain`, `projectId`, `appId` | Vercel env `NEXT_PUBLIC_FIREBASE_*` | Project settings → Your apps (these are public identifiers) |
| **Firebase Admin service account** (`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`) | Vercel server env only | Project settings → Service accounts |
| **Allowed email domain** (e.g. `paruluniversity.ac.in`?) and/or admin email allowlist | Portal server check | Your decision |
| **Vercel account** linked to the GitHub repo, with the Vercel domain added to Firebase *Authorized domains* | Hosting | vercel.com |
| Apps Script URL + portal secret | Vercel server env | From above |

### Apple / kiosk
| Item | Notes |
|---|---|
| **A Mac with Xcode** | This machine is Windows. The kiosk app can't be built, run, or debugged here. CI can only run the package tests. |
| Lab iMac access (camera permission, macOS version ≥ 13) | `Package.swift` targets macOS 13 |
| **Apple Developer Program** ($99/yr), *optional* | Only for notarized `.dmg`; conflicts with the $0 goal. Without it, install via right-click → Open. |

### Non-technical
- **Biometric consent text** + whatever approval the university/faculty (e.g. Prof. Umang Panchal) needs.
- **Logistics for the bulk face-capture session** (~150 students).
- **Anthropic API key**, *only* if you want to actually run `orchestration/orchestrator.py`. Not needed for the product.

---

## 8. Recommended next 5 actions

1. Commit the uncommitted Swift/docs work and push so CI validates it.
2. Make the repo private, or at minimum remove the "commit embeddings" step from `retrain.yml` and disable the schedule until the Drive steps exist.
3. Create the dev Sheets + Script Properties, deploy the backend, and run curl smoke tests, including the redirect check for K1.
4. Decide three open product questions: non-SCC enrollment path, minimum session length / auto-close rule, and the admin email domain.
5. Get a Mac and start the Xcode kiosk app on top of `KioskNetworking`. Settle the CoreML model first (M1), since everything else depends on matching working.
