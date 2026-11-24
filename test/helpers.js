'use strict';
// Shared test helpers: a throwaway server with an in-memory database, and a tiny client that keeps its own cookie.
const { createServer } = require('../server/app');

async function startServer(opts = {}) {
  const s = createServer({ dbPath: ':memory:', quiet: true, ...opts });
  await new Promise((r) => s.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + s.server.address().port;
  return { ...s, base, client: () => client(base), stop: () => new Promise((r) => { s.close(); r(); }) };
}

function client(base) {
  const c = { cookie: '', base };
  c.req = async (method, path, body, headers = {}) => {
    const isRaw = Buffer.isBuffer(body) || typeof body === 'string';
    const r = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { origin: base, 'x-nexa-csrf': '1', ...(c.cookie ? { cookie: c.cookie } : {}), ...(body !== undefined && !isRaw ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body),
    });
    for (const sc of r.headers.getSetCookie()) if (sc.startsWith('nexa_sid=')) c.cookie = sc.split(';')[0];
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null; try { json = JSON.parse(buf.toString()); } catch { /* not json */ }
    return { status: r.status, body: json, buf, headers: r.headers };
  };
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) c[m] = (p, b, h) => c.req(m.toUpperCase(), p, b, h);
  return c;
}

const PW = 'correct horse battery 9';
async function setupOwner(srv, extra = {}) {
  const owner = srv.client();
  const r = await owner.post('/api/setup', { workspace: 'Test Co', name: 'Olive Owner', email: 'olive@test.example', password: PW, sampleContent: true, ...extra });
  if (r.status !== 201 && r.status !== 200) throw new Error('setup failed ' + r.status + JSON.stringify(r.body));
  return owner;
}
async function addUser(srv, owner, email, role = 'member', name = 'Max Member') {
  const inv = await owner.post('/api/invites', { email, role });
  const token = inv.body.path.split('/').pop();
  const u = srv.client();
  const r = await u.post(`/api/invites/${token}/accept`, { name, password: PW });
  if (r.status >= 300) throw new Error('accept failed ' + JSON.stringify(r.body));
  return u;
}
module.exports = { startServer, client, setupOwner, addUser, PW };
