import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';

export default function ExerciseRow({ exercise, planId, dayIndex, existingLogs, isComplete, onLogged }) {
  const [open, setOpen] = useState(!isComplete);
  const [sets, setSets] = useState([]);
  const [notes, setNotes] = useState('');
  const [savingIdx, setSavingIdx] = useState(null);

  // Initialise sets state from existing logs, padding to exercise.sets
  useEffect(() => {
    const arr = Array.from({ length: exercise.sets }, (_, i) => {
      const log = existingLogs.find(l => l.set_index === i);
      return {
        weight: log?.weight ?? '',
        reps: log?.reps ?? '',
        done: !!log,
      };
    });
    setSets(arr);
    const noteLog = existingLogs.find(l => l.notes);
    if (noteLog?.notes) setNotes(noteLog.notes);
  }, [exercise.sets, JSON.stringify(existingLogs)]);

  async function saveSet(i) {
    setSavingIdx(i);
    try {
      const s = sets[i];
      await api.logSet({
        plan_id: planId,
        day_index: dayIndex,
        exercise_name: exercise.name,
        set_index: i,
        weight: s.weight === '' ? null : Number(s.weight),
        reps: s.reps === '' ? null : Number(s.reps),
        notes: i === 0 ? notes : null,
      });
      setSets(prev => prev.map((x, idx) => idx === i ? { ...x, done: true } : x));
      onLogged();
    } catch (e) {
      alert('Failed to save: ' + e.message);
    } finally {
      setSavingIdx(null);
    }
  }

  function updateSet(i, key, value) {
    setSets(prev => prev.map((x, idx) => idx === i ? { ...x, [key]: value } : x));
  }

  return (
    <div className={`exercise ${isComplete ? 'done' : ''}`}>
      <div className="exercise-head" onClick={() => setOpen(!open)}>
        <div>
          <div className="exercise-name">{exercise.name}</div>
          <div className="exercise-prescription">
            {exercise.sets} × {exercise.reps}
            {exercise.target_weight && ` · ${exercise.target_weight}`}
            {exercise.rest_seconds ? ` · rest ${exercise.rest_seconds}s` : ''}
          </div>
        </div>
        <div className="muted small">{isComplete ? '✓' : open ? '▾' : '▸'}</div>
      </div>

      {exercise.form_tip && open && (
        <div className="form-tip">{exercise.form_tip}</div>
      )}

      {open && (
        <div style={{ marginTop: '0.75rem' }}>
          <div className="set-grid">
            <div className="set-label">set</div>
            <div className="set-label">weight</div>
            <div className="set-label">reps</div>
            <div></div>
          </div>
          {sets.map((s, i) => (
            <div className="set-grid" key={i}>
              <div className="set-label mono">{i + 1}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <input
                  type="number" step="2.5" inputMode="decimal" placeholder="kg"
                  value={s.weight}
                  onChange={e => updateSet(i, 'weight', e.target.value)}
                />
                <div style={{ display: 'flex', gap: '0.2rem' }}>
                  <button type="button" className="ghost small"
                    style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.7rem', minWidth: 0 }}
                    onClick={() => updateSet(i, 'weight', Math.max(0, (Number(s.weight) || 0) - 2.5))}>
                    −2.5
                  </button>
                  <button type="button" className="ghost small"
                    style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.7rem', minWidth: 0 }}
                    onClick={() => updateSet(i, 'weight', (Number(s.weight) || 0) + 2.5)}>
                    +2.5
                  </button>
                  <button type="button" className="ghost small"
                    style={{ flex: 1, padding: '0.1rem 0', fontSize: '0.7rem', minWidth: 0 }}
                    onClick={() => updateSet(i, 'weight', (Number(s.weight) || 0) + 5)}>
                    +5
                  </button>
                </div>
              </div>
              <input
                type="number" inputMode="numeric" placeholder={exercise.reps}
                value={s.reps}
                onChange={e => updateSet(i, 'reps', e.target.value)}
              />
              <button
                className={`complete-toggle ${s.done ? 'checked' : ''}`}
                onClick={() => saveSet(i)}
                disabled={savingIdx === i}
                title="Save set"
              >
                {savingIdx === i ? '…' : s.done ? '✓' : ''}
              </button>
            </div>
          ))}
          <textarea
            rows="1"
            placeholder="notes (optional) — e.g. felt strong, left knee twinge"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => { if (notes !== '') saveSet(0); }}
            style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
          />
        </div>
      )}
    </div>
  );
}
