import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

const EQUIPMENT_OPTIONS = [
  'barbell', 'dumbbells', 'kettlebells', 'machines', 'cables',
  'pull-up bar', 'resistance bands', 'bench', 'bodyweight only',
];

const SPLIT_SUGGESTIONS = [
  'Push / Pull / Legs',
  'Upper / Lower',
  'Full body each session',
  'Bro split — one muscle group per day',
  'One big + one small muscle per day',
  'Arnold split',
];

export default function Profile() {
  const [p, setP] = useState(null);
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [msg, setMsg] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { api.getProfile().then(setP); }, []);

  if (!p) return <div className="muted"><span className="spinner" /></div>;

  function update(key, value) { setP({ ...p, [key]: value }); }
  function toggleEquip(opt) {
    const has = p.equipment.includes(opt);
    setP({ ...p, equipment: has ? p.equipment.filter(e => e !== opt) : [...p.equipment, opt] });
  }
  function updatePref(key, value) { setP({ ...p, preferences: { ...p.preferences, [key]: value } }); }

  function profilePayload() {
    return {
      age: Number(p.age),
      height: Number(p.height),
      weight: Number(p.weight),
      experience: p.experience,
      goal: p.goal,
      days_per_week_min: Number(p.days_per_week_min),
      days_per_week_max: Number(p.days_per_week_max),
      session_duration_minutes: Number(p.session_duration_minutes ?? 60),
      injuries: p.injuries,
      additional_activities: p.additional_activities,
      split_preference: p.split_preference,
      equipment: p.equipment,
      preferences: p.preferences,
    };
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await api.saveProfile(profilePayload());
      setMsg({ type: 'success', text: 'Profile saved.' });
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function saveAndUpdate() {
    setUpdating(true);
    setMsg(null);
    try {
      await api.saveProfile(profilePayload());
      await api.generatePlan('regenerate');
      navigate('/');
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
      setUpdating(false);
    }
  }

  if (updating) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
        <div className="spinner" style={{ width: 24, height: 24 }} />
        <h2 style={{ marginTop: '1.25rem' }}>Updating your plan</h2>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Saving profile and consulting the coach. This usually takes 5–15 seconds.
        </p>
      </div>
    );
  }

  return (
    <>
      <h1>Profile</h1>
      <p className="muted" style={{ marginBottom: '1.25rem' }}>
        Save your changes, or save and immediately get a new plan built around your updated details and workout history.
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
        </div>
        <div className="row" style={{ gap: '0.75rem', marginTop: '0.75rem' }}>
          <div style={{ flex: 1 }}>
            <label>days / week</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <select value={p.days_per_week_min} onChange={e => update('days_per_week_min', e.target.value)} style={{ flex: 1 }}>
                {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="muted" style={{ flexShrink: 0 }}>to</span>
              <select value={p.days_per_week_max} onChange={e => update('days_per_week_max', e.target.value)} style={{ flex: 1 }}>
                {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            {Number(p.days_per_week_min) > Number(p.days_per_week_max)
              ? <div style={{ color: 'var(--danger)', fontSize: '0.78rem', marginTop: '0.2rem' }}>min must be ≤ max</div>
              : <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.2rem' }}>{p.days_per_week_min}–{p.days_per_week_max} days/week</div>
            }
          </div>
          <div style={{ flex: 1 }}>
            <label>session duration</label>
            <select value={p.session_duration_minutes ?? 60} onChange={e => update('session_duration_minutes', e.target.value)}>
              <option value={30}>30 min</option>
              <option value={45}>45 min</option>
              <option value={60}>60 min</option>
              <option value={75}>75 min</option>
              <option value={90}>90 min</option>
              <option value={120}>2 hours</option>
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
        <label>preferred workout split</label>
        <input type="text" list="split-suggestions" placeholder="e.g. push pull legs, upper/lower, one big + one small muscle"
               value={p.split_preference || ''}
               onChange={e => update('split_preference', e.target.value)} />
        <datalist id="split-suggestions">
          {SPLIT_SUGGESTIONS.map(s => <option key={s} value={s} />)}
        </datalist>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
          {SPLIT_SUGGESTIONS.map(s => (
            <button type="button" key={s} className="ghost small"
                    onClick={() => update('split_preference', s)}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}>
              {s}
            </button>
          ))}
        </div>
        <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>
          Free text — tell the coach how you like to organise your week. Tap a suggestion or write your own. Leave blank and the coach picks the best split for your training days.
        </div>
      </div>

      <div className="card" style={{ marginTop: '0.75rem' }}>
        <label>activities outside the gym</label>
        <textarea rows="2"
          placeholder="e.g. walk 5km daily, climb twice a week, weekend football, cycling commute"
          value={p.additional_activities || ''}
          onChange={e => update('additional_activities', e.target.value)} />
        <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>
          Your coach uses this to balance total load — fewer conditioning days if you're already active, and avoids fatiguing the same muscle groups used in your sport.
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

      <div className="row" style={{ marginTop: '1rem', gap: '0.75rem' }}>
        <button onClick={save} disabled={saving} style={{ flex: 1 }}>
          {saving ? <span className="spinner" /> : 'Save profile'}
        </button>
        <button className="primary" onClick={saveAndUpdate} disabled={saving} style={{ flex: 1 }}>
          Save & update plan →
        </button>
      </div>
    </>
  );
}
