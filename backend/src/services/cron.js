import cron from 'node-cron';
import db from '../db/index.js';
import { generatePlan } from './llm.js';

/**
 * Weekly cron: every Sunday at 22:00 in the container's TZ.
 * For each user with an active plan, generate next week's plan
 * informed by the last 7 days of logs.
 */
export function startWeeklyCron() {
  // sec? no — node-cron uses 5-field by default: min hour day month dow
  cron.schedule('0 22 * * 0', async () => {
    console.log('[cron] Weekly plan adaptation starting');
    const users = db.prepare(`
      SELECT DISTINCT u.id FROM users u
      INNER JOIN profiles p ON p.user_id = u.id
    `).all();

    for (const { id: userId } of users) {
      try {
        const profileRow = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
        if (!profileRow) continue;

        const profile = {
          age: profileRow.age,
          height: profileRow.height,
          weight: profileRow.weight,
          experience: profileRow.experience,
          goal: profileRow.goal,
          days_per_week: profileRow.days_per_week,
          days_per_week_min: profileRow.days_per_week_min ?? profileRow.days_per_week,
          days_per_week_max: profileRow.days_per_week_max ?? profileRow.days_per_week,
          session_duration_minutes: profileRow.session_duration_minutes ?? 60,
          injuries: profileRow.injuries,
          equipment: JSON.parse(profileRow.equipment_json || '[]'),
          preferences: JSON.parse(profileRow.preferences_json || '{}'),
          additional_activities: profileRow.additional_activities || '',
        };

        const recent_logs = db.prepare(`
          SELECT exercise_name, set_index, weight, reps, notes, session_date
          FROM workout_logs
          WHERE user_id = ? AND completed_at >= datetime('now', '-7 days')
          ORDER BY completed_at
        `).all(userId);

        if (recent_logs.length === 0) {
          console.log(`[cron] user ${userId}: no logs this week, skipping adaptation`);
          continue;
        }

        const plan_history = db.prepare(`
          SELECT week_start, plan_json FROM plans
          WHERE user_id = ? AND is_active = 0
          ORDER BY id DESC LIMIT 5
        `).all(userId).map(r => {
          const p = JSON.parse(r.plan_json);
          return { week_start: r.week_start, week_summary: p.week_summary };
        });

        const plan = await generatePlan({ profile, recent_logs, plan_history, mode: 'weekly_adapt' });

        db.prepare('UPDATE plans SET is_active = 0 WHERE user_id = ? AND is_active = 1').run(userId);

        const today = new Date();
        const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        db.prepare(`
          INSERT INTO plans (user_id, week_start, plan_json, current_day_index, is_active)
          VALUES (?, ?, ?, 0, 1)
        `).run(userId, ymd, JSON.stringify(plan));

        console.log(`[cron] user ${userId}: new plan generated`);
      } catch (e) {
        console.error(`[cron] user ${userId} failed:`, e.message);
      }
    }

    console.log('[cron] Weekly plan adaptation complete');
  });

  console.log('[cron] Weekly adaptation scheduled: Sundays 22:00');
}
