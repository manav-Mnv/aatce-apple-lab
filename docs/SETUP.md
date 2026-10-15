# Setup guide — Supabase, GitHub, email, Firebase, Vercel

The backend already exists: Supabase project **aatce-apple-lab** (Mumbai, free plan), with the
database, API, tests, scheduled jobs and three role secrets set up. This guide is what *you* do
around it. The iMac is covered in [MAC_SETUP.md](MAC_SETUP.md).

> **Never** paste secrets into the repo, chat, issues or commit messages. Copy them from Supabase
> Vault straight into the place that needs them.

---

## Where every value goes (cheat sheet)

| Value | Where to find it | Put it in |
|---|---|---|
| Project URL `https://mlwbcifxunliyvxxfblo.supabase.co` | Supabase → Project Settings → API | kiosk Settings, GitHub `SUPABASE_URL`, Vercel `SUPABASE_URL` |
| Publishable key `sb_publishable_YzKz…TH0U` (public) | Supabase → Project Settings → **API Keys** | kiosk Settings, GitHub `SUPABASE_PUBLISHABLE_KEY`, Vercel `SUPABASE_PUBLISHABLE_KEY` |
| `aatce_kiosk_secret` | Supabase → **Integrations → Vault** (click the eye to reveal) | kiosk Settings → Kiosk secret |
| `aatce_pipeline_secret` | Vault | GitHub secret `PIPELINE_SECRET` |
| `aatce_admin_secret` | Vault | Vercel `ADMIN_SECRET` (and `admin-portal/.env.local` for local use) |
| Brevo API key | Brevo → SMTP & API → API Keys | Vault secret `brevo_api_key` (Part 3) |
| Firebase `apiKey`, `authDomain`, `projectId`, `appId` | Firebase console (Part 4) | Vercel `NEXT_PUBLIC_FIREBASE_*` |
| Allowed admin domain / emails | your decision | Vercel `NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN`, `ADMIN_EMAILS` |

---

## Part 1 — Students (the roster)

1. https://supabase.com/dashboard → project **aatce-apple-lab** → **Table Editor**.
2. Schema dropdown (top left) → **`lab`** → table **`students`**.
3. Add people with **Insert → Insert row**, or bulk-import: in your Google Sheet use
   **File → Download → CSV** with the columns `enrollment_no, name, email, batch_tags`, then
   **Insert → Import data from CSV**.
4. `batch_tags`: one or more batches separated by commas, e.g. `SCC/5-7, SCC/3-5`.

Only people in `students` count as SCC members; anyone else who enrolls on the kiosk is logged as
a workshop attendee.

## Part 2 — GitHub (weekly retrain + keep-alive)

Repo → **Settings → Secrets and variables → Actions → New repository secret** (or the commands below):

| Secret | Value |
|---|---|
| `SUPABASE_URL` | `https://mlwbcifxunliyvxxfblo.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | the publishable key |
| `PIPELINE_SECRET` | Vault → `aatce_pipeline_secret` |

```powershell
gh secret set SUPABASE_URL --repo manav-Mnv/aatce-apple-lab --body "https://mlwbcifxunliyvxxfblo.supabase.co"
```
```powershell
gh secret set SUPABASE_PUBLISHABLE_KEY --repo manav-Mnv/aatce-apple-lab --body "sb_publishable_YzKz9KDj3humCQ5Vu1Da2Q_eCZnTH0U"
```
```powershell
gh secret set PIPELINE_SECRET --repo manav-Mnv/aatce-apple-lab
```
(The last one asks for the value — paste it from Vault.) You can delete the old `APPS_SCRIPT_URL`
secret. Test: **Actions → Keep Supabase awake → Run workflow** → green with "Supabase is awake".

- **Retrain embeddings** runs every Sunday 03:00 IST (skips quietly until someone enrolls).
- **Keep Supabase awake** pings every 3 days — free projects pause after 7 idle days (holidays).
- **Kiosk release** builds the iMac app — see [MAC_SETUP.md](MAC_SETUP.md).

## Part 3 — Activity emails (Brevo, free 300/day, no card)

1. Sign up at https://www.brevo.com (free plan).
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender**: e.g. `applelab.scc@gmail.com`
   — click the link Brevo emails you to verify it.
3. **SMTP & API → API Keys → Generate a new API key** → copy it.
4. Supabase → **SQL Editor** → run (fill in your values):
   ```sql
   select vault.create_secret('<BREVO API KEY>', 'brevo_api_key');
   insert into lab.settings (key, value) values
     ('sender_email', 'applelab.scc@gmail.com'),
     ('sender_name',  'AATCE Apple Lab'),
     ('portal_url',   'https://<your-portal>.vercel.app')
   on conflict (key) do update set value = excluded.value;
   ```
   (Set `portal_url` after Part 5 gives you the Vercel address.)

Until these exist, emails wait in the queue (`email_sent = queued`) and go out once configured.
Check results in `lab.sessions.email_sent` (`yes` / `failed`).

## Part 4 — Firebase (Google sign-in for the portal)

1. https://console.firebase.google.com → **Add project** → `aatce-apple-lab` (Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable** → Save.
3. **Project settings (⚙) → General → Your apps → `</>` (Web)** → register `admin-portal` (no Hosting) → copy `apiKey`, `authDomain`, `projectId`, `appId`.
4. After Part 5: **Authentication → Settings → Authorized domains → Add domain** → your `*.vercel.app` domain.

## Part 5 — Vercel (the admin portal and the activity form)

1. https://vercel.com/new → import **manav-Mnv/aatce-apple-lab** → **Root Directory: `admin-portal`**.
2. **Environment Variables**:

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://mlwbcifxunliyvxxfblo.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | the publishable key |
| `ADMIN_SECRET` | Vault → `aatce_admin_secret` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` / `_AUTH_DOMAIN` / `_PROJECT_ID` / `_APP_ID` | from Part 4 |
| `NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN` | e.g. `paruluniversity.ac.in` |
| `ADMIN_EMAILS` | optional extra people, comma-separated |

3. **Deploy** → you get `https://<name>.vercel.app` — that is the **admin link** for faculty, and
   `https://<name>.vercel.app/activity/<id>` is where activity emails point (set `portal_url` in Part 3).
4. Changing a `NEXT_PUBLIC_*` value needs a **Redeploy**.

Without the Firebase variables the deployed portal shows no data ("Sign-in is not configured") — on
purpose. The `/activity/…` page works without sign-in.

**Run it on your PC instead:** fill `ADMIN_SECRET` in `admin-portal/.env.local`, then
`cd admin-portal; npm run dev` → http://localhost:3000 (sign-in skipped in development).

---

## Operations

### Rotating a secret (e.g. the kiosk Mac is lost)
1. SQL Editor — generates a new secret, activates it and stores it in Vault (change `kiosk` to `pipeline` or `admin` as needed):
   ```sql
   do $$
   declare s text := encode(extensions.gen_random_bytes(32), 'hex');
   begin
     perform lab.set_secret('kiosk', s);
     perform vault.update_secret((select id from vault.secrets where name = 'aatce_kiosk_secret'), s);
   end $$;
   ```
2. Copy the new value from Vault to where that role is used (kiosk Settings / GitHub `PIPELINE_SECRET` / Vercel `ADMIN_SECRET` + Redeploy). The old one stops working immediately.

### Deleting a student's biometric data (on request)
```sql
delete from lab.face_enrollments where enrollment_no = '<number>';   -- also deletes their photos
```
Then **Actions → Retrain embeddings → Run workflow**. On the kiosk, after that retrain: quit the app,
delete `~/Library/Application Support/AATCEKiosk/local-enrollments.json`, start it again.

### Health checks
- Kiosk status pill **Online · N faces**; orange = needs attention (hover for the message).
- Supabase → **Logs** (API, Postgres), **Integrations → Cron** (job runs), **Advisors** (security).
- Run `supabase/tests/api_test.sql` in the SQL editor any time → `TESTS PASSED: 70` (it changes nothing).

### Database changes
Add a new file in `supabase/migrations/`, run it in the SQL editor (or `supabase db push`), run the
tests. CI runs the same tests on a fresh Postgres for every push.
