import { WORLD_HALF, ZONES } from '../data/world';
import { heightAt, inLava, zoneAt } from '../engine/terrain';

let cached: HTMLCanvasElement | null = null;

/** A painted top-down map of the whole world, built once. */
export function mapImage(): HTMLCanvasElement {
  if (cached) return cached;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const scale = (WORLD_HALF * 2) / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = -WORLD_HALF + (px + 0.5) * scale;
      const z = -WORLD_HALF + (py + 0.5) * scale;
      const h = heightAt(x, z);
      let col: number;
      if (inLava(x, z, h)) col = 0xff5010;
      else if (h < 0) col = h < -6 ? 0x1a3040 : 0x2a4a58;
      else col = ZONES[zoneAt(x, z)].ground;
      // Hill shading.
      const shade = h >= 0 ? Math.max(0.55, Math.min(1.35, 1 + (heightAt(x - scale, z - scale) - h) * 0.12)) : 1;
      const i = (py * size + px) * 4;
      img.data[i] = Math.min(255, ((col >> 16) & 255) * shade * 1.2);
      img.data[i + 1] = Math.min(255, ((col >> 8) & 255) * shade * 1.2);
      img.data[i + 2] = Math.min(255, (col & 255) * shade * 1.2);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  cached = c;
  return c;
}

/** World position to map pixel on a map drawn at `size` pixels. */
export const toMap = (x: number, z: number, size: number) => [((x + WORLD_HALF) / (WORLD_HALF * 2)) * size, ((z + WORLD_HALF) / (WORLD_HALF * 2)) * size] as const;
