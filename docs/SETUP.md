# Setup guide — Google, Apps Script, GitHub, Firebase, Vercel

Do the parts in order. Part 1–3 make the backend work (needed by everything else). Part 4 turns on
weekly retraining, Part 5 the admin portal. The kiosk iMac is covered in [MAC_SETUP.md](MAC_SETUP.md).

> **Use one Google account for Parts 1–3** — ideally a club account (e.g. `scc.applelab@…`), not a
> personal one. The backend runs as that account, and it owns the sheets, folders and emails.
> **Never** paste secrets into the repo, chat, issues or commit messages.

---

## Where every value goes (cheat sheet)

| Value | How to get it | Put it in |
|---|---|---|
| `MASTER_SHEET_ID` | URL of the SCC registration spreadsheet: `docs.google.com/spreadsheets/d/`**`<ID>`**`/edit` | Apps Script → Script Properties |
| `ATTENDANCE_SHEET_ID` | URL of the new "AATCE Apple Lab" spreadsheet | Script Properties |
| `FACE_DATASET_FOLDER_ID` | URL of Drive folder `Face-Dataset`: `drive.google.com/drive/folders/`**`<ID>`** | Script Properties |
| `EMBEDDINGS_FOLDER_ID` | URL of Drive folder `Embeddings` | Script Properties |
| `KIOSK_SECRET` | generate (below) | Script Properties **and** kiosk Settings |
| `PIPELINE_SECRET` | generate | Script Properties **and** GitHub secret `PIPELINE_SECRET` |
| `ADMIN_SECRET` | generate | Script Properties **and** Vercel env `ADMIN_SECRET` |
| Web app URL (`…/exec`) | Apps Script → Deploy (Part 3) | Script Property `WEB_APP_URL`, GitHub secret `APPS_SCRIPT_URL`, Vercel env `APPS_SCRIPT_URL`, kiosk Settings |
| Firebase `apiKey`, `authDomain`, `projectId`, `appId` | Firebase console (Part 5) | Vercel env `NEXT_PUBLIC_FIREBASE_*` |
| Allowed admin domain / emails | your decision | Vercel env `NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN`, `ADMIN_EMAILS` |

**Generate a secret** (three different ones — never reuse one for two roles):
```bash
openssl rand -hex 32
```
(Windows PowerShell without OpenSSL: `-join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })`)

---

## Part 1 — Google Sheets

### 1.1 The roster: `Master_Students`
This is the existing SCC registration sheet. The system **only reads** it.
1. Open the SCC registration spreadsheet. Its tab must be named **`Master_Students`** (rename it, or change `TABS.MASTER_STUDENTS` in `backend/src/Config.gs`).
2. Row 1 must contain these headers (any order, extra columns are fine): `enrollment_no`, `name`, `email`, `batch_tags`.
   If the real headers differ (e.g. `Enrollment No`), edit the right-hand side of `MASTER_COLUMNS` in `backend/src/Config.gs` instead of renaming the sheet.
3. `batch_tags`: one or more batches separated by commas, e.g. `SCC/5-7, SCC/3-5`.
4. If this spreadsheet belongs to someone else, share it with the club account (**Viewer** is enough).
5. Copy its ID from the URL → `MASTER_SHEET_ID`.

### 1.2 The AATCE spreadsheet
1. In the club account: Google Sheets → **Blank** → name it `AATCE Apple Lab`.
2. Copy its ID → `ATTENDANCE_SHEET_ID`. (Tabs are created automatically in Part 3.6.)
3. Optional but recommended: make a **copy of both sheets for testing** and a second Apps Script deployment that points at the copies, so you never test against real attendance (SRS §7).

## Part 2 — Google Drive
1. In the club account's Drive: **New → Folder** `AATCE Apple Lab`.
2. Inside it create two folders: `Face-Dataset` and `Embeddings`.
3. Copy each folder's ID from its URL → `FACE_DATASET_FOLDER_ID`, `EMBEDDINGS_FOLDER_ID`.
4. **Do not share** these folders with "Anyone with the link". Share only with lab maintainers if needed.

## Part 3 — Apps Script backend

### 3.1 Create the project
Go to https://script.google.com → **New project** → rename it `AATCE Backend`.

### 3.2 Put the code in — choose A or B

**A. With clasp (recommended, keeps it in sync with Git)** — on any computer with Node.js:
```bash
npm install -g @google/clasp
```
```bash
clasp login
```
1. Turn on the Apps Script API once: https://script.google.com/home/usersettings → **Google Apps Script API: On**.
2. In the script editor: **Project Settings (⚙)** → copy the **Script ID**.
3. In the repo: copy `backend/.clasp.json.example` to `backend/.clasp.json` and paste the Script ID.
4. Push the code:
```bash
cd backend && clasp push --force
```
This uploads everything in `backend/src/` (all `.gs` files, `ActivityForm.html`, `appsscript.json`).

**B. Copy-paste (no tools)**
1. Editor → **Project Settings** → tick **Show "appsscript.json" manifest file in editor**.
2. Replace the manifest's content with `backend/src/appsscript.json`.
3. For every file in `backend/src/`: **+ → Script** (or **HTML** for `ActivityForm`), name it exactly like the file without the extension (`Main`, `Auth`, `Config`, `Sheets`, `Enroll`, `Scan`, `Activity`, `Embeddings`, `Admin`, `Setup`, `ActivityForm`) and paste the content. Delete the default `Code.gs`.

### 3.3 Script Properties
Editor → **Project Settings** → **Script Properties** → **Add script property**, one per row:

| Property | Value |
|---|---|
| `KIOSK_SECRET` | secret #1 |
| `PIPELINE_SECRET` | secret #2 |
| `ADMIN_SECRET` | secret #3 |
| `MASTER_SHEET_ID` | from 1.1 |
| `ATTENDANCE_SHEET_ID` | from 1.2 |
| `FACE_DATASET_FOLDER_ID` | from Part 2 |
| `EMBEDDINGS_FOLDER_ID` | from Part 2 |
| `WEB_APP_URL` | leave for now — filled in 3.5 |

### 3.4 Deploy as a web app
1. **Deploy → New deployment** → ⚙ **Select type → Web app**.
2. Description `v2.0.0`; **Execute as: Me**; **Who has access: Anyone** (the manifest says `ANYONE_ANONYMOUS`; the kiosk and GitHub Actions have no Google login — the secrets protect the API).
3. **Deploy** → **Authorize access** → pick the club account → *Advanced → Go to AATCE Backend (unsafe)* → **Allow**. (Google shows this for every unverified personal script; the permissions are Sheets, Drive, send mail, triggers, your email address.)
4. Copy the **Web app URL** (ends in `/exec`).

### 3.5 Save the URL
Add Script Property `WEB_APP_URL` = that URL (used in activity-form emails).

### 3.6 Create tabs and the nightly trigger
In the editor, choose function **`setupSheets`** in the toolbar → **Run**. Check the log: it creates
`Attendance_Log`, `Other_Workshop_Attendees`, `Face_Enrollments`, `Embeddings` and reports
`Master_Students OK: N rows`. Then run **`installTriggers`** once (schedules `closeStaleSessions` at 01:00).

### 3.7 Test it
```bash
curl -L -H "Content-Type: application/json" -d '{"secret":"<KIOSK_SECRET>","action":"status"}' "<WEB_APP_URL>"
```
Expected: `{"success":true,"status":"online",...,"version":"2.0.0"}`.
Use `-L` and **do not** add `-X POST` (Apps Script answers with a redirect that must be followed with GET).
More checks: `"action":"lookup","enrollment_no":"<a real number>"` with the kiosk secret returns the student's name; `"action":"students"` with the kiosk secret must return `forbidden`.

### 3.8 Updating the backend later
Push/paste the new code, then **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy**.
This keeps the **same URL**. ("New deployment" would create a new URL you'd have to update everywhere.)

---

## Part 4 — GitHub (weekly retraining)
1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `APPS_SCRIPT_URL` = web app URL
   - `PIPELINE_SECRET` = secret #2
2. **Actions → Retrain embeddings → Run workflow** to test. Expected log: photos downloaded, `Generated N embeddings`, `Published embeddings vX`. With no enrolled photos yet it fails at "Dataset loading failed" — that's normal until someone enrolls.
3. It then runs every Sunday 03:00 IST by itself. Without the secrets it skips with a notice instead of failing.

**Kiosk app builds:** **Actions → Kiosk release** builds `AATCE Kiosk.app` with the face model. It runs on every push to `master` that touches the app, or manually via **Run workflow** (only after this workflow file is on `master`). See [MAC_SETUP.md](MAC_SETUP.md).

---

## Part 5 — Admin portal (Firebase + Vercel)

### 5.1 Firebase (Google sign-in)
1. https://console.firebase.google.com → **Add project** → `aatce-apple-lab` (Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable** → choose a support email → Save.
3. **Project settings (⚙) → General → Your apps → `</>` (Web)** → nickname `admin-portal` → Register (no Hosting). Copy `apiKey`, `authDomain`, `projectId`, `appId` from the config shown.
4. After step 5.2 gives you a domain: **Authentication → Settings → Authorized domains → Add domain** → `your-project.vercel.app` (and any custom domain).

These four values are *public identifiers*, not secrets; access is controlled by the server-side checks below.

### 5.2 Vercel (hosting)
1. https://vercel.com → **Add New → Project** → import `manav-Mnv/aatce-apple-lab`.
2. **Root Directory: `admin-portal`**; Framework: Next.js (auto).
3. **Environment Variables**:

| Name | Value |
|---|---|
| `APPS_SCRIPT_URL` | web app URL |
| `ADMIN_SECRET` | secret #3 |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | from 5.1 |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | from 5.1 |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | from 5.1 |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | from 5.1 |
| `NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN` | e.g. `paruluniversity.ac.in` — everyone with a verified address there may sign in |
| `ADMIN_EMAILS` | optional, comma-separated extra people, e.g. `mentor@gmail.com` |

4. **Deploy**. Every PR gets a preview URL; merging to `master` updates production.
5. Changing a `NEXT_PUBLIC_*` value needs a **Redeploy** (they are built into the page).

Without the Firebase variables the deployed portal shows nothing and its API answers "Sign-in is not configured" — that's deliberate.

---

## Part 6 — Day-to-day operations

### Secret rotation (if a secret leaks, e.g. the kiosk Mac is stolen)
1. Generate a new secret for **that role only**.
2. Replace it in Script Properties (takes effect immediately, no redeploy).
3. Update where it is used: kiosk Settings / GitHub secret / Vercel env (+ Redeploy).

### Removing a student's biometric data (on request)
1. Drive → `Face-Dataset/<enrollment_no>` → delete the folder.
2. AATCE sheet → `Face_Enrollments` → delete their row.
3. Actions → **Retrain embeddings → Run workflow** (their template disappears from the next version).
4. On the kiosk, after the retrain has published: quit the app, delete `~/Library/Application Support/AATCEKiosk/local-enrollments.json`, start it again. (That file only holds people enrolled on this kiosk; everyone included in the new published file is unaffected. Do it right after a retrain so nobody enrolled since then is lost.)

### Health checks
- Kiosk status pill: **Online · N faces**. Orange = needs attention (hover for the message).
- Apps Script editor → **Executions**: every request and error.
- Sheet `Attendance_Log` → `email_sent = failed` usually means the daily mail quota was hit.

### Local development
`node backend/dev/server.js` gives a full backend on `http://localhost:8787/exec` with fake data;
point the portal (`admin-portal/.env.local`) or a dev kiosk (Settings) at it.
