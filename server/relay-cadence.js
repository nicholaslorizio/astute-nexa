'use strict';
// Relay (mail) and Cadence (calendar).
// Mail between workspace members is delivered instantly inside Nexa.
// Mail to outside addresses goes through an SMTP server the owner configures
// (NEXA_SMTP_URL); without one, outside addresses are refused with a clear message.
const A = require('./auth');
const { sanitizeDocHtml, plainText } = require('./sanitize');

const DAY = 86400000;

function attachRelayCadence({ store, auth, filePerm, audit, HttpError, app, wrap, huddle, smtpUrl, smtpFrom }) {
  const { one, all, run, tx } = store;
  let transport = null;
  if (smtpUrl) {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport(smtpUrl);
  }

  const splitAddrs = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;]/)).map((s) => String(s).trim()).filter(Boolean).slice(0, 100);
  const validAddr = (a) => A.validEmail(a);

  // ---------- Relay ----------
  function mailRow(m, box) {
    const atts = all('SELECT f.id, f.title, f.kind, f.size FROM mail_attachments a JOIN files f ON f.id = a.file_id WHERE a.message_id = ?', m.id);
    return {
      id: m.id, thread_id: m.thread_id, from_addr: m.from_addr, from_name: m.from_name, subject: m.subject,
      to: JSON.parse(m.to_list), cc: JSON.parse(m.cc_list), body_html: m.body_html, created_at: m.created_at,
      external_status: m.external_status, folder: box && box.folder, is_read: box ? !!box.is_read : true, starred: box ? !!box.starred : false,
      attachments: atts,
    };
  }

  app.get('/api/mail', auth.requireUser, (req, res) => {
    const folder = ['inbox', 'sent', 'drafts', 'archive', 'trash', 'starred'].includes(req.query.folder) ? req.query.folder : 'inbox';
    const where = folder === 'starred' ? 'b.starred = 1 AND b.folder != \'trash\'' : 'b.folder = ?';
    const params = folder === 'starred' ? [req.user.id] : [req.user.id, folder];
    const q = String(req.query.q || '').trim().toLowerCase();
    let rows = all(`SELECT m.*, b.folder, b.is_read, b.starred FROM mail_boxes b JOIN mail_messages m ON m.id = b.message_id
      WHERE b.user_id = ? AND ${where} ORDER BY m.created_at DESC LIMIT 500`, ...params);
    if (q) rows = rows.filter((m) => (m.subject + ' ' + m.from_name + ' ' + m.from_addr + ' ' + m.body_html.replace(/<[^>]+>/g, ' ')).toLowerCase().includes(q));
    // collapse to newest message per thread
    const seen = new Set();
    const threads = [];
    for (const m of rows) {
      if (seen.has(m.thread_id)) continue;
      seen.add(m.thread_id);
      const count = one('SELECT COUNT(*) AS n FROM mail_boxes b JOIN mail_messages mm ON mm.id = b.message_id WHERE b.user_id = ? AND mm.thread_id = ? AND b.folder != \'trash\'', req.user.id, m.thread_id).n;
      threads.push({ id: m.id, thread_id: m.thread_id, subject: m.subject, from_name: m.from_name, from_addr: m.from_addr, to: JSON.parse(m.to_list),
        created_at: m.created_at, is_read: !!m.is_read, starred: !!m.starred, count,
        preview: m.body_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) });
    }
    const unread = one("SELECT COUNT(*) AS n FROM mail_boxes WHERE user_id = ? AND folder = 'inbox' AND is_read = 0", req.user.id).n;
    res.json({ folder, threads, unread, external: !!transport });
  });

  app.get('/api/mail/threads/:thread', auth.requireUser, (req, res) => {
    const rows = all(`SELECT m.*, b.folder, b.is_read, b.starred FROM mail_boxes b JOIN mail_messages m ON m.id = b.message_id
      WHERE b.user_id = ? AND m.thread_id = ? ORDER BY m.created_at`, req.user.id, req.params.thread);
    if (!rows.length) throw new HttpError(404, 'Conversation not found.');
    run('UPDATE mail_boxes SET is_read = 1 WHERE user_id = ? AND message_id IN (SELECT id FROM mail_messages WHERE thread_id = ?)', req.user.id, req.params.thread);
    res.json({ messages: rows.map((m) => mailRow(m, m)) });
  });

  app.post('/api/mail', auth.requireUser, wrap(async (req, res) => {
    const b = req.body || {};
    const to = splitAddrs(b.to), cc = splitAddrs(b.cc), bcc = splitAddrs(b.bcc);
    const subject = plainText(b.subject, 300).trim();
    const body = sanitizeDocHtml(b.body_html || '');
    const draft = !!b.draft;
    const all3 = [...to, ...cc, ...bcc];
    if (!draft && !all3.length) throw new HttpError(400, 'Add at least one recipient.');
    const badAddr = all3.find((a) => !validAddr(a));
    if (badAddr) throw new HttpError(400, `"${badAddr}" isn't a valid email address.`);
    const internal = new Map();
    const external = [];
    for (const a of all3) {
      const u = one("SELECT id, email FROM users WHERE email = ? AND status = 'active'", a);
      if (u) internal.set(u.id, u); else external.push(a);
    }
    if (!draft && external.length && !transport) {
      throw new HttpError(400, `Outside email isn't set up on this workspace yet, so Nexa can't reach ${external.join(', ')}. An owner can add an SMTP server in Settings.`);
    }
    if (req.user.role === 'guest' && external.length) throw new HttpError(403, 'Guests can only email people in this workspace.');
    const atts = Array.isArray(b.attachments) ? b.attachments.slice(0, 20) : [];
    for (const fid of atts) {
      const f = one('SELECT * FROM files WHERE id = ?', fid);
      if (!f || filePerm(req.user, f) === 'none') throw new HttpError(404, 'An attachment was not found.');
    }
    let threadId = A.id('t');
    if (b.reply_to) {
      const parent = one('SELECT m.thread_id FROM mail_messages m JOIN mail_boxes x ON x.message_id = m.id AND x.user_id = ? WHERE m.id = ?', req.user.id, b.reply_to);
      if (parent) threadId = parent.thread_id;
    }
    const mid = A.id('ml');
    const now = Date.now();
    tx(() => {
      if (b.draft_id) {
        const d = one("SELECT message_id FROM mail_boxes WHERE message_id = ? AND user_id = ? AND folder = 'drafts'", b.draft_id, req.user.id);
        if (d) run('DELETE FROM mail_messages WHERE id = ?', d.message_id);
      }
      run(`INSERT INTO mail_messages (id, thread_id, from_user, from_addr, from_name, subject, body_html, to_list, cc_list, created_at, external_status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, mid, threadId, req.user.id, req.user.email, req.user.name, subject || '(no subject)', body,
        JSON.stringify(to), JSON.stringify(cc), now, !draft && external.length ? 'sending' : null);
      run('INSERT INTO mail_boxes (message_id, user_id, folder, is_read) VALUES (?,?,?,1)', mid, req.user.id, draft ? 'drafts' : 'sent');
      for (const fid of atts) run('INSERT OR IGNORE INTO mail_attachments (message_id, file_id) VALUES (?,?)', mid, fid);
      if (!draft) {
        for (const [uid] of internal) {
          if (uid === req.user.id) continue;
          run("INSERT OR IGNORE INTO mail_boxes (message_id, user_id, folder) VALUES (?,?, 'inbox')", mid, uid);
          for (const fid of atts) {
            const f = one('SELECT * FROM files WHERE id = ?', fid);
            if (filePerm({ id: uid, role: 'member' }, f) === 'none') run('INSERT OR IGNORE INTO file_shares (file_id, user_id, perm) VALUES (?,?,?)', fid, uid, 'view');
          }
        }
      }
    });
    if (!draft) {
      for (const [uid] of internal) if (uid !== req.user.id) huddle.sendTo(uid, { t: 'mail.new', from: req.user.name, subject: subject || '(no subject)', thread_id: threadId });
      audit(req, 'mail.sent', mid, { internal: internal.size, external: external.length });
      if (external.length) {
        try {
          await transport.sendMail({ from: smtpFrom ? `"${req.user.name}" <${smtpFrom}>` : `"${req.user.name}" <${req.user.email}>`, replyTo: req.user.email,
            to: to.filter((a) => external.includes(a)), cc: cc.filter((a) => external.includes(a)), bcc: bcc.filter((a) => external.includes(a)),
            subject: subject || '(no subject)', html: body });
          run("UPDATE mail_messages SET external_status = 'sent' WHERE id = ?", mid);
        } catch (e) {
          run("UPDATE mail_messages SET external_status = 'failed' WHERE id = ?", mid);
          return res.status(502).json({ error: 'The outside mail server refused the message: ' + String(e.message).slice(0, 200), id: mid });
        }
      }
    }
    res.status(201).json({ id: mid, thread_id: threadId });
  }));

  app.patch('/api/mail/:id', auth.requireUser, (req, res) => {
    const box = one('SELECT * FROM mail_boxes WHERE message_id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!box) throw new HttpError(404, 'Message not found.');
    const { folder, is_read, starred, whole_thread } = req.body || {};
    const ids = whole_thread
      ? all('SELECT b.message_id FROM mail_boxes b JOIN mail_messages m ON m.id = b.message_id WHERE b.user_id = ? AND m.thread_id = (SELECT thread_id FROM mail_messages WHERE id = ?)', req.user.id, req.params.id).map((r) => r.message_id)
      : [req.params.id];
    for (const id of ids) {
      if (folder !== undefined) {
        if (!['inbox', 'archive', 'trash'].includes(folder)) throw new HttpError(400, 'Unknown folder.');
        const cur = one('SELECT folder FROM mail_boxes WHERE message_id = ? AND user_id = ?', id, req.user.id);
        if (cur && cur.folder !== 'sent' && cur.folder !== 'drafts') run('UPDATE mail_boxes SET folder = ? WHERE message_id = ? AND user_id = ?', folder, id, req.user.id);
        else if (cur && folder === 'trash') run("UPDATE mail_boxes SET folder = 'trash' WHERE message_id = ? AND user_id = ?", id, req.user.id);
      }
      if (is_read !== undefined) run('UPDATE mail_boxes SET is_read = ? WHERE message_id = ? AND user_id = ?', is_read ? 1 : 0, id, req.user.id);
      if (starred !== undefined) run('UPDATE mail_boxes SET starred = ? WHERE message_id = ? AND user_id = ?', starred ? 1 : 0, id, req.user.id);
    }
    res.json({ ok: true });
  });
  app.delete('/api/mail/:id', auth.requireUser, (req, res) => {
    const box = one('SELECT * FROM mail_boxes WHERE message_id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!box || !['trash', 'drafts'].includes(box.folder)) throw new HttpError(400, 'Move the message to the trash first.');
    run('DELETE FROM mail_boxes WHERE message_id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!one('SELECT 1 AS x FROM mail_boxes WHERE message_id = ?', req.params.id)) run('DELETE FROM mail_messages WHERE id = ?', req.params.id);
    res.json({ ok: true });
  });

  // ---------- Cadence ----------
  function eventRow(e, uid) {
    const attendees = all('SELECT a.addr, a.user_id, a.response, u.name FROM event_attendees a LEFT JOIN users u ON u.id = a.user_id WHERE a.event_id = ?', e.id);
    const owner = one('SELECT name, email FROM users WHERE id = ?', e.owner_id);
    const mine = attendees.find((a) => a.user_id === uid);
    return { id: e.id, title: e.title, description: e.description, location: e.location, start_at: e.start_at, end_at: e.end_at, all_day: !!e.all_day,
      recurrence: e.recurrence, repeat_until: e.repeat_until, color: e.color, huddle: !!e.huddle, owner_id: e.owner_id, owner_name: owner && owner.name,
      owner_email: owner && owner.email, attendees, my_response: e.owner_id === uid ? 'owner' : (mine ? mine.response : null), can_edit: e.owner_id === uid };
  }
  function visibleEvent(req, id) {
    const e = one('SELECT * FROM events WHERE id = ?', id);
    if (!e) throw new HttpError(404, 'Event not found.');
    if (e.owner_id !== req.user.id && !one('SELECT 1 AS x FROM event_attendees WHERE event_id = ? AND user_id = ?', e.id, req.user.id)) throw new HttpError(404, 'Event not found.');
    return e;
  }
  function expand(e, from, to) {
    const dur = e.end_at - e.start_at;
    if (e.recurrence === 'none') return e.end_at >= from && e.start_at <= to ? [{ start_at: e.start_at, end_at: e.end_at }] : [];
    const out = [];
    const until = Math.min(to, e.repeat_until || Infinity);
    let t = e.start_at;
    let i = 0;
    while (t <= until && i < 2000) {
      const d = new Date(t);
      const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      if (t + dur >= from && !(e.recurrence === 'weekdays' && weekend)) out.push({ start_at: t, end_at: t + dur, occurrence: i });
      i++;
      if (e.recurrence === 'daily' || e.recurrence === 'weekdays') t = e.start_at + i * DAY;
      else if (e.recurrence === 'weekly') t = e.start_at + i * 7 * DAY;
      else if (e.recurrence === 'monthly') { const s = new Date(e.start_at); s.setUTCMonth(s.getUTCMonth() + i); t = s.getTime(); }
    }
    return out;
  }
  const eventsFor = (uid, from, to) => all(`SELECT DISTINCT e.* FROM events e LEFT JOIN event_attendees a ON a.event_id = e.id
      WHERE (e.owner_id = ? OR (a.user_id = ? AND a.response != 'declined')) AND e.start_at <= ? AND (e.recurrence != 'none' OR e.end_at >= ?)`, uid, uid, to, from);

  app.get('/api/events', auth.requireUser, (req, res) => {
    const from = +req.query.from || Date.now() - 31 * DAY;
    const to = +req.query.to || Date.now() + 62 * DAY;
    if (to - from > 400 * DAY) throw new HttpError(400, 'Ask for a shorter range.');
    const out = [];
    for (const e of eventsFor(req.user.id, from, to)) {
      const base = eventRow(e, req.user.id);
      for (const occ of expand(e, from, to)) out.push({ ...base, ...occ });
    }
    const pending = all(`SELECT e.* FROM events e JOIN event_attendees a ON a.event_id = e.id WHERE a.user_id = ? AND a.response = 'pending' AND e.end_at >= ?`, req.user.id, Date.now())
      .map((e) => eventRow(e, req.user.id));
    res.json({ events: out.sort((a, b) => a.start_at - b.start_at), pending });
  });

  function saveAttendees(eventId, list, ownerId) {
    const addrs = splitAddrs(list);
    const bad = addrs.find((a) => !validAddr(a));
    if (bad) throw new HttpError(400, `"${bad}" isn't a valid email address.`);
    const existing = new Map(all('SELECT addr, response FROM event_attendees WHERE event_id = ?', eventId).map((r) => [r.addr.toLowerCase(), r.response]));
    run('DELETE FROM event_attendees WHERE event_id = ?', eventId);
    const invited = [];
    for (const a of addrs) {
      const u = one("SELECT id FROM users WHERE email = ? AND status = 'active'", a);
      if (u && u.id === ownerId) continue;
      run('INSERT OR IGNORE INTO event_attendees (event_id, user_id, addr, response) VALUES (?,?,?,?)', eventId, u ? u.id : null, a, existing.get(a.toLowerCase()) || 'pending');
      if (u && !existing.has(a.toLowerCase())) invited.push(u.id);
    }
    return invited;
  }
  function readEventBody(b) {
    const title = plainText(b.title, 200).trim() || 'New event';
    const start = +b.start_at, end = +b.end_at;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new HttpError(400, 'The end time must be after the start time.');
    if (end - start > 60 * DAY) throw new HttpError(400, 'Events can last up to 60 days.');
    const recurrence = ['none', 'daily', 'weekdays', 'weekly', 'monthly'].includes(b.recurrence) ? b.recurrence : 'none';
    return { title, start, end, recurrence, description: plainText(b.description, 8000), location: plainText(b.location, 300),
      all_day: b.all_day ? 1 : 0, repeat_until: b.repeat_until ? +b.repeat_until : null, color: typeof b.color === 'string' ? b.color.slice(0, 9) : null, huddle: b.huddle ? 1 : 0 };
  }

  app.post('/api/events', auth.requireUser, (req, res) => {
    const v = readEventBody(req.body || {});
    const eid = A.id('ev');
    const now = Date.now();
    let invited = [];
    tx(() => {
      run(`INSERT INTO events (id, owner_id, title, description, location, start_at, end_at, all_day, recurrence, repeat_until, color, huddle, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, eid, req.user.id, v.title, v.description, v.location, v.start, v.end, v.all_day, v.recurrence, v.repeat_until, v.color, v.huddle, now, now);
      invited = saveAttendees(eid, (req.body || {}).attendees, req.user.id);
    });
    for (const uid of invited) huddle.sendTo(uid, { t: 'event.invite', from: req.user.name, title: v.title, id: eid });
    audit(req, 'event.created', eid, { attendees: invited.length });
    res.status(201).json({ event: eventRow(one('SELECT * FROM events WHERE id = ?', eid), req.user.id) });
  });

  app.patch('/api/events/:id', auth.requireUser, (req, res) => {
    const e = visibleEvent(req, req.params.id);
    if (e.owner_id !== req.user.id) throw new HttpError(403, 'Only the organizer can change this event.');
    const v = readEventBody({ ...eventRow(e, req.user.id), ...req.body });
    let invited = [];
    tx(() => {
      run(`UPDATE events SET title = ?, description = ?, location = ?, start_at = ?, end_at = ?, all_day = ?, recurrence = ?, repeat_until = ?, color = ?, huddle = ?, updated_at = ? WHERE id = ?`,
        v.title, v.description, v.location, v.start, v.end, v.all_day, v.recurrence, v.repeat_until, v.color, v.huddle, Date.now(), e.id);
      if (req.body.attendees !== undefined) invited = saveAttendees(e.id, req.body.attendees, req.user.id);
    });
    for (const uid of invited) huddle.sendTo(uid, { t: 'event.invite', from: req.user.name, title: v.title, id: e.id });
    res.json({ event: eventRow(one('SELECT * FROM events WHERE id = ?', e.id), req.user.id) });
  });

  app.delete('/api/events/:id', auth.requireUser, (req, res) => {
    const e = visibleEvent(req, req.params.id);
    if (e.owner_id !== req.user.id) throw new HttpError(403, 'Only the organizer can cancel this event.');
    const attendees = all('SELECT user_id FROM event_attendees WHERE event_id = ? AND user_id IS NOT NULL', e.id);
    run('DELETE FROM events WHERE id = ?', e.id);
    for (const a of attendees) huddle.sendTo(a.user_id, { t: 'event.cancelled', title: e.title });
    res.json({ ok: true });
  });

  app.post('/api/events/:id/rsvp', auth.requireUser, (req, res) => {
    const e = visibleEvent(req, req.params.id);
    const r = (req.body || {}).response;
    if (!['accepted', 'declined', 'tentative'].includes(r)) throw new HttpError(400, 'Answer accepted, declined or tentative.');
    const changed = run('UPDATE event_attendees SET response = ? WHERE event_id = ? AND user_id = ?', r, e.id, req.user.id);
    if (!changed.changes) throw new HttpError(400, 'You are the organizer of this event.');
    huddle.sendTo(e.owner_id, { t: 'event.rsvp', from: req.user.name, title: e.title, response: r });
    res.json({ ok: true });
  });

  app.get('/api/freebusy', auth.requireUser, (req, res) => {
    const from = +req.query.from, to = +req.query.to;
    if (!from || !to || to - from > 31 * DAY) throw new HttpError(400, 'Ask for up to 31 days.');
    const ids = String(req.query.users || '').split(',').filter(Boolean).slice(0, 30);
    const out = {};
    for (const uid of ids) {
      const busy = [];
      for (const e of eventsFor(uid, from, to)) for (const occ of expand(e, from, to)) if (!e.all_day) busy.push({ start_at: occ.start_at, end_at: occ.end_at });
      out[uid] = busy.sort((a, b) => a.start_at - b.start_at);
    }
    res.json({ busy: out });
  });

  app.get('/api/events/:id/ics', auth.requireUser, (req, res) => {
    const e = visibleEvent(req, req.params.id);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="event.ics"`);
    res.end(toIcs([eventRow(e, req.user.id)]));
  });
  app.get('/api/calendar.ics', auth.requireUser, (req, res) => {
    const list = eventsFor(req.user.id, Date.now() - 365 * DAY, Date.now() + 365 * DAY).map((e) => eventRow(e, req.user.id));
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cadence.ics"');
    res.end(toIcs(list));
  });
  app.post('/api/calendar/import', auth.requireUser, (req, res) => {
    const text = String((req.body || {}).ics || '');
    if (text.length > 5_000_000) throw new HttpError(413, 'That calendar file is too big.');
    const evs = parseIcs(text).slice(0, 2000);
    const now = Date.now();
    tx(() => {
      for (const v of evs) {
        run(`INSERT INTO events (id, owner_id, title, description, location, start_at, end_at, all_day, recurrence, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`, A.id('ev'), req.user.id, plainText(v.title, 200) || 'Event', plainText(v.description, 8000), plainText(v.location, 300),
          v.start_at, v.end_at, v.all_day ? 1 : 0, v.recurrence, now, now);
      }
    });
    audit(req, 'calendar.imported', null, { count: evs.length });
    res.json({ imported: evs.length });
  });

  return {};
}

// ---------- iCalendar helpers ----------
const icsDate = (ms, allDay) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  if (allDay) return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};
const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const out = [];
  while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
  out.push(line);
  return out.join('\r\n');
}
function toIcs(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Astute//Nexa Cadence//EN', 'CALSCALE:GREGORIAN'];
  const rr = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY' };
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@nexa`, `DTSTAMP:${icsDate(Date.now())}`);
    lines.push(e.all_day ? `DTSTART;VALUE=DATE:${icsDate(e.start_at, true)}` : `DTSTART:${icsDate(e.start_at)}`);
    lines.push(e.all_day ? `DTEND;VALUE=DATE:${icsDate(e.end_at, true)}` : `DTEND:${icsDate(e.end_at)}`);
    lines.push(`SUMMARY:${icsText(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${icsText(e.location)}`);
    if (rr[e.recurrence]) lines.push(`RRULE:${rr[e.recurrence]}${e.repeat_until ? ';UNTIL=' + icsDate(e.repeat_until) : ''}`);
    if (e.owner_email) lines.push(`ORGANIZER;CN=${icsText(e.owner_name)}:mailto:${e.owner_email}`);
    for (const a of e.attendees || []) lines.push(`ATTENDEE;PARTSTAT=${({ accepted: 'ACCEPTED', declined: 'DECLINED', tentative: 'TENTATIVE' })[a.response] || 'NEEDS-ACTION'}:mailto:${a.addr}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
function parseIcsDate(v, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m;
  if (!m[4] || /VALUE=DATE/.test(params)) return { ms: Date.UTC(+y, +mo - 1, +d), allDay: true };
  return { ms: z ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) : new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime(), allDay: false };
}
function parseIcs(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out = [];
  let cur = null;
  const un = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur && cur.start) {
        const end = cur.end || { ms: cur.start.ms + (cur.start.allDay ? DAY : 3600000), allDay: cur.start.allDay };
        out.push({ title: cur.title || 'Event', description: cur.description || '', location: cur.location || '', start_at: cur.start.ms, end_at: end.ms, all_day: cur.start.allDay, recurrence: cur.recurrence || 'none' });
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';');
    const value = line.slice(i + 1);
    const p = params.join(';');
    if (name === 'SUMMARY') cur.title = un(value);
    else if (name === 'DESCRIPTION') cur.description = un(value);
    else if (name === 'LOCATION') cur.location = un(value);
    else if (name === 'DTSTART') cur.start = parseIcsDate(value, p);
    else if (name === 'DTEND') cur.end = parseIcsDate(value, p);
    else if (name === 'RRULE') {
      if (/BYDAY=MO,TU,WE,TH,FR/.test(value)) cur.recurrence = 'weekdays';
      else if (/FREQ=DAILY/.test(value)) cur.recurrence = 'daily';
      else if (/FREQ=WEEKLY/.test(value)) cur.recurrence = 'weekly';
      else if (/FREQ=MONTHLY/.test(value)) cur.recurrence = 'monthly';
    }
  }
  return out;
}

module.exports = { attachRelayCadence, toIcs, parseIcs };
