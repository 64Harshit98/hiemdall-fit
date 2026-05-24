import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const EQUIPMENT_OPTIONS = [
  'barbell', 'dumbbells', 'kettlebells', 'machines', 'cables',
  'pull-up bar', 'resistance bands', 'bench', 'bodyweight only',
];

export default function Profile() {
  const [p, setP] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { api.getProfile().then(setP); }, []);

  if (!p) return <div className="muted"><span className="spinner" /></div>;

  function update(key, value) { setP({ ...p, [key]: value }); }
  function toggleEquip(opt) {
    const has = p.equipment.includes(opt);
    setP({ ...p, equipment: has ? p.equipment.filter(e => e !== opt) : [...p.equipment, opt] });
  }
  function updatePref(key, value) { setP({ ...p, preferences: { ...p.preferences, [key]: value } }); }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await api.saveProfile({
        age: Number(p.age),
        height: Number(p.height),
        weight: Number(p.weight),
        experience: p.experience,
        goal: p.goal,
        days_per_week: Number(p.days_per_week),
        injuries: p.injuries,
        equipment: p.equipment,
        preferences: p.preferences,
      });
      setMsg({ type: 'success', text: 'Profile saved.' });
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h1>Profile</h1>
      <p className="muted" style={{ marginBottom: '1.25rem' }}>
        Change anything here, then regenerate your plan from the Today screen if you want the new info reflected.
      </p>

      <div className="card col">
        <div className="row" style={{ gap: '0.75rem' }}>
          <div style={{ flex: 1 }}>
            <label>age</label>
            <input type="number" value={p.age} onChange={e => update('age', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label>height (cm)</label>
            <input type="number" value={p.height} onChange={e => update('height', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label>weight (kg)</label>
            <input type="number" step="0.1" value={p.weight} onChange={e => update('weight', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card col" style={{ marginTop: '0.75rem' }}>
        <div className="row" style={{ gap: '0.75rem' }}>
          <div style={{ flex: 1 }}>
            <label>experience</label>
            <select value={p.experience} onChange={e => update('experience', e.target.value)}>
              <option value="beginner">beginner</option>
              <option value="intermediate">intermediate</option>
              <option value="advanced">advanced</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>goal</label>
            <select value={p.goal} onChange={e => update('goal', e.target.value)}>
              <option value="muscle gain">muscle gain</option>
              <option value="fat loss">fat loss</option>
              <option value="strength">strength</option>
              <option value="endurance">endurance</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>days / week</label>
            <select value={p.days_per_week} onChange={e => update('days_per_week', e.target.value)}>
              {[2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '0.75rem' }}>
        <label>equipment</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.25rem' }}>
          {EQUIPMENT_OPTIONS.map(opt => (
            <label key={opt} className="checkbox-row" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '0.9rem', color: 'var(--text)' }}>
              <input type="checkbox" checked={p.equipment.includes(opt)} onChange={() => toggleEquip(opt)} />
              {opt}
            </label>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: '0.75rem' }}>
        <label>injuries / limitations</label>
        <textarea rows="2" value={p.injuries || ''} onChange={e => update('injuries', e.target.value)} />
      </div>

      <div className="card" style={{ marginTop: '0.75rem' }}>
        <label>favorite exercises</label>
        <textarea rows="2" value={p.preferences?.liked || ''} onChange={e => updatePref('liked', e.target.value)} />
        <label style={{ marginTop: '0.75rem' }}>exercises to avoid</label>
        <textarea rows="2" value={p.preferences?.disliked || ''} onChange={e => updatePref('disliked', e.target.value)} />
      </div>

      {msg && <div className={msg.type === 'error' ? 'error' : 'success'} style={{ marginTop: '0.75rem' }}>{msg.text}</div>}

      <button className="primary" onClick={save} disabled={saving} style={{ marginTop: '1rem' }}>
        {saving ? <span className="spinner" /> : 'Save profile'}
      </button>
    </>
  );
}
