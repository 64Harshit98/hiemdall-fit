import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import ReportView from '../components/ReportView.jsx';

const RANGE_OPTIONS = [
  { label: 'Last 7 days',  value: 7  },
  { label: 'Last 14 days', value: 14 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 60 days', value: 60 },
  { label: 'Last 90 days', value: 90 },
];

export default function History() {
  const [histData, setHistData]         = useState({ logs: [], stats: [] });
  const [savedReports, setSavedReports] = useState([]);
  const [loading, setLoading]           = useState(true);

  const [range, setRange]           = useState(30);
  const [generating, setGenerating] = useState(false);
  const [freshReport, setFreshReport] = useState(null);
  const [genErr, setGenErr]         = useState(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    try {
      const [h, saved] = await Promise.all([api.history(), api.listReports()]);
      setHistData(h);
      setSavedReports(saved);
    } catch {}
    setLoading(false);
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenErr(null);
    setFreshReport(null);
    try {
      const result = await api.generateReport(range);
      setFreshReport(result);
    } catch (e) {
      setGenErr(e.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave(id, note) {
    await api.saveReport(id, note);
    const saved = await api.listReports();
    setSavedReports(saved);
    setFreshReport(null); // now lives in the saved list
  }

  async function handleUnsave(id) {
    await api.unsaveReport(id);
    const saved = await api.listReports();
    setSavedReports(saved);
  }

  async function handleDelete(id) {
    await api.deleteReport(id);
    const saved = await api.listReports();
    setSavedReports(saved);
    if (freshReport?.id === id) setFreshReport(null);
  }

  if (loading) return <div className="muted"><span className="spinner" /></div>;

  // Group logs by date
  const byDate = {};
  for (const log of histData.logs) {
    if (!byDate[log.session_date]) byDate[log.session_date] = [];
    byDate[log.session_date].push(log);
  }
  const statsByDate = {};
  for (const s of histData.stats) statsByDate[s.session_date] = s;
  const dates = Object.keys(byDate).sort().reverse();

  return (
    <>
      <h1>History</h1>

      {/* ── Analysis panel ── */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 500, marginBottom: '0.75rem' }}>
          Get an analysis
        </div>
        <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <select
            value={range}
            onChange={e => setRange(Number(e.target.value))}
            style={{ flex: '1 1 160px' }}
          >
            {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            className="primary"
            onClick={handleGenerate}
            disabled={generating}
            style={{ flex: '1 1 auto' }}
          >
            {generating
              ? <><span className="spinner" style={{ marginRight: '0.5rem' }} />Analysing…</>
              : 'Generate report'}
          </button>
        </div>
        {genErr && <div className="error" style={{ marginTop: '0.5rem' }}>{genErr}</div>}
        <p className="muted small" style={{ marginTop: '0.6rem' }}>
          Save a snapshot and it will inform your next generated plan — the coach sees your concerns and recommendations.
        </p>
      </div>

      {/* ── Fresh report ── */}
      {freshReport && (
        <ReportView
          id={freshReport.id}
          report={freshReport.report}
          dateRange={freshReport.date_range}
          isSaved={freshReport.is_saved}
          userNote={freshReport.user_note}
          onSave={handleSave}
          onUnsave={handleUnsave}
          onDelete={handleDelete}
        />
      )}

      {/* ── Saved snapshots ── */}
      {savedReports.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: '2rem' }}>
            Saved snapshots
          </div>
          {savedReports.map(r => (
            <ReportView
              key={r.id}
              id={r.id}
              report={r.report}
              dateRange={r.date_range}
              isSaved
              userNote={r.user_note}
              createdAt={r.created_at}
              onSave={handleSave}
              onUnsave={handleUnsave}
              onDelete={handleDelete}
              collapsible
            />
          ))}
        </>
      )}

      {/* ── Daily workout log ── */}
      <div className="section-title" style={{ marginTop: '2rem' }}>
        Workout log
      </div>
      {dates.length === 0 ? (
        <p className="muted" style={{ marginTop: '1rem' }}>Nothing logged yet. Today's the day.</p>
      ) : (
        dates.map(date => {
          const logs  = byDate[date];
          const stats = statsByDate[date];
          const byExercise = {};
          for (const log of logs) {
            if (!byExercise[log.exercise_name]) byExercise[log.exercise_name] = [];
            byExercise[log.exercise_name].push(log);
          }

          return (
            <div key={date} className="card" style={{ marginTop: '0.75rem' }}>
              <div className="row between">
                <h3>{date}</h3>
                {stats && (
                  <div className="muted small">
                    {stats.heart_rate_avg ? `${stats.heart_rate_avg} bpm avg · ` : ''}
                    {stats.calories       ? `${stats.calories} kcal · `          : ''}
                    {stats.duration_sec   ? `${Math.round(stats.duration_sec / 60)} min` : ''}
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
