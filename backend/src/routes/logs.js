import { Router } from 'express';
import multer from 'multer';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { extractSessionStats } from '../services/appleHealth.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const router = Router();

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Log a single set. Upserts on (plan_id, day_index, exercise_name, set_index). */
router.post('/set', requireAuth, (req, res) => {
  const { plan_id, day_index, exercise_name, set_index, weight, reps, notes } = req.body || {};
  if (plan_id == null || day_index == null || !exercise_name || set_index == null) {
    return res.status(400).json({ error: 'missing fields' });
  }

  // Verify the plan belongs to this user
  const owns = db.prepare('SELECT id FROM plans WHERE id = ? AND user_id = ?').get(plan_id, req.user.id);
  if (!owns) return res.status(403).json({ error: 'forbidden' });

  // Delete any existing log for this exact set, then insert (simple upsert)
  db.prepare(`
    DELETE FROM workout_logs
    WHERE user_id = ? AND plan_id = ? AND day_index = ? AND exercise_name = ? AND set_index = ?
  `).run(req.user.id, plan_id, day_index, exercise_name, set_index);

  db.prepare(`
    INSERT INTO workout_logs (user_id, plan_id, day_index, exercise_name, set_index, weight, reps, notes, session_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, plan_id, day_index, exercise_name, set_index,
         weight ?? null, reps ?? null, notes || null, todayYmd());

  res.json({ ok: true });
});

/** Manual session stats entry. */
router.post('/session-stats', requireAuth, (req, res) => {
  const { heart_rate_avg, heart_rate_max, calories, duration_sec, session_date } = req.body || {};
  const date = session_date || todayYmd();

  // Replace existing manual entry for this date
  db.prepare(`DELETE FROM session_stats WHERE user_id = ? AND session_date = ? AND source = 'manual'`)
    .run(req.user.id, date);

  db.prepare(`
    INSERT INTO session_stats (user_id, session_date, heart_rate_avg, heart_rate_max, calories, duration_sec, source)
    VALUES (?, ?, ?, ?, ?, ?, 'manual')
  `).run(req.user.id, date, heart_rate_avg ?? null, heart_rate_max ?? null,
         calories ?? null, duration_sec ?? null);

  res.json({ ok: true });
});

/** Apple Health upload. Multipart with `file` field, optional `session_date` form field. */
router.post('/apple-health', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const sessionDate = req.body.session_date || todayYmd();

  try {
    const content = req.file.buffer.toString('utf8');
    const stats = extractSessionStats(content, sessionDate);

    db.prepare(`DELETE FROM session_stats WHERE user_id = ? AND session_date = ? AND source = 'apple_health'`)
      .run(req.user.id, sessionDate);

    db.prepare(`
      INSERT INTO session_stats (user_id, session_date, heart_rate_avg, heart_rate_max, calories, duration_sec, source)
      VALUES (?, ?, ?, ?, ?, ?, 'apple_health')
    `).run(req.user.id, sessionDate, stats.heart_rate_avg, stats.heart_rate_max,
           stats.calories, stats.duration_sec);

    res.json({ ok: true, stats, session_date: sessionDate });
  } catch (e) {
    console.error('Apple Health parse failed:', e);
    res.status(400).json({ error: 'failed to parse file', detail: e.message });
  }
});

/** Get all logs for a given plan_id + day_index. */
router.get('/day', requireAuth, (req, res) => {
  const { plan_id, day_index } = req.query;
  if (!plan_id || day_index == null) return res.status(400).json({ error: 'plan_id and day_index required' });

  const logs = db.prepare(`
    SELECT exercise_name, set_index, weight, reps, notes, completed_at, session_date
    FROM workout_logs
    WHERE user_id = ? AND plan_id = ? AND day_index = ?
    ORDER BY exercise_name, set_index
  `).all(req.user.id, plan_id, day_index);

  res.json(logs);
});

/** Full history: log rows with stats joined by date. */
router.get('/history', requireAuth, (req, res) => {
  const logs = db.prepare(`
    SELECT session_date, exercise_name, set_index, weight, reps, notes, completed_at
    FROM workout_logs WHERE user_id = ?
    ORDER BY completed_at DESC LIMIT 500
  `).all(req.user.id);

  const stats = db.prepare(`
    SELECT session_date, heart_rate_avg, heart_rate_max, calories, duration_sec, source
    FROM session_stats WHERE user_id = ?
    ORDER BY session_date DESC LIMIT 100
  `).all(req.user.id);

  res.json({ logs, stats });
});

export default router;
