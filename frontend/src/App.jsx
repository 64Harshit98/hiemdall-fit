import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from './lib/api.js';
import Login from './pages/Login.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Today from './pages/Today.jsx';
import History from './pages/History.jsx';
import Profile from './pages/Profile.jsx';
import Admin from './pages/Admin.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  async function refresh() {
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleLogout() {
    await api.logout();
    setUser(null);
    navigate('/login');
  }

  if (loading) {
    return (
      <div className="auth-wrap">
        <div className="muted small"><span className="spinner" /> &nbsp; loading</div>
      </div>
    );
  }

  // Not logged in: only /login is reachable
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login onAuth={refresh} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Logged in but no profile → force onboarding (admins skip onboarding)
  if (!user.has_profile && !user.is_admin && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <Link to="/" className="logo">
            heimdall<span className="accent">·</span>fit
          </Link>
          <nav className="nav">
            <div className="nav-links">
              <NavLink to="/" end>Today</NavLink>
              <NavLink to="/history">History</NavLink>
              <NavLink to="/profile">Profile</NavLink>
              {user.is_admin && <NavLink to="/admin">Admin</NavLink>}
            </div>
            <button className="ghost small" onClick={handleLogout} style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>
              {user.username} ↗
            </button>
          </nav>
        </div>
      </header>

      <main className="container">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/onboarding" element={<Onboarding onDone={refresh} />} />
          <Route path="/history" element={<History />} />
          <Route path="/profile" element={<Profile />} />
          {user.is_admin && <Route path="/admin" element={<Admin />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="bottom-nav">
        <NavLink to="/" end className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span>Today</span>
        </NavLink>
        <NavLink to="/history" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>History</span>
        </NavLink>
        <NavLink to="/profile" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>Profile</span>
        </NavLink>
      </nav>
    </>
  );
}
