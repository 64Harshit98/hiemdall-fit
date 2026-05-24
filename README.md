# Heimdall · Fit

A self-hosted workout plan generator and tracker. Designed to run on a Raspberry Pi 5 alongside the rest of your Heimdall stack, reached over your existing Tailscale VPN.

The app asks the LLM for a personalized weekly plan, shows you only today's workout, lets you log each set as you go, captures session stats (manual or from an Apple Health export), and adapts the plan weekly based on your recent logs.

## Stack

- **Frontend** — React + Vite, served by nginx
- **Backend** — Node 20 + Express, better-sqlite3 (file-based SQLite, WAL mode)
- **LLM** — Groq (`llama-3.3-70b-versatile`) by default; Gemini and OpenRouter wired up as drop-in alternatives
- **Auth** — bcrypt password hashes + JWT in an httpOnly cookie
- **Cron** — `node-cron` runs inside the backend container; weekly adaptation Sun 22:00 local time

## LLM choice

After comparing free-tier options:

| Provider | Free tier | Native JSON | Latency | JSON reliability |
|---|---|---|---|---|
| **Groq** (llama-3.3-70b) | 14,400 req/day | `response_format: json_object` | ~0.5–1s | Very high |
| Gemini Flash | 1,500 req/day | `responseMimeType` | ~1–2s | High |
| OpenRouter (free models) | varies, often throttled | variable | 2–5s | Inconsistent |

**Groq won** on speed, daily quota, and JSON-mode reliability. The "Regenerate plan" button feels instant, which matters because the user might iterate.

To swap providers later, set `LLM_PROVIDER=gemini` (and provide `GEMINI_API_KEY`) or `LLM_PROVIDER=openrouter` in `.env`. The provider abstraction is in `backend/src/services/llm.js`.

## First-time setup

1. Get a Groq API key from https://console.groq.com (free, no card).
2. Clone this directory onto the Pi.
3. Copy and fill the env file:

   ```bash
   cp .env.example .env
   nano .env
   ```

   Set at minimum:
   - `JWT_SECRET` — long random string (e.g. `openssl rand -hex 32`)
   - `GROQ_API_KEY` — your Groq key
   - `TZ` — your timezone (default `Asia/Kolkata`) — this controls cron and "today" date math

4. Start the stack:

   ```bash
   docker compose up -d --build
   ```

5. Open `http://<pi-tailscale-ip>:8080` from any device on your Tailnet. Register, fill the onboarding form, and you'll get your first plan in ~5 seconds.

## Ports

- `8080` → frontend (nginx, also proxies `/api` to the backend)
- `3001` → backend API (exposed for direct debugging; you can remove this mapping in `docker-compose.yml` if you only want LAN access through the frontend)

Both bind to `0.0.0.0` inside the Pi. Since you're behind Tailscale, no public exposure, no TLS in scope.

## Data and backups

SQLite lives at `./data/workout.db` on the host (bind-mounted into the backend container at `/data`).

Quick backup:

```bash
# Hot copy — WAL mode makes this safe
cp ./data/workout.db ./data/workout.db.$(date +%F).bak
```

Better — checkpoint first to fold the WAL into the main file:

```bash
docker exec workout-backend sh -c "sqlite3 /data/workout.db 'PRAGMA wal_checkpoint(TRUNCATE);'"
cp ./data/workout.db /path/to/backup/location/
```

You could drop this into a cron job on the Pi that rsyncs into the Synology NAS once it's online.

## Operating notes

- **Adding a user:** they just register on the login screen. Each user's data is isolated (`user_id` FK on every table).
- **Apple Health upload:** export from the iPhone Health app → Share → "Export All Health Data" → unzip → upload `export.xml`. The parser also accepts a CSV with `type,startDate,value` columns if you prefer to pre-filter.
- **Weekly adaptation:** runs Sun 22:00 in the container TZ. Looks at the last 7 days of logs, asks the LLM to bump load on lifts you nailed, deload lifts where you missed reps, and swap exercises you flagged as painful in notes.
- **Manual override:** "Regenerate plan" on the Today screen runs the same logic on demand, useful mid-week if something changes.

## Updating

```bash
git pull
docker compose up -d --build
```

The schema uses `CREATE TABLE IF NOT EXISTS` for all tables, so adding a column later means writing a migration in `backend/src/db/index.js` — guard it with a `PRAGMA table_info` check before running.

## Project structure

```
.
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── server.js
│       ├── db/index.js               # SQLite schema + connection
│       ├── middleware/auth.js        # JWT
│       ├── routes/{auth,profile,plans,logs}.js
│       └── services/
│           ├── llm.js                # Groq/Gemini/OpenRouter abstraction
│           ├── appleHealth.js        # XML+CSV parser
│           └── cron.js               # Weekly adaptation
└── frontend/
    ├── Dockerfile
    ├── nginx.conf                    # /api → backend
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── App.jsx                   # Routes + auth gate
        ├── lib/api.js                # Fetch wrapper
        ├── pages/{Login,Onboarding,Today,History,Profile}.jsx
        └── components/{ExerciseRow,SessionStatsPanel}.jsx
```

## Out of scope (per spec)

- HTTPS / public domain — Tailscale handles this
- Direct HealthKit integration — manual + file upload only
- Native mobile app — responsive web only
