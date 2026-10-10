# Admin portal

Faculty dashboard (FR-18–20): who is in the lab now, session log with activity answers, roster with
face-enrollment status, analytics (peak hours, per-batch attendance, daily trend, average session),
CSV export. Apple-style UI, light and dark, works on phones.

## How it is secured
The browser signs in with Google through Firebase and sends its ID token to `/api/data`. The
Next.js server verifies the token with Google's public keys (issuer, audience, verified email),
checks `NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN` / `ADMIN_EMAILS`, and only then calls the backend with
`ADMIN_SECRET`, which never reaches the browser. Without Firebase configured, `next dev` is open
(local only) and a production build refuses all data.

## Files
| Path | |
|---|---|
| `app/page.tsx`, `sessions/`, `students/`, `analytics/` | The four pages |
| `app/api/data/route.ts` | The only API route: auth → four backend calls in parallel |
| `lib/auth-server.ts`, `lib/access.ts` | Token verification, allow rules |
| `lib/backend.ts` | Server-side backend client |
| `lib/analytics.ts` | Pure stats/filters/CSV functions (unit-tested) |
| `components/` | Provider (auth + data), shell/sidebar, UI kit, SVG charts |

## Run
```bash
cp .env.example .env.local && npm install && npm run dev
```
With `node ../backend/dev/server.js` running, the defaults in `.env.example` work as-is.
```bash
npm test && npm run typecheck && npm run build
```
Deploy: Vercel, root directory `admin-portal` — see [../docs/SETUP.md](../docs/SETUP.md) Part 5.
