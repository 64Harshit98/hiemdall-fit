import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id);
  if (!row) return res.json(null);
  // Normalize legacy rows that only have the old single days_per_week value
  const min = row.days_per_week_min ?? row.days_per_week ?? 3;
  const max = row.days_per_week_max ?? row.days_per_week ?? 5;
  res.json({
    ...row,
    days_per_week_min: min,
    days_per_week_max: max,
    session_duration_minutes: row.session_duration_minutes ?? 60,
    equipment: JSON.parse(row.equipment_json || '[]'),
    preferences: JSON.parse(row.preferences_json || '{}'),
  });
});

router.put('/', requireAuth, (req, res) => {
  const {
    age, height, weight, experience, goal,
    days_per_week_min, days_per_week_max,
    session_duration_minutes,
    injuries, equipment, preferences, additional_activities, split_preference,
  } = req.body || {};

  if (!age || !height || !weight || !experience || !goal || !days_per_week_min || !days_per_week_max) {
    return res.status(400).json({ error: 'required fields missing' });
  }
  const min = Number(days_per_week_min);
  const max = Number(days_per_week_max);
  if (min < 1 || min > 7 || max < 1 || max > 7) {
    return res.status(400).json({ error: 'days_per_week_min and max must be 1-7' });
  }
  if (min > max) {
    return res.status(400).json({ error: 'days_per_week_min must be <= days_per_week_max' });
  }

  const equipmentJson = JSON.stringify(equipment || []);
  const preferencesJson = JSON.stringify(preferences || {});

  db.prepare(`
    INSERT INTO profiles (user_id, age, height, weight, experience, goal, days_per_week, days_per_week_min, days_per_week_max, session_duration_minutes, injuries, equipment_json, preferences_json, additional_activities, split_preference, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      age = excluded.age,
      height = excluded.height,
      weight = excluded.weight,
      experience = excluded.experience,
      goal = excluded.goal,
      days_per_week = excluded.days_per_week,
      days_per_week_min = excluded.days_per_week_min,
      days_per_week_max = excluded.days_per_week_max,
      session_duration_minutes = excluded.session_duration_minutes,
      injuries = excluded.injuries,
      equipment_json = excluded.equipment_json,
      preferences_json = excluded.preferences_json,
      additional_activities = excluded.additional_activities,
      split_preference = excluded.split_preference,
      updated_at = datetime('now')
  `).run(req.user.id, age, height, weight, experience, goal, max, min, max, session_duration_minutes || 60, injuries || '', equipmentJson, preferencesJson, additional_activities || '', split_preference || '');

  res.json({ ok: true });
});

export default router;
