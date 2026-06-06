/**
 * LLM service. Exports: generatePlan(input), generateReport(input).
 * Provider selected via LLM_PROVIDER env var. Default: groq.
 *
 * Chosen default: Groq (llama-3.3-70b-versatile)
 *  - Free tier: 14,400 req/day, plenty of headroom for a single-user workout app
 *  - Native JSON mode via response_format
 *  - Very fast inference (sub-second), good for UX
 *
 * Alternatives:
 *  - gemini: Gemini 1.5 Flash, also has JSON mode (responseMimeType)
 *  - openrouter: free models vary; uses OpenAI-compatible interface
 */

const PROVIDER = (process.env.LLM_PROVIDER || 'groq').toLowerCase();

// ─── Plan system prompt ────────────────────────────────────────────────────────

const PLAN_SYSTEM_PROMPT = `You are an expert strength and conditioning coach.
You generate weekly workout plans as STRICT JSON only. No prose, no markdown, no code fences.

Output schema:
{
  "week_summary": string,
  "days": [
    {
      "day_index": integer (0-based),
      "name": string (descriptive of the day's focus, e.g. "Full Body A", "Upper Body", "Lower Body", "Legs & Core", "Rest"),
      "is_rest": boolean,
      "exercises": [
        {
          "name": string,
          "sets": integer,
          "reps": string (e.g. "8-10" or "5"),
          "target_weight": string (e.g. "60kg" or "bodyweight" or "RPE 8"),
          "rest_seconds": integer,
          "form_tip": string (one short sentence),
          "alternate_exercise": {
            "name": string,
            "note": string (one short sentence — why you'd swap, e.g. "use if no barbell available" or "easier on the lower back")
          }
        }
      ]
    }
  ]
}

Rules:
- The profile contains days_per_week_min and days_per_week_max, which define the user's acceptable range of gym training days. Choose a specific number of training days within this range based on the user's goal, recovery capacity, and additional_activities load. Always output exactly 7 days total (training days + rest days = 7, day_index 0..6).
- split_preference is a free-text field where the user describes the style of training split they prefer (e.g. "push pull legs", "upper/lower", "full body", "bro split — one muscle group per day", "one big + one small muscle group per day", "Arnold split"). When it is non-empty, treat it as the PRIMARY driver of how you structure the week: honour the user's requested split as closely as the chosen number of training days allows, and the week_summary MUST acknowledge the requested style and how you applied it. Only fall back to the frequency-based guidance below when split_preference is empty or cannot be sensibly reconciled with the training frequency (in which case explain the adjustment in the week_summary).
- Training split selection (IMPORTANT — do NOT default to push/pull/legs): when split_preference is empty, choose the weekly split based on the number of training days you selected and the user's goal, NOT a fixed template:
    • 2 training days → full-body each session (e.g. "Full Body A", "Full Body B").
    • 3 training days → full-body (3× full-body is excellent for most goals) OR upper/lower/full depending on goal.
    • 4 training days → upper/lower split (Upper A, Lower A, Upper B, Lower B) is the default; for hypertrophy, a 2-way body-part split is also valid.
    • 5 training days → upper/lower + a third focus day, or a body-part split (e.g. Chest & Triceps, Back & Biceps, Legs, Shoulders & Arms, Lower/Posterior chain). Push/pull/legs + upper/lower is one option among several.
    • 6 training days → push/pull/legs ×2, OR an upper/lower ×3, OR a body-part split. Push/pull/legs is acceptable here but is only ONE valid choice — vary it across weeks.
  Push/pull/legs is appropriate ONLY at 5-6 days and should never be the automatic choice. For 2-4 day weeks, full-body and upper/lower are strongly preferred because they hit each muscle group more frequently. Pick the split that best serves the user's stated goal, experience level, and additional_activities; the week_summary MUST name the split you chose and briefly justify why it fits the training frequency and goal.
- Session structure (MANDATORY): every non-rest day MUST follow a compound-first approach. Lead with 1-2 primary compound movements from the fundamental patterns (squat, hip hinge/deadlift, horizontal push, horizontal pull, vertical push, vertical pull) then follow with 3-5 accessory/supplementary exercises that target the same muscle groups or address weak points. Never programme fewer than 5 exercises on a training day. Aim for 6-8 exercises for sessions of 60 minutes or longer.
- include_mobility: when true, every training day MUST include dedicated mobility work — 1-2 dynamic warm-up/activation movements at the START and 1-2 static stretches or mobility drills at the END of the session (in addition to the main exercises), targeting the muscle groups trained that day. Keep these low-intensity (bodyweight, "30-60s" or "10 each side" style prescriptions). When false, do not add separate mobility exercises. This adds to, and may slightly extend, the session within the time budget below.
- session_duration_minutes tells you how long the user can train. Scale volume to fit within that window: ~30 min → 4-5 exercises, 2-3 sets each, short rest; ~45 min → 5-6 exercises, 3 sets; ~60 min → 6-7 exercises, 3-4 sets; ~75 min → 7-8 exercises, 3-4 sets; ~90 min+ → 8-9 exercises, 4-5 sets. Set rest_seconds shorter for time-limited sessions (60-90s) and longer for heavy strength work (120-180s).
- additional_activities lists physical activity the user does outside the gym (e.g. "cycling commute, weekend football, climbing twice a week"). Factor this into the programme: reduce gym conditioning work if the user already accumulates significant cardio; avoid prescribing exercises that heavily overlap muscle groups already fatigued by their sport (e.g. reduce upper-body pulling volume if the user climbs regularly; avoid heavy leg work the day before a long run). The week_summary MUST explicitly mention how the additional activities were considered and what programming decisions they influenced (or state "no additional activities" if the field is empty).
- Every exercise MUST include an alternate_exercise with a different movement that trains the same pattern or muscle group. Pick a genuinely useful swap — different equipment, lower skill demand, or joint-friendlier variation (e.g. bench press → dumbbell press; barbell squat → goblet squat; pull-up → lat pulldown).
- Respect injuries: never prescribe contraindicated movements.
- Match equipment: only use exercises the user can do with their listed equipment.
- Respect dislikes; favor liked exercises where biomechanically sensible.
- Progressive overload aware: when recent_logs are provided, increase load/reps modestly on lifts where the user hit prescribed reps comfortably; deload (~10%) on lifts where reps were missed or pain was noted.
- plan_history contains week_summary strings from previous plans. Use these to avoid repeating the same weekly structure back-to-back, identify longer-term progression trends, and vary exercise selection meaningfully across weeks.
- If latest_report is provided (a saved analysis snapshot), treat its concerns and recommendations as high-priority inputs when structuring the new plan. Address identified concerns directly in the programme. The week_summary MUST explicitly state which report recommendations were applied.
- carry_forward, when provided, lists workouts being prepended to the START of this week from unfinished prior work; they will appear as their own training day(s) before the days you generate. Do NOT re-program these exercises in your output. Account for the extra early-week volume and fatigue when structuring the remaining days (e.g. avoid stacking the same muscle groups immediately after the carried-over work), and the week_summary should briefly note that carried-over work opens the week.`;

// ─── Report system prompt ──────────────────────────────────────────────────────

const REPORT_SYSTEM_PROMPT = `You are an expert strength and conditioning coach analyzing a client's workout history.
Return STRICT JSON only. No prose, no markdown, no code fences.

Output schema:
{
  "summary": string (2-3 sentences: overall assessment of the training period),
  "metrics": {
    "sessions": integer (count of distinct training days),
    "total_sets": integer (total sets logged across all exercises),
    "adherence_pct": integer (0-100),
    "avg_duration_min": integer or null
  },
  "strengths": string[] (2-3 specific positives with numbers where possible),
  "concerns": string[] (1-3 issues to address; empty array [] if none),
  "exercise_trends": [
    {
      "name": string,
      "trend": "improving" | "stable" | "regressing",
      "detail": string (one sentence with numbers, e.g. "Progressed from 80kg×8 to 92.5kg×8 across 5 sessions")
    }
  ],
  "recommendations": string[] (3-5 specific, actionable suggestions for the next training block)
}

Analysis rules:
- Each entry in sessions[] represents one training day. Count them for metrics.sessions.
- total_sets = sum of sets across all exercises across all sessions.
- adherence_pct = round(sessions / expected × 100), where expected = round(date_range_days / 7 × 4). Clamp to 100.
- avg_duration_min: average duration_min from sessions where it is non-null. Null if none available.
- Exercise trends: compare first-half vs second-half of the period. Improving = higher weight or reps recently. Regressing = lower weight, missed reps, or dropped frequency. Stable = consistent. Only include exercises appearing in ≥2 sessions.
- Strengths and concerns must reference specific exercises or patterns with numbers — no generic statements.
- Recommendations must be concrete programming changes ("Add a second squat day", "Reduce chest volume — 4 sessions in 2 weeks is too frequent for recovery"), never generic encouragement.`;

// ─── Provider calls ────────────────────────────────────────────────────────────

async function callGroq(systemPrompt, userContent) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Groq API ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callGemini(systemPrompt, userContent) {
  const model = 'gemini-1.5-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini API ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

async function callOpenRouter(systemPrompt, userContent) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenRouter API ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callProvider(systemPrompt, userContent) {
  let raw;
  switch (PROVIDER) {
    case 'groq': raw = await callGroq(systemPrompt, userContent); break;
    case 'gemini': raw = await callGemini(systemPrompt, userContent); break;
    case 'openrouter': raw = await callOpenRouter(systemPrompt, userContent); break;
    default: throw new Error(`Unknown LLM_PROVIDER: ${PROVIDER}`);
  }
  // Strip accidental code fences
  raw = raw.trim();
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`LLM did not return valid JSON: ${e.message}. Raw: ${raw.slice(0, 500)}`);
  }
}

// ─── Plan generation ───────────────────────────────────────────────────────────

function buildPlanPrompt({ profile, recent_logs, plan_history, latest_report, carry_forward, mode }) {
  return JSON.stringify({
    mode: mode || 'initial',
    profile,
    recent_logs: recent_logs || null,
    plan_history: plan_history || null,
    latest_report: latest_report || null,
    carry_forward: carry_forward || null,
  });
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('Plan is not an object');
  if (!Array.isArray(plan.days)) throw new Error('Plan.days must be an array');
  if (plan.days.length !== 7) throw new Error(`Plan.days must have 7 entries, got ${plan.days.length}`);
  for (const day of plan.days) {
    if (typeof day.day_index !== 'number') throw new Error('day.day_index missing');
    if (typeof day.is_rest !== 'boolean') throw new Error('day.is_rest missing');
    if (!day.is_rest) {
      if (!Array.isArray(day.exercises) || day.exercises.length === 0) {
        throw new Error(`day ${day.day_index} non-rest day must have exercises`);
      }
      for (const ex of day.exercises) {
        if (!ex.name || typeof ex.sets !== 'number' || !ex.reps) {
          throw new Error(`day ${day.day_index} exercise malformed: ${JSON.stringify(ex)}`);
        }
      }
    }
  }
  return true;
}

/**
 * Deterministic safety net: the LLM is instructed to pick a training-day count
 * within the user's [days_per_week_min, days_per_week_max] range, but occasionally
 * overshoots. If it scheduled MORE training days than the user's weekly max, convert
 * the lightest excess day(s) to rest and stash their exercises into _carryover so the
 * work is preserved (the smart-shift and Monday-cron machinery already consume that
 * field). If it scheduled fewer than the minimum, we only warn — fabricating extra
 * training days mechanically would produce low-quality sessions.
 */
function enforceSessionCount(plan, profile) {
  if (!profile) return;
  const max = profile.days_per_week_max ?? profile.days_per_week;
  const min = profile.days_per_week_min ?? profile.days_per_week;
  const training = plan.days.filter(d => !d.is_rest);

  if (max && training.length > max) {
    const excess = training.length - max;
    // Drop the lightest training days first so we shed the least programming value.
    const toRest = [...training]
      .sort((a, b) => (a.exercises?.length || 0) - (b.exercises?.length || 0))
      .slice(0, excess);
    const carry = plan._carryover_days || [];
    for (const day of toRest) {
      if ((day.exercises || []).length) {
        carry.push({
          name: day.name,
          is_rest: false,
          exercises: day.exercises.map(ex => ({ ...ex, carried_over: true })),
          carried_over: true,
        });
      }
      day.is_rest = true;
      day.name = 'Rest';
      day.exercises = [];
    }
    if (carry.length) plan._carryover_days = carry;
    console.warn(`[plan] training days ${training.length} > max ${max}; capped to ${max}, stashed ${carry.length} day(s) to carryover`);
  } else if (min && training.length < min) {
    console.warn(`[plan] training days ${training.length} < requested min ${min}; leaving as generated`);
  }
}

export async function generatePlan(input) {
  const parsed = await callProvider(PLAN_SYSTEM_PROMPT, buildPlanPrompt(input));
  validatePlan(parsed);
  enforceSessionCount(parsed, input?.profile);
  return parsed;
}

// ─── Mobility session generation ─────────────────────────────────────────────────

const MOBILITY_SYSTEM_PROMPT = `You are an expert strength and conditioning coach.
A user on a rest day wants light movement instead, and there is no remaining workout day this week to pull forward.
Generate a SINGLE mobility / active-recovery session as STRICT JSON only. No prose, no markdown, no code fences.

Output schema:
{
  "name": string (e.g. "Mobility & Recovery"),
  "exercises": [
    {
      "name": string,
      "sets": integer,
      "reps": string (e.g. "30s hold" or "10 each side"),
      "target_weight": string (usually "bodyweight"),
      "rest_seconds": integer,
      "form_tip": string (one short sentence),
      "alternate_exercise": { "name": string, "note": string }
    }
  ]
}

Rules:
- Programme 5-7 gentle mobility, stretching, or activation movements — NOT heavy strength work. Keep it low-intensity and recovery-focused.
- Respect injuries: never prescribe contraindicated movements; gently address the user's restricted areas where appropriate.
- Use minimal or no equipment regardless of what the user owns.
- Every exercise MUST include an alternate_exercise (an easier or equipment-free variation).`;

function validateMobility(m) {
  if (!m || typeof m !== 'object') throw new Error('Mobility session is not an object');
  if (!Array.isArray(m.exercises) || m.exercises.length === 0) throw new Error('mobility.exercises must be a non-empty array');
  for (const ex of m.exercises) {
    if (!ex.name || typeof ex.sets !== 'number' || !ex.reps) throw new Error(`mobility exercise malformed: ${JSON.stringify(ex)}`);
  }
  return true;
}

export async function generateMobilitySession({ profile }) {
  const parsed = await callProvider(MOBILITY_SYSTEM_PROMPT, JSON.stringify({ profile: profile || null }));
  validateMobility(parsed);
  if (!parsed.name) parsed.name = 'Mobility & Recovery';
  return parsed;
}

// ─── Report generation ─────────────────────────────────────────────────────────

function buildReportPrompt({ sessions, days }) {
  return JSON.stringify({ date_range_days: days, sessions });
}

function validateReport(r) {
  if (!r || typeof r !== 'object') throw new Error('Report is not an object');
  if (typeof r.summary !== 'string') throw new Error('report.summary missing');
  if (!r.metrics || typeof r.metrics.sessions !== 'number') throw new Error('report.metrics missing');
  if (!Array.isArray(r.strengths)) throw new Error('report.strengths must be array');
  if (!Array.isArray(r.concerns)) throw new Error('report.concerns must be array');
  if (!Array.isArray(r.exercise_trends)) throw new Error('report.exercise_trends must be array');
  if (!Array.isArray(r.recommendations)) throw new Error('report.recommendations must be array');
  return true;
}

export async function generateReport(input) {
  const parsed = await callProvider(REPORT_SYSTEM_PROMPT, buildReportPrompt(input));
  validateReport(parsed);
  return parsed;
}
