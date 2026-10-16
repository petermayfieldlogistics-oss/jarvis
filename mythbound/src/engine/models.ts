// Shared model helpers: materials, primitives, compaction, glow sprites,
// weapons and props. Characters live in humanoid.ts and creatures.ts.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
let outlineMat: THREE.MeshBasicMaterial | null = null;
/** The heroes' ink line for rigid models: a dark shell a hair larger, its inner faces drawn (bolder on bigger models, as on the heroes). */
function outlineMaterial(): THREE.MeshBasicMaterial {
  if (!outlineMat) {
    outlineMat = new THREE.MeshBasicMaterial({ color: 0x0e0b10, side: THREE.BackSide });
    outlineMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        float inkDepth = -(modelViewMatrix * vec4(position, 1.0)).z;
        transformed += normal * clamp(inkDepth * 0.0021, 0.0042, 0.03);`);
    };
    outlineMat.customProgramCacheKey = () => 'rigid-ink';
  }
  return outlineMat;
}

const welded = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** A copy with its corners welded and normals averaged, so the ink shell has no cracks at hard edges (skin weights kept). */
function weldedCopy(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let w = welded.get(g);
  if (!w) {
    const p = new THREE.BufferGeometry();
    for (const name of ['position', 'skinIndex', 'skinWeight']) if (g.attributes[name]) p.setAttribute(name, g.attributes[name]);
    if (g.index) p.setIndex(g.index);
    w = mergeVertices(p, 1e-4);
    w.computeVertexNormals();
    welded.set(g, w);
  }
  return w;
}

/** Outlines a model (a creature boss) in ink like the heroes. Glowing and see-through parts are left bare. */
export function outline(root: THREE.Object3D) {
  const list: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.noInk || Array.isArray(m.material)) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat.transparent || (mat.emissiveIntensity > 0.5 && mat.emissive && mat.emissive.getHex() !== 0)) return;
    list.push(m);
  });
  for (const m of list) {
    const geo = weldedCopy(m.geometry);
    let ink: THREE.Mesh;
    const sk = m as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh) {
      // Bound to the same bones, so the line bends with the body.
      const s = new THREE.SkinnedMesh(geo, outlineMaterial());
      s.bind(sk.skeleton, sk.bindMatrix);
      if (sk.boundingSphere) s.boundingSphere = sk.boundingSphere.clone();
      m.parent!.add(s);
      ink = s;
    } else {
      ink = new THREE.Mesh(geo, outlineMaterial());
      m.add(ink);
    }
    ink.castShadow = false;
    ink.userData.noInk = true;
    ink.userData.keep = true;
    ink.raycast = () => {};
  }
}

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

/** A tube along a smooth curve through `pts`, its radius r(t) (t from 0 to 1 along it), scaled by `wide` across x and `deep` along z. */
function taperTube(pts: number[][], r: (t: number) => number, seg = 16, radial = 6, wide = 1, deep = 1): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const geo = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = geo.attributes.position;
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    curve.getPointAt(i / seg, c);
    const k = r(i / seg);
    for (let j = 0; j <= radial; j++) {
      const n = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, n).sub(c).multiplyScalar(k);
      v.x *= wide;
      v.z *= deep;
      pos.setXYZ(n, c.x + v.x, c.y + v.y, c.z + v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
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

export function buildWeapon(kind: WeaponKind, legendary = false, rune?: RuneId, id?: string): THREE.Group {
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
  // Where a rune would glow; a weapon shaped unlike the rest of its kind moves it.
  let spots = RUNE_SPOTS[kind];
  switch (kind) {
    case 'sword': {
      if (id === 'duelist-saber') {
        // A slim blade curving back toward its spine, and brass round the
        // hand: a knuckle bow from the guard down to the pommel, and a back
        // quillon curled toward the blade.
        const bend = (y: number) => 0.062 * Math.max(0, y - 0.12) ** 2;
        const edge: [number, number][] = [], spine: [number, number][] = [];
        for (let i = 0; i <= 8; i++) {
          const y = 0.12 + i * 0.125, w = 1 - i * 0.03;
          edge.push([bend(y) - 0.022 * w, y]);
          spine.push([bend(y) + 0.017 * w, y]);
        }
        part(bladeGeo([...edge, [bend(1.22) + 0.006, 1.22], ...spine.reverse()], 0.012), steel, 0, 0, 0, g);
        for (let i = 0; i < 3; i++) {
          const y = 0.3 + i * 0.2;
          for (const z of [-1, 1]) part(box(0.007, 0.2, 0.002), darkSteel, bend(y) + 0.005, y, z * 0.0172, g).rotation.z = -Math.atan(0.124 * (y - 0.12));
        }
        part(cyl(0.019, 0.022, 0.2, 8), wrap, 0, 0, 0, g);
        cord(0.0225, [-0.07, -0.035, 0, 0.035, 0.07], brass);
        part(box(0.055, 0.028, 0.038), brass, -0.002, 0.108, 0, g);
        part(taperTube([[-0.02, 0.108, 0], [-0.06, 0.1, 0], [-0.086, 0.04, 0], [-0.08, -0.05, 0], [-0.05, -0.118, 0], [-0.012, -0.135, 0]], () => 0.0085, 18, 5), brass, 0, 0, 0, g);
        part(taperTube([[0.02, 0.108, 0], [0.06, 0.115, 0], [0.084, 0.142, 0], [0.078, 0.168, 0], [0.062, 0.162, 0]], (t) => 0.0085 - t * 0.003, 12, 5), brass, 0, 0, 0, g);
        part(sphere(0.012, 6, 4), brass, 0.062, 0.162, 0, g);
        part(cyl(0.024, 0.018, 0.03, 8), brass, 0, -0.115, 0, g);
        part(sphere(0.023, 8, 6), brass, 0, -0.14, 0, g).scale.y = 0.8;
        const x = bend(0.42) - 0.0025;
        spots = [[x, 0.42, 0.0175, 0.06, 0], [x, 0.42, -0.0175, 0.06, 0]];
        break;
      }
      if (id === 'reapers-edge') {
        // Forged from the Reaper's scythe: a black blade that hooks at its
        // point the way the scythe did, its edge lit with the pale green of
        // the souls it reaped. A bone guard, a grip of vertebrae, and a skull
        // for a pommel whose eyes still glow.
        const black = mat(0x4a4858, { rough: 0.35, metal: 0.2 });
        const bone = mat(0xd8d0b8, { rough: 0.7 });
        const soul = mat(0x70ffb0, { emissive: 0x40ff90, emissiveIntensity: 1.8 });
        const edge: [number, number][] = [[-0.032, 0.13], [-0.034, 0.45], [-0.037, 0.8], [-0.042, 0.95], [-0.052, 1.04], [-0.072, 1.1], [-0.1, 1.125], [-0.125, 1.11]];
        const back: [number, number][] = [[-0.148, 1.065], [-0.137, 1.14], [-0.11, 1.195], [-0.075, 1.225], [-0.03, 1.22], [0.005, 1.17], [0.025, 1.08], [0.03, 0.95], [0.028, 0.13]];
        part(bladeGeo([...edge, ...back], 0.016), black, 0, 0, 0, g);
        // The lit edge: a strip just inside the edge on both faces, round into the hook.
        const inner = (d: number) => edge.slice(1, 7).map(([x, y], i, a) => {
          const [px, py] = a[Math.max(0, i - 1)], [nx, ny] = a[Math.min(a.length - 1, i + 1)];
          const len = Math.hypot(nx - px, ny - py);
          return [x + ((ny - py) / len) * d, y - ((nx - px) / len) * d] as [number, number];
        });
        const strip = bladeGeo([...inner(0.003), ...inner(0.011).reverse()], 0.001);
        for (const z of [-1, 1]) part(strip, soul, 0, 0, z * 0.0206, g).castShadow = false;
        part(taperTube([[-0.115, 0.188, 0], [-0.078, 0.128, 0], [-0.032, 0.104, 0], [0, 0.1, 0], [0.032, 0.104, 0], [0.078, 0.128, 0], [0.115, 0.188, 0]], (t) => 0.004 + 0.02 * Math.sin(PI * t), 18, 6, 1, 0.85), bone, 0, 0, 0, g);
        for (const z of [-1, 1]) part(sphere(0.014, 8, 6), soul, 0, 0.104, z * 0.016, g).scale.z = 0.5;
        part(cyl(0.017, 0.017, 0.2, 6), black, 0, 0, 0, g);
        for (let i = 0; i < 5; i++) {
          const y = -0.08 + i * 0.04;
          part(cyl(0.024, 0.024, 0.024, 8), bone, 0, y, 0, g);
          part(box(0.062, 0.008, 0.014), bone, 0, y, 0, g);
        }
        // The skull looks out over the blade's face.
        part(sphere(0.032, 10, 8), bone, 0, -0.148, 0, g).scale.set(0.9, 1, 1.05);
        part(box(0.034, 0.018, 0.03), bone, 0, -0.176, 0.01, g);
        for (const x of [-1, 1]) part(sphere(0.0085, 6, 4), soul, x * 0.012, -0.146, 0.027, g);
        break;
      }
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
      if (id === 'venomfang') {
        // The Giant Spider's fang: dark at the root, pale toward its point,
        // a channel of venom glowing down both faces and a drop of it at the
        // tip. Mandibles for a guard; spider silk binds the grip.
        const chitin = mat(0x2a2018, { rough: 0.45, metal: 0.1 });
        const ivory = mat(0xd8d8b0, { rough: 0.35 });
        const venom = mat(0x9aff60, { emissive: 0x50e020, emissiveIntensity: 1.8 });
        const silk = mat(0xe0dcd0, { rough: 0.9 });
        const at = (t: number) => [-0.09 * t * t, 0.07 + 0.46 * t, 0];
        const r = (t: number) => 0.03 * (1 - t) ** 0.8 + 0.002;
        const along = (a: number, b: number, z = (_t: number) => 0) => Array.from({ length: 7 }, (_, i) => {
          const t = a + ((b - a) * i) / 6, p = at(t);
          return [p[0], p[1], z(t)];
        });
        part(taperTube(along(0, 0.5), (t) => r(t * 0.5), 10, 7, 1, 0.7), chitin, 0, 0, 0, g);
        part(taperTube(along(0.48, 1), (t) => r(0.48 + t * 0.52), 12, 7, 1, 0.7), ivory, 0, 0, 0, g);
        for (const s of [-1, 1]) part(taperTube(along(0.12, 0.86, (t) => s * (r(t) * 0.7 - 0.0025)), (t) => 0.0042 - t * 0.0025, 12, 4), venom, 0, 0, 0, g).castShadow = false;
        const tip = at(1);
        part(sphere(0.0075, 6, 5), venom, tip[0] - 0.002, tip[1] - 0.006, 0, g).scale.y = 1.5;
        const drop = glowSprite(0x80ff40, 0.1, 0.7);
        drop.position.set(tip[0], tip[1], 0);
        g.add(drop);
        part(cyl(0.036, 0.028, 0.03, 8), chitin, 0, 0.072, 0, g);
        for (const s of [-1, 1]) part(taperTube([[s * 0.02, 0.07, 0], [s * 0.05, 0.085, 0], [s * 0.066, 0.12, 0], [s * 0.058, 0.152, 0]], (t) => 0.011 - t * 0.008, 8, 5), chitin, 0, 0, 0, g);
        part(cyl(0.018, 0.021, 0.13, 8), wrap, 0, 0, 0, g);
        cord(0.0215, [-0.048, -0.024, 0, 0.024, 0.048], silk);
        for (const s of [-1, 1]) part(box(0.004, 0.11, 0.003), silk, 0, 0, s * 0.0205, g).rotation.z = s * 0.35;
        part(new THREE.OctahedronGeometry(0.028, 0), chitin, 0, -0.085, 0, g).scale.set(1, 1.25, 0.8);
        for (const z of [-1, 1]) part(sphere(0.01, 6, 4), venom, 0, -0.085, z * 0.02, g).scale.z = 0.5;
        const x = at(0.326)[0];
        spots = [[x, 0.22, 0.0185, 0.045, 0], [x, 0.22, -0.0185, 0.045, 0]];
        break;
      }
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
      // Bearded head: the edge sweeps down into a hooked beard, ground bright
      // along a forged grey body that thickens into a dark cheek at the haft.
      // A spike behind.
      const inner: [number, number][] = [[0.17, 0.565], [0.215, 0.595], [0.26, 0.66], [0.285, 0.75], [0.285, 0.83], [0.26, 0.895], [0.215, 0.935]];
      const edgeArc: [number, number][] = [[0.24, 0.975], [0.29, 0.925], [0.322, 0.84], [0.322, 0.74], [0.292, 0.64], [0.24, 0.56], [0.18, 0.515]];
      const body = bladeGeo([[0.02, 0.69], [0.06, 0.68], [0.1, 0.64], [0.14, 0.585], ...inner, [0.16, 0.948], [0.08, 0.925], [0.02, 0.91]], 0.03);
      body.rotateY(-PI / 2);
      part(body, mat(0x8e9298, { rough: 0.45, metal: 0.4 }), 0, 0, 0, g);
      const bit = bladeGeo([...edgeArc, ...inner], 0.02);
      bit.rotateY(-PI / 2);
      part(bit, legendary ? glow : steel, 0, 0, 0, g);
      const cheek = bladeGeo([[0.02, 0.69], [0.12, 0.675], [0.16, 0.8], [0.12, 0.925], [0.02, 0.9]], 0.05);
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
      // An octagonal forged head: flared striking faces at both ends, iron
      // bands, a collar round the haft and a spike on top. Hephaestus's own
      // glows from a forge seam round its middle.
      const iron = mat(legendary ? 0x4a3a34 : 0x4a4644, { rough: 0.45, metal: 0.4 });
      const along = (geo: THREE.BufferGeometry, z: number, m: THREE.Material) => part(geo, m, 0, 0.98, z, g).rotation.set(PI / 2, PI / 8, 0);
      along(cyl(0.122, 0.122, 0.34, 8), 0, iron);
      for (const z of [-1, 1]) {
        along(cyl(0.142, 0.122, 0.05, 8).rotateX(z > 0 ? 0 : PI), z * 0.19, darkSteel);
        along(cyl(0.118, 0.142, 0.03, 8).rotateX(z > 0 ? 0 : PI), z * 0.228, darkSteel);
        along(cyl(0.128, 0.128, 0.028, 8), z * 0.105, legendary ? brass : darkSteel);
      }
      along(cyl(0.126, 0.126, 0.05, 8), 0, legendary ? glow : brass);
      if (legendary) {
        for (const z of [-1, 1]) glyph('fire', mat(0xa83a10, { emissive: 0xff5a10, emissiveIntensity: 1.6 }), g, 0.124, 0.98, z * 0.06, 0.09, PI / 2);
        const ember = glowSprite(0xff8030, 0.55, 0.7);
        ember.position.set(0, 0.98, 0);
        g.add(ember);
      }
      part(cyl(0.05, 0.06, 0.07, 8), darkSteel, 0, 0.85, 0, g);
      part(cone(0.05, 0.16, 6), darkSteel, 0, 1.17, 0, g);
      for (const x of [-1, 1]) part(box(0.012, 0.26, 0.035), darkSteel, x * 0.036, 0.73, 0, g);
      break;
    }
    case 'staff': {
      if (legendary) {
        // Hecate's staff: black wood bound in silver, a silver crescent moon
        // cradling a violet orb, her torches burning on its horns, and a key
        // to every door hanging from it.
        const ebony = mat(0x221830, { rough: 0.6 });
        const silver = mat(0xc8ccd8, { rough: 0.3, metal: 0.5 });
        const violet = mat(0xc890ff, { emissive: 0x9040ff, emissiveIntensity: 2.2 });
        part(cyl(0.03, 0.04, 1.7, 8), ebony, 0, 0.5, 0, g);
        part(cyl(0.042, 0.042, 0.24, 8), wrap, 0, 0, 0, g);
        cord(0.044, [-0.08, -0.04, 0, 0.04, 0.08], silver);
        for (const [y, r] of [[0.2, 0.042], [0.62, 0.038], [1.16, 0.035]]) part(cyl(r, r, 0.03, 8), silver, 0, y, 0, g);
        part(cone(0.04, 0.1, 8), silver, 0, -0.4, 0, g).rotation.x = PI;
        part(cyl(0.036, 0.03, 0.06, 8), silver, 0, 1.34, 0, g);
        // The crescent, horns up: its outer arc round the bottom, its inner
        // arc back across, meeting in points.
        const moon: [number, number][] = [];
        for (let i = 0; i <= 12; i++) {
          const a = ((160 + (220 * i) / 12) * PI) / 180;
          moon.push([Math.cos(a) * 0.12, 1.47 + Math.sin(a) * 0.12]);
        }
        for (let i = 0; i <= 10; i++) {
          const a = ((372 - (204 * i) / 10) * PI) / 180;
          moon.push([Math.cos(a) * 0.11, 1.5 + Math.sin(a) * 0.11]);
        }
        part(bladeGeo(moon, 0.008), silver, 0, 0, 0, g);
        const orb = part(sphere(0.062, 12, 10), violet, 0, 1.5, 0, g);
        orb.castShadow = false;
        const glowAt = (x: number, y: number, size: number, o: number) => {
          const sp = glowSprite(0xb070ff, size, o);
          sp.position.set(x, y, 0);
          g.add(sp);
        };
        glowAt(0, 1.5, 0.45, 0.75);
        for (const sd of [-1, 1]) {
          const x = sd * 0.108;
          part(cyl(0.014, 0.01, 0.03, 6), silver, x, 1.525, 0, g);
          part(cone(0.016, 0.07, 6), violet, x, 1.565, 0, g).castShadow = false;
          glowAt(x, 1.56, 0.16, 0.8);
        }
        // The key, on two links of chain under the left horn.
        for (let i = 0; i < 2; i++) part(new THREE.TorusGeometry(0.008, 0.0025, 4, 8), silver, -0.08, 1.4 - i * 0.016, 0, g).rotation.y = i * PI_2;
        part(new THREE.TorusGeometry(0.014, 0.004, 4, 10), silver, -0.08, 1.37, 0, g);
        part(box(0.007, 0.07, 0.007), silver, -0.08, 1.322, 0, g);
        for (const y of [1.296, 1.31]) part(box(0.02, 0.007, 0.007), silver, -0.07, y, 0, g);
        spots = [[0, 1.0, 0.035, 0.08, 0], [0, 1.0, -0.035, 0.08, PI]];
        break;
      }
      // A gnarled oak staff: its head splits into three roots that wind up
      // round a floating ice-blue crystal, with leaves still growing at the
      // fork.
      const oak = mat(0x6a4a2a, { rough: 0.85 });
      const bark = mat(0x4a3220, { rough: 0.95 });
      const leaf = mat(0x5a8a3a, { rough: 0.8 });
      // The shaft wanders a little, as a grown branch does (straight at the hand).
      part(taperTube([[0, -0.4, 0], [0, 0, 0], [-0.009, 0.5, 0.006], [0, 1.0, 0], [0.006, 1.12, -0.004], [0, 1.22, 0]], (t) => 0.034 - t * 0.004, 24, 7), oak, 0, 0, 0, g);
      for (const [x, y, z] of [[0.028, 0.36, 0.008], [-0.03, 0.78, -0.006]]) part(sphere(0.016, 6, 5), bark, x, y, z, g).scale.set(1, 1.5, 1);
      part(cyl(0.04, 0.04, 0.24, 8), wrap, 0, 0, 0, g);
      cord(0.042, [-0.08, -0.04, 0, 0.04, 0.08]);
      part(cyl(0.039, 0.039, 0.03, 8), brass, 0, 0.16, 0, g);
      part(cone(0.036, 0.1, 8), brass, 0, -0.43, 0, g).rotation.x = PI;
      for (let k = 0; k < 3; k++) {
        const a0 = 0.3 + (k * 2 * PI) / 3;
        const root = [0, 1, 2, 3, 4, 5].map((i) => {
          const a = a0 + i * 0.28, rr = [0.012, 0.05, 0.085, 0.092, 0.065, 0.02][i];
          return [Math.cos(a) * rr, 1.19 + i * 0.075, Math.sin(a) * rr];
        });
        part(taperTube(root, (t) => 0.024 - t * 0.017, 16, 5), oak, 0, 0, 0, g);
        const sprig = part(bladeGeo([[0, 0], [0.018, 0.03], [0.012, 0.062], [0, 0.078], [-0.012, 0.062], [-0.018, 0.03]], 0.003), leaf, Math.cos(a0 + 1) * 0.04, 1.24, Math.sin(a0 + 1) * 0.04, g);
        sprig.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(a0 + 1), 0.35, Math.sin(a0 + 1)).normalize());
      }
      const crystal = part(new THREE.OctahedronGeometry(0.05, 0), mat(0x9ad8ff, { rough: 0.15, emissive: 0x3a9aff, emissiveIntensity: 1.6 }), 0, 1.42, 0, g);
      crystal.scale.set(1, 1.7, 1);
      crystal.rotation.y = 0.4;
      crystal.castShadow = false;
      const shine = glowSprite(0x60b0ff, 0.36, 0.7);
      shine.position.set(0, 1.42, 0);
      g.add(shine);
      const ribbon = mat(0x8a1c18, { rough: 0.9 });
      part(box(0.035, 0.3, 0.006), ribbon, 0.045, 1.02, 0.02, g).rotation.z = 0.12;
      part(box(0.03, 0.22, 0.006), ribbon, 0.03, 1.05, -0.03, g).rotation.set(0.2, 0.5, 0.18);
      part(cyl(0.036, 0.036, 0.03, 8), ribbon, 0, 1.15, 0, g);
      spots = [[0, 1.0, 0.0345, 0.08, 0], [0, 1.0, -0.0345, 0.08, PI]];
      break;
    }
    case 'trident': {
      // Poseidon's own is sea-green bronze and gold, with scallop shells on
      // its socket and sea water glowing down its points. The Drowned and the
      // fishers carry plain iron on driftwood, lashed on with rope.
      const shaft = legendary ? mat(0x2a6a7a, { rough: 0.35, metal: 0.4 }) : mat(0x6e5a44, { rough: 0.9 });
      const iron = legendary ? steel : mat(0x7a7e84, { rough: 0.45, metal: 0.45 });
      const rope = mat(0x9a8a62, { rough: 0.95 });
      part(cyl(0.028, 0.032, 1.9, 8), shaft, 0, 0.6, 0, g);
      part(cyl(0.036, 0.036, 0.26, 8), wrap, 0, 0, 0, g);
      cord(0.039, [-0.09, -0.03, 0.03, 0.09]);
      if (legendary) {
        // Gold bands, a gold spiral up to the head, and a pearl at the foot.
        for (const y of [0.18, 0.7]) part(cyl(0.036, 0.036, 0.03, 8), brass, 0, y, 0, g);
        const coil: number[][] = [];
        for (let i = 0; i <= 36; i++) {
          const a = i * 0.45;
          coil.push([Math.cos(a) * 0.029, 1.08 + i * 0.0102, Math.sin(a) * 0.029]);
        }
        part(taperTube(coil, () => 0.0055, 44, 4), brass, 0, 0, 0, g);
        part(cyl(0.036, 0.03, 0.05, 8), brass, 0, -0.37, 0, g);
        part(sphere(0.04, 8, 6), mat(0xf4ece0, { rough: 0.22, metal: 0.1 }), 0, -0.42, 0, g);
      } else {
        // An iron shoe at the foot, and rope lashing under the socket.
        part(cone(0.033, 0.11, 6), iron, 0, -0.405, 0, g).rotation.x = PI;
        cord(0.031, [0.7, 0.715, 1.36, 1.375, 1.39, 1.405], rope);
      }
      // The socket, and the head forged in one piece: the outer tines sweep
      // out from it and up, each ending in a flat barbed point.
      part(cyl(0.04, 0.03, 0.12, 8), iron, 0, 1.5, 0, g);
      part(new THREE.TorusGeometry(0.034, 0.008, 5, 12), legendary ? brass : iron, 0, 1.445, 0, g).rotation.x = PI / 2;
      for (const s of [-1, 1]) {
        const arm = [[0, 1.552, 0], [s * 0.05, 1.56, 0], [s * 0.105, 1.592, 0], [s * 0.135, 1.65, 0], [s * 0.142, 1.74, 0], [s * 0.138, 1.83, 0]];
        part(taperTube(arm, (t) => 0.021 - t * 0.008, 16, 5), iron, 0, 0, 0, g);
      }
      part(cyl(0.014, 0.021, 0.33, 6), iron, 0, 1.715, 0, g);
      const tine = legendary ? glow : iron;
      // Center point: barbed on both sides. Outer points: barbed outward only.
      part(bladeGeo([[-0.015, 0], [-0.05, -0.04], [-0.034, 0.035], [0, 0.15], [0.034, 0.035], [0.05, -0.04], [0.015, 0]], 0.008), tine, 0, 1.875, 0, g);
      for (const s of [-1, 1]) {
        const tip: [number, number][] = [[-0.013, 0], [-0.028, 0.03], [0, 0.125], [0.03, 0.03], [0.046, -0.036], [0.013, 0]];
        part(bladeGeo(tip.map(([x, y]) => [x * s, y] as [number, number]), 0.007), tine, s * 0.138, 1.825, 0, g);
      }
      if (legendary) {
        // A gold scallop shell on each face of the socket, ribbed, with a
        // pearl at its hinge.
        const fan: [number, number][] = [[0, 0]];
        for (let i = 0; i <= 12; i++) {
          const a = 0.15 + (i / 12) * (PI - 0.3);
          const r = i % 2 ? 0.072 : 0.06;
          fan.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
        const pearl = mat(0xf4ece0, { rough: 0.22, metal: 0.1 });
        for (const z of [-1, 1]) {
          const shell = pivot(g, 0, 1.445, z * 0.034);
          shell.rotation.x = z * 0.1;
          part(bladeGeo(fan, 0.006), brass, 0, 0, 0, shell);
          for (let i = 1; i < 12; i += 2) {
            const a = 0.15 + (i / 12) * (PI - 0.3);
            part(box(0.006, 0.058, 0.004), steel, Math.cos(a) * 0.035, Math.sin(a) * 0.035, z * 0.009, shell).rotation.z = a - PI / 2;
          }
          part(sphere(0.016, 8, 6), pearl, 0, 0.006, z * 0.012, shell);
        }
        // Water runs down the middle of each point.
        const sea = mat(0x7ae8f0, { rough: 0.15, emissive: 0x20b8e0, emissiveIntensity: 1.8 });
        for (const [x, y, h, face] of [[0, 1.935, 0.075, 0.0122], [-0.138, 1.885, 0.055, 0.0108], [0.138, 1.885, 0.055, 0.0108]]) {
          for (const z of [-1, 1]) part(box(0.008, h, 0.002), sea, x, y, z * face, g).castShadow = false;
        }
        const swell = glowSprite(0x40d8ff, 0.5, 0.55);
        swell.position.set(0, 1.6, 0);
        g.add(swell);
      }
      break;
    }
    case 'bolt': {
      // Zeus' thunderbolt: a gold grip in the hand, with forked lightning
      // flaring out of both ends, a white-hot core inside a blue glow.
      const core = mat(0xfff1a8, { emissive: 0xffd650, emissiveIntensity: 2.6 });
      const aura = mat(0x5ab0ff, { emissive: 0x2f86ff, emissiveIntensity: 2, transparent: 0.42 });
      const gold = mat(0xd8b050, { rough: 0.3, metal: 0.6 });
      part(cyl(0.032, 0.032, 0.24, 8), wrap, 0, 0, 0, g);
      cord(0.035, [-0.08, 0, 0.08], gold);
      /** One jagged stroke of lightning through 2D points (x, y), thinning toward its tip. */
      const stroke = (pts: [number, number][], w0: number, w1: number, glow: boolean) => {
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
          const len = Math.hypot(bx - ax, by - ay);
          const w = w0 + (w1 - w0) * ((i - 0.5) / (pts.length - 1));
          const seg = part(box(w, len + w * 0.6, w * 0.7), core, (ax + bx) / 2, (ay + by) / 2, 0, g);
          seg.rotation.z = Math.atan2(ax - bx, by - ay);
          if (glow) {
            const halo = part(box(w * 2.2, len + w, w * 1.8), aura, (ax + bx) / 2, (ay + by) / 2, 0, g);
            halo.rotation.z = seg.rotation.z;
            halo.castShadow = false;
          }
        }
        const [px, py] = pts[pts.length - 2], [tx, ty] = pts[pts.length - 1];
        const tip = part(cone(w1 * 1.4, 0.12, 4), core, tx + (tx - px) * 0.25, ty + (ty - py) * 0.25, 0, g);
        tip.rotation.z = Math.atan2(px - tx, ty - py);
      };
      for (const s of [-1, 1]) {
        // A gold collar flares from each end of the grip.
        part(new THREE.TorusGeometry(0.045, 0.012, 4, 10), gold, 0, s * 0.125, 0, g).rotation.x = PI / 2;
        part(cone(0.075, 0.1, 8), gold, 0, s * 0.18, 0, g).rotation.x = s > 0 ? 0 : PI;
        // The main bolt, mirrored through the grip so the two ends twist opposite ways.
        const main: [number, number][] = [[0, 0.22], [0.075, 0.38], [-0.05, 0.52], [0.065, 0.66], [-0.02, 0.8]];
        stroke(main.map(([x, y]) => [x * s, y * s]), 0.07, 0.035, true);
        // Two forks branch off to the sides.
        for (const side of [-1, 1]) {
          const fork: [number, number][] = [[0.05 * side, 0.22], [0.13 * side, 0.32], [0.1 * side, 0.4], [0.2 * side, 0.53]];
          stroke(fork.map(([x, y]) => [x * s, y * s]), 0.045, 0.022, false);
        }
      }
      break;
    }
    case 'bow': {
      // Vertical along local y: a riser in the hand, limbs curving back toward
      // -z to the string's ends at z -0.191, and recurved tips past them. The
      // group is turned so it sits upright in a raised left hand.
      const make = legendary ? 'moon' : id === 'copper-bow' ? 'copper' : id === 'elven-bow' ? 'elven' : 'hunting';
      const look = {
        hunting: { wood: 0x6a4426, dark: 0x3e2614, band: 0x4a3420, metal: false, grip: 0x3a2a1c, tip: 0xe8dcc0, wide: 1.5, r0: 0.027 },
        copper: { wood: 0x7a3a20, dark: 0x4a2010, band: 0xc8743c, metal: true, grip: 0x5a1c14, tip: 0xc8743c, wide: 1.5, r0: 0.028 },
        elven: { wood: 0xd0bc8c, dark: 0x8a7448, band: 0xd8b060, metal: true, grip: 0x3a5a3a, tip: 0xd8b060, wide: 1.25, r0: 0.024 },
        moon: { wood: 0xece8dc, dark: 0xa8b0d0, band: 0xd8dce8, metal: true, grip: 0x3a4a7a, tip: 0xd8dce8, wide: 1.35, r0: 0.026 },
      }[make];
      const wood = make === 'moon' ? mat(look.wood, { rough: 0.35, emissive: 0x8090ff, emissiveIntensity: 0.45 }) : mat(look.wood, { rough: 0.7 });
      const back = mat(look.dark, { rough: 0.8 });
      const band = look.metal ? mat(look.band, { rough: 0.35, metal: 0.55 }) : mat(look.band, { rough: 0.9 });
      const tipMat = look.metal ? band : mat(look.tip, { rough: 0.5 });
      const leather = mat(look.grip, { rough: 0.95 });
      // One limb, bottom to top (mirrored for the lower one): out of the riser, back to
      // the string's end at (0.74, -0.191), then curling forward again.
      const limb = [[0, 0.08, 0.004], [0, 0.26, -0.036], [0, 0.44, -0.097], [0, 0.6, -0.156], [0, 0.7, -0.187], [0, 0.742, -0.192], [0, 0.785, -0.172], [0, 0.82, -0.132]];
      const taper = (t: number) => look.r0 * (1 - 0.62 * t) * (1 + 0.25 * Math.max(0, 1 - Math.abs(t - 0.05) * 8));
      for (const s of [-1, 1]) {
        const pts = limb.map(([x, y, z]) => [x, s * y, z]);
        part(taperTube(pts, taper, 18, 6, look.wide), wood, 0, 0, 0, g);
        // A darker backing strip down the limb's back (the side facing away from the archer).
        part(taperTube(pts.slice(0, 6).map(([x, y, z]) => [x, y, z + 0.012]), (t) => look.r0 * 0.55 * (1 - 0.6 * t), 12, 4, look.wide * 1.1), back, 0, 0, 0, g);
        // Tip caps where the string loops on, and a band where the limb meets the riser.
        const tip = part(cone(look.r0 * 0.5, 0.06, 5), tipMat, 0, s * 0.836, -0.118, g);
        tip.rotation.x = s > 0 ? 0.75 : PI - 0.75;
        part(cyl(look.r0 * 1.25, look.r0 * 1.25, 0.022, 8), band, 0, s * 0.125, -0.002, g).scale.x = look.wide * 0.9;
        if (make === 'elven') {
          // Leaf blades at the tips.
          const leaf = bladeGeo([[0, 0], [0.028, 0.05], [0, 0.12], [-0.028, 0.05]], 0.004);
          const lf = part(leaf, band, 0, s * 0.8, -0.15, g);
          lf.rotation.set(s > 0 ? 0.9 : PI - 0.9, PI / 2, 0);
        }
      }
      // The riser: a shaped grip with a leather wrap and an arrow shelf.
      part(cyl(0.03, 0.03, 0.26, 8), mat(look.dark, { rough: 0.75 }), 0, 0, 0.004, g).scale.set(look.wide * 0.85, 1, 1);
      part(cyl(0.033, 0.033, 0.13, 8), leather, 0, -0.01, 0.004, g).scale.set(look.wide * 0.85, 1, 1);
      for (const y of [-0.06, -0.02, 0.02]) part(cyl(0.035, 0.035, 0.008, 8), band, 0, y, 0.004, g).scale.set(look.wide * 0.85, 1, 1);
      part(box(0.03, 0.02, 0.05), band, 0, 0.065, -0.012, g);
      if (make === 'moon') {
        // Artemis's crescent above the grip, and a moonlit glow.
        const crescent = new THREE.TorusGeometry(0.075, 0.012, 5, 14, PI * 1.25);
        const cm = part(crescent, mat(0xf0f4ff, { emissive: 0xa8b8ff, emissiveIntensity: 1.6 }), 0, 0.1, 0.03, g);
        cm.rotation.set(0, PI / 2, -PI * 0.12);
        const halo = glowSprite(0xb8c8ff, 0.5, 0.5);
        halo.position.set(0, 0.1, 0.03);
        g.add(halo);
      }
      // The string is two segments meeting at the nock, so it can be drawn back.
      const stringMat = mat(make === 'moon' ? 0xdfe8ff : 0xe8e2d0, { rough: 0.9, ...(make === 'moon' ? { emissive: 0x8090ff, emissiveIntensity: 0.6 } : {}) });
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
      g.userData.bow = { top, bottom, arrow, tipTop: new THREE.Vector3(0, 0.742, -0.191), tipBottom: new THREE.Vector3(0, -0.742, -0.191) };
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
      // Socket with flared wings, and a broad leaf head with a raised midrib.
      part(cyl(0.022, 0.03, 0.15, 8), darkSteel, 0, 1.45, 0, g);
      part(bladeGeo([[-0.075, 1.405], [0.075, 1.405], [0.03, 1.44], [-0.03, 1.44]], 0.014), darkSteel, 0, 0, 0, g);
      part(bladeGeo([[0, 1.47], [0.068, 1.57], [0.058, 1.69], [0, 1.9], [-0.058, 1.69], [-0.068, 1.57]], 0.012), legendary ? glow : steel, 0, 0, 0, g);
      part(box(0.014, 0.36, 0.034), steel, 0, 1.68, 0, g);
      break;
    }
    case 'quarterstaff': {
      // A plain fighting staff held at its middle, shod with iron at both
      // ends; ironwood is near black and bound in brass.
      const ironwood = id === 'ironwood-staff';
      const wood = mat(ironwood ? 0x3a2a20 : 0x9a7448, { rough: ironwood ? 0.55 : 0.8 });
      const shoe = ironwood ? brass : darkSteel;
      part(cyl(0.028, 0.028, 1.9, 8), wood, 0, 0.1, 0, g);
      part(cyl(0.032, 0.032, 0.28, 8), wrap, 0, 0, 0, g);
      cord(0.0335, [-0.12, -0.06, 0, 0.06, 0.12]);
      for (const y of [-0.85, 1.05]) {
        part(cyl(0.034, 0.034, 0.12, 8), shoe, 0, y, 0, g);
        part(cyl(0.036, 0.036, 0.02, 8), ironwood ? darkSteel : brass, 0, y + (y > 0 ? -0.07 : 0.07), 0, g);
        // Rivets through the shoe.
        for (const a of [0, PI_2, PI, -PI_2]) part(sphere(0.006, 4, 3), ironwood ? darkSteel : brass, Math.cos(a) * 0.034, y + (y > 0 ? 0.02 : -0.02), Math.sin(a) * 0.034, g);
      }
      part(sphere(0.034, 8, 5), shoe, 0, 1.11, 0, g);
      part(sphere(0.034, 8, 5), shoe, 0, -0.91, 0, g);
      for (const y of [-0.45, 0.65]) part(cyl(0.031, 0.031, 0.018, 8), brass, 0, y, 0, g);
      if (ironwood) for (const y of [-0.6, -0.3, 0.5, 0.8]) part(cyl(0.03, 0.03, 0.012, 8), brass, 0, y, 0, g);
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
      // Two crescent bits back to back, forged grey with a bright ground
      // edge, each with a forge-dark cheek.
      const inner: [number, number][] = [[0.215, 1.14], [0.24, 1.07], [0.252, 0.93], [0.24, 0.79], [0.215, 0.72]];
      const body: [number, number][] = [[0.03, 0.85], [0.12, 0.82], [0.19, 0.74], ...inner.slice().reverse(), [0.19, 1.12], [0.12, 1.04], [0.03, 1.01]];
      const ground: [number, number][] = [[0.235, 0.69], [0.27, 0.78], [0.285, 0.93], [0.27, 1.08], [0.235, 1.17], ...inner];
      const cheek = [[0.03, 0.86], [0.11, 0.85], [0.15, 0.93], [0.11, 1.01], [0.03, 1.0]];
      for (const s of [-1, 1]) {
        const forged = bladeGeo(body, 0.028);
        forged.rotateY(-s * PI_2);
        part(forged, mat(0x8e9298, { rough: 0.45, metal: 0.4 }), 0, 0, 0, g);
        const edge = bladeGeo(ground, 0.018);
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
    for (const [x, y, z, s, turn] of spots) glyph(rune, m, g, x, y, z, s, turn);
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

/**
 * What a beast of legend carries that no hero can take from it: a giant's
 * club, a fury's scourge and torch, a pirate's hook. Built along +y from the
 * grip like a weapon; left-hand things are marked off-hand.
 */
export function buildBossProp(id: string): THREE.Group {
  const g = new THREE.Group();
  g.userData.kind = 'hammer';
  switch (id) {
    default:
      part(cyl(0.05, 0.08, 1.2, 8), mat(0x5a3a22, { rough: 0.9 }), 0, 0.5, 0, g);
  }
  compact(g);
  return g;
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

/** A farmer's hoe: an ash shaft and an iron blade (held like a staff, harmless). */
export function buildHoe(): THREE.Object3D {
  const g = new THREE.Group();
  part(cyl(0.025, 0.03, 1.5, 6), mat(0x8a6a44, { rough: 0.8 }), 0, 0.55, 0, g);
  part(box(0.24, 0.12, 0.03), mat(0x5a5a5e, { rough: 0.5, metal: 0.6 }), 0, 1.28, 0.06, g).rotation.x = -0.35;
  return compact(g);
}

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
