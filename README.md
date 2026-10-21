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
- Frontend (e.g. Vercel): set `VITE_API_URL=https://hive-efc7.onrender.com` then redeploy

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
