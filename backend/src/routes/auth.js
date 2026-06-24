import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: 'username and password (min 6 chars) required' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'username taken' });

  const hash = await bcrypt.hash(password, 12);
  // New accounts start pending — an admin must approve before the user can sign
  // in. No auth token is issued here.
  db.prepare("INSERT INTO users (username, password_hash, status, is_admin) VALUES (?, ?, 'pending', 0)").run(username, hash);

  res.json({ pending: true, message: 'Registration submitted. An admin will review your account before you can sign in.' });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'credentials required' });

  const row = db.prepare('SELECT id, username, password_hash, status FROM users WHERE username = ?').get(username);
  if (!row) return res.status(401).json({ error: 'invalid credentials' });

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  // Approval gate — only approved accounts may sign in.
  if (row.status === 'pending') {
    return res.status(403).json({ error: 'Your account is awaiting admin approval.' });
  }
  if (row.status === 'rejected') {
    return res.status(403).json({ error: 'Your account request was declined. Contact the admin.' });
  }

  const token = signToken({ id: row.id, username: row.username });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  res.json({ id: row.id, username: row.username });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.clearCookie('impersonate_id');
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'user not found' });
  // Also report whether they have a profile yet (drives onboarding redirect)
  const profile = db.prepare('SELECT user_id FROM profiles WHERE user_id = ?').get(req.user.id);
  const resp = { id: row.id, username: row.username, is_admin: !!row.is_admin, has_profile: !!profile };
  // When impersonating, surface the real admin identity so the UI can show a banner.
  if (req.impersonating) {
    resp.impersonating = true;
    resp.real_user = { id: req.realUser.id, username: req.realUser.username };
  }
  res.json(resp);
});

export default router;
