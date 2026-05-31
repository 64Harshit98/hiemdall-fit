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
    days_per_week_min: row.days_per_week_min ?? row.days_per_week,
    days_per_week_max: row.days_per_week_max ?? row.days_per_week,
    session_duration_minutes: row.session_duration_minutes ?? 60,
    injuries: row.injuries,
    equipment: JSON.parse(row.equipment_json || '[]'),
    preferences: JSON.parse(row.preferences_json || '{}'),
    additional_activities: row.additional_activities || '',
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

function getPlanHistory(userId, limit = 5) {
  const rows = db.prepare(`
    SELECT week_start, plan_json FROM plans
    WHERE user_id = ? AND is_active = 0
    ORDER BY id DESC LIMIT ?
  `).all(userId, limit);
  return rows.map(r => {
    const p = JSON.parse(r.plan_json);
    return { week_start: r.week_start, week_summary: p.week_summary };
  });
}

function getLatestSavedReport(userId) {
  const row = db.prepare(`
    SELECT report_json, user_note, date_range, created_at
    FROM reports WHERE user_id = ? AND is_saved = 1
    ORDER BY id DESC LIMIT 1
  `).get(userId);
  if (!row) return null;
  const r = JSON.parse(row.report_json);
  return {
    date_range: row.date_range,
    created_at: row.created_at,
    user_note: row.user_note || null,
    summary: r.summary,
    concerns: r.concerns,
    recommendations: r.recommendations,
  };
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
  const withHistory = mode !== 'initial';
  const recent_logs = withHistory ? getRecentLogs(req.user.id, 30) : null;
  const plan_history = withHistory ? getPlanHistory(req.user.id) : null;
  const latest_report = withHistory ? getLatestSavedReport(req.user.id) : null;

  try {
    const plan = await generatePlan({ profile, recent_logs, plan_history, latest_report, mode });

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

/** Mark the current training day as a rest day and advance. */
router.post('/mark-rest', requireAuth, (req, res) => {
  const plan = db.prepare(`
    SELECT id, plan_json, current_day_index FROM plans
    WHERE user_id = ? AND is_active = 1
    ORDER BY id DESC LIMIT 1
  `).get(req.user.id);
  if (!plan) return res.status(404).json({ error: 'no active plan' });

  const parsed = JSON.parse(plan.plan_json);
  const idx = plan.current_day_index;

  // Mutate the day in place
  parsed.days[idx] = { ...parsed.days[idx], is_rest: true, name: 'Rest', exercises: [] };

  const next = idx + 1;
  const atEnd = next >= parsed.days.length;

  db.prepare('UPDATE plans SET plan_json = ?, current_day_index = ? WHERE id = ?')
    .run(JSON.stringify(parsed), atEnd ? idx : next, plan.id);

  try {
    db.prepare(`
      INSERT OR IGNORE INTO day_completions (user_id, plan_id, day_index)
      VALUES (?, ?, ?)
    `).run(req.user.id, plan.id, idx);
  } catch {}

  res.json({ at_end_of_week: atEnd, current_day_index: atEnd ? idx : next });
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
