/* Lyceum's service worker (issue #267). The app shell is served cache-first, so
   a cold start draws without the network; the read-mostly course and workshop
   API is stale-while-revalidate. Discussions, messages and the practice deck are never cached:
   the chat polls them, and a cached answer would hide the reply it waits for.
   The server stamps BUILD with a hash of public/, so every deploy is a new
   worker with a new cache and the old one is dropped on activate. */
const BUILD = '__BUILD__';
const SHELL = `lyceum-shell-${BUILD}`;
const API = `lyceum-api-${BUILD}`;
const SHELL_FILES = [
  '/', '/app.js', '/markdown.js', '/vendor/preact-htm.js', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png',
];
const CACHED_API = /^\/api\/(courses|chapters|workshop)(\/|$)/;
const NEVER_CACHED = /\/practice$/;   // the deck is ordered by his last answers

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== API).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function staleWhileRevalidate(req) {
  return caches.open(API).then((cache) => cache.match(req).then((hit) => {
    const fresh = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    if (!hit) return fresh;
    fresh.catch(() => {});
    return hit;
  }));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (CACHED_API.test(url.pathname) && !NEVER_CACHED.test(url.pathname)) e.respondWith(staleWhileRevalidate(req));
    return;
  }
  // Every page is the one shell, which then routes, so a navigation anywhere
  // is answered by the cached index.
  const key = req.mode === 'navigate' ? '/' : req;
  e.respondWith(caches.open(SHELL).then((c) => c.match(key)).then((hit) => hit || fetch(req)));
});
