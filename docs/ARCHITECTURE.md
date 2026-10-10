# Architecture, tech stack and algorithms

Everything here describes the code on `feature/full-build` (backend API v2.1.0). Numbers quoted
(thresholds, timeouts) are the actual constants in the code, with the file they live in.

---

## 1. What the system does

| Actor | Does |
|---|---|
| **Student** | Walks up to the iMac, looks at the camera, turns their head slightly → checked in. Same again later → checked out. First time: enrolls on the kiosk (number → confirm → consent → 5 photos). After a session ≥ 15 min gets an email with a one-tap "what did you work on?" form. |
| **Workshop attendee** (not on the SCC roster) | Enrolls with name + email; scans are logged once per day to `Other_Workshop_Attendees`. |
| **Faculty / lab admin** | Signs in to the admin portal with a university Google account: who is in the lab now, session log, activity answers, roster with enrollment status, analytics, CSV export. |
| **Maintainer** | Sets up Google resources and secrets once ([SETUP.md](SETUP.md)), installs the kiosk ([MAC_SETUP.md](MAC_SETUP.md)). Retraining runs weekly by itself. |

---

## 2. Tech stack

| Layer | Technology | Why |
|---|---|---|
| Kiosk UI | **SwiftUI** (macOS 13+), `ObservableObject` state | Native Apple look, runs on older lab iMacs (Ventura) |
| Camera | **AVFoundation** `AVCaptureSession` (720p, BGRA) | Built-in webcam, no extra hardware |
| Face detection + head pose | **Vision** `VNDetectFaceRectanglesRequest` revision 3 | Fast, on-device, gives continuous yaw for liveness |
| Face embedding on kiosk | **Core ML** model `FaceNet.mlpackage` (float32, CPU+GPU) | Same network as the pipeline, exported by `export_coreml.py` |
| Kiosk storage | Application Support JSON files (atomic writes), **Keychain** for the secret | Survives crashes; secret never in plain files |
| Server | **Google Apps Script** web app (V8) | Free, no servers to run, native Sheets/Drive/Gmail access |
| Database | **Google Sheets** (two spreadsheets) | Faculty already use Sheets; zero cost |
| File storage | **Google Drive** (private folders) | Face photos and embeddings files |
| Email | Apps Script **MailApp** + an **HtmlService** form page | Activity form without Google Forms setup |
| Embedding model | **FaceNet InceptionResnetV1**, pretrained on **VGGFace2** (`facenet-pytorch` 2.5.3, PyTorch) | Well-known 512-d face embedding, good accuracy for free |
| Pipeline runner | **GitHub Actions** (weekly cron + manual) | Free compute for a public repo |
| Model export | **coremltools 9.0** (torch 2.7.1, numpy 2.2.6 pinned) | Converts the exact pipeline model to Core ML |
| Admin portal | **Next.js 16** App Router, **React 19**, **Tailwind CSS 4**, TypeScript | Fast to build, free hosting on Vercel |
| Portal sign-in | **Firebase Authentication** (Google provider) + **jose** for JWT verification | Free; tokens verified with Google's public keys, no service account |
| Charts | Hand-written SVG (single series, accessible tables) | No chart library needed |
| CI | GitHub Actions: Node tests, pytest, `swift build/test` on macOS, Next build | Every push is verified |

---

## 3. Components and data flow

### 3.1 Check-in / check-out
1. Kiosk camera frame (10 analysed/s) → Vision finds the face and its yaw.
2. Three consecutive frames are cropped (§5.2) and embedded with Core ML; their mean is the **probe**.
3. Probe is matched against all templates on the kiosk (§5.4). No match → "We don't recognize you yet".
4. Match → **liveness**: "Turn your head slightly" (§5.5). The moment it passes, the kiosk shows a green ✓ "Hi, Alice" (first names are remembered from earlier scans) — no waiting for the backend.
5. Kiosk `POST scan {enrollment_no, method:"face"}` → backend decides entry or exit (§5.7) → kiosk shows "Welcome, Alice" / "See you, Alice · 1 h 40 min".
6. On exit (≥ 15 min) the backend emails the activity form link.
7. Offline? The scan goes to the durable queue with its real time and is replayed later (§5.8).

### 3.2 Enrollment
`lookup` (shows name + masked email) → member confirms / non-member types name + email → consent
screen → `enroll {consent:true}` → guided capture of 5 crops (§5.6) → `upload_faces` (5 JPEGs to
`Face-Dataset/<enrollment_no>/`) → the mean embedding is stored locally so the student is
recognised immediately, before the next weekly retrain.

### 3.3 Weekly retrain (GitHub Actions, Sunday 03:00 IST)
`sync_faces` (manifest + photos via `face_manifest` / `face_images`) → `pipeline` (FaceNet embeddings)
→ `publish` (`publish_embeddings`, version = current + 1). Kiosks check `embeddings_version` every
10 min and download the new file with `embeddings_download`. Photos are written to the runner's
temp folder and deleted at the end; nothing is cached, committed or uploaded as an artifact.

### 3.4 Admin portal
Browser signs in with Google (Firebase) → calls the portal's own `/api/data` with the Firebase ID
token → the Next.js server verifies the token, checks the email domain/allow list, then makes **one**
`dashboard` call to the backend with the **admin secret** → the browser computes stats and charts.
The admin secret never reaches the browser. The last response is kept in `sessionStorage`, so a
reload shows data instantly while fresh data loads (cleared when the tab closes and on sign-out).

---

## 4. Data model

**Spreadsheet 1 — SCC registration (`MASTER_SHEET_ID`), tab `Master_Students`** — *read-only for the system*.
Columns are found by header name (`MASTER_COLUMNS` in `backend/src/Config.gs`): `enrollment_no`, `name`, `email`, `batch_tags` (comma-separated, e.g. `SCC/5-7, SCC/3-5`). Other columns are ignored.

**Spreadsheet 2 — AATCE (`ATTENDANCE_SHEET_ID`)**, tabs created by `setupSheets()`:

| Tab | Columns |
|---|---|
| `Attendance_Log` | session_id, enrollment_no, entry_time, exit_time, duration_mins, activity_form_status (`pending` / `completed` / `skipped`), activity_description, email_sent (`no` / `yes` / `failed`), notes (`manual entry`, `manual exit`, `no exit scan`) |
| `Other_Workshop_Attendees` | id, name, enrollment_no, email, workshop_name, date |
| `Face_Enrollments` | enrollment_no, name, email, is_member, consent_at, photo_count, enrolled_at, updated_at |
| `Embeddings` | version, generated_at, model_version, drive_file_id, entry_count (one data row) |

**Drive**: `Face-Dataset/<enrollment_no>/<yyyyMMdd-HHmmss>-<n>.jpg` (160×160 face crops) and `Embeddings/embeddings-v<N>.json`.

**embeddings.json**: `{ version, generated_at, model_version: "facenet-inceptionresnetv1-vggface2", entries: [{ enrollment_no, embedding_vector: [512 floats] }] }` — about 5 KB per person.

**Kiosk** (`~/Library/Application Support/AATCEKiosk/`): `embeddings.json`, `local-enrollments.json`, `scan-queue.json`, optional `FaceNet.mlpackage`/`.mlmodelc`. Secret in the login Keychain (`club.scc.aatce.kiosk`).

---

## 5. Algorithms

### 5.1 Face detection and framing — `CameraService.swift`
- Vision rectangles request, revision 3 (continuous yaw).
- Largest face wins; if a second face is more than half its area → "One at a time".
- Face width must be ≥ **16 %** of the frame (`FaceGeometry.minimumWidth`) → otherwise "Come a little closer".

### 5.2 Face crop (identical for enrollment and matching) — `FaceGeometry.crop`
Square of side **1.3 × max(box width, box height)** centred on the face; rejected if it leaves the
frame; scaled with Lanczos to **160 × 160** RGB. The same function produces the photos uploaded for
training and the frames matched live, so the pipeline and the kiosk see the same preprocessing.

### 5.3 Embedding — `embeddings.py`, `FaceEmbedder.swift`
FaceNet InceptionResnetV1 (VGGFace2 weights). Input standardisation `(pixel − 127.5) / 128`
(built into the Core ML input as scale `1/128`, bias `−127.5/128`). Output: **512-d, L2-normalised**.
CI checks Core ML against PyTorch on macOS: lowest cosine similarity **1.000000**.

**Template per person** = mean of the per-photo embeddings, re-normalised (`person_embedding` in
Python, `Vector.mean` in Swift).

### 5.4 Matching — `FaceMatcher.swift`
- Probe = mean of **3** consecutive frame embeddings.
- Score = cosine similarity = dot product of unit vectors, against every template.
- Accept only if best score ≥ **0.65** (FR-7; adjustable in kiosk Settings, 0.50–0.90) **and** it beats the runner-up by ≥ **0.05**, so two look-alikes are never confused — they get the manual-entry fallback instead.
- Cost: one 512-float dot product per enrolled student — microseconds for hundreds of students.

### 5.5 Liveness — `KioskModel.checkLiveness`
The first frame's yaw is the baseline; the student must turn **≥ 0.26 rad (≈ 15°)** to either side
within **7 s**. A printed photo cannot do this. Limitation: a video of the student turning their head
would pass (no depth camera); acceptable for attendance and recorded in the build report.

### 5.6 Enrollment capture — `EnrollmentModel.handle`
5 crops, ≥ **0.4 s** apart: 3 frontal (|Δyaw| < 0.13 rad), then 2 turned (|Δyaw| ≥ 0.26 rad) — this is
both the liveness check and pose variety for better recognition. Times out after **25 s**.

### 5.7 Session logic — `backend/src/Scan.gs`
- Member, **no open session today** → entry (new UUID `session_id`).
- Member, **open session today** → exit, `duration_mins = round((exit − entry)/60 000)`.
- Any scan within **2 min** of the member's last scan → `cooldown` with seconds remaining (FR-11). The kiosk also stays quiet for 2 min after a successful scan of the same person.
- Not in `Master_Students` but in `Face_Enrollments` → logged once per day to `Other_Workshop_Attendees`.
- Neither → `not_enrolled`.
- "Today" is the scan's date in **Asia/Kolkata**. A session left open is closed by the nightly job (§5.10), never by the next day's scan.
- `scanned_at` (offline replays) is accepted if within the last **24 h**; up to **2 min** in the future is clamped to server time.
- `method: "manual"` adds `manual entry` / `manual exit` to `notes` for audit.

### 5.8 Offline queue — `ScanQueue.swift`
FIFO, persisted to disk with an atomic write **before** the kiosk says "Scan saved", so a power cut
can't lose it. Flushed every minute and before any new scan (order is preserved). On replay:
success → removed; retryable error (no network, HTTP 5xx/429, Google HTML error page,
`server_error`) → stop and retry later; any other rejection (cooldown, not enrolled, too old) →
dropped. A guard prevents two overlapping flushes from sending the same scan twice.

### 5.9 Embeddings versioning — `publish.py`, `EmbeddingStore.swift`
- `publish` reads the current version and sends `current + 1`; the backend rejects anything not greater (`version_conflict`).
- The kiosk downloads only when the server version is newer, and refuses a file whose `model_version` differs from its Core ML model's version.
- A **local template** (made at enrollment) overrides the published one and is deleted only when a published file **generated after** the enrollment **contains** that student — so a failed photo upload never makes a student disappear.

### 5.10 Activity form and nightly job — `Activity.gs`
- Exit after ≥ **15 min** → email with `WEB_APP_URL?session=<uuid>`; the UUID is the credential for that single row. Shorter sessions are marked `skipped`.
- The form page writes `activity_description`, max 1000 characters, once.
- `closeStaleSessions` runs daily at **01:00**: sessions from earlier days with no exit get `no exit scan` and still receive the form email. Idempotent.

### 5.11 Security
- **Per-role secrets** (`KIOSK_SECRET`, `PIPELINE_SECRET`, `ADMIN_SECRET`) in Script Properties; each role may call only its actions (`ROLE_ACTIONS` in `Config.gs`); comparison is constant-time.
- Secrets travel only in POST bodies (never URLs); GET serves only the activity form.
- Every internal Apps Script function ends in `_`, which makes it **private** — the form page's `google.script.run` can reach only `submitActivity` and the owner-only setup functions (a test enforces this).
- Writes run under the script lock from read to write, so two scans at once can't create duplicate sessions.
- Text typed by users that starts with `= + - @` is stored as text, in Sheets and in CSV exports (formula injection).
- Enrollment numbers must match `^[A-Za-z0-9_-]{1,32}$` (they become Drive folder names).
- Portal: Firebase ID token verified against Google's JWKS (issuer, audience, `email_verified`) + domain / allow list; a production build refuses all data until sign-in is configured.
- Kiosk: secret in the Keychain, write-only in Settings; HTTPS only (except `http://localhost` for development).

---

## 6. Performance and limits
| Item | Limit |
|---|---|
| Scan round trip | Apps Script ~1.5 s fixed startup + 0.5–2 s work, measured on the live deployment; matching itself is milliseconds and the student sees ✓ immediately |
| `Attendance_Log` size | read in full per scan; fine to ~30 000 rows, archive yearly after that |
| Emails | MailApp: 100/day on a personal Gmail, 1 500/day on Google Workspace |
| Upload | ≤ 5 images × 200 KB per call; `face_images` ≤ 25 per call |
| Embeddings file | ~5 KB per person (~1.5 MB for 300) |
