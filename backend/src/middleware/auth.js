import jwt from 'jsonwebtoken';
import db from '../db/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // req.realUser is always the signed-in identity (used for authorization);
  // req.user is the *effective* identity that data routes scope by.
  req.realUser = decoded;
  req.user = decoded;

  // Admin impersonation: when a signed-in admin carries a valid impersonate
  // cookie, every downstream route (which scopes by req.user.id) transparently
  // operates as the target user. Admin status is checked live so a demotion
  // immediately disables it.
  const impersonateId = Number(req.cookies?.impersonate_id);
  if (impersonateId) {
    const me = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(decoded.id);
    const target = me?.is_admin
      ? db.prepare('SELECT id, username FROM users WHERE id = ?').get(impersonateId)
      : null;
    if (target) {
      req.user = { id: target.id, username: target.username };
      req.impersonating = true;
    }
  }

  next();
}
