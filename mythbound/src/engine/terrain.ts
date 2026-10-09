import * as THREE from 'three';
import { fbm, lerp, noise2, smoothstep } from './noise';
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
    flatSpots.push({ x: t.x, z: t.z, r: t.radius + 4, fade: 22, h: Math.max(2.5, rawHeight(t.x, t.z)) });
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

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

export function buildTerrainMesh(segments: number): THREE.Mesh {
  const size = WORLD_HALF * 2;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
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
  const ash = new THREE.Color(0x2e2522);
  const path = new THREE.Color(0x7b6a4c);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = pos.getY(i);
    // Blend the zone colours of nearby points for soft borders.
    tmpA.setRGB(0, 0, 0);
    for (const [ox, oz] of [[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10]]) {
      const zone = ZONES[zoneAt(x + ox, z + oz)];
      tmpB.setHex(zone.ground);
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
    if (zone.id === 'volcano') tmpA.lerp(ash, smoothstep(30, 70, y) * 0.7);
    if (zone.id === 'town') {
      // Worn roads crossing the town square.
      const road = Math.min(Math.abs(x - TOWN.x), Math.abs(z - TOWN.z));
      tmpA.lerp(path, 1 - smoothstep(2, 4.5, road));
    }
    const n = 0.85 + 0.3 * (0.5 + 0.5 * noise2(x / 4.3, z / 4.3));
    colors[i * 3] = tmpA.r * n;
    colors[i * 3 + 1] = tmpA.g * n;
    colors[i * 3 + 2] = tmpA.b * n;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
