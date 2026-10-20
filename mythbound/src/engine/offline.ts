// Keeps the game's own files on this device with a service worker
// (public/sw.js), so a later visit starts at once, even on a slow connection,
// and solo play works offline. Only in the published build: not while
// developing, and not in the single-file copy (which has no files to keep).

/** The game's files this page has loaded (the page itself, its code and style, models, ground textures). */
function ownFiles(): string[] {
  const base = new URL('./', location.href);
  const files = performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .filter((u) => u.startsWith(new URL('assets/', base).href));
  return [base.href, ...new Set(files)];
}

/**
 * Starts the service worker (once the models have downloaded, so it never
 * competes with them) and tells it which files to keep; files loaded later
 * (the ground textures when a game starts) are passed on as they arrive.
 */
export function keepOffline() {
  const built = new URL(import.meta.url).pathname.includes('/assets/');
  if (import.meta.env.DEV || !built || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => {
      const tell = () => reg.active?.postMessage({ keep: ownFiles() });
      tell();
      if (typeof PerformanceObserver === 'undefined') return;
      let soon = 0;
      new PerformanceObserver(() => {
        clearTimeout(soon);
        soon = window.setTimeout(tell, 2000);
      }).observe({ type: 'resource' });
    })
    .catch(() => {});
}
