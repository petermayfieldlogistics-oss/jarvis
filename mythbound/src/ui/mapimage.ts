import { WORLD_HALF, ZONES } from '../data/world';
import { heightAt, inLava, zoneAt } from '../engine/terrain';

/** Pixels across the map: 4 m a pixel. */
const SIZE = 448;

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D;
let img: ImageData;
/** Rows still to paint, the nearest to the hero last (popped first), and which are done. */
let rows: number[] | null = null;
const painted = new Uint8Array(SIZE);
/** The row being painted, and how far along it (a row is painted a chunk at a time, so no frame overruns its budget). */
let row = -1;
let col = 0;
let west = 0;
const CHUNK = 32;

/**
 * A painted top-down map of the whole world. It fills in a few rows each
 * frame (paintMap), around the hero first, so painting the big world never
 * stalls the game.
 */
export function mapImage(): HTMLCanvasElement {
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  ctx = canvas.getContext('2d')!;
  img = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < img.data.length; i += 4) (img.data[i] = 11), (img.data[i + 1] = 10), (img.data[i + 2] = 8), (img.data[i + 3] = 255);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Paints more of the map for about `ms` milliseconds, rows nearest (x, z) first. False once it is all painted. */
export function paintMap(ms: number, x: number, z: number): boolean {
  mapImage();
  const here = Math.max(0, Math.min(SIZE - 1, Math.floor(toMap(x, z, SIZE)[1])));
  // First paint, or the hero has gone somewhere unpainted (fast travel): paint outward from them.
  if (!rows || (!painted[here] && rows.length && rows[rows.length - 1] !== here)) {
    rows = [];
    for (let d = SIZE - 1; d >= 0; d--) {
      if (d > 0 && here - d >= 0 && !painted[here - d]) rows.push(here - d);
      if (here + d < SIZE && !painted[here + d]) rows.push(here + d);
    }
  }
  const t0 = performance.now();
  while ((row >= 0 || rows.length) && performance.now() - t0 < ms) {
    if (row < 0) {
      row = rows.pop()!;
      col = 0;
      west = heightAt(-WORLD_HALF, -WORLD_HALF + (row + 0.5) * ((WORLD_HALF * 2) / SIZE));
    }
    const end = Math.min(SIZE, col + CHUNK);
    paintSpan(row, col, end);
    ctx.putImageData(img, 0, 0, col, row, end - col, 1);
    col = end;
    if (col >= SIZE) (painted[row] = 1), (row = -1);
  }
  return row >= 0 || rows.length > 0;
}

/** Paints pixels [from, to) of a row (`west` carries the height to their west, for the hill shading). */
function paintSpan(py: number, from: number, to: number) {
  const scale = (WORLD_HALF * 2) / SIZE;
  const z = -WORLD_HALF + (py + 0.5) * scale;
  for (let px = from; px < to; px++) {
    const x = -WORLD_HALF + (px + 0.5) * scale;
    const h = heightAt(x, z);
    let rgb: number;
    if (inLava(x, z, h)) rgb = 0xff5010;
    else if (h < 0) rgb = h < -12 ? 0x14283a : h < -6 ? 0x1a3040 : 0x2a4a58;
    else {
      const zone = zoneAt(x, z);
      rgb = zone === 'peaks' && h > 55 ? 0xd8dee4 : ZONES[zone].ground;
    }
    // Hill shading, lit from the west.
    const shade = h >= 0 ? Math.max(0.55, Math.min(1.35, 1 + (west - h) * 0.12)) : 1;
    west = h;
    const i = (py * SIZE + px) * 4;
    img.data[i] = Math.min(255, ((rgb >> 16) & 255) * shade * 1.2);
    img.data[i + 1] = Math.min(255, ((rgb >> 8) & 255) * shade * 1.2);
    img.data[i + 2] = Math.min(255, (rgb & 255) * shade * 1.2);
  }
}

/** World position to map pixel on a map drawn at `size` pixels. */
export const toMap = (x: number, z: number, size: number) => [((x + WORLD_HALF) / (WORLD_HALF * 2)) * size, ((z + WORLD_HALF) / (WORLD_HALF * 2)) * size] as const;
