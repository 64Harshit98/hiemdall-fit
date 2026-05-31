import { useState } from 'react';

const TREND_ICON  = { improving: '↑', stable: '→', regressing: '↓' };
const TREND_COLOR = { improving: 'var(--success)', stable: 'var(--text-dim)', regressing: 'var(--danger)' };

export default function ReportView({
  id, report, dateRange, isSaved, userNote, createdAt,
  onSave, onUnsave, onDelete,
  collapsible = false,
}) {
  const [expanded, setExpanded]       = useState(!collapsible);
  const [showEditor, setShowEditor]   = useState(false);
  const [note, setNote]               = useState(userNote || '');
  const [busy, setBusy]               = useState(false);

  async function handleSave() {
    setBusy(true);
    try { await onSave(id, note); } finally { setBusy(false); setShowEditor(false); }
  }
  async function handleUnsave() {
    setBusy(true);
    try { await onUnsave(id); } finally { setBusy(false); }
  }
  async function handleDelete() {
    if (!confirm('Delete this report?')) return;
    await onDelete(id);
  }

  return (
    <div className="card" style={{ marginTop: '1rem' }}>

      {/* ── Header ── */}
      <div className="row between" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span className="tag">{dateRange}</span>
          {createdAt && <span className="muted small">{createdAt.slice(0, 10)}</span>}
          {isSaved && <span className="tag" style={{ borderColor: 'var(--accent-dim)', color: 'var(--accent)' }}>★ saved</span>}
        </div>
        <div className="row" style={{ gap: '0.5rem' }}>
          {!isSaved && !showEditor && (
            <button className="ghost small" onClick={() => setShowEditor(true)}>☆ Save snapshot</button>
          )}
          {isSaved && (
            <button className="ghost small" onClick={handleUnsave} disabled={busy}>★ Unsave</button>
          )}
          {collapsible && (
            <button className="ghost small" onClick={() => setExpanded(v => !v)}>
              {expanded ? '▾' : '▸'}
            </button>
          )}
        </div>
      </div>

      {/* ── Note editor (before saving) ── */}
      {showEditor && !isSaved && (
        <div style={{ marginTop: '0.75rem' }}>
          <label>Note for your coach</label>
          <textarea
            rows="2"
            placeholder="e.g. focus on lower body next week, skip overhead press due to shoulder"
            value={note}
            onChange={e => setNote(e.target.value)}
            style={{ fontSize: '0.88rem' }}
          />
          <div className="row" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
            <button className="primary small" onClick={handleSave} disabled={busy} style={{ padding: '0.35rem 0.9rem' }}>
              {busy ? <span className="spinner" /> : '★ Save'}
            </button>
            <button className="ghost small" onClick={() => setShowEditor(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Saved note ── */}
      {isSaved && userNote && (
        <div className="form-tip" style={{ marginTop: '0.5rem' }}>📝 {userNote}</div>
      )}

      {/* ── Report body ── */}
      {expanded && (
        <>
          <p style={{ marginTop: '0.75rem', fontSize: '0.92rem', lineHeight: 1.65 }}>{report.summary}</p>

          {/* Metrics */}
          <div className="stats-grid" style={{ marginTop: '0.75rem' }}>
            <div className="stat-item">
              <div className="stat-label">Sessions</div>
              <div className="stat-value">{report.metrics.sessions}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Total sets</div>
              <div className="stat-value">{report.metrics.total_sets}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Adherence</div>
              <div className="stat-value">{report.metrics.adherence_pct}%</div>
            </div>
            {report.metrics.avg_duration_min != null && (
              <div className="stat-item">
                <div className="stat-label">Avg session</div>
                <div className="stat-value">{report.metrics.avg_duration_min}m</div>
              </div>
            )}
          </div>

          {/* Strengths + Concerns */}
          <div className="row" style={{ gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            {report.strengths.length > 0 && (
              <div style={{ flex: '1 1 180px' }}>
                <div className="stat-label" style={{ marginBottom: '0.4rem' }}>Strengths</div>
                {report.strengths.map((s, i) => (
                  <div key={i} style={{ fontSize: '0.88rem', marginBottom: '0.3rem', color: 'var(--success)' }}>✓ {s}</div>
                ))}
              </div>
            )}
            {report.concerns.length > 0 && (
              <div style={{ flex: '1 1 180px' }}>
                <div className="stat-label" style={{ marginBottom: '0.4rem' }}>Concerns</div>
                {report.concerns.map((c, i) => (
                  <div key={i} style={{ fontSize: '0.88rem', marginBottom: '0.3rem', color: 'var(--warning)' }}>⚠ {c}</div>
                ))}
              </div>
            )}
          </div>

          {/* Exercise trends */}
          {report.exercise_trends.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <div className="stat-label" style={{ marginBottom: '0.5rem' }}>Exercise trends</div>
              {report.exercise_trends.map((t, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'baseline', gap: '0.6rem',
                  padding: '0.35rem 0', borderBottom: '1px solid var(--border)',
                  fontSize: '0.88rem',
                }}>
                  <span style={{ color: TREND_COLOR[t.trend], fontWeight: 700, fontSize: '1.05rem', minWidth: '1.1rem' }}>
                    {TREND_ICON[t.trend]}
                  </span>
                  <span style={{ fontWeight: 600, minWidth: '140px', flexShrink: 0 }}>{t.name}</span>
                  <span className="muted" style={{ flex: 1 }}>{t.detail}</span>
                </div>
              ))}
            </div>
          )}

          {/* Recommendations */}
          {report.recommendations.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <div className="stat-label" style={{ marginBottom: '0.5rem' }}>Recommendations for next plan</div>
              {report.recommendations.map((r, i) => (
                <div key={i} style={{ fontSize: '0.88rem', marginBottom: '0.4rem', paddingLeft: '1.25rem', position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0, color: 'var(--accent)', fontWeight: 600 }}>{i + 1}.</span>
                  {r}
                </div>
              ))}
            </div>
          )}

          {/* Delete */}
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="ghost small danger" onClick={handleDelete} style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
