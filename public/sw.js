/* Astute Nexa service worker: makes Nexa installable and keeps the app shell
   available offline. Your files and messages always come live from the server. */
'use strict';
const CACHE = 'nexa-shell-v2';
const SHELL = ['/', '/index.html', '/css/nexa.css', '/manifest.webmanifest', '/icons/icon.svg', '/shared/formula.js', '/shared/themes.js',
  ...['core', 'auth', 'shell', 'editor-common', 'write', 'grid', 'deck', 'huddle', 'relay', 'cadence', 'vault', 'main'].map((n) => `/js/${n}.js`)];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (/^\/(api|dav|s|ws|w|sso|cloud|call)(\/|$)/.test(u.pathname)) return; // live data, workspace links and sign-in are never cached
  // Network first so updates land at once; fall back to the cached shell offline.
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && SHELL.includes(u.pathname)) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then((m) => m || caches.match('/index.html'))));
});
