import * as THREE from 'three';
import { mulberry32, noise2, smoothstep } from './noise';
import { heightAt, TILE, zoneAt } from './terrain';
import { WORLD_HALF, type ZoneId } from '../data/world';

/**
 * A field of real grass blades around the hero: squares of ground CHUNK wide,
 * built nearest first a little at a time, dropped when left behind. Blades stand
 * exactly on the ground mesh (the same triangles it is drawn with), sway in the
 * zone's wind, part round the hero's feet and shrink away at the field's edge.
 */
const CHUNK = 12;

/** How thickly each land grows (0 none), and how tall its blades stand. */
const FIELD: Partial<Record<ZoneId, [density: number, height: number]>> = {
  plains: [1, 1.15], town: [0.45, 0.8], forest: [0.55, 0.9], coast: [0.45, 0.85], swamp: [0.75, 1.2],
  crossroads: [0.35, 0.8], peaks: [0.55, 0.7], elderwood: [0.6, 1], jungle: [1, 1.3], ocean: [0.5, 0.85], badlands: [0.12, 0.6],
};

/** Blade colours (root to tip), mixed with dry stalks. */
const GREEN: Partial<Record<ZoneId, number>> = {
  town: 0x6e7a34, plains: 0x8a8a38, forest: 0x46622a, coast: 0x7e8a4a, swamp: 0x4e5a2a, crossroads: 0x50504a,
  peaks: 0x627a4a, elderwood: 0x3e5a24, jungle: 0x3a7022, ocean: 0x6e8a40, badlands: 0x8a7a4a,
};
const DRY = new THREE.Color(0xb8a060);

/** Field radius and tufts per square metre (each tuft is three to five blades). */
const QUALITY = { low: { r: 15, per: 3 }, medium: { r: 24, per: 6 }, high: { r: 32, per: 8 } } as const;

const GRASS_VERT_PARS = /* glsl */ `
attribute vec2 aBlade;
uniform float uTime;
uniform vec2 uWind;
uniform vec3 uFocus;
uniform float uReach;
`;
// Sway, parting round the hero, and shrinking towards the edge of the field.
const GRASS_VERT = /* glsl */ `
{
  vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float t = aBlade.x, h = aBlade.y;
  float bend = t * t;
  float gust = sin(uTime * 1.9 + wp.x * 0.31 + wp.z * 0.23) * 0.6 + sin(uTime * 3.7 + wp.x * 0.9 - wp.z * 0.7) * 0.25;
  transformed.xz += uWind * 2.2 * bend * h * (0.55 + gust);
  vec2 away = wp.xz - uFocus.xz;
  float d = length(away);
  transformed.xz += away / max(d, 0.001) * (1.0 - smoothstep(0.2, 1.1, d)) * bend * h * 0.9;
  transformed.y -= (1.0 - smoothstep(0.2, 1.1, d)) * t * h * 0.45;
  float edge = smoothstep(uReach, uReach * 0.72, d);
  transformed.y -= (1.0 - edge) * t * h;
}
`;

export class GrassField {
  readonly root = new THREE.Group();
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly chunks = new Map<string, THREE.Mesh>();
  private job: { key: string; gen: Generator<void, THREE.Mesh | null> } | null = null;
  private readonly reach: number;
  private readonly per: number;
  private readonly focus: { value: THREE.Vector3 };
  private wantT = 0;

  /**
   * @param step  the ground mesh's grid spacing (blades follow its triangles)
   * @param avoid places kept clear (roads, arenas, docks, shrines...)
   */
  constructor(
    private readonly step: number,
    quality: keyof typeof QUALITY,
    time: { value: number },
    wind: { value: THREE.Vector2 },
    private readonly avoid: (x: number, z: number) => boolean,
  ) {
    this.reach = QUALITY[quality].r;
    this.per = QUALITY[quality].per;
    this.focus = { value: new THREE.Vector3() };
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
    const reach = { value: this.reach };
    this.mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uTime: time, uWind: wind, uFocus: this.focus, uReach: reach });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GRASS_VERT_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GRASS_VERT}`);
      // Both faces lit as the ground is (a flipped normal would turn the back of a blade black).
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    };
    this.root.name = 'grass';
  }

  update(focus: THREE.Vector3, dt: number) {
    this.focus.value.copy(focus);
    this.wantT -= dt;
    if (this.wantT <= 0 && !this.job) {
      this.wantT = 0.25;
      const r = this.reach + CHUNK;
      // Drop the squares left behind.
      for (const [key, mesh] of this.chunks) {
        const [cx, cz] = key.split(',').map(Number);
        if (Math.hypot((cx + 0.5) * CHUNK - focus.x, (cz + 0.5) * CHUNK - focus.z) > r + CHUNK) {
          this.root.remove(mesh);
          mesh.geometry.dispose();
          this.chunks.delete(key);
        }
      }
      // Start the nearest missing one.
      let best: [number, number] | null = null, bestD = Infinity;
      const c0 = Math.floor(focus.x / CHUNK), r0 = Math.floor(focus.z / CHUNK), k = Math.ceil(r / CHUNK);
      for (let cz = r0 - k; cz <= r0 + k; cz++)
        for (let cx = c0 - k; cx <= c0 + k; cx++) {
          if (this.chunks.has(`${cx},${cz}`)) continue;
          const d = Math.hypot((cx + 0.5) * CHUNK - focus.x, (cz + 0.5) * CHUNK - focus.z);
          if (d < r && d < bestD) (bestD = d), (best = [cx, cz]);
        }
      if (best) this.job = { key: `${best[0]},${best[1]}`, gen: this.build(best[0], best[1]) };
    }
    if (!this.job) return;
    const t0 = performance.now();
    while (performance.now() - t0 < 2.5) {
      const r = this.job.gen.next();
      if (!r.done) continue;
      const mesh = r.value ?? new THREE.Mesh();
      if (r.value) this.root.add(mesh);
      this.chunks.set(this.job.key, mesh);
      this.job = null;
      // A finished square may let the next start this frame.
      this.wantT = 0;
      break;
    }
  }

  dispose() {
    for (const mesh of this.chunks.values()) mesh.geometry.dispose();
    this.chunks.clear();
    this.root.clear();
    this.mat.dispose();
  }

  /** One square of blades (or null if nothing grows there). */
  private *build(cx: number, cz: number): Generator<void, THREE.Mesh | null> {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    if (Math.max(Math.abs(x0), Math.abs(z0)) > WORLD_HALF - 12) return null;
    // The ground mesh's heights round this square, on its own grid.
    const s = this.step;
    const gi0 = Math.floor(x0 / s), gj0 = Math.floor(z0 / s);
    const gn = Math.ceil(CHUNK / s) + 2;
    const hs = new Float32Array(gn * gn);
    for (let j = 0; j < gn; j++) for (let i = 0; i < gn; i++) hs[j * gn + i] = heightAt((gi0 + i) * s, (gj0 + j) * s);
    yield;
    // Same triangles as the ground: split along the (i+1, j)-(i, j+1) diagonal.
    const ground = (x: number, z: number): [number, number] => {
      const fx = x / s - gi0, fz = z / s - gj0;
      const i = Math.min(gn - 2, Math.floor(fx)), j = Math.min(gn - 2, Math.floor(fz));
      const u = fx - i, v = fz - j;
      const a = hs[j * gn + i], b = hs[j * gn + i + 1], c = hs[(j + 1) * gn + i], d = hs[(j + 1) * gn + i + 1];
      const flat = Math.max(Math.abs(b - a), Math.abs(c - a), Math.abs(d - b), Math.abs(d - c)) / s;
      return [u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v), flat];
    };
    // Which land, at a few points (zone edges wander, so blend them).
    const ZS = 4;
    const zones: ZoneId[] = [];
    for (let j = 0; j < ZS; j++) for (let i = 0; i < ZS; i++) zones.push(zoneAt(x0 + ((i + 0.5) / ZS) * CHUNK, z0 + ((j + 0.5) / ZS) * CHUNK));
    if (zones.every((z) => !FIELD[z])) return null;
    yield;

    const rand = mulberry32((((cx + 4096) * 73856093) ^ ((cz + 4096) * 19349663)) >>> 0);
    const count = Math.round(CHUNK * CHUNK * this.per);
    const pos: number[] = [], col: number[] = [], blade: number[] = [], idx: number[] = [];
    const root = new THREE.Color(), tip = new THREE.Color();
    for (let n = 0; n < count; n++) {
      const x = x0 + rand() * CHUNK, z = z0 + rand() * CHUNK;
      const r1 = rand(), r2 = rand(), r3 = rand(), r5 = rand();
      const zone = zones[Math.min(ZS - 1, Math.floor(((z - z0) / CHUNK) * ZS)) * ZS + Math.min(ZS - 1, Math.floor(((x - x0) / CHUNK) * ZS))];
      const field = FIELD[zone];
      if (!field) continue;
      // Meadows with bare patches and thick clumps.
      const patch = smoothstep(-0.35, 0.35, noise2(x / 9 + 3.1, z / 9) + 0.5 * noise2(x / 3.3, z / 3.3 + 7));
      if (r1 > field[0] * patch) continue;
      const [y, slope] = ground(x, z);
      if (y < 0.9 || slope > 0.55) continue;
      // Not on the snowfields of the heights.
      if (zone === 'peaks' && y + 8 * noise2(x / 40, z / 40) > 28) continue;
      if (this.avoid(x, z)) continue;
      const tuftH = (0.16 + 0.26 * r2 * r2 + 0.14 * patch) * field[1];
      const green = new THREE.Color(GREEN[zone] ?? 0x6e7a34).multiplyScalar(0.85 + 0.3 * r3);
      const blades = 3 + Math.floor(r5 * 3);
      for (let k = 0; k < blades; k++) {
        const q1 = rand(), q2 = rand(), q3 = rand(), q4 = rand();
        const bx = x + (q1 - 0.5) * 0.14, bz = z + (q2 - 0.5) * 0.14;
        const h = tuftH * (0.6 + 0.6 * q3);
        const w = 0.012 + 0.012 * q4;
        // Blades fan out from the tuft's heart.
        const a = Math.atan2(bz - z, bx - x) + (q4 - 0.5) * 0.8;
        const lean = (0.15 + 0.35 * q3) * h;
        const ca = Math.cos(a + Math.PI / 2), sa = Math.sin(a + Math.PI / 2);
        const ox = Math.cos(a), oz = Math.sin(a);
        // Root shaded, tip catching the light; one stalk in six dry.
        root.copy(green);
        if (q1 > 0.84) root.lerp(DRY, 0.75);
        tip.copy(root).multiplyScalar(1.3).lerp(DRY, 0.12 + 0.18 * q2);
        const mid = root.clone().lerp(tip, 0.6);
        root.multiplyScalar(0.45);
        const base = pos.length / 3;
        const pts: [number, number, number, THREE.Color][] = [
          [-w, 0, 0, root], [w, 0, 0, root],
          [-w * 0.65, 0.55, lean * 0.3, mid], [w * 0.65, 0.55, lean * 0.3, mid],
          [0, 1, lean, tip],
        ];
        for (const [px, t, out, c] of pts) {
          pos.push(bx + px * ca + out * ox, y + t * h - 0.02, bz + px * sa + out * oz);
          col.push(c.r, c.g, c.b);
          blade.push(t, h);
        }
        idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
      }
      if (n % 150 === 149) yield;
    }
    if (!idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // Lit like the ground under it, so a field reads as one surface.
    const nrm = new Float32Array(pos.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 2));
    geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    // (Swaying and parting move blades a little past their resting bounds.)
    if (geo.boundingSphere) geo.boundingSphere.radius += 1;
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'grass';
    return mesh;
  }
}

/** The ground mesh's grid spacing for a number of segments per tile. */
export const groundStep = (segs: number) => TILE / segs;
