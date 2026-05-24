import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function History() {
  const [data, setData] = useState({ logs: [], stats: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.history().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="muted"><span className="spinner" /></div>;

  // Group logs by date
  const byDate = {};
  for (const log of data.logs) {
    if (!byDate[log.session_date]) byDate[log.session_date] = [];
    byDate[log.session_date].push(log);
  }
  const statsByDate = {};
  for (const s of data.stats) statsByDate[s.session_date] = s;

  const dates = Object.keys(byDate).sort().reverse();

  return (
    <>
      <h1>History</h1>
      {dates.length === 0 ? (
        <p className="muted" style={{ marginTop: '1rem' }}>Nothing logged yet. Today's the day.</p>
      ) : (
        dates.map(date => {
          const logs = byDate[date];
          const stats = statsByDate[date];
          const byExercise = {};
          for (const log of logs) {
            if (!byExercise[log.exercise_name]) byExercise[log.exercise_name] = [];
            byExercise[log.exercise_name].push(log);
          }

          return (
            <div key={date} className="card" style={{ marginTop: '1rem' }}>
              <div className="row between">
                <h3>{date}</h3>
                {stats && (
                  <div className="muted small">
                    {stats.heart_rate_avg ? `${stats.heart_rate_avg} bpm avg · ` : ''}
                    {stats.calories ? `${stats.calories} kcal · ` : ''}
                    {stats.duration_sec ? `${Math.round(stats.duration_sec / 60)} min` : ''}
                  </div>
                )}
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                {Object.entries(byExercise).map(([name, entries]) => (
                  <div key={name} style={{ paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)', marginTop: '0.5rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{name}</div>
                    <div className="muted small mono">
                      {entries.map(e => `${e.weight ?? '—'}kg × ${e.reps ?? '—'}`).join('  ·  ')}
                    </div>
                    {entries.find(e => e.notes) && (
                      <div className="faint small" style={{ fontStyle: 'italic', marginTop: '0.2rem' }}>
                        {entries.find(e => e.notes).notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
