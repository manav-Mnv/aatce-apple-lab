# Architecture, tech stack and algorithms

Describes the system as built (backend API v3.0.0 on Supabase). Numbers quoted (thresholds,
timeouts) are the actual constants in the code, with the file they live in.

---

## 1. What the system does

| Actor | Does |
|---|---|
| **Student** | Walks up to the iMac, looks at the camera, turns their head slightly → a green ✓ "Hi, Alice" appears instantly and the scan is recorded. Same again later → checked out. First time: enrolls on the kiosk (number → confirm → consent → 5 photos). After a session ≥ 15 min gets an email with a one-tap "what did you work on?" form. |
| **Workshop attendee** (not on the SCC roster) | Enrolls with name + email; scans are logged once per day as a workshop attendee. |
| **Faculty / lab admin** | Signs in to the admin portal with a university Google account: who is in the lab now, session log, activity answers, roster with enrollment status, analytics, CSV export. |
| **Maintainer** | Edits the roster in Supabase, copies secrets from Vault into the apps ([SETUP.md](SETUP.md)), installs the kiosk ([MAC_SETUP.md](MAC_SETUP.md)). Retraining runs weekly by itself. |

```
 Lab iMac ── AATCE Kiosk (SwiftUI)                     Faculty ── Admin portal (Next.js on Vercel)
   camera → Vision → FaceNet (Core ML) → match → head-turn      Google sign-in (Firebase)
            │ POST /rest/v1/rpc/api + kiosk secret                │ server-side, admin secret
            ▼                                                     ▼
        Supabase (Postgres, Mumbai) ── public.api(jsonb) ── schema `lab` (students, sessions,
            ▲      │                                          enrollments, photos, embeddings)
            │      ├── pg_cron every 5 min → pg_net → Brevo → activity email → portal /activity/<id>
            │      └── pg_cron 01:00 IST → close sessions with no exit
            │ pipeline secret
        GitHub Actions (weekly): download photos → FaceNet embeddings → publish → kiosks download
```

---

## 2. Tech stack

| Layer | Technology | Why |
|---|---|---|
| Kiosk UI | **SwiftUI** (macOS 13+), `ObservableObject` state | Native Apple look, runs on older lab iMacs (Ventura) |
| Camera | **AVFoundation** `AVCaptureSession` (720p, BGRA) | Built-in webcam, no extra hardware |
| Face detection + head pose | **Vision** `VNDetectFaceRectanglesRequest` revision 3 | Fast, on-device, continuous yaw for liveness |
| Face embedding on kiosk | **Core ML** `FaceNet.mlpackage` (float32, CPU+GPU) | Same network as the pipeline (`export_coreml.py`) |
| Kiosk storage | Application Support JSON (atomic writes), **Keychain** for the secret | Survives crashes; secret never in plain files |
| Backend | **Supabase** Postgres 17 — all logic in PL/pgSQL behind one RPC function | ~0.1–0.3 s per call, transactional, free, no server to run |
| Data | Tables in a private schema `lab` (not exposed by the Data API) | Nothing readable without going through the API |
| Secrets | SHA-256 hashes in `lab.secrets`; plaintext in **Supabase Vault** | Copy-from-Vault, never in the repo |
| Photos / embeddings | `bytea` / `jsonb` in Postgres (~10 KB per photo, ~5 KB per person) | One store; 300 students ≈ 15 MB of the free 500 MB |
| Email | **Brevo** API called from Postgres by **pg_net**, scheduled by **pg_cron** | Free 300/day, no card, no extra service |
| Activity form | Public page in the admin portal (`/activity/<session_id>`) | Same Apple-style UI as the portal |
| Embedding model | **FaceNet InceptionResnetV1**, pretrained on **VGGFace2** (`facenet-pytorch` 2.5.3) | Well-known 512-d face embedding |
| Pipeline runner | **GitHub Actions** (weekly cron + manual) | Free compute for a public repo |
| Model export | **coremltools 9.0** (torch 2.7.1, numpy 2.2.6 pinned) | Converts the exact pipeline model to Core ML |
| Admin portal | **Next.js 16** App Router, **React 19**, **Tailwind CSS 4**, TypeScript | Free hosting on Vercel |
| Portal sign-in | **Firebase Authentication** (Google) + **jose** JWT verification | Tokens verified with Google's public keys |
| CI | GitHub Actions: SQL tests on Postgres 17, pytest, `swift build/test` on macOS, Next build | Every push is verified |

---

## 3. Data flows

### 3.1 Check-in / check-out
1. Kiosk camera frame (10 analysed/s) → Vision finds the face and its yaw.
2. Three consecutive frames are cropped (§5.2) and embedded with Core ML; their mean is the **probe**.
3. Probe is matched against all templates on the kiosk (§5.4). No match → "We don't recognize you yet".
4. Match → **liveness**: "Turn your head slightly" (§5.5). The moment it passes, the kiosk shows ✓ "Hi, Alice" (first names remembered from earlier scans).
5. Kiosk `scan` → backend decides entry or exit (§5.7) → "Checked in at 9:41" / "Checked out · 1 h 40 min".
6. Exit ≥ 15 min → the session is queued for the activity email (§5.10).
7. Offline? The scan goes to the durable queue with its real time and is replayed later (§5.8).

### 3.2 Enrollment
`lookup` (name + masked email) → member confirms / non-member types name + email → consent →
`enroll {consent:true}` → guided capture of 5 crops (§5.6) → `upload_faces` → the mean embedding is
stored locally so the student is recognised immediately, before the next weekly retrain.

### 3.3 Weekly retrain (GitHub Actions, Sunday 03:00 IST)
`sync_faces` (`face_manifest` + `face_images`, 25 per call) → `pipeline` (FaceNet) → `publish`
(`publish_embeddings`, version = current + 1). Kiosks check `embeddings_version` every 10 min and
download with `embeddings_download`. Photos exist on the runner only during the job.

### 3.4 Admin portal
Browser signs in with Google (Firebase) → the portal's `/api/data` verifies the token and email
domain → **one** `dashboard` call with the admin secret → the browser computes stats and charts.
The last response is kept in `sessionStorage` so reloads are instant (cleared on tab close/sign-out).

---

## 4. Data model (schema `lab`)

| Table | Columns |
|---|---|
| `students` (roster, edited by admins) | enrollment_no (PK), name, email, batch_tags (comma-separated), created_at |
| `face_enrollments` | enrollment_no (PK), name, email, is_member, consent_at, photo_count, enrolled_at, updated_at |
| `face_photos` | id (uuid), enrollment_no → face_enrollments (cascade delete), data (JPEG bytes), created_at |
| `sessions` | session_id (uuid), enrollment_no, entry_time, exit_time, duration_mins, activity_form_status (`pending`/`completed`/`skipped`), activity_description, email_sent (`no`/`queued`/`sending`/`yes`/`failed`), email_request_id, notes (`manual entry`, `manual exit`, `no exit scan`) |
| `workshop_attendees` | id, enrollment_no, name, email, workshop_name, date |
| `embeddings` | version (PK), generated_at, model_version, entry_count, data (the whole embeddings.json), published_at — last 3 kept |
| `secrets` | role (`kiosk`/`pipeline`/`admin`), secret_hash (SHA-256) |
| `settings` | `sender_email`, `sender_name`, `portal_url` |

**embeddings.json**: `{ version, generated_at, model_version: "facenet-inceptionresnetv1-vggface2", entries: [{ enrollment_no, embedding_vector: [512 floats] }] }`.

**Kiosk** (`~/Library/Application Support/AATCEKiosk/`): `embeddings.json`, `local-enrollments.json`, `scan-queue.json`, optional `FaceNet.mlpackage`. Secret in the Keychain (`club.scc.aatce.kiosk`); project URL and publishable key in UserDefaults.

---

## 5. Algorithms

### 5.1 Face detection and framing — `CameraService.swift`
Vision rectangles request, revision 3. Largest face wins; if a second face is more than half its
area → "One at a time". Face width must be ≥ **16 %** of the frame → otherwise "Come a little closer".

### 5.2 Face crop (identical for enrollment and matching) — `FaceGeometry.crop`
Square of side **1.3 × max(box width, height)** centred on the face; rejected if it leaves the frame;
Lanczos-scaled to **160 × 160** RGB. The same function produces the training photos and the live
probes, so pipeline and kiosk see identical preprocessing.

### 5.3 Embedding — `embeddings.py`, `FaceEmbedder.swift`
FaceNet InceptionResnetV1 (VGGFace2). Input `(pixel − 127.5) / 128` (built into the Core ML input).
Output **512-d, L2-normalised**. CI checks Core ML against PyTorch on macOS: cosine **1.000000**.
**Template per person** = mean of the per-photo embeddings, re-normalised.

### 5.4 Matching — `FaceMatcher.swift`
Probe = mean of **3** frames. Score = cosine similarity (dot product of unit vectors). Accept only if
best ≥ **0.65** (adjustable 0.50–0.90 in kiosk Settings) **and** ≥ **0.05** ahead of the runner-up, so
look-alikes get the manual fallback instead of a wrong name.

### 5.5 Liveness — `KioskModel.checkLiveness`
Yaw must change **≥ 0.26 rad (≈ 15°)** from the first frame within **7 s**. Stops printed photos;
a video replay could pass (no depth camera) — accepted for attendance.

### 5.6 Enrollment capture — `EnrollmentModel.handle`
5 crops ≥ **0.4 s** apart: 3 frontal (|Δyaw| < 0.13), 2 turned (|Δyaw| ≥ 0.26) — liveness and pose
variety in one. Times out after **25 s**.

### 5.7 Session logic — `lab.a_scan`
- Member with no open session **today** → entry. Open session today → exit, `duration_mins = round(Δ/60 s)`.
- Within **2 min** of the member's last scan → `cooldown` (+ seconds left). The kiosk also stays quiet for 2 min after a scan.
- Not in `students` but enrolled → `workshop_attendees`, once per day. Neither → `not_enrolled`.
- "Today" = Asia/Kolkata date. `pg_advisory_xact_lock` per student: two simultaneous scans can't both open a session.
- `scanned_at` (offline replay) accepted within the last **24 h**; ≤ 2 min in the future is clamped.
- `method: "manual"` → `manual entry` / `manual exit` in notes, badged in the portal.

### 5.8 Offline queue — `ScanQueue.swift`
FIFO, written to disk atomically **before** "Scan saved" is shown. Flushed every minute and before
any new scan (order kept). Retryable failure (no network, HTTP 5xx/429, `server_error`) → stop and
retry later; any other rejection → drop. A guard stops overlapping flushes from double-sending.

### 5.9 Embeddings versioning
`publish` sends `current + 1`; the backend rejects anything not greater. The kiosk downloads only
newer versions and refuses a file whose `model_version` differs from its Core ML model. A **local
template** made at enrollment overrides the published one and is dropped only once a published file
**generated after** the enrollment **contains** that student.

### 5.10 Activity form and emails — `lab.send_queued_emails`, `lab.close_stale_sessions`
- Exit ≥ **15 min** → `email_sent = queued`; shorter → form `skipped`.
- Every **5 min** (pg_cron): queued emails are posted to Brevo via pg_net (link `portal_url/activity/<session_id>`); the next run records `yes`/`failed` from the HTTP result.
- **01:00 IST** daily: sessions from earlier days with no exit get `no exit scan` and are queued for the email. Idempotent.
- The form page saves `activity_description` (1–1000 chars) once; the session UUID is the credential.

### 5.11 Security
- **Per-role secrets**, stored hashed; each role may call only its actions; plaintext only in Vault.
- Tables live in `lab`, which the Data API doesn't expose; RLS is on with no policies (deny-all).
- `public.api` is `SECURITY DEFINER` with `search_path = ''`; every `lab` function pins `search_path` too.
- Each call is one transaction: an error rolls back all its writes (`server_error`, retryable).
- Inputs validated in SQL: enrollment numbers `^[A-Za-z0-9_-]{1,32}$`, JPEG magic bytes and size, email format, 512-number vectors.
- Portal: Firebase ID token verified against Google's JWKS + domain/allow list; production refuses data until sign-in is configured; the admin secret never reaches the browser. CSV exports escape formula characters.
- Kiosk: secret in the Keychain, write-only in Settings; HTTPS only.

---

## 6. Performance and limits
| Item | Value |
|---|---|
| API call (warm, PC → Mumbai) | ~0.15 s `status`, ~0.3 s full `dashboard`; first call after idle ~1 s |
| Student-visible scan | ✓ instantly after the head turn; "Checked in" ~0.2–0.5 s later |
| Free plan | 500 MB database, pauses after 7 idle days (kiosk pings every minute; GitHub keep-alive every 3 days) |
| Emails | Brevo free: 300/day |
| Upload | ≤ 5 images × 200 KB per call; `face_images` ≤ 25 per call |
