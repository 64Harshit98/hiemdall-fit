import cron from 'node-cron';
import db from '../db/index.js';
import { generatePlan } from './llm.js';

/**
 * Compute the WHOLE DAYS that were not fully completed in a plan, so they can be
 * carried forward as their own day(s) (a "stack") rather than merged onto one day.
 *
 * Returns an array of day objects shaped like plan days, in day order:
 *   { name, is_rest:false, exercises:[...remaining], carried_over:true }
 * For each non-rest day we keep only the exercises with sets still owing
 * (prescribed sets minus logged sets). Days fully completed are dropped. Also
 * appends any whole days already stashed in _carryover_days (rolled over from a
 * previous reset or a smart-shifted rest day), plus a back-compat wrap of any
 * legacy loose _carryover exercises into a single carried day.
 */
function getUnfinishedDays(planId, parsed) {
  const days = [];

  for (const day of parsed.days || []) {
    if (day.is_rest || !Array.isArray(day.exercises)) continue;
    const remainingExercises = [];
    for (const ex of day.exercises) {
      if (ex.skipped) continue; // user chose to skip — don't carry it forward
      const { count } = db.prepare(`
        SELECT COUNT(*) AS count FROM workout_logs
        WHERE plan_id = ? AND day_index = ? AND exercise_name = ?
      `).get(planId, day.day_index, ex.name);
      const remaining = (ex.sets || 0) - count;
      if (remaining > 0) {
        remainingExercises.push({ ...ex, sets: remaining, carried_over: true });
      }
    }
    if (remainingExercises.length) {
      days.push({ name: day.name, is_rest: false, exercises: remainingExercises, carried_over: true });
    }
  }

  // Whole days rolled over from a previous reset / smart-shifted rest day.
  for (const d of parsed._carryover_days || []) {
    days.push({ name: d.name, is_rest: false, exercises: d.exercises, carried_over: true });
  }

  // Back-compat: legacy loose-exercise carryover → wrap into one carried day.
  if (Array.isArray(parsed._carryover) && parsed._carryover.length) {
    days.push({
      name: 'Carried over',
      is_rest: false,
      exercises: parsed._carryover.map(ex => ({ ...ex, carried_over: true })),
      carried_over: true,
    });
  }

  return days;
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

        // Capture the outgoing plan so we can carry forward unfinished WHOLE DAYS.
        const outgoing = db.prepare(`
          SELECT id, plan_json FROM plans
          WHERE user_id = ? AND is_active = 1
          ORDER BY id DESC LIMIT 1
        `).get(userId);
        const carriedDays = outgoing
          ? getUnfinishedDays(outgoing.id, JSON.parse(outgoing.plan_json))
          : [];

        // Inform the LLM of the carried volume so the new week adapts (and does
        // not re-program the same exercises that we'll prepend as whole days).
        const carry_forward = carriedDays.length
          ? carriedDays.flatMap(d => d.exercises.map(e => ({ name: e.name, sets: e.sets, reps: e.reps })))
          : null;

        // If carried-over work already fills (or overflows) the whole week, the
        // generated plan would be entirely discarded — skip the LLM call.
        const plan = carriedDays.length >= 7
          ? { week_summary: 'Catching up on carried-over work from last week.', days: [] }
          : await generatePlan({ profile, recent_logs, plan_history, latest_report, carry_forward, mode: 'weekly_adapt' });

        // Stack: prepend carried days, shift the generated week back, keep 7 days.
        const combined = [...carriedDays, ...plan.days];
        plan.days = combined.slice(0, 7).map((d, i) => ({ ...d, day_index: i }));

        // FIFO roll-over: only genuinely-unfinished days that overflow past day 7
        // roll to the next reset (the bumped-off fresh tail is regenerated then).
        // Merge with any days enforceSessionCount already stashed on the new plan.
        const overflowCarried = combined.slice(7).filter(d => d.carried_over);
        const rolled = [...(plan._carryover_days || []), ...overflowCarried]
          .map(({ day_index, ...d }) => d);
        if (rolled.length) plan._carryover_days = rolled;
        else delete plan._carryover_days;

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
