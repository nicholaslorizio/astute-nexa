'use strict';
// Checks for four bugs found in the Nov 25 review: mail sharing files it shouldn't, files in the
// trash staying open to others, and repeating events landing on the wrong days or hours.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, setupOwner, addUser } = require('./helpers');
const { toIcs, parseIcs } = require('../server/relay-cadence');
const TZ = require('../server/tz');
const DAY = 86400e3;

test('mail and trash keep file access in check', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const owner = await setupOwner(srv, { sampleContent: false });
  const max = await addUser(srv, owner, 'max@test.example', 'member', 'Max');
  const eve = await addUser(srv, owner, 'eve@test.example', 'member', 'Eve');
  const ed = await addUser(srv, owner, 'ed@test.example', 'member', 'Ed');
  const ids = Object.fromEntries((await owner.get('/api/users')).body.users.map((u) => [u.email.split('@')[0], u.id]));

  await t.test('someone who can only view a file cannot mail it to people who cannot open it', async () => {
    const doc = (await owner.post('/api/files', { kind: 'doc', title: 'Salaries' })).body.file;
    await owner.put(`/api/files/${doc.id}/shares`, { shares: [{ user_id: ids.max, perm: 'view' }, { user_id: ids.ed, perm: 'view' }] });
    const r = await max.post('/api/mail', { to: 'eve@test.example', subject: 'fyi', body_html: 'see attached', attachments: [doc.id] });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /can view "Salaries" but not share it/);
    assert.equal((await eve.get('/api/files/' + doc.id)).status, 404, 'Eve still has no access');
    // Mailing it to someone who can already open it is fine.
    assert.equal((await max.post('/api/mail', { to: 'ed@test.example', subject: 'fyi', body_html: 'x', attachments: [doc.id] })).status, 201);
    // A draft can hold it; the check happens on send.
    assert.equal((await max.post('/api/mail', { draft: true, to: 'eve@test.example', subject: 'later', body_html: 'x', attachments: [doc.id] })).status, 201);
  });

  await t.test('an owner or editor mailing a file still gives recipients view access', async () => {
    const doc = (await owner.post('/api/files', { kind: 'doc', title: 'Notes' })).body.file;
    await owner.put(`/api/files/${doc.id}/shares`, { shares: [{ user_id: ids.ed, perm: 'edit' }] });
    assert.equal((await ed.post('/api/mail', { to: 'eve@test.example', subject: 'notes', body_html: 'x', attachments: [doc.id] })).status, 201);
    const got = await eve.get('/api/files/' + doc.id);
    assert.equal(got.status, 200);
    assert.equal(got.body.file.perm, 'view');
  });

  await t.test('a file in the trash is closed to the people it was shared with', async () => {
    const doc = (await owner.post('/api/files', { kind: 'doc', title: 'Old plan' })).body.file;
    await owner.put(`/api/files/${doc.id}/shares`, { shares: [{ user_id: ids.max, perm: 'edit' }] });
    assert.equal((await max.get('/api/files/' + doc.id)).status, 200);
    await owner.patch('/api/files/' + doc.id, { trashed: true });
    assert.equal((await max.get('/api/files/' + doc.id)).status, 404);
    assert.equal((await max.put('/api/files/' + doc.id, { content: { html: '<p>x</p>' }, baseVersion: 1 })).status, 404);
    assert.ok(!(await max.get('/api/files?view=shared')).body.files.some((f) => f.id === doc.id));
    assert.equal((await owner.get('/api/files/' + doc.id)).status, 200, 'the owner can still open it to restore it');
    await owner.patch('/api/files/' + doc.id, { trashed: false });
    assert.equal((await max.get('/api/files/' + doc.id)).status, 200, 'restoring it brings access back');
  });

  await t.test('files inside a folder in the trash are closed too, public links included', async () => {
    const folder = (await owner.post('/api/files', { kind: 'folder', title: 'Project' })).body.file;
    const inner = (await owner.post('/api/files', { kind: 'doc', title: 'Brief', parent_id: folder.id })).body.file;
    await owner.patch('/api/files/' + folder.id, { workspace_perm: 'view' });
    const link = (await owner.post(`/api/files/${inner.id}/links`, {})).body.link;
    const anon = srv.client();
    assert.equal((await eve.get('/api/files/' + inner.id)).status, 200);
    assert.equal((await anon.get(link.path)).status, 200);
    await owner.patch('/api/files/' + folder.id, { trashed: true });
    assert.equal((await eve.get('/api/files/' + inner.id)).status, 404);
    assert.equal((await eve.get('/api/files?parent=' + folder.id)).status, 404);
    assert.equal((await anon.get(link.path)).status, 404);
    assert.equal((await owner.get('/api/files/' + inner.id)).status, 200);
  });
});

test('repeating events follow the organizer’s own clock', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const owner = await setupOwner(srv, { sampleContent: false });
  const NY = 'America/New_York';
  const at = (y, m, d, h, mi = 0) => TZ.toMs(y, m, d, h, mi, 0, 0, NY);
  const local = (ms) => { const p = TZ.parts(ms, NY); return { day: TZ.weekday(p.y, p.m, p.d), date: `${p.y}-${p.m}-${p.d}`, h: p.h, mi: p.mi }; };
  const get = async (title, from, to, q = '') => (await owner.get(`/api/events?from=${from}&to=${to}${q}`)).body.events.filter((e) => e.title === title);

  await t.test('an 8 PM weekday event in New York lands Monday to Friday', async () => {
    const start = at(2026, 11, 2, 20); // Monday Nov 2, 8 PM, which is already Tuesday in UTC
    await owner.post('/api/events', { title: 'Evening review', start_at: start, end_at: start + 3600e3, recurrence: 'weekdays', tz: NY });
    const list = await get('Evening review', start - DAY, start + 14 * DAY - 1);
    assert.equal(list.length, 10);
    assert.deepEqual([...new Set(list.map((e) => local(e.start_at).day))].sort(), [1, 2, 3, 4, 5]);
    assert.ok(list.every((e) => local(e.start_at).h === 20));
  });

  await t.test('a daily event keeps its hour across the daylight saving change', async () => {
    const start = at(2026, 3, 5, 9, 30); // March 5; clocks move forward on March 8
    await owner.post('/api/events', { title: 'Standup NY', start_at: start, end_at: start + 900e3, recurrence: 'daily', tz: NY });
    const list = await get('Standup NY', start - DAY, start + 8 * DAY);
    assert.equal(list.length, 9);
    assert.ok(list.every((e) => local(e.start_at).h === 9 && local(e.start_at).mi === 30), JSON.stringify(list.map((e) => local(e.start_at))));
    const weekly = at(2026, 10, 26, 18); // Monday Oct 26; clocks move back on Nov 1
    await owner.post('/api/events', { title: 'Weekly NY', start_at: weekly, end_at: weekly + 3600e3, recurrence: 'weekly', tz: NY });
    const w = await get('Weekly NY', weekly - DAY, weekly + 15 * DAY);
    assert.deepEqual(w.map((e) => local(e.start_at)), [
      { day: 1, date: '2026-10-26', h: 18, mi: 0 }, { day: 1, date: '2026-11-2', h: 18, mi: 0 }, { day: 1, date: '2026-11-9', h: 18, mi: 0 }]);
  });

  await t.test('a monthly event on the 31st skips months without a 31st', async () => {
    const start = at(2027, 1, 31, 10);
    await owner.post('/api/events', { title: 'Month end', start_at: start, end_at: start + 3600e3, recurrence: 'monthly', tz: NY });
    const list = await get('Month end', start - DAY, start + 200 * DAY);
    assert.deepEqual(list.map((e) => local(e.start_at).date), ['2027-1-31', '2027-3-31', '2027-5-31', '2027-7-31']);
  });

  await t.test('events saved before time zones were kept use the viewer’s time zone', async () => {
    const start = at(2026, 11, 2, 20);
    const ev = (await owner.post('/api/events', { title: 'Legacy', start_at: start, end_at: start + 3600e3, recurrence: 'weekdays' })).body.event;
    assert.equal(ev.tz, null);
    const list = await get('Legacy', start - DAY, start + 7 * DAY - 1, '&tz=' + encodeURIComponent(NY));
    assert.deepEqual(list.map((e) => local(e.start_at).day), [1, 2, 3, 4, 5]);
  });

  await t.test('an old repeating event still shows years later', async () => {
    const start = at(2019, 1, 7, 9);
    await owner.post('/api/events', { title: 'Old daily', start_at: start, end_at: start + 900e3, recurrence: 'daily', tz: NY });
    const from = at(2026, 6, 1, 0);
    const list = await get('Old daily', from, from + 3 * DAY);
    assert.deepEqual(list.map((e) => local(e.start_at).date), ['2026-6-1', '2026-6-2', '2026-6-3']);
  });

  await t.test('editing an event keeps its time zone', async () => {
    const start = at(2026, 12, 1, 20);
    const ev = (await owner.post('/api/events', { title: 'Keep zone', start_at: start, end_at: start + 3600e3, recurrence: 'daily', tz: NY })).body.event;
    const ed = (await owner.patch('/api/events/' + ev.id, { title: 'Kept zone' })).body.event;
    assert.equal(ed.tz, NY);
  });

  await t.test('.ics files keep the time zone both ways', async () => {
    const start = at(2026, 11, 2, 20);
    const ics = toIcs([{ id: 'x', title: 'Zoned', start_at: start, end_at: start + 3600e3, recurrence: 'weekdays', tz: NY, attendees: [] }]);
    assert.match(ics, /DTSTART;TZID=America\/New_York:20261102T200000/);
    const back = parseIcs(ics)[0];
    assert.equal(back.start_at, start);
    assert.equal(back.tz, NY);
    assert.equal(back.recurrence, 'weekdays');
    const once = toIcs([{ id: 'y', title: 'Once', start_at: start, end_at: start + 3600e3, recurrence: 'none', tz: NY, attendees: [] }]);
    assert.match(once, /DTSTART:20261103T010000Z/, 'one-off events stay in UTC');
  });
});
