'use strict';
// Vault: OneDrive-style file storage.
//  - Replacing an uploaded file keeps the old copy in version history.
//  - Public share links (view or download, optional expiry, can be turned off).
//  - Storage usage per person.
//  - WebDAV at /dav so Windows, macOS, Linux and phone file apps can mount Vault as a drive.
//    Sign-in for WebDAV uses sync passwords made in Vault, never the account password.
const crypto = require('node:crypto');
const express = require('express');
const A = require('./auth');
const { plainText, sanitizeDocHtml } = require('./sanitize');
const { htmlToDocx, docxToHtml } = require('./convert/docx');
const { gridToXlsx, xlsxToGrid } = require('./convert/xlsx');
const { deckToPptx, pptxToDeck } = require('./convert/pptx');
const NexaFormula = require('../shared/formula.js');

const NATIVE_EXT = { doc: 'docx', sheet: 'xlsx', deck: 'pptx' };
const NATIVE_MIME = {
  doc: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  sheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  deck: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const BLOB_VERSIONS_KEPT = 20;
const DAY = 86400000;

function attachVault({ store, auth, filePerm, audit, HttpError, app, wrap, huddle, maxUpload, quotaBytes, cleanContent, insertFile, meta }) {
  const { one, all, run, tx, db } = store;
  const PERM_RANK = { none: 0, view: 1, edit: 2, owner: 3 };
  const bad = (m) => new HttpError(400, m);

  // ---------- schema additions ----------
  db.exec(`
    CREATE TABLE IF NOT EXISTS share_links (
      token TEXT PRIMARY KEY,
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      allow_download INTEGER NOT NULL DEFAULT 1,
      views INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS share_links_file ON share_links(file_id);
    CREATE TABLE IF NOT EXISTS app_passwords (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      last_used INTEGER
    );`);
  const cols = all('PRAGMA table_info(file_versions)').map((c) => c.name);
  if (!cols.includes('blob')) db.exec('ALTER TABLE file_versions ADD COLUMN blob BLOB; ALTER TABLE file_versions ADD COLUMN mime TEXT; ALTER TABLE file_versions ADD COLUMN size INTEGER;');

  const getMeta = (k) => (one('SELECT v FROM meta WHERE k = ?', k) || {}).v;
  const linksAllowed = () => getMeta('public_links') !== 'off';
  const usedBy = (uid) => one('SELECT COALESCE(SUM(size),0) AS n FROM files WHERE owner_id = ?', uid).n
    + one('SELECT COALESCE(SUM(v.size),0) AS n FROM file_versions v JOIN files f ON f.id = v.file_id WHERE f.owner_id = ? AND v.blob IS NOT NULL', uid).n;
  function checkQuota(uid, adding) {
    if (quotaBytes && usedBy(uid) + adding > quotaBytes) throw new HttpError(507, `This would go over your ${fmtBytes(quotaBytes)} of storage. Empty the trash or delete older files to make room.`);
  }
  const notify = (f, user) => huddle.notifyFile(f.id, { t: 'file.saved', id: f.id, version: f.version + 1, by: user.id, byName: user.name });

  // Replace the bytes of an uploaded file, keeping the old bytes as a version.
  function saveBlob(f, user, buf, mime) {
    if (buf.length > maxUpload) throw new HttpError(413, `Files can be up to ${fmtBytes(maxUpload)}.`);
    checkQuota(f.owner_id, buf.length);
    tx(() => {
      run('INSERT INTO file_versions (file_id, version, title, content, blob, mime, size, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
        f.id, f.version, f.title, null, f.blob, f.mime, f.size, f.updated_at, f.updated_by);
      run(`DELETE FROM file_versions WHERE file_id = ? AND blob IS NOT NULL AND id NOT IN
        (SELECT id FROM file_versions WHERE file_id = ? AND blob IS NOT NULL ORDER BY version DESC LIMIT ${BLOB_VERSIONS_KEPT})`, f.id, f.id);
      run('UPDATE files SET blob = ?, size = ?, mime = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?',
        buf, buf.length, mime || f.mime, Date.now(), user.id, f.id);
    });
    notify(f, user);
  }
  // Replace a Nexa document, grid or deck with content converted from an Office file.
  async function saveNativeFromOffice(f, user, buf) {
    let content;
    try {
      if (f.kind === 'doc') content = { html: await docxToHtml(buf) };
      else if (f.kind === 'sheet') content = await xlsxToGrid(buf);
      else content = await pptxToDeck(buf);
    } catch { throw bad(`Nexa couldn't read that file as a .${NATIVE_EXT[f.kind]}.`); }
    const body = cleanContent(f.kind, content);
    tx(() => {
      run('INSERT INTO file_versions (file_id, version, title, content, created_at, created_by) VALUES (?,?,?,?,?,?)', f.id, f.version, f.title, f.content, f.updated_at, f.updated_by);
      run('UPDATE files SET content = ?, size = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?', body, Buffer.byteLength(body), Date.now(), user.id, f.id);
    });
    notify(f, user);
  }
  const exportSize = new Map();
  async function sizeOf(f) {
    const k = f.id + ':' + f.version;
    if (!exportSize.has(k)) { if (exportSize.size > 5000) exportSize.clear(); exportSize.set(k, (await exportNative(f)).length); }
    return exportSize.get(k);
  }
  async function exportNative(f) {
    const c = f.content ? JSON.parse(f.content) : null;
    if (f.kind === 'doc') return htmlToDocx(c.html, { title: f.title });
    if (f.kind === 'sheet') return gridToXlsx(c);
    return deckToPptx(c, { title: f.title });
  }

  // ---------- REST: replace bytes, versions of uploads, storage ----------
  app.put('/api/files/:id/blob', auth.requireUser, express.raw({ type: () => true, limit: maxUpload }), (req, res) => {
    const f = one('SELECT * FROM files WHERE id = ?', req.params.id);
    const perm = filePerm(req.user, f);
    if (!f || perm === 'none') throw new HttpError(404, 'File not found.');
    if (PERM_RANK[perm] < PERM_RANK.edit) throw new HttpError(403, 'You can view this file but not change it.');
    if (f.kind !== 'upload') throw bad('Only uploaded files can be replaced this way.');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('The file was empty.');
    saveBlob(f, req.user, req.body, String(req.get('x-mime') || '').slice(0, 100) || null);
    audit(req, 'file.replaced', f.id, { size: req.body.length });
    const nf = one('SELECT f.*, u.name AS owner_name FROM files f JOIN users u ON u.id = f.owner_id WHERE f.id = ?', f.id);
    res.json({ file: meta(nf, perm) });
  });
  app.get('/api/files/:id/versions/:v/raw', auth.requireUser, (req, res) => {
    const f = one('SELECT * FROM files WHERE id = ?', req.params.id);
    if (!f || filePerm(req.user, f) === 'none') throw new HttpError(404, 'File not found.');
    const v = one('SELECT * FROM file_versions WHERE file_id = ? AND version = ? AND blob IS NOT NULL', f.id, +req.params.v);
    if (!v) throw new HttpError(404, 'Version not found.');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.title)}`);
    res.end(Buffer.from(v.blob));
  });
  app.get('/api/storage', auth.requireUser, (req, res) => {
    const by = all(`SELECT kind, COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes, SUM(trashed) AS trashed FROM files WHERE owner_id = ? GROUP BY kind`, req.user.id);
    const trash = one('SELECT COALESCE(SUM(size),0) AS n FROM files WHERE owner_id = ? AND trashed = 1', req.user.id).n;
    const versions = one('SELECT COALESCE(SUM(v.size),0) AS n FROM file_versions v JOIN files f ON f.id = v.file_id WHERE f.owner_id = ? AND v.blob IS NOT NULL', req.user.id).n;
    res.json({ used: usedBy(req.user.id), quota: quotaBytes || null, trash, versions, by_kind: by, max_upload: maxUpload });
  });
  app.post('/api/files/trash/empty', auth.requireUser, (req, res) => {
    const n = run('DELETE FROM files WHERE owner_id = ? AND trashed = 1', req.user.id).changes;
    audit(req, 'trash.emptied', null, { count: n });
    res.json({ deleted: n });
  });

  // ---------- share links ----------
  const linkRow = (l) => ({ token: l.token, path: '/s/' + l.token, created_at: l.created_at, expires_at: l.expires_at, allow_download: !!l.allow_download, views: l.views, created_by: l.created_by });
  app.get('/api/files/:id/links', auth.requireUser, (req, res) => {
    const f = one('SELECT * FROM files WHERE id = ?', req.params.id);
    if (!f || PERM_RANK[filePerm(req.user, f)] < PERM_RANK.edit) throw new HttpError(404, 'File not found.');
    res.json({ allowed: linksAllowed() && req.user.role !== 'guest', links: all('SELECT * FROM share_links WHERE file_id = ? ORDER BY created_at DESC', f.id).map(linkRow) });
  });
  app.post('/api/files/:id/links', auth.requireUser, (req, res) => {
    const f = one('SELECT * FROM files WHERE id = ?', req.params.id);
    if (!f || filePerm(req.user, f) !== 'owner') throw new HttpError(403, 'Only the owner can make a public link.');
    if (!linksAllowed()) throw new HttpError(403, 'An owner of this workspace has turned off public links.');
    if (req.user.role === 'guest') throw new HttpError(403, 'Guests cannot make public links.');
    const b = req.body || {};
    const days = Math.min(365, Math.max(0, Math.floor(+b.expires_days || 0)));
    const token = crypto.randomBytes(18).toString('base64url');
    run('INSERT INTO share_links (token, file_id, created_by, created_at, expires_at, allow_download) VALUES (?,?,?,?,?,?)',
      token, f.id, req.user.id, Date.now(), days ? Date.now() + days * DAY : null, b.allow_download === false ? 0 : 1);
    audit(req, 'link.created', f.id, { days, download: b.allow_download !== false });
    res.status(201).json({ link: linkRow(one('SELECT * FROM share_links WHERE token = ?', token)) });
  });
  app.delete('/api/links/:token', auth.requireUser, (req, res) => {
    const l = one('SELECT * FROM share_links WHERE token = ?', req.params.token);
    if (!l) throw new HttpError(404, 'Link not found.');
    const f = one('SELECT * FROM files WHERE id = ?', l.file_id);
    if (l.created_by !== req.user.id && filePerm(req.user, f) !== 'owner' && !['owner', 'admin'].includes(req.user.role)) throw new HttpError(403, 'You cannot turn off this link.');
    run('DELETE FROM share_links WHERE token = ?', l.token);
    audit(req, 'link.deleted', l.file_id);
    res.json({ ok: true });
  });
  app.patch('/api/settings/links', auth.requireRole('owner'), (req, res) => {
    const on = !!(req.body || {}).public_links;
    run('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', 'public_links', on ? 'on' : 'off');
    audit(req, 'settings.public_links', null, { on });
    res.json({ public_links: on });
  });
  app.get('/api/settings/links', auth.requireRole('admin'), (req, res) => res.json({ public_links: linksAllowed(), count: one('SELECT COUNT(*) AS n FROM share_links').n }));

  // Public pages for share links. They show the file read-only and never reveal anything else.
  function liveLink(token) {
    if (!linksAllowed() || typeof token !== 'string' || !/^[\w-]{10,60}$/.test(token)) return null;
    const l = one('SELECT * FROM share_links WHERE token = ?', token);
    if (!l || (l.expires_at && l.expires_at < Date.now())) return null;
    const f = one('SELECT * FROM files WHERE id = ?', l.file_id);
    const owner = f && one("SELECT id, role, status FROM users WHERE id = ?", f.owner_id);
    if (!f || f.trashed || !owner || owner.status !== 'active') return null;
    return { l, f };
  }
  function childOf(folder, childId) {
    let c = one('SELECT * FROM files WHERE id = ?', childId);
    const child = c;
    for (let i = 0; c && i < 32; i++) { if (c.parent_id === folder.id) return child && !child.trashed ? child : null; c = c.parent_id ? one('SELECT * FROM files WHERE id = ?', c.parent_id) : null; if (c && c.trashed) return null; }
    return null;
  }
  const page = (title, body) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · Astute Nexa</title><link rel="icon" href="/icons/icon.svg"><style>
:root{color-scheme:light dark;--t:#1B2037;--m:#5E6687;--b:#F5F6FB;--c:#fff;--l:#E3E6F2;--a:#6D4BFF}
@media (prefers-color-scheme:dark){:root{--t:#ECEEFA;--m:#9AA3C7;--b:#0E1020;--c:#171A2E;--l:#2A2F4D}}
*{box-sizing:border-box}body{margin:0;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--b);color:var(--t)}
header{display:flex;align-items:center;gap:10px;padding:14px 22px;border-bottom:1px solid var(--l);background:var(--c)}
header b{font-size:16px}.logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#6D4BFF,#3D7BFF 55%,#22C7E8);color:#fff;display:grid;place-items:center;font-weight:800}
main{max-width:1000px;margin:24px auto;padding:0 18px}.card{background:var(--c);border:1px solid var(--l);border-radius:16px;padding:24px;overflow:auto}
.btn{display:inline-block;padding:9px 16px;border-radius:10px;background:var(--a);color:#fff;text-decoration:none;font-weight:600}
.muted{color:var(--m);font-size:13px}table{border-collapse:collapse}td,th{border:1px solid var(--l);padding:4px 8px;font-size:13px;white-space:nowrap}
.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.grow{flex:1}img,video{max-width:100%;border-radius:10px}
.slide{position:relative;width:100%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;margin-bottom:16px;border:1px solid var(--l)}
.slide div{position:absolute;white-space:pre-wrap;overflow:hidden}a.item{display:flex;gap:10px;padding:10px;border-bottom:1px solid var(--l);color:inherit;text-decoration:none}
footer{text-align:center;margin:30px 0;color:var(--m);font-size:12px}footer a{color:inherit}</style>
<header><span class="logo">N</span><b>${esc(title)}</b></header><main>${body}</main>
<footer>Shared with Astute Nexa · free and open source</footer></html>`;
  function renderNative(f) {
    const c = f.content ? JSON.parse(f.content) : {};
    if (f.kind === 'doc') return `<div class="card">${sanitizeDocHtml(c.html || '')}</div>`;
    if (f.kind === 'sheet') {
      const wb = new NexaFormula.Workbook({ sheets: c.sheets || [] });
      return (c.sheets || []).map((s, si) => {
        let maxR = 1, maxC = 1;
        for (const a of Object.keys(s.cells || {})) { const p = NexaFormula.parseAddr(a); if (p) { maxR = Math.max(maxR, p.row); maxC = Math.max(maxC, p.col); } }
        maxR = Math.min(maxR, 1000); maxC = Math.min(maxC, 60);
        let t = `<h3>${esc(s.name)}</h3><div class="card"><table><tr><th></th>${Array.from({ length: maxC }, (_, i) => `<th>${NexaFormula.numToCol(i + 1)}</th>`).join('')}</tr>`;
        for (let r = 1; r <= maxR; r++) {
          t += `<tr><th>${r}</th>`;
          for (let col = 1; col <= maxC; col++) {
            const a = NexaFormula.numToCol(col) + r;
            const fmt = (s.styles || {})[a] && s.styles[a].fmt;
            let v = ''; try { v = fmt ? NexaFormula.formatValue(wb.getValue(si, a), fmt) : wb.getDisplay(si, a); } catch { v = ''; }
            t += `<td>${esc(v == null ? '' : v)}</td>`;
          }
          t += '</tr>';
        }
        return t + '</table></div>';
      }).join('');
    }
    const slides = (c.slides || []).slice(0, 200);
    return slides.map((s) => `<div class="slide" style="background:${cssColor(s.bg) || '#14162B'}">${(s.elements || []).map((e) => {
      const st = e.style || {};
      const box = `left:${e.x / 9.6}%;top:${e.y / 5.4}%;width:${e.w / 9.6}%;height:${e.h / 5.4}%;`;
      if (e.type === 'image' && e.src) return `<div style="${box}"><img alt="" src="${esc(e.src)}" style="width:100%;height:100%;object-fit:contain;border-radius:0"></div>`;
      if (e.type === 'shape') return `<div style="${box}background:${cssColor(st.fill) || '#6D4BFF'};border-radius:${st.shape === 'ellipse' ? '50%' : st.shape === 'round' ? '12px' : '0'}"></div>`;
      return `<div style="${box}font-size:clamp(8px,${(st.size || 24) / 9.6 * 0.95}vw,${st.size || 24}px);color:${cssColor(st.color) || '#fff'};font-weight:${st.bold ? 700 : 400};text-align:${['left', 'center', 'right'].includes(st.align) ? st.align : 'left'}">${esc(e.text || '')}</div>`;
    }).join('')}</div>`).join('') || '<p class="muted">This deck has no slides.</p>';
  }
  app.get('/s/:token', (req, res) => {
    const L = liveLink(req.params.token);
    res.setHeader('X-Robots-Tag', 'noindex');
    if (!L) return res.status(404).send(page('Link not available', '<div class="card"><h2>This link is not available</h2><p class="muted">It may have expired, or the owner turned it off.</p></div>'));
    const { l, f } = L;
    run('UPDATE share_links SET views = views + 1 WHERE token = ?', l.token);
    const base = '/s/' + l.token;
    const dl = (href, label) => (l.allow_download ? `<a class="btn" href="${href}">${label}</a>` : '<span class="muted">The owner turned off downloads for this link.</span>');
    const owner = one('SELECT name FROM users WHERE id = ?', f.owner_id);
    const sub = `<p class="muted">Shared by ${esc(owner ? owner.name : 'someone')} · updated ${new Date(f.updated_at).toUTCString().slice(0, 16)}</p>`;
    if (f.kind === 'folder') {
      const kids = all("SELECT id, kind, title, size, updated_at FROM files WHERE parent_id = ? AND trashed = 0 AND title NOT LIKE '.%' ORDER BY kind = 'folder' DESC, title COLLATE NOCASE LIMIT 1000", f.id);
      const rows = kids.map((k) => k.kind === 'folder' ? `<div class="item" style="padding:10px;border-bottom:1px solid var(--l)">📁 ${esc(k.title)}</div>`
        : `<a class="item" href="${base}/f/${k.id}"><span class="grow">${k.kind === 'upload' ? '📄' : k.kind === 'doc' ? '📝' : k.kind === 'sheet' ? '📊' : '📽️'} ${esc(k.title)}${NATIVE_EXT[k.kind] ? '.' + NATIVE_EXT[k.kind] : ''}</span><span class="muted">${k.kind === 'upload' ? fmtBytes(k.size) : ''}</span></a>`).join('');
      return res.send(page(f.title, `${sub}<div class="card" style="padding:0">${rows || '<p style="padding:20px" class="muted">This folder is empty.</p>'}</div>${l.allow_download ? '' : '<p class="muted">Downloads are turned off for this link.</p>'}`));
    }
    if (f.kind === 'upload') {
      const preview = /^image\/(png|jpeg|gif|webp)$/.test(f.mime) ? `<img alt="" src="${base}/raw?inline=1">` : /^video\/mp4$/.test(f.mime) ? `<video controls src="${base}/raw?inline=1"></video>` : '';
      return res.send(page(f.title, `${sub}<div class="card"><div class="row"><span class="grow"><b>${esc(f.title)}</b><br><span class="muted">${fmtBytes(f.size)}</span></span>${dl(base + '/raw', 'Download')}</div>${preview ? '<div style="margin-top:16px">' + preview + '</div>' : ''}</div>`));
    }
    res.send(page(f.title, `<div class="row">${sub}<span class="grow"></span>${dl(base + '/raw', 'Download .' + NATIVE_EXT[f.kind])}</div>${renderNative(f)}`));
  });
  const sendFile = (req, res, f, allowDownload, next) => sendFileAsync(req, res, f, allowDownload).catch(next);
  async function sendFileAsync(req, res, f, allowDownload) {
    if (f.kind === 'upload') {
      const inline = req.query.inline === '1' && /^(image\/(png|jpeg|gif|webp)|video\/mp4)$/.test(f.mime);
      if (!inline && !allowDownload) return res.status(403).send('Downloads are turned off for this link.');
      res.setHeader('Content-Type', inline ? f.mime : 'application/octet-stream');
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.title)}`);
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      return res.end(Buffer.from(f.blob));
    }
    if (!allowDownload) return res.status(403).send('Downloads are turned off for this link.');
    if (!NATIVE_EXT[f.kind]) return res.status(404).end();
    res.setHeader('Content-Type', NATIVE_MIME[f.kind]);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.title + '.' + NATIVE_EXT[f.kind])}`);
    res.end(await exportNative(f));
  }
  app.get('/s/:token/raw', (req, res, next) => { const L = liveLink(req.params.token); if (!L || L.f.kind === 'folder') return res.status(404).send('Not found'); sendFile(req, res, L.f, !!L.l.allow_download, next); });
  app.get('/s/:token/f/:child', (req, res, next) => {
    const L = liveLink(req.params.token);
    const c = L && L.f.kind === 'folder' && childOf(L.f, req.params.child);
    if (!c || c.kind === 'folder') return res.status(404).send('Not found');
    sendFile(req, res, c, !!L.l.allow_download, next);
  });

  // ---------- sync passwords for WebDAV ----------
  app.get('/api/sync-passwords', auth.requireUser, (req, res) => {
    res.json({ passwords: all('SELECT id, name, created_at, last_used FROM app_passwords WHERE user_id = ? ORDER BY created_at DESC', req.user.id) });
  });
  app.post('/api/sync-passwords', auth.requireUser, (req, res) => {
    const name = plainText((req.body || {}).name, 60).trim() || 'My device';
    if (one('SELECT COUNT(*) AS n FROM app_passwords WHERE user_id = ?', req.user.id).n >= 20) throw bad('You have 20 sync passwords already. Remove one first.');
    // grouped so it is easy to type on a phone: xxxx-xxxx-xxxx-xxxx-xxxx
    const raw = crypto.randomBytes(15).toString('base64url').replace(/[-_]/g, 'x').slice(0, 20).toLowerCase();
    const pw = raw.match(/.{4}/g).join('-');
    const pid = A.id('ap');
    run('INSERT INTO app_passwords (id, user_id, name, hash, created_at) VALUES (?,?,?,?,?)', pid, req.user.id, name, A.sha256(pw), Date.now());
    audit(req, 'sync_password.created', pid, { name });
    res.status(201).json({ id: pid, name, password: pw });
  });
  app.delete('/api/sync-passwords/:id', auth.requireUser, (req, res) => {
    const n = run('DELETE FROM app_passwords WHERE id = ? AND user_id = ?', req.params.id, req.user.id).changes;
    if (!n) throw new HttpError(404, 'Not found.');
    audit(req, 'sync_password.deleted', req.params.id);
    res.json({ ok: true });
  });

  // ---------- WebDAV ----------
  const davLimit = A.rateLimiter(30, 15 * 60 * 1000);
  function davUser(req) {
    const h = req.get('authorization') || '';
    if (h.startsWith('Basic ')) {
      const dec = Buffer.from(h.slice(6), 'base64').toString('utf8');
      const i = dec.indexOf(':');
      const email = dec.slice(0, i).trim().toLowerCase(), pw = dec.slice(i + 1).trim().toLowerCase();
      const key = 'dav:' + (req.ip || '') + ':' + email;
      const row = one(`SELECT a.id AS pid, u.id, u.email, u.name, u.role, u.status, u.title FROM app_passwords a JOIN users u ON u.id = a.user_id WHERE a.hash = ?`, A.sha256(pw));
      if (row && row.email.toLowerCase() === email && row.status === 'active') {
        run('UPDATE app_passwords SET last_used = ? WHERE id = ?', Date.now(), row.pid);
        return { id: row.id, email: row.email, name: row.name, role: row.role, title: row.title };
      }
      if (!davLimit(key)) return 'limited';
      return null;
    }
    return req.user || null; // a browser that is already signed in
  }
  const nameOf = (f) => (NATIVE_EXT[f.kind] ? `${f.title}.${NATIVE_EXT[f.kind]}` : f.title).replace(/[\\/]/g, '_');
  function children(user, parent) {
    const rows = parent
      ? all('SELECT * FROM files WHERE parent_id = ? AND trashed = 0 ORDER BY created_at', parent.id)
      : all('SELECT * FROM files WHERE owner_id = ? AND parent_id IS NULL AND trashed = 0 ORDER BY created_at', user.id);
    const seen = new Map();
    return rows.map((f) => {
      let n = nameOf(f);
      const k = n.toLowerCase();
      if (seen.has(k)) { const c = seen.get(k) + 1; seen.set(k, c); const dot = n.lastIndexOf('.'); n = dot > 0 && f.kind !== 'folder' ? `${n.slice(0, dot)} (${c})${n.slice(dot)}` : `${n} (${c})`; } else seen.set(k, 1);
      return { f, name: n };
    });
  }
  // Walks a /dav path. Returns { node, parent, name } where node is null at the root.
  function resolve(user, segs) {
    let parent = null, node = null;
    for (let i = 0; i < segs.length; i++) {
      const hit = children(user, node).find((c) => c.name.toLowerCase() === segs[i].toLowerCase());
      if (!hit) return i === segs.length - 1 ? { node: undefined, parent: node, name: segs[i] } : null;
      parent = node; node = hit.f;
      if (i < segs.length - 1 && node.kind !== 'folder') return null;
    }
    return { node, parent, name: segs[segs.length - 1] };
  }
  const segsOf = (p) => p.replace(/^\/dav\/?/, '').split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const hrefOf = (segs, folder) => '/dav/' + segs.map(encodeURIComponent).join('/') + (folder && segs.length ? '/' : '');
  const etag = (f) => `"${f.id}-${f.version}"`;
  function propXml(href, f, user, isRoot) {
    const folder = isRoot || f.kind === 'folder';
    const mod = new Date(isRoot ? Date.now() : f.updated_at).toUTCString();
    const created = new Date(isRoot ? Date.now() : f.created_at).toISOString();
    const size = folder ? '' : `<d:getcontentlength>${f.kind === 'upload' ? f.size : exportSize.get(f.id + ':' + f.version) || 0}</d:getcontentlength>`;
    const type = folder ? '' : `<d:getcontenttype>${esc(f.kind === 'upload' ? f.mime || 'application/octet-stream' : NATIVE_MIME[f.kind])}</d:getcontenttype>`;
    const quota = isRoot ? `<d:quota-used-bytes>${usedBy(user.id)}</d:quota-used-bytes>${quotaBytes ? `<d:quota-available-bytes>${Math.max(0, quotaBytes - usedBy(user.id))}</d:quota-available-bytes>` : ''}` : '';
    return `<d:response><d:href>${esc(href)}</d:href><d:propstat><d:prop><d:displayname>${esc(isRoot ? 'Vault' : nameOf(f))}</d:displayname>
<d:resourcetype>${folder ? '<d:collection/>' : ''}</d:resourcetype>${size}${type}<d:getlastmodified>${mod}</d:getlastmodified><d:creationdate>${created}</d:creationdate>
${isRoot ? '' : `<d:getetag>${etag(f)}</d:getetag>`}${quota}<d:supportedlock><d:lockentry><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype></d:lockentry></d:supportedlock>
</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  }
  const canWrite = (user, parent) => (parent ? PERM_RANK[filePerm(user, parent)] >= PERM_RANK.edit : user.role !== 'guest');
  const multistatus = (res, body) => { res.status(207).setHeader('Content-Type', 'application/xml; charset=utf-8'); res.end(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${body}</d:multistatus>`); };
  const isJunk = (n) => n === '.DS_Store' || n === 'desktop.ini' || n === 'Thumbs.db' || n.startsWith('._');

  app.use('/dav', express.raw({ type: () => true, limit: maxUpload }));
  app.all(/^\/dav(\/.*)?$/, wrap(async (req, res) => {
    res.setHeader('DAV', '1, 2');
    res.setHeader('MS-Author-Via', 'DAV');
    if (req.method === 'OPTIONS') { res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY, LOCK, UNLOCK'); return res.end(); }
    const user = davUser(req);
    if (user === 'limited') return res.status(429).end('Too many tries. Wait 15 minutes.');
    if (!user) { res.setHeader('WWW-Authenticate', 'Basic realm="Astute Nexa Vault", charset="UTF-8"'); return res.status(401).end('Sign in with your email and a sync password from Vault.'); }
    const segs = segsOf(req.path === '/' ? '/dav' : req.originalUrl.split('?')[0]);
    const r = segs.length ? resolve(user, segs) : { node: null, parent: null };
    const m = req.method;

    if (m === 'PROPFIND') {
      if (!r || r.node === undefined) return res.status(404).end();
      const depth = req.get('depth') === '0' ? 0 : 1;
      const isRoot = r.node === null;
      if (!isRoot && filePerm(user, r.node) === 'none') return res.status(404).end();
      const list = depth && (isRoot || r.node.kind === 'folder') ? children(user, r.node) : [];
      // Office files are made on the fly, so work out their real size first: some apps trust it.
      for (const f of [r.node, ...list.map((c) => c.f)]) if (f && NATIVE_EXT[f.kind]) await sizeOf(f);
      let out = propXml(hrefOf(segs, isRoot || r.node.kind === 'folder'), r.node, user, isRoot);
      for (const c of list) out += propXml(hrefOf([...segs, c.name], c.f.kind === 'folder'), c.f, user, false);
      return multistatus(res, out);
    }
    if (m === 'PROPPATCH') { if (!r || r.node === undefined) return res.status(404).end(); return multistatus(res, `<d:response><d:href>${esc(hrefOf(segs))}</d:href><d:propstat><d:prop/><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`); }
    if (m === 'LOCK') {
      const token = 'opaquelocktoken:' + crypto.randomUUID();
      res.setHeader('Lock-Token', `<${token}>`);
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      if (r && r.node === undefined && canWrite(user, r.parent) && !isJunk(r.name)) {
        insertFile(user, { kind: 'upload', title: plainText(r.name, 200), parent_id: r.parent ? r.parent.id : null, blob: Buffer.alloc(0), mime: 'application/octet-stream', size: 0 });
        res.status(201);
      }
      return res.end(`<?xml version="1.0" encoding="utf-8"?><d:prop xmlns:d="DAV:"><d:lockdiscovery><d:activelock><d:locktype><d:write/></d:locktype><d:lockscope><d:exclusive/></d:lockscope>
<d:depth>0</d:depth><d:owner>${esc(user.name)}</d:owner><d:timeout>Second-3600</d:timeout><d:locktoken><d:href>${token}</d:href></d:locktoken></d:activelock></d:lockdiscovery></d:prop>`);
    }
    if (m === 'UNLOCK') return res.status(204).end();
    if (m === 'GET' || m === 'HEAD') {
      if (!r || r.node === undefined) return res.status(404).end();
      if (r.node === null || r.node.kind === 'folder') {
        const list = children(user, r.node).map((c) => `<li><a href="${esc(hrefOf([...segs, c.name], c.f.kind === 'folder'))}">${esc(c.name)}</a></li>`).join('');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(m === 'HEAD' ? undefined : `<!doctype html><meta charset="utf-8"><title>Vault</title><h1>Vault${segs.length ? ' / ' + esc(segs.join(' / ')) : ''}</h1><ul>${list}</ul>`);
      }
      const f = r.node;
      if (filePerm(user, f) === 'none') return res.status(404).end();
      const buf = f.kind === 'upload' ? Buffer.from(f.blob || Buffer.alloc(0)) : await exportNative(f);
      res.setHeader('Content-Type', f.kind === 'upload' ? 'application/octet-stream' : NATIVE_MIME[f.kind]);
      res.setHeader('Content-Length', buf.length);
      res.setHeader('ETag', etag(f));
      res.setHeader('Last-Modified', new Date(f.updated_at).toUTCString());
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      return res.end(m === 'HEAD' ? undefined : buf);
    }
    if (m === 'PUT') {
      if (!r) return res.status(409).end();
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (r.node) {
        if (r.node.kind === 'folder') return res.status(405).end();
        if (PERM_RANK[filePerm(user, r.node)] < PERM_RANK.edit) return res.status(403).end();
        if (r.node.kind === 'upload') saveBlob(r.node, user, buf, mimeFor(r.name));
        else if (buf.length) await saveNativeFromOffice(r.node, user, buf);
        return res.status(204).end();
      }
      if (!canWrite(user, r.parent)) return res.status(403).end();
      checkQuota(r.parent ? r.parent.owner_id : user.id, buf.length);
      insertFile(user, { kind: 'upload', title: plainText(r.name, 200), parent_id: r.parent ? r.parent.id : null, blob: buf, mime: mimeFor(r.name), size: buf.length });
      return res.status(201).end();
    }
    if (m === 'MKCOL') {
      if (!r) return res.status(409).end();
      if (r.node !== undefined) return res.status(405).end();
      if (!canWrite(user, r.parent)) return res.status(403).end();
      insertFile(user, { kind: 'folder', title: plainText(r.name, 200), parent_id: r.parent ? r.parent.id : null });
      return res.status(201).end();
    }
    if (m === 'DELETE') {
      if (!r || !r.node) return res.status(404).end();
      if (filePerm(user, r.node) !== 'owner') return res.status(403).end();
      run('UPDATE files SET trashed = 1, updated_at = ? WHERE id = ?', Date.now(), r.node.id); // goes to Vault's trash, like a recycle bin
      return res.status(204).end();
    }
    if (m === 'MOVE' || m === 'COPY') {
      if (!r || !r.node) return res.status(404).end();
      let dest;
      try { dest = new URL(req.get('destination') || '', 'http://x'); } catch { return res.status(400).end(); }
      const dsegs = segsOf(dest.pathname);
      if (!dsegs.length) return res.status(403).end();
      const d = resolve(user, dsegs);
      if (!d) return res.status(409).end();
      if (d.node && d.node.id === r.node.id) return res.status(204).end();
      if (!canWrite(user, d.parent)) return res.status(403).end();
      const overwrite = (req.get('overwrite') || 'T').toUpperCase() !== 'F';
      if (d.node) { if (!overwrite) return res.status(412).end(); if (filePerm(user, d.node) !== 'owner') return res.status(403).end(); run('UPDATE files SET trashed = 1 WHERE id = ?', d.node.id); }
      let title = plainText(d.name, 200);
      if (NATIVE_EXT[r.node.kind]) title = title.replace(new RegExp(`\\.${NATIVE_EXT[r.node.kind]}$`, 'i'), '');
      if (m === 'MOVE') {
        if (filePerm(user, r.node) !== 'owner') return res.status(403).end();
        for (let p = d.parent, i = 0; p && i < 32; i++) { if (p.id === r.node.id) return res.status(409).end(); p = p.parent_id ? one('SELECT * FROM files WHERE id = ?', p.parent_id) : null; }
        run('UPDATE files SET title = ?, parent_id = ?, updated_at = ? WHERE id = ?', title, d.parent ? d.parent.id : null, Date.now(), r.node.id);
      } else {
        let n = 0;
        const copy = (src, parentId, t) => {
          if (++n > 2000) throw bad('That folder is too big to copy in one go.');
          const nf = insertFile(user, { kind: src.kind, title: t, parent_id: parentId, content: src.content ? JSON.parse(src.content) : undefined, blob: src.blob ? Buffer.from(src.blob) : undefined, mime: src.mime, size: src.size });
          if (src.kind === 'folder') for (const c of all('SELECT * FROM files WHERE parent_id = ? AND trashed = 0', src.id)) copy(c, nf.id, c.title);
        };
        tx(() => copy(r.node, d.parent ? d.parent.id : null, title));
      }
      return res.status(d.node ? 204 : 201).end();
    }
    res.status(405).end();
  }));

  return { saveBlob, checkQuota };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cssColor = (c) => (typeof c === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(c) ? c : null);
function fmtBytes(n) { if (n < 1024) return n + ' B'; const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < 3); return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i]; }
const MIMES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', mp3: 'audio/mpeg', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip', svg: 'image/svg+xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const mimeFor = (name) => MIMES[(String(name).split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

module.exports = { attachVault, fmtBytes, mimeFor };
