# Login auth map (research)

Product choices locked in:

- Open sign-up: email + password for anyone with the app link.
- Demo mode: no login; Live mode requires login.
- Data: each account sees only their own jobs and artifacts.

---

## For BD / Designer (quick facts)

### True

- Users live in a JSON file (`server/data/users.json`, or path from `HIVE_USERS_FILE` / `NEXUS_USERS_FILE`). Fields: id, email, password hash, createdAt.
- Passwords use scrypt hashing and safe compare (`server/src/auth/password.ts`). Register validation: email format, password 8–128 chars.
- Register API code exists (`server/src/routes/register.ts`) but is **not wired** in `server/src/index.ts` — sign-up is not reachable today.
- There is **no** login route, session store, cookies, or “who am I” endpoint. `verifyPassword` is unused.
- All Live API routes are **public** today; no middleware checks identity.
- Demo runs **in the browser** (scripted flow, localStorage for demo jobs). It does not need the orchestration API for the main run.
- Live mode uses server APIs + SSE (`/api/events`). Jobs (max 3) persist under `.hive/jobs.json`; artifacts under `.hive/artifacts/` — **no user id** on either.
- Frontend has no login, sign-up, or “logged in as” UI. Header toggles Demo / Live only.

### Unknown / assume

- **Assume** session = HTTP-only cookie on the API host, ~7–30 day sliding expiry (team picks exact days).
- **Assume** sign-up + login + logout + current-user JSON under `/api/auth/*`.
- **Assume** Demo stays client-only; gating Live = block API when cookie missing + UI gate when switching to Live or starting a live run.
- **Unknown:** rate limits on sign-up/login, email verification, password reset (not in repo today).
- **Unknown:** production split (Vercel UI + Render API) — cookies need `SameSite` / domain plan so login works cross-origin or via same-site proxy.

### Risk

- Per-user jobs/artifacts is a **data model change**, not only route guards. Today one server = one shared job list and artifact folder.
- SSE (`/api/events`) is one global event bus — logged-in users could see each other’s events unless runs are scoped by user id.
- Open sign-up on a server with `CURSOR_API_KEY` = anyone who registers can spend your Cursor quota via Live.
- JSON user file does not scale for many accounts; fine for small teams, weak for public launch.
- Register router exists but unmounted — easy to miss in implementation; wire + login in same pass.

### Sources

- `server/src/users/store.ts`, `server/src/auth/password.ts`, `server/src/routes/register.ts`, `server/src/validation/register.ts`
- `server/src/index.ts` (route list)
- `server/src/jobs.ts`, `server/src/artifacts.ts`
- `src/hooks/useOrchestration.ts` (demo vs live)
- `src/api/client.ts` (client API surface)

---

## API routes: protect for Live (logged-in only)

| Route | Method | Notes |
|-------|--------|--------|
| `/api/health` | GET | **Keep public** — uptime checks; demo uses it to detect API/key |
| `/api/auth/register` | POST | **New** — mount existing register handler |
| `/api/auth/login` | POST | **New** |
| `/api/auth/logout` | POST | **New** |
| `/api/auth/me` | GET | **New** — optional for UI bootstrap |
| `/api/repos` | GET | Protect |
| `/api/events` | GET | Protect; filter events by user |
| `/api/jobs` | GET | Protect; filter by user |
| `/api/jobs/:id/stop` | POST | Protect; owner only |
| `/api/jobs/:id` | DELETE | Protect; owner only |
| `/api/artifacts` | GET | Protect; filter by user |
| `/api/artifacts/:id/download` | GET | Protect; owner only |
| `/api/artifacts/:id` | DELETE | Protect; owner only |
| `/api/stop` | POST | Protect |
| `/api/skip` | POST | Protect |
| `/api/orchestrate` | POST | Protect; attach user id to new job |
| `/api/instruct` | POST | Protect |

## Gaps to close (build order hint for engineering)

1. Wire register; add login, logout, session middleware.
2. Frontend: sign-up / login screens; block Live until session valid; send cookies on fetch (`credentials: 'include'`).
3. Add `userId` (or similar) to jobs, artifacts, and in-memory run state; filter all list/get/delete paths.
4. Scope SSE and orchestration so one user cannot stop or read another’s run.
5. Optional: hide Live toggle until logged in, or show login modal on Live select (per product).

## What demo visitors still get without login

- Full Demo engine (scripted agents, local demo job list in localStorage).
- Health probe only from API (to show “Live unavailable” vs “log in for Live”).
