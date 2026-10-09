// Procedural models: heroes, townsfolk, monsters, bosses and weapons, built
// from primitives so the game needs no asset files.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeaponKind } from '../data/defs';

const matCache = new Map<string, THREE.Material>();

/**
 * Merges the static meshes under each joint of a model, by material, so a
 * character costs a handful of draw calls instead of dozens. Joints (groups)
 * and meshes marked `userData.keep` are left alone so they can still animate.
 */
export function compact(root: THREE.Object3D): THREE.Object3D {
  const nodes: THREE.Object3D[] = [];
  root.traverse((o) => nodes.push(o));
  const color = new THREE.Color();
  for (const parent of nodes) {
    const groups = new Map<string, THREE.Mesh[]>();
    for (const c of parent.children) {
      const m = c as THREE.Mesh;
      const material = m.material as THREE.MeshStandardMaterial;
      if (!m.isMesh || m.children.length || m.userData.keep || !material?.isMeshStandardMaterial || material.vertexColors) continue;
      const key = surfaceKey(material);
      const list = groups.get(key) ?? [];
      list.push(m);
      groups.set(key, list);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
        // Bake the part's colour into the vertices so differently coloured
        // parts can share one material.
        color.copy((m.material as THREE.MeshStandardMaterial).color);
        const n = g.attributes.position.count;
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) (arr[i * 3] = color.r), (arr[i * 3 + 1] = color.g), (arr[i * 3 + 2] = color.b);
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        return g;
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, vertexColorTwin(list[0].material as THREE.MeshStandardMaterial));
      mesh.castShadow = list.some((m) => m.castShadow);
      for (const m of list) {
        parent.remove(m);
        m.geometry.dispose();
      }
      parent.add(mesh);
    }
  }
  return root;
}

/**
 * Frees the GPU memory of a model that is gone for good. Materials from the
 * shared caches stay; one-off sprite materials go.
 */
export function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    if ((o as THREE.Sprite).isSprite) ((o as THREE.Sprite).material as THREE.SpriteMaterial).dispose();
  });
}

const surfaceKey = (m: THREE.MeshStandardMaterial) =>
  [m.roughness, m.metalness, m.emissive.getHex(), m.emissiveIntensity, m.transparent, m.opacity, m.side, m.fog].join('|');

const twins = new Map<string, THREE.MeshStandardMaterial>();
/** A white, vertex-coloured copy of a material's surface properties. */
function vertexColorTwin(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const key = surfaceKey(m);
  let t = twins.get(key);
  if (!t) {
    t = m.clone();
    t.color.setRGB(1, 1, 1);
    t.vertexColors = true;
    twins.set(key, t);
  }
  return t;
}

export function mat(color: number, opts: { rough?: number; metal?: number; emissive?: number; emissiveIntensity?: number; transparent?: number; side?: THREE.Side; fog?: boolean } = {}): THREE.MeshStandardMaterial {
  const key = JSON.stringify([color, opts]);
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.75,
      metalness: opts.metal ?? 0,
      emissive: opts.emissive ?? 0,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: opts.transparent !== undefined,
      opacity: opts.transparent ?? 1,
      side: opts.side ?? THREE.FrontSide,
      fog: opts.fog ?? true,
    });
    matCache.set(key, m);
  }
  return m;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
const sphere = (r: number, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
const cone = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg);

export function part(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, parent?: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent?.add(m);
  return m;
}

function pivot(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

let glowTex: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export function glowSprite(color: number, size: number, opacity = 1): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  s.scale.set(size, size, size);
  return s;
}

// --------------------------------------------------------------- weapons --

export function buildWeapon(kind: WeaponKind, legendary = false): THREE.Group {
  const g = new THREE.Group();
  const steel = mat(legendary ? 0xd8c27a : 0xa8a8a8, { rough: 0.3, metal: 0.9 });
  const grip = mat(0x3a2a1c, { rough: 0.9 });
  const glow = legendary ? mat(0xffd27a, { emissive: 0xffb040, emissiveIntensity: 1.6 }) : steel;
  switch (kind) {
    case 'sword':
      part(box(0.05, 0.22, 0.05), grip, 0, 0.0, 0, g);
      part(box(0.28, 0.05, 0.07), steel, 0, 0.12, 0, g);
      part(box(0.07, 1.05, 0.025), legendary ? glow : steel, 0, 0.66, 0, g);
      break;
    case 'dagger':
      part(box(0.04, 0.14, 0.04), grip, 0, 0, 0, g);
      part(box(0.16, 0.03, 0.05), steel, 0, 0.08, 0, g);
      part(box(0.05, 0.42, 0.02), steel, 0, 0.3, 0, g);
      break;
    case 'axe':
      part(cyl(0.03, 0.035, 1.0), grip, 0, 0.4, 0, g);
      part(box(0.04, 0.32, 0.36), steel, 0, 0.78, 0.15, g);
      break;
    case 'hammer':
      part(cyl(0.035, 0.04, 1.1), grip, 0, 0.45, 0, g);
      part(box(0.26, 0.24, 0.42), mat(0x2a2422, { rough: 0.4, metal: 0.8 }), 0, 0.98, 0, g);
      part(box(0.27, 0.06, 0.43), glow, 0, 0.98, 0, g);
      break;
    case 'staff': {
      part(cyl(0.03, 0.04, 1.7), mat(legendary ? 0x221830 : 0x5a3e22, { rough: 0.8 }), 0, 0.5, 0, g);
      const orb = part(sphere(0.1), mat(legendary ? 0xb080ff : 0x80c0ff, { emissive: legendary ? 0x8040ff : 0x3080ff, emissiveIntensity: 2 }), 0, 1.42, 0, g);
      orb.castShadow = false;
      if (legendary) for (let i = 0; i < 3; i++) part(cone(0.03, 0.25), mat(0x221830), Math.cos(i * 2.1) * 0.1, 1.5, Math.sin(i * 2.1) * 0.1, g);
      break;
    }
    case 'trident':
      part(cyl(0.03, 0.03, 1.9), mat(0x2a6a7a, { rough: 0.3, metal: 0.7 }), 0, 0.6, 0, g);
      for (const x of [-0.12, 0, 0.12]) part(cone(0.035, 0.32), legendary ? glow : steel, x, 1.68 + (x === 0 ? 0.06 : 0), 0, g);
      part(box(0.28, 0.04, 0.04), steel, 0, 1.52, 0, g);
      break;
    case 'bolt': {
      const m = mat(0xfff2a0, { emissive: 0xffe060, emissiveIntensity: 2.5 });
      part(box(0.06, 0.45, 0.06), m, 0, 0.25, 0, g).rotation.z = 0.3;
      part(box(0.06, 0.45, 0.06), m, 0.06, 0.65, 0, g).rotation.z = -0.4;
      part(cone(0.07, 0.3), m, 0.0, 1.0, 0, g);
      break;
    }
    case 'bow': {
      // Vertical along local y, limbs curving back toward -z; the group is
      // turned so it sits upright in a raised left hand.
      const wood = legendary ? mat(0xe8e4d8, { emissive: 0xa0b0ff, emissiveIntensity: 0.6 }) : mat(0x5a3a1e, { rough: 0.8 });
      for (const s of [-1, 1]) part(box(0.04, 0.75, 0.05), wood, 0, s * 0.36, -0.08, g).rotation.x = -s * 0.3;
      part(box(0.05, 0.18, 0.06), grip, 0, 0, 0, g);
      g.userData.string = part(cyl(0.006, 0.006, 1.36, 3), mat(0xdddddd), 0, 0, -0.2, g);
      g.rotation.x = Math.PI / 2;
      break;
    }
  }
  return g;
}

export function buildShield(): THREE.Group {
  const g = new THREE.Group();
  part(cyl(0.38, 0.38, 0.06, 12), mat(0x4a3424, { rough: 0.8 }), 0, 0, 0, g).rotation.x = Math.PI / 2;
  part(cyl(0.4, 0.4, 0.04, 12), mat(0x8a8070, { rough: 0.4, metal: 0.8 }), 0, 0, -0.02, g).rotation.x = Math.PI / 2;
  part(sphere(0.08), mat(0xb09a60, { rough: 0.3, metal: 0.9 }), 0, 0, 0.05, g);
  return g;
}

// --------------------------------------------------------------- humanoid --

export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  handR: THREE.Group;
  handL: THREE.Group;
  cape?: THREE.Object3D;
  wings?: THREE.Group;
  tail?: THREE.Object3D;
  height: number;
}

export interface HumanoidLook {
  skin: number;
  armor: number;
  cloth: number;
  accent: number;
  build: 'heavy' | 'light' | 'robe';
  head: 'helmet' | 'hood' | 'hat' | 'bare' | 'skull' | 'crown' | 'plume';
  ears?: boolean;
  horns?: boolean;
  tail?: boolean;
  wings?: boolean;
  glowEyes?: number;
  cape?: number;
  scale?: number;
}

export function buildHumanoid(look: HumanoidLook): Rig {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const metal = look.build === 'heavy';
  const armorM = mat(look.armor, { rough: metal ? 0.35 : 0.8, metal: metal ? 0.75 : 0 });
  const clothM = mat(look.cloth, { rough: 0.9 });
  const skinM = mat(look.skin, { rough: 0.7 });
  const accentM = mat(look.accent, { rough: 0.4, metal: 0.6 });

  // Torso.
  if (look.build === 'robe') {
    part(cyl(0.22, 0.42, 1.05, 10), clothM, 0, 0.75, 0, body);
    part(box(0.46, 0.5, 0.28), clothM, 0, 1.32, 0, body);
    part(box(0.5, 0.06, 0.3), accentM, 0, 1.08, 0, body);
  } else {
    part(box(0.48, 0.58, 0.28), armorM, 0, 1.32, 0, body);
    part(box(0.42, 0.22, 0.26), clothM, 0, 0.98, 0, body);
    part(box(0.5, 0.06, 0.3), accentM, 0, 1.08, 0, body);
    if (metal) {
      part(box(0.2, 0.12, 0.3), armorM, -0.3, 1.58, 0, body).rotation.z = 0.35;
      part(box(0.2, 0.12, 0.3), armorM, 0.3, 1.58, 0, body).rotation.z = -0.35;
    }
  }

  // Head.
  const head = pivot(body, 0, 1.66, 0);
  switch (look.head) {
    case 'helmet':
      part(box(0.27, 0.3, 0.29), armorM, 0, 0.06, 0, head);
      part(box(0.2, 0.03, 0.02), mat(0x111111), 0, 0.08, 0.146, head);
      break;
    case 'plume':
      part(box(0.27, 0.3, 0.29), armorM, 0, 0.06, 0, head);
      part(box(0.04, 0.22, 0.4), mat(0x9a1a14), 0, 0.28, -0.02, head);
      break;
    case 'crown':
      part(sphere(0.14), skinM, 0, 0.05, 0, head);
      for (let i = 0; i < 5; i++) part(cone(0.03, 0.12, 4), accentM, Math.cos(i * 1.25) * 0.12, 0.2, Math.sin(i * 1.25) * 0.12, head);
      break;
    case 'hood':
      part(sphere(0.14), skinM, 0, 0.04, 0.02, head);
      part(cone(0.22, 0.42, 8), clothM, 0, 0.12, -0.03, head);
      break;
    case 'hat':
      part(sphere(0.14), skinM, 0, 0.04, 0, head);
      part(cyl(0.3, 0.3, 0.03, 12), clothM, 0, 0.13, 0, head);
      part(cone(0.16, 0.5, 8), clothM, 0, 0.38, -0.04, head).rotation.x = -0.25;
      break;
    case 'skull':
      part(sphere(0.15), mat(0xd8d0b8), 0, 0.05, 0, head);
      break;
    case 'bare':
      part(sphere(0.14), skinM, 0, 0.05, 0, head);
      part(sphere(0.145, 10, 6, ), mat(0x2a1e14), 0, 0.09, -0.02, head).scale.set(1, 0.7, 1);
      break;
  }
  if (look.ears) {
    part(cone(0.03, 0.18, 4), skinM, -0.15, 0.08, 0, head).rotation.z = 1.1;
    part(cone(0.03, 0.18, 4), skinM, 0.15, 0.08, 0, head).rotation.z = -1.1;
  }
  if (look.horns) {
    const hornM = mat(0x2a2420, { rough: 0.5 });
    part(cone(0.04, 0.25, 5), hornM, -0.1, 0.24, -0.04, head).rotation.set(-0.5, 0, 0.4);
    part(cone(0.04, 0.25, 5), hornM, 0.1, 0.24, -0.04, head).rotation.set(-0.5, 0, -0.4);
  }
  if (look.glowEyes !== undefined) {
    const eyeM = mat(look.glowEyes, { emissive: look.glowEyes, emissiveIntensity: 3 });
    part(sphere(0.025, 6, 4), eyeM, -0.055, 0.07, 0.14, head).castShadow = false;
    part(sphere(0.025, 6, 4), eyeM, 0.055, 0.07, 0.14, head).castShadow = false;
  }

  // Arms.
  const armL = pivot(body, -0.32, 1.54, 0);
  const armR = pivot(body, 0.32, 1.54, 0);
  for (const arm of [armL, armR]) {
    part(box(0.14, 0.34, 0.14), look.build === 'robe' ? clothM : armorM, 0, -0.17, 0, arm);
    part(box(0.12, 0.3, 0.12), look.build === 'heavy' ? armorM : clothM, 0, -0.47, 0, arm);
    part(box(0.1, 0.1, 0.1), look.build === 'heavy' ? armorM : skinM, 0, -0.66, 0, arm);
  }
  const handR = pivot(armR, 0, -0.66, 0.02);
  handR.rotation.x = Math.PI / 2;
  const handL = pivot(armL, 0, -0.62, 0.06);

  // Legs.
  const legL = pivot(body, -0.12, 0.92, 0);
  const legR = pivot(body, 0.12, 0.92, 0);
  if (look.build !== 'robe') {
    for (const leg of [legL, legR]) {
      part(box(0.17, 0.45, 0.18), clothM, 0, -0.22, 0, leg);
      part(box(0.15, 0.42, 0.16), look.build === 'heavy' ? armorM : mat(0x2a2018, { rough: 0.9 }), 0, -0.64, 0.01, leg);
      part(box(0.16, 0.08, 0.26), mat(0x1e1814, { rough: 0.9 }), 0, -0.88, 0.04, leg);
    }
  }

  const rig: Rig = { root, body, head, armL, armR, legL, legR, handR, handL, height: 1.85 };

  if (look.cape !== undefined) {
    const capeGeo = new THREE.PlaneGeometry(0.62, 1.25, 1, 4);
    capeGeo.translate(0, -0.62, 0);
    const cape = new THREE.Mesh(capeGeo, mat(look.cape, { rough: 0.95, side: THREE.DoubleSide }));
    cape.position.set(0, 1.6, -0.16);
    cape.castShadow = true;
    cape.userData.keep = true;
    body.add(cape);
    rig.cape = cape;
  }
  if (look.tail) {
    const tail = pivot(body, 0, 0.95, -0.14);
    part(cone(0.08, 0.9, 6), mat(look.skin, { rough: 0.6 }), 0, 0, -0.42, tail).rotation.x = -Math.PI / 2 - 0.4;
    rig.tail = tail;
  }
  if (look.wings) {
    const wings = pivot(body, 0, 1.45, -0.16);
    const wingM = mat(0x3a2a24, { rough: 0.7, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const w = pivot(wings, 0, 0, 0);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, side * 1.3, 0.5, -0.1, side * 1.1, -0.6, -0.1, 0, 0, 0, side * 1.1, -0.6, -0.1, side * 0.3, -0.7, 0], 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, wingM);
      m.castShadow = true;
      w.add(m);
      w.userData.side = side;
    }
    rig.wings = wings;
  }
  root.scale.setScalar(look.scale ?? 1);
  return rig;
}

export interface AnimState {
  /** Walk cycle phase, radians. */
  phase: number;
  /** 0..1 how much the legs swing. */
  moving: number;
  /** -1 when not attacking, else 0..1 progress. */
  attack: number;
  attackStyle: 'slash' | 'overhead' | 'thrust' | 'spin' | 'cast' | 'bow' | 'throw';
  /** Bow draw 0..1 while aiming. */
  draw: number;
  blocking: boolean;
  rolling: number;
  airborne: boolean;
  flying: boolean;
  swimming: boolean;
  crouching: boolean;
  dead: number;
  t: number;
}

export const newAnim = (): AnimState => ({
  phase: 0, moving: 0, attack: -1, attackStyle: 'slash', draw: 0, blocking: false, rolling: -1, airborne: false, flying: false, swimming: false, crouching: false, dead: -1, t: 0,
});

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function animateHumanoid(rig: Rig, a: AnimState): void {
  const swing = Math.sin(a.phase) * 0.7 * a.moving;
  rig.legL.rotation.x = swing;
  rig.legR.rotation.x = -swing;
  rig.armL.rotation.set(-swing * 0.6, 0, 0.05);
  rig.armR.rotation.set(swing * 0.6, 0, -0.05);
  rig.body.rotation.set(0, 0, 0);
  rig.body.position.set(0, Math.abs(Math.cos(a.phase)) * 0.06 * a.moving, 0);
  rig.head.rotation.set(0, 0, 0);

  if (a.crouching) {
    rig.body.position.y -= 0.3;
    rig.body.rotation.x = 0.35;
    rig.legL.rotation.x += -0.6;
    rig.legR.rotation.x += -0.6;
  }
  if (a.swimming) {
    rig.body.rotation.x = 1.2;
    rig.body.position.y = 0.6;
    rig.armL.rotation.x = -2.5 + Math.sin(a.t * 4) * 0.8;
    rig.armR.rotation.x = -2.5 - Math.sin(a.t * 4) * 0.8;
  }
  if (a.airborne && !a.flying && !a.swimming) {
    rig.legL.rotation.x = -0.6;
    rig.legR.rotation.x = 0.3;
  }
  if (a.flying) {
    rig.body.rotation.x = 0.5 * a.moving;
    rig.legL.rotation.x = 0.4;
    rig.legR.rotation.x = 0.5;
  }
  if (a.blocking) {
    rig.armL.rotation.set(-1.35, 0.6, 0.2);
  }
  if (a.draw > 0 || a.attackStyle === 'bow' && a.attack >= 0) {
    // Bow in the left hand, string hand pulling back.
    const d = a.attack >= 0 ? 1 - a.attack : a.draw;
    rig.body.rotation.y = 0.35;
    rig.armL.rotation.set(-Math.PI / 2, 0.35, 0);
    rig.armR.rotation.set(-Math.PI / 2 + 0.1, -0.2 - 0.9 * d, 0);
    rig.head.rotation.y = -0.35;
  }

  if (a.attack >= 0) {
    const p = a.attack;
    switch (a.attackStyle) {
      case 'slash': {
        const k = p < 0.35 ? ease(p / 0.35) : 1 - ease((p - 0.35) / 0.65) * 0.1;
        const s = p < 0.35 ? -ease(p / 0.35) : -1 + 2 * ease(Math.min(1, (p - 0.35) / 0.35));
        rig.armR.rotation.set(-1.4 - 0.5 * k, 0, -0.9 * (1 - k * 0.2));
        rig.body.rotation.y = -s * 0.9;
        break;
      }
      case 'overhead': {
        const up = p < 0.45 ? ease(p / 0.45) : 1 - ease(Math.min(1, (p - 0.45) / 0.25));
        rig.armR.rotation.set(-0.4 - 2.4 * up, 0, -0.1);
        rig.armL.rotation.set(-0.4 - 2.2 * up, 0, 0.1);
        rig.body.rotation.x = 0.35 * (1 - up);
        break;
      }
      case 'thrust': {
        const k = p < 0.4 ? -ease(p / 0.4) * 0.6 : ease(Math.min(1, (p - 0.4) / 0.3));
        rig.armR.rotation.set(-1.5, 0, 0);
        rig.armR.position.z = 0.35 * k;
        rig.body.rotation.x = 0.2 * k;
        break;
      }
      case 'spin':
        rig.armR.rotation.set(-1.5, 0, -1.2);
        rig.armL.rotation.set(-1.2, 0, 1.2);
        rig.body.rotation.y = -p * Math.PI * 2;
        break;
      case 'cast': {
        const k = Math.sin(p * Math.PI);
        rig.armR.rotation.set(-1.2 - 0.8 * k, 0, -0.2);
        rig.armL.rotation.set(-1.2 - 0.8 * k, 0, 0.2);
        break;
      }
      case 'throw': {
        const k = p < 0.5 ? ease(p / 0.5) : 1 - ease((p - 0.5) / 0.5);
        rig.armR.rotation.set(-2.8 * k + (p > 0.5 ? -1.4 * (1 - k) : 0), 0, -0.1);
        break;
      }
      case 'bow':
        break;
    }
  }
  if (a.attackStyle !== 'thrust' || a.attack < 0) rig.armR.position.z = 0;

  if (a.rolling >= 0) {
    rig.body.rotation.x = a.rolling * Math.PI * 2;
    rig.body.position.y = 0.6 - Math.sin(a.rolling * Math.PI) * 0.3;
    rig.legL.rotation.x = rig.legR.rotation.x = -1.5;
  }
  if (rig.cape) rig.cape.rotation.x = 0.15 + 0.5 * a.moving + (a.airborne ? 0.6 : 0) + Math.sin(a.t * 3) * 0.04;
  if (rig.tail) rig.tail.rotation.y = Math.sin(a.t * 2 + a.phase) * 0.4;
  if (rig.wings) {
    rig.wings.visible = rig.wings.userData.enabled !== false;
    const flap = a.flying ? Math.sin(a.t * 12) * 0.7 : 0.15;
    for (const w of rig.wings.children) w.rotation.y = (w.userData.side as number) * (flap - 0.2);
  }
  if (a.dead >= 0) {
    rig.body.rotation.x = -Math.min(1, a.dead * 2) * Math.PI / 2;
    rig.body.position.y = 0.2 * Math.min(1, a.dead * 2);
  }
}

// ------------------------------------------------------------- creatures --

export interface CreatureRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  legs: THREE.Group[];
  extra: THREE.Object3D[];
  kind: string;
  height: number;
}

export function buildQuad(color: number, kind: 'wolf' | 'boar' | 'hound' | 'stag' | 'drake', scale = 1): CreatureRig {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const furM = mat(color, { rough: 0.95 });
  const dark = mat(0x111111, { rough: 0.8 });
  const isBoar = kind === 'boar';
  const legH = kind === 'stag' ? 1.1 : kind === 'drake' ? 0.7 : 0.6;
  const bodyLen = kind === 'stag' ? 1.6 : kind === 'drake' ? 2 : 1.25;
  part(box(isBoar ? 0.75 : 0.55, isBoar ? 0.6 : 0.5, bodyLen), furM, 0, legH + 0.25, 0, body);
  const head = pivot(body, 0, legH + 0.4, bodyLen / 2);
  part(box(0.34, 0.32, 0.42), furM, 0, 0, 0.12, head);
  part(box(0.22, 0.18, 0.3), furM, 0, -0.06, 0.42, head);
  const extra: THREE.Object3D[] = [];
  if (kind === 'wolf' || kind === 'hound') {
    part(cone(0.06, 0.16, 4), furM, -0.1, 0.22, 0.05, head);
    part(cone(0.06, 0.16, 4), furM, 0.1, 0.22, 0.05, head);
    const tail = part(cyl(0.04, 0.08, 0.6, 5), furM, 0, legH + 0.35, -bodyLen / 2 - 0.25, body);
    tail.rotation.x = -0.9;
    extra.push(tail);
  }
  if (kind === 'hound') {
    const lava = mat(0xff5a1a, { emissive: 0xff4010, emissiveIntensity: 2 });
    for (let i = 0; i < 4; i++) part(box(0.57, 0.04, 0.05), lava, 0, legH + 0.25 + (i % 2) * 0.12, -0.4 + i * 0.25, body).castShadow = false;
    part(sphere(0.04), lava, -0.1, 0.05, 0.33, head);
    part(sphere(0.04), lava, 0.1, 0.05, 0.33, head);
  } else {
    part(sphere(0.03), mat(0xffd070, { emissive: 0x806020 }), -0.1, 0.06, 0.33, head);
    part(sphere(0.03), mat(0xffd070, { emissive: 0x806020 }), 0.1, 0.06, 0.33, head);
  }
  if (isBoar) {
    part(cone(0.03, 0.18, 4), mat(0xe8e0c8), -0.1, -0.1, 0.55, head).rotation.x = -1.1;
    part(cone(0.03, 0.18, 4), mat(0xe8e0c8), 0.1, -0.1, 0.55, head).rotation.x = -1.1;
  }
  if (kind === 'stag') {
    const antler = mat(0xcfc3a0, { rough: 0.6 });
    for (const s of [-1, 1]) {
      const a = pivot(head, s * 0.12, 0.2, 0.05);
      part(cyl(0.025, 0.04, 0.7, 5), antler, 0, 0.35, 0, a).rotation.z = -s * 0.5;
      part(cyl(0.02, 0.03, 0.4, 5), antler, s * 0.25, 0.6, 0.05, a).rotation.z = -s * 1.1;
      part(cyl(0.02, 0.03, 0.4, 5), antler, s * 0.15, 0.75, -0.05, a).rotation.z = s * 0.2;
      part(cyl(0.02, 0.03, 0.35, 5), antler, s * 0.38, 0.8, 0.0, a).rotation.z = -s * 0.4;
    }
    const glow = mat(0x9fffd0, { emissive: 0x40ffa0, emissiveIntensity: 2.5 });
    part(sphere(0.045), glow, -0.12, 0.05, 0.33, head);
    part(sphere(0.045), glow, 0.12, 0.05, 0.33, head);
  }
  if (kind === 'drake') {
    head.position.y += 0.4;
    part(cone(0.05, 0.3, 4), dark, -0.1, 0.24, -0.05, head).rotation.x = -0.6;
    part(cone(0.05, 0.3, 4), dark, 0.1, 0.24, -0.05, head).rotation.x = -0.6;
    const tail = part(cone(0.18, 1.6, 6), furM, 0, legH + 0.25, -bodyLen / 2 - 0.7, body);
    tail.rotation.x = -Math.PI / 2;
    const wingM = mat(0x2a1a16, { side: THREE.DoubleSide, rough: 0.7 });
    for (const s of [-1, 1]) {
      const w = pivot(body, s * 0.3, legH + 0.5, 0.2);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, s * 2, 0.6, -0.4, s * 1.6, 0, -1.2, 0, 0, 0, s * 1.6, 0, -1.2, 0, 0, -0.8], 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, wingM);
      m.castShadow = true;
      w.add(m);
      w.userData.side = s;
      extra.push(w);
    }
  }
  const legs: THREE.Group[] = [];
  for (const [x, z] of [[-0.2, bodyLen / 2 - 0.15], [0.2, bodyLen / 2 - 0.15], [-0.2, -bodyLen / 2 + 0.15], [0.2, -bodyLen / 2 + 0.15]]) {
    const leg = pivot(body, x, legH + 0.1, z);
    part(box(0.12, legH + 0.1, 0.14), furM, 0, -(legH + 0.1) / 2, 0, leg);
    legs.push(leg);
  }
  root.scale.setScalar(scale);
  extra.forEach((e) => (e.userData.keep = true));
  return { root, body, head, legs, extra, kind, height: (legH + 0.7) * scale };
}

export function buildInsect(color: number, scale = 1): CreatureRig {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const shell = mat(color, { rough: 0.4, metal: 0.2 });
  part(box(0.8, 0.35, 1.0), shell, 0, 0.45, 0, body);
  const head = pivot(body, 0, 0.45, 0.55);
  part(box(0.5, 0.25, 0.3), shell, 0, 0, 0, head);
  for (const s of [-1, 1]) {
    const claw = pivot(head, s * 0.35, 0, 0.15);
    part(box(0.12, 0.12, 0.5), shell, 0, 0, 0.25, claw);
    part(box(0.2, 0.14, 0.25), shell, 0, 0, 0.55, claw);
  }
  // Segmented tail curling over the back with a stinger.
  const tail = pivot(body, 0, 0.55, -0.5);
  let seg: THREE.Object3D = tail;
  for (let i = 0; i < 5; i++) {
    const s = pivot(seg, 0, 0, i === 0 ? 0 : -0.24);
    s.rotation.x = -0.45;
    part(box(0.18 - i * 0.02, 0.16, 0.26), shell, 0, 0, -0.12, s);
    seg = s;
  }
  part(cone(0.06, 0.25, 5), mat(0x1a1410, { rough: 0.3 }), 0, 0, -0.35, seg).rotation.x = -Math.PI / 2 - 0.6;
  const legs: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const s = i % 2 ? 1 : -1;
    const leg = pivot(body, s * 0.4, 0.4, 0.3 - Math.floor(i / 2) * 0.3);
    part(box(0.5, 0.06, 0.06), shell, s * 0.25, -0.15, 0, leg).rotation.z = s * -0.6;
    legs.push(leg);
  }
  root.scale.setScalar(scale);
  return { root, body, head, legs, extra: [tail], kind: 'insect', height: 0.9 * scale };
}

export function buildFloater(color: number, kind: 'wraith' | 'eye' | 'witch', scale = 1): CreatureRig {
  const root = new THREE.Group();
  const body = pivot(root, 0, 1.0, 0);
  const head = pivot(body, 0, 0.9, 0);
  const extra: THREE.Object3D[] = [];
  if (kind === 'eye') {
    part(sphere(0.6, 16, 12), mat(0xe8dcc8, { rough: 0.3 }), 0, 0, 0, head);
    const iris = part(sphere(0.32, 12, 8), mat(0xa01010, { emissive: 0xff2020, emissiveIntensity: 1.5 }), 0, 0, 0.36, head);
    iris.scale.z = 0.5;
    part(sphere(0.14, 8, 6), mat(0x050505), 0, 0, 0.48, head).scale.z = 0.4;
    for (let i = 0; i < 6; i++) {
      const t = part(cone(0.08, 1.2, 5), mat(color, { rough: 0.9 }), Math.cos(i) * 0.35, -0.2, Math.sin(i) * 0.35 - 0.2, body);
      t.rotation.set(Math.PI + Math.sin(i) * 0.4, 0, Math.cos(i) * 0.4);
      extra.push(t);
    }
  } else {
    const robe = mat(color, { rough: 0.95, transparent: kind === 'wraith' ? 0.85 : undefined });
    part(cone(0.55, 1.8, 10, ), robe, 0, -0.1, 0, body).rotation.x = Math.PI;
    part(box(0.6, 0.5, 0.35), robe, 0, 0.55, 0, body);
    part(cone(0.3, 0.6, 8), robe, 0, 0.15, -0.02, head);
    const eyeColor = kind === 'witch' ? 0xb070ff : 0x80b0ff;
    const eyeM = mat(eyeColor, { emissive: eyeColor, emissiveIntensity: 3 });
    part(sphere(0.04, 6, 4), eyeM, -0.08, 0.0, 0.2, head).castShadow = false;
    part(sphere(0.04, 6, 4), eyeM, 0.08, 0.0, 0.2, head).castShadow = false;
    for (const s of [-1, 1]) {
      const arm = pivot(body, s * 0.38, 0.65, 0);
      part(cone(0.12, 0.9, 6), robe, 0, -0.4, 0.1, arm).rotation.x = Math.PI - 0.3;
      extra.push(arm);
    }
    if (kind === 'witch') {
      // Three faces: maiden, mother, crone.
      for (const [i, c] of [[-1, 0xe8e0d0], [1, 0x8a8070]] as const) {
        const face = part(sphere(0.13, 8, 6), mat(c, { rough: 0.4 }), i * 0.24, 0.0, 0.05, head);
        face.rotation.y = i * 1.2;
      }
      part(sphere(0.14, 8, 6), mat(0xb8b0a0, { rough: 0.4 }), 0, 0.0, 0.12, head);
      const staff = buildWeapon('staff', true);
      staff.position.set(0.5, -0.6, 0.2);
      body.add(staff);
    }
  }
  root.scale.setScalar(scale);
  extra.forEach((e) => (e.userData.keep = true));
  return { root, body, head, legs: [], extra, kind, height: 2.2 * scale };
}

export function buildImp(color: number, scale = 1): CreatureRig {
  const rig = buildHumanoid({ skin: color, armor: color, cloth: 0x2a1410, accent: 0xff6a20, build: 'light', head: 'bare', horns: true, tail: true, glowEyes: 0xffa020, scale: 0.7 * scale });
  return { root: rig.root, body: rig.body, head: rig.head, legs: [rig.legL, rig.legR], extra: [rig.armL, rig.armR], kind: 'imp', height: 1.3 * scale };
}

export function animateCreature(rig: CreatureRig, a: AnimState): void {
  const k = a.moving;
  rig.legs.forEach((leg, i) => {
    leg.rotation.x = Math.sin(a.phase + (i % 2 ? Math.PI : 0) + (i >= 2 ? Math.PI / 2 : 0)) * 0.6 * k;
  });
  rig.body.rotation.set(0, 0, 0);
  rig.head.rotation.set(0, 0, 0);
  if (rig.kind === 'wraith' || rig.kind === 'eye' || rig.kind === 'witch') {
    rig.body.position.y = 1.0 + Math.sin(a.t * 2) * 0.15;
    rig.extra.forEach((e, i) => (e.rotation.z = Math.sin(a.t * 3 + i) * 0.2));
  }
  if (rig.kind === 'drake') {
    for (const w of rig.extra) w.rotation.z = (w.userData.side as number) * Math.sin(a.t * (a.flying ? 10 : 1.5)) * (a.flying ? 0.6 : 0.1);
  }
  if (a.attack >= 0) {
    const p = Math.sin(a.attack * Math.PI);
    if (rig.kind === 'insect') rig.extra[0].rotation.x = -0.8 * p;
    else if (rig.kind === 'imp') (rig.extra[1] as THREE.Object3D).rotation.x = -2.5 * p;
    else if (rig.kind === 'wraith' || rig.kind === 'witch') rig.extra.forEach((e) => (e.rotation.x = -1.6 * p));
    else {
      rig.body.rotation.x = -0.25 * p;
      rig.head.rotation.x = 0.5 * p;
      rig.body.position.z = 0.3 * p;
    }
  } else rig.body.position.z = 0;
  if (a.dead >= 0) {
    rig.body.rotation.z = Math.min(1, a.dead * 2) * Math.PI / 2;
    if (rig.kind === 'wraith' || rig.kind === 'eye' || rig.kind === 'witch') rig.body.position.y = 1 - Math.min(1, a.dead) * 1.0;
  }
}

// ----------------------------------------------------------------- bosses --

export function buildCrab(color: number, scale: number): CreatureRig {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const shell = mat(color, { rough: 0.35, metal: 0.3 });
  const barnacle = mat(0x8a9a8a, { rough: 0.9 });
  part(sphere(1.1, 14, 10), shell, 0, 1.2, 0, body).scale.set(1.3, 0.55, 1);
  for (let i = 0; i < 12; i++) part(cone(0.1, 0.3, 5), barnacle, Math.cos(i * 1.7) * 0.9, 1.6, Math.sin(i * 1.7) * 0.6, body);
  const head = pivot(body, 0, 1.4, 0.9);
  const eyeM = mat(0x60ffe0, { emissive: 0x20ffd0, emissiveIntensity: 2.5 });
  for (const s of [-1, 1]) {
    part(cyl(0.04, 0.05, 0.5, 5), shell, s * 0.3, 0.25, 0, head);
    part(sphere(0.09), eyeM, s * 0.3, 0.52, 0, head);
  }
  const extra: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const claw = pivot(body, s * 1.2, 1.2, 0.7);
    part(box(0.3, 0.3, 1.0), shell, 0, 0, 0.4, claw);
    part(box(0.55, 0.45, 0.7), shell, 0, 0.1, 1.1, claw);
    part(box(0.2, 0.2, 0.6), shell, s * -0.15, -0.2, 1.35, claw);
    extra.push(claw);
  }
  const legs: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const s = i % 2 ? 1 : -1;
    const leg = pivot(body, s * 1.1, 1.0, 0.3 - Math.floor(i / 2) * 0.45);
    part(box(1.2, 0.14, 0.14), shell, s * 0.6, -0.4, 0, leg).rotation.z = s * -0.7;
    legs.push(leg);
  }
  root.scale.setScalar(scale);
  return { root, body, head, legs, extra, kind: 'crab', height: 2 * scale };
}

export function buildBossHumanoid(model: 'colossus' | 'golem' | 'champion', color: number, scale: number): Rig {
  let rig: Rig;
  if (model === 'colossus') {
    rig = buildHumanoid({ skin: 0x9a8a6a, armor: color, cloth: 0x6a5a40, accent: 0x40a0ff, build: 'heavy', head: 'helmet', glowEyes: 0x60c0ff, cape: 0x5a4a30, scale });
    const glow = mat(0x8fd0ff, { emissive: 0x40a0ff, emissiveIntensity: 2 });
    part(sphere(0.12), glow, 0, 1.35, 0.16, rig.body).castShadow = false;
  } else if (model === 'golem') {
    rig = buildHumanoid({ skin: color, armor: color, cloth: 0x1a1210, accent: 0xff5010, build: 'heavy', head: 'helmet', glowEyes: 0xff6010, scale });
    const lava = mat(0xff6a20, { emissive: 0xff4010, emissiveIntensity: 2.5 });
    for (let i = 0; i < 8; i++) part(box(0.5, 0.03, 0.02), lava, 0, 1.05 + i * 0.07, 0.145, rig.body).rotation.z = Math.sin(i * 2.3) * 0.5;
    part(box(0.28, 0.03, 0.3), lava, 0, 1.6, 0, rig.body);
  } else {
    rig = buildHumanoid({ skin: 0xb08a6a, armor: 0x8a5a2a, cloth: color, accent: 0xd8b060, build: 'heavy', head: 'plume', cape: 0x7a1410, scale });
  }
  return rig;
}

// ------------------------------------------------------------------ props --

export function buildBoat(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(0x5a3e24, { rough: 0.85 });
  part(box(1.6, 0.4, 4), wood, 0, 0.2, 0, g);
  part(box(1.8, 0.5, 0.15), wood, 0, 0.45, 1.95, g);
  part(box(1.8, 0.5, 0.15), wood, 0, 0.45, -1.95, g);
  part(box(0.15, 0.5, 4), wood, -0.85, 0.45, 0, g);
  part(box(0.15, 0.5, 4), wood, 0.85, 0.45, 0, g);
  part(cyl(0.06, 0.06, 3.2), wood, 0, 1.8, 0.5, g);
  const sail = part(new THREE.PlaneGeometry(1.6, 2.2), mat(0xc8b890, { side: THREE.DoubleSide, rough: 1 }), 0, 2.2, 0.55, g);
  sail.rotation.y = Math.PI / 2;
  return g;
}
