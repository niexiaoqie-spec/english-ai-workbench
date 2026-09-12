// Service Worker - English AI Workbench (offline-first)
const CACHE_NAME = 'english-ai-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/db.js',
  '/js/fsrs.js',
  '/js/sync.js',
  '/js/daily.js',
  '/js/reading.js',
  '/js/srs.js',
  '/js/listening.js',
  '/js/speaking.js',
  '/js/profile.js',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

// Install: precache shell for instant offline launch
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // add individually so one 404 doesn't fail the whole batch
      return Promise.allSettled(STATIC_ASSETS.map((url) => cache.add(url)));
    }).then(() => self.skipWaiting())
  );
});

// Activate: purge old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/DELETE etc. always go to network

  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // cross-origin passes through

  // API GET: network-first, fall back to cache when offline
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      }).catch(() =>
        caches.match(req).then((cached) =>
          cached || new Response(JSON.stringify({ detail: '离线模式，暂无缓存数据' }), {
            status: 503, headers: { 'Content-Type': 'application/json' },
          })
        )
      )
    );
    return;
  }

  // App shell + static assets: cache-first for instant launch, refresh in background
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      }).catch(() => null);

      if (cached) {
        fetchPromise; // background refresh for next launch
        return cached;
      }
      return fetchPromise.then((response) => {
        if (response) return response;
        if (req.mode === 'navigate') return caches.match('/index.html');
        return new Response('Offline', { status: 503 });
      });
    })
  );
});
