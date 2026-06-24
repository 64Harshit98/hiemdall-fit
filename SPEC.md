# Heimdall · Fit — Specification

A self-hosted workout plan generator and tracker. An LLM produces a personalized
weekly plan; the app surfaces only *today's* workout, logs each set, captures session
stats, and adapts the plan weekly. Designed to run on a single Raspberry Pi behind
Tailscale/LAN — single-tenant-feel multi-user, no public exposure, no TLS in scope.

> Agent quick-start lives in [CLAUDE.md](CLAUDE.md). This document is the product +
> technical reference.

---

## 1. Goals & non-goals

**Goals**
- Generate a science-based weekly plan from a user profile (goal, experience,
  equipment, schedule, injuries, split preference, side activities).
- Reduce decision fatigue: show one day at a time, log sets inline, auto-advance.
- Adapt over time using logged performance, periodic reports, and unfinished work.
- Run cheaply and privately on home hardware.

**Non-goals**
- Public SaaS, billing, TLS termination, horizontal scaling.
- Native mobile apps (it's a responsive web app reached over VPN).
- Real-time coaching or video.

---

## 2. Architecture

```
Browser (React/Vite SPA)
   │  fetch /api/*  (httpOnly JWT cookie)
   ▼
nginx (frontend container)  ──proxy /api──►  Express (backend container, :3001)
                                                │
                                                ├─ better-sqlite3  → /data/workout.db (WAL)
                                                ├─ services/llm.js → Groq / Gemini / OpenRouter
                                                └─ services/cron.js → weekly adaptation
```

- **Backend**: Node 20 ESM + Express. Synchronous SQLite via `better-sqlite3`.
  Entry `backend/src/server.js` mounts routers under `/api/*` and starts the cron.
- **Frontend**: React 18 + react-router-dom v6, built by Vite, served by nginx which
  also reverse-proxies `/api` to the backend. API base is `/api` (`frontend/src/lib/api.js`).
- **Persistence**: a single SQLite file at `DB_PATH` (`/data/workout.db` in Docker),
  schema and migrations defined in `backend/src/db/index.js`.

---

## 3. Data model

Defined in `backend/src/db/index.js` (idempotent `CREATE TABLE IF NOT EXISTS` +
guarded `ALTER TABLE` migrations). The DB is long-lived; migrations must never drop data.

| Table | Purpose | Key columns |
|---|---|---|
| `users` | accounts + approval gate | `username` (unique), `password_hash`, `status` (`pending`/`approved`/`rejected`), `is_admin` |
| `profiles` | one per user, drives plan generation | `age,height,weight,experience,goal`, `days_per_week_min/max`, `session_duration_minutes`, `injuries` (free text), `equipment_json`, `preferences_json`, `additional_activities`, `split_preference`, `include_mobility` |
| `plans` | generated weekly plans (JSON blob) | `plan_json`, `week_start`, `current_day_index`, `is_active` (only one active per user) |
| `workout_logs` | one row per logged set | `plan_id,day_index,exercise_name,set_index,weight,reps,notes,session_date` |
| `session_stats` | per-session HR/calories/duration | `session_date`, `heart_rate_avg/max`, `calories`, `duration_sec`, `source` (`manual`/apple health) |
| `day_completions` | marks a plan day done | unique `(plan_id, day_index)` |
| `reports` | saved LLM analyses (JSON blob) | `report_json`, `date_range`, `user_note`, `is_saved` |

**Legacy/migration notes**: `profiles.days_per_week` is legacy, backfilled into
`days_per_week_min/max`. `users.status`/`is_admin` were added later; pre-existing
users were backfilled to `approved`. The admin account is seeded/promoted from
`ADMIN_USERNAME`/`ADMIN_PASSWORD` on startup.

---

## 4. Plan JSON shape

Stored in `plans.plan_json`, produced by the LLM, validated in `llm.js` before persist.

```jsonc
{
  "week_summary": "string — names the split, how injuries/activities/reports were handled",
  "days": [
    {
      "day_index": 0,
      "name": "Full Body A | Rest | ...",
      "is_rest": false,
      "exercises": [
        {
          "name": "string",
          "sets": 3,
          "reps": "8-10",
          "target_weight": "60kg | bodyweight | RPE 8",
          "rest_seconds": 90,
          "form_tip": "one sentence",
          "alternate_exercise": { "name": "string", "note": "why you'd swap" }
        }
      ]
    }
    // always exactly 7 days (day_index 0..6); training + rest = 7
  ],
  "_rest_undo": { /* internal: stashed exercises when a day is converted to rest */ }
}
```

---

## 5. Core flows

### 5.1 Onboarding → first plan
1. User registers → `status='pending'` (admin must approve; seeded admin is auto-approved).
2. On first login with no profile, the SPA routes to `/onboarding`.
3. `PUT /api/profile` saves the profile.
4. `POST /api/plans/generate` calls `generatePlan` → LLM → validated plan → stored
   `is_active=1`, `current_day_index=0`.

### 5.2 Daily use (`Today.jsx`)
- `GET /api/plans/current` returns the day at `current_day_index` (or `?day=N` to
  preview/review another day), its logs, and today's session stats.
- Each set is logged via `POST /api/logs/set`. Session stats via
  `POST /api/logs/session-stats` or an Apple Health XML upload to
  `POST /api/logs/apple-health` (parsed in `services/appleHealth.js`).
- Completing a day advances `current_day_index` (`POST /api/plans/advance`).
- Day-level actions: `mark-rest` / `unmark-rest`, `swap-exercise`, `skip-exercise`,
  and `convert-to-workout` (turns a rest day into an LLM-generated mobility session).

### 5.3 Reports (`reports.js`, `ReportView.jsx`)
- `POST /api/reports/generate` analyzes a date range of logs via `REPORT_SYSTEM_PROMPT`
  → JSON report (summary, metrics, strengths, concerns, trends, recommendations).
- Reports can be saved (`is_saved=1`); the latest saved report feeds the weekly cron.

### 5.4 Weekly adaptation (`services/cron.js`)
- Schedule: **`0 4 * * 1` → Monday 04:00 local** (`TZ`). *(README's "Sun 22:00" is stale.)*
- For each user with a profile and ≥1 log in the last 7 days:
  - Gathers `profile`, last 7 days of `recent_logs`, last 5 `plan_history` summaries,
    the latest saved report, and `carry_forward` (unfinished exercises from the
    active plan).
  - Calls `generatePlan(... mode:'weekly_adapt')`. The LLM owns the whole week:
    it schedules carry-forward work into a balanced 7-day plan itself.
  - Deactivates the old plan (`is_active=0`) and inserts the new active plan.
- Users with no logs that week are skipped (plan carries over).

---

## 6. API surface (all under `/api`, `requireAuth` unless noted)

| Method & path | Notes |
|---|---|
| `GET /health` | public liveness |
| `POST /auth/register` | public; creates pending user |
| `POST /auth/login` `POST /auth/logout` | public; sets/clears JWT cookie |
| `GET /auth/me` | current user |
| `GET /profile` `PUT /profile` | read/upsert profile |
| `POST /plans/generate` | generate initial/active plan |
| `GET /plans/current` | today's (or `?day=N`) view + logs + stats |
| `POST /plans/advance` | advance current day |
| `POST /plans/mark-rest` `/unmark-rest` | toggle a day to rest (stashes exercises) |
| `POST /plans/swap-exercise` `/skip-exercise` | edit a day's exercises |
| `POST /plans/convert-to-workout` | rest day → LLM mobility session |
| `GET /plans/history` `GET /plans/:id` | past plans |
| `POST /logs/set` | log one set |
| `POST /logs/session-stats` | manual session stats |
| `POST /logs/apple-health` | multipart XML upload, parsed server-side |
| `GET /logs/day` `GET /logs/history` | read logs |
| `POST /reports/generate` `GET /reports` | analyses |
| `POST /reports/:id/save` `DELETE /reports/:id` | manage saved reports |
| `GET /admin/users` | admin only |
| `POST /admin/users/:id/approve` `/reject` `DELETE /admin/users/:id` | admin only |

---

## 7. LLM integration (`backend/src/services/llm.js`)

- Provider chosen by `LLM_PROVIDER` (`groq` default, `gemini`, `openrouter`). One
  `callProvider(systemPrompt, userJson)` abstraction; each provider is invoked in
  JSON mode and the response is parsed + validated before use.
- Three system prompts: `PLAN_SYSTEM_PROMPT`, `MOBILITY_SYSTEM_PROMPT`,
  `REPORT_SYSTEM_PROMPT`. Output is **strict JSON, no prose/markdown**.
- The user message is the profile + context serialized to JSON (`buildPlanPrompt`).
  Profile constraints the model must honor: **injuries/limitations (highest
  priority)**, available `equipment`, liked/disliked exercises (`preferences`),
  `split_preference`, `session_duration_minutes`, `days_per_week_min/max`,
  `additional_activities`, and `include_mobility`.
- **When changing output shape**: update the corresponding `validate*` function in
  `llm.js` and every frontend consumer (`Today.jsx`, `ReportView.jsx`).

---

## 8. Auth & access control

- Passwords hashed with bcrypt (cost 12). JWT stored in an httpOnly cookie;
  `requireAuth` (`middleware/auth.js`) verifies it and sets `req.user`.
- Sign-up is gated: new users are `pending` and cannot use the app until an admin
  approves them. The env-seeded admin bypasses the queue and can approve/reject/delete.
- CORS is intentionally permissive (`origin: true, credentials: true`) — the app is
  only reachable over a private network.

---

## 9. Configuration (env)

| Var | Purpose |
|---|---|
| `JWT_SECRET` | JWT signing secret (set to a long random string) |
| `GROQ_API_KEY` | Groq key (default provider) |
| `LLM_PROVIDER` | `groq` \| `gemini` \| `openrouter` |
| `GEMINI_API_KEY` / `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | alternate providers |
| `TZ` | controls cron firing **and** all "today" date math |
| `DB_PATH` | SQLite file path (`/data/workout.db` in Docker) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | seeded admin account |
| `PORT` | backend port (default 3001) |

---

## 10. Deployment

- `docker compose up -d --build` → two containers:
  - `backend` on `:3001`, mounts `./data` → `/data`.
  - `frontend` (nginx) published on host **`:8090`** → container `:80`, proxies `/api`.
- Single Pi, behind Tailscale. Backups = copy `data/workout.db` (+ WAL).

---

## 11. Known doc drift / gotchas

- Cron is **Monday 04:00** (code), not Sun 22:00 (README).
- Frontend host port is **8090** (compose), not 8080 (README).
- No tests / linters / typecheck — verify by running the app.
- `injuries` is free text interpreted entirely by the LLM; precise phrasing changes
  how well it's respected. The plan prompt treats it as the highest-priority constraint.
