'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, setupOwner, addUser } = require('./helpers');

test('Vault: uploads, versions, share links, storage and drive sync', async (t) => {
  const srv = await startServer({ maxUpload: 1024 * 1024, quotaBytes: 2 * 1024 * 1024 });
  t.after(() => srv.stop());
  const owner = await setupOwner(srv);
  const max = await addUser(srv, owner, 'max@test.example');
  const up = (c, name, data, parent) => c.post('/api/upload' + (parent ? '?parent=' + parent : ''), Buffer.from(data), { 'x-filename': encodeURIComponent(name), 'content-type': 'application/octet-stream' });

  let photo;
  await t.test('uploads keep their bytes and refuse files over the limit or quota', async () => {
    const r = await up(owner, 'note.txt', 'hello vault');
    assert.equal(r.status, 201);
    photo = r.body.file;
    assert.equal((await owner.get(`/api/files/${photo.id}/raw`)).buf.toString(), 'hello vault');
    assert.equal((await up(owner, 'big.bin', Buffer.alloc(1024 * 1024 + 10))).status, 413);
    for (let i = 0; i < 2; i++) await up(owner, `half${i}.bin`, Buffer.alloc(900 * 1024));
    assert.equal((await up(owner, 'over.bin', Buffer.alloc(900 * 1024))).status, 507, 'a full Vault answers Insufficient Storage');
  });

  await t.test('replacing an upload keeps the old copy in history and it can be restored', async () => {
    const r = await owner.put(`/api/files/${photo.id}/blob`, Buffer.from('hello vault v2'), { 'content-type': 'application/octet-stream', 'x-mime': 'text/plain' });
    assert.equal(r.status, 200);
    const v = (await owner.get(`/api/files/${photo.id}/versions`)).body;
    assert.equal(v.versions[0].version, 1);
    assert.equal((await owner.get(`/api/files/${photo.id}/versions/1/raw`)).buf.toString(), 'hello vault');
    await owner.post(`/api/files/${photo.id}/versions/1/restore`);
    assert.equal((await owner.get(`/api/files/${photo.id}/raw`)).buf.toString(), 'hello vault');
  });

  await t.test('public links work without signing in, end when turned off, and obey the owner switch', async () => {
    const anon = srv.client();
    const l = (await owner.post(`/api/files/${photo.id}/links`, { expires_days: 7, allow_download: true })).body.link;
    const page = await anon.get(l.path);
    assert.equal(page.status, 200);
    assert.match(page.buf.toString(), /note\.txt/);
    assert.equal((await anon.get(l.path + '/raw')).buf.toString(), 'hello vault');
    assert.ok([403, 404].includes((await max.post(`/api/files/${photo.id}/links`, {})).status), 'only people with access can make links');
    await owner.patch('/api/settings/links', { public_links: false });
    assert.equal((await anon.get(l.path)).status, 404);
    await owner.patch('/api/settings/links', { public_links: true });
    assert.equal((await anon.get(l.path)).status, 200);
    await owner.delete('/api/links/' + l.token);
    assert.equal((await anon.get(l.path)).status, 404);
  });

  await t.test('view-only links do not allow downloads', async () => {
    const l = (await owner.post(`/api/files/${photo.id}/links`, { allow_download: false })).body.link;
    assert.equal((await srv.client().get(l.path + '/raw')).status, 403);
  });

  await t.test('docs, sheets and decks have read-only public pages', async () => {
    const files = (await owner.get('/api/files')).body.files;
    for (const kind of ['doc', 'sheet', 'deck']) {
      const f = files.find((x) => x.kind === kind);
      const l = (await owner.post(`/api/files/${f.id}/links`, {})).body.link;
      const p = await srv.client().get(l.path);
      assert.equal(p.status, 200, kind);
      assert.ok(!/<script/i.test(p.buf.toString()), 'public pages run no scripts');
    }
  });

  await t.test('storage shows what is used', async () => {
    const s = (await owner.get('/api/storage')).body;
    assert.ok(s.used > 1024 * 1024);
    assert.equal(s.quota, 2 * 1024 * 1024);
  });

  await t.test('drive sync over WebDAV with a sync password', async () => {
    const sp = (await owner.post('/api/sync-passwords', { name: 'Laptop' })).body;
    assert.match(sp.password, /^[\w]{4}(-[\w]{4}){4}$/);
    const auth = { authorization: 'Basic ' + Buffer.from('olive@test.example:' + sp.password).toString('base64') };
    const dav = (method, p, body, h = {}) => srv.client().req(method, p, body, { ...auth, ...h });
    assert.equal((await srv.client().req('PROPFIND', '/dav/', undefined, { depth: '1' })).status, 401);
    const wrongPw = { authorization: 'Basic ' + Buffer.from('olive@test.example:correct horse battery 9').toString('base64') };
    assert.equal((await srv.client().req('PROPFIND', '/dav/', undefined, { ...wrongPw, depth: '1' })).status, 401, 'the main password is not a sync password');
    const list = await dav('PROPFIND', '/dav/', undefined, { depth: '1' });
    assert.equal(list.status, 207);
    assert.match(list.buf.toString(), /note\.txt/);
    assert.match(list.buf.toString(), /\.docx</, 'Write docs show up as .docx');
    assert.equal((await dav('MKCOL', '/dav/Photos')).status, 201);
    assert.equal((await dav('PUT', '/dav/Photos/a.txt', 'one')).status, 201);
    assert.equal((await dav('PUT', '/dav/Photos/a.txt', 'two')).status, 204);
    assert.equal((await dav('GET', '/dav/Photos/a.txt')).buf.toString(), 'two');
    assert.equal((await dav('MOVE', '/dav/Photos/a.txt', undefined, { destination: srv.base + '/dav/Photos/b.txt' })).status, 201);
    assert.equal((await dav('GET', '/dav/Photos/b.txt')).buf.toString(), 'two');
    assert.equal((await dav('DELETE', '/dav/Photos')).status, 204);
    assert.ok((await owner.get('/api/files?view=trash')).body.files.some((f) => f.title === 'Photos'), 'deleting from the drive moves to Trash');
    const docs = (await owner.get('/api/files')).body.files.filter((f) => f.kind === 'doc');
    const d = await dav('GET', '/dav/' + encodeURIComponent(docs[0].title + '.docx'));
    assert.equal(d.buf.slice(0, 2).toString(), 'PK');
    assert.ok([200, 204].includes((await dav('PUT', '/dav/' + encodeURIComponent(docs[0].title + '.docx'), d.buf)).status));
    assert.ok((await owner.get(`/api/files/${docs[0].id}/versions`)).body.versions.length >= 1, 'saving over a doc from the drive keeps a version');
    const pw = (await owner.get('/api/sync-passwords')).body.passwords[0];
    await owner.delete('/api/sync-passwords/' + pw.id);
    assert.equal((await dav('PROPFIND', '/dav/', undefined, { depth: '0' })).status, 401);
  });

  await t.test('people only see their own files on the drive', async () => {
    const sp = (await max.post('/api/sync-passwords', { name: 'Phone' })).body;
    const auth = { authorization: 'Basic ' + Buffer.from('max@test.example:' + sp.password).toString('base64'), depth: '1' };
    const r = await srv.client().req('PROPFIND', '/dav/', undefined, auth);
    assert.ok(!/note\.txt/.test(r.buf.toString()));
  });
});
