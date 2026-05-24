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
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
  const userId = result.lastInsertRowid;

  const token = signToken({ id: userId, username });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  res.json({ id: userId, username });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'credentials required' });

  const row = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
  if (!row) return res.status(401).json({ error: 'invalid credentials' });

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

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
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'user not found' });
  // Also report whether they have a profile yet (drives onboarding redirect)
  const profile = db.prepare('SELECT user_id FROM profiles WHERE user_id = ?').get(req.user.id);
  res.json({ ...row, has_profile: !!profile });
});

export default router;
