import * as THREE from 'three';
import { fbm, lerp, noise2, smoothstep, tileableNoise } from './noise';
import { CINDER_CONES, ISLAND, ISLES, LAVA_POOLS, OASES, PASS, SHRINES, TOWN, TRIALS, VOLCANO, WORLD_HALF, ZONES, type ZoneId } from '../data/world';

export const WATER_LEVEL = 0;
/** Depth at which you start swimming. */
export const SWIM_DEPTH = 1.3;

const dist = (x: number, z: number, p: { x: number; z: number }) => Math.hypot(x - p.x, z - p.z);

const RIM = 88 * Math.pow(1 - VOLCANO.crater / VOLCANO.radius, 1.4);
export const CRATER_FLOOR = RIM - 20;
export const LAVA_LEVEL = RIM - 22.5;
/** The surface of the Cinderwaste's lava pools. */
export const POOL_LAVA = 2.2;

/** Ridged noise in [0, 1]: sharp crests where the noise crosses zero (mountain ridges). */
function ridged(x: number, y: number, octaves: number): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const r = 1 - Math.abs(noise2(x * freq + i * 17.3, y * freq - i * 9.1));
    sum += amp * r * r;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

/** Distance from a point to the pass through the Frostspine (a chain of segments). */
function passDist(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < PASS.length - 1; i++) {
    const [ax, az] = PASS[i], [bx, bz] = PASS[i + 1];
    const vx = bx - ax, vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return best;
}

// The outer lands' ground, each on its own (blended in by outerHeight).

/** The Frostspine: ridged peaks rising northward, parted by a pass. */
function peaksHeight(x: number, z: number): number {
  const rise = smoothstep(-430, -720, z) * smoothstep(16, 70, passDist(x, z));
  return 10 + 4 * fbm(x / 50, z / 50, 3) + rise * (16 + 115 * Math.pow(ridged(x / 270, z / 270, 4), 1.5));
}

/** The Cinderwaste: black plains, small cinder cones, pools of lava. */
function cinderHeight(x: number, z: number): number {
  let h = 5 + 4 * fbm(x / 90 + 2, z / 90, 3) + 1.2 * fbm(x / 14, z / 14, 2);
  for (const c of CINDER_CONES) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < c.r) h += c.h * Math.pow(1 - d / c.r, 1.6) - (d < c.r * 0.16 ? c.h * 0.3 * (1 - d / (c.r * 0.16)) : 0);
  }
  for (const p of LAVA_POOLS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r * 1.6) h = lerp(h + (d > p.r ? 1.2 * (1 - smoothstep(p.r, p.r * 1.6, d)) : 0), POOL_LAVA - 1.2, 1 - smoothstep(p.r * 0.8, p.r * 1.05, d));
  }
  return h;
}

/** The Sea of Sand: long dunes, and oases. */
function dunesHeight(x: number, z: number): number {
  let h = 7 + 12 * Math.pow(Math.abs(Math.sin((x * 0.82 + z * 0.57) / 42 + 3.2 * fbm(x / 170, z / 170, 2))), 1.5) + 4 * fbm(x / 60, z / 60, 2);
  for (const o of OASES) {
    const d = Math.hypot(x - o.x, z - o.z);
    if (d < o.r * 2.6) h = lerp(h, lerp(-1.7, 1.4, smoothstep(o.r * 0.7, o.r * 1.1, d)), 1 - smoothstep(o.r * 1.2, o.r * 2.6, d));
  }
  return h;
}

/** The Elderwood: high rolling forest hills. */
const elderHeight = (x: number, z: number) => 9 + 9 * fbm(x / 110 + 3, z / 110, 4) + 3 * fbm(x / 28, z / 28, 2);

/** The Verdant Tangle: low, wet ground cut by streams. */
function jungleHeight(x: number, z: number): number {
  const h = 3.8 + 6 * fbm(x / 80 + 9, z / 80, 4);
  const stream = 1 - smoothstep(0.025, 0.07, Math.abs(fbm(x / 210, z / 210 + 4, 3)));
  return lerp(h, -1.9, stream);
}

/** The Wine-Dark Sea: deep water and its islands. */
function oceanHeight(x: number, z: number): number {
  let h = -20 + 5 * fbm(x / 140, z / 140, 3);
  for (const s of ISLES) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < s.r * 1.6) h = lerp(h, 1.5 + s.h * (1 - smoothstep(0, s.r, d)) + 1.5 * fbm(x / 18, z / 18, 2), 1 - smoothstep(s.r * 0.75, s.r * 1.5, d));
  }
  return h;
}

/** Beyond the heartland: the outer lands blended in by which edge is near (corners mix two). */
function outerHeight(x: number, z: number, h0: number): number {
  const wN = smoothstep(-400, -540, z), wS = smoothstep(400, 540, z), wE = smoothstep(400, 540, x), wW = smoothstep(-400, -540, x);
  const w = Math.max(wN, wS, wE, wW);
  if (w <= 0) return h0;
  const mix = (a: () => number, b: () => number, k: number) => (k <= 0 ? a() : k >= 1 ? b() : lerp(a(), b(), k));
  let sum = 0, hs = 0;
  // (Molten Peak's northern flank stands up out of the Frostspine's foothills.)
  const flank = Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.radius ? h0 : -Infinity;
  if (wN > 0) (hs += wN * Math.max(flank, mix(() => peaksHeight(x, z), () => cinderHeight(x, z), smoothstep(200, 380, x)))), (sum += wN);
  // The corners belong to one land each: the Cinderwaste (NE), the sea (SE), the jungle (SW), the Frostspine (NW).
  const south = smoothstep(140, 260, z), north = smoothstep(-330, -450, z);
  if (wE > 0) (hs += wE * mix(() => mix(() => dunesHeight(x, z), () => oceanHeight(x, z), south), () => cinderHeight(x, z), north)), (sum += wE);
  if (wS > 0) (hs += wS * mix(() => oceanHeight(x, z), () => jungleHeight(x, z), smoothstep(-200, -330, x))), (sum += wS);
  if (wW > 0) (hs += wW * mix(() => mix(() => elderHeight(x, z), () => jungleHeight(x, z), smoothstep(220, 340, z)), () => peaksHeight(x, z), north)), (sum += wW);
  return lerp(h0, hs / sum, w);
}

/** Terrain height before places are flattened. */
function rawHeight(x: number, z: number): number {
  let h = 4 + 5 * fbm(x / 140, z / 140, 4) + 1.5 * fbm(x / 35, z / 35, 2);

  const forest = smoothstep(-90, -170, x) * (1 - smoothstep(110, 160, z));
  h += forest * (8 * fbm(x / 70 + 5, z / 70, 3) + 5);

  const desert = smoothstep(95, 170, x) * (1 - smoothstep(140, 190, z)) * smoothstep(-175, -120, z);
  h += desert * (5 * Math.abs(Math.sin(x / 22 + 3 * fbm(x / 90, z / 90, 2))) + 2);

  const badlands = smoothstep(140, 190, x) * smoothstep(-130, -180, z);
  h += badlands * (4 + smoothstep(0.12, 0.3, fbm(x / 55, z / 55, 3)) * 16);

  const cross = smoothstep(-140, -190, x) * smoothstep(-140, -190, z);
  h += cross * (8 + 5 * fbm(x / 40, z / 40, 3));

  const sea = smoothstep(130, 205, z) * smoothstep(-175, -120, x);
  h = lerp(h, -14 + 3 * fbm(x / 60, z / 60, 2), sea);

  const swamp = smoothstep(-115, -170, x) * smoothstep(95, 150, z);
  h = lerp(h, 0.35 + 1.8 * fbm(x / 22, z / 22, 3), swamp);

  const island = 1 - smoothstep(ISLAND.radius * 0.8, ISLAND.radius * 1.5, dist(x, z, ISLAND));
  if (island > 0) h = lerp(h, 3 + fbm(x / 20, z / 20, 2), island);

  // Molten Peak: a cone with a crater, a basalt platform and a ring of lava.
  const dv = dist(x, z, VOLCANO);
  if (dv < VOLCANO.radius) {
    const cone = 88 * Math.pow(1 - dv / VOLCANO.radius, 1.4) + 2 * noise2(x / 9, z / 9);
    if (dv > VOLCANO.crater) h += cone;
    else {
      const toRim = smoothstep(VOLCANO.crater - 4, VOLCANO.crater, dv);
      const toPlatform = smoothstep(VOLCANO.platform, VOLCANO.platform - 2, dv);
      const floor = lerp(LAVA_LEVEL - 3, CRATER_FLOOR, toPlatform);
      h = lerp(floor, RIM + h, toRim);
    }
  }

  h = outerHeight(x, z, h);

  // The world's edge: mountains (the open sea just runs on until the world ends).
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > WORLD_HALF - 70 && h > -3) h += Math.pow((edge - (WORLD_HALF - 70)) / 70, 2) * 70 * (0.7 + 0.3 * fbm(x / 30, z / 30, 2));
  return h;
}

const flatSpots: { x: number; z: number; r: number; fade: number; h: number }[] = [];
function initFlatSpots() {
  if (flatSpots.length) return;
  for (const t of TRIALS) {
    if (t.id === 'forge') continue;
    // The Serpent's Shoal drops steeply into deep water, so the Leviathan can rise right beside the sand.
    const steep = t.id === 'deep';
    flatSpots.push({ x: t.x, z: t.z, r: t.radius + (steep ? 1 : 4), fade: steep ? 6 : 22, h: Math.max(2.5, rawHeight(t.x, t.z)) });
  }
  for (const s of SHRINES) flatSpots.push({ x: s.x, z: s.z, r: 5, fade: 8, h: Math.max(1.2, rawHeight(s.x, s.z)) });
}

export function heightAt(x: number, z: number): number {
  initFlatSpots();
  let h = rawHeight(x, z);
  const town = 1 - smoothstep(TOWN.radius - 6, TOWN.radius + 24, dist(x, z, TOWN));
  if (town > 0) h = lerp(h, 3.2 + 0.4 * noise2(x / 12, z / 12), town);
  for (const f of flatSpots) {
    const d = dist(x, z, f);
    if (d < f.r + f.fade) h = lerp(h, f.h, 1 - smoothstep(f.r, f.r + f.fade, d));
  }
  return h;
}

export function zoneAt(x: number, z: number): ZoneId {
  const px = x + 34 * noise2(x / 110 + 11, z / 110) + 10 * noise2(x / 30, z / 30 + 3);
  const pz = z + 34 * noise2(x / 110, z / 110 + 7) + 10 * noise2(x / 30 + 5, z / 30);
  if (dist(x, z, TOWN) < TOWN.radius) return 'town';
  if (dist(px, pz, VOLCANO) < VOLCANO.radius * 0.8) return 'volcano';
  const ax = Math.abs(px), az = Math.abs(pz);
  if (Math.max(ax, az) > 450) {
    // The outer lands, by which edge is nearest.
    if (az >= ax) return pz < 0 ? (px > 290 ? 'cinder' : 'peaks') : px < -265 ? 'jungle' : 'ocean';
    if (pz < -390) return px > 0 ? 'cinder' : 'peaks';
    return px > 0 ? (pz > 200 ? 'ocean' : 'dunes') : pz > 280 ? 'jungle' : 'elderwood';
  }
  if (px < -140 && pz > 115) return 'swamp';
  if (pz > 135 || dist(x, z, ISLAND) < ISLAND.radius * 1.6) return 'coast';
  if (px < -150 && pz < -150) return 'crossroads';
  if (px > 150 && pz < -140) return 'badlands';
  if (px < -110) return 'forest';
  if (px > 115) return 'desert';
  return 'plains';
}

export function inLava(x: number, z: number, y: number): boolean {
  const dv = dist(x, z, VOLCANO);
  if (dv > VOLCANO.platform + 0.5 && dv < VOLCANO.crater - 1 && y < LAVA_LEVEL + 1.2) return true;
  if (y > POOL_LAVA + 1.2) return false;
  for (const p of LAVA_POOLS) if (dist(x, z, p) < p.r * 0.85) return true;
  return false;
}

export function waterDepth(x: number, z: number): number {
  return WATER_LEVEL - heightAt(x, z);
}

export function normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 1;
  out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e));
  return out.normalize();
}

// ---------------------------------------------------------------- mesh --

let detailTex: THREE.DataTexture | null = null;
/**
 * A tiling 256² detail texture shared by the terrain, water and sky:
 * B = fractal height, RG = its slope (0.5 = flat), A = a second, blotchier noise.
 */
export function detailTexture(): THREE.DataTexture {
  if (detailTex) return detailTex;
  const N = 256;
  const h = tileableNoise(N, 8, 5, 3);
  const a = tileableNoise(N, 4, 4, 11);
  const data = new Uint8Array(N * N * 4);
  const at = (x: number, y: number) => h[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const dx = (at(x + 1, y) - at(x - 1, y)) * 6;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 6;
      data[i] = Math.max(0, Math.min(255, 128 + dx * 255));
      data[i + 1] = Math.max(0, Math.min(255, 128 + dy * 255));
      data[i + 2] = h[y * N + x] * 255;
      data[i + 3] = a[y * N + x] * 255;
    }
  detailTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
  detailTex.magFilter = THREE.LinearFilter;
  detailTex.minFilter = THREE.LinearMipmapLinearFilter;
  detailTex.generateMipmaps = true;
  detailTex.anisotropy = 4;
  detailTex.needsUpdate = true;
  return detailTex;
}

/** Secondary ground tones, blended in large patches so zones are not one flat colour. */
const PATCH: Record<ZoneId, number> = {
  town: 0x5a5e32, plains: 0x5f6a2c, forest: 0x403a24, desert: 0xc4a070, volcano: 0x2a2421,
  coast: 0x9a9070, swamp: 0x3a3a20, crossroads: 0x2e2c3a, badlands: 0x7e5434,
  peaks: 0x5a6a4a, cinder: 0x1e1816, dunes: 0xdcb87a, elderwood: 0x3a3218, jungle: 0x2a6a24, ocean: 0x5a7a3a,
};

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();
const tmpC = new THREE.Color();

const TERRAIN_VERT_PARS = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNrm;
`;
const TERRAIN_VERT = /* glsl */ `
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);
`;
const TERRAIN_FRAG_PARS = /* glsl */ `
uniform sampler2D uDetail;
varying vec3 vWPos;
varying vec3 vWNrm;
`;
// World-space detail: noise breaks up the albedo, steep ground gets rock
// strata, wet sand darkens and shines at the waterline.
const TERRAIN_COLOR = /* glsl */ `
vec3 tN = normalize(vWNrm);
float tRock = smoothstep(0.14, 0.42, 1.0 - tN.y);
vec4 tD1 = texture2D(uDetail, vWPos.xz * 0.09);
vec4 tD2 = texture2D(uDetail, vWPos.xz * 0.017 + 0.37);
// Cliffs sample the noise side-on (squashed vertically) so it does not smear down the face.
#ifdef TERRAIN_HQ
vec4 tD0 = texture2D(uDetail, vWPos.xz * 0.43 + 0.11);
float tSide = smoothstep(0.3, 0.7, abs(tN.x) / (abs(tN.x) + abs(tN.z) + 1e-4));
vec4 tR = mix(texture2D(uDetail, vWPos.xy * vec2(0.09, 0.2)), texture2D(uDetail, vWPos.zy * vec2(0.09, 0.2)), tSide);
#else
vec4 tD0 = vec4(0.5);
vec4 tR = texture2D(uDetail, (abs(tN.x) > abs(tN.z) ? vWPos.zy : vWPos.xy) * vec2(0.09, 0.2));
#endif
tD1 = mix(tD1, tR, tRock);
float tVar = (tD1.b - 0.5) * 0.42 + (tD2.b - 0.5) * 0.34 + (tD0.b - 0.5) * 0.22;
vec3 tCol = diffuseColor.rgb * (1.0 + tVar);
// Dry and lush tufts on open ground.
tCol = mix(tCol, tCol * vec3(1.14, 1.06, 0.8), smoothstep(0.5, 0.85, tD2.a) * (1.0 - tRock) * 0.7);
tCol = mix(tCol, tCol * vec3(0.86, 1.04, 0.86), smoothstep(0.55, 0.9, tD1.a) * (1.0 - tRock) * 0.5);
// Layered rock on slopes.
float tStrata = sin(vWPos.y * 2.3 + tD2.b * 7.0 + tD1.b * 2.5) * 0.5 + 0.5;
tCol *= mix(1.0, 0.72 + 0.42 * tStrata * (0.7 + 0.6 * tD0.b), tRock);
// Crevices.
tCol *= mix(1.0, 0.65 + 0.35 * smoothstep(0.15, 0.55, tD1.b), tRock * 0.8 + 0.2);
float tWet = (1.0 - smoothstep(0.05, 1.0, vWPos.y)) * smoothstep(-3.0, -1.5, vWPos.y);
tCol *= 1.0 - 0.38 * tWet;
// Cobbles on the town's roads and square, worn through in places, faded out with distance.
vec2 tTp = vWPos.xz - TOWN_POS;
float tRoad = (1.0 - smoothstep(2.6, 3.8, min(abs(tTp.x), abs(tTp.y)))) * (1.0 - smoothstep(TOWN_R - 8.0, TOWN_R - 3.0, length(tTp)));
tRoad = max(tRoad, 1.0 - smoothstep(9.0, 11.5, length(tTp)));
tRoad *= smoothstep(0.3, 0.5, tD1.a + 0.12) * (1.0 - smoothstep(35.0, 70.0, distance(vWPos, cameraPosition)));
vec2 tCp = vWPos.xz * vec2(2.1, 2.8);
tCp.x += floor(tCp.y) * 0.5;
vec2 tCf = fract(tCp) - 0.5 + (tD0.rg - 0.5) * 0.25;
vec2 tCa = abs(tCf);
float tStone = smoothstep(0.5, 0.36, mix(max(tCa.x, tCa.y), length(tCa) * 0.8, 0.6));
float tCh = fract(sin(dot(floor(tCp), vec2(12.9898, 78.233))) * 43758.5453);
vec3 tCob = vec3(0.15, 0.135, 0.11) * (0.7 + 0.5 * tCh) * (0.85 + 0.3 * tD0.b) * mix(0.4, 1.0, tStone);
tCol = mix(tCol, tCob, tRoad);
diffuseColor.rgb = tCol;
`;
const TERRAIN_ROUGH = /* glsl */ `
roughnessFactor = mix(roughnessFactor, 0.32, tWet * 0.85);
roughnessFactor = mix(roughnessFactor, 0.7, tRoad * tStone);
`;
const TERRAIN_NORMAL = /* glsl */ `
{
  vec2 tG = (tD1.rg - 0.5) * (0.9 + 1.6 * tRock) + (tD0.rg - 0.5) * 0.7 + (tD2.rg - 0.5) * 0.6;
  // Rounded cobble tops.
  tG += tCf * tCf * tCf * 6.0 * tRoad;
  vec3 tP = normalize(tN + vec3(-tG.x, 0.0, -tG.y) * 0.55);
  normal = normalize((viewMatrix * vec4(tP, 0.0)).xyz);
}
`;

/** Ground is built and drawn in square tiles this wide (the world is TILES across). */
export const TILE = 150;
export const TILES = Math.round((WORLD_HALF * 2) / TILE);

const materials = new Map<boolean, THREE.MeshStandardMaterial>();

/** The ground's material, shared by every tile (with the detail shader). */
export function terrainMaterial(hq: boolean): THREE.MeshStandardMaterial {
  let mat = materials.get(hq);
  if (mat) return mat;
  mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.defines = { TOWN_POS: `vec2(${TOWN.x.toFixed(1)}, ${TOWN.z.toFixed(1)})`, TOWN_R: TOWN.radius.toFixed(1) };
  if (hq) mat.defines.TERRAIN_HQ = '';
  const detail = detailTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_VERT_PARS}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${TERRAIN_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${TERRAIN_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${TERRAIN_ROUGH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${TERRAIN_NORMAL}`);
  };
  materials.set(hq, mat);
  return mat;
}

const SAND = new THREE.Color(0x9c8a64);
const ASH = new THREE.Color(0x5a5450);
const BASALT = new THREE.Color(0x231c1a);
const PATH = new THREE.Color(0x7b6a4c);
const SCORCH = new THREE.Color(0x3a2a22);
const SNOW = new THREE.Color(0xeef2f6);
const EMBER = new THREE.Color(0x6a2414);
const BLEND: [number, number][] = [[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10]];

/** The ground's colour at a point (height y, flatness ny: the normal's y). */
function groundColor(x: number, z: number, y: number, ny: number, out: THREE.Color): THREE.Color {
  // Blend the zone colours of nearby points for soft borders.
  out.setRGB(0, 0, 0);
  for (const [ox, oz] of BLEND) {
    const zid = zoneAt(x + ox, z + oz);
    tmpB.setHex(ZONES[zid].ground).lerp(tmpC.setHex(PATCH[zid]), smoothstep(-0.2, 0.5, noise2(x / 55 + 3, z / 55)) * 0.75);
    out.r += tmpB.r / 5;
    out.g += tmpB.g / 5;
    out.b += tmpB.b / 5;
  }
  const zone = ZONES[zoneAt(x, z)];
  const rock = smoothstep(0.18, 0.4, 1 - ny);
  out.lerp(tmpB.setHex(zone.rock), rock);
  if (zone.id !== 'swamp' && zone.id !== 'cinder' && y < 1.6 && y > -3) out.lerp(SAND, 1 - smoothstep(0.4, 1.6, y));
  if (y < -3) out.lerp(tmpB.setHex(0x3a3d38), 0.6);
  if (zone.id === 'volcano') {
    const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
    out.lerp(BASALT, smoothstep(VOLCANO.crater + 30, VOLCANO.crater + 4, dv) * 0.8);
    out.lerp(ASH, smoothstep(25, 70, y) * 0.55 * (1 - rock * 0.5));
    // Old lava runs streaking down the cone.
    const run = Math.abs(Math.sin(Math.atan2(z - VOLCANO.z, x - VOLCANO.x) * 9 + noise2(x / 30, z / 30) * 2));
    out.lerp(SCORCH, smoothstep(0.85, 1, run) * smoothstep(VOLCANO.radius, VOLCANO.crater + 20, dv) * 0.6);
  } else if (zone.id === 'peaks') {
    // Snow on the heights, thinning on the steepest faces.
    out.lerp(SNOW, smoothstep(34, 60, y + 8 * noise2(x / 40, z / 40)) * (1 - rock * 0.55));
  } else if (zone.id === 'cinder') {
    // Glowing seams and the scorched rims of the lava pools.
    out.lerp(EMBER, (1 - smoothstep(0, 0.05, Math.abs(noise2(x / 26, z / 26)))) * 0.55);
    for (const p of LAVA_POOLS) out.lerp(SCORCH, (1 - smoothstep(p.r, p.r * 1.8, Math.hypot(x - p.x, z - p.z))) * 0.7);
  } else if (zone.id === 'town') {
    // Worn roads crossing the town square.
    const road = Math.min(Math.abs(x - TOWN.x), Math.abs(z - TOWN.z));
    out.lerp(PATH, 1 - smoothstep(2, 4.5, road));
    out.lerp(PATH, (1 - smoothstep(9, 13, Math.hypot(x - TOWN.x, z - TOWN.z))) * 0.8);
  }
  const n = 0.88 + 0.24 * (0.5 + 0.5 * noise2(x / 4.3, z / 4.3));
  return out.multiplyScalar(n);
}

/**
 * One tile of ground (tile cx, cz covers x from cx * TILE to (cx + 1) * TILE),
 * built a row at a time: each `yield` lets a frame through, so streaming in
 * new ground never stalls the game. Vertices sit on one world-wide grid and
 * normals come from the heights around them, so tiles meet without seams.
 */
export function* groundTile(cx: number, cz: number, segs: number, hq: boolean): Generator<void, THREE.Mesh> {
  const n = segs + 1, W = n + 2, step = TILE / segs;
  const at = (k: number, base: number) => (base * segs + k) * step;
  const hs = new Float32Array(W * W);
  for (let j = -1; j <= n; j++) {
    const z = at(j, cz);
    for (let i = -1; i <= n; i++) hs[(j + 1) * W + i + 1] = heightAt(at(i, cx), z);
    yield;
  }
  const H = (i: number, j: number) => hs[(j + 1) * W + i + 1];
  const pos = new Float32Array(n * n * 3);
  const nrm = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    const z = at(j, cz);
    for (let i = 0; i < n; i++) {
      const x = at(i, cx), y = H(i, j), k = (j * n + i) * 3;
      let nx = H(i - 1, j) - H(i + 1, j), ny = 2 * step, nz = H(i, j - 1) - H(i, j + 1);
      const l = Math.hypot(nx, ny, nz);
      (nx /= l), (ny /= l), (nz /= l);
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = z;
      nrm[k] = nx;
      nrm[k + 1] = ny;
      nrm[k + 2] = nz;
      groundColor(x, z, y, ny, tmpA);
      col[k] = tmpA.r;
      col[k + 1] = tmpA.g;
      col[k + 2] = tmpA.b;
    }
    yield;
  }
  const index = new Uint16Array(segs * segs * 6);
  let q = 0;
  for (let j = 0; j < segs; j++)
    for (let i = 0; i < segs; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      index[q++] = a;
      index[q++] = c;
      index[q++] = b;
      index[q++] = b;
      index[q++] = c;
      index[q++] = d;
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, terrainMaterial(hq));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  mesh.matrixAutoUpdate = false;
  return mesh;
}
