'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, setupOwner, addUser } = require('./helpers');

test('files: permissions, folders, conflicts, versions and trash', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const owner = await setupOwner(srv, { sampleContent: false });
  const member = await addUser(srv, owner, 'max@test.example');
  const guest = await addUser(srv, owner, 'gus@test.example', 'guest', 'Gus Guest');
  const users = (await owner.get('/api/users')).body.users;
  const maxId = users.find((u) => u.email === 'max@test.example').id;

  const doc = (await owner.post('/api/files', { kind: 'doc', title: 'Plan' })).body.file;

  await t.test('private by default', async () => {
    assert.equal((await member.get('/api/files/' + doc.id)).status, 404);
  });

  await t.test('sharing view lets someone read but not edit', async () => {
    await owner.put(`/api/files/${doc.id}/shares`, { shares: [{ user_id: maxId, perm: 'view' }] });
    assert.equal((await member.get('/api/files/' + doc.id)).status, 200);
    const r = await member.put('/api/files/' + doc.id, { content: { html: '<p>hi</p>' }, baseVersion: 1 });
    assert.equal(r.status, 403);
  });

  await t.test('team-wide sharing reaches members but not guests', async () => {
    const d2 = (await owner.post('/api/files', { kind: 'sheet', title: 'Budget' })).body.file;
    await owner.patch('/api/files/' + d2.id, { workspace_perm: 'edit' });
    assert.equal((await member.get('/api/files/' + d2.id)).status, 200);
    assert.equal((await guest.get('/api/files/' + d2.id)).status, 404);
  });

  await t.test('access is inherited from folders', async () => {
    const folder = (await owner.post('/api/files', { kind: 'folder', title: 'Shared' })).body.file;
    const inner = (await owner.post('/api/files', { kind: 'deck', title: 'Pitch', parent_id: folder.id })).body.file;
    assert.equal((await member.get('/api/files/' + inner.id)).status, 404);
    await owner.put(`/api/files/${folder.id}/shares`, { shares: [{ user_id: maxId, perm: 'edit' }] });
    assert.equal((await member.get('/api/files/' + inner.id)).status, 200);
    const crumbs = (await member.get('/api/files/' + inner.id)).body.file.crumbs;
    assert.deepEqual(crumbs.map((c) => c.title), ['Shared']);
  });

  await t.test('saves keep versions and stale saves get a 409 instead of overwriting', async () => {
    const r1 = await owner.put('/api/files/' + doc.id, { content: { html: '<p>one</p>' }, baseVersion: 1 });
    assert.equal(r1.status, 200);
    const stale = await owner.put('/api/files/' + doc.id, { content: { html: '<p>two</p>' }, baseVersion: 1 });
    assert.equal(stale.status, 409);
    const v = (await owner.get(`/api/files/${doc.id}/versions`)).body;
    assert.equal(v.current, 2);
    assert.ok(v.versions.some((x) => x.version === 1));
  });

  await t.test('saved HTML is cleaned of scripts', async () => {
    const cur = (await owner.get('/api/files/' + doc.id)).body;
    await owner.put('/api/files/' + doc.id, { content: { html: '<p onclick="x()">ok</p><script>alert(1)</script><img src="javascript:alert(1)">' }, baseVersion: cur.file.version });
    const html = (await owner.get('/api/files/' + doc.id)).body.content.html;
    assert.ok(!/script|onclick|javascript:/i.test(html), html);
    assert.ok(html.includes('ok'));
  });

  await t.test('a folder cannot be moved inside itself', async () => {
    const a = (await owner.post('/api/files', { kind: 'folder', title: 'A' })).body.file;
    const b = (await owner.post('/api/files', { kind: 'folder', title: 'B', parent_id: a.id })).body.file;
    assert.equal((await owner.patch('/api/files/' + a.id, { parent_id: b.id })).status, 400);
  });

  await t.test('trash, restore and delete forever', async () => {
    const f = (await owner.post('/api/files', { kind: 'doc', title: 'Temp' })).body.file;
    await owner.patch('/api/files/' + f.id, { trashed: true });
    assert.ok((await owner.get('/api/files?view=trash')).body.files.some((x) => x.id === f.id));
    await owner.patch('/api/files/' + f.id, { trashed: false });
    assert.ok(!(await owner.get('/api/files?view=trash')).body.files.some((x) => x.id === f.id));
    assert.equal((await owner.delete('/api/files/' + f.id)).status, 400, 'must be in the trash first');
    await owner.patch('/api/files/' + f.id, { trashed: true });
    assert.equal((await member.delete('/api/files/' + f.id)).status, 404);
    assert.equal((await owner.delete('/api/files/' + f.id)).status, 200);
    assert.equal((await owner.get('/api/files/' + f.id)).status, 404);
  });

  await t.test('search only finds what you can open', async () => {
    await owner.post('/api/files', { kind: 'doc', title: 'Zebra secret' });
    assert.ok((await owner.get('/api/search?q=Zebra')).body.files.length >= 1);
    assert.equal((await member.get('/api/search?q=Zebra')).body.files.length, 0);
  });
});
