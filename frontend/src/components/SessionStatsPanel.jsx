import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';

function fmtDuration(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}m ${s}s`;
}

export default function SessionStatsPanel({ stats, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ hr_avg: '', hr_max: '', cal: '', dur_min: '' });
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (stats) {
      setForm({
        hr_avg: stats.heart_rate_avg ?? '',
        hr_max: stats.heart_rate_max ?? '',
        cal: stats.calories ?? '',
        dur_min: stats.duration_sec ? Math.round(stats.duration_sec / 60) : '',
      });
    }
  }, [stats]);

  async function saveManual() {
    setMsg(null);
    try {
      await api.saveSessionStats({
        heart_rate_avg: form.hr_avg ? Number(form.hr_avg) : null,
        heart_rate_max: form.hr_max ? Number(form.hr_max) : null,
        calories: form.cal ? Number(form.cal) : null,
        duration_sec: form.dur_min ? Number(form.dur_min) * 60 : null,
      });
      setEditing(false);
      onSaved();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMsg(null);
    try {
      const res = await api.uploadAppleHealth(file);
      setMsg({ type: 'success', text: `Imported: HR ${res.stats.heart_rate_avg ?? '—'} avg, ${res.stats.calories ?? '—'} kcal` });
      onSaved();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div className="card">
      {!editing ? (
        <>
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-label">Heart rate avg</div>
              <div className="stat-value">{stats?.heart_rate_avg ?? '—'} <span className="muted small">bpm</span></div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Heart rate max</div>
              <div className="stat-value">{stats?.heart_rate_max ?? '—'} <span className="muted small">bpm</span></div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Calories</div>
              <div className="stat-value">{stats?.calories ?? '—'} <span className="muted small">kcal</span></div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Duration</div>
              <div className="stat-value">{fmtDuration(stats?.duration_sec)}</div>
            </div>
          </div>
          {stats?.source && (
            <div className="muted small" style={{ marginTop: '0.5rem' }}>
              source: {stats.source.replace('_', ' ')}
            </div>
          )}
          <div className="row" style={{ marginTop: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="ghost small" onClick={() => setEditing(true)}>Enter manually</button>
            <label className="ghost small" style={{
              display: 'inline-block', cursor: 'pointer',
              padding: '0.55rem 1.1rem', borderRadius: 'var(--radius)',
              border: '1px solid var(--border)', textTransform: 'none',
              letterSpacing: 0, color: 'var(--text)', fontSize: '0.92rem',
            }}>
              {uploading ? <span className="spinner" /> : 'Upload Apple Health export'}
              <input type="file" accept=".xml,.csv" onChange={handleUpload} style={{ display: 'none' }} />
            </label>
          </div>
          {msg && <div className={msg.type === 'error' ? 'error' : 'success'} style={{ marginTop: '0.5rem' }}>{msg.text}</div>}
        </>
      ) : (
        <div className="col">
          <div className="row" style={{ gap: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <label>HR avg</label>
              <input type="number" value={form.hr_avg} onChange={e => setForm({ ...form, hr_avg: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label>HR max</label>
              <input type="number" value={form.hr_max} onChange={e => setForm({ ...form, hr_max: e.target.value })} />
            </div>
          </div>
          <div className="row" style={{ gap: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <label>calories</label>
              <input type="number" value={form.cal} onChange={e => setForm({ ...form, cal: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label>duration (min)</label>
              <input type="number" value={form.dur_min} onChange={e => setForm({ ...form, dur_min: e.target.value })} />
            </div>
          </div>
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="primary" onClick={saveManual}>Save</button>
            <button className="ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
