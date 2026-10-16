/*
 * DockCast service worker (ui-spec.md §8). Plain JS, no bundler: vite.config.ts turns this
 * template into dist/sw.js at build time, replacing __VERSION__ with a hash of the build's
 * file list and __PRECACHE__ with that list. A new build therefore always ships a
 * byte-different sw.js, which is what makes browsers pick up the update.
 *
 * Caching, by request type:
 *   page navigations     network-first; offline → the precached app shell (index.html)
 *   /assets/* (hashed)   cache-first; kept across versions so an older open tab can still
 *                        lazy-load its chunks after a deploy removed them from the server
 *   public read API      network-first (4 s budget when a copy exists); offline → last copy
 *   map tiles/styles     stale-while-revalidate, capped
 *   web app manifest     network-first (it decides the installed app's icons)
 *   icons, other files   stale-while-revalidate
 * Everything else (auth, commutes, push, trip check, any non-GET) goes straight to the
 * network and is never cached.
 *
 * Updates: a new worker waits instead of taking over mid-session. The page shows a
 * "new version" prompt and sends SKIP_WAITING when the user accepts (src/lib/sw.ts).
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;

const SHELL_CACHE = `dockcast-shell-${VERSION}`;
const ASSET_CACHE = 'dockcast-assets';
const STATIC_CACHE = 'dockcast-static';
const API_CACHE = 'dockcast-api';
const TILE_CACHE = 'dockcast-tiles';
const LIMITS = { [ASSET_CACHE]: 300, [STATIC_CACHE]: 60, [API_CACHE]: 150, [TILE_CACHE]: 1500 };

const SHELL_URL = '/index.html';
const API_TIMEOUT_MS = 4000;
/** Public, read-only endpoints worth showing from cache when offline (docs/api.md §1–4). */
const CACHEABLE_API = /^\/api\/v1\/(cities(\/[^/]+\/(stations|map))?|stations\/\d+(\/history)?|model)$/;
const TILE_HOSTS = new Set(['tiles.openfreemap.org']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await shell.add(new Request(SHELL_URL, { cache: 'reload' }));
      const assets = await caches.open(ASSET_CACHE);
      const statics = await caches.open(STATIC_CACHE);
      await Promise.all(
        PRECACHE.filter((url) => url !== SHELL_URL).map((url) =>
          (url.startsWith('/assets/') ? assets : statics).add(url).catch(() => undefined),
        ),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('dockcast-shell-') && name !== SHELL_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(navigation(request));
    } else if (url.pathname.startsWith('/assets/')) {
      event.respondWith(cacheFirst(request, ASSET_CACHE));
    } else if (url.pathname.startsWith('/api/')) {
      if (CACHEABLE_API.test(url.pathname)) event.respondWith(networkFirst(request, API_CACHE));
    } else if (url.pathname.endsWith('.webmanifest')) {
      // The manifest decides the installed app's name and icons: always the server's copy
      // when online (a stale one gave iOS an icon list it could not render).
      event.respondWith(networkFirst(request, STATIC_CACHE));
    } else if (url.pathname !== '/sw.js') {
      event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    }
    return;
  }

  if (TILE_HOSTS.has(url.hostname)) event.respondWith(staleWhileRevalidate(request, TILE_CACHE));
});

async function navigation(request) {
  try {
    return await fetch(request);
  } catch {
    const shell = await caches.open(SHELL_CACHE);
    return (await shell.match(SHELL_URL)) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await put(cache, cacheName, request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });
  const network = fetch(request).then(async (response) => {
    if (response.ok) await put(cache, cacheName, request, response.clone());
    return response;
  });
  if (!cached) return network;
  // With a copy in hand, don't let a stalled connection hang the UI.
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), API_TIMEOUT_MS));
  try {
    return await Promise.race([network, timeout]);
  } catch {
    return cached;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) await put(cache, cacheName, request, response.clone());
      return response;
    })
    .catch(() => undefined);
  if (cached) return cached;
  return (await network) || Response.error();
}

async function put(cache, cacheName, request, response) {
  // Only pages are HTML. An HTML body for an icon, script or data URL is a server fallback
  // (an older deploy answered /favicon.ico with the app shell), never something to keep.
  const type = response.headers.get('content-type') || '';
  if (request.mode !== 'navigate' && type.startsWith('text/html')) return;
  await cache.put(request, response);
  const limit = LIMITS[cacheName];
  if (!limit) return;
  const keys = await cache.keys();
  // Keys come back in insertion order: drop the oldest beyond the cap.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((key) => cache.delete(key)));
}

// ---- Push alerts (docs/api.md §7) ----

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'DockCast', {
      body: data.body || '',
      tag: data.tag,
      data: { url: data.url || '/' },
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      renotify: !!data.tag,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const client = clients.find((c) => 'focus' in c);
      if (client) {
        client.navigate(url);
        return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
