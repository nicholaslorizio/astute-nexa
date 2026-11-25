'use strict';
const crypto = require('node:crypto');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const DEFAULT_COOKIE = 'nexa_sid';
// Stored in place of a password hash for people who only sign in with Google or Apple. It never matches a password.
const SSO_ONLY = 'sso$none';
const ROLES = ['owner', 'admin', 'member', 'guest'];
const RANK = { guest: 0, member: 1, admin: 2, owner: 3 };

const id = (prefix) => prefix + '_' + crypto.randomBytes(12).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [algo, N, r, p, saltB64, keyB64] = stored.split('$');
    if (algo !== 'scrypt') return false;
    const key = Buffer.from(keyB64, 'base64');
    const test = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), key.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(key, test);
  } catch { return false; }
}
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 200) return 'Use at most 200 characters.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9\W_]/.test(pw)) return 'Mix letters with numbers or symbols.';
  return null;
}
const validEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Simple fixed-window limiter, keyed by string. */
function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || now > h.reset) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    h.n++;
    if (hits.size > 10000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    return h.n <= max;
  };
}

function createAuth(store, { secureCookies, cookieName }) {
  const { one, run } = store;
  const COOKIE = cookieName || DEFAULT_COOKIE;

  function createSession(userId, ua) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)',
      sha256(token), userId, now, now + SESSION_TTL_MS, String(ua || '').slice(0, 200));
    run('UPDATE users SET last_login = ? WHERE id = ?', now, userId);
    return token;
  }
  function cookieFor(token, maxAgeMs) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secureCookies ? '; Secure' : ''}`;
  }
  function userFromToken(token) {
    if (!token) return null;
    const row = one(`SELECT u.id, u.email, u.name, u.role, u.status, u.title, s.expires_at
                     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha256(token));
    if (!row || row.expires_at < Date.now() || row.status !== 'active') return null;
    return { id: row.id, email: row.email, name: row.name, role: row.role, title: row.title };
  }
  function userFromRequest(req) {
    return userFromToken(parseCookies(req.headers.cookie)[COOKIE]);
  }
  function destroySession(req) {
    const t = parseCookies(req.headers.cookie)[COOKIE];
    if (t) run('DELETE FROM sessions WHERE token_hash = ?', sha256(t));
  }
  function destroyUserSessions(userId) { run('DELETE FROM sessions WHERE user_id = ?', userId); }

  // Express middleware
  function attach(req, _res, next) { req.user = userFromRequest(req); next(); }
  function requireUser(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Sign in first.' });
    next();
  }
  const requireRole = (min) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in first.' });
    if (RANK[req.user.role] < RANK[min]) return res.status(403).json({ error: 'Your role does not allow this.' });
    next();
  };
  return { createSession, cookieFor, userFromToken, userFromRequest, destroySession, destroyUserSessions, attach, requireUser, requireRole, COOKIE, SESSION_TTL_MS };
}

module.exports = { SSO_ONLY, createAuth, hashPassword, verifyPassword, passwordProblem, validEmail, id, sha256, rateLimiter, parseCookies, ROLES, RANK };
