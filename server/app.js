'use strict';
const PKG = require('../package.json');
// AGPL-3.0 section 13: people who use Nexa over a network must be offered its source code.
const SOURCE_URL = process.env.NEXA_SOURCE_URL || String((PKG.repository && (PKG.repository.url || PKG.repository)) || '').replace(/^git\+/, '').replace(/\.git$/, '') || null;
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { openDb } = require('./db');
const A = require('./auth');
const { sanitizeDocHtml, plainText } = require('./sanitize');
const { htmlToDocx, docxToHtml } = require('./convert/docx');
const { gridToXlsx, xlsxToGrid, gridToCsv, csvToGrid } = require('./convert/xlsx');
const { deckToPptx, pptxToDeck } = require('./convert/pptx');
const { attachHuddle } = require('./huddle');
const { attachRelayCadence } = require('./relay-cadence');
const { attachVault } = require('./vault');
const seed = require('./seed');

const KINDS = ['doc', 'sheet', 'deck', 'folder', 'upload'];
const MAX_CONTENT = 25 * 1024 * 1024; // 25 MB per file
const VERSION_EVERY_MS = 5 * 60 * 1000;
const PERM_RANK = { none: 0, view: 1, edit: 2, owner: 3 };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);

function createServer(opts = {}) {
  let vault = null;
  const maxUpload = opts.maxUpload || 100 * 1024 * 1024; // uploads to Vault, 100 MB unless set
  const store = openDb(opts.dbPath || path.join(__dirname, '..', 'data', 'nexa.db'));
  const { one, all, run, tx } = store;
  const auth = A.createAuth(store, { secureCookies: !!opts.secureCookies, cookieName: opts.cookieName });
  const linkBase = opts.linkBase || ''; // '/w/<name>' when this workspace is one of many on a cloud host
  const loginLimit = A.rateLimiter(10, 15 * 60 * 1000);
  const app = express();
  app.disable('x-powered-by');
  if (opts.trustProxy) app.set('trust proxy', 1);

  const audit = (req, action, target, detail) => run('INSERT INTO audit (at, user_id, action, target, detail, ip) VALUES (?,?,?,?,?,?)',
    Date.now(), req.user ? req.user.id : null, action, target || null, detail ? JSON.stringify(detail).slice(0, 2000) : null, req.ip || null);

  // ---------- security headers ----------
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:", "media-src 'self' blob:", "connect-src 'self' ws: wss:",
      "font-src 'self' data:", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
    ].join('; '));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=()');
    if (opts.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // ---------- CSRF: mutating API calls need our header and a same-origin Origin ----------
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-nexa-csrf') !== '1') return res.status(403).json({ error: 'Missing request header.' });
    const origin = req.get('origin');
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-site request blocked.' }); } catch { return res.status(403).json({ error: 'Bad origin.' }); }
    }
    next();
  });
  app.use(auth.attach);
  app.use('/api/import', express.raw({ type: () => true, limit: MAX_CONTENT }));
  app.use('/api/upload', express.raw({ type: () => true, limit: maxUpload }));
  app.use('/api', express.json({ limit: MAX_CONTENT }));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const userCount = () => one('SELECT COUNT(*) AS n FROM users').n;
  const workspaceName = () => (one("SELECT v FROM meta WHERE k = 'workspace'") || {}).v || 'Astute Nexa';
  const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, role: u.role, title: u.title || '' });

  // ---------- session & setup ----------
  app.get('/api/state', (req, res) => {
    res.json({ setupNeeded: userCount() === 0, workspace: workspaceName(), user: publicUser(req.user), sourceUrl: SOURCE_URL, version: PKG.version,
      linkBase, sso: opts.ssoProviders || [], cloud: opts.cloud || null });
  });

  app.post('/api/setup', wrap(async (req, res) => {
    if (opts.setupGate && !opts.setupGate(req)) throw new HttpError(403, 'Create a workspace from the start page.');
    const { workspace, name, email, password, sampleContent } = req.body || {};
    if (!A.validEmail(email)) throw bad('Enter a valid email.');
    const pw = A.passwordProblem(password); if (pw) throw bad(pw);
    if (!name || !String(name).trim()) throw bad('Enter your name.');
    const uid = A.id('u');
    tx(() => {
      if (userCount() > 0) throw new HttpError(409, 'This workspace is already set up.');
      run("INSERT OR REPLACE INTO meta (k, v) VALUES ('workspace', ?)", plainText(workspace || 'Astute Nexa', 80));
      run('INSERT INTO users (id, email, name, pass_hash, role, created_at) VALUES (?,?,?,?,?,?)', uid, email.trim(), plainText(name, 80).trim(), A.hashPassword(password), 'owner', Date.now());
      run("INSERT OR REPLACE INTO meta (k, v) VALUES ('join_token', ?)", require('node:crypto').randomBytes(18).toString('base64url'));
      run("INSERT OR REPLACE INTO meta (k, v) VALUES ('join_enabled', '1')");
      run("INSERT OR REPLACE INTO meta (k, v) VALUES ('plan', 'free')");
      seed.channels(store, uid);
      if (sampleContent !== false) seed.files(store, uid);
    });
    req.user = { id: uid };
    audit(req, 'workspace.setup', uid);
    const token = auth.createSession(uid, req.get('user-agent'));
    res.setHeader('Set-Cookie', auth.cookieFor(token, auth.SESSION_TTL_MS));
    res.json({ ok: true });
  }));

  app.post('/api/login', wrap(async (req, res) => {
    const { email, password } = req.body || {};
    const key = (req.ip || '') + '|' + String(email || '').toLowerCase();
    if (!loginLimit(key)) throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
    const u = one('SELECT * FROM users WHERE email = ?', String(email || '').trim());
    if (!u || u.status !== 'active' || !A.verifyPassword(String(password || ''), u.pass_hash)) {
      req.user = u ? { id: u.id } : null;
      audit(req, 'auth.login_failed', null, { email: String(email || '').slice(0, 120) });
      throw new HttpError(401, 'Email or password is wrong.');
    }
    const token = auth.createSession(u.id, req.get('user-agent'));
    req.user = u;
    audit(req, 'auth.login', u.id);
    res.setHeader('Set-Cookie', auth.cookieFor(token, auth.SESSION_TTL_MS));
    res.json({ ok: true, user: publicUser(u) });
  }));

  app.post('/api/logout', (req, res) => {
    auth.destroySession(req);
    res.setHeader('Set-Cookie', auth.cookieFor('', 0));
    res.json({ ok: true });
  });

  app.get('/api/me', auth.requireUser, (req, res) => res.json({ user: publicUser(req.user), workspace: workspaceName() }));
  app.patch('/api/me', auth.requireUser, wrap(async (req, res) => {
    const { name, title, currentPassword, newPassword } = req.body || {};
    if (name !== undefined) { if (!String(name).trim()) throw bad('Name cannot be empty.'); run('UPDATE users SET name = ? WHERE id = ?', plainText(name, 80).trim(), req.user.id); }
    if (title !== undefined) run('UPDATE users SET title = ? WHERE id = ?', plainText(title, 80), req.user.id);
    if (newPassword !== undefined) {
      const u = one('SELECT pass_hash FROM users WHERE id = ?', req.user.id);
      if (u.pass_hash !== A.SSO_ONLY && !A.verifyPassword(String(currentPassword || ''), u.pass_hash)) throw new HttpError(403, 'Current password is wrong.');
      const p = A.passwordProblem(newPassword); if (p) throw bad(p);
      run('UPDATE users SET pass_hash = ? WHERE id = ?', A.hashPassword(newPassword), req.user.id);
      auth.destroyUserSessions(req.user.id);
      const token = auth.createSession(req.user.id, req.get('user-agent'));
      res.setHeader('Set-Cookie', auth.cookieFor(token, auth.SESSION_TTL_MS));
      audit(req, 'auth.password_changed', req.user.id);
    }
    res.json({ user: publicUser(one('SELECT * FROM users WHERE id = ?', req.user.id)) });
  }));

  // ---------- people & admin ----------
  app.get('/api/users', auth.requireUser, (req, res) => {
    const rows = all('SELECT id, email, name, role, title, status, last_login, created_at FROM users ORDER BY name COLLATE NOCASE');
    const admin = A.RANK[req.user.role] >= A.RANK.admin;
    res.json({ users: rows.filter((u) => admin || u.status === 'active').map((u) => (admin ? u : { id: u.id, email: u.email, name: u.name, role: u.role, title: u.title })) });
  });

  app.post('/api/invites', auth.requireRole('admin'), (req, res) => {
    const { email, role } = req.body || {};
    if (!A.validEmail(email)) throw bad('Enter a valid email.');
    if (!['admin', 'member', 'guest'].includes(role)) throw bad('Pick a role: admin, member or guest.');
    if (role === 'admin' && req.user.role !== 'owner') throw new HttpError(403, 'Only an owner can invite admins.');
    if (one('SELECT id FROM users WHERE email = ?', email.trim())) throw new HttpError(409, 'That person already has an account.');
    const token = require('node:crypto').randomBytes(24).toString('base64url');
    run('INSERT INTO invites (token_hash, email, role, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?)',
      A.sha256(token), email.trim(), role, req.user.id, Date.now(), Date.now() + 7 * 86400000);
    audit(req, 'user.invited', email.trim(), { role });
    res.json({ token, path: `${linkBase}/#/invite/${token}`, expiresInDays: 7 });
  });
  app.get('/api/invites/:token', (req, res) => {
    const inv = one('SELECT email, role, expires_at, used_at FROM invites WHERE token_hash = ?', A.sha256(req.params.token));
    if (!inv || inv.used_at || inv.expires_at < Date.now()) return res.status(404).json({ error: 'This invite link is not valid any more.' });
    res.json({ email: inv.email, role: inv.role, workspace: workspaceName() });
  });
  app.post('/api/invites/:token/accept', wrap(async (req, res) => {
    const { name, password } = req.body || {};
    const p = A.passwordProblem(password); if (p) throw bad(p);
    if (!name || !String(name).trim()) throw bad('Enter your name.');
    const th = A.sha256(req.params.token);
    const uid = A.id('u');
    tx(() => {
      const inv = one('SELECT * FROM invites WHERE token_hash = ?', th);
      if (!inv || inv.used_at || inv.expires_at < Date.now()) throw new HttpError(404, 'This invite link is not valid any more.');
      if (one('SELECT id FROM users WHERE email = ?', inv.email)) throw new HttpError(409, 'That person already has an account.');
      run('INSERT INTO users (id, email, name, pass_hash, role, created_at) VALUES (?,?,?,?,?,?)', uid, inv.email, plainText(name, 80).trim(), A.hashPassword(password), inv.role, Date.now());
      run('UPDATE invites SET used_at = ? WHERE token_hash = ?', Date.now(), th);
      if (inv.role !== 'guest') {
        for (const c of all("SELECT id FROM channels WHERE kind = 'public' AND archived = 0 AND name = 'general'")) {
          run('INSERT OR IGNORE INTO channel_members (channel_id, user_id, joined_at) VALUES (?,?,?)', c.id, uid, Date.now());
        }
      }
    });
    req.user = { id: uid };
    audit(req, 'user.joined', uid);
    const token = auth.createSession(uid, req.get('user-agent'));
    res.setHeader('Set-Cookie', auth.cookieFor(token, auth.SESSION_TTL_MS));
    res.json({ ok: true });
  }));

  app.patch('/api/users/:id', auth.requireRole('admin'), (req, res) => {
    const target = one('SELECT * FROM users WHERE id = ?', req.params.id);
    if (!target) throw new HttpError(404, 'No such person.');
    const { role, status } = req.body || {};
    const owners = one("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND status = 'active'").n;
    if (target.role === 'owner' && req.user.role !== 'owner') throw new HttpError(403, 'Only an owner can change another owner.');
    if (role !== undefined) {
      if (!A.ROLES.includes(role)) throw bad('Unknown role.');
      if ((role === 'owner' || role === 'admin') && req.user.role !== 'owner') throw new HttpError(403, 'Only an owner can grant admin or owner.');
      if (target.role === 'owner' && role !== 'owner' && owners <= 1) throw new HttpError(409, 'The workspace needs at least one owner.');
      run('UPDATE users SET role = ? WHERE id = ?', role, target.id);
    }
    if (status !== undefined) {
      if (!['active', 'disabled'].includes(status)) throw bad('Unknown status.');
      if (target.id === req.user.id && status === 'disabled') throw bad('You cannot disable yourself.');
      if (target.role === 'owner' && status === 'disabled' && owners <= 1) throw new HttpError(409, 'The workspace needs at least one owner.');
      run('UPDATE users SET status = ? WHERE id = ?', status, target.id);
      if (status === 'disabled') { auth.destroyUserSessions(target.id); huddle.kick(target.id); }
    }
    audit(req, 'user.updated', target.id, { role, status });
    res.json({ ok: true });
  });

  app.get('/api/audit', auth.requireRole('admin'), (req, res) => {
    const before = +req.query.before || Date.now() + 1;
    res.json({ events: all(`SELECT a.*, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.at < ? ORDER BY a.at DESC LIMIT 200`, before) });
  });

  // ---------- files ----------
  // A file in the trash, or inside a folder in the trash, is closed to everyone but its owner
  // until the owner puts it back.
  function filePerm(user, file) {
    if (!file || !user) return 'none';
    if (file.owner_id === user.id) return 'owner';
    let best = 'none';
    let cur = file;
    for (let depth = 0; cur && depth < 32; depth++) {
      if (cur.owner_id === user.id) return 'owner';
      const trashed = cur.trashed !== undefined ? cur.trashed : (one('SELECT trashed FROM files WHERE id = ?', cur.id) || {}).trashed;
      if (trashed) return 'none';
      const s = one('SELECT perm FROM file_shares WHERE file_id = ? AND user_id = ?', cur.id, user.id);
      if (s && PERM_RANK[s.perm] > PERM_RANK[best]) best = s.perm;
      if (user.role !== 'guest' && PERM_RANK[cur.workspace_perm] > PERM_RANK[best]) best = cur.workspace_perm;
      cur = cur.parent_id ? one('SELECT id, owner_id, parent_id, workspace_perm, trashed FROM files WHERE id = ?', cur.parent_id) : null;
    }
    return best;
  }
  function loadFile(req, min) {
    const f = one('SELECT * FROM files WHERE id = ?', req.params.id);
    if (!f) throw new HttpError(404, 'File not found.');
    const perm = filePerm(req.user, f);
    if (PERM_RANK[perm] < PERM_RANK[min]) throw new HttpError(perm === 'none' ? 404 : 403, perm === 'none' ? 'File not found.' : 'You can view this file but not change it.');
    return { f, perm };
  }
  const meta = (f, perm, extra = {}) => ({
    id: f.id, kind: f.kind, title: f.title, owner_id: f.owner_id, owner_name: f.owner_name, parent_id: f.parent_id,
    mime: f.mime, size: f.size, version: f.version, starred: !!f.starred, trashed: !!f.trashed,
    workspace_perm: f.workspace_perm, created_at: f.created_at, updated_at: f.updated_at, updated_by: f.updated_by, perm, ...extra,
  });
  function cleanContent(kind, content) {
    if (kind === 'doc') {
      const c = typeof content === 'object' && content ? content : { html: String(content || '') };
      return JSON.stringify({ html: sanitizeDocHtml(c.html || '') });
    }
    if (kind === 'sheet' || kind === 'deck') {
      const s = typeof content === 'string' ? content : JSON.stringify(content || {});
      JSON.parse(s);
      if (kind === 'deck') return JSON.stringify(cleanDeck(JSON.parse(s)));
      return s;
    }
    return null;
  }
  function cleanDeck(d) {
    const slides = Array.isArray(d.slides) ? d.slides.slice(0, 500) : [];
    return {
      theme: typeof d.theme === 'string' ? d.theme.slice(0, 30) : 'aurora',
      slides: slides.map((s) => ({
        id: String(s.id || '').slice(0, 40), bg: typeof s.bg === 'string' ? s.bg.slice(0, 20) : undefined,
        notes: plainText(s.notes, 20000), transition: typeof s.transition === 'string' ? s.transition.slice(0, 20) : undefined,
        elements: (Array.isArray(s.elements) ? s.elements : []).slice(0, 200).map((e) => ({
          id: String(e.id || '').slice(0, 40), type: ['text', 'shape', 'image'].includes(e.type) ? e.type : 'text',
          x: +e.x || 0, y: +e.y || 0, w: +e.w || 100, h: +e.h || 50, r: +e.r || 0,
          text: e.text !== undefined ? plainText(e.text, 20000) : undefined,
          src: typeof e.src === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(e.src) ? e.src : undefined,
          style: e.style && typeof e.style === 'object' ? JSON.parse(JSON.stringify(e.style)) : {},
        })),
      })),
    };
  }
  const defaultContent = (kind) => ({
    doc: JSON.stringify({ html: '<h1>Untitled document</h1><p></p>' }),
    sheet: JSON.stringify({ sheets: [{ name: 'Sheet1', cells: {} }] }),
    deck: JSON.stringify({ theme: 'aurora', slides: [{ id: 's1', elements: [
      { id: 'e1', type: 'text', x: 80, y: 190, w: 800, h: 90, text: 'Your big idea', style: { size: 60, bold: true } },
      { id: 'e2', type: 'text', x: 80, y: 290, w: 800, h: 50, text: 'Click to add a subtitle', style: { size: 26, color: '#9AA3C7' } },
    ] }] }),
  })[kind] ?? null;

  function insertFile(user, { kind, title, parent_id, content, blob, mime, size }) {
    if (!KINDS.includes(kind)) throw bad('Unknown file type.');
    if (user.role === 'guest' && !parent_id) throw new HttpError(403, 'Guests can only add files inside folders shared with them.');
    if (parent_id) {
      const parent = one('SELECT * FROM files WHERE id = ?', parent_id);
      if (!parent || parent.kind !== 'folder' || PERM_RANK[filePerm(user, parent)] < PERM_RANK.edit) throw new HttpError(403, 'You cannot add files to that folder.');
    }
    const fid = A.id('f');
    const now = Date.now();
    const body = content !== undefined && content !== null ? cleanContent(kind, content) : defaultContent(kind);
    run(`INSERT INTO files (id, kind, title, owner_id, parent_id, content, blob, mime, size, created_at, updated_at, updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, fid, kind, plainText(title || 'Untitled', 200).trim() || 'Untitled', user.id, parent_id || null,
      body, blob || null, mime || null, size || (body ? Buffer.byteLength(body) : 0), now, now, user.id);
    return one('SELECT * FROM files WHERE id = ?', fid);
  }

  app.get('/api/files', auth.requireUser, (req, res) => {
    const u = req.user;
    const view = req.query.view || 'mine';
    const base = `SELECT f.id, f.kind, f.title, f.owner_id, u.name AS owner_name, f.parent_id, f.mime, f.size, f.version, f.starred,
                  f.trashed, f.workspace_perm, f.created_at, f.updated_at, f.updated_by FROM files f JOIN users u ON u.id = f.owner_id`;
    let rows;
    if (view === 'trash') rows = all(`${base} WHERE f.owner_id = ? AND f.trashed = 1 ORDER BY f.updated_at DESC`, u.id);
    else if (view === 'shared') rows = all(`${base} WHERE f.trashed = 0 AND f.owner_id != ? AND (f.id IN (SELECT file_id FROM file_shares WHERE user_id = ?) OR (f.workspace_perm != 'none' AND ? != 'guest')) ORDER BY f.updated_at DESC`, u.id, u.id, u.role)
      .filter((f) => filePerm(u, f) !== 'none'); // leaves out files inside a folder in the trash
    else if (view === 'recent') rows = all(`${base} WHERE f.trashed = 0 AND f.kind != 'folder' ORDER BY f.updated_at DESC LIMIT 400`).filter((f) => filePerm(u, f) !== 'none').slice(0, 40);
    else if (view === 'starred') rows = all(`${base} WHERE f.trashed = 0 AND f.starred = 1 AND f.owner_id = ? ORDER BY f.updated_at DESC`, u.id);
    else if (req.query.parent) {
      const parent = one('SELECT * FROM files WHERE id = ?', req.query.parent);
      if (!parent || filePerm(u, parent) === 'none') throw new HttpError(404, 'Folder not found.');
      rows = all(`${base} WHERE f.trashed = 0 AND f.parent_id = ? ORDER BY f.kind = 'folder' DESC, f.title COLLATE NOCASE`, parent.id);
    } else rows = all(`${base} WHERE f.trashed = 0 AND f.owner_id = ? AND f.parent_id IS NULL ORDER BY f.kind = 'folder' DESC, f.updated_at DESC`, u.id);
    if (req.query.kind) rows = rows.filter((f) => f.kind === req.query.kind);
    rows = rows.filter((f) => !(f.title.startsWith('._') || ['.DS_Store', 'desktop.ini', 'Thumbs.db'].includes(f.title)));
    res.json({ files: rows.map((f) => meta(f, filePerm(u, f))) });
  });

  app.post('/api/files', auth.requireUser, (req, res) => {
    const f = insertFile(req.user, req.body || {});
    audit(req, 'file.created', f.id, { kind: f.kind });
    res.status(201).json({ file: meta(f, 'owner') });
  });

  app.get('/api/files/:id', auth.requireUser, (req, res) => {
    const { f, perm } = loadFile(req, 'view');
    const owner = one('SELECT name FROM users WHERE id = ?', f.owner_id);
    const crumbs = [];
    let p = f.parent_id ? one('SELECT id, title, parent_id, owner_id, workspace_perm FROM files WHERE id = ?', f.parent_id) : null;
    while (p && crumbs.length < 32) { if (filePerm(req.user, p) !== 'none') crumbs.unshift({ id: p.id, title: p.title }); p = p.parent_id ? one('SELECT id, title, parent_id, owner_id, workspace_perm FROM files WHERE id = ?', p.parent_id) : null; }
    res.json({ file: meta({ ...f, owner_name: owner && owner.name }, perm, { crumbs }), content: f.content ? JSON.parse(f.content) : null });
  });

  app.put('/api/files/:id', auth.requireUser, (req, res) => {
    const { f } = loadFile(req, 'edit');
    if (!['doc', 'sheet', 'deck'].includes(f.kind)) throw bad('Only documents, grids and decks have editable content.');
    const { content, baseVersion, title } = req.body || {};
    if (baseVersion !== undefined && +baseVersion !== f.version) {
      const by = one('SELECT name FROM users WHERE id = ?', f.updated_by);
      return res.status(409).json({ error: `${by ? by.name : 'Someone'} saved a newer version. Reload to see it.`, version: f.version });
    }
    const body = cleanContent(f.kind, content);
    const now = Date.now();
    tx(() => {
      const last = one('SELECT created_at FROM file_versions WHERE file_id = ? ORDER BY version DESC LIMIT 1', f.id);
      if (!last || now - last.created_at > VERSION_EVERY_MS || f.updated_by !== req.user.id) {
        run('INSERT INTO file_versions (file_id, version, title, content, created_at, created_by) VALUES (?,?,?,?,?,?)', f.id, f.version, f.title, f.content, f.updated_at, f.updated_by);
        run('DELETE FROM file_versions WHERE file_id = ? AND id NOT IN (SELECT id FROM file_versions WHERE file_id = ? ORDER BY version DESC LIMIT 100)', f.id, f.id);
      }
      run('UPDATE files SET content = ?, size = ?, version = version + 1, updated_at = ?, updated_by = ?, title = COALESCE(?, title) WHERE id = ?',
        body, Buffer.byteLength(body), now, req.user.id, title !== undefined ? plainText(title, 200).trim() || 'Untitled' : null, f.id);
    });
    const nf = one('SELECT * FROM files WHERE id = ?', f.id);
    huddle.notifyFile(nf.id, { t: 'file.saved', id: nf.id, version: nf.version, by: req.user.id, byName: req.user.name });
    res.json({ version: nf.version, updated_at: nf.updated_at });
  });

  app.patch('/api/files/:id', auth.requireUser, (req, res) => {
    const b = req.body || {};
    const { f, perm } = loadFile(req, 'view');
    const needs = (min) => { if (PERM_RANK[perm] < PERM_RANK[min]) throw new HttpError(403, 'You do not have permission for that.'); };
    if (b.title !== undefined) { needs('edit'); run('UPDATE files SET title = ?, updated_at = ? WHERE id = ?', plainText(b.title, 200).trim() || 'Untitled', Date.now(), f.id); }
    if (b.starred !== undefined) { needs('owner'); run('UPDATE files SET starred = ? WHERE id = ?', b.starred ? 1 : 0, f.id); }
    if (b.trashed !== undefined) { needs('owner'); run('UPDATE files SET trashed = ?, updated_at = ? WHERE id = ?', b.trashed ? 1 : 0, Date.now(), f.id); audit(req, b.trashed ? 'file.trashed' : 'file.restored', f.id); }
    if (b.workspace_perm !== undefined) {
      needs('owner');
      if (!['none', 'view', 'edit'].includes(b.workspace_perm)) throw bad('Unknown sharing level.');
      run('UPDATE files SET workspace_perm = ? WHERE id = ?', b.workspace_perm, f.id);
      audit(req, 'file.workspace_share', f.id, { perm: b.workspace_perm });
    }
    if (b.parent_id !== undefined) {
      needs('owner');
      if (b.parent_id) {
        const parent = one('SELECT * FROM files WHERE id = ?', b.parent_id);
        if (!parent || parent.kind !== 'folder' || PERM_RANK[filePerm(req.user, parent)] < PERM_RANK.edit) throw new HttpError(403, 'You cannot move files into that folder.');
        let p = parent;
        for (let i = 0; p && i < 32; i++) { if (p.id === f.id) throw bad('A folder cannot go inside itself.'); p = p.parent_id ? one('SELECT * FROM files WHERE id = ?', p.parent_id) : null; }
      }
      run('UPDATE files SET parent_id = ? WHERE id = ?', b.parent_id || null, f.id);
    }
    const nf = one('SELECT f.*, u.name AS owner_name FROM files f JOIN users u ON u.id = f.owner_id WHERE f.id = ?', f.id);
    res.json({ file: meta(nf, perm) });
  });

  app.delete('/api/files/:id', auth.requireUser, (req, res) => {
    const { f } = loadFile(req, 'owner');
    if (!f.trashed) throw bad('Move the file to the trash first.');
    run('DELETE FROM files WHERE id = ?', f.id);
    audit(req, 'file.deleted', f.id, { title: f.title });
    res.json({ ok: true });
  });

  app.get('/api/files/:id/shares', auth.requireUser, (req, res) => {
    const { f } = loadFile(req, 'view');
    res.json({ workspace_perm: f.workspace_perm, shares: all('SELECT s.user_id, s.perm, u.name, u.email FROM file_shares s JOIN users u ON u.id = s.user_id WHERE s.file_id = ?', f.id) });
  });
  app.put('/api/files/:id/shares', auth.requireUser, (req, res) => {
    const { f } = loadFile(req, 'owner');
    const list = Array.isArray(req.body && req.body.shares) ? req.body.shares : [];
    tx(() => {
      run('DELETE FROM file_shares WHERE file_id = ?', f.id);
      for (const s of list.slice(0, 500)) {
        if (!['view', 'edit'].includes(s.perm) || s.user_id === f.owner_id) continue;
        if (!one("SELECT id FROM users WHERE id = ? AND status = 'active'", s.user_id)) continue;
        run('INSERT INTO file_shares (file_id, user_id, perm) VALUES (?,?,?)', f.id, s.user_id, s.perm);
      }
    });
    audit(req, 'file.shared', f.id, { count: list.length });
    res.json({ ok: true });
  });

  app.get('/api/files/:id/versions', auth.requireUser, (req, res) => {
    const { f } = loadFile(req, 'view');
    res.json({ current: f.version, kind: f.kind, versions: all(`SELECT v.version, v.created_at, v.size, u.name AS by FROM file_versions v LEFT JOIN users u ON u.id = v.created_by
      WHERE v.file_id = ? ORDER BY v.version DESC`, f.id) });
  });
  app.get('/api/files/:id/versions/:v', auth.requireUser, (req, res) => {
    const { f } = loadFile(req, 'view');
    const v = one('SELECT * FROM file_versions WHERE file_id = ? AND version = ?', f.id, +req.params.v);
    if (!v) throw new HttpError(404, 'Version not found.');
    res.json({ version: v.version, content: v.content ? JSON.parse(v.content) : null });
  });
  app.post('/api/files/:id/versions/:v/restore', auth.requireUser, (req, res) => {
    const { f } = loadFile(req, 'edit');
    const v = one('SELECT * FROM file_versions WHERE file_id = ? AND version = ?', f.id, +req.params.v);
    if (!v) throw new HttpError(404, 'Version not found.');
    tx(() => {
      if (f.kind === 'upload') {
        if (!v.blob) throw bad('That version has no saved copy of the file.');
        run('INSERT INTO file_versions (file_id, version, title, blob, mime, size, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)', f.id, f.version, f.title, f.blob, f.mime, f.size, f.updated_at, f.updated_by);
        run('UPDATE files SET blob = ?, size = ?, mime = COALESCE(?, mime), version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?', v.blob, v.size, v.mime, Date.now(), req.user.id, f.id);
        return;
      }
      run('INSERT INTO file_versions (file_id, version, title, content, created_at, created_by) VALUES (?,?,?,?,?,?)', f.id, f.version, f.title, f.content, f.updated_at, f.updated_by);
      run('UPDATE files SET content = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?', v.content, Date.now(), req.user.id, f.id);
    });
    audit(req, 'file.version_restored', f.id, { version: v.version });
    res.json({ version: f.version + 1 });
  });

  // ---------- import / export ----------
  app.post('/api/import', auth.requireUser, wrap(async (req, res) => {
    const name = decodeURIComponent(req.get('x-filename') || 'file');
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) throw bad('The file was empty.');
    const ext = (name.split('.').pop() || '').toLowerCase();
    const title = name.replace(/\.[^.]+$/, '');
    const parent_id = req.query.parent || null;
    let f;
    try {
      if (ext === 'docx') f = insertFile(req.user, { kind: 'doc', title, parent_id, content: { html: await docxToHtml(buf) } });
      else if (ext === 'xlsx') f = insertFile(req.user, { kind: 'sheet', title, parent_id, content: await xlsxToGrid(buf) });
      else if (ext === 'csv') f = insertFile(req.user, { kind: 'sheet', title, parent_id, content: csvToGrid(buf.toString('utf8')) });
      else if (ext === 'pptx') f = insertFile(req.user, { kind: 'deck', title, parent_id, content: await pptxToDeck(buf) });
      else if (ext === 'html' || ext === 'htm' || ext === 'txt' || ext === 'md') {
        const text = buf.toString('utf8');
        const html = ext === 'txt' || ext === 'md' ? text.split(/\n{2,}/).map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('') : text;
        f = insertFile(req.user, { kind: 'doc', title, parent_id, content: { html } });
      } else throw bad('Nexa can import .docx, .xlsx, .csv, .pptx, .html, .md and .txt. Use Vault upload for other files.');
    } catch (e) {
      if (e instanceof HttpError || e.status) throw e;
      throw bad(`Nexa couldn't read that ${ext} file. It may be damaged or password protected.`);
    }
    audit(req, 'file.imported', f.id, { ext });
    res.status(201).json({ file: meta(f, 'owner') });
  }));

  app.post('/api/upload', auth.requireUser, (req, res) => {
    const name = decodeURIComponent(req.get('x-filename') || 'file');
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) throw bad('The file was empty.');
    const mime = String(req.get('content-type') || 'application/octet-stream').slice(0, 100);
    vault.checkQuota(req.user.id, buf.length);
    const f = insertFile(req.user, { kind: 'upload', title: name, parent_id: req.query.parent || null, blob: buf, mime, size: buf.length });
    audit(req, 'file.uploaded', f.id, { size: buf.length });
    res.status(201).json({ file: meta(f, 'owner') });
  });

  app.get('/api/files/:id/raw', auth.requireUser, (req, res) => {
    const { f } = loadFile(req, 'view');
    if (f.kind !== 'upload') throw bad('Use export for this file.');
    const inline = req.query.inline === '1' && /^(image\/(png|jpeg|gif|webp)|application\/pdf|video\/mp4|audio\/mpeg|text\/plain)$/.test(f.mime);
    res.setHeader('Content-Type', inline ? f.mime : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.title)}`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
    res.end(Buffer.from(f.blob));
  });

  app.get('/api/files/:id/export', auth.requireUser, wrap(async (req, res) => {
    const { f } = loadFile(req, 'view');
    const fmt = String(req.query.format || '');
    const content = f.content ? JSON.parse(f.content) : null;
    const send = (buf, ext, mime) => {
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.title)}.${ext}`);
      res.end(buf);
    };
    if (f.kind === 'doc' && fmt === 'docx') return send(await htmlToDocx(content.html, { title: f.title }), 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    if (f.kind === 'doc' && fmt === 'html') return send(Buffer.from(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(f.title)}</title>${content.html}`), 'html', 'text/html; charset=utf-8');
    if (f.kind === 'sheet' && fmt === 'xlsx') return send(await gridToXlsx(content), 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (f.kind === 'sheet' && fmt === 'csv') return send(Buffer.from('﻿' + gridToCsv(content, +req.query.sheet || 0)), 'csv', 'text/csv; charset=utf-8');
    if (f.kind === 'deck' && fmt === 'pptx') return send(await deckToPptx(content, { title: f.title }), 'pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    if (fmt === 'json') return send(Buffer.from(JSON.stringify({ title: f.title, kind: f.kind, content }, null, 2)), 'nexa.json', 'application/json');
    throw bad('That export format is not available for this file.');
  }));

  // ---------- search ----------
  app.get('/api/search', auth.requireUser, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 2) return res.json({ files: [], messages: [] });
    const like = '%' + q.replace(/[%_]/g, (m) => '\\' + m) + '%';
    const files = all(`SELECT f.id, f.kind, f.title, f.owner_id, f.parent_id, f.workspace_perm, f.updated_at, f.content FROM files f
      WHERE f.trashed = 0 AND (lower(f.title) LIKE ? ESCAPE '\\' OR (f.kind IN ('doc','sheet','deck') AND lower(f.content) LIKE ? ESCAPE '\\')) ORDER BY f.updated_at DESC LIMIT 200`, like, like)
      .filter((f) => filePerm(req.user, f) !== 'none').slice(0, 25)
      .map((f) => ({ id: f.id, kind: f.kind, title: f.title, updated_at: f.updated_at, snippet: snippet(f, q) }));
    const messages = all(`SELECT m.id, m.channel_id, m.body, m.created_at, c.name AS channel, u.name AS user_name FROM messages m
      JOIN channels c ON c.id = m.channel_id JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = ?
      LEFT JOIN users u ON u.id = m.user_id WHERE m.deleted = 0 AND lower(m.body) LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC LIMIT 25`, req.user.id, like);
    res.json({ files, messages });
  });
  function snippet(f, q) {
    let text = '';
    try {
      const c = JSON.parse(f.content || 'null');
      if (f.kind === 'doc') text = c.html.replace(/<[^>]+>/g, ' ');
      else if (f.kind === 'sheet') text = c.sheets.map((s) => Object.values(s.cells).join(' ')).join(' ');
      else if (f.kind === 'deck') text = c.slides.map((s) => s.elements.map((e) => e.text || '').join(' ')).join(' ');
    } catch { /* ignore */ }
    text = text.replace(/\s+/g, ' ');
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return '';
    return (i > 40 ? '…' : '') + text.slice(Math.max(0, i - 40), i + q.length + 60) + '…';
  }

  // ---------- team join link (fast sign-up) ----------
  const getMeta = (k) => (one('SELECT v FROM meta WHERE k = ?', k) || {}).v;
  const setMeta = (k, v) => run('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, v);
  function joinAllowed(token) {
    const t = getMeta('join_token');
    if (getMeta('join_enabled') !== '1' || !t || typeof token !== 'string' || token.length !== t.length) return false;
    return require('node:crypto').timingSafeEqual(Buffer.from(token), Buffer.from(t));
  }
  app.get('/api/settings', auth.requireRole('admin'), (req, res) => {
    res.json({ workspace: workspaceName(), join_enabled: getMeta('join_enabled') === '1', join_token: getMeta('join_token'),
      join_domain: getMeta('join_domain') || '', plan: getMeta('plan') || 'free', external_mail: !!opts.smtpUrl,
      users: one("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").n });
  });
  app.patch('/api/settings', auth.requireRole('owner'), (req, res) => {
    const b = req.body || {};
    if (b.workspace !== undefined) { const w = plainText(b.workspace, 80).trim(); if (!w) throw bad('Workspace name cannot be empty.'); setMeta('workspace', w); }
    if (b.join_enabled !== undefined) setMeta('join_enabled', b.join_enabled ? '1' : '0');
    if (b.join_domain !== undefined) {
      const d = String(b.join_domain || '').trim().toLowerCase().replace(/^@/, '');
      if (d && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw bad('Enter a domain like example.com, or leave it empty.');
      setMeta('join_domain', d);
    }
    if (b.new_join_link) setMeta('join_token', require('node:crypto').randomBytes(18).toString('base64url'));
    audit(req, 'settings.updated', null, { join_enabled: b.join_enabled, join_domain: b.join_domain, new_join_link: !!b.new_join_link });
    res.json({ ok: true });
  });
  app.get('/api/join/:token', (req, res) => {
    if (!joinAllowed(req.params.token)) return res.status(404).json({ error: 'This team link is not valid any more. Ask your admin for a new one.' });
    res.json({ workspace: workspaceName(), domain: getMeta('join_domain') || '' });
  });
  app.post('/api/join/:token', wrap(async (req, res) => {
    const key = 'join|' + (req.ip || '');
    if (!loginLimit(key)) throw new HttpError(429, 'Too many sign-ups from here. Try again in 15 minutes.');
    if (!joinAllowed(req.params.token)) throw new HttpError(404, 'This team link is not valid any more. Ask your admin for a new one.');
    const { name, email, password } = req.body || {};
    if (!A.validEmail(email)) throw bad('Enter a valid email.');
    const domain = getMeta('join_domain');
    if (domain && !String(email).toLowerCase().endsWith('@' + domain)) throw bad(`Use your @${domain} email to join this workspace.`);
    if (!name || !String(name).trim()) throw bad('Enter your name.');
    const p = A.passwordProblem(password); if (p) throw bad(p);
    const uid = A.id('u');
    tx(() => {
      if (one('SELECT id FROM users WHERE email = ?', email.trim())) throw new HttpError(409, 'That email already has an account. Sign in instead.');
      run('INSERT INTO users (id, email, name, pass_hash, role, created_at) VALUES (?,?,?,?,?,?)', uid, email.trim(), plainText(name, 80).trim(), A.hashPassword(password), 'member', Date.now());
      for (const c of all("SELECT id FROM channels WHERE kind = 'public' AND archived = 0 AND name IN ('general','random')")) {
        run('INSERT OR IGNORE INTO channel_members (channel_id, user_id, joined_at) VALUES (?,?,?)', c.id, uid, Date.now());
      }
    });
    req.user = { id: uid };
    audit(req, 'user.joined_by_link', uid);
    const token = auth.createSession(uid, req.get('user-agent'));
    res.setHeader('Set-Cookie', auth.cookieFor(token, auth.SESSION_TTL_MS));
    res.status(201).json({ ok: true });
  }));

  // ---------- Huddle REST ----------
  const huddle = attachHuddle({ store, auth, filePerm, audit, HttpError, plainText, app, wrap, ice: opts.ice });
  attachRelayCadence({ store, auth, filePerm, audit, HttpError, app, wrap, huddle, smtpUrl: opts.smtpUrl, smtpFrom: opts.smtpFrom });
  vault = attachVault({ store, auth, filePerm, audit, HttpError, app, wrap, huddle, maxUpload, quotaBytes: opts.quotaBytes || 0, cleanContent, insertFile, meta, linkBase, workspaceQuotaBytes: opts.workspaceQuotaBytes || 0 });

  // ---------- Google or Apple sign-in ----------
  // The cloud host checks the provider's answer, then calls this with a verified email.
  function ssoSignIn({ email, name, invite, join, setup, ip, ua }) {
    email = String(email || '').trim();
    if (!A.validEmail(email)) throw bad('That account did not share an email we can use.');
    const nm = plainText(String(name || '').trim() || email.split('@')[0], 80).trim() || 'New member';
    const fake = { user: null, ip: ip || null };
    let uid = null;
    const addToChannels = (id, names) => {
      for (const c of all(`SELECT id FROM channels WHERE kind = 'public' AND archived = 0 AND name IN (${names.map(() => '?').join(',')})`, ...names)) {
        run('INSERT OR IGNORE INTO channel_members (channel_id, user_id, joined_at) VALUES (?,?,?)', c.id, id, Date.now());
      }
    };
    if (setup) {
      uid = A.id('u');
      tx(() => {
        if (userCount() > 0) throw new HttpError(409, 'This workspace is already set up.');
        run("INSERT OR REPLACE INTO meta (k, v) VALUES ('workspace', ?)", plainText(setup.workspace || (nm.split(/\s+/)[0] + '’s team'), 80));
        run('INSERT INTO users (id, email, name, pass_hash, role, created_at) VALUES (?,?,?,?,?,?)', uid, email, nm, A.SSO_ONLY, 'owner', Date.now());
        run("INSERT OR REPLACE INTO meta (k, v) VALUES ('join_token', ?)", require('node:crypto').randomBytes(18).toString('base64url'));
        run("INSERT OR REPLACE INTO meta (k, v) VALUES ('join_enabled', '1')");
        run("INSERT OR REPLACE INTO meta (k, v) VALUES ('plan', 'free')");
        seed.channels(store, uid);
        if (setup.sampleContent !== false) seed.files(store, uid);
      });
      fake.user = { id: uid }; audit(fake, 'workspace.setup', uid, { via: 'sso' });
    } else {
      const u = one('SELECT * FROM users WHERE email = ?', email);
      if (u) {
        if (u.status !== 'active') throw new HttpError(403, 'This account is turned off. Ask an admin.');
        uid = u.id;
        fake.user = { id: uid }; audit(fake, 'auth.login', uid, { via: 'sso' });
      } else if (invite) {
        const th = A.sha256(String(invite));
        uid = A.id('u');
        tx(() => {
          const inv = one('SELECT * FROM invites WHERE token_hash = ?', th);
          if (!inv || inv.used_at || inv.expires_at < Date.now()) throw new HttpError(404, 'This invite link is not valid any more.');
          if (inv.email.toLowerCase() !== email.toLowerCase()) throw new HttpError(403, `This invite is for ${inv.email}. Sign in with that account.`);
          run('INSERT INTO users (id, email, name, pass_hash, role, created_at) VALUES (?,?,?,?,?,?)', uid, inv.email, nm, A.SSO_ONLY, inv.role, Date.now());
          run('UPDATE invites SET used_at = ? WHERE token_hash = ?', Date.now(), th);
          if (inv.role !== 'guest') addToChannels(uid, ['general']);
        });
        fake.user = { id: uid }; audit(fake, 'user.joined', uid, { via: 'sso' });
      } else if (join) {
        if (!joinAllowed(String(join))) throw new HttpError(404, 'This team link is not valid any more. Ask your admin for a new one.');
        const domain = getMeta('join_domain');
        if (domain && !email.toLowerCase().endsWith('@' + domain)) throw bad(`Use your @${domain} account to join this workspace.`);
        uid = A.id('u');
        tx(() => {
          run('INSERT INTO users (id, email, name, pass_hash, role, created_at) VALUES (?,?,?,?,?,?)', uid, email, nm, A.SSO_ONLY, 'member', Date.now());
          addToChannels(uid, ['general', 'random']);
        });
        fake.user = { id: uid }; audit(fake, 'user.joined_by_link', uid, { via: 'sso' });
      } else {
        throw new HttpError(404, 'No account in this workspace uses that email. Ask an admin for an invite or the team link.');
      }
    }
    return auth.cookieFor(auth.createSession(uid, ua), auth.SESSION_TTL_MS);
  }

  // ---------- static ----------
  app.get('/shared/:file', (req, res, next) => {
    if (!/^[a-z]+\.js$/.test(req.params.file)) return next();
    res.sendFile(path.join(__dirname, '..', 'shared', req.params.file));
  });
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: opts.dev ? 0 : '1h' }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500 && !(err instanceof HttpError) && !opts.quiet) console.error(err);
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That file is larger than the upload limit.' });
    res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? 'Something went wrong on the server.' : err.message });
  });

  const server = http.createServer(app);
  huddle.attachSockets(server);
  return { app, server, store, ssoSignIn, close: () => { huddle.close(); server.close(); store.db.close(); } };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

module.exports = { createServer };
