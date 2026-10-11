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
  // The animator reads this to carry the weapon the right way.
  g.userData.kind = kind;
  const PI = Math.PI;
  // Brushed rather than mirror-like: the scene has no reflections, so very
  // metallic surfaces would render almost black.
  const steel = mat(legendary ? 0xe0c886 : 0xc4c8cc, { rough: 0.38, metal: 0.45 });
  const darkSteel = mat(0x6a6e74, { rough: 0.5, metal: 0.4 });
  const brass = mat(0xb8944a, { rough: 0.4, metal: 0.5 });
  const grip = mat(0x3a2a1c, { rough: 0.9 });
  const wrap = mat(0x5a3a22, { rough: 0.95 });
  const glow = legendary ? mat(0xffd27a, { emissive: 0xffb040, emissiveIntensity: 1.6 }) : steel;
  const gem = legendary ? mat(0x9ad8ff, { rough: 0.2, emissive: 0x3aa0ff, emissiveIntensity: 1.5 }) : mat(0x9a1824, { rough: 0.25, metal: 0.3 });
  /** Cord bound round a grip of radius r. */
  const cord = (r: number, ys: number[], m = grip) => ys.forEach((y) => part(cyl(r, r, 0.011, 8), m, 0, y, 0, g));
  /** A dark groove down both faces of a blade whose faces sit at +-face. */
  const fuller = (w: number, y0: number, y1: number, face: number) => {
    for (const z of [-1, 1]) part(box(w, y1 - y0, 0.002), darkSteel, 0, (y0 + y1) / 2, z * face, g);
  };
  switch (kind) {
    case 'sword': {
      // Corded grip, wheel pommel set with a stone.
      part(cyl(0.022, 0.026, 0.2, 8), wrap, 0, 0.0, 0, g);
      cord(0.0262, [-0.065, -0.022, 0.022, 0.065]);
      part(cyl(0.03, 0.022, 0.03, 8), brass, 0, -0.112, 0, g);
      part(cyl(0.048, 0.048, 0.032, 12), brass, 0, -0.15, 0, g).rotation.x = PI / 2;
      for (const z of [-1, 1]) part(sphere(0.019, 6, 4), gem, 0, -0.15, z * 0.016, g).scale.z = 0.5;
      // Cross-guard: a block with arms swept toward the blade, ball ends and
      // a pointed langet on each face.
      part(box(0.07, 0.045, 0.07), brass, 0, 0.115, 0, g);
      for (const s of [-1, 1]) {
        part(box(0.13, 0.026, 0.045), brass, s * 0.095, 0.125, 0, g).rotation.z = s * 0.22;
        part(sphere(0.026, 8, 6), brass, s * 0.163, 0.142, 0, g);
        part(bladeGeo([[-0.028, 0], [0.028, 0], [0, 0.075]], 0.004), brass, 0, 0.135, s * 0.023, g);
      }
      part(straightBlade(0.075, 0.13, 1.22, 0.16, 0.016), legendary ? glow : steel, 0, 0, 0, g);
      if (!legendary) fuller(0.016, 0.2, 0.92, 0.0205);
      else {
        // Runes burn down the middle of a legendary blade.
        const rune = mat(0xa83a10, { emissive: 0xff4a00, emissiveIntensity: 1.3 });
        for (let i = 0; i < 6; i++) {
          const y = 0.27 + i * 0.12;
          for (const z of [-1, 1]) {
            part(box(0.011, 0.05, 0.002), rune, 0, y, z * 0.0205, g);
            part(box(0.03, 0.009, 0.002), rune, 0, y + (i % 2 ? 0.014 : -0.014), z * 0.0205, g).rotation.z = i % 2 ? 0.5 : -0.5;
          }
        }
      }
      break;
    }
    case 'dagger': {
      part(cyl(0.018, 0.022, 0.13, 8), wrap, 0, 0, 0, g);
      cord(0.0222, [-0.04, 0, 0.04]);
      // Faceted pommel; quillons swept toward the blade, a stone in the middle.
      part(new THREE.OctahedronGeometry(0.03, 0), brass, 0, -0.088, 0, g).scale.set(1, 1.25, 0.8);
      part(box(0.045, 0.035, 0.05), brass, 0, 0.075, 0, g);
      for (const s of [-1, 1]) {
        part(box(0.07, 0.02, 0.035), brass, s * 0.05, 0.085, 0, g).rotation.z = s * 0.4;
        part(sphere(0.017, 6, 4), brass, s * 0.083, 0.1, 0, g);
        part(sphere(0.011, 6, 4), gem, 0, 0.075, s * 0.026, g).scale.z = 0.5;
      }
      part(straightBlade(0.05, 0.085, 0.5, 0.1, 0.012), legendary ? glow : steel, 0, 0, 0, g);
      fuller(0.01, 0.12, 0.38, 0.0172);
      break;
    }
    case 'axe': {
      part(cyl(0.026, 0.032, 1.02, 8), grip, 0, 0.4, 0, g);
      part(cyl(0.032, 0.032, 0.16, 8), wrap, 0, -0.02, 0, g);
      cord(0.0345, [-0.08, -0.035, 0.01, 0.05]);
      part(cyl(0.036, 0.03, 0.04, 8), darkSteel, 0, -0.12, 0, g);
      // Bearded head: a broad curved edge in front, a spike behind. The
      // forge-dark middle is thicker than the polished edge.
      const head = bladeGeo([[0.02, 0.66], [0.2, 0.6], [0.3, 0.68], [0.33, 0.8], [0.3, 0.94], [0.2, 0.98], [0.02, 0.9]], 0.035);
      head.rotateY(-PI / 2);
      part(head, legendary ? glow : steel, 0, 0, 0, g);
      const cheek = bladeGeo([[0.02, 0.68], [0.13, 0.655], [0.17, 0.8], [0.13, 0.935], [0.02, 0.89]], 0.05);
      cheek.rotateY(-PI / 2);
      part(cheek, darkSteel, 0, 0, 0, g);
      part(box(0.075, 0.16, 0.085), darkSteel, 0, 0.8, 0, g);
      for (const x of [-1, 1]) for (const y of [0.75, 0.85]) part(sphere(0.012, 5, 4), brass, x * 0.04, y, 0.0, g);
      // Langets down the haft and a cap on top.
      for (const x of [-1, 1]) part(box(0.012, 0.2, 0.03), darkSteel, x * 0.029, 0.63, 0, g);
      part(cone(0.032, 0.07, 6), darkSteel, 0, 0.93, 0, g);
      part(cone(0.03, 0.16, 6), darkSteel, 0, 0.8, -0.115, g).rotation.x = -PI / 2;
      break;
    }
    case 'hammer': {
      part(cyl(0.03, 0.038, 1.12, 8), grip, 0, 0.45, 0, g);
      part(cyl(0.04, 0.04, 0.18, 8), wrap, 0, -0.04, 0, g);
      cord(0.0425, [-0.1, -0.055, -0.01, 0.035]);
      part(sphere(0.045, 8, 6), brass, 0, -0.16, 0, g);
      for (const y of [0.3, 0.62]) part(cyl(0.042, 0.042, 0.03, 8), darkSteel, 0, y, 0, g);
      // Iron-bound head with stepped striking faces, rivets and a top spike.
      part(box(0.24, 0.22, 0.4), mat(0x3a3634, { rough: 0.45, metal: 0.35 }), 0, 0.98, 0, g);
      for (const z of [-1, 1]) {
        part(box(0.26, 0.24, 0.02), darkSteel, 0, 0.98, z * 0.205, g);
        part(box(0.2, 0.18, 0.04), darkSteel, 0, 0.98, z * 0.23, g);
      }
      part(box(0.25, 0.05, 0.41), legendary ? glow : brass, 0, 0.98, 0, g);
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) part(sphere(0.016, 5, 4), brass, x * 0.122, 0.98 + y * 0.075, z * 0.13, g);
      part(cone(0.05, 0.14, 6), darkSteel, 0, 1.16, 0, g);
      for (const x of [-1, 1]) part(box(0.012, 0.26, 0.035), darkSteel, x * 0.036, 0.78, 0, g);
      break;
    }
    case 'staff': {
      const wood = mat(legendary ? 0x221830 : 0x5a3e22, { rough: 0.8 });
      const metal = legendary ? mat(0x221830) : brass;
      part(cyl(0.03, 0.04, 1.7), wood, 0, 0.5, 0, g);
      // Bands down the shaft, a ferrule at the foot, a collar under the head.
      for (const [y, r] of [[0.05, 0.044], [0.6, 0.041], [1.1, 0.038]]) part(cyl(r, r, 0.035, 8), metal, 0, y, 0, g);
      part(cone(0.04, 0.1, 8), metal, 0, -0.39, 0, g).rotation.x = PI;
      part(cyl(0.045, 0.032, 0.09, 8), metal, 0, 1.3, 0, g);
      const orb = part(sphere(0.1), mat(legendary ? 0xb080ff : 0x80c0ff, { emissive: legendary ? 0x8040ff : 0x3080ff, emissiveIntensity: 2 }), 0, 1.42, 0, g);
      orb.castShadow = false;
      for (let i = 0; i < 3; i++) part(cone(0.025, 0.26), metal, Math.cos(i * 2.1) * 0.1, 1.42, Math.sin(i * 2.1) * 0.1, g).rotation.set(Math.sin(i * 2.1) * 0.5, 0, -Math.cos(i * 2.1) * 0.5);
      // A ring round the orb, a finial and ribbons tied under the collar.
      part(new THREE.TorusGeometry(0.135, 0.008, 4, 20), metal, 0, 1.42, 0, g).rotation.x = PI / 2;
      part(cone(0.015, 0.08, 5), metal, 0, 1.57, 0, g);
      const ribbon = mat(legendary ? 0xd8c8ff : 0x8a1c18, { rough: 0.9 });
      part(box(0.035, 0.3, 0.006), ribbon, 0.045, 1.12, 0.02, g).rotation.z = 0.12;
      part(box(0.03, 0.22, 0.006), ribbon, 0.03, 1.15, -0.03, g).rotation.set(0.2, 0.5, 0.18);
      break;
    }
    case 'trident': {
      part(cyl(0.03, 0.03, 1.9), mat(0x2a6a7a, { rough: 0.35, metal: 0.4 }), 0, 0.6, 0, g);
      part(cyl(0.036, 0.036, 0.26, 8), wrap, 0, 0, 0, g);
      cord(0.039, [-0.09, -0.03, 0.03, 0.09]);
      for (const y of [0.7, 1.4]) part(cyl(0.037, 0.037, 0.03, 8), brass, 0, y, 0, g);
      part(cone(0.03, 0.12, 6), steel, 0, -0.41, 0, g).rotation.x = PI;
      // Socket, curved arms out to the side tines, and barbs on every tine.
      part(cyl(0.04, 0.032, 0.1, 8), steel, 0, 1.5, 0, g);
      for (const s of [-1, 1]) part(box(0.15, 0.035, 0.035), steel, s * 0.06, 1.565, 0, g).rotation.z = s * 0.53;
      const tine = legendary ? glow : steel;
      for (const x of [-0.12, 0, 0.12]) {
        const y = 1.68 + (x === 0 ? 0.06 : 0);
        part(cone(0.035, 0.32), tine, x, y, 0, g);
        for (const s of x === 0 ? [-1, 1] : [Math.sign(x)]) part(cone(0.016, 0.07, 4), tine, x + s * 0.028, y + 0.05, 0, g).rotation.z = -s * 2.62;
      }
      break;
    }
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
      const sinew = legendary ? brass : mat(0x2e1c10, { rough: 0.8 });
      const horn = mat(0xe8dcc0, { rough: 0.5 });
      for (const s of [-1, 1]) {
        part(box(0.035, 0.75, 0.045), wood, 0, s * 0.36, -0.08, g).rotation.x = -s * 0.3;
        // A darker backing strip, recurved tips and horn caps past the string.
        part(box(0.022, 0.7, 0.008), sinew, 0, s * 0.368, -0.055, g).rotation.x = -s * 0.3;
        part(box(0.03, 0.1, 0.035), wood, 0, s * 0.758, -0.161, g).rotation.x = s * 0.64;
        part(cone(0.02, 0.05, 5), horn, 0, s * 0.81, -0.122, g).rotation.x = s > 0 ? 0.64 : PI - 0.64;
        part(box(0.058, 0.02, 0.068), brass, 0, s * 0.1, 0, g);
      }
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
  // Many small parts, few draw calls.
  compact(g);
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
  const brass = mat(0xb8944a, { rough: 0.35, metal: 0.5 });
  part(cyl(0.38, 0.38, 0.05, 16), wood, 0, 0, 0, g).rotation.x = Math.PI / 2;
  // Painted field and an iron rim riveted all round.
  part(cyl(0.34, 0.34, 0.052, 16), mat(0x6a1e18, { rough: 0.8 }), 0, 0, 0.002, g).rotation.x = Math.PI / 2;
  part(new THREE.TorusGeometry(0.385, 0.022, 6, 24), iron, 0, 0, 0, g);
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) / 12) * Math.PI * 2;
    part(sphere(0.011, 4, 3), iron, Math.cos(a) * 0.385, Math.sin(a) * 0.385, 0.02, g);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    part(sphere(0.018, 5, 4), iron, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.03, g);
  }
  // A brass sun: a ring round the boss and rays between the studs.
  part(new THREE.TorusGeometry(0.13, 0.012, 4, 24), brass, 0, 0, 0.03, g);
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    part(bladeGeo([[-0.024, 0], [0.024, 0], [0, 0.1]], 0.004), brass, Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.032, g).rotation.z = a - Math.PI / 2;
  }
  part(sphere(0.085, 10, 8), brass, 0, 0, 0.04, g).scale.z = 0.7;
  part(cone(0.03, 0.08, 8), brass, 0, 0, 0.13, g).rotation.x = Math.PI / 2;
  // Arm straps and a grip behind.
  const leather = mat(0x3a2a1c, { rough: 0.9 });
  for (const y of [-0.1, 0.1]) part(box(0.36, 0.05, 0.02), leather, 0, y, -0.034, g);
  part(box(0.04, 0.22, 0.03), leather, 0, 0, -0.045, g);
  compact(g);
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
