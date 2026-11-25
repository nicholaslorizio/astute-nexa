'use strict';
// Huddle: channels, direct messages, live events and call signaling over WebSocket.
const crypto = require('node:crypto');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const A = require('./auth');
const { createIce, iceFromEnv } = require('./ice');

let sharedIce = null; // one TURN login cache for every workspace in this process

const MAX_BODY = 8000;
const CHANNEL_NAME = /^[a-z0-9][a-z0-9-_]{0,59}$/;

function attachHuddle({ store, auth, filePerm, audit, HttpError, plainText, app, wrap, ice, linkBase = '', callLinks = {} }) {
  const { one, all, run, tx } = store;
  const sockets = new Map(); // userId -> Set<ws>
  const guests = new Set(); // ids of people in a call through a call link, without an account
  const calls = new Map(); // channelId -> Map<userId, {name, since, sockets: Set<ws>}>
  const iceSvc = ice && typeof ice.forUser === 'function' ? ice : ice ? createIce(ice) : (sharedIce = sharedIce || createIce(iceFromEnv()));
  const fileWatchers = new Map(); // fileId -> Set<ws>
  let wss;

  const isMember = (cid, uid) => !!one('SELECT 1 AS x FROM channel_members WHERE channel_id = ? AND user_id = ?', cid, uid);
  const members = (cid) => all('SELECT user_id FROM channel_members WHERE channel_id = ?', cid).map((r) => r.user_id);
  function sendTo(uid, msg) {
    const set = sockets.get(uid);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const ws of set) if (ws.readyState === 1) ws.send(data);
  }
  const broadcast = (cid, msg, except) => { for (const uid of members(cid)) if (uid !== except) sendTo(uid, msg); };
  const broadcastAll = (msg) => { for (const uid of sockets.keys()) if (!guests.has(uid)) sendTo(uid, msg); };
  // call news goes to the channel's members and to any guests in that call
  const callBroadcast = (cid, msg, except) => {
    broadcast(cid, msg, except);
    const room = calls.get(cid);
    if (room) for (const [id, v] of room) if (v.guest && id !== except) sendTo(id, msg);
  };
  const online = () => [...sockets.keys()];

  function channelFor(req, min = 'member') {
    const c = one('SELECT * FROM channels WHERE id = ?', req.params.id);
    if (!c) throw new HttpError(404, 'Channel not found.');
    const mem = isMember(c.id, req.user.id);
    if (!mem && (min === 'member' || c.kind !== 'public' || req.user.role === 'guest')) throw new HttpError(404, 'Channel not found.');
    return c;
  }
  function messageRow(m) {
    const reacts = all('SELECT emoji, user_id FROM reactions WHERE message_id = ?', m.id);
    const grouped = {};
    for (const r of reacts) (grouped[r.emoji] = grouped[r.emoji] || []).push(r.user_id);
    let file = null;
    if (m.file_id) {
      const f = one('SELECT id, kind, title, mime, size FROM files WHERE id = ?', m.file_id);
      if (f) file = f;
    }
    return { id: m.id, channel_id: m.channel_id, user_id: m.user_id, user_name: m.user_name, body: m.deleted ? '' : m.body, deleted: !!m.deleted,
      created_at: m.created_at, edited_at: m.edited_at, parent_id: m.parent_id, reactions: grouped, file, replies: m.replies || 0 };
  }

  // ---------- REST ----------
  app.get('/api/channels', auth.requireUser, (req, res) => {
    const mine = all(`SELECT c.*, cm.last_read,
        (SELECT COUNT(*) FROM messages m WHERE m.channel_id = c.id AND m.created_at > cm.last_read AND m.user_id != ? AND m.deleted = 0 AND m.parent_id IS NULL) AS unread,
        (SELECT MAX(created_at) FROM messages m WHERE m.channel_id = c.id) AS last_at
      FROM channels c JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ? WHERE c.archived = 0`, req.user.id, req.user.id);
    const dmNames = (c) => all('SELECT u.id, u.name FROM channel_members cm JOIN users u ON u.id = cm.user_id WHERE cm.channel_id = ? AND u.id != ?', c.id, req.user.id);
    const browse = req.user.role === 'guest' ? [] : all(`SELECT id, name, topic, (SELECT COUNT(*) FROM channel_members WHERE channel_id = channels.id) AS member_count
      FROM channels WHERE kind = 'public' AND archived = 0 AND id NOT IN (SELECT channel_id FROM channel_members WHERE user_id = ?) ORDER BY name`, req.user.id);
    res.json({
      channels: mine.map((c) => ({ id: c.id, name: c.name, topic: c.topic, kind: c.kind, unread: c.unread, last_at: c.last_at,
        people: c.kind === 'dm' ? dmNames(c) : undefined, in_call: calls.has(c.id) ? calls.get(c.id).size : 0 })),
      browse, online: online(),
    });
  });

  app.post('/api/channels', auth.requireUser, (req, res) => {
    const { name, topic, kind, member_ids } = req.body || {};
    if (req.user.role === 'guest') throw new HttpError(403, 'Guests cannot create channels.');
    const k = kind === 'private' ? 'private' : 'public';
    const n = String(name || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (!CHANNEL_NAME.test(n)) throw new HttpError(400, 'Use lowercase letters, numbers and dashes, up to 60 characters.');
    if (one("SELECT id FROM channels WHERE name = ? AND kind != 'dm' AND archived = 0", n)) throw new HttpError(409, 'A channel with that name already exists.');
    const cid = A.id('c');
    tx(() => {
      run('INSERT INTO channels (id, name, topic, kind, created_by, created_at) VALUES (?,?,?,?,?,?)', cid, n, plainText(topic, 250), k, req.user.id, Date.now());
      const ids = new Set([req.user.id, ...(Array.isArray(member_ids) ? member_ids : [])]);
      for (const uid of ids) if (one("SELECT id FROM users WHERE id = ? AND status = 'active'", uid)) run('INSERT OR IGNORE INTO channel_members (channel_id, user_id, joined_at) VALUES (?,?,?)', cid, uid, Date.now());
    });
    audit(req, 'channel.created', cid, { name: n, kind: k });
    for (const uid of members(cid)) sendTo(uid, { t: 'channels.changed' });
    res.status(201).json({ channel: { id: cid, name: n, kind: k } });
  });

  app.patch('/api/channels/:id', auth.requireUser, (req, res) => {
    const c = channelFor(req);
    const { topic, archived } = req.body || {};
    if (topic !== undefined) run('UPDATE channels SET topic = ? WHERE id = ?', plainText(topic, 250), c.id);
    if (archived !== undefined) {
      if (c.created_by !== req.user.id && A.RANK[req.user.role] < A.RANK.admin) throw new HttpError(403, 'Only the creator or an admin can archive a channel.');
      run('UPDATE channels SET archived = ? WHERE id = ?', archived ? 1 : 0, c.id);
      audit(req, 'channel.archived', c.id);
    }
    broadcast(c.id, { t: 'channels.changed' });
    res.json({ ok: true });
  });

  app.post('/api/channels/:id/join', auth.requireUser, (req, res) => {
    const c = channelFor(req, 'browse');
    if (c.kind !== 'public' || req.user.role === 'guest') throw new HttpError(403, 'Ask a member to add you.');
    run('INSERT OR IGNORE INTO channel_members (channel_id, user_id, joined_at) VALUES (?,?,?)', c.id, req.user.id, Date.now());
    res.json({ ok: true });
  });
  app.post('/api/channels/:id/members', auth.requireUser, (req, res) => {
    const c = channelFor(req);
    if (c.kind === 'dm') throw new HttpError(400, 'Start a new group message instead.');
    const ids = Array.isArray(req.body && req.body.user_ids) ? req.body.user_ids : [];
    for (const uid of ids) if (one("SELECT id FROM users WHERE id = ? AND status = 'active'", uid)) {
      run('INSERT OR IGNORE INTO channel_members (channel_id, user_id, joined_at) VALUES (?,?,?)', c.id, uid, Date.now());
      sendTo(uid, { t: 'channels.changed' });
    }
    res.json({ ok: true });
  });
  app.get('/api/channels/:id/members', auth.requireUser, (req, res) => {
    const c = channelFor(req);
    res.json({ members: all('SELECT u.id, u.name, u.title, u.role FROM channel_members cm JOIN users u ON u.id = cm.user_id WHERE cm.channel_id = ? ORDER BY u.name', c.id) });
  });
  app.post('/api/channels/:id/leave', auth.requireUser, (req, res) => {
    const c = channelFor(req);
    run('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?', c.id, req.user.id);
    res.json({ ok: true });
  });

  app.post('/api/dm', auth.requireUser, (req, res) => {
    const ids = [...new Set([req.user.id, ...((req.body && req.body.user_ids) || [])])].filter((uid) => one("SELECT id FROM users WHERE id = ? AND status = 'active'", uid)).sort();
    if (ids.length < 2) throw new HttpError(400, 'Pick at least one person.');
    if (ids.length > 9) throw new HttpError(400, 'Group messages can have up to 9 people. Make a channel instead.');
    const key = 'dm:' + ids.join(',');
    let c = one("SELECT id FROM channels WHERE kind = 'dm' AND name = ?", key);
    if (!c) {
      const cid = A.id('c');
      tx(() => {
        run("INSERT INTO channels (id, name, kind, created_by, created_at) VALUES (?,?,'dm',?,?)", cid, key, req.user.id, Date.now());
        for (const uid of ids) run('INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?,?,?)', cid, uid, Date.now());
      });
      c = { id: cid };
      for (const uid of ids) sendTo(uid, { t: 'channels.changed' });
    }
    res.json({ channel: { id: c.id } });
  });

  app.get('/api/channels/:id/messages', auth.requireUser, (req, res) => {
    const c = channelFor(req, 'browse');
    const before = +req.query.before || Date.now() + 1000;
    const parent = req.query.thread || null;
    const rows = all(`SELECT m.*, u.name AS user_name,
        (SELECT COUNT(*) FROM messages r WHERE r.parent_id = m.id AND r.deleted = 0) AS replies
      FROM messages m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.channel_id = ? AND m.created_at < ? AND ${parent ? 'm.parent_id = ?' : 'm.parent_id IS NULL'}
      ORDER BY m.created_at DESC LIMIT 60`, ...(parent ? [c.id, before, parent] : [c.id, before]));
    if (isMember(c.id, req.user.id) && !parent) run('UPDATE channel_members SET last_read = ? WHERE channel_id = ? AND user_id = ?', Date.now(), c.id, req.user.id);
    res.json({ channel: { id: c.id, name: c.name, topic: c.topic, kind: c.kind }, messages: rows.reverse().map(messageRow), in_call: callList(c.id) });
  });

  app.post('/api/channels/:id/messages', auth.requireUser, (req, res) => {
    const c = channelFor(req);
    const body = plainText(req.body && req.body.body, MAX_BODY).trim();
    const fileId = req.body && req.body.file_id;
    const parentId = req.body && req.body.parent_id;
    if (!body && !fileId) throw new HttpError(400, 'Write a message first.');
    if (fileId) {
      const f = one('SELECT * FROM files WHERE id = ?', fileId);
      if (!f || filePerm(req.user, f) === 'none') throw new HttpError(404, 'File not found.');
      // grant view access to channel members who cannot see it yet
      if (['owner', 'edit'].includes(filePerm(req.user, f))) {
        for (const uid of members(c.id)) if (filePerm({ id: uid, role: 'member' }, f) === 'none') run('INSERT OR IGNORE INTO file_shares (file_id, user_id, perm) VALUES (?,?,?)', f.id, uid, 'view');
      }
    }
    if (parentId && !one('SELECT id FROM messages WHERE id = ? AND channel_id = ?', parentId, c.id)) throw new HttpError(404, 'Thread not found.');
    const mid = A.id('m');
    const now = Date.now();
    run('INSERT INTO messages (id, channel_id, user_id, body, file_id, parent_id, created_at) VALUES (?,?,?,?,?,?,?)', mid, c.id, req.user.id, body, fileId || null, parentId || null, now);
    run('UPDATE channel_members SET last_read = ? WHERE channel_id = ? AND user_id = ?', now, c.id, req.user.id);
    const m = messageRow({ ...one('SELECT * FROM messages WHERE id = ?', mid), user_name: req.user.name });
    broadcast(c.id, { t: 'message.new', message: m });
    res.status(201).json({ message: m });
  });

  app.patch('/api/messages/:id', auth.requireUser, (req, res) => {
    const m = one('SELECT * FROM messages WHERE id = ?', req.params.id);
    if (!m || m.user_id !== req.user.id || m.deleted) throw new HttpError(404, 'Message not found.');
    const body = plainText(req.body && req.body.body, MAX_BODY).trim();
    if (!body) throw new HttpError(400, 'A message cannot be empty.');
    run('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?', body, Date.now(), m.id);
    const nm = messageRow({ ...one('SELECT * FROM messages WHERE id = ?', m.id), user_name: req.user.name });
    broadcast(m.channel_id, { t: 'message.edit', message: nm });
    res.json({ message: nm });
  });
  app.delete('/api/messages/:id', auth.requireUser, (req, res) => {
    const m = one('SELECT * FROM messages WHERE id = ?', req.params.id);
    if (!m || !isMember(m.channel_id, req.user.id)) throw new HttpError(404, 'Message not found.');
    if (m.user_id !== req.user.id && A.RANK[req.user.role] < A.RANK.admin) throw new HttpError(403, 'You can only delete your own messages.');
    run("UPDATE messages SET deleted = 1, body = '' WHERE id = ?", m.id);
    if (m.user_id !== req.user.id) audit(req, 'message.deleted_by_admin', m.id);
    broadcast(m.channel_id, { t: 'message.delete', id: m.id, channel_id: m.channel_id });
    res.json({ ok: true });
  });
  app.post('/api/messages/:id/reactions', auth.requireUser, (req, res) => {
    const m = one('SELECT * FROM messages WHERE id = ?', req.params.id);
    if (!m || !isMember(m.channel_id, req.user.id)) throw new HttpError(404, 'Message not found.');
    const emoji = String((req.body && req.body.emoji) || '').slice(0, 16);
    if (!emoji) throw new HttpError(400, 'Pick an emoji.');
    const had = one('SELECT 1 AS x FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', m.id, req.user.id, emoji);
    if (had) run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', m.id, req.user.id, emoji);
    else run('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?,?,?)', m.id, req.user.id, emoji);
    const nm = messageRow({ ...m, user_name: (one('SELECT name FROM users WHERE id = ?', m.user_id) || {}).name });
    broadcast(m.channel_id, { t: 'message.edit', message: nm });
    res.json({ message: nm });
  });

  // ---------- calls ----------
  // Where browsers find each other: STUN, plus a TURN relay when one is set (see server/ice.js).
  app.get('/api/call/ice', auth.requireUser, wrap(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await iceSvc.forUser(req.user.id));
  }));

  const callList = (cid) => (calls.has(cid) ? [...calls.get(cid)].map(([id, v]) => ({ id, name: v.name, since: v.since, guest: !!v.guest })) : []);
  // A person stays in a call while any of their connections is in it. After a dropped connection the
  // browser reconnects and joins again, sometimes before the server notices the old one is gone.
  function leaveCall(uid, cid, ws) {
    const room = calls.get(cid);
    if (!room || !room.has(uid)) return;
    const me = room.get(uid);
    if (ws) { me.sockets.delete(ws); if (me.sockets.size) return; }
    room.delete(uid);
    if (!room.size) { calls.delete(cid); endWhenEmpty(cid); }
    callBroadcast(cid, { t: 'call.left', channel_id: cid, user_id: uid, participants: callList(cid) });
  }

  // ---------- call links: someone without an account joins one call ----------
  // The link holds a random secret; only its hash is stored. A link works for one channel's call, for
  // LINK_TTL at most, and ends a little after a call it was used in ends, or when someone removes its guest.
  const LINK_TTL = callLinks.ttlMs || 12 * 3600 * 1000;
  const LINK_GRACE = callLinks.graceMs ?? 2 * 60 * 1000;
  const linkMade = A.rateLimiter(30, 3600 * 1000);
  const linkLooked = A.rateLimiter(60, 10 * 60 * 1000);
  const endTimers = new Map(); // channelId -> timer that ends used links once the call stays empty
  const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
  function liveLink(hash) {
    const l = one('SELECT * FROM call_links WHERE token_hash = ?', hash);
    if (!l || l.ended_at || l.expires_at <= Date.now()) return null;
    const c = one('SELECT archived FROM channels WHERE id = ?', l.channel_id);
    return c && !c.archived ? l : null;
  }
  const linkFor = (token) => (typeof token === 'string' && /^[A-Za-z0-9_-]{30,64}$/.test(token) ? liveLink(hashToken(token)) : null);
  function endLink(hash, why) {
    run('UPDATE call_links SET ended_at = ? WHERE token_hash = ? AND ended_at IS NULL', Date.now(), hash);
    for (const id of [...guests]) {
      const set = sockets.get(id);
      if (set) for (const ws of set) if (ws.user.linkHash === hash) ws.close(why === 'removed' ? 4003 : 4004, why);
    }
  }
  function endWhenEmpty(cid) {
    clearTimeout(endTimers.get(cid));
    const t = setTimeout(() => {
      endTimers.delete(cid);
      if (calls.has(cid)) return;
      for (const l of all('SELECT token_hash FROM call_links WHERE channel_id = ? AND used_at IS NOT NULL AND ended_at IS NULL', cid)) endLink(l.token_hash, 'ended');
    }, LINK_GRACE);
    t.unref();
    endTimers.set(cid, t);
  }
  // a link counts as used once its guest and someone from the workspace are in the call together
  function markUsed(cid) {
    const room = calls.get(cid);
    if (!room) return;
    const vals = [...room.values()];
    if (!vals.some((v) => !v.guest)) return;
    for (const v of vals) if (v.guest) run('UPDATE call_links SET used_at = COALESCE(used_at, ?) WHERE token_hash = ?', Date.now(), v.linkHash);
  }

  app.post('/api/channels/:id/call-link', auth.requireUser, (req, res) => {
    const c = channelFor(req);
    if (c.archived) throw new HttpError(400, 'This channel is archived.');
    if (req.user.role === 'guest') throw new HttpError(403, 'Guests in this workspace cannot make call links.');
    if (!linkMade(req.user.id)) throw new HttpError(429, 'Too many call links. Wait a while, then try again.');
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    run('INSERT INTO call_links (token_hash, channel_id, created_by, created_at, expires_at) VALUES (?,?,?,?,?)', hashToken(token), c.id, req.user.id, now, now + LINK_TTL);
    audit(req, 'call.link_made', c.id);
    res.json({ path: `${linkBase}/call/${token}`, expiresAt: now + LINK_TTL });
  });
  // what the guest's page needs before joining: who invited them. Nothing about the channel or workspace.
  app.get('/api/guest/call/:token', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!linkLooked(req.ip || 'x')) return res.status(429).json({ error: 'Too many tries. Wait a few minutes.' });
    const l = linkFor(req.params.token);
    if (!l) return res.status(404).json({ error: 'This call link has ended or is not right. Ask for a new one.' });
    const by = l.created_by && one('SELECT name FROM users WHERE id = ?', l.created_by);
    res.json({ host: (by && by.name) || 'Someone', expiresAt: l.expires_at });
  });
  app.get('/api/guest/call/:token/ice', wrap(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const l = linkFor(req.params.token);
    if (!l) return res.status(404).json({ error: 'This call link has ended.' });
    res.json(await iceSvc.forUser('guest_' + l.token_hash.slice(0, 12)));
  }));
  app.get('/call/:token', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer'); // the link is the key: never pass it on
    res.setHeader('X-Robots-Tag', 'noindex');
    res.sendFile(path.join(__dirname, '..', 'public', 'call.html'));
  });

  // ---------- sockets ----------
  function attachSockets(server) {
    wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
    server.on('upgrade', (req, socket, head) => {
      if (!req.url.startsWith('/ws')) return socket.destroy();
      const origin = req.headers.origin;
      try { if (origin && new URL(origin).host !== req.headers.host) return socket.destroy(); } catch { return socket.destroy(); }
      if (req.url.startsWith('/ws/guest')) {
        const q = new URL(req.url, 'http://x').searchParams;
        const link = linkFor(q.get('t'));
        if (!link) { socket.write('HTTP/1.1 410 Gone\r\n\r\n'); return socket.destroy(); }
        const name = plainText(q.get('name') || '', 40).replace(/\s+/g, ' ').trim() || 'Guest';
        const guest = { id: 'g_' + crypto.randomBytes(12).toString('base64url'), name: name + ' (guest)', guest: true, linkHash: link.token_hash, cid: link.channel_id, role: 'none' };
        return wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, guest));
      }
      const user = auth.userFromRequest(req);
      if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, user));
    });
    // Drop connections that went quiet (a phone that lost signal, a laptop that slept) so the people
    // still in a call see them leave instead of a frozen tile.
    const beat = setInterval(() => {
      for (const ws of wss.clients) {
        if (ws.alive === false) { ws.terminate(); continue; }
        ws.alive = false;
        try { ws.ping(); } catch { /* closing */ }
      }
    }, 30000);
    beat.unref();
    wss.on('close', () => clearInterval(beat));
    wss.on('connection', (ws, user) => {
      ws.alive = true;
      ws.on('pong', () => { ws.alive = true; });
      ws.user = user;
      ws.calls = new Set();
      ws.files = new Set();
      const first = !sockets.has(user.id);
      if (first) sockets.set(user.id, new Set());
      sockets.get(user.id).add(ws);
      if (user.guest) {
        // a guest sees nothing of the workspace: no presence, no people, only their one call
        guests.add(user.id);
        ws.send(JSON.stringify({ t: 'hello', user_id: user.id, name: user.name, guest: true, channel_id: user.cid }));
      } else {
        if (first) broadcastAll({ t: 'presence', user_id: user.id, online: true });
        ws.send(JSON.stringify({ t: 'hello', user_id: user.id, online: online() }));
      }
      // Call setup sends a burst of network candidates (more with a TURN relay), so call signals get
      // their own, larger allowance and cannot crowd out or be crowded out by chat traffic.
      let budget = 60, signals = 600;
      const refill = setInterval(() => { budget = 60; signals = 600; }, 10000);
      ws.on('message', (raw) => {
        ws.alive = true;
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (!msg || (msg.t === 'call.signal' ? --signals : --budget) < 0) return;
        if (user.guest) {
          // re-check the link still works
          if (!liveLink(user.linkHash)) return ws.close(4004, 'ended');
          return handleGuest(ws, user, msg);
        }
        // re-check the account is still active
        if (!one("SELECT 1 AS x FROM users WHERE id = ? AND status = 'active'", user.id)) return ws.close(4001, 'disabled');
        handle(ws, user, msg);
      });
      ws.on('close', () => {
        clearInterval(refill);
        if (closing) return; // shutting down: the database may already be closed
        for (const cid of ws.calls) leaveCall(user.id, cid, ws);
        for (const fid of ws.files) { const s = fileWatchers.get(fid); if (s) { s.delete(ws); if (!s.size) fileWatchers.delete(fid); else notifyFile(fid, presenceForFile(fid)); } }
        const set = sockets.get(user.id);
        if (set) {
          set.delete(ws);
          if (!set.size) {
            sockets.delete(user.id);
            if (user.guest) guests.delete(user.id); else broadcastAll({ t: 'presence', user_id: user.id, online: false });
          }
        }
      });
    });
  }

  function presenceForFile(fid) {
    const s = fileWatchers.get(fid);
    const people = {};
    if (s) for (const w of s) people[w.user.id] = w.user.name;
    return { t: 'file.presence', id: fid, people: Object.entries(people).map(([id, name]) => ({ id, name })) };
  }
  function notifyFile(fid, msg) {
    const s = fileWatchers.get(fid);
    if (!s) return;
    const data = JSON.stringify(msg);
    for (const w of s) if (w.readyState === 1) w.send(data);
  }

  function handle(ws, user, msg) {
    const cid = typeof msg.channel_id === 'string' ? msg.channel_id : null;
    switch (msg.t) {
      case 'typing':
        if (cid && isMember(cid, user.id)) broadcast(cid, { t: 'typing', channel_id: cid, user_id: user.id, name: user.name }, user.id);
        break;
      case 'file.watch': {
        const f = one('SELECT * FROM files WHERE id = ?', String(msg.id || ''));
        if (!f || filePerm(user, f) === 'none') return;
        if (!fileWatchers.has(f.id)) fileWatchers.set(f.id, new Set());
        fileWatchers.get(f.id).add(ws); ws.files.add(f.id);
        notifyFile(f.id, presenceForFile(f.id));
        break;
      }
      case 'file.unwatch': {
        const s = fileWatchers.get(msg.id);
        if (s) { s.delete(ws); ws.files.delete(msg.id); notifyFile(msg.id, presenceForFile(msg.id)); }
        break;
      }
      case 'call.join': {
        if (!cid || !isMember(cid, user.id)) return;
        joinCall(ws, user, cid);
        break;
      }
      case 'call.remove': {
        // anyone from the workspace in the channel can send a guest out; their link stops working
        const room = cid && calls.get(cid);
        const target = room && room.get(String(msg.user_id || ''));
        if (!target || !target.guest || !isMember(cid, user.id)) return;
        endLink(target.linkHash, 'removed');
        audit({ user, ip: null }, 'call.guest_removed', cid, { name: target.name });
        break;
      }
      case 'call.leave':
        if (cid) { leaveCall(user.id, cid, ws); ws.calls.delete(cid); }
        break;
      case 'call.signal': relaySignal(user, cid, msg); break;
      case 'call.state': callState(user, cid, msg); break;
      case 'ping': ws.send(JSON.stringify({ t: 'pong' })); break;
      default: break;
    }
  }

  function joinCall(ws, user, cid) {
    clearTimeout(endTimers.get(cid)); endTimers.delete(cid);
    if (!calls.has(cid)) calls.set(cid, new Map());
    const room = calls.get(cid);
    if (room.size >= 8 && !room.has(user.id)) return ws.send(JSON.stringify({ t: 'call.full', channel_id: cid }));
    const peers = [...room.keys()].filter((id) => id !== user.id);
    const me = room.get(user.id) || { name: user.name, since: Date.now(), sockets: new Set(), guest: !!user.guest, linkHash: user.linkHash };
    me.sockets.add(ws);
    room.set(user.id, me);
    ws.calls.add(cid);
    markUsed(cid);
    ws.send(JSON.stringify({ t: 'call.joined', channel_id: cid, peers, participants: callList(cid) }));
    callBroadcast(cid, { t: 'call.peer', channel_id: cid, user_id: user.id, name: user.name, guest: !!user.guest, participants: callList(cid) }, user.id);
  }
  // relay SDP / ICE to one peer who is in the same call
  function relaySignal(user, cid, msg) {
    const room = cid && calls.get(cid);
    if (!room || !room.has(user.id) || !room.has(msg.to)) return;
    const data = msg.data && typeof msg.data === 'object' ? msg.data : null;
    if (!data) return;
    sendTo(msg.to, { t: 'call.signal', channel_id: cid, from: user.id, name: user.name, data });
  }
  function callState(user, cid, msg) {
    const room = cid && calls.get(cid);
    if (!room || !room.has(user.id)) return;
    callBroadcast(cid, { t: 'call.state', channel_id: cid, user_id: user.id, muted: !!msg.muted, video: !!msg.video, hand: !!msg.hand }, user.id);
  }
  // a guest can only be in the one call their link is for: everything else they send is ignored
  function handleGuest(ws, user, msg) {
    const cid = msg.channel_id === user.cid ? user.cid : null;
    if (msg.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }));
    if (!cid) return;
    if (msg.t === 'call.join') joinCall(ws, user, cid);
    else if (msg.t === 'call.leave') { leaveCall(user.id, cid, ws); ws.calls.delete(cid); }
    else if (msg.t === 'call.signal') relaySignal(user, cid, msg);
    else if (msg.t === 'call.state') callState(user, cid, msg);
  }

  function kick(uid) {
    const set = sockets.get(uid);
    if (set) for (const ws of set) ws.close(4001, 'disabled');
  }
  let closing = false;
  const close = () => { closing = true; for (const t of endTimers.values()) clearTimeout(t); if (wss) { for (const c of wss.clients) c.terminate(); wss.close(); } };

  return { attachSockets, notifyFile, kick, close, sendTo, broadcastAll };
}

module.exports = { attachHuddle };
