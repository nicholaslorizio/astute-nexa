/* Astute Nexa core: DOM helpers, API client, router, realtime socket, UI primitives. */
'use strict';
const Nexa = window.Nexa = { apps: {}, state: { user: null, users: [], online: new Set(), workspace: 'Astute Nexa' } };

// ---------- DOM ----------
// append() and prepend() take lists and skip empty values everywhere in the app, so a list of
// elements never shows up as "[object HTMLElement]" and a missing part never shows up as "null".
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const name of ['append', 'prepend']) {
    const orig = proto[name];
    proto[name] = function (...items) { return orig.apply(this, items.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false)); };
  }
}
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v; // only used with trusted, sanitized or static markup
      else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };
const svgNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}

// ---------- icons (original line icons, 24px grid) ----------
const ICONS = {
  write: 'M6 3h9l5 5v13H6z M15 3v5h5 M9 13h8 M9 17h6',
  grid: 'M4 4h16v16H4z M4 10h16 M4 15h16 M10 4v16 M15 4v16',
  deck: 'M3 5h18v11H3z M12 16v4 M8 20h8 M7 9h6 M7 12h9',
  huddle: 'M4 5h16v10H9l-5 4z M8 9h8 M8 12h5',
  relay: 'M3 6h18v12H3z M3 7l9 6 9-6',
  cadence: 'M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5 M8 14h3 M13 14h3 M8 17h3',
  vault: 'M3 7h7l2 2h9v10H3z M3 7V5h6',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20c0-3 3-5 6-5s6 2 6 5 M16 11a2.5 2.5 0 1 0 0-5 M17 15c2 .4 4 2 4 5',
  home: 'M3 11l9-7 9 7v9H3z M9 20v-6h6v6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-5-5',
  plus: 'M12 5v14 M5 12h14',
  apps: 'M5 5h3v3H5z M10.5 5h3v3h-3z M16 5h3v3h-3z M5 10.5h3v3H5z M10.5 10.5h3v3h-3z M16 10.5h3v3h-3z M5 16h3v3H5z M10.5 16h3v3h-3z M16 16h3v3h-3z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  share: 'M16 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M16 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.6 13.5l4.8 3 M13.4 6.5l-4.8 3',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  upload: 'M12 20V9 M7 14l5-5 5 5 M5 4h14',
  history: 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 8v4l3 2',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  video: 'M3 7h12v10H3z M15 10l6-3v10l-6-3',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3',
  micoff: 'M3 3l18 18 M9 9v3a3 3 0 0 0 5 2.2 M15 10V6a3 3 0 0 0-6-.5 M5 11a7 7 0 0 0 11.5 5.3 M19 11a7 7 0 0 1-.6 2.8 M12 18v3',
  screen: 'M3 4h18v12H3z M8 20h8 M12 16v4 M9 10l3-3 3 3 M12 7v6',
  phone: 'M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z',
  hand: 'M8 12V5a1.5 1.5 0 0 1 3 0v6 M11 11V4a1.5 1.5 0 0 1 3 0v7 M14 11V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7 6 6 0 0 1-5-3l-2.5-4a1.5 1.5 0 0 1 2.5-1.5L8 15',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M8.5 14a4 4 0 0 0 7 0 M9 9.5h.01 M15 9.5h.01',
  reply: 'M10 9V5l-7 7 7 7v-4c5 0 8 1.5 11 5-1-5-4-10-11-11z',
  edit: 'M4 20h4L19 9l-4-4L4 16z M14 6l4 4',
  close: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  folder: 'M3 7h7l2 2h9v10H3z',
  file: 'M6 3h9l5 5v13H6z M15 3v5h5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  back: 'M15 18l-6-6 6-6',
  play: 'M7 4l13 8-13 8z',
  image: 'M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M15.5 9.5h.01',
  text: 'M5 6V4h14v2 M12 4v16 M9 20h6',
  shape: 'M4 4h9v9H4z M17 20a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
  moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z',
  logout: 'M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h11',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  install: 'M12 3v12 M7 10l5 5 5-5 M4 17v3h16v-3',
  archive: 'M3 4h18v4H3z M5 8v12h14V8 M10 12h4',
  inbox: 'M3 13l3-8h12l3 8v6H3z M3 13h5l1 3h6l1-3h5',
  send: 'M3 11l18-8-8 18-2-8z M11 13l10-10',
  draft: 'M4 20h4L19 9l-4-4L4 16z',
  hash: 'M5 9h14 M4 15h14 M10 3L8 21 M16 3l-2 18',
  lock: 'M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7z M7 12h7a4 4 0 0 1 0 8H7z',
  italic: 'M14 4h-4 M14 20h-4 M14 4l-4 16',
  underline: 'M7 4v7a5 5 0 0 0 10 0V4 M5 21h14',
  strike: 'M5 12h14 M16 6a4 3 0 0 0-8 1c0 4 8 3 8 7a4 3 0 0 1-8 1',
  list: 'M9 6h11 M9 12h11 M9 18h11 M5 6h.01 M5 12h.01 M5 18h.01',
  olist: 'M10 6h10 M10 12h10 M10 18h10 M4 6h2v4 M4 10h3 M4 14h3l-3 4h3',
  checklist: 'M4 6l2 2 3-3 M4 13l2 2 3-3 M12 7h8 M12 14h8 M12 20h8',
  quote: 'M6 17h3l2-4V7H5v6h3z M14 17h3l2-4V7h-6v6h3z',
  code: 'M9 8l-5 4 5 4 M15 8l5 4-5 4',
  table: 'M3 5h18v14H3z M3 10h18 M3 15h18 M9 5v14 M15 5v14',
  alignL: 'M4 6h16 M4 10h10 M4 14h16 M4 18h10',
  alignC: 'M4 6h16 M7 10h10 M4 14h16 M7 18h10',
  alignR: 'M4 6h16 M10 10h10 M4 14h16 M10 18h10',
  undo: 'M9 14L4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5 M20 9H9a5 5 0 0 0 0 10h3',
  print: 'M6 9V3h12v6 M6 18H4v-7h16v7h-2 M6 14h12v7H6z',
  chart: 'M4 20V10 M10 20V4 M16 20v-7 M3 20h18',
  freeze: 'M3 3h18v18H3z M3 8h18 M8 3v18',
  sort: 'M7 4v16 M3 16l4 4 4-4 M14 6h7 M14 12h5 M14 18h3',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  sum: 'M18 5H6l6 7-6 7h12',
  bell: 'M6 9a6 6 0 0 1 12 0c0 6 2 8 2 8H4s2-2 2-8 M10 20a2 2 0 0 0 4 0',
  calendarPlus: 'M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5 M12 13v5 M9.5 15.5h5',
  chevL: 'M15 5l-7 7 7 7', chevR: 'M9 5l7 7-7 7', chevD: 'M5 9l7 7 7-7',
  clip: 'M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7',
  copy: 'M8 8h12v12H8z M4 16V4h12',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
};
function icon(name, size = 18, extra = {}) {
  const s = svg('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', ...extra });
  s.append(svg('path', { d: ICONS[name] || ICONS.file }));
  return s;
}

// ---------- apps ----------
const APPS = [
  { id: 'write', name: 'Write', blurb: 'Documents', color: 'var(--write)', route: '#/vault?kind=doc', kind: 'doc' },
  { id: 'grid', name: 'Grid', blurb: 'Spreadsheets', color: 'var(--grid)', route: '#/vault?kind=sheet', kind: 'sheet' },
  { id: 'deck', name: 'Deck', blurb: 'Presentations', color: 'var(--deck)', route: '#/vault?kind=deck', kind: 'deck' },
  { id: 'huddle', name: 'Huddle', blurb: 'Chat and calls', color: 'var(--huddle)', route: '#/huddle' },
  { id: 'relay', name: 'Relay', blurb: 'Mail', color: 'var(--relay)', route: '#/relay' },
  { id: 'cadence', name: 'Cadence', blurb: 'Calendar', color: 'var(--cadence)', route: '#/cadence' },
  { id: 'vault', name: 'Vault', blurb: 'Files', color: 'var(--vault)', route: '#/vault' },
];
const KIND_APP = { doc: 'write', sheet: 'grid', deck: 'deck', folder: 'vault', upload: 'vault' };
const appById = (id) => APPS.find((a) => a.id === id);
function appIcon(id, small) {
  const a = appById(id) || appById('vault');
  return h('span', { class: 'app-ico' + (small ? ' sm' : ''), style: { background: a.color } }, icon(id === 'vault' ? 'vault' : id));
}
function fileIcon(f, small = true) {
  if (f.kind === 'folder') return h('span', { class: 'app-ico' + (small ? ' sm' : ''), style: { background: 'var(--vault)' } }, icon('folder'));
  if (f.kind === 'upload') return h('span', { class: 'app-ico' + (small ? ' sm' : ''), style: { background: '#64748B' } }, icon(/^image\//.test(f.mime || '') ? 'image' : 'file'));
  return appIcon(KIND_APP[f.kind], small);
}
const fileRoute = (f) => (f.kind === 'folder' ? `#/vault/${f.id}` : f.kind === 'upload' ? `/api/files/${f.id}/raw` : `#/${KIND_APP[f.kind]}/${f.id}`);

// ---------- logo ----------
function logo(size = 30) {
  const s = svg('svg', { viewBox: '0 0 64 64', width: size, height: size, 'aria-label': 'Astute Nexa' });
  const defs = svg('defs', {}, svg('linearGradient', { id: 'nxg' + size, x1: 0, y1: 0, x2: 1, y2: 1 },
    svg('stop', { offset: '0', 'stop-color': '#6D4BFF' }), svg('stop', { offset: '.55', 'stop-color': '#3D7BFF' }), svg('stop', { offset: '1', 'stop-color': '#22C7E8' })));
  s.append(defs,
    svg('rect', { x: 2, y: 2, width: 60, height: 60, rx: 16, fill: `url(#nxg${size})` }),
    svg('path', { d: 'M19 45V19l26 26V19', fill: 'none', stroke: '#fff', 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    svg('circle', { cx: 45, cy: 19, r: 4, fill: '#fff' }));
  return s;
}

// ---------- API ----------
class ApiError extends Error { constructor(msg, status, data) { super(msg); this.status = status; this.data = data; } }
async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const opts = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (method !== 'GET') opts.headers['x-nexa-csrf'] = '1';
  if (raw !== undefined) opts.body = raw;
  else if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opts); } catch { throw new ApiError('Nexa can’t reach the server. Check your connection.', 0); }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/login')) { Nexa.state.user = null; if (!/^#\/(join|invite)/.test(location.hash)) Nexa.boot(); }
    throw new ApiError((data && data.error) || `Request failed (${res.status}).`, res.status, data);
  }
  return data;
}
api.get = (p) => api(p);
api.post = (p, body) => api(p, { method: 'POST', body });
api.put = (p, body) => api(p, { method: 'PUT', body });
api.patch = (p, body) => api(p, { method: 'PATCH', body });
api.del = (p) => api(p, { method: 'DELETE' });

// ---------- formatting ----------
const pad = (n) => String(n).padStart(2, '0');
function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  if (s < 7 * 86400) return Math.round(s / 86400) + ' d ago';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
const fmtTime = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtDate = (ts, o = {}) => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...o });
function fmtSize(n) { if (!n) return '—'; if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'; if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'; return (n / 1073741824).toFixed(2) + ' GB'; }
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
function hueFor(id) { let x = 0; for (const c of String(id)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; }
function avatar(user, size = '') {
  if (!user) user = { id: 'nexa', name: 'Nexa' };
  const el = h('span', { class: 'avatar ' + size, title: user.name, style: { background: user.id === 'nexa' ? 'var(--grad)' : `hsl(${hueFor(user.id)} 62% 50%)` } }, user.id === 'nexa' ? 'N' : initials(user.name));
  if (size !== 'sm' && user.id !== 'nexa') el.append(h('i', { class: 'dot' + (Nexa.state.online.has(user.id) ? ' on' : ''), 'data-dot': user.id }));
  return el;
}
const userById = (id) => Nexa.state.users.find((u) => u.id === id);
function debounce(fn, ms) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; d.cancel = () => clearTimeout(t); return d; }
const uid = (p = 'x') => p + Math.random().toString(36).slice(2, 9);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- toasts, modals, menus ----------
function toast(msg, kind = '') {
  let box = $('.toasts');
  if (!box) { box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind }, icon(kind === 'bad' ? 'close' : 'check', 16), h('span', {}, msg));
  box.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3200);
  t.addEventListener('click', () => t.remove());
}
const fail = (e) => toast(e && e.message ? e.message : String(e), 'bad');

function modal({ title, body, actions = [], wide, onClose }) {
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const foot = actions.length ? h('footer', {}, actions.map((a) => h('button', { class: 'btn ' + (a.kind || ''), type: a.submit ? 'submit' : 'button', onclick: async (e) => {
    if (a.submit) return; e.preventDefault();
    if (a.onClick) { const r = await a.onClick(close); if (r === false) return; }
    if (!a.keepOpen) close();
  } }, a.label))) : null;
  const form = h('form', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', onsubmit: async (e) => {
    e.preventDefault();
    const sub = actions.find((a) => a.submit);
    if (sub && sub.onClick) { const r = await sub.onClick(close); if (r === false) return; }
    close();
  } }, h('header', {}, h('h3', {}, title), h('span', { class: 'grow' }), h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': 'Close', onclick: close }, icon('close'))),
  h('div', { class: 'body' }, body), foot);
  const scrim = h('div', { class: 'scrim', onmousedown: (e) => { if (e.target === scrim) close(); } }, form);
  document.body.append(scrim);
  document.addEventListener('keydown', onKey);
  setTimeout(() => { const f = form.querySelector('input:not([type=hidden]),textarea,select'); if (f) f.focus(); }, 30);
  return { close, el: form };
}
function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    modal({ title, body: h('p', { style: { margin: 0 } }, text), onClose: () => { if (!done) resolve(false); },
      actions: [{ label: 'Cancel' }, { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { done = true; resolve(true); } }] });
  });
}
function promptBox(title, label, value = '', okLabel = 'Save') {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', { class: 'input', value });
    modal({ title, body: h('label', { class: 'field' }, label, input), onClose: () => { if (!done) resolve(null); },
      actions: [{ label: 'Cancel' }, { label: okLabel, kind: 'primary', submit: true, onClick: () => { done = true; resolve(input.value); } }] });
  });
}
function menu(anchor, items) {
  $$('.menu').forEach((m) => m.remove());
  const m = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map((it) => {
    if (it === '-') return h('div', { class: 'sep' });
    if (it.label && it.header) return h('div', { class: 'label' }, it.label);
    return h('button', { class: it.danger ? 'danger' : '', role: 'menuitem', onclick: () => { m.remove(); it.onClick && it.onClick(); } }, it.icon ? icon(it.icon, 16) : null, h('span', { class: 'grow' }, it.label), it.hint ? h('span', { class: 'muted small' }, it.hint) : null);
  }));
  document.body.append(m);
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, bottom: anchor.y, right: anchor.x, top: anchor.y };
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = r.left; if (left + mw > innerWidth - 8) left = Math.max(8, r.right - mw);
  let top = r.bottom + 4; if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  Object.assign(m.style, { left: left + 'px', top: top + 'px' });
  const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off, true); } };
  setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  return m;
}
function download(url) { const a = h('a', { href: url, download: '' }); document.body.append(a); a.click(); a.remove(); }
function pickFile(accept, multiple = false) {
  return new Promise((resolve) => {
    const i = h('input', { type: 'file', accept: accept || '', multiple, style: { display: 'none' } });
    i.addEventListener('change', () => { resolve([...i.files]); i.remove(); });
    document.body.append(i); i.click();
  });
}
const readAsDataURL = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Copied'); return; } catch { /* clipboard blocked, show it instead */ }
  const input = h('input', { class: 'input', readonly: true, value: t, onfocus: (e) => e.target.select() });
  modal({ title: 'Copy this', body: [h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Select it and press Ctrl+C (Cmd+C on a Mac).'), input], actions: [{ label: 'Done', kind: 'primary' }] });
}

// ---------- realtime ----------
const RT = Nexa.rt = { ws: null, handlers: new Map(), queue: [], retry: 0, watching: new Set(), seen: 0, timer: null };
RT.on = (type, fn) => { if (!RT.handlers.has(type)) RT.handlers.set(type, new Set()); RT.handlers.get(type).add(fn); return () => RT.handlers.get(type).delete(fn); };
// Call signals and pings are only useful right now; after a reconnect the call starts fresh, so don't save them up.
const LIVE_ONLY = new Set(['call.signal', 'ping', 'typing']);
RT.send = (msg) => { if (RT.ws && RT.ws.readyState === 1) RT.ws.send(JSON.stringify(msg)); else if (!LIVE_ONLY.has(msg.t)) RT.queue.push(msg); };
RT.connect = () => {
  clearTimeout(RT.timer); RT.timer = null;
  if (RT.ws && RT.ws.readyState <= 1) return;
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  RT.ws = ws;
  ws.onopen = () => { RT.retry = 0; RT.seen = Date.now(); for (const id of RT.watching) ws.send(JSON.stringify({ t: 'file.watch', id })); while (RT.queue.length) ws.send(JSON.stringify(RT.queue.shift())); RT.emit({ t: 'connected' }); };
  ws.onmessage = (e) => { RT.seen = Date.now(); let m; try { m = JSON.parse(e.data); } catch { return; } RT.emit(m); };
  ws.onclose = (e) => {
    if (RT.ws === ws) RT.ws = null;
    RT.emit({ t: 'disconnected' });
    if (e.code === 4001 || !Nexa.state.user) return;
    RT.retry = Math.min(RT.retry + 1, 4);
    clearTimeout(RT.timer); RT.timer = setTimeout(RT.connect, 500 * 2 ** RT.retry);
  };
};
// A connection that went quiet (sleeping laptop, phone switching networks, a server restart) can look
// open while nothing gets through. Drop it and connect again instead of waiting for the browser to notice.
RT.revive = () => {
  const w = RT.ws;
  if (w) { RT.ws = null; w.onclose = w.onmessage = null; try { w.close(); } catch { /* already closed */ } RT.emit({ t: 'disconnected' }); }
  if (Nexa.state.user) { RT.retry = 0; RT.connect(); }
};
RT.emit = (m) => { for (const fn of RT.handlers.get(m.t) || []) { try { fn(m); } catch (err) { console.error(err); } } for (const fn of RT.handlers.get('*') || []) fn(m); };
RT.close = () => { clearTimeout(RT.timer); if (RT.ws) { const w = RT.ws; RT.ws = null; w.onclose = null; w.close(); } };
RT.watch = (id) => { RT.watching.add(id); RT.send({ t: 'file.watch', id }); };
RT.unwatch = (id) => { RT.watching.delete(id); RT.send({ t: 'file.unwatch', id }); };
// Ping, and reconnect if nothing at all comes back. Timers in background tabs can run late, so this only
// reconnects when the server stayed silent after a ping, never just because a timer was slow.
RT.probe = () => {
  const w = RT.ws, sent = Date.now();
  if (!w || w.readyState !== 1) return;
  w.send(JSON.stringify({ t: 'ping' }));
  setTimeout(() => { if (RT.ws === w && w.readyState === 1 && RT.seen < sent) RT.revive(); }, 10000);
};
setInterval(RT.probe, 20000);
addEventListener('online', () => { if (!Nexa.state.user) return; if (!RT.ws || RT.ws.readyState > 1) { RT.retry = 0; RT.connect(); } else RT.probe(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !Nexa.state.user) return;
  if (!RT.ws || RT.ws.readyState > 1) { RT.retry = 0; RT.connect(); } else RT.probe();
});
RT.on('hello', (m) => { Nexa.state.online = new Set(m.online); refreshDots(); });
RT.on('presence', (m) => { if (m.online) Nexa.state.online.add(m.user_id); else Nexa.state.online.delete(m.user_id); refreshDots(); });
function refreshDots() { $$('[data-dot]').forEach((d) => d.classList.toggle('on', Nexa.state.online.has(d.dataset.dot))); }

// ---------- router ----------
const Router = Nexa.router = Nexa.Router = { routes: [], current: null };
Router.add = (pattern, fn) => Router.routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/?]+)') + '(?:\\?(?<qs>.*))?$'), fn });
Router.go = (hash) => { if (location.hash === hash) Router.resolve(); else location.hash = hash; };
Router.resolve = async () => {
  const hash = location.hash.slice(1) || '/home';
  if (Router.current && Router.current.leave) { const ok = await Router.current.leave(); if (ok === false) return; }
  Router.current = null;
  for (const r of Router.routes) {
    const m = hash.match(r.re);
    if (m) {
      const params = { ...m.groups };
      params.query = Object.fromEntries(new URLSearchParams(params.qs || ''));
      Router.current = (await r.fn(params)) || null;
      return;
    }
  }
  Router.go('#/home');
};
addEventListener('hashchange', () => {
  if (Nexa.state.user) Router.resolve();
  else if (/^#\/(join|invite)\//.test(location.hash) && Nexa.boot) Nexa.boot();
});
addEventListener('beforeunload', (e) => { if (Router.current && Router.current.dirty && Router.current.dirty()) { e.preventDefault(); e.returnValue = ''; } });

// ---------- theme ----------
function applyTheme(t) { if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t; try { localStorage.setItem('nexa-theme', t); } catch { /* private mode */ } }
try { const t = localStorage.getItem('nexa-theme'); if (t && t !== 'system') document.documentElement.dataset.theme = t; } catch { /* ignore */ }

Object.assign(Nexa, { h, $, $$, clear, svg, icon, ICONS, APPS, KIND_APP, appById, appIcon, fileIcon, fileRoute, logo, api, ApiError, pad, timeAgo, fmtTime, fmtDate, fmtSize,
  initials, avatar, userById, debounce, uid, escapeHtml, toast, fail, modal, confirmBox, promptBox, menu, download, pickFile, readAsDataURL, copyText, applyTheme, hueFor });
