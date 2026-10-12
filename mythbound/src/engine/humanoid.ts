// Humanoid heroes, townsfolk, humanoid monsters and humanoid bosses.
//
// A humanoid is one skinned mesh per surface (cloth/skin, metal, glow) bound
// to a skeleton of plain Groups, so a detailed character costs two or three
// draw calls while its waist, elbows, knees, cape and tail bend smoothly.
// animateHumanoid() builds a target pose from the AnimState every frame and
// eases each joint toward it with frame-rate independent damping, so states
// blend instead of snapping.

import * as THREE from 'three';
import { pivot } from './models';
import type { AnimState, AttackStyle } from './anim';

type O3 = THREE.Object3D;
const PI = Math.PI;
const TAU = PI * 2;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Smoothstep from edge a to edge b (b may be below a). */
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Fraction of the remaining distance to close this frame. */
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const shade = (hex: number, f: number) =>
  (Math.min(255, Math.round(((hex >> 16) & 255) * f)) << 16) | (Math.min(255, Math.round(((hex >> 8) & 255) * f)) << 8) | Math.min(255, Math.round((hex & 255) * f));

// --------------------------------------------------------------- the rig --

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
  // The finer joints of the skinned rig (always set by buildHumanoid).
  hips?: THREE.Group;
  spine?: THREE.Group;
  chest?: THREE.Group;
  foreArmL?: THREE.Group;
  foreArmR?: THREE.Group;
  shinL?: THREE.Group;
  shinR?: THREE.Group;
  footL?: THREE.Group;
  footR?: THREE.Group;
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

interface Joints {
  body: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  foreL: THREE.Group;
  handL: THREE.Group;
  armR: THREE.Group;
  foreR: THREE.Group;
  handR: THREE.Group;
  legL: THREE.Group;
  shinL: THREE.Group;
  footL: THREE.Group;
  legR: THREE.Group;
  shinR: THREE.Group;
  footR: THREE.Group;
  cape: THREE.Group[];
  tail: THREE.Group[];
  wings: THREE.Group | null;
  /** Left root, left tip, right root, right tip. */
  wing: THREE.Group[];
}

/** Body proportions: torso width/depth, limb thickness, fist size, shoulder and hip spacing. */
interface Dims {
  B: number;
  BZ: number;
  L: number;
  F: number;
  SX: number;
  HX: number;
}

/** Per-rig posture and motion character. */
interface Profile {
  robe: number;
  heavy: number;
  hunch: number;
  capeLift: number;
}

interface BuildOpts {
  bulk?: number;
  limb?: number;
  fist?: number;
  /** Armour is stone, not metal. */
  stone?: boolean;
  /** The extras build the head. */
  noHead?: boolean;
  extras?: (k: Kit, j: Joints, d: Dims) => void;
  posture?: Partial<Profile>;
}

// ------------------------------------------------------------ geometry --

type Ring = [y: number, rx: number, rz: number, cz?: number, cx?: number];

function indexed(pos: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A smooth shell through elliptical rings stacked bottom to top. `arc`
 * leaves a gap (angle 0 faces +z); `wave` nudges ring vertices up or down.
 */
function loft(rings: Ring[], seg: number, o: { bottom?: boolean; top?: boolean; arc?: [number, number]; wave?: (a: number, i: number) => number } = {}): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const per = o.arc ? seg + 1 : seg;
  rings.forEach(([y, rx, rz, cz = 0, cx = 0], i) => {
    for (let k = 0; k < per; k++) {
      const a = o.arc ? o.arc[0] + (k / seg) * o.arc[1] : (k / seg) * TAU;
      pos.push(cx + Math.sin(a) * rx, y + (o.wave ? o.wave(a, i) : 0), cz + Math.cos(a) * rz);
    }
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * per + k;
      const b = i * per + ((k + 1) % per);
      idx.push(a, b, a + per, b, b + per, a + per);
    }
  }
  const cap = (ring: number, up: boolean) => {
    const [y, , , cz = 0, cx = 0] = rings[ring];
    const c = pos.length / 3;
    pos.push(cx, y, cz);
    for (let k = 0; k < seg; k++) {
      const a = ring * per + k;
      const b = ring * per + ((k + 1) % per);
      if (up) idx.push(c, a, b);
      else idx.push(c, b, a);
    }
  };
  if (o.bottom) cap(0, false);
  if (o.top) cap(rings.length - 1, true);
  return indexed(pos, idx);
}

/** A tapered tube along a path; a last radius of 0 ends it in a point. */
function tube(path: number[][], radii: number[], seg = 6): THREE.BufferGeometry {
  const P = path.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const dir = P[P.length - 1].clone().sub(P[0]);
  const ax = [Math.abs(dir.x), Math.abs(dir.y), Math.abs(dir.z)];
  const ref = new THREE.Vector3(ax[0] <= ax[1] && ax[0] <= ax[2] ? 1 : 0, ax[1] < ax[0] && ax[1] <= ax[2] ? 1 : 0, ax[2] < ax[0] && ax[2] < ax[1] ? 1 : 0);
  const t = new THREE.Vector3();
  const b = new THREE.Vector3();
  const n = new THREE.Vector3();
  const pos: number[] = [];
  const idx: number[] = [];
  P.forEach((p, i) => {
    t.subVectors(P[Math.min(i + 1, P.length - 1)], P[Math.max(i - 1, 0)]).normalize();
    b.crossVectors(t, ref).normalize();
    n.crossVectors(b, t).normalize();
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * TAU;
      const c = Math.cos(a) * radii[i];
      const s = Math.sin(a) * radii[i];
      pos.push(p.x + b.x * c + n.x * s, p.y + b.y * c + n.y * s, p.z + b.z * c + n.z * s);
    }
  });
  for (let i = 0; i < P.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k;
      const c = i * seg + ((k + 1) % seg);
      idx.push(a, c, a + seg, c, c + seg, a + seg);
    }
  }
  // Face the winding outward.
  const v = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const face = new THREE.Vector3().crossVectors(v(1).sub(v(0)), v(seg).sub(v(0)));
  if (face.dot(v(0).sub(P[0])) < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  return indexed(pos, idx);
}

/** A copy facing the other way (the inside of an open shell). */
function inside(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const f = g.clone();
  const ix = f.index!;
  for (let i = 0; i < ix.count; i += 3) {
    const a = ix.getX(i + 1);
    ix.setX(i + 1, ix.getX(i + 2));
    ix.setX(i + 2, a);
  }
  const n = f.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return f;
}

/**
 * A hood: elliptical rings from the shoulders to a peak behind the crown,
 * open at the front by a gap that closes toward the top.
 */
function hoodShell(k: number): THREE.BufferGeometry {
  // [y, rx, rz, cz, gap half-angle]
  const rings = [[1.56, 0.17, 0.19, -0.02, 0.95], [1.64, 0.165, 0.2, -0.018, 0.8], [1.74, 0.158, 0.2, -0.02, 0.74], [1.83, 0.14, 0.185, -0.035, 0.6], [1.9, 0.105, 0.15, -0.06, 0.35], [1.95, 0.05, 0.09, -0.1, 0.0]];
  const seg = 12;
  const pos: number[] = [];
  const idx: number[] = [];
  rings.forEach(([y, rx, rz, cz, gap]) => {
    for (let i = 0; i <= seg; i++) {
      const a = gap + (i / seg) * (TAU - 2 * gap);
      pos.push(Math.sin(a) * rx * k, y, cz + Math.cos(a) * rz * k);
    }
  });
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < seg; i++) {
      const a = r * (seg + 1) + i;
      idx.push(a, a + 1, a + seg + 1, a + 1, a + seg + 2, a + seg + 1);
    }
  }
  // Close the top into a drooping point at the back.
  const c = pos.length / 3;
  pos.push(0, 1.9, -0.2 * k);
  const last = (rings.length - 1) * (seg + 1);
  for (let i = 0; i < seg; i++) idx.push(c, last + i, last + i + 1);
  return indexed(pos, idx);
}

/** A thin two-sided sheet from a grid of points (rows top to bottom). */
function sheet(rows: number, cols: number, at: (r: number, c: number) => [number, number, number], thick: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const make = (front: boolean) => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const [x, y, z] = at(r, c);
      pos.push(x, y, z + (front ? thick / 2 : -thick / 2));
    }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      if (front) idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      else idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
    }
    return indexed(pos, idx);
  };
  return [make(false), make(true)];
}

const ball = (w = 10, h = 8) => new THREE.SphereGeometry(1, w, h);
const dome = (w = 10, h = 5, cut = 0.5) => new THREE.SphereGeometry(1, w, h, 0, TAU, 0, PI * cut);
const cube = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const spike = (r: number, h: number, seg = 5) => new THREE.ConeGeometry(r, h, seg);
const rock = () => new THREE.DodecahedronGeometry(1, 0);
const shard = () => new THREE.OctahedronGeometry(1, 0);

// ------------------------------------------------- skinned mesh builder --

const MATTE = 0;
const METAL = 1;
const GLOW = 2;

type Skin = (x: number, y: number, z: number) => void;
const inf = { b: [] as O3[], w: [] as number[], n: 0 };
function put(b: O3, w: number) {
  if (w > 0.002 && inf.n < 4) {
    inf.b[inf.n] = b;
    inf.w[inf.n++] = w;
  }
}
/** Bone `a` above y + soft, bone `b` below y - soft, blended between. */
const splitY = (a: O3, b: O3, y: number, soft = 0.05): Skin => (_x, py) => {
  const t = smooth(y - soft, y + soft, py);
  put(a, t);
  put(b, 1 - t);
};
/** Along a chain of bones: bones[i] up to cuts[i] of an increasing coordinate. */
const chain = (bones: O3[], cuts: number[], soft: number, coord: (x: number, y: number, z: number) => number): Skin => (x, y, z) => {
  const c = coord(x, y, z);
  let i = 0;
  while (i < cuts.length && c > cuts[i] + soft) i++;
  if (i < cuts.length && c > cuts[i] - soft) {
    const t = smooth(cuts[i] - soft, cuts[i] + soft, c);
    put(bones[i], 1 - t);
    put(bones[i + 1], t);
  } else put(bones[i], 1);
};
const down = (_x: number, y: number) => -y;
/** Skirts and coat tails: rigid at the waist, following the thighs lower down. */
const skirt = (hips: O3, legL: O3, legR: O3, yTop: number, yFull: number, most: number): Skin => (x, y) => {
  const f = smooth(yTop, yFull, y) * most;
  const r = smooth(-0.07, 0.07, x);
  put(hips, 1 - f);
  put(legL, f * r);
  put(legR, f * (1 - r));
};

const surfaceMats: THREE.MeshStandardMaterial[] = [];
function surfaceMaterial(s: number): THREE.MeshStandardMaterial {
  let m = surfaceMats[s];
  if (!m) {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: s === METAL ? 0.42 : s === GLOW ? 0.5 : 0.82, metalness: s === METAL ? 0.45 : 0 });
    if (s === GLOW) {
      // Glow takes its colour from the vertices too, so one material serves every hue.
      m.emissive.setRGB(1, 1, 1);
      m.emissiveIntensity = 1.7;
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * vColor.rgb;');
      };
      m.customProgramCacheKey = () => 'humanoid-glow';
    }
    surfaceMats[s] = m;
  }
  return m;
}

const IDENTITY = new THREE.Matrix4();

/** Collects parts in bind-pose model space, then bakes them into skinned meshes. */
class Kit {
  readonly bones: O3[] = [];
  tris = 0;
  private bufs: { p: number[]; n: number[]; c: number[]; si: number[]; sw: number[]; ix: number[] }[] = [];
  private m = new THREE.Matrix4();
  private nm = new THREE.Matrix3();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private col = new THREE.Color();

  private bone(o: O3) {
    let i = this.bones.indexOf(o);
    if (i < 0) {
      i = this.bones.length;
      this.bones.push(o);
    }
    return i;
  }

  /** Adds a part, transformed by position/rotation/scale, bound to a bone or a weighting. */
  add(geo: THREE.BufferGeometry, surf: number, color: number, skin: O3 | Skin, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    const b = (this.bufs[surf] ??= { p: [], n: [], c: [], si: [], sw: [], ix: [] });
    this.m.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), this.sc.set(sx, sy, sz));
    this.nm.getNormalMatrix(this.m);
    const mirror = this.m.determinant() < 0;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const base = b.p.length / 3;
    this.col.set(color);
    for (let i = 0; i < pos.count; i++) {
      const v = this.v.fromBufferAttribute(pos, i).applyMatrix4(this.m);
      b.p.push(v.x, v.y, v.z);
      if (typeof skin === 'function') {
        inf.n = 0;
        skin(v.x, v.y, v.z);
        let sum = 0;
        for (let k = 0; k < inf.n; k++) sum += inf.w[k];
        for (let k = 0; k < 4; k++) {
          b.si.push(k < inf.n ? this.bone(inf.b[k]) : 0);
          b.sw.push(k < inf.n ? inf.w[k] / sum : 0);
        }
      } else {
        b.si.push(this.bone(skin), 0, 0, 0);
        b.sw.push(1, 0, 0, 0);
      }
      const n = this.v.fromBufferAttribute(nor, i).applyMatrix3(this.nm).normalize();
      b.n.push(n.x, n.y, n.z);
      b.c.push(this.col.r, this.col.g, this.col.b);
    }
    const index = geo.index;
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const i0 = base + (index ? index.getX(i) : i);
      const i1 = base + (index ? index.getX(i + 1) : i + 1);
      const i2 = base + (index ? index.getX(i + 2) : i + 2);
      if (mirror) b.ix.push(i0, i2, i1);
      else b.ix.push(i0, i1, i2);
    }
    this.tris += count / 3;
    geo.dispose();
  }

  finish(root: THREE.Group, radius: number): void {
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones as THREE.Bone[]);
    this.bufs.forEach((b, s) => {
      if (!b) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(b.sw, 4));
      g.setIndex(b.ix);
      // Poses reach well outside the bind pose; cull against a generous sphere.
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), radius);
      const mesh = new THREE.SkinnedMesh(g, surfaceMaterial(s));
      mesh.bind(skeleton, IDENTITY);
      mesh.boundingSphere = g.boundingSphere.clone();
      mesh.castShadow = s !== GLOW;
      mesh.userData.keep = true;
      root.add(mesh);
    });
  }
}

// ---------------------------------------------------------------- build --

const BOOT = 0x2a2018;
const LEATHER = 0x3a2a1c;
const SLIT = 0x07060a;

export function buildHumanoid(look: HumanoidLook): Rig {
  const { scale = 1, ...shape } = look;
  return instance(JSON.stringify(shape), scale, () => makeRig(shape));
}

// Each distinct look is built once; spawns clone it (shared geometry, their
// own joints and skeleton), which is far cheaper than building.
const templates = new Map<string, Rig>();

function instance(key: string, scale: number, build: () => Rig): Rig {
  let t = templates.get(key);
  if (!t) {
    t = build();
    t.root.traverse((o) => {
      // Shared for the whole session: a dying monster must not free it.
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose = () => {};
    });
    templates.set(key, t);
  }
  const rig = cloneRig(t);
  rig.root.scale.setScalar(scale);
  return rig;
}

function cloneRig(t: Rig): Rig {
  const root = t.root.clone();
  const map = new Map<O3, O3>();
  const pair = (a: O3, b: O3) => {
    map.set(a, b);
    a.children.forEach((c, i) => pair(c, b.children[i]));
  };
  pair(t.root, root);
  const m = <T extends O3>(o: T): T => map.get(o) as T;
  let skeleton: THREE.Skeleton | undefined;
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    skeleton ??= new THREE.Skeleton(mesh.skeleton.bones.map(m), mesh.skeleton.boneInverses);
    mesh.bind(skeleton, mesh.bindMatrix);
  });
  // Free the bone texture when the model leaves the scene for good.
  root.addEventListener('removed', () => skeleton?.dispose());
  const ts = states.get(t.root)!;
  const tj = ts.j;
  const j: Joints = {
    body: m(tj.body), hips: m(tj.hips), spine: m(tj.spine), chest: m(tj.chest), head: m(tj.head),
    armL: m(tj.armL), foreL: m(tj.foreL), handL: m(tj.handL), armR: m(tj.armR), foreR: m(tj.foreR), handR: m(tj.handR),
    legL: m(tj.legL), shinL: m(tj.shinL), footL: m(tj.footL), legR: m(tj.legR), shinR: m(tj.shinR), footR: m(tj.footR),
    cape: tj.cape.map(m), tail: tj.tail.map(m), wings: tj.wings && m(tj.wings), wing: tj.wing.map(m),
  };
  states.set(root, newState(j, ts.prof));
  return rigOf(root, j, t.height);
}

function rigOf(root: THREE.Group, j: Joints, height: number): Rig {
  const rig: Rig = {
    root, body: j.body, head: j.head, armL: j.armL, armR: j.armR, legL: j.legL, legR: j.legR, handR: j.handR, handL: j.handL, height,
    hips: j.hips, spine: j.spine, chest: j.chest, foreArmL: j.foreL, foreArmR: j.foreR, shinL: j.shinL, shinR: j.shinR, footL: j.footL, footR: j.footR,
  };
  if (j.cape.length) rig.cape = j.cape[0];
  if (j.tail.length) rig.tail = j.tail[0];
  if (j.wings) rig.wings = j.wings;
  return rig;
}

function makeRig(look: Omit<HumanoidLook, 'scale'>, o: BuildOpts = {}): Rig {
  const B = o.bulk ?? 1;
  const d: Dims = { B, BZ: 1 + (B - 1) * 0.7, L: o.limb ?? 1, F: o.fist ?? 1, SX: 0.235 * B, HX: 0.1 * (1 + (B - 1) * 0.6) };
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const hips = pivot(body, 0, 0.98, 0);
  const spine = pivot(hips, 0, 0.12, 0);
  const chest = pivot(spine, 0, 0.22, 0);
  const head = pivot(chest, 0, 0.28, 0);
  // The anatomical left side is +x (the model faces +z).
  const armL = pivot(chest, d.SX, 0.17, 0);
  const armR = pivot(chest, -d.SX, 0.17, 0);
  const foreL = pivot(armL, 0, -0.285, 0);
  const foreR = pivot(armR, 0, -0.285, 0);
  // Shields and bows hang off the left hand; turned so their outside faces out.
  const handL = pivot(foreL, 0, -0.27, 0.035);
  handL.rotation.y = PI;
  // Weapons: blade along the hand's +y, pointing forward when the arm hangs.
  const handR = pivot(foreR, 0, -0.28, 0.02);
  handR.rotation.order = 'YXZ';
  handR.rotation.x = PI / 2;
  const legL = pivot(hips, d.HX, -0.05, 0);
  const legR = pivot(hips, -d.HX, -0.05, 0);
  const shinL = pivot(legL, 0, -0.43, 0);
  const shinR = pivot(legR, 0, -0.43, 0);
  const footL = pivot(shinL, 0, -0.415, 0);
  const footR = pivot(shinR, 0, -0.415, 0);
  const j: Joints = { body, hips, spine, chest, head, armL, foreL, handL, armR, foreR, handR, legL, shinL, footL, legR, shinR, footR, cape: [], tail: [], wings: null, wing: [] };

  const k = new Kit();
  buildBody(k, j, look, d, o);
  if (!o.noHead) buildHead(k, j, look);
  if (look.cape !== undefined) buildCape(k, j, look.cape, look.accent, d);
  if (look.tail) buildTail(k, j, look.skin);
  if (look.wings) buildWings(k, j, look.skin);
  o.extras?.(k, j, d);
  k.finish(root, 2.6);

  const prof: Profile = { robe: look.build === 'robe' ? 1 : 0, heavy: look.build === 'heavy' ? 0.4 : 0, hunch: 0, capeLift: look.tail ? 0.3 : 0, ...o.posture };
  states.set(root, newState(j, prof));
  root.userData.tris = k.tris;
  return rigOf(root, j, 1.85);
}

function buildBody(k: Kit, j: Joints, look: Omit<HumanoidLook, 'scale'>, d: Dims, o: BuildOpts) {
  const { B, BZ, L, F, SX, HX } = d;
  const { hips, spine, chest, armL, foreL, handL, armR, foreR, handR, legL, shinL, footL, legR, shinR, footR } = j;
  const heavy = look.build === 'heavy';
  const robe = look.build === 'robe';
  const bony = look.head === 'skull';
  const armorS = heavy && !o.stone ? METAL : MATTE;
  const { skin, armor, cloth, accent } = look;
  const T = (rings: Ring[]): Ring[] => rings.map(([y, rx, rz, cz = 0, cx = 0]) => [y, rx * B, rz * BZ, cz * BZ, cx]);
  const torsoW = chain([hips, spine, chest], [1.07, 1.3], 0.06, (_x, y) => y);
  const sides: [number, THREE.Group, THREE.Group, THREE.Group, THREE.Group, THREE.Group, THREE.Group][] = [
    [1, armL, foreL, handL, legL, shinL, footL],
    [-1, armR, foreR, handR, legR, shinR, footR],
  ];
  const legW = (leg: O3, shin: O3, foot: O3): Skin => (_x, y) => {
    if (y > 0.84) {
      const t = smooth(0.84, 1.0, y) * 0.45;
      put(hips, t);
      put(leg, 1 - t);
    } else if (y > 0.13) {
      const t = smooth(0.55, 0.45, y);
      put(leg, 1 - t);
      put(shin, t);
    } else {
      const t = smooth(0.13, 0.07, y);
      put(shin, 1 - t);
      put(foot, t);
    }
  };
  const armW = (arm: O3, fore: O3) => chain([arm, fore], [-1.205], 0.045, down);
  const boot = (x: number, foot: O3, color: number, surf: number, s = 1) => {
    // Built along +y, then laid along +z (ring depth becomes height).
    const g = loft([[-0.075, 0.042 * s, 0.035, -0.04], [-0.055, 0.052 * s, 0.052, -0.055], [0.0, 0.056 * s, 0.062, -0.062], [0.08, 0.057 * s, 0.047, -0.047], [0.15, 0.05 * s, 0.036, -0.036], [0.195, 0.028 * s, 0.022, -0.024]], 6, { bottom: true, top: true });
    k.add(g, surf, color, foot, x, 0, 0.0, PI / 2);
  };
  const fist = (x: number, hand: O3, color: number, surf: number, s = 1) => {
    k.add(ball(7, 5), surf, color, hand, x, 0.905, 0.025, 0, 0, 0, 0.042 * F * s, 0.058 * F * s, 0.05 * F * s);
  };
  /** Rivets round a shoulder dome (centre, radii, tilt) on its outer side, just above the rim. */
  const rivets = (skinTo: O3 | Skin, side: number, c: [number, number, number], r: [number, number, number], tilt: number, color: number) => {
    for (const da of [-0.75, 0, 0.75]) {
      const a = (side > 0 ? 0 : PI) + da;
      const lx = Math.cos(a) * Math.sin(1.2) * r[0] * 1.04, ly = Math.cos(1.2) * r[1] * 1.04, lz = Math.sin(a) * Math.sin(1.2) * r[2] * 1.04;
      k.add(ball(4, 3), METAL, color, skinTo, c[0] + lx * Math.cos(tilt) - ly * Math.sin(tilt), c[1] + lx * Math.sin(tilt) + ly * Math.cos(tilt), c[2] + lz, 0, 0, 0, 0.011, 0.011, 0.011);
    }
  };

  if (bony) {
    // Restless bones: a ribcage on a spine, bony limbs, rags and rusty scraps.
    const bone = skin;
    k.add(tube([[0, 0.92, -0.05], [0, 1.1, -0.075], [0, 1.3, -0.07], [0, 1.48, -0.045], [0, 1.64, -0.01]], [0.03, 0.028, 0.028, 0.025, 0.022], 6), MATTE, bone, torsoW);
    for (let i = 0; i < 4; i++) {
      const y = 1.2 + i * 0.075;
      const w = [0.15, 0.165, 0.165, 0.145][i] * B;
      k.add(new THREE.TorusGeometry(1, 0.1, 3, 12), MATTE, shade(bone, 0.95 - i * 0.03), chest, 0, y, 0.012, PI / 2, 0, 0, w, 0.11 * BZ, 0.12);
    }
    k.add(cube(0.035, 0.22, 0.02), MATTE, bone, chest, 0, 1.33, 0.118 * BZ, -0.1);
    k.add(new THREE.TorusGeometry(1, 0.18, 4, 12), MATTE, bone, hips, 0, 0.95, -0.005, PI / 2 - 0.25, 0, 0, 0.14 * B, 0.095, 0.15);
    for (const [s] of sides) k.add(tube([[s * 0.03, 1.54, 0.07], [s * SX * 0.6, 1.53, 0.05], [s * SX, 1.5, 0.0]], [0.016, 0.016, 0.014], 4), MATTE, bone, chest);
    for (const [s, arm, fore, hand, leg, shin, foot] of sides) {
      k.add(loft([[0.93, 0.02, 0.018], [1.2, 0.024, 0.022], [1.46, 0.028, 0.026], [1.52, 0.03, 0.03]], 6, { top: true }).translate(s * SX, 0, 0), MATTE, bone, armW(arm, fore));
      k.add(ball(6, 5), MATTE, bone, armW(arm, fore), s * SX, 1.205, -0.005, 0, 0, 0, 0.034, 0.034, 0.034);
      k.add(ball(7, 5), MATTE, bone, arm, s * SX, 1.5, 0, 0, 0, 0, 0.045, 0.045, 0.045);
      k.add(ball(6, 5), MATTE, bone, hand, s * SX, 0.905, 0.02, 0, 0, 0, 0.035, 0.05, 0.04);
      k.add(loft([[0.08, 0.024, 0.024], [0.48, 0.03, 0.03], [0.9, 0.034, 0.034], [0.97, 0.03, 0.03]], 6).translate(s * HX, 0, 0), MATTE, bone, legW(leg, shin, foot));
      k.add(ball(6, 5), MATTE, bone, splitY(leg, shin, 0.5, 0.02), s * HX, 0.5, 0.01, 0, 0, 0, 0.04, 0.04, 0.04);
      k.add(cube(0.06, 0.04, 0.17), MATTE, shade(bone, 0.9), foot, s * HX, 0.03, 0.045);
    }
    // Rags, belt and a rusted pauldron.
    k.add(cube(0.16, 0.34, 0.012), MATTE, cloth, skirt(hips, legL, legR, 0.95, 0.65, 0.55), 0, 0.8, 0.1 * BZ, -0.06);
    k.add(cube(0.2, 0.38, 0.012), MATTE, shade(cloth, 0.8), skirt(hips, legL, legR, 0.95, 0.65, 0.55), 0, 0.78, -0.1 * BZ, 0.08);
    k.add(loft([[0.95, 0.165 * B, 0.11 * BZ], [0.99, 0.165 * B, 0.11 * BZ]], 10), MATTE, LEATHER, hips);
    k.add(dome(8, 4), METAL, armor, armL, SX * 1.05, 1.5, 0, 0, 0, -0.35, 0.1, 0.075, 0.1);
    k.add(dome(8, 3), METAL, shade(armor, 0.85), armL, SX * 1.08, 1.45, 0, 0, 0, -0.4, 0.1, 0.06, 0.1);
    k.add(loft([[0.97, 0.034, 0.032], [1.12, 0.036, 0.034]], 6).translate(-SX, 0, 0), METAL, shade(armor, 0.8), foreR);
    return;
  }

  // Neck.
  k.add(loft([[1.5, 0.056 * Math.sqrt(B), 0.056, -0.008], [1.62, 0.05 * Math.sqrt(B), 0.05, 0], [1.71, 0.047, 0.047, 0.006]], 8), MATTE, skin, splitY(j.head, chest, 1.62, 0.04));

  // Hips (trousers) under everything but robes.
  const trousers = heavy ? shade(cloth, 0.9) : shade(cloth, 0.85);
  if (!robe) k.add(loft(T([[0.835, 0.09, 0.075, 0.0], [0.88, 0.15, 0.106, -0.004], [0.95, 0.178, 0.12, -0.01], [1.03, 0.172, 0.116, -0.004], [1.08, 0.166, 0.112, 0]]), 12, { bottom: true }), MATTE, trousers, hips);

  if (heavy) {
    // Cuirass with a centre ridge, faulds, belt and buckle, gorget.
    k.add(loft(T([[0.98, 0.18, 0.125, -0.005], [1.06, 0.175, 0.122, 0.002], [1.16, 0.188, 0.132, 0.014], [1.28, 0.212, 0.146, 0.024], [1.39, 0.226, 0.146, 0.022], [1.47, 0.222, 0.13, 0.01], [1.53, 0.19, 0.11, 0.0], [1.58, 0.12, 0.088, -0.005]]), 12), armorS, armor, torsoW);
    k.add(cube(0.024, 0.34, 0.03), armorS, shade(armor, 1.18), torsoW, 0, 1.3, 0.162 * BZ, -0.14);
    k.add(loft(T([[0.9, 0.2, 0.142, -0.006], [0.95, 0.196, 0.137, -0.006], [0.95, 0.186, 0.13, 0], [1.0, 0.184, 0.128, 0]]), 12), armorS, shade(armor, 0.88), hips);
    k.add(loft(T([[0.995, 0.19, 0.134], [1.04, 0.187, 0.131]]), 12), MATTE, LEATHER, hips);
    k.add(cube(0.07, 0.055, 0.025), METAL, accent, hips, 0, 1.017, 0.134 * BZ);
    k.add(loft([[1.52, 0.135 * B, 0.104 * BZ, -0.006], [1.58, 0.118 * B, 0.096 * BZ, -0.006], [1.645, 0.084, 0.08, 0]], 12), armorS, shade(armor, 0.94), chest);
    if (!o.stone) {
      // Overlapping lames across the belly, a trimmed neckline, an emblem on the breast.
      for (const [y, rx, rz, cz] of [[1.04, 0.181, 0.127, 0.0], [1.1, 0.186, 0.131, 0.007]]) k.add(loft(T([[y, rx, rz, cz], [y + 0.022, rx + 0.002, rz + 0.002, cz]]), 12), armorS, shade(armor, 1.12), torsoW);
      k.add(loft(T([[1.5, 0.209, 0.124, 0.006], [1.535, 0.19, 0.114, 0.001]]), 12), METAL, accent, torsoW);
      k.add(shard(), METAL, accent, torsoW, 0, 1.38, 0.168 * BZ, -0.12, 0, 0, 0.045, 0.06, 0.012);
    }
    // Tabard and tasset skirt.
    const sk = skirt(hips, legL, legR, 0.95, 0.62, 0.55);
    k.add(cube(0.17, 0.42, 0.012), MATTE, cloth, sk, 0, 0.78, 0.136 * BZ, -0.07);
    k.add(cube(0.2, 0.44, 0.012), MATTE, shade(cloth, 0.85), sk, 0, 0.77, -0.134 * BZ, 0.07);
    for (const [s, , , , leg] of sides) {
      const tw: Skin = (_x, y) => {
        const f = smooth(0.94, 0.7, y) * 0.6;
        put(hips, 1 - f);
        put(leg, f);
      };
      for (let row = 0; row < 2; row++) {
        const y = 0.885 - row * 0.1;
        const out = row * 0.012;
        k.add(cube(0.13, 0.13, 0.016), armorS, shade(armor, 0.95 - row * 0.08), tw, s * 0.105 * B, y, (0.128 + out) * BZ, -0.14, s * 0.42, 0);
        k.add(cube(0.12, 0.13, 0.016), armorS, shade(armor, 0.92 - row * 0.08), tw, s * (0.19 + out) * B, y, 0.0, 0, s * PI / 2, s * 0.13);
      }
    }
  } else if (robe) {
    k.add(loft(T([[0.96, 0.186, 0.13, -0.004], [1.06, 0.172, 0.12, 0.002], [1.16, 0.176, 0.124, 0.01], [1.28, 0.2, 0.136, 0.02], [1.39, 0.212, 0.136, 0.018], [1.47, 0.208, 0.122, 0.008], [1.54, 0.17, 0.1, 0], [1.6, 0.1, 0.078, -0.004]]), 12), MATTE, cloth, torsoW);
    for (const s of [-1, 1]) k.add(cube(0.03, 0.4, 0.012), METAL, accent, torsoW, s * 0.055 * B, 1.33, 0.152 * BZ, -0.12, 0, s * 0.22);
    // Layered robe: an inner hem to the ground, a dagged outer layer over it.
    const sk = skirt(hips, legL, legR, 1.0, 0.3, 0.72);
    k.add(loft(T([[0.03, 0.3, 0.27, -0.02], [0.3, 0.272, 0.232, -0.012], [0.62, 0.236, 0.186, -0.004], [0.9, 0.2, 0.14, 0], [1.02, 0.188, 0.13, 0]]), 14, { bottom: true }), MATTE, shade(cloth, 0.62), sk);
    k.add(loft(T([[0.22, 0.326, 0.294, -0.02], [0.46, 0.292, 0.252, -0.012], [0.7, 0.252, 0.2, -0.005], [0.92, 0.21, 0.15, 0], [1.04, 0.196, 0.138, 0]]), 14, { wave: (a, i) => (i === 0 ? 0.035 * Math.sin(a * 7) + 0.07 * Math.max(0, Math.cos(a)) : 0) }), MATTE, cloth, sk);
    // Sash with hanging ends; a shoulder mantle.
    k.add(loft(T([[0.99, 0.2, 0.142], [1.06, 0.192, 0.136]]), 14), MATTE, accent, hips);
    k.add(cube(0.05, 0.3, 0.012), MATTE, accent, skirt(hips, legL, legR, 1.0, 0.7, 0.5), 0.09 * B, 0.86, 0.15 * BZ, -0.08, 0, 0.08);
    k.add(cube(0.045, 0.24, 0.012), MATTE, shade(accent, 0.85), skirt(hips, legL, legR, 1.0, 0.7, 0.5), 0.135 * B, 0.88, 0.14 * BZ, -0.08, 0.3, 0.14);
    k.add(loft(T([[1.37, 0.27, 0.18, -0.01], [1.46, 0.252, 0.164, -0.004], [1.54, 0.182, 0.126, 0], [1.6, 0.11, 0.09, -0.005]]), 14), MATTE, shade(cloth, 0.78), chest);
    k.add(loft(T([[0.04, 0.303, 0.273, -0.02], [0.085, 0.299, 0.267, -0.019]]), 14), MATTE, accent, sk);
    // An amulet on a chain below the mantle.
    for (const t of [-1, 1]) k.add(tube([[t * 0.075 * B, 1.375, 0.168 * BZ], [t * 0.04 * B, 1.335, 0.168 * BZ], [0, 1.31, 0.164 * BZ]], [0.004, 0.004, 0.004], 3), METAL, accent, chest);
    k.add(ball(6, 4), METAL, accent, chest, 0, 1.29, 0.16 * BZ, 0, 0, 0, 0.026, 0.032, 0.012);
    k.add(shard(), GLOW, 0x8fd0ff, chest, 0, 1.29, 0.171 * BZ, 0, 0, 0, 0.015, 0.021, 0.008);
  } else {
    // Leather jerkin, coat tails open at the front, belt, pouch.
    k.add(loft(T([[0.96, 0.182, 0.125, -0.006], [1.05, 0.17, 0.118, 0.002], [1.15, 0.174, 0.122, 0.01], [1.27, 0.198, 0.136, 0.02], [1.38, 0.21, 0.135, 0.018], [1.46, 0.206, 0.12, 0.008], [1.53, 0.17, 0.1, 0], [1.585, 0.11, 0.08, -0.004]]), 12), MATTE, armor, torsoW);
    const coat = loft(T([[0.6, 0.218, 0.172, -0.012], [0.78, 0.202, 0.156, -0.008], [0.93, 0.186, 0.133, -0.006], [1.0, 0.18, 0.126, -0.005]]), 12, { arc: [0.32, TAU - 0.64], wave: (a, i) => (i === 0 ? 0.02 * Math.sin(a * 5) : 0) });
    const sk = skirt(hips, legL, legR, 0.96, 0.62, 0.7);
    k.add(inside(coat), MATTE, shade(armor, 0.55), sk);
    k.add(coat, MATTE, shade(armor, 0.9), sk);
    k.add(loft(T([[0.985, 0.19, 0.133], [1.035, 0.187, 0.13]]), 12), MATTE, LEATHER, hips);
    k.add(cube(0.055, 0.045, 0.022), METAL, accent, hips, 0, 1.01, 0.132 * BZ);
    k.add(cube(0.075, 0.085, 0.05), MATTE, shade(LEATHER, 1.2), hips, -0.17 * B, 0.95, 0.07, 0, -0.5, 0);
    k.add(cube(0.08, 0.035, 0.056), MATTE, shade(LEATHER, 0.95), hips, -0.17 * B, 0.985, 0.07, 0, -0.5, 0);
    k.add(cube(0.016, 0.016, 0.006), METAL, accent, hips, -0.17 * B - 0.013, 0.975, 0.094);
    k.add(cube(0.055, 0.065, 0.04), MATTE, shade(LEATHER, 1.1), hips, 0.165 * B, 0.95, 0.085, 0, 0.55, 0);
    k.add(cube(0.06, 0.03, 0.045), MATTE, shade(LEATHER, 0.9), hips, 0.165 * B, 0.978, 0.085, 0, 0.55, 0);
    // Studded leather over the belly.
    for (const [y, rx, rz, cz] of [[1.075, 0.172, 0.12, 0.004], [1.14, 0.176, 0.123, 0.009]]) {
      for (let i = -3; i <= 3; i++) {
        const a = i * 0.36 + (y > 1.1 ? 0.18 : 0);
        k.add(ball(4, 3), METAL, accent, torsoW, Math.sin(a) * rx * B * 1.02, y, (cz + Math.cos(a) * rz * 1.02) * BZ, 0, 0, 0, 0.0095, 0.0095, 0.0095);
      }
    }
    // Laced up the left side of the chest.
    k.add(cube(0.008, 0.13, 0.006), MATTE, shade(armor, 0.35), torsoW, 0.075 * B, 1.265, 0.147 * BZ, -0.12, 0.3, 0);
    for (const [y, z] of [[1.22, 0.142], [1.265, 0.15], [1.31, 0.152]]) {
      for (const t of [-1, 1]) k.add(cube(0.04, 0.006, 0.005), MATTE, 0xc8b48a, torsoW, 0.075 * B, y, (z + 0.004) * BZ, 0, 0.3, t * 0.6);
    }
    if (look.head !== 'hood') {
      // Scarf.
      k.add(new THREE.TorusGeometry(0.1, 0.032, 5, 12), MATTE, accent, chest, 0, 1.585, 0.0, PI / 2 - 0.15, 0, 0, 1.12 * B, 1, 1);
      k.add(cube(0.06, 0.2, 0.016), MATTE, shade(accent, 0.9), chest, 0.06, 1.45, 0.135 * BZ, -0.12, 0, 0.12);
    }
    // A leather pad on the left shoulder; a baldric across chest and back.
    k.add(dome(8, 4), MATTE, shade(armor, 0.8), armL, SX * 1.03, 1.49, 0, 0, 0, -0.4, 0.1 * B, 0.075, 0.1 * B);
    rivets(armL, 1, [SX * 1.03, 1.49, 0], [0.1 * B, 0.075, 0.1 * B], -0.4, accent);
    k.add(cube(0.045, 0.6, 0.014), MATTE, LEATHER, torsoW, -0.02 * B, 1.27, 0.15 * BZ, -0.08, 0, 0.62);
    k.add(cube(0.045, 0.6, 0.014), MATTE, LEATHER, torsoW, -0.02 * B, 1.27, -0.145 * BZ, 0.06, 0, -0.62);
    k.add(cube(0.03, 0.035, 0.016), METAL, accent, torsoW, -0.06 * B, 1.33, 0.162 * BZ, -0.08, 0, 0.62);
  }

  // Arms.
  const armRings = (r: number): Ring[] => [[0.95, 0.036 * r, 0.033 * r, 0.004], [1.1, 0.047 * r, 0.044 * r, 0.006], [1.205, 0.046 * r, 0.044 * r], [1.32, 0.054 * r, 0.052 * r], [1.44, 0.064 * r, 0.06 * r], [1.51, 0.06 * r, 0.056 * r], [1.555, 0.03 * r, 0.03 * r]];
  for (const [s, arm, fore, hand] of sides) {
    const aw = armW(arm, fore);
    const x = s * SX;
    if (robe) {
      // Wide sleeves with a shadowed opening.
      k.add(loft([[0.965, 0.1 * L, 0.095 * L, 0.01], [1.05, 0.084 * L, 0.08 * L, 0.006], [1.2, 0.062 * L, 0.06 * L], [1.36, 0.062 * L, 0.06 * L], [1.47, 0.068 * L, 0.064 * L], [1.555, 0.035, 0.035]], 10, { top: true }).translate(x, 0, 0), MATTE, cloth, aw);
      k.add(new THREE.CircleGeometry(1, 10), MATTE, shade(cloth, 0.25), fore, x, 0.975, 0.01, PI / 2, 0, 0, 0.09 * L, 0.085 * L, 1);
      k.add(loft([[0.965, 0.103 * L, 0.098 * L, 0.01], [1.0, 0.098 * L, 0.093 * L, 0.009]], 10).translate(x, 0, 0), MATTE, look.accent, aw);
      k.add(loft([[0.94, 0.034, 0.03], [1.0, 0.038, 0.034]], 6, {}).translate(x, 0, 0.004), MATTE, skin, fore);
      fist(x, hand, skin, MATTE);
      continue;
    }
    k.add(loft(armRings(L), 8, { top: true }).translate(x, 0, 0), MATTE, heavy ? shade(cloth, 0.8) : cloth, aw);
    if (!heavy) k.add(ball(7, 5), MATTE, cloth, arm, x, 1.485, 0, 0, 0, 0, 0.068 * L, 0.068 * L, 0.064 * L);
    if (heavy) {
      // Layered pauldron with a trim, rerebrace, couter, vambrace, gauntlet.
      const pw: Skin = (_x, y) => {
        const t = smooth(1.46, 1.6, y) * 0.35;
        put(chest, t);
        put(arm, 1 - t);
      };
      const px = s * SX * 1.03;
      k.add(dome(9, 4), armorS, armor, pw, px, 1.5, 0, 0, 0, -s * 0.32, 0.135 * B, 0.1, 0.13 * BZ);
      if (!o.stone) rivets(pw, s, [px, 1.5, 0], [0.135 * B, 0.1, 0.13 * BZ], -s * 0.32, accent);
      k.add(new THREE.TorusGeometry(1, 0.07, 3, 10), METAL, accent, pw, px, 1.5, 0, PI / 2, -s * 0.32, 0, 0.137 * B, 0.132 * BZ, 0.12);
      k.add(dome(9, 2, 0.4), armorS, shade(armor, 0.85), arm, s * SX * 1.06, 1.445, 0, 0, 0, -s * 0.42, 0.13 * B, 0.07, 0.125 * BZ);
      k.add(dome(9, 2, 0.4), armorS, shade(armor, 0.75), arm, s * SX * 1.08, 1.395, 0, 0, 0, -s * 0.5, 0.12 * B, 0.06, 0.115 * BZ);
      k.add(loft([[1.25, 0.058 * L, 0.056 * L], [1.33, 0.064 * L, 0.062 * L], [1.4, 0.066 * L, 0.064 * L]], 8).translate(x, 0, 0), armorS, shade(armor, 0.9), arm);
      k.add(ball(6, 4), armorS, armor, splitY(arm, fore, 1.205, 0.08), x, 1.205, -0.01, 0, 0, 0, 0.056 * L, 0.05 * L, 0.056 * L);
      if (!o.stone) k.add(cube(0.012, 0.075 * L, 0.075 * L), armorS, shade(armor, 1.05), splitY(arm, fore, 1.205, 0.08), x + s * 0.056 * L, 1.205, -0.01, PI / 4, 0, 0);
      k.add(loft([[0.975, 0.047 * L, 0.044 * L, 0.004], [1.07, 0.054 * L, 0.051 * L, 0.006], [1.17, 0.057 * L, 0.054 * L, 0.006]], 8).translate(x, 0, 0), armorS, armor, fore);
      k.add(loft([[0.935, 0.05 * L, 0.048 * L, 0.01], [0.995, 0.06 * L, 0.057 * L, 0.008]], 8).translate(x, 0, 0), armorS, shade(armor, 0.9), hand);
      fist(x, hand, shade(armor, 0.8), armorS, 1.08);
      if (!o.stone) k.add(cube(0.014, 0.05 * F, 0.055 * F), armorS, shade(armor, 1.1), hand, x + s * 0.044 * F, 0.915, 0.025);
    } else {
      // Bracers and gloves.
      k.add(loft([[0.965, 0.044 * L, 0.041 * L, 0.004], [1.06, 0.05 * L, 0.047 * L, 0.006], [1.15, 0.054 * L, 0.051 * L, 0.006]], 8).translate(x, 0, 0), MATTE, shade(armor, 0.75), fore);
      k.add(loft([[1.02, 0.052 * L, 0.049 * L, 0.006], [1.04, 0.052 * L, 0.049 * L, 0.006]], 8).translate(x, 0, 0), METAL, accent, fore);
      fist(x, hand, look.head === 'bare' || look.head === 'crown' || look.head === 'hat' ? skin : shade(armor, 0.55), MATTE);
    }
  }

  // Legs.
  for (const [s, , , , leg, shin, foot] of sides) {
    const x = s * HX;
    const lw = legW(leg, shin, foot);
    const r = (robe ? 0.82 : 1) * L;
    k.add(loft([[0.07, 0.04 * r, 0.045 * r, 0.0], [0.3, 0.056 * r, 0.064 * r, -0.012], [0.5, 0.054 * r, 0.057 * r, 0], [0.62, 0.066 * r, 0.07 * r, 0], [0.78, 0.078 * r, 0.082 * r, 0], [0.9, 0.084 * r, 0.088 * r, -0.005], [0.98, 0.08 * r, 0.085 * r, -0.01]], 8).translate(x, 0, 0), MATTE, trousers, lw);
    if (heavy) {
      k.add(loft([[0.6, 0.074 * L, 0.078 * L, 0.006], [0.74, 0.086 * L, 0.09 * L, 0.006], [0.86, 0.092 * L, 0.096 * L, 0.0]], 8).translate(x, 0, 0), armorS, shade(armor, 0.92), leg);
      k.add(ball(6, 4), armorS, armor, splitY(leg, shin, 0.5, 0.06), x, 0.505, 0.035, 0, 0, 0, 0.062 * L, 0.058 * L, 0.055 * L);
      k.add(cube(0.08 * L, 0.05, 0.02), armorS, shade(armor, 0.85), splitY(leg, shin, 0.5, 0.06), x + s * 0.045 * L, 0.5, 0.03, 0, s * 0.9, 0);
      k.add(loft([[0.1, 0.052 * L, 0.058 * L, 0.004], [0.24, 0.064 * L, 0.072 * L, -0.004], [0.36, 0.066 * L, 0.072 * L, -0.002], [0.45, 0.06 * L, 0.064 * L, 0.006]], 8).translate(x, 0, 0), armorS, armor, shin);
      boot(x, foot, shade(armor, 0.75), armorS, L);
      if (!o.stone) {
        k.add(cube(0.014, 0.3, 0.02), armorS, shade(armor, 1.15), shin, x, 0.28, 0.068 * L, -0.04);
        k.add(cube(0.105 * L, 0.012, 0.024), armorS, shade(armor, 0.95), foot, x, 0.093, 0.09, 0.25);
        k.add(cube(0.095 * L, 0.012, 0.022), armorS, shade(armor, 0.95), foot, x, 0.078, 0.13, 0.4);
      }
    } else {
      const cuff = robe ? 0.25 : 0.36;
      k.add(loft([[0.05, 0.05 * L, 0.056 * L, 0], [0.2, 0.058 * L, 0.065 * L, -0.008], [cuff - 0.03, 0.06 * L, 0.066 * L, -0.008], [cuff, 0.069 * L, 0.074 * L, -0.006], [cuff + 0.035, 0.066 * L, 0.07 * L, -0.004]], 8).translate(x, 0, 0), MATTE, BOOT, chain([shin, foot], [-0.11], 0.04, down));
      boot(x, foot, shade(BOOT, 0.9), MATTE, L);
      if (!robe) {
        k.add(loft([[0.2, 0.0625 * L, 0.0695 * L, -0.008], [0.225, 0.0625 * L, 0.0695 * L, -0.008]], 8).translate(x, 0, 0), MATTE, LEATHER, shin);
        k.add(cube(0.008, 0.024, 0.022), METAL, accent, shin, x + s * 0.064 * L, 0.2125, -0.008);
      }
    }
  }
}

function buildHead(k: Kit, j: Joints, look: Omit<HumanoidLook, 'scale'>) {
  const H = j.head;
  const hy = 1.735;
  const hz = 0.012;
  const skin = look.skin;
  const metalS = look.build === 'heavy' ? METAL : MATTE;
  const elfHair = 0xd8c8a0;
  const hairColor = look.ears ? elfHair : look.glowEyes !== undefined ? shade(skin, 0.45) : 0x2a1e14;
  const eyes = (z: number, dark: number) => {
    for (const s of [-1, 1]) {
      if (look.glowEyes !== undefined) k.add(ball(6, 4), GLOW, look.glowEyes, H, s * 0.038, 1.746, z, 0, 0, 0, 0.018, 0.012, 0.01);
      else k.add(cube(0.024, 0.013, 0.012), MATTE, dark, H, s * 0.038, 1.745, z);
    }
  };
  const face = (tone: number, withEyes = true, w = 12, h = 9) => {
    k.add(ball(w, h), MATTE, tone, H, 0, hy, hz, 0, 0, 0, 0.1, 0.122, 0.112);
    k.add(cube(0.024, 0.044, 0.03), MATTE, shade(tone, 0.95), H, 0, 1.722, 0.118, -0.35);
    k.add(cube(0.095, 0.018, 0.024), MATTE, shade(tone, 0.86), H, 0, 1.763, 0.104);
    k.add(cube(0.048, 0.012, 0.02), MATTE, shade(tone, 0.7), H, 0, 1.68, 0.105);
    if (withEyes) eyes(0.104, 0x16100c);
  };
  const ears = (tone: number) => {
    for (const s of [-1, 1]) {
      if (look.ears) k.add(spike(0.026, 0.2, 4), MATTE, tone, H, s * 0.13, 1.765, -0.02, -0.35, 0, -s * 1.2);
      else k.add(ball(6, 5), MATTE, tone, H, s * 0.1, 1.735, 0.0, 0, 0, 0, 0.016, 0.03, 0.022);
    }
  };
  const hair = () => {
    if (look.horns) return;
    k.add(dome(12, 6, 0.56), MATTE, hairColor, H, 0, hy + 0.014, hz - 0.016, -0.42, 0, 0, 0.108, 0.13, 0.122);
    k.add(ball(8, 6), MATTE, hairColor, H, 0, 1.7, -0.062, 0, 0, 0, 0.095, 0.085, 0.06);
  };
  switch (look.head) {
    case 'helmet': {
      // Great helm: visor slit, centre ridge, crest.
      k.add(loft([[1.6, 0.116, 0.125, 0.012], [1.64, 0.123, 0.131, 0.012], [1.7, 0.128, 0.138, 0.014], [1.78, 0.128, 0.138, 0.012], [1.84, 0.113, 0.123, 0.006], [1.88, 0.08, 0.09, 0], [1.9, 0.03, 0.035, 0]], 10, { bottom: true, top: true }), metalS, look.armor, H);
      k.add(cube(0.17, 0.02, 0.03), MATTE, SLIT, H, 0, 1.755, 0.146);
      k.add(cube(0.022, 0.13, 0.03), metalS, shade(look.armor, 1.15), H, 0, 1.69, 0.145, -0.08);
      k.add(new THREE.TorusGeometry(0.135, 0.016, 4, 10, PI), METAL, look.accent, H, 0, 1.745, 0.0, 0, PI / 2, 0, 0.6, 1, 1);
      k.add(loft([[1.775, 0.134, 0.144, 0.012], [1.797, 0.133, 0.143, 0.011]], 10), metalS, shade(look.armor, 0.85), H);
      for (const a of [-1.2, -0.6, 0, 0.6, 1.2]) k.add(ball(4, 3), METAL, look.accent, H, Math.sin(a) * 0.138, 1.786, 0.012 + Math.cos(a) * 0.148, 0, 0, 0, 0.009, 0.009, 0.009);
      for (const a of [-0.78, -0.62, -0.46]) for (const y of [1.69, 1.716]) k.add(cube(0.011, 0.011, 0.008), MATTE, SLIT, H, Math.sin(a) * 0.13, y, 0.014 + Math.cos(a) * 0.14, 0, a, 0);
      break;
    }
    case 'plume': {
      // Crested galea with cheek guards; the face shows.
      face(skin);
      ears(skin);
      k.add(dome(12, 5, 0.52), metalS, look.armor, H, 0, 1.735, 0.002, 0, 0, 0, 0.126, 0.135, 0.134);
      k.add(loft([[1.69, 0.13, 0.14, -0.014], [1.74, 0.127, 0.136, 0.0]], 12, { arc: [1.1, TAU - 2.2] }), metalS, shade(look.armor, 0.9), H);
      for (const s of [-1, 1]) k.add(cube(0.018, 0.1, 0.075), metalS, shade(look.armor, 0.95), H, s * 0.112, 1.69, 0.055, 0, 0, s * 0.08);
      k.add(new THREE.TorusGeometry(0.16, 0.05, 5, 12, PI), MATTE, 0x9a1a14, H, 0, 1.74, -0.01, 0, PI / 2, 0, 0.42, 1, 1);
      break;
    }
    case 'hood': {
      // A deep hood: the face sits in shadow, a cowl drapes the shoulders.
      face(shade(skin, 0.3), false, 8, 6);
      eyes(0.106, 0x050404);
      const shell = hoodShell(1);
      k.add(inside(hoodShell(0.94)), MATTE, shade(look.cloth, 0.22), H);
      k.add(shell, MATTE, look.cloth, H);
      k.add(loft([[1.38, 0.26, 0.175, -0.008], [1.47, 0.245, 0.16, -0.002], [1.55, 0.19, 0.15, -0.01], [1.6, 0.16, 0.17, -0.02]], 12), MATTE, shade(look.cloth, 0.9), j.chest);
      k.add(new THREE.CylinderGeometry(1, 1, 1, 8), METAL, look.accent, j.chest, 0, 1.5, 0.154, PI / 2 - 0.1, 0, 0, 0.026, 0.008, 0.026);
      k.add(ball(5, 4), METAL, shade(look.accent, 0.6), j.chest, 0, 1.5, 0.161, 0, 0, 0, 0.011, 0.011, 0.007);
      if (look.ears) ears(skin);
      break;
    }
    case 'hat': {
      // Wide-brimmed, bent-tipped hat with a band.
      face(skin);
      ears(skin);
      hair();
      const brim = loft([[1.79, 0.31, 0.31], [1.808, 0.22, 0.22], [1.82, 0.13, 0.13]], 14);
      k.add(inside(brim), MATTE, shade(look.cloth, 0.6), H, 0, 0, 0.0);
      k.add(brim, MATTE, look.cloth, H);
      k.add(loft([[1.81, 0.136, 0.136], [1.85, 0.13, 0.13], [1.95, 0.096, 0.096, -0.016], [2.05, 0.062, 0.062, -0.05], [2.13, 0.032, 0.032, -0.11], [2.17, 0.006, 0.006, -0.17]], 10), MATTE, look.cloth, H);
      k.add(loft([[1.822, 0.14, 0.14], [1.86, 0.132, 0.132]], 12), MATTE, look.accent, H);
      k.add(ball(6, 4), METAL, shade(look.accent, 1.1), H, 0, 1.84, 0.137, -0.1, 0, 0, 0.022, 0.024, 0.008);
      k.add(shard(), GLOW, 0x8fd0ff, H, 0, 1.84, 0.144, -0.1, 0, 0, 0.012, 0.017, 0.006);
      break;
    }
    case 'skull': {
      const bone = skin;
      k.add(ball(10, 8), MATTE, bone, H, 0, 1.748, 0.0, 0, 0, 0, 0.098, 0.102, 0.108);
      k.add(cube(0.088, 0.055, 0.075), MATTE, shade(bone, 0.92), H, 0, 1.672, 0.045);
      k.add(cube(0.07, 0.016, 0.01), MATTE, 0xeee6d0, H, 0, 1.69, 0.086);
      for (const s of [-1, 1]) k.add(ball(6, 5), MATTE, SLIT, H, s * 0.037, 1.742, 0.078, 0, 0, 0, 0.028, 0.026, 0.02);
      k.add(cube(0.02, 0.03, 0.02), MATTE, SLIT, H, 0, 1.71, 0.097);
      eyes(0.092, SLIT);
      break;
    }
    case 'crown': {
      face(skin);
      ears(skin);
      hair();
      k.add(loft([[1.8, 0.114, 0.12, 0.004], [1.845, 0.117, 0.123, 0.004]], 12), METAL, look.accent, H);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        k.add(spike(0.022, 0.08, 4), METAL, look.accent, H, Math.sin(a) * 0.116, 1.88, 0.004 + Math.cos(a) * 0.122);
      }
      k.add(ball(6, 4), METAL, 0xb01820, H, 0, 1.823, 0.128, 0, 0, 0, 0.016, 0.016, 0.01);
      break;
    }
    case 'bare':
      face(skin);
      ears(skin);
      hair();
      break;
  }
  if (look.horns) {
    for (const s of [-1, 1]) {
      k.add(tube([[s * 0.05, 1.8, 0.05], [s * 0.075, 1.87, 0.02], [s * 0.095, 1.92, -0.05], [s * 0.1, 1.93, -0.13], [s * 0.098, 1.9, -0.2]], [0.03, 0.025, 0.018, 0.01, 0], 6), MATTE, 0x2a2420, H);
    }
    k.add(cube(0.03, 0.02, 0.12), MATTE, shade(skin, 0.75), H, 0, 1.85, 0.0);
  }
}

function buildCape(k: Kit, j: Joints, color: number, clasp: number, d: Dims) {
  const z0 = -0.165 * d.BZ;
  const c0 = pivot(j.chest, 0, 0.2, z0);
  const c1 = pivot(c0, 0, -0.29, 0);
  const c2 = pivot(c1, 0, -0.29, 0);
  const c3 = pivot(c2, 0, -0.29, 0);
  j.cape.push(c0, c1, c2, c3);
  const rows = 6;
  const cols = 7;
  const [back, front] = sheet(rows, cols, (r, c) => {
    const t = r / (rows - 1);
    const u = (c / (cols - 1)) * 2 - 1;
    const half = lerp(0.17, 0.33, Math.sqrt(t)) * d.B;
    const bow = lerp(0.12, 0.05, t);
    // Pleats down the length and a ragged hem.
    const pleat = 0.018 * t * Math.cos(u * PI * 3.5);
    const y = 1.53 - t * 1.17 + (t === 1 ? 0.045 * Math.sin(u * 9 + 1) : 0);
    return [u * half, y, z0 + bow * u * u - bow + pleat + (t === 0 ? 0.02 : 0)];
  }, 0.014);
  const w = chain([c0, c1, c2, c3], [-1.24, -0.95, -0.66], 0.1, down);
  k.add(back, MATTE, color, w);
  k.add(front, MATTE, shade(color, 0.6), w);
  for (const s of [-1, 1]) k.add(ball(5, 4), METAL, clasp, j.chest, s * 0.12 * d.B, 1.52, 0.11 * d.BZ, 0, 0, 0, 0.03, 0.03, 0.02);
}

function buildTail(k: Kit, j: Joints, skin: number) {
  const pts = [[0, 0.97, -0.1], [0, 0.88, -0.34], [0, 0.72, -0.58], [0, 0.52, -0.8], [0, 0.34, -0.98], [0, 0.24, -1.1]];
  const t0 = pivot(j.hips, 0, -0.01, -0.1);
  const t1 = pivot(t0, 0, -0.17, -0.34);
  const t2 = pivot(t1, 0, -0.2, -0.26);
  const t3 = pivot(t2, 0, -0.18, -0.18);
  j.tail.push(t0, t1, t2, t3);
  const w = chain([t0, t1, t2, t3], [0.27, 0.55, 0.8], 0.09, (_x, _y, z) => -z);
  k.add(tube(pts, [0.075, 0.064, 0.05, 0.034, 0.018, 0], 7), MATTE, skin, w);
  for (let i = 0; i < 4; i++) {
    const [, y, z] = pts[i + 1];
    k.add(spike(0.022, 0.07, 4), MATTE, shade(skin, 0.6), w, 0, y + 0.06 - i * 0.008, z, -0.6);
  }
}

function buildWings(k: Kit, j: Joints, skin: number) {
  const wings = pivot(j.chest, 0, 0.12, -0.15);
  j.wings = wings;
  const membrane = shade(skin, 0.62);
  const strut = shade(skin, 0.45);
  for (const s of [1, -1]) {
    const root = pivot(wings, s * 0.07, 0, -0.02);
    const tip = pivot(root, s * 0.55, 0.32, -0.08);
    root.userData.side = s;
    j.wing.push(root, tip);
    // Bind-pose points (model space): root, wrist, tip and the trailing fingers.
    const R = [s * 0.07, 1.44, -0.17];
    const E = [s * 0.62, 1.76, -0.25];
    const T = [s * 1.38, 1.92, -0.3];
    const F1 = [s * 1.25, 1.22, -0.3];
    const F2 = [s * 0.86, 0.9, -0.26];
    const F3 = [s * 0.34, 1.0, -0.2];
    const pts = [R, E, T, F1, F2, F3];
    const tris = [0, 1, 5, 1, 4, 5, 1, 3, 4, 1, 2, 3];
    const pos: number[] = [];
    for (const p of pts) pos.push(...p);
    const g = indexed(pos, s > 0 ? tris : tris.map((_, i) => tris[i - (i % 3) + [0, 2, 1][i % 3]]));
    const ww: Skin = (x) => {
      const t = smooth(0.4, 0.75, Math.abs(x));
      put(root, 1 - t);
      put(tip, t);
    };
    k.add(inside(g), MATTE, shade(membrane, 0.8), ww);
    k.add(g, MATTE, membrane, ww);
    k.add(tube([R, E], [0.035, 0.025], 5), MATTE, strut, ww);
    k.add(tube([E, T], [0.025, 0.006], 5), MATTE, strut, tip);
    k.add(tube([E, F1], [0.014, 0.004], 4), MATTE, strut, tip);
    k.add(tube([E, F2], [0.014, 0.004], 4), MATTE, strut, ww);
    k.add(spike(0.022, 0.08, 4), MATTE, 0x2a2420, tip, E[0], E[1] + 0.05, E[2], 0, 0, -s * 0.3);
  }
}

// ---------------------------------------------------------------- bosses --

export function buildBossHumanoid(model: 'colossus' | 'golem' | 'champion', color: number, scale: number): Rig {
  return instance(`boss:${model}:${color}`, scale, () => buildBoss(model, color));
}

function buildBoss(model: 'colossus' | 'golem' | 'champion', color: number): Rig {
  if (model === 'colossus') {
    // Sandstone giant shot through with storm-blue crystal.
    const sand = 0x9a8a6a;
    const crystal = 0x2f8cff;
    return makeRig({ skin: sand, armor: color, cloth: 0x6a5a40, accent: 0x7a6a4a, build: 'heavy', head: 'helmet', cape: 0x5a4a30 }, {
      bulk: 1.3, limb: 1.4, fist: 1.35, stone: true, noHead: true, posture: { heavy: 1, hunch: 0.08 },
      extras: (k, j, d) => {
        const H = j.head;
        k.add(loft([[1.58, 0.13, 0.14, 0.01], [1.68, 0.145, 0.15, 0.014], [1.8, 0.138, 0.146, 0.01], [1.87, 0.105, 0.11, 0], [1.9, 0.05, 0.05, 0]], 7, { top: true, bottom: true }), MATTE, shade(sand, 1.05), H);
        k.add(cube(0.17, 0.028, 0.04), GLOW, 0x58b4ff, H, 0, 1.75, 0.15);
        k.add(cube(0.03, 0.09, 0.04), MATTE, shade(sand, 0.8), H, 0, 1.68, 0.15);
        const crown: [number, number, number, number, number][] = [[0, 1.93, -0.02, 0, 0.0], [0.06, 1.9, -0.03, 0, -0.45], [-0.06, 1.9, -0.03, 0, 0.45], [0.03, 1.88, -0.09, -0.5, -0.2], [-0.03, 1.88, -0.09, -0.5, 0.2]];
        for (const [x, y, z, rx, rz] of crown) k.add(shard(), GLOW, crystal, H, x, y, z, rx, 0, rz, 0.03, 0.11, 0.03);
        const shards = (bone: O3, list: number[][], size: number) => {
          for (const [x, y, z, rx, rz] of list) k.add(shard(), GLOW, crystal, bone, x, y, z, rx, 0, rz, 0.05 * size, 0.17 * size, 0.05 * size);
        };
        for (const s of [-1, 1]) {
          const arm = s > 0 ? j.armL : j.armR;
          const fore = s > 0 ? j.foreL : j.foreR;
          const leg = s > 0 ? j.legL : j.legR;
          shards(arm, [[s * d.SX * 1.1, 1.62, 0.02, 0.1, -s * 0.5], [s * d.SX * 1.25, 1.58, -0.05, -0.3, -s * 0.9], [s * d.SX * 0.95, 1.63, -0.08, -0.4, -s * 0.2]], 1.1);
          shards(fore, [[s * d.SX * 1.15, 1.08, -0.04, -0.4, -s * 1.1]], 0.7);
          shards(leg, [[s * d.HX * 1.5, 0.78, 0.0, 0, -s * 1.0]], 0.6);
          k.add(cube(0.012, 0.16, 0.012), GLOW, crystal, fore, s * d.SX * 1.24, 1.07, 0.02);
        }
        shards(j.chest, [[0.1, 1.55, -0.2, -0.7, -0.3], [-0.08, 1.58, -0.22, -0.8, 0.35], [0.0, 1.45, -0.24, -1.0, 0], [0.16, 1.38, -0.2, -0.9, -0.6], [-0.15, 1.36, -0.2, -0.9, 0.6]], 1.2);
        // Storm core with cracks running out of it.
        k.add(ball(10, 8), GLOW, 0x7ac8ff, j.chest, 0, 1.36, 0.19 * d.BZ, 0, 0, 0, 0.07, 0.07, 0.04);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU + 0.3;
          k.add(cube(0.012, 0.14, 0.01), GLOW, crystal, j.chest, Math.sin(a) * 0.1, 1.36 + Math.cos(a) * 0.1, 0.18 * d.BZ, -0.1, 0, -a);
        }
      },
    });
  }
  if (model === 'golem') {
    // Black rock with molten seams and huge fists, hunched.
    const lava = 0xff6a20;
    return makeRig({ skin: color, armor: shade(color, 1.3), cloth: 0x1a1210, accent: 0x5a3a2a, build: 'heavy', head: 'helmet' }, {
      bulk: 1.45, limb: 1.55, fist: 1.9, stone: true, noHead: true, posture: { heavy: 1, hunch: 0.38 },
      extras: (k, j, d) => {
        const H = j.head;
        const dark = shade(color, 1.15);
        k.add(rock(), MATTE, dark, H, 0, 1.69, 0.05, 0.3, 0.4, 0, 0.13, 0.12, 0.13);
        k.add(rock(), MATTE, shade(color, 0.9), H, 0, 1.76, 0.1, 0.0, 0.2, 0, 0.14, 0.05, 0.08);
        for (const s of [-1, 1]) k.add(ball(6, 4), GLOW, 0xffa040, H, s * 0.05, 1.71, 0.165, 0, 0, 0, 0.022, 0.014, 0.01);
        k.add(cube(0.08, 0.012, 0.02), GLOW, lava, H, 0, 1.64, 0.165);
        const rocks = (bone: O3, list: number[][]) => {
          for (const [x, y, z, sx, sy, sz, ry] of list) k.add(rock(), MATTE, shade(color, 0.85 + ((x * 7 + y * 3) % 0.3)), bone, x, y, z, 0.4, ry ?? 0, 0.2, sx, sy, sz);
        };
        for (const s of [-1, 1]) {
          const arm = s > 0 ? j.armL : j.armR;
          const fore = s > 0 ? j.foreL : j.foreR;
          const hand = s > 0 ? j.handL : j.handR;
          const leg = s > 0 ? j.legL : j.legR;
          const shin = s > 0 ? j.shinL : j.shinR;
          rocks(arm, [[s * d.SX * 1.08, 1.56, 0.0, 0.17, 0.13, 0.16, 0.3], [s * d.SX * 1.2, 1.47, -0.06, 0.11, 0.09, 0.1, 1]]);
          rocks(fore, [[s * d.SX * 1.12, 1.08, -0.02, 0.09, 0.12, 0.09, 0.5]]);
          rocks(hand, [[s * d.SX, 0.9, 0.035, 0.1, 0.11, 0.105, 0.2], [s * d.SX * 1.06, 0.95, 0.06, 0.06, 0.05, 0.06, 1.2]]);
          rocks(leg, [[s * d.HX * 1.3, 0.75, 0.04, 0.1, 0.12, 0.09, 0.7]]);
          rocks(shin, [[s * d.HX * 1.1, 0.3, 0.05, 0.08, 0.1, 0.07, 0.1]]);
          k.add(cube(0.014, 0.18, 0.01), GLOW, lava, fore, s * d.SX * 1.18, 1.1, 0.03, 0, 0, s * 0.2);
          k.add(cube(0.014, 0.16, 0.01), GLOW, lava, arm, s * d.SX * 1.15, 1.33, 0.03, 0, 0, -s * 0.15);
          k.add(cube(0.014, 0.2, 0.01), GLOW, lava, leg, s * d.HX * 1.55, 0.7, 0.06, 0, 0, s * 0.15);
          k.add(cube(0.012, 0.16, 0.01), GLOW, lava, shin, s * d.HX * 0.6, 0.3, 0.085, 0, 0, s * 0.25);
        }
        rocks(j.chest, [[0.12, 1.5, -0.2, 0.14, 0.12, 0.1, 0.5], [-0.14, 1.46, -0.2, 0.13, 0.11, 0.1, 1.3], [0.0, 1.32, -0.22, 0.12, 0.1, 0.08, 0.2], [0.0, 1.6, -0.14, 0.12, 0.09, 0.1, 2.0]]);
        // Molten seams across chest and back, a furnace core.
        const seams = [[0.08, 1.45, 0.6], [0.14, 1.32, -0.4], [0.05, 1.2, 0.3], [-0.1, 1.42, -0.7], [-0.13, 1.25, 0.5]];
        for (const [x, y, rz] of seams) k.add(cube(0.016, 0.14, 0.012), GLOW, lava, j.chest, x * d.B, y, 0.185 * d.BZ, -0.1, 0, rz);
        for (const [x, y, rz] of seams.slice(0, 3)) k.add(cube(0.016, 0.14, 0.012), GLOW, lava, j.chest, -x * d.B, y, -0.17 * d.BZ, 0.1, 0, rz);
        k.add(ball(10, 8), GLOW, 0xffb050, j.chest, 0, 1.34, 0.19 * d.BZ, 0, 0, 0, 0.075, 0.075, 0.045);
        k.add(new THREE.TorusGeometry(1, 0.2, 4, 12), GLOW, lava, j.chest, 0, 1.34, 0.19 * d.BZ, 0, 0, 0, 0.095, 0.095, 0.05);
      },
    });
  }
  // Champion of Mars: ornate bronze, gold trim, red cloth, crested helm.
  const bronze = 0x8a5a2a;
  const gold = 0xd8b060;
  return makeRig({ skin: 0xb08a6a, armor: bronze, cloth: color, accent: gold, build: 'heavy', head: 'plume', cape: 0x7a1410 }, {
    bulk: 1.15, limb: 1.1, noHead: true, posture: { heavy: 0.6 },
    extras: (k, j, d) => {
      const H = j.head;
      // Corinthian helm: closed face with a T-slit, cheek flares, towering crest.
      k.add(loft([[1.6, 0.118, 0.13, 0.02], [1.65, 0.124, 0.136, 0.018], [1.72, 0.128, 0.14, 0.014], [1.8, 0.124, 0.136, 0.01], [1.86, 0.1, 0.112, 0.004], [1.9, 0.05, 0.06, 0]], 12, { top: true, bottom: true }), METAL, bronze, H);
      k.add(cube(0.15, 0.024, 0.03), MATTE, SLIT, H, 0, 1.75, 0.15);
      k.add(cube(0.028, 0.11, 0.03), MATTE, SLIT, H, 0, 1.68, 0.152);
      k.add(cube(0.02, 0.07, 0.03), METAL, gold, H, 0, 1.775, 0.155, -0.2);
      for (const s of [-1, 1]) k.add(cube(0.012, 0.11, 0.05), METAL, shade(bronze, 0.9), H, s * 0.1, 1.65, 0.11, 0.15, s * 0.5, 0);
      k.add(cube(0.04, 0.04, 0.3), METAL, gold, H, 0, 1.885, -0.005);
      k.add(new THREE.TorusGeometry(0.21, 0.08, 5, 14, PI), MATTE, shade(color, 1.5), H, 0, 1.76, -0.02, 0, PI / 2, 0, 0.36, 1.15, 1);
      k.add(tube([[0, 1.75, -0.2], [0, 1.6, -0.27], [0, 1.4, -0.28]], [0.035, 0.03, 0.005], 5), MATTE, shade(color, 0.85), H);
      // Sun emblem.
      k.add(new THREE.CylinderGeometry(1, 1, 1, 14), METAL, gold, j.chest, 0, 1.37, 0.17 * d.BZ, PI / 2 - 0.15, 0, 0, 0.07, 0.015, 0.07);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        k.add(spike(0.016, 0.06, 3), METAL, gold, j.chest, Math.sin(a) * 0.1, 1.37 + Math.cos(a) * 0.1, 0.165 * d.BZ, PI / 2 - 0.15, 0, -a, 1, 1, 0.4);
      }
      // Gilded pauldron spikes and knee medallions.
      for (const s of [-1, 1]) {
        const arm = s > 0 ? j.armL : j.armR;
        const leg = s > 0 ? j.legL : j.legR;
        const shin = s > 0 ? j.shinL : j.shinR;
        for (let i = 0; i < 3; i++) k.add(spike(0.025, 0.13, 5), METAL, gold, arm, s * d.SX * (1.0 + i * 0.12), 1.6 - i * 0.025, -0.03 + i * 0.03, 0, 0, -s * (0.5 + i * 0.25));
        k.add(new THREE.TorusGeometry(1, 0.12, 3, 12), METAL, gold, arm, s * d.SX * 1.08, 1.395, 0, PI / 2, -s * 0.5, 0, 0.122 * d.B, 0.117 * d.BZ, 0.12);
        k.add(ball(6, 5), METAL, gold, splitY(leg, shin, 0.5, 0.06), s * d.HX, 0.51, 0.09, 0, 0, 0, 0.03, 0.03, 0.015);
      }
      // Pteruges: leather straps around the hips.
      const sk = skirt(j.hips, j.legL, j.legR, 0.95, 0.66, 0.6);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + PI / 12;
        k.add(cube(0.05, 0.25, 0.012), MATTE, i % 2 ? shade(color, 0.9) : 0x5a3a1c, sk, Math.sin(a) * 0.2 * d.B, 0.79, Math.cos(a) * 0.145 * d.BZ, -0.12 * Math.cos(a), a, 0.12 * Math.sin(a));
      }
    },
  });
}

// ------------------------------------------------------------- animation --

// Pose channels: every animated joint angle (and the body offset) in one
// flat vector, so poses can be keyed, blended and damped uniformly.
const BX = 0, BY = 1, BZ = 2, BRX = 3, BRY = 4, BRZ = 5;
const HIX = 6, HIY = 7, HIZ = 8, SPX = 9, SPY = 10, SPZ = 11, CHX = 12, CHY = 13, CHZ = 14, HDX = 15, HDY = 16, HDZ = 17;
const ALX = 18, ALY = 19, ALZ = 20, FLX = 21, FLY = 22, WLX = 23, WLY = 24, WLZ = 25;
const ARX = 26, ARY = 27, ARZ = 28, FRX = 29, FRY = 30, WRX = 31, WRY = 32, WRZ = 33;
const LLX = 34, LLY = 35, LLZ = 36, KLX = 37, TLX = 38;
const LRX = 39, LRY = 40, LRZ = 41, KRX = 42, TRX = 43;
const NCH = 44;
/** Channels of the upper body (spine to right wrist). */
const isUpper = (c: number) => c >= SPX && c <= WRZ;

type Pose = { [channel: number]: number };

function poseOf(p: Pose, base?: Float32Array): Float32Array {
  const out = base ? base.slice() : new Float32Array(NCH);
  for (const key in p) out[+key] = p[key];
  return out;
}

const NEUTRAL = poseOf({ [ALZ]: 0.11, [ARZ]: -0.11, [FLX]: -0.12, [FRX]: -0.2, [KLX]: 0.05, [KRX]: 0.05, [LLX]: -0.02, [LRX]: -0.02 });
const READY = poseOf({ [SPX]: 0.08, [CHX]: 0.02, [HDX]: -0.08, [ARX]: -0.45, [ARZ]: -0.2, [FRX]: -0.95, [WRX]: 0.8, [ALX]: -0.25, [ALZ]: 0.25, [FLX]: -0.7, [LLX]: -0.16, [KLX]: 0.22, [LRX]: 0.1, [KRX]: 0.2, [LLZ]: 0.04, [LRZ]: -0.04 }, NEUTRAL);

const E_IO = 0, E_OUT = 1, E_IN = 2;
const ease = (t: number, e: number) => (e === E_OUT ? 1 - (1 - t) * (1 - t) * (1 - t) : e === E_IN ? t * t * t : t * t * (3 - 2 * t));

interface Move {
  /** End of the anticipation (what anim.windup drives). */
  A: number;
  keys: { v: number; p: Float32Array; e: number }[];
  /** Full-turn window [from, to] for spinning moves. */
  spin?: [number, number];
  /** How much the move owns the legs while moving (0 = legs keep running). */
  legs?: number;
  /** The left hand joins the grip (unless it holds a shield). */
  twoHand?: boolean;
}

function move(A: number, keys: [number, Pose, number?][], extra: Partial<Move> = {}): Move {
  return { A, keys: keys.map(([v, p, e]) => ({ v, p: poseOf(p, READY), e: e ?? E_IO })), ...extra };
}

function sample(m: Move, v: number, out: Float32Array) {
  const keys = m.keys;
  let i = 0;
  while (i < keys.length - 2 && v > keys[i + 1].v) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const t = ease(clamp01((v - a.v) / Math.max(1e-4, b.v - a.v)), b.e);
  for (let c = 0; c < NCH; c++) out[c] = a.p[c] + (b.p[c] - a.p[c]) * t;
}

// Arm channels [swing, turn, raise, elbow, forearm twist, wrist] for the key
// poses, solved offline by IK from where each hand should be and where the
// blade should point (in body space), every move chained from its previous
// key so the arcs between keys stay smooth.
const ARM: Record<string, number[]> = {
  SL_W: [-1.62, 0.23, -0.58, -1.73, -1.64, 0.53],
  SL_M: [-1.12, -0.16, -0.33, -1.67, -1.7, 1.14],
  SL_H: [-0.43, 0.27, -0.37, -1.34, -0.34, 1.75],
  SL_F: [0.01, 2.12, -0.95, 0.02, -0.61, 1.12],
  B_W: [-0.51, 1.11, -0.16, -1.56, 0.94, 0.93],
  B_M: [-0.76, -0.24, 0.22, -1.25, 1.33, 1.75],
  B_H: [-1.02, -0.27, 0.28, -0.77, 1.7, 1.75],
  B_F: [-0.73, -0.72, 0.39, -1.62, 1.68, 1.75],
  O_W: [-2.46, 0.54, 0.06, -0.88, -0.55, 0.49],
  O_M: [-2.37, 0.48, 0.18, -0.63, -1.7, 1.17],
  O_H: [-1.54, 0.89, 0.39, -0.26, -1.7, 1.04],
  O_F: [-1.58, 1.12, 0.55, -0.02, 0.39, 1.75],
  OL_W: [-0.98, -1.68, 1.74, -0.82, 0.58, 0],
  OL_M: [-0.74, -1.73, 1.73, -0.72, 0.49, 0],
  OL_H: [-0.01, -1.7, 1.27, -0.71, 0.56, 0],
  OL_F: [0.24, -1.93, 1.27, -0.11, 0.47, 0],
  H_W: [-2.12, 0.1, -0.05, -1.13, -0.67, 0.03],
  H_M: [-1.8, 0.38, -0.47, -1.37, 0.09, 1.75],
  H_H: [-0.82, 0.36, -0.43, -0.68, 0.36, 1.75],
  H_F: [-0.96, 0.45, -0.25, 0.02, 0.29, 1.54],
  HL_W: [-0.78, 0.3, -1.85, -0.67, 0.22, 0],
  HL_M: [-2.32, -0.33, -0.89, -0.65, -0.05, 0],
  HL_H: [-2.13, -0.6, -1.12, 0.02, -0.17, 0],
  SP_C: [-0.74, -0.84, -0.46, 0.01, -1.05, 0.63],
  SP_S: [-0.7, -0.08, -1.21, 0.02, -0.58, 1.13],
  T_W: [0.96, 0.31, -0.84, -1.71, -0.35, 0.72],
  T_H: [-0.49, 1.02, -1.25, -0.09, -1.3, 1.38],
  TH_W: [-1.84, 0.34, -0.71, -1.29, -1.7, 0.86],
  TH_R: [-1.09, -0.08, -0.32, -1.82, -1.7, 1.15],
  TH_F: [-0.42, 0.03, -0.02, -0.98, -1.7, 0.98],
  BLK_R: [-0.22, 0.85, -0.53, -1.35, -0.74, 0.59],
  BLK_L: [0.38, -0.94, 1.57, -1.71, 0.99, 0],
  BOW_L: [-2.88, 0.59, 1.43, -0.35, 1.7, -0.06],
  BOW_RR: [-1.84, 0.26, 1.42, -0.36, -0.32, 0.44],
  BOW_RD: [-3.3, 1.01, 1.24, -1.75, -0.04, 0.33],
  C_G: [-0.19, 0.83, -0.08, -1.57, -1.04, 0.65],
  C_P: [-1.59, 0.9, 0.1, -0.34, -1.26, 0.87],
  CL_G: [-0.15, -1.03, 0.28, -1.51, 1.03, -0.04],
  CL_P: [-0.86, -1.71, 0.75, -0.1, 1.12, -0.03],
  ROAR_R: [0.73, 0.7, -0.89, -1.15, -0.8, 0.65],
  ROAR_L: [0.87, -0.8, 1.06, -1.05, 0.58, -0.02],
  SW_W: [-0.84, -0.6, -0.53, -0.73, -1.42, 0.55],
  SW_H: [-0.79, -0.3, -0.33, -1.24, 0.14, 1.75],
  SW_F: [-1.36, 0.31, 0.41, -0.07, 0.65, 1.27],
  ST_UP: [-2.24, 1.05, -0.04, -0.13, 1.48, 1.75],
  ST_PT: [-2.16, 1.5, 0.36, -0.17, 1.7, 1.21],
  SU_UP: [-1.32, 0.4, -0.88, -0.66, 1.7, 1.75],
  SU_DN: [-0.88, -0.15, -0.57, 0.02, 1.03, 1.24],
  SUL_UP: [-0.68, -0.7, 1.35, -0.49, 0.62, -0.01],
  SUL_DN: [0.04, -0.84, 0.96, 0.02, -0.03, -0.01],
  RG_IN: [-0.97, 1.09, 0.47, -1.36, -0.13, 0.43],
  RG_OUT: [-0.89, 0, -1.12, -0.39, -0.25, 1.03],
  RGL_IN: [-1.19, -1.15, -0.5, -1.43, -0.32, -0.01],
  RGL_OUT: [-0.93, -0.02, 1.13, -0.26, -0.17, -0.01],
  CH_R: [-3.07, -0.22, -1.14, -1.67, 0.63, 1.75],
  CH_L: [0.28, -1.19, 2.16, -1.62, 1.07, 0],
  CH_HR: [-0.63, 0.91, -0.1, -1.34, -0.81, -1.08],
  CH_HL: [-0.93, -1.13, 0.06, -0.79, -0.23, 0],
  // Two-handed backhand sweep (greatsword, battle axe): the left hand just below the right on the grip.
  CL_W: [-2.06, 0.54, 1.1, -1.11, -0.3, 1.75],
  CL_M: [-1.14, 0.6, 0.29, -0.81, -1.7, 1.07],
  CL_H: [-1.55, 0.61, 0.51, -0.14, -1.24, 1.08],
  CL_F: [-1.36, 0.73, 0.4, -0.25, -1.7, 0.83],
  CLL_W: [-1.23, -0.91, -0.12, -2.18, -0.18, 0],
  CLL_M: [-1.06, -1.06, -0.25, -1.15, -0.19, 0],
  CLL_H: [-0.92, -0.72, -0.28, -0.98, -0.04, 0],
  CLL_F: [-0.77, -0.62, -0.33, -0.92, -0.04, 0],
  // A spear carried at a run: low at the right hip, the left hand forward on the shaft.
  SPC_R: [0.01, 0.6, -0.03, -0.93, 0.1, 0.75],
  SPC_L: [-0.93, -0.4, -0.16, -0.01, -0.22, 0],
  // A lyre held up before the chest (raised higher for a song), strummed from above to below.
  LY_L: [-0.25, 1.05, -0.51, 0.02, 1.7, 0.88],
  LY_L2: [-0.15, 1.23, -0.76, 0.02, 1.65, 0.47],
  STR_A: [-1.25, 0.67, 0.31, -0.87, 0.14, 0.56],
  STR_B: [-1.17, 0.55, 0.54, 0, 0.27, 0.42],
  STR_A2: [-1.67, 0.36, 0.42, -0.05, 0.29, 0.31],
  STR_B2: [-1.31, 0.54, 0.54, -0.02, 0.16, 0.23],
  // A war horn raised before the chest, then to the lips, bell forward and up.
  BL_W: [-0.02, 0.52, -0.38, -1.41, -1.42, 0.82],
  BL_H: [-1.24, -0.18, 1.24, -1.52, -1.7, 0.77],
};
const armR = (k: string): Pose => {
  const v = ARM[k];
  return { [ARX]: v[0], [ARY]: v[1], [ARZ]: v[2], [FRX]: v[3], [FRY]: v[4], [WRX]: v[5] };
};
const armL = (k: string): Pose => {
  const v = ARM[k];
  return { [ALX]: v[0], [ALY]: v[1], [ALZ]: v[2], [FLX]: v[3], [FLY]: v[4], [WLX]: v[5] };
};
/** Spine pitch and turn, chest pitch and turn. */
const torso = (spx: number, spy: number, chx: number, chy: number): Pose => ({ [SPX]: spx, [SPY]: spy, [CHX]: chx, [CHY]: chy });
/** Legs: left thigh and knee, right thigh and knee, body forward shift. */
const legs = (ll: number, kl: number, lr: number, kr: number, bz = 0, by = 0): Pose => ({ [LLX]: ll, [KLX]: kl, [LRX]: lr, [KRX]: kr, [BZ]: bz, [BY]: by });
/** Free left arm swinging out for balance. */
const balance = (x: number, z: number, e: number): Pose => ({ [ALX]: x, [ALZ]: z, [FLX]: e });
/** A shield arm kept in guard while the right hand swings two-handed moves. */
const GUARD_L: Pose = { [ALX]: -0.55, [ALY]: -0.3, [ALZ]: 0.35, [FLX]: -1.3, [FLY]: 0.6, [WLX]: 0 };

const SLASH_WIND: Pose = { ...torso(-0.04, -0.3, 0, -0.35), [HDY]: 0.5, ...armR('SL_W'), ...balance(-0.5, 0.35, -0.9), ...legs(-0.3, 0.3, 0.15, 0.25) };
const SLASH_MID: Pose = { ...torso(0.05, 0, 0, 0), [HDY]: 0.1, ...armR('SL_M'), ...balance(-0.2, 0.35, -0.7), ...legs(-0.38, 0.45, 0.22, 0.3, 0.05) };
const SLASH_HIT: Pose = { ...torso(0.2, 0.3, 0, 0.4), [HDY]: -0.4, ...armR('SL_H'), ...balance(0.2, 0.3, -0.4), ...legs(-0.45, 0.55, 0.3, 0.35, 0.1) };
const SLASH_FOLLOW: Pose = { ...torso(0.22, 0.38, 0, 0.5), [HDY]: -0.5, ...armR('SL_F'), ...balance(0.25, 0.35, -0.4), ...legs(-0.45, 0.5, 0.3, 0.35, 0.1) };
const BACK_WIND: Pose = { ...torso(0.12, 0.35, 0, 0.4), [HDY]: -0.45, ...armR('B_W'), ...balance(0.2, 0.3, -0.5), ...legs(-0.3, 0.4, 0.2, 0.3) };
const BACK_MID: Pose = { ...torso(0.1, 0.05, 0, 0.05), [HDY]: -0.05, ...armR('B_M'), ...balance(-0.1, 0.4, -0.6), ...legs(-0.33, 0.42, 0.22, 0.3, 0.04) };
const BACK_HIT: Pose = { ...torso(0.1, -0.3, 0, -0.35), [HDY]: 0.3, ...armR('B_H'), ...balance(-0.4, 0.45, -0.7), ...legs(-0.35, 0.45, 0.25, 0.3, 0.08) };
const BACK_FOLLOW: Pose = { ...torso(0.1, -0.4, 0, -0.45), [HDY]: 0.35, ...armR('B_F'), ...balance(-0.4, 0.45, -0.7), ...legs(-0.35, 0.45, 0.25, 0.3, 0.08) };
const OVER_WIND: Pose = { ...torso(-0.18, 0, -0.1, 0), [HDX]: -0.1, ...armR('O_W'), ...armL('OL_W'), ...legs(0.1, 0.15, 0.15, 0.2, -0.04, 0.02) };
const OVER_MID: Pose = { ...torso(0.15, 0, 0.05, 0), [HDX]: -0.2, ...armR('O_M'), ...armL('OL_M'), ...legs(-0.4, 0.5, 0.25, 0.3, 0.06) };
const OVER_HIT: Pose = { ...torso(0.45, 0, 0.15, 0), [HDX]: -0.3, ...armR('O_H'), ...armL('OL_H'), ...legs(-0.75, 0.85, 0.35, 0.4, 0.15) };
const OVER_FOLLOW: Pose = { ...torso(0.5, 0, 0.15, 0), [HDX]: -0.3, ...armR('O_F'), ...armL('OL_F'), ...legs(-0.75, 0.85, 0.35, 0.4, 0.15) };
const SLAM_WIND: Pose = { ...OVER_WIND, ...torso(-0.3, 0, -0.15, 0), [HDX]: -0.2, ...legs(0.05, 0.1, 0.1, 0.12, -0.04, 0.05) };
const SLAM_HIT: Pose = { ...OVER_HIT, ...torso(0.7, 0, 0.2, 0), [HDX]: -0.4, ...legs(-0.8, 1.1, -0.5, 1.1, 0.12) };
const CROSSED: Pose = { ...armR('C_G'), ...armL('CL_G') };
const AIM_REST: Pose = { [HIY]: -0.55, ...torso(0, -0.3, 0, -0.3), [HDY]: 1.05, [HDX]: -0.05, ...armL('BOW_L'), ...armR('BOW_RR'), ...legs(-0.2, 0.2, 0.15, 0.2), [LLZ]: 0.1, [LRZ]: -0.1 };
const AIM_DRAWN: Pose = { ...AIM_REST, ...armR('BOW_RD') };
const AIM_LOOSE: Pose = { ...AIM_REST, ...armR('BOW_RD'), [ARY]: ARM.BOW_RD[1] - 0.5, [FRX]: -1.2 };
const CLEAVE_WIND: Pose = { ...torso(0.05, 0.45, 0, 0.5), [HDY]: -0.7, ...armR('CL_W'), ...armL('CLL_W'), ...legs(-0.25, 0.35, 0.2, 0.3) };
const CLEAVE_MID: Pose = { ...torso(0.15, 0.05, 0, 0.05), [HDY]: -0.05, ...armR('CL_M'), ...armL('CLL_M'), ...legs(-0.4, 0.5, 0.25, 0.35, 0.06) };
const CLEAVE_HIT: Pose = { ...torso(0.15, -0.3, 0, -0.35), [HDY]: 0.5, ...armR('CL_H'), ...armL('CLL_H'), ...legs(-0.5, 0.6, 0.3, 0.4, 0.12) };
const CLEAVE_FOLLOW: Pose = { ...torso(0.15, -0.4, 0, -0.45), [HDY]: 0.6, ...armR('CL_F'), ...armL('CLL_F'), ...legs(-0.5, 0.6, 0.3, 0.4, 0.12) };
const LYRE_UP: Pose = { ...torso(0.05, 0, 0, 0.1), [HDX]: 0.15, [HDY]: -0.1, ...armL('LY_L'), ...armR('STR_A'), ...legs(-0.15, 0.2, 0.1, 0.2) };
const LYRE_DOWN: Pose = { ...LYRE_UP, [CHX]: 0.05, ...armR('STR_B') };
const SONG_UP: Pose = { ...torso(-0.1, 0, -0.1, 0.1), [HDX]: -0.2, ...armL('LY_L2'), ...armR('STR_A2'), ...legs(-0.1, 0.15, 0.1, 0.15), [LLZ]: 0.08, [LRZ]: -0.08 };
const SONG_DOWN: Pose = { ...SONG_UP, [CHX]: -0.05, ...armR('STR_B2') };
const HORN_UP: Pose = { ...torso(-0.15, 0, -0.15, 0), [HDX]: -0.1, ...armR('BL_W'), ...balance(-0.3, 0.35, -0.8), ...legs(-0.1, 0.2, 0.1, 0.2) };
const HORN_BLOW: Pose = { ...torso(0.05, 0, 0, 0), [HDX]: -0.05, ...armR('BL_H'), ...balance(-0.5, 0.55, -0.5), ...legs(-0.35, 0.4, 0.2, 0.3, 0.06), [LLZ]: 0.06, [LRZ]: -0.06 };

const MOVES: Partial<Record<AttackStyle, Move>> = {
  slash: move(0.28, [[0, {}], [0.28, SLASH_WIND], [0.38, SLASH_MID, E_IN], [0.46, SLASH_HIT, E_OUT], [0.62, SLASH_FOLLOW, E_OUT], [1, {}]]),
  slash2: move(0.26, [[0, {}], [0.26, BACK_WIND], [0.36, BACK_MID, E_IN], [0.44, BACK_HIT, E_OUT], [0.6, BACK_FOLLOW, E_OUT], [1, {}]]),
  slash3: move(0.34, [[0, {}], [0.34, OVER_WIND], [0.44, OVER_MID, E_IN], [0.5, OVER_HIT, E_OUT], [0.7, OVER_FOLLOW, E_OUT], [1, {}]], { twoHand: true }),
  overhead: move(0.4, [[0, {}], [0.4, OVER_WIND], [0.5, OVER_MID, E_IN], [0.56, OVER_HIT, E_OUT], [0.74, OVER_FOLLOW, E_OUT], [1, {}]], { twoHand: true }),
  heavy: move(0.4, [
    [0, {}],
    [0.4, { ...torso(-0.12, -0.45, 0, -0.5), [HDY]: 0.6, ...armR('H_W'), ...armL('HL_W'), ...legs(-0.2, 0.35, 0.25, 0.45, -0.04, -0.02) }],
    [0.5, { ...torso(0.2, 0, 0.05, 0), [HDY]: 0.1, ...armR('H_M'), ...armL('HL_M'), ...legs(-0.5, 0.6, 0.3, 0.45, 0.08) }, E_IN],
    [0.56, { ...torso(0.55, 0.35, 0.15, 0.35), [HDY]: -0.3, [HDX]: -0.35, ...armR('H_H'), ...armL('HL_H'), ...legs(-0.8, 1.0, 0.4, 0.6, 0.2) }, E_OUT],
    [0.78, { ...torso(0.6, 0.4, 0.15, 0.4), [HDY]: -0.3, [HDX]: -0.35, ...armR('H_F'), ...armL('HL_H'), ...legs(-0.8, 1.0, 0.4, 0.6, 0.2) }, E_OUT],
    [1, {}],
  ], { twoHand: true }),
  spin: move(0.22, [
    [0, {}],
    [0.22, { ...torso(0.25, -0.35, 0, -0.3), ...armR('SP_C'), ...balance(-0.4, 0.9, -0.5), ...legs(-0.45, 0.8, -0.35, 0.8) }],
    [0.32, { ...torso(0.1, 0, 0, 0), ...armR('SP_S'), ...balance(-0.1, 1.3, -0.2), ...legs(-0.5, 0.9, 0.3, 0.6, 0, 0.12) }, E_OUT],
    [0.7, { ...torso(0.1, 0, 0, 0), ...armR('SP_S'), ...balance(-0.1, 1.3, -0.2), ...legs(-0.5, 0.9, 0.3, 0.6, 0, 0.12) }],
    [0.84, { ...torso(0.22, 0, 0, 0), ...armR('SP_S'), [ARZ]: ARM.SP_S[2] + 0.4, ...balance(-0.2, 0.7, -0.4), ...legs(-0.35, 0.6, -0.3, 0.6) }],
    [1, {}],
  ], { spin: [0.24, 0.8] }),
  thrust: move(0.32, [
    [0, {}],
    [0.32, { ...torso(0, -0.3, 0, -0.25), [HDY]: 0.3, ...armR('T_W'), ...balance(-0.6, 0.35, -0.8), ...legs(-0.1, 0.35, 0.15, 0.45) }],
    [0.46, { ...torso(0.3, 0.35, 0, 0.25), [HDY]: -0.3, ...armR('T_H'), ...balance(0.4, 0.4, -0.3), ...legs(0.45, 0.2, -0.7, 0.85, 0.25) }, E_OUT],
    [0.64, { ...torso(0.28, 0.3, 0, 0.2), [HDY]: -0.25, ...armR('T_H'), ...balance(0.4, 0.4, -0.3), ...legs(0.45, 0.2, -0.7, 0.85, 0.25) }],
    [1, {}],
  ]),
  cast: move(0.3, [
    [0, {}],
    [0.3, { ...torso(-0.08, 0, -0.06, 0), ...CROSSED, ...legs(-0.1, 0.2, 0.05, 0.2) }],
    [0.42, { ...torso(0.15, 0, 0, 0), ...armR('C_P'), ...armL('CL_P'), ...legs(-0.3, 0.4, 0.2, 0.25, 0.05) }, E_OUT],
    [0.66, { ...torso(0.12, 0, 0, 0), ...armR('C_P'), ...armL('CL_P'), ...legs(-0.3, 0.4, 0.2, 0.25, 0.05) }],
    [1, {}],
  ]),
  throw: move(0.32, [
    [0, {}],
    [0.32, { ...torso(-0.15, -0.4, 0, -0.4), [HDY]: 0.5, ...armR('TH_W'), ...balance(-1.2, 0.3, -0.4), ...legs(-0.35, 0.25, 0.25, 0.35) }],
    [0.45, { ...torso(0.35, 0.35, 0, 0.35), [HDY]: -0.3, ...armR('TH_R'), ...balance(0.4, 0.25, -0.5), ...legs(-0.5, 0.55, 0.4, 0.3) }, E_OUT],
    [0.62, { ...torso(0.4, 0.4, 0, 0.4), [HDY]: -0.3, ...armR('TH_F'), ...balance(0.4, 0.25, -0.5), ...legs(-0.5, 0.55, 0.4, 0.3) }, E_OUT],
    [1, {}],
  ]),
  roar: move(0.25, [
    [0, {}],
    [0.25, { ...torso(0.55, 0, 0.3, 0), [HDX]: 0.35, ...CROSSED, ...legs(-0.45, 0.85, -0.45, 0.85) }],
    [0.36, { ...torso(-0.3, 0, -0.4, 0), [HDX]: -0.85, ...armR('ROAR_R'), ...armL('ROAR_L'), ...legs(-0.2, 0.45, -0.2, 0.45), [LLZ]: 0.16, [LRZ]: -0.16 }, E_OUT],
    [0.8, { ...torso(-0.26, 0, -0.38, 0), [HDX]: -0.8, ...armR('ROAR_R'), ...armL('ROAR_L'), ...legs(-0.2, 0.45, -0.2, 0.45), [LLZ]: 0.16, [LRZ]: -0.16 }],
    [1, {}],
  ]),
  bow: move(0.62, [[0, {}], [0.4, AIM_DRAWN], [0.64, AIM_DRAWN], [0.7, AIM_LOOSE, E_OUT], [1, AIM_REST]]),
  cleave: move(0.3, [[0, {}], [0.3, CLEAVE_WIND], [0.42, CLEAVE_MID, E_IN], [0.5, CLEAVE_HIT, E_OUT], [0.72, CLEAVE_FOLLOW, E_OUT], [1, {}]], { twoHand: true }),
  strum: move(0.3, [[0, {}], [0.3, LYRE_UP], [0.45, LYRE_DOWN, E_OUT], [0.7, LYRE_DOWN], [1, {}]]),
  // Three strums, the lyre held high, the last one ringing out.
  song: move(0.25, [
    [0, {}], [0.25, SONG_UP], [0.36, SONG_DOWN, E_OUT], [0.45, SONG_UP], [0.56, SONG_DOWN, E_OUT], [0.63, SONG_UP], [0.72, SONG_DOWN, E_OUT], [0.9, SONG_DOWN], [1, {}],
  ]),
  blow: move(0.3, [[0, {}], [0.3, HORN_UP], [0.42, HORN_BLOW, E_OUT], [0.84, HORN_BLOW], [1, {}]]),
  // Boss moves: a readable anticipation (driven by windup) then the strike.
  sweep: move(0.45, [
    [0, {}],
    [0.45, { ...torso(0.1, -0.5, 0, -0.55), [HDY]: 0.6, ...armR('SW_W'), ...balance(-0.6, 0.6, -0.5), ...legs(-0.35, 0.6, 0.3, 0.6), [LLZ]: 0.1, [LRZ]: -0.1 }],
    [0.55, { ...torso(0.2, 0.45, 0, 0.5), [HDY]: -0.4, ...armR('SW_H'), ...balance(0.3, 0.5, -0.4), ...legs(-0.4, 0.6, 0.3, 0.5) }, E_OUT],
    [0.72, { ...torso(0.2, 0.55, 0, 0.65), [HDY]: -0.45, ...armR('SW_F'), ...balance(0.3, 0.5, -0.4), ...legs(-0.4, 0.6, 0.3, 0.5) }, E_OUT],
    [1, {}],
  ]),
  combo: move(0.12, [[0, {}], [0.12, SLASH_WIND], [0.17, SLASH_MID, E_IN], [0.2, SLASH_HIT, E_OUT], [0.3, SLASH_FOLLOW, E_OUT], [0.42, BACK_WIND], [0.47, BACK_MID, E_IN], [0.5, BACK_HIT, E_OUT], [0.6, BACK_FOLLOW, E_OUT], [0.72, OVER_WIND], [0.77, OVER_MID, E_IN], [0.8, OVER_HIT, E_OUT], [0.9, OVER_FOLLOW, E_OUT], [1, {}]], { twoHand: true }),
  slam: move(0.55, [[0, {}], [0.55, SLAM_WIND], [0.62, SLAM_HIT, E_OUT], [0.82, SLAM_HIT], [1, {}]], { twoHand: true }),
  ring: move(0.55, [
    [0, {}],
    [0.55, { ...torso(0.45, 0, 0.25, 0), [HDX]: 0.35, ...armR('RG_IN'), ...armL('RGL_IN'), ...legs(-0.55, 0.9, -0.55, 0.9) }],
    [0.6, { ...torso(-0.25, 0, -0.3, 0), [HDX]: -0.6, ...armR('RG_OUT'), ...armL('RGL_OUT'), ...legs(-0.1, 0.2, -0.1, 0.2, 0, 0.05), [LLZ]: 0.12, [LRZ]: -0.12 }, E_OUT],
    [0.8, { ...torso(-0.2, 0, -0.25, 0), [HDX]: -0.5, ...armR('RG_OUT'), ...armL('RGL_OUT'), ...legs(-0.1, 0.25, -0.1, 0.25), [LLZ]: 0.12, [LRZ]: -0.12 }],
    [1, {}],
  ]),
  leap: move(0.3, [
    [0, {}],
    [0.3, { ...torso(0.55, 0, 0.15, 0), [HDX]: -0.35, [ARX]: 0.9, [ARZ]: -0.3, [FRX]: -0.3, [ALX]: 0.9, [ALZ]: 0.3, [FLX]: -0.3, ...legs(-1.0, 1.5, -1.0, 1.5) }],
    [0.5, { ...OVER_WIND, ...torso(-0.2, 0, 0, 0), ...legs(-1.1, 1.7, -0.3, 1.2) }, E_OUT],
    [0.85, { ...OVER_WIND, ...torso(0.1, 0, 0, 0), ...legs(-0.5, 0.6, -0.2, 0.5) }],
    [0.95, { ...SLAM_HIT, ...legs(-1.0, 1.3, -0.6, 1.3, 0.12) }, E_OUT],
    [1, { ...SLAM_HIT, ...legs(-1.0, 1.3, -0.6, 1.3, 0.12) }],
  ], { twoHand: true }),
  volley: move(0.4, [
    [0, {}],
    [0.4, { ...torso(-0.1, -0.35, 0, -0.3), ...armR('TH_W'), ...balance(-1.2, 0.2, -0.6), ...legs(-0.3, 0.35, 0.1, 0.3) }],
    ...[0.5, 0.66, 0.82].flatMap((v): [number, Pose, number?][] => [
      [v, { ...torso(0.15, 0.2, 0, 0.2), ...armR('TH_R'), ...balance(-1.0, 0.2, -0.5), ...legs(-0.35, 0.4, 0.1, 0.3) }, E_OUT],
      [v + 0.08, { ...torso(0.05, -0.15, 0, -0.15), ...armR('TH_W'), ...balance(-1.1, 0.2, -0.6), ...legs(-0.35, 0.4, 0.1, 0.3) }],
    ]),
    [1, {}],
  ]),
  strikes: move(0.45, [
    [0, {}],
    [0.45, { ...torso(-0.25, 0, -0.2, 0), [HDX]: -0.45, ...armR('ST_UP'), ...balance(-0.4, 0.7, -0.6), ...legs(-0.05, 0.25, 0.05, 0.25), [LLZ]: 0.06, [LRZ]: -0.06 }],
    [0.55, { ...torso(0.25, 0, 0, 0), [HDX]: -0.1, ...armR('ST_PT'), ...balance(-0.2, 0.5, -0.4), ...legs(-0.4, 0.45, 0.1, 0.3) }, E_OUT],
    [0.85, { ...torso(0.2, 0, 0, 0), [HDX]: -0.1, ...armR('ST_PT'), ...balance(-0.2, 0.5, -0.4), ...legs(-0.4, 0.45, 0.1, 0.3) }],
    [1, {}],
  ]),
  summon: move(0.45, [
    [0, {}],
    [0.45, { ...torso(-0.2, 0, -0.2, 0), [HDX]: -0.45, ...armR('SU_UP'), ...armL('SUL_UP'), ...legs(-0.05, 0.15, 0.05, 0.15) }],
    [0.55, { ...torso(0.45, 0, 0, 0), [HDX]: -0.2, ...armR('SU_DN'), ...armL('SUL_DN'), ...legs(-0.5, 0.8, -0.5, 0.8) }, E_OUT],
    [0.8, { ...torso(0.4, 0, 0, 0), [HDX]: -0.2, ...armR('SU_DN'), ...armL('SUL_DN'), ...legs(-0.5, 0.75, -0.5, 0.75) }],
    [1, {}],
  ]),
  charge: move(0.5, [
    [0, {}],
    [0.5, { ...torso(0.55, 0, 0.2, 0), [HDX]: -0.5, ...armL('BLK_L'), ...armR('T_W'), ...legs(-0.7, 1.0, 0.5, 0.7, -0.05) }],
    [0.6, { ...torso(0.6, 0, 0.2, 0), [HDX]: -0.55, ...armL('BLK_L'), ...armR('T_W') }, E_OUT],
    [1, { ...torso(0.6, 0, 0.2, 0), [HDX]: -0.55, ...armL('BLK_L'), ...armR('T_W') }],
  ], { legs: 0 }),
  teleport: move(0.6, [
    [0, {}],
    [0.6, { ...torso(0.4, 0, 0.2, 0), [HDX]: 0.3, ...CROSSED, ...legs(-0.6, 1.0, -0.6, 1.0) }],
    [0.72, { ...torso(-0.1, 0, 0, 0), ...armR('RG_OUT'), ...armL('RGL_OUT') }, E_OUT],
    [1, {}],
  ]),
};
MOVES.stomp = MOVES.slam;
MOVES.bite = MOVES.claw = MOVES.sting = MOVES.slash;

// Whole-body state poses (blended in by smoothed weights).
const CROUCH = poseOf({ [BZ]: -0.06, [SPX]: 0.38, [CHX]: 0.12, [HDX]: -0.38, [LLX]: -0.95, [LRX]: -0.85, [KLX]: 1.55, [KRX]: 1.4, [ALX]: -0.35, [ARX]: -0.3, [FLX]: -0.7, [FRX]: -0.6, [ALZ]: 0.2, [ARZ]: -0.2 }, NEUTRAL);
const BLOCK = poseOf({ ...torso(0.1, 0, 0, -0.2), [HDY]: 0.15, [HDX]: -0.12, ...armR('BLK_R'), ...armL('BLK_L'), ...legs(-0.35, 0.45, 0.25, 0.35), [LLZ]: 0.05, [LRZ]: -0.05 }, NEUTRAL);
const AIR_UP = poseOf({ [SPX]: 0.08, [LLX]: -0.85, [KLX]: 1.3, [LRX]: 0.15, [KRX]: 0.75, [ALX]: -0.4, [ALZ]: 0.45, [ARX]: -0.3, [ARZ]: -0.45, [FLX]: -0.5, [FRX]: -0.6 }, NEUTRAL);
const AIR_DOWN = poseOf({ [SPX]: 0.05, [HDX]: 0.1, [LLX]: -0.35, [KLX]: 0.45, [LRX]: -0.05, [KRX]: 0.3, [ALX]: -0.5, [ALZ]: 0.75, [ARX]: -0.45, [ARZ]: -0.75, [FLX]: -0.3, [FRX]: -0.35 }, NEUTRAL);
const SWIM = poseOf({ [BRX]: 1.35, [HDX]: -0.85, [SPX]: -0.08, [LLX]: 0.1, [LRX]: 0.1, [KLX]: 0.25, [KRX]: 0.25, [ALZ]: 0.25, [ARZ]: -0.25 }, NEUTRAL);
const TREAD = poseOf({ [BRX]: 0.25, [HDX]: -0.2, [LLX]: -0.3, [LRX]: 0.1, [KLX]: 0.6, [KRX]: 0.5, [ALZ]: 0.9, [ARZ]: -0.9, [FLX]: -0.5, [FRX]: -0.5, [ALX]: -0.3, [ARX]: -0.3 }, NEUTRAL);
const FLIGHT = poseOf({ [BRX]: 1.1, [HDX]: -0.9, [SPX]: -0.05, [ALX]: 0.35, [ALZ]: 0.3, [FLX]: -0.25, [ARX]: 0.35, [ARZ]: -0.3, [FRX]: -0.25, [LLX]: 0.12, [LRX]: 0.3, [KLX]: 0.3, [KRX]: 0.55 }, NEUTRAL);
const HOVER = poseOf({ [BRX]: 0.15, [SPX]: 0.05, [ALX]: -0.2, [ALZ]: 0.45, [ARX]: -0.2, [ARZ]: -0.45, [FLX]: -0.5, [FRX]: -0.5, [LLX]: -0.2, [LRX]: 0.1, [KLX]: 0.5, [KRX]: 0.35 }, NEUTRAL);
const TUCK = poseOf({ [SPX]: 0.65, [CHX]: 0.35, [HDX]: 0.5, [ALX]: -0.9, [ALZ]: 0.15, [FLX]: -1.9, [ARX]: -0.9, [ARZ]: -0.15, [FRX]: -1.9, [WRX]: -1.3, [LLX]: -2.25, [LRX]: -2.15, [KLX]: 2.4, [KRX]: 2.35, [LLZ]: 0.08, [LRZ]: -0.08 }, NEUTRAL);
const DEATH = poseOf({ [SPX]: -0.25, [CHX]: -0.15, [HDX]: -0.4, [HDZ]: 0.3, [ALX]: -2.2, [ALZ]: 0.9, [FLX]: -0.4, [ARX]: -2.4, [ARZ]: -0.7, [FRX]: -0.6, [LLX]: -0.4, [KLX]: 0.7, [LRX]: 0.05, [KRX]: 0.15, [LLZ]: 0.12, [LRZ]: -0.1 }, NEUTRAL);
const STAGGER = poseOf({ [SPX]: -0.35, [CHX]: -0.2, [HDX]: -0.45, [ALX]: -0.6, [ALZ]: 0.7, [ARX]: -0.5, [ARZ]: -0.7, [FLX]: -0.6, [FRX]: -0.6, [LLX]: 0.25, [KLX]: 0.55, [LRX]: -0.2, [KRX]: 0.5 }, NEUTRAL);

interface State {
  j: Joints;
  prof: Profile;
  cur: Float32Array;
  tgt: Float32Array;
  out: Float32Array;
  tmp: Float32Array;
  t: number;
  fresh: boolean;
  mv: number;
  run: number;
  sprint: number;
  crouch: number;
  block: number;
  air: number;
  airT: number;
  swim: number;
  fly: number;
  aim: number;
  fury: number;
  back: number;
  hipYaw: number;
  yawRate: number;
  lastYaw: number;
  accel: number;
  lastSpd: number;
  act: number;
  spin: number;
  roll: number;
  tuck: number;
  latched: boolean;
  lastStyle: string;
  lastAttack: number;
  lastWindup: number;
  lastDraw: number;
  lastHurt: number;
  hurtSide: number;
  deadSide: number;
  /** Cape and tail springs: angle x, velocity x, angle z, velocity z per segment. */
  cape: Float32Array;
  tail: Float32Array;
  wing: number;
  weapon: O3 | undefined;
  weaponLen: number;
  left: O3 | undefined;
  bow: boolean;
  /** The left hand's item stands upright (a bow or lyre). */
  upright: boolean;
  /** A rune circle's ring, spun about the wrist. */
  orbit: O3 | undefined;
  /** A big two-hander rests on the shoulder. */
  shoulder: boolean;
  shield: boolean;
  leftTwist: number;
  /** How a charge carries the weapon: 0 arms swept back, 1 a blade cocked high, 2 a heavy weapon in both hands, 3 a spear levelled. */
  carry: number;
}

const states = new WeakMap<O3, State>();

function newState(j: Joints, prof: Profile): State {
  return {
    j, prof, cur: NEUTRAL.slice(), tgt: new Float32Array(NCH), out: new Float32Array(NCH), tmp: new Float32Array(NCH), t: 0, fresh: true,
    mv: 0, run: 0, sprint: 0, crouch: 0, block: 0, air: 0, airT: 0, swim: 0, fly: 0, aim: 0, fury: 0, back: 0, hipYaw: 0, yawRate: 0, lastYaw: 0, accel: 0, lastSpd: 0,
    act: 0, spin: 0, roll: 0, tuck: 0, latched: false, lastStyle: '', lastAttack: -1, lastWindup: 0, lastDraw: 0, lastHurt: 0, hurtSide: 1, deadSide: 1,
    cape: new Float32Array(16), tail: new Float32Array(16), wing: 0, weapon: undefined, weaponLen: 0, left: undefined, bow: false, upright: false, orbit: undefined, shoulder: false, shield: false, leftTwist: 0, carry: 0,
  };
}

/** Adds `w` of the difference between `pose` and the base to `o` (channel-wise blend). */
function blend(o: Float32Array, pose: Float32Array, w: number, upperOnly = false) {
  if (w <= 0.001) return;
  for (let c = 0; c < NCH; c++) if (!upperOnly || isUpper(c)) o[c] += (pose[c] - o[c]) * w;
}

/** One stride of the walk/run cycle at phase p, added to `o`. */
function stride(o: Float32Array, p: number, run: number, sprint: number, crouch: number, robe: number, legs: number, arms: number, armsR: number) {
  const sp = Math.sin(p);
  const amp = lerp(0.4, 0.8, run) * (1 - 0.35 * crouch) * (1 - 0.3 * robe) * (1 + 0.12 * sprint);
  const bias = -0.2 * run;
  const lift = (q: number) => Math.pow(Math.max(0, Math.cos(q + 0.5 - 0.15 * run)), 1.4);
  const load = (q: number) => Math.pow(Math.max(0, Math.cos(q - 2.1)), 2);
  const kSw = lerp(1.0, 1.95, run) * (1 - 0.3 * robe);
  const kSt = lerp(0.12, 0.42, run);
  const swL = lift(p);
  const swR = lift(p + PI);
  o[LLX] += legs * (-amp * sp + bias);
  o[LRX] += legs * (amp * sp + bias);
  o[KLX] += legs * (kSw * swL + kSt * load(p));
  o[KRX] += legs * (kSw * swR + kSt * load(p + PI));
  o[TLX] += legs * 0.4 * swL;
  o[TRX] += legs * 0.4 * swR;
  const twist = lerp(0.1, 0.17, run);
  o[HIY] += legs * twist * sp;
  o[HIZ] += legs * 0.035 * (1 - run) * Math.sin(2 * p);
  o[SPY] -= legs * twist * 0.5 * sp;
  o[CHY] -= legs * twist * 1.1 * sp;
  o[HDY] += legs * twist * 0.5 * sp;
  o[BY] += legs * (0.012 * (1 - run) * Math.cos(2 * p) + 0.055 * run * sp * sp);
  o[BX] += legs * 0.018 * (1 - run) * Math.sin(p);
  const swing = lerp(0.32, 0.7, run) * (1 + 0.3 * sprint);
  const elbow = lerp(-0.2, -1.35, run);
  o[ALX] += arms * swing * sp;
  o[ARX] -= armsR * swing * sp;
  o[FLX] += arms * (elbow - 0.3 * Math.max(0, -sp) * (0.4 + run));
  o[FRX] += armsR * (elbow - 0.3 * Math.max(0, sp) * (0.4 + run));
  o[ALZ] += arms * 0.06 * run;
  o[ARZ] -= armsR * 0.1 * run;
}

const THIGH = 0.43;
const SHIN = 0.415;
/** Height of a foot's lowest point above the body origin, from the leg angles. */
function footLow(o: Float32Array, thigh: number, knee: number, ankle: number, abd: number) {
  const a1 = o[HIX] + o[thigh];
  const a2 = a1 + o[knee];
  const a3 = a2 + o[ankle];
  const y = 0.93 - (THIGH * Math.cos(a1) + SHIN * Math.cos(a2)) * Math.cos(o[abd]);
  return y - 0.085 * Math.cos(a3) - Math.max(0.17 * Math.sin(a3), -0.06 * Math.sin(a3));
}

const _pivot = new THREE.Vector3();
const _euler = new THREE.Euler();
let _dt = 0;
let _steps = 1;
let _h = 0;
let _snap = false;
const easeTo = (cur: number, to: number, rate: number) => cur + (to - cur) * damp(rate, _dt);
const snapTo = (_cur: number, to: number) => to;
/** A damped spring (angle, velocity at i, i + 1) pulled toward `to`. */
function spring(arr: Float32Array, i: number, to: number, k: number, c: number) {
  if (_snap) {
    arr[i] = to;
    arr[i + 1] = 0;
    return;
  }
  for (let n = 0; n < _steps; n++) {
    arr[i + 1] += (k * (to - arr[i]) - c * arr[i + 1]) * _h;
    arr[i] += arr[i + 1] * _h;
  }
}

export function animateHumanoid(rig: Rig, a: AnimState): void {
  const s = states.get(rig.root);
  if (!s) return;
  const j = s.j;
  const prof = s.prof;
  let dt = a.t - s.t;
  const snap = s.fresh || dt < 0 || dt > 1;
  dt = snap ? 0 : Math.min(dt, 0.1);
  s.t = a.t;
  s.fresh = false;
  const t = a.t;

  // Hits and landings decay here (gameplay sets them to 1).
  if (a.hurt > s.lastHurt + 0.05) s.hurtSide = Math.random() < 0.5 ? -1 : 1;
  const hurt = a.hurt;
  const landing = a.landing;
  a.hurt = Math.max(0, a.hurt - dt * 3);
  a.landing = Math.max(0, a.landing - dt * 2.6);
  s.lastHurt = a.hurt;

  // What is in the hands.
  const weapon = j.handR.children[0];
  if (weapon !== s.weapon) {
    s.weapon = weapon;
    let len = 0;
    weapon?.traverse((m) => {
      const g = (m as THREE.Mesh).geometry;
      if (!g) return;
      if (!g.boundingBox) g.computeBoundingBox();
      len = Math.max(len, m.position.y + g.boundingBox!.max.y);
    });
    s.weaponLen = len;
    const kind = weapon?.userData.kind;
    s.carry = CARRY[kind] ?? 0;
    s.shoulder = kind === 'greatsword' || kind === 'battleaxe';
  }
  const left = j.handL.children[0];
  if (left !== s.left) {
    s.left = left;
    s.bow = !!left && left.userData.bow !== undefined;
    // A lyre stands upright in the hand like a bow; a rune circle orbits the wrist.
    s.upright = s.bow || left?.userData.kind === 'lyre';
    s.orbit = left?.userData.orbit;
    s.shield = !!left && !s.bow && !left.userData.offhand;
    // Turn a shield so its face looks outward at rest and forward in a block,
    // whichever way it was attached.
    s.leftTwist = 0;
    if (s.shield) {
      const n = _pivot.set(0, 0, 1).applyQuaternion(left.quaternion);
      s.leftTwist = -PI / 2 - Math.atan2(n.x, n.z);
    }
  }

  const dead = a.dead >= 0;
  const rolling = a.rolling >= 0 && !dead;
  const spd = a.speed > 0.05 ? a.speed : a.moving * 7;
  let mx = a.moveX;
  let mz = a.moveZ;
  if (Math.abs(mx) + Math.abs(mz) < 0.05) (mx = 0), (mz = 1);
  const swimming = a.swimming && !dead;
  const flying = a.flying && !dead && !swimming;
  const airborne = a.airborne && !flying && !swimming && !dead;

  // Smoothed state weights.
  const approach = snap ? snapTo : easeTo;
  _dt = dt;
  s.mv = approach(s.mv, dead ? 0 : clamp01(a.moving * 1.25), 9);
  s.run = approach(s.run, smooth(2.5, 6, spd), 6);
  s.sprint = approach(s.sprint, smooth(8.5, 10.5, spd), 5);
  s.crouch = approach(s.crouch, a.crouching && !swimming && !flying ? 1 : 0, 9);
  s.block = approach(s.block, a.blocking && !dead ? 1 : 0, 16);
  s.air = approach(s.air, airborne ? 1 : 0, 10);
  s.airT = airborne ? s.airT + dt : 0;
  s.swim = approach(s.swim, swimming ? 1 : 0, 5);
  s.fly = approach(s.fly, flying ? 1 : 0, 4);
  s.aim = approach(s.aim, a.draw > 0.01 && !dead ? 1 : 0, 10);
  s.fury = approach(s.fury, a.fury, 4);
  s.back = approach(s.back, mz < -0.2 ? 1 : 0, 6);
  // Strafing turns the hips toward the travel direction; the chest stays on target.
  let yaw = Math.atan2(mx, mz);
  if (mz < -0.2) yaw = wrap(yaw - PI);
  s.hipYaw = approach(s.hipYaw, clamp(yaw, -1.2, 1.2) * 0.75 * clamp01(a.moving * 2), 7);
  const ry = rig.root.rotation.y;
  const turn = dt > 0 ? wrap(ry - s.lastYaw) / dt : 0;
  s.lastYaw = ry;
  s.yawRate = approach(s.yawRate, clamp(turn, -6, 6), 6);
  s.accel = approach(s.accel, dt > 0 ? clamp((spd - s.lastSpd) / dt, -30, 30) : 0, 5);
  s.lastSpd = spd;

  // The current move and where we are in it.
  const style = a.attackStyle;
  const mv = MOVES[style] ?? MOVES.slash!;
  const attacking = a.attack >= 0 && !dead && !rolling;
  const winding = !attacking && a.windup > 0.01 && !dead && !rolling;
  if (attacking && (s.lastAttack < 0 || style !== s.lastStyle || a.attack < s.lastAttack - 0.25)) {
    // A move that was telegraphed (or a drawn bow) starts past its anticipation.
    s.latched = s.lastWindup > 0.3 || a.windup > 0.3 || s.lastDraw > 0.3 || a.draw > 0.3;
  }
  s.lastAttack = attacking ? a.attack : -1;
  s.lastStyle = style;
  s.lastWindup = a.windup;
  s.lastDraw = a.draw;
  let v = -1;
  if (attacking) v = s.latched ? mv.A + (1 - mv.A) * a.attack : a.attack;
  else if (winding) v = mv.A * clamp01(a.windup);
  s.act = approach(s.act, v >= 0 ? 1 : 0, 12);

  // ---- Target pose.
  const g = s.tgt;
  g.set(NEUTRAL);
  // Swords rest pointing forward and down; staves and tridents stand upright.
  // Greatswords and battle axes lean back against the shoulder.
  g[WRX] = s.shoulder ? REST_SHOULDER[0] : s.weaponLen >= 1.45 ? -1.25 : s.weaponLen > 0 ? 0.6 : 0;
  g[WRZ] = s.shoulder ? REST_SHOULDER[1] : s.weaponLen >= 1.45 ? 0.22 : s.weaponLen > 0 ? 0.12 : 0;
  if (s.upright) g[WLX] = PI / 2;
  blend(g, CROUCH, s.crouch);
  // Running leans into the stride; acceleration and turns lean the body.
  g[SPX] += s.mv * (0.14 * s.run + 0.14 * s.sprint) + clamp(s.accel * 0.012, -0.1, 0.12) * s.mv;
  g[HDX] -= s.mv * 0.1 * s.run;
  g[BRZ] -= s.yawRate * 0.03 * s.mv * (0.3 + s.run);
  g[HIY] += s.hipYaw;
  g[SPY] -= s.hipYaw * 0.5;
  g[CHY] -= s.hipYaw * 0.45;
  // Airborne: knees up on the way up, legs reaching down later.
  if (s.air > 0.001) {
    const fall = smooth(0.25, 0.6, s.airT);
    for (let c = 0; c < NCH; c++) g[c] += (lerp(AIR_UP[c], AIR_DOWN[c], fall) - g[c]) * s.air;
  }
  // Running with a sword, dagger, axe or hammer carries it ready to strike.
  const chargeW = s.carry ? s.mv * (1 - s.back) * (1 - s.crouch) * (1 - s.air) * s.run : 0;
  if (chargeW > 0.001) {
    const p = s.carry === 1 ? CHARGE_BLADE : s.carry === 3 ? CHARGE_SPEAR : CHARGE_HEAVY;
    for (const c of CHARGE_ARMS) g[c] += ((s.shield && c < ARX ? CHARGE_BLADE[c] : p[c]) - g[c]) * chargeW;
    g[SPY] += (p[SPY] - g[SPY]) * chargeW;
    g[CHY] += (p[CHY] - g[CHY]) * chargeW;
  }
  blend(g, BLOCK, s.block * (1 - s.air));
  if (s.aim > 0.001) {
    const d = clamp01(a.draw);
    for (let c = 0; c < NCH; c++) {
      const p = AIM_REST_P[c] + (AIM_DRAWN_P[c] - AIM_REST_P[c]) * d;
      if (isUpper(c) || c === HIY) g[c] += (p - g[c]) * s.aim;
    }
  }
  if (s.swim > 0.001) {
    for (let c = 0; c < NCH; c++) g[c] += (lerp(TREAD[c], SWIM[c], s.mv) - g[c]) * s.swim;
  }
  if (s.fly > 0.001) {
    for (let c = 0; c < NCH; c++) g[c] += (lerp(HOVER[c], FLIGHT[c], s.mv) - g[c]) * s.fly;
  }
  // The move owns the upper body; the legs share with locomotion while moving.
  if (v >= 0) {
    const p = s.tmp;
    sample(mv, v, p);
    if (mv.twoHand && s.shield) for (const c of LEFT_ARM) p[c] = GUARD_LP[c];
    const legsK = (mv.legs ?? 1) * (1 - 0.7 * s.mv) * (1 - s.swim) * (1 - s.fly);
    for (let c = 0; c < NCH; c++) {
      if (isUpper(c)) g[c] = p[c];
      else g[c] += (p[c] - g[c]) * legsK;
    }
    if (style === 'blow' && v > 0.42 && v < 0.84) {
      // The whole body shakes with the blast.
      const q = Math.sin(t * 53) * 0.012;
      g[CHX] += q;
      g[HDX] += q;
    }
    if (style === 'roar' && v > 0.36 && v < 0.82) {
      const q = Math.sin(t * 47) * 0.025;
      g[CHX] += q;
      g[ALZ] += q;
      g[ARZ] -= q;
    }
  }

  // Additive posture: heavy builds stand wide, hunched bosses lean in.
  g[LLZ] += 0.05 * prof.heavy;
  g[LRZ] -= 0.05 * prof.heavy;
  g[ALZ] += 0.1 * prof.heavy;
  g[ARZ] -= 0.1 * prof.heavy;
  g[SPX] += 0.5 * prof.hunch;
  g[CHX] += 0.35 * prof.hunch;
  g[HDX] -= 0.7 * prof.hunch;
  g[KLX] += 0.3 * prof.hunch;
  g[KRX] += 0.3 * prof.hunch;
  g[LLX] -= 0.15 * prof.hunch;
  g[LRX] -= 0.15 * prof.hunch;
  // Fury: an aggressive, coiled stance.
  const f = s.fury;
  if (f > 0.001) {
    g[SPX] += 0.2 * f;
    g[CHX] += 0.08 * f;
    g[HDX] -= 0.25 * f;
    g[ALZ] += 0.15 * f;
    g[ARZ] -= 0.15 * f;
    g[FLX] -= 0.35 * f;
    g[FRX] -= 0.2 * f;
    g[KLX] += 0.25 * f;
    g[KRX] += 0.25 * f;
    g[LLX] -= 0.12 * f;
    g[LRX] -= 0.12 * f;
    g[LLZ] += 0.05 * f;
    g[LRZ] -= 0.05 * f;
  }
  // Landing squash and hit flinch.
  if (landing > 0.001) {
    const l = landing * landing;
    g[LLX] -= 0.7 * l;
    g[LRX] -= 0.6 * l;
    g[KLX] += 1.3 * l;
    g[KRX] += 1.2 * l;
    g[SPX] += 0.35 * l;
    g[CHX] += 0.1 * l;
    g[HDX] -= 0.2 * l;
    g[ALZ] += 0.3 * l;
    g[ARZ] -= 0.3 * l;
  }
  if (hurt > 0.001) {
    const h = hurt * hurt * (3 - 2 * hurt);
    const sd = s.hurtSide;
    g[SPX] -= 0.3 * h;
    g[CHX] -= 0.15 * h;
    g[HDX] -= 0.35 * h;
    g[HDZ] += 0.25 * sd * h;
    g[SPZ] += 0.12 * sd * h;
    g[CHY] += 0.15 * sd * h;
    g[ALZ] += 0.35 * h;
    g[ARZ] -= 0.35 * h;
    g[ALX] -= 0.3 * h;
    g[ARX] -= 0.2 * h;
    g[BZ] -= 0.06 * h;
    g[KLX] += 0.3 * h;
    g[KRX] += 0.3 * h;
  }

  // Roll: crouch, tuck, a full turn around the centre of mass, rise.
  let rollW = 0;
  if (rolling) {
    const u = a.rolling;
    s.tuck = smooth(0, 0.12, u) * (1 - smooth(0.7, 0.95, u));
    blend(g, TUCK, s.tuck);
    g[BRX] = 0;
    const r = clamp01((u - 0.06) / 0.7);
    s.roll = TAU * (r < 0.5 ? 2 * r * r : 1 - Math.pow(-2 * r + 2, 2) / 2);
    rollW = smooth(0.02, 0.16, u) * (1 - smooth(0.74, 0.97, u));
  } else {
    s.tuck = 0;
    // An interrupted roll or spin settles to the nearest whole turn.
    const near = Math.round(s.roll / TAU) * TAU;
    s.roll = Math.abs(s.roll - near) < 1e-3 ? 0 : s.roll + (near - s.roll) * damp(10, dt);
  }
  if (v >= 0 && mv.spin && attacking) {
    const [f0, f1] = mv.spin;
    const r = clamp01((v - f0) / (f1 - f0));
    s.spin = TAU * (r < 0.5 ? 2 * r * r : 1 - Math.pow(-2 * r + 2, 2) / 2);
  } else {
    const near = Math.round(s.spin / TAU) * TAU;
    s.spin = Math.abs(s.spin - near) < 1e-3 ? 0 : s.spin + (near - s.spin) * damp(10, dt);
  }

  // Death: stagger, then topple backward.
  let fall = 0;
  if (dead) {
    if (a.dead < 0.05) s.deadSide = Math.random() < 0.5 ? -1 : 1;
    const st = smooth(0, 0.25, a.dead) * (1 - smooth(0.3, 0.6, a.dead));
    blend(g, STAGGER, st);
    blend(g, DEATH, smooth(0.3, 0.9, a.dead));
    g[HDZ] *= s.deadSide;
    const k = clamp01((a.dead - 0.28) / 0.55);
    fall = k * k;
  }

  // ---- Ease every joint toward the target.
  const busy = v >= 0;
  // Moves are keyed smoothly already, so they only need a stiff ease (which
  // still blends in and out of them, and between chained combo swings).
  // The stiff ease ramps up over the first few frames of a move or roll, so
  // starting one blends out of the current pose instead of twitching.
  const rollIn = rolling ? smooth(0, 0.14, a.rolling) : 0;
  const rate = (dead ? 9 : rolling ? 12 + 18 * rollIn : busy ? 18 + 37 * s.act : s.block > 0.5 ? 18 : 12) * (1 - 0.25 * prof.heavy);
  const kk = snap ? 1 : damp(rate, dt);
  const cur = s.cur;
  for (let c = 0; c < NCH; c++) cur[c] += (g[c] - cur[c]) * kk;

  // ---- Undamped motion on top: stride, breathing, swim strokes, flight.
  const o = s.out;
  o.set(cur);
  const legsFree = (1 - rollW) * (1 - s.swim) * (1 - s.fly) * (1 - s.air) * (dead ? 0 : 1);
  const armsFree = (1 - s.act) * (1 - s.block) * (1 - s.aim) * (1 - s.swim) * (1 - s.fly) * (1 - s.tuck) * (dead ? 0 : 1);
  if (s.mv > 0.001) {
    const w = s.mv;
    const legs = w * legsFree * (1 - (busy ? (mv.legs ?? 1) * 0.3 : 0));
    const arms = w * armsFree;
    // A weapon arm swings less and stays straighter.
    const armsR = s.weaponLen > 0 ? 0.55 : 1;
    // Charging: running flat out, the body drives forward and both arms sweep
    // back behind it (halfway at a run, fully at a sprint), barely pumping.
    // A sword, axe or hammer is carried ready instead (see the target pose).
    const charge = arms * (1 - s.back) * (1 - s.crouch) * (1 - prof.robe * 0.5) * clamp01(0.5 * s.run + 0.5 * s.sprint);
    const pump = 1 - (s.carry ? 0.9 : 0.75) * charge;
    if (s.back < 0.999) stride(o, a.phase, s.run, s.sprint, s.crouch, prof.robe, legs * (1 - s.back), arms * (1 - s.back) * pump, arms * armsR * (1 - s.back) * pump);
    if (s.back > 0.001) stride(o, -a.phase, s.run * 0.6, 0, s.crouch, prof.robe, legs * s.back, arms * s.back, arms * armsR * s.back);
    if (charge > 0.001) {
      o[SPX] += charge * (0.36 + 0.03 * Math.cos(a.phase * 2));
      o[CHX] += charge * 0.16;
      o[HDX] -= charge * 0.42;
    }
    if (charge > 0.001 && !s.carry) {
      const bob = Math.sin(a.phase * 2) * 0.06;
      o[ALX] += charge * (0.78 + bob);
      o[ARX] += charge * (0.78 - bob);
      o[ALZ] += charge * 0.12;
      o[ARZ] -= charge * 0.12;
      o[ALY] += charge * 0.3;
      o[ARY] -= charge * 0.3;
      o[FLX] += charge * 0.95;
      o[FRX] += charge * 0.95;
    }
  }
  // Breathing, weight shift and a wandering gaze when idle.
  const idle = (1 - s.mv) * (1 - s.act) * (dead ? 0 : 1);
  const br = Math.sin(t * (1.7 + 1.6 * s.fury));
  o[CHX] += 0.022 * br * (1 + s.fury);
  o[ALZ] += 0.015 * br;
  o[ARZ] -= 0.015 * br;
  if (idle > 0.001) {
    const sh = Math.sin(t * 0.55);
    o[BX] += 0.018 * sh * idle;
    o[HIZ] -= 0.035 * sh * idle;
    o[SPZ] += 0.025 * sh * idle;
    o[KLX] += 0.07 * Math.max(0, -sh) * idle;
    o[KRX] += 0.07 * Math.max(0, sh) * idle;
    o[HDY] += 0.22 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1) * idle * (1 - s.aim);
    o[HDX] += 0.04 * Math.sin(t * 0.29 + 2) * idle;
  }
  if (s.swim > 0.001) {
    const q = t * (s.mv > 0.3 ? 3.4 : 2.2);
    const crawl = s.swim * s.mv;
    const tread = s.swim * (1 - s.mv);
    o[ALX] += crawl * (-1.6 + 1.7 * Math.sin(q));
    o[ARX] += crawl * (-1.6 + 1.7 * Math.sin(q + PI));
    o[FLX] += crawl * -0.5 * Math.max(0, Math.cos(q));
    o[FRX] += crawl * -0.5 * Math.max(0, Math.cos(q + PI));
    o[ALZ] += crawl * 0.25 * Math.max(0, Math.cos(q));
    o[ARZ] -= crawl * 0.25 * Math.max(0, Math.cos(q + PI));
    o[CHY] += crawl * 0.18 * Math.sin(q);
    o[LLX] += s.swim * 0.35 * Math.sin(q * 2.2);
    o[LRX] -= s.swim * 0.35 * Math.sin(q * 2.2);
    o[ALY] += tread * 0.6 * Math.sin(q);
    o[ARY] -= tread * 0.6 * Math.sin(q);
    o[KLX] += tread * 0.3 * Math.max(0, Math.sin(q));
    o[KRX] += tread * 0.3 * Math.max(0, -Math.sin(q));
  }
  if (s.fly > 0.001) {
    const q = t * 2.2;
    o[LLX] += s.fly * 0.12 * Math.sin(q);
    o[LRX] -= s.fly * 0.12 * Math.sin(q);
    o[BY] += s.fly * 0.06 * Math.sin(t * 6.5);
  }

  // Feet: flat on the ground while planted, relaxed in the air.
  const planted = (1 - rollW) * (1 - s.swim) * (1 - s.fly) * (1 - s.air) * (1 - fall);
  const lowL = footLow(o, LLX, KLX, TLX, LLZ);
  const lowR = footLow(o, LRX, KRX, TRX, LRZ);
  const low = Math.min(lowL, lowR);
  const flatL = planted * (1 - smooth(0.02, 0.12, lowL - low)) * 0.9;
  const flatR = planted * (1 - smooth(0.02, 0.12, lowR - low)) * 0.9;
  o[TLX] = lerp(o[TLX] + 0.25 * (1 - planted), -(o[HIX] + o[LLX] + o[KLX]), flatL);
  o[TRX] = lerp(o[TRX] + 0.25 * (1 - planted), -(o[HIX] + o[LRX] + o[KRX]), flatR);
  // On the move the weapon is held steady against the arm swing: blades
  // trail low behind at a run, staves and spears angle forward.
  // A charge holds the weapon in its own pose.
  const carried = s.carry ? (1 - s.back) * (1 - s.crouch) * s.run : 0;
  // (A shouldered two-hander just sways with the arm at a walk.)
  const hold = s.mv * armsFree * (s.weaponLen > 0 && !s.shoulder ? 1 : 0) * (1 - carried);
  if (hold > 0.001) {
    const fore = -(o[ARX] + o[FRX]);
    const want = s.weaponLen >= 1.45 ? 2.55 : lerp(0.95, -1.05, s.run);
    o[WRX] = lerp(o[WRX], PI / 2 - want + fore, hold);
  }
  // Keep elbows and knees bending the right way.
  o[FLX] = Math.min(o[FLX], 0.05);
  o[FRX] = Math.min(o[FRX], 0.05);
  o[KLX] = Math.max(o[KLX], 0);
  o[KRX] = Math.max(o[KRX], 0);
  // Plant the lower foot on the ground (less so mid-run, when both feet fly).
  const ground = planted * (1 - 0.85 * s.run * s.mv * legsFree);
  const plant = -Math.min(footLow(o, LLX, KLX, TLX, LLZ), footLow(o, LRX, KRX, TRX, LRZ)) * ground;

  // ---- Pose the joints.
  // The body turns about a pivot: the feet normally, the centre of mass in a
  // roll, the chest while swimming or flying, the heels when falling dead.
  const pivY = Math.max(rollW * 0.95, s.swim * 1.0, s.fly * 1.05) * (1 - fall);
  const pivZ = rollW * 0.12 - fall * 0.1;
  const rollDrop = rollW * 0.5;
  const body = j.body;
  body.rotation.set(o[BRX] + s.roll - fall * (PI / 2 - 0.04), o[BRY] + s.spin + fall * 0.25 * s.deadSide, o[BRZ] + fall * 0.12 * s.deadSide);
  _pivot.set(0, pivY, pivZ).applyEuler(_euler.copy(body.rotation));
  body.position.set(o[BX] - _pivot.x, o[BY] + plant - rollDrop + pivY - _pivot.y + fall * 0.16, o[BZ] + pivZ - _pivot.z);
  j.hips.rotation.set(o[HIX], o[HIY], o[HIZ]);
  j.spine.rotation.set(o[SPX], o[SPY], o[SPZ]);
  j.chest.rotation.set(o[CHX], o[CHY], o[CHZ]);
  j.head.rotation.set(o[HDX], o[HDY], o[HDZ]);
  j.armL.rotation.set(o[ALX], o[ALY], o[ALZ]);
  j.foreL.rotation.set(o[FLX], o[FLY], 0);
  j.handL.rotation.set(o[WLX], PI + o[WLY] + s.leftTwist, o[WLZ]);
  j.armR.rotation.set(o[ARX], o[ARY], o[ARZ]);
  j.foreR.rotation.set(o[FRX], o[FRY], 0);
  j.handR.rotation.set(PI / 2 + o[WRX], o[WRY], o[WRZ]);
  j.legL.rotation.set(o[LLX], o[LLY], o[LLZ]);
  j.shinL.rotation.x = o[KLX];
  j.footL.rotation.x = o[TLX];
  j.legR.rotation.set(o[LRX], o[LRY], o[LRZ]);
  j.shinR.rotation.x = o[KRX];
  j.footR.rotation.x = o[TRX];
  // A rune circle turns about the wrist, faster while it works.
  if (s.orbit) {
    s.orbit.rotation.y = wrap(s.orbit.rotation.y + dt * (1.6 + 5 * s.act));
    s.orbit.position.y = -0.06 + 0.012 * Math.sin(t * 2.3);
  }

  secondary(s, a, o, dt, snap, rollW, fall);
}

const AIM_REST_P = poseOf(AIM_REST, NEUTRAL);
const GUARD_LP = poseOf(GUARD_L, READY);
const LEFT_ARM = [ALX, ALY, ALZ, FLX, FLY, WLX];
// Charging with a weapon ready. A sword or dagger is cocked high beside the
// head, the shield (or free hand) thrust out in front. An axe or hammer is
// carried in both hands low at the right hip, its head angled up over the
// shoulder, the chest turned into it (a shield arm stays out in front).
const CHARGE_BLADE = poseOf({ ...armR('CH_R'), ...armL('CH_L') });
const CHARGE_HEAVY = poseOf({ [SPY]: -0.15, [CHY]: -0.3, ...armR('CH_HR'), ...armL('CH_HL') });
// A spear is carried low and angled forward in both hands, ready to thrust.
const CHARGE_SPEAR = poseOf({ [SPY]: -0.3, [CHY]: -0.3, ...armR('SPC_R'), ...armL('SPC_L') });
/** How each weapon is carried at a run: 1 a blade cocked high, 2 a heavy weapon in both hands, 3 a spear levelled. */
const CARRY: Record<string, number> = { sword: 1, dagger: 1, longsword: 1, knives: 1, axe: 2, hammer: 2, greatsword: 2, battleaxe: 2, spear: 3 };
const REST_SHOULDER = [-1.9, 0.35];
const CHARGE_ARMS = [ALX, ALY, ALZ, FLX, FLY, WLX, WLY, WLZ, ARX, ARY, ARZ, FRX, FRY, WRX, WRY, WRZ];
const AIM_DRAWN_P = poseOf(AIM_DRAWN, NEUTRAL);

/** Cape, tail and wings: damped springs that trail the body's motion. */
function secondary(s: State, a: AnimState, o: Float32Array, dt: number, snap: boolean, rollW: number, fall: number) {
  const j = s.j;
  const t = a.t;
  _snap = snap;
  _steps = dt > 0.034 ? 2 : 1;
  _h = dt / _steps;
  const pitch = o[BRX] + o[HIX] + o[SPX] + o[CHX];
  if (j.cape.length) {
    for (let i = 0; i < 4; i++) {
      // Drag lifts it behind an upright runner; lying flat in flight it streams along the back.
      const drag = Math.max(0, Math.cos(pitch));
      const lift = (s.mv * (0.28 + 0.28 * s.run + 0.15 * s.sprint) * drag + s.air * 0.45) * (i === 0 ? 1 : 0.22);
      const wind = 0.04 * Math.sin(t * 1.7 + i * 0.9) + 0.02 * Math.sin(t * 3.1 + i * 1.7) + (0.06 * s.mv + 0.12 * s.fly) * Math.sin(t * (9 + 4 * s.fly) - i * 1.3);
      let to = (i === 0 ? 0.06 + s.prof.capeLift : 0.03) + lift + wind;
      // Hang with gravity, but never through the back.
      if (i === 0) to = Math.max(0.02 + s.prof.capeLift, to - pitch * 0.9);
      // In a roll it wraps the curled back.
      if (rollW > 0.05) to = lerp(to, i === 0 ? 0.02 : -0.45, rollW);
      if (fall > 0) to = lerp(to, 0.15, fall);
      spring(s.cape, i * 4, to, 70, 9);
      const side = clamp(-s.yawRate * 0.06 * (1 + i * 0.4) - s.hipYaw * 0.2 + 0.03 * Math.sin(t * 1.3 + i), -0.5, 0.5);
      spring(s.cape, i * 4 + 2, side, 50, 8);
      j.cape[i].rotation.set(s.cape[i * 4], 0, s.cape[i * 4 + 2]);
    }
  }
  if (j.tail.length) {
    for (let i = 0; i < 4; i++) {
      const sway = (0.22 - 0.1 * s.mv) * Math.sin(t * (1.8 + 2 * s.mv) - i * 0.9);
      spring(s.tail, i * 4, (0.12 * s.mv * s.run + 0.2 * s.air) * (i === 0 ? 1 : 0.4) - 0.04 * i * (1 - s.mv), 60, 8);
      spring(s.tail, i * 4 + 2, sway - s.yawRate * 0.05 * i, 40, 6);
      j.tail[i].rotation.set(-s.tail[i * 4], s.tail[i * 4 + 2], 0);
    }
  }
  if (j.wings) {
    const on = j.wings.userData.enabled !== false;
    j.wings.visible = on;
    j.wings.scale.setScalar(on ? 1 : 1e-4);
    s.wing += ((a.flying ? 1 : 0) - s.wing) * damp(5, dt);
    const open = s.wing;
    const flap = Math.sin(t * (open > 0.5 ? 7 : 1.6));
    for (let i = 0; i < 2; i++) {
      const root = j.wing[i * 2];
      const tip = j.wing[i * 2 + 1];
      const sd = root.userData.side as number;
      const beat = open * flap * (0.75 - 0.3 * s.mv);
      // Folded: swept back and gathered small; open: spread and beating.
      root.rotation.set(lerp(-0.3, 0, open), sd * lerp(1.15, 0.12, open), sd * (lerp(-0.85, 0.1, open) + beat + (1 - open) * 0.03 * flap));
      root.scale.setScalar(lerp(0.72, 1, open));
      tip.rotation.set(0, sd * lerp(0.7, 0.05, open), sd * open * 0.45 * Math.sin(t * 7 - 0.9));
      tip.scale.setScalar(lerp(0.32, 1, open));
    }
  }
}
