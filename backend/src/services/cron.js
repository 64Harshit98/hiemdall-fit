import cron from 'node-cron';
import db from '../db/index.js';
import { generatePlan } from './llm.js';

/**
 * Compute the flat, deduped list of exercises the user still OWES from the
 * outgoing plan — the work to fold into next week. The LLM receives this and
 * schedules it into a balanced week itself (it owns the day/rest layout), so we
 * no longer manipulate days mechanically here.
 *
 * For each non-rest day we count logged sets and keep the shortfall; skipped
 * exercises are ignored. We also fold in any exercises stashed in _carryover_days
 * (rest-day overflow / session-cap) and legacy loose _carryover. Deduped by name,
 * keeping the larger remaining set count.
 */
function getCarryForwardExercises(planId, parsed) {
  const byName = new Map();
  const add = (ex, sets) => {
    if (!ex?.name || !(sets > 0)) return;
    const existing = byName.get(ex.name);
    if (!existing || sets > existing.sets) {
      byName.set(ex.name, { name: ex.name, sets, reps: ex.reps, target_weight: ex.target_weight });
    }
  };

  for (const day of parsed.days || []) {
    if (day.is_rest || !Array.isArray(day.exercises)) continue;
    for (const ex of day.exercises) {
      if (ex.skipped) continue; // user chose to skip — don't carry it forward
      const { count } = db.prepare(`
        SELECT COUNT(*) AS count FROM workout_logs
        WHERE plan_id = ? AND day_index = ? AND exercise_name = ?
      `).get(planId, day.day_index, ex.name);
      add(ex, (ex.sets || 0) - count);
    }
  }

  // Exercises stashed as whole days (rest-day overflow / session-cap) and legacy.
  for (const d of parsed._carryover_days || []) {
    for (const ex of d.exercises || []) add(ex, ex.sets || 0);
  }
  for (const ex of parsed._carryover || []) add(ex, ex.sets || 0);

  return [...byName.values()];
}

/**
 * Weekly cron: every Monday at 04:00 in the container's TZ.
 * For each user with an active plan, generate next week's plan
 * informed by the last 7 days of logs, and strict-add any exercises
 * left unfinished in the previous week.
 */
export function startWeeklyCron() {
  // node-cron uses 5-field by default: min hour day month dow (1 = Monday)
  cron.schedule('0 4 * * 1', async () => {
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
          split_preference: profileRow.split_preference || '',
          include_mobility: !!profileRow.include_mobility,
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

        const latestReportRow = db.prepare(`
          SELECT report_json, user_note, date_range, created_at
          FROM reports WHERE user_id = ? AND is_saved = 1
          ORDER BY id DESC LIMIT 1
        `).get(userId);
        const latest_report = latestReportRow ? (() => {
          const r = JSON.parse(latestReportRow.report_json);
          return { date_range: latestReportRow.date_range, created_at: latestReportRow.created_at, user_note: latestReportRow.user_note || null, summary: r.summary, concerns: r.concerns, recommendations: r.recommendations };
        })() : null;

        // Capture the outgoing plan so we can fold unfinished work into next week.
        const outgoing = db.prepare(`
          SELECT id, plan_json FROM plans
          WHERE user_id = ? AND is_active = 1
          ORDER BY id DESC LIMIT 1
        `).get(userId);
        const carryList = outgoing
          ? getCarryForwardExercises(outgoing.id, JSON.parse(outgoing.plan_json))
          : [];
        const carry_forward = carryList.length ? carryList : null;

        // The LLM owns the whole week: it schedules carry_forward into a balanced
        // 7-day plan itself (correct training/rest days, no duplication). We do not
        // manipulate days mechanically anymore.
        const plan = await generatePlan({ profile, recent_logs, plan_history, latest_report, carry_forward, mode: 'weekly_adapt' });

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

  console.log('[cron] Weekly adaptation scheduled: Mondays 04:00');
}
