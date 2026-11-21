/* India_edge service worker: makes the app installable and usable offline.
   Network first for everything (so you always see the newest data when online),
   falling back to the last saved copy when offline. Only same-origin files are cached;
   YouTube and news links are never touched. Change VERSION to force a clean cache. */
const VERSION = 'edge-v4';
const SHELL = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Cache key without the ?t= cache-buster, so data.json?t=123 and ?t=456 share one saved copy
  const key = url.origin + url.pathname;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(key, copy));
      }
      return res;
    }).catch(() => caches.match(key).then(hit => hit ||
      (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
