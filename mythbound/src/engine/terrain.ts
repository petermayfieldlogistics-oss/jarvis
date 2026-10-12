import * as THREE from 'three';
import { fbm, lerp, noise2, smoothstep, tileableNoise } from './noise';
import { ISLAND, SHRINES, TOWN, TRIALS, VOLCANO, WORLD_HALF, ZONES, type ZoneId } from '../data/world';

export const WATER_LEVEL = 0;
/** Depth at which you start swimming. */
export const SWIM_DEPTH = 1.3;

const dist = (x: number, z: number, p: { x: number; z: number }) => Math.hypot(x - p.x, z - p.z);

const RIM = 88 * Math.pow(1 - VOLCANO.crater / VOLCANO.radius, 1.4);
export const CRATER_FLOOR = RIM - 20;
export const LAVA_LEVEL = RIM - 22.5;

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

  // The world's edge: mountains (and sea cliffs to the south).
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > WORLD_HALF - 70) h += Math.pow((edge - (WORLD_HALF - 70)) / 70, 2) * 70 * (0.7 + 0.3 * fbm(x / 30, z / 30, 2));
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
  return dv > VOLCANO.platform + 0.5 && dv < VOLCANO.crater - 1 && y < LAVA_LEVEL + 1.2;
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

export function buildTerrainMesh(segments: number, hq = segments > 200): THREE.Mesh {
  const size = WORLD_HALF * 2;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  geo.deleteAttribute('uv');
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
  }
  geo.computeVertexNormals();
  const normals = geo.attributes.normal as THREE.BufferAttribute;
  const sand = new THREE.Color(0x9c8a64);
  const ash = new THREE.Color(0x5a5450);
  const basalt = new THREE.Color(0x231c1a);
  const path = new THREE.Color(0x7b6a4c);
  const scorch = new THREE.Color(0x3a2a22);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = pos.getY(i);
    // Blend the zone colours of nearby points for soft borders.
    tmpA.setRGB(0, 0, 0);
    for (const [ox, oz] of [[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10]]) {
      const zid = zoneAt(x + ox, z + oz);
      tmpB.setHex(ZONES[zid].ground).lerp(tmpC.setHex(PATCH[zid]), smoothstep(-0.2, 0.5, noise2(x / 55 + 3, z / 55)) * 0.75);
      tmpA.r += tmpB.r / 5;
      tmpA.g += tmpB.g / 5;
      tmpA.b += tmpB.b / 5;
    }
    const zone = ZONES[zoneAt(x, z)];
    const slope = 1 - normals.getY(i);
    const rock = smoothstep(0.18, 0.4, slope);
    tmpB.setHex(zone.rock);
    tmpA.lerp(tmpB, rock);
    if (zone.id !== 'swamp' && y < 1.6 && y > -3) tmpA.lerp(sand, 1 - smoothstep(0.4, 1.6, y));
    if (y < -3) tmpA.lerp(tmpB.setHex(0x3a3d38), 0.6);
    if (zone.id === 'volcano') {
      const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
      tmpA.lerp(basalt, smoothstep(VOLCANO.crater + 30, VOLCANO.crater + 4, dv) * 0.8);
      tmpA.lerp(ash, smoothstep(25, 70, y) * 0.55 * (1 - rock * 0.5));
      // Old lava runs streaking down the cone.
      const run = Math.abs(Math.sin(Math.atan2(z - VOLCANO.z, x - VOLCANO.x) * 9 + noise2(x / 30, z / 30) * 2));
      tmpA.lerp(scorch, smoothstep(0.85, 1, run) * smoothstep(VOLCANO.radius, VOLCANO.crater + 20, dv) * 0.6);
    }
    if (zone.id === 'town') {
      // Worn roads crossing the town square.
      const road = Math.min(Math.abs(x - TOWN.x), Math.abs(z - TOWN.z));
      tmpA.lerp(path, 1 - smoothstep(2, 4.5, road));
      tmpA.lerp(path, (1 - smoothstep(9, 13, Math.hypot(x - TOWN.x, z - TOWN.z))) * 0.8);
    }
    const n = 0.88 + 0.24 * (0.5 + 0.5 * noise2(x / 4.3, z / 4.3));
    colors[i * 3] = tmpA.r * n;
    colors[i * 3 + 1] = tmpA.g * n;
    colors[i * 3 + 2] = tmpA.b * n;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
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
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
