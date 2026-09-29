// Service worker: lets the app open offline and be installed to the home screen.
// This site's own files are cached. Card data comes from the card databases and
// is fetched fresh; card images are too, except for sites that ask apps to keep
// their own copy (see SAVED_IMAGE_HOSTS).
const CACHE = 'card-scanner-v2';
// Kept across app updates so saved images aren't downloaded again.
const IMAGE_CACHE = 'card-images-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

// YGOPRODeck asks apps not to hotlink card images over and over, so each image
// is downloaded once and then served from this device.
const SAVED_IMAGE_HOSTS = ['images.ygoprodeck.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== IMAGE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function savedImage(url) {
  const cache = await caches.open(IMAGE_CACHE);
  const hit = await cache.match(url);
  if (hit) return hit;
  // A CORS copy is stored compactly; if the host doesn't allow that, keep an opaque one.
  let res = await fetch(url, { mode: 'cors', credentials: 'omit' }).catch(() => null);
  if (!res || !res.ok) res = await fetch(url, { mode: 'no-cors', credentials: 'omit' });
  if (res.ok || res.type === 'opaque') cache.put(url, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;

  if (SAVED_IMAGE_HOSTS.includes(url.hostname)) {
    event.respondWith(savedImage(req.url));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Network first so updates show up; fall back to the cached app offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Hashed build files never change, so cache-first is safe. Everything else
  // (OCR engine files, icons) is served from cache and refreshed in the background.
  const immutable = url.pathname.includes('/assets/');
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached ?? Response.error());
      if (cached) {
        if (!immutable) event.waitUntil(network);
        return cached;
      }
      return network;
    }),
  );
});
