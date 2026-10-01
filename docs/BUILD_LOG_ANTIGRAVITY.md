# BUILD LOG — Antigravity Agent
## AATCE Apple Lab Attendance System

---

## 🔍 Summary (as of 2026-10-02T02:52 IST)

### ✅ What's Working & Committed

| Commit | Component | What Works |
|---|---|---|
| `9e04fff` | **Backend (Phase 1)** | Full Apps Script web app: `doPost`/`doGet` router, `/enroll` (FR-1–6), `/scan` with entry/exit/cooldown/workshop routing (FR-7–12), `/embeddings` sync, shared-secret auth (NFR-4), LockService writes (PRD §8), read endpoints for admin portal (FR-20). 25/25 tests pass. API contract documented. |
| *(pending)* | **ML Training (Phase 4)** | Full embedding pipeline: dataset loader, FaceNet embedding generator, pipeline orchestrator with auto-versioning, `embeddings.json` schema exactly matching SRS §6. GitHub Actions weekly retrain workflow. 48/48 tests pass. |

### 🔎 What to Check First
1. **`backend/API_CONTRACT.md`** — the other agent needs these endpoint shapes for the kiosk app
2. **`ml-training/output/embeddings.json`** — will be generated once real face images exist in `Face-Dataset/`
3. **CI updated** — backend tests run via Node.js, ML tests run via pytest, retrain workflow added

### ⚠️ What's Blocked
- **Real face images** — pipeline works with fixtures/mocks; needs actual `Face-Dataset/` to produce real embeddings
- **Google Sheets setup** — Script Properties (SHARED_SECRET, MASTER_SHEET_ID, ATTENDANCE_SHEET_ID) need to be configured in the Apps Script editor for deployed testing
- **Apps Script deployment** — code is ready to push via `clasp`; requires Google account auth

### 📝 Not Started (out of scope for this session)
- Phase 2: Activity form & email (Apps Script MailApp trigger)
- Phase 5: Hardening (offline queue, batch tagging, CSV export, analytics)

---

Append-only build journal. One entry per attempt.
Format: `## [timestamp] <component> — <what you attempted>` + Why / Result / Details.

Session start: 2026-10-02T02:39+05:30 (autonomous build, phases 1 & 4 per SRS §8).

---

## [2026-10-02T02:40] Backend — Read all specification documents
**Why:** Need to understand full requirements before writing any code
**Result:** SUCCESS
**Details:** Read SRS.md, PRD.md, multi-agent-orchestration.md. Key finding: SRS v2.0 §2-3 specifies Apps Script (not Go) as backend. Existing README and CI stale.

## [2026-10-02T02:41] Backend — Create build plan
**Why:** Planning mode requested — lay out roadmap before coding
**Result:** SUCCESS
**Details:** Created detailed plan covering all Phase 1 and Phase 4 steps. Plan artifact at build_plan.md.

## [2026-10-02T02:42] Backend — Implement Apps Script web app (6 source files)
**Why:** Phase 1 core loop — defines the API contract other agents depend on
**Result:** SUCCESS
**Details:** Created:
- `backend/appsscript.json` — manifest with OAuth scopes
- `backend/src/Config.gs` — centralized config (sheet names, columns, constants)
- `backend/src/Auth.gs` — shared-secret validation (NFR-4, FR-13)
- `backend/src/SheetHelpers.gs` — batch reads, LockService writes (NFR-7, PRD §8)
- `backend/src/Enroll.gs` — enrollment endpoint (FR-1 through FR-6)
- `backend/src/Scan.gs` — scan endpoint with entry/exit/cooldown/workshop routing (FR-7 through FR-12)
- `backend/src/Embeddings.gs` — embeddings sync endpoint (SRS §6 schema)
- `backend/src/Main.gs` — doPost/doGet router with read endpoints for admin portal (FR-20)

## [2026-10-02T02:45] Backend — Run unit tests (25 tests)
**Why:** Validate all handler logic before committing
**Result:** SUCCESS
**Details:** 25/25 tests passed. Coverage: auth (4), config (1), enroll (4), scan (4), embeddings (3), router (7). Tests mock Apps Script globals and run via Node.js.

## [2026-10-02T02:46] Backend — API contract + README + CI update
**Why:** Other agents need the API contract; stale Go CI needed fixing
**Result:** SUCCESS
**Details:** Created API_CONTRACT.md (full endpoint documentation), updated README.md (Apps Script architecture), updated ci.yml (Node.js test runner instead of Go build).

## [2026-10-02T02:47] Backend — Git commit
**Why:** Backend passes all tests, ready to commit
**Result:** SUCCESS
**Details:** Commit `9e04fff`: "backend: Apps Script web app with enroll/scan/embeddings endpoints (Phase 1)". 13 files changed, 1855 insertions.

## [2026-10-02T02:47] ML Training — Project structure + dependencies
**Why:** Phase 4 — set up Python project with pyproject.toml + requirements.txt
**Result:** SUCCESS
**Details:** Created pyproject.toml (torch, facenet-pytorch, Pillow, numpy, pytest), requirements.txt, src/__init__.py.

## [2026-10-02T02:48] ML Training — Dataset loader
**Why:** Need to load face images from /Face-Dataset/<enrollment_no>/ structure
**Result:** SUCCESS
**Details:** `src/dataset.py` — loads images, validates (size, readability), filters by min images per person, returns {enrollment_no: [paths]} dict.

## [2026-10-02T02:48] ML Training — Embedding generator
**Why:** Core ML logic — FaceNet embedding generation with schema compliance
**Result:** SUCCESS
**Details:** `src/embeddings.py` — FaceNet InceptionResnetV1 (VGGFace2), MTCNN face detection, multi-image averaging, L2 normalization, schema validation. Output exactly matches SRS §6 and backend API_CONTRACT.md.

## [2026-10-02T02:49] ML Training — Pipeline orchestrator
**Why:** CLI entry point orchestrating dataset→embeddings→validate→save
**Result:** SUCCESS
**Details:** `src/pipeline.py` — argparse CLI, auto-version increment from previous embeddings.json, schema validation gate, logging throughout. Supports `--dry-run` for dataset-only validation.

## [2026-10-02T02:50] ML Training — Tests (48 tests, first run: 47 passed, 1 failed)
**Why:** Validate all ML pipeline logic
**Result:** FAILED (1 test)
**Details:** `test_schema_validated` failed — pipeline overrides version with int after mock returns string. Fixed test to use `entries: "not a list"` as the schema violation instead.

## [2026-10-02T02:51] ML Training — Tests (48 tests, re-run: 48 passed)
**Why:** Re-run after fixing test_schema_validated
**Result:** SUCCESS
**Details:** 48/48 tests passed in 0.75s. Coverage: dataset (13), embeddings (10), schema (17), pipeline (7). All tests use synthetic data — no model download needed.

## [2026-10-02T02:52] ML Training — GitHub Actions retrain workflow + README
**Why:** SRS §7 requires scheduled weekly retraining via GitHub Actions
**Result:** SUCCESS
**Details:** Created `.github/workflows/retrain.yml` (weekly cron, pip cache, artifact upload, auto-commit). Updated README.md with actual architecture and usage.

