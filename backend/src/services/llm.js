/**
 * LLM service. One exported function: generatePlan(input).
 * Provider selected via LLM_PROVIDER env var. Default: groq.
 *
 * Chosen default: Groq (llama-3.3-70b-versatile)
 *  - Free tier: 14,400 req/day, plenty of headroom for a single-user workout app
 *  - Native JSON mode via response_format
 *  - Very fast inference (sub-second), good for "Regenerate plan" UX
 *
 * Alternatives kept compatible:
 *  - gemini: Gemini 1.5 Flash, also has JSON mode (responseMimeType)
 *  - openrouter: free models vary; uses OpenAI-compatible interface
 */

const PROVIDER = (process.env.LLM_PROVIDER || 'groq').toLowerCase();

const SYSTEM_PROMPT = `You are an expert strength and conditioning coach.
You generate weekly workout plans as STRICT JSON only. No prose, no markdown, no code fences.

Output schema:
{
  "week_summary": string,
  "days": [
    {
      "day_index": integer (0-based),
      "name": string (e.g. "Push Day", "Rest"),
      "is_rest": boolean,
      "exercises": [
        {
          "name": string,
          "sets": integer,
          "reps": string (e.g. "8-10" or "5"),
          "target_weight": string (e.g. "60kg" or "bodyweight" or "RPE 8"),
          "rest_seconds": integer,
          "form_tip": string (one short sentence)
        }
      ]
    }
  ]
}

Rules:
- Number of days in array MUST equal user's days_per_week scheduled days + rest days to make a 7-day week (so always 7 entries, day_index 0..6).
- Respect injuries: never prescribe contraindicated movements.
- Match equipment: only use exercises the user can do with their listed equipment.
- Respect dislikes; favor liked exercises where biomechanically sensible.
- Progressive overload aware: when recent_logs are provided, increase load/reps modestly on lifts where the user hit prescribed reps comfortably; deload (~10%) on lifts where reps were missed or pain was noted.`;

function buildUserPrompt(input) {
  const { profile, recent_logs, mode } = input;
  return JSON.stringify({
    mode: mode || 'initial',
    profile,
    recent_logs: recent_logs || null,
  });
}

async function callGroq(userPrompt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
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

async function callGemini(userPrompt) {
  const model = 'gemini-1.5-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
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

async function callOpenRouter(userPrompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
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

/** Validate the LLM JSON output matches our expected schema. */
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

export async function generatePlan(input) {
  const userPrompt = buildUserPrompt(input);

  let rawJson;
  switch (PROVIDER) {
    case 'groq': rawJson = await callGroq(userPrompt); break;
    case 'gemini': rawJson = await callGemini(userPrompt); break;
    case 'openrouter': rawJson = await callOpenRouter(userPrompt); break;
    default: throw new Error(`Unknown LLM_PROVIDER: ${PROVIDER}`);
  }

  // Strip accidental code fences if any
  rawJson = rawJson.trim();
  if (rawJson.startsWith('```')) {
    rawJson = rawJson.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (e) {
    throw new Error(`LLM did not return valid JSON: ${e.message}. Raw: ${rawJson.slice(0, 500)}`);
  }

  validatePlan(parsed);
  return parsed;
}
