/* Relay: team mail with folders, threads, drafts and attachments. */
'use strict';
(function () {
  const { h, $, $$, clear, icon, api, toast, fail, modal, menu, avatar, fmtTime, fmtDate, fileIcon, fileRoute, confirmBox, escapeHtml } = Nexa;
  const FOLDERS = [
    { id: 'inbox', name: 'Inbox', icon: 'inbox' }, { id: 'starred', name: 'Starred', icon: 'star' }, { id: 'sent', name: 'Sent', icon: 'send' },
    { id: 'drafts', name: 'Drafts', icon: 'draft' }, { id: 'archive', name: 'Archive', icon: 'archive' }, { id: 'trash', name: 'Trash', icon: 'trash' },
  ];
  let R = null;

  const when = (t) => { const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? fmtTime(t) : fmtDate(t); };

  async function open(q) {
    const view = Nexa.shell('relay');
    if (!Nexa.state.users.length) Nexa.state.users = (await api.get('/api/users')).users;
    const folders = h('nav', { class: 'r-folders' });
    const list = h('div', { class: 'r-list' });
    const read = h('section', { class: 'r-read' });
    view.append(h('div', { class: 'relay' }, folders, list, read));
    R = { folder: (q && q.folder) || 'inbox', folders, list, read, q: '', open: null };
    drawFolders();
    await load();
    const off = Nexa.rt.on('mail.new', () => R && R.folder === 'inbox' && load());
    return { leave: () => { off(); R = null; } };
  }

  function drawFolders(unread) {
    clear(R.folders).append(h('button', { class: 'btn primary', style: { margin: '0 4px 12px' }, onclick: () => compose() }, icon('edit', 16), h('span', { class: 'lbl' }, 'Compose')));
    for (const f of FOLDERS) R.folders.append(h('button', { class: 'h-item' + (R.folder === f.id ? ' on' : ''), style: { border: 0, background: R.folder === f.id ? '' : 'none', width: '100%', textAlign: 'left' },
      onclick: () => { R.folder = f.id; R.open = null; drawFolders(unread); load(); } }, icon(f.icon, 16), h('span', { class: 'lbl grow' }, f.name), f.id === 'inbox' && unread ? h('span', { class: 'badge' }, unread) : null));
    R.folders.append(h('div', { class: 'muted small lbl', style: { padding: '14px 10px 0', lineHeight: 1.5 } }, `Your address is ${Nexa.state.user.email}. Mail to teammates arrives instantly.`));
  }

  async function load() {
    let r;
    try { r = await api.get(`/api/mail?folder=${R.folder}&q=${encodeURIComponent(R.q)}`); } catch (e) { return fail(e); }
    if (!R) return;
    drawFolders(r.unread);
    const search = h('input', { class: 'input', placeholder: 'Search mail', value: R.q, 'aria-label': 'Search mail' });
    search.addEventListener('input', Nexa.debounce(() => { R.q = search.value; load(); }, 300));
    clear(R.list).append(h('div', { style: { padding: '12px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--bg-2)', zIndex: 1 } }, search));
    if (!r.threads.length) R.list.append(h('div', { class: 'empty' }, icon(FOLDERS.find((f) => f.id === R.folder).icon, 34), R.q ? 'Nothing matches that search.' : `Nothing in ${FOLDERS.find((f) => f.id === R.folder).name.toLowerCase()}.`));
    for (const t of r.threads) {
      const who = R.folder === 'sent' || R.folder === 'drafts' ? 'To: ' + (t.to.join(', ') || '(no one yet)') : t.from_name;
      R.list.append(h('div', { class: 'item' + (t.is_read ? '' : ' unread') + (R.open === t.thread_id ? ' on' : ''), tabindex: 0, 'data-thread': t.thread_id,
        onclick: () => (R.folder === 'drafts' ? editDraft(t) : openThread(t.thread_id)), onkeydown: (e) => e.key === 'Enter' && e.currentTarget.click() },
        h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'from grow ellipsis' }, who), t.count > 1 ? h('span', { class: 'muted small' }, t.count) : null, t.starred ? h('span', { style: { color: 'var(--warn)' } }, icon('star', 13)) : null, h('span', { class: 'muted small' }, when(t.created_at))),
        h('div', { class: 'subj ellipsis' }, t.subject), h('div', { class: 'prev' }, t.preview || ' ')));
    }
    if (!R.open) clear(R.read).append(h('div', { class: 'empty' }, Nexa.appIcon('relay', true), 'Pick a conversation to read it.'));
    Nexa.refreshBadges();
  }

  async function openThread(tid) {
    R.open = tid;
    $$('.item', R.list).forEach((i) => i.classList.toggle('on', i.dataset.thread === tid));
    let r;
    try { r = await api.get('/api/mail/threads/' + tid); } catch (e) { return fail(e); }
    const msgs = r.messages; const last = msgs[msgs.length - 1];
    const me = Nexa.state.user;
    const act = (ic, label, fn) => h('button', { class: 'btn ghost sm', title: label, onclick: fn }, icon(ic, 15), label);
    clear(R.read).append(
      h('div', { class: 'row', style: { marginBottom: '8px', flexWrap: 'wrap' } },
        act('reply', 'Reply', () => reply(last, false)), act('reply', 'Reply all', () => reply(last, true)), act('send', 'Forward', () => forward(last)),
        h('span', { class: 'grow' }),
        act('star', last.starred ? 'Unstar' : 'Star', async () => { await api.patch('/api/mail/' + last.id, { starred: !last.starred }).catch(fail); openThread(tid); load(); }),
        R.folder !== 'archive' ? act('archive', 'Archive', () => move(last, 'archive')) : act('inbox', 'Move to inbox', () => move(last, 'inbox')),
        R.folder !== 'trash' ? act('trash', 'Delete', () => move(last, 'trash')) : act('trash', 'Delete forever', async () => { if (await confirmBox('Delete forever?', 'This removes the conversation from your mailbox for good.', 'Delete', true)) { await api.del('/api/mail/' + last.id).catch(fail); R.open = null; load(); } }),
        act('inbox', 'Mark unread', async () => { await api.patch('/api/mail/' + last.id, { is_read: false, whole_thread: true }).catch(fail); R.open = null; load(); })),
      h('h2', {}, msgs[0].subject),
      msgs.map((m, i) => h('article', { class: 'mail-msg' },
        h('header', {}, avatar({ id: m.from_addr, name: m.from_name }), h('div', { class: 'grow', style: { minWidth: 0 } },
          h('b', {}, m.from_name), h('span', { class: 'muted small' }, ` <${m.from_addr}>`),
          h('div', { class: 'muted small ellipsis' }, 'To: ' + m.to.join(', ') + (m.cc.length ? ' · Cc: ' + m.cc.join(', ') : ''))),
          h('span', { class: 'muted small' }, new Date(m.created_at).toLocaleString()),
          m.external_status === 'failed' ? h('span', { class: 'pill', style: { color: 'var(--bad)' } }, 'Not delivered outside') : null),
        h('div', { class: 'content', html: m.body_html }),
        m.attachments.length ? h('div', { class: 'row', style: { padding: '0 16px 14px', flexWrap: 'wrap' } }, m.attachments.map((f) => h('a', { class: 'file-chip', href: fileRoute(f), target: f.kind === 'upload' ? '_blank' : null }, fileIcon(f), h('div', {}, h('b', {}, f.title), h('div', { class: 'muted small' }, f.kind === 'upload' ? Nexa.fmtSize(f.size) : Nexa.appById(Nexa.KIND_APP[f.kind]).name))))) : null)),
      h('button', { class: 'btn', style: { marginTop: '4px' }, onclick: () => reply(last, last.to.length + last.cc.length > 1) }, icon('reply', 15), 'Write a reply'));
    $$('.item', R.list).forEach((i) => { if (i.dataset.thread === tid) i.classList.remove('unread'); });
    Nexa.refreshBadges();
    if (me) { /* read marks are done by the server on open */ }
  }
  async function move(m, folder) { try { await api.patch('/api/mail/' + m.id, { folder, whole_thread: true }); toast(folder === 'trash' ? 'Moved to Trash' : folder === 'archive' ? 'Archived' : 'Moved to Inbox'); R.open = null; load(); } catch (e) { fail(e); } }

  const quote = (m) => `<p><br></p><p>On ${escapeHtml(new Date(m.created_at).toLocaleString())}, ${escapeHtml(m.from_name)} wrote:</p><blockquote>${m.body_html}</blockquote>`;
  const re = (s) => (/^re:/i.test(s) ? s : 'Re: ' + s);
  function reply(m, all) {
    const me = Nexa.state.user.email;
    const to = m.from_addr === me ? m.to : [m.from_addr];
    const cc = all ? [...m.to, ...m.cc].filter((a) => a !== me && !to.includes(a)) : [];
    compose({ to, cc, subject: re(m.subject), body_html: quote(m), reply_to: m.id });
  }
  function forward(m) { compose({ subject: /^fwd:/i.test(m.subject) ? m.subject : 'Fwd: ' + m.subject, body_html: `<p><br></p><p>Forwarded message from ${escapeHtml(m.from_name)} &lt;${escapeHtml(m.from_addr)}&gt;:</p><blockquote>${m.body_html}</blockquote>`, attachments: m.attachments }); }
  async function editDraft(t) {
    const r = await api.get('/api/mail/threads/' + t.thread_id);
    const d = r.messages[r.messages.length - 1];
    compose({ to: d.to, cc: d.cc, subject: d.subject === '(no subject)' ? '' : d.subject, body_html: d.body_html, attachments: d.attachments, draft_id: d.id });
  }

  // An address box that suggests teammates as you type.
  function addrInput(initial, placeholder) {
    const inp = h('input', { class: 'input', value: (initial || []).join(', '), placeholder, autocomplete: 'off', spellcheck: false });
    const sug = h('div', { class: 'suggest hidden' });
    const wrap = h('div', { class: 'addr-input' }, inp, sug);
    let pick = 0, opts = [];
    const draw = () => {
      const part = inp.value.split(',').pop().trim().toLowerCase();
      opts = part ? Nexa.state.users.filter((u) => (u.name + ' ' + u.email).toLowerCase().includes(part)).slice(0, 6) : [];
      clear(sug).classList.toggle('hidden', !opts.length);
      opts.forEach((u, i) => sug.append(h('div', { class: i === pick ? 'sel' : '', onmousedown: (e) => { e.preventDefault(); choose(u); } }, avatar(u, 'sm'), h('span', {}, u.name, h('span', { class: 'muted small' }, ' ' + u.email)))));
    };
    const choose = (u) => { const parts = inp.value.split(','); parts[parts.length - 1] = ' ' + u.email; inp.value = parts.map((p) => p.trim()).filter(Boolean).join(', ') + ', '; pick = 0; draw(); inp.focus(); };
    inp.addEventListener('input', () => { pick = 0; draw(); });
    inp.addEventListener('blur', () => setTimeout(() => sug.classList.add('hidden'), 100));
    inp.addEventListener('keydown', (e) => {
      if (!opts.length || sug.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); pick = (pick + 1) % opts.length; draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); pick = (pick - 1 + opts.length) % opts.length; draw(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(opts[pick]); }
    });
    return { el: wrap, value: () => inp.value.split(/[,;]/).map((s) => s.trim()).filter(Boolean), input: inp };
  }

  function compose(init = {}) {
    const to = addrInput(init.to, 'name@company.com'), cc = addrInput(init.cc, 'Cc'), bcc = addrInput(init.bcc, 'Bcc');
    const ccRow = h('label', { class: 'field' + (init.cc && init.cc.length ? '' : ' hidden') }, 'Cc', cc.el);
    const bccRow = h('label', { class: 'field hidden' }, 'Bcc', bcc.el);
    const subject = h('input', { class: 'input', value: init.subject || '', placeholder: 'Subject' });
    const body = h('div', { class: 'rich', contentEditable: 'true', html: init.body_html || '<p><br></p>', 'aria-label': 'Message' });
    let atts = [...(init.attachments || [])];
    const attBox = h('div', { class: 'row', style: { flexWrap: 'wrap' } });
    const drawAtts = () => { clear(attBox); for (const f of atts) attBox.append(h('span', { class: 'file-chip' }, fileIcon(f), f.title, h('button', { class: 'btn ghost icon sm', type: 'button', 'aria-label': 'Remove attachment', onclick: () => { atts = atts.filter((x) => x !== f); drawAtts(); } }, icon('close', 13)))); };
    drawAtts();
    const ex = (c, v) => (e) => { e.preventDefault(); document.execCommand(c, false, v); body.focus(); };
    const tool = (ic, title, fn) => h('button', { class: 'btn ghost icon sm', type: 'button', title, onmousedown: (e) => e.preventDefault(), onclick: fn }, icon(ic, 15));
    const bar = h('div', { class: 'row', style: { gap: '2px', flexWrap: 'wrap' } },
      tool('bold', 'Bold', ex('bold')), tool('italic', 'Italic', ex('italic')), tool('underline', 'Underline', ex('underline')), tool('list', 'Bullets', ex('insertUnorderedList')), tool('olist', 'Numbers', ex('insertOrderedList')),
      tool('link', 'Link', async (e) => { e.preventDefault(); const u = await Nexa.promptBox('Add a link', 'Web address', 'https://'); if (u && /^(https?:|mailto:)/i.test(u)) { body.focus(); document.execCommand('createLink', false, u); } }),
      tool('clip', 'Attach', (e) => menu(e.currentTarget, [
        { label: 'Upload from this device', icon: 'upload', onClick: async () => { const fs = await Nexa.pickFile('', true); for (const f of fs) { const v = await Nexa.vaultUpload(f); if (v) atts.push(v); } drawAtts(); } },
        { label: 'Pick from Vault', icon: 'vault', onClick: async () => { const f = await Nexa.pickVaultFile(); if (f) { atts.push(f); drawAtts(); } } },
      ])),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: (e) => { ccRow.classList.remove('hidden'); bccRow.classList.remove('hidden'); e.currentTarget.remove(); } }, 'Cc / Bcc'));
    let draftId = init.draft_id || null, sent = false;
    const payload = (draft) => ({ to: to.value(), cc: cc.value(), bcc: bcc.value(), subject: subject.value, body_html: body.innerHTML, attachments: atts.map((f) => f.id), reply_to: init.reply_to, draft, draft_id: draftId });
    const hasContent = () => to.value().length || subject.value.trim() || body.innerText.trim();
    const saveDraft = async () => { if (sent || !hasContent()) return; try { const r = await api.post('/api/mail', payload(true)); draftId = r.id; } catch { /* drafts are best effort */ } };
    const autosave = Nexa.debounce(saveDraft, 2500);
    [subject, body, to.input].forEach((el) => el.addEventListener('input', autosave));
    modal({ title: init.reply_to ? 'Reply' : 'New email', wide: true,
      body: [h('label', { class: 'field' }, 'To', to.el), ccRow, bccRow, h('label', { class: 'field' }, 'Subject', subject), bar, body, attBox],
      onClose: () => { autosave.cancel(); if (!sent && hasContent()) saveDraft().then(() => { toast('Saved to Drafts'); if (R && R.folder === 'drafts') load(); }); },
      actions: [
        draftId ? { label: 'Discard draft', kind: 'danger', onClick: async () => { sent = true; await api.del('/api/mail/' + draftId).catch(() => {}); if (R) load(); } } : null,
        { label: 'Close' },
        { label: 'Send', kind: 'primary', onClick: async () => {
          if (!to.value().length && !cc.value().length && !bcc.value().length) { toast('Add at least one recipient.', 'bad'); return false; }
          try { autosave.cancel(); await api.post('/api/mail', payload(false)); sent = true; toast('Sent'); if (R) load(); } catch (e) { fail(e); return false; }
        } },
      ].filter(Boolean) });
    setTimeout(() => (to.value().length ? body : to.input).focus(), 50);
  }

  Nexa.Router.add('/relay', (p) => open({ folder: new URLSearchParams(p.qs || '').get('folder') }));
  Nexa.apps.relay = { compose };
})();
