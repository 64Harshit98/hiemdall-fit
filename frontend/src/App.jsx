import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from './lib/api.js';
import Login from './pages/Login.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Today from './pages/Today.jsx';
import History from './pages/History.jsx';
import Profile from './pages/Profile.jsx';

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

  // Logged in but no profile → force onboarding
  if (!user.has_profile && location.pathname !== '/onboarding') {
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
            <NavLink to="/" end>Today</NavLink>
            <NavLink to="/history">History</NavLink>
            <NavLink to="/profile">Profile</NavLink>
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
