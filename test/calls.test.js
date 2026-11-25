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
