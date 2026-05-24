import { useReducer, useState } from 'react';
import { api } from '../lib/api.js';
import { useNavigate } from 'react-router-dom';

const EQUIPMENT_OPTIONS = [
  'barbell', 'dumbbells', 'kettlebells', 'machines', 'cables',
  'pull-up bar', 'resistance bands', 'bench', 'bodyweight only',
];

const initial = {
  age: '', height: '', weight: '',
  experience: 'beginner',
  goal: 'muscle gain',
  days_per_week: 4,
  injuries: '',
  equipment: ['bodyweight only'],
  preferences: { liked: '', disliked: '' },
};

function reducer(state, action) {
  if (action.type === 'set') return { ...state, [action.key]: action.value };
  if (action.type === 'toggleEquip') {
    const has = state.equipment.includes(action.value);
    return { ...state, equipment: has ? state.equipment.filter(e => e !== action.value) : [...state.equipment, action.value] };
  }
  if (action.type === 'pref') return { ...state, preferences: { ...state.preferences, [action.key]: action.value } };
  return state;
}

export default function Onboarding({ onDone }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [step, setStep] = useState('form');  // 'form' | 'generating' | 'error'
  const [err, setErr] = useState(null);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    setStep('generating');
    try {
      await api.saveProfile({
        ...state,
        age: Number(state.age),
        height: Number(state.height),
        weight: Number(state.weight),
        days_per_week: Number(state.days_per_week),
      });
      await api.generatePlan('initial');
      await onDone();
      navigate('/');
    } catch (e) {
      setErr(e.message);
      setStep('form');
    }
  }

  if (step === 'generating') {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
        <div className="spinner" style={{ width: 24, height: 24 }} />
        <h2 style={{ marginTop: '1.25rem' }}>Building your plan</h2>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Consulting the coach. This usually takes 5–15 seconds.
        </p>
      </div>
    );
  }

  return (
    <>
      <h1>Tell me about you</h1>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        This shapes the first plan. You can change everything later.
      </p>

      <form onSubmit={handleSubmit} className="col" style={{ gap: '1.25rem' }}>
        <div className="card">
          <div className="row" style={{ gap: '0.75rem' }}>
            <div style={{ flex: 1 }}>
              <label>age</label>
              <input type="number" min="10" max="100" required
                     value={state.age} onChange={e => dispatch({ type: 'set', key: 'age', value: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label>height (cm)</label>
              <input type="number" min="100" max="250" required
                     value={state.height} onChange={e => dispatch({ type: 'set', key: 'height', value: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label>weight (kg)</label>
              <input type="number" min="30" max="250" step="0.1" required
                     value={state.weight} onChange={e => dispatch({ type: 'set', key: 'weight', value: e.target.value })} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="row" style={{ gap: '0.75rem' }}>
            <div style={{ flex: 1 }}>
              <label>experience</label>
              <select value={state.experience}
                      onChange={e => dispatch({ type: 'set', key: 'experience', value: e.target.value })}>
                <option value="beginner">beginner</option>
                <option value="intermediate">intermediate</option>
                <option value="advanced">advanced</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>primary goal</label>
              <select value={state.goal}
                      onChange={e => dispatch({ type: 'set', key: 'goal', value: e.target.value })}>
                <option value="muscle gain">muscle gain</option>
                <option value="fat loss">fat loss</option>
                <option value="strength">strength</option>
                <option value="endurance">endurance</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>days / week</label>
              <select value={state.days_per_week}
                      onChange={e => dispatch({ type: 'set', key: 'days_per_week', value: e.target.value })}>
                {[2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="card">
          <label>equipment available</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.25rem' }}>
            {EQUIPMENT_OPTIONS.map(opt => (
              <label key={opt} className="checkbox-row" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '0.9rem', color: 'var(--text)' }}>
                <input type="checkbox"
                       checked={state.equipment.includes(opt)}
                       onChange={() => dispatch({ type: 'toggleEquip', value: opt })} />
                {opt}
              </label>
            ))}
          </div>
        </div>

        <div className="card">
          <label>injuries or limitations</label>
          <textarea rows="2" placeholder="e.g. lower back, left shoulder impingement (leave blank if none)"
                    value={state.injuries}
                    onChange={e => dispatch({ type: 'set', key: 'injuries', value: e.target.value })} />
        </div>

        <div className="card">
          <label>favorite exercises</label>
          <textarea rows="2" placeholder="e.g. deadlifts, pull-ups"
                    value={state.preferences.liked}
                    onChange={e => dispatch({ type: 'pref', key: 'liked', value: e.target.value })} />
          <label style={{ marginTop: '0.75rem' }}>exercises to avoid</label>
          <textarea rows="2" placeholder="e.g. burpees, overhead press"
                    value={state.preferences.disliked}
                    onChange={e => dispatch({ type: 'pref', key: 'disliked', value: e.target.value })} />
        </div>

        {err && <div className="error">{err}</div>}

        <button type="submit" className="primary" style={{ padding: '0.75rem' }}>
          Generate my plan →
        </button>
      </form>
    </>
  );
}
