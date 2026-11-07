/*
 * Agrowth service worker: lets the app open and run with no connection.
 *
 * - Pages: tried on the network first (so updates arrive), falling back to the saved app
 *   shell when there's no signal or it's too slow.
 * - The app's own code, styles and icons: saved the first time they load, then served from
 *   the phone. Their file names change with every release, so a saved copy is never stale.
 * - Nothing else is cached here. Data from Supabase is never stored by this worker; the
 *   app keeps the agent's work list and unsent visits itself (IndexedDB). Map tiles are left
 *   to the browser's normal caching: the tile providers' terms don't allow bulk offline copies.
 */
const SHELL = 'agrowth-shell-v1';
const ASSETS = 'agrowth-assets-v1';
const KEEP = [SHELL, ASSETS];
const MAX_ASSETS = 150;
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Keeps the asset cache from growing without end across releases. */
async function trim() {
  const cache = await caches.open(ASSETS);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(k);
}

async function page(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), NETWORK_TIMEOUT_MS)),
    ]);
    if (response.ok) await cache.put('/', response.clone());
    return response;
  } catch {
    return (await cache.match('/')) ?? Response.error();
  }
}

/** Versioned build files never change: the saved copy is always right. */
async function asset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(ASSETS);
    await cache.put(request, response.clone());
    void trim();
  }
  return response;
}

/** Icons and the manifest keep their names: serve the saved copy, refresh it behind. */
async function refreshing(event) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(event.request);
  const fresh = fetch(event.request)
    .then((r) => (r.ok ? cache.put(event.request, r.clone()).then(() => r) : r))
    .catch(() => cached ?? Response.error());
  if (cached) {
    event.waitUntil(fresh);
    return cached;
  }
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(page(request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(asset(request));
  } else if (
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/favicon.svg' ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(refreshing(event));
  }
});
