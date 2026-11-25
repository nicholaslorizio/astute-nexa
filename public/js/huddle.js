/* Huddle: channels, direct messages, threads, reactions, file sharing and video calls. */
'use strict';
(function () {
  const { h, $, $$, clear, icon, api, toast, fail, modal, menu, avatar, fmtTime, fmtDate, timeAgo, fileIcon, fileRoute, confirmBox } = Nexa;
  const EMOJI = ['👍', '❤️', '😂', '🎉', '👀', '🙏', '🔥', '✅'];
  let S = null; // view state while Huddle is open

  function linkify(text) {
    const out = [];
    const re = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|(@[A-Za-z][\w.-]*)|(\*\*[^*]+\*\*)|(`[^`]+`)/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1]) out.push(h('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer' }, m[1]));
      else if (m[2]) out.push(h('b', { style: { color: 'var(--huddle)' } }, m[2]));
      else if (m[3]) out.push(h('b', {}, m[3].slice(2, -2)));
      else if (m[4]) out.push(h('code', { style: { fontFamily: 'var(--mono)', background: 'var(--bg-3)', padding: '0 4px', borderRadius: '4px' } }, m[4].slice(1, -1)));
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  const chanLabel = (c) => (c.kind === 'dm' ? (c.people && c.people.length ? c.people.map((p) => p.name).join(', ') : 'Just you') : c.name);

  async function open({ id }) {
    const view = Nexa.shell('huddle');
    if (!Nexa.state.users.length) Nexa.state.users = (await api.get('/api/users')).users;
    const side = h('nav', { class: 'h-side' });
    const main = h('section', { class: 'h-main' });
    const root = h('div', { class: 'huddle' }, side, main);
    view.append(root);
    S = { id, side, main, root, channels: [], browse: [], thread: null, typing: new Map(), offs: [] };
    await loadChannels();
    if (!id) { const g = S.channels.find((c) => c.name === 'general') || S.channels[0]; if (g) return Nexa.router.go('#/huddle/' + g.id); }
    else await openChannel(id);
    const offs = [
      Nexa.rt.on('message.new', ({ message: m }) => {
        if (!S) return;
        if (m.channel_id === S.id) {
          if (m.parent_id) { bumpReplies(m.parent_id, 1); if (S.thread === m.parent_id) appendMsg(S.threadList, m, true); }
          else { appendMsg(S.list, m); markRead(); }
          S.typing.delete(m.user_id); drawTyping();
        } else loadChannels();
      }),
      Nexa.rt.on('message.edit', ({ message: m }) => { if (!S) return; $$(`[data-mid="${m.id}"]`, S.root).forEach((el) => el.replaceWith(msgEl(m, el.classList.contains('cont'), !!el.closest('.thread-panel')))); }),
      Nexa.rt.on('message.delete', ({ id: mid }) => { if (S) $$(`[data-mid="${mid}"]`, S.root).forEach((el) => el.remove()); }),
      Nexa.rt.on('channels.changed', () => S && loadChannels()),
      Nexa.rt.on('typing', (m) => { if (!S || m.channel_id !== S.id) return; S.typing.set(m.user_id, { name: m.name, at: Date.now() }); drawTyping(); setTimeout(drawTyping, 4200); }),
      Nexa.rt.on('call.peer', (m) => { if (S && m.channel_id === S.id) drawCallBadge(m.participants); }),
      Nexa.rt.on('call.left', (m) => { if (S && m.channel_id === S.id) drawCallBadge(m.participants); }),
    ];
    return { leave: () => { offs.forEach((f) => f()); S = null; } };
  }

  async function loadChannels() {
    const r = await api.get('/api/channels');
    S.channels = r.channels; S.browse = r.browse;
    Nexa.state.online = new Set(r.online);
    const me = Nexa.state.user;
    clear(S.side);
    const chans = r.channels.filter((c) => c.kind !== 'dm').sort((a, b) => a.name.localeCompare(b.name));
    const dms = r.channels.filter((c) => c.kind === 'dm').sort((a, b) => (b.last_at || 0) - (a.last_at || 0));
    S.side.append(h('div', { class: 'sect' }, 'Channels', me.role !== 'guest' ? h('button', { class: 'btn ghost icon sm', title: 'New channel', onclick: newChannel }, icon('plus', 14)) : null));
    for (const c of chans) S.side.append(h('a', { class: 'h-item' + (c.id === S.id ? ' on' : '') + (c.unread ? ' unread' : ''), href: '#/huddle/' + c.id }, icon(c.kind === 'private' ? 'lock' : 'hash', 15), h('span', { class: 'grow ellipsis' }, c.name),
      c.in_call ? h('span', { title: 'Call in progress', style: { color: 'var(--ok)' } }, icon('video', 14)) : null, c.unread ? h('span', { class: 'badge' }, c.unread) : null));
    if (S.browse.length) S.side.append(h('button', { class: 'h-item', style: { border: 0, background: 'none', width: '100%' }, onclick: browse }, icon('search', 15), h('span', { class: 'muted' }, `Browse ${S.browse.length} more`)));
    S.side.append(h('div', { class: 'sect' }, 'Direct messages', h('button', { class: 'btn ghost icon sm', title: 'New message', onclick: newDm }, icon('plus', 14))));
    for (const c of dms) {
      const p = c.people[0] || me;
      S.side.append(h('a', { class: 'h-item' + (c.id === S.id ? ' on' : '') + (c.unread ? ' unread' : ''), href: '#/huddle/' + c.id }, avatar(p, 'sm'), h('span', { class: 'grow ellipsis' }, chanLabel(c)), c.unread ? h('span', { class: 'badge' }, c.unread) : null));
    }
    if (!dms.length) S.side.append(h('div', { class: 'muted small', style: { padding: '4px 10px' } }, 'Start one with the + button.'));
    Nexa.refreshBadges();
  }

  async function openChannel(id, before) {
    let r;
    try { r = await api.get(`/api/channels/${id}/messages`); } catch (e) { clear(S.main).append(h('div', { class: 'empty' }, e.message)); return; }
    const c = S.channels.find((x) => x.id === id) || { ...r.channel, people: [] };
    const member = S.channels.some((x) => x.id === id);
    S.chan = c;
    clear(S.main);
    const callBadge = h('span', { 'data-callbadge': '' });
    const head = h('header', { class: 'h-head' },
      c.kind === 'dm' ? avatar(c.people[0] || Nexa.state.user) : icon(c.kind === 'private' ? 'lock' : 'hash', 18),
      h('div', { class: 'grow' }, h('h3', {}, chanLabel(c)), c.topic ? h('div', { class: 'muted small ellipsis' }, c.topic) : null),
      callBadge,
      member ? h('button', { class: 'btn sm', onclick: () => Nexa.call.start(id, chanLabel(c), false) }, icon('phone', 15), 'Audio') : null,
      member ? h('button', { class: 'btn primary sm', onclick: () => Nexa.call.start(id, chanLabel(c), true) }, icon('video', 15), 'Video call') : null,
      h('button', { class: 'btn ghost icon sm', 'aria-label': 'Channel options', onclick: (e) => chanMenu(e.currentTarget, c, member) }, icon('more', 16)));
    S.list = h('div', { class: 'msgs' });
    const typing = h('div', { class: 'typing', 'data-typing': '' });
    S.main.append(head, S.list, typing, member ? composer(id, null) : h('div', { class: 'composer', style: { padding: '14px', textAlign: 'center' } },
      h('button', { class: 'btn primary', onclick: async () => { await api.post(`/api/channels/${id}/join`); await loadChannels(); openChannel(id); } }, `Join #${c.name}`)));
    if (!r.messages.length) S.list.append(h('div', { class: 'empty' }, h('div', { style: { fontSize: '40px' } }, '👋'), c.kind === 'dm' ? 'This is the start of your conversation.' : `This is the start of #${c.name}.`));
    let prev = null;
    for (const m of r.messages) { appendMsg(S.list, m, false, prev); prev = m; }
    S.list.scrollTop = S.list.scrollHeight;
    drawCallBadge(r.in_call);
    S.side.querySelectorAll('.h-item').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#/huddle/' + id));
    const it = S.side.querySelector(`.h-item[href="#/huddle/${id}"]`); if (it) { it.classList.remove('unread'); const b = it.querySelector('.badge'); if (b) b.remove(); }
    Nexa.refreshBadges();
  }
  const markRead = Nexa.debounce(() => S && api.get(`/api/channels/${S.id}/messages?before=1`).catch(() => {}), 1500);
  function drawCallBadge(list) {
    const b = S && $('[data-callbadge]', S.main); if (!b) return;
    clear(b);
    if (list && list.length) b.append(h('span', { class: 'pill', style: { background: 'color-mix(in srgb, var(--ok) 18%, transparent)', color: 'var(--ok)' } }, icon('video', 13), `${list.length} in call`));
  }
  function drawTyping() {
    const el = S && $('[data-typing]', S.main); if (!el) return;
    const now = Date.now(); for (const [k, v] of S.typing) if (now - v.at > 4000) S.typing.delete(k);
    const names = [...S.typing.values()].map((v) => v.name.split(' ')[0]);
    el.textContent = names.length ? `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} typing…` : '';
  }

  function appendMsg(list, m, inThread, prev) {
    const empty = list.querySelector('.empty'); if (empty) empty.remove();
    if (prev === undefined) { const last = list.lastElementChild; prev = last && last._m; }
    const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
    if (newDay && !inThread) list.append(h('div', { class: 'day-sep' }, fmtDate(m.created_at, { weekday: 'long' })));
    const cont = !newDay && prev && prev.user_id === m.user_id && m.created_at - prev.created_at < 5 * 60000;
    const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    list.append(msgEl(m, cont, inThread));
    if (stick || m.user_id === Nexa.state.user.id) list.scrollTop = list.scrollHeight;
  }
  function msgEl(m, cont, inThread) {
    const me = Nexa.state.user;
    const u = m.user_id ? (Nexa.userById(m.user_id) || { id: m.user_id, name: m.user_name }) : { id: 'nexa', name: 'Nexa' };
    const reacts = h('div', { class: 'reacts' }, Object.entries(m.reactions || {}).map(([em, users]) => h('button', { class: users.includes(me.id) ? 'mine' : '', title: users.map((x) => (Nexa.userById(x) || {}).name).join(', '), onclick: () => react(m, em) }, `${em} ${users.length}`)));
    const el = h('div', { class: 'msg' + (cont ? ' cont' : ''), 'data-mid': m.id },
      avatar(u),
      h('div', { class: 'grow', style: { minWidth: 0 } },
        cont ? null : h('div', {}, h('span', { class: 'who' }, u.name), h('span', { class: 'time' }, fmtTime(m.created_at)), m.edited_at ? h('span', { class: 'time' }, '(edited)') : null),
        m.deleted ? h('div', { class: 'body muted' }, 'This message was deleted.') : h('div', { class: 'body' }, linkify(m.body)),
        m.file ? h('a', { class: 'file-chip', href: fileRoute(m.file), target: m.file.kind === 'upload' ? '_blank' : null }, fileIcon(m.file), h('div', {}, h('b', {}, m.file.title), h('div', { class: 'muted small' }, m.file.kind === 'upload' ? Nexa.fmtSize(m.file.size) : Nexa.appById(Nexa.KIND_APP[m.file.kind]).name))) : null,
        reacts,
        !inThread && m.replies ? h('button', { class: 'btn ghost sm', style: { color: 'var(--huddle)', marginTop: '2px', paddingLeft: 0 }, 'data-replies': m.id, onclick: () => openThread(m) }, `${m.replies} repl${m.replies === 1 ? 'y' : 'ies'}`) : null),
      m.deleted ? null : h('div', { class: 'acts' },
        EMOJI.slice(0, 3).map((em) => h('button', { title: 'React ' + em, onclick: () => react(m, em) }, em)),
        h('button', { title: 'More reactions', onclick: (e) => menu(e.currentTarget, EMOJI.map((em) => ({ label: em, onClick: () => react(m, em) }))) }, icon('smile', 15)),
        !inThread ? h('button', { title: 'Reply in thread', onclick: () => openThread(m) }, icon('reply', 15)) : null,
        m.user_id === me.id ? h('button', { title: 'Edit', onclick: () => editMsg(m) }, icon('edit', 15)) : null,
        m.user_id === me.id || ['owner', 'admin'].includes(me.role) ? h('button', { title: 'Delete', onclick: async () => { if (await confirmBox('Delete this message?', 'It will be removed for everyone.', 'Delete', true)) api.del('/api/messages/' + m.id).catch(fail); } }, icon('trash', 15)) : null));
    el._m = m;
    return el;
  }
  function bumpReplies(pid, n) {
    const el = S.list && S.list.querySelector(`[data-mid="${pid}"]`); if (!el) return;
    el._m.replies = (el._m.replies || 0) + n;
    el.replaceWith(msgEl(el._m, el.classList.contains('cont'), false));
  }
  const react = (m, em) => api.post(`/api/messages/${m.id}/reactions`, { emoji: em }).catch(fail);
  function editMsg(m) {
    const t = h('textarea', { class: 'input', rows: 4 }, m.body);
    modal({ title: 'Edit message', body: t, actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => { try { await api.patch('/api/messages/' + m.id, { body: t.value }); } catch (e) { fail(e); return false; } } }] });
  }

  function composer(cid, parentId) {
    const ta = h('textarea', { rows: 1, placeholder: parentId ? 'Reply…' : `Message ${S.chan.kind === 'dm' ? chanLabel(S.chan) : '#' + S.chan.name}`, 'aria-label': 'Message' });
    let attach = null;
    const chip = h('div', { style: { padding: '0 12px' } });
    const send = async () => {
      const body = ta.value.trim();
      if (!body && !attach) return;
      ta.value = ''; grow();
      try { await api.post(`/api/channels/${cid}/messages`, { body, file_id: attach && attach.id, parent_id: parentId }); attach = null; clear(chip); } catch (e) { fail(e); ta.value = body; }
    };
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(200, ta.scrollHeight) + 'px'; };
    const sendTyping = Nexa.debounce(() => {}, 0);
    let lastTyping = 0;
    ta.addEventListener('input', () => { grow(); if (Date.now() - lastTyping > 2500) { lastTyping = Date.now(); Nexa.rt.send({ t: 'typing', channel_id: cid }); } sendTyping(); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    const setAttach = (f) => { attach = f; clear(chip).append(h('div', { class: 'file-chip' }, fileIcon(f), h('span', {}, f.title), h('button', { class: 'btn ghost icon sm', onclick: () => { attach = null; clear(chip); } }, icon('close', 14)))); };
    const box = h('div', { class: 'composer' }, chip, ta, h('div', { class: 'bar' },
      h('button', { class: 'btn ghost icon sm', title: 'Attach a file', onclick: async (e) => {
        menu(e.currentTarget, [
          { label: 'Upload from this device', icon: 'upload', onClick: async () => { const [f] = await Nexa.pickFile(); if (f) setAttach(await Nexa.vaultUpload(f)); } },
          { label: 'Pick from Vault', icon: 'vault', onClick: async () => { const f = await Nexa.pickVaultFile(); if (f) setAttach(f); } },
        ]);
      } }, icon('clip', 16)),
      h('button', { class: 'btn ghost icon sm', title: 'Emoji', onclick: (e) => menu(e.currentTarget, EMOJI.map((em) => ({ label: em, onClick: () => { ta.value += em; ta.focus(); } }))) }, icon('smile', 16)),
      h('span', { class: 'grow muted small' }, 'Enter to send, Shift+Enter for a new line'),
      h('button', { class: 'btn primary sm', onclick: send }, icon('send', 14), 'Send')));
    box.addEventListener('dragover', (e) => e.preventDefault());
    box.addEventListener('drop', async (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setAttach(await Nexa.vaultUpload(f)); });
    setTimeout(() => ta.focus(), 30);
    return box;
  }

  async function openThread(m) {
    $$('.thread-panel', S.root).forEach((p) => p.remove());
    S.thread = m.id;
    const r = await api.get(`/api/channels/${m.channel_id}/messages?thread=${m.id}`);
    S.threadList = h('div', { class: 'msgs' });
    const panel = h('aside', { class: 'thread-panel' },
      h('header', { class: 'h-head' }, h('h3', { class: 'grow' }, 'Thread'), h('button', { class: 'btn ghost icon sm', 'aria-label': 'Close thread', onclick: () => { panel.remove(); S.thread = null; } }, icon('close', 16))),
      S.threadList, composer(m.channel_id, m.id));
    S.threadList.append(msgEl(m, false, true), h('div', { class: 'day-sep' }, `${r.messages.length} repl${r.messages.length === 1 ? 'y' : 'ies'}`));
    for (const x of r.messages) appendMsg(S.threadList, x, true);
    S.root.append(panel);
  }

  function chanMenu(anchor, c, member) {
    const me = Nexa.state.user;
    menu(anchor, [
      c.kind !== 'dm' && { label: 'Members', icon: 'people', onClick: () => members(c) },
      c.kind !== 'dm' && member && { label: 'Add people', icon: 'plus', onClick: () => addPeople(c) },
      c.kind !== 'dm' && ['owner', 'admin'].includes(me.role) && { label: 'Edit topic', icon: 'edit', onClick: async () => { const t = await Nexa.promptBox('Channel topic', 'Topic', c.topic || ''); if (t !== null) { await api.patch('/api/channels/' + c.id, { topic: t }).catch(fail); openChannel(c.id); } } },
      { label: 'Plan a meeting here', icon: 'cadence', onClick: () => { Nexa.router.go('#/cadence'); setTimeout(() => Nexa.apps.cadence.newEvent({ title: c.kind === 'dm' ? 'Catch up' : `#${c.name} sync`, huddle: true }), 300); } },
      c.kind !== 'dm' && member && c.name !== 'general' && '-',
      c.kind !== 'dm' && member && c.name !== 'general' && { label: 'Leave channel', icon: 'logout', danger: true, onClick: async () => { await api.post(`/api/channels/${c.id}/leave`).catch(fail); Nexa.router.go('#/huddle'); } },
    ]);
  }
  async function members(c) {
    const r = await api.get(`/api/channels/${c.id}/members`);
    modal({ title: `Members of #${c.name}`, body: r.members.map((u) => h('div', { class: 'person' }, avatar(u), h('div', { class: 'grow' }, h('b', {}, u.name), h('div', { class: 'muted small' }, u.title || u.role)))), actions: [{ label: 'Close' }] });
  }
  function peoplePicker(exclude = []) {
    const box = h('div', { style: { maxHeight: '320px', overflow: 'auto' } });
    for (const u of Nexa.state.users.filter((x) => x.id !== Nexa.state.user.id && !exclude.includes(x.id))) box.append(h('label', { class: 'person check' }, h('input', { type: 'checkbox', value: u.id }), avatar(u, 'sm'), h('div', {}, u.name, h('div', { class: 'muted small' }, u.email))));
    if (!box.children.length) box.append(h('p', { class: 'muted' }, 'No one else here yet. Invite people from the People page.'));
    return { el: box, value: () => $$('input:checked', box).map((i) => i.value) };
  }
  async function addPeople(c) {
    const r = await api.get(`/api/channels/${c.id}/members`);
    const p = peoplePicker(r.members.map((m) => m.id));
    modal({ title: `Add people to #${c.name}`, body: p.el, actions: [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', onClick: async () => { try { await api.post(`/api/channels/${c.id}/members`, { user_ids: p.value() }); toast('Added'); } catch (e) { fail(e); return false; } } }] });
  }
  function newChannel() {
    const name = h('input', { class: 'input', placeholder: 'e.g. marketing', required: true });
    const topic = h('input', { class: 'input', placeholder: 'What is it for?' });
    const priv = h('input', { type: 'checkbox' });
    modal({ title: 'New channel', body: [h('label', { class: 'field' }, 'Name', name), h('label', { class: 'field' }, 'Topic (optional)', topic), h('label', { class: 'check' }, priv, 'Private: only people you add can see it')],
      actions: [{ label: 'Cancel' }, { label: 'Create', kind: 'primary', submit: true, onClick: async () => {
        try { const r = await api.post('/api/channels', { name: name.value, topic: topic.value, kind: priv.checked ? 'private' : 'public' }); await loadChannels(); Nexa.router.go('#/huddle/' + r.channel.id); } catch (e) { fail(e); return false; }
      } }] });
  }
  function newDm() {
    const p = peoplePicker();
    modal({ title: 'New message', body: [h('p', { class: 'muted small', style: { margin: 0 } }, 'Pick one person, or a few for a group chat.'), p.el], actions: [{ label: 'Cancel' }, { label: 'Start', kind: 'primary', onClick: async () => {
      const ids = p.value(); if (!ids.length) return false;
      try { const r = await api.post('/api/dm', { user_ids: ids }); Nexa.router.go('#/huddle/' + r.channel.id); } catch (e) { fail(e); return false; }
    } }] });
  }
  function browse() {
    modal({ title: 'Browse channels', body: S.browse.map((c) => h('div', { class: 'person' }, icon('hash', 16), h('div', { class: 'grow' }, h('b', {}, c.name), h('div', { class: 'muted small' }, `${c.member_count} members${c.topic ? ' · ' + c.topic : ''}`)),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { await api.post(`/api/channels/${c.id}/join`).catch(fail); $$('.scrim').forEach((s) => s.remove()); await loadChannels(); Nexa.router.go('#/huddle/' + c.id); } }, 'Join'))), actions: [{ label: 'Close' }] });
  }

  Nexa.Router.add('/huddle', () => open({}));
  Nexa.Router.add('/huddle/:id', ({ id }) => open({ id }));
  Nexa.apps.huddle = {
    async dm(userId) { try { const r = await api.post('/api/dm', { user_ids: [userId] }); Nexa.router.go('#/huddle/' + r.channel.id); } catch (e) { fail(e); } },
  };

  // ======================= calls (WebRTC mesh, up to 8 people) =======================
  // Browsers find each other through STUN, and through a TURN relay when the server has one
  // (see server/ice.js). Without TURN, people behind strict office, hotel or mobile networks can't connect.
  const FALLBACK_ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }] };
  let iceCache = null;
  async function loadIce() {
    if (iceCache && Date.now() - iceCache.at < 6 * 3600 * 1000) return iceCache.cfg;
    try {
      const r = await Promise.race([api.get('/api/call/ice'), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 5000))]);
      if (r && Array.isArray(r.iceServers) && r.iceServers.length) {
        iceCache = { at: Date.now(), relay: !!r.relay, cfg: { iceServers: r.iceServers, iceTransportPolicy: r.iceTransportPolicy === 'relay' ? 'relay' : 'all' } };
        return iceCache.cfg;
      }
    } catch { /* use the public STUN servers below */ }
    return iceCache ? iceCache.cfg : FALLBACK_ICE;
  }
  const hasRelay = () => !!(iceCache && iceCache.relay);

  const MIC_HELP = 'Allow the microphone for this site in your browser settings (on iPhone: Settings > Safari > Microphone), then try again.';
  async function getMedia(video) {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Calls only work on a secure https address. Open Nexa from its https link and try again.', 'bad');
      return null;
    }
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    const cam = { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } };
    let first;
    try { return { stream: await navigator.mediaDevices.getUserMedia({ audio, video: video ? cam : false }), video: !!video }; } catch (err) { first = err; }
    const why = (e) => (e && e.name) || '';
    if (video) {
      // no camera, a camera that is busy or blocked: carry on with sound only
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio });
        toast(why(first) === 'NotAllowedError' ? 'Camera access is blocked, so you joined with audio only.'
          : why(first) === 'NotReadableError' ? 'Your camera is busy in another app, so you joined with audio only.'
            : 'No camera found, so you joined with audio only.');
        return { stream, video: false };
      } catch (err) { first = err; }
    }
    const n = why(first);
    toast(n === 'NotAllowedError' || n === 'SecurityError' ? 'Nexa needs your microphone for calls. ' + MIC_HELP
      : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'Nexa could not find a microphone on this device.'
        : n === 'NotReadableError' ? 'Your microphone is busy in another app. Close that app and try again.'
          : 'Nexa could not start your microphone. ' + MIC_HELP, 'bad');
    return null;
  }

  // Older Safari and some browsers need the offer or answer made explicitly.
  async function setLocal(pc) {
    try { await pc.setLocalDescription(); } catch (err) {
      if (!err || err.name !== 'TypeError') throw err;
      await pc.setLocalDescription(await (pc.signalingState === 'have-remote-offer' ? pc.createAnswer() : pc.createOffer()));
    }
  }
  const plain = (d) => (d && d.toJSON ? d.toJSON() : { type: d.type, sdp: d.sdp });
  const connected = (pc) => pc.connectionState === 'connected' || ['connected', 'completed'].includes(pc.iceConnectionState);
  let C = null;
  Nexa.call = {
    async start(cid, label, video) {
      if (C) { if (C.cid === cid) { C.el.classList.remove('mini'); return; } await this.leave(); }
      if (this.starting) return;
      this.starting = true;
      let media, ice;
      try { [media, ice] = await Promise.all([getMedia(video), loadIce()]); } finally { this.starting = false; }
      if (!media) return;
      const { stream } = media; video = media.video;
      C = { cid, label, stream, ice, peers: new Map(), muted: false, video: !!video, screen: null, offs: [] };
      const grid = h('div', { class: 'call-grid' });
      const btn = (ic, title, fn, cls = '') => h('button', { class: 'btn ' + cls, title, 'aria-label': title, onclick: fn }, icon(ic, 18));
      const micB = btn('mic', 'Mute', () => this.toggleMic()), camB = btn('video', 'Camera', () => this.toggleCam()), shareB = btn('screen', 'Share screen', () => this.toggleScreen());
      C.el = h('div', { class: 'call' }, h('div', { class: 'row', style: { color: '#fff', padding: '10px 16px' } }, h('b', {}, label), h('span', { class: 'muted small', 'data-count': '' }), h('span', { class: 'grow' }),
        h('button', { class: 'btn ghost sm', style: { color: '#fff' }, onclick: () => C.el.classList.toggle('mini') }, 'Minimize')), grid,
        h('div', { class: 'call-bar' }, micB, camB, navigator.mediaDevices.getDisplayMedia ? shareB : null, btn('hand', 'Raise hand', () => { C.hand = !C.hand; this.state(); toast(C.hand ? 'Hand raised' : 'Hand lowered'); }),
          btn('link', 'Copy call link', () => Nexa.copyText(location.origin + (Nexa.state.linkBase || '') + '/#/huddle/' + cid)), h('button', { class: 'btn leave', onclick: () => this.leave() }, icon('phone', 18), 'Leave')));
      Object.assign(C, { grid, micB, camB, shareB });
      document.body.append(C.el);
      this.tile('me', 'You', stream, true);
      if (!video) camB.classList.add('off');
      C.offs.push(
        Nexa.rt.on('call.joined', (m) => {
          if (!C || m.channel_id !== cid) return;
          C.live = true; this.count(m.participants);
          // anyone we still hold who left while we were offline is gone
          for (const pid of [...C.peers.keys()]) if (!m.peers.includes(pid)) this.drop(pid);
          // (re)connect to everyone in the call: after a dropped connection both sides start fresh
          for (const p of m.peers) this.reset(p, (m.participants.find((x) => x.id === p) || {}).name);
        }),
        Nexa.rt.on('call.peer', (m) => { if (!C || m.channel_id !== cid) return; this.count(m.participants); this.reset(m.user_id, m.name); }),
        Nexa.rt.on('call.left', (m) => { if (!C || m.channel_id !== cid) return; this.count(m.participants); this.drop(m.user_id); }),
        Nexa.rt.on('call.full', (m) => { if (C && m.channel_id === cid) { toast('This call is full (8 people).', 'bad'); this.leave(); } }),
        Nexa.rt.on('call.signal', (m) => { if (C && m.channel_id === cid) this.signal(m); }),
        Nexa.rt.on('call.state', (m) => { if (!C || m.channel_id !== cid) return; const t = C.grid.querySelector(`[data-peer="${m.user_id}"] .name`); if (t) t.textContent = `${t.dataset.n}${m.muted ? ' 🔇' : ''}${m.hand ? ' ✋' : ''}`; }),
        Nexa.rt.on('disconnected', () => { if (!C) return; C.live = false; const c = C.el.querySelector('[data-count]'); if (c) c.textContent = ' · reconnecting…'; }),
        Nexa.rt.on('connected', () => { if (C) { Nexa.rt.send({ t: 'call.join', channel_id: cid }); this.state(); } }),
      );
      Nexa.rt.send({ t: 'call.join', channel_id: cid });
      if (C.ac && C.ac.state === 'suspended') C.ac.resume().catch(() => {});
    },
    count(list) { const c = C && C.el.querySelector('[data-count]'); if (c) c.textContent = ` · ${list.length} in call`; },
    tile(key, name, stream, mine) {
      let t = C.grid.querySelector(`[data-peer="${key}"]`);
      if (!t) {
        t = h('div', { class: 'tile', 'data-peer': key }, h('video', { autoplay: true, playsinline: true, muted: !!mine }),
          h('span', { class: 'name', 'data-n': name }, name), h('span', { class: 'state', role: 'status' }));
        C.grid.append(t);
      }
      const v = t.querySelector('video');
      v.muted = !!mine; if (mine) v.style.transform = 'scaleX(-1)';
      if (stream && v.srcObject !== stream) v.srcObject = stream;
      if (stream) {
        v.play().catch(() => { if (!mine) this.tapToPlay(t, v); });
        this.speaking(t, stream);
      }
      return t;
    },
    // Phones and some browsers won't start sound until the person taps the page.
    tapToPlay(t, v) {
      if (t.querySelector('.tap')) return;
      const b = h('button', { class: 'btn tap', type: 'button', onclick: () => { v.play().then(() => b.remove(), () => {}); if (C && C.ac) C.ac.resume().catch(() => {}); } }, 'Tap to turn on sound');
      t.append(b);
    },
    status(pid, text, bad) {
      const t = C && C.grid.querySelector(`[data-peer="${pid}"] .state`);
      if (!t) return;
      t.textContent = text || '';
      t.classList.toggle('bad', !!bad);
    },
    speaking(t, stream) {
      if (t._meter === stream || !stream.getAudioTracks().length || !window.AudioContext) return;
      t._meter = stream;
      try {
        C.ac = C.ac || new AudioContext();
        const an = C.ac.createAnalyser(); an.fftSize = 256; C.ac.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.frequencyBinCount);
        const tick = () => { if (!C || !t.isConnected || t._meter !== stream) return; an.getByteFrequencyData(buf); t.classList.toggle('speaking', buf.reduce((a, b) => a + b, 0) / buf.length > 18); requestAnimationFrame(tick); };
        tick();
      } catch { /* audio meter is optional */ }
    },
    reset(pid, name) {
      if (!C || pid === Nexa.state.user.id) return;
      const old = C.peers.get(pid);
      if (old) this.drop(pid, true);
      return this.peer(pid, name || (old && old.name));
    },
    peer(pid, name) {
      if (C.peers.has(pid)) return C.peers.get(pid);
      let pc;
      try { pc = new RTCPeerConnection(C.ice); } catch { pc = new RTCPeerConnection(FALLBACK_ICE); }
      const p = { pc, name: name || 'Guest', polite: Nexa.state.user.id > pid, makingOffer: false, ignore: false, queue: Promise.resolve(), restarts: 0, timers: {}, remote: null };
      C.peers.set(pid, p);
      this.tile(pid, p.name, null, false);
      this.status(pid, 'Connecting…');
      for (const tr of (C.screen || C.stream).getTracks()) pc.addTrack(tr, C.stream);
      if (C.screen) for (const tr of C.stream.getAudioTracks()) pc.addTrack(tr, C.stream);
      const send = (data) => Nexa.rt.send({ t: 'call.signal', channel_id: C.cid, to: pid, data });
      p.send = send;
      pc.onicecandidate = (e) => { if (e.candidate && C && C.peers.get(pid) === p) send({ candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
      pc.ontrack = (e) => {
        let s = e.streams && e.streams[0];
        if (!s) { s = p.remote || new MediaStream(); s.addTrack(e.track); }
        p.remote = s;
        this.tile(pid, p.name, s, false);
      };
      pc.onnegotiationneeded = async () => {
        try { p.makingOffer = true; await setLocal(pc); send({ description: plain(pc.localDescription) }); } catch (err) { console.warn('call offer', err); } finally { p.makingOffer = false; }
      };
      pc.onconnectionstatechange = () => this.watch(pid, p);
      pc.oniceconnectionstatechange = () => this.watch(pid, p);
      // still not connected after a while: tell the person instead of leaving a black tile
      p.timers.first = setTimeout(() => { if (C && C.peers.get(pid) === p && !connected(pc)) this.giveUp(pid, p); }, 25000);
      return p;
    },
    watch(pid, p) {
      if (!C || C.peers.get(pid) !== p) return;
      const { pc } = p;
      const st = pc.connectionState || pc.iceConnectionState;
      if (connected(pc)) {
        clearTimeout(p.timers.dc); clearTimeout(p.timers.retry);
        p.restarts = 0; p.gaveUp = false;
        this.status(pid, '');
        return;
      }
      if (st === 'disconnected' || pc.iceConnectionState === 'disconnected') {
        // often a brief network blip that heals on its own; restart if it doesn't
        this.status(pid, 'Reconnecting…');
        clearTimeout(p.timers.dc);
        p.timers.dc = setTimeout(() => { if (C && C.peers.get(pid) === p && !connected(pc)) this.restart(pid, p); }, 5000);
      } else if (st === 'failed' || pc.iceConnectionState === 'failed') this.restart(pid, p);
    },
    restart(pid, p) {
      if (!C || C.peers.get(pid) !== p) return;
      if (p.restarts >= 3) return this.giveUp(pid, p);
      p.restarts++;
      this.status(pid, 'Reconnecting…');
      try { p.pc.restartIce(); } catch { return this.reset(pid, p.name); }
      clearTimeout(p.timers.retry);
      p.timers.retry = setTimeout(() => { if (C && C.peers.get(pid) === p && !connected(p.pc)) this.restart(pid, p); }, 12000);
    },
    giveUp(pid, p) {
      if (!C || p.gaveUp) return;
      p.gaveUp = true;
      const why = !Nexa.rt.ws || Nexa.rt.ws.readyState !== 1 ? 'Your connection to Nexa dropped. Check your internet.'
        : hasRelay() ? 'Check your internet connection, or try leaving and joining again.'
          : 'Your network or theirs is blocking the call. Try a different Wi-Fi or mobile data.';
      this.status(pid, `Can't connect to ${p.name}. ${why}`, true);
      toast(`Can't connect to ${p.name}. ${why}`, 'bad');
    },
    signal(m) {
      let p = C.peers.get(m.from);
      const { description, candidate } = m.data || {};
      if (!p) {
        if (!description || description.type !== 'offer') return; // a stray message from a call that already ended
        p = this.peer(m.from, m.name);
      }
      // handle one message at a time per person so answers and candidates never overtake each other
      p.queue = p.queue.then(() => this.handleSignal(m.from, p, description, candidate));
    },
    async handleSignal(pid, p, description, candidate) {
      if (!C || C.peers.get(pid) !== p) return;
      const { pc } = p;
      try {
        if (description) {
          const collision = description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
          p.ignore = !p.polite && collision;
          if (p.ignore) return;
          if (collision) await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
          await pc.setRemoteDescription(description);
          if (description.type === 'offer') { await setLocal(pc); p.send({ description: plain(pc.localDescription) }); }
        } else if (candidate) {
          try { await pc.addIceCandidate(candidate); } catch (err) { if (!p.ignore) console.warn('call candidate', err); }
        }
      } catch (err) { console.warn('call signal', err); }
    },
    drop(pid, keepTile) {
      const p = C && C.peers.get(pid);
      if (p) { for (const t of Object.values(p.timers)) clearTimeout(t); p.pc.onicecandidate = p.pc.ontrack = p.pc.onnegotiationneeded = p.pc.onconnectionstatechange = p.pc.oniceconnectionstatechange = null; p.pc.close(); C.peers.delete(pid); }
      const t = C && C.grid.querySelector(`[data-peer="${pid}"]`);
      if (t && !keepTile) t.remove();
    },
    state() { if (C) Nexa.rt.send({ t: 'call.state', channel_id: C.cid, muted: C.muted, video: C.video, hand: !!C.hand }); },
    toggleMic() { C.muted = !C.muted; C.stream.getAudioTracks().forEach((t) => { t.enabled = !C.muted; }); clear(C.micB).append(icon(C.muted ? 'micoff' : 'mic', 18)); C.micB.classList.toggle('off', C.muted); this.state(); },
    async toggleCam() {
      const vt = C.stream.getVideoTracks()[0];
      if (vt) { C.video = !C.video; vt.enabled = C.video; C.camB.classList.toggle('off', !C.video); this.state(); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
        const t = s.getVideoTracks()[0]; C.stream.addTrack(t); C.video = true; C.camB.classList.remove('off');
        for (const p of C.peers.values()) p.pc.addTrack(t, C.stream);
        this.tile('me', 'You', C.stream, true);
        this.state();
      } catch (err) { toast(err && err.name === 'NotAllowedError' ? 'Camera access is blocked. Allow the camera for this site in your browser settings.' : 'Nexa could not turn on your camera.', 'bad'); }
    },
    async toggleScreen() {
      if (C.screen) return this.stopScreen();
      try { C.screen = await navigator.mediaDevices.getDisplayMedia({ video: true }); } catch { return; }
      const st = C.screen.getVideoTracks()[0];
      for (const p of C.peers.values()) { const s = p.pc.getSenders().find((x) => x.track && x.track.kind === 'video'); if (s) s.replaceTrack(st); else p.pc.addTrack(st, C.stream); }
      st.onended = () => this.stopScreen();
      C.shareB.classList.add('on');
      this.tile('me', 'You (sharing)', new MediaStream([st, ...C.stream.getAudioTracks()]), true).querySelector('video').style.transform = '';
    },
    stopScreen() {
      if (!C || !C.screen) return;
      C.screen.getTracks().forEach((t) => t.stop()); C.screen = null;
      const cam = C.stream.getVideoTracks()[0];
      for (const p of C.peers.values()) { const s = p.pc.getSenders().find((x) => x.track && x.track.kind === 'video'); if (s) s.replaceTrack(cam || null); }
      C.shareB.classList.remove('on');
      this.tile('me', 'You', C.stream, true);
    },
    async leave() {
      if (!C) return;
      Nexa.rt.send({ t: 'call.leave', channel_id: C.cid });
      for (const pid of [...C.peers.keys()]) this.drop(pid);
      C.stream.getTracks().forEach((t) => t.stop());
      if (C.screen) C.screen.getTracks().forEach((t) => t.stop());
      if (C.ac) C.ac.close().catch(() => {});
      C.offs.forEach((f) => f()); C.el.remove(); C = null;
    },
  };
  // pagehide also fires on phones, where beforeunload often doesn't
  for (const ev of ['beforeunload', 'pagehide']) addEventListener(ev, () => { if (C) Nexa.rt.send({ t: 'call.leave', channel_id: C.cid }); });
})();
