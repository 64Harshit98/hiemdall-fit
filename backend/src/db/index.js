import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || './workout.db';

// Ensure directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema — idempotent CREATE IF NOT EXISTS
const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age INTEGER,
  height REAL,
  weight REAL,
  experience TEXT,
  goal TEXT,
  days_per_week INTEGER,
  injuries TEXT,
  equipment_json TEXT,
  preferences_json TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  generated_at TEXT DEFAULT (datetime('now')),
  current_day_index INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_plans_user ON plans(user_id, is_active);

CREATE TABLE IF NOT EXISTS workout_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  day_index INTEGER NOT NULL,
  exercise_name TEXT NOT NULL,
  set_index INTEGER NOT NULL,
  weight REAL,
  reps INTEGER,
  notes TEXT,
  completed_at TEXT DEFAULT (datetime('now')),
  session_date TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_user_date ON workout_logs(user_id, session_date);
CREATE INDEX IF NOT EXISTS idx_logs_plan_day ON workout_logs(plan_id, day_index);

CREATE TABLE IF NOT EXISTS session_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  heart_rate_avg INTEGER,
  heart_rate_max INTEGER,
  calories INTEGER,
  duration_sec INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stats_user_date ON session_stats(user_id, session_date);

CREATE TABLE IF NOT EXISTS day_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  day_index INTEGER NOT NULL,
  completed_at TEXT DEFAULT (datetime('now')),
  UNIQUE(plan_id, day_index)
);
`;

db.exec(schema);

export default db;
