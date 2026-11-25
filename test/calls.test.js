'use strict';
// Huddle calls: where browsers find each other (STUN/TURN) and call signaling across reconnects.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const WebSocket = require('ws');
const { startServer, setupOwner, addUser } = require('./helpers');
const { createIce, iceFromEnv, DEFAULT_STUN } = require('../server/ice');

function socket(srv, c) {
  const ws = new WebSocket(srv.base.replace('http', 'ws') + '/ws', { headers: { cookie: c.cookie, origin: srv.base } });
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else inbox.push(m);
  });
  ws.next = (pred, ms = 3000) => {
    const i = inbox.findIndex(pred);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => { const w = { pred, resolve }; waiters.push(w); setTimeout(() => reject(new Error('timed out waiting for message')), ms); });
  };
  ws.none = async (pred, ms = 400) => { await new Promise((r) => setTimeout(r, ms)); return !inbox.some(pred); };
  ws.opened = new Promise((ok, no) => { ws.on('open', ok); ws.on('error', no); });
  ws.json = (m) => ws.send(JSON.stringify(m));
  return ws;
}
const quiet = { warn() {} };

test('ICE settings for calls', async (t) => {
  await t.test('with nothing set, people get public STUN servers only', async () => {
    const r = await createIce(iceFromEnv({})).forUser('u1');
    assert.deepEqual(r.iceServers, [{ urls: DEFAULT_STUN }]);
    assert.equal(r.relay, false);
    assert.equal(r.iceTransportPolicy, 'all');
  });

  await t.test('forcing relay is ignored when no TURN server is set', async () => {
    const r = await createIce(iceFromEnv({ NEXA_ICE_POLICY: 'relay' })).forUser('u1');
    assert.equal(r.iceTransportPolicy, 'all');
  });

  await t.test('a TURN server with a fixed login is handed out', async () => {
    const r = await createIce(iceFromEnv({ NEXA_TURN_URLS: 'turn:t.example:3478, turns:t.example:443?transport=tcp', NEXA_TURN_USERNAME: 'u', NEXA_TURN_CREDENTIAL: 'p', NEXA_ICE_POLICY: 'relay' })).forUser('u1');
    assert.deepEqual(r.iceServers[1], { urls: ['turn:t.example:3478', 'turns:t.example:443?transport=tcp'], username: 'u', credential: 'p' });
    assert.equal(r.relay, true);
    assert.equal(r.iceTransportPolicy, 'relay');
  });

  await t.test('a coturn shared secret becomes a short-lived login coturn can check', async () => {
    const r = await createIce(iceFromEnv({ NEXA_TURN_URLS: 'turn:t.example:3478', NEXA_TURN_SECRET: 's3cret' })).forUser('u_42');
    const turn = r.iceServers[1];
    const [expires, user] = turn.username.split(':');
    assert.equal(user, 'u_42');
    assert.ok(+expires > Date.now() / 1000 + 3600);
    assert.equal(turn.credential, crypto.createHmac('sha1', 's3cret').update(turn.username).digest('base64'));
  });

  await t.test('Cloudflare TURN logins are fetched once, reused, and leave out port 53', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'cfu', credential: 'cfc' }] }) };
    };
    const ice = createIce(iceFromEnv({ NEXA_TURN_CF_KEY_ID: 'key1', NEXA_TURN_CF_API_TOKEN: 'tok' }), { fetchImpl, log: quiet });
    const [a, b] = await Promise.all([ice.forUser('u1'), ice.forUser('u2')]);
    await ice.forUser('u3');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'https://rtc.live.cloudflare.com/v1/turn/keys/key1/credentials/generate-ice-servers');
    assert.equal(seen[0].init.method, 'POST');
    assert.equal(seen[0].init.headers.authorization, 'Bearer tok');
    assert.equal(JSON.parse(seen[0].init.body).ttl, 86400);
    const turn = a.iceServers.find((s) => s.username === 'cfu');
    assert.deepEqual(turn.urls, ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp']);
    assert.equal(a.relay, true);
    assert.deepEqual(a, b);
  });

  await t.test('if Cloudflare is down, calls still get STUN', async () => {
    let calls = 0;
    const ice = createIce(iceFromEnv({ NEXA_TURN_CF_KEY_ID: 'k', NEXA_TURN_CF_API_TOKEN: 't' }), { fetchImpl: async () => { calls++; return { ok: false, status: 401 }; }, log: quiet });
    const r = await ice.forUser('u1');
    assert.deepEqual(r.iceServers, [{ urls: DEFAULT_STUN }]);
    assert.equal(r.relay, false);
    await ice.forUser('u1');
    assert.equal(calls, 1, 'waits before asking again');
  });
});

test('call signaling', async (t) => {
  const srv = await startServer({ ice: { stun: ['stun:s.example:3478'], turnUrls: ['turn:t.example:3478'], turnUser: 'x', turnCred: 'y', policy: 'all' } });
  t.after(() => srv.stop());
  const owner = await setupOwner(srv, { sampleContent: false });
  const max = await addUser(srv, owner, 'max@test.example');
  const maxId = (await max.get('/api/state')).body.user.id;
  const dm = (await owner.post('/api/dm', { user_ids: [maxId] })).body.channel;
  const open = [];
  t.after(() => open.forEach((w) => w.terminate()));
  const sock = async (c) => { const w = socket(srv, c); open.push(w); await w.opened; await w.next((m) => m.t === 'hello'); return w; };

  await t.test('signed-in people get the ICE servers, others do not', async () => {
    assert.equal((await srv.client().get('/api/call/ice')).status, 401);
    const r = await owner.get('/api/call/ice');
    assert.equal(r.status, 200);
    assert.equal(r.body.relay, true);
    assert.deepEqual(r.body.iceServers[1], { urls: ['turn:t.example:3478'], username: 'x', credential: 'y' });
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  const a = await sock(owner);
  const b1 = await sock(max);

  await t.test('a burst of network candidates all gets through', async () => {
    a.json({ t: 'call.join', channel_id: dm.id });
    await a.next((m) => m.t === 'call.joined');
    b1.json({ t: 'call.join', channel_id: dm.id });
    await b1.next((m) => m.t === 'call.joined');
    await a.next((m) => m.t === 'call.peer');
    const ownerId = (await owner.get('/api/state')).body.user.id;
    for (let i = 0; i < 150; i++) b1.json({ t: 'call.signal', channel_id: dm.id, to: ownerId, data: { candidate: { candidate: 'c' + i } } });
    for (let i = 0; i < 150; i++) await a.next((m) => m.t === 'call.signal' && m.data.candidate.candidate === 'c' + i);
  });

  await t.test('rejoining from a new connection keeps the person in the call', async () => {
    const b2 = await sock(max);
    b2.json({ t: 'call.join', channel_id: dm.id });
    const j = await b2.next((m) => m.t === 'call.joined');
    assert.equal(j.peers.length, 1, 'sees the other person');
    const p = await a.next((m) => m.t === 'call.peer');
    assert.equal(p.user_id, maxId, 'the other person is told to reconnect');
    assert.equal(p.participants.length, 2);
    // the old connection finally closes: Max is still in the call through the new one
    b1.close();
    assert.ok(await a.none((m) => m.t === 'call.left'), 'no leave while another connection is in the call');
    const ch = (await owner.get('/api/channels')).body.channels.find((c) => c.id === dm.id);
    assert.equal(ch.in_call, 2);
    b2.close();
    const left = await a.next((m) => m.t === 'call.left');
    assert.equal(left.user_id, maxId);
    assert.equal(left.participants.length, 1);
  });

  await t.test('leaving on purpose ends the call for that person', async () => {
    const b3 = await sock(max);
    b3.json({ t: 'call.join', channel_id: dm.id });
    await b3.next((m) => m.t === 'call.joined');
    await a.next((m) => m.t === 'call.peer');
    b3.json({ t: 'call.leave', channel_id: dm.id });
    assert.equal((await a.next((m) => m.t === 'call.left')).user_id, maxId);
  });
});

// Someone without an account joins one call from a link (say, a parent on their phone).
function guestSocket(srv, token, name = 'Dad') {
  const ws = new WebSocket(`${srv.base.replace('http', 'ws')}/ws/guest?t=${encodeURIComponent(token)}&name=${encodeURIComponent(name)}`, { headers: { origin: srv.base } });
  const inbox = [], waiters = [];
  ws.on('message', (d) => { const m = JSON.parse(d); const i = waiters.findIndex((w) => w.pred(m)); if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else inbox.push(m); });
  ws.next = (pred, ms = 3000) => {
    const i = inbox.findIndex(pred);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => { waiters.push({ pred, resolve }); setTimeout(() => reject(new Error('timed out waiting for message')), ms); });
  };
  ws.none = async (pred, ms = 400) => { await new Promise((r) => setTimeout(r, ms)); return !inbox.some(pred); };
  ws.opened = new Promise((ok, no) => { ws.on('open', ok); ws.on('error', no); ws.on('unexpected-response', (q, res) => no(new Error('HTTP ' + res.statusCode))); });
  ws.closed = new Promise((ok) => ws.on('close', (code) => ok(code)));
  ws.json = (m) => ws.send(JSON.stringify(m));
  return ws;
}
const tokenOf = (r) => r.body.path.split('/').pop();

test('guest call links', async (t) => {
  const srv = await startServer({ callLinks: { graceMs: 80 } });
  t.after(() => srv.stop());
  const owner = await setupOwner(srv, { sampleContent: false });
  const max = await addUser(srv, owner, 'max@test.example');
  const zed = await addUser(srv, owner, 'zed@test.example', 'member', 'Zed Member');
  const maxId = (await max.get('/api/state')).body.user.id;
  const ownerId = (await owner.get('/api/state')).body.user.id;
  const dm = (await owner.post('/api/dm', { user_ids: [maxId] })).body.channel;
  const open = [];
  t.after(() => open.forEach((w) => w.terminate()));
  const sock = async (c) => { const w = socket(srv, c); open.push(w); await w.opened; await w.next((m) => m.t === 'hello'); return w; };
  const guest = async (token, name) => { const w = guestSocket(srv, token, name); open.push(w); await w.opened; return w; };

  await t.test('only people in the conversation can make a link', async () => {
    assert.equal((await srv.client().post(`/api/channels/${dm.id}/call-link`, {})).status, 401);
    assert.ok((await zed.post(`/api/channels/${dm.id}/call-link`, {})).status >= 400, 'someone outside the DM');
    const r = await owner.post(`/api/channels/${dm.id}/call-link`, {});
    assert.equal(r.status, 200);
    assert.match(r.body.path, /^\/call\/[A-Za-z0-9_-]{43}$/);
    assert.ok(r.body.expiresAt > Date.now() + 11 * 3600 * 1000);
  });

  await t.test('the link opens a page that names the host and leaks nothing', async () => {
    const token = tokenOf(await owner.post(`/api/channels/${dm.id}/call-link`, {}));
    const page = await srv.client().get('/call/' + token);
    assert.equal(page.status, 200);
    assert.match(page.buf.toString(), /guest-call\.js/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const info = await srv.client().get('/api/guest/call/' + token);
    assert.equal(info.status, 200);
    assert.deepEqual(Object.keys(info.body).sort(), ['expiresAt', 'host']);
    assert.equal(info.body.host, 'Olive Owner');
    assert.equal((await srv.client().get('/api/guest/call/' + token + '/ice')).status, 200);
    for (const bad of ['nope', 'x'.repeat(43), token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')]) {
      assert.equal((await srv.client().get('/api/guest/call/' + bad)).status, 404, bad);
      assert.equal((await srv.client().get('/api/guest/call/' + bad + '/ice')).status, 404, bad);
    }
    await assert.rejects(guest('x'.repeat(43)).then(() => {}), /HTTP 410/);
  });

  const token = tokenOf(await owner.post(`/api/channels/${dm.id}/call-link`, {}));
  const a = await sock(owner);

  await t.test('a guest joins that one call and talks both ways', async () => {
    const g = await guest(token, 'Dad');
    const hi = await g.next((m) => m.t === 'hello');
    assert.equal(hi.guest, true);
    assert.equal(hi.channel_id, dm.id);
    assert.equal(hi.online, undefined, 'no list of who is online');
    assert.ok(await a.none((m) => m.t === 'presence' && m.user_id === hi.user_id), 'workspace does not see the guest come online');
    // the guest arrives first and waits
    g.json({ t: 'call.join', channel_id: dm.id });
    assert.deepEqual((await g.next((m) => m.t === 'call.joined')).peers, []);
    a.json({ t: 'call.join', channel_id: dm.id });
    const joined = await a.next((m) => m.t === 'call.joined');
    assert.deepEqual(joined.peers, [hi.user_id]);
    assert.deepEqual(joined.participants.find((p) => p.id === hi.user_id), { id: hi.user_id, name: 'Dad (guest)', since: joined.participants.find((p) => p.id === hi.user_id).since, guest: true });
    assert.equal((await g.next((m) => m.t === 'call.peer')).user_id, ownerId);
    g.json({ t: 'call.signal', channel_id: dm.id, to: ownerId, data: { description: { type: 'offer', sdp: 'o' } } });
    const s1 = await a.next((m) => m.t === 'call.signal');
    assert.equal(s1.from, hi.user_id);
    assert.equal(s1.name, 'Dad (guest)');
    a.json({ t: 'call.signal', channel_id: dm.id, to: hi.user_id, data: { description: { type: 'answer', sdp: 'a' } } });
    assert.equal((await g.next((m) => m.t === 'call.signal')).data.description.type, 'answer');
    g.json({ t: 'call.state', channel_id: dm.id, muted: true });
    assert.equal((await a.next((m) => m.t === 'call.state')).muted, true);
    g.close();
    assert.equal((await a.next((m) => m.t === 'call.left')).user_id, hi.user_id);
  });

  await t.test('a guest gets nothing else from the workspace', async () => {
    const other = (await owner.post('/api/channels', { name: 'secret-plans' })).body.channel;
    const g = await guest(token);
    await g.next((m) => m.t === 'hello');
    g.json({ t: 'call.join', channel_id: other.id });
    g.json({ t: 'typing', channel_id: dm.id });
    g.json({ t: 'file.watch', id: 'anything' });
    assert.ok(await a.none((m) => m.t === 'typing'), 'typing from a guest goes nowhere');
    assert.ok(await g.none((m) => m.t === 'call.joined'), 'cannot join another call');
    // workspace news does not reach a guest
    const m2 = await sock(max);
    assert.ok((await owner.post(`/api/channels/${dm.id}/messages`, { body: 'private note' })).status < 300);
    await m2.next((m) => m.t === 'message.new'); // members hear about it
    assert.ok(await g.none((m) => m.t === 'presence' || m.t === 'message' || m.t === 'message.new'), 'no presence or messages');
    m2.close();
    g.close();
    // a guest's cookie-less request gets no workspace data
    assert.equal((await srv.client().get('/api/channels')).status, 401);
  });

  await t.test('the host can remove a guest, which ends their link', async () => {
    const g = await guest(token);
    const hi = await g.next((m) => m.t === 'hello');
    g.json({ t: 'call.join', channel_id: dm.id });
    await g.next((m) => m.t === 'call.joined');
    await a.next((m) => m.t === 'call.peer' && m.user_id === hi.user_id);
    // a guest cannot remove anyone
    g.json({ t: 'call.remove', channel_id: dm.id, user_id: ownerId });
    a.json({ t: 'call.remove', channel_id: dm.id, user_id: ownerId }); // and members are not removable
    assert.ok(await a.none((m) => m.t === 'call.left'));
    a.json({ t: 'call.remove', channel_id: dm.id, user_id: hi.user_id });
    assert.equal(await g.closed, 4003);
    assert.equal((await a.next((m) => m.t === 'call.left')).user_id, hi.user_id);
    assert.equal((await srv.client().get('/api/guest/call/' + token)).status, 404);
    await assert.rejects(guest(token).then(() => {}), /HTTP 410/);
    a.json({ t: 'call.leave', channel_id: dm.id });
  });

  await t.test('a link ends a little after the call it was used in ends', async () => {
    const early = tokenOf(await owner.post(`/api/channels/${dm.id}/call-link`, {}));
    const used = tokenOf(await owner.post(`/api/channels/${dm.id}/call-link`, {}));
    const g = await guest(used);
    await g.next((m) => m.t === 'hello');
    g.json({ t: 'call.join', channel_id: dm.id });
    await g.next((m) => m.t === 'call.joined');
    // a guest alone in the call does not use up the link
    g.json({ t: 'call.leave', channel_id: dm.id });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal((await srv.client().get('/api/guest/call/' + used)).status, 200, 'still fine before the host came');
    g.json({ t: 'call.join', channel_id: dm.id });
    await g.next((m) => m.t === 'call.joined');
    a.json({ t: 'call.join', channel_id: dm.id });
    await a.next((m) => m.t === 'call.joined');
    // a short drop (the host's phone loses signal) does not end it
    a.json({ t: 'call.leave', channel_id: dm.id });
    a.json({ t: 'call.join', channel_id: dm.id });
    await a.next((m) => m.t === 'call.joined');
    a.json({ t: 'call.leave', channel_id: dm.id });
    g.json({ t: 'call.leave', channel_id: dm.id });
    assert.equal(await g.closed, 4004, 'the guest is told the call is over');
    assert.equal((await srv.client().get('/api/guest/call/' + used)).status, 404);
    assert.equal((await srv.client().get('/api/guest/call/' + early)).status, 200, 'a link nobody has used yet keeps working');
  });
});

test('guest call links expire', async (t) => {
  const srv = await startServer({ callLinks: { ttlMs: 300 } });
  t.after(() => srv.stop());
  const owner = await setupOwner(srv, { sampleContent: false });
  const ch = (await owner.get('/api/channels')).body.channels[0];
  const token = tokenOf(await owner.post(`/api/channels/${ch.id}/call-link`, {}));
  const g = guestSocket(srv, token); await g.opened; await g.next((m) => m.t === 'hello');
  assert.equal((await srv.client().get('/api/guest/call/' + token)).status, 200);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await srv.client().get('/api/guest/call/' + token)).status, 404);
  g.json({ t: 'call.join', channel_id: ch.id });
  assert.equal(await g.closed, 4004, 'an open connection is closed on its next message');
  await assert.rejects(guestSocket(srv, token).opened, /HTTP 410/);
});
