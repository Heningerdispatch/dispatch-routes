// Offline support: keeps the app's own files and the Firebase library on the phone.
// Own files: network first (so updates arrive), cached copy when there's no signal. Firebase library: cache first.
const CACHE = 'dispatch-routes-v2';
const FB = 'https://www.gstatic.com/firebasejs/10.14.1/';
const SHELL = ['./', './index.html', './admin.html', './app.css', './backend.js', './backend-firebase.js', './firebase-config.js',
  './common.js', './crew.js', './admin.js', './manifest.webmanifest', './admin.webmanifest', './setup.html', './icon-192.png', './icon-512.png',
  FB + 'firebase-app.js', FB + 'firebase-auth.js', FB + 'firebase-firestore.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.href.startsWith(FB)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
    return;
  }
  if (url.origin !== self.location.origin) return;   // Firestore/Auth traffic is handled by Firebase itself
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
});
