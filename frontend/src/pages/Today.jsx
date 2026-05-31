import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import ExerciseRow from '../components/ExerciseRow.jsx';
import SessionStatsPanel from '../components/SessionStatsPanel.jsx';

export default function Today() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  // null = follow the server's current day; a number = previewing that day
  const [viewDay, setViewDay] = useState(null);

  async function load(day = viewDay) {
    setLoading(true);
    try {
      const d = await api.getCurrentPlan(day);
      setData(d);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(null); }, []);

  function goToDay(i) {
    setViewDay(i);
    load(i);
  }

  // Jump back to (and follow) the active day after an action that moves it.
  function backToCurrent() {
    setViewDay(null);
    load(null);
  }

  async function handleAdvance() {
    await api.advanceDay();
    backToCurrent();
  }

  async function handleMarkRest() {
    if (!confirm("Mark today as a rest day? Today's workout will shift to the coming days. You can undo this.")) return;
    await api.markRestDay();
    backToCurrent();
  }

  async function handleUnmarkRest() {
    await api.unmarkRestDay();
    backToCurrent();
  }

  async function handleRegenerate() {
    if (!confirm('Regenerate this week\'s plan? A new plan will be built from your profile and your latest saved analysis report (if any). Today\'s logged sets stay saved.')) return;
    setRegenerating(true);
    try {
      await api.generatePlan('regenerate');
      setViewDay(null);
      await load(null);
    } catch (e) {
      alert('Regenerate failed: ' + e.message);
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) return <div className="muted"><span className="spinner" /> &nbsp; loading today</div>;
  if (err) return <div className="error">{err}</div>;
  if (!data) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
        <h2>No active plan</h2>
        <p className="muted" style={{ margin: '0.75rem 0 1.5rem' }}>
          Looks like you don't have a plan yet. Generate one from your profile.
        </p>
        <button className="primary" onClick={async () => { await api.generatePlan('initial'); load(); }}>
          Generate plan
        </button>
      </div>
    );
  }

  const { today, plan_id, current_day_index, viewing_day_index, is_current, total_days, logs, stats, week_summary } = data;
  const isFuture = viewing_day_index > current_day_index;

  // Build a set of completed exercises = all prescribed sets logged
  const completedExercises = new Set();
  if (today && !today.is_rest) {
    for (const ex of today.exercises) {
      const setsLogged = logs.filter(l => l.exercise_name === ex.name).length;
      if (setsLogged >= ex.sets) completedExercises.add(ex.name);
    }
  }
  const allDone = today && !today.is_rest && completedExercises.size === today.exercises.length;

  return (
    <>
      <div className="row between" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div className="tag">Week of {data.week_start}</div>
          <h1 style={{ marginTop: '0.5rem' }}>
            Day {viewing_day_index + 1}{today?.name ? ` · ${today.name}` : ''}
          </h1>
          {!is_current && (
            <div className="tag" style={{ marginTop: '0.4rem', borderColor: 'var(--accent-dim)', color: 'var(--accent)' }}>
              {isFuture ? '🔒 Preview' : '✓ Completed'}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: '0.5rem' }}>
          {is_current && today && !today.is_rest && (
            <button className="ghost small danger" onClick={handleMarkRest}>
              Rest day
            </button>
          )}
          <button className="ghost small" onClick={handleRegenerate} disabled={regenerating}>
            {regenerating ? <span className="spinner" /> : '↻ Regenerate plan'}
          </button>
        </div>
      </div>

      {week_summary && <p className="muted small" style={{ marginTop: '0.5rem' }}>{week_summary}</p>}

      <div className="day-strip">
        {Array.from({ length: total_days }, (_, i) => (
          <button
            key={i}
            onClick={() => goToDay(i)}
            className={`day-pill ${i === current_day_index ? 'current' : ''} ${i < current_day_index ? 'done' : ''} ${i > current_day_index ? 'locked' : ''} ${i === viewing_day_index ? 'viewing' : ''}`}
          >
            D{i + 1}
          </button>
        ))}
      </div>

      {!is_current && (
        <div className="card" style={{ marginBottom: '0.75rem', borderColor: 'var(--accent-dim)' }}>
          <p className="muted small" style={{ margin: 0 }}>
            {isFuture
              ? `🔒 Preview only — finish Day ${current_day_index + 1} to unlock logging for this day.`
              : '✓ This day is already done — read-only.'}
          </p>
          <button className="ghost small" style={{ marginTop: '0.75rem' }} onClick={backToCurrent}>
            ← Back to today (Day {current_day_index + 1})
          </button>
        </div>
      )}

      {today?.is_rest ? (
        <div className="rest-day card">
          <div className="glyph">·</div>
          <h2>Rest day</h2>
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Recovery is where adaptation happens. Sleep, eat, hydrate.
          </p>

          {is_current && today.can_undo_rest && (
            <div style={{ marginTop: '1.5rem' }}>
              {today.stashed_exercises?.length > 0 && (
                <p className="muted small" style={{ marginBottom: '0.75rem' }}>
                  You changed this day to rest. Original workout:{' '}
                  {today.stashed_exercises.map(e => e.name).join(', ')}.
                </p>
              )}
              <button className="ghost small" onClick={handleUnmarkRest}>
                ↩ Undo — back to workout
              </button>
            </div>
          )}

          {is_current && (
            <button className="primary" style={{ marginTop: '2rem' }} onClick={handleAdvance}>
              Mark done → next day
            </button>
          )}
        </div>
      ) : (
        <>
          {today?.exercises?.map((ex, idx) => (
            <ExerciseRow
              key={`${ex.name}-${idx}`}
              exercise={ex}
              planId={plan_id}
              dayIndex={viewing_day_index}
              existingLogs={logs.filter(l => l.exercise_name === ex.name)}
              isComplete={completedExercises.has(ex.name)}
              onLogged={load}
              readOnly={!is_current}
            />
          ))}

          {is_current && (
            <>
              <div className="section-title">Session <span className="sub">heart rate, calories, duration</span></div>
              <SessionStatsPanel stats={stats} onSaved={load} />

              {allDone && (
                <div className="card" style={{ marginTop: '1.5rem', textAlign: 'center', borderColor: 'var(--accent-dim)' }}>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem' }}>Day complete</h3>
                  <p className="muted small" style={{ margin: '0.5rem 0 1rem' }}>
                    Every prescribed set logged. Ready to advance?
                  </p>
                  <button className="primary" onClick={handleAdvance}>Advance to next day →</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
