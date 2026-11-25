/* App shell: top bar, launcher, home, search palette, people and admin, profile. */
'use strict';
(function () {
  const { h, $, $$, clear, icon, logo, api, APPS, appById, appIcon, fileIcon, fileRoute, avatar, timeAgo, toast, fail, modal, menu, confirmBox, copyText, applyTheme, fmtDate } = Nexa;

  let deferredInstall = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $$('[data-install]').forEach((b) => b.classList.remove('hidden')); });
  addEventListener('appinstalled', () => { deferredInstall = null; $$('[data-install]').forEach((b) => b.classList.add('hidden')); toast('Astute Nexa is installed'); });
  async function install() {
    if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; return; }
    modal({ title: 'Install Astute Nexa', body: [
      h('p', { style: { margin: 0 } }, 'Nexa installs as an app from your browser, with its own window and icon.'),
      h('ul', { style: { margin: 0, paddingLeft: '18px', lineHeight: 1.8 } },
        h('li', {}, h('b', {}, 'Chrome or Edge: '), 'click the install icon at the right of the address bar.'),
        h('li', {}, h('b', {}, 'Safari on Mac: '), 'File, then Add to Dock.'),
        h('li', {}, h('b', {}, 'iPhone or iPad: '), 'tap Share, then Add to Home Screen.'),
        h('li', {}, h('b', {}, 'Android: '), 'tap the menu, then Install app.')),
    ], actions: [{ label: 'Got it', kind: 'primary' }] });
  }
  Nexa.install = install;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  // ---------- shell ----------
  let unread = { mail: 0, chat: 0 };
  function shell(appId) {
    const root = document.getElementById('app');
    let sh = $('.shell', root);
    if (!sh) {
      clear(root);
      const u = Nexa.state.user;
      sh = h('div', { class: 'shell' },
        h('header', { class: 'topbar' },
          h('button', { class: 'btn ghost icon', 'aria-label': 'All apps', onclick: toggleWaffle }, icon('apps', 20)),
          h('a', { class: 'brand', href: '#/home' }, logo(28), h('span', {}, 'Nexa'), h('span', { class: 'app-name', 'data-appname': '' })),
          h('button', { class: 'search-trigger', onclick: () => palette() }, icon('search', 16), h('span', {}, 'Search files, messages and people'), h('span', { class: 'kbd' }, navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K')),
          h('button', { class: 'btn ghost sm hidden', 'data-install': '', onclick: install }, icon('install', 16), 'Install app'),
          h('a', { class: 'btn ghost icon', href: '#/huddle', title: 'Huddle', style: { position: 'relative' } }, icon('huddle'), h('span', { class: 'badge hidden', 'data-badge': 'chat', style: { position: 'absolute', top: '-2px', right: '-4px' } })),
          h('a', { class: 'btn ghost icon', href: '#/relay', title: 'Relay', style: { position: 'relative' } }, icon('relay'), h('span', { class: 'badge hidden', 'data-badge': 'mail', style: { position: 'absolute', top: '-2px', right: '-4px' } })),
          h('button', { class: 'btn ghost', style: { padding: '0 4px' }, 'aria-label': 'Account', onclick: (e) => accountMenu(e.currentTarget) }, avatar(u))),
        h('main', { class: 'main' }, h('div', { class: 'view', id: 'view' })));
      root.append(sh);
      if (deferredInstall) $('[data-install]').classList.remove('hidden');
      refreshBadges();
    }
    const a = appById(appId);
    $('[data-appname]').textContent = a ? '· ' + a.name : '';
    document.title = (a ? a.name + ' · ' : '') + 'Astute Nexa';
    const view = clear($('#view'));
    view.className = 'view';
    return view;
  }
  async function refreshBadges() {
    try {
      const [m, c] = await Promise.all([api.get('/api/mail?folder=inbox'), api.get('/api/channels')]);
      unread.mail = m.unread; unread.chat = c.channels.reduce((s, x) => s + (x.unread || 0), 0);
      Nexa.state.online = new Set(c.online);
    } catch { return; }
    for (const [k, v] of Object.entries(unread)) { const b = $(`[data-badge=${k}]`); if (b) { b.textContent = v > 99 ? '99+' : v; b.classList.toggle('hidden', !v); } }
  }
  Nexa.refreshBadges = Nexa.debounce(refreshBadges, 400);
  Nexa.rt.on('message.new', (m) => { if (m.message.user_id !== Nexa.state.user.id) Nexa.refreshBadges(); });
  Nexa.rt.on('mail.new', (m) => { Nexa.refreshBadges(); if (!location.hash.startsWith('#/relay')) toast(`New mail from ${m.from}: ${m.subject}`); });
  Nexa.rt.on('event.invite', (m) => toast(`${m.from} invited you to “${m.title}”`));
  Nexa.rt.on('event.rsvp', (m) => toast(`${m.from} ${m.response} “${m.title}”`));

  function toggleWaffle() {
    const ex = $('.waffle'); if (ex) return ex.remove();
    const w = h('nav', { class: 'waffle' }, APPS.map((a) => h('a', { href: a.route, onclick: () => w.remove() }, appIcon(a.id), a.name)),
      h('a', { href: '#/people', onclick: () => w.remove() }, h('span', { class: 'app-ico', style: { background: '#64748B' } }, icon('people')), 'People'),
      h('a', { href: '#/home', onclick: () => w.remove() }, h('span', { class: 'app-ico', style: { background: 'var(--grad)' } }, icon('home')), 'Home'));
    document.body.append(w);
    const off = (e) => { if (!w.contains(e.target) && !e.target.closest('[aria-label="All apps"]')) { w.remove(); document.removeEventListener('mousedown', off); } };
    setTimeout(() => document.addEventListener('mousedown', off), 0);
  }
  function accountMenu(anchor) {
    const u = Nexa.state.user;
    menu(anchor, [
      { label: `${u.name} · ${u.role}`, header: true },
      { label: 'Profile and password', icon: 'settings', onClick: profile },
      { label: 'People and admin', icon: 'people', onClick: () => Nexa.router.go('#/people') },
      '-',
      { label: 'Light theme', icon: 'sun', onClick: () => applyTheme('light') },
      { label: 'Dark theme', icon: 'moon', onClick: () => applyTheme('dark') },
      { label: 'Match my device', icon: 'settings', onClick: () => applyTheme('system') },
      !standalone() && { label: 'Install as an app', icon: 'install', onClick: install },
      '-',
      { label: 'Sign out', icon: 'logout', onClick: async () => { await api.post('/api/logout'); Nexa.rt.close(); Nexa.state.user = null; location.hash = ''; location.reload(); } },
    ]);
  }
  function profile() {
    const u = Nexa.state.user;
    const name = h('input', { class: 'input', value: u.name });
    const title = h('input', { class: 'input', value: u.title || '', placeholder: 'e.g. Operations lead' });
    const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const nw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Leave empty to keep it' });
    modal({ title: 'Your profile', body: [
      h('div', { class: 'row' }, avatar(u, 'lg'), h('div', {}, h('b', {}, u.email), h('div', { class: 'muted small' }, 'Role: ' + u.role))),
      h('label', { class: 'field' }, 'Name', name), h('label', { class: 'field' }, 'Job title', title),
      h('div', { class: 'divider' }), h('b', {}, 'Change password'),
      h('label', { class: 'field' }, 'Current password', cur), h('label', { class: 'field' }, 'New password', nw),
    ], actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', submit: true, onClick: async () => {
      try {
        const body = { name: name.value, title: title.value };
        if (nw.value) Object.assign(body, { currentPassword: cur.value, newPassword: nw.value });
        const r = await api.patch('/api/me', body);
        Nexa.state.user = r.user; toast('Profile saved');
      } catch (e) { fail(e); return false; }
    } }] });
  }

  // ---------- search palette (Ctrl/Cmd+K) ----------
  function palette() {
    if ($('.palette')) return;
    const input = h('input', { class: 'input', placeholder: 'Search or type a command…', 'aria-label': 'Search' });
    const results = h('div', { class: 'results' });
    let items = [], sel = 0;
    const commands = [
      { label: 'New document', icon: 'write', run: () => Nexa.newFile('doc') },
      { label: 'New spreadsheet', icon: 'grid', run: () => Nexa.newFile('sheet') },
      { label: 'New presentation', icon: 'deck', run: () => Nexa.newFile('deck') },
      { label: 'Write an email', icon: 'relay', run: () => { Nexa.router.go('#/relay'); setTimeout(() => Nexa.apps.relay && Nexa.apps.relay.compose(), 300); } },
      { label: 'New calendar event', icon: 'cadence', run: () => { Nexa.router.go('#/cadence'); setTimeout(() => Nexa.apps.cadence && Nexa.apps.cadence.newEvent(), 300); } },
      { label: 'Import a file (.docx .xlsx .pptx .csv)', icon: 'upload', run: () => Nexa.importFiles() },
      ...APPS.map((a) => ({ label: 'Open ' + a.name, icon: a.id, run: () => Nexa.router.go(a.route) })),
      { label: 'Invite people', icon: 'people', run: () => Nexa.router.go('#/people') },
    ];
    function render() {
      clear(results);
      let idx = 0;
      let lastGroup = null;
      for (const it of items) {
        if (it.group !== lastGroup) { results.append(h('div', { class: 'group' }, it.group)); lastGroup = it.group; }
        const i = idx++;
        results.append(h('div', { class: 'item' + (i === sel ? ' sel' : ''), onmouseenter: () => { sel = i; mark(); }, onclick: () => go(i) }, it.lead, h('div', { class: 'grow' }, h('div', { class: 'ellipsis' }, it.label), it.sub ? h('div', { class: 'muted small ellipsis' }, it.sub) : null)));
      }
      if (!items.length) results.append(h('div', { class: 'empty' }, input.value.length < 2 ? 'Type to search' : 'Nothing found'));
    }
    const mark = () => $$('.item', results).forEach((el, i) => el.classList.toggle('sel', i === sel));
    function go(i) { const it = items[i]; if (!it) return; close(); it.run(); }
    const search = Nexa.debounce(async () => {
      const q = input.value.trim();
      const lq = q.toLowerCase();
      const cmd = commands.filter((c) => !q || c.label.toLowerCase().includes(lq)).slice(0, q ? 5 : 8).map((c) => ({ group: 'Actions', label: c.label, lead: appById(c.icon) ? appIcon(c.icon, true) : h('span', { class: 'app-ico sm', style: { background: '#64748B' } }, icon(c.icon, 15)), run: c.run }));
      let found = [];
      if (q.length >= 2) {
        try {
          const r = await api.get('/api/search?q=' + encodeURIComponent(q));
          found = [
            ...r.files.map((f) => ({ group: 'Files', label: f.title, sub: f.snippet || timeAgo(f.updated_at), lead: fileIcon(f), run: () => { const u = fileRoute(f); if (u.startsWith('#')) Nexa.router.go(u); else open(u); } })),
            ...r.messages.map((m) => ({ group: 'Messages', label: m.body.slice(0, 120), sub: `#${m.channel} · ${m.user_name || 'Nexa'} · ${timeAgo(m.created_at)}`, lead: avatar({ id: m.user_name || 'x', name: m.user_name }, 'sm'), run: () => Nexa.router.go(`#/huddle/${m.channel_id}`) })),
            ...Nexa.state.users.filter((u) => (u.name + ' ' + u.email).toLowerCase().includes(lq)).slice(0, 5).map((u) => ({ group: 'People', label: u.name, sub: u.email, lead: avatar(u, 'sm'), run: () => Nexa.apps.huddle.dm(u.id) })),
          ];
        } catch { /* offline */ }
      }
      items = [...found, ...cmd]; sel = 0; render();
    }, 150);
    input.addEventListener('input', search);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); mark(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(); e.preventDefault(); }
      else if (e.key === 'Enter') { go(sel); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    });
    const scrim = h('div', { class: 'scrim', onmousedown: (e) => { if (e.target === scrim) close(); } }, h('div', { class: 'modal palette' }, input, results));
    const close = () => scrim.remove();
    document.body.append(scrim);
    input.focus(); search();
  }
  Nexa.palette = palette;
  addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && Nexa.state.user) { e.preventDefault(); palette(); } });

  // ---------- creating and importing ----------
  Nexa.newFile = async (kind, parent_id) => {
    const titles = { doc: 'Untitled document', sheet: 'Untitled spreadsheet', deck: 'Untitled presentation', folder: 'New folder' };
    try {
      const r = await api.post('/api/files', { kind, title: titles[kind], parent_id: parent_id || null });
      if (kind !== 'folder') Nexa.router.go(fileRoute(r.file));
      return r.file;
    } catch (e) { fail(e); }
  };
  Nexa.importFiles = async (parent, files) => {
    files = files || await Nexa.pickFile('.docx,.xlsx,.csv,.pptx,.html,.htm,.md,.txt', true);
    let last = null;
    for (const f of files) {
      try {
        const r = await api(`/api/import${parent ? '?parent=' + parent : ''}`, { method: 'POST', raw: f, headers: { 'x-filename': encodeURIComponent(f.name), 'content-type': 'application/octet-stream' } });
        last = r.file; toast(`Imported ${f.name}`);
      } catch (e) { fail(e); }
    }
    if (last && files.length === 1) Nexa.router.go(fileRoute(last));
    return last;
  };

  // ---------- home ----------
  async function home() {
    const view = shell(null);
    const u = Nexa.state.user;
    const hr = new Date().getHours();
    const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const recent = h('div', {}, h('div', { class: 'empty' }, 'Loading…'));
    const today = h('div', {}, h('div', { class: 'muted small' }, 'Loading…'));
    const chats = h('div', {});
    const wrap = h('div', { class: 'home' },
      (!standalone() && !sessionStorageGet('hide-install')) ? h('div', { class: 'install-banner' }, logo(34),
        h('div', { class: 'grow' }, h('b', {}, 'Put Nexa on your dock or home screen'), h('div', { class: 'muted small' }, 'It opens in its own window and works like a desktop app.')),
        h('button', { class: 'btn primary', onclick: install }, icon('install', 16), 'Install'),
        h('button', { class: 'btn ghost icon', 'aria-label': 'Hide', onclick: (e) => { sessionStorageSet('hide-install', '1'); e.currentTarget.parentElement.remove(); } }, icon('close', 16))) : null,
      h('div', { class: 'hello' },
        h('div', {}, h('div', { class: 'muted' }, fmtDate(Date.now(), { weekday: 'long', month: 'long' })), h('h1', {}, `${greet}, ${u.name.split(' ')[0]}`)),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => Nexa.importFiles() }, icon('upload', 16), 'Import'),
          h('button', { class: 'btn primary', onclick: (e) => menu(e.currentTarget, [
            { label: 'Document', icon: 'write', onClick: () => Nexa.newFile('doc') },
            { label: 'Spreadsheet', icon: 'grid', onClick: () => Nexa.newFile('sheet') },
            { label: 'Presentation', icon: 'deck', onClick: () => Nexa.newFile('deck') },
            '-',
            { label: 'Email', icon: 'relay', onClick: () => { Nexa.router.go('#/relay'); setTimeout(() => Nexa.apps.relay.compose(), 300); } },
            { label: 'Event', icon: 'cadence', onClick: () => { Nexa.router.go('#/cadence'); setTimeout(() => Nexa.apps.cadence.newEvent(), 300); } },
          ]) }, icon('plus', 16), 'New'))),
      h('nav', { class: 'launch' }, APPS.map((a) => h('a', { href: a.route }, appIcon(a.id), h('div', {}, h('b', {}, a.name), h('br'), h('span', {}, a.blurb)),
        a.id === 'relay' && unread.mail ? h('span', { class: 'badge' }, unread.mail) : null, a.id === 'huddle' && unread.chat ? h('span', { class: 'badge' }, unread.chat) : null))),
      h('div', { class: 'cards' },
        h('section', { class: 'card' }, h('h3', {}, icon('history', 16), 'Recent files', h('span', { class: 'grow' }), h('a', { href: '#/vault', class: 'small' }, 'All files')), recent),
        h('div', { class: 'col', style: { gap: '18px' } },
          h('section', { class: 'card' }, h('h3', {}, icon('cadence', 16), 'Today', h('span', { class: 'grow' }), h('a', { href: '#/cadence', class: 'small' }, 'Calendar')), today),
          h('section', { class: 'card' }, h('h3', {}, icon('huddle', 16), 'Conversations', h('span', { class: 'grow' }), h('a', { href: '#/huddle', class: 'small' }, 'Huddle')), chats),
          ['owner', 'admin'].includes(u.role) ? h('section', { class: 'card' }, h('h3', {}, icon('people', 16), 'Bring your team'),
            h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Anyone with your team link can make an account in seconds.'),
            h('a', { class: 'btn', href: '#/people' }, icon('link', 16), 'Get the team link')) : null)),
      h('footer', { class: 'home-foot muted small' }, `Astute Nexa ${Nexa.state.version || ''} · Free software under AGPL-3.0`,
        Nexa.state.sourceUrl ? [' · ', h('a', { href: Nexa.state.sourceUrl, target: '_blank', rel: 'noopener' }, 'Source code')] : null,
        Nexa.state.cloud ? [' · ', h('a', { href: '/w/' }, 'Switch workspace')] : null));
    view.append(wrap);
    try {
      const r = await api.get('/api/files?view=recent');
      clear(recent);
      if (!r.files.length) recent.append(h('div', { class: 'empty' }, 'Nothing yet. Create a document or import one you have.'));
      for (const f of r.files.slice(0, 10)) recent.append(h('a', { class: 'file-row', href: fileRoute(f), target: f.kind === 'upload' ? '_blank' : null }, fileIcon(f), h('div', { class: 'grow' }, h('div', { class: 'ellipsis' }, f.title), h('div', { class: 'muted small' }, `${f.owner_id === u.id ? 'You' : f.owner_name} · ${timeAgo(f.updated_at)}`))));
    } catch (e) { clear(recent).append(h('div', { class: 'empty' }, e.message)); }
    try {
      const s = new Date(); s.setHours(0, 0, 0, 0);
      const r = await api.get(`/api/events?from=${+s}&to=${+s + 86400000}`);
      clear(today);
      if (r.pending.length) today.append(h('a', { class: 'pill brand', href: '#/cadence', style: { marginBottom: '8px', textDecoration: 'none' } }, `${r.pending.length} invite${r.pending.length > 1 ? 's' : ''} waiting`));
      if (!r.events.length) today.append(h('div', { class: 'muted small' }, 'Nothing on your calendar today.'));
      for (const e of r.events) today.append(h('a', { class: 'file-row', href: '#/cadence' }, h('span', { style: { width: '4px', alignSelf: 'stretch', borderRadius: '4px', background: e.color || 'var(--cadence)' } }),
        h('div', { class: 'grow' }, h('div', { class: 'ellipsis' }, e.title), h('div', { class: 'muted small' }, e.all_day ? 'All day' : `${Nexa.fmtTime(e.start_at)} to ${Nexa.fmtTime(e.end_at)}`))));
    } catch { clear(today); }
    try {
      const r = await api.get('/api/channels');
      for (const c of r.channels.sort((a, b) => (b.last_at || 0) - (a.last_at || 0)).slice(0, 5)) {
        chats.append(h('a', { class: 'file-row', href: '#/huddle/' + c.id }, c.kind === 'dm' ? avatar(c.people[0], 'sm') : h('span', { class: 'app-ico sm', style: { background: 'var(--huddle)' } }, icon(c.kind === 'private' ? 'lock' : 'hash', 14)),
          h('span', { class: 'grow ellipsis' }, c.kind === 'dm' ? c.people.map((p) => p.name).join(', ') : c.name), c.unread ? h('span', { class: 'badge' }, c.unread) : null));
      }
    } catch { /* ignore */ }
  }
  const sessionStorageGet = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
  const sessionStorageSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } };

  // ---------- people & admin ----------
  async function people() {
    const view = shell(null);
    document.title = 'People · Astute Nexa';
    const me = Nexa.state.user;
    const admin = ['owner', 'admin'].includes(me.role);
    const list = h('div', {});
    const wrap = h('div', { class: 'people' }, h('div', { class: 'hello' }, h('h1', {}, 'People'),
      admin ? h('button', { class: 'btn primary', onclick: invite }, icon('plus', 16), 'Invite by email') : null));
    view.append(wrap);
    if (admin) {
      const s = await api.get('/api/settings').catch(() => null);
      if (s) {
        const link = location.origin + (Nexa.state.linkBase || '') + '/#/join/' + s.join_token;
        const linkInput = h('input', { class: 'input', readonly: true, value: link });
        const toggle = h('input', { type: 'checkbox', checked: s.join_enabled, disabled: me.role !== 'owner' });
        const domain = h('input', { class: 'input', placeholder: 'Any email (or type company.com)', value: s.join_domain, disabled: me.role !== 'owner' });
        toggle.addEventListener('change', async () => { try { await api.patch('/api/settings', { join_enabled: toggle.checked }); toast(toggle.checked ? 'Team link is on' : 'Team link is off'); } catch (e) { fail(e); toggle.checked = !toggle.checked; } });
        domain.addEventListener('change', async () => { try { await api.patch('/api/settings', { join_domain: domain.value }); toast('Saved'); } catch (e) { fail(e); } });
        wrap.append(h('section', { class: 'card', style: { marginBottom: '18px' } },
          h('h3', {}, icon('link', 16), 'Team link', h('span', { class: 'grow' }), h('label', { class: 'check small' }, toggle, 'On')),
          h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Share this link in an email or chat. Anyone who opens it can make a member account with their name, email and a password.'),
          h('div', { class: 'copy-box' }, linkInput, h('button', { class: 'btn', onclick: () => copyText(link) }, icon('copy', 16), 'Copy'),
            me.role === 'owner' ? h('button', { class: 'btn', title: 'Make a new link and turn off the old one', onclick: async () => {
              if (!(await confirmBox('Make a new team link?', 'The old link will stop working right away.', 'Make new link'))) return;
              await api.patch('/api/settings', { new_join_link: true }); people();
            } }, 'Reset') : null),
          h('label', { class: 'field', style: { marginTop: '12px' } }, 'Only allow emails at this domain', domain),
          h('p', { class: 'muted small', style: { marginBottom: 0 } }, `${s.users} active ${s.users === 1 ? 'person' : 'people'} · Plan: ${s.plan === 'free' ? 'Free' : s.plan}`, s.external_mail ? ' · Outside email is on' : ' · Outside email is off (mail stays inside the workspace)')));
      }
    }
    if (me.role === 'owner') {
      const pl = await api.get('/api/settings/links').catch(() => null);
      if (pl) {
        const t = h('input', { type: 'checkbox', checked: !!pl.public_links });
        t.addEventListener('change', async () => { try { await api.patch('/api/settings/links', { public_links: t.checked }); toast(t.checked ? 'Public links are on' : 'Public links are off, and existing ones stop working'); } catch (e) { fail(e); t.checked = !t.checked; } });
        wrap.append(h('section', { class: 'card', style: { marginBottom: '18px' } },
          h('h3', {}, icon('shield', 16), 'Public file links', h('span', { class: 'grow' }), h('label', { class: 'check small' }, t, 'On')),
          h('p', { class: 'muted small', style: { margin: 0 } }, 'Lets people share a Vault file or folder with anyone who has the link, no sign-in needed. Turn it off and every public link stops working right away.')));
      }
    }
    wrap.append(h('section', { class: 'card' }, h('h3', {}, icon('people', 16), 'Everyone'), list));
    const r = await api.get('/api/users');
    Nexa.state.users = r.users;
    for (const u of r.users) {
      const roleSel = admin && u.id !== me.id ? h('select', { class: 'select', style: { width: '120px' } }, ['owner', 'admin', 'member', 'guest'].map((x) => h('option', { value: x, selected: u.role === x }, x[0].toUpperCase() + x.slice(1)))) : h('span', { class: 'pill' }, u.role);
      if (roleSel.tagName === 'SELECT') roleSel.addEventListener('change', async () => { try { await api.patch('/api/users/' + u.id, { role: roleSel.value }); toast('Role updated'); } catch (e) { fail(e); roleSel.value = u.role; } });
      list.append(h('div', { class: 'person' }, avatar(u), h('div', { class: 'grow' }, h('b', {}, u.name, u.id === me.id ? ' (you)' : ''), h('div', { class: 'muted small' }, [u.title, u.email].filter(Boolean).join(' · '), u.status === 'disabled' ? ' · disabled' : '')),
        u.id !== me.id ? h('button', { class: 'btn sm', onclick: () => Nexa.apps.huddle.dm(u.id) }, icon('huddle', 14), 'Message') : null,
        roleSel,
        admin && u.id !== me.id ? h('button', { class: 'btn ghost icon sm', 'aria-label': 'More', onclick: (e) => menu(e.currentTarget, [
          { label: u.status === 'disabled' ? 'Turn account back on' : 'Turn off account', danger: u.status !== 'disabled', onClick: async () => {
            try { await api.patch('/api/users/' + u.id, { status: u.status === 'disabled' ? 'active' : 'disabled' }); people(); } catch (e2) { fail(e2); }
          } }]) }, icon('more', 16)) : null));
    }
    if (admin) {
      const box = h('div', { style: { maxHeight: '320px', overflow: 'auto' } });
      wrap.append(h('section', { class: 'card', style: { marginTop: '18px' } }, h('h3', {}, icon('shield', 16), 'Activity log'), box));
      const a = await api.get('/api/audit').catch(() => ({ events: [] }));
      for (const ev of a.events.slice(0, 100)) box.append(h('div', { class: 'audit-row' }, h('span', { class: 'muted' }, new Date(ev.at).toLocaleString()), h('span', {}, ev.user_name || 'System'), h('span', { class: 'ellipsis' }, ev.action.replace(/[._]/g, ' '), ev.target ? h('span', { class: 'muted' }, ' · ' + ev.target) : null)));
    }
  }
  function invite() {
    const email = h('input', { class: 'input', type: 'email', required: true, placeholder: 'name@company.com' });
    const role = h('select', { class: 'select' }, h('option', { value: 'member' }, 'Member: full access to team chat and shared files'), h('option', { value: 'guest' }, 'Guest: only what is shared with them'), Nexa.state.user.role === 'owner' ? h('option', { value: 'admin' }, 'Admin: can manage people') : null);
    modal({ title: 'Invite someone', body: [h('label', { class: 'field' }, 'Email', email), h('label', { class: 'field' }, 'Role', role)],
      actions: [{ label: 'Cancel' }, { label: 'Create invite link', kind: 'primary', submit: true, onClick: async () => {
        try {
          const r = await api.post('/api/invites', { email: email.value, role: role.value });
          const link = location.origin + r.path;
          modal({ title: 'Invite link ready', body: [h('p', { style: { margin: 0 } }, `Send this link to ${email.value}. It works once and expires in ${r.expiresInDays} days.`),
            h('div', { class: 'copy-box' }, h('input', { class: 'input', readonly: true, value: link }), h('button', { class: 'btn', type: 'button', onclick: () => copyText(link) }, icon('copy', 16), 'Copy'))],
            actions: [{ label: 'Done', kind: 'primary' }] });
        } catch (e) { fail(e); return false; }
      } }] });
  }

  Object.assign(Nexa, { shell, home, people });
})();
