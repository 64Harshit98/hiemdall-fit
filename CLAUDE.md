# CLAUDE.md

Operating guide for AI agents working in this repo. Read this first. For the full
product + technical specification see [SPEC.md](SPEC.md).

## What this is

**Heimdall · Fit** — a self-hosted, single-Pi workout plan generator and tracker.
An LLM produces a personalized weekly plan; the app shows only *today's* workout,
logs each set, captures session stats (manual or Apple Health export), and adapts
the plan weekly via cron. Behind Tailscale/LAN only — no public exposure, no TLS in
scope, CORS reflects any origin by design.

## Stack

- **Backend** — Node 20 (ESM, `"type": "module"`) + Express, `better-sqlite3` (file
  SQLite, WAL mode, `foreign_keys = ON`). Entry: `backend/src/server.js`.
- **Frontend** — React 18 + Vite + react-router-dom v6. Entry: `frontend/src/main.jsx`.
- **LLM** — Groq (`llama-3.3-70b-versatile`) by default; Gemini and OpenRouter are
  drop-in alternatives. All provider logic lives in `backend/src/services/llm.js`.
- **Auth** — bcrypt hashes + JWT in an httpOnly cookie.
- **Deploy** — `docker compose up -d --build`. Two containers: backend + nginx-served frontend.

## Repo layout

```
backend/src/
  server.js            Express app, mounts routers, starts cron
  db/index.js          SQLite schema + idempotent migrations + admin seed (SOURCE OF TRUTH for schema)
  middleware/auth.js   requireAuth (JWT cookie), admin gate
  routes/              auth, profile, plans, logs, reports, admin
  services/
    llm.js             provider abstraction + ALL system prompts (plan / mobility / report)
    cron.js            weekly plan adaptation job
    appleHealth.js     parses Apple Health export XML
frontend/src/
  App.jsx              routing + auth gate
  lib/api.js           fetch wrapper, BASE = '/api'
  pages/               Today, History, Profile, Onboarding, Login, Admin
  components/          ExerciseRow, ReportView, SessionStatsPanel
data/                  SQLite db lives here (gitignored, mounted into container)
```

## Run / dev

```bash
# Backend (needs .env with GROQ_API_KEY, JWT_SECRET, ADMIN_PASSWORD)
cd backend && npm install && npm run dev      # node --watch src/server.js, :3001

# Frontend
cd frontend && npm install && npm run dev      # vite

# Full stack
docker compose up -d --build                   # frontend :8090 → nginx, proxies /api → backend :3001
```

There is **no test suite, linter, or typechecker**. Verify changes by running the
app. There is no root `package.json` — backend and frontend are independent.

## Conventions

- ESM everywhere (`import`/`export`), not CommonJS.
- DB access is synchronous via `better-sqlite3` prepared statements
  (`db.prepare(...).get/all/run`). No ORM, no async DB calls.
- Plans and reports are stored as JSON blobs in TEXT columns (`plan_json`,
  `report_json`) and parsed at the route boundary.
- Schema changes go in `backend/src/db/index.js` as **idempotent** `CREATE TABLE IF
  NOT EXISTS` + `PRAGMA table_info` guarded `ALTER TABLE` migrations. The DB is
  long-lived on a Pi — never write a migration that drops data or assumes a fresh DB.
- Auth: every protected route uses `requireAuth`; it sets `req.user`. New users are
  `status='pending'` until an admin approves them; the seeded admin bypasses the queue.

## The LLM prompts (most-edited area)

All system prompts are template strings in `backend/src/services/llm.js`:
`PLAN_SYSTEM_PROMPT`, `MOBILITY_SYSTEM_PROMPT`, `REPORT_SYSTEM_PROMPT`. The model is
asked for **STRICT JSON only**; providers are called in JSON mode and the result is
validated before persisting. When editing prompts:

- The profile (including the free-text `injuries` field) is serialized to JSON and
  sent as the user message via `buildPlanPrompt`. Injuries, equipment, dislikes,
  `split_preference`, `additional_activities`, and `include_mobility` are all
  constraints the model must honor — keep their rules explicit and high-priority.
- If you change the output JSON shape, update the matching `validate*` function in
  the same file **and** any frontend consumer (`Today.jsx`, `ReportView.jsx`).

## Gotchas / known doc drift

- **Cron timing**: code is the source of truth — `cron.schedule('0 4 * * 1', ...)` =
  **Monday 04:00 local** (TZ env). The README's "Sun 22:00" is stale.
- **Frontend port**: `docker-compose.yml` maps `8090:80`. The README says 8080. Trust
  compose.
- `TZ` controls both cron firing and all "today" date math — changing it shifts which
  day's workout a user sees.
- CORS is intentionally permissive (`origin: true, credentials: true`) because the app
  is VPN-gated. Don't "harden" it without understanding the deployment.

## Safety for agents

- Never commit `.env` or anything under `data/` (the live SQLite DB).
- Don't run destructive DB operations against `data/workout.db` — it's real user data.
- Commit/push only when asked. Match existing code style; this is a small, plain
  JS codebase with no build-time type checking, so read neighboring code before editing.
