/* Shared editor chrome: title, autosave with conflict checks, sharing, versions, export, presence. */
'use strict';
(function () {
  const { h, $, clear, icon, api, toast, fail, modal, menu, avatar, timeAgo, download, confirmBox } = Nexa;

  // Opens a file and builds the header. `getContent` returns the current content; `onRemote` reloads.
  async function openEditor({ id, appId, exportFormats, build }) {
    const view = Nexa.shell(appId);
    view.className = 'view';
    let data;
    try { data = await api.get('/api/files/' + id); } catch (e) { view.append(h('div', { class: 'empty' }, e.message, h('br'), h('a', { href: '#/vault' }, 'Back to Vault'))); return null; }
    const file = data.file;
    const canEdit = ['owner', 'edit'].includes(file.perm);
    let version = file.version, dirty = false, saving = false, getContent = () => null, conflict = false;
    const state = h('span', { class: 'save-state' }, canEdit ? 'Saved' : 'View only');
    const presence = h('div', { class: 'presence' });
    const banner = h('div', { class: 'banner hidden' });
    const title = h('input', { class: 'ed-title', value: file.title, 'aria-label': 'Title', readOnly: !canEdit });
    title.addEventListener('change', async () => { try { await api.patch('/api/files/' + id, { title: title.value }); file.title = title.value; document.title = title.value + ' · Nexa'; } catch (e) { fail(e); } });
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.blur(); });

    async function save() {
      if (!canEdit || !dirty || saving || conflict) return;
      saving = true; dirty = false; state.textContent = 'Saving…';
      try {
        const r = await api.put('/api/files/' + id, { content: getContent(), baseVersion: version });
        version = r.version; state.textContent = 'Saved ' + Nexa.fmtTime(Date.now());
      } catch (e) {
        if (e.status === 409) {
          conflict = true; state.textContent = 'Not saved';
          showBanner(e.message, [{ label: 'Load their version', kind: 'primary', onClick: () => location.reload() },
            { label: 'Keep mine and overwrite', onClick: async () => { conflict = false; version = e.data.version; dirty = true; hideBanner(); await save(); } }]);
        } else { dirty = true; state.textContent = 'Offline, will retry'; setTimeout(save, 4000); }
      } finally { saving = false; if (dirty && !conflict) queue(); }
    }
    const queue = Nexa.debounce(save, 900);
    const changed = () => { if (!canEdit) return; dirty = true; state.textContent = 'Editing…'; queue(); };
    function showBanner(msg, acts = []) { clear(banner).classList.remove('hidden'); banner.append(icon('bell', 16), h('span', { class: 'grow' }, msg), acts.map((a) => h('button', { class: 'btn sm ' + (a.kind || ''), onclick: a.onClick }, a.label))); }
    const hideBanner = () => banner.classList.add('hidden');

    const offSaved = Nexa.rt.on('file.saved', (m) => {
      if (m.id !== id || m.by === Nexa.state.user.id || m.version <= version) return;
      if (!dirty) showBanner(`${m.byName} saved changes.`, [{ label: 'Show them', kind: 'primary', onClick: () => Nexa.router.resolve() }]);
      else showBanner(`${m.byName} saved changes while you were editing. Your next save will ask what to keep.`);
    });
    const offPres = Nexa.rt.on('file.presence', (m) => {
      if (m.id !== id) return;
      clear(presence);
      for (const p of m.people.filter((p) => p.id !== Nexa.state.user.id)) presence.append(avatar(p, 'sm'));
    });
    Nexa.rt.watch(id);

    const head = h('div', { class: 'ed-head' },
      h('a', { class: 'btn ghost icon', href: file.parent_id ? '#/vault/' + file.parent_id : '#/vault?kind=' + file.kind, 'aria-label': 'Back' }, icon('chevL')),
      Nexa.appIcon(appId, true), title,
      h('button', { class: 'btn ghost icon sm', title: file.starred ? 'Starred' : 'Star', disabled: file.perm !== 'owner', onclick: async (e) => {
        file.starred = !file.starred; e.currentTarget.style.color = file.starred ? 'var(--warn)' : ''; await api.patch('/api/files/' + id, { starred: file.starred }).catch(fail);
      }, style: { color: file.starred ? 'var(--warn)' : '' } }, icon('star', 16)),
      state, h('span', { class: 'grow' }), presence,
      h('button', { class: 'btn ghost sm', onclick: () => versions() }, icon('history', 16), 'History'),
      h('button', { class: 'btn ghost sm', onclick: (e) => menu(e.currentTarget, [
        { label: 'Download as', header: true },
        ...exportFormats.map((f) => ({ label: f.label, icon: 'download', onClick: async () => { await save(); download(`/api/files/${id}/export?format=${f.fmt}`); } })),
        { label: 'Nexa backup (.json)', icon: 'download', onClick: () => download(`/api/files/${id}/export?format=json`) },
        '-', { label: 'Print or save PDF', icon: 'print', onClick: () => print() },
      ]) }, icon('download', 16), 'Export'),
      file.perm === 'owner' ? h('button', { class: 'btn primary sm', onclick: () => shareDialog(file) }, icon('share', 16), 'Share') : h('span', { class: 'pill' }, file.perm === 'edit' ? 'Can edit' : 'View only'));

    async function versions() {
      const r = await api.get(`/api/files/${id}/versions`);
      modal({ title: 'Version history', body: r.versions.length ? r.versions.map((v) => h('div', { class: 'person' },
        h('div', { class: 'grow' }, h('b', {}, 'Version ' + v.version), h('div', { class: 'muted small' }, `${new Date(v.created_at).toLocaleString()} · ${v.by || 'Someone'}`)),
        canEdit ? h('button', { class: 'btn sm', type: 'button', onclick: async () => {
          if (!(await confirmBox('Restore this version?', 'The current version stays in history, so you can come back to it.', 'Restore'))) return;
          await save(); await api.post(`/api/files/${id}/versions/${v.version}/restore`); $$('.scrim').forEach((s) => s.remove()); Nexa.router.resolve(); toast('Version restored');
        } }, 'Restore') : null)) : h('p', { class: 'muted' }, 'Older versions appear here as you edit.'), actions: [{ label: 'Close' }] });
    }
    const $$ = Nexa.$$;

    const body = h('div', { class: 'editor' }, head, banner);
    view.append(body);
    document.title = file.title + ' · Nexa';
    const api2 = await build({ body, file, content: data.content, canEdit, changed, showBanner, hideBanner });
    getContent = api2.getContent;
    return {
      dirty: () => dirty || saving,
      leave: async () => { if (dirty) await save(); Nexa.rt.unwatch(id); offSaved(); offPres(); api2.destroy && api2.destroy(); },
    };
  }

  async function shareDialog(file) {
    const r = await api.get(`/api/files/${file.id}/shares`);
    if (!Nexa.state.users.length) Nexa.state.users = (await api.get('/api/users')).users;
    let shares = r.shares.map((s) => ({ user_id: s.user_id, perm: s.perm }));
    const ws = h('select', { class: 'select' }, h('option', { value: 'none' }, 'Only people added below'), h('option', { value: 'view' }, 'Everyone in the workspace can view'), h('option', { value: 'edit' }, 'Everyone in the workspace can edit'));
    ws.value = r.workspace_perm || 'none';
    const list = h('div', {});
    const pick = h('select', { class: 'select grow' }, h('option', { value: '' }, 'Add a person…'));
    const draw = () => {
      clear(list); clear(pick).append(h('option', { value: '' }, 'Add a person…'));
      for (const u of Nexa.state.users) if (u.id !== file.owner_id && !shares.find((s) => s.user_id === u.id)) pick.append(h('option', { value: u.id }, `${u.name} (${u.email})`));
      if (!shares.length) list.append(h('div', { class: 'muted small' }, 'No one added yet.'));
      for (const s of shares) {
        const u = Nexa.userById(s.user_id) || { id: s.user_id, name: 'Unknown' };
        const sel = h('select', { class: 'select', style: { width: '110px' } }, h('option', { value: 'view' }, 'Can view'), h('option', { value: 'edit' }, 'Can edit'));
        sel.value = s.perm; sel.addEventListener('change', () => { s.perm = sel.value; });
        list.append(h('div', { class: 'person' }, avatar(u, 'sm'), h('div', { class: 'grow' }, u.name, h('div', { class: 'muted small' }, u.email)), sel,
          h('button', { class: 'btn ghost icon sm', type: 'button', 'aria-label': 'Remove', onclick: () => { shares = shares.filter((x) => x !== s); draw(); } }, icon('close', 14))));
      }
    };
    pick.addEventListener('change', () => { if (pick.value) { shares.push({ user_id: pick.value, perm: 'edit' }); draw(); } });
    draw();
    modal({ title: `Share “${file.title}”`, body: [h('label', { class: 'field' }, 'Workspace access', ws), h('div', { class: 'row' }, pick), list,
      h('p', { class: 'muted small', style: { margin: 0 } }, 'Guests never get workspace-wide access, only what you add here.')],
    actions: [{ label: 'Cancel' }, { label: 'Save sharing', kind: 'primary', onClick: async () => {
      try { await api.patch('/api/files/' + file.id, { workspace_perm: ws.value }); await api.put(`/api/files/${file.id}/shares`, { shares }); toast('Sharing saved'); } catch (e) { fail(e); return false; }
    } }] });
  }

  Nexa.openEditor = openEditor;
  Nexa.shareDialog = shareDialog;
})();
