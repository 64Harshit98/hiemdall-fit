import { useState } from 'react';
import { api } from '../lib/api.js';

export default function Login({ onAuth }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    setLoading(true);
    try {
      if (isRegister) {
        const r = await api.register(username, password);
        // New accounts are pending admin approval — no session is created.
        setNotice(r?.message || 'Registration submitted. An admin will review your account.');
        setIsRegister(false);
        setPassword('');
        return;
      }
      await api.login(username, password);
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
          {notice && <div className="notice" style={{ background: 'var(--accent-dim, rgba(120,180,255,0.12))', color: 'var(--accent)', padding: '0.6rem 0.75rem', borderRadius: '8px', fontSize: '0.85rem' }}>{notice}</div>}
          {err && <div className="error">{err}</div>}
          <button type="submit" className="primary" disabled={loading} style={{ marginTop: '0.5rem' }}>
            {loading ? <span className="spinner" /> : (isRegister ? 'create account' : 'sign in')}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.85rem' }}>
          <button className="ghost small" onClick={() => { setIsRegister(!isRegister); setErr(null); setNotice(null); }}>
            {isRegister ? '← back to sign in' : 'need an account? register →'}
          </button>
        </div>
      </div>
    </div>
  );
}
