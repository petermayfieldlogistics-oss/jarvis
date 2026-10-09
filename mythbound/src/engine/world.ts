import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ANVILS, DOCKS, EYES_RUINS, FISHING_SPOTS, ISLAND, LORE, NPCS, ORE_NODES, PAGES, SHRINES, TOMES, TOWN, TRIALS, VOLCANO, WORLD_HALF, ZONES, type ZoneId,
} from '../data/world';
import { SPELLS } from '../data/defs';
import { buildBoat, glowSprite, mat } from './models';
import { mulberry32, noise2, smoothstep } from './noise';
import { buildTerrainMesh, heightAt, inLava, LAVA_LEVEL, normalAt, zoneAt, WATER_LEVEL } from './terrain';

export type Quality = 'low' | 'medium' | 'high';

export interface Collider {
  x: number;
  z: number;
  r: number;
}

export type InteractKind = 'npc' | 'shrine' | 'lore' | 'tome' | 'page' | 'anvil' | 'dock' | 'fish' | 'ore' | 'trial' | 'loot';

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

/** Merges static props per material into a handful of draw calls. */
class Batcher {
  private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  add(geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(sx, sy, sz));
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(this.m);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    let list = this.groups.get(material);
    if (!list) this.groups.set(material, (list = []));
    list.push(g);
  }

  build(parent: THREE.Object3D, shadows: boolean) {
    for (const [material, list] of this.groups) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      parent.add(mesh);
      list.forEach((g) => g.dispose());
    }
    this.groups.clear();
  }
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const CONE4 = new THREE.ConeGeometry(0.75, 1, 4);
const CONE = new THREE.ConeGeometry(0.5, 1, 10);
const ROCK = new THREE.DodecahedronGeometry(1, 0);
const TORUS = new THREE.TorusGeometry(1, 0.08, 6, 24);

// ------------------------------------------------------------------- sky --

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w;
}`;
const SKY_FRAG = `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 moonDir;
uniform float night;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main() {
  float h = clamp(vDir.y, -0.2, 1.0);
  vec3 col = mix(horizon, top, pow(max(h, 0.0), 0.55));
  float s = max(dot(vDir, sunDir), 0.0);
  col += sunColor * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.35);
  float m = max(dot(vDir, moonDir), 0.0);
  col += vec3(0.8, 0.85, 1.0) * (smoothstep(0.9993, 0.9996, m) * 1.4 + pow(m, 40.0) * 0.15) * night;
  vec3 cell = floor(vDir * 300.0);
  float star = step(0.9975, hash(cell)) * night * smoothstep(0.0, 0.25, vDir.y);
  col += vec3(star);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  mesh: THREE.Mesh;
  uniforms = {
    top: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3() },
    sunColor: { value: new THREE.Color() },
    moonDir: { value: new THREE.Vector3() },
    night: { value: 0 },
  };
  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1800, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }
}

// ----------------------------------------------------------------- world --

export class World {
  root = new THREE.Group();
  colliders: Collider[] = [];
  private grid = new Map<string, Collider[]>();
  interactables: Interactable[] = [];
  emitters: Emitter[] = [];
  trialFog = new Map<string, THREE.Mesh>();
  sky = new Sky();
  sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
  hemi = new THREE.HemisphereLight(0xc8b890, 0x3a3020, 0.9);
  ambient = new THREE.AmbientLight(0x404050, 0.25);
  water!: THREE.Mesh;
  lava!: THREE.Mesh;
  eyeMaterial!: THREE.MeshStandardMaterial;
  giantOrb!: THREE.Mesh;
  private lights: THREE.PointLight[] = [];
  private animated: { obj: THREE.Object3D; kind: 'spin' | 'bob' | 'flicker'; base: number }[] = [];
  private batch = new Batcher();
  private rand = mulberry32(42);

  constructor(scene: THREE.Scene, private quality: Quality) {
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
      const l = new THREE.PointLight(0xffa040, 0, 20, 1.6);
      this.lights.push(l);
      scene.add(l);
    }

    this.root.add(buildTerrainMesh(quality === 'low' ? 200 : quality === 'medium' ? 260 : 320));
    this.buildWater();
    this.buildLava();
    this.buildGiant();
    this.buildVegetation();
    this.buildTown();
    this.buildDocks();
    this.buildShrines();
    this.buildTrials();
    this.buildEyeRuins();
    this.buildLoreAndLoot();
    this.batch.build(this.root, quality !== 'low');
  }

  // ------------------------------------------------------------ colliders --

  addCollider(x: number, z: number, r: number) {
    const c = { x, z, r };
    this.colliders.push(c);
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

  // -------------------------------------------------------------- builders --

  private groundY(x: number, z: number) {
    return heightAt(x, z);
  }

  private buildWater() {
    const geo = new THREE.PlaneGeometry(2400, 2400, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1d3a44, roughness: 0.12, metalness: 0.5, transparent: true, opacity: 0.86 }));
    this.water.position.y = WATER_LEVEL;
    this.water.receiveShadow = true;
    this.root.add(this.water);
  }

  private buildLava() {
    const geo = new THREE.RingGeometry(VOLCANO.platform - 1, VOLCANO.crater + 2, 48, 1);
    geo.rotateX(-Math.PI / 2);
    this.lava = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xff5010, emissive: 0xff3000, emissiveIntensity: 2.2, roughness: 0.6 }));
    this.lava.position.set(VOLCANO.x, LAVA_LEVEL, VOLCANO.z);
    this.root.add(this.lava);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = (VOLCANO.platform + VOLCANO.crater) / 2;
      this.emitters.push({ pos: new THREE.Vector3(VOLCANO.x + Math.cos(a) * r, LAVA_LEVEL + 2, VOLCANO.z + Math.sin(a) * r), color: 0xff5010, intensity: 30, distance: 40, flicker: 0.3 });
    }
    const smoke = glowSprite(0xff6020, 120, 0.25);
    smoke.position.set(VOLCANO.x, LAVA_LEVEL + 20, VOLCANO.z);
    this.root.add(smoke);
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
    g.position.set(-80, -60, -640);
    g.rotation.y = 0.3;
    this.root.add(g);
  }

  private instanced(geo: THREE.BufferGeometry, material: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[], shadow = true) {
    if (!mats.length) return;
    const mesh = new THREE.InstancedMesh(geo, material, mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    if (colors) colors.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.computeBoundingSphere();
    mesh.castShadow = shadow && this.quality !== 'low';
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  private buildVegetation() {
    const colored = (geo: THREE.BufferGeometry, color: number) => {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      const c = new THREE.Color(color);
      const arr = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < arr.length; i += 3) (arr[i] = c.r), (arr[i + 1] = c.g), (arr[i + 2] = c.b);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      g.deleteAttribute('uv');
      return g;
    };
    const tf = (geo: THREE.BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, rz = 0) =>
      geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)), new THREE.Vector3(sx, sy, sz)));

    const conifer = mergeGeometries([
      tf(colored(CYL, 0x3a2a1c), 0, 1.5, 0, 0.5, 3, 0.5),
      tf(colored(CONE, 0x2e3a26), 0, 4, 0, 4.2, 4.5, 4.2),
      tf(colored(CONE, 0x34422a), 0, 6.3, 0, 3.2, 3.8, 3.2),
      tf(colored(CONE, 0x3a4a2e), 0, 8.3, 0, 2, 3, 2),
    ])!;
    const leafy = mergeGeometries([
      tf(colored(CYL, 0x3e2e20), 0, 2, 0, 0.6, 4, 0.6),
      tf(colored(new THREE.IcosahedronGeometry(1, 0), 0xffffff), 0, 5.3, 0, 3.2, 2.6, 3.2),
      tf(colored(new THREE.IcosahedronGeometry(1, 0), 0xffffff), 1.4, 4.6, 0.6, 2, 1.8, 2),
      tf(colored(new THREE.IcosahedronGeometry(1, 0), 0xffffff), -1.2, 4.8, -0.7, 2.1, 1.7, 2.1),
    ])!;
    const dead = mergeGeometries([
      tf(colored(CYL, 0x2a2420), 0, 2.5, 0, 0.45, 5, 0.45),
      tf(colored(CYL, 0x2a2420), 0.8, 4.2, 0, 0.2, 2.4, 0.2, -0.8),
      tf(colored(CYL, 0x2a2420), -0.7, 3.6, 0, 0.18, 2, 0.18, 0.9),
      tf(colored(CYL, 0x2a2420), 0.2, 5.6, 0, 0.14, 1.6, 0.14, 0.3),
    ])!;
    const cactus = mergeGeometries([
      tf(colored(CYL, 0x4a6a3a), 0, 1.6, 0, 0.7, 3.2, 0.7),
      tf(colored(CYL, 0x4a6a3a), 0.7, 1.8, 0, 0.4, 1.2, 0.4, 1.2),
      tf(colored(CYL, 0x4a6a3a), 1.1, 2.3, 0, 0.4, 1.2, 0.4),
    ])!;
    const grass = mergeGeometries([
      tf(colored(new THREE.ConeGeometry(0.08, 1, 3), 0xffffff), 0, 0.4, 0, 1, 0.9, 1, 0.2),
      tf(colored(new THREE.ConeGeometry(0.08, 1, 3), 0xffffff), 0.12, 0.35, 0.05, 1, 0.7, 1, -0.3),
      tf(colored(new THREE.ConeGeometry(0.08, 1, 3), 0xffffff), -0.1, 0.3, -0.06, 1, 0.65, 1, 0.4),
    ])!;
    const vmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });

    const sets: Record<string, { mats: THREE.Matrix4[]; colors: THREE.Color[] }> = {};
    // Instances are grouped in tiles so whole tiles can be culled.
    const TILE = 150;
    const put = (name: string, x: number, z: number, s: number, color?: THREE.Color, sink = 0.2) => {
      const set = (sets[`${name}:${Math.floor(x / TILE)},${Math.floor(z / TILE)}`] ??= { mats: [], colors: [] });
      const y = this.groundY(x, z) - sink * s;
      set.mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rand() * Math.PI * 2), new THREE.Vector3(s, s * (0.85 + this.rand() * 0.3), s)));
      set.colors.push(color ?? new THREE.Color(1, 1, 1));
    };

    const avoid = (x: number, z: number, pad: number) => {
      if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.radius + pad) return true;
      for (const t of TRIALS) if (Math.hypot(x - t.x, z - t.z) < t.radius + pad + 4) return true;
      for (const s of SHRINES) if (Math.hypot(x - s.x, z - s.z) < 8 + pad) return true;
      for (const d of DOCKS) if (Math.hypot(x - d.x, z - d.z) < 10 + pad) return true;
      if (Math.hypot(x - EYES_RUINS.x, z - EYES_RUINS.z) < 22 + pad) return true;
      return false;
    };

    const density: Partial<Record<ZoneId, Record<string, number>>> = {
      plains: { leafy: 0.035, rock: 0.02, grass: 0.5 },
      forest: { conifer: 0.32, leafy: 0.06, rock: 0.03, grass: 0.35 },
      desert: { cactus: 0.025, rock: 0.03, dead: 0.008 },
      volcano: { dead: 0.02, rock: 0.06 },
      coast: { leafy: 0.015, rock: 0.04, grass: 0.12 },
      swamp: { dead: 0.12, grass: 0.4, rock: 0.02 },
      crossroads: { dead: 0.07, rock: 0.05, grass: 0.12 },
      badlands: { dead: 0.012, rock: 0.05 },
      town: { grass: 0.15 },
    };
    const grassScale = this.quality === 'low' ? 0.3 : this.quality === 'medium' ? 0.6 : 1;
    const step = 6;
    const tint = new THREE.Color();
    for (let gx = -WORLD_HALF + 10; gx < WORLD_HALF - 10; gx += step) {
      for (let gz = -WORLD_HALF + 10; gz < WORLD_HALF - 10; gz += step) {
        const x = gx + (this.rand() - 0.5) * step;
        const z = gz + (this.rand() - 0.5) * step;
        const y = this.groundY(x, z);
        if (y < 0.6 || inLava(x, z, y)) continue;
        const zone = zoneAt(x, z);
        const d = density[zone];
        if (!d) continue;
        const slope = normalAt(x, z).y;
        const clump = 0.5 + 0.5 * noise2(x / 40, z / 40);
        for (const [kind, p] of Object.entries(d)) {
          const chance = p * (kind === 'grass' ? grassScale * 3 : 1) * (kind === 'conifer' || kind === 'leafy' ? 0.4 + clump * 1.2 : 1);
          if (this.rand() > chance) continue;
          if (kind !== 'grass' && kind !== 'rock' && slope < 0.8) continue;
          if (avoid(x, z, kind === 'grass' ? -6 : 2)) continue;
          if (kind === 'grass') {
            const zc = ZONES[zone].ground;
            tint.setHex(zone === 'plains' ? 0xb09a48 : zc).multiplyScalar(1.2 + this.rand() * 0.4);
            put('grass', x, z, 0.8 + this.rand() * 0.8, tint.clone(), 0);
          } else if (kind === 'rock') {
            const s = 0.6 + this.rand() * this.rand() * 4;
            put('rock', x, z, s, new THREE.Color(ZONES[zone].rock).multiplyScalar(1.3), 0.35);
            if (s > 1.8) this.addCollider(x, z, s * 0.85);
          } else {
            const s = 0.8 + this.rand() * 0.6;
            let color: THREE.Color | undefined;
            if (kind === 'leafy') {
              // Golden canopies on the plains, autumn reds by the coast.
              const palette = zone === 'plains' ? [0xc8962a, 0xd8a838, 0xa87a28, 0x8a8a30] : zone === 'coast' ? [0x7a8a40, 0x9a6a30] : [0x4a5a2a, 0x5a6a30, 0x7a6a28];
              color = new THREE.Color(palette[Math.floor(this.rand() * palette.length)]);
            }
            put(kind, x, z, s, color);
            this.addCollider(x, z, 0.7 * s);
          }
        }
      }
    }
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const rockMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
    const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    for (const [key, set] of Object.entries(sets)) {
      switch (key.split(':')[0]) {
        case 'conifer': this.instanced(conifer, vmat, set.mats); break;
        case 'leafy': this.instanced(leafy, leafMat, set.mats, set.colors); break;
        case 'dead': this.instanced(dead, vmat, set.mats); break;
        case 'cactus': this.instanced(cactus, vmat, set.mats); break;
        case 'rock': this.instanced(ROCK, rockMat, set.mats, set.colors); break;
        case 'grass': this.instanced(grass, grassMat, set.mats, set.colors, false); break;
      }
    }
  }

  // ---------------------------------------------------------- structures --

  private house(x: number, z: number, ry: number, w = 6, d = 5, h = 3.6) {
    const y = this.groundY(x, z);
    const plaster = mat(0x8a7a62, { rough: 0.95 });
    const timber = mat(0x3a2a1c, { rough: 0.9 });
    const roof = mat(0x4a2e22, { rough: 0.9 });
    const b = this.batch;
    b.add(BOX, plaster, x, y + h / 2 - 0.3, z, ry, w, h, d);
    const c = Math.cos(ry), s = Math.sin(ry);
    const off = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
    for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
      const [px, pz] = off(lx, lz);
      b.add(BOX, timber, px, y + h / 2 - 0.3, pz, ry, 0.3, h + 0.1, 0.3);
    }
    b.add(CONE4, roof, x, y + h + 1.1, z, ry + Math.PI / 4, Math.max(w, d) * 0.95, 2.8, Math.max(w, d) * 0.95);
    const [dx, dz] = off(0, d / 2 + 0.02);
    b.add(BOX, timber, dx, y + 0.9, dz, ry, 1.1, 2, 0.1);
    const [wx, wz] = off(w / 4 + 0.4, d / 2 + 0.03);
    b.add(BOX, mat(0xffb860, { emissive: 0xff9030, emissiveIntensity: 1.2 }), wx, y + 1.8, wz, ry, 0.7, 0.6, 0.06);
    this.addCollider(x, z, Math.max(w, d) * 0.55);
  }

  private buildTown() {
    const b = this.batch;
    const stone = mat(0x6a645a, { rough: 0.95 });
    const dark = mat(0x3a352f, { rough: 0.95 });
    // Ruined outer wall with gaps for the four roads.
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const gap = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.12);
      if (gap || this.rand() < 0.15) continue;
      const r = TOWN.radius - 2;
      const x = TOWN.x + Math.cos(a) * r;
      const z = TOWN.z + Math.sin(a) * r;
      const h = 2 + this.rand() * 2.5;
      b.add(BOX, stone, x, this.groundY(x, z) + h / 2 - 0.5, z, -a, 1.2, h, 6.4);
      this.addCollider(x, z, 2.6);
    }
    // Houses around the square, off the roads.
    const spots: [number, number][] = [];
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
        spots.push([x, z]);
        this.house(x, z, -a + Math.PI / 2, 5 + this.rand() * 2.5, 4.5 + this.rand() * 1.5, 3.2 + this.rand() * 1.2);
      }
    }
    // Chapel of Light.
    {
      const x = 0, z = -28, y = this.groundY(x, z);
      b.add(BOX, stone, x, y + 4, z, 0, 9, 9, 13);
      b.add(CONE4, mat(0x3a3a44, { rough: 0.8 }), x, y + 10.5, z, Math.PI / 4, 11, 4, 15);
      b.add(BOX, stone, x, y + 9, z + 5, 0, 3, 18, 3);
      b.add(CONE4, mat(0x3a3a44), x, y + 20, z + 5, Math.PI / 4, 3.6, 5, 3.6);
      b.add(BOX, mat(0xffe8a0, { emissive: 0xffd060, emissiveIntensity: 1.6 }), x, y + 6, z + 6.55, 0, 2.2, 3.4, 0.1);
      b.add(BOX, dark, x, y + 1.5, z + 6.55, 0, 2, 3, 0.1);
      this.addCollider(x, z - 2, 6.5);
      this.addCollider(x, z + 3, 5.5);
      this.emitters.push({ pos: new THREE.Vector3(x, y + 6, z + 8), color: 0xffd080, intensity: 12, distance: 22 });
    }
    // Forge.
    {
      const x = 34, z = 16, y = this.groundY(x, z);
      for (const [px, pz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) b.add(BOX, mat(0x3a2a1c), x + px, y + 1.8, z + pz, 0, 0.35, 3.6, 0.35);
      b.add(CONE4, mat(0x4a2e22), x, y + 4.3, z, Math.PI / 4, 9, 1.6, 9);
      b.add(BOX, stone, x + 1.8, y + 1, z - 1.8, 0, 2.4, 2, 2);
      b.add(BOX, mat(0xff7020, { emissive: 0xff5010, emissiveIntensity: 2.5 }), x + 1.8, y + 0.9, z - 0.78, 0, 1, 0.7, 0.05);
      this.emitters.push({ pos: new THREE.Vector3(x + 1.8, y + 1.4, z), color: 0xff6a20, intensity: 18, distance: 16, flicker: 0.4 });
      this.addCollider(x + 1.8, z - 1.8, 1.6);
    }
    for (const a of ANVILS) this.anvil(a.x, a.z);
    // The Archive.
    {
      const x = -36, z = 6, y = this.groundY(x, z);
      b.add(BOX, mat(0x7a7468, { rough: 0.9 }), x, y + 3, z, 0, 10, 6, 8);
      b.add(BOX, mat(0x7a7468), x, y + 6.4, z, 0, 11, 0.8, 9);
      for (let i = 0; i < 4; i++) b.add(CYL, mat(0x9a948a), x + 5.6, y + 3, z - 3 + i * 2, 0, 0.7, 6, 0.7);
      b.add(BOX, mat(0xffc070, { emissive: 0xff9a40, emissiveIntensity: 1.3 }), x + 5.06, y + 1.5, z, 0, 0.05, 2.6, 1.4);
      this.addCollider(x, z, 6.4);
    }
    // Well, market stall, lamp posts, the Chronicler's desk.
    {
      const y = this.groundY(TOWN.x, TOWN.z);
      b.add(CYL, stone, TOWN.x, y + 0.5, TOWN.z, 0, 3.2, 1.2, 3.2);
      b.add(CYL, mat(0x0a1418, { rough: 0.1 }), TOWN.x, y + 1.05, TOWN.z, 0, 2.6, 0.05, 2.6);
      this.addCollider(TOWN.x, TOWN.z, 1.8);
      const sx = 16, sz = 40, sy = this.groundY(sx, sz);
      b.add(BOX, mat(0x5a3e24), sx, sy + 0.5, sz, 0, 4, 1, 1.6);
      b.add(BOX, mat(0x8a2a22, { rough: 1 }), sx, sy + 2.6, sz, 0.15, 4.6, 0.12, 2.4);
      for (const px of [-1.9, 1.9]) b.add(BOX, mat(0x3a2a1c), sx + px, sy + 1.3, sz - 0.9, 0, 0.15, 2.6, 0.15);
      this.addCollider(sx, sz, 2.2);
      const cx = -12, cz = 37, cy = this.groundY(cx, cz);
      b.add(BOX, mat(0x3a2a1c), cx, cy + 0.5, cz, 0, 1.6, 1, 0.9);
      b.add(BOX, mat(0xe8dcc0), cx, cy + 1.02, cz, 0.3, 0.5, 0.02, 0.35);
      const candle = glowSprite(0xffb040, 0.8);
      candle.position.set(cx + 0.6, cy + 1.25, cz);
      this.root.add(candle);
      for (const [lx, lz] of [[6, 8], [-6, 8], [6, 32], [-6, 32], [8, -8], [-8, -8], [20, 26], [-20, 26]]) {
        const x = TOWN.x + lx, z = TOWN.z + lz, ly = this.groundY(x, z);
        b.add(CYL, mat(0x2a2422, { metal: 0.6, rough: 0.5 }), x, ly + 1.6, z, 0, 0.16, 3.2, 0.16);
        const s = glowSprite(0xffb050, 1.6);
        s.position.set(x, ly + 3.3, z);
        this.root.add(s);
        this.emitters.push({ pos: new THREE.Vector3(x, ly + 3.3, z), color: 0xffa050, intensity: 6, distance: 14, flicker: 0.1 });
      }
    }
    // Interactables for townsfolk are added by the game (they are actors).
  }

  private anvil(x: number, z: number) {
    const y = this.groundY(x, z);
    this.batch.add(BOX, mat(0x2a2a2c, { metal: 0.8, rough: 0.4 }), x, y + 0.75, z, 0, 1.3, 0.35, 0.55);
    this.batch.add(BOX, mat(0x2a2a2c, { metal: 0.8, rough: 0.4 }), x, y + 0.3, z, 0, 0.6, 0.6, 0.45);
    this.addCollider(x, z, 0.8);
    this.interactables.push({ id: `anvil-${x}-${z}`, kind: 'anvil', x, y: y + 1, z, radius: 3, label: 'Anvil: upgrade weapons' });
  }

  private buildDocks() {
    const wood = mat(0x4a3420, { rough: 0.9 });
    for (const d of DOCKS) {
      const len = 18;
      const y0 = Math.max(0.6, this.groundY(d.x, d.z - 4));
      for (let i = 0; i < len; i += 2) {
        const z = d.z - 6 + i;
        this.batch.add(BOX, wood, d.x, y0 + 0.2, z, 0, 3, 0.2, 1.9);
        if (i % 4 === 0) for (const s of [-1.4, 1.4]) this.batch.add(CYL, wood, d.x + s, y0 - 2, z, 0, 0.3, 5, 0.3);
      }
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
    const stone = mat(0x5a564e, { rough: 0.95 });
    for (const s of SHRINES) {
      const y = this.groundY(s.x, s.z);
      this.batch.add(CYL, stone, s.x, y + 0.2, s.z, 0, 3.2, 0.5, 3.2);
      this.batch.add(BOX, stone, s.x, y + 1.3, s.z, 0.2, 0.6, 2.2, 0.6, 0.06);
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
  }

  private buildTrials() {
    const palette: Record<string, number> = { hunt: 0x60ffb0, tides: 0x40d0ff, storms: 0x80b0ff, forge: 0xff6a20, war: 0xff4030, crossroads: 0xa070ff };
    for (const t of TRIALS) {
      const y = this.groundY(t.x, t.z);
      const color = palette[t.id];
      const stone = t.id === 'storms' ? mat(0xa08060, { rough: 0.95 }) : t.id === 'forge' ? mat(0x2a2220, { rough: 0.9 }) : mat(0x6a665e, { rough: 0.95 });
      if (t.id === 'war') {
        // A ruined colosseum.
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2;
          if (i === 7 || this.rand() < 0.12) continue;
          const r = t.radius + 3;
          const x = t.x + Math.cos(a) * r;
          const z = t.z + Math.sin(a) * r;
          const h = 6 + this.rand() * 6;
          this.batch.add(BOX, stone, x, y + h / 2, z, -a, 2, h, 7.2);
          this.addCollider(x, z, 3.4);
        }
      } else if (t.id !== 'forge') {
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const r = t.radius + 1.5;
          const x = t.x + Math.cos(a) * r;
          const z = t.z + Math.sin(a) * r;
          const h = 3 + this.rand() * 5;
          this.batch.add(BOX, stone, x, this.groundY(x, z) + h / 2 - 0.4, z, a, 1.6, h, 1.6, (this.rand() - 0.5) * 0.15);
          this.addCollider(x, z, 1.2);
        }
      }
      if (t.id === 'crossroads') {
        // Three roads, and the three-faced statue.
        for (let i = 0; i < 3; i++) this.batch.add(BOX, mat(0x4a4652), t.x, y + 0.02, t.z, (i * Math.PI * 2) / 3, 3.5, 0.08, t.radius * 2.2);
      }
      if (t.id === 'hunt') {
        // Antler totem.
        this.batch.add(CYL, mat(0x3a2a1c), t.x, y + 2, t.z - t.radius + 4, 0, 0.4, 4, 0.4);
        this.batch.add(BOX, mat(0xcfc3a0), t.x, y + 4.2, t.z - t.radius + 4, 0, 2.6, 0.2, 0.2);
      }
      // Sigil ring on the floor and the altar that begins the trial.
      const sigil = new THREE.Mesh(TORUS, mat(color, { emissive: color, emissiveIntensity: 1.6 }));
      sigil.rotation.x = Math.PI / 2;
      sigil.scale.setScalar(3.2);
      sigil.position.set(t.x, y + 0.08, t.z);
      this.root.add(sigil);
      this.animated.push({ obj: sigil, kind: 'spin', base: 0 });
      this.batch.add(BOX, stone, t.x, y + 0.5, t.z, 0, 2.2, 1, 2.2);
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

  private buildEyeRuins() {
    const { x: ex, z: ez } = EYES_RUINS;
    const stone = mat(0x3b3d33, { rough: 0.95 });
    this.eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x80ffa0, emissive: 0x40ff80, emissiveIntensity: 0.2, roughness: 0.6 });
    const pupil = mat(0x050505);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const x = ex + Math.cos(a) * 14;
      const z = ez + Math.sin(a) * 14;
      const y = this.groundY(x, z);
      this.batch.add(BOX, stone, x, y + 3, z, -a + Math.PI / 2, 6, 6 + this.rand() * 3, 1.2);
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
    this.batch.add(CYL, stone, ex, y + 0.3, ez, 0, 5, 0.6, 5);
    const glyph = glowSprite(0x60ff90, 3, 0.6);
    glyph.position.set(ex, y + 1.5, ez);
    this.root.add(glyph);
  }

  private buildLoreAndLoot() {
    for (const l of LORE) {
      const y = this.groundY(l.x, l.z);
      this.batch.add(BOX, mat(0x5a564e, { rough: 0.95 }), l.x, y + 1, l.z, 0.4, 1.4, 2.2, 0.35);
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
      const ped = new THREE.Mesh(CYL, mat(0x4a463e));
      ped.scale.set(0.8, 1.1, 0.8);
      ped.position.y = 0.55;
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
        const c = new THREE.Mesh(CONE4, crystal);
        c.scale.set(0.5, 1.2 + this.rand(), 0.5);
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
    const golden = 1 - smoothstep(0.05, 0.45, Math.abs(sunUp));
    const night = 1 - day;

    const u = this.sky.uniforms;
    u.sunDir.value.copy(this.sunDir);
    u.moonDir.value.set(-this.sunDir.x, Math.max(0.25, -this.sunDir.y), -this.sunDir.z).normalize();
    u.night.value = night;
    u.top.value.setHex(0x3a5a86).lerp(this.tmp.setHex(0x05070e), night);
    const zoneFog = ZONES[zone].fog;
    this.dayFog.setHex(zoneFog).lerp(this.tmp.setHex(0xe0a060), golden * 0.45);
    u.horizon.value.copy(this.dayFog).multiplyScalar(1.15).lerp(this.tmp.setHex(0x1c2638), night);
    u.sunColor.value.setHex(0xffd890).lerp(this.tmp.setHex(0xff7030), golden);

    this.fogColor.copy(this.dayFog).lerp(this.nightFog, night * (nightVision ? 0.6 : 1));
    fog.color.lerp(this.fogColor, Math.min(1, dt * 1.5));
    const density = zone === 'swamp' ? 0.016 : zone === 'crossroads' ? 0.011 : zone === 'volcano' ? 0.009 : zone === 'forest' ? 0.008 : 0.0055;
    fog.density += (density * (1 + night * 0.4) - fog.density) * Math.min(1, dt);

    this.sun.position.copy(focus).addScaledVector(sunUp > -0.05 ? this.sunDir : u.moonDir.value, 160);
    this.sun.target.position.copy(focus);
    this.sun.color.setHex(0xfff0d0).lerp(this.tmp.setHex(0xffa060), golden);
    this.sun.intensity = sunUp > -0.05 ? 2.6 * smoothstep(-0.05, 0.2, sunUp) : 0.7;
    if (sunUp <= -0.05) this.sun.color.setHex(0x8090c0);
    this.hemi.intensity = 0.55 + 0.55 * day + (nightVision ? 0.9 * night : 0);
    this.hemi.color.setHex(0xd8c8a0).lerp(this.tmp.setHex(0x5a6a96), night);
    this.ambient.intensity = 0.2 + (nightVision ? 0.6 * night : 0);

    this.lava.material instanceof THREE.MeshStandardMaterial && (this.lava.material.emissiveIntensity = 2 + Math.sin(t * 1.3) * 0.4);
    this.eyeMaterial.emissiveIntensity = 0.3 + night * 2.8 + Math.sin(t * 0.7) * 0.15;
    this.giantOrb.rotation.y = t * 0.05;

    for (const a of this.animated) {
      if (a.kind === 'spin') a.obj.rotation.z = t * 0.3;
      else if (a.kind === 'bob') a.obj.position.y = a.base + Math.sin(t * 2) * 0.08;
      else a.obj.scale.setScalar(a.base * (0.9 + Math.sin(t * 9 + a.base) * 0.06 + Math.sin(t * 23) * 0.04));
    }

    // Hand the few real point lights to the emitters nearest the player.
    const near = this.emitters
      .map((e) => ({ e, d: e.pos.distanceToSquared(focus) }))
      .filter((x) => x.d < 70 * 70)
      .sort((p, q) => p.d - q.d);
    this.lights.forEach((l, i) => {
      const n = near[i];
      if (!n) return void (l.intensity = 0);
      l.position.copy(n.e.pos);
      l.color.setHex(n.e.color);
      l.distance = n.e.distance;
      const fade = 1 - smoothstep(45, 70, Math.sqrt(n.d));
      const flick = n.e.flicker ? 1 - n.e.flicker * (0.5 + 0.5 * Math.sin(t * 17 + i * 3) * Math.sin(t * 7.3)) : 1;
      l.intensity = n.e.intensity * fade * flick * (0.6 + 0.6 * night);
    });
  }

  isNight(dayMinutes: number) {
    return dayMinutes < 330 || dayMinutes > 1170;
  }
}
