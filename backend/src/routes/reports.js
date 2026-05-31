import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { generateReport } from '../services/llm.js';

const router = Router();

/** Summarise raw logs into per-session per-exercise compact rows for LLM. */
function summariseLogs(rawLogs, rawStats) {
  const sessions = {};
  for (const log of rawLogs) {
    if (!sessions[log.session_date]) sessions[log.session_date] = {};
    const ex = sessions[log.session_date];
    if (!ex[log.exercise_name]) ex[log.exercise_name] = { sets: 0, top_weight: 0, top_reps: 0 };
    ex[log.exercise_name].sets++;
    const w = log.weight || 0;
    if (w >= ex[log.exercise_name].top_weight) {
      ex[log.exercise_name].top_weight = w;
      ex[log.exercise_name].top_reps = log.reps || 0;
    }
  }
  const statsByDate = {};
  for (const s of rawStats) statsByDate[s.session_date] = s;

  return Object.entries(sessions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, exercises]) => ({
      date,
      duration_min: statsByDate[date]?.duration_sec
        ? Math.round(statsByDate[date].duration_sec / 60)
        : null,
      exercises: Object.entries(exercises).map(([name, d]) => ({
        name,
        sets: d.sets,
        best: `${d.top_weight || 'BW'}×${d.top_reps || '?'}`,
      })),
    }));
}

/** POST /api/reports/generate — run LLM analysis, persist as unsaved, return result. */
router.post('/generate', requireAuth, async (req, res) => {
  const { days = 30 } = req.body || {};

  const rawLogs = db.prepare(`
    SELECT exercise_name, weight, reps, session_date
    FROM workout_logs
    WHERE user_id = ? AND session_date >= date('now', ?)
    ORDER BY session_date, exercise_name, set_index
  `).all(req.user.id, `-${days} days`);

  if (rawLogs.length === 0) {
    return res.status(400).json({ error: 'No workout data in this date range' });
  }

  const rawStats = db.prepare(`
    SELECT session_date, duration_sec, calories
    FROM session_stats
    WHERE user_id = ? AND session_date >= date('now', ?)
    ORDER BY session_date
  `).all(req.user.id, `-${days} days`);

  const sessions = summariseLogs(rawLogs, rawStats);

  try {
    const report = await generateReport({ sessions, days });

    // Clean up any previous unsaved drafts, then save the new one
    db.prepare('DELETE FROM reports WHERE user_id = ? AND is_saved = 0').run(req.user.id);
    const result = db.prepare(`
      INSERT INTO reports (user_id, report_json, date_range, is_saved)
      VALUES (?, ?, ?, 0)
    `).run(req.user.id, JSON.stringify(report), `${days}d`);

    res.json({ id: result.lastInsertRowid, report, date_range: `${days}d`, is_saved: false });
  } catch (e) {
    console.error('Report generation failed:', e);
    res.status(502).json({ error: 'report generation failed', detail: e.message });
  }
});

/** GET /api/reports — list all saved snapshots. */
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, date_range, user_note, is_saved, created_at, report_json
    FROM reports WHERE user_id = ? AND is_saved = 1
    ORDER BY id DESC LIMIT 20
  `).all(req.user.id);

  res.json(rows.map(r => ({ ...r, report: JSON.parse(r.report_json) })));
});

/** POST /api/reports/:id/save — save or unsave a report, optionally with a note. */
router.post('/:id/save', requireAuth, (req, res) => {
  const { save = true, note = null } = req.body || {};
  const row = db.prepare('SELECT id FROM reports WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  db.prepare('UPDATE reports SET is_saved = ?, user_note = ? WHERE id = ?')
    .run(save ? 1 : 0, note, req.params.id);

  res.json({ ok: true });
});

/** DELETE /api/reports/:id */
router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM reports WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});

export default router;
