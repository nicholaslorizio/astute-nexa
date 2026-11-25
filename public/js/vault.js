/* Vault: files and folders like OneDrive. Upload, drag and drop, share links, history, trash and sync to computers and phones. */
'use strict';
(function () {
  const { h, $, $$, clear, icon, api, toast, fail, modal, menu, fileIcon, fileRoute, fmtSize, timeAgo, confirmBox, promptBox, download, pickFile, copyText, avatar } = Nexa;
  const TABS = [
    { id: 'mine', name: 'My files', icon: 'vault' }, { id: 'recent', name: 'Recent', icon: 'history' }, { id: 'shared', name: 'Shared with me', icon: 'people' },
    { id: 'starred', name: 'Starred', icon: 'star' }, { id: 'trash', name: 'Trash', icon: 'trash' },
  ];
  const KIND_NAME = { doc: 'Write document', sheet: 'Grid spreadsheet', deck: 'Deck presentation', folder: 'Folder', upload: 'File' };
  const OFFICE = /\.(docx|xlsx|pptx|csv)$/i;
  let V = null;

  // ---------- uploads with progress ----------
  const tray = () => $('.up-tray') || document.body.appendChild(h('div', { class: 'up-tray card', style: { position: 'fixed', right: '18px', bottom: '18px', width: '320px', zIndex: 90, padding: '12px', maxHeight: '50vh', overflow: 'auto', boxShadow: 'var(--shadow-l)' } }));
  function xhrUpload(url, file, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const t = tray();
      const bar = h('div', { style: { height: '4px', background: 'var(--bg-3)', borderRadius: '4px', overflow: 'hidden', marginTop: '4px' } }, h('div', { style: { height: '100%', width: '0%', background: 'var(--vault)', transition: 'width .2s' } }));
      const row = h('div', { style: { marginBottom: '8px' } }, h('div', { class: 'small ellipsis' }, file.name, h('span', { class: 'muted' }, ' · ' + fmtSize(file.size))), bar);
      t.append(row);
      const x = new XMLHttpRequest();
      x.open(url.includes('/blob') ? 'PUT' : 'POST', url);
      x.setRequestHeader('x-nexa-csrf', '1');
      x.setRequestHeader('x-filename', encodeURIComponent(file.name));
      x.setRequestHeader('content-type', 'application/octet-stream');
      for (const [k, v] of Object.entries(extraHeaders)) x.setRequestHeader(k, v);
      x.upload.onprogress = (e) => { if (e.lengthComputable) bar.firstChild.style.width = (e.loaded / e.total * 100) + '%'; };
      const done = () => { row.remove(); if (!t.children.length) t.remove(); };
      x.onload = () => {
        done();
        let d = {}; try { d = JSON.parse(x.responseText); } catch { /* not json */ }
        if (x.status >= 200 && x.status < 300) resolve(d.file); else reject(new Error(d.error || (x.status === 413 ? 'That file is too big.' : `Upload failed (${x.status}).`)));
      };
      x.onerror = () => { done(); reject(new Error('Upload failed. Check your connection.')); };
      x.send(file);
    });
  }
  Nexa.vaultUpload = async (file, parent) => {
    try { return await xhrUpload('/api/upload' + (parent ? '?parent=' + parent : ''), file); } catch (e) { toast(`${file.name}: ${e.message}`, 'bad'); return null; }
  };
  // Upload a dropped or picked set of files, recreating any folders inside it.
  async function uploadEntries(items, parent) {
    let n = 0;
    const folderCache = new Map();
    async function folderFor(path) {
      if (!path) return parent;
      if (folderCache.has(path)) return folderCache.get(path);
      const parts = path.split('/'); const name = parts.pop();
      const up = await folderFor(parts.join('/'));
      const r = await api.post('/api/files', { kind: 'folder', title: name, parent_id: up || null });
      folderCache.set(path, r.file.id);
      return r.file.id;
    }
    for (const { file, path } of items) {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      try { const p = await folderFor(dir); if (await Nexa.vaultUpload(file, p)) n++; } catch (e) { fail(e); }
    }
    if (n) toast(`Uploaded ${n} file${n === 1 ? '' : 's'}`);
    if (V) load();
  }
  async function readDrop(dt) {
    const out = [];
    const walk = (entry, path) => new Promise((res) => {
      if (entry.isFile) entry.file((f) => { out.push({ file: f, path: path + f.name }); res(); }, () => res());
      else if (entry.isDirectory) {
        const reader = entry.createReader(); const all = [];
        const more = () => reader.readEntries(async (ents) => { if (ents.length) { all.push(...ents); more(); } else { for (const e of all) await walk(e, path + entry.name + '/'); res(); } }, () => res());
        more();
      } else res();
    });
    const entries = [...dt.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (entries.length) { for (const e of entries) await walk(e, ''); return out; }
    return [...dt.files].map((f) => ({ file: f, path: f.name }));
  }

  // ---------- main view ----------
  async function open({ id, qs }) {
    const view = Nexa.shell('vault');
    const p = new URLSearchParams(qs || '');
    V = { folder: id || null, tab: id ? 'mine' : (p.get('view') || 'mine'), kind: p.get('kind') || '', q: '', sel: new Set(), view, files: [] };
    const root = h('div', { class: 'vault drop-zone' });
    view.append(root);
    V.root = root;
    root.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); root.classList.add('over'); } });
    root.addEventListener('dragleave', (e) => { if (e.target === root) root.classList.remove('over'); });
    root.addEventListener('drop', async (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault(); root.classList.remove('over');
      if (V.tab !== 'mine') { V.tab = 'mine'; }
      uploadEntries(await readDrop(e.dataTransfer), V.folder);
    });
    await load();
    const off = Nexa.rt.on('file.saved', () => V && load());
    return { leave: () => { off(); V = null; } };
  }

  async function load() {
    let r, crumbs = [];
    try {
      if (V.folder) {
        const [list, me] = await Promise.all([api.get('/api/files?parent=' + V.folder), api.get('/api/files/' + V.folder)]);
        r = list; crumbs = [...(me.file.crumbs || []), { id: me.file.id, title: me.file.title }]; V.current = me.file;
      } else { r = await api.get(`/api/files?view=${V.tab}${V.kind ? '&kind=' + V.kind : ''}`); V.current = null; }
    } catch (e) { clear(V.root).append(h('div', { class: 'empty' }, e.message, h('a', { href: '#/vault' }, 'Back to My files'))); return; }
    if (!V) return;
    V.files = r.files; V.sel.clear();
    draw(crumbs);
    storage();
  }

  function draw(crumbs) {
    const canAdd = V.tab === 'mine' && (!V.current || ['owner', 'edit'].includes(V.current.perm));
    const search = h('input', { class: 'input', placeholder: 'Filter this list', value: V.q, style: { width: '220px' }, 'aria-label': 'Filter files' });
    search.addEventListener('input', () => { V.q = search.value; drawTable(); });
    const crumbBar = h('div', { class: 'crumbs' }, h('a', { href: '#/vault' }, V.folder ? 'My files' : TABS.find((t) => t.id === V.tab).name),
      crumbs.map((c) => [icon('chevR', 16), h('a', { href: '#/vault/' + c.id, ondragover: (e) => e.preventDefault(), ondrop: (e) => dropMove(e, c.id) }, c.title)]));
    const newMenu = (e) => menu(e.currentTarget, [
      { label: 'Folder', icon: 'folder', onClick: newFolder },
      { label: 'Write document', icon: 'write', onClick: () => Nexa.newFile('doc', V.folder) },
      { label: 'Grid spreadsheet', icon: 'grid', onClick: () => Nexa.newFile('sheet', V.folder) },
      { label: 'Deck presentation', icon: 'deck', onClick: () => Nexa.newFile('deck', V.folder) },
      '-',
      { label: 'Upload files', icon: 'upload', onClick: async () => { const fs = await pickFile('', true); uploadEntries(fs.map((f) => ({ file: f, path: f.name })), V.folder); } },
      { label: 'Upload a folder', icon: 'folder', onClick: pickFolder },
      { label: 'Import Office files to edit', icon: 'upload', onClick: async () => { await Nexa.importFiles(V.folder); load(); } },
    ]);
    const tabs = h('div', { class: 'v-tabs' }, TABS.map((t) => h('a', { class: 'btn sm' + (!V.folder && V.tab === t.id ? ' primary' : ' ghost'), href: '#/vault' + (t.id === 'mine' ? '' : '?view=' + t.id) }, icon(t.icon, 14), t.name)),
      h('span', { class: 'grow' }),
      V.kind ? h('a', { class: 'pill brand', href: '#/vault', style: { textDecoration: 'none' } }, `Only ${KIND_NAME[V.kind].toLowerCase()}s`, icon('close', 12)) : null);
    V.table = h('div', {});
    V.bulk = h('div', { class: 'row hidden', style: { margin: '0 0 10px', padding: '8px 12px', background: 'var(--brand-soft)', borderRadius: '12px' } });
    V.meter = h('div', { class: 'small muted', style: { minWidth: '180px' } });
    clear(V.root).append(
      h('div', { class: 'v-head' }, crumbBar, h('span', { class: 'grow' }), search,
        h('button', { class: 'btn', onclick: syncDialog, title: 'Sync Vault to your computer or phone' }, icon('install', 16), 'Sync'),
        V.folder && V.current && V.current.perm === 'owner' ? h('button', { class: 'btn', onclick: () => shareMenu(V.current) }, icon('share', 16), 'Share folder') : null,
        canAdd ? h('button', { class: 'btn primary', onclick: newMenu }, icon('plus', 16), 'New') : null),
      tabs, V.bulk, V.table,
      h('div', { class: 'row', style: { marginTop: '14px' } }, V.meter, h('span', { class: 'grow' }),
        V.tab === 'trash' && V.files.length ? h('button', { class: 'btn danger sm', onclick: emptyTrash }, icon('trash', 14), 'Empty trash') : null,
        canAdd ? h('span', { class: 'muted small' }, 'Drop files or whole folders anywhere on this page to upload.') : null));
    drawTable();
  }

  function drawTable() {
    const q = V.q.trim().toLowerCase();
    const rows = V.files.filter((f) => !q || f.title.toLowerCase().includes(q));
    if (!rows.length) {
      clear(V.table).append(h('div', { class: 'empty card', style: { padding: '50px 20px' } }, Nexa.appIcon('vault'),
        q ? 'Nothing matches that filter.' : V.tab === 'trash' ? 'Trash is empty.' : V.tab === 'shared' ? 'Files people share with you show up here.' : V.tab === 'starred' ? 'Star files to find them fast.' : 'This folder is empty. Drop files here or press New.'));
      return drawBulk();
    }
    const all = h('input', { type: 'checkbox', 'aria-label': 'Select all', onchange: (e) => { rows.forEach((f) => (e.target.checked ? V.sel.add(f.id) : V.sel.delete(f.id))); drawTable(); } });
    all.checked = rows.every((f) => V.sel.has(f.id));
    const tbody = h('tbody', {});
    for (const f of rows) {
      const cb = h('input', { type: 'checkbox', 'aria-label': 'Select ' + f.title, checked: V.sel.has(f.id), onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? V.sel.add(f.id) : V.sel.delete(f.id); drawBulk(); } });
      const tr = h('tr', { draggable: f.perm === 'owner' && V.tab === 'mine', tabindex: 0,
        ondragstart: (e) => { e.dataTransfer.setData('text/nexa-files', JSON.stringify(V.sel.has(f.id) ? [...V.sel] : [f.id])); },
        ondragover: (e) => { if (f.kind === 'folder' && [...e.dataTransfer.types].includes('text/nexa-files')) { e.preventDefault(); tr.style.outline = '2px solid var(--vault)'; } },
        ondragleave: () => { tr.style.outline = ''; },
        ondrop: (e) => { tr.style.outline = ''; dropMove(e, f.id); },
        onclick: () => openFile(f), onkeydown: (e) => { if (e.key === 'Enter') openFile(f); },
        oncontextmenu: (e) => { e.preventDefault(); fileMenu(e, f); } },
      h('td', { style: { width: '34px' } }, cb),
      h('td', {}, h('div', { class: 'row', style: { gap: '10px' } }, fileIcon(f), h('div', { style: { minWidth: 0 } },
        h('div', { class: 'ellipsis', style: { fontWeight: 550 } }, f.title, f.starred ? h('span', { style: { color: 'var(--warn)', marginLeft: '6px' } }, icon('star', 12)) : null),
        h('div', { class: 'muted small' }, KIND_NAME[f.kind] + (f.workspace_perm !== 'none' ? ' · shared with the team' : ''))))),
      h('td', { class: 'muted small' }, f.owner_id === Nexa.state.user.id ? 'You' : f.owner_name),
      h('td', { class: 'muted small', title: new Date(f.updated_at).toLocaleString() }, timeAgo(f.updated_at)),
      h('td', { class: 'muted small' }, f.kind === 'folder' ? '' : fmtSize(f.size || 0)),
      h('td', { style: { width: '44px' } }, h('button', { class: 'btn ghost icon sm', 'aria-label': 'Actions for ' + f.title, onclick: (e) => { e.stopPropagation(); fileMenu(e.currentTarget, f); } }, icon('more', 16))));
      tbody.append(tr);
    }
    clear(V.table).append(h('table', { class: 'v-table' }, h('thead', {}, h('tr', {}, h('th', {}, all), h('th', {}, 'Name'), h('th', {}, 'Owner'), h('th', {}, 'Modified'), h('th', {}, 'Size'), h('th'))), tbody));
    drawBulk();
  }
  function drawBulk() {
    const n = V.sel.size;
    V.bulk.classList.toggle('hidden', !n);
    if (!n) return;
    const ids = [...V.sel]; const sel = V.files.filter((f) => V.sel.has(f.id));
    const mine = sel.every((f) => f.perm === 'owner');
    clear(V.bulk).append(h('b', {}, `${n} selected`), h('span', { class: 'grow' }),
      V.tab === 'trash' ? [h('button', { class: 'btn sm', onclick: () => bulk(ids, { trashed: false }, 'Restored') }, 'Restore'),
        h('button', { class: 'btn danger sm', onclick: async () => { if (await confirmBox(`Delete ${n} item${n > 1 ? 's' : ''} forever?`, 'This cannot be undone.', 'Delete forever', true)) { for (const id of ids) await api.del('/api/files/' + id).catch(fail); load(); } } }, 'Delete forever')]
        : [sel.filter((f) => f.kind === 'upload').length ? h('button', { class: 'btn sm', onclick: () => sel.filter((f) => f.kind === 'upload').forEach((f, i) => setTimeout(() => download(`/api/files/${f.id}/raw`), i * 400)) }, icon('download', 14), 'Download') : null,
          mine ? h('button', { class: 'btn sm', onclick: () => moveDialog(ids) }, icon('folder', 14), 'Move') : null,
          mine ? h('button', { class: 'btn sm', onclick: () => bulk(ids, { trashed: true }, 'Moved to Trash') }, icon('trash', 14), 'Delete') : null],
      h('button', { class: 'btn ghost sm', onclick: () => { V.sel.clear(); drawTable(); } }, 'Clear'));
  }
  async function bulk(ids, patch, msg) { for (const id of ids) await api.patch('/api/files/' + id, patch).catch(fail); toast(msg); load(); }
  async function dropMove(e, folderId) {
    const data = e.dataTransfer.getData('text/nexa-files');
    if (!data) return;
    e.preventDefault(); e.stopPropagation();
    const ids = JSON.parse(data).filter((x) => x !== folderId);
    for (const id of ids) await api.patch('/api/files/' + id, { parent_id: folderId }).catch(fail);
    toast(`Moved ${ids.length} item${ids.length === 1 ? '' : 's'}`); load();
  }
  async function storage() {
    try {
      const s = await api.get('/api/storage');
      const pct = s.quota ? Math.min(100, s.used / s.quota * 100) : Math.min(100, s.used / (5 * 1024 ** 3) * 100);
      clear(V.meter).append(h('div', {}, s.quota ? `${fmtSize(s.used)} of ${fmtSize(s.quota)} used` : `${fmtSize(s.used)} used`, s.trash ? ` · ${fmtSize(s.trash)} in Trash` : ''),
        h('div', { style: { height: '6px', borderRadius: '6px', background: 'var(--bg-3)', marginTop: '4px', overflow: 'hidden', width: '200px' } }, h('div', { style: { width: Math.max(2, pct) + '%', height: '100%', background: pct > 90 ? 'var(--bad)' : 'var(--vault)' } })));
    } catch { /* the meter is optional */ }
  }

  function openFile(f) {
    if (V.tab === 'trash') return fileMenu(null, f);
    if (f.kind === 'folder') return Nexa.router.go('#/vault/' + f.id);
    if (f.kind === 'upload') return preview(f);
    Nexa.router.go(fileRoute(f));
  }
  function preview(f) {
    const src = `/api/files/${f.id}/raw?inline=1`;
    const m = f.mime || '';
    const body = /^image\/(png|jpeg|gif|webp)$/.test(m) ? h('img', { src, alt: f.title, style: { maxWidth: '100%', maxHeight: '65vh', borderRadius: '10px', display: 'block', margin: '0 auto' } })
      : m === 'video/mp4' ? h('video', { src, controls: true, style: { width: '100%', borderRadius: '10px' } })
        : m === 'audio/mpeg' ? h('audio', { src, controls: true, style: { width: '100%' } })
          : h('div', { class: 'empty', style: { padding: '30px' } }, fileIcon(f, false), h('b', {}, f.title), h('span', { class: 'muted' }, `${fmtSize(f.size)} · ${m || 'file'}`),
            m === 'application/pdf' ? h('a', { class: 'btn', href: src, target: '_blank', rel: 'noopener' }, 'Open PDF in a new tab') : null);
    modal({ title: f.title, wide: true, body: [body, OFFICE.test(f.title) ? h('p', { class: 'muted small', style: { margin: 0 } }, 'Want to edit this in Nexa? "Edit a copy" turns it into a Write, Grid or Deck file and keeps the original here.') : null],
      actions: [
        OFFICE.test(f.title) && f.title.match(/\.(docx|xlsx|pptx|csv)$/i) ? { label: 'Edit a copy in Nexa', onClick: () => editCopy(f) } : null,
        { label: 'History', onClick: () => history(f) },
        { label: 'Download', kind: 'primary', onClick: () => { download(`/api/files/${f.id}/raw`); return false; } },
      ].filter(Boolean) });
  }
  async function editCopy(f) {
    try {
      const blob = await (await fetch(`/api/files/${f.id}/raw`, { credentials: 'same-origin' })).blob();
      const file = new File([blob], f.title);
      await Nexa.importFiles(f.parent_id, [file]);
    } catch (e) { fail(e); }
  }

  function fileMenu(anchor, f) {
    const own = f.perm === 'owner', edit = own || f.perm === 'edit';
    if (V.tab === 'trash') return menu(anchor || document.body, [
      { label: 'Restore', icon: 'undo', onClick: () => bulk([f.id], { trashed: false }, 'Restored') },
      { label: 'Delete forever', icon: 'trash', danger: true, onClick: async () => { if (await confirmBox('Delete forever?', `“${f.title}” will be gone for good.`, 'Delete forever', true)) { await api.del('/api/files/' + f.id).catch(fail); load(); } } },
    ]);
    menu(anchor, [
      { label: f.kind === 'folder' ? 'Open' : f.kind === 'upload' ? 'Preview' : 'Open in ' + Nexa.appById(Nexa.KIND_APP[f.kind]).name, icon: 'file', onClick: () => openFile(f) },
      f.kind === 'upload' && { label: 'Download', icon: 'download', onClick: () => download(`/api/files/${f.id}/raw`) },
      Nexa.KIND_APP[f.kind] !== 'vault' && { label: 'Download as Office file', icon: 'download', onClick: () => download(`/api/files/${f.id}/export?format=${{ doc: 'docx', sheet: 'xlsx', deck: 'pptx' }[f.kind]}`) },
      own && { label: 'Share with people', icon: 'share', onClick: () => Nexa.shareDialog(f).then(load) },
      own && { label: 'Get a public link', icon: 'link', onClick: () => linkDialog(f) },
      '-',
      edit && { label: 'Rename', icon: 'edit', onClick: async () => { const t = await promptBox('Rename', 'Name', f.title); if (t && t !== f.title) { await api.patch('/api/files/' + f.id, { title: t }).catch(fail); load(); } } },
      own && { label: 'Move to…', icon: 'folder', onClick: () => moveDialog([f.id]) },
      f.kind !== 'folder' && { label: 'Version history', icon: 'history', onClick: () => history(f) },
      f.kind === 'upload' && edit && { label: 'Upload a new version', icon: 'upload', onClick: () => replace(f) },
      own && { label: f.starred ? 'Unstar' : 'Star', icon: 'star', onClick: async () => { await api.patch('/api/files/' + f.id, { starred: !f.starred }).catch(fail); load(); } },
      { label: 'Copy link for teammates', icon: 'copy', onClick: () => copyText(location.origin + (Nexa.state.linkBase || '') + '/' + (f.kind === 'upload' ? '#/vault/' + (f.parent_id || '') : fileRoute(f))) },
      own && '-',
      own && { label: 'Delete', icon: 'trash', danger: true, onClick: () => bulk([f.id], { trashed: true }, 'Moved to Trash. You can restore it from Trash.') },
    ]);
  }
  function shareMenu(f) { menu(document.activeElement, [{ label: 'Share with people', icon: 'share', onClick: () => Nexa.shareDialog(f) }, { label: 'Get a public link', icon: 'link', onClick: () => linkDialog(f) }]); }

  async function newFolder() {
    const t = await promptBox('New folder', 'Folder name', 'New folder', 'Create');
    if (!t) return;
    try { await api.post('/api/files', { kind: 'folder', title: t, parent_id: V.folder }); load(); } catch (e) { fail(e); }
  }
  function pickFolder() {
    const i = h('input', { type: 'file', multiple: true, webkitdirectory: true, style: { display: 'none' } });
    i.addEventListener('change', () => { uploadEntries([...i.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })), V.folder); i.remove(); });
    document.body.append(i); i.click();
  }
  async function replace(f) {
    const [file] = await pickFile('');
    if (!file) return;
    try { await xhrUpload(`/api/files/${f.id}/blob`, file, { 'x-mime': file.type || '' }); toast('New version saved. The old one is in Version history.'); load(); } catch (e) { fail(e); }
  }
  async function emptyTrash() {
    if (!(await confirmBox('Empty the trash?', `${V.files.length} item${V.files.length === 1 ? '' : 's'} will be deleted for good.`, 'Empty trash', true))) return;
    try { const r = await api.post('/api/files/trash/empty'); toast(`Deleted ${r.deleted} item${r.deleted === 1 ? '' : 's'}`); load(); } catch (e) { fail(e); }
  }

  async function history(f) {
    let r;
    try { r = await api.get(`/api/files/${f.id}/versions`); } catch (e) { return fail(e); }
    const edit = ['owner', 'edit'].includes(f.perm);
    modal({ title: 'Version history', body: [h('div', { class: 'person' }, h('div', { class: 'grow' }, h('b', {}, 'Current version'), h('div', { class: 'muted small' }, `Version ${r.current} · ${new Date(f.updated_at).toLocaleString()}`))),
      r.versions.length ? r.versions.map((v) => h('div', { class: 'person' },
        h('div', { class: 'grow' }, h('b', {}, 'Version ' + v.version), h('div', { class: 'muted small' }, `${new Date(v.created_at).toLocaleString()} · ${v.by || 'Someone'}${v.size ? ' · ' + fmtSize(v.size) : ''}`)),
        f.kind === 'upload' ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => download(`/api/files/${f.id}/versions/${v.version}/raw`) }, 'Download') : null,
        edit ? h('button', { class: 'btn sm', type: 'button', onclick: async () => {
          if (!(await confirmBox('Restore this version?', 'The current version is kept in history too.', 'Restore'))) return;
          try { await api.post(`/api/files/${f.id}/versions/${v.version}/restore`); $$('.scrim').forEach((s) => s.remove()); toast('Version restored'); if (V) load(); } catch (e) { fail(e); }
        } }, 'Restore') : null)) : h('p', { class: 'muted' }, f.kind === 'upload' ? 'Upload a new version and the old one is kept here.' : 'Older versions appear here as you edit.')],
    actions: [{ label: 'Close' }] });
  }

  async function moveDialog(ids) {
    let at = null; const trail = [{ id: null, title: 'My files' }];
    const list = h('div', { style: { maxHeight: '320px', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '10px' } });
    const where = h('div', { class: 'crumbs', style: { fontSize: '14px' } });
    async function show() {
      const r = await api.get(at ? '/api/files?parent=' + at : '/api/files');
      clear(where).append(trail.map((t, i) => [i ? icon('chevR', 14) : null, h('a', { href: '#', onclick: (e) => { e.preventDefault(); trail.splice(i + 1); at = t.id; show(); } }, t.title)]));
      clear(list);
      const folders = r.files.filter((f) => f.kind === 'folder' && !ids.includes(f.id));
      if (!folders.length) list.append(h('div', { class: 'muted small', style: { padding: '14px' } }, 'No folders here.'));
      for (const f of folders) list.append(h('div', { class: 'person', style: { cursor: 'pointer' }, onclick: () => { trail.push({ id: f.id, title: f.title }); at = f.id; show(); } }, fileIcon(f), h('span', { class: 'grow' }, f.title), icon('chevR', 14)));
    }
    await show();
    modal({ title: `Move ${ids.length} item${ids.length === 1 ? '' : 's'}`, body: [where, list], actions: [{ label: 'Cancel' },
      { label: 'Move here', kind: 'primary', onClick: async () => { for (const id of ids) { try { await api.patch('/api/files/' + id, { parent_id: at }); } catch (e) { fail(e); return false; } } toast('Moved'); if (V) load(); } }] });
  }

  async function linkDialog(f) {
    let r;
    try { r = await api.get(`/api/files/${f.id}/links`); } catch (e) { return fail(e); }
    const list = h('div', {});
    const draw = () => {
      clear(list);
      if (!r.links.length) list.append(h('p', { class: 'muted small', style: { margin: 0 } }, 'No public links yet.'));
      for (const l of r.links) {
        const url = location.origin + l.path;
        list.append(h('div', { style: { padding: '10px 0', borderBottom: '1px solid var(--line)' } },
          h('div', { class: 'copy-box' }, h('input', { class: 'input', readOnly: true, value: url, onclick: (e) => e.target.select() }), h('button', { class: 'btn sm', type: 'button', onclick: () => copyText(url) }, icon('copy', 14), 'Copy')),
          h('div', { class: 'row', style: { marginTop: '6px' } }, h('span', { class: 'muted small grow' },
            `${l.allow_download ? 'View and download' : 'View only'} · ${l.expires_at ? 'ends ' + new Date(l.expires_at).toLocaleDateString() : 'no end date'} · opened ${l.views} time${l.views === 1 ? '' : 's'}`),
            h('button', { class: 'btn ghost sm', type: 'button', style: { color: 'var(--bad)' }, onclick: async () => { await api.del('/api/links/' + l.token).catch(fail); r.links = r.links.filter((x) => x !== l); draw(); toast('Link turned off'); } }, 'Turn off'))));
      }
    };
    draw();
    const exp = h('select', { class: 'select' }, [['7', 'Ends in 7 days'], ['30', 'Ends in 30 days'], ['1', 'Ends tomorrow'], ['0', 'No end date']].map(([v, l]) => h('option', { value: v }, l)));
    const dl = h('input', { type: 'checkbox', checked: true });
    modal({ title: `Public link for “${f.title}”`, body: [
      r.allowed ? h('p', { class: 'muted small', style: { margin: 0 } }, 'Anyone with the link can see this without signing in. Turn a link off at any time.') : h('p', { style: { margin: 0, color: 'var(--bad)' } }, 'Public links are turned off for this workspace.'),
      r.allowed ? h('div', { class: 'row', style: { flexWrap: 'wrap' } }, exp, h('label', { class: 'check' }, dl, 'Allow downloads'), h('span', { class: 'grow' }),
        h('button', { class: 'btn primary sm', type: 'button', onclick: async () => {
          try { const n = await api.post(`/api/files/${f.id}/links`, { expires_days: +exp.value, allow_download: dl.checked }); r.links.unshift(n.link); draw(); copyText(location.origin + n.link.path); } catch (e) { fail(e); }
        } }, icon('link', 14), 'Make a link')) : null,
      list], actions: [{ label: 'Done' }] });
  }

  // ---------- sync to computers and phones ----------
  async function syncDialog() {
    const dav = location.origin + (Nexa.state.linkBase || '') + '/dav/';
    const email = Nexa.state.user.email;
    const https = location.protocol === 'https:';
    let pw = null;
    const pwBox = h('div', {});
    const existing = h('div', {});
    async function drawExisting() {
      const r = await api.get('/api/sync-passwords');
      clear(existing);
      for (const p of r.passwords) existing.append(h('div', { class: 'person', style: { padding: '6px 0' } }, icon('lock', 14), h('div', { class: 'grow' }, p.name, h('div', { class: 'muted small' }, `Made ${new Date(p.created_at).toLocaleDateString()} · ${p.last_used ? 'last used ' + timeAgo(p.last_used) : 'not used yet'}`)),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { if (await confirmBox('Remove this sync password?', `Any device using “${p.name}” will stop syncing.`, 'Remove', true)) { await api.del('/api/sync-passwords/' + p.id).catch(fail); drawExisting(); } } }, 'Remove')));
    }
    const field = (label, value) => h('div', { class: 'field' }, label, h('div', { class: 'copy-box' }, h('input', { class: 'input', readOnly: true, value, onclick: (e) => e.target.select() }), h('button', { class: 'btn sm', type: 'button', onclick: () => copyText(value) }, icon('copy', 14))));
    const make = async () => {
      const name = devName.value.trim() || 'My device';
      try { const r = await api.post('/api/sync-passwords', { name }); pw = r.password; clear(pwBox).append(field('Sync password (shown once, so save it now)', pw)); drawExisting(); drawSteps(); } catch (e) { fail(e); }
    };
    const devName = h('input', { class: 'input', placeholder: 'Name this device, e.g. Work laptop', value: /Mac/.test(navigator.platform) ? 'Mac' : /Win/.test(navigator.platform) ? 'Windows PC' : /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'My device' });
    const steps = h('div', {});
    const guess = /iPhone|iPad/.test(navigator.userAgent) ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : /Mac/.test(navigator.platform) ? 'mac' : /Win/.test(navigator.platform) ? 'windows' : 'linux';
    let os = guess;
    const seg = h('div', { class: 'seg', style: { flexWrap: 'wrap' } });
    const OSES = [['windows', 'Windows'], ['mac', 'Mac'], ['linux', 'Linux'], ['ios', 'iPhone and iPad'], ['android', 'Android']];
    const code = (t) => h('pre', { style: { background: 'var(--bg-3)', padding: '10px', borderRadius: '8px', overflow: 'auto', fontSize: '12px', margin: '6px 0', fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap' } }, t);
    function drawSteps() {
      clear(seg).append(OSES.map(([k, l]) => h('button', { type: 'button', class: os === k ? 'on' : '', onclick: () => { os = k; drawSteps(); } }, l)));
      const P = pw || '(your sync password)';
      const ol = (...items) => h('ol', { style: { paddingLeft: '20px', margin: '6px 0', lineHeight: 1.6 } }, items.map((i) => h('li', {}, i)));
      const rclone = (dest) => code(`rclone config create nexa webdav url=${dav} vendor=other user=${email} pass=$(rclone obscure ${P})\nrclone bisync nexa: "${dest}" --resync    # first time only\nrclone bisync nexa: "${dest}"             # run again (or on a schedule) to keep both sides in step`);
      const content = {
        windows: [ol('Open File Explorer, right-click This PC and choose Map network drive.', `Pick a drive letter and paste the Vault address: ${dav}`, 'Tick Connect using different credentials and press Finish.', `Sign in with ${email} and your sync password.`),
          !https ? h('p', { class: 'small', style: { color: 'var(--warn)' } }, 'Windows only connects drives over https. Put Nexa behind https (the Render and Docker guides in the README do this) to map it as a drive.') : null,
          h('p', { class: 'muted small' }, 'Want a folder that keeps a full copy offline and syncs both ways, like OneDrive? Install rclone (free) and run:'), rclone('%USERPROFILE%\\Nexa Vault')],
        mac: [ol('In Finder, choose Go then Connect to Server (Cmd+K).', `Paste ${dav} and press Connect.`, `Sign in with ${email} and your sync password. Vault shows up in the Finder sidebar.`),
          h('p', { class: 'muted small' }, 'For an offline copy that syncs both ways, install rclone (brew install rclone) and run:'), rclone('~/Nexa Vault')],
        linux: [ol(`Files (GNOME): Other Locations, then connect to ${dav.replace(/^http/, 'dav')}`, 'Dolphin (KDE): Network, then Add Network Folder, then WebDAV.'), h('p', { class: 'muted small' }, 'Two-way sync with rclone:'), rclone('~/Nexa Vault')],
        ios: [ol('Add Nexa to your Home Screen: tap Share in Safari, then Add to Home Screen. Uploading from Photos and the camera works from there.',
          `To see Vault in the Files app, install a free WebDAV app such as Documents by Readdle, add a WebDAV connection with ${dav}, ${email} and your sync password.`)],
        android: [ol('Add Nexa to your home screen: in Chrome, tap the menu, then Install app.',
          `For Vault in your file manager or automatic photo backup, use a WebDAV app such as FolderSync, Solid Explorer or Material Files with ${dav}, ${email} and your sync password.`)],
      }[os];
      clear(steps).append(content);
    }
    drawSteps(); drawExisting();
    modal({ title: 'Sync Vault to your computer and phone', wide: true, body: [
      h('p', { class: 'muted small', style: { margin: 0 } }, 'Vault works as a network drive, so it shows up next to your other folders. Changes you make there show up in Nexa, and every replaced file keeps its old versions. Use a sync password for each device, never your Nexa password.'),
      field('Vault address', dav), field('User name', email),
      h('div', { class: 'row' }, devName, h('button', { class: 'btn primary', type: 'button', onclick: make }, icon('lock', 14), 'Make a sync password')), pwBox,
      seg, steps,
      h('div', { class: 'sect', style: { padding: '10px 0 0' } }, 'Devices with a sync password'), existing,
    ], actions: [{ label: 'Done' }] });
  }

  // ---------- picker other apps use ----------
  Nexa.pickVaultFile = () => new Promise((resolve) => {
    let at = null, chosen = null, done = false; const trail = [{ id: null, title: 'My files' }];
    const list = h('div', { style: { maxHeight: '360px', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '10px' } });
    const where = h('div', { class: 'crumbs', style: { fontSize: '14px' } });
    const tabs = h('div', { class: 'seg' }, [['mine', 'My files'], ['recent', 'Recent'], ['shared', 'Shared with me']].map(([k, l]) => h('button', { type: 'button', onclick: () => { at = null; trail.splice(1); tab = k; show(); } }, l)));
    let tab = 'mine';
    async function show() {
      $$('button', tabs).forEach((b, i) => b.classList.toggle('on', ['mine', 'recent', 'shared'][i] === tab));
      const r = await api.get(at ? '/api/files?parent=' + at : '/api/files?view=' + tab);
      clear(where).append(trail.map((t, i) => [i ? icon('chevR', 14) : null, h('a', { href: '#', onclick: (e) => { e.preventDefault(); trail.splice(i + 1); at = t.id; show(); } }, t.title)]));
      clear(list);
      if (!r.files.length) list.append(h('div', { class: 'muted small', style: { padding: '14px' } }, 'Nothing here.'));
      for (const f of r.files) {
        const row = h('div', { class: 'person', style: { cursor: 'pointer' }, onclick: () => {
          if (f.kind === 'folder') { trail.push({ id: f.id, title: f.title }); at = f.id; show(); return; }
          chosen = f; $$('.person', list).forEach((x) => { x.style.background = ''; }); row.style.background = 'var(--brand-soft)';
        } }, fileIcon(f), h('span', { class: 'grow ellipsis' }, f.title), h('span', { class: 'muted small' }, f.kind === 'folder' ? '' : fmtSize(f.size || 0)), f.kind === 'folder' ? icon('chevR', 14) : null);
        list.append(row);
      }
    }
    show();
    modal({ title: 'Pick a file from Vault', body: [tabs, where, list], onClose: () => { if (!done) resolve(null); },
      actions: [{ label: 'Cancel' }, { label: 'Attach', kind: 'primary', onClick: () => { if (!chosen) { toast('Pick a file first.'); return false; } done = true; resolve(chosen); } }] });
  });

  Nexa.Router.add('/vault', (p) => open({ qs: p.qs }));
  Nexa.Router.add('/vault/:id', ({ id, qs }) => open({ id, qs }));
})();
