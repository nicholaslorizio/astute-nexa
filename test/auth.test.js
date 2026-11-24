'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, setupOwner, addUser, PW } = require('./helpers');

test('sign-up, sign-in, roles, CSRF and the team link', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const anon = srv.client();

  await t.test('a new server asks for setup', async () => {
    const s = await anon.get('/api/state');
    assert.equal(s.body.setupNeeded, true);
    assert.equal(s.body.user, null);
  });

  await t.test('weak passwords and bad emails are refused', async () => {
    assert.equal((await anon.post('/api/setup', { name: 'A', email: 'a@b.example', password: 'short' })).status, 400);
    assert.equal((await anon.post('/api/setup', { name: 'A', email: 'not-an-email', password: PW })).status, 400);
  });

  const owner = await setupOwner(srv);
  await t.test('setup makes an owner and cannot run twice', async () => {
    const s = await owner.get('/api/state');
    assert.equal(s.body.user.role, 'owner');
    assert.equal((await srv.client().post('/api/setup', { name: 'Eve', email: 'eve@x.example', password: PW })).status, 409);
  });

  await t.test('requests without the CSRF header or from another site are refused', async () => {
    const r1 = await owner.post('/api/files', { kind: 'doc', title: 'x' }, { 'x-nexa-csrf': '' });
    assert.equal(r1.status, 403);
    const r2 = await owner.post('/api/files', { kind: 'doc', title: 'x' }, { origin: 'https://evil.example' });
    assert.equal(r2.status, 403);
  });

  await t.test('wrong passwords fail and right ones work', async () => {
    const c = srv.client();
    assert.equal((await c.post('/api/login', { email: 'olive@test.example', password: 'wrong password here' })).status, 401);
    assert.equal((await c.post('/api/login', { email: 'olive@test.example', password: PW })).status, 200);
    assert.equal((await c.get('/api/state')).body.user.email, 'olive@test.example');
    await c.post('/api/logout');
    assert.equal((await c.get('/api/files')).status, 401);
  });

  await t.test('members cannot invite or change roles; owners can', async () => {
    const member = await addUser(srv, owner, 'max@test.example');
    assert.equal((await member.post('/api/invites', { email: 'z@test.example', role: 'member' })).status, 403);
    const users = (await owner.get('/api/users')).body.users;
    const max = users.find((u) => u.email === 'max@test.example');
    assert.equal((await member.patch('/api/users/' + max.id, { role: 'admin' })).status, 403);
    assert.equal((await owner.patch('/api/users/' + max.id, { role: 'admin' })).status, 200);
  });

  await t.test('the team link lets people join and can be limited to a domain or turned off', async () => {
    const s = (await owner.get('/api/settings')).body;
    const tok = s.join_token;
    assert.equal((await anon.get('/api/join/' + tok)).status, 200);
    await owner.patch('/api/settings', { join_domain: 'test.example' });
    assert.equal((await srv.client().post('/api/join/' + tok, { name: 'Out', email: 'out@other.example', password: PW })).status, 400);
    const j = srv.client();
    assert.equal((await j.post('/api/join/' + tok, { name: 'Ina', email: 'ina@test.example', password: PW })).status, 201);
    assert.equal((await j.get('/api/state')).body.user.role, 'member');
    await owner.patch('/api/settings', { join_enabled: false });
    assert.equal((await anon.get('/api/join/' + tok)).status, 404);
  });
});
