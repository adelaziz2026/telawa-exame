// Offline support: the app shell and the Quran text are cached; recitation audio and APIs still need the internet.
const VERSION = 'tarteel-v20';
const SHELL = ['./', 'index.html', 'style.css', 'compare.js', 'learning.js', 'asr.js', 'app.js', 'assistant.js', 'meet.html', 'meet.css', 'meet.js', 'board.js', 'appboard.js', 'manifest.webmanifest', 'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
const DATA = ['data/quran.json', 'data/simple.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll([...SHELL, ...DATA])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('tarteel-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // The deep-learning library and its WASM runtime come from jsdelivr and are versioned: cache them for offline use.
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); } return res; })));
    return;
  }
  if (url.origin !== location.origin) return;
  // Live server endpoints (the meeting's event stream, the assistant) are never cached: an endless stream would
  // never finish saving, and stale answers would be wrong.
  if (url.pathname.includes('/api/')) return;
  // The Quran text never changes: serve it from the cache. Everything else: network first so updates show up.
  if (url.pathname.includes('/data/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
    return;
  }
  // Always revalidate with the server, so a stale browser-cached file never mixes with newer ones.
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
});
