// The loading screen's wait for the Blender models: how much has come in,
// and on a slow connection a way to play without waiting for them.

import { assetProgress, loadAssets } from '../engine/assets';

type Connection = { saveData?: boolean; effectiveType?: string };

/** A connection too slow (or a player saving data) to wait on 3 MB for: the game starts at once. */
export function verySlowConnection(): boolean {
  const c = (navigator as Navigator & { connection?: Connection }).connection;
  return !!c && (c.saveData === true || c.effectiveType === 'slow-2g' || c.effectiveType === '2g');
}

const mb = (n: number) => (n / 1048576).toFixed(1);

/** Seconds into the wait after which the game starts by itself, unless the models are nearly in. */
const PATIENCE = 12;

/**
 * Waits on the loading screen `el` for the Blender models, showing the
 * download. While they're still coming, "Start now" plays with the built-in
 * models instead; after PATIENCE seconds it starts by itself (unless the rest
 * is a few seconds away), and on a very slow connection at once. The
 * download carries on either way, for the next game. Resolves true when
 * starting without them.
 */
export function waitForModels(el: HTMLElement): Promise<boolean> {
  const all = loadAssets().then(() => false);
  if (assetProgress().done) return all;
  if (verySlowConnection()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const line = document.createElement('p');
    line.className = 'lprog';
    const now = document.createElement('button');
    now.className = 'startnow hidden';
    now.innerHTML = 'Start now<small>with simpler models until the full ones have downloaded</small>';
    el.append(line, now);
    const t0 = performance.now();
    const seen: [number, number][] = [];
    const timer = window.setInterval(tick, 250);
    function finish(early: boolean) {
      clearInterval(timer);
      line.remove();
      now.remove();
      resolve(early);
    }
    function tick() {
      const p = assetProgress();
      if (p.done) return;
      const t = performance.now();
      line.textContent = p.total ? `Downloading models ${mb(p.loaded)} / ${mb(p.total)} MB` : `Downloading models ${mb(p.loaded)} MB`;
      seen.push([t, p.loaded]);
      while (t - seen[0][0] > 4000) seen.shift();
      if (t - t0 > 1500) now.classList.remove('hidden');
      if (t - t0 > PATIENCE * 1000) {
        // The rate over the last few seconds says how long the rest will take.
        const rate = ((p.loaded - seen[0][1]) / Math.max(1, t - seen[0][0])) * 1000;
        const left = p.total ? (p.total - p.loaded) / Math.max(1, rate) : Infinity;
        if (left > 5) finish(true);
      }
    }
    now.addEventListener('click', () => finish(true));
    void all.then(() => finish(false));
    tick();
  });
}
