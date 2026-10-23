# Hive

React UI + Node API. **Live** mode runs **one Cursor agent per bubble** via `@cursor/sdk`.

## Setup

Needs **Node 20+** (Cursor SDK). If you use nvm:

```bash
cd "/Users/jarvis/NEXUS ORCHESTRATOR"
nvm use
cp .env.example .env
# paste CURSOR_API_KEY from https://cursor.com/dashboard/integrations
npm install
npm run dev
```

- Web: Vite (proxies `/api` → `:8787` in local dev)
- API: Express + Cursor SDK

### Production

- API (e.g. Render): start with `npx tsx server/src/index.ts`, set `CURSOR_API_KEY`
- Frontend (e.g. Vercel): deploy with `vercel.json` (rewrites `/api` → Render). You can leave `VITE_API_URL` unset on Vercel — the app uses same-origin `/api`.

### GitHub sign-in

Hive uses a **GitHub App** (client ID starts with `Iv23`) or a classic OAuth App.

On the GitHub App: **Callback URL** can be any of:

- `https://hive-efc7.onrender.com/api/auth/github/callback` (API — preferred)
- `https://hive-sepia-chi.vercel.app/api/auth/github/callback` (SPA rewrite → API)
- `https://hive-sepia-chi.vercel.app/` (homepage; Hive forwards `?code` to the API)

Production **does not send `redirect_uri`**. GitHub then uses the first Callback URL on the app. Sending the Vercel SPA URL was what caused `The redirect_uri is not associated with this application`.

In API `.env` / Render env:

```bash
GITHUB_CLIENT_ID=...          # GitHub App client ID (Iv23…), not the numeric App ID
GITHUB_CLIENT_SECRET=...      # full generated client secret (long), no quotes
HIVE_APP_URL=http://localhost:5173          # prod: your Vercel URL (not localhost)
# Local only:
# GITHUB_CALLBACK_URL=http://localhost:8787/api/auth/github/callback
```

Paste the **client secret**, not the App ID. A 5-character value is the App ID and will fail after GitHub redirects back.

After OAuth, Hive sets cookie + `sessionStorage` on the app origin. Opening `/api/auth/me` alone in a tab without a session still shows `SESSION_EXPIRED`.

Run **both** API and web (`npm run dev`). Locally the GitHub button opens the API on `:8787`, not Vite — otherwise you get `Cannot GET /api/auth/github`.

### GitHub workspace (Live)

Before assigning a goal, pick a **repo** in the picker (Cursor-connected repos, `HIVE_REPOS`, or paste a URL). Agents then run as **cloud** Cursor agents on that repo and can open a PR. Leave “Local server folder” to use the API machine’s disk instead.

Toggle **Live / Demo** in the header. Live needs a valid key; Demo uses the old scripted run.

## How Live works

1. Orchestrator agent plans JSON assignments
2. Each teammate bubble has its own Cursor `Agent` (created lazily, reused)
3. Agents run locally against `HIVE_CWD` (or `NEXUS_CWD`; default: this repo)
4. SSE streams status and chat updates to the UI

## Build

```bash
npm run build
npm run preview
```
