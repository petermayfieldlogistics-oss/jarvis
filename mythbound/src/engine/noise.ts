// Small seeded 2D gradient noise, enough for terrain and scattering.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const perm = new Uint8Array(512);
const grads: [number, number][] = [];
{
  const rand = mulberry32(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) {
    const a = rand() * Math.PI * 2;
    grads.push([Math.cos(a), Math.sin(a)]);
  }
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Gradient noise in roughly [-1, 1]. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const g = (ix: number, iy: number, dx: number, dy: number) => {
    const gr = grads[perm[(perm[ix & 255] + iy) & 255]];
    return gr[0] * dx + gr[1] * dy;
  };
  const u = fade(xf);
  const v = fade(yf);
  const n00 = g(xi, yi, xf, yf);
  const n10 = g(xi + 1, yi, xf - 1, yf);
  const n01 = g(xi, yi + 1, xf, yf - 1);
  const n11 = g(xi + 1, yi + 1, xf - 1, yf - 1);
  const a = n00 + u * (n10 - n00);
  const b = n01 + u * (n11 - n01);
  return (a + v * (b - a)) * 1.4;
}

export function fbm(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
