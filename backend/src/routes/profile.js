import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id);
  if (!row) return res.json(null);
  res.json({
    ...row,
    equipment: JSON.parse(row.equipment_json || '[]'),
    preferences: JSON.parse(row.preferences_json || '{}'),
  });
});

router.put('/', requireAuth, (req, res) => {
  const {
    age, height, weight, experience, goal, days_per_week,
    injuries, equipment, preferences,
  } = req.body || {};

  // Light validation
  if (!age || !height || !weight || !experience || !goal || !days_per_week) {
    return res.status(400).json({ error: 'required fields missing' });
  }
  if (days_per_week < 1 || days_per_week > 7) {
    return res.status(400).json({ error: 'days_per_week must be 1-7' });
  }

  const equipmentJson = JSON.stringify(equipment || []);
  const preferencesJson = JSON.stringify(preferences || {});

  db.prepare(`
    INSERT INTO profiles (user_id, age, height, weight, experience, goal, days_per_week, injuries, equipment_json, preferences_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      age = excluded.age,
      height = excluded.height,
      weight = excluded.weight,
      experience = excluded.experience,
      goal = excluded.goal,
      days_per_week = excluded.days_per_week,
      injuries = excluded.injuries,
      equipment_json = excluded.equipment_json,
      preferences_json = excluded.preferences_json,
      updated_at = datetime('now')
  `).run(req.user.id, age, height, weight, experience, goal, days_per_week, injuries || '', equipmentJson, preferencesJson);

  res.json({ ok: true });
});

export default router;
