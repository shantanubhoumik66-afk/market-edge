/* Offline support: the app opens without internet (bill reading and Drive still need internet).
   App files: newest from the network when online (so updates show at once), saved copy when offline.
   Google/Gemini requests are never cached. */
const VERSION = 'pb-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/db.js', 'js/import.js', 'js/ai.js', 'js/app.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== VERSION).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(c => fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; })
    .catch(async () => (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? c.match('index.html') : Response.error()))));
});
