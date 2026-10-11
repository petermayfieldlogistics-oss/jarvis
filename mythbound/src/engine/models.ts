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

/** A flat blade outline (x across, y along) extruded thin with bevelled edges that catch the light. */
function bladeGeo(outline: [number, number][], thick: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  outline.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const bevel = Math.min(thick * 0.9, 0.012);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
  geo.translate(0, 0, -thick / 2);
  geo.computeVertexNormals();
  return geo;
}

/** A straight blade from y0 to y1 with a pointed tip. */
const straightBlade = (w: number, y0: number, y1: number, tip: number, thick: number) =>
  bladeGeo([[-w / 2, y0], [w / 2, y0], [w * 0.42, y1 - tip], [0, y1], [-w * 0.42, y1 - tip]], thick);

export function buildWeapon(kind: WeaponKind, legendary = false): THREE.Group {
  const g = new THREE.Group();
  // Brushed rather than mirror-like: the scene has no reflections, so very
  // metallic surfaces would render almost black.
  const steel = mat(legendary ? 0xe0c886 : 0xc4c8cc, { rough: 0.38, metal: 0.45 });
  const darkSteel = mat(0x6a6e74, { rough: 0.5, metal: 0.4 });
  const brass = mat(0xb8944a, { rough: 0.4, metal: 0.5 });
  const grip = mat(0x3a2a1c, { rough: 0.9 });
  const wrap = mat(0x5a3a22, { rough: 0.95 });
  const glow = legendary ? mat(0xffd27a, { emissive: 0xffb040, emissiveIntensity: 1.6 }) : steel;
  switch (kind) {
    case 'sword': {
      part(cyl(0.022, 0.026, 0.2, 8), wrap, 0, 0.0, 0, g);
      part(sphere(0.04, 8, 6), brass, 0, -0.12, 0, g);
      part(box(0.3, 0.035, 0.06), brass, 0, 0.115, 0, g);
      for (const x of [-0.15, 0.15]) part(sphere(0.03, 6, 5), brass, x, 0.115, 0, g);
      part(straightBlade(0.075, 0.13, 1.22, 0.16, 0.016), legendary ? glow : steel, 0, 0, 0, g);
      // Fuller: a darker groove down the middle of the blade.
      part(box(0.018, 0.75, 0.021), darkSteel, 0, 0.55, 0, g);
      break;
    }
    case 'dagger':
      part(cyl(0.018, 0.022, 0.13, 8), wrap, 0, 0, 0, g);
      part(sphere(0.026, 6, 5), brass, 0, -0.08, 0, g);
      part(box(0.15, 0.025, 0.045), brass, 0, 0.075, 0, g);
      part(straightBlade(0.05, 0.085, 0.5, 0.1, 0.012), steel, 0, 0, 0, g);
      break;
    case 'axe': {
      part(cyl(0.026, 0.032, 1.02, 8), grip, 0, 0.4, 0, g);
      part(cyl(0.032, 0.032, 0.16, 8), wrap, 0, -0.02, 0, g);
      // Bearded head: a broad curved edge in front, a short spike behind.
      const head = bladeGeo([[0.02, 0.66], [0.2, 0.6], [0.3, 0.68], [0.33, 0.8], [0.3, 0.94], [0.2, 0.98], [0.02, 0.9]], 0.035);
      head.rotateY(-Math.PI / 2);
      part(head, legendary ? glow : steel, 0, 0, 0, g);
      part(box(0.05, 0.13, 0.08), darkSteel, 0, 0.8, 0, g);
      part(cone(0.03, 0.12, 6), darkSteel, 0, 0.8, -0.09, g).rotation.x = -Math.PI / 2;
      break;
    }
    case 'hammer':
      part(cyl(0.03, 0.038, 1.12, 8), grip, 0, 0.45, 0, g);
      part(cyl(0.04, 0.04, 0.18, 8), wrap, 0, -0.04, 0, g);
      part(box(0.24, 0.22, 0.4), mat(0x3a3634, { rough: 0.45, metal: 0.35 }), 0, 0.98, 0, g);
      for (const z of [-0.205, 0.205]) part(box(0.26, 0.24, 0.02), darkSteel, 0, 0.98, z, g);
      part(box(0.25, 0.05, 0.41), legendary ? glow : brass, 0, 0.98, 0, g);
      break;
    case 'staff': {
      part(cyl(0.03, 0.04, 1.7), mat(legendary ? 0x221830 : 0x5a3e22, { rough: 0.8 }), 0, 0.5, 0, g);
      const orb = part(sphere(0.1), mat(legendary ? 0xb080ff : 0x80c0ff, { emissive: legendary ? 0x8040ff : 0x3080ff, emissiveIntensity: 2 }), 0, 1.42, 0, g);
      orb.castShadow = false;
      for (let i = 0; i < 3; i++) part(cone(0.025, 0.26), legendary ? mat(0x221830) : brass, Math.cos(i * 2.1) * 0.1, 1.42, Math.sin(i * 2.1) * 0.1, g).rotation.set(Math.sin(i * 2.1) * 0.5, 0, -Math.cos(i * 2.1) * 0.5);
      break;
    }
    case 'trident':
      part(cyl(0.03, 0.03, 1.9), mat(0x2a6a7a, { rough: 0.35, metal: 0.4 }), 0, 0.6, 0, g);
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
      const wood = legendary ? mat(0xe8e4d8, { emissive: 0xa0b0ff, emissiveIntensity: 0.6 }) : mat(0x6a4426, { rough: 0.75 });
      for (const s of [-1, 1]) part(box(0.035, 0.75, 0.045), wood, 0, s * 0.36, -0.08, g).rotation.x = -s * 0.3;
      part(box(0.05, 0.18, 0.06), wrap, 0, 0, 0, g);
      // The string is two segments meeting at the nock, so it can be drawn back.
      const stringMat = mat(0xe8e2d0, { rough: 0.9 });
      const seg = () => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 1, 3).translate(0, 0.5, 0), stringMat);
        m.userData.keep = true;
        g.add(m);
        return m;
      };
      const top = seg(), bottom = seg();
      // An arrow on the string while drawing.
      const arrow = new THREE.Group();
      arrow.userData.keep = true;
      part(cyl(0.008, 0.008, 0.78, 4), mat(0x8a6a40, { rough: 0.8 }), 0, 0.39, 0, arrow);
      part(cone(0.02, 0.07, 4), steel, 0, 0.8, 0, arrow);
      for (let i = 0; i < 3; i++) part(box(0.002, 0.08, 0.03), mat(0xd8d0c0), 0, 0.06, 0, arrow).rotation.y = (i * Math.PI * 2) / 3;
      arrow.visible = false;
      g.add(arrow);
      g.userData.bow = { top, bottom, arrow, tipTop: new THREE.Vector3(0, 0.718, -0.191), tipBottom: new THREE.Vector3(0, -0.718, -0.191) };
      setBowString(g, new THREE.Vector3(0, 0, -0.191), false);
      g.rotation.x = Math.PI / 2;
      break;
    }
  }
  return g;
}

const _seg = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
/** Points a unit-length string segment from `a` to `b`. */
function aimSegment(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  _seg.subVectors(b, a);
  const len = _seg.length();
  m.position.copy(a);
  m.scale.set(1, Math.max(1e-3, len), 1);
  m.quaternion.setFromUnitVectors(_up, _seg.multiplyScalar(1 / Math.max(1e-6, len)));
}

/**
 * Bends a bow's string to the nock point (bow-local coordinates) and shows
 * or hides the nocked arrow, which points from the nock out past the grip.
 */
export function setBowString(bow: THREE.Object3D, nock: THREE.Vector3, arrow: boolean) {
  const b = bow.userData.bow as { top: THREE.Mesh; bottom: THREE.Mesh; arrow: THREE.Object3D; tipTop: THREE.Vector3; tipBottom: THREE.Vector3 } | undefined;
  if (!b) return;
  aimSegment(b.top, nock, b.tipTop);
  aimSegment(b.bottom, nock, b.tipBottom);
  b.arrow.visible = arrow;
  if (arrow) {
    b.arrow.position.copy(nock);
    b.arrow.quaternion.setFromUnitVectors(_up, _seg.set(-nock.x, -nock.y, 0.25 - nock.z).normalize());
  }
}

export function buildShield(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(0x5a3e26, { rough: 0.85 });
  const iron = mat(0x8c8a84, { rough: 0.45, metal: 0.4 });
  part(cyl(0.38, 0.38, 0.05, 16), wood, 0, 0, 0, g).rotation.x = Math.PI / 2;
  // Painted field and an iron rim.
  part(cyl(0.34, 0.34, 0.052, 16), mat(0x6a1e18, { rough: 0.8 }), 0, 0, 0.002, g).rotation.x = Math.PI / 2;
  const rim = part(new THREE.TorusGeometry(0.385, 0.022, 6, 24), iron, 0, 0, 0, g);
  rim.rotation.z = 0;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    part(sphere(0.018, 5, 4), iron, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.03, g);
  }
  part(sphere(0.085, 10, 8), mat(0xb8944a, { rough: 0.35, metal: 0.5 }), 0, 0, 0.04, g).scale.z = 0.7;
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
