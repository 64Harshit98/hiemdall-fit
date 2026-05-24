import { useState } from 'react';
import { api } from '../lib/api.js';

export default function Login({ onAuth }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      if (isRegister) await api.register(username, password);
      else await api.login(username, password);
      await onAuth();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>heimdall<span style={{ color: 'var(--accent)' }}>·</span>fit</h1>
        <div className="subtitle">{isRegister ? 'create an account' : 'welcome back'}</div>

        <form onSubmit={handleSubmit} className="col">
          <div>
            <label>username</label>
            <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoFocus required />
          </div>
          <div>
            <label>password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                   autoComplete={isRegister ? 'new-password' : 'current-password'}
                   minLength={6} required />
          </div>
          {err && <div className="error">{err}</div>}
          <button type="submit" className="primary" disabled={loading} style={{ marginTop: '0.5rem' }}>
            {loading ? <span className="spinner" /> : (isRegister ? 'create account' : 'sign in')}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.85rem' }}>
          <button className="ghost small" onClick={() => { setIsRegister(!isRegister); setErr(null); }}>
            {isRegister ? '← back to sign in' : 'need an account? register →'}
          </button>
        </div>
      </div>
    </div>
  );
}
