// Shared model helpers: materials, primitives, compaction, glow sprites,
// weapons and props. Characters live in humanoid.ts and creatures.ts.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RUNES, type RuneId, type WeaponKind } from '../data/defs';

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

const PI_2 = Math.PI / 2;

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

/** A tapered tube through points (x, y, z) with a radius at each point, as one cone per span. */
function bentTube(pts: number[][], radii: number[], m: THREE.Material, parent: THREE.Object3D, seg = 8) {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < pts.length - 1; i++) {
    a.fromArray(pts[i]);
    b.fromArray(pts[i + 1]);
    const len = a.distanceTo(b);
    // Overlap the spans a little so the joints stay closed when bent.
    const p = part(cyl(radii[i + 1], radii[i], len * 1.06, seg), m, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, parent);
    p.quaternion.setFromUnitVectors(up, b.sub(a).normalize());
  }
}

/** Strokes of each rune's glyph, x and y from -0.5 to 0.5. */
const GLYPHS: Record<RuneId, number[][]> = {
  fire: [[0.25, 0.5, -0.25, 0], [-0.25, 0, 0.25, -0.5]],
  frost: [[0, -0.5, 0, 0.5], [-0.36, -0.3, 0.36, 0.3], [-0.36, 0.3, 0.36, -0.3]],
  storm: [[-0.2, 0.5, 0.22, 0.17], [0.22, 0.17, -0.22, -0.17], [-0.22, -0.17, 0.2, -0.5]],
  venom: [[0, -0.5, 0, 0.5], [0, 0.1, -0.3, 0.46], [0, 0.1, 0.3, 0.46]],
};

/** A rune glyph `s` tall at (x, y, z), drawn in the x-y plane turned `turn` about y. */
function glyph(rune: RuneId, m: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number, s: number, turn = 0) {
  const c = Math.cos(turn), sn = Math.sin(turn);
  for (const [x0, y0, x1, y1] of GLYPHS[rune]) {
    const len = Math.hypot(x1 - x0, y1 - y0) * s;
    const mx = ((x0 + x1) / 2) * s, my = ((y0 + y1) / 2) * s;
    const p = part(box(s * 0.14, len + s * 0.12, 0.003), m, x + mx * c, y + my, z - mx * sn, parent);
    p.rotation.set(0, turn, Math.atan2(-(x1 - x0), y1 - y0));
    p.castShadow = false;
  }
}

/**
 * Where an inscribed rune glows on each weapon: [x, y, z, size, turn], one
 * entry per visible face. The rune circle carries its runes in the ring.
 */
const RUNE_SPOTS: Record<WeaponKind, number[][]> = {
  sword: [[0, 0.42, 0.0215, 0.095, 0], [0, 0.42, -0.0215, 0.095, 0]],
  dagger: [[0, 0.22, 0.018, 0.06, 0], [0, 0.22, -0.018, 0.06, 0]],
  axe: [[0.038, 0.8, 0.1, 0.09, PI_2], [-0.038, 0.8, 0.1, 0.09, -PI_2]],
  hammer: [[0.123, 0.98, 0, 0.13, PI_2], [-0.123, 0.98, 0, 0.13, -PI_2]],
  staff: [[0, 1.0, 0.04, 0.09, 0], [0, 1.0, -0.04, 0.09, Math.PI]],
  trident: [[0, 1.0, 0.033, 0.08, 0], [0, 1.0, -0.033, 0.08, Math.PI]],
  bolt: [],
  bow: [[0, 0.3, -0.03, 0.06, 0], [0, 0.3, -0.088, 0.06, Math.PI], [0, -0.3, -0.03, 0.06, 0], [0, -0.3, -0.088, 0.06, Math.PI]],
  greatsword: [[0, 0.5, 0.0225, 0.11, 0], [0, 0.5, -0.0225, 0.11, 0], [0, 0.8, 0.0225, 0.11, 0], [0, 0.8, -0.0225, 0.11, 0]],
  longsword: [[0, 0.42, 0.0205, 0.09, 0], [0, 0.42, -0.0205, 0.09, 0]],
  spear: [[0, 1.62, 0.017, 0.075, 0], [0, 1.62, -0.017, 0.075, Math.PI]],
  battleaxe: [[0.036, 0.93, 0.1, 0.085, PI_2], [-0.036, 0.93, 0.1, 0.085, -PI_2], [0.036, 0.93, -0.1, 0.085, PI_2], [-0.036, 0.93, -0.1, 0.085, -PI_2]],
  knives: [[0, 0.14, 0.0085, 0.05, 0]],
  wand: [[0, 0.02, 0.019, 0.05, 0], [0, 0.02, -0.019, 0.05, Math.PI]],
  runecircle: [],
  lyre: [[0, 0.07, 0.042, 0.08, 0]],
  horn: [],
  wraps: [[0, 0.005, 0.096, 0.045, 0]],
  quarterstaff: [[0, 0.62, 0.032, 0.08, 0], [0, 0.62, -0.032, 0.08, Math.PI]],
};

/** Colours of each pair of hand wraps: the cloth, its darker bands, and the knuckle plate (none for plain linen). */
const WRAP_LOOK: Record<string, { cloth: number; band: number; plate?: number; claws?: boolean }> = {
  'linen-wraps': { cloth: 0xd8ccae, band: 0xa8987a },
  'iron-knuckles': { cloth: 0x8a6a4a, band: 0x5a4430, plate: 0x6a6e74 },
  'tiger-claws': { cloth: 0x2a2624, band: 0x1a1614, plate: 0x8a8e94, claws: true },
};

/**
 * One hand's wraps. The right hand holds its fist with the forearm along
 * local +z (fingers toward +y); the left hand, turned about y, along local -y.
 */
export function buildWraps(variant: string, left: boolean, rune?: RuneId): THREE.Group {
  const g = new THREE.Group();
  g.userData.kind = 'wraps';
  const look = WRAP_LOOK[variant] ?? WRAP_LOOK['linen-wraps'];
  const cloth = mat(look.cloth, { rough: 0.95 });
  const band = mat(look.band, { rough: 0.95 });
  // A ring of cloth round the hand at `at` (along the forearm), its ellipse rx by ry.
  const ring = (at: number, r: number, h: number, m: THREE.Material, sx = 1, sy = 1) => {
    const p = part(cyl(r, r, h, 10), m, 0, 0, 0, g);
    p.scale.set(sx, 1, sy);
    if (left) p.position.y = -at;
    else {
      p.rotation.x = Math.PI / 2;
      p.position.z = at;
      // Turned, its depth (sy) lies along local y.
      p.scale.set(sx, 1, sy);
    }
    return p;
  };
  // Over the knuckles and palm, round the wrist, and a little up the forearm.
  ring(0.03, 0.05, 0.05, cloth, 0.92, 1.04);
  ring(0.0, 0.047, 0.03, band, 0.95, 1.0);
  ring(-0.04, 0.042, 0.05, cloth, 0.95, 0.98);
  ring(-0.08, 0.044, 0.03, band, 1, 1);
  ring(-0.11, 0.046, 0.04, cloth, 1, 1);
  // A loose tail of cloth hanging from the wrist.
  const tail = part(box(0.022, 0.1, 0.006), cloth, 0, 0, 0, g);
  if (left) tail.position.set(0.045, 0.06, 0);
  else tail.position.set(0.045, 0, -0.06), (tail.rotation.x = Math.PI / 2);
  tail.rotation.z = 0.25;
  if (look.plate) {
    // A plate over the knuckles, which lead the fist along the forearm (local +z right, -y left).
    const metal = mat(look.plate, { rough: 0.4, metal: 0.45 });
    const plate = part(left ? box(0.085, 0.022, 0.034) : box(0.085, 0.034, 0.022), metal, 0, 0, 0, g);
    if (left) plate.position.set(0, -0.092, 0.01);
    else plate.position.set(0, 0.005, 0.082);
    for (let i = -1; i <= 1; i++) {
      const stud = part(sphere(0.011, 6, 4), metal, 0, 0, 0, g);
      if (left) stud.position.set(i * 0.028, -0.104, 0.01);
      else stud.position.set(i * 0.028, 0.005, 0.094);
      if (look.claws) {
        // Three steel claws jutting past the knuckles.
        const claw = part(cone(0.008, 0.085, 4), mat(0xc4c8cc, { rough: 0.3, metal: 0.5 }), 0, 0, 0, g);
        if (left) claw.position.set(i * 0.028, -0.14, 0.01), (claw.rotation.x = Math.PI);
        else claw.position.set(i * 0.028, 0.005, 0.13), (claw.rotation.x = Math.PI / 2);
      }
    }
  }
  if (rune && !left) {
    const c = RUNES[rune].color;
    const m = mat(c, { emissive: c, emissiveIntensity: 2.2 });
    for (const [x, y, z, sz, turn] of RUNE_SPOTS.wraps) glyph(rune, m, g, x, y, z + 0.0, sz, turn);
  }
  compact(g);
  return g;
}

export function buildWeapon(kind: WeaponKind, legendary = false, rune?: RuneId): THREE.Group {
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
    case 'longsword': {
      // A hand-and-a-half grip with room for the second hand, a scent-stopper
      // pommel and a long straight cross with flared ends.
      part(cyl(0.021, 0.024, 0.27, 8), wrap, 0, -0.035, 0, g);
      cord(0.0245, [-0.14, -0.095, -0.05, -0.005, 0.04]);
      part(cyl(0.028, 0.021, 0.03, 8), brass, 0, -0.183, 0, g);
      part(new THREE.OctahedronGeometry(0.034, 0), brass, 0, -0.222, 0, g).scale.set(1, 1.4, 1);
      part(cone(0.011, 0.03, 6), brass, 0, -0.272, 0, g).rotation.x = PI;
      part(box(0.05, 0.04, 0.05), brass, 0, 0.105, 0, g);
      part(box(0.27, 0.022, 0.03), brass, 0, 0.11, 0, g);
      for (const s of [-1, 1]) {
        part(box(0.035, 0.032, 0.038), brass, s * 0.145, 0.104, 0, g).rotation.z = s * 0.35;
        part(sphere(0.011, 6, 4), gem, 0, 0.105, s * 0.026, g).scale.z = 0.5;
      }
      // Long, evenly tapering blade with a ricasso and a fuller.
      part(bladeGeo([[-0.032, 0.125], [0.032, 0.125], [0.024, 1.14], [0, 1.36], [-0.024, 1.14]], 0.015), steel, 0, 0, 0, g);
      part(box(0.07, 0.06, 0.04), darkSteel, 0, 0.155, 0, g);
      fuller(0.014, 0.24, 1.04, 0.0198);
      break;
    }
    case 'greatsword': {
      // A long two-hand grip bound in cord and a heavy faceted pommel.
      part(cyl(0.024, 0.027, 0.38, 8), wrap, 0, -0.1, 0, g);
      cord(0.0275, [-0.26, -0.2, -0.14, -0.08, -0.02, 0.04]);
      part(cyl(0.033, 0.024, 0.035, 8), brass, 0, -0.305, 0, g);
      part(new THREE.OctahedronGeometry(0.052, 0), brass, 0, -0.352, 0, g).scale.set(1, 1.2, 0.75);
      // A broad cross with swept quillons, ball ends and a stone each side.
      part(box(0.1, 0.06, 0.075), brass, 0, 0.1, 0, g);
      for (const s of [-1, 1]) {
        part(box(0.22, 0.032, 0.048), brass, s * 0.15, 0.118, 0, g).rotation.z = s * 0.14;
        part(sphere(0.03, 8, 6), brass, s * 0.262, 0.142, 0, g);
        part(sphere(0.02, 6, 4), gem, 0, 0.1, s * 0.037, g).scale.z = 0.5;
      }
      // A leather-bound ricasso, parrying lugs, then the broad blade with a deep fuller.
      part(box(0.1, 0.14, 0.05), wrap, 0, 0.2, 0, g);
      for (const y of [0.15, 0.2, 0.25]) part(box(0.104, 0.012, 0.054), grip, 0, y, 0, g);
      for (const s of [-1, 1]) part(bladeGeo([[0, 0], [0.06, 0.012], [0.07, 0.04], [0, 0.05]], 0.012), steel, s * 0.05, 0.27, 0, g).rotation.y = s > 0 ? 0 : PI;
      part(bladeGeo([[-0.056, 0.26], [0.056, 0.26], [0.046, 1.54], [0, 1.82], [-0.046, 1.54]], 0.018), steel, 0, 0, 0, g);
      fuller(0.024, 0.36, 1.42, 0.0215);
      break;
    }
    case 'spear': {
      const ash = mat(0x8a6c46, { rough: 0.8 });
      // An ash shaft with a leather grip, bronze bands and a butt spike.
      part(cyl(0.023, 0.026, 1.86, 8), ash, 0, 0.42, 0, g);
      part(cyl(0.029, 0.029, 0.3, 8), wrap, 0, 0, 0, g);
      cord(0.0305, [-0.13, -0.065, 0, 0.065, 0.13]);
      for (const y of [-0.38, 0.5, 1.05]) part(cyl(0.028, 0.028, 0.025, 8), brass, 0, y, 0, g);
      part(cyl(0.027, 0.02, 0.08, 8), darkSteel, 0, -0.52, 0, g);
      part(cone(0.02, 0.11, 6), darkSteel, 0, -0.615, 0, g).rotation.x = PI;
      // A red horsehair tassel under a bronze collar.
      part(cone(0.052, 0.15, 8), mat(0x8a1c18, { rough: 1 }), 0, 1.28, 0, g);
      part(cyl(0.031, 0.028, 0.04, 8), brass, 0, 1.37, 0, g);
      // Socket with small wings, and a leaf head with a raised midrib.
      part(cyl(0.02, 0.028, 0.13, 8), steel, 0, 1.45, 0, g);
      part(box(0.1, 0.014, 0.014), steel, 0, 1.42, 0, g);
      part(bladeGeo([[0, 1.47], [0.048, 1.56], [0.042, 1.66], [0, 1.82], [-0.042, 1.66], [-0.048, 1.56]], 0.01), legendary ? glow : steel, 0, 0, 0, g);
      part(box(0.012, 0.3, 0.032), steel, 0, 1.64, 0, g);
      break;
    }
    case 'quarterstaff': {
      // A plain fighting staff held at its middle, shod with iron at both ends.
      const wood = mat(0x7a5634, { rough: 0.8 });
      part(cyl(0.028, 0.028, 1.9, 8), wood, 0, 0.1, 0, g);
      part(cyl(0.032, 0.032, 0.28, 8), wrap, 0, 0, 0, g);
      cord(0.0335, [-0.12, -0.06, 0, 0.06, 0.12]);
      for (const y of [-0.85, 1.05]) {
        part(cyl(0.034, 0.034, 0.12, 8), darkSteel, 0, y, 0, g);
        part(cyl(0.036, 0.036, 0.02, 8), brass, 0, y + (y > 0 ? -0.07 : 0.07), 0, g);
      }
      part(sphere(0.034, 8, 5), darkSteel, 0, 1.11, 0, g);
      part(sphere(0.034, 8, 5), darkSteel, 0, -0.91, 0, g);
      for (const y of [-0.45, 0.65]) part(cyl(0.031, 0.031, 0.018, 8), brass, 0, y, 0, g);
      break;
    }
    case 'wraps':
      // Built per hand by buildWraps; this is only reached for a bare preview.
      return buildWraps('linen-wraps', false, rune);
    case 'battleaxe': {
      // A long haft, iron-shod at the foot, with a wrapped grip.
      part(cyl(0.027, 0.033, 1.36, 8), grip, 0, 0.47, 0, g);
      part(cyl(0.034, 0.034, 0.2, 8), wrap, 0, -0.03, 0, g);
      cord(0.0355, [-0.11, -0.06, -0.01, 0.04]);
      part(cyl(0.038, 0.03, 0.05, 8), darkSteel, 0, -0.19, 0, g);
      part(sphere(0.032, 8, 6), brass, 0, -0.23, 0, g);
      // Two crescent bits back to back, each with a forge-dark cheek.
      const bit = [[0.03, 0.85], [0.12, 0.82], [0.19, 0.74], [0.235, 0.69], [0.27, 0.78], [0.285, 0.93], [0.27, 1.08], [0.235, 1.17], [0.19, 1.12], [0.12, 1.04], [0.03, 1.01]];
      const cheek = [[0.03, 0.86], [0.11, 0.85], [0.15, 0.93], [0.11, 1.01], [0.03, 1.0]];
      for (const s of [-1, 1]) {
        const edge = bladeGeo(bit as [number, number][], 0.028);
        edge.rotateY(-s * PI_2);
        part(edge, legendary ? glow : steel, 0, 0, 0, g);
        const ch = bladeGeo(cheek as [number, number][], 0.046);
        ch.rotateY(-s * PI_2);
        part(ch, darkSteel, 0, 0, 0, g);
        part(sphere(0.012, 5, 4), brass, 0.0, 0.93, s * 0.075, g);
      }
      // The socket between the bits, langets down the haft and a top spike.
      part(box(0.075, 0.2, 0.08), darkSteel, 0, 0.93, 0, g);
      for (const x of [-1, 1]) {
        for (const y of [0.87, 0.99]) part(sphere(0.012, 5, 4), brass, x * 0.04, y, 0, g);
        part(box(0.012, 0.22, 0.03), darkSteel, x * 0.029, 0.74, 0, g);
      }
      part(cone(0.034, 0.14, 6), darkSteel, 0, 1.1, 0, g);
      break;
    }
    case 'knives': {
      // The knife in hand, and two more fanned behind it, ready to follow.
      for (const [rz, dz] of [[0.42, -0.016], [-0.42, -0.008], [0, 0.002]]) {
        const put = (geo: THREE.BufferGeometry, m: THREE.Material, y: number) => part(geo.translate(0, y, 0).rotateZ(rz).translate(0, 0, dz), m, 0, 0, 0, g);
        put(cyl(0.011, 0.013, 0.1, 6), wrap, 0);
        put(new THREE.TorusGeometry(0.017, 0.005, 4, 10), darkSteel, -0.066);
        put(box(0.046, 0.012, 0.02), darkSteel, 0.055);
        put(bladeGeo([[-0.017, 0.06], [0.017, 0.06], [0.025, 0.14], [0, 0.27], [-0.025, 0.14]], 0.004), steel, 0);
      }
      break;
    }
    case 'wand': {
      const wood = mat(0x4a2e1c, { rough: 0.7 });
      const silver = mat(0xc8ccd4, { rough: 0.3, metal: 0.6 });
      // A leather handle between a silver pommel and collar.
      part(cyl(0.015, 0.017, 0.15, 8), wrap, 0, 0, 0, g);
      cord(0.0175, [-0.05, -0.017, 0.017, 0.05]);
      part(sphere(0.021, 8, 6), silver, 0, -0.09, 0, g);
      part(cone(0.011, 0.03, 6), silver, 0, -0.118, 0, g).rotation.x = PI;
      part(cyl(0.016, 0.019, 0.02, 8), silver, 0, 0.083, 0, g);
      // A tapering shaft wound with a silver spiral.
      part(cyl(0.007, 0.013, 0.3, 8), wood, 0, 0.24, 0, g);
      for (let i = 0; i < 11; i++) {
        const a = i * 1.15, r = 0.0125 - i * 0.00055;
        part(sphere(0.0042, 4, 3), silver, Math.cos(a) * r, 0.105 + i * 0.026, Math.sin(a) * r, g);
      }
      // Silver claws gripping a glowing crystal.
      part(cyl(0.012, 0.008, 0.02, 8), silver, 0, 0.392, 0, g);
      for (let i = 0; i < 3; i++) {
        const a = (i * PI * 2) / 3;
        part(cone(0.005, 0.045, 4), silver, Math.cos(a) * 0.012, 0.418, Math.sin(a) * 0.012, g).rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
      }
      const c = rune ? RUNES[rune].color : 0xb070ff;
      const tip = part(new THREE.OctahedronGeometry(0.022, 0), mat(c, { rough: 0.15, emissive: c, emissiveIntensity: 1.8 }), 0, 0.434, 0, g);
      tip.scale.set(1, 1.6, 1);
      tip.castShadow = false;
      break;
    }
    case 'runecircle': {
      // A ring of glowing runes floats round the off hand; the animator spins
      // `orbit` about the forearm. It carries its own runes: an inscribed one
      // recolours them and takes every place in the ring.
      const c = rune ? RUNES[rune].color : 0x46f0c8;
      const glowM = mat(c, { emissive: c, emissiveIntensity: 2 });
      const faint = mat(c, { emissive: c, emissiveIntensity: 1.2, transparent: 0.55 });
      const orbit = new THREE.Group();
      orbit.position.y = -0.06;
      g.add(orbit);
      part(new THREE.TorusGeometry(0.19, 0.005, 4, 40), glowM, 0, 0, 0, orbit).rotation.x = PI_2;
      part(new THREE.TorusGeometry(0.215, 0.003, 3, 40), faint, 0, 0, 0, orbit).rotation.x = PI_2;
      const kinds: RuneId[] = ['fire', 'frost', 'storm', 'venom'];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * PI * 2;
        glyph(rune ?? kinds[i % 4], glowM, orbit, Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2, 0.055, a);
      }
      // A tilted inner ring and motes of light.
      const inner = part(new THREE.TorusGeometry(0.12, 0.004, 3, 28), faint, 0, 0.01, 0, orbit);
      inner.rotation.set(PI_2 + 0.35, 0.2, 0);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * PI * 2 + 0.3;
        part(sphere(0.008, 5, 4), glowM, Math.sin(a) * 0.15, 0.03 * Math.sin(i * 2.1), Math.cos(a) * 0.15, orbit).castShadow = false;
      }
      orbit.traverse((o) => (o.castShadow = false));
      g.userData.orbit = orbit;
      g.userData.offhand = true;
      // Upright along the forearm.
      g.userData.wrist = 0;
      break;
    }
    case 'lyre': {
      // Vertical along local y, strings facing +z; turned like the bow so it
      // sits upright in a raised left hand.
      const wood = mat(0x7a4a26, { rough: 0.6 });
      const gold = mat(0xd8b050, { rough: 0.35, metal: 0.55 });
      const board = mat(0xd8c49a, { rough: 0.8 });
      // A round, tortoise-shell sound box with a pale sound board and a gold rim.
      part(sphere(0.11, 12, 8), wood, 0, 0.07, -0.012, g).scale.set(1, 0.95, 0.42);
      part(cyl(0.094, 0.094, 0.012, 16), board, 0, 0.07, 0.03, g).rotation.x = PI_2;
      part(new THREE.TorusGeometry(0.096, 0.007, 4, 24), gold, 0, 0.07, 0.034, g);
      part(box(0.07, 0.014, 0.018), gold, 0, 0.0, 0.04, g);
      part(box(0.1, 0.012, 0.014), wood, 0, 0.1, 0.045, g);
      // Two curving horn-like arms, curled at the tips.
      for (const s of [-1, 1]) {
        bentTube([[s * 0.06, 0.13, 0], [s * 0.11, 0.21, 0], [s * 0.13, 0.31, 0], [s * 0.115, 0.4, 0], [s * 0.14, 0.47, 0]], [0.019, 0.016, 0.014, 0.012, 0.009], wood, g, 6);
        part(new THREE.TorusGeometry(0.018, 0.006, 4, 10), gold, s * 0.155, 0.48, 0, g);
        part(cyl(0.017, 0.017, 0.016, 8), gold, s * 0.112, 0.21, 0, g);
      }
      // The yoke with its pegs, and seven strings.
      part(cyl(0.011, 0.011, 0.25, 8), gold, 0, 0.405, 0, g).rotation.z = PI_2;
      const strings = mat(0xf0e6c0, { rough: 0.5, emissive: 0x403010, emissiveIntensity: 0.6 });
      for (let i = 0; i < 7; i++) {
        const u = i / 6 - 0.5;
        part(cyl(0.004, 0.004, 0.03, 4), gold, u * 0.16, 0.405, -0.018, g).rotation.x = PI_2;
        const x0 = u * 0.06, x1 = u * 0.15;
        const str = part(cyl(0.0018, 0.0018, Math.hypot(x1 - x0, 0.4), 3), strings, (x0 + x1) / 2, 0.205, 0.044, g);
        str.rotation.z = -Math.atan2(x1 - x0, 0.4);
        str.castShadow = false;
      }
      g.userData.offhand = true;
      g.rotation.x = PI_2;
      break;
    }
    case 'horn': {
      // A curved horn, dark at the mouthpiece and pale at the bell, bound in
      // brass; the hand holds it just past the mouthpiece.
      const dark = mat(0x5a4028, { rough: 0.5 });
      const pale = mat(0xe2d2aa, { rough: 0.45 });
      const pts: number[][] = [];
      const radii: number[] = [];
      for (let i = 0; i <= 7; i++) {
        const t = i / 7;
        pts.push([0, -0.06 + 0.56 * t, 0.2 * t * t]);
        radii.push(0.013 + 0.06 * Math.pow(t, 1.7));
      }
      bentTube(pts.slice(0, 4), radii.slice(0, 4), dark, g);
      bentTube(pts.slice(3), radii.slice(3), pale, g, 10);
      // The bell's lip, brass bands and the mouthpiece.
      const end = pts[7], before = pts[6];
      const lip = part(new THREE.TorusGeometry(radii[7] + 0.004, 0.009, 5, 16), brass, end[0], end[1], end[2], g);
      lip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, end[1] - before[1], end[2] - before[2]).normalize());
      for (const i of [2, 4, 6]) {
        const [x, y, z] = pts[i];
        const band = part(cyl(radii[i] + 0.005, radii[i] + 0.005, 0.022, 10), brass, x, y, z, g);
        band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, pts[i + 1][1] - pts[i - 1][1], pts[i + 1][2] - pts[i - 1][2]).normalize());
      }
      part(cyl(0.011, 0.014, 0.05, 8), brass, 0, -0.085, 0, g);
      part(cyl(0.018, 0.011, 0.016, 8), brass, 0, -0.115, 0, g);
      // A ring for the baldric on the middle band.
      part(new THREE.TorusGeometry(0.016, 0.004, 4, 10), brass, -radii[4] - 0.018, pts[4][1], pts[4][2], g).rotation.y = PI_2;
      if (rune) {
        const m = mat(RUNES[rune].color, { emissive: RUNES[rune].color, emissiveIntensity: 2.2 });
        for (const sd of [-1, 1]) glyph(rune, m, g, sd * (radii[5] + 0.003), pts[5][1] + 0.01, pts[5][2], 0.08, sd * PI_2);
      }
      break;
    }
  }
  if (rune && kind !== 'runecircle' && kind !== 'horn') {
    // An inscribed rune glows on the weapon.
    const c = RUNES[rune].color;
    const m = mat(c, { emissive: c, emissiveIntensity: 2.2 });
    for (const [x, y, z, s, turn] of RUNE_SPOTS[kind]) glyph(rune, m, g, x, y, z, s, turn);
  }
  // Many small parts, few draw calls.
  compact(g);
  return g;
}

/** One throwing knife along +Y (in flight, or lying where it landed), its rune glowing on the blade. */
export function buildThrowingKnife(rune?: RuneId): THREE.Group {
  const g = new THREE.Group();
  part(cyl(0.011, 0.013, 0.1, 6), mat(0x5a3a22, { rough: 0.95 }), 0, 0, 0, g);
  part(new THREE.TorusGeometry(0.017, 0.005, 4, 10), mat(0x6a6e74, { rough: 0.5, metal: 0.4 }), 0, -0.066, 0, g);
  part(box(0.046, 0.012, 0.02), mat(0x6a6e74, { rough: 0.5, metal: 0.4 }), 0, 0.055, 0, g);
  part(bladeGeo([[-0.017, 0.06], [0.017, 0.06], [0.025, 0.14], [0, 0.27], [-0.025, 0.14]], 0.004), mat(0xc4c8cc, { rough: 0.38, metal: 0.45 }), 0, 0, 0, g);
  if (rune) {
    const c = RUNES[rune].color;
    const m = mat(c, { emissive: c, emissiveIntensity: 2.2 });
    for (const z of [-0.0065, 0.0065]) glyph(rune, m, g, 0, 0.14, z, 0.05);
  }
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
