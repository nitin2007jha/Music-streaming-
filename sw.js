/**
 * Musico PWA Service Worker
 * - Background audio support
 * - Offline cache
 * - Media notification controls
 */

const CACHE_NAME = 'musico-v1';
const STATIC_ASSETS = [
  './',
  './index-29-3.html',
  './manifest.json',
  'https://fonts.googleapis.com/icon?family=Material+Icons',
];

// ── Install: cache static assets ──
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Cache addAll partial fail:', err);
      });
    })
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ──
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: cache-first for static, network-first for audio ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Audio files — always network (can't cache large mp3s)
  if (
    event.request.url.includes('.mp3') ||
    event.request.url.includes('.m4a') ||
    event.request.url.includes('.ogg') ||
    event.request.url.includes('archive.org') ||
    event.request.url.includes('workers.dev')
  ) {
    event.respondWith(fetch(event.request).catch(() => new Response('Audio unavailable', { status: 503 })));
    return;
  }

  // Firebase — always network
  if (url.hostname.includes('firebase') || url.hostname.includes('googleapis')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  // Static assets — cache first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached || new Response('Offline', { status: 503 }));
    })
  );
});

// ── Media Session via postMessage ──
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'MEDIA_SESSION_UPDATE') {
    // Forward to all clients if needed
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        if (client.id !== event.source.id) {
          client.postMessage(event.data);
        }
      });
    });
  }
});

console.log('[SW] Musico Service Worker loaded ✅');
