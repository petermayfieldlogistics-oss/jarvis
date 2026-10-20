// Mythbound's service worker (started by src/engine/offline.ts): keeps the
// game's own files on this device, so a later visit starts at once, even on
// a slow connection, and solo play works offline.
//  - The page itself comes from the network first, so a new version shows up
//    at once; the kept copy is used offline, or when the network is very slow.
//  - assets/ holds build files named after their content (a kept copy is
//    never out of date): from here first, else downloaded and kept.
// Nothing from another site (the co-op and account server, the fonts) and
// nothing outside this folder is touched.
const CACHE = 'mythbound-v1';
const SCOPE = self.registration.scope;
const ASSETS = SCOPE + 'assets/';
/** How long a page waits on the network before the kept copy is used. */
const PATIENCE_MS = 4000;
const LOOSE = { ignoreVary: true, ignoreSearch: false };

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = req.url.split('#')[0];
  if (req.mode === 'navigate') {
    const path = new URL(url).pathname;
    const home = new URL(SCOPE).pathname;
    if (path === home || path === home + 'index.html') e.respondWith(page(e));
    return;
  }
  if (url.startsWith(ASSETS) && !url.includes('?')) e.respondWith(asset(e));
});

/** The page: the network's copy, or the kept one when the network fails or is too slow. */
async function page(e) {
  const kept = await caches.open(CACHE).then((c) => c.match(SCOPE, LOOSE));
  const net = fetch(e.request);
  if (!kept) return net;
  e.waitUntil(net.catch(() => {}));
  let timer = 0;
  const slow = new Promise((resolve) => (timer = setTimeout(resolve, PATIENCE_MS, kept)));
  try {
    const res = await Promise.race([net, slow]);
    return res.ok || res.type === 'opaqueredirect' ? res : kept;
  } catch {
    return kept;
  } finally {
    clearTimeout(timer);
  }
}

/** A build file: the kept copy, else downloaded (and kept). */
async function asset(e) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(e.request, LOOSE);
  if (hit) return hit;
  const res = await fetch(e.request);
  if (res.status === 200 && res.type === 'basic') e.waitUntil(cache.put(e.request, res.clone()).catch(() => {}));
  return res;
}

// The page lists the files it has loaded: keep any not kept yet.
self.addEventListener('message', (e) => {
  const list = e.data && e.data.keep;
  if (Array.isArray(list)) e.waitUntil(keep(list.filter((u) => typeof u === 'string' && u.startsWith(SCOPE))).catch(() => {}));
});

/** Vite names build files name-HASH.ext; a new build's file replaces the old one of the same name. */
const stem = (url) => url.replace(/-[\w-]{8}(\.[^./]+)$/, '$1');

async function keep(urls) {
  const cache = await caches.open(CACHE);
  const files = urls.filter((u) => u.startsWith(ASSETS) && !u.includes('?'));
  for (const u of files) {
    if (await cache.match(u, LOOSE)) continue;
    // Usually straight from the browser's cache: the page has just downloaded it.
    const res = await fetch(u).catch(() => null);
    if (res && res.status === 200) await cache.put(u, res);
  }
  if (!urls.includes(SCOPE)) return;
  // The page itself, as the browser last had it; kept only when the code and
  // style it starts are kept too, so the kept page always works offline.
  const res = await fetch(SCOPE, { cache: 'force-cache' }).catch(() => null);
  if (!res || res.status !== 200) return;
  const html = await res.clone().text();
  const needs = [...html.matchAll(/(?:src|href)="(?:\.\/)?(assets\/[^"?#]+)"/g)].map((m) => SCOPE + m[1]);
  for (const u of needs) if (!(await cache.match(u, LOOSE))) return;
  await cache.put(SCOPE, res);
  // Older builds of these files are no longer needed.
  const current = new Set([...files, ...needs]);
  const stems = new Set([...current].map(stem));
  for (const req of await cache.keys()) {
    const u = req.url;
    if (u.startsWith(ASSETS) && !current.has(u) && stems.has(stem(u))) await cache.delete(req);
  }
}
