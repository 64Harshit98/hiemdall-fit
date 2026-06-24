import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Gate every admin route: must be authenticated AND flagged is_admin in the DB
// (checked live, not from the token, so a demotion takes effect immediately).
function requireAdmin(req, res, next) {
  // Authorize against the real signed-in identity, not the impersonated one —
  // otherwise an admin impersonating a normal user couldn't reach these routes
  // (including stop-impersonate).
  const id = req.realUser?.id ?? req.user.id;
  const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(id);
  if (!row || !row.is_admin) return res.status(403).json({ error: 'admin only' });
  next();
}

router.use(requireAuth, requireAdmin);

/** List all users with their approval status. Pending first, then newest. */
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.status, u.is_admin, u.created_at,
           (SELECT COUNT(*) FROM profiles p WHERE p.user_id = u.id) AS has_profile
    FROM users u
    ORDER BY
      CASE u.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      u.id DESC
  `).all();
  res.json(users.map(u => ({
    id: u.id,
    username: u.username,
    status: u.status,
    is_admin: !!u.is_admin,
    has_profile: !!u.has_profile,
    created_at: u.created_at,
  })));
});

function setStatus(req, res, status) {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'user not found' });
  if (target.is_admin) return res.status(400).json({ error: 'cannot change an admin account' });
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
  res.json({ ok: true, id, status });
}

/** Approve a pending (or previously rejected) user. */
router.post('/users/:id/approve', (req, res) => setStatus(req, res, 'approved'));

/** Reject a user — they keep their row but cannot sign in. */
router.post('/users/:id/reject', (req, res) => setStatus(req, res, 'rejected'));

/**
 * Start impersonating a user: set a cookie that requireAuth resolves into the
 * effective identity. The whole app then operates as that user.
 */
router.post('/impersonate/:id', (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'user not found' });
  if (target.id === req.realUser.id) return res.status(400).json({ error: 'cannot impersonate yourself' });
  console.log(`[admin] impersonate START: admin '${req.realUser.username}' (${req.realUser.id}) → user '${target.username}' (${target.id})`);
  res.cookie('impersonate_id', String(target.id), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true, impersonating: { id: target.id, username: target.username } });
});

/** Stop impersonating — clear the cookie and return to the admin identity. */
router.post('/stop-impersonate', (req, res) => {
  console.log(`[admin] impersonate STOP: admin '${req.realUser.username}' (${req.realUser.id})`);
  res.clearCookie('impersonate_id');
  res.json({ ok: true });
});

/** Permanently delete a user and all their data (cascades via FKs). */
router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'user not found' });
  if (target.is_admin) return res.status(400).json({ error: 'cannot delete an admin account' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true, id });
});

export default router;
