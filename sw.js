/**
 * Musico PWA Service Worker
 * - Background audio support
 * - Offline cache
 * - Media notification controls
 *
 * 🔼 BUMP THIS every time you deploy and want to be 100% sure old
 * clients pick up the change immediately. Even without bumping it,
 * updates now reach users on their NEXT visit (see network-first
 * strategy below) — but bumping forces an instant, clean cache wipe.
 */
const SW_VERSION = 'v3';
const CACHE_NAME = 'musico-' + SW_VERSION;

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/icon?family=Material+Icons',
];

// ── Install: pre-warm cache (used only as an OFFLINE fallback now) ──
self.addEventListener('install', event => {
  console.log('[SW]', SW_VERSION, 'installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Cache addAll partial fail:', err);
      });
    })
  );
  self.skipWaiting(); // activate this SW immediately, don't wait for old tabs to close
});

// ── Activate: delete every cache from older versions ──
self.addEventListener('activate', event => {
  console.log('[SW]', SW_VERSION, 'activating...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim(); // take control of already-open tabs right away
});

// ── Fetch strategy ──
// HTML / app shell → NETWORK-FIRST (always fetch the latest deploy;
//                     cache is only a fallback when there's no internet).
// Audio / Firebase  → network only (unchanged).
// Everything else   → cache-first (icons, fonts — rarely change).
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

  // Page navigations + index.html + manifest — NETWORK FIRST.
  // This is the actual fix: whatever you just deployed is what loads,
  // every time, as long as the user has internet. Cache only kicks in
  // when they're offline.
  const isAppShell =
    event.request.mode === 'navigate' ||
    event.request.url.endsWith('/') ||
    event.request.url.endsWith('index.html') ||
    event.request.url.endsWith('manifest.json');

  if (isAppShell) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Everything else (icons, fonts, etc.) — cache-first as before
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
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        if (client.id !== event.source.id) {
          client.postMessage(event.data);
        }
      });
    });
  }
  // Let the page force this SW to activate immediately (used by the
  // "update available" prompt in index.html).
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Notification click handler ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('index') && 'focus' in client) {
          client.focus();
          if (event.notification.data?.songId) {
            client.postMessage({ type: 'PLAY_SONG', songId: event.notification.data.songId });
          }
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow('./index.html');
    })
  );
});

console.log('[SW]', SW_VERSION, 'Musico Service Worker loaded ✅');
