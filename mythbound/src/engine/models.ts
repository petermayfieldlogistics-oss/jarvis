// Shared model helpers: materials, primitives, compaction, glow sprites,
// weapons and props. Characters live in humanoid.ts and creatures.ts.

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

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
export const sphere = (r: number, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
export const cone = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg);

export function part(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, parent?: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent?.add(m);
  return m;
}

export function pivot(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
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
