import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
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

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_json TEXT NOT NULL,
  date_range TEXT NOT NULL,
  user_note TEXT,
  is_saved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id, is_saved);
`;

db.exec(schema);

// Migrations — idempotent via PRAGMA table_info checks
const profileCols = db.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);

if (!profileCols.includes('days_per_week_min')) {
  db.exec('ALTER TABLE profiles ADD COLUMN days_per_week_min INTEGER');
}
if (!profileCols.includes('days_per_week_max')) {
  db.exec('ALTER TABLE profiles ADD COLUMN days_per_week_max INTEGER');
}
if (!profileCols.includes('additional_activities')) {
  db.exec('ALTER TABLE profiles ADD COLUMN additional_activities TEXT');
}
if (!profileCols.includes('session_duration_minutes')) {
  db.exec('ALTER TABLE profiles ADD COLUMN session_duration_minutes INTEGER');
}
if (!profileCols.includes('split_preference')) {
  db.exec('ALTER TABLE profiles ADD COLUMN split_preference TEXT');
}
if (!profileCols.includes('include_mobility')) {
  db.exec('ALTER TABLE profiles ADD COLUMN include_mobility INTEGER DEFAULT 0');
}

// Backfill min/max from the legacy days_per_week for existing rows
db.prepare(`
  UPDATE profiles
  SET days_per_week_min = days_per_week, days_per_week_max = days_per_week
  WHERE days_per_week IS NOT NULL
    AND (days_per_week_min IS NULL OR days_per_week_max IS NULL)
`).run();

// User approval gate: status ('pending' | 'approved' | 'rejected') + admin flag.
const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userCols.includes('status')) {
  // Added without a DEFAULT so existing rows are NULL → backfilled to 'approved'
  // below (they were already using the app and must not be locked out).
  db.exec('ALTER TABLE users ADD COLUMN status TEXT');
  db.exec("UPDATE users SET status = 'approved' WHERE status IS NULL");
}
if (!userCols.includes('is_admin')) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0');
}

// Seed / promote the admin account from env. The admin is always approved and
// can sign in without going through the approval queue.
const adminUser = process.env.ADMIN_USERNAME;
const adminPass = process.env.ADMIN_PASSWORD;
if (adminUser && adminPass) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUser);
  if (!existing) {
    const hash = bcrypt.hashSync(adminPass, 12);
    db.prepare("INSERT INTO users (username, password_hash, status, is_admin) VALUES (?, ?, 'approved', 1)").run(adminUser, hash);
    console.log(`[db] seeded admin user '${adminUser}'`);
  } else {
    db.prepare("UPDATE users SET is_admin = 1, status = 'approved' WHERE username = ?").run(adminUser);
  }
} else {
  console.warn('[db] ADMIN_USERNAME / ADMIN_PASSWORD not set — no admin account seeded');
}

export default db;
