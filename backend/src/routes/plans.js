import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { generatePlan } from '../services/llm.js';

const router = Router();

function getProfile(userId) {
  const row = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  if (!row) return null;
  return {
    age: row.age,
    height: row.height,
    weight: row.weight,
    experience: row.experience,
    goal: row.goal,
    days_per_week: row.days_per_week,
    injuries: row.injuries,
    equipment: JSON.parse(row.equipment_json || '[]'),
    preferences: JSON.parse(row.preferences_json || '{}'),
  };
}

function getRecentLogs(userId, days = 7) {
  return db.prepare(`
    SELECT exercise_name, set_index, weight, reps, notes, session_date, completed_at
    FROM workout_logs
    WHERE user_id = ?
      AND completed_at >= datetime('now', ?)
    ORDER BY completed_at DESC
  `).all(userId, `-${days} days`);
}

function deactivateOldPlans(userId) {
  db.prepare('UPDATE plans SET is_active = 0 WHERE user_id = ? AND is_active = 1').run(userId);
}

function todayYmd() {
  // YYYY-MM-DD using the server's local time (container TZ is set in compose)
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Generate initial plan or regenerate. */
router.post('/generate', requireAuth, async (req, res) => {
  const profile = getProfile(req.user.id);
  if (!profile) return res.status(400).json({ error: 'complete your profile first' });

  const mode = req.body?.mode || 'initial';
  const recent_logs = mode === 'regenerate' ? getRecentLogs(req.user.id, 14) : null;

  try {
    const plan = await generatePlan({ profile, recent_logs, mode });

    deactivateOldPlans(req.user.id);
    const result = db.prepare(`
      INSERT INTO plans (user_id, week_start, plan_json, current_day_index, is_active)
      VALUES (?, ?, ?, 0, 1)
    `).run(req.user.id, todayYmd(), JSON.stringify(plan));

    res.json({ id: result.lastInsertRowid, plan });
  } catch (e) {
    console.error('Plan generation failed:', e);
    res.status(502).json({ error: 'plan generation failed', detail: e.message });
  }
});

/** Get active plan and today's day. */
router.get('/current', requireAuth, (req, res) => {
  const plan = db.prepare(`
    SELECT id, week_start, plan_json, current_day_index, generated_at
    FROM plans WHERE user_id = ? AND is_active = 1
    ORDER BY id DESC LIMIT 1
  `).get(req.user.id);

  if (!plan) return res.json(null);

  const parsed = JSON.parse(plan.plan_json);
  const today = parsed.days[plan.current_day_index];

  // Logs for today's exercises (this plan, this day_index)
  const logs = db.prepare(`
    SELECT exercise_name, set_index, weight, reps, notes, completed_at
    FROM workout_logs
    WHERE plan_id = ? AND day_index = ?
    ORDER BY exercise_name, set_index
  `).all(plan.id, plan.current_day_index);

  // Session stats for today's date
  const stats = db.prepare(`
    SELECT * FROM session_stats
    WHERE user_id = ? AND session_date = ?
    ORDER BY id DESC LIMIT 1
  `).get(req.user.id, todayYmd());

  res.json({
    plan_id: plan.id,
    week_start: plan.week_start,
    week_summary: parsed.week_summary,
    current_day_index: plan.current_day_index,
    total_days: parsed.days.length,
    today,
    logs,
    stats: stats || null,
  });
});

/** Advance to next day (manual override OR called automatically when day complete). */
router.post('/advance', requireAuth, (req, res) => {
  const plan = db.prepare(`
    SELECT id, plan_json, current_day_index FROM plans
    WHERE user_id = ? AND is_active = 1
    ORDER BY id DESC LIMIT 1
  `).get(req.user.id);
  if (!plan) return res.status(404).json({ error: 'no active plan' });

  const parsed = JSON.parse(plan.plan_json);
  const next = plan.current_day_index + 1;

  if (next >= parsed.days.length) {
    // End of week — keep on last day; weekly cron will regenerate
    return res.json({ at_end_of_week: true, current_day_index: plan.current_day_index });
  }

  db.prepare('UPDATE plans SET current_day_index = ? WHERE id = ?').run(next, plan.id);

  // Mark previous day as completed
  try {
    db.prepare(`
      INSERT OR IGNORE INTO day_completions (user_id, plan_id, day_index)
      VALUES (?, ?, ?)
    `).run(req.user.id, plan.id, plan.current_day_index);
  } catch {}

  res.json({ current_day_index: next });
});

/** History: list past plans and weekly summaries. */
router.get('/history', requireAuth, (req, res) => {
  const plans = db.prepare(`
    SELECT id, week_start, generated_at, current_day_index, is_active
    FROM plans WHERE user_id = ?
    ORDER BY id DESC LIMIT 20
  `).all(req.user.id);

  res.json(plans);
});

router.get('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM plans WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ ...row, plan: JSON.parse(row.plan_json) });
});

export default router;
