'use strict';
// Cloud host: many workspaces on one server, opened from a link.
// Each workspace is a normal Nexa server with its own database file at <data>/workspaces/<name>/nexa.db.
// A browser picks its workspace with the nexa_ws cookie; /w/<name> sets it, and /w/<name>/<path> serves
// share links and WebDAV for that workspace without the cookie.
// Google and Apple sign-in stay off until their keys are set (see deploy/README.md).
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const { createServer } = require('./app');
const A = require('./auth');

const WS_COOKIE = 'nexa_ws';
const SSO_COOKIE = 'nexa_sso';
const RESERVED = new Set(['api', 'app', 'admin', 'cloud', 'dav', 'help', 'login', 'nexa', 'root', 'shared', 'sso', 'static', 'support', 'www']);
const validName = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(s) && !s.includes('--') && !RESERVED.has(s);

const PROVIDERS = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    scope: 'openid email profile',
  },
  apple: {
    authorize: 'https://appleid.apple.com/auth/authorize',
    token: 'https://appleid.apple.com/auth/token',
    issuers: ['https://appleid.apple.com'],
    scope: 'name email',
  },
};

/** Reads Google and Apple settings from the environment. A provider is on only when all its values are set. */
function providersFromEnv(env = process.env) {
  const out = {};
  if (env.NEXA_GOOGLE_CLIENT_ID && env.NEXA_GOOGLE_CLIENT_SECRET) {
    out.google = { clientId: env.NEXA_GOOGLE_CLIENT_ID, clientSecret: env.NEXA_GOOGLE_CLIENT_SECRET };
  }
  if (env.NEXA_APPLE_CLIENT_ID && env.NEXA_APPLE_TEAM_ID && env.NEXA_APPLE_KEY_ID && (env.NEXA_APPLE_PRIVATE_KEY || env.NEXA_APPLE_PRIVATE_KEY_FILE)) {
    const key = env.NEXA_APPLE_PRIVATE_KEY ? env.NEXA_APPLE_PRIVATE_KEY.replace(/\\n/g, '\n') : fs.readFileSync(env.NEXA_APPLE_PRIVATE_KEY_FILE, 'utf8');
    out.apple = { clientId: env.NEXA_APPLE_CLIENT_ID, teamId: env.NEXA_APPLE_TEAM_ID, keyId: env.NEXA_APPLE_KEY_ID, privateKey: key };
  }
  return out;
}

const b64u = (b) => Buffer.from(b).toString('base64url');
function appleClientSecret(cfg) {
  const now = Math.floor(Date.now() / 1000);
  const input = b64u(JSON.stringify({ alg: 'ES256', kid: cfg.keyId })) + '.' +
    b64u(JSON.stringify({ iss: cfg.teamId, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: cfg.clientId }));
  return input + '.' + crypto.sign('sha256', Buffer.from(input), { key: cfg.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}

function createCloud(opts = {}) {
  const dataDir = opts.dataDir;
  const wsRoot = path.join(dataDir, 'workspaces');
  fs.mkdirSync(wsRoot, { recursive: true });
  const secure = !!opts.secureCookies;
  const publicUrl = String(opts.publicUrl || '').replace(/\/$/, '');
  const maxWorkspaces = opts.maxWorkspaces || 100;
  const minFreeBytes = opts.minFreeBytes ?? 2 * 1024 ** 3;
  const sso = {};
  for (const [p, cfg] of Object.entries(opts.providers || {})) sso[p] = { ...PROVIDERS[p], ...(opts.endpoints && opts.endpoints[p]), ...cfg };
  const ssoList = publicUrl ? Object.keys(sso) : [];
  const createLimit = A.rateLimiter(opts.createsPerIpPerDay || 3, 24 * 3600 * 1000);
  const ssoLimit = A.rateLimiter(30, 15 * 60 * 1000);

  // A secret for signing the short-lived sign-in cookie, made once and kept with the data.
  const secretFile = path.join(dataDir, 'cloud-secret');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  const secret = fs.readFileSync(secretFile, 'utf8').trim();
  const sign = (s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');

  const tenants = new Map();
  const dbFile = (name) => path.join(wsRoot, name, 'nexa.db');
  const exists = (name) => validName(name) && fs.existsSync(dbFile(name));
  const count = () => fs.readdirSync(wsRoot).filter((n) => fs.existsSync(dbFile(n))).length;
  function load(name) {
    let t = tenants.get(name);
    if (t) return t;
    fs.mkdirSync(path.join(wsRoot, name), { recursive: true });
    t = createServer({
      dbPath: dbFile(name), cookieName: 'nexa_sid_' + name.replace(/-/g, '_'), linkBase: '/w/' + name,
      secureCookies: secure, trustProxy: opts.trustProxy, maxUpload: opts.maxUpload || 25 * 1024 * 1024,
      workspaceQuotaBytes: opts.workspaceQuotaBytes ?? 1024 ** 3, ssoProviders: ssoList, cloud: { name },
      setupGate: (req) => req.nexaCloudCreate === true, quiet: opts.quiet,
    });
    tenants.set(name, t);
    return t;
  }
  function remove(name) {
    const t = tenants.get(name);
    if (t) { try { t.close(); } catch { /* already closed */ } tenants.delete(name); }
    fs.rmSync(path.join(wsRoot, name), { recursive: true, force: true });
  }
  function canCreate(name, ip, consume = true) {
    if (!validName(name)) return 'Use 3 to 32 lowercase letters, numbers or dashes.';
    if (exists(name)) return 'That address is taken. Try another.';
    if (count() >= maxWorkspaces) return 'This server is full for now. Try again later.';
    try { const st = fs.statfsSync(dataDir); if (st.bavail * st.bsize < minFreeBytes) return 'This server is full for now. Try again later.'; } catch { /* statfs unsupported */ }
    if (consume && !createLimit(ip)) return 'Too many new workspaces from here today. Try again tomorrow.';
    return null;
  }

  const clientIp = (req) => {
    if (opts.trustProxy) { const f = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean); if (f.length) return f[f.length - 1]; }
    return req.socket.remoteAddress || '';
  };
  const cookies = (req) => A.parseCookies(req.headers.cookie);
  const wsCookie = (name, maxAge) => `${WS_COOKIE}=${name}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const headers = (res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function page(res, status, title, msg) {
    headers(res);
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Astute Nexa</title><link rel="stylesheet" href="/css/nexa.css"></head>
<body><div class="auth"><div class="auth-card"><h2>${esc(title)}</h2><p class="muted">${esc(msg)}</p><a class="btn" href="/cloud/">Go to the start page</a></div></div></body></html>`);
  }
  const redirect = (res, to, setCookies) => { if (setCookies) res.setHeader('Set-Cookie', setCookies); res.writeHead(302, { Location: to }); res.end(); };

  // ---------- the start page, workspace checks and Google/Apple sign-in ----------
  const web = express();
  web.disable('x-powered-by');
  web.use((req, res, next) => { headers(res); next(); });
  web.get('/cloud/config', (req, res) => res.json({ sso: ssoList, full: count() >= maxWorkspaces, workspaceBytes: opts.workspaceQuotaBytes ?? 1024 ** 3 }));
  web.get('/cloud/check', (req, res) => {
    const n = String(req.query.name || '');
    res.json({ ok: validName(n) && !exists(n), exists: exists(n), reason: !validName(n) ? 'Use 3 to 32 lowercase letters, numbers or dashes.' : exists(n) ? 'That address is taken. Try another.' : null });
  });
  web.use('/cloud', express.static(path.join(__dirname, '..', 'cloud-web'), { index: 'index.html', maxAge: '1h' }));

  web.get('/sso/:p/start', (req, res) => {
    const p = req.params.p, cfg = sso[p];
    if (!cfg || !publicUrl) return page(res, 404, 'Sign-in is not switched on', 'Use your email and password instead.');
    if (!ssoLimit(clientIp(req))) return page(res, 429, 'Too many tries', 'Wait 15 minutes, then try again.');
    const q = req.query;
    const create = q.create ? String(q.create) : null;
    const name = create || cookies(req)[WS_COOKIE];
    if (create) { const why = canCreate(create, null, false); if (why) return page(res, 400, 'That address can’t be used', why); }
    else if (!exists(name)) return page(res, 404, 'Open your workspace first', 'Go to the start page and open your workspace, then sign in.');
    const st = {
      p, state: b64u(crypto.randomBytes(18)), nonce: b64u(crypto.randomBytes(18)), verifier: b64u(crypto.randomBytes(32)),
      name, create: !!create, workspace: q.workspace ? String(q.workspace).slice(0, 80) : null,
      invite: q.invite ? String(q.invite).slice(0, 100) : null, join: q.join ? String(q.join).slice(0, 100) : null,
      exp: Date.now() + 10 * 60 * 1000,
    };
    const v = b64u(JSON.stringify(st));
    // Apple posts the answer back from its own site, so its cookie must be allowed on that cross-site POST.
    const same = p === 'apple' && secure ? 'None' : 'Lax';
    res.setHeader('Set-Cookie', `${SSO_COOKIE}=${v}.${sign(v)}; Path=/sso/; HttpOnly; SameSite=${same}; Max-Age=600${secure ? '; Secure' : ''}`);
    const u = new URL(cfg.authorize);
    u.searchParams.set('client_id', cfg.clientId);
    u.searchParams.set('redirect_uri', `${publicUrl}/sso/${p}/callback`);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', cfg.scope);
    u.searchParams.set('state', st.state);
    u.searchParams.set('nonce', st.nonce);
    if (p === 'apple') u.searchParams.set('response_mode', 'form_post');
    else { u.searchParams.set('code_challenge', b64u(crypto.createHash('sha256').update(st.verifier).digest())); u.searchParams.set('code_challenge_method', 'S256'); u.searchParams.set('prompt', 'select_account'); }
    res.redirect(302, u.toString());
  });

  async function callback(req, res) {
    const p = req.params.p, cfg = sso[p];
    const clear = `${SSO_COOKIE}=; Path=/sso/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
    const fail = (msg) => { res.setHeader('Set-Cookie', clear); page(res, 400, 'Sign-in didn’t finish', msg); };
    if (!cfg || !publicUrl) return page(res, 404, 'Sign-in is not switched on', 'Use your email and password instead.');
    const q = req.method === 'POST' ? (req.body || {}) : req.query;
    if (q.error) return fail(q.error === 'access_denied' || q.error === 'user_cancelled_authorize' ? 'You cancelled the sign-in.' : 'The sign-in service sent back an error.');
    const raw = cookies(req)[SSO_COOKIE] || '';
    const [v, sig] = raw.split('.');
    let st = null;
    try { if (v && sig && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(v)))) st = JSON.parse(Buffer.from(v, 'base64url').toString()); } catch { st = null; }
    if (!st || st.p !== p || st.exp < Date.now() || !q.state || q.state !== st.state || !q.code) return fail('The sign-in took too long or came from somewhere else. Try again.');
    let claims;
    try {
      const body = new URLSearchParams({ grant_type: 'authorization_code', code: String(q.code), redirect_uri: `${publicUrl}/sso/${p}/callback`, client_id: cfg.clientId,
        client_secret: p === 'apple' ? appleClientSecret(cfg) : cfg.clientSecret });
      if (p !== 'apple') body.set('code_verifier', st.verifier);
      const r = await fetch(cfg.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal: AbortSignal.timeout(10000) });
      const j = await r.json();
      if (!r.ok || !j.id_token) throw new Error('no id_token');
      // The ID token came straight from the provider's token endpoint over HTTPS, so its issuer is the provider
      // (OpenID Connect Core 3.1.3.7). We still check who it is for, when it expires and that it answers this sign-in.
      claims = JSON.parse(Buffer.from(String(j.id_token).split('.')[1], 'base64url').toString());
    } catch { return fail('Could not confirm the sign-in with the provider. Try again.'); }
    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!cfg.issuers.includes(claims.iss) || !aud.includes(cfg.clientId) || !(claims.exp > now) || claims.nonce !== st.nonce) return fail('The sign-in answer did not check out. Try again.');
    if (!claims.email || !(claims.email_verified === true || claims.email_verified === 'true')) return fail('That account has no confirmed email address.');
    let name = claims.name || '';
    if (p === 'apple' && q.user) { try { const n = JSON.parse(q.user).name || {}; name = [n.firstName, n.lastName].filter(Boolean).join(' '); } catch { /* no name sent */ } }

    const ip = clientIp(req), ua = req.headers['user-agent'];
    let t, made = false;
    if (st.create) {
      const why = canCreate(st.name, ip);
      if (why) return fail(why);
      t = load(st.name); made = true;
    } else {
      if (!exists(st.name)) return fail('That workspace is gone.');
      t = load(st.name);
    }
    let session;
    try {
      session = t.ssoSignIn({ email: claims.email, name, invite: st.invite, join: st.join, setup: st.create ? { workspace: st.workspace } : null, ip, ua });
    } catch (e) {
      if (made) remove(st.name);
      return fail(e.status && e.status < 500 ? e.message : 'Something went wrong on the server.');
    }
    res.setHeader('Set-Cookie', [clear, session, wsCookie(st.name, 365 * 86400)]);
    res.writeHead(302, { Location: '/#/home' });
    res.end();
  }
  web.get('/sso/:p/callback', (req, res, next) => callback(req, res).catch(next));
  web.post('/sso/:p/callback', express.urlencoded({ extended: false, limit: '64kb' }), (req, res, next) => callback(req, res).catch(next));

  // Files the start page and share pages need (styles, icons) come from the normal web folder.
  web.use(express.static(path.join(__dirname, '..', 'public'), { index: false, maxAge: '1h' }));
  web.use('/api', (req, res) => res.status(404).json({ error: 'Open your workspace first.' }));
  web.use((req, res) => page(res, 404, 'Not found', 'There is nothing at this address.'));
  // eslint-disable-next-line no-unused-vars
  web.use((err, req, res, next) => { if (!opts.quiet) console.error(err); page(res, 500, 'Something went wrong', 'Try again in a moment.'); });

  // ---------- routing between the start page and workspaces ----------
  function handle(req, res) {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/' && !exists(cookies(req)[WS_COOKIE])) return redirect(res, '/cloud/');
    if (p === '/w' || p === '/w/') return redirect(res, '/cloud/', wsCookie('', 0));
    if (p === '/cloud/create' && req.method === 'POST') {
      if (req.headers['x-nexa-csrf'] !== '1') { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"error":"Missing request header."}'); }
      try { if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw 0; } catch { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"error":"Cross-site request blocked."}'); }
      const name = u.searchParams.get('name') || '';
      const why = canCreate(name, clientIp(req));
      if (why) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: why })); }
      const t = load(name);
      res.on('finish', () => { if (res.statusCode >= 400) remove(name); });
      req.url = '/api/setup';
      req.nexaCloudCreate = true;
      return t.app(req, res);
    }
    if (p.startsWith('/cloud/') || p === '/cloud' || p.startsWith('/sso/')) return web(req, res);
    const m = p.match(/^\/w\/([^/]+)(\/.*)?$/);
    if (m) {
      if (!exists(m[1])) return page(res, 404, 'No workspace at this address', 'Check the link, or make a new workspace.');
      if (!m[2] || m[2] === '/') return redirect(res, '/' + u.search, wsCookie(m[1], 365 * 86400));
      req.url = m[2] + u.search;
      return load(m[1]).app(req, res);
    }
    const name = cookies(req)[WS_COOKIE];
    if (exists(name)) return load(name).app(req, res);
    return web(req, res);
  }

  const server = http.createServer(handle);
  server.on('upgrade', (req, socket, head) => {
    const name = cookies(req)[WS_COOKIE];
    if (!exists(name)) return socket.destroy();
    load(name).server.emit('upgrade', req, socket, head);
  });
  return { server, handle, tenants, close: () => { for (const t of tenants.values()) t.close(); tenants.clear(); server.close(); } };
}

module.exports = { createCloud, providersFromEnv, validName, appleClientSecret };
