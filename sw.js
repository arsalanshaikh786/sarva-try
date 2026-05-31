/* ═══════════════════════════════════════════════════════════
   Sarva-Nest Service Worker  v2.0
   Strategy:
   • App Shell  → Cache-First (instant loads)
   • Google Fonts / CDN  → StaleWhileRevalidate
   • Firebase API  → NetworkFirst (always try live, fallback cache)
   • Images (Unsplash / icons8) → CacheFirst with expiry
   • Navigation  → App-Shell fallback
═══════════════════════════════════════════════════════════ */

const CACHE_NAME    = 'sarva-nest-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

/* ── Install: cache app shell ── */
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

/* ── Activate: delete old caches ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch handler ── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET & chrome-extension requests
  if (request.method !== 'GET' || url.protocol === 'chrome-extension:') return;

  // Firebase / API → NetworkFirst
  if (
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.pathname.includes('/v1/') ||
    url.pathname.includes('/v2/')
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Google Fonts / CDN assets → StaleWhileRevalidate
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('img.icons8.com') ||
    url.hostname.includes('cdnjs.cloudflare.com')
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Images (Unsplash, etc.) → CacheFirst (they rarely change)
  if (
    request.destination === 'image' ||
    url.hostname.includes('unsplash.com') ||
    url.hostname.includes('images.unsplash.com')
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navigation (HTML pages) → NetworkFirst with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() =>
          caches.match(request).then(cached =>
            cached || caches.match('/offline.html')
          )
        )
    );
    return;
  }

  // Everything else → StaleWhileRevalidate
  event.respondWith(staleWhileRevalidate(request));
});

/* ─── Strategy helpers ─── */

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Network error', { status: 408 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('{"error":"offline"}', {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await fetchPromise || new Response('', { status: 503 });
}

/* ── Background Sync (future use) ── */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-bookings') {
    event.waitUntil(syncPendingBookings());
  }
});

async function syncPendingBookings() {
  // Placeholder – extend to POST queued bookings when online
  console.log('[SW] Syncing pending bookings...');
}

/* ── Push Notifications ── */
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Sarva-Nest', {
      body   : data.body   || 'You have a new update.',
      icon   : '/icons/icon-192.png',
      badge  : '/icons/icon-72.png',
      vibrate: [100, 50, 100],
      data   : { url: data.url || '/' },
      actions: [
        { action: 'open',    title: '📱 Open App' },
        { action: 'dismiss', title: '✕ Dismiss'   }
      ]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url === targetUrl && 'focus' in c);
      if (existing) return existing.focus();
      return clients.openWindow(targetUrl);
    })
  );
});
