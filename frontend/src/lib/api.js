const BASE = '/api';

async function request(path, opts = {}) {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // auth
  register: (username, password) => request('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),

  // profile
  getProfile: () => request('/profile'),
  saveProfile: (data) => request('/profile', { method: 'PUT', body: JSON.stringify(data) }),

  // plans
  generatePlan: (mode = 'initial') => request('/plans/generate', { method: 'POST', body: JSON.stringify({ mode }) }),
  getCurrentPlan: () => request('/plans/current'),
  advanceDay: () => request('/plans/advance', { method: 'POST' }),
  markRestDay: () => request('/plans/mark-rest', { method: 'POST' }),
  planHistory: () => request('/plans/history'),

  // logs
  logSet: (data) => request('/logs/set', { method: 'POST', body: JSON.stringify(data) }),
  saveSessionStats: (data) => request('/logs/session-stats', { method: 'POST', body: JSON.stringify(data) }),
  uploadAppleHealth: (file, sessionDate) => {
    const fd = new FormData();
    fd.append('file', file);
    if (sessionDate) fd.append('session_date', sessionDate);
    return fetch(BASE + '/logs/apple-health', {
      method: 'POST', credentials: 'include', body: fd,
    }).then(async r => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'upload failed');
      return r.json();
    });
  },
  history: () => request('/logs/history'),
};
