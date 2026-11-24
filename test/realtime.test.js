'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { startServer, setupOwner, addUser } = require('./helpers');

function socket(srv, c, extraHeaders = {}) {
  const ws = new WebSocket(srv.base.replace('http', 'ws') + '/ws', { headers: { cookie: c.cookie, origin: srv.base, ...extraHeaders } });
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
  ws.opened = new Promise((ok, no) => { ws.on('open', ok); ws.on('error', no); ws.on('unexpected-response', (req, res) => no(new Error('HTTP ' + res.statusCode))); });
  return ws;
}

test('realtime: presence, chat, file updates and calls', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const owner = await setupOwner(srv, { sampleContent: false });
  const max = await addUser(srv, owner, 'max@test.example');

  await t.test('sockets need a signed-in session from the same site', async () => {
    await assert.rejects(socket(srv, srv.client()).opened);
    await assert.rejects(socket(srv, owner, { origin: 'https://evil.example' }).opened);
  });

  const a = socket(srv, owner); await a.opened;
  const b = socket(srv, max); await b.opened;
  t.after(() => { a.close(); b.close(); });
  await a.next((m) => m.t === 'hello');
  await b.next((m) => m.t === 'hello');

  await t.test('new chat messages reach channel members live', async () => {
    const ch = (await owner.get('/api/channels')).body.channels.find((c) => c.kind !== 'dm');
    await owner.post(`/api/channels/${ch.id}/messages`, { body: 'hello team' });
    const m = await b.next((x) => x.t === 'message.new');
    assert.equal(m.message.body, 'hello team');
  });

  await t.test('people watching a file hear when it is saved', async () => {
    const d = (await owner.post('/api/files', { kind: 'doc', title: 'Live', workspace_perm: 'edit' })).body.file;
    await owner.patch('/api/files/' + d.id, { workspace_perm: 'edit' });
    b.send(JSON.stringify({ t: 'file.watch', id: d.id }));
    await b.next((x) => x.t === 'file.presence');
    await owner.put('/api/files/' + d.id, { baseVersion: 1, content: { html: '<p>v2</p>' } });
    const m = await b.next((x) => x.t === 'file.saved');
    assert.equal(m.version, 2);
  });

  await t.test('calls tell existing people about a new peer', async () => {
    const dm = (await owner.post('/api/dm', { user_ids: [(await max.get('/api/state')).body.user.id] })).body.channel;
    a.send(JSON.stringify({ t: 'call.join', channel_id: dm.id }));
    assert.deepEqual((await a.next((x) => x.t === 'call.joined')).peers, []);
    b.send(JSON.stringify({ t: 'call.join', channel_id: dm.id }));
    const j = await b.next((x) => x.t === 'call.joined');
    assert.equal(j.peers.length, 1);
    const p = await a.next((x) => x.t === 'call.peer');
    assert.equal(p.name, 'Max Member');
  });

  await t.test('turning off an account closes its live connection', async () => {
    const id = (await max.get('/api/state')).body.user.id;
    const closed = new Promise((r) => b.on('close', (code) => r(code)));
    await owner.patch('/api/users/' + id, { status: 'disabled' });
    assert.equal(await closed, 4001);
    assert.equal((await max.get('/api/files')).status, 401);
  });
});
