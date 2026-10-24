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

### Jira stories (optional)

Set on the API host:

```bash
JIRA_BASE_URL=https://your-site.atlassian.net
JIRA_EMAIL=bot@your-company.com
JIRA_API_TOKEN=...   # from https://id.atlassian.com/manage-profile/security/api-tokens
# JIRA_CLOUD_ID=...  # optional; required if auto-detect fails (see site/_edge/tenant_info)
# JIRA_PROJECT=PROJ  # optional
```

**Scoped API tokens** must use `https://api.atlassian.com/ex/jira/{cloudId}` (Hive resolves `cloudId` automatically). Classic tokens also work on that gateway. Scopes: `read:jira-work`, `read:me` / `read:jira-user`. Account needs **Browse projects**.

In the UI, **Jira story** lists unfinished issues whose type name contains “Story” and that are assigned to the Jira account (`assignee = currentUser()`). Picking one fills the Orchestrator goal (Board) or starts a run (Bubbles). No Jira write-back in v1.

### GitHub sign-in

Create a GitHub OAuth App (Settings → Developer settings → OAuth Apps):

- Homepage URL: your web app (local `http://localhost:5173`, prod your Vercel URL)
- Authorization callback URL (must be the **app** host, not Render):
  - Local: `http://localhost:5173/api/auth/github/callback` (Vite proxies `/api`)
  - Prod: `https://hive-sepia-chi.vercel.app/api/auth/github/callback` (Vercel rewrites `/api` → Render)

In API `.env` / Render env:

```bash
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...   # no quotes; must match this OAuth App
HIVE_APP_URL=http://localhost:5173          # prod: your Vercel URL (not localhost)
# Optional override — usually omit; defaults to ${HIVE_APP_URL}/api/auth/github/callback
# GITHUB_CALLBACK_URL=https://hive-sepia-chi.vercel.app/api/auth/github/callback
```

GitHub App callback and `redirect_uri` must match (https, no trailing slash). Wrong secret or mismatched callback → `token_exchange_failed` / `redirect_uri_mismatch`.

After OAuth, the callback runs on the app origin (via rewrite), sets cookie + `sessionStorage`, then sends you home. Opening `/api/auth/me` alone in a tab without a session still shows `SESSION_EXPIRED`.

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
