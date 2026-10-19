import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ANVILS, ARENA, DOCKS, EYES_RUINS, FIELD, FISHING_SPOTS, ISLAND, LAIRS, LAVA_POOLS, LORE, NPCS, OASES, ORE_NODES, PAGES, plotCentre, SHRINES, TOMES, TOWN, TRIALS, VOLCANO, WORLD_HALF, ZONES, type ZoneId,
} from '../data/world';
import { SPELLS } from '../data/defs';
import { buildBoat, glowSprite, mat } from './models';
import { worldGeometry, worldMesh } from './assets';
import { FRUITS, NELL_STALL, STATIONS } from '../data/goods';
import { mulberry32, noise2, smoothstep } from './noise';
import { GrassField, groundStep } from './grass';
import { detailTexture, groundTile, heightAt, inLava, LAVA_LEVEL, normalAt, POOL_LAVA, TILE, TILES, zoneAt, WATER_LEVEL } from './terrain';

export type Quality = 'low' | 'medium' | 'high';

/** What builder mode can place: building blocks, props of the town, and the wild's trees and rocks. */
export type PropKind =
  | 'stone-block' | 'wood-block' | 'wall' | 'floor' | 'pillar' | 'stairs' | 'roof' | 'tower' | 'arch'
  | 'house' | 'big-house' | 'barrel' | 'crate' | 'banner' | 'fence' | 'brazier' | 'lamp' | 'statue' | 'well' | 'tent' | 'campfire'
  | PlantKind;

/** A plant out in the wild that builder mode can pick up (its tile's mesh and its place in it). */
export interface PlantHit {
  mesh: THREE.InstancedMesh;
  index: number;
  kind: PlantKind;
  x: number;
  z: number;
  scale: number;
  turn: number;
}

export interface Collider {
  x: number;
  z: number;
  r: number;
  /** World height of its top (the camera boom passes over lower ones). */
  top: number;
}

export type InteractKind = 'npc' | 'shrine' | 'lore' | 'tome' | 'page' | 'anvil' | 'dock' | 'fish' | 'ore' | 'trial' | 'loot' | 'plot' | 'station';

export interface Interactable {
  id: string;
  kind: InteractKind;
  x: number;
  y: number;
  z: number;
  radius: number;
  label: string;
  object?: THREE.Object3D;
  used?: boolean;
}

/** Glowing things that can borrow one of the few real lights near the player. */
export interface Emitter {
  pos: THREE.Vector3;
  color: number;
  intensity: number;
  distance: number;
  flicker?: number;
}

// ---------------------------------------------------------------- batcher --

/**
 * Merges static props into a handful of draw calls. `add` groups by material;
 * `paint` bakes a colour into the vertices so props of every colour share one
 * matte (or metal) material.
 */
class Batcher {
  private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  constructor(
    readonly matte = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }),
    readonly metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.65 }),
  ) {}

  private place(geo: THREE.BufferGeometry, x: number, y: number, z: number, ry: number, sx: number, sy: number, sz: number, rx: number, rz: number) {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sx, sy, sz));
    return (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(this.m);
  }

  private push(material: THREE.Material, g: THREE.BufferGeometry) {
    let list = this.groups.get(material);
    if (!list) this.groups.set(material, (list = []));
    list.push(g);
  }

  add(geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
    const g = this.place(geo, x, y, z, ry, sx, sy, sz, rx, rz);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    this.push(material, g);
  }

  paint(geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0, metal = false) {
    // Boulders take the Blender rock's shape (in the colour asked for).
    const g = this.place(geo === ROCK ? rockGeometry() : geo, x, y, z, ry, sx, sy, sz, rx, rz);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    this.c.setHex(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) (arr[i * 3] = this.c.r), (arr[i * 3 + 1] = this.c.g), (arr[i * 3 + 2] = this.c.b);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.push(metal ? this.metal : this.matte, g);
  }

  /**
   * A piece of scenery modelled in Blender, its colour slots filled from
   * `slots`, placed like `paint`. False (and nothing drawn) if it didn't load.
   */
  model(name: string, slots: number[], x: number, y: number, z: number, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0): boolean {
    const m = worldMesh(name);
    if (!m) return false;
    const geo = worldGeometry(m, slots);
    this.push(this.matte, this.place(geo, x, y, z, ry, sx, sy, sz, rx, rz));
    geo.dispose();
    return true;
  }

  /** A Blender piece drawn in a material of its own (lit windows, lamp glass). */
  modelIn(name: string, material: THREE.Material, x: number, y: number, z: number, ry = 0, sx = 1, sy = sx, sz = sx) {
    const m = worldMesh(name);
    if (!m) return;
    const geo = worldGeometry(m);
    this.add(geo, material, x, y, z, ry, sx, sy, sz);
    geo.dispose();
  }

  build(parent: THREE.Object3D, shadows: boolean) {
    for (const [material, list] of this.groups) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
    this.groups.clear();
  }
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const CYL6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
// Plant parts are open-ended: their caps are hidden in canopies or the ground.
const TAPER = new THREE.CylinderGeometry(0.32, 0.5, 1, 7, 1, true);
const STEM = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true);
const THIN = new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 1, true);
const CONE4 = new THREE.ConeGeometry(0.75, 1, 4);
const CONE8 = new THREE.ConeGeometry(0.5, 1, 8);
const ROCK = new THREE.DodecahedronGeometry(1, 0);
const ICO = new THREE.IcosahedronGeometry(1, 0);
const OCTA = new THREE.OctahedronGeometry(1, 0);
const BLADE = new THREE.ConeGeometry(0.07, 1, 3, 1, true);
const TORUS = new THREE.TorusGeometry(1, 0.08, 6, 24);
const BOWL = new THREE.CylinderGeometry(0.62, 0.3, 0.42, 9);
/** A gable roof: base 2 wide at y = 0, ridge at y = 1, 1 long along z, flat shaded. */
const ROOF = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 3, 1).rotateX(-Math.PI / 2).translate(0, 0.5, 0).scale(1 / 0.866, 1 / 1.5, 1).toNonIndexed();
  g.computeVertexNormals();
  return g;
})();

const TAU = Math.PI * 2;
/** Where a wild plant grew, to a tenth of a metre (the same on every player's machine). */
const spotKey = (x: number, z: number) => `${Math.round(x * 10)},${Math.round(z * 10)}`;
const PLANT_KINDS: string[] = ['pine', 'oak', 'birch', 'bush', 'grass', 'flowers', 'reeds', 'toadstool', 'mushroom', 'crystal', 'dead', 'ashtree', 'cactus', 'palm', 'rock'];
/** How a placed plant looks (the wild ones take their colours from their land). */
const PLANT_TINT: Partial<Record<PlantKind, number>> = {
  oak: 0x5a6a30, birch: 0xb8b848, pine: 0xd8e8d0, bush: 0x5a6232, palm: 0x5a9a34, flowers: 0xffd040, toadstool: 0xb83a2a, mushroom: 0x60c0ff, crystal: 0xa070ff, rock: 0x8a8478,
};
const hash = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

// ------------------------------------------------------------------- sky --

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w;
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 moonDir;
uniform vec3 cloudLit;
uniform vec3 cloudShade;
uniform float night;
uniform float golden;
uniform float time;
uniform float cover;
uniform sampler2D detail;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float hp = max(h, 0.0);
  vec3 col = mix(horizon, top, pow(hp, 0.5));
  col = mix(col, horizon * 0.7, smoothstep(0.0, -0.3, h));
  float s = max(dot(d, sunDir), 0.0);
  float sunVis = smoothstep(-0.1, 0.02, sunDir.y);
  // Golden hour: a warm band hugging the horizon on the sun's side.
  float az = max(dot(normalize(d.xz + 1e-4), normalize(sunDir.xz + 1e-4)), 0.0);
  col += sunColor * golden * (pow(az, 3.0) * 0.6 + 0.12) * pow(1.0 - hp, 5.0) * 0.8;
  col += sunColor * sunVis * (pow(s, 6.0) * 0.16 + pow(s, 48.0) * 0.4 + pow(s, 700.0) * 1.6);
  // Stars that twinkle, and a cratered moon.
  vec3 sp = d * 200.0;
  vec3 cell = floor(sp);
  float st = hash(cell);
  float tw = 0.55 + 0.45 * sin(time * (1.5 + st * 4.0) + st * 50.0);
  // A round point somewhere in each lucky cell (cut by the sphere, so sizes vary).
  vec3 so = vec3(hash(cell + 1.7), hash(cell + 3.1), hash(cell + 5.3)) * 0.5 + 0.25;
  float sdot = smoothstep(0.42, 0.06, length(fract(sp) - so));
  col += mix(vec3(1.0, 0.86, 0.7), vec3(0.8, 0.9, 1.0), hash(cell + 7.9)) * smoothstep(0.996, 1.0, st) * sdot * tw * night * smoothstep(0.04, 0.3, h) * 2.2;
  float m = dot(d, moonDir);
  vec3 mr = normalize(cross(moonDir, vec3(0.0, 1.0, 0.0)));
  vec3 mu = cross(mr, moonDir);
  float maria = texture2D(detail, vec2(dot(d, mr), dot(d, mu)) * 9.0 + 0.3).b;
  float disc = smoothstep(0.99935, 0.99952, m);
  col += vec3(0.86, 0.9, 1.0) * night * (disc * (1.25 - maria * 0.6) * 1.5 + pow(max(m, 0.0), 160.0) * 0.3 + pow(max(m, 0.0), 10.0) * 0.06);
  col += sunColor * sunVis * smoothstep(0.99955, 0.99975, s) * 9.0;
  // Drifting clouds projected onto a high plane.
  vec2 cuv = d.xz / (hp + 0.1);
  float c1 = texture2D(detail, cuv * 0.09 + time * vec2(0.0032, 0.0011)).b;
  #ifdef SKY_LQ
  float cov = c1;
  #else
  float cov = c1 * 0.72 + texture2D(detail, cuv * 0.31 + time * vec2(0.0055, 0.002)).a * 0.28;
  #endif
  float cl = smoothstep(cover, cover + 0.2, cov) * smoothstep(0.0, 0.16, h);
  float thick = smoothstep(cover + 0.04, cover + 0.4, cov);
  vec3 cc = mix(cloudLit, cloudShade, thick);
  cc += sunColor * sunVis * (pow(s, 5.0) * 0.7 + pow(s, 40.0) * 1.2) * (1.0 - thick * 0.6);
  col = mix(col, cc, cl * 0.9);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  mesh: THREE.Mesh;
  uniforms = {
    top: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3() },
    sunColor: { value: new THREE.Color() },
    moonDir: { value: new THREE.Vector3() },
    cloudLit: { value: new THREE.Color() },
    cloudShade: { value: new THREE.Color() },
    night: { value: 0 },
    golden: { value: 0 },
    time: { value: 0 },
    cover: { value: 0.56 },
    detail: { value: detailTexture() as THREE.Texture },
  };
  constructor(lq = false) {
    const material = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false });
    if (lq) material.defines = { SKY_LQ: '' };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }
}

// ----------------------------------------------------------------- water --

const WATER_VERT = /* glsl */ `
varying vec3 vWPos;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FRAG = /* glsl */ `
uniform sampler2D uDetail;
uniform sampler2D uShore;
uniform vec2 uShoreXf;
uniform float uTime;
uniform float uLight;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uHorizon;
varying vec3 vWPos;
#include <fog_pars_fragment>
void main() {
  vec2 p = vWPos.xz;
  vec3 V = cameraPosition - vWPos;
  float dist = length(V);
  V /= dist;
  // The mire's pools are still and brown; the sea is clear and choppy.
  float murk = smoothstep(-115.0, -160.0, p.x) * smoothstep(100.0, 140.0, p.y);
  // Two scrolling slope fields make the ripples; calm them far away.
  vec2 g = (texture2D(uDetail, p * 0.029 + uTime * vec2(0.010, 0.006)).rg - 0.5) * 1.1;
  #ifndef WATER_LQ
  g += (texture2D(uDetail, p * 0.087 + uTime * vec2(-0.016, 0.019)).rg - 0.5) * 0.8;
  #endif
  g *= (1.0 - murk * 0.65) / (1.0 + dist * 0.012);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  // Depth below the surface, baked from the terrain; open sea outside the map.
  vec2 suv = p * uShoreXf.x + uShoreXf.y;
  float inside = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
  float depth = mix(8.0, texture2D(uShore, suv).r * 8.0, inside);
  vec3 shallow = mix(vec3(0.07, 0.30, 0.30), vec3(0.13, 0.15, 0.06), murk);
  vec3 deep = mix(vec3(0.008, 0.045, 0.075), vec3(0.025, 0.035, 0.015), murk);
  vec3 body = mix(shallow, deep, smoothstep(0.2, 6.0, depth)) * uLight;
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uHorizon, uSky, pow(clamp(R.y, 0.0, 1.0), 0.5));
  vec3 col = mix(body, sky, fres * 0.9);
  float sd = max(dot(R, uSunDir), 0.0);
  // Sharp glints up close soften into a broad sheen with distance (no sparkle noise).
  float sharp = mix(380.0, 90.0, smoothstep(20.0, 160.0, dist));
  col += uSunColor * (pow(sd, sharp) * mix(4.5, 1.6, smoothstep(20.0, 160.0, dist)) + pow(sd, 36.0) * 0.15);
  // Foam: a frothy edge at the shoreline and lines of surf rolling in.
  float fn = texture2D(uDetail, p * 0.19 + uTime * vec2(0.011, -0.008)).b;
  float edge = 1.0 - smoothstep(0.0, 0.3 + fn * 0.35, depth);
  float surf = smoothstep(0.6, 0.95, sin(depth * 4.5 - uTime * 1.6 + fn * 5.0)) * (1.0 - smoothstep(0.2, 1.7, depth)) * smoothstep(0.3, 0.6, fn);
  float foam = max(edge, surf) * (1.0 - murk * 0.92);
  col = mix(col, vec3(0.85, 0.89, 0.9) * (uLight * 0.9 + 0.08), foam * 0.85);
  float alpha = max(max(mix(0.4, 0.94, smoothstep(0.0, 3.5, depth)), fres), foam * 0.9);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// ------------------------------------------------------------ vegetation --

const VEG_VERT_PARS = /* glsl */ `
attribute vec3 aVeg;
uniform float uTime;
uniform vec2 uWind;
varying float vGlow;
varying float vCamD;
varying float vLeaf;
`;
// Colour: instance tint only where the part asks for it (canopies, petals).
const VEG_COLOR = /* glsl */ `
vColor = vec4(1.0);
vColor.rgb *= color;
#ifdef USE_INSTANCING_COLOR
vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aVeg.y);
#endif
`;
// Sway in world space after instancing, each instance on its own phase.
const VEG_PROJECT = /* glsl */ `
vec4 mvPosition = vec4(transformed, 1.0);
vec3 vIP = vec3(0.0);
float vIS = 1.0;
#ifdef USE_INSTANCING
mvPosition = instanceMatrix * mvPosition;
vIP = instanceMatrix[3].xyz;
vIS = length(instanceMatrix[1].xyz);
#endif
float vPh = vIP.x * 0.23 + vIP.z * 0.19;
float vGust = 0.6 + 0.4 * sin(uTime * 0.45 + vIP.x * 0.013 + vIP.z * 0.009);
vec2 vBend = uWind * vGust * (0.75 + 0.25 * sin(uTime * 1.4 + vPh)) + 0.16 * vec2(sin(uTime * 2.1 + vPh * 1.7), cos(uTime * 1.7 + vPh * 1.3));
float vSw = aVeg.x * vIS;
mvPosition.xz += vBend * vSw;
mvPosition.y -= dot(vBend, vBend) * vSw * 0.25;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
vGlow = aVeg.z;
vLeaf = aVeg.y;
vCamD = length(mvPosition.xyz);
`;

// Leaves and trunks right in front of the camera dissolve (screen-door) instead of filling the view.
const VEG_NEAR_FADE = /* glsl */ `
if (vCamD < 3.4 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > smoothstep(1.0, 3.4, vCamD)) discard;
`;

type V3 = [number, number, number];
interface VPart {
  geo: THREE.BufferGeometry;
  color: number;
  /** Colour at the top of the part (a cheap light/AO gradient). */
  top?: number;
  /** How much the instance colour applies (0 trunk, 1 leaves). */
  tint?: number;
  glow?: number;
  at?: V3;
  scale?: V3;
  rot?: V3;
}

/**
 * Merges parts into one vertex-coloured plant. `sway` is how far (per unit
 * of wind) the top bends; the base above `from` bends progressively.
 */
function plant(parts: VPart[], sway: number, from = 0): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const a = new THREE.Color();
  const b = new THREE.Color();
  const list = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const r = p.rot ?? [0, 0, 0];
    q.setFromEuler(new THREE.Euler(r[0], r[1], r[2]));
    g.applyMatrix4(m.compose(new THREE.Vector3(...(p.at ?? [0, 0, 0])), q, new THREE.Vector3(...(p.scale ?? [1, 1, 1]))));
    g.computeBoundingBox();
    const y0 = g.boundingBox!.min.y;
    const y1 = g.boundingBox!.max.y;
    a.setHex(p.color);
    b.setHex(p.top ?? p.color);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const veg = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - y0) / (y1 - y0 || 1);
      col[i * 3] = a.r + (b.r - a.r) * t;
      col[i * 3 + 1] = a.g + (b.g - a.g) * t;
      col[i * 3 + 2] = a.b + (b.b - a.b) * t;
      veg[i * 3 + 1] = p.tint ?? 0;
      veg[i * 3 + 2] = p.glow ?? 0;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aVeg', new THREE.BufferAttribute(veg, 3));
    return g;
  });
  const merged = mergeGeometries(list, false)!;
  list.forEach((g) => g.dispose());
  merged.computeBoundingBox();
  const top = merged.boundingBox!.max.y;
  const pos = merged.attributes.position;
  const veg = merged.attributes.aVeg as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) veg.setX(i, sway * Math.pow(Math.max(0, (pos.getY(i) - from) / (top - from)), 1.6));
  merged.computeBoundingSphere();
  return merged;
}

/** Grass tints: golden on the plains, lush in the wood, sickly in the mire. */
const GRASS: Partial<Record<ZoneId, number>> = {
  town: 0x8e8a42, plains: 0xb09a48, forest: 0x4e6a30, coast: 0x9a9a5c, swamp: 0x4e5430, crossroads: 0x4e4a5a,
  peaks: 0x7a8a62, elderwood: 0x3e5a28, jungle: 0x3a7a24, ocean: 0x8a9a54,
};

export type PlantKind = 'pine' | 'oak' | 'birch' | 'bush' | 'grass' | 'flowers' | 'reeds' | 'toadstool' | 'mushroom' | 'crystal' | 'dead' | 'ashtree' | 'cactus' | 'palm' | 'rock';
const SMALL: PlantKind[] = ['grass', 'flowers', 'reeds', 'toadstool', 'mushroom'];
const TREES: PlantKind[] = ['pine', 'oak', 'birch', 'dead', 'ashtree', 'cactus', 'palm'];

/**
 * A lumpy ball of leaves: a jittered icosahedron with round normals, so the
 * light wraps softly around it instead of picking out every facet.
 */
function leafBlob(detail: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
    // Same jitter for the copies of a corner shared by several faces.
    const j = 0.84 + 0.3 * hash(Math.round(v.x * 97) * 3.1 + Math.round(v.y * 97) * 7.7 + Math.round(v.z * 97) * 13.3);
    pos.setXYZ(i, v.x * j, v.y * j, v.z * j);
  }
  return g;
}

/** How far each plant's top sways and from what height it starts to bend (as the built-in ones). */
const SWAY: Record<Exclude<PlantKind, 'rock'>, [number, number]> = {
  pine: [0.9, 1.5], oak: [0.75, 2], birch: [1.0, 2.5], bush: [0.25, 0], grass: [0.4, 0], flowers: [0.35, 0], reeds: [0.5, 0], toadstool: [0, 0],
  mushroom: [0, 0], crystal: [0, 0], dead: [0.12, 2], ashtree: [0.05, 2], cactus: [0, 0], palm: [0.55, 4],
};

/** A plant modelled in Blender, with the vegetation attributes the plant shader reads (see plant()). */
function blendPlant(kind: Exclude<PlantKind, 'rock'>): THREE.BufferGeometry | null {
  const m = worldMesh(kind);
  if (!m) return null;
  const g = worldGeometry(m);
  const [sway, from] = SWAY[kind];
  const pos = g.attributes.position;
  let top = -Infinity;
  for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
  const veg = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    veg[i * 3] = sway * Math.pow(Math.max(0, (pos.getY(i) - from) / (top - from)), 1.6);
    veg[i * 3 + 1] = m.tint[i] / 255;
    veg[i * 3 + 2] = (m.glow[i] / 255) * 4;
  }
  g.setAttribute('aVeg', new THREE.BufferAttribute(veg, 3));
  g.computeBoundingSphere();
  return g;
}

/** The rock wild boulders are drawn with: the Blender one if it loaded. */
function rockGeometry(): THREE.BufferGeometry {
  const m = worldMesh('rock');
  return m ? (rockGeo ??= worldGeometry(m)) : ROCK;
}
let rockGeo: THREE.BufferGeometry | undefined;
let oreGeo: THREE.BufferGeometry | undefined;

function plantGeometries(leafDetail: number): Record<Exclude<PlantKind, 'rock'>, THREE.BufferGeometry> {
  const built = builtPlants(leafDetail);
  for (const kind of Object.keys(built) as Exclude<PlantKind, 'rock'>[]) {
    const g = blendPlant(kind);
    if (g) {
      built[kind].dispose();
      built[kind] = g;
    }
  }
  return built;
}

function builtPlants(leafDetail: number): Record<Exclude<PlantKind, 'rock'>, THREE.BufferGeometry> {
  const leaves = leafBlob(leafDetail);
  const mushrooms = (glow: number) =>
    plant([
      { geo: STEM, color: 0xb8b0a0, top: 0xe0d8c8, at: [0, 0.25, 0], scale: [0.12, 0.5, 0.12] },
      { geo: STEM, color: 0xb8b0a0, top: 0xe0d8c8, at: [0.32, 0.17, 0.15], scale: [0.09, 0.34, 0.09] },
      { geo: STEM, color: 0xb8b0a0, top: 0xe0d8c8, at: [-0.22, 0.13, -0.26], scale: [0.08, 0.26, 0.08] },
      { geo: CONE8, color: 0xcccccc, top: 0xffffff, tint: 1, glow, at: [0, 0.56, 0], scale: [0.62, 0.26, 0.62] },
      { geo: CONE8, color: 0xcccccc, top: 0xffffff, tint: 1, glow, at: [0.32, 0.38, 0.15], scale: [0.44, 0.2, 0.44] },
      { geo: CONE8, color: 0xcccccc, top: 0xffffff, tint: 1, glow, at: [-0.22, 0.3, -0.26], scale: [0.36, 0.17, 0.36] },
    ], 0);
  const canopy = (at: V3, scale: V3): VPart => ({ geo: leaves, color: 0x9a9a9a, top: 0xffffff, tint: 1, at, scale });
  const blades = (n: number, h: number, w: number, color: number, top: number, tint: number, seed: number): VPart[] =>
    Array.from({ length: n }, (_, i) => {
      const a = hash(seed + i) * TAU;
      const r = 0.05 + hash(seed + i + 9) * 0.12;
      const hh = h * (0.65 + hash(seed + i + 3) * 0.45);
      return { geo: BLADE, color, top, tint, at: [Math.cos(a) * r, hh / 2, Math.sin(a) * r] as V3, scale: [w, hh, w] as V3, rot: [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35] as V3 };
    });
  return {
    pine: plant([
      { geo: TAPER, color: 0x3a2a1c, top: 0x56402c, at: [0, 1.6, 0], scale: [0.55, 3.2, 0.55] },
      ...[0, 1, 2, 3, 4].map((k): VPart => ({ geo: CONE8, color: 0x24361e, top: 0x587a44, tint: 1, at: [0, 2.7 + k * 1.4, 0], scale: [4.6 - k * 0.8, 2.6 - k * 0.22, 4.6 - k * 0.8] })),
    ], 0.9, 1.5),
    oak: plant([
      { geo: TAPER, color: 0x34261a, top: 0x4e3a26, at: [0, 1.6, 0], scale: [0.85, 3.2, 0.85] },
      { geo: STEM, color: 0x4a3624, at: [0.75, 3.4, 0], scale: [0.26, 1.9, 0.26], rot: [0, 0, -0.75] },
      { geo: STEM, color: 0x4a3624, at: [-0.6, 3.2, 0.3], scale: [0.24, 1.7, 0.24], rot: [0.3, 0, 0.8] },
      canopy([0, 5.1, 0], [2.8, 2.1, 2.8]),
      canopy([1.9, 4.5, 0.6], [1.9, 1.5, 1.9]),
      canopy([-1.7, 4.6, -0.5], [2.0, 1.6, 2.0]),
      canopy([0.4, 4.3, -1.8], [1.7, 1.4, 1.7]),
      canopy([-0.5, 4.3, 1.7], [1.6, 1.4, 1.6]),
      canopy([0.2, 6.4, 0.2], [1.6, 1.2, 1.6]),
    ], 0.75, 2),
    birch: plant([
      { geo: STEM, color: 0xbab4a6, top: 0xe4e0d4, at: [0, 3, 0], scale: [0.3, 6, 0.3] },
      ...[1.1, 2.3, 3.4, 4.5, 5.3].map((y, i): VPart => ({ geo: BOX, color: 0x24201c, at: [0, y, 0], scale: [0.32, 0.07, 0.1], rot: [0, i * 1.3, 0] })),
      { geo: STEM, color: 0xc8c2b4, at: [0.35, 4.6, 0], scale: [0.1, 1.2, 0.1], rot: [0, 0, -0.6] },
      canopy([0, 6.3, 0], [1.5, 2.2, 1.5]),
      canopy([0.7, 5.3, 0.3], [1.1, 1.5, 1.1]),
      canopy([-0.5, 5.5, -0.35], [1.0, 1.6, 1.0]),
    ], 1.0, 2.5),
    bush: plant([canopy([0, 0.6, 0], [1.1, 0.8, 1.1]), canopy([0.7, 0.45, 0.3], [0.8, 0.6, 0.8]), canopy([-0.6, 0.5, -0.3], [0.85, 0.65, 0.85])], 0.25),
    grass: plant(blades(6, 0.95, 1, 0x5a5a5a, 0xffffff, 1, 1), 0.4),
    flowers: plant([
      ...blades(4, 0.5, 0.8, 0x3e5a24, 0x6a8a38, 0, 20),
      ...[0, 1, 2, 3, 4].map((i): VPart => {
        const a = i * 2.4;
        const r = i === 0 ? 0 : 0.2;
        const h = 0.45 + hash(i + 40) * 0.3;
        return { geo: THIN, color: 0x3e5a24, at: [Math.cos(a) * r, h / 2, Math.sin(a) * r], scale: [0.03, h, 0.03] };
      }),
      ...[0, 1, 2, 3, 4].map((i): VPart => {
        const a = i * 2.4;
        const r = i === 0 ? 0 : 0.2;
        const h = 0.45 + hash(i + 40) * 0.3;
        return { geo: OCTA, color: 0xffffff, tint: 1, glow: 0.15, at: [Math.cos(a) * r, h + 0.03, Math.sin(a) * r], scale: [0.1, 0.06, 0.1] };
      }),
    ], 0.35),
    reeds: plant([
      ...blades(7, 2.0, 1.3, 0x3e4a26, 0x9a9858, 0.6, 60),
      { geo: STEM, color: 0x3a2414, at: [0.08, 1.75, 0.05], scale: [0.08, 0.35, 0.08] },
      { geo: STEM, color: 0x3a2414, at: [-0.1, 1.5, -0.08], scale: [0.08, 0.3, 0.08] },
    ], 0.5),
    // Toadstools in the wood; the mire's caps glow.
    toadstool: mushrooms(0),
    mushroom: mushrooms(0.9),
    crystal: plant([
      { geo: ICO, color: 0x2e2c36, at: [0, 0.1, 0], scale: [0.75, 0.35, 0.7] },
      { geo: OCTA, color: 0x9a9aa8, top: 0xffffff, tint: 1, glow: 1, at: [0, 1.15, 0], scale: [0.34, 1.35, 0.34] },
      { geo: OCTA, color: 0x9a9aa8, top: 0xffffff, tint: 1, glow: 1, at: [0.45, 0.75, 0.2], scale: [0.24, 0.85, 0.24], rot: [0, 0, -0.38] },
      { geo: OCTA, color: 0x9a9aa8, top: 0xffffff, tint: 1, glow: 1, at: [-0.38, 0.62, -0.22], scale: [0.22, 0.75, 0.22], rot: [0.2, 0, 0.42] },
      { geo: OCTA, color: 0x9a9aa8, top: 0xffffff, tint: 1, glow: 1, at: [0.1, 0.5, -0.5], scale: [0.2, 0.6, 0.2], rot: [-0.5, 0, 0] },
    ], 0),
    dead: plant([
      { geo: TAPER, color: 0x221d1a, top: 0x3a332c, at: [0, 2.5, 0], scale: [0.5, 5, 0.5] },
      { geo: STEM, color: 0x2e2824, at: [0.8, 4.2, 0], scale: [0.2, 2.4, 0.2], rot: [0, 0, -0.8] },
      { geo: STEM, color: 0x2e2824, at: [-0.7, 3.6, 0], scale: [0.18, 2, 0.18], rot: [0, 0, 0.9] },
      { geo: STEM, color: 0x2e2824, at: [0.2, 5.6, 0.2], scale: [0.14, 1.6, 0.14], rot: [0.3, 0, 0.3] },
      { geo: BOX, color: 0x3e4a2a, top: 0x56603a, at: [1.35, 3.9, 0], scale: [0.08, 1.3, 0.25] },
      { geo: BOX, color: 0x3e4a2a, top: 0x56603a, at: [-1.15, 3.6, 0.05], scale: [0.08, 1.0, 0.22] },
    ], 0.12, 2),
    ashtree: plant([
      { geo: TAPER, color: 0x161210, top: 0x7a746c, at: [0, 2.5, 0], scale: [0.55, 5, 0.55] },
      { geo: STEM, color: 0x6a645c, top: 0x8e8880, at: [0.8, 4.2, 0], scale: [0.18, 2.4, 0.18], rot: [0, 0, -0.8] },
      { geo: STEM, color: 0x6a645c, top: 0x8e8880, at: [-0.7, 3.6, 0], scale: [0.16, 2, 0.16], rot: [0, 0, 0.9] },
      { geo: STEM, color: 0x6a645c, top: 0x8e8880, at: [0.25, 5.6, 0.3], scale: [0.12, 1.6, 0.12], rot: [0.35, 0, 0.3] },
      { geo: STEM, color: 0x6a645c, top: 0x8e8880, at: [-0.3, 4.9, -0.5], scale: [0.11, 1.4, 0.11], rot: [-0.7, 0, 0] },
      { geo: BOX, color: 0xff5a18, glow: 2.5, at: [0.2, 1.1, 0.18], scale: [0.14, 0.34, 0.08], rot: [0, 0.7, 0] },
      { geo: BOX, color: 0xff7a28, glow: 2.5, at: [-0.16, 2.3, -0.14], scale: [0.1, 0.24, 0.08], rot: [0, -0.8, 0] },
    ], 0.05, 2),
    cactus: plant([
      { geo: CYL6, color: 0x3e5a30, top: 0x5a7a44, at: [0, 1.6, 0], scale: [0.7, 3.2, 0.7] },
      { geo: CYL6, color: 0x4a6a3a, at: [0.6, 1.5, 0], scale: [0.34, 0.9, 0.34], rot: [0, 0, Math.PI / 2] },
      { geo: CYL6, color: 0x4a6a3a, top: 0x5a7a44, at: [1.0, 2.1, 0], scale: [0.36, 1.3, 0.36] },
      { geo: CYL6, color: 0x4a6a3a, at: [-0.55, 2.0, 0], scale: [0.3, 0.8, 0.3], rot: [0, 0, Math.PI / 2] },
      { geo: CYL6, color: 0x4a6a3a, top: 0x5a7a44, at: [-0.88, 2.45, 0], scale: [0.32, 1.0, 0.32] },
      { geo: ICO, color: 0xe0607a, at: [0, 3.28, 0], scale: [0.16, 0.1, 0.16] },
    ], 0),
    // A leaning, ringed trunk and a crown of drooping fronds (islands, oases, the jungle).
    palm: plant([
      ...[0, 1, 2, 3].map((k): VPart => ({ geo: TAPER, color: 0x5a4430, top: 0x806446, at: [0.14 * k * k + 0.06 * k, 1.05 + k * 2, 0], scale: [0.46 - k * 0.05, 2.15, 0.46 - k * 0.05], rot: [0, 0, -0.06 - 0.07 * k] })),
      ...[0, 1, 2, 3, 4, 5, 6].map((i): VPart => {
        const a = (i / 7) * TAU + 0.3;
        return { geo: BOX, color: 0x6a6a6a, top: 0xffffff, tint: 1, at: [1.75 + Math.cos(a) * 1.55, 8.05, Math.sin(a) * 1.55], scale: [3.3, 0.06, 0.62], rot: [0, -a, -0.42] };
      }),
      ...[0, 1, 2].map((i): VPart => ({ geo: ICO, color: 0x4a3420, at: [1.75 + Math.cos(i * 2.1) * 0.3, 7.75, Math.sin(i * 2.1) * 0.3], scale: [0.22, 0.24, 0.22] })),
    ], 0.55, 4),
  };
}

// ------------------------------------------------------------- particles --

const MOTE_VERT = /* glsl */ `
attribute vec4 aCol;
attribute vec2 aSize;
uniform float uScale;
varying vec4 vCol;
varying float vAdd;
varying float vSoft;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = aSize.x * uScale / max(-mv.z, 0.1);
  // Specks stay specks even right in front of the lens; big puffs may grow.
  gl_PointSize = min(sz, uScale * (aSize.x < 1.0 ? 0.022 : 0.4));
  vCol = aCol;
  // Fade what drifts into the lens (big puffs from further away).
  vCol.a *= smoothstep(0.6, 2.0, sz) * smoothstep(0.4, 1.6, -mv.z) * smoothstep(aSize.x * 0.5, aSize.x * 1.6, -mv.z);
  vAdd = aSize.y;
  vSoft = step(1.0, aSize.x);
  if (aCol.a < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
// Premultiplied output: aSize.y = 1 is purely additive (glows), 0 is normal blending.
const MOTE_FRAG = /* glsl */ `
varying vec4 vCol;
varying float vAdd;
varying float vSoft;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = 1.0 - dot(q, q) * 4.0;
  if (d <= 0.0) discard;
  float a = vCol.a * d * d * mix(1.0, d, vSoft);
  gl_FragColor = vec4(vCol.rgb * a, a * (1.0 - vAdd));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function moteMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    uniforms: { uScale: { value: 400 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

/** A pool of points whose positions, colours and sizes are written on the CPU. */
class PointPool {
  points: THREE.Points;
  pos: Float32Array;
  col: Float32Array;
  size: Float32Array;
  private attrs: THREE.BufferAttribute[];
  constructor(public n: number, material: THREE.ShaderMaterial) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n * 2);
    const geo = new THREE.BufferGeometry();
    this.attrs = [new THREE.BufferAttribute(this.pos, 3), new THREE.BufferAttribute(this.col, 4), new THREE.BufferAttribute(this.size, 2)];
    this.attrs.forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('position', this.attrs[0]);
    geo.setAttribute('aCol', this.attrs[1]);
    geo.setAttribute('aSize', this.attrs[2]);
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    const buf = new THREE.Vector2();
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(buf);
      material.uniforms.uScale.value = buf.y * 0.5 * camera.projectionMatrix.elements[5];
    };
  }
  commit() {
    for (const a of this.attrs) a.needsUpdate = true;
  }
}

interface MoteKind {
  color: number;
  size: [number, number];
  alpha: number;
  /** 1 glows (additive), 0 is dusty. */
  add: number;
  /** Brightness of glowing kinds (dusty ones follow the daylight). */
  bright?: number;
  vel: V3;
  wander: number;
  life: [number, number];
  y: [number, number];
  radius: number;
  /** Fraction of the pool this kind may take (big soft ones are costly). */
  share: number;
  sunlit?: boolean;
  blink?: boolean;
  windy?: number;
}
// dust, firefly, ember, ash, sand, mist, spore, snow
const MOTES: MoteKind[] = [
  { color: 0xffe2b0, size: [0.03, 0.06], alpha: 0.5, add: 1, bright: 0.9, vel: [0.1, 0.03, 0.06], wander: 0.2, life: [6, 11], y: [0.3, 5], radius: 16, share: 1, sunlit: true },
  { color: 0xc8ff5a, size: [0.1, 0.16], alpha: 1, add: 1, bright: 1.8, vel: [0, 0.04, 0], wander: 0.8, life: [5, 9], y: [0.3, 2.8], radius: 22, share: 1, blink: true },
  { color: 0xff6418, size: [0.06, 0.12], alpha: 1, add: 1, bright: 2.2, vel: [0.2, 1.3, 0.15], wander: 0.6, life: [2.5, 5], y: [-0.5, 3], radius: 20, share: 1, windy: 1 },
  { color: 0x5e5854, size: [0.05, 0.1], alpha: 0.85, add: 0, vel: [0, -0.45, 0], wander: 0.35, life: [6, 10], y: [1, 10], radius: 20, share: 1, windy: 2 },
  { color: 0xc8a676, size: [0.035, 0.07], alpha: 0.75, add: 0, vel: [0, 0.05, 0], wander: 0.6, life: [1.5, 3], y: [0.05, 2], radius: 15, share: 1, windy: 14 },
  { color: 0xc4ccc4, size: [3.5, 7], alpha: 0.13, add: 0, vel: [0, 0.02, 0], wander: 0.12, life: [10, 16], y: [0.2, 2.2], radius: 30, share: 0.22, windy: 1.2 },
  { color: 0xb48cff, size: [0.06, 0.1], alpha: 0.9, add: 1, bright: 1.4, vel: [0, 0.12, 0], wander: 0.35, life: [6, 10], y: [0.3, 4], radius: 20, share: 1 },
  { color: 0xf4f8ff, size: [0.05, 0.1], alpha: 0.95, add: 0, vel: [0.25, -1.1, 0.15], wander: 0.5, life: [5, 9], y: [0.5, 12], radius: 22, share: 1, windy: 3 },
];
/** What floats in the air of each region, by day and by night. */
const MOTE_MIX: Record<ZoneId, [number[], number[]]> = {
  town: [[0.3, 0, 0, 0, 0, 0, 0, 0], [0, 0.12, 0, 0, 0, 0.3, 0, 0]],
  plains: [[0.45, 0, 0, 0, 0, 0, 0, 0], [0, 0.4, 0, 0, 0, 0.3, 0, 0]],
  forest: [[0.5, 0, 0, 0, 0, 0.5, 0, 0], [0, 0.8, 0, 0, 0, 0.8, 0, 0]],
  desert: [[0.12, 0, 0, 0, 0.85, 0, 0, 0], [0, 0, 0, 0, 0.45, 0, 0, 0]],
  volcano: [[0, 0, 0.55, 0.45, 0, 0, 0, 0], [0, 0, 0.6, 0.4, 0, 0, 0, 0]],
  coast: [[0.3, 0, 0, 0, 0, 0.6, 0, 0], [0, 0.08, 0, 0, 0, 0.8, 0, 0]],
  swamp: [[0.15, 0, 0, 0, 0, 1.6, 0, 0], [0, 0.6, 0, 0, 0, 2, 0, 0]],
  crossroads: [[0, 0, 0, 0, 0, 1.6, 0.35, 0], [0, 0, 0, 0, 0, 2, 0.5, 0]],
  badlands: [[0.1, 0, 0.08, 0.25, 0.4, 0, 0, 0], [0, 0, 0.12, 0.25, 0.3, 0, 0, 0]],
  peaks: [[0.15, 0, 0, 0, 0, 0.5, 0, 1.2], [0, 0, 0, 0, 0, 0.6, 0, 1.4]],
  cinder: [[0, 0, 0.8, 0.7, 0, 0, 0, 0], [0, 0, 0.9, 0.5, 0, 0, 0, 0]],
  dunes: [[0.1, 0, 0, 0, 1.2, 0, 0, 0], [0, 0.1, 0, 0, 0.6, 0, 0, 0]],
  elderwood: [[0.6, 0, 0, 0, 0, 0.7, 0, 0], [0, 1, 0, 0, 0, 1, 0.2, 0]],
  jungle: [[0.4, 0, 0, 0, 0, 0.9, 0, 0], [0, 1.4, 0, 0, 0, 1.1, 0, 0]],
  ocean: [[0.2, 0, 0, 0, 0, 0.7, 0, 0], [0, 0.1, 0, 0, 0, 0.9, 0, 0]],
};

// ------------------------------------------------------------- god rays --

const RAY_VERT = /* glsl */ `
attribute vec4 aBase;
attribute float aPhase;
uniform vec3 uSun;
uniform vec3 uFocus;
uniform float uR;
uniform float uTime;
varying vec2 vUv;
varying float vA;
void main() {
  vec2 rel = mod(aBase.xy - uFocus.xz + uR, 2.0 * uR) - uR;
  vec3 base = vec3(uFocus.x + rel.x, uFocus.y - 1.5, uFocus.z + rel.y);
  // Steeper than the real sun so low light still reads as shafts, not sheets on the ground.
  vec3 axis = normalize(vec3(uSun.x, max(uSun.y, 0.75), uSun.z));
  vec3 toCam = normalize(cameraPosition - base);
  vec3 side = normalize(cross(axis, toCam));
  vec3 p = base + axis * position.y * aBase.w + side * position.x * aBase.z * (0.55 + 0.45 * position.y);
  vUv = position.xy;
  // Fade at the edge of the patch and when seen end-on (the quad turns to a sliver).
  vA = (1.0 - smoothstep(uR * 0.6, uR, length(rel))) * (0.55 + 0.45 * sin(uTime * 0.35 + aPhase * 6.283)) * smoothstep(0.98, 0.7, abs(dot(axis, toCam)));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RAY_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vA;
void main() {
  float across = 1.0 - abs(vUv.x);
  // Brightest just above the ground, fading up toward the sun.
  float along = smoothstep(0.03, 0.25, vUv.y) * (1.0 - smoothstep(0.4, 1.0, vUv.y));
  gl_FragColor = vec4(uColor * across * across * along * vA, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ------------------------------------------------------------ rune rings --

const RUNE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const RUNE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 uColor;
uniform float uTime;
uniform float uGlow;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float a = uTime * 0.12;
  vec2 r = vec2(c.x * cos(a) - c.y * sin(a), c.x * sin(a) + c.y * cos(a));
  float t = texture2D(map, r + 0.5).a;
  float pulse = 0.75 + 0.25 * sin(uTime * 1.7 - length(c) * 14.0);
  gl_FragColor = vec4(uColor * t * pulse * uGlow, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function runeTexture(): THREE.Texture {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const rand = mulberry32(77);
  g.translate(N / 2, N / 2);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.shadowColor = '#fff';
  g.shadowBlur = 6;
  const circle = (r: number, w: number) => {
    g.lineWidth = w;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.stroke();
  };
  circle(122, 2.5);
  circle(92, 2);
  circle(60, 1.5);
  // Runes between the two outer circles, each a few strokes in a small cell.
  for (let i = 0; i < 22; i++) {
    g.save();
    g.rotate((i / 22) * TAU);
    g.translate(0, -107);
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(0, 9);
    for (let k = 0; k < 2 + Math.floor(rand() * 2); k++) {
      const y = (rand() - 0.5) * 16;
      const s = rand() < 0.5 ? -1 : 1;
      g.moveTo(0, y);
      g.lineTo(s * (4 + rand() * 4), y + (rand() - 0.5) * 10);
    }
    g.stroke();
    g.restore();
  }
  // A star of lines tying the inner circles together.
  g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 0; i <= 7; i++) {
    const a = ((i * 3) / 7) * TAU;
    const x = Math.sin(a) * 90;
    const y = -Math.cos(a) * 90;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

// ----------------------------------------------------------------- world --

interface PlantTile {
  mesh: THREE.InstancedMesh;
  x: number;
  z: number;
  range: number;
}

/** What every plant tile is made from (built once). */
interface PlantKit {
  geos: Record<Exclude<PlantKind, 'rock'>, THREE.BufferGeometry>;
  plantMat: THREE.Material;
  rockMat: THREE.Material;
  grassScale: number;
}

/** How thickly each kind grows in each region (per 6 m candidate spot). */
const DENSITY: Partial<Record<ZoneId, Partial<Record<PlantKind, number>>>> = {
  plains: { oak: 0.032, birch: 0.006, bush: 0.02, rock: 0.02, grass: 0.5, flowers: 0.16 },
  forest: { pine: 0.27, oak: 0.05, birch: 0.035, bush: 0.045, rock: 0.03, grass: 0.35, toadstool: 0.02 },
  desert: { cactus: 0.025, rock: 0.03, dead: 0.008 },
  volcano: { ashtree: 0.024, rock: 0.06 },
  coast: { oak: 0.012, bush: 0.02, rock: 0.04, grass: 0.12, reeds: 0.04 },
  swamp: { dead: 0.1, mushroom: 0.05, reeds: 0.1, grass: 0.32, rock: 0.02 },
  crossroads: { dead: 0.06, crystal: 0.025, rock: 0.05, grass: 0.12 },
  badlands: { dead: 0.012, rock: 0.05 },
  town: { grass: 0.15, flowers: 0.05 },
  peaks: { pine: 0.09, rock: 0.07, grass: 0.12, dead: 0.004 },
  cinder: { ashtree: 0.03, rock: 0.08, dead: 0.01, crystal: 0.004 },
  dunes: { cactus: 0.006, rock: 0.012, dead: 0.003 },
  elderwood: { oak: 0.065, pine: 0.07, birch: 0.02, bush: 0.05, rock: 0.03, grass: 0.3, toadstool: 0.03, mushroom: 0.01 },
  jungle: { palm: 0.08, oak: 0.06, bush: 0.12, grass: 0.45, flowers: 0.08, reeds: 0.05, mushroom: 0.01 },
  ocean: { palm: 0.06, bush: 0.03, rock: 0.03, grass: 0.15, reeds: 0.02 },
};
/** Palms crowd round an oasis. */
const OASIS_PLANTS: Partial<Record<PlantKind, number>> = { palm: 0.28, bush: 0.08, grass: 0.4, reeds: 0.08 };
const PALETTES: Partial<Record<PlantKind, Partial<Record<ZoneId, number[]>>>> = {
  // Golden canopies on the plains, amber and green in the wood, autumn by the coast.
  oak: {
    plains: [0xc8962a, 0xd8a838, 0xb07a24, 0xa89a34], forest: [0x4a5a2a, 0x5a6a30, 0x8a6a28, 0x6a7a34], coast: [0x7a8a40, 0x9a6a30],
    elderwood: [0x3a4a22, 0x2e4020, 0x4a5a28, 0x5a5a26], jungle: [0x2a6a20, 0x347a28, 0x226020],
  },
  birch: { plains: [0xd8b440, 0xc8c050], forest: [0xb8b848, 0xd0a840, 0x98a840], elderwood: [0x98a840, 0xa8a038] },
  // Frosted pines up in the Frostspine.
  pine: { forest: [0xffffff, 0xd8e8d0, 0xc0d0c8, 0xe8e0c0], peaks: [0xe8f0f4, 0xd8e4e8, 0xf4f8fa], elderwood: [0xb0c8a8, 0xc0d0b8, 0xa8b8a0] },
  bush: { plains: [0x8a8a38, 0xa08a34], forest: [0x4a5a2c, 0x5a6232], coast: [0x6a7a40], elderwood: [0x3a4a24, 0x44522a], jungle: [0x2a6a24, 0x3a7a2a], ocean: [0x4a7a34], dunes: [0x5a7a34] },
  palm: { jungle: [0x4a8a2a, 0x3a7a24, 0x5a9a34], ocean: [0x6a9a3a, 0x5a8a30], dunes: [0x6a8a34, 0x7a9a3a] },
  flowers: { plains: [0xffd040, 0xffc020, 0xfff0d0, 0xe04030], town: [0xffd040, 0xfff0d0], jungle: [0xff4a6a, 0xffa020, 0xc040ff] },
  toadstool: { forest: [0xb83a2a, 0xa8402a, 0x9a7a50], elderwood: [0xb83a2a, 0x9a7a50] },
  mushroom: { swamp: [0x40e0c0, 0x60c0ff, 0xb070ff], elderwood: [0x60c0ff], jungle: [0xff70c0, 0xffb040] },
  crystal: { crossroads: [0xa070ff, 0x7060ff, 0xc080ff], cinder: [0xff6a20, 0xff9a40] },
};
/** Trees in the Elderwood grow huge. */
const GIANT: Partial<Record<ZoneId, number>> = { elderwood: 1.45, jungle: 1.15 };

/** A chimney, brazier or the volcano's plume, drawn from the shared smoke pool. */
interface SmokeSource {
  x: number;
  y: number;
  z: number;
  kind: 0 | 1 | 2;
  first: number;
  count: number;
  seed: number;
  on: boolean;
}
// chimney smoke, brazier fire, volcano plume
const SMOKE = [
  { life: 7, n: [5, 8], range: 180 },
  { life: 0.9, n: [4, 7], range: 120 },
  { life: 14, n: [12, 22], range: 2000 },
] as const;

/** Ground and plants are built (a little each frame) out to this far from the hero, and the nearest at once on arrival. */
const BUILD_R = 560;
const PRIME_R = 160;
/** On the host, trees' and rocks' colliders are built this far around every other hero (for the monsters it runs there). */
const COLLIDE_R = 230;
/** Ground vertices per tile side, by quality. */
const GROUND_SEGS = { low: 32, medium: 40, high: 50 } as const;
const tileKey = (cx: number, cz: number) => (cx + 64) * 128 + cz + 64;
/** Distance from a point to the nearest edge of a tile (0 inside it). */
function tileGap(x: number, z: number, cx: number, cz: number): number {
  const dx = Math.max(0, cx * TILE - x, x - (cx + 1) * TILE);
  const dz = Math.max(0, cz * TILE - z, z - (cz + 1) * TILE);
  return Math.hypot(dx, dz);
}

export class World {
  root = new THREE.Group();
  colliders: Collider[] = [];
  private grid = new Map<string, Collider[]>();
  interactables: Interactable[] = [];
  emitters: Emitter[] = [];
  trialFog = new Map<string, THREE.Mesh>();
  sky: Sky;
  sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
  hemi = new THREE.HemisphereLight(0xc8b890, 0x3a3020, 0.9);
  ambient = new THREE.AmbientLight(0x404050, 0.25);
  water!: THREE.Mesh;
  lava!: THREE.Mesh;
  eyeMaterial!: THREE.MeshStandardMaterial;
  giantOrb!: THREE.Mesh;
  private lights: THREE.PointLight[] = [];
  /** A soft moonlit glow around the hero at night, so the hero and nearby ground stay readable. */
  private heroLight = new THREE.PointLight(0xa8b8ff, 0, 16, 1.4);
  /** 0-1: the Sun Tree's warm light round the hero (engine/sun.ts). */
  heroWarm = 0;
  private lightPick: (Emitter | null)[] = [];
  private animated: { obj: THREE.Object3D; kind: 'spin' | 'bob' | 'flicker'; base: number }[] = [];
  private batch = new Batcher();
  private rand = mulberry32(42);
  /** Building a prop for builder mode: at the origin, with no collider, smoke or light of its own. */
  private propMode = false;
  /** Wild plants builder mode has taken away (by where they grew), so their tiles leave them out. */
  private cuts = new Set<string>();
  /** The wild plants' colliders, by where they grew (so a cut plant stops blocking). */
  private plantCol = new Map<string, Collider>();
  private cutKept = new Map<string, { mesh: THREE.InstancedMesh; i: number; m: THREE.Matrix4 }[]>();
  private detail = detailTexture();
  private time = { value: 0 };
  private wind = { value: new THREE.Vector2(0.2, 0.1) };
  /** Blades of grass round the hero. */
  private grass!: GrassField;
  private glow = { value: 0.2 };
  /** Daylight scattering through leaves and blades, so shaded foliage isn't a black mass. */
  private leafLift = { value: 0.3 };
  private waterU!: Record<string, THREE.IUniform>;
  private lavaTime = { value: 0 };
  private plantTiles: PlantTile[] = [];
  /** Ground tiles built so far (they stay: about 0.1 MB each), the one being built, and those wanted. */
  private groundTiles: { mesh: THREE.Mesh; x: number; z: number }[] = [];
  private built = new Set<number>();
  private job: { key: number; it: Generator<void, void> } | null = null;
  private wanted: { key: number; cx: number; cz: number }[] = [];
  /** Tiles whose plant colliders exist (built in full, or colliders only around another hero). */
  private collided = new Set<number>();
  private colJob: { key: number; it: Generator<void, void> } | null = null;
  private wantedCol: { key: number; cx: number; cz: number }[] = [];
  /** On the co-op host: where the other heroes are. Set by the game each frame. */
  others: { x: number; z: number }[] = [];
  /** Arrived somewhere unbuilt (a new game, fast travel, a respawn): the nearby tiles are still being built, and the screen is veiled. */
  priming = true;
  private wantT = 0;
  private segs: number;
  private shoreData!: Uint8Array;
  private shoreTex!: THREE.DataTexture;
  private plants!: PlantKit;
  private motes!: PointPool;
  private moteState!: { vel: Float32Array; age: Float32Array; life: Float32Array; kind: Int8Array; seed: Float32Array; alpha: Float32Array; mix: Float32Array };
  private smoke!: PointPool;
  private smokeSrc: SmokeSource[] = [];
  private rays: THREE.Mesh | null = null;
  private runes: THREE.Mesh | null = null;
  private zoneWind = 1;
  private cover = 0.56;

  constructor(scene: THREE.Scene, private quality: Quality) {
    this.sky = new Sky(quality === 'low');
    scene.add(this.root);
    scene.add(this.sky.mesh);
    scene.add(this.hemi, this.ambient, this.sun, this.sun.target);
    this.sun.castShadow = quality !== 'low';
    const sm = quality === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -45;
    cam.right = cam.top = 45;
    cam.near = 1;
    cam.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    for (let i = 0; i < (quality === 'low' ? 2 : 5); i++) {
      if (i === 0) scene.add(this.heroLight);
      const l = new THREE.PointLight(0xffa040, 0, 20, 1.6);
      this.lights.push(l);
      this.lightPick.push(null);
      scene.add(l);
    }

    // The ground and plants stream in by tile around the hero (see stream()).
    this.segs = GROUND_SEGS[quality];
    this.buildWater();
    this.buildLava();
    this.buildGiant();
    this.plants = this.plantKit();
    this.buildTown();
    this.buildDocks();
    this.buildShrines();
    this.buildTrials();
    this.buildLairs();
    this.buildEyeRuins();
    this.buildLoreAndLoot();
    this.buildField();
    this.buildStations();
    this.buildNellStall();
    this.grass = new GrassField(groundStep(this.segs), quality, this.time, this.wind, (x, z) => this.bare(x, z));
    this.root.add(this.grass.root);
    this.batch.build(this.root, quality !== 'low');
    this.buildMotes();
    this.buildSmoke();
    this.buildRays();
  }

  // ------------------------------------------------------------ colliders --

  addCollider(x: number, z: number, r: number, top = heightAt(x, z) + 8) {
    if (this.propMode) return { x, z, r, top };
    const c = { x, z, r, top };
    this.colliders.push(c);
    this.gridAdd(c);
    return c;
  }

  private gridAdd(c: Collider) {
    const { x, z, r } = c;
    const cx0 = Math.floor((x - r) / 16), cx1 = Math.floor((x + r) / 16);
    const cz0 = Math.floor((z - r) / 16), cz1 = Math.floor((z + r) / 16);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = `${cx},${cz}`;
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(c);
      }
  }

  /** Takes a collider away again (a placed prop moved or deleted, a wild plant cut). */
  removeCollider(c: Collider) {
    const i = this.colliders.indexOf(c);
    if (i >= 0) this.colliders.splice(i, 1);
    for (const list of this.grid.values()) {
      const k = list.indexOf(c);
      if (k >= 0) list.splice(k, 1);
    }
  }

  /** Pushes a circle out of static colliders. */
  resolve(pos: THREE.Vector3, radius: number): void {
    const list = this.grid.get(`${Math.floor(pos.x / 16)},${Math.floor(pos.z / 16)}`);
    if (list) {
      for (const c of list) {
        const dx = pos.x - c.x;
        const dz = pos.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + radius;
        if (d < min && d > 1e-4) {
          pos.x = c.x + (dx / d) * min;
          pos.z = c.z + (dz / d) * min;
        }
      }
    }
    const lim = WORLD_HALF - 8;
    pos.x = Math.max(-lim, Math.min(lim, pos.x));
    pos.z = Math.max(-lim, Math.min(lim, pos.z));
  }

  /**
   * How far a ray from (ax, ay, az) runs before it enters a collider wider than `minR`
   * (padded by `pad`). (dx, dz) is a horizontal unit direction, dy the rise per unit of
   * horizontal travel; distances are horizontal. Returns `len` when clear.
   */
  rayHit(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, len: number, pad: number, minR = 0.5): number {
    let best = len;
    let lastX = NaN, lastZ = NaN;
    for (let t = 0; ; t = Math.min(len, t + 4)) {
      const cx = Math.floor((ax + dx * t) / 16), cz = Math.floor((az + dz * t) / 16);
      if (cx !== lastX || cz !== lastZ) {
        lastX = cx;
        lastZ = cz;
        const list = this.grid.get(`${cx},${cz}`);
        if (list) {
          for (const c of list) {
            if (c.r < minR) continue;
            const fx = ax - c.x, fz = az - c.z, R = c.r + pad;
            const b = fx * dx + fz * dz;
            const cc = fx * fx + fz * fz - R * R;
            // Starting inside it, or heading away.
            if (cc <= 0 || b >= 0) continue;
            const disc = b * b - cc;
            if (disc < 0) continue;
            const hit = -b - Math.sqrt(disc);
            if (hit < best && ay + dy * hit < c.top + pad) best = hit;
          }
        }
      }
      if (t >= len) break;
    }
    return best;
  }

  /** True if a straight line between two points crosses a collider (rough line of sight). */
  blocked(ax: number, az: number, bx: number, bz: number): boolean {
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 4);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const list = this.grid.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`);
      if (list) for (const c of list) if (c.r > 1.2 && Math.hypot(x - c.x, z - c.z) < c.r * 0.8) return true;
    }
    return false;
  }

  // ---------------------------------------------------------- builder mode --

  /** Builds one prop as a model of its own, its foot at the origin (for builder mode). */
  makeProp(kind: PropKind): THREE.Group {
    const g = new THREE.Group();
    if (PLANT_KINDS.includes(kind)) {
      g.add(this.makePlant(kind as PlantKind));
      return g;
    }
    const saved = this.batch, savedRand = this.rand;
    this.batch = new Batcher(saved.matte, saved.metal);
    this.rand = mulberry32(kind.length * 977 + kind.charCodeAt(0));
    this.propMode = true;
    try {
      this.paintProp(kind);
      this.batch.build(g, this.quality !== 'low');
    } finally {
      this.propMode = false;
      this.rand = savedRand;
      this.batch = saved;
    }
    return g;
  }

  /** One plant, drawn the way the wild ones are (they sway in the wind). */
  private makePlant(kind: PlantKind): THREE.Object3D {
    const { geos, plantMat, rockMat } = this.plants;
    const mesh = new THREE.InstancedMesh(kind === 'rock' ? rockGeometry() : geos[kind as Exclude<PlantKind, 'rock'>], kind === 'rock' ? rockMat : plantMat, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, kind === 'rock' ? -0.3 : -0.1, 0));
    mesh.setColorAt(0, new THREE.Color(PLANT_TINT[kind] ?? 0xffffff));
    mesh.computeBoundingSphere();
    mesh.castShadow = this.quality !== 'low';
    mesh.receiveShadow = true;
    return mesh;
  }

  /** The building blocks and props builder mode places (painted like the town's own). */
  private paintProp(kind: PropKind) {
    const b = this.batch;
    const stone = 0x7a746a, dark = 0x5a554c, wood = 0x7a5a36, timber = 0x3e2a1a;
    switch (kind) {
      case 'house':
        return this.house(0, 0, 0);
      case 'big-house':
        return this.house(0, 0, 0, 9, 7, 4.8);
      case 'barrel':
        return this.barrel(0, 0);
      case 'crate':
        return this.crate(0, 0, 0, 1);
      case 'banner':
        return this.banner(0, 0, 0);
      case 'fence':
        return this.fence(-2.4, 0, 2.4, 0);
      case 'brazier':
        return this.brazier(0, 0);
      case 'stone-block':
        if (b.model('stone-block', [], 0, 0, 0)) return;
        b.paint(BOX, stone, 0, 1, 0, 0, 2, 2, 2);
        for (const y of [0.02, 1.98]) b.paint(BOX, dark, 0, y, 0, 0, 2.04, 0.08, 2.04);
        return;
      case 'wood-block':
        if (b.model('wood-block', [], 0, 0, 0)) return;
        b.paint(BOX, wood, 0, 1, 0, 0, 2, 2, 2);
        for (const y of [0.5, 1.0, 1.5]) b.paint(BOX, timber, 0, y, 0, 0, 2.03, 0.05, 2.03);
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.paint(BOX, timber, x * 0.97, 1, z * 0.97, 0, 0.14, 2.02, 0.14);
        return;
      case 'wall':
        b.paint(BOX, stone, 0, 1.5, 0, 0, 4, 3, 0.7);
        b.paint(BOX, dark, 0, 3.08, 0, 0, 4.2, 0.18, 0.9);
        for (let i = 0; i < 3; i++) b.paint(BOX, 0x6e685e, -1.4 + i * 1.4, 0.75 + (i % 2) * 1.2, 0.36, 0, 1.1, 0.5, 0.04);
        return;
      case 'floor':
        if (b.model('floor', [], 0, 0, 0)) return;
        b.paint(BOX, wood, 0, 0.12, 0, 0, 4, 0.24, 4);
        for (let i = 0; i < 5; i++) b.paint(BOX, timber, -1.6 + i * 0.8, 0.245, 0, 0, 0.04, 0.02, 4);
        return;
      case 'pillar':
        if (b.model('pillar', [], 0, 0, 0)) return;
        b.paint(BOX, dark, 0, 0.2, 0, 0, 1.3, 0.4, 1.3);
        b.paint(CYL, stone, 0, 2.2, 0, 0, 0.9, 3.6, 0.9);
        b.paint(BOX, dark, 0, 4.2, 0, 0, 1.3, 0.4, 1.3);
        return;
      case 'stairs':
        if (b.model('stairs', [], 0, 0, 0)) return;
        for (let i = 0; i < 4; i++) b.paint(BOX, stone, 0, 0.25 + i * 0.5, -1.5 + i * 1, 0, 3, 0.5 + i * 1, 1);
        for (let i = 0; i < 4; i++) b.paint(BOX, dark, 0, 0.5 + i * 1, -1.5 + i * 1, 0, 3.02, 0.06, 1.02);
        return;
      case 'roof':
        if (b.model('roof', [], 0, 0, 0)) return;
        b.paint(ROOF, 0x4a2e22, 0, 0, 0, 0, 2.6, 2, 4.4);
        b.paint(BOX, timber, 0, 2, 0, 0, 0.16, 0.16, 4.6);
        return;
      case 'tower':
        if (b.model('tower', [], 0, 0, 0)) return;
        b.paint(CYL, stone, 0, 4, 0, 0, 4, 8, 4);
        b.paint(CYL, dark, 0, 8.2, 0, 0, 4.6, 0.5, 4.6);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          b.paint(BOX, stone, Math.cos(a) * 2.1, 8.9, Math.sin(a) * 2.1, -a, 0.7, 0.9, 0.7);
        }
        b.paint(BOX, 0x1a1612, 0, 1.2, 2.0, 0, 1.2, 2.4, 0.1);
        for (const y of [4, 6.2]) b.paint(BOX, 0x1a1612, 2.02, y, 0, Math.PI / 2, 0.5, 0.9, 0.08);
        return;
      case 'arch':
        if (b.model('arch', [], 0, 0, 0)) return;
        for (const x of [-1.8, 1.8]) {
          b.paint(BOX, stone, x, 2, 0, 0, 0.9, 4, 0.9);
          b.paint(BOX, dark, x, 0.15, 0, 0, 1.1, 0.3, 1.1);
        }
        b.paint(BOX, stone, 0, 4.3, 0, 0, 4.6, 0.7, 1);
        b.paint(BOX, dark, 0, 4.75, 0, 0, 4.8, 0.2, 1.1);
        return;
      case 'lamp': {
        if (b.model('lamp', [], 0, 0, 0)) return b.modelIn('lamp.lit', mat(0xffd080, { emissive: 0xffb040, emissiveIntensity: 2 }), 0, 0, 0);
        b.paint(CYL6, 0x2a2622, 0, 1.6, 0, 0, 0.14, 3.2, 0.14, 0, 0, true);
        b.paint(BOX, 0x2a2622, 0.3, 3.15, 0, 0, 0.7, 0.08, 0.08, 0, 0, true);
        b.paint(BOX, 0x2a2622, 0.6, 2.85, 0, 0, 0.36, 0.06, 0.36, 0, 0, true);
        b.add(BOX, mat(0xffd080, { emissive: 0xffb040, emissiveIntensity: 2 }), 0.6, 2.62, 0, 0, 0.26, 0.4, 0.26);
        return;
      }
      case 'statue':
        if (b.model('statue', [], 0, 0, 0)) return;
        b.paint(BOX, dark, 0, 0.6, 0, 0, 2, 1.2, 2);
        b.paint(CYL, 0x9a968c, 0, 2.3, 0, 0, 0.9, 2.2, 0.7);
        b.paint(ICO, 0x9a968c, 0, 3.75, 0, 0, 0.42, 0.48, 0.42);
        for (const s of [-1, 1]) b.paint(CYL, 0x9a968c, s * 0.62, 2.7, 0, 0, 0.26, 1.4, 0.26, 0, s * 0.35);
        b.paint(CYL6, 0x8a867c, 0.9, 2.6, 0.1, 0, 0.1, 3.6, 0.1);
        return;
      case 'well':
        if (b.model('well', [0, 0x4a2e22], 0, 0, 0, 0, 0.75)) return;
        b.paint(CYL, stone, 0, 0.5, 0, 0, 2.4, 1, 2.4);
        b.paint(CYL, 0x1a2a3a, 0, 0.9, 0, 0, 1.9, 0.12, 1.9);
        for (const x of [-1.05, 1.05]) b.paint(BOX, timber, x, 1.6, 0, 0, 0.16, 2.2, 0.16);
        b.paint(ROOF, 0x4a2e22, 0, 2.6, 0, 0, 1.2, 0.8, 1.6);
        b.paint(CYL, timber, 0, 2.2, 0, 0, 0.12, 2.1, 0.12, 0, Math.PI / 2);
        return;
      case 'tent':
        if (b.model('tent', [0xb8a888], 0, 0, 0)) return;
        b.paint(CONE4, 0xb8a888, 0, 1.4, 0, Math.PI / 4, 3.4, 2.8, 3.4);
        b.paint(BOX, 0x1a1612, 0, 0.6, 1.25, 0, 0.8, 1.2, 0.04);
        b.paint(CYL6, timber, 0, 3.0, 0, 0, 0.08, 0.5, 0.08);
        return;
      case 'campfire': {
        if (!b.model('campfire', [], 0, 0, 0)) for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          b.paint(ROCK, 0x6a645a, Math.cos(a) * 0.8, 0.1, Math.sin(a) * 0.8, a, 0.25, 0.2, 0.25);
        }
        if (!worldMesh('campfire')) for (let i = 0; i < 3; i++) b.paint(CYL6, 0x3a2a1c, 0, 0.18, 0, (i / 3) * Math.PI, 0.14, 1.1, 0.14, Math.PI / 2 - 0.2, 0);
        b.add(CONE8, mat(0xff9030, { emissive: 0xff5010, emissiveIntensity: 2.4 }), 0, 0.5, 0, 0, 0.6, 0.8, 0.6);
        return;
      }
    }
  }

  /** The wild trees, rocks and bushes drawn near the hero (what builder mode can pick up). */
  pickablePlants(near: THREE.Vector3, r: number): THREE.InstancedMesh[] {
    const reach = r + TILE * 0.71;
    return this.plantTiles
      .filter((t) => t.mesh.visible && Math.hypot(t.x - near.x, t.z - near.z) < reach && !SMALL.includes(t.mesh.userData.kind) && t.mesh.userData.kind !== 'grass')
      .map((t) => t.mesh);
  }

  /** What a ray from the camera hit among the plants: which plant, and where it grew. */
  plantHit(mesh: THREE.InstancedMesh, index: number): PlantHit | null {
    const at = mesh.userData.at as number[] | undefined;
    if (!at || index * 4 + 3 >= at.length) return null;
    return { mesh, index, kind: mesh.userData.kind, x: at[index * 4], z: at[index * 4 + 1], scale: at[index * 4 + 2], turn: at[index * 4 + 3] };
  }

  /** Takes a wild plant away (it stops blocking, and its tile leaves it out if built again). */
  cutPlant(x: number, z: number) {
    const key = spotKey(x, z);
    if (this.cuts.has(key)) return;
    this.cuts.add(key);
    const c = this.plantCol.get(key);
    if (c) this.removeCollider(c);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const kept: { mesh: THREE.InstancedMesh; i: number; m: THREE.Matrix4 }[] = [];
    for (const t of this.plantTiles) {
      if (Math.abs(t.x - x) > TILE || Math.abs(t.z - z) > TILE) continue;
      const at = t.mesh.userData.at as number[] | undefined;
      if (!at) continue;
      for (let i = 0; i < at.length; i += 4) {
        if (spotKey(at[i], at[i + 1]) !== key) continue;
        const m = new THREE.Matrix4();
        t.mesh.getMatrixAt(i / 4, m);
        kept.push({ mesh: t.mesh, i: i / 4, m });
        t.mesh.setMatrixAt(i / 4, zero);
        t.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.cutKept.set(key, kept);
  }

  /** Puts a cut plant back (undo in builder mode). */
  uncutPlant(x: number, z: number) {
    const key = spotKey(x, z);
    if (!this.cuts.delete(key)) return;
    const c = this.plantCol.get(key);
    if (c) {
      this.colliders.push(c);
      this.gridAdd(c);
    }
    for (const { mesh, i, m } of this.cutKept.get(key) ?? []) {
      mesh.setMatrixAt(i, m);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.cutKept.delete(key);
  }

  /** Forgets every cut (loading another build): tiles built from now on grow them back. */
  clearCuts() {
    this.cuts.clear();
  }

  // -------------------------------------------------------------- builders --

  /** Where no grass grows: the town's roads and square, the farm, arenas, trials, shrines, docks, lairs, ruins. */
  private bare(x: number, z: number): boolean {
    const tx = x - TOWN.x, tz = z - TOWN.z, td = Math.hypot(tx, tz);
    if (td < TOWN.radius && (Math.min(Math.abs(tx), Math.abs(tz)) < 4.2 || td < 12.5)) return true;
    if (Math.abs(x - FIELD.x) < 7 && Math.abs(z - FIELD.z) < 7) return true;
    if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.radius + 2) return true;
    for (const t of TRIALS) if (Math.hypot(x - t.x, z - t.z) < t.radius + 2) return true;
    for (const s of SHRINES) if (Math.hypot(x - s.x, z - s.z) < 6) return true;
    for (const d of DOCKS) if (Math.hypot(x - d.x, z - d.z) < 10) return true;
    for (const l of LAIRS) if (Math.hypot(x - l.x, z - l.z) < 12) return true;
    return Math.hypot(x - EYES_RUINS.x, z - EYES_RUINS.z) < 22;
  }

  private groundY(x: number, z: number) {
    return this.propMode ? 0 : heightAt(x, z);
  }

  /**
   * The sea: ripples, fresnel sky reflection, sun glint and surf, with depth
   * from the ground (each ground tile fills in its part as it is built; the
   * rest reads as open sea until then, far off in the haze).
   */
  private buildWater() {
    const n = TILES * this.segs + 1;
    const data = new Uint8Array(n * n).fill(255);
    const shore = new THREE.DataTexture(data, n, n, THREE.RedFormat);
    shore.magFilter = shore.minFilter = THREE.LinearFilter;
    shore.needsUpdate = true;
    this.shoreData = data;
    this.shoreTex = shore;
    // Grid vertex i sits at -WORLD_HALF + i * step; map onto texel centres.
    const a = (n - 1) / (n * WORLD_HALF * 2);
    this.waterU = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uShoreXf: { value: new THREE.Vector2(a, WORLD_HALF * a + 0.5 / n) },
        uTime: { value: 0 },
        uLight: { value: 1 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uSky: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
      },
    ]);
    this.waterU.uDetail = { value: this.detail };
    this.waterU.uShore = { value: shore };
    const material = new THREE.ShaderMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, uniforms: this.waterU, transparent: true, fog: true });
    if (this.quality === 'low') material.defines = { WATER_LQ: '' };
    const geo = new THREE.PlaneGeometry(WORLD_HALF * 2 + 2600, WORLD_HALF * 2 + 2600, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, material);
    this.water.position.y = WATER_LEVEL;
    this.root.add(this.water);
  }

  private buildLava() {
    const geo = new THREE.RingGeometry(VOLCANO.platform - 1, VOLCANO.crater + 2, 48, 1);
    geo.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ color: 0xff5010, emissive: 0xff3000, emissiveIntensity: 2.2, roughness: 0.6 });
    // A crust that drifts and cracks over the glowing melt.
    const detail = this.detail;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uDetail = { value: detail };
      shader.uniforms.uTime = this.lavaTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vLP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nuniform float uTime;\nvarying vec2 vLP;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float lv = texture2D(uDetail, vLP * 0.045 + vec2(uTime * 0.006, uTime * 0.004)).b * 0.6 + texture2D(uDetail, vLP * 0.13 - uTime * 0.01).b * 0.4;
          float crust = smoothstep(0.42, 0.62, lv);
          totalEmissiveRadiance *= mix(1.5, 0.12, crust);
          diffuseColor.rgb *= mix(1.0, 0.15, crust);`,
        );
    };
    this.lava = new THREE.Mesh(geo, material);
    this.lava.position.set(VOLCANO.x, LAVA_LEVEL, VOLCANO.z);
    this.root.add(this.lava);
    // The Cinderwaste's pools, in the same melt.
    for (const p of LAVA_POOLS) {
      const pool = new THREE.Mesh(new THREE.CircleGeometry(p.r, 28).rotateX(-Math.PI / 2), material);
      pool.position.set(p.x, POOL_LAVA, p.z);
      this.root.add(pool);
      this.emitters.push({ pos: new THREE.Vector3(p.x, POOL_LAVA + 2, p.z), color: 0xff5010, intensity: 26, distance: p.r * 2.2, flicker: 0.3 });
      const haze = glowSprite(0xff6020, p.r * 2.6, 0.22);
      haze.position.set(p.x, POOL_LAVA + 4, p.z);
      this.root.add(haze);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = (VOLCANO.platform + VOLCANO.crater) / 2;
      this.emitters.push({ pos: new THREE.Vector3(VOLCANO.x + Math.cos(a) * r, LAVA_LEVEL + 2, VOLCANO.z + Math.sin(a) * r), color: 0xff5010, intensity: 30, distance: 40, flicker: 0.3 });
    }
    const smoke = glowSprite(0xff6020, 120, 0.25);
    smoke.position.set(VOLCANO.x, LAVA_LEVEL + 20, VOLCANO.z);
    this.root.add(smoke);
    this.smokeSource(VOLCANO.x, LAVA_LEVEL + 6, VOLCANO.z, 2);
  }

  /** The Giant who holds the world, visible from everywhere like a beacon. */
  private buildGiant() {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x5a5248, roughness: 1, fog: false, emissive: 0x16120c });
    const add = (w: number, h: number, d: number, x: number, y: number, z: number, rz = 0, rx = 0) => {
      const m = new THREE.Mesh(BOX, stone);
      m.scale.set(w, h, d);
      m.position.set(x, y, z);
      m.rotation.set(rx, 0, rz);
      g.add(m);
    };
    add(60, 80, 34, 0, 120, 0);
    add(70, 30, 38, 0, 170, 0);
    add(26, 30, 26, 0, 200, 0);
    add(24, 100, 26, -18, 40, 0);
    add(24, 100, 26, 18, 40, 0);
    add(18, 90, 18, -48, 130, 10, -0.35);
    add(18, 70, 18, 46, 165, 30, 0.2, -1.1);
    add(30, 8, 30, 52, 178, 62);
    this.giantOrb = new THREE.Mesh(new THREE.SphereGeometry(16, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffd890, emissive: 0xffb040, emissiveIntensity: 2.4, fog: false }));
    this.giantOrb.position.set(52, 198, 62);
    g.add(this.giantOrb);
    const halo = glowSprite(0xffc060, 160, 0.55);
    (halo.material as THREE.SpriteMaterial).fog = false;
    halo.position.copy(this.giantOrb.position);
    g.add(halo);
    // Far beyond the Frostspine, past the world's northern edge.
    g.position.set(-80, -90, -1350);
    g.scale.setScalar(1.7);
    g.rotation.y = 0.3;
    this.root.add(g);
  }

  /** The plants' shared geometry and materials (the plants themselves are built by tile, as the hero nears). */
  private plantKit(): PlantKit {
    const geos = plantGeometries(this.quality === 'high' ? 1 : 0);
    const plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 });
    const { time, wind, glow, leafLift } = this;
    const near = this.quality !== 'low';
    plantMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.uniforms.uWind = wind;
      shader.uniforms.uGlow = glow;
      shader.uniforms.uLift = leafLift;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VEG_VERT_PARS}`)
        .replace('#include <color_vertex>', VEG_COLOR)
        .replace('#include <project_vertex>', VEG_PROJECT);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uGlow;\nuniform float uLift;\nvarying float vGlow;\nvarying float vCamD;\nvarying float vLeaf;')
        // (Not on low: a discard costs phones their early depth test on all that foliage.)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${near ? VEG_NEAR_FADE : ''}`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (vGlow * uGlow + vLeaf * uLift);');
    };
    const rockMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true, vertexColors: !!worldMesh('rock') });
    return { geos, plantMat, rockMat, grassScale: this.quality === 'low' ? 0.3 : this.quality === 'medium' ? 0.6 : 1 };
  }

  /**
   * The plants of one tile, a row of candidate spots at a time. Each tile has
   * its own seed and every spot draws the same numbers whatever the quality,
   * so trees, rocks and their colliders stand in the same places for every
   * player (only grass and flowers thin out on lower settings).
   */
  private *plantTile(cx: number, cz: number, meshes = true): Generator<void, void> {
    const { geos, plantMat, rockMat, grassScale } = this.plants;
    // Colliders once per tile (a tile near another hero in co-op may have had them built already).
    const key = tileKey(cx, cz);
    const collide = !this.collided.has(key);
    const rand = mulberry32((((cx + 64) * 73856093) ^ ((cz + 64) * 19349663)) >>> 0);
    const sets = new Map<PlantKind, { mats: THREE.Matrix4[]; colors: THREE.Color[]; at: number[] }>();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const put = (kind: PlantKind, x: number, z: number, s: number, color: THREE.Color, sink: number, turn: number, tall: number) => {
      if (!meshes) return;
      let set = sets.get(kind);
      if (!set) sets.set(kind, (set = { mats: [], colors: [], at: [] }));
      const y = this.groundY(x, z) - sink * s;
      set.mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, turn * TAU), new THREE.Vector3(s, s * (0.85 + tall * 0.3), s)));
      set.colors.push(color);
      set.at.push(x, z, s, turn * TAU);
    };
    const col = (x: number, z: number, r: number, top?: number) => this.plantCol.set(spotKey(x, z), this.addCollider(x, z, r, top));
    const avoid = (x: number, z: number, pad: number) => {
      if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.radius + pad) return true;
      // The Arena of Ares is open ground (heroes fight there).
      if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.radius + pad + 4) return true;
      for (const t of TRIALS) if (Math.hypot(x - t.x, z - t.z) < t.radius + pad + 4) return true;
      for (const s of SHRINES) if (Math.hypot(x - s.x, z - s.z) < 8 + pad) return true;
      for (const d of DOCKS) if (Math.hypot(x - d.x, z - d.z) < 10 + pad) return true;
      if (Math.hypot(x - EYES_RUINS.x, z - EYES_RUINS.z) < 22 + pad) return true;
      return false;
    };
    const step = 6;
    const lim = WORLD_HALF - 10;
    for (let gz = cz * TILE + step / 2; gz < (cz + 1) * TILE; gz += step) {
      for (let gx = cx * TILE + step / 2; gx < (cx + 1) * TILE; gx += step) {
        const x = gx + (rand() - 0.5) * step;
        const z = gz + (rand() - 0.5) * step;
        if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
        const y = this.groundY(x, z);
        if (y < 0.6 || inLava(x, z, y)) continue;
        const zone = zoneAt(x, z);
        const oasis = zone === 'dunes' && OASES.some((o) => Math.hypot(x - o.x, z - o.z) < o.r * 2.4);
        const d = oasis ? OASIS_PLANTS : DENSITY[zone];
        if (!d) continue;
        const slope = normalAt(x, z).y;
        const clump = 0.5 + 0.5 * noise2(x / 40, z / 40);
        const giant = GIANT[zone] ?? 1;
        for (const [k, p] of Object.entries(d)) {
          const kind = k as PlantKind;
          // Always five draws, used or not, so the quality setting never shifts what grows where.
          const roll = rand(), pick = rand(), shade = rand(), size = rand(), turn = rand();
          const small = SMALL.includes(kind);
          const tree = TREES.includes(kind);
          const chance = p * (kind === 'grass' ? grassScale * 3 : small ? grassScale * 2 : 1) * (kind === 'pine' || kind === 'oak' || kind === 'birch' ? 0.4 + clump * 1.2 : 1);
          if (roll > chance) continue;
          if (kind !== 'grass' && kind !== 'rock' && slope < 0.8) continue;
          if (kind === 'reeds' && y > 3) continue;
          if (avoid(x, z, small ? -6 : 2)) continue;
          // Taken away in builder mode.
          if (!small && kind !== 'grass' && this.cuts.size && this.cuts.has(spotKey(x, z))) continue;
          const pal = PALETTES[kind]?.[zone];
          const color = pal ? new THREE.Color(pal[Math.floor(pick * pal.length)]) : new THREE.Color(1, 1, 1);
          color.multiplyScalar(0.9 + shade * 0.2);
          const tall = (turn * 7.31) % 1;
          if (kind === 'grass') {
            put('grass', x, z, 0.8 + size * 0.8, color.setHex(GRASS[zone] ?? ZONES[zone].ground).multiplyScalar(1.1 + shade * 0.4), 0, turn, tall);
          } else if (kind === 'rock') {
            const s = 0.6 + size * ((pick * 3.7) % 1) * 4;
            put('rock', x, z, s, color.setHex(ZONES[zone].rock).multiplyScalar(1.15 + shade * 0.3), 0.35, turn, tall);
            if (s > 1.8 && collide) col(x, z, s * 0.85, this.groundY(x, z) + s * 0.8);
          } else if (small || kind === 'bush' || kind === 'crystal') {
            put(kind, x, z, (kind === 'bush' ? 0.8 : 0.7) + size * 0.6, color, kind === 'crystal' ? 0.1 : 0.05, turn, tall);
            if (kind === 'crystal' && collide) col(x, z, 0.6);
          } else {
            const s = (0.8 + size * 0.6) * (kind === 'palm' ? 1 : giant);
            put(kind, x, z, s, color, 0.2, turn, tall);
            if (tree && collide) col(x, z, (kind === 'oak' ? 0.8 : kind === 'palm' ? 0.5 : 0.7) * s, this.groundY(x, z) + (kind === 'cactus' ? 3.4 : 9) * s);
          }
        }
      }
      yield;
    }
    this.collided.add(key);
    if (!meshes) return;
    const lowRange = this.quality === 'low' ? 0.75 : 1;
    for (const [kind, set] of sets) {
      const geo = kind === 'rock' ? rockGeometry() : geos[kind];
      const mesh = new THREE.InstancedMesh(geo, kind === 'rock' ? rockMat : plantMat, set.mats.length);
      set.mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      set.colors.forEach((c, i) => mesh.setColorAt(i, c));
      mesh.computeBoundingSphere();
      mesh.userData.kind = kind;
      mesh.userData.at = set.at;
      mesh.castShadow = this.quality !== 'low' && (TREES.includes(kind) || kind === 'rock');
      mesh.receiveShadow = true;
      mesh.visible = false;
      this.root.add(mesh);
      const range = (SMALL.includes(kind) ? 110 : kind === 'bush' || kind === 'crystal' ? 190 : 420) * lowRange;
      this.plantTiles.push({ mesh, x: (cx + 0.5) * TILE, z: (cz + 0.5) * TILE, range });
    }
  }

  /** One tile of the world: its ground (and its part of the sea's shore depth), then its plants. */
  private *worldTile(cx: number, cz: number): Generator<void, void> {
    const mesh: THREE.Mesh = yield* groundTile(cx, cz, this.segs, this.quality !== 'low');
    this.root.add(mesh);
    this.groundTiles.push({ mesh, x: (cx + 0.5) * TILE, z: (cz + 0.5) * TILE });
    // Its depths go into the sea's shore texture (vertices sit on the texture's grid).
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const n = this.segs + 1, N = TILES * this.segs + 1, half = (TILES / 2) * this.segs;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const gi = cx * this.segs + i + half, gj = cz * this.segs + j + half;
        if (gi < 0 || gj < 0 || gi >= N || gj >= N) continue;
        this.shoreData[gj * N + gi] = Math.max(0, Math.min(255, ((WATER_LEVEL - pos.getY(j * n + i)) / 8) * 255));
      }
    this.shoreTex.needsUpdate = true;
    yield* this.plantTile(cx, cz);
  }

  /**
   * Streams the world in around the hero: tiles nearest first, a few
   * milliseconds of building a frame. Arriving somewhere unbuilt (a new
   * game, fast travel, a respawn) builds the tiles close by faster, behind a
   * veil, so the hero never stands on nothing and the game never freezes.
   * On the co-op host, the trees' and rocks' colliders are also built around
   * the other heroes, for the monsters it runs near them.
   */
  private stream(dt: number, focus: THREE.Vector3) {
    const fx = focus.x, fz = focus.z;
    const here = tileKey(Math.floor(fx / TILE), Math.floor(fz / TILE));
    if (!this.built.has(here) && this.job?.key !== here) this.priming = true;
    this.wantT -= dt;
    if (this.priming || this.wantT <= 0) {
      this.wantT = 0.5;
      this.wanted.length = 0;
      const r = Math.ceil(BUILD_R / TILE) + 1;
      const c0 = Math.floor(fx / TILE), r0 = Math.floor(fz / TILE);
      for (let cz = r0 - r; cz <= r0 + r; cz++)
        for (let cx = c0 - r; cx <= c0 + r; cx++) {
          if (cx < -TILES / 2 || cz < -TILES / 2 || cx >= TILES / 2 || cz >= TILES / 2) continue;
          const key = tileKey(cx, cz);
          if (this.built.has(key) || this.job?.key === key) continue;
          if (tileGap(fx, fz, cx, cz) < BUILD_R) this.wanted.push({ key, cx, cz });
        }
      this.wanted.sort((a, b) => tileGap(fx, fz, a.cx, a.cz) - tileGap(fx, fz, b.cx, b.cz));
      // The other heroes' surroundings: colliders only.
      this.wantedCol.length = 0;
      for (const o of this.others) {
        const oc = Math.floor(o.x / TILE), or = Math.floor(o.z / TILE), k = Math.ceil(COLLIDE_R / TILE);
        for (let cz = or - k; cz <= or + k; cz++)
          for (let cx = oc - k; cx <= oc + k; cx++) {
            if (cx < -TILES / 2 || cz < -TILES / 2 || cx >= TILES / 2 || cz >= TILES / 2) continue;
            const key = tileKey(cx, cz);
            if (this.collided.has(key) || this.colJob?.key === key || this.job?.key === key) continue;
            if (tileGap(o.x, o.z, cx, cz) < COLLIDE_R && !this.wantedCol.some((w) => w.key === key)) this.wantedCol.push({ key, cx, cz });
          }
      }
    }
    // Close by first; the veil lifts once everything within PRIME_R is built.
    if (this.priming) {
      const next = this.wanted[0];
      if (!this.job && (!next || tileGap(fx, fz, next.cx, next.cz) > PRIME_R)) this.priming = false;
    }
    const t0 = performance.now();
    // (Behind the veil nothing shows, so arriving can take a bigger share of each frame.)
    const budget = this.priming ? 30 : this.quality === 'low' ? 3 : 4;
    while (performance.now() - t0 < budget) {
      if (!this.job && this.wanted.length) {
        const next = this.wanted.shift()!;
        // (Its colliders may be on their way already: finish those first, so they are built once.)
        if (this.colJob?.key === next.key) {
          while (!this.colJob.it.next().done);
          this.colJob = null;
        }
        this.job = { key: next.key, it: this.worldTile(next.cx, next.cz) };
      }
      if (this.job) {
        if (this.job.it.next().done) {
          this.built.add(this.job.key);
          this.job = null;
        }
        continue;
      }
      if (!this.colJob) {
        const next = this.wantedCol.shift();
        if (!next) break;
        if (this.collided.has(next.key)) continue;
        this.colJob = { key: next.key, it: this.plantTile(next.cx, next.cz, false) };
      }
      if (this.colJob.it.next().done) this.colJob = null;
    }
  }

  // ---------------------------------------------------------- structures --

  /** Timber-framed house; the door faces the local -z side. */
  private house(x: number, z: number, ry: number, w = 6, d = 5, h = 3.6) {
    const y = this.groundY(x, z) - 0.3;
    const b = this.batch;
    const c = Math.cos(ry), s = Math.sin(ry);
    const P = (geo: THREE.BufferGeometry, color: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, rz = 0, ryo = 0) =>
      b.paint(geo, color, x + lx * c + lz * s, y + ly, z - lx * s + lz * c, ry + ryo, sx, sy, sz, 0, rz);
    const plaster = [0x9a8a6c, 0x8a7a62, 0xa89878, 0x857660][Math.floor(this.rand() * 4)];
    const roof = [0x4a2e22, 0x3a3a44, 0x6a5636, 0x5a2a20][Math.floor(this.rand() * 4)];
    const shutter = [0x2e3a2a, 0x4a2220, 0x2a3446, 0x3a2a1c][Math.floor(this.rand() * 4)];
    if (worldMesh('house')) {
      // The Blender house, made at 6 x 5 x 3.6 and stretched to this one (the same numbers drawn as below).
      const sx = w / 6, sy = h / 3.6, sz = d / 5;
      const chimney = this.rand() < 0.7;
      if (chimney) this.rand();
      b.model(chimney ? 'house-chimney' : 'house', [plaster, roof, shutter], x, y, z, ry, sx, sy, sz);
      b.modelIn('house.lit', mat(0xffb860, { emissive: 0xff9030, emissiveIntensity: 1.2 }), x, y, z, ry, sx, sy, sz);
      if (chimney) {
        const lx = 2.1 * sx, lz = 0.9 * sz;
        this.smokeSource(x + lx * c + lz * s, y + 7.17 * sy + 0.3, z - lx * s + lz * c, 0);
      }
      this.houseClutter(x, z, c, s, w, d);
      this.addCollider(x, z, Math.max(w, d) * 0.55);
      return;
    }
    const timber = 0x33241a;
    const stone = 0x5a554c;
    P(BOX, stone, 0, 0.3, 0, w + 0.3, 0.6, d + 0.3);
    P(BOX, plaster, 0, h / 2, 0, w, h, d);
    // Frame: corner posts, sill, mid rail and top plate, studs and braces.
    for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) P(BOX, timber, lx, h / 2 + 0.1, lz, 0.3, h + 0.2, 0.3);
    for (const fz of [-1, 1]) {
      const zz = fz * (d / 2 + 0.04);
      for (const yy of [0.62, h * 0.52, h - 0.1]) P(BOX, timber, 0, yy, zz, w + 0.1, 0.2, 0.1);
      for (const sx of [-1, 1]) {
        P(BOX, timber, sx * w * 0.22, h / 2, zz, 0.18, h, 0.1);
        const bw = w * 0.28;
        const bh = h * 0.48 - 0.1;
        P(BOX, timber, sx * (w / 2 - bw / 2), h * 0.76, zz, 0.16, Math.hypot(bw, bh), 0.08, sx * Math.atan2(bw, bh));
      }
    }
    for (const fx of [-1, 1]) for (const yy of [0.62, h * 0.52, h - 0.1]) P(BOX, timber, fx * (w / 2 + 0.04), yy, 0, 0.1, 0.2, d + 0.1);
    // Gable roof with overhanging eaves; the ridge runs along the long side.
    const rh = 1.6 + d * 0.22;
    P(ROOF, roof, 0, h, 0, d / 2 + 0.55, rh, w + 0.7, 0, Math.PI / 2);
    P(BOX, timber, 0, h + rh + 0.02, 0, w + 0.8, 0.14, 0.14);
    // Door, windows (lit from inside) and shutters.
    P(BOX, 0x2a1c12, -w * 0.12, 0.95 + 0.3, -d / 2 - 0.06, 1.05, 1.9, 0.08);
    P(BOX, timber, -w * 0.12, 2.0 + 0.3, -d / 2 - 0.08, 1.35, 0.16, 0.12);
    const lit = mat(0xffb860, { emissive: 0xff9030, emissiveIntensity: 1.2 });
    for (const [wx, fz] of [[w * 0.3, -1], [-w * 0.3, 1], [w * 0.3, 1]]) {
      const zz = fz * (d / 2 + 0.06);
      const [px, pz] = [x + wx * c + zz * s, z - wx * s + zz * c];
      b.add(BOX, lit, px, y + 2.1, pz, ry, 0.7, 0.62, 0.05);
      P(BOX, timber, wx, 1.74, zz * 1.01, 0.9, 0.1, 0.1);
      for (const sx of [-1, 1]) P(BOX, shutter, wx + sx * 0.55, 2.1, zz * 1.02, 0.36, 0.7, 0.05);
    }
    // A chimney on most houses, smoking.
    if (this.rand() < 0.7) {
      const lx = w / 2 - 0.9;
      const lz = (this.rand() < 0.5 ? -1 : 1) * d * 0.18;
      const top = h + rh * 0.95 + 0.6;
      P(BOX, 0x4e4a44, lx, (h + top) / 2, lz, 0.8, top - h + 0.6, 0.8);
      P(BOX, 0x3e3a36, lx, top, lz, 0.95, 0.18, 0.95);
      this.smokeSource(x + lx * c + lz * s, y + top + 0.3, z - lx * s + lz * c, 0);
    }
    this.houseClutter(x, z, c, s, w, d);
    this.addCollider(x, z, Math.max(w, d) * 0.55);
  }

  /** Barrels and crates by a house's walls. */
  private houseClutter(x: number, z: number, c: number, s: number, w: number, d: number) {
    for (let i = 0; i < 2; i++) {
      if (this.rand() < 0.35) continue;
      const lx = (this.rand() < 0.5 ? -1 : 1) * (w / 2 + 0.7);
      const lz = (this.rand() - 0.5) * d;
      if (this.rand() < 0.5) this.barrel(x + lx * c + lz * s, z - lx * s + lz * c);
      else this.crate(x + lx * c + lz * s, z - lx * s + lz * c, this.rand() * TAU, 0.7 + this.rand() * 0.3);
    }
  }

  private barrel(x: number, z: number) {
    const y = this.groundY(x, z);
    const b = this.batch;
    if (b.model('barrel', [], x, y, z, (x * 7.3 + z * 3.1) % TAU)) return this.addCollider(x, z, 0.45);
    b.paint(CYL, 0x5a3e24, x, y + 0.5, z, 0, 0.75, 1, 0.75);
    for (const yy of [0.18, 0.82]) b.paint(CYL, 0x2a2622, x, y + yy, z, 0, 0.79, 0.07, 0.79, 0, 0, true);
    b.paint(CYL, 0x4a3420, x, y + 1.0, z, 0, 0.62, 0.03, 0.62);
    this.addCollider(x, z, 0.45);
  }

  private crate(x: number, z: number, ry: number, s = 0.8) {
    const y = this.groundY(x, z);
    const b = this.batch;
    if (b.model('crate', [], x, y, z, ry, s)) return this.addCollider(x, z, s * 0.6);
    b.paint(BOX, 0x6a4a2a, x, y + s / 2, z, ry, s, s, s);
    b.paint(BOX, 0x3e2a1a, x, y + s / 2, z, ry, s * 1.02, s * 0.16, s * 1.02);
    b.paint(BOX, 0x3e2a1a, x, y + s / 2, z, ry, s * 0.16, s * 1.02, s * 1.03);
    this.addCollider(x, z, s * 0.6);
  }

  /** A banner on a pole with a crossbar. */
  private banner(x: number, z: number, ry: number, color = 0x6a1a18) {
    const y = this.groundY(x, z);
    const b = this.batch;
    const c = Math.cos(ry), s = Math.sin(ry);
    if (b.model('banner', [color], x, y, z, ry)) return this.addCollider(x, z, 0.3);
    b.paint(CYL6, 0x2e2218, x, y + 3, z, 0, 0.18, 6, 0.18);
    b.paint(BOX, 0x2e2218, x + c * 0.5, y + 5.7, z - s * 0.5, ry, 1.5, 0.1, 0.1);
    b.paint(BOX, color, x + c * 0.5, y + 4.3, z - s * 0.5, ry, 1.2, 2.7, 0.04);
    b.paint(BOX, 0xb08a3a, x + c * 0.5, y + 3.0, z - s * 0.5, ry, 1.2, 0.12, 0.05);
    b.paint(CONE4, color, x + c * 0.5, y + 2.75, z - s * 0.5, ry + Math.PI / 4, 0.8, 0.5, 0.06, Math.PI);
    b.paint(BOX, 0xd8b050, x + c * 0.5, y + 4.6, z - s * 0.5, ry + Math.PI / 4, 0.32, 0.32, 0.06);
    this.addCollider(x, z, 0.3);
  }

  private fence(x0: number, z0: number, x1: number, z1: number) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 2.4));
    const ry = -Math.atan2(z1 - z0, x1 - x0);
    const b = this.batch;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const z = z0 + ((z1 - z0) * i) / n;
      const y = this.groundY(x, z);
      if (!b.model('fence-post', [], x, y, z, ry + i * 1.7)) b.paint(BOX, 0x4a3624, x, y + 0.55, z, ry, 0.16, 1.2, 0.16);
      if (i % 2 === 0) this.addCollider(x, z, 0.3);
      if (i === n) break;
      const mx = x0 + ((x1 - x0) * (i + 0.5)) / n;
      const mz = z0 + ((z1 - z0) * (i + 0.5)) / n;
      const my = this.groundY(mx, mz);
      // Rails follow the ground from post to post.
      const tilt = Math.atan2(this.groundY(x0 + ((x1 - x0) * (i + 1)) / n, z0 + ((z1 - z0) * (i + 1)) / n) - y, len / n);
      for (const yy of [0.45, 0.9]) if (!b.model('fence-rail', [], mx, my + yy, mz, ry, len / n + 0.1, 1, 1, 0, tilt)) b.paint(BOX, 0x5a4430, mx, my + yy, mz, ry, len / n + 0.1, 0.1, 0.06);
    }
  }

  private buildTown() {
    const b = this.batch;
    const stone = 0x6a645a;
    // Ruined outer wall with gaps for the four roads, towers and banners at each gate.
    const gates = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const gap = gates.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.12);
      if (gap || this.rand() < 0.15) continue;
      const r = TOWN.radius - 2;
      const x = TOWN.x + Math.cos(a) * r;
      const z = TOWN.z + Math.sin(a) * r;
      const h = 2 + this.rand() * 2.5;
      const tone = [0x6a645a, 0x5e584e, 0x726a5e][Math.floor(this.rand() * 3)];
      if (b.model('wall', [], x, this.groundY(x, z) - 0.5, z, -a, 1, h, 1)) b.model('wall-cap', [], x, this.groundY(x, z) + h - 0.45, z, -a);
      else {
        b.paint(BOX, tone, x, this.groundY(x, z) + h / 2 - 0.5, z, -a, 1.2, h, 6.4);
        b.paint(BOX, 0x56514a, x, this.groundY(x, z) + h - 0.45, z, -a, 1.5, 0.3, 6.5);
      }
      this.addCollider(x, z, 2.6);
    }
    for (const g of gates) {
      for (const side of [-1, 1]) {
        const a = g + side * 0.17;
        const r = TOWN.radius - 2;
        const x = TOWN.x + Math.cos(a) * r;
        const z = TOWN.z + Math.sin(a) * r;
        const y = this.groundY(x, z);
        if (!b.model('gate-tower', [], x, y, z, -a)) {
          b.paint(BOX, stone, x, y + 3, z, -a, 3, 7, 3);
          b.paint(BOX, 0x56514a, x, y + 6.6, z, -a, 3.5, 0.5, 3.5);
          for (const [ox, oz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) b.paint(BOX, stone, x + ox, y + 7.2, z + oz, 0, 0.7, 0.8, 0.7);
        }
        this.addCollider(x, z, 2);
        const br = r - 3;
        this.banner(TOWN.x + Math.cos(a) * br, TOWN.z + Math.sin(a) * br, -g + Math.PI / 2 + (side < 0 ? Math.PI : 0));
      }
    }
    // Houses around the square, off the roads.
    for (let ring = 0; ring < 2; ring++) {
      const r = ring ? 44 : 28;
      const n = ring ? 14 : 8;
      for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) / n) * Math.PI * 2 + ring * 0.1;
        const x = TOWN.x + Math.cos(a) * r;
        const z = TOWN.z + Math.sin(a) * r;
        if (Math.min(Math.abs(x - TOWN.x), Math.abs(z - TOWN.z)) < 7) continue;
        if (NPCS.some((p) => Math.hypot(p.x - x, p.z - z) < 9)) continue;
        if (Math.hypot(x - 0, z + 22) < 14 || Math.hypot(x - 32, z - 16) < 10 || Math.hypot(x + 32, z - 8) < 10 || Math.hypot(x, z - 42) < 9) continue;
        this.house(x, z, -a - Math.PI / 2, 5 + this.rand() * 2.5, 4.5 + this.rand() * 1.5, 3.2 + this.rand() * 1.2);
      }
    }
    // Fences along the roads out of town.
    for (const g of gates) {
      const dx = Math.cos(g), dz = Math.sin(g);
      for (const side of [-1, 1]) {
        const ox = -dz * side * 5.2, oz = dx * side * 5.2;
        for (const [r0, r1] of [[48, 54], [21, 26]]) {
          if (this.rand() < 0.3) continue;
          this.fence(TOWN.x + dx * r0 + ox, TOWN.z + dz * r0 + oz, TOWN.x + dx * r1 + ox, TOWN.z + dz * r1 + oz);
        }
      }
    }
    // Chapel of Light.
    {
      const x = 0, z = -28, y = this.groundY(x, z);
      if (b.model('chapel', [0, 0x3a3a44], x, y, z)) b.modelIn('chapel.lit', mat(0xffe8a0, { emissive: 0xffd060, emissiveIntensity: 1.6 }), x, y, z);
      else {
      b.paint(BOX, 0x5a554c, x, y + 0.3, z, 0, 9.8, 0.8, 13.8);
      b.paint(BOX, stone, x, y + 4, z, 0, 9, 9, 13);
      b.paint(ROOF, 0x3a3a44, x, y + 8.5, z, 0, 5.4, 4.2, 14);
      for (const sx of [-1, 1]) for (const zz of [-4, 0, 4]) b.paint(BOX, 0x5e584e, x + sx * 4.8, y + 3, z + zz, 0, 0.9, 6, 1.1);
      b.paint(BOX, stone, x, y + 9, z + 5, 0, 3, 18, 3);
      b.paint(BOX, 0x56514a, x, y + 17.6, z + 5, 0, 3.6, 0.6, 3.6);
      b.paint(CONE4, 0x3a3a44, x, y + 20, z + 5, Math.PI / 4, 3.6, 5, 3.6);
      b.paint(BOX, 0xb08a3a, x, y + 23.2, z + 5, 0, 0.16, 1.6, 0.16);
      b.paint(BOX, 0xb08a3a, x, y + 23.4, z + 5, 0, 0.9, 0.16, 0.16);
      b.add(BOX, mat(0xffe8a0, { emissive: 0xffd060, emissiveIntensity: 1.6 }), x, y + 6, z + 6.55, 0, 2.2, 3.4, 0.1);
      b.add(CYL, mat(0xffe8a0, { emissive: 0xffd060, emissiveIntensity: 1.6 }), x, y + 12.5, z + 6.55, 0, 1.4, 0.1, 1.4, Math.PI / 2);
      b.paint(BOX, 0x3a352f, x, y + 1.5, z + 6.55, 0, 2, 3, 0.1);
      for (let i = 0; i < 3; i++) b.paint(BOX, 0x6a645a, x, y + 0.1 + i * 0.2, z + 7.2 + (2 - i) * 0.45, 0, 4 - i * 0.4, 0.3, 1);
      }
      for (const sx of [-1, 1]) this.banner(x + sx * 3.2, z + 8.2, sx < 0 ? Math.PI : 0, 0xd8cfa8);
      this.addCollider(x, z - 2, 6.5);
      this.addCollider(x, z + 3, 5.5);
      this.emitters.push({ pos: new THREE.Vector3(x, y + 6, z + 8), color: 0xffd080, intensity: 12, distance: 22 });
    }
    // Forge.
    {
      const x = 34, z = 16, y = this.groundY(x, z);
      if (b.model('forge', [0, 0x4a2e22], x, y, z)) b.modelIn('forge.lit', mat(0xff7020, { emissive: 0xff5010, emissiveIntensity: 2.5 }), x, y, z);
      else {
        for (const [px, pz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) b.paint(BOX, 0x3a2a1c, x + px, y + 1.8, z + pz, 0, 0.35, 3.6, 0.35);
        b.paint(ROOF, 0x4a2e22, x, y + 3.6, z, 0, 4.4, 1.4, 7.6);
        b.paint(BOX, 0x5a554c, x + 1.8, y + 1, z - 1.8, 0, 2.4, 2, 2);
        b.paint(BOX, 0x4e4a44, x + 1.8, y + 3.4, z - 2.3, 0, 1, 4.8, 1);
        b.add(BOX, mat(0xff7020, { emissive: 0xff5010, emissiveIntensity: 2.5 }), x + 1.8, y + 0.9, z - 0.78, 0, 1, 0.7, 0.05);
      }
      this.smokeSource(x + 1.8, y + 6.1, z - 2.3, 0);
      this.barrel(x - 3.8, z + 1.2);
      this.crate(x - 3.6, z - 1.4, 0.3, 0.9);
      this.emitters.push({ pos: new THREE.Vector3(x + 1.8, y + 1.4, z), color: 0xff6a20, intensity: 18, distance: 16, flicker: 0.4 });
      this.addCollider(x + 1.8, z - 1.8, 1.6);
    }
    for (const a of ANVILS) this.anvil(a.x, a.z);
    // The Archive.
    {
      const x = -36, z = 6, y = this.groundY(x, z);
      if (b.model('archive', [], x, y, z)) b.modelIn('archive.lit', mat(0xffc070, { emissive: 0xff9a40, emissiveIntensity: 1.3 }), x, y, z);
      else {
        b.paint(BOX, 0x5a554c, x, y + 0.3, z, 0, 10.8, 0.6, 8.8);
        b.paint(BOX, 0x7a7468, x, y + 3, z, 0, 10, 6, 8);
        b.paint(BOX, 0x7a7468, x, y + 6.4, z, 0, 11, 0.8, 9);
        b.paint(ROOF, 0x3a3a44, x, y + 6.8, z, Math.PI / 2, 4.9, 2.2, 11.4);
        for (let i = 0; i < 4; i++) b.paint(CYL, 0x9a948a, x + 5.6, y + 3, z - 3 + i * 2, 0, 0.7, 6, 0.7);
        b.add(BOX, mat(0xffc070, { emissive: 0xff9a40, emissiveIntensity: 1.3 }), x + 5.06, y + 1.5, z, 0, 0.05, 2.6, 1.4);
      }
      for (let i = 0; i < 3; i++) this.crate(x - 6.2, z - 2 + i * 1.4, i * 0.4, 0.75);
      this.addCollider(x, z, 6.4);
    }
    // Well, market stall, lamp posts, the Chronicler's desk.
    {
      const y = this.groundY(TOWN.x, TOWN.z);
      if (!b.model('well', [0, 0x4a2e22], TOWN.x, y, TOWN.z)) {
        b.paint(CYL, 0x6a645a, TOWN.x, y + 0.5, TOWN.z, 0, 3.2, 1.2, 3.2);
        b.paint(CYL, 0x56514a, TOWN.x, y + 1.15, TOWN.z, 0, 3.4, 0.15, 3.4);
        b.add(CYL, mat(0x0a1418, { rough: 0.1 }), TOWN.x, y + 1.05, TOWN.z, 0, 2.6, 0.05, 2.6);
        for (const sx of [-1, 1]) b.paint(BOX, 0x3a2a1c, TOWN.x + sx * 1.4, y + 2, TOWN.z, 0, 0.2, 2.8, 0.2);
        b.paint(BOX, 0x3a2a1c, TOWN.x, y + 3.3, TOWN.z, 0, 3.2, 0.18, 0.18);
        b.paint(ROOF, 0x4a2e22, TOWN.x, y + 3.35, TOWN.z, Math.PI / 2, 1.3, 0.9, 3.6);
        b.paint(CYL, 0x5a3e24, TOWN.x + 0.4, y + 2.3, TOWN.z, 0, 0.35, 0.4, 0.35);
      }
      this.addCollider(TOWN.x, TOWN.z, 1.8);
      const sx = 16, sz = 40, sy = this.groundY(sx, sz);
      if (!b.model('stall', [0x8a2a22], sx, sy, sz)) {
        b.paint(BOX, 0x5a3e24, sx, sy + 0.5, sz, 0, 4, 1, 1.6);
        b.paint(BOX, 0x8a2a22, sx, sy + 2.6, sz, 0.15, 4.6, 0.12, 2.4);
        for (let i = 0; i < 5; i++) b.paint(BOX, 0xd8cfb0, sx - 2 + i * 1.0, sy + 2.5 - 0.02, sz + 1.21, 0.15, 0.5, 0.14, 0.06);
        for (const px of [-1.9, 1.9]) b.paint(BOX, 0x3a2a1c, sx + px, sy + 1.3, sz - 0.9, 0, 0.15, 2.6, 0.15);
        const goods = [0xc8962a, 0x8a3a22, 0x5a7a3a, 0xd8c8a0];
        for (let i = 0; i < 4; i++) b.paint(ICO, goods[i], sx - 1.4 + i * 0.95, sy + 1.15, sz + 0.1, i, 0.32, 0.22, 0.32);
      }
      this.crate(sx + 2.9, sz - 0.4, 0.2, 0.8);
      this.crate(sx + 3.0, sz + 0.7, 0.9, 0.6);
      this.barrel(sx - 2.9, sz + 0.3);
      this.addCollider(sx, sz, 2.2);
      const cx = -12, cz = 37, cy = this.groundY(cx, cz);
      b.paint(BOX, 0x3a2a1c, cx, cy + 0.5, cz, 0, 1.6, 1, 0.9);
      b.paint(BOX, 0xe8dcc0, cx, cy + 1.02, cz, 0.3, 0.5, 0.02, 0.35);
      const candle = glowSprite(0xffb040, 0.8);
      candle.position.set(cx + 0.6, cy + 1.25, cz);
      this.root.add(candle);
      const glass = mat(0xffd890, { emissive: 0xffa040, emissiveIntensity: 2 });
      for (const [lx, lz] of [[6, 8], [-6, 8], [6, 32], [-6, 32], [8, -8], [-8, -8], [20, 26], [-20, 26]]) {
        const x = TOWN.x + lx, z = TOWN.z + lz, ly = this.groundY(x, z);
        if (b.model('lamp', [], x, ly, z)) b.modelIn('lamp.lit', glass, x, ly, z);
        else {
          b.paint(CYL, 0x2a2422, x, ly + 1.6, z, 0, 0.16, 3.2, 0.16, 0, 0, true);
          b.paint(BOX, 0x2a2422, x, ly + 0.15, z, 0, 0.4, 0.3, 0.4, 0, 0, true);
          b.paint(BOX, 0x2a2422, x, ly + 3.62, z, 0, 0.42, 0.06, 0.42, 0, 0, true);
          b.paint(CONE4, 0x2a2422, x, ly + 3.82, z, Math.PI / 4, 0.42, 0.32, 0.42, 0, 0, true);
          b.add(BOX, glass, x, ly + 3.3, z, 0, 0.3, 0.5, 0.3);
        }
        const s = glowSprite(0xffb050, 1.6);
        s.position.set(x, ly + 3.3, z);
        this.root.add(s);
        this.emitters.push({ pos: new THREE.Vector3(x, ly + 3.3, z), color: 0xffa050, intensity: 6, distance: 14, flicker: 0.1 });
      }
    }
    // Interactables for townsfolk are added by the game (they are actors).
  }

  /**
   * Wren's field: a fenced yard of nine seed beds (their soil and crops are
   * drawn by the game's FarmView, as each hero's own), a scarecrow, a trough
   * and a seed crate. Draws no random numbers, so the rest of the world is
   * laid out as before.
   */
  private buildField() {
    const b = this.batch;
    const x0 = FIELD.x - 5.2, x1 = FIELD.x + 5.5, z0 = FIELD.z - 5.5, z1 = FIELD.z + 5.5;
    // Fenced all round but for a gate on the west side, by the beds nearest Wren.
    const gate0 = FIELD.z + 1.6, gate1 = FIELD.z + 4.6;
    this.fence(x0, z0, x1, z0);
    this.fence(x1, z0, x1, z1);
    this.fence(x1, z1, x0, z1);
    this.fence(x0, z1, x0, gate1);
    this.fence(x0, gate0, x0, z0);
    for (let i = 0; i < 9; i++) {
      const { x, z } = plotCentre(i);
      const y = this.groundY(x, z);
      // A border of logs round each bed.
      const h = FIELD.bed / 2;
      for (const [dx, dz, w, d] of [[0, -h, FIELD.bed + 0.2, 0.2], [0, h, FIELD.bed + 0.2, 0.2], [-h, 0, 0.2, FIELD.bed], [h, 0, 0.2, FIELD.bed]] as const) {
        b.paint(BOX, 0x3a2a1c, x + dx, y + 0.08, z + dz, 0, w, 0.16, d);
      }
      this.interactables.push({ id: `plot-${i}`, kind: 'plot', x, y: y + 0.5, z, radius: 1.7, label: 'Seed bed' });
    }
    // Outside the fence: a scarecrow at the far corner, a water trough and seed crates by the gate.
    {
      const x = x1 + 1.2, z = z0 + 1.2, y = this.groundY(x, z);
      b.paint(BOX, 0x4a3420, x, y + 1.1, z, 0, 0.12, 2.2, 0.12);
      b.paint(BOX, 0x4a3420, x, y + 1.6, z, 0, 1.4, 0.1, 0.1);
      b.paint(BOX, 0x8a6a3a, x, y + 1.4, z, 0, 0.5, 0.7, 0.3);
      b.paint(ICO, 0xd8c890, x, y + 2.0, z, 0, 0.26, 0.26, 0.26);
      b.paint(CONE4, 0xa88a4a, x, y + 2.3, z, Math.PI / 4, 0.42, 0.3, 0.42);
      this.addCollider(x, z, 0.3);
    }
    {
      const x = x0 - 1.1, z = FIELD.z - 1.2, y = this.groundY(x, z);
      b.paint(BOX, 0x5a4430, x, y + 0.35, z, 0, 0.9, 0.7, 1.8);
      b.add(BOX, mat(0x2a4a5a, { rough: 0.15 }), x, y + 0.68, z, 0, 0.7, 0.04, 1.6);
      this.addCollider(x, z, 0.8);
    }
    this.crate(x0 - 1.0, z0 + 1.0, 0.3, 0.7);
    this.crate(x0 - 1.1, z1 - 0.6, 1.1, 0.6);
  }

  /**
   * The crafting stations by Wren's field: a cookfire (stones, logs, a
   * tripod and pot over a flickering flame, with smoke and firelight) and a
   * workbench, and the loom. Draws no random numbers (the rest of the world stays as it was).
   */
  private buildStations() {
    const b = this.batch;
    for (const s of STATIONS) {
      const { x, z } = s;
      const y = this.groundY(x, z);
      if (s.id === 'cookfire') {
        if (!b.model('cookfire', [], x, y, z)) for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          b.paint(ICO, i % 2 ? 0x6a645a : 0x5a554c, x + Math.cos(a) * 0.75, y + 0.12, z + Math.sin(a) * 0.75, a, 0.22, 0.16, 0.2);
        }
        if (!worldMesh('cookfire')) {
          // Three logs crossed like a star (laid flat by rz, aimed by ry).
          for (let i = 0; i < 3; i++) b.paint(CYL6, 0x4a3420, x, y + 0.14 + i * 0.05, z, (i / 3) * Math.PI, 0.14, 0.9, 0.14, 0, Math.PI / 2);
          // A tripod and its pot.
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + 0.3;
            b.paint(BOX, 0x2a2622, x + Math.cos(a) * 0.55, y + 0.75, z + Math.sin(a) * 0.55, -a, 0.05, 1.6, 0.05, 0, 0.35, true);
          }
          b.paint(CYL, 0x2a2a2c, x, y + 0.85, z, 0, 0.5, 0.35, 0.5, 0, 0, true);
        }
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 6), mat(0xffa040, { emissive: 0xff6a10, emissiveIntensity: 2.2 }));
        flame.position.set(x, y + 0.42, z);
        this.root.add(flame);
        this.animated.push({ obj: flame, kind: 'flicker', base: 1 });
        const glow = glowSprite(0xff8a30, 1.6);
        glow.position.set(x, y + 0.6, z);
        this.root.add(glow);
        this.emitters.push({ pos: new THREE.Vector3(x, y + 1, z), color: 0xff8030, intensity: 10, distance: 12, flicker: 0.35 });
        this.fixedSmoke(x, y + 1.3, z, 0, 0.61);
        this.addCollider(x, z, 1.1);
      } else if (s.id === 'loom') {
        this.loom(x, y, z);
      } else {
        // A trestle table with a vice, a saw, a bundle of arrows, and crates.
        if (!b.model('workbench', [], x, y, z, 0.4)) {
          b.paint(BOX, 0x6a4a2a, x, y + 0.88, z, 0.4, 2.2, 0.1, 0.9);
          for (const [dx, dz] of [[-0.95, -0.35], [0.95, -0.35], [-0.95, 0.35], [0.95, 0.35]]) {
            const c = Math.cos(0.4), sn = Math.sin(0.4);
            b.paint(BOX, 0x4a3420, x + dx * c + dz * sn, y + 0.42, z - dx * sn + dz * c, 0.4, 0.1, 0.84, 0.1);
          }
          b.paint(BOX, 0x3a3a3e, x + 0.7, y + 1.02, z - 0.25, 0.4, 0.22, 0.18, 0.16, 0, 0, true);
          b.paint(BOX, 0x9a9aa0, x - 0.4, y + 0.95, z + 0.1, 0.9, 0.7, 0.02, 0.18, 0, 0, true);
          // A bundle of arrows lying along the table.
          for (let i = 0; i < 5; i++) b.paint(CYL6, 0x8a6a44, x + 0.1 + i * 0.019, y + 0.95, z - 0.1 + i * 0.046, 0.4, 0.02, 0.8, 0.02, 0, Math.PI / 2);
        }
        this.crate(x + 1.6, z + 0.9, 0.2, 0.7);
        this.barrel(x - 1.6, z + 0.6);
        this.addCollider(x, z, 1.2);
      }
      this.interactables.push({ id: `station-${s.id}`, kind: 'station', x, y: y + 1, z, radius: 2.8, label: s.label });
    }
  }

  /**
   * Nell's stall by the shrine, behind her and turned the way she faces: a
   * counter with fish on ice and heaps of fruit in each fruit's colour, a
   * sea-blue striped awning, a crate and a barrel. All batched; draws no
   * random numbers (the rest of the world stays as it was).
   */
  private buildNellStall() {
    const b = this.batch;
    const { x, z, facing: ry } = NELL_STALL;
    const y = this.groundY(x, z);
    // Local to world: +x along the counter, +z out toward the square.
    const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
    const at = (lx: number, lz: number) => [x + rx * lx + fx * lz, z + rz * lx + fz * lz] as const;
    const put = (geo: THREE.BufferGeometry, color: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, turn = 0, tilt = 0) => {
      const [px, pz] = at(lx, lz);
      b.paint(geo, color, px, y + ly, pz, ry + turn, sx, sy, sz, tilt);
    };
    put(BOX, 0x4a3420, 0, 0.5, 0, 4, 1, 1.4);
    put(BOX, 0x3a2a1c, 0, 0.98, 0.72, 4.05, 0.08, 0.06);
    // Ice on the left half, with fish laid across it (one golden).
    put(BOX, 0xd8eef2, -1, 1.04, 0.05, 1.8, 0.08, 1.1);
    const fish = [0x9aa8b0, 0x8a9aa4, 0xd8a830];
    for (let i = 0; i < 3; i++) put(ICO, fish[i], -1.55 + i * 0.55, 1.13, 0.05 + (i % 2 ? 0.18 : -0.18), 0.12, 0.07, 0.34, 0.3 * (i - 1));
    // Heaps of fruit in baskets on the right half.
    const fruit = [FRUITS.sunberry, FRUITS.heartapple, FRUITS.moonplum, FRUITS.windpear, FRUITS.emberfig, FRUITS.bloodorange];
    for (let i = 0; i < 6; i++) {
      const lx = 0.4 + (i % 3) * 0.55, lz = i < 3 ? -0.25 : 0.3;
      put(BOX, 0x6a4a2a, lx, 1.05, lz, 0.46, 0.1, 0.44);
      put(ICO, fruit[i].color, lx, 1.16, lz, 0.2, 0.13, 0.19, i);
    }
    // Posts and a sea-blue awning, white stripes along its front edge.
    for (const [lx, lz] of [[-1.9, -0.6], [1.9, -0.6], [-1.9, 0.62], [1.9, 0.62]]) put(BOX, 0x3a2a1c, lx, 1.35, lz, 0.14, 2.7, 0.14);
    put(BOX, 0x2a6a8a, 0, 2.72, 0, 4.6, 0.1, 2.2, 0, -0.12);
    for (let i = 0; i < 4; i++) put(BOX, 0xd8e8ea, -1.65 + i * 1.1, 2.6, 1.08, 0.55, 0.1, 0.12, 0, -0.12);
    const [cx, cz] = at(2.75, -0.2);
    this.crate(cx, cz, ry + 0.3, 0.7);
    const [bx, bz] = at(-2.7, -0.1);
    this.barrel(bx, bz);
    this.addCollider(x, z, 2.2);
  }

  /**
   * The loom north of Wren's field: an upright frame with its warp strung
   * and a red cloth half woven, a weaver's bench, and three dye vats (madder
   * red, woad blue, weld yellow). Faces the field. Draws no random numbers.
   */
  private loom(x: number, y: number, z: number) {
    const b = this.batch;
    const wood = 0x5a3e24, dark = 0x3e2a1a, cloth = 0x9a2a22;
    // Two uprights on feet, a warp beam on top and a breast beam at the weaver's lap.
    for (const sx of [-0.85, 0.85]) {
      b.paint(BOX, wood, x + sx, y + 0.95, z, 0, 0.12, 1.9, 0.12);
      b.paint(BOX, dark, x + sx, y + 0.06, z, 0, 0.14, 0.12, 1.0);
    }
    b.paint(CYL6, wood, x, y + 1.8, z, 0, 0.13, 1.84, 0.13, 0, Math.PI / 2);
    b.paint(CYL6, wood, x, y + 0.72, z + 0.06, 0, 0.11, 1.84, 0.11, 0, Math.PI / 2);
    // The cloth rolled on the breast beam, and the half woven above it, with a cream stripe.
    b.paint(CYL6, cloth, x, y + 0.66, z + 0.06, 0, 0.2, 1.5, 0.2, 0, Math.PI / 2);
    b.paint(BOX, cloth, x, y + 0.98, z, 0, 1.46, 0.5, 0.03);
    b.paint(BOX, 0xd8cfb0, x, y + 1.08, z, 0, 1.47, 0.06, 0.035);
    // The warp: pale threads from the cloth's edge up to the beam.
    for (let i = 0; i < 11; i++) b.paint(BOX, 0xe8e0c8, x - 0.7 + i * 0.14, y + 1.49, z, 0, 0.014, 0.62, 0.014);
    // A heddle bar across the threads and a shuttle resting in the shed.
    b.paint(BOX, dark, x, y + 1.36, z + 0.02, 0, 1.66, 0.05, 0.05);
    b.paint(BOX, 0x8a6a44, x + 0.25, y + 1.24, z + 0.04, 0, 0.36, 0.05, 0.08);
    // The weaver's bench, on the field side.
    b.paint(BOX, 0x6a4a2a, x, y + 0.46, z + 0.85, 0, 1.0, 0.08, 0.34);
    for (const sx of [-0.4, 0.4]) b.paint(BOX, dark, x + sx, y + 0.22, z + 0.85, 0, 0.08, 0.44, 0.28);
    this.addCollider(x - 0.5, z, 0.6);
    this.addCollider(x + 0.5, z, 0.6);
    // Three dye vats to the east, each brimming with its colour; a stick in the red.
    const vats: [number, number, number][] = [[1.75, -0.35, 0x9a2a22], [2.45, 0.3, 0x2a4a8a], [1.8, 0.95, 0xc8a83a]];
    for (const [dx, dz, dye] of vats) {
      const vx = x + dx, vz = z + dz;
      this.barrel(vx, vz);
      b.paint(CYL, dye, vx, this.groundY(vx, vz) + 1.025, vz, 0, 0.6, 0.02, 0.6);
    }
    b.paint(BOX, 0x8a6a44, x + 1.85, y + 1.15, z - 0.35, 0.5, 0.04, 0.9, 0.04, 0.35, 0);
  }

  /** A smoke plume with a fixed seed (so it draws no random number). */
  private fixedSmoke(x: number, y: number, z: number, kind: 0 | 1 | 2, seed: number) {
    const count = SMOKE[kind].n[this.quality === 'low' ? 0 : 1];
    const last = this.smokeSrc[this.smokeSrc.length - 1];
    this.smokeSrc.push({ x, y, z, kind, first: last ? last.first + last.count : 0, count, seed, on: false });
  }

  private anvil(x: number, z: number) {
    const y = this.groundY(x, z);
    if (!this.batch.model('anvil', [], x, y, z, 0, 1.15)) {
      this.batch.paint(BOX, 0x2a2a2c, x, y + 0.75, z, 0, 1.3, 0.35, 0.55, 0, 0, true);
      this.batch.paint(BOX, 0x2a2a2c, x, y + 0.3, z, 0, 0.6, 0.6, 0.45, 0, 0, true);
      this.batch.paint(CONE4, 0x2a2a2c, x + 0.85, y + 0.8, z, Math.PI / 4, 0.25, 0.5, 0.25, 0, Math.PI / 2, true);
      this.batch.paint(CYL, 0x4a3624, x, y + 0.05, z, 0, 1.0, 0.1, 1.0);
    }
    this.addCollider(x, z, 0.8);
    this.interactables.push({ id: `anvil-${x}-${z}`, kind: 'anvil', x, y: y + 1, z, radius: 3, label: 'Anvil: upgrade and smith' });
  }

  private buildDocks() {
    for (const d of DOCKS) {
      const len = 18;
      const y0 = Math.max(0.6, this.groundY(d.x, d.z - 4));
      for (let i = 0; i < len; i += 2) {
        const z = d.z - 6 + i;
        if (!this.batch.model('dock-plank', [], d.x, y0 + 0.2, z, (i % 4) * Math.PI / 2)) this.batch.paint(BOX, i % 4 ? 0x4a3420 : 0x54402a, d.x, y0 + 0.2, z, 0, 3, 0.2, 1.9);
        if (i % 4 === 0) for (const s of [-1.4, 1.4]) if (!this.batch.model('piling', [], d.x + s, y0 - 2, z)) this.batch.paint(CYL, 0x3a2a1a, d.x + s, y0 - 2, z, 0, 0.3, 5, 0.3);
      }
      this.barrel(d.x - 1, d.z - 6.5);
      this.crate(d.x + 1.1, d.z - 6.3, 0.4, 0.7);
      const boat = buildBoat();
      boat.position.set(d.x + 3.8, 0.05, d.z + 6);
      boat.userData.dock = d;
      this.root.add(boat);
      this.interactables.push({ id: `dock-${d.x}`, kind: 'dock', x: d.x, y: y0 + 1, z: d.z + 8, radius: 4, label: 'Dock', object: boat });
    }
    FISHING_SPOTS.forEach((f, i) => {
      this.interactables.push({ id: `fish-${i}`, kind: 'fish', x: f.x, y: 0.5, z: f.z, radius: 6, label: 'Fish' });
      const ripple = new THREE.Mesh(TORUS, mat(0xbfe0ff, { transparent: 0.3 }));
      ripple.rotation.x = Math.PI / 2;
      ripple.position.set(f.x + (i === 0 ? -4 : 0), 0.05, f.z + 2);
      this.root.add(ripple);
      this.animated.push({ obj: ripple, kind: 'bob', base: 0.05 });
    });
  }

  private buildShrines() {
    const geos: THREE.BufferGeometry[] = [];
    for (const s of SHRINES) {
      const y = this.groundY(s.x, s.z);
      const b = this.batch;
      if (!b.model('shrine', [], s.x, y, s.z, 0.2)) {
        b.paint(CYL, 0x4e4a44, s.x, y + 0.1, s.z, 0, 4.2, 0.3, 4.2);
        b.paint(CYL, 0x5a564e, s.x, y + 0.35, s.z, 0, 3.2, 0.5, 3.2);
        b.paint(BOX, 0x5a564e, s.x, y + 1.3, s.z, 0.2, 0.6, 2.2, 0.6, 0.06);
        b.paint(BOX, 0x6a665e, s.x, y + 2.45, s.z, 0.2, 0.8, 0.14, 0.8);
      }
      // Old standing stones around, clear of where the hero wakes.
      for (const a of [0.3, 2.0, 3.5, 4.9]) {
        const x = s.x + Math.cos(a) * 4.4;
        const z = s.z + Math.sin(a) * 4.4;
        const h = 1.2 + this.rand() * 1.1;
        const lean = (this.rand() - 0.5) * 0.2;
        if (!b.model('monolith', [0, 0, 0, 0x56524a], x, this.groundY(x, z) - 0.2, z, -a, 0.55, h, 0.4, 0, lean)) b.paint(BOX, 0x56524a, x, this.groundY(x, z) + h / 2 - 0.2, z, -a, 0.55, h, 0.4, 0, lean);
        this.addCollider(x, z, 0.35);
      }
      const ring = new THREE.PlaneGeometry(6.4, 6.4).rotateX(-Math.PI / 2).translate(s.x, y + 0.62, s.z);
      geos.push(ring);
      const flame = glowSprite(0xffcf6a, 2.4);
      flame.position.set(s.x, y + 2.8, s.z);
      this.root.add(flame);
      const core = glowSprite(0xfff2c0, 0.9);
      core.position.set(s.x, y + 2.8, s.z);
      this.root.add(core);
      this.animated.push({ obj: flame, kind: 'flicker', base: 2.4 });
      this.emitters.push({ pos: new THREE.Vector3(s.x, y + 2.8, s.z), color: 0xffc860, intensity: 14, distance: 18, flicker: 0.15 });
      this.addCollider(s.x, s.z, 0.6);
      this.interactables.push({ id: `shrine-${s.id}`, kind: 'shrine', x: s.x, y: y + 1.5, z: s.z, radius: 3.5, label: `Rest at ${s.name}` });
    }
    // All the rune rings in one draw call; they turn and pulse in the shader.
    const material = new THREE.ShaderMaterial({
      vertexShader: RUNE_VERT,
      fragmentShader: RUNE_FRAG,
      uniforms: { map: { value: runeTexture() }, uColor: { value: new THREE.Color(0xffc860) }, uTime: this.time, uGlow: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.runes = new THREE.Mesh(mergeGeometries(geos, false)!, material);
    geos.forEach((g) => g.dispose());
    this.runes.frustumCulled = false;
    this.root.add(this.runes);
  }

  private brazier(x: number, z: number) {
    const y = this.groundY(x, z);
    const b = this.batch;
    if (b.model('brazier', [], x, y, z)) b.modelIn('brazier.lit', mat(0xff8030, { emissive: 0xff5010, emissiveIntensity: 2.4 }), x, y, z);
    else {
      b.paint(CYL, 0x4e4a44, x, y + 0.15, z, 0, 1.1, 0.3, 1.1);
      b.paint(CYL6, 0x56524a, x, y + 0.8, z, 0, 0.55, 1.2, 0.55);
      b.paint(BOWL, 0x2a2624, x, y + 1.55, z, 0, 1, 1, 1, 0, 0, true);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + 0.4;
        b.paint(CONE4, 0x2a2624, x + Math.cos(a) * 0.62, y + 1.86, z + Math.sin(a) * 0.62, a, 0.08, 0.3, 0.08, 0, 0, true);
      }
      b.add(CYL, mat(0xff8030, { emissive: 0xff5010, emissiveIntensity: 2.4 }), x, y + 1.72, z, 0, 1.05, 0.06, 1.05);
    }
    this.smokeSource(x, y + 1.8, z, 1);
    if (!this.propMode) this.emitters.push({ pos: new THREE.Vector3(x, y + 2.4, z), color: 0xff8030, intensity: 10, distance: 16, flicker: 0.35 });
    this.addCollider(x, z, 0.65);
  }

  private buildTrials() {
    const palette: Record<string, number> = { hunt: 0x60ffb0, tides: 0x40d0ff, storms: 0x80b0ff, forge: 0xff6a20, war: 0xff4030, crossroads: 0xa070ff, deep: 0x40e0ff, court: 0x60fff0, roost: 0xff5020, eclipse: 0x8a50ff };
    const stones: Record<string, number> = { storms: 0xa08060, forge: 0x2a2220, deep: 0x7a8a84, court: 0x5a7a76, roost: 0x2e2624, eclipse: 0x1c1922 };
    for (const t of TRIALS) {
      const y = this.groundY(t.x, t.z);
      const color = palette[t.id] ?? 0xffd080;
      const stone = stones[t.id] ?? 0x6a665e;
      if (t.id === 'war') {
        // A ruined colosseum.
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2;
          if (i === 7 || this.rand() < 0.12) continue;
          const r = t.radius + 3;
          const x = t.x + Math.cos(a) * r;
          const z = t.z + Math.sin(a) * r;
          const h = 6 + this.rand() * 6;
          if (!this.batch.model('pier', [0, 0, 0, stone], x, y, z, -a, 1, h, 1)) this.batch.paint(BOX, stone, x, y + h / 2, z, -a, 2, h, 7.2);
          this.batch.paint(BOX, 0x5a564e, x, y + h + 0.2, z, -a, 2.4, 0.4, 7.4);
          this.addCollider(x, z, 3.4);
        }
      } else if (t.id !== 'forge') {
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          // The shoal stays open to the sea: nothing between the heroes and the Leviathan.
          if (t.id === 'deep' && Math.sin(a) > -0.2) continue;
          const r = t.radius + 1.5;
          const x = t.x + Math.cos(a) * r;
          const z = t.z + Math.sin(a) * r;
          const h = 3 + this.rand() * 5;
          const lean = (this.rand() - 0.5) * 0.15;
          if (!this.batch.model('monolith', [0, 0, 0, stone], x, this.groundY(x, z) - 0.4, z, a, 1.6, h, 1.6, lean)) this.batch.paint(BOX, stone, x, this.groundY(x, z) + h / 2 - 0.4, z, a, 1.6, h, 1.6, lean);
          this.addCollider(x, z, 1.2);
        }
      }
      // Braziers burn between the stones (on the platform's rim in the crater).
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + (t.id === 'war' ? 0.35 : Math.PI / 9);
        const r = t.id === 'forge' ? t.radius - 1.5 : t.id === 'war' ? t.radius : t.radius - 0.5;
        this.brazier(t.x + Math.cos(a) * r, t.z + Math.sin(a) * r);
      }
      if (t.id === 'crossroads') {
        // Three roads, and the three-faced statue.
        for (let i = 0; i < 3; i++) this.batch.paint(BOX, 0x4a4652, t.x, y + 0.02, t.z, (i * Math.PI * 2) / 3, 3.5, 0.08, t.radius * 2.2);
      }
      if (t.id === 'deep' || t.id === 'court' || t.id === 'roost') this.decorateElderArena(t.id, t.x, t.z, t.radius, y, stone);
      if (t.id === 'hunt') {
        // Antler totem.
        this.batch.paint(CYL, 0x3a2a1c, t.x, y + 2, t.z - t.radius + 4, 0, 0.4, 4, 0.4);
        this.batch.paint(BOX, 0xcfc3a0, t.x, y + 4.2, t.z - t.radius + 4, 0, 2.6, 0.2, 0.2);
      }
      // Sigil ring on the floor and the altar that begins the trial.
      const sigil = new THREE.Mesh(TORUS, mat(color, { emissive: color, emissiveIntensity: 1.6 }));
      sigil.rotation.x = Math.PI / 2;
      sigil.scale.setScalar(3.2);
      sigil.position.set(t.x, y + 0.08, t.z);
      this.root.add(sigil);
      this.animated.push({ obj: sigil, kind: 'spin', base: 0 });
      if (!this.batch.model('altar', [0, 0, 0, stone], t.x, y, t.z)) this.batch.paint(BOX, stone, t.x, y + 0.5, t.z, 0, 2.2, 1, 2.2);
      const orb = glowSprite(color, 2.2);
      orb.position.set(t.x, y + 2, t.z);
      this.root.add(orb);
      this.animated.push({ obj: orb, kind: 'flicker', base: 2.2 });
      this.emitters.push({ pos: new THREE.Vector3(t.x, y + 2, t.z), color, intensity: 10, distance: 18 });
      this.addCollider(t.x, t.z, 1.4);
      this.interactables.push({ id: `trial-${t.id}`, kind: 'trial', x: t.x, y: y + 1, z: t.z, radius: 3.5, label: `Begin the ${t.name}` });
      // The fog wall that seals the arena during the fight.
      const fog = new THREE.Mesh(
        new THREE.CylinderGeometry(t.radius + 0.5, t.radius + 0.5, 14, 48, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
      );
      fog.position.set(t.x, y + 6, t.z);
      fog.visible = false;
      this.root.add(fog);
      this.trialFog.set(t.id, fog);
    }
  }

  /** The elder foes' arenas: bones on the shoal, a drowned throne, a scorched roost. */
  private decorateElderArena(id: string, cx: number, cz: number, radius: number, y: number, stone: number) {
    const b = this.batch;
    const bone = 0xd8d0b4;
    if (id === 'deep') {
      // The ribs of something the Leviathan ate, arching out of the sand.
      for (let i = 0; i < 6; i++) {
        const z = cz - 14 + i * 2.2, x = cx - 12;
        for (const s of [-1, 1]) {
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 0.5;
            const r = 3.2 - i * 0.25;
            b.paint(CYL6, bone, x + s * Math.sin(a) * r, y + Math.cos(a) * r * 0.9 + 0.2, z, 0, 0.32, 1.3, 0.32, 0, s * (a + 0.2));
          }
        }
      }
      b.paint(ROCK, bone, cx - 12, y + 0.6, cz - 17, 0.4, 1.6, 1.1, 2.4);
      // Sea-worn rocks and shells along the sand.
      for (let i = 0; i < 10; i++) {
        const a = this.rand() * TAU, r = 8 + this.rand() * (radius - 9);
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (Math.sin(a) > 0.3 && r > radius - 6) continue;
        b.paint(ROCK, this.rand() < 0.5 ? stone : 0x9a9488, x, y + 0.2, z, this.rand() * TAU, 0.6 + this.rand() * 0.8, 0.4 + this.rand() * 0.4, 0.6 + this.rand() * 0.8);
      }
    } else if (id === 'court') {
      // Broken columns and a throne of coral facing the sea.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.2;
        const r = radius - 4;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const h = 2 + this.rand() * 4;
        b.paint(CYL, stone, x, y + h / 2, z, 0, 1.1, h, 1.1);
        b.paint(BOX, 0x6a8a84, x, y + 0.15, z, a, 1.6, 0.3, 1.6);
        if (this.rand() < 0.5) b.paint(CYL, stone, x + 1.5, y + 0.5, z + 0.6, 0.3, 1, 2.2, 1, Math.PI / 2, 0);
        this.addCollider(x, z, 0.7);
      }
      const tz = cz + radius - 7;
      b.paint(BOX, 0x4a6a66, cx, y + 0.5, tz, 0, 3.2, 1, 2.2);
      b.paint(BOX, 0x4a6a66, cx, y + 2.4, tz + 0.9, 0, 3, 3.6, 0.5);
      for (let i = 0; i < 7; i++) {
        const x = cx - 1.5 + i * 0.5;
        b.paint(CONE8, 0xe86a7a, x, y + 4.6 + (i % 2) * 0.4, tz + 0.9, 0, 0.3, 1.4 + (i % 3) * 0.5, 0.3);
      }
      this.addCollider(cx, tz, 1.8);
    } else {
      // A nest ring of scorched boulders, old bones and broken armour.
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU + this.rand() * 0.2;
        const r = radius - 1.5;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        b.paint(ROCK, stone, x, this.groundY(x, z) + 0.6, z, this.rand() * TAU, 1.4 + this.rand(), 1 + this.rand() * 0.8, 1.4 + this.rand());
      }
      for (let i = 0; i < 14; i++) {
        const a = this.rand() * TAU, r = 5 + this.rand() * (radius - 8);
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        b.paint(CYL6, bone, x, y + 0.15, z, this.rand() * TAU, 0.22, 1.6 + this.rand() * 1.4, 0.22, Math.PI / 2, 0);
      }
      // A great horned skull of an older dragon.
      const sx = cx + 9, sz = cz - 10;
      b.paint(ICO, bone, sx, y + 0.9, sz, 0.6, 1.3, 1, 1.8);
      for (const s of [-1, 1]) b.paint(CONE4, bone, sx + s * 0.9, y + 1.9, sz - 0.6, 0.6, 0.35, 1.8, 0.35, -0.6, s * 0.5);
    }
  }

  /** The hunted foes' lairs: a hollow strung with webs, a graveyard in the mire. */
  private buildLairs() {
    const b = this.batch;
    for (const l of LAIRS) {
      if (l.id === 'hollow') {
        // Webs strung between the trees, egg sacs and the bones of the careless.
        for (let w = 0; w < 7; w++) {
          const a = (w / 7) * TAU + 0.3, r = 7 + this.rand() * 9;
          const x = l.x + Math.cos(a) * r, z = l.z + Math.sin(a) * r;
          const wy = this.groundY(x, z) + 3 + this.rand() * 3, size = 2.5 + this.rand() * 2, face = a + Math.PI / 2;
          const cs = Math.cos(face), sn = Math.sin(face);
          for (let k = 0; k < 8; k++) {
            const ka = (k / 8) * TAU;
            const ex = Math.cos(ka) * size, ey = Math.sin(ka) * size;
            b.paint(THIN, 0xe8e8e0, x + (ex / 2) * cs, wy + ey / 2, z - (ex / 2) * sn, face, 0.05, size, 0.05, 0, -ka + Math.PI / 2);
          }
          for (let ring = 1; ring <= 3; ring++) {
            const rr = (size * ring) / 3.4;
            for (let k = 0; k < 8; k++) {
              const ka = ((k + 0.5) / 8) * TAU;
              const ex = Math.cos(ka) * rr * 0.96, ey = Math.sin(ka) * rr * 0.96;
              b.paint(THIN, 0xd8d8d0, x + ex * cs, wy + ey, z - ex * sn, face, 0.035, rr * 0.78, 0.035, 0, -ka);
            }
          }
          // A strand down to the ground.
          b.paint(THIN, 0xe8e8e0, x, (wy + this.groundY(x, z)) / 2, z, 0, 0.04, wy - this.groundY(x, z), 0.04);
        }
        for (let i = 0; i < 9; i++) {
          const a = this.rand() * TAU, r = 3 + this.rand() * 12;
          const x = l.x + Math.cos(a) * r, z = l.z + Math.sin(a) * r;
          if (i < 5) b.paint(ICO, 0xe0dcc8, x, this.groundY(x, z) + 0.45, z, this.rand() * TAU, 0.5, 0.65, 0.5);
          else b.paint(CYL6, 0xd8d0b4, x, this.groundY(x, z) + 0.12, z, this.rand() * TAU, 0.14, 1.2, 0.14, Math.PI / 2, 0);
        }
      } else {
        // Leaning headstones, a crypt and a dead tree.
        for (let i = 0; i < 16; i++) {
          const row = Math.floor(i / 4), col = i % 4;
          const x = l.x - 9 + col * 6 + (this.rand() - 0.5) * 1.5, z = l.z - 6 + row * 4.5 + (this.rand() - 0.5) * 1.2;
          const gy = this.groundY(x, z);
          const tall = this.rand() < 0.3;
          const turn = (this.rand() - 0.5) * 0.3, tipX = (this.rand() - 0.5) * 0.25, tipZ = (this.rand() - 0.5) * 0.25;
          if (!b.model('headstone', [0, 0, 0, 0x5a5c58], x, gy, z, turn, 1, tall ? 1.6 : 1, 1, tipX, tipZ)) {
            b.paint(BOX, 0x5a5c58, x, gy + (tall ? 0.9 : 0.55), z, turn, 0.8, tall ? 1.8 : 1.1, 0.22, tipX, tipZ);
            if (tall) b.paint(BOX, 0x5a5c58, x, gy + 1.45, z, 0, 0.7, 0.18, 0.2);
          }
          this.addCollider(x, z, 0.45);
        }
        const cx = l.x, cz = l.z - 13;
        const cy = this.groundY(cx, cz);
        if (!b.model('crypt', [], cx, cy, cz)) {
          b.paint(BOX, 0x4a4c48, cx, cy + 1.6, cz, 0, 5, 3.2, 4);
          b.paint(ROOF, 0x3a3c38, cx, cy + 3.2, cz, 0, 5.4, 1.6, 4.4);
          b.paint(BOX, 0x101010, cx, cy + 1.1, cz + 2.01, 0, 1.4, 2.2, 0.05);
        }
        this.addCollider(cx, cz, 2.8);
        const tx = l.x + 10, tz = l.z + 8, ty = this.groundY(tx, tz);
        b.paint(TAPER, 0x2a2420, tx, ty + 2.5, tz, 0, 0.5, 5, 0.5);
        for (let k = 0; k < 4; k++) b.paint(TAPER, 0x2a2420, tx, ty + 3.4 + k * 0.5, tz, k * 1.7, 0.18, 2.2, 0.18, 0.9, 0);
        this.addCollider(tx, tz, 0.5);
        const lamp = glowSprite(0x70ffb0, 2.2, 0.6);
        lamp.position.set(cx, cy + 3.6, cz + 2.4);
        this.root.add(lamp);
        this.animated.push({ obj: lamp, kind: 'flicker', base: 2.2 });
      }
    }
  }

  private buildEyeRuins() {
    const { x: ex, z: ez } = EYES_RUINS;
    const stone = 0x3b3d33;
    this.eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x80ffa0, emissive: 0x40ff80, emissiveIntensity: 0.2, roughness: 0.6 });
    const pupil = mat(0x050505);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const x = ex + Math.cos(a) * 14;
      const z = ez + Math.sin(a) * 14;
      const y = this.groundY(x, z);
      const h = 6 + this.rand() * 3;
      if (!this.batch.model('pier', [0, 0, 0, stone], x, y + 3 - h / 2, z, -a + Math.PI, 0.6, h, 6 / 7.2)) this.batch.paint(BOX, stone, x, y + 3, z, -a + Math.PI / 2, 6, h, 1.2);
      this.addCollider(x, z, 3);
      // An eye carved on the inner face, staring at the centre.
      const ix = ex + Math.cos(a) * 13.3;
      const iz = ez + Math.sin(a) * 13.3;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), this.eyeMaterial);
      eye.scale.set(1.6, 0.8, 0.25);
      eye.position.set(ix, y + 3.5, iz);
      eye.lookAt(ex, y + 3.5, ez);
      this.root.add(eye);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), pupil);
      p.position.set(ix + (ex - ix) * 0.02, y + 3.5, iz + (ez - iz) * 0.02);
      this.root.add(p);
    }
    const y = this.groundY(ex, ez);
    this.batch.paint(CYL, stone, ex, y + 0.3, ez, 0, 5, 0.6, 5);
    const glyph = glowSprite(0x60ff90, 3, 0.6);
    glyph.position.set(ex, y + 1.5, ez);
    this.root.add(glyph);
  }

  private buildLoreAndLoot() {
    for (const l of LORE) {
      const y = this.groundY(l.x, l.z);
      if (!this.batch.model('runestone', [0, 0, 0, 0x5a564e], l.x, y - 0.1, l.z, 0.4)) this.batch.paint(BOX, 0x5a564e, l.x, y + 1, l.z, 0.4, 1.4, 2.2, 0.35);
      const g = glowSprite(l.ancient ? 0x60ff90 : 0xffd080, 1.4, 0.7);
      g.position.set(l.x, y + 2.4, l.z);
      this.root.add(g);
      this.addCollider(l.x, l.z, 0.9);
      this.interactables.push({ id: `lore-${l.id}`, kind: 'lore', x: l.x, y: y + 1, z: l.z, radius: 3, label: `Read: ${l.title}` });
    }
    for (const t of TOMES) {
      const y = this.groundY(t.x, t.z);
      const g = new THREE.Group();
      g.position.set(t.x, y, t.z);
      const pm = worldMesh('pedestal');
      const ped = pm ? new THREE.Mesh(worldGeometry(pm), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })) : new THREE.Mesh(CYL, mat(0x4a463e));
      if (!pm) {
        ped.scale.set(0.8, 1.1, 0.8);
        ped.position.y = 0.55;
      }
      g.add(ped);
      const book = new THREE.Mesh(BOX, mat(0x6a2a8a, { emissive: 0x6a30ff, emissiveIntensity: 0.8 }));
      book.scale.set(0.6, 0.12, 0.45);
      book.position.y = 1.25;
      g.add(book);
      const glow = glowSprite(0xb080ff, 2.2);
      glow.position.y = 1.5;
      g.add(glow);
      this.root.add(g);
      this.animated.push({ obj: book, kind: 'bob', base: 1.25 });
      this.interactables.push({ id: `tome-${t.spell}`, kind: 'tome', x: t.x, y: y + 1, z: t.z, radius: 3, label: `Spell tome: ${SPELLS[t.spell].name}`, object: g });
    }
    for (const p of PAGES) {
      const y = this.groundY(p.x, p.z);
      const g = new THREE.Group();
      g.position.set(p.x, y + 0.05, p.z);
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), mat(0xe8dcc0, { side: THREE.DoubleSide }));
      sheet.rotation.x = -Math.PI / 2;
      g.add(sheet);
      const glow = glowSprite(0xfff0c0, 1.2, 0.8);
      glow.position.y = 0.5;
      g.add(glow);
      this.root.add(g);
      this.interactables.push({ id: p.id, kind: 'page', x: p.x, y, z: p.z, radius: 2.5, label: 'A torn page', object: g });
    }
    const crystal = mat(0xff7a2a, { emissive: 0xff5010, emissiveIntensity: 1.8, rough: 0.3 });
    ORE_NODES.forEach((o, i) => {
      const y = this.groundY(o.x, o.z);
      const g = new THREE.Group();
      g.position.set(o.x, y, o.z);
      for (let k = 0; k < 5; k++) {
        const shard = worldMesh('ore-shard');
        const c = new THREE.Mesh(shard ? (oreGeo ??= worldGeometry(shard)) : CONE4, crystal);
        c.scale.set(shard ? 0.9 : 0.5, 1.2 + this.rand(), shard ? 0.9 : 0.5);
        c.position.set((this.rand() - 0.5) * 1.2, 0.5, (this.rand() - 0.5) * 1.2);
        c.rotation.set((this.rand() - 0.5) * 0.8, 0, (this.rand() - 0.5) * 0.8);
        g.add(c);
      }
      this.root.add(g);
      this.interactables.push({ id: `ore-${i}`, kind: 'ore', x: o.x, y: y + 1, z: o.z, radius: 3, label: 'Mine Ember Ore', object: g });
    });
    // The island trial needs a boat or a long swim; mark the way with a beacon.
    const beacon = glowSprite(0x40d0ff, 6, 0.5);
    beacon.position.set(ISLAND.x, 14, ISLAND.z);
    this.root.add(beacon);
  }

  // ------------------------------------------------------------ atmosphere --

  private buildMotes() {
    const n = this.quality === 'low' ? 60 : this.quality === 'medium' ? 160 : 260;
    this.motes = new PointPool(n, moteMaterial());
    this.moteState = {
      vel: new Float32Array(n * 3),
      age: new Float32Array(n),
      life: new Float32Array(n),
      kind: new Int8Array(n).fill(-1),
      seed: new Float32Array(n).map(() => this.rand()),
      alpha: new Float32Array(n),
      mix: new Float32Array(MOTES.length),
    };
    this.root.add(this.motes.points);
  }

  private smokeSource(x: number, y: number, z: number, kind: 0 | 1 | 2) {
    if (this.propMode) return;
    const count = SMOKE[kind].n[this.quality === 'low' ? 0 : 1];
    const first = this.smokeSrc.length ? this.smokeSrc[this.smokeSrc.length - 1].first + this.smokeSrc[this.smokeSrc.length - 1].count : 0;
    this.smokeSrc.push({ x, y, z, kind, first, count, seed: this.rand(), on: false });
  }

  private buildSmoke() {
    const last = this.smokeSrc[this.smokeSrc.length - 1];
    this.smoke = new PointPool(last ? last.first + last.count : 1, this.motes.points.material as THREE.ShaderMaterial);
    this.root.add(this.smoke.points);
  }

  /** Shafts of sunlight slanting down around the player. */
  private buildRays() {
    const n = this.quality === 'low' ? 5 : 10;
    const pos: number[] = [];
    const base: number[] = [];
    const phase: number[] = [];
    const idx: number[] = [];
    const R = 34;
    for (let i = 0; i < n; i++) {
      const bx = (this.rand() - 0.5) * 2 * R;
      const bz = (this.rand() - 0.5) * 2 * R;
      const w = 2 + this.rand() * 3;
      const len = 13 + this.rand() * 10;
      const ph = this.rand();
      for (const [px, py] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) {
        pos.push(px, py, 0);
        base.push(bx, bz, w, len);
        phase.push(ph);
      }
      const k = i * 4;
      idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aBase', new THREE.Float32BufferAttribute(base, 4));
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
    geo.setIndex(idx);
    const material = new THREE.ShaderMaterial({
      vertexShader: RAY_VERT,
      fragmentShader: RAY_FRAG,
      uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uFocus: { value: new THREE.Vector3() }, uR: { value: R }, uTime: this.time, uColor: { value: new THREE.Color() } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.rays = new THREE.Mesh(geo, material);
    this.rays.frustumCulled = false;
    this.rays.renderOrder = 3;
    this.root.add(this.rays);
  }

  private updateMotes(dt: number, t: number, focus: THREE.Vector3, zone: ZoneId, day: number, sun: number) {
    const st = this.moteState;
    const { pos, col, size } = this.motes;
    const dayMix = MOTE_MIX[zone][0];
    const nightMix = MOTE_MIX[zone][1];
    let total = 0;
    for (let k = 0; k < MOTES.length; k++) total += (dayMix[k] * day + nightMix[k] * (1 - day)) * MOTES[k].share;
    const norm = total > 1 ? 1 / total : 1;
    for (let k = 0; k < MOTES.length; k++) st.mix[k] = (dayMix[k] * day + nightMix[k] * (1 - day)) * MOTES[k].share * norm;
    const wx = this.wind.value.x;
    const wz = this.wind.value.y;
    const light = 0.25 + 0.75 * day;
    for (let i = 0; i < this.motes.n; i++) {
      const i3 = i * 3;
      st.age[i] += dt;
      let kind = st.kind[i];
      const mk = kind >= 0 ? MOTES[kind] : null;
      const far = mk && (Math.abs(pos[i3] - focus.x) > mk.radius * 1.2 || Math.abs(pos[i3 + 2] - focus.z) > mk.radius * 1.2 || Math.abs(pos[i3 + 1] - focus.y) > 16);
      if (st.age[i] >= st.life[i] || far) {
        // Respawn as whatever this place and hour call for (or rest a moment).
        let r = this.rand();
        kind = -1;
        for (let k = 0; k < MOTES.length; k++) {
          r -= st.mix[k];
          if (r < 0) {
            kind = k;
            break;
          }
        }
        st.kind[i] = kind;
        st.age[i] = 0;
        if (kind < 0) {
          st.life[i] = 0.5 + this.rand() * 1.5;
          col[i * 4 + 3] = 0;
          continue;
        }
        const m = MOTES[kind];
        const a = this.rand() * TAU;
        const d = Math.sqrt(this.rand()) * m.radius;
        const x = focus.x + Math.cos(a) * d;
        const z = focus.z + Math.sin(a) * d;
        pos[i3] = x;
        pos[i3 + 2] = z;
        pos[i3 + 1] = Math.max(this.groundY(x, z), WATER_LEVEL) + m.y[0] + this.rand() * (m.y[1] - m.y[0]);
        st.life[i] = m.life[0] + this.rand() * (m.life[1] - m.life[0]);
        const v = 0.6 + this.rand() * 0.8;
        st.vel[i3] = (m.vel[0] + wx * (m.windy ?? 0)) * v;
        st.vel[i3 + 1] = m.vel[1] * v;
        st.vel[i3 + 2] = (m.vel[2] + wz * (m.windy ?? 0)) * v;
        size[i * 2] = m.size[0] + this.rand() * (m.size[1] - m.size[0]);
        size[i * 2 + 1] = m.add;
        continue;
      }
      if (!mk) continue;
      const s = st.seed[i] * 50;
      const w = mk.wander;
      pos[i3] += (st.vel[i3] + Math.sin(t * 0.9 + s) * w) * dt;
      pos[i3 + 1] += (st.vel[i3 + 1] + Math.sin(t * 1.3 + s * 1.7) * w * 0.5) * dt;
      pos[i3 + 2] += (st.vel[i3 + 2] + Math.cos(t * 0.8 + s * 1.3) * w) * dt;
      const env = Math.min(1, st.age[i] / 1.2, (st.life[i] - st.age[i]) / 1.5);
      let alpha = mk.alpha * Math.max(0, env);
      if (mk.sunlit) alpha *= sun;
      if (mk.blink) alpha *= 0.15 + 0.85 * Math.pow(Math.max(0, Math.sin(t * 2.2 + s)), 2);
      const lit = mk.add ? mk.bright ?? 1 : light;
      const c = mk.color;
      col[i * 4] = ((c >> 16) / 255) * ((c >> 16) / 255) * lit;
      col[i * 4 + 1] = (((c >> 8) & 255) / 255) * (((c >> 8) & 255) / 255) * lit;
      col[i * 4 + 2] = ((c & 255) / 255) * ((c & 255) / 255) * lit;
      col[i * 4 + 3] = alpha;
    }
    this.motes.commit();
  }

  private updateSmoke(t: number, focus: THREE.Vector3, day: number) {
    const { pos, col, size } = this.smoke;
    const wx = this.wind.value.x * 3;
    const wz = this.wind.value.y * 3;
    const light = 0.2 + 0.8 * day;
    let dirty = false;
    for (const s of this.smokeSrc) {
      const def = SMOKE[s.kind];
      const near = Math.abs(s.x - focus.x) + Math.abs(s.z - focus.z) < def.range;
      if (!near) {
        if (s.on) {
          for (let i = s.first; i < s.first + s.count; i++) col[i * 4 + 3] = 0;
          s.on = false;
          dirty = true;
        }
        continue;
      }
      s.on = dirty = true;
      for (let k = 0; k < s.count; k++) {
        const i = s.first + k;
        const ph = t / def.life + k / s.count + s.seed;
        const a = ph - Math.floor(ph);
        const age = a * def.life;
        const j = hash(k + s.seed * 100 + Math.floor(ph) * 7.3);
        if (s.kind === 0) {
          pos[i * 3] = s.x + wx * age + (j - 0.5) * 0.4;
          pos[i * 3 + 1] = s.y + age * 0.9;
          pos[i * 3 + 2] = s.z + wz * age + (hash(j * 13) - 0.5) * 0.4;
          size[i * 2] = 0.6 + a * 2.8;
          size[i * 2 + 1] = 0;
          const g = 0.3 * light;
          col[i * 4] = g;
          col[i * 4 + 1] = g * 0.97;
          col[i * 4 + 2] = g * 0.94;
          col[i * 4 + 3] = 0.42 * Math.sin(Math.PI * a) * (1 - a * 0.5);
        } else if (s.kind === 1) {
          pos[i * 3] = s.x + Math.sin(t * 9 + k * 2.1) * 0.12 * (1 - a) + (j - 0.5) * 0.5 * (1 - a);
          pos[i * 3 + 1] = s.y + age * 1.9;
          pos[i * 3 + 2] = s.z + Math.cos(t * 8 + k * 1.7) * 0.12 * (1 - a) + (hash(j * 7) - 0.5) * 0.5 * (1 - a);
          size[i * 2] = 0.95 * (1 - a) + 0.2;
          size[i * 2 + 1] = 1;
          col[i * 4] = 2.4;
          col[i * 4 + 1] = 0.9 - a * 0.6;
          col[i * 4 + 2] = 0.2 - a * 0.18;
          col[i * 4 + 3] = (1 - a) * Math.min(1, a * 8);
        } else {
          pos[i * 3] = s.x + wx * age * 1.5 + (j - 0.5) * 14;
          pos[i * 3 + 1] = s.y + age * 5.5;
          pos[i * 3 + 2] = s.z + wz * age * 1.5 + (hash(j * 3) - 0.5) * 14;
          size[i * 2] = 12 + a * 34;
          size[i * 2 + 1] = 0;
          const glowLow = Math.max(0, 1 - a * 4);
          col[i * 4] = 0.08 * light + glowLow * 0.5;
          col[i * 4 + 1] = 0.07 * light + glowLow * 0.14;
          col[i * 4 + 2] = 0.065 * light + glowLow * 0.03;
          col[i * 4 + 3] = 0.34 * Math.sin(Math.PI * Math.min(1, a * 1.2));
        }
      }
    }
    if (dirty) this.smoke.commit();
  }

  // ------------------------------------------------------------- per-frame --

  private sunDir = new THREE.Vector3();
  private fogColor = new THREE.Color();
  private dayFog = new THREE.Color();
  private nightFog = new THREE.Color(0x182030);
  private tmp = new THREE.Color();

  /**
   * Updates sky, sun, fog and lights for the time of day and the zone the
   * player stands in. `dayMinutes` is 0-1440.
   */
  update(dt: number, t: number, dayMinutes: number, focus: THREE.Vector3, zone: ZoneId, nightVision: boolean, fog: THREE.FogExp2) {
    // Sun angle: rises at 6:00, sets at 18:00.
    const a = ((dayMinutes - 360) / 1440) * Math.PI * 2;
    this.sunDir.set(Math.cos(a) * 0.8, Math.sin(a), 0.35).normalize();
    const sunUp = this.sunDir.y;
    const day = smoothstep(-0.12, 0.25, sunUp);
    const golden = 1 - smoothstep(0.04, 0.42, Math.abs(sunUp));
    const night = 1 - day;
    const k = Math.min(1, dt);

    const u = this.sky.uniforms;
    u.sunDir.value.copy(this.sunDir);
    u.moonDir.value.set(-this.sunDir.x, Math.max(0.25, -this.sunDir.y), -this.sunDir.z).normalize();
    u.night.value = night;
    u.golden.value = golden * smoothstep(-0.15, 0.0, sunUp);
    u.time.value = t;
    u.top.value.setHex(0x3a5a86).lerp(this.tmp.setHex(0x4a4a7a), golden * 0.6).lerp(this.tmp.setHex(0x05070e), night);
    const zoneFog = ZONES[zone].fog;
    this.dayFog.setHex(zoneFog).lerp(this.tmp.setHex(0xe8985a), golden * 0.55);
    u.horizon.value.copy(this.dayFog).multiplyScalar(1.15).lerp(this.tmp.setHex(0x1c2638), night);
    u.sunColor.value.setHex(0xffd890).lerp(this.tmp.setHex(0xff6a28), golden);
    const coverWant = zone === 'desert' ? 0.66 : zone === 'swamp' || zone === 'crossroads' ? 0.44 : zone === 'volcano' || zone === 'badlands' ? 0.5 : 0.56;
    this.cover += (coverWant - this.cover) * k * 0.2;
    u.cover.value = this.cover;
    u.cloudLit.value.setHex(0xf0ebe4).lerp(this.tmp.setHex(0xffa868), golden * 0.75).lerp(this.tmp.setHex(0x283044), night);
    u.cloudShade.value.setHex(0x8a909c).lerp(this.tmp.setHex(0x6a4a5a), golden * 0.6).lerp(this.tmp.setHex(0x0e121c), night);
    if (zone === 'volcano') u.cloudShade.value.lerp(this.tmp.setHex(0x3a2a24), 0.6);

    this.fogColor.copy(this.dayFog).lerp(this.nightFog, night * (nightVision ? 0.6 : 1));
    fog.color.lerp(this.fogColor, Math.min(1, dt * 1.5));
    const density = zone === 'swamp' ? 0.016 : zone === 'crossroads' ? 0.011 : zone === 'volcano' ? 0.009 : zone === 'forest' ? 0.008 : 0.0055;
    fog.density += (density * (1 + night * 0.4) - fog.density) * k;

    this.sun.position.copy(focus).addScaledVector(sunUp > -0.05 ? this.sunDir : u.moonDir.value, 160);
    this.sun.target.position.copy(focus);
    this.sun.color.setHex(0xfff0d8).lerp(this.tmp.setHex(0xff9050), golden);
    // The moon takes over from the sun after dusk (fading in, so there is no pop).
    this.sun.intensity = sunUp > -0.05 ? 2.7 * smoothstep(-0.05, 0.2, sunUp) : 1.7 * smoothstep(-0.05, -0.25, sunUp);
    if (sunUp <= -0.05) this.sun.color.setHex(0x8494c8);
    // Moonlit nights stay dark but readable.
    this.hemi.intensity = 1.1 + 0.15 * night + (nightVision ? 0.9 * night : 0);
    this.hemi.color.setHex(0xd8c8a0).lerp(this.tmp.setHex(0xe0a070), golden * 0.5).lerp(this.tmp.setHex(0x7a8cc0), night);
    this.hemi.groundColor.setHex(0x3a3020).lerp(this.tmp.setHex(0x222a3a), night);
    this.ambient.intensity = 0.2 + 0.4 * night + (nightVision ? 0.6 * night : 0);
    this.heroLight.position.set(focus.x, focus.y + 3, focus.z);
    this.heroLight.intensity = Math.max(7 * night, 4 * this.heroWarm);
    this.heroLight.color.setHex(0xa8b8ff).lerp(this.tmp.setHex(0xffc070), this.heroWarm);

    // Water mirrors the sky; the glint follows the sun, or the moon at night.
    const w = this.waterU;
    w.uTime.value = t;
    w.uLight.value = 0.22 + 0.78 * day + (nightVision ? 0.4 * night : 0);
    w.uSky.value.copy(u.top.value);
    w.uHorizon.value.copy(u.horizon.value);
    if (sunUp > -0.05) {
      w.uSunDir.value.copy(this.sunDir);
      w.uSunColor.value.copy(u.sunColor.value).multiplyScalar(smoothstep(-0.05, 0.1, sunUp));
    } else {
      w.uSunDir.value.copy(u.moonDir.value);
      w.uSunColor.value.setHex(0x8a9ac0).multiplyScalar(0.28);
    }

    this.time.value = t;
    this.lavaTime.value = t;
    const windWant = zone === 'desert' ? 1.7 : zone === 'badlands' ? 1.4 : zone === 'coast' ? 1.3 : zone === 'swamp' ? 0.4 : zone === 'forest' ? 0.7 : zone === 'crossroads' ? 0.55 : 1;
    this.zoneWind += (windWant - this.zoneWind) * k * 0.3;
    this.wind.value.set(0.22, 0.11).multiplyScalar(this.zoneWind);
    this.glow.value = 0.25 + night * 1.6;
    this.leafLift.value = 0.45 * day;
    if (this.runes) (this.runes.material as THREE.ShaderMaterial).uniforms.uGlow.value = 0.7 + night * 0.9;
    (this.lava.material as THREE.MeshStandardMaterial).emissiveIntensity = 2 + Math.sin(t * 1.3) * 0.4;
    this.eyeMaterial.emissiveIntensity = 0.3 + night * 2.8 + Math.sin(t * 0.7) * 0.15;
    this.giantOrb.rotation.y = t * 0.05;

    this.stream(dt, focus);
    if (!this.priming) this.grass.update(focus, dt);
    // Ground and plants far beyond the fog (or too small to see) are skipped entirely.
    const view = Math.min(440, 2.4 / fog.density);
    for (const gt of this.groundTiles) {
      const dx = Math.max(0, Math.abs(focus.x - gt.x) - TILE / 2);
      const dz = Math.max(0, Math.abs(focus.z - gt.z) - TILE / 2);
      gt.mesh.visible = dx * dx + dz * dz < (view + 40) ** 2;
    }
    for (const p of this.plantTiles) {
      const dx = Math.max(0, Math.abs(focus.x - p.x) - TILE / 2);
      const dz = Math.max(0, Math.abs(focus.z - p.z) - TILE / 2);
      p.mesh.visible = dx * dx + dz * dz < Math.min(p.range, view) ** 2;
    }

    for (const a of this.animated) {
      if (a.kind === 'spin') a.obj.rotation.z = t * 0.3;
      else if (a.kind === 'bob') a.obj.position.y = a.base + Math.sin(t * 2) * 0.08;
      else a.obj.scale.setScalar(a.base * (0.9 + Math.sin(t * 9 + a.base) * 0.06 + Math.sin(t * 23) * 0.04));
    }

    // Sunbeams: strongest in the woods and at the golden hour.
    if (this.rays) {
      const ru = (this.rays.material as THREE.ShaderMaterial).uniforms;
      const zoneRays = zone === 'forest' ? 1 : zone === 'plains' || zone === 'town' ? 0.65 : zone === 'swamp' || zone === 'crossroads' ? 0.55 : zone === 'volcano' ? 0.1 : 0.45;
      const strength = smoothstep(0.0, 0.15, sunUp) * zoneRays * (0.55 + golden * 0.8) * 0.32;
      ru.uSun.value.copy(this.sunDir);
      ru.uFocus.value.copy(focus);
      ru.uColor.value.copy(u.sunColor.value).multiplyScalar(strength);
      this.rays.visible = strength > 0.002;
    }

    this.updateMotes(Math.min(dt, 0.1), t, focus, zone, day, smoothstep(0.02, 0.2, sunUp));
    this.updateSmoke(t, focus, day);

    // Hand the few real point lights to the emitters nearest the player.
    for (let i = 0; i < this.lights.length; i++) {
      let best: Emitter | null = null;
      let bestD = 70 * 70;
      for (const e of this.emitters) {
        const d = e.pos.distanceToSquared(focus);
        if (d >= bestD) continue;
        let taken = false;
        for (let j = 0; j < i; j++) if (this.lightPick[j] === e) taken = true;
        if (taken) continue;
        bestD = d;
        best = e;
      }
      this.lightPick[i] = best;
      const l = this.lights[i];
      if (!best) {
        l.intensity = 0;
        continue;
      }
      l.position.copy(best.pos);
      l.color.setHex(best.color);
      l.distance = best.distance;
      const fade = 1 - smoothstep(45, 70, Math.sqrt(bestD));
      const flick = best.flicker ? 1 - best.flicker * (0.5 + 0.5 * Math.sin(t * 17 + i * 3) * Math.sin(t * 7.3)) : 1;
      l.intensity = best.intensity * fade * flick * (0.6 + 0.6 * night);
    }
  }

  isNight(dayMinutes: number) {
    return dayMinutes < 330 || dayMinutes > 1170;
  }
}
