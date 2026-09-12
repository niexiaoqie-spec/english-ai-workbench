// Service Worker - AI英语 · 离线版 (100% offline, cache-first)
// All assets and data are precached on install so the app runs with no network.
const CACHE_NAME = 'eaw-offline-v2';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/fsrs.js',
  './js/quiz.js',
  './js/tts.js',
  './js/daily.js',
  './js/reading.js',
  './js/srs.js',
  './js/listening.js',
  './js/speaking.js',
  './js/profile.js',
  './data/words.json',
  './data/dict.json',
  './data/dialogues.json',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
];

// Install: precache the full app shell + data. allSettled so a single
// missing/404 asset (e.g. a not-yet-shipped route module) never aborts install.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(PRECACHE_ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

// Activate: purge old caches, take control of open clients immediately.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: same-origin GET only. Cache-first; on miss go to network and cache
// the response. If both cache and network fail, navigations fall back to the
// cached app shell so the PWA still opens offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin passes through

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((response) => {
        // Cache successful, same-origin basic responses for next time.
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      }).catch(() => {
        // Offline with no cache: navigations get the app shell.
        if (req.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      });
    })
  );
});
