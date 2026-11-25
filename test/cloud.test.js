'use strict';
// The online version: many workspaces on one server, chat between people in a workspace, and Google/Apple sign-in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const WebSocket = require('ws');
const { createCloud, validName } = require('../server/cloud');

const PW = 'correct horse battery 9';

// A browser-like client that keeps every cookie it is given.
function browser(base) {
  const jar = new Map();
  const b = { jar, base };
  b.cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  b.req = async (method, p, body, headers = {}) => {
    const isForm = body instanceof URLSearchParams || Buffer.isBuffer(body);
    const r = await fetch(base + p, {
      method, redirect: 'manual',
      headers: { origin: base, 'x-nexa-csrf': '1', cookie: b.cookie(), ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    for (const sc of r.headers.getSetCookie()) {
      const [kv, ...attrs] = sc.split(';');
      const i = kv.indexOf('='); const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
      if (attrs.some((a) => /max-age=0\b/i.test(a.trim())) || v === '') jar.delete(k); else jar.set(k, v);
    }
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, body: json, text, headers: r.headers };
  };
  for (const m of ['get', 'post', 'put', 'patch']) b[m] = (p, body, h) => b.req(m.toUpperCase(), p, body, h);
  return b;
}

async function startCloud(opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-cloud-'));
  const c = createCloud({ dataDir, quiet: true, minFreeBytes: 0, ...opts(dataDir) });
  await new Promise((r) => c.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + c.server.address().port;
  return { ...c, base, dataDir, stop: () => { c.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

async function makeWorkspace(cloud, name, email, extra = {}) {
  const b = browser(cloud.base);
  const r = await b.post('/cloud/create?name=' + name, { workspace: name.toUpperCase(), name: 'Olive ' + name, email, password: PW, sampleContent: false, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const open = await b.get('/w/' + name);
  assert.equal(open.status, 302);
  return b;
}

function socket(cloud, b) {
  const ws = new WebSocket(cloud.base.replace('http', 'ws') + '/ws', { headers: { cookie: b.cookie(), origin: cloud.base } });
  const inbox = [], waiters = [];
  ws.on('message', (d) => { const m = JSON.parse(d); const i = waiters.findIndex((w) => w.pred(m)); if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else inbox.push(m); });
  ws.next = (pred, ms = 3000) => {
    const i = inbox.findIndex(pred);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => { waiters.push({ pred, resolve }); setTimeout(() => reject(new Error('timed out')), ms); });
  };
  ws.opened = new Promise((ok, no) => { ws.on('open', ok); ws.on('error', no); ws.on('unexpected-response', (q, res) => no(new Error('HTTP ' + res.statusCode))); });
  return ws;
}

test('workspace names', () => {
  for (const ok of ['acme', 'my-team', 'a1b']) assert.ok(validName(ok), ok);
  for (const no of ['ab', 'Acme', '-acme', 'acme-', 'a--b', 'cloud', 'sso', 'a'.repeat(33), '../x', 'a b']) assert.ok(!validName(no), no);
});

test('cloud: many workspaces from one link, kept apart', async (t) => {
  const cloud = await startCloud(() => ({ maxWorkspaces: 3, createsPerIpPerDay: 20 }));
  t.after(() => cloud.stop());
  const anon = browser(cloud.base);

  await t.test('the address opens the start page', async () => {
    const r = await anon.get('/');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/cloud/');
    const page = await anon.get('/cloud/');
    assert.equal(page.status, 200);
    assert.match(page.text, /Make your workspace/);
    assert.deepEqual((await anon.get('/cloud/config')).body.sso, []);
    assert.equal((await anon.get('/cloud/config')).body.workspaceBytes, 1024 ** 3, 'the start page shows the real workspace size');
    assert.equal((await anon.get('/css/nexa.css')).status, 200);
    assert.equal((await anon.get('/api/state')).status, 404);
  });

  const acme = await makeWorkspace(cloud, 'acme', 'olive@acme.example');
  const beta = await makeWorkspace(cloud, 'beta', 'bo@beta.example');

  await t.test('each workspace has its own people, data and links', async () => {
    const s = (await acme.get('/api/state')).body;
    assert.equal(s.workspace, 'ACME');
    assert.equal(s.user.email, 'olive@acme.example');
    assert.equal(s.linkBase, '/w/acme');
    assert.deepEqual(s.cloud, { name: 'acme' });
    assert.equal((await beta.get('/api/state')).body.user.email, 'bo@beta.example');
    await acme.post('/api/files', { kind: 'doc', title: 'Acme plan' });
    const betaFiles = (await beta.get('/api/files?view=recent')).body.files;
    assert.ok(!betaFiles.some((f) => f.title === 'Acme plan'));
    // Acme's sign-in does not open Beta.
    const sneaky = browser(cloud.base);
    sneaky.jar.set('nexa_ws', 'beta');
    for (const [k, v] of acme.jar) if (k.startsWith('nexa_sid')) sneaky.jar.set(k, v);
    assert.equal((await sneaky.get('/api/state')).body.user, null);
  });

  await t.test('phone keyboards do not capitalise the workspace address', async () => {
    const page = (await anon.get('/cloud/')).text;
    const fields = page.match(/<input[^>]*name="name"[^>]*>/g);
    assert.equal(fields.length, 2, 'both forms ask for the address');
    for (const f of fields) assert.match(f, /autocapitalize="none"/, 'a capital first letter would fail the address format');
  });

  await t.test('the start page offers to sign back in to the workspace this browser opened', async () => {
    assert.equal((await anon.get('/cloud/config')).body.current, null, 'a new browser is not pointed anywhere');
    const page = await anon.get('/cloud/');
    assert.match(page.text, />Sign in</, 'signing in is offered on the start page');
    const back = browser(cloud.base);
    await back.get('/w/acme');
    const c = await back.get('/cloud/config');
    assert.equal(c.body.current, 'acme');
    assert.equal(c.headers.get('cache-control'), 'no-store');
    // "Open a different workspace" forgets it
    await back.get('/w/');
    assert.equal((await back.get('/cloud/config')).body.current, null);
    const stale = browser(cloud.base);
    stale.jar.set('nexa_ws', 'gone-away');
    assert.equal((await stale.get('/cloud/config')).body.current, null, 'a workspace that no longer exists is not offered');
  });

  await t.test('names are checked and setup cannot be redone', async () => {
    assert.equal((await anon.post('/cloud/create?name=acme', { name: 'X', email: 'x@x.example', password: PW })).status, 400);
    assert.equal((await anon.post('/cloud/create?name=Bad%20Name', { name: 'X', email: 'x@x.example', password: PW })).status, 400);
    assert.equal((await anon.post('/cloud/create?name=gamma', { name: 'X', email: 'x@x.example', password: PW }, { 'x-nexa-csrf': '' })).status, 403);
    assert.equal((await acme.post('/api/setup', { name: 'X', email: 'x@x.example', password: PW })).status, 403);
    assert.equal((await anon.get('/cloud/check?name=acme')).body.exists, true);
    assert.equal((await anon.get('/cloud/check?name=gamma')).body.ok, true);
  });

  await t.test('a failed setup leaves no workspace behind', async () => {
    const r = await anon.post('/cloud/create?name=gamma', { name: 'X', email: 'x@x.example', password: 'short' });
    assert.equal(r.status, 400);
    await new Promise((res) => setTimeout(res, 50));
    assert.equal((await anon.get('/cloud/check?name=gamma')).body.exists, false);
    assert.ok(!fs.existsSync(path.join(cloud.dataDir, 'workspaces', 'gamma')));
  });

  await t.test('the server stops at its workspace limit', async () => {
    await makeWorkspace(cloud, 'gamma', 'g@g.example');
    const r = await anon.post('/cloud/create?name=delta', { name: 'X', email: 'x@x.example', password: PW });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /full/);
  });

  // An invited teammate opens the link with no cookies at all.
  const max = browser(cloud.base);
  await t.test('invite links name the workspace and work from a fresh browser', async () => {
    const inv = (await acme.post('/api/invites', { email: 'max@acme.example', role: 'member' })).body;
    assert.match(inv.path, /^\/w\/acme\/#\/invite\//);
    const open = await max.get('/w/acme/');
    assert.equal(open.status, 302);
    assert.equal(max.jar.get('nexa_ws'), 'acme');
    const token = inv.path.split('/').pop();
    assert.equal((await max.post(`/api/invites/${token}/accept`, { name: 'Max', password: PW })).status, 200);
    assert.equal((await max.get('/api/state')).body.user.email, 'max@acme.example');
  });

  await t.test('people in a workspace chat with each other live', async () => {
    const a = socket(cloud, acme); await a.opened;
    const b = socket(cloud, max); await b.opened;
    t.after(() => { a.close(); b.close(); });
    await b.next((m) => m.t === 'hello');
    const ch = (await acme.get('/api/channels')).body.channels.find((c) => c.name === 'general');
    await acme.post(`/api/channels/${ch.id}/messages`, { body: 'hello from the cloud' });
    const m = await b.next((x) => x.t === 'message.new');
    assert.equal(m.message.body, 'hello from the cloud');
    // Beta's people never hear Acme's chat.
    const c = socket(cloud, beta); await c.opened;
    t.after(() => c.close());
    await c.next((x) => x.t === 'hello');
    await acme.post(`/api/channels/${ch.id}/messages`, { body: 'second' });
    await b.next((x) => x.t === 'message.new');
    await assert.rejects(c.next((x) => x.t === 'message.new', 300));
  });

  await t.test('share links open without signing in', async () => {
    const f = (await acme.post('/api/files', { kind: 'doc', title: 'Public note' })).body.file;
    const l = (await acme.post(`/api/files/${f.id}/links`, { expires_days: 7, allow_download: true })).body.link;
    assert.match(l.path, /^\/w\/acme\/s\//);
    const r = await browser(cloud.base).get(l.path);
    assert.equal(r.status, 200);
    assert.match(r.text, /Public note/);
    assert.match(r.text, new RegExp(l.path.replace(/[/]/g, '\\/') + '\\/'));
  });

  await t.test('call links let someone with no account join one call from a phone', async () => {
    const ch = (await acme.get('/api/channels')).body.channels[0];
    const link = (await acme.post(`/api/channels/${ch.id}/call-link`, {})).body;
    assert.match(link.path, /^\/w\/acme\/call\/[A-Za-z0-9_-]{43}$/);
    const dad = browser(cloud.base); // a phone that has never seen Nexa
    const page = await dad.get(link.path);
    assert.equal(page.status, 200);
    // the page loads its files relative to the link, so they come from this workspace
    for (const f of page.text.match(/(?:src|href)="(\.\.\/[^"]+)"/g).map((x) => x.split('"')[1])) {
      const url = new URL(f, cloud.base + link.path).pathname;
      assert.equal((await dad.get(url)).status, 200, url);
    }
    const token = link.path.split('/').pop();
    assert.equal((await dad.get(`/w/acme/api/guest/call/${token}`)).body.host, 'Olive acme');
    assert.equal((await dad.get(`/w/beta/api/guest/call/${token}`)).status, 404, 'a link only works in its own workspace');
    const ws = new WebSocket(`${cloud.base.replace('http', 'ws')}/w/acme/ws/guest?t=${token}&name=Dad`, { headers: { origin: cloud.base } });
    const hello = await new Promise((ok, no) => { ws.on('message', (d) => ok(JSON.parse(d))); ws.on('error', no); ws.on('unexpected-response', (q, r) => no(new Error('HTTP ' + r.statusCode))); });
    assert.equal(hello.guest, true);
    assert.equal(hello.channel_id, ch.id);
    ws.terminate();
    const wrong = new WebSocket(`${cloud.base.replace('http', 'ws')}/w/beta/ws/guest?t=${token}&name=Dad`, { headers: { origin: cloud.base } });
    await assert.rejects(new Promise((ok, no) => { wrong.on('open', ok); wrong.on('error', no); wrong.on('unexpected-response', (q, r) => no(new Error('HTTP ' + r.statusCode))); }), /410/);
    const nobody = new WebSocket(`${cloud.base.replace('http', 'ws')}/w/nope/ws/guest?t=${token}&name=Dad`, { headers: { origin: cloud.base } });
    await assert.rejects(new Promise((ok, no) => { nobody.on('open', ok); nobody.on('error', no); }));
  });

  await t.test('each workspace has its own storage limit', async () => {
    const small = await startCloud(() => ({ workspaceQuotaBytes: 1500 }));
    t.after(() => small.stop());
    const b = await makeWorkspace(small, 'tiny', 't@t.example');
    const up = (n) => b.post('/api/upload', Buffer.alloc(n, 1), { 'x-filename': 'a.bin', 'content-type': 'application/octet-stream' });
    assert.ok((await up(1000)).status < 300);
    const r = await up(1000);
    assert.equal(r.status, 507);
    assert.match(r.body.error, /workspace/);
  });

  await t.test('switching workspace clears the choice', async () => {
    const b = browser(cloud.base);
    await b.get('/w/beta');
    assert.equal(b.jar.get('nexa_ws'), 'beta');
    const r = await b.get('/w/');
    assert.equal(r.headers.get('location'), '/cloud/');
    assert.ok(!b.jar.has('nexa_ws'));
    assert.equal((await b.get('/w/nope')).status, 404);
  });
});

// ---------- Google and Apple sign-in against a stand-in provider ----------
function fakeProvider() {
  const codes = new Map();
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const f = new URLSearchParams(body);
      const c = codes.get(f.get('code'));
      if (!c || f.get('client_id') !== c.aud) { res.writeHead(400); return res.end('{"error":"invalid_grant"}'); }
      if (c.pkce && crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url') !== c.pkce) { res.writeHead(400); return res.end('{"error":"pkce"}'); }
      srv.seen.push(Object.fromEntries(f));
      const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id_token: enc({ alg: 'RS256' }) + '.' + enc(c.claims) + '.sig' }));
    });
  });
  srv.seen = [];
  srv.issue = (claims, aud, pkce) => { const code = crypto.randomBytes(8).toString('hex'); codes.set(code, { claims, aud, pkce }); return code; };
  return srv;
}

test('cloud: Google and Apple sign-in, off until switched on', async (t) => {
  const prov = fakeProvider();
  await new Promise((r) => prov.listen(0, '127.0.0.1', r));
  const tokenUrl = 'http://127.0.0.1:' + prov.address().port + '/token';
  t.after(() => prov.close());
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const cloud = await startCloud(() => ({
    publicUrl: 'https://nexa.test', createsPerIpPerDay: 20,
    providers: { google: { clientId: 'g-client', clientSecret: 'g-secret' }, apple: { clientId: 'a-client', teamId: 'TEAM1', keyId: 'KEY1', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) } },
    endpoints: { google: { authorize: 'https://idp.test/auth', token: tokenUrl }, apple: { authorize: 'https://apple.test/auth', token: tokenUrl } },
  }));
  t.after(() => cloud.stop());
  const now = () => Math.floor(Date.now() / 1000);

  async function google(b, startQuery, claims) {
    const r = await b.get('/sso/google/start' + startQuery);
    assert.equal(r.status, 302, r.text);
    const u = new URL(r.headers.get('location'));
    assert.equal(u.origin + u.pathname, 'https://idp.test/auth');
    assert.equal(u.searchParams.get('redirect_uri'), 'https://nexa.test/sso/google/callback');
    const code = prov.issue({ iss: 'https://accounts.google.com', aud: 'g-client', exp: now() + 300, nonce: u.searchParams.get('nonce'), email_verified: true, ...claims }, 'g-client', u.searchParams.get('code_challenge'));
    return b.get(`/sso/google/callback?state=${u.searchParams.get('state')}&code=${code}`);
  }

  await t.test('the start page and sign-in screens offer both', async () => {
    assert.deepEqual((await browser(cloud.base).get('/cloud/config')).body.sso, ['google', 'apple']);
  });

  const owner = browser(cloud.base);
  await t.test('make a workspace with Google', async () => {
    const r = await google(owner, '?create=zeta&workspace=Zeta%20Co', { email: 'zoe@zeta.example', name: 'Zoe Z' });
    assert.equal(r.status, 302, r.text);
    assert.equal(r.headers.get('location'), '/#/home');
    const s = (await owner.get('/api/state')).body;
    assert.equal(s.workspace, 'Zeta Co');
    assert.equal(s.user.email, 'zoe@zeta.example');
    assert.equal(s.user.role, 'owner');
    assert.deepEqual(s.sso, ['google', 'apple']);
    // A Google-only owner can still add a password later.
    assert.equal((await owner.patch('/api/me', { newPassword: PW })).status, 200);
  });

  await t.test('sign back in with Google', async () => {
    const b = browser(cloud.base);
    await b.get('/w/zeta');
    const r = await google(b, '', { email: 'zoe@zeta.example' });
    assert.equal(r.status, 302);
    assert.equal((await b.get('/api/state')).body.user.email, 'zoe@zeta.example');
  });

  await t.test('strangers, wrong emails and replays are turned away', async () => {
    const b = browser(cloud.base);
    await b.get('/w/zeta');
    assert.equal((await google(b, '', { email: 'nobody@else.example' })).status, 400);
    assert.equal((await google(b, '', { email: 'zoe@zeta.example', email_verified: false })).status, 400);
    assert.equal((await google(b, '', { email: 'zoe@zeta.example', aud: 'someone-else' })).status, 400);
    assert.equal((await google(b, '', { email: 'zoe@zeta.example', nonce: 'wrong' })).status, 400);
    // A state that does not match this browser's cookie is refused.
    await b.get('/sso/google/start');
    const code = prov.issue({ iss: 'https://accounts.google.com', aud: 'g-client', exp: now() + 300, nonce: 'x', email: 'zoe@zeta.example', email_verified: true }, 'g-client');
    assert.equal((await b.get(`/sso/google/callback?state=forged&code=${code}`)).status, 400);
    assert.equal((await b.get('/api/state')).body.user, null);
  });

  await t.test('an invite accepted with Google must match its email', async () => {
    const tok = (await owner.post('/api/invites', { email: 'max@zeta.example', role: 'member' })).body.path.split('/').pop();
    const wrong = browser(cloud.base); await wrong.get('/w/zeta');
    assert.equal((await google(wrong, '?invite=' + tok, { email: 'other@zeta.example' })).status, 400);
    const max = browser(cloud.base); await max.get('/w/zeta');
    assert.equal((await google(max, '?invite=' + tok, { email: 'max@zeta.example', name: 'Max M' })).status, 302);
    assert.equal((await max.get('/api/state')).body.user.name, 'Max M');
  });

  await t.test('join with the team link and Apple, which posts back', async () => {
    const settings = (await owner.get('/api/settings')).body;
    const join = settings.join_token || (settings.settings && settings.settings.join_token);
    assert.ok(join, 'team link token');
    const b = browser(cloud.base); await b.get('/w/zeta');
    const r = await b.get('/sso/apple/start?join=' + join);
    const u = new URL(r.headers.get('location'));
    assert.equal(u.searchParams.get('response_mode'), 'form_post');
    const code = prov.issue({ iss: 'https://appleid.apple.com', aud: 'a-client', exp: now() + 300, nonce: u.searchParams.get('nonce'), email: 'amy@private.example', email_verified: 'true' }, 'a-client');
    const cb = await b.post('/sso/apple/callback', new URLSearchParams({ state: u.searchParams.get('state'), code, user: JSON.stringify({ name: { firstName: 'Amy', lastName: 'Apple' } }) }), { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://appleid.apple.com' });
    assert.equal(cb.status, 302, cb.text);
    const s = (await b.get('/api/state')).body;
    assert.equal(s.user.name, 'Amy Apple');
    assert.equal(s.user.role, 'member');
    // Apple's client secret is a short ES256 token signed with the team's key.
    const secret = prov.seen.at(-1).client_secret.split('.');
    const head = JSON.parse(Buffer.from(secret[0], 'base64url'));
    const body = JSON.parse(Buffer.from(secret[1], 'base64url'));
    assert.deepEqual([head.alg, head.kid, body.iss, body.sub, body.aud], ['ES256', 'KEY1', 'TEAM1', 'a-client', 'https://appleid.apple.com']);
    const pub = crypto.createPublicKey(privateKey);
    assert.ok(crypto.verify('sha256', Buffer.from(secret[0] + '.' + secret[1]), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(secret[2], 'base64url')));
  });

  await t.test('with no keys set, sign-in buttons stay hidden', async () => {
    const plain = await startCloud(() => ({ providers: {} }));
    t.after(() => plain.stop());
    const b = await makeWorkspace(plain, 'quiet', 'q@q.example');
    assert.deepEqual((await b.get('/api/state')).body.sso, []);
    assert.equal((await b.get('/sso/google/start')).status, 404);
  });
});
