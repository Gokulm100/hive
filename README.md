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

Create a GitHub OAuth App (Settings → Developer settings → OAuth Apps):

- Homepage URL: your web app (local `http://localhost:5173`, prod your Vercel URL)
- Authorization callback URL: `http://localhost:8787/api/auth/github/callback` (local) or `https://hive-efc7.onrender.com/api/auth/github/callback` (prod)

In API `.env` / Render env:

```bash
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...   # no quotes; must match this OAuth App
HIVE_APP_URL=http://localhost:5173          # prod: your Vercel URL (not localhost)
GITHUB_CALLBACK_URL=https://hive-efc7.onrender.com/api/auth/github/callback
# local instead: GITHUB_CALLBACK_URL=http://localhost:8787/api/auth/github/callback
```

`GITHUB_CALLBACK_URL` must be **identical** to the GitHub App callback (https, no trailing slash). Wrong secret or mismatched callback → `token_exchange_failed`.

After OAuth, the API redirects to your app with a `#h=…` session handoff (Bearer). Opening `/api/auth/me` alone in a tab will still show `SESSION_EXPIRED` — that endpoint needs the session from the app.

Run **both** API and web (`npm run dev`). Locally the GitHub button opens the API on `:8787`, not Vite — otherwise you get `Cannot GET /api/auth/github`.

### GitHub workspace (Live)

Before assigning a goal, pick a **repo** in the picker (Cursor-connected repos, `HIVE_REPOS`, or paste a URL). Agents then run as **cloud** Cursor agents on that repo and can open a PR. Leave “Local server folder” to use the API machine’s disk instead.

Toggle **Live / Demo** in the header. Live needs a valid key; Demo uses the old scripted run.

## How Live works

1. Orchestrator agent plans JSON assignments
2. Each teammate bubble has its own Cursor `Agent` (created lazily, reused)
3. Agents run locally against `HIVE_CWD` (or `NEXUS_CWD`; default: this repo)
4. SSE streams status, chat, and detail-log updates to the UI

## Build

```bash
npm run build
npm run preview
```
