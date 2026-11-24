'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, setupOwner, addUser } = require('./helpers');
const HOUR = 3600e3;

test('Relay mail and Cadence calendar', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const owner = await setupOwner(srv, { sampleContent: false });
  const max = await addUser(srv, owner, 'max@test.example');

  await t.test('mail between teammates lands in the inbox, with replies in one thread', async () => {
    const sent = await owner.post('/api/mail', { to: 'max@test.example', subject: 'Lunch?', body_html: '<p>Noon works</p><script>x</script>' });
    assert.equal(sent.status, 201);
    const inbox = (await max.get('/api/mail?folder=inbox')).body;
    assert.equal(inbox.unread, 1);
    const th = inbox.threads[0];
    assert.equal(th.subject, 'Lunch?');
    const msgs = (await max.get('/api/mail/threads/' + th.thread_id)).body.messages;
    assert.ok(!/script/.test(msgs[0].body_html));
    await max.post('/api/mail', { to: 'olive@test.example', subject: 'Re: Lunch?', body_html: '<p>Yes</p>', reply_to: msgs[0].id });
    const o = (await owner.get('/api/mail?folder=inbox')).body.threads[0];
    assert.equal(o.thread_id, th.thread_id);
    assert.equal(o.count, 2);
    assert.equal((await max.get('/api/mail?folder=inbox')).body.unread, 0, 'opening a thread marks it read');
  });

  await t.test('outside addresses are refused when no mail server is set up', async () => {
    const r = await owner.post('/api/mail', { to: 'someone@outside.example', subject: 'Hi', body_html: 'x' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Outside email/);
  });

  await t.test('drafts save without recipients and can be found later', async () => {
    assert.equal((await owner.post('/api/mail', { draft: true, subject: 'Half done', body_html: '<p>..</p>' })).status, 201);
    assert.ok((await owner.get('/api/mail?folder=drafts')).body.threads.some((m) => m.subject === 'Half done'));
  });

  await t.test('people cannot read each other’s mail', async () => {
    const th = (await owner.get('/api/mail?folder=sent')).body.threads[0];
    const eve = await addUser(srv, owner, 'eve@test.example', 'member', 'Eve');
    assert.equal((await eve.get('/api/mail/threads/' + th.thread_id)).status, 404);
  });

  await t.test('events with guests send invites, take RSVPs and show busy times', async () => {
    const start = Date.now() + 24 * HOUR;
    const ev = await owner.post('/api/events', { title: 'Planning', start_at: start, end_at: start + HOUR, attendees: 'max@test.example' });
    assert.equal(ev.status, 201);
    const mine = (await max.get(`/api/events?from=${start - HOUR}&to=${start + 2 * HOUR}`)).body;
    assert.ok(mine.pending.some((e) => e.title === 'Planning'));
    assert.equal((await max.post(`/api/events/${ev.body.event.id}/rsvp`, { response: 'accepted' })).status, 200);
    const users = (await owner.get('/api/users')).body.users;
    const maxId = users.find((u) => u.email === 'max@test.example').id;
    const fb = (await owner.get(`/api/freebusy?from=${start - HOUR}&to=${start + 2 * HOUR}&users=${maxId}`)).body.busy;
    assert.ok(JSON.stringify(fb).includes(String(start)));
  });

  await t.test('repeating events expand and calendars export to .ics', async () => {
    const start = Date.now() + 2 * 24 * HOUR;
    await owner.post('/api/events', { title: 'Standup', start_at: start, end_at: start + HOUR / 4, recurrence: 'daily' });
    const list = (await owner.get(`/api/events?from=${start - HOUR}&to=${start + 5 * 24 * HOUR}`)).body.events.filter((e) => e.title === 'Standup');
    assert.ok(list.length >= 5);
    const ics = (await owner.get('/api/calendar.ics')).buf.toString();
    assert.match(ics, /BEGIN:VCALENDAR/);
    assert.match(ics, /SUMMARY:Standup/);
    assert.match(ics, /RRULE:FREQ=DAILY/);
  });

  await t.test('.ics files import', async () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x1\r\nSUMMARY:Dentist\r\nDTSTART:20300105T150000Z\r\nDTEND:20300105T160000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const r = await owner.post('/api/calendar/import', { ics });
    assert.equal(r.status, 200);
    const from = Date.UTC(2030, 0, 1), to = Date.UTC(2030, 0, 10);
    assert.ok((await owner.get(`/api/events?from=${from}&to=${to}`)).body.events.some((e) => e.title === 'Dentist'));
  });
});
