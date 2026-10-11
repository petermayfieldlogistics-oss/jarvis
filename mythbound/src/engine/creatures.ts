// Creatures and non-humanoid bosses: wolves, boars, magma hounds, the stag,
// drakes, scorpions, wraiths, watchers, imps, the crab and the witch.
//
// Each creature is one skinned mesh per surface (fur, shell, glow...) bound to
// a skeleton of plain Groups, so a whole wolf costs two or three draw calls
// while its spine, neck, jaw, tail and jointed legs bend smoothly. Geometry is
// authored in bind-pose model space (all joints unrotated); the animator then
// poses the joints toward target angles with frame-rate-independent damping.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { glowSprite } from './models';
import type { AnimState, AttackStyle } from './anim';

/** A jointed leg or arm: `up` at the hip/shoulder, `mid` at the knee/elbow, `low` at the ankle/wrist. */
export interface Limb {
  up: THREE.Group;
  mid: THREE.Group;
  low: THREE.Group;
  side: number;
  front: boolean;
  /** Bind-pose measurements for two-bone IK in the leg's sagittal (y,z) plane. */
  ik?: { l1: number; l2: number; a1: number; a2: number; bend: number; foot: V3; ankle: V3 };
}

export interface Wing {
  root: THREE.Group;
  fore: THREE.Group;
  hand: THREE.Group;
  fingers: THREE.Group[];
  side: number;
  /** Joint rotations that fold the wing against the body (the bind pose is fully spread). */
  fold: { root: THREE.Euler; fore: THREE.Euler; fingers: THREE.Euler[] };
}

/** A claw arm whose `finger` opens and snaps against the fixed half on `hand`. */
export interface Pincer {
  arm: THREE.Group;
  fore: THREE.Group;
  hand: THREE.Group;
  finger: THREE.Group;
  side: number;
}

/** Optional joints the animator drives; absent ones are skipped. */
export interface CreatureJoints {
  chest?: THREE.Group;
  hips?: THREE.Group;
  neck?: THREE.Group[];
  jaw?: THREE.Group;
  ears?: THREE.Group[];
  tail?: THREE.Group[];
  limbs?: Limb[];
  arms?: Limb[];
  wings?: Wing[];
  pincers?: Pincer[];
  /** Chains that sway on their own: robe tatters, tentacles, seaweed, hair. */
  strands?: THREE.Group[][];
  lids?: THREE.Group[];
  iris?: THREE.Group;
  pupil?: THREE.Group;
  stalks?: THREE.Group[];
  wisps?: THREE.Sprite[];
  /** A boss's own glow material, pulsed with fury and spellcasting. */
  glow?: THREE.MeshStandardMaterial;
  /** Hip height in model units; gait stride scales with it. */
  legLen?: number;
  /** Torso half-width: how high the body rests when it dies on its side. */
  girth?: number;
}

export interface CreatureRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  legs: THREE.Group[];
  extra: THREE.Object3D[];
  kind: string;
  height: number;
  j?: CreatureJoints;
}

// --------------------------------------------------------------- skinning --

type V3 = THREE.Vector3;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

type Surface = 'fur' | 'shell' | 'scale' | 'membrane' | 'ghost' | 'glow';
/** A flat colour, or a function of the bind-pose vertex position that may return an alpha (ghost only). */
type Shade = number | ((p: V3, out: THREE.Color) => number | void);
type Weights = [THREE.Object3D, number][];

const SURFACES: Record<Exclude<Surface, 'glow'>, THREE.MeshStandardMaterialParameters> = {
  fur: { roughness: 0.88 },
  shell: { roughness: 0.42, metalness: 0.2 },
  scale: { roughness: 0.6, metalness: 0.08, flatShading: true },
  membrane: { roughness: 0.8, side: THREE.DoubleSide },
  ghost: { roughness: 0.95, transparent: true, depthWrite: false },
};
const surfaceMats = new Map<Surface, THREE.MeshStandardMaterial>();

/** Emissive in the vertex colour: one material serves every glowing eye, crack and tip. */
function glowMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, roughness: 1, vertexColors: true });
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;');
  };
  m.customProgramCacheKey = () => 'mythbound-glow';
  return m;
}

function surfaceMaterial(s: Surface): THREE.MeshStandardMaterial {
  let m = surfaceMats.get(s);
  if (!m) {
    m = s === 'glow' ? glowMaterial() : new THREE.MeshStandardMaterial({ vertexColors: true, ...SURFACES[s] });
    surfaceMats.set(s, m);
  }
  return m;
}

const _c = new THREE.Color();
const _robeA = new THREE.Color();
const _robeB = new THREE.Color();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _r = new THREE.Vector3();

/** Builds one creature: joints, then geometry bound to them, then the skinned meshes. */
class Skin {
  readonly root = new THREE.Group();
  private bones: THREE.Object3D[] = [];
  private index = new Map<THREE.Object3D, number>();
  private geos = new Map<Surface, THREE.BufferGeometry[]>();

  /** A joint at a bind-pose model-space position. */
  joint(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group();
    const pw = parent.userData.w as V3 | undefined;
    g.position.set(x - (pw?.x ?? 0), y - (pw?.y ?? 0), z - (pw?.z ?? 0));
    g.userData.w = V(x, y, z);
    g.userData.bp = g.position.clone();
    parent.add(g);
    return g;
  }

  /** Geometry in model space, rigidly bound to one joint or blended along a chain (ending at `tip`). */
  add(surf: Surface, shade: Shade, geo: THREE.BufferGeometry, bind: THREE.Object3D | THREE.Object3D[], tip?: V3, gain = 1) {
    if (!Array.isArray(bind) || bind.length === 1) {
      const b = Array.isArray(bind) ? bind[0] : bind;
      const w: Weights = [[b, 1]];
      this.push(surf, shade, geo, () => w, gain);
    } else this.push(surf, shade, geo, chainWeights(bind, tip), gain);
  }

  /** Geometry whose vertices pick their own weights. */
  push(surf: Surface, shade: Shade, geo: THREE.BufferGeometry, weigh: (p: V3, i: number) => Weights, gain = 1) {
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pos = geo.attributes.position;
    const n = pos.count;
    const cs = surf === 'ghost' ? 4 : 3;
    const col = new Float32Array(n * cs);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      _p.fromBufferAttribute(pos, i);
      let alpha = 1;
      if (typeof shade === 'number') _c.setHex(shade);
      else alpha = shade(_p, _c) ?? 1;
      _c.multiplyScalar(gain);
      col[i * cs] = _c.r;
      col[i * cs + 1] = _c.g;
      col[i * cs + 2] = _c.b;
      if (cs === 4) col[i * cs + 3] = alpha;
      const w = weigh(_p, i);
      for (let k = 0; k < Math.min(4, w.length); k++) {
        si[i * 4 + k] = this.boneIndex(w[k][0]);
        sw[i * 4 + k] = w[k][1];
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, cs));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    const list = this.geos.get(surf) ?? [];
    list.push(geo);
    this.geos.set(surf, list);
  }

  private boneIndex(o: THREE.Object3D): number {
    let i = this.index.get(o);
    if (i === undefined) {
      i = this.bones.length;
      this.bones.push(o);
      this.index.set(o, i);
    }
    return i;
  }

  /** Merges each surface into one skinned mesh. A boss gets its own glow material so it can pulse. */
  build(ownGlow = false): THREE.MeshStandardMaterial | undefined {
    const root = this.root;
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones as unknown as THREE.Bone[]);
    let glow: THREE.MeshStandardMaterial | undefined;
    for (const [surf, list] of this.geos) {
      const geo = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!geo) continue;
      let material = surfaceMaterial(surf);
      if (surf === 'glow' && ownGlow) material = glow = glowMaterial();
      const mesh = new THREE.SkinnedMesh(geo, material);
      mesh.castShadow = surf !== 'glow';
      mesh.userData.keep = true;
      geo.computeBoundingSphere();
      const bs = geo.boundingSphere!.clone();
      bs.radius *= 1.6;
      mesh.boundingSphere = bs;
      root.add(mesh);
      mesh.bind(skeleton);
    }
    // The bone texture is rebuilt on demand if the model is ever shown again.
    root.addEventListener('removed', () => {
      skeleton.dispose();
      glow?.dispose();
    });
    return glow;
  }
}

/** Weights for a vertex bound along a chain of joints: nearest segment, blended near each joint. */
function chainWeights(bones: THREE.Object3D[], tip?: V3): (p: V3) => Weights {
  const pts = bones.map((b) => b.userData.w as V3);
  const last = pts[pts.length - 1];
  const end = tip ?? last.clone().add(last.clone().sub(pts[pts.length - 2]).multiplyScalar(0.5));
  const P = [...pts, end];
  const B = 0.38;
  return (p) => {
    let best = 0, bt = 0, bd = Infinity;
    for (let k = 0; k < bones.length; k++) {
      _q.subVectors(P[k + 1], P[k]);
      const len2 = _q.lengthSq() || 1e-6;
      const t = Math.min(1, Math.max(0, _r.subVectors(p, P[k]).dot(_q) / len2));
      const d = _r.copy(P[k]).addScaledVector(_q, t).distanceToSquared(p);
      if (d < bd) (bd = d), (best = k), (bt = t);
    }
    const wn = best + 1 < bones.length ? 0.5 * sstep(1 - B, 1, bt) : 0;
    const wp = best > 0 ? 0.5 * (1 - sstep(0, B, bt)) : 0;
    const w: Weights = [[bones[best], 1 - wn - wp]];
    if (wn > 0) w.push([bones[best + 1], wn]);
    if (wp > 0) w.push([bones[best - 1], wp]);
    return w;
  };
}

// --------------------------------------------------------------- geometry --

type Radius = number | [number, number];

/**
 * A tube through `pts` with a radius (or [half-width, half-height]) at each
 * point. A zero radius closes to a point; otherwise the ends get rounded caps.
 */
function tube(pts: V3[], radii: Radius[], seg = 6, o: { bulge?: number; open?: boolean; ref?: V3 } = {}): THREE.BufferGeometry {
  const bulge = o.bulge ?? 0.45;
  const pos: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  const T = V(), N = V(), B = V(), ref = V();
  const ring: number[] = [];
  const apex: boolean[] = [];
  const rad: number[] = [];
  const tans: V3[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) T.subVectors(pts[1], pts[0]);
    else if (i === n - 1) T.subVectors(pts[n - 1], pts[n - 2]);
    else T.subVectors(pts[i + 1], pts[i - 1]);
    T.normalize();
    tans.push(T.clone());
    if (i === 0) {
      if (o.ref) ref.copy(o.ref);
      else {
        ref.set(0, 1, 0);
        if (Math.abs(T.dot(ref)) > 0.9) ref.set(0, 0, 1);
      }
      N.copy(ref).addScaledVector(T, -ref.dot(T)).normalize();
    } else N.addScaledVector(T, -N.dot(T)).normalize();
    B.crossVectors(T, N);
    const r = radii[i];
    const rw = typeof r === 'number' ? r : r[0];
    const rh = typeof r === 'number' ? r : r[1];
    ring.push(pos.length / 3);
    rad.push(Math.max(rw, rh));
    if (rw < 1e-4 && rh < 1e-4) {
      pos.push(pts[i].x, pts[i].y, pts[i].z);
      apex.push(true);
      continue;
    }
    apex.push(false);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      pos.push(pts[i].x + B.x * c * rw + N.x * s * rh, pts[i].y + B.y * c * rw + N.y * s * rh, pts[i].z + B.z * c * rw + N.z * s * rh);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      const a = apex[i] ? ring[i] : ring[i] + j, c = apex[i] ? ring[i] : ring[i] + j1;
      const b = apex[i + 1] ? ring[i + 1] : ring[i + 1] + j, d = apex[i + 1] ? ring[i + 1] : ring[i + 1] + j1;
      if (!apex[i]) idx.push(a, b, c);
      if (!apex[i + 1]) idx.push(c, b, d);
    }
  }
  for (const [i, sign] of [[0, -1], [n - 1, 1]] as const) {
    if (apex[i] || (o.open && sign > 0)) continue;
    const ci = pos.length / 3;
    const t = tans[i];
    pos.push(pts[i].x + t.x * rad[i] * bulge * sign, pts[i].y + t.y * rad[i] * bulge * sign, pts[i].z + t.z * rad[i] * bulge * sign);
    for (let j = 0; j < seg; j++) {
      const a = ring[i] + j, b = ring[i] + ((j + 1) % seg);
      if (sign < 0) idx.push(ci, a, b);
      else idx.push(ci, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** An ellipsoid, optionally rotated (Euler XYZ). */
function ell(c: V3, rx: number, ry: number, rz: number, w = 10, h = 7, rot?: [number, number, number]): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
  g.translate(c.x, c.y, c.z);
  return g;
}

/** Part of a sphere shell (for eyelids and carapace plates). */
function shell(c: V3, r: number, thetaStart: number, thetaLen: number, rot: [number, number, number], scale: [number, number, number] = [1, 1, 1]): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 14, 6, 0, Math.PI * 2, thetaStart, thetaLen);
  g.scale(...scale);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
  g.translate(c.x, c.y, c.z);
  return g;
}

/** A cone from `base` to `tip`. */
const spike = (base: V3, tip: V3, r: number, seg = 4) => tube([base, tip], [r, 0], seg);

/** A flat clump of fur (or feather, or rag) lying on a surface whose outward normal is `n`. */
const tuft = (base: V3, tip: V3, w: number, n: V3) => tube([base, base.clone().lerp(tip, 0.5), tip], [[w, w * 0.22], [w * 0.75, w * 0.18], 0], 4, { ref: n });

/** Points along a quadratic Bezier. */
function bez(a: V3, b: V3, c: V3, n = 4): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push(V(u * u * a.x + 2 * u * t * b.x + t * t * c.x, u * u * a.y + 2 * u * t * b.y + t * t * c.y, u * u * a.z + 2 * u * t * b.z + t * t * c.z));
  }
  return out;
}

/** Radii tapering linearly from r0 to r1 over n points. */
const taper = (n: number, r0: number, r1: number) => Array.from({ length: n }, (_, i) => r0 + (r1 - r0) * (i / (n - 1)));

/** A vertical gradient from `bottom` (at y0) to `top` (at y1) with a little fur mottling. */
function grad(top: number, bottom: number, y0: number, y1: number, mottle = 0.1): Shade {
  const a = new THREE.Color(bottom), b = new THREE.Color(top);
  return (p, c) => {
    c.lerpColors(a, b, clamp01((p.y - y0) / (y1 - y0)));
    if (mottle) c.multiplyScalar(1 + mottle * Math.sin(p.x * 31 + p.z * 17) * Math.sin(p.z * 23 - p.y * 29));
  };
}

/** A colour scaled in brightness (and optionally blended toward another). */
function tint(color: number, k: number, toward?: number, amt = 0): number {
  const c = new THREE.Color(color);
  if (toward !== undefined) c.lerp(new THREE.Color(toward), amt);
  return c.multiplyScalar(k).getHex();
}

/** Body profile rings: [z, half-width, half-height, centre y]. */
type Profile = [number, number, number, number][];
const profileTube = (prof: Profile, seg = 10) => tube(prof.map(([z, , , y]) => V(0, y, z)), prof.map(([, w, h]) => [w, h] as [number, number]), seg);

/** A point on the surface of a profile body at depth z and angle a (0 = top, PI/2 = left side). */
function onProfile(prof: Profile, z: number, a: number, out = 1.0): V3 {
  let i = 0;
  while (i < prof.length - 2 && prof[i + 1][0] < z) i++;
  const [z0, w0, h0, y0] = prof[i];
  const [z1, w1, h1, y1] = prof[i + 1];
  const t = clamp01((z - z0) / (z1 - z0 || 1));
  const w = w0 + (w1 - w0) * t, h = h0 + (h1 - h0) * t, y = y0 + (y1 - y0) * t;
  return V(Math.sin(a) * w * out, y + Math.cos(a) * h * out, z);
}

// ---------------------------------------------------------------- helpers --

/** A leg through four points (top joint, middle joint, low joint, foot) blended along its three joints. */
function leg(sk: Skin, parent: THREE.Object3D, pts: V3[], radii: Radius[], shade: Shade, side: number, front: boolean, surf: Surface = 'fur'): Limb {
  const up = sk.joint(parent, pts[0].x, pts[0].y, pts[0].z);
  const mid = sk.joint(up, pts[1].x, pts[1].y, pts[1].z);
  const low = sk.joint(mid, pts[2].x, pts[2].y, pts[2].z);
  const path = [pts[0], pts[0].clone().lerp(pts[1], 0.5), pts[1], pts[1].clone().lerp(pts[2], 0.5), pts[2], pts[3]];
  const r = (x: Radius, y: Radius): Radius => (typeof x === 'number' && typeof y === 'number' ? (x + y) / 2 : x);
  sk.add(surf, shade, tube(path, [radii[0], r(radii[0], radii[1]), radii[1], r(radii[1], radii[2]), radii[2], radii[3]], 6), [up, mid, low], pts[3]);
  const [p0, p1, p2, p3] = pts;
  const a1 = Math.atan2(p1.z - p0.z, p1.y - p0.y);
  const base = Math.atan2(p2.z - p0.z, p2.y - p0.y);
  const ik = {
    l1: Math.hypot(p1.y - p0.y, p1.z - p0.z),
    l2: Math.hypot(p2.y - p1.y, p2.z - p1.z),
    a1,
    a2: Math.atan2(p2.z - p1.z, p2.y - p1.y),
    bend: Math.sign(Math.atan2(Math.sin(a1 - base), Math.cos(a1 - base))) || 1,
    foot: p3.clone(),
    ankle: p2.clone().sub(p3),
  };
  return { up, mid, low, side, front, ik };
}

/**
 * Two-bone IK in the leg's (y,z) plane: hip and knee angles that put the ankle
 * where the foot (at fy, fz in model space) needs it, plus the ankle angle
 * that keeps the paw at its rest attitude. `hy, hz, pitch` are the hip
 * joint's model-space position and its parent's pitch.
 */
function solveLeg(ik: NonNullable<Limb['ik']>, hy: number, hz: number, pitch: number, fy: number, fz: number, out: number[]) {
  const dy = fy + ik.ankle.y - hy, dz = fz + ik.ankle.z - hz;
  const c = Math.cos(-pitch), s = Math.sin(-pitch);
  const ty = dy * c - dz * s, tz = dy * s + dz * c;
  const d = Math.hypot(ty, tz) || 1e-4;
  const dc = Math.min(ik.l1 + ik.l2 - 1e-3, Math.max(Math.abs(ik.l1 - ik.l2) + 1e-3, d));
  const A = Math.acos(Math.max(-1, Math.min(1, (ik.l1 * ik.l1 + dc * dc - ik.l2 * ik.l2) / (2 * ik.l1 * dc))));
  const ang1 = Math.atan2(tz, ty) + ik.bend * A;
  const k = dc / d;
  const ang2 = Math.atan2(tz * k - Math.sin(ang1) * ik.l1, ty * k - Math.cos(ang1) * ik.l1);
  out[0] = wrap(ang1 - ik.a1);
  out[1] = wrap(ang2 - ik.a2 - out[0]);
  out[2] = wrap(-(pitch + out[0] + out[1]));
}
const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
const _ik = [0, 0, 0];

/** Model-space (y, z, pitch) of a child joint, given its parent's. */
function childFrame(o: THREE.Object3D, py: number, pz: number, pitch: number, out: number[]) {
  const c = Math.cos(pitch), s = Math.sin(pitch);
  out[0] = py + o.position.y * c - o.position.z * s;
  out[1] = pz + o.position.y * s + o.position.z * c;
  out[2] = pitch + o.rotation.x;
}
const _fr = [0, 0, 0];
const _fh = [0, 0, 0];

/** Shoulder or haunch muscle: rides the leg at the bottom, the torso at the top. */
function muscle(sk: Skin, surf: Surface, shade: Shade, geo: THREE.BufferGeometry, l: Limb) {
  const top = (l.up.userData.w as V3).y;
  const torso = l.up.parent!;
  sk.push(surf, shade, geo, (p) => {
    const w = sstep(top - 0.25, top + 0.05, p.y) * 0.7;
    return [[l.up, 1 - w], [torso, w]];
  });
}

/** A chain of joints along `pts` (the last point is the tip) skinned with one smooth tube. */
function chain(sk: Skin, parent: THREE.Object3D, pts: V3[], radii: Radius[], surf: Surface, shade: Shade, seg = 6): THREE.Group[] {
  const joints: THREE.Group[] = [];
  let p: THREE.Object3D = parent;
  for (let i = 0; i < pts.length - 1; i++) {
    p = sk.joint(p, pts[i].x, pts[i].y, pts[i].z);
    joints.push(p as THREE.Group);
  }
  sk.add(surf, shade, tube(pts, radii, seg), joints, pts[pts.length - 1]);
  return joints;
}

function finish(sk: Skin, kind: string, body: THREE.Group, head: THREE.Group, j: CreatureJoints, height: number, scale: number, ownGlow = false): CreatureRig {
  j.glow = sk.build(ownGlow);
  sk.root.scale.setScalar(scale);
  const legs = (j.limbs ?? []).map((l) => l.up);
  const extra: THREE.Object3D[] = [...(j.tail ?? []), ...(j.wings ?? []).map((w) => w.root), ...(j.pincers ?? []).map((p) => p.arm)];
  return { root: sk.root, body, head, legs, extra, kind, height: height * scale, j };
}

// ---------------------------------------------------------------- caching --

/**
 * Ordinary monsters spawn by the dozen, so each kind and colour is built once
 * as a template and then cloned: the clone shares the template's geometry
 * (which therefore must outlive any one monster) and gets its own joints and
 * skeleton. Bosses are built fresh with their own glow material.
 */
const templates = new Map<string, CreatureRig>();

function instance(key: string, scale: number, build: () => CreatureRig): CreatureRig {
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
  rig.root.scale.setScalar(scale * (t.root.scale.x || 1));
  rig.height = t.height * scale;
  return rig;
}

function cloneRig(t: CreatureRig): CreatureRig {
  const root = t.root.clone();
  const map = new Map<THREE.Object3D, THREE.Object3D>();
  const pair = (a: THREE.Object3D, b: THREE.Object3D) => {
    map.set(a, b);
    a.children.forEach((c, i) => pair(c, b.children[i]));
  };
  pair(t.root, root);
  const m = <T extends THREE.Object3D>(o: T): T => map.get(o) as T;
  // One skeleton over the cloned joints, shared by every surface.
  let skeleton: THREE.Skeleton | undefined;
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) {
      skeleton ??= new THREE.Skeleton(mesh.skeleton.bones.map(m), mesh.skeleton.boneInverses);
      mesh.bind(skeleton, mesh.bindMatrix);
    } else if ((o as THREE.Sprite).isSprite) {
      const sp = o as THREE.Sprite;
      sp.material = sp.material.clone();
    }
  });
  root.addEventListener('removed', () => skeleton?.dispose());
  const tj = t.j ?? {};
  const limb = (l: Limb): Limb => ({ ...l, up: m(l.up), mid: m(l.mid), low: m(l.low) });
  const j: CreatureJoints = {
    ...tj,
    chest: tj.chest && m(tj.chest),
    hips: tj.hips && m(tj.hips),
    neck: tj.neck?.map(m),
    jaw: tj.jaw && m(tj.jaw),
    ears: tj.ears?.map(m),
    tail: tj.tail?.map(m),
    limbs: tj.limbs?.map(limb),
    arms: tj.arms?.map(limb),
    wings: tj.wings?.map((w) => ({ ...w, root: m(w.root), fore: m(w.fore), hand: m(w.hand), fingers: w.fingers.map(m) })),
    pincers: tj.pincers?.map((p) => ({ ...p, arm: m(p.arm), fore: m(p.fore), hand: m(p.hand), finger: m(p.finger) })),
    strands: tj.strands?.map((c) => c.map(m)),
    lids: tj.lids?.map(m),
    iris: tj.iris && m(tj.iris),
    pupil: tj.pupil && m(tj.pupil),
    stalks: tj.stalks?.map(m),
    wisps: tj.wisps?.map(m),
  };
  return { root: root as THREE.Group, body: m(t.body), head: m(t.head), legs: t.legs.map(m), extra: t.extra.map(m), kind: t.kind, height: t.height, j };
}

// ------------------------------------------------------------ quadrupeds --

export function buildQuad(color: number, kind: 'wolf' | 'boar' | 'hound' | 'stag' | 'drake', scale = 1): CreatureRig {
  switch (kind) {
    case 'boar':
      return instance(`boar:${color}`, scale, () => buildBoar(color));
    case 'stag':
      return buildStag(color, scale);
    case 'drake':
      return instance(`drake:${color}`, scale, () => buildDrake(color));
    default:
      return instance(`${kind}:${color}`, scale, () => buildCanine(color, kind === 'hound'));
  }
}

function buildCanine(color: number, hound: boolean): CreatureRig {
  const sk = new Skin();
  const H = hound ? 1 : 0;
  const back = hound ? tint(color, 1.0) : tint(color, 0.72);
  const belly = hound ? tint(color, 0.55) : tint(color, 1.5, 0xd8cfc0, 0.4);
  const fur = grad(back, belly, 0.52, 0.92, hound ? 0.06 : 0.12);
  const pale = tint(color, 1.35, 0xd8cfc0, 0.35);
  const legShade = hound ? grad(tint(color, 0.8), 0x140c0a, 0.05, 0.7, 0.05) : grad(tint(color, 0.9), pale, 0.08, 0.6);
  const ty = 0.74 + H * 0.04;
  const body = sk.joint(sk.root, 0, ty, 0);
  const chest = sk.joint(body, 0, ty + 0.02, 0.26);
  const hips = sk.joint(body, 0, ty, -0.3);

  // Deep chest, tucked waist, rounded haunch; the hound is leaner and taller.
  const w = hound ? 0.92 : 1;
  const prof: Profile = [
    [-0.66, 0.05, 0.05, ty + 0.04], [-0.6, 0.12 * w, 0.13, ty + 0.03], [-0.47, 0.16 * w, 0.17, ty + 0.01], [-0.3, 0.15 * w, 0.155, ty + 0.02],
    [-0.12, 0.13 * w * (hound ? 0.9 : 1), 0.14 - H * 0.02, ty + 0.05], [0.06, 0.15 * w, 0.2, ty], [0.24, 0.17 * w, 0.24 + H * 0.02, ty - 0.03],
    [0.4, 0.16 * w, 0.22, ty + 0.01], [0.52, 0.12, 0.17, ty + 0.07], [0.6, 0.05, 0.08, ty + 0.11],
  ];
  const torso = [hips, chest];
  const torsoTip = V(0, ty + 0.1, 0.62);
  sk.add('fur', fur, profileTube(prof, 9), torso, torsoTip);

  // Legs: shoulder/elbow/wrist/paw and hip/stifle/hock/paw.
  const limbs: Limb[] = [];
  const legY = ty + 0.04;
  for (const [front, s] of [[true, 1], [true, -1], [false, 1], [false, -1]] as const) {
    const x = s * (0.11 - H * 0.01);
    const pts = front
      ? [V(x, legY + 0.02, 0.36), V(x * 1.12, legY * 0.62, 0.28), V(x * 1.04, 0.15, 0.33), V(x * 1.04, 0.035, 0.38)]
      : [V(x, legY, -0.4), V(x * 1.12, legY * 0.66, -0.27), V(x * 1.04, 0.25, -0.5), V(x * 1.04, 0.035, -0.45)];
    const radii: Radius[] = front ? [0.08, 0.05, 0.034, 0.03] : [0.1, 0.06, 0.035, 0.03];
    const l = leg(sk, front ? chest : hips, pts, radii, legShade, s, front);
    // Shoulder blade / haunch muscle, and the paw.
    muscle(sk, 'fur', fur, front ? ell(V(x * 0.95, legY - 0.06, 0.37), 0.07, 0.15, 0.1, 7, 5) : ell(V(x * 0.95, legY - 0.08, -0.37), 0.08, 0.17, 0.14, 7, 5), l);
    const paw = pts[3];
    sk.add('fur', hound ? 0x120a08 : tint(color, 0.6), ell(V(paw.x, 0.035, paw.z + 0.025), 0.045, 0.032, 0.065, 6, 4), l.low);
    if (hound) for (const dx of [-0.025, 0, 0.025]) sk.add('fur', 0x0a0606, spike(V(paw.x + dx, 0.03, paw.z + 0.07), V(paw.x + dx, 0.01, paw.z + 0.11), 0.01, 3), l.low);
    limbs.push(l);
  }

  // Neck, carried forward rather than upright, and the head.
  const n0 = sk.joint(chest, 0, ty + 0.1, 0.44);
  const n1 = sk.joint(n0, 0, ty + 0.18, 0.58);
  const hp = V(0, ty + 0.25, 0.71);
  const head = sk.joint(n1, hp.x, hp.y, hp.z);
  const neckChain = [chest, n0, n1, head];
  const neckTip = V(0, hp.y + 0.04, 0.84);
  sk.add('fur', fur, tube([V(0, ty + 0.04, 0.32), V(0, ty + 0.1, 0.44), V(0, ty + 0.18, 0.58), hp, V(0, hp.y + 0.03, 0.8)], [[0.14, 0.17], [0.13, 0.15], [0.11, 0.125], [0.09, 0.1], [0.07, 0.07]], 8), neckChain, neckTip);
  const hy = hp.y + 0.03;
  // Ruff of fur clumps around the neck (wolf) or obsidian spines (hound).
  const axis = V(0, 0.55, 0.83).normalize();
  const e2 = V(0, 0.83, -0.55);
  for (const [cz, cy, n, r] of [[0.47, ty + 0.13, 9, 0.135], [0.58, ty + 0.2, 8, 0.12]] as const) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * 0.8 + (i / (n - 1)) * Math.PI * 1.6 + (cz > 0.5 ? 0.1 : 0);
      const radial = V(Math.sin(a), 0, 0).addScaledVector(e2, Math.cos(a));
      const base = V(0, cy, cz).addScaledVector(radial, r);
      if (hound) {
        if (Math.cos(a) > 0.4) sk.add('fur', 0x0c0808, spike(base, base.clone().addScaledVector(radial, 0.1).addScaledVector(axis, -0.08), 0.028, 4), neckChain, neckTip);
      } else {
        const tip = base.clone().addScaledVector(axis, -0.15).addScaledVector(radial, 0.035);
        sk.add('fur', i % 2 ? tint(color, 0.95) : pale, tuft(base, tip, 0.06, radial), neckChain, neckTip);
      }
    }
  }
  const skull = hound ? 0.115 : 0.105;
  sk.add('fur', fur, ell(V(0, hy, 0.77), skull, skull * 0.95, skull * 1.15, 9, 7), head);
  for (const s of [-1, 1]) {
    sk.add('fur', hound ? fur : pale, ell(V(s * 0.065, hy - 0.04, 0.8), 0.06, 0.06, 0.07, 6, 4), head);
    if (!hound) sk.add('fur', pale, tuft(V(s * 0.09, hy - 0.04, 0.76), V(s * 0.16, hy - 0.09, 0.69), 0.045, V(s, 0, 0)), head);
    // Brow ridge, eye, fang.
    sk.add('fur', tint(color, 0.55), ell(V(s * 0.048, hy + 0.045, 0.86), 0.042, 0.018, 0.04, 5, 3, [0, 0, -s * 0.35]), head);
    sk.add('glow', hound ? 0xff6a10 : 0xffb030, ell(V(s * 0.054, hy + 0.025, 0.87), 0.017, 0.012, 0.011, 5, 3), head, undefined, hound ? 3 : 1.4);
    sk.add('fur', 0xe8e0d0, spike(V(s * 0.026, hy - 0.06, 0.99), V(s * 0.025, hy - 0.1, 0.995), 0.009, 3), head);
  }
  // Muzzle, nose and a dark (or molten) mouth that shows when the jaw drops.
  const snoutLen = hound ? 1.05 : 1.07;
  sk.add('fur', hound ? fur : grad(tint(color, 0.8), pale, hy - 0.06, hy + 0.04, 0.05), tube([V(0, hy - 0.01, 0.83), V(0, hy - 0.025, 0.93), V(0, hy - 0.04, 1.01), V(0, hy - 0.045, snoutLen)], [[0.07, 0.065], [0.052, 0.048], [0.036, 0.032], [0.02, 0.018]], 7), head);
  sk.add('fur', 0x0a0808, ell(V(0, hy - 0.038, snoutLen - 0.004), 0.022, 0.017, 0.016, 5, 3), head);
  if (hound) sk.add('glow', 0xff4a10, ell(V(0, hy - 0.07, 0.92), 0.035, 0.022, 0.09, 5, 3), head, undefined, 1.6);
  else sk.add('fur', 0x2a0a0a, ell(V(0, hy - 0.07, 0.92), 0.035, 0.02, 0.09, 5, 3), head);
  const jaw = sk.joint(head, 0, hy - 0.07, 0.81);
  sk.add('fur', hound ? tint(color, 0.6) : pale, tube([V(0, hy - 0.075, 0.81), V(0, hy - 0.095, 0.92), V(0, hy - 0.1, 1.02)], [[0.055, 0.03], [0.04, 0.022], [0.02, 0.014]], 6), jaw);
  for (const s of [-1, 1]) sk.add('fur', 0xe8e0d0, spike(V(s * 0.022, hy - 0.095, 1.0), V(s * 0.022, hy - 0.065, 1.005), 0.008, 3), jaw);
  // Ears.
  const ears: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const e = sk.joint(head, s * 0.065, hy + 0.075, 0.75);
    const tipP = hound ? V(s * 0.12, hy + 0.15, 0.65) : V(s * 0.085, hy + 0.19, 0.74);
    sk.add('fur', tint(color, 0.6), tube([V(s * 0.065, hy + 0.06, 0.755), tipP], [[0.045, 0.016], 0], 4), e);
    ears.push(e);
  }
  // Tail: bushy with a dark tip for the wolf, a whip with an ember tip for the hound.
  const tailPts = hound ? [V(0, ty + 0.08, -0.62), V(0, ty + 0.04, -0.82), V(0, ty - 0.06, -1.0), V(0, ty - 0.2, -1.12), V(0, ty - 0.3, -1.2)] : [V(0, ty + 0.07, -0.6), V(0, ty, -0.78), V(0, ty - 0.12, -0.91), V(0, ty - 0.26, -0.98)];
  const tailR: Radius[] = hound ? [0.045, 0.035, 0.028, 0.02, 0] : [0.045, 0.075, 0.07, 0];
  const tail = chain(sk, hips, tailPts, tailR, 'fur', hound ? tint(color, 0.8) : grad(tint(color, 0.85), 0x1a1614, ty - 0.26, ty), hound ? 5 : 7);
  if (hound) sk.add('glow', 0xff5a10, ell(tailPts[tailPts.length - 1], 0.04, 0.04, 0.04, 5, 3), tail[tail.length - 1], undefined, 2.5);

  if (hound) {
    // Molten cracks that ride the skin, and obsidian spines down the back.
    const cracks: [number, number[]][] = [[1.1, [-0.45, -0.25, -0.05, 0.12, 0.3, 0.45]], [-1.1, [-0.45, -0.25, -0.05, 0.12, 0.3, 0.45]], [1.9, [-0.35, -0.15, 0.08, 0.26]], [-1.9, [-0.35, -0.15, 0.08, 0.26]], [0.5, [-0.5, -0.3, -0.1]], [-0.5, [0.1, 0.25, 0.42]]];
    for (const [a0, zs] of cracks) {
      const pts = zs.map((z, i) => onProfile(prof, z, a0 + Math.sin(i * 2.7 + a0) * 0.35, 1.02));
      sk.add('glow', 0xff5a14, tube(pts, pts.map(() => 0.011), 3), torso, torsoTip, 2.2);
    }
    for (const l of limbs) {
      const p = l.up.userData.w as V3, q = l.mid.userData.w as V3;
      const o = V(l.side * 0.045, 0, 0.03);
      sk.add('glow', 0xff5a14, tube([p.clone().add(o).add(V(0, -0.06, 0)), p.clone().lerp(q, 0.5).add(o).add(V(0, 0, -0.02)), q.clone().add(o)], [0.01, 0.01, 0.008], 3), [l.up, l.mid], undefined, 2.2);
    }
    sk.add('glow', 0xff5a14, tube([V(0, hy + 0.07, 0.79), V(0.01, hy + 0.05, 0.86), V(0, hy + 0.02, 0.94)], [0.008, 0.009, 0.006], 3), head, undefined, 2.2);
    for (let i = 0; i < 8; i++) {
      const base = onProfile(prof, 0.42 - i * 0.12, 0, 0.95);
      sk.add('fur', 0x0c0808, spike(base, base.clone().add(V(0, 0.08 + (i % 2) * 0.03, -0.07)), 0.026, 4), torso, torsoTip);
    }
  } else {
    // Fur clumps along the spine and over the haunches.
    for (let i = 0; i < 7; i++) {
      const z = 0.38 - i * 0.14;
      const base = onProfile(prof, z, (i % 2 ? 0.25 : -0.25), 0.96);
      sk.add('fur', tint(color, 0.6), tuft(base, base.clone().add(V(0, 0.015, -0.13)), 0.055, V(0, 1, 0)), torso, torsoTip);
    }
  }
  const j: CreatureJoints = { chest, hips, neck: [n0, n1], jaw, ears, tail, limbs, legLen: legY, girth: 0.17 };
  return finish(sk, hound ? 'hound' : 'wolf', body, head, j, 1.3 + H * 0.05, 1);
}

function buildBoar(color: number): CreatureRig {
  const sk = new Skin();
  const back = tint(color, 0.7), belly = tint(color, 1.25, 0x8a6a50, 0.2);
  const fur = grad(back, belly, 0.4, 0.9, 0.12);
  const ty = 0.64;
  const body = sk.joint(sk.root, 0, ty, 0);
  const chest = sk.joint(body, 0, ty + 0.04, 0.24);
  const hips = sk.joint(body, 0, ty, -0.3);
  // Barrel body with a massive shoulder hump.
  const prof: Profile = [
    [-0.64, 0.06, 0.06, ty], [-0.58, 0.17, 0.18, ty], [-0.44, 0.23, 0.24, ty], [-0.22, 0.24, 0.25, ty + 0.01], [0.04, 0.25, 0.27, ty + 0.03],
    [0.24, 0.25, 0.3, ty + 0.07], [0.42, 0.22, 0.27, ty + 0.06], [0.55, 0.16, 0.2, ty + 0.03], [0.62, 0.07, 0.09, ty + 0.02],
  ];
  sk.add('fur', fur, profileTube(prof, 10), [hips, chest], V(0, ty, 0.64));
  const limbs: Limb[] = [];
  const legShade = grad(tint(color, 0.75), tint(color, 0.5), 0.05, 0.5, 0.06);
  for (const [front, s] of [[true, 1], [true, -1], [false, 1], [false, -1]] as const) {
    const x = s * 0.14;
    const pts = front
      ? [V(x, ty, 0.36), V(x * 1.08, 0.36, 0.3), V(x, 0.12, 0.34), V(x, 0.03, 0.36)]
      : [V(x, ty - 0.02, -0.38), V(x * 1.08, 0.38, -0.3), V(x, 0.17, -0.45), V(x, 0.03, -0.42)];
    const l = leg(sk, front ? chest : hips, pts, front ? [0.1, 0.065, 0.045, 0.04] : [0.12, 0.07, 0.045, 0.04], legShade, s, front);
    sk.add('fur', 0x1a1410, tube([V(pts[3].x, 0.08, pts[3].z), V(pts[3].x, 0.0, pts[3].z + 0.02)], [0.045, 0.05], 6), l.low);
    muscle(sk, 'fur', fur, front ? ell(V(x * 0.9, ty - 0.04, 0.36), 0.09, 0.17, 0.12, 7, 5) : ell(V(x * 0.9, ty - 0.06, -0.36), 0.1, 0.18, 0.15, 7, 5), l);
    limbs.push(l);
  }
  // Short thick neck and a heavy wedge head, low to the ground.
  const n0 = sk.joint(chest, 0, ty + 0.06, 0.5);
  const head = sk.joint(n0, 0, ty + 0.02, 0.64);
  sk.add('fur', fur, tube([V(0, ty + 0.08, 0.4), V(0, ty + 0.06, 0.5), V(0, ty + 0.03, 0.62), V(0, ty, 0.7)], [[0.21, 0.24], [0.19, 0.22], [0.17, 0.19], [0.14, 0.15]], 9), [chest, n0, head], V(0, ty, 0.74));
  sk.add('fur', fur, tube([V(0, ty + 0.04, 0.6), V(0, ty + 0.0, 0.76), V(0, ty - 0.06, 0.9), V(0, ty - 0.09, 0.99)], [[0.16, 0.18], [0.13, 0.14], [0.09, 0.09], [0.07, 0.068]], 9), head);
  sk.add('fur', 0x4a2a24, ell(V(0, ty - 0.09, 1.0), 0.068, 0.062, 0.022, 8, 5), head);
  for (const s of [-1, 1]) {
    sk.add('fur', 0x140a08, ell(V(s * 0.025, ty - 0.085, 1.018), 0.012, 0.016, 0.006, 5, 4), head);
    sk.add('glow', 0xff3010, ell(V(s * 0.09, ty + 0.08, 0.76), 0.016, 0.012, 0.012, 6, 4), head, undefined, 1.1);
    sk.add('fur', tint(color, 0.5), ell(V(s * 0.085, ty + 0.1, 0.77), 0.04, 0.016, 0.035, 6, 4, [0, 0, -s * 0.4]), head);
  }
  const ears: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const e = sk.joint(head, s * 0.1, ty + 0.15, 0.62);
    sk.add('fur', tint(color, 0.6), tube([V(s * 0.1, ty + 0.14, 0.62), V(s * 0.19, ty + 0.21, 0.56)], [[0.05, 0.018], 0], 4), e);
    ears.push(e);
  }
  const jaw = sk.joint(head, 0, ty - 0.06, 0.68);
  sk.add('fur', tint(color, 0.8), tube([V(0, ty - 0.07, 0.66), V(0, ty - 0.12, 0.8), V(0, ty - 0.13, 0.92)], [[0.1, 0.055], [0.075, 0.04], [0.045, 0.03]], 7), jaw);
  // Tusks curving up out of the lower jaw.
  for (const s of [-1, 1]) {
    const t = bez(V(s * 0.06, ty - 0.11, 0.88), V(s * 0.15, ty - 0.13, 0.96), V(s * 0.16, ty + 0.02, 0.92), 4);
    sk.add('fur', 0xe8dcc0, tube(t, taper(5, 0.024, 0), 5), jaw);
  }
  sk.add('fur', 0x2a0a0a, ell(V(0, ty - 0.08, 0.84), 0.06, 0.025, 0.11, 6, 4), head);
  // Bristle ridge.
  for (let i = 0; i < 15; i++) {
    const z = 0.62 - i * 0.075;
    const base = z > 0.5 ? V(0, ty + 0.16 - (z - 0.5) * 0.5, z) : onProfile(prof, z, 0, 0.92);
    const len = 0.1 + 0.1 * Math.max(0, Math.sin(((z + 0.4) / 1.0) * Math.PI));
    sk.add('fur', i % 2 ? 0x1e140e : 0x2e2016, spike(base, base.clone().add(V(0, len, -0.08)), 0.03, 3), z > 0.5 ? [chest, n0, head] : [hips, chest], V(0, ty, 0.74));
  }
  const tail = chain(sk, hips, [V(0, ty + 0.04, -0.62), V(0, ty - 0.06, -0.7), V(0, ty - 0.2, -0.72)], [0.02, 0.016, 0], 'fur', tint(color, 0.6), 4);
  sk.add('fur', 0x1a120c, spike(V(0, ty - 0.17, -0.72), V(0, ty - 0.3, -0.73), 0.035, 4), tail[tail.length - 1]);
  const j: CreatureJoints = { chest, hips, neck: [n0], jaw, ears, tail, limbs, legLen: ty, girth: 0.25 };
  return finish(sk, 'boar', body, head, j, 1.05, 1);
}

function buildStag(color: number, scale: number): CreatureRig {
  const sk = new Skin();
  const back = tint(color, 0.95), belly = tint(color, 1.6, 0xb8a888, 0.35);
  const fur = grad(back, belly, 0.95, 1.5, 0.16);
  const bone = 0xd8d0b8;
  const ty = 1.26;
  const body = sk.joint(sk.root, 0, ty, 0);
  const chest = sk.joint(body, 0, ty + 0.02, 0.3);
  const hips = sk.joint(body, 0, ty, -0.36);
  const prof: Profile = [
    [-0.76, 0.05, 0.05, ty + 0.05], [-0.69, 0.17, 0.19, ty + 0.04], [-0.53, 0.23, 0.25, ty + 0.02], [-0.3, 0.22, 0.24, ty + 0.02], [-0.08, 0.21, 0.25, ty + 0.02],
    [0.12, 0.24, 0.3, ty - 0.02], [0.3, 0.25, 0.32, ty - 0.03], [0.48, 0.22, 0.29, ty + 0.03], [0.6, 0.15, 0.21, ty + 0.1], [0.68, 0.06, 0.09, ty + 0.15],
  ];
  sk.add('fur', fur, profileTube(prof, 12), [hips, chest], V(0, ty + 0.1, 0.68));
  const legShade = grad(tint(color, 0.85), tint(color, 0.45), 0.05, 1.0, 0.08);
  const limbs: Limb[] = [];
  for (const [front, s] of [[true, 1], [true, -1], [false, 1], [false, -1]] as const) {
    const x = s * 0.13;
    const pts = front
      ? [V(x, ty + 0.04, 0.42), V(x * 1.08, 0.88, 0.33), V(x * 0.95, 0.42, 0.38), V(x * 0.95, 0.04, 0.4)]
      : [V(x, ty + 0.03, -0.48), V(x * 1.12, 0.95, -0.33), V(x * 0.95, 0.55, -0.62), V(x * 0.95, 0.04, -0.55)];
    const l = leg(sk, front ? chest : hips, pts, front ? [0.12, 0.065, 0.042, 0.036] : [0.14, 0.08, 0.044, 0.036], legShade, s, front);
    sk.add('fur', 0x14100c, tube([V(pts[3].x, 0.1, pts[3].z - 0.01), V(pts[3].x, 0.0, pts[3].z + 0.04)], [0.036, [0.045, 0.03]], 6), l.low);
    muscle(sk, 'fur', fur, front ? ell(V(x * 0.92, ty - 0.06, 0.42), 0.1, 0.22, 0.14, 7, 5) : ell(V(x * 0.92, ty - 0.08, -0.44), 0.12, 0.24, 0.17, 7, 5), l);
    limbs.push(l);
  }
  // A long neck rising to a bone-white skull face.
  const n0 = sk.joint(chest, 0, ty + 0.2, 0.55);
  const n1 = sk.joint(n0, 0, ty + 0.46, 0.72);
  const hp = V(0, ty + 0.7, 0.85);
  const head = sk.joint(n1, hp.x, hp.y, hp.z);
  sk.add('fur', fur, tube([V(0, ty + 0.06, 0.42), V(0, ty + 0.2, 0.55), V(0, ty + 0.46, 0.72), hp, V(0, hp.y + 0.06, 0.92)], [[0.2, 0.26], [0.18, 0.23], [0.14, 0.17], [0.11, 0.12], [0.08, 0.08]], 10), [chest, n0, n1, head], V(0, hp.y + 0.07, 0.95));
  // Shaggy mane: long clumps hanging under the neck and chest, shorter ones along the crest.
  const mane = grad(tint(color, 0.5, 0x3a4a2a, 0.3), tint(color, 0.85, 0x5a6a4a, 0.25), ty - 0.5, ty + 0.6, 0.18);
  const neckChain = [chest, n0, n1, head];
  const neckTip = V(0, hp.y + 0.07, 0.95);
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const side = (i % 3) - 1;
    const base = V(side * 0.09, ty - 0.12 + t * 0.62, 0.52 + t * 0.3);
    const len = 0.42 - t * 0.2;
    sk.add('fur', mane, tuft(base, base.clone().add(V(side * 0.05, -len, 0.03 - t * 0.05)), 0.09, V(side * 0.6, -0.2, 1).normalize()), neckChain, neckTip);
  }
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    for (const sd of [-1, 1]) {
      const base = V(sd * 0.07, ty + 0.25 + t * 0.48, 0.46 + t * 0.34);
      sk.add('fur', mane, tuft(base, base.clone().add(V(sd * 0.1, -0.08, -0.14)), 0.07, V(sd, 0.6, -0.3).normalize()), neckChain, neckTip);
    }
  }
  const hy = hp.y + 0.04;
  sk.add('fur', fur, ell(V(0, hy, 0.86), 0.1, 0.1, 0.11, 9, 7), head);
  sk.add('fur', grad(bone, tint(bone, 0.75), hy - 0.1, hy + 0.08, 0.05), tube([V(0, hy + 0.01, 0.88), V(0, hy, 0.98), V(0, hy - 0.04, 1.12), V(0, hy - 0.08, 1.24), V(0, hy - 0.09, 1.29)], [[0.095, 0.09], [0.088, 0.085], [0.062, 0.058], [0.04, 0.035], [0.02, 0.02]], 9), head);
  for (const s of [-1, 1]) {
    sk.add('fur', 0x0a0806, ell(V(s * 0.066, hy + 0.02, 0.99), 0.034, 0.03, 0.03, 7, 5), head);
    sk.add('glow', 0x60ffb0, ell(V(s * 0.072, hy + 0.02, 1.0), 0.018, 0.015, 0.015, 6, 4), head, undefined, 2.4);
    sk.add('fur', 0x0a0806, ell(V(s * 0.016, hy - 0.08, 1.27), 0.01, 0.012, 0.01, 4, 3), head);
  }
  const jaw = sk.joint(head, 0, hy - 0.07, 0.9);
  sk.add('fur', tint(bone, 0.85), tube([V(0, hy - 0.075, 0.9), V(0, hy - 0.12, 1.06), V(0, hy - 0.135, 1.2)], [[0.06, 0.03], [0.045, 0.024], [0.024, 0.015]], 7), jaw);
  sk.add('fur', 0x1a0806, ell(V(0, hy - 0.07, 1.04), 0.04, 0.02, 0.11, 6, 4), head);
  const ears: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const e = sk.joint(head, s * 0.08, hy + 0.06, 0.82);
    sk.add('fur', tint(color, 0.7), tube([V(s * 0.08, hy + 0.06, 0.82), V(s * 0.18, hy + 0.1, 0.8), V(s * 0.27, hy + 0.11, 0.77)], [[0.03, 0.02], [0.055, 0.02], 0], 5), e);
    ears.push(e);
  }
  // Branching antlers with glowing tips and hanging moss.
  const antler = grad(0xe8dcc0, 0x6a5e48, hy + 0.1, hy + 1.3, 0.08);
  for (const s of [-1, 1]) {
    const beam = new THREE.CatmullRomCurve3([V(s * 0.06, hy + 0.08, 0.84), V(s * 0.22, hy + 0.36, 0.72), V(s * 0.42, hy + 0.7, 0.74), V(s * 0.46, hy + 1.06, 0.62), V(s * 0.36, hy + 1.36, 0.5)]).getPoints(8);
    sk.add('fur', antler, tube(beam, taper(beam.length, 0.045, 0.012), 6), head);
    const tines: [number, V3, number][] = [
      [0.12, V(0.05, 0.12, 0.3), 0.3], [0.3, V(0.12, 0.25, 0.25), 0.36], [0.5, V(0.02, 0.3, 0.26), 0.4],
      [0.62, V(0.2, 0.22, -0.08), 0.34], [0.78, V(-0.1, 0.32, 0.18), 0.3], [0.9, V(0.16, 0.3, -0.12), 0.26], [1.0, V(-0.04, 0.28, -0.04), 0.2],
    ];
    for (const [f, d, len] of tines) {
      const p0 = beam[Math.round(f * (beam.length - 1))];
      const dir = V(d.x * s, d.y, d.z).normalize();
      const p1 = p0.clone().addScaledVector(dir, len * 0.55).add(V(0, len * 0.08, 0));
      const p2 = p0.clone().addScaledVector(dir, len).add(V(0, len * 0.25, 0));
      sk.add('fur', antler, tube([p0, p1, p2], [0.026, 0.017, 0.008], 5), head);
      sk.add('glow', 0x80ffc8, tube([p1.clone().lerp(p2, 0.45), p2, p2.clone().addScaledVector(dir, 0.05)], [0.016, 0.011, 0], 4), head, undefined, 1.8);
    }
    for (const f of [0.35, 0.55, 0.75]) {
      const p0 = beam[Math.round(f * (beam.length - 1))];
      sk.add('fur', 0x3a5a2a, spike(p0.clone().add(V(0, -0.02, 0)), p0.clone().add(V(s * 0.03, -0.32, 0.02)), 0.022, 3), head);
    }
  }
  const tail = chain(sk, hips, [V(0, ty + 0.1, -0.7), V(0, ty + 0.0, -0.8), V(0, ty - 0.14, -0.84)], [0.06, 0.05, 0], 'fur', tint(color, 1.2, 0xd8d0c0, 0.4), 6);
  // Spirit markings: faint glowing whorls along the flanks and down the face.
  for (const s of [-1, 1]) {
    for (const [z0, a0, n] of [[-0.5, 1.2, 5], [0.05, 1.0, 5], [0.3, 1.7, 3]] as const) {
      const pts = Array.from({ length: n }, (_, i) => onProfile(prof, z0 + i * 0.09, s * (a0 + Math.sin(i * 1.9) * 0.25), 1.01));
      sk.add('glow', 0x30c890, tube(pts, pts.map((_, i) => (i === n - 1 ? 0 : 0.009)), 3), [hips, chest], V(0, ty + 0.1, 0.68), 0.7);
    }
  }
  sk.add('glow', 0x30c890, tube([V(0, hy + 0.06, 0.92), V(0, hy + 0.04, 1.02), V(0, hy, 1.12)], [0.007, 0.008, 0], 3), head, undefined, 0.9);
  // Spirit wisps drifting about the antlers.
  const wisps: THREE.Sprite[] = [];
  for (let i = 0; i < 5; i++) {
    const w = glowSprite(0x80ffc8, 0.32, 0.85);
    w.userData.k = i;
    head.add(w);
    wisps.push(w);
  }
  const j: CreatureJoints = { chest, hips, neck: [n0, n1], jaw, ears, tail, limbs, wisps, legLen: ty, girth: 0.21 };
  return finish(sk, 'stag', body, head, j, 2.2, scale, true);
}

function buildDrake(color: number): CreatureRig {
  const sk = new Skin();
  const back = tint(color, 0.8), belly = tint(color, 1.6, 0xb08050, 0.4);
  const hide = grad(back, belly, 0.55, 1.0, 0.12);
  const legHide = grad(tint(color, 0.85), tint(color, 0.45), 0.0, 0.8, 0.1);
  const ty = 0.8;
  const body = sk.joint(sk.root, 0, ty, 0);
  const chest = sk.joint(body, 0, ty + 0.04, 0.3);
  const hips = sk.joint(body, 0, ty, -0.35);
  const prof: Profile = [
    [-0.78, 0.12, 0.12, ty + 0.03], [-0.6, 0.2, 0.2, ty + 0.01], [-0.35, 0.24, 0.24, ty], [-0.1, 0.25, 0.26, ty], [0.15, 0.26, 0.28, ty + 0.01],
    [0.35, 0.24, 0.27, ty + 0.05], [0.52, 0.18, 0.2, ty + 0.12], [0.6, 0.11, 0.12, ty + 0.17],
  ];
  sk.add('scale', hide, profileTube(prof, 9), [hips, chest], V(0, ty + 0.2, 0.64));
  // Belly plates.
  for (let i = 0; i < 7; i++) {
    const z = 0.42 - i * 0.15;
    const p = onProfile(prof, z, Math.PI, 0.96);
    sk.add('scale', tint(color, 1.25, 0xa07050, 0.35), ell(p, 0.17, 0.04, 0.1, 6, 3), [hips, chest], V(0, ty + 0.2, 0.64));
  }
  const limbs: Limb[] = [];
  for (const [front, s] of [[true, 1], [true, -1], [false, 1], [false, -1]] as const) {
    const x = s * 0.2;
    const pts = front
      ? [V(x, ty + 0.02, 0.38), V(x * 1.4, 0.5, 0.3), V(x * 1.3, 0.15, 0.4), V(x * 1.3, 0.04, 0.47)]
      : [V(x, ty, -0.42), V(x * 1.3, 0.52, -0.25), V(x * 1.2, 0.24, -0.5), V(x * 1.2, 0.04, -0.42)];
    const l = leg(sk, front ? chest : hips, pts, front ? [0.11, 0.075, 0.05, 0.045] : [0.14, 0.08, 0.05, 0.045], legHide, s, front, 'scale');
    const f = pts[3];
    for (const dx of [-0.05, 0, 0.05]) sk.add('fur', 0x1a1210, tube([V(f.x + dx, 0.05, f.z + 0.02), V(f.x + dx * 1.3, 0.03, f.z + 0.1), V(f.x + dx * 1.4, 0.0, f.z + 0.15)], [0.02, 0.014, 0], 4), l.low);
    muscle(sk, 'scale', hide, front ? ell(V(x * 0.95, ty - 0.04, 0.38), 0.1, 0.17, 0.12, 7, 5) : ell(V(x * 0.95, ty - 0.06, -0.4), 0.12, 0.2, 0.16, 7, 5), l);
    limbs.push(l);
  }
  // Long serpentine neck.
  const neckPts = [V(0, ty + 0.16, 0.55), V(0, ty + 0.32, 0.7), V(0, ty + 0.45, 0.84), V(0, ty + 0.55, 0.97)];
  const neck: THREE.Group[] = [];
  let np: THREE.Object3D = chest;
  for (const p of neckPts) {
    np = sk.joint(np, p.x, p.y, p.z);
    neck.push(np as THREE.Group);
  }
  const hp = V(0, ty + 0.62, 1.08);
  const head = sk.joint(np, hp.x, hp.y, hp.z);
  sk.add('scale', hide, tube([V(0, ty + 0.06, 0.42), ...neckPts, hp, V(0, hp.y + 0.03, 1.14)], [[0.2, 0.22], [0.17, 0.19], [0.14, 0.15], [0.12, 0.13], [0.105, 0.11], [0.095, 0.1], [0.08, 0.08]], 9), [chest, ...neck, head], V(0, hp.y + 0.04, 1.18));
  const hy = hp.y + 0.02;
  sk.add('scale', hide, ell(V(0, hy, 1.12), 0.12, 0.1, 0.15, 8, 6), head);
  sk.add('scale', hide, tube([V(0, hy - 0.01, 1.2), V(0, hy - 0.03, 1.36), V(0, hy - 0.06, 1.5)], [[0.1, 0.075], [0.07, 0.055], [0.04, 0.035]], 7), head);
  for (const s of [-1, 1]) {
    sk.add('scale', tint(color, 0.55), ell(V(s * 0.065, hy + 0.05, 1.2), 0.05, 0.025, 0.08, 5, 3, [0.2, 0, -s * 0.3]), head);
    sk.add('glow', 0xffb020, ell(V(s * 0.075, hy + 0.03, 1.23), 0.02, 0.014, 0.014, 5, 3), head, undefined, 2.2);
    sk.add('glow', 0xff6020, ell(V(s * 0.022, hy - 0.04, 1.49), 0.008, 0.008, 0.008, 4, 3), head, undefined, 1.5);
    // Swept-back horns and cheek spikes.
    sk.add('fur', 0x1e1612, tube(bez(V(s * 0.07, hy + 0.07, 1.08), V(s * 0.15, hy + 0.16, 0.96), V(s * 0.17, hy + 0.12, 0.74), 4), taper(5, 0.04, 0), 5), head);
    sk.add('fur', 0x1e1612, tube(bez(V(s * 0.1, hy, 1.06), V(s * 0.2, hy + 0.02, 0.98), V(s * 0.24, hy + 0.0, 0.86), 3), taper(4, 0.025, 0), 4), head);
    for (let i = 0; i < 4; i++) sk.add('fur', 0xe8dcc0, spike(V(s * 0.04, hy - 0.06, 1.24 + i * 0.07), V(s * 0.038, hy - 0.1, 1.25 + i * 0.07), 0.008, 3), head);
  }
  sk.add('glow', 0xff5010, ell(V(0, hy - 0.07, 1.3), 0.05, 0.025, 0.15, 5, 3), head, undefined, 1.2);
  const jaw = sk.joint(head, 0, hy - 0.07, 1.12);
  sk.add('scale', tint(color, 1.2, 0xb08050, 0.3), tube([V(0, hy - 0.08, 1.12), V(0, hy - 0.12, 1.32), V(0, hy - 0.12, 1.46)], [[0.08, 0.04], [0.06, 0.03], [0.034, 0.02]], 7), jaw);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) sk.add('fur', 0xe8dcc0, spike(V(s * 0.034, hy - 0.1, 1.28 + i * 0.07), V(s * 0.033, hy - 0.065, 1.29 + i * 0.07), 0.008, 3), jaw);
  // Tail.
  const tailPts = [V(0, ty + 0.06, -0.72), V(0, ty + 0.02, -1.0), V(0, ty - 0.04, -1.3), V(0, ty - 0.12, -1.6), V(0, ty - 0.22, -1.9), V(0, ty - 0.32, -2.16), V(0, ty - 0.4, -2.4)];
  const tail = chain(sk, hips, tailPts, [[0.15, 0.16], [0.12, 0.13], [0.095, 0.1], [0.07, 0.075], [0.05, 0.05], [0.03, 0.03], 0], 'scale', hide, 6);
  sk.add('fur', 0x1e1612, tube([V(0, ty - 0.3, -2.1), V(0, ty - 0.24, -2.3), V(0, ty - 0.38, -2.5)], [[0.008, 0.08], [0.008, 0.06], 0], 4), tail[tail.length - 1]);
  // Dorsal spines from skull to tail.
  const spineBones = [...tail.slice().reverse(), hips, chest, ...neck, head];
  const spineW = chainWeights([hips, chest], V(0, ty, 0.64));
  for (let i = 0; i < 20; i++) {
    let base: V3;
    if (i < 5) base = neckPts[Math.min(3, 3 - Math.floor(i * 0.8))].clone().lerp(neckPts[Math.max(0, 3 - Math.floor(i * 0.8) - 1)], (i * 0.8) % 1).add(V(0, 0.11, 0));
    else if (i < 11) base = onProfile(prof, 0.42 - (i - 5) * 0.2, 0, 0.94);
    else {
      const t = (i - 11) / 8;
      const k = Math.min(tailPts.length - 2, Math.floor(t * (tailPts.length - 1)));
      base = tailPts[k].clone().lerp(tailPts[k + 1], t * (tailPts.length - 1) - k).add(V(0, 0.1 - t * 0.07, 0));
    }
    const len = i < 5 ? 0.1 : i < 11 ? 0.16 : 0.12 - (i - 11) * 0.01;
    const g = spike(base, base.clone().add(V(0, len, -len * 0.6)), 0.035, 3);
    if (i >= 5 && i < 11) sk.push('fur', 0x1e1612, g, spineW);
    else sk.push('fur', 0x1e1612, g, nearest(spineBones));
  }
  // Wings: arm, forearm, hand and three finger bones carrying the membrane.
  const wings: Wing[] = [];
  for (const s of [-1, 1]) {
    const S = V(s * 0.17, ty + 0.24, 0.32), E = V(s * 0.72, ty + 0.42, 0.18), W = V(s * 1.3, ty + 0.46, 0.32);
    const tips = [V(s * 2.05, ty + 0.28, 0.06), V(s * 1.85, ty + 0.18, -0.58), V(s * 1.42, ty + 0.12, -1.02)];
    const Hp = V(s * 0.2, ty + 0.16, -0.5);
    const root = sk.joint(chest, S.x, S.y, S.z);
    const fore = sk.joint(root, E.x, E.y, E.z);
    const hand = sk.joint(fore, W.x, W.y, W.z);
    const fingers = tips.map(() => sk.joint(hand, W.x, W.y, W.z));
    sk.add('scale', hide, tube([S, S.clone().lerp(E, 0.5), E, E.clone().lerp(W, 0.5), W], [0.07, 0.055, 0.045, 0.035, 0.03], 6), [root, fore, hand], W.clone().add(V(s * 0.1, 0, 0)));
    tips.forEach((t, i) => sk.add('scale', tint(color, 0.6), tube([W, W.clone().lerp(t, 0.5), t], [0.026, 0.018, 0.004], 4), fingers[i]));
    sk.add('fur', 0x1a1210, spike(W, W.clone().add(V(s * 0.04, 0.05, 0.16)), 0.025, 4), hand);
    // Membrane panels between the fingers and from the last finger to the flank.
    const mem = membrane(s, W, tips, fingers, [S, E], [root, fore], hand, Hp, hips, chest);
    sk.push('membrane', grad(tint(color, 0.7, 0x6a2a1a, 0.4), tint(color, 0.45), ty, ty + 0.5, 0.05), mem.geo, mem.weigh);
    // Folded: elbow up and back, forearm forward along it, fingers swept back down the flank.
    const fold = foldWing(root, fore, hand, tips, V(s * 0.3, 0.8, -0.55), V(s * 0.05, -0.25, 1), [V(s * 0.04, 0.12, -1), V(s * 0.06, -0.08, -1), V(s * 0.08, -0.3, -1)]);
    wings.push({ root, fore, hand, fingers, side: s, fold });
  }
  const j: CreatureJoints = { chest, hips, neck, jaw, tail, limbs, wings, legLen: ty, girth: 0.26 };
  return finish(sk, 'drake', body, head, j, 1.45, 1);
}

/** Every vertex goes to the nearest joint of `bones`. */
function nearest(bones: THREE.Object3D[]): (p: V3) => Weights {
  return (p) => {
    let best = bones[0], bd = Infinity;
    for (const b of bones) {
      const d = (b.userData.w as V3).distanceToSquared(p);
      if (d < bd) (bd = d), (best = b);
    }
    return [[best, 1]];
  };
}

/** Wing membrane: fans between finger spars, plus the inner panel from the last finger back to the flank. */
function membrane(s: number, W: V3, tips: V3[], fingers: THREE.Object3D[], arm: V3[], armBones: THREE.Object3D[], hand: THREE.Object3D, hip: V3, hips: THREE.Object3D, chest: THREE.Object3D) {
  const pos: number[] = [];
  const idx: number[] = [];
  const wts: Weights[] = [];
  const vert = (p: V3, w: Weights) => {
    pos.push(p.x, p.y, p.z);
    wts.push(w);
    return wts.length - 1;
  };
  const tri = (a: number, b: number, c: number) => (s > 0 ? idx.push(a, b, c) : idx.push(a, c, b));
  const n = 3;
  const w0 = vert(W, [[hand, 1]]);
  const spar = (k: number) => {
    const out = [w0];
    for (let i = 1; i <= n; i++) out.push(vert(W.clone().lerp(tips[k], i / n), [[fingers[k], 1]]));
    return out;
  };
  const spars = tips.map((_, k) => spar(k));
  for (let k = 0; k < tips.length - 1; k++) {
    const A = spars[k], B = spars[k + 1];
    const mid = tips[k].clone().lerp(tips[k + 1], 0.5).lerp(W, 0.22);
    const m = vert(mid, [[fingers[k], 0.5], [fingers[k + 1], 0.5]]);
    tri(A[0], A[1], B[1]);
    for (let i = 1; i < n; i++) {
      tri(A[i], A[i + 1], B[i]);
      tri(B[i], A[i + 1], B[i + 1]);
    }
    tri(A[n], m, B[n]);
  }
  // Inner panel: shoulder S, elbow E, wrist, last finger tip, scallop, hip.
  const [S, E] = arm;
  const last = spars[tips.length - 1];
  const sv = vert(S.clone().add(V(-s * 0.04, -0.04, -0.04)), [[chest, 1]]);
  const ev = vert(E, [[armBones[0], 0.5], [armBones[1], 0.5]]);
  const hv = vert(hip, [[hips, 1]]);
  const flank = vert(S.clone().lerp(hip, 0.5).add(V(s * 0.02, 0, 0)), [[chest, 0.5], [hips, 0.5]]);
  const scallop = vert(tips[tips.length - 1].clone().lerp(hip, 0.5).lerp(W, 0.2), [[fingers[tips.length - 1], 0.5], [hips, 0.5]]);
  const inner = vert(W.clone().lerp(hip, 0.45), [[hand, 0.4], [armBones[1], 0.2], [hips, 0.4]]);
  tri(sv, ev, flank);
  tri(ev, w0, inner);
  tri(ev, inner, flank);
  tri(flank, inner, hv);
  tri(w0, last[1], inner);
  for (let i = 1; i < n; i++) tri(inner, last[i], last[i + 1]);
  tri(inner, last[n], scallop);
  tri(inner, scallop, hv);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, weigh: (_p: V3, i: number) => wts[i] };
}

/**
 * Solves the joint rotations that turn a spread wing's arm, forearm and
 * fingers to the given directions.
 */
function foldWing(root: THREE.Group, fore: THREE.Group, hand: THREE.Group, tips: V3[], dE: V3, dW: V3, dTips: V3[]): Wing['fold'] {
  const S0 = root.userData.w as V3, E0 = fore.userData.w as V3, W0 = hand.userData.w as V3;
  const dir = (a: V3, b: V3) => b.clone().sub(a).normalize();
  const qRoot = new THREE.Quaternion().setFromUnitVectors(dir(S0, E0), dE.clone().normalize());
  const qFore = new THREE.Quaternion().setFromUnitVectors(dir(E0, W0), dW.clone().normalize().applyQuaternion(qRoot.clone().invert()));
  const invArm = qRoot.clone().multiply(qFore).invert();
  return {
    root: new THREE.Euler().setFromQuaternion(qRoot),
    fore: new THREE.Euler().setFromQuaternion(qFore),
    fingers: tips.map((t, i) => new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(dir(W0, t), dTips[i].clone().normalize().applyQuaternion(invArm)))),
  };
}

// ---------------------------------------------------------------- insects --

export function buildInsect(color: number, scale = 1): CreatureRig {
  return instance(`insect:${color}`, scale, () => buildScorpion(color));
}

function buildScorpion(color: number): CreatureRig {
  const sk = new Skin();
  const plate = grad(tint(color, 1.05), tint(color, 0.55), 0.3, 0.6, 0.05);
  const dark = tint(color, 0.45);
  const ty = 0.44;
  const body = sk.joint(sk.root, 0, ty, 0);
  const head = sk.joint(body, 0, ty + 0.02, 0.3);
  // Cephalothorax and overlapping abdomen plates.
  sk.add('shell', plate, ell(V(0, ty + 0.03, 0.36), 0.26, 0.11, 0.24, 10, 6), head);
  sk.add('shell', dark, ell(V(0, ty - 0.04, 0.34), 0.22, 0.08, 0.22, 8, 5), head);
  for (const s of [-1, 1]) for (const [dx, dz] of [[0.04, 0.54], [0.08, 0.5], [0.11, 0.45]]) sk.add('glow', 0xa0ff60, ell(V(s * dx, ty + 0.12, dz), 0.016, 0.014, 0.016, 5, 3), head, undefined, 1.2);
  // Abdomen: one flattened body ridged by overlapping plate edges.
  const abd: Profile = [[0.3, 0.2, 0.08, ty + 0.02], [0.15, 0.27, 0.11, ty + 0.03], [-0.15, 0.28, 0.12, ty + 0.03], [-0.45, 0.24, 0.11, ty + 0.03], [-0.66, 0.15, 0.09, ty + 0.05], [-0.76, 0.08, 0.07, ty + 0.06]];
  sk.add('shell', grad(tint(color, 1.05), tint(color, 0.45), ty - 0.08, ty + 0.12, 0.05), profileTube(abd, 10), body);
  for (let i = 0; i < 6; i++) {
    const z = 0.18 - i * 0.15;
    const pts = [-1.35, -0.7, 0, 0.7, 1.35].map((a) => onProfile(abd, z, a, 1.02));
    sk.add('shell', tint(color, 0.7), tube(pts, [0.008, 0.018, 0.02, 0.018, 0.008], 4), body);
  }
  // Tail: five beads and a venom bulb arcing over the back.
  const tailPts = [V(0, ty + 0.06, -0.72), V(0, ty + 0.2, -0.92), V(0, ty + 0.45, -1.02), V(0, ty + 0.72, -0.98), V(0, ty + 0.94, -0.82), V(0, ty + 1.04, -0.6)];
  const tail: THREE.Group[] = [];
  let tp: THREE.Object3D = body;
  for (let i = 0; i < tailPts.length; i++) {
    tp = sk.joint(tp, tailPts[i].x, tailPts[i].y, tailPts[i].z);
    tail.push(tp as THREE.Group);
    if (i < tailPts.length - 1) {
      const c = tailPts[i].clone().lerp(tailPts[i + 1], 0.5);
      const r = 0.1 - i * 0.012;
      sk.add('shell', plate, tube([tailPts[i].clone().lerp(tailPts[i + 1], -0.1), c, tailPts[i + 1].clone().lerp(tailPts[i], -0.05)], [[r * 0.8, r * 0.75], [r, r * 0.95], [r * 0.75, r * 0.7]], 8), tp);
    }
  }
  const tb = tailPts[tailPts.length - 1];
  sk.add('shell', tint(color, 0.8, 0x8a3020, 0.3), ell(tb.clone().add(V(0, 0, 0.06)), 0.07, 0.07, 0.1, 8, 6), tp);
  const sting = bez(tb.clone().add(V(0, 0.0, 0.14)), tb.clone().add(V(0, 0.02, 0.26)), tb.clone().add(V(0, -0.12, 0.3)), 3);
  sk.add('fur', 0x14100c, tube(sting, [0.035, 0.022, 0.012, 0], 5), tp);
  sk.add('glow', 0xa0ff60, ell(sting[3], 0.012, 0.012, 0.012, 4, 3), tp, undefined, 2);
  // Pincers: arm, forearm, palm with a fixed finger, and a movable finger.
  const pincers: Pincer[] = [];
  for (const s of [-1, 1]) {
    const A = V(s * 0.16, ty, 0.52), E = V(s * 0.45, ty + 0.08, 0.7), Wr = V(s * 0.43, ty + 0.04, 0.98);
    const arm = sk.joint(head, A.x, A.y, A.z);
    const fore = sk.joint(arm, E.x, E.y, E.z);
    const hand = sk.joint(fore, Wr.x, Wr.y, Wr.z);
    sk.add('shell', plate, tube([A, A.clone().lerp(E, 0.5), E, E.clone().lerp(Wr, 0.5), Wr], [0.05, 0.062, 0.055, 0.065, 0.06], 6), [arm, fore, hand], Wr.clone().add(V(0, 0, 0.05)));
    sk.add('shell', plate, ell(V(s * 0.43, ty + 0.04, 1.15), 0.13, 0.09, 0.2, 8, 6), hand);
    sk.add('shell', dark, tube([V(s * 0.38, ty + 0.04, 1.28), V(s * 0.35, ty + 0.04, 1.45), V(s * 0.39, ty + 0.04, 1.58)], [[0.05, 0.04], [0.032, 0.026], 0], 5), hand);
    const finger = sk.joint(hand, s * 0.48, ty + 0.05, 1.27);
    sk.add('shell', dark, tube([V(s * 0.48, ty + 0.05, 1.27), V(s * 0.5, ty + 0.05, 1.45), V(s * 0.43, ty + 0.05, 1.58)], [[0.045, 0.036], [0.03, 0.024], 0], 5), finger);
    pincers.push({ arm, fore, hand, finger, side: s });
  }
  // Eight legs splayed from the body sides.
  const limbs: Limb[] = [];
  const splay = [0.75, 0.3, -0.15, -0.6];
  const zs = [0.34, 0.2, 0.04, -0.12];
  for (let i = 0; i < 4; i++) {
    for (const s of [1, -1]) {
      const ps = splay[i];
      const A = V(s * 0.2, ty - 0.02, zs[i]);
      const K = A.clone().add(V(s * Math.cos(ps) * 0.28, 0.17, Math.sin(ps) * 0.28));
      const F = A.clone().add(V(s * Math.cos(ps) * 0.52, -0.3, Math.sin(ps) * 0.52));
      const T = A.clone().add(V(s * Math.cos(ps) * 0.6, -ty + 0.0, Math.sin(ps) * 0.6));
      limbs.push(leg(sk, i < 2 ? head : body, [A, K, F, T], [0.05, 0.042, 0.03, 0.008], dark, s, i < 2, 'shell'));
    }
  }
  const j: CreatureJoints = { tail, pincers, limbs, legLen: ty };
  return finish(sk, 'insect', body, head, j, 0.9, 1);
}

// --------------------------------------------------------------- floaters --

export function buildFloater(color: number, kind: 'wraith' | 'eye' | 'witch', scale = 1): CreatureRig {
  if (kind === 'eye') return instance(`eye:${color}`, scale, () => buildEye(color));
  if (kind === 'witch') return buildWitch(color, scale);
  return instance(`wraith:${color}`, scale, () => buildWraith(color));
}

/** Tattered robe strips hanging from a ring, each a chain of joints that flutters. */
function tatters(sk: Skin, parent: THREE.Object3D, n: number, cy: number, r: number, len: number, width: number, shade: Shade, surf: Surface, flare = 0.25): THREE.Group[][] {
  const out: THREE.Group[][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.2;
    const dx = Math.sin(a), dz = Math.cos(a);
    const l = len * (0.75 + 0.25 * Math.sin(i * 2.3));
    const pts = [0, 0.33, 0.66, 1].map((t) => V(dx * (r + flare * t * l), cy - t * l, dz * (r + flare * t * l)));
    const wid = width * (0.8 + 0.3 * Math.cos(i * 1.7));
    // Flat side outwards: the strip's thickness runs along the radius.
    const geo = tube(pts, [[wid, 0.02], [wid * 0.95, 0.018], [wid * 0.8, 0.015], [wid * 0.3, 0.01]], 4, { ref: V(dx, 0, dz) });
    const joints: THREE.Group[] = [];
    let p: THREE.Object3D = parent;
    for (let k = 0; k < 3; k++) {
      p = sk.joint(p, pts[k].x, pts[k].y, pts[k].z);
      joints.push(p as THREE.Group);
    }
    sk.add(surf, shade, geo, joints, pts[3]);
    out.push(joints);
  }
  return out;
}

function buildWraith(color: number): CreatureRig {
  const sk = new Skin();
  const robeTop = tint(color, 0.7), robeLow = tint(color, 0.35);
  const ghost: Shade = (p, c) => {
    c.lerpColors(_robeA.setHex(robeLow), _robeB.setHex(robeTop), clamp01((p.y - 0.2) / 1.6));
    return 0.35 + 0.6 * clamp01((p.y - 0.05) / 0.9);
  };
  const boneC = 0xcfc7ad;
  const body = sk.joint(sk.root, 0, 1.0, 0);
  const chest = sk.joint(body, 0, 1.5, 0);
  const hp = V(0, 1.92, 0.06);
  const head = sk.joint(chest, hp.x, hp.y, hp.z);
  // Robe: shoulders and torso flaring into a ragged skirt.
  sk.add('ghost', ghost, tube([V(0, 1.82, 0), V(0, 1.7, 0), V(0, 1.45, 0), V(0, 1.15, 0.0), V(0, 0.9, 0)], [[0.12, 0.1], [0.3, 0.18], [0.26, 0.17], [0.27, 0.22], [0.32, 0.28]], 10), [chest, body], V(0, 0.8, 0));
  const strands = tatters(sk, body, 9, 0.98, 0.27, 0.95, 0.11, ghost, 'ghost', 0.22);
  // Hood: an open cowl around a skull with hollow glowing eyes.
  sk.add('ghost', ghost, tube([V(0, 1.98, -0.16), V(0, 2.0, -0.06), V(0, 1.98, 0.06), V(0, 1.93, 0.15)], [[0.06, 0.06], [0.19, 0.2], [0.2, 0.21], [0.18, 0.2]], 10, { open: true }), head);
  sk.add('fur', 0x050408, ell(V(0, 1.93, 0.02), 0.15, 0.17, 0.12, 8, 6), head);
  sk.add('fur', boneC, ell(V(0, 1.92, 0.1), 0.1, 0.12, 0.09, 8, 6), head);
  sk.add('fur', tint(boneC, 0.8), tube([V(0, 1.84, 0.08), V(0, 1.81, 0.15)], [[0.07, 0.03], [0.05, 0.025]], 6), head);
  for (const s of [-1, 1]) {
    sk.add('fur', 0x050408, ell(V(s * 0.04, 1.94, 0.17), 0.03, 0.028, 0.02, 6, 4), head);
    sk.add('glow', 0x80b0ff, ell(V(s * 0.04, 1.94, 0.18), 0.013, 0.013, 0.01, 5, 3), head, undefined, 3);
  }
  // Skeletal arms in ragged sleeves.
  const arms: Limb[] = [];
  for (const s of [-1, 1]) {
    const S = V(s * 0.27, 1.72, 0), E = V(s * 0.38, 1.36, 0.1), Wr = V(s * 0.4, 1.05, 0.22);
    const up = sk.joint(chest, S.x, S.y, S.z);
    const mid = sk.joint(up, E.x, E.y, E.z);
    const low = sk.joint(mid, Wr.x, Wr.y, Wr.z);
    sk.add('ghost', ghost, tube([S, S.clone().lerp(E, 0.5), E, E.clone().lerp(Wr, 0.6)], [0.09, 0.09, 0.1, 0.13], 7), [up, mid], Wr);
    sk.add('fur', boneC, tube([E, Wr], [0.025, 0.02], 5), mid);
    for (let f = 0; f < 4; f++) {
      const sp = (f - 1.5) * 0.035;
      const k0 = Wr.clone().add(V(sp, -0.02, 0.02));
      const k1 = k0.clone().add(V(sp * 0.6, -0.1, 0.06));
      const k2 = k1.clone().add(V(0, -0.08, 0.06));
      sk.add('fur', boneC, tube([k0, k1, k2], [0.012, 0.009, 0], 4), low);
    }
    arms.push({ up, mid, low, side: s, front: true });
  }
  const glow = glowSprite(0x6090ff, 0.55, 0.55);
  glow.position.set(0, 0.0, 0.1);
  head.add(glow);
  const j: CreatureJoints = { chest, arms, strands, wisps: [glow] };
  return finish(sk, 'wraith', body, head, j, 2.2, 1);
}
function buildEye(color: number): CreatureRig {
  const sk = new Skin();
  const body = sk.joint(sk.root, 0, 1.55, 0);
  const head = sk.joint(body, 0, 1.6, 0);
  const R = 0.55;
  const C = V(0, 1.6, 0);
  // Bloodshot sclera, a fleshy hood behind, eyelids, iris and pupil.
  const sclera: Shade = (p, c) => {
    const back = clamp01((0.3 - (p.z - C.z)) / 0.8);
    c.setHex(0xe8dcc8).lerp(_robeA.setHex(0x8a2a2a), back * back);
  };
  sk.add('fur', sclera, ell(C, R, R, R, 16, 12), head);
  const flesh = grad(tint(color, 1.4, 0x6a3040, 0.3), tint(color, 0.8), 1.0, 2.2, 0.15);
  sk.add('fur', flesh, ell(C.clone().add(V(0, 0, -0.28)), R * 0.92, R * 0.92, R * 0.75, 12, 8), head);
  // Veins creeping over the eyeball from behind.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const pts = [0, 0.33, 0.66, 1].map((t) => {
      const th = 2.2 - t * 1.05;
      const ph = a + Math.sin(t * 4 + i * 1.3) * 0.25;
      return V(Math.cos(ph) * Math.sin(th) * R * 1.006, 1.6 + Math.sin(ph) * Math.sin(th) * R * 1.006, Math.cos(th) * R * 1.006);
    });
    sk.add('fur', 0x7a1010, tube(pts, [0.016, 0.012, 0.008, 0], 3), head);
  }
  const iris = sk.joint(head, C.x, C.y, C.z);
  sk.add('glow', 0xff2a20, shell(C, R * 1.006, 0, 0.5, [Math.PI / 2, 0, 0]), iris, undefined, 1.8);
  sk.add('glow', 0xffb040, shell(C, R * 1.008, 0, 0.22, [Math.PI / 2, 0, 0]), iris, undefined, 1.4);
  const pupil = sk.joint(iris, C.x, C.y, C.z + R);
  sk.add('fur', 0x050303, ell(C.clone().add(V(0, 0, R * 0.99)), 0.05, 0.2, 0.02, 8, 6), pupil);
  // Eyelids: shells around the eye that close over it.
  const lids: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const lid = sk.joint(head, C.x, C.y, C.z);
    sk.add('fur', flesh, shell(C, R * 1.05, 0, 1.25, [s > 0 ? -0.55 : Math.PI + 0.55, 0, 0]), lid);
    lids.push(lid);
  }
  // Writhing tentacles below and behind.
  const strands: THREE.Group[][] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const base = V(Math.cos(a) * 0.32, 1.35 + Math.sin(a) * 0.18, -0.28 + Math.sin(a) * 0.05);
    const dir = V(Math.cos(a) * 0.35, -1, -0.45).normalize();
    const len = 1.3 + 0.25 * Math.sin(i * 1.9);
    const pts = [0, 0.25, 0.5, 0.75, 1].map((t) => base.clone().addScaledVector(dir, t * len).add(V(Math.sin(t * 4 + i) * 0.06, 0, 0)));
    strands.push(chain(sk, body, pts, [0.09, 0.07, 0.05, 0.03, 0], 'fur', flesh, 6));
  }
  const j: CreatureJoints = { lids, iris, pupil, strands };
  return finish(sk, 'eye', body, head, j, 2.2, 1);
}

function buildWitch(color: number, scale: number): CreatureRig {
  const sk = new Skin();
  const robe = grad(tint(color, 1.2), tint(color, 0.5), 0.2, 2.0, 0.08);
  const trim = 0xb89a50;
  const skin = 0xb8b0a0;
  const body = sk.joint(sk.root, 0, 1.0, 0);
  const chest = sk.joint(body, 0, 1.7, 0);
  const hp = V(0, 2.22, 0);
  const head = sk.joint(chest, hp.x, hp.y, hp.z);
  // Bodice, high collar and a flared skirt dissolving into tatters.
  sk.add('fur', robe, tube([V(0, 2.08, 0), V(0, 1.98, 0), V(0, 1.75, 0), V(0, 1.45, 0), V(0, 1.15, 0), V(0, 0.75, 0)], [[0.1, 0.09], [0.26, 0.15], [0.22, 0.15], [0.18, 0.14], [0.3, 0.27], [0.42, 0.4]], 12), [chest, body], V(0, 0.6, 0));
  sk.add('fur', trim, tube([V(0, 1.46, 0), V(0, 1.42, 0)], [[0.19, 0.15], [0.19, 0.15]], 12), chest);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.PI;
    sk.add('fur', tint(color, 0.6), spike(V(Math.sin(a) * 0.14, 2.0, Math.cos(a) * 0.1 - 0.02), V(Math.sin(a) * 0.3, 2.28, Math.cos(a) * 0.24 - 0.08), 0.05, 3), chest);
  }
  const strands = tatters(sk, body, 12, 0.78, 0.4, 0.9, 0.13, robe, 'fur', 0.25);
  // Three faces: maiden ahead, mother and crone to either side; a crown above.
  const faces: [number, number][] = [[0, 0xe8e0d0], [2.1, skin], [-2.1, 0x8a8070]];
  sk.add('fur', 0x18141e, ell(hp, 0.15, 0.17, 0.15, 10, 8), head);
  for (const [a, c] of faces) {
    const dir = V(Math.sin(a), 0, Math.cos(a));
    const fc = hp.clone().addScaledVector(dir, 0.085);
    sk.add('fur', c, ell(fc, 0.1, 0.13, 0.08, 9, 7, [0, a, 0]), head);
    const side = V(Math.cos(a), 0, -Math.sin(a));
    for (const s of [-1, 1]) {
      const e = fc.clone().addScaledVector(dir, 0.07).addScaledVector(side, s * 0.04).add(V(0, 0.025, 0));
      sk.add('fur', 0x050308, ell(e, 0.022, 0.016, 0.012, 5, 3, [0, a, 0]), head);
      sk.add('glow', 0xb070ff, ell(e.clone().addScaledVector(dir, 0.006), 0.01, 0.008, 0.008, 4, 3), head, undefined, 3);
    }
    sk.add('fur', 0x2a1018, ell(fc.clone().addScaledVector(dir, 0.07).add(V(0, -0.06, 0)), 0.03, 0.01, 0.01, 5, 3, [0, a, 0]), head);
  }
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const b = V(Math.sin(a) * 0.13, hp.y + 0.11, Math.cos(a) * 0.13);
    sk.add('shell', trim, spike(b, b.clone().add(V(Math.sin(a) * 0.04, 0.12 + (i % 3 === 0 ? 0.08 : 0), Math.cos(a) * 0.04)), 0.025, 4), head);
    if (i % 3 === 0) sk.add('glow', 0xb070ff, ell(b.clone().add(V(0, 0.03, 0)), 0.018, 0.018, 0.018, 5, 3), head, undefined, 2.5);
  }
  sk.add('shell', trim, tube([V(0, hp.y + 0.1, 0), V(0, hp.y + 0.13, 0)], [0.14, 0.145], 12), head);
  // Veil of dark hair down the back.
  const hair: THREE.Group[][] = [];
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + (i - 2) * 0.35;
    const b = V(Math.sin(a) * 0.13, hp.y + 0.04, Math.cos(a) * 0.13);
    hair.push(chain(sk, head, [b, b.clone().add(V(Math.sin(a) * 0.08, -0.3, Math.cos(a) * 0.06)), b.clone().add(V(Math.sin(a) * 0.12, -0.65, Math.cos(a) * 0.1))], [[0.07, 0.02], [0.06, 0.02], 0], 'fur', 0x16121a, 4));
  }
  // Arms in long sleeves; a staff in the right hand, a torch in the left.
  const arms: Limb[] = [];
  for (const s of [-1, 1]) {
    const S = V(s * 0.27, 1.96, 0), E = V(s * 0.42, 1.58, 0.1), Wr = V(s * 0.46, 1.22, 0.28);
    const up = sk.joint(chest, S.x, S.y, S.z);
    const mid = sk.joint(up, E.x, E.y, E.z);
    const low = sk.joint(mid, Wr.x, Wr.y, Wr.z);
    sk.add('fur', robe, tube([S, S.clone().lerp(E, 0.5), E, E.clone().lerp(Wr, 0.6), Wr.clone().lerp(E, -0.02)], [0.075, 0.07, 0.075, 0.1, 0.12], 7), [up, mid, low], Wr.clone().lerp(E, -0.2));
    sk.add('fur', 0x0c0a10, tube([Wr.clone().lerp(E, 0.05), Wr.clone().lerp(E, -0.03)], [0.1, 0.1], 7, { open: true }), low);
    sk.add('fur', skin, ell(Wr.clone().add(V(0, -0.05, 0.03)), 0.04, 0.05, 0.035, 6, 4), low);
    for (let f = 0; f < 4; f++) {
      const k0 = Wr.clone().add(V((f - 1.5) * 0.026, -0.08, 0.04));
      sk.add('fur', skin, tube([k0, k0.clone().add(V((f - 1.5) * 0.01, -0.1, 0.05)), k0.clone().add(V((f - 1.5) * 0.015, -0.19, 0.11))], [0.013, 0.011, 0], 4), low);
    }
    arms.push({ up, mid, low, side: s, front: true });
  }
  const right = arms[0].low;
  const Wr = right.userData.w as V3;
  const shaft = 0x221830;
  sk.add('fur', shaft, tube([Wr.clone().add(V(0, -1.1, 0.04)), Wr.clone().add(V(0, 0.2, 0)), Wr.clone().add(V(0, 1.05, -0.02))], [0.03, 0.035, 0.03], 6), right);
  const top = Wr.clone().add(V(0, 1.12, -0.02));
  sk.add('shell', trim, tube(bez(top.clone().add(V(-0.17, 0.12, 0)), top.clone().add(V(0, -0.18, 0)), top.clone().add(V(0.17, 0.12, 0)), 6), [0.008, 0.02, 0.03, 0.035, 0.03, 0.02, 0.008], 5), right);
  sk.add('glow', 0xb080ff, ell(top.clone().add(V(0, 0.1, 0)), 0.08, 0.08, 0.08, 8, 6), right, undefined, 2.2);
  const left = arms[1].low;
  const Wl = left.userData.w as V3;
  sk.add('fur', 0x2a1c12, tube([Wl.clone().add(V(0, -0.12, 0.04)), Wl.clone().add(V(0, 0.28, 0.06))], [0.022, 0.03], 5), left);
  sk.add('glow', 0x9060ff, tube([Wl.clone().add(V(0, 0.3, 0.06)), Wl.clone().add(V(0, 0.42, 0.06)), Wl.clone().add(V(0, 0.55, 0.05))], [0.06, 0.05, 0], 6), left, undefined, 2.4);
  const flame = glowSprite(0x9060ff, 0.55, 0.9);
  flame.position.copy(Wl).add(V(0, 0.42, 0.06)).sub(Wl);
  left.add(flame);
  const orb = glowSprite(0xb080ff, 0.5, 0.8);
  orb.position.set(0, 1.22, -0.02);
  right.add(orb);
  const j: CreatureJoints = { chest, arms, strands: [...strands, ...hair], wisps: [flame, orb] };
  return finish(sk, 'witch', body, head, j, 2.4, scale, true);
}

// -------------------------------------------------------------------- imp --

export function buildImp(color: number, scale = 1): CreatureRig {
  return instance(`imp:${color}`, scale * 0.95, () => buildImpRig(color));
}

function buildImpRig(color: number): CreatureRig {
  const sk = new Skin();
  const hide = grad(tint(color, 0.9), tint(color, 0.45), 0.3, 1.3, 0.1);
  const darkC = tint(color, 0.3);
  // Hovers: the body floats above the root and the legs dangle.
  const body = sk.joint(sk.root, 0, 0.9, 0);
  const chest = sk.joint(body, 0, 1.12, 0.02);
  sk.add('fur', hide, tube([V(0, 0.78, -0.02), V(0, 0.9, 0), V(0, 1.08, 0.03), V(0, 1.24, 0.02), V(0, 1.3, 0.0)], [[0.12, 0.1], [0.13, 0.11], [0.16, 0.13], [0.15, 0.11], [0.06, 0.05]], 9), [body, chest], V(0, 1.32, 0));
  // Molten belly.
  sk.add('glow', 0xff6a10, tube([V(0, 0.86, 0.1), V(0.01, 0.98, 0.135), V(-0.01, 1.08, 0.15)], [0.012, 0.016, 0.01], 3), [body, chest], V(0, 1.2, 0.1), 2);
  const hp = V(0, 1.38, 0.04);
  const head = sk.joint(chest, hp.x, hp.y, hp.z);
  sk.add('fur', hide, ell(V(0, 1.43, 0.06), 0.13, 0.12, 0.12, 10, 8), head);
  sk.add('fur', hide, ell(V(0, 1.38, 0.15), 0.08, 0.06, 0.06, 7, 5), head);
  const jaw = sk.joint(head, 0, 1.36, 0.08);
  sk.add('fur', tint(color, 0.7), tube([V(0, 1.35, 0.06), V(0, 1.32, 0.15), V(0, 1.33, 0.2)], [[0.08, 0.03], [0.06, 0.025], [0.03, 0.015]], 6), jaw);
  sk.add('glow', 0xff7a20, ell(V(0, 1.355, 0.15), 0.05, 0.015, 0.05, 6, 4), head, undefined, 1.6);
  for (const s of [-1, 1]) {
    sk.add('glow', 0xffc020, ell(V(s * 0.055, 1.45, 0.16), 0.022, 0.014, 0.012, 6, 4, [0, 0, s * 0.3]), head, undefined, 3);
    sk.add('fur', darkC, ell(V(s * 0.05, 1.48, 0.15), 0.04, 0.012, 0.03, 5, 3, [0, 0, -s * 0.4]), head);
    sk.add('fur', 0x2a2420, tube(bez(V(s * 0.06, 1.52, 0.04), V(s * 0.14, 1.66, 0.0), V(s * 0.1, 1.74, -0.1), 4), taper(5, 0.03, 0), 5), head);
    sk.add('fur', hide, tube([V(s * 0.11, 1.44, 0.04), V(s * 0.24, 1.48, -0.02)], [[0.03, 0.012], 0], 4), head);
    sk.add('fur', 0xf0e8d0, spike(V(s * 0.03, 1.34, 0.17), V(s * 0.03, 1.31, 0.175), 0.008, 3), head);
  }
  // Thin clawed arms.
  const arms: Limb[] = [];
  for (const s of [-1, 1]) {
    const S = V(s * 0.15, 1.24, 0.02), E = V(s * 0.24, 1.04, 0.0), Wr = V(s * 0.26, 0.84, 0.08);
    const up = sk.joint(chest, S.x, S.y, S.z);
    const mid = sk.joint(up, E.x, E.y, E.z);
    const low = sk.joint(mid, Wr.x, Wr.y, Wr.z);
    sk.add('fur', hide, tube([S, E, Wr, Wr.clone().add(V(0, -0.04, 0.02))], [0.045, 0.035, 0.03, 0.035], 6), [up, mid, low], Wr.clone().add(V(0, -0.06, 0.03)));
    for (let f = 0; f < 3; f++) sk.add('fur', 0x1a1210, spike(Wr.clone().add(V((f - 1) * 0.02, -0.05, 0.03)), Wr.clone().add(V((f - 1) * 0.03, -0.13, 0.08)), 0.01, 3), low);
    arms.push({ up, mid, low, side: s, front: true });
  }
  // Digitigrade legs.
  const limbs: Limb[] = [];
  for (const s of [-1, 1]) {
    const pts = [V(s * 0.09, 0.8, 0), V(s * 0.12, 0.6, 0.1), V(s * 0.11, 0.42, -0.04), V(s * 0.11, 0.34, 0.05)];
    const l = leg(sk, body, pts, [0.065, 0.045, 0.03, 0.03], hide, s, false);
    sk.add('fur', darkC, ell(V(s * 0.11, 0.34, 0.07), 0.035, 0.025, 0.06, 6, 4), l.low);
    limbs.push(l);
  }
  // Tail with an arrowhead tip.
  const tailPts = [V(0, 0.82, -0.12), V(0, 0.72, -0.3), V(0, 0.6, -0.42), V(0, 0.52, -0.58), V(0, 0.5, -0.72)];
  const tail = chain(sk, body, tailPts, [0.035, 0.028, 0.022, 0.016, 0.01], 'fur', hide, 5);
  sk.add('fur', darkC, tube([V(0, 0.5, -0.68), V(0, 0.5, -0.76), V(0, 0.5, -0.86)], [[0.07, 0.01], [0.05, 0.01], 0], 4), tail[tail.length - 1]);
  // Bat wings.
  const wings: Wing[] = [];
  for (const s of [-1, 1]) {
    const S = V(s * 0.08, 1.24, -0.08), E = V(s * 0.3, 1.38, -0.16), W = V(s * 0.52, 1.42, -0.12);
    const tips = [V(s * 0.85, 1.36, -0.2), V(s * 0.74, 1.12, -0.28), V(s * 0.5, 0.98, -0.26)];
    const root = sk.joint(chest, S.x, S.y, S.z);
    const fore = sk.joint(root, E.x, E.y, E.z);
    const hand = sk.joint(fore, W.x, W.y, W.z);
    const fingers = tips.map(() => sk.joint(hand, W.x, W.y, W.z));
    sk.add('fur', darkC, tube([S, E, W], [0.025, 0.02, 0.016], 5), [root, fore, hand], W.clone().add(V(s * 0.05, 0, 0)));
    tips.forEach((t, i) => sk.add('fur', darkC, tube([W, t], [0.012, 0.003], 3), fingers[i]));
    const mem = membrane(s, W, tips, fingers, [S, E], [root, fore], hand, V(s * 0.06, 0.95, -0.1), body, chest);
    sk.push('membrane', tint(color, 0.45, 0x401010, 0.4), mem.geo, mem.weigh);
    const fold = foldWing(root, fore, hand, tips, V(s * 0.3, 0.9, -0.4), V(s * 0.1, -0.4, 1), [V(s * 0.1, 0.0, -1), V(s * 0.15, -0.3, -1), V(s * 0.2, -0.6, -1)]);
    wings.push({ root, fore, hand, fingers, side: s, fold });
  }
  const j: CreatureJoints = { chest, jaw, arms, limbs, tail, wings };
  return finish(sk, 'imp', body, head, j, 1.37, 1);
}

// ------------------------------------------------------------------- crab --

export function buildCrab(color: number, scale: number): CreatureRig {
  const sk = new Skin();
  const shellC = grad(tint(color, 1.15), tint(color, 0.5), 0.9, 1.75, 0.1);
  const under = tint(color, 0.55, 0xc8b898, 0.2);
  const barn = 0x9aa69a;
  const ty = 1.2;
  const body = sk.joint(sk.root, 0, ty, 0);
  const head = sk.joint(body, 0, ty + 0.2, 0.85);
  // Carapace: a broad domed shell with a ridged front edge, spikes and barnacles.
  sk.add('shell', shellC, ell(V(0, ty + 0.08, 0), 1.3, 0.55, 1.0, 16, 10), body);
  sk.add('shell', under, ell(V(0, ty - 0.16, 0.0), 1.15, 0.32, 0.88, 12, 6), body);
  sk.add('shell', shellC, ell(V(0, ty + 0.32, -0.1), 0.85, 0.32, 0.62, 12, 6), body);
  for (let i = 0; i < 9; i++) {
    const a = -1.15 + (i / 8) * 2.3;
    const b = V(Math.sin(a) * 1.22, ty + 0.1, Math.cos(a) * 0.9);
    sk.add('shell', tint(color, 0.6), spike(b, b.clone().add(V(Math.sin(a) * 0.22, 0.05, Math.cos(a) * 0.2)), 0.07, 4), body);
  }
  for (let i = 0; i < 16; i++) {
    const a = i * 2.39996;
    const r = 0.25 + 0.65 * Math.sqrt((i + 0.5) / 16);
    const x = Math.cos(a) * r * 1.1, z = Math.sin(a) * r * 0.8 - 0.1;
    const y = ty + 0.08 + 0.55 * Math.sqrt(Math.max(0, 1 - (x / 1.3) ** 2 - (z / 1.0) ** 2));
    sk.add('shell', barn, tube([V(x, y - 0.04, z), V(x, y + 0.08, z), V(x, y + 0.1, z)], [0.08 + (i % 3) * 0.02, 0.055, 0.03], 5), body);
  }
  // Seaweed trailing off the back.
  const strands: THREE.Group[][] = [];
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.35;
    const b = V(x, ty + 0.3, -0.85);
    strands.push(chain(sk, body, [b, b.clone().add(V(x * 0.1, -0.35, -0.2)), b.clone().add(V(x * 0.15, -0.7, -0.3)), b.clone().add(V(x * 0.2, -1.0, -0.32))], [[0.08, 0.015], [0.07, 0.012], [0.05, 0.01], 0], 'fur', i % 2 ? 0x2a4a2a : 0x3a5a30, 4));
  }
  // Eye stalks with glowing eyes, and mouthparts.
  const stalks: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const st = sk.joint(head, s * 0.28, ty + 0.25, 0.9);
    sk.add('shell', shellC, tube([V(s * 0.28, ty + 0.2, 0.9), V(s * 0.31, ty + 0.5, 0.94), V(s * 0.33, ty + 0.68, 0.95)], [0.05, 0.04, 0.045], 6), st);
    sk.add('glow', 0x60ffe0, ell(V(s * 0.33, ty + 0.72, 0.96), 0.08, 0.08, 0.08, 8, 6), st, undefined, 2.4);
    stalks.push(st);
  }
  const jaw = sk.joint(head, 0, ty - 0.05, 0.92);
  for (const s of [-1, 1]) sk.add('shell', under, ell(V(s * 0.1, ty - 0.08, 0.95), 0.1, 0.16, 0.05, 6, 4), jaw);
  // Two huge claws, the right larger.
  const pincers: Pincer[] = [];
  for (const s of [-1, 1]) {
    const k = s < 0 ? 1.18 : 1;
    const A = V(s * 0.95, ty - 0.02, 0.62), E = V(s * 1.6, ty + 0.12, 1.12), Wr = V(s * 1.42, ty + 0.18, 1.78);
    const arm = sk.joint(body, A.x, A.y, A.z);
    const fore = sk.joint(arm, E.x, E.y, E.z);
    const hand = sk.joint(fore, Wr.x, Wr.y, Wr.z);
    sk.add('shell', shellC, tube([A, A.clone().lerp(E, 0.5), E, E.clone().lerp(Wr, 0.5), Wr], [0.16, 0.2, 0.17, 0.22, 0.2], 8), [arm, fore, hand], Wr.clone().add(V(0, 0, 0.1)));
    for (const t of [0.3, 0.7]) {
      const p = A.clone().lerp(E, t).add(V(0, 0.16, 0));
      sk.add('shell', tint(color, 0.6), spike(p, p.clone().add(V(0, 0.16, -0.05)), 0.05, 4), arm);
    }
    // A flattened, ridged claw with a serrated fixed finger and a hinged dactyl.
    const palm = V(s * 1.4, ty + 0.2, 2.2);
    sk.add('shell', shellC, ell(palm, 0.27 * k, 0.4 * k, 0.6 * k, 10, 8), hand);
    for (const dz of [-0.25, 0.05, 0.3]) {
      const p = palm.clone().add(V(0, 0.36 * k, dz * k));
      sk.add('shell', tint(color, 0.6), spike(p, p.clone().add(V(s * 0.04, 0.14 * k, -0.06)), 0.05 * k, 4), hand);
    }
    const fixedTip = palm.clone().add(V(-s * 0.1, -0.1 * k, 1.25 * k));
    sk.add('shell', tint(color, 0.7), tube([palm.clone().add(V(0, -0.14 * k, 0.4 * k)), palm.clone().add(V(-s * 0.05, -0.2 * k, 0.85 * k)), fixedTip], [[0.13 * k, 0.17 * k], [0.09 * k, 0.11 * k], 0], 6), hand);
    const fj = palm.clone().add(V(0, 0.16 * k, 0.42 * k));
    const finger = sk.joint(hand, fj.x, fj.y, fj.z);
    sk.add('shell', tint(color, 0.85), tube([fj, fj.clone().add(V(-s * 0.03, 0.05 * k, 0.42 * k)), fj.clone().add(V(-s * 0.09, -0.12 * k, 0.82 * k))], [[0.12 * k, 0.15 * k], [0.08 * k, 0.1 * k], 0], 6), finger);
    for (let i = 0; i < 4; i++) {
      const p = fj.clone().add(V(-s * 0.03, -0.1 * k, (0.12 + i * 0.15) * k));
      sk.add('shell', 0xd8d0b8, spike(p, p.clone().add(V(0, -0.1 * k, 0.02)), 0.035, 3), finger);
      const q = palm.clone().add(V(-s * 0.04, -0.06 * k, (0.5 + i * 0.16) * k));
      sk.add('shell', 0xd8d0b8, spike(q, q.clone().add(V(0, 0.1 * k, 0.02)), 0.035, 3), hand);
    }
    pincers.push({ arm, fore, hand, finger, side: s });
  }
  // Eight spiny walking legs.
  const limbs: Limb[] = [];
  const zs = [0.42, 0.08, -0.26, -0.58];
  const splay = [0.45, 0.12, -0.2, -0.5];
  for (let i = 0; i < 4; i++) {
    for (const s of [1, -1]) {
      const ps = splay[i];
      const A = V(s * 0.95, ty - 0.1, zs[i]);
      const K = A.clone().add(V(s * Math.cos(ps) * 0.55, 0.42, Math.sin(ps) * 0.55));
      const F = A.clone().add(V(s * Math.cos(ps) * 0.98, -0.42, Math.sin(ps) * 0.98));
      const T = A.clone().add(V(s * Math.cos(ps) * 1.08, -ty + 0.1, Math.sin(ps) * 1.08));
      limbs.push(leg(sk, body, [A, K, F, T], [0.17, 0.13, 0.09, 0.0], shellC, s, i < 2, 'shell'));
      sk.add('shell', tint(color, 0.6), spike(K, K.clone().add(V(0, 0.14, 0)), 0.04, 4), limbs[limbs.length - 1].mid);
    }
  }
  const j: CreatureJoints = { jaw, pincers, limbs, stalks, strands, legLen: ty };
  return finish(sk, 'crab', body, head, j, 2, scale, true);
}

// ---------------------------------------------------------------- animator --

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Rises over [a,b], falls over [c,d]. */
const env = (x: number, a: number, b: number, c: number, d: number) => sstep(a, b, x) * (1 - sstep(c, d, x));
const frac = (x: number) => x - Math.floor(x);
const TAU = Math.PI * 2;

interface St {
  t: number;
  ready: boolean;
  x: number;
  z: number;
  yaw: number;
  /** Smoothed ground speed (world m/s) and yaw rate. */
  v: number;
  turn: number;
  cyc: number;
  walk: number;
  gallop: number;
  seed: number;
  blink: number;
  look: number;
  lookX: number;
  lookY: number;
  hurt: number;
  hurtSide: number;
  deadSide: number;
}
const states = new WeakMap<CreatureRig, St>();

/** Damped approach to a target rotation. */
function R(o: THREE.Object3D, x: number, y: number, z: number, k: number) {
  const r = o.rotation;
  r.set(r.x + (x - r.x) * k, r.y + (y - r.y) * k, r.z + (z - r.z) * k);
}
/** Damped approach to an offset from the joint's bind position. */
function P(o: THREE.Object3D, x: number, y: number, z: number, k: number) {
  const b = o.userData.bp as V3;
  const p = o.position;
  p.set(p.x + (b.x + x - p.x) * k, p.y + (b.y + y - p.y) * k, p.z + (b.z + z - p.z) * k);
}
function S(o: THREE.Object3D, s: number, k: number) {
  o.scale.setScalar(o.scale.x + (s - o.scale.x) * k);
}

/** The creature's own reading of a gameplay attack style. */
function styleFor(kind: string, s: AttackStyle): AttackStyle {
  switch (s) {
    case 'slash': case 'slash2': case 'slash3': case 'thrust': case 'heavy': case 'spin': case 'combo':
      return kind === 'insect' ? 'sting' : kind === 'crab' || kind === 'wraith' ? 'claw' : kind === 'stag' || kind === 'witch' ? 'sweep' : kind === 'imp' ? 'throw' : kind === 'eye' ? 'cast' : 'bite';
    case 'overhead':
      return 'slam';
    case 'bow': case 'throw':
      return kind === 'imp' ? 'throw' : 'cast';
    case 'roar':
      return 'summon';
    default:
      return s;
  }
}

/** Fraction of the attack at which each move lands. */
const HIT: Partial<Record<AttackStyle, number>> = { sweep: 0.62, slam: 0.9, ring: 0.92, volley: 0.32, summon: 0.8, leap: 1, stomp: 0.8, strikes: 0.5 };

export function animateCreature(rig: CreatureRig, a: AnimState): void {
  let st = states.get(rig);
  if (!st) {
    st = { t: a.t, ready: false, x: 0, z: 0, yaw: 0, v: 0, turn: 0, cyc: Math.random(), walk: 1, gallop: 0, seed: Math.random() * 100, blink: 2, look: 0, lookX: 0, lookY: 0, hurt: 0, hurtSide: 1, deadSide: Math.random() < 0.5 ? -1 : 1 };
    states.set(rig, st);
  }
  const r = rig.root;
  const dt = st.ready ? Math.min(0.1, Math.max(0, a.t - st.t)) : 1;
  st.t = a.t;
  if (st.ready && dt > 0) {
    const d = Math.hypot(r.position.x - st.x, r.position.z - st.z);
    // Ground speed from the root's motion; a jump of more than ~60 m/s is a teleport.
    const speed = a.speed > 0 ? a.speed : d < Math.max(2, 40 * dt) ? d / dt : 0;
    st.v += (Math.min(speed, 40) - st.v) * (1 - Math.exp(-8 * dt));
    const turn = Math.max(-5, Math.min(5, Math.atan2(Math.sin(r.rotation.y - st.yaw), Math.cos(r.rotation.y - st.yaw)) / dt));
    st.turn += (turn - st.turn) * (1 - Math.exp(-5 * dt));
  }
  st.ready = true;
  st.x = r.position.x;
  st.z = r.position.z;
  st.yaw = r.rotation.y;
  // Hurt and landing decay here; a fresh hit picks a new flinch side.
  if (a.hurt > st.hurt + 0.3) st.hurtSide = Math.random() < 0.5 ? -1 : 1;
  st.hurt = a.hurt = Math.max(0, a.hurt - dt * 3);
  a.landing = Math.max(0, a.landing - dt * 3);
  const j = rig.j ?? {};
  const style = a.attack >= 0 || a.windup > 0 ? styleFor(rig.kind, a.attackStyle) : 'bite';
  // One context object is reused for every creature every frame (no garbage in the hot loop).
  const c = CTX;
  c.rig = rig;
  c.j = j;
  c.a = a;
  c.st = st;
  c.dt = kdt = dt;
  c.style = style;
  switch (rig.kind) {
    case 'insect':
      return animInsect(c);
    case 'crab':
      return animCrab(c);
    case 'wraith':
      return animWraith(c);
    case 'eye':
      return animEye(c);
    case 'witch':
      return animWitch(c);
    case 'imp':
      return animImp(c);
    default:
      return animQuad(c);
  }
}

interface Ctx {
  rig: CreatureRig;
  j: CreatureJoints;
  a: AnimState;
  st: St;
  dt: number;
  style: AttackStyle;
  k: (rate: number) => number;
}

/** Frame step for the shared damping function below. */
let kdt = 0;
const CTX = { k: (rate: number) => 1 - Math.exp(-rate * kdt) } as Ctx;
/** Shared stand-in for missing joint lists, so `?? NONE` allocates nothing. */
const NONE: never[] = [];

/** Attack curves: wind-up (anticipation), strike (the lunge into the hit) and the follow-through. */
const ATK = { on: 0, antic: 0, strike: 0, after: 0 };
/** Fills and returns a shared object: read it before the next call. */
function attackCurves(a: AnimState, hit: number) {
  const x = a.attack;
  if (x < 0) {
    ATK.on = 0;
    ATK.antic = Math.max(0, a.windup) * 0.8;
    ATK.strike = ATK.after = 0;
    return ATK;
  }
  ATK.antic = Math.max(env(x, 0, hit * 0.7, hit * 0.72, hit * 0.95), a.windup);
  ATK.strike = env(x, hit * 0.7, hit * 0.98, hit + 0.04, Math.min(1, hit + 0.35));
  ATK.after = env(x, hit, hit + 0.08, hit + 0.15, 1);
  ATK.on = 1 - sstep(0.85, 1, x) * 0.5;
  return ATK;
}

/** Gait leg cycle: stance pushes the foot back, swing lifts and carries it forward. */
const STRIDE: [number, number] = [0, 0];
function stride(u: number, duty: number): [number, number] {
  if (u < duty) {
    STRIDE[0] = 1 - 2 * (u / duty);
    STRIDE[1] = 0;
    return STRIDE;
  }
  const s = (u - duty) / (1 - duty);
  STRIDE[0] = -1 + 2 * s * s * (3 - 2 * s);
  STRIDE[1] = Math.sin(Math.PI * s);
  return STRIDE;
}

const OFF_WALK = [0.25, 0.75, 0.0, 0.5];
const OFF_TROT = [0.5, 1.0, 0.0, 0.5];
const OFF_GALLOP = [0.55, 0.65, 0.0, 0.1];

function animQuad(c: Ctx) {
  const { rig, j, a, st, dt, k } = c;
  const sc = rig.root.scale.x || 1;
  const legLen = j.legLen ?? 0.75;
  const vr = st.v / sc / legLen;
  const big = rig.kind === 'stag';
  const drake = rig.kind === 'drake';
  st.walk += (1 - sstep(1.8, 3.2, vr) - st.walk) * k(3);
  st.gallop += (sstep(5, 7.5, vr) - st.gallop) * k(3);
  const gW = st.walk, gG = st.gallop * (1 - gW), gT = Math.max(0, 1 - gW - gG);
  const strideLen = (1.4 * gW + 2.4 * gT + 3.8 * gG) * legLen * sc;
  st.cyc = frac(st.cyc + (st.v * dt) / Math.max(0.3, strideLen));
  const mv = sstep(0.12, 1.2, vr);
  const duty = 0.64 * gW + 0.5 * gT + 0.38 * gG;
  const lift = (0.55 * gW + 0.8 * gT + 1 * gG) * mv;
  const ph = st.cyc * TAU;
  const t = a.t + st.seed;
  const fury = a.fury;
  const flying = a.flying && drake;

  // Body posture: bob, gallop rock, spine flex, lean into turns, breathing.
  let bodyY = -0.012 * gW * mv * Math.cos(2 * ph) - 0.03 * gT * mv * Math.abs(Math.cos(ph)) + 0.05 * gG * Math.sin(ph) * mv;
  let bodyZ = 0;
  let bodyX = 0.06 * gG * Math.sin(ph + 0.6) * mv - 0.03 * fury;
  let bodyRoll = Math.max(-0.22, Math.min(0.22, -st.turn * 0.07 * mv));
  let flex = 0.12 * gG * Math.sin(ph + 1.2) * mv;
  const breathe = Math.sin(t * (2 + fury)) * (1 - mv);
  bodyY += breathe * 0.006 - fury * 0.04;
  // Head and neck: counter the body rock, look into turns, idle sniff and look-around.
  const idle = 1 - mv;
  const sniff = idle * Math.max(0, Math.sin(t * 0.37)) ** 6;
  let neckX = -bodyX * 0.8 + sniff * 0.45 + 0.08 * gG * mv + fury * 0.12;
  let neckY = st.turn * 0.12 + idle * Math.sin(t * 0.29) * 0.35 * (1 - sniff);
  let headX = sniff * (0.15 + Math.sin(t * 14) * 0.05) - 0.05 * gW * mv * Math.sin(2 * ph);
  let headY = 0;
  let headZ = 0;
  let jaw = 0.04 + 0.12 * sstep(5, 7, vr) + sniff * 0.05;
  let earX = 0.3 * sstep(4, 8, vr) + fury * 0.4;
  // Tail wag, stiffer when hunting.
  const wagAmp = idle > 0.5 ? 0.25 : 0.1;
  let tailX = -0.08 * mv - 0.06 * gG * Math.sin(ph) + (rig.kind === 'wolf' ? 0.15 * (1 - mv) : 0);
  let frontReach = 0;
  let rear = 0;

  // Attacks.
  const style = c.style;
  const hit = HIT[style] ?? 0.667;
  const atk = attackCurves(a, hit);
  if (atk.on > 0 || atk.antic > 0) {
    if (style === 'charge' && big) {
      // Rear up during the wind-up, then lower the antlers into the charge.
      rear = Math.max(0, a.windup) * (a.attack < 0 ? 1 : 1 - sstep(0.05, 0.25, a.attack));
      const lower = a.attack >= 0 ? 1 - rear : 0;
      neckX += 0.55 * lower - 0.4 * rear;
      headX += 0.35 * lower;
      jaw += 0.3 * rear;
    } else if (style === 'sweep') {
      // Swing the head (antlers) to one side, then sweep across.
      const side = 1;
      neckY += side * (0.7 * atk.antic - 1.2 * atk.strike);
      headZ += side * (0.25 * atk.antic - 0.35 * atk.strike);
      neckX += 0.25 * atk.antic + 0.35 * atk.strike;
      bodyRoll += side * (-0.06 * atk.antic + 0.1 * atk.strike);
      bodyZ += 0.1 * atk.strike;
    } else if (style === 'volley' || style === 'cast' || style === 'summon' || style === 'roar') {
      // Rear back, then thrust the head forward (spit / launch / call).
      const pull = style === 'volley' ? env(a.attack, 0, 0.25, 0.3, 0.4) : atk.antic;
      const thrust = style === 'volley' ? env(a.attack, 0.28, 0.34, 0.65, 0.85) : atk.strike;
      if (style === 'summon' && big) rear = 0.5 * env(a.attack, 0, 0.35, 0.75, 1);
      neckX += -0.6 * pull + 0.4 * thrust;
      headX += -0.3 * pull + 0.2 * thrust + (style === 'volley' ? Math.sin(a.t * 50) * 0.04 * thrust : 0);
      jaw += 0.2 * pull + 0.7 * thrust;
      bodyZ += -0.08 * pull + 0.05 * thrust;
      if (style === 'summon') jaw += 0.4 * env(a.attack, 0.2, 0.4, 0.8, 1);
    } else if (style === 'slam' || style === 'stomp' || style === 'leap') {
      rear = atk.antic;
      neckX += -0.3 * atk.antic + 0.5 * atk.strike;
      bodyY -= 0.08 * atk.after;
      frontReach = -0.6 * atk.strike;
    } else if (rig.kind === 'boar') {
      // Gore: head low and braced, lunge, toss the tusks up.
      neckX += 0.4 * atk.antic + 0.1 * atk.strike;
      headX += 0.3 * atk.antic - 0.9 * atk.strike;
      bodyZ += -0.1 * atk.antic + 0.35 * atk.strike;
      bodyY += -0.06 * atk.antic + 0.04 * atk.strike;
      jaw += 0.15 * atk.strike;
      earX += 0.6;
    } else {
      // Bite: crouch and draw back with the jaw opening, lunge up at the throat, snap shut.
      const open = env(a.attack < 0 ? 0 : a.attack, 0.15, hit * 0.85, hit * 0.92, hit + 0.02);
      neckX += 0.3 * atk.antic + 0.05 * atk.strike;
      headX += -0.15 * atk.antic - 0.1 * atk.strike - 0.3 * open;
      jaw += 0.75 * open + 0.1 * atk.after;
      bodyZ += -0.12 * atk.antic + 0.5 * atk.strike;
      bodyY += -0.08 * atk.antic + 0.09 * atk.strike;
      bodyX += 0.08 * atk.antic - 0.16 * atk.strike;
      frontReach = 0.7 * atk.strike;
      earX += 0.7 * (atk.antic + atk.strike);
      tailX -= 0.3 * atk.antic;
    }
  }
  // Charging without an attack phase (the stag at full tilt) keeps its head down.
  if (big && vr > 6 && atk.on === 0) {
    neckX += 0.45 * sstep(6, 8, vr);
    headX += 0.25 * sstep(6, 8, vr);
  }

  // Hurt flinch: recoil away from the blow, head jerks up.
  const h = st.hurt * st.hurt;
  bodyZ -= 0.1 * h;
  bodyRoll += st.hurtSide * 0.12 * h;
  neckX -= 0.35 * h;
  headY += st.hurtSide * 0.25 * h;
  jaw += 0.35 * h;
  earX += 0.8 * h;

  // Rearing pivots the body up about the hind hips.
  const rx = -0.62 * rear;
  if (rear > 0) {
    const zh = j.hips ? (j.hips.userData.bp as V3).z : -0.3;
    bodyY += zh * Math.sin(rx);
    bodyZ += zh * (1 - Math.cos(rx));
    neckX -= 0.3 * rear;
  }

  // Death: legs buckle, the body drops and rolls onto its side.
  let dead = 0;
  if (a.dead >= 0) {
    dead = sstep(0, 0.9, a.dead);
    const kneel = sstep(0, 0.35, a.dead);
    const roll = sstep(0.2, 0.9, a.dead);
    const torsoY = (rig.body.userData.bp as V3).y;
    const kneelY = torsoY * 0.55, sideY = (j.girth ?? 0.2) + 0.02;
    bodyY = (kneelY - torsoY) * kneel * (1 - roll) + (sideY - torsoY) * roll;
    bodyRoll = st.deadSide * 1.45 * roll;
    bodyX = 0.15 * kneel * (1 - roll);
    flex = 0;
    bodyZ = 0;
    neckX = -0.1 + 0.35 * roll;
    neckY = 0.2 * st.deadSide * roll;
    headX = 0.2 * roll;
    headY = 0;
    headZ = 0;
    jaw = 0.25 * roll;
    tailX = 0.2;
    earX = 0.5;
  }

  const kb = k(big ? 9 : 12);
  const kh = k(14);
  R(rig.body, bodyX + rx, 0, bodyRoll, kb);
  P(rig.body, 0, bodyY, bodyZ, kb);
  if (j.chest) R(j.chest, flex, 0, 0, kb);
  if (j.hips) R(j.hips, -flex - rx * 0.15, 0, 0, kb);
  const neck = j.neck ?? NONE;
  const nn = neck.length + 1;
  for (const n of neck) R(n, neckX / nn, neckY / nn, headZ * 0.3, kh);
  R(rig.head, neckX / nn + headX, neckY / nn + headY, headZ, kh);
  if (j.jaw) R(j.jaw, Math.max(0, jaw), 0, 0, k(jaw > j.jaw.rotation.x ? 18 : 30));
  for (const e of j.ears ?? NONE) {
    const s = (e.userData.bp as V3).x > 0 ? 1 : -1;
    const twitch = idle * (Math.sin(t * 1.7 + s) > 0.97 ? 0.3 : 0);
    R(e, -earX * 0.9 - twitch, 0, -s * earX * 0.5, k(12));
  }
  const tail = j.tail ?? NONE;
  const wagRate = idle > 0.5 ? 3 : 8;
  tail.forEach((seg, i) => {
    const y = wagAmp * Math.sin(t * wagRate - i * 0.6) * (0.6 + i * 0.3) - st.turn * 0.15;
    R(seg, tailX / tail.length + (dead ? 0.05 : 0), (dead ? 0 : y) * (2 / tail.length), 0, k(8));
  });

  // Legs: feet planted by IK through the stance, carried forward in an arc
  // through the swing; rearing, flight and death fall back to set poses.
  const limbs = j.limbs ?? NONE;
  const kl = k(dead ? 8 : 40);
  const S = strideLen / sc;
  const liftH = (0.1 * gW + 0.16 * gT + 0.22 * gG) * legLen * mv;
  const body = rig.body;
  limbs.forEach((l, i) => {
    const off = OFF_WALK[i] * gW + OFF_TROT[i] * gT + OFF_GALLOP[i] * gG;
    const [fwd, up] = stride(frac(st.cyc + off), duty);
    const parent = l.up.parent!;
    childFrame(parent, body.position.y, body.position.z, body.rotation.x, _fr);
    childFrame(l.up, _fr[0], _fr[1], _fr[2], _fh);
    const ik = l.ik!;
    const fz = ik.foot.z + fwd * duty * S * 0.5 * mv + (l.front ? 0.25 * frontReach + bodyZ * 0.5 : bodyZ * 0.2);
    const fy = ik.foot.y + up * liftH + (l.front ? 0.2 * frontReach * legLen : 0);
    solveLeg(ik, _fh[0], _fh[1], _fr[2], fy, fz, _ik);
    let [hip, mid, low] = _ik;
    // A flick of the paw through the swing.
    low += (l.front ? 0.9 : -0.5) * up * lift;
    let fk = 0;
    let fh = 0, fm = 0, fl = 0;
    if (rear > 0 && l.front) {
      // Hooves paw the air.
      const paw = Math.sin(a.t * 9 + (l.side > 0 ? 0 : 2)) * 0.5 + 0.5;
      fk = sstep(0, 0.4, rear);
      fh = -0.9 - 0.4 * paw;
      fm = -0.5;
      fl = 1.4 + 0.6 * paw;
    }
    if (flying) {
      fk = 1;
      fh = l.front ? -0.9 : 1.1;
      fm = l.front ? -0.4 : 0.9;
      fl = l.front ? 1.4 : -0.4;
    }
    if (dead) {
      // Buckle, then go limp as the body rolls.
      const kneel = sstep(0, 0.35, a.dead) * (1 - sstep(0.4, 0.9, a.dead));
      fk = sstep(0, 0.3, a.dead);
      fh = l.front ? -0.2 + 0.6 * kneel : 0.5 * kneel;
      fm = l.front ? 0.2 - 0.5 * kneel : 0.7 * kneel;
      fl = l.front ? 1.6 * kneel + 0.2 : -0.6 * kneel;
    }
    hip += (fh - hip) * fk;
    mid += (fm - mid) * fk;
    low += (fl - low) * fk;
    R(l.up, hip, 0, l.side * (0.04 * dead), kl);
    R(l.mid, mid, 0, 0, kl);
    R(l.low, low, 0, 0, kl);
  });

  // Wings (drake).
  for (const w of j.wings ?? NONE) animWing(c, w, flying ? 1 : 0, (atk.on > 0 ? 0.6 : 0) + 0.25 * sstep(5, 9, vr) + (dead ? 0.6 : 0), flying ? 7 : 0);
  if (j.wisps && j.glow) animWisps(c, j.wisps, j.glow, style === 'summon' || style === 'volley' ? atk.on : 0, dead);
}

/**
 * Poses a wing: `flap` 0/1 blends in the flight beat at `rate`, `open` 0..1
 * how far it unfolds when grounded (0 = folded against the flank).
 */
function animWing(c: Ctx, w: Wing, flap: number, open: number, rate: number) {
  const { a, st, k } = c;
  const s = w.side;
  const t = a.t + st.seed;
  const f = clamp01(1 - open - flap);
  const F = w.fold;
  const breathe = Math.sin(t * 1.3) * 0.03 * f;
  // The downstroke is quicker than the recovery; the outer joints trail.
  const ph = rate > 0 ? t * rate : 0;
  const beat = rate > 0 ? Math.sin(ph + 0.5 * Math.sin(ph)) : 0;
  const lag = rate > 0 ? Math.sin(ph - 0.8 + 0.5 * Math.sin(ph - 0.8)) : 0;
  const kw = k(rate > 0 ? 35 : 9);
  R(w.root, F.root.x * f, F.root.y * f + s * 0.1 * flap * lag, F.root.z * f + breathe * s + s * flap * (0.2 + 0.8 * beat), kw);
  R(w.fore, F.fore.x * f, F.fore.y * f, F.fore.z * f + s * flap * 0.4 * lag, kw);
  R(w.hand, 0, 0, s * flap * 0.2 * lag, kw);
  w.fingers.forEach((g, i) => {
    const e = F.fingers[i];
    R(g, e.x * f, e.y * f - s * flap * 0.1 * lag * (i + 1), e.z * f + s * flap * 0.15 * lag, kw);
  });
}

function animWisps(c: Ctx, wisps: THREE.Sprite[], glow: THREE.MeshStandardMaterial, cast: number, dead: number) {
  const { a, k } = c;
  const t = a.t;
  const spin = 0.6 + cast * 2.5 + a.fury * 0.8;
  wisps.forEach((w, i) => {
    const ph = (i / wisps.length) * TAU + t * spin * (i % 2 ? 1 : -0.7);
    const r = 0.45 + 0.12 * Math.sin(t * 1.3 + i) - cast * 0.15;
    w.position.set(Math.cos(ph) * r, 0.75 + 0.3 * Math.sin(t * 0.9 + i * 1.7) + cast * 0.2, -0.05 + Math.sin(ph) * r * 0.6);
    const s = (0.28 + 0.08 * Math.sin(t * 3 + i * 2) + cast * 0.15) * (1 - dead);
    w.scale.set(s, s, s);
  });
  glow.emissiveIntensity += ((1 + a.fury * 0.5 + cast * 1.2 + Math.sin(t * 2.2) * 0.12) * (1 - 0.8 * dead) - glow.emissiveIntensity) * k(6);
}

function animInsect(c: Ctx) {
  const { rig, j, a, st, dt, k } = c;
  const sc = rig.root.scale.x || 1;
  const vn = st.v / sc;
  const mv = sstep(0.1, 1, vn);
  st.cyc = frac(st.cyc + (st.v * dt) / (0.9 * sc));
  const t = a.t + st.seed;
  const hit = HIT[c.style] ?? 0.667;
  const atk = attackCurves(a, hit);
  const sting = c.style === 'sting' || c.style === 'bite' ? 1 : 0;
  const clawing = 1 - sting;
  const h = st.hurt * st.hurt;
  const dead = a.dead >= 0 ? sstep(0, 0.6, a.dead) : 0;
  const kb = k(12);
  R(rig.body, -0.04 * atk.antic * sting + 0.06 * atk.strike - 0.1 * h, Math.sin(t * 0.7) * 0.03 * (1 - mv), st.hurtSide * 0.1 * h + Math.sin(st.cyc * TAU * 2) * 0.02 * mv, kb);
  P(rig.body, 0, Math.abs(Math.sin(st.cyc * TAU * 2)) * 0.015 * mv - 0.3 * dead + Math.sin(t * 2) * 0.004, 0.12 * atk.strike - 0.06 * atk.antic - 0.06 * h, kb);
  R(rig.head, 0.05 * atk.strike * clawing, 0, 0, kb);
  // Tail curls up in a threat, coils back in the wind-up and whips over to sting.
  const tail = j.tail ?? NONE;
  const sway = Math.sin(t * 1.4) * 0.06;
  tail.forEach((seg, i) => {
    const w = i / (tail.length - 1);
    // Positive pitch curls a segment forward: the base heaves the tail over, the tip straightens to stab.
    const cock = (-0.2 * (1 - w) + 0.12 * w) * atk.antic * sting;
    const stab = (0.5 * (1 - w) - 0.35 * w) * atk.strike * sting;
    const x = cock + stab + Math.sin(t * 2.2 - i * 0.5) * 0.03 - 0.2 * dead * (1 - w) + 0.12 * dead;
    R(seg, x, sway * (1 - w) + Math.sin(t * 1.1 + i) * 0.02, sway * w, k(dead ? 6 : 16));
  });
  // Pincers: held forward and twitching; spread wide when threatening; snap shut on the strike.
  for (const p of j.pincers ?? NONE) {
    const s = p.side;
    const idleSnap = Math.max(0, Math.sin(t * 1.6 + s)) ** 8;
    const spread = 0.35 * atk.antic + 0.1 * sting * atk.strike;
    R(p.arm, -0.1 * atk.antic * clawing + 0.1 * dead, s * (0.2 * spread - 0.15 * atk.strike * clawing), -s * 0.05 * mv * Math.sin(st.cyc * TAU), k(14));
    R(p.fore, 0, s * (0.3 * spread + 0.2 * atk.antic * clawing - 0.5 * atk.strike * clawing), 0, k(14));
    R(p.hand, 0, -s * 0.1 * atk.strike * clawing, 0, k(14));
    const open = 0.5 * atk.antic + 0.3 * idleSnap + 0.15 * (1 - atk.on) * (0.5 + 0.5 * Math.sin(t * 0.8 + s)) - 0.3 * atk.strike;
    R(p.finger, 0, s * Math.max(0, open), 0, k(open > 0.3 ? 14 : 30));
  }
  // Legs ripple in an alternating tetrapod gait.
  animSpiderLegs(c, j.limbs ?? NONE, 0.32, 0.45, mv, dead);
}

/** Many-legged walk: alternating sets with a ripple along each side; legs curl in on death. */
function animSpiderLegs(c: Ctx, limbs: Limb[], swing: number, liftAmt: number, mv: number, dead: number) {
  const { a, st, k } = c;
  const t = a.t + st.seed;
  const kl = k(dead ? 6 : 30);
  limbs.forEach((l, n) => {
    const i = Math.floor(n / 2);
    const s = l.side;
    const set = (i + (s > 0 ? 0 : 1)) % 2;
    const [fwd, up] = stride(frac(st.cyc + set * 0.5 + i * 0.08), 0.55);
    const idle = (1 - mv) * Math.sin(t * 1.3 + n * 1.7) * 0.03;
    const sweep = swing * fwd * mv + idle;
    const lift = liftAmt * up * mv;
    R(l.up, 0, -s * sweep, s * (lift - 0.9 * dead), kl);
    R(l.mid, 0, 0, -s * (0.2 * lift + 1.0 * dead), kl);
    R(l.low, 0, 0, -s * (0.6 * dead), kl);
  });
}

function animCrab(c: Ctx) {
  const { rig, j, a, st, dt, k } = c;
  const sc = rig.root.scale.x || 1;
  const vn = st.v / sc;
  const mv = sstep(0.05, 0.6, vn);
  st.cyc = frac(st.cyc + (st.v * dt) / (1.4 * sc));
  const t = a.t + st.seed;
  const style = c.style;
  const hit = HIT[style] ?? 0.667;
  const atk = attackCurves(a, hit);
  const h = st.hurt * st.hurt;
  const dead = a.dead >= 0 ? sstep(0, 1, a.dead) : 0;
  const fury = a.fury;
  let bodyX = -0.05 * fury, bodyY = Math.sin(t * 1.2) * 0.02 - 0.05 * fury, bodyZ = 0, bodyRoll = Math.sin(st.cyc * TAU * 2) * 0.03 * mv;
  // Claw targets: arm (lift, swing), forearm, hand, finger open.
  const claw = [
    { lift: 0, swing: 0, fore: 0, hand: 0, open: 0.15 + 0.15 * Math.sin(t * 0.9) },
    { lift: 0, swing: 0, fore: 0, hand: 0, open: 0.15 + 0.15 * Math.sin(t * 0.9 + 2) },
  ];
  if (atk.on > 0 || atk.antic > 0) {
    if (style === 'slam') {
      // Both claws high, then smashed down.
      for (const cl of claw) {
        cl.lift = -1.1 * atk.antic + 0.35 * atk.strike + 0.25 * atk.after;
        cl.fore = -0.5 * atk.antic + 0.2 * atk.strike;
        cl.open = 0.6 * atk.antic;
      }
      bodyX = -0.3 * atk.antic + 0.18 * atk.strike;
      bodyY = 0.25 * atk.antic - 0.2 * atk.after;
    } else if (style === 'ring') {
      // Rise on the legs, claws flung wide, then crash down.
      for (const cl of claw) {
        cl.lift = -0.6 * atk.antic;
        cl.swing = 0.9 * atk.antic - 0.2 * atk.strike;
        cl.open = 0.8 * atk.antic;
      }
      bodyY = 0.55 * atk.antic - 0.35 * atk.after;
      bodyX = -0.15 * atk.antic + 0.1 * atk.strike;
    } else if (style === 'sweep') {
      // The great right claw swings wide and sweeps across.
      const cl = claw[0];
      cl.lift = -0.4 * atk.antic - 0.1 * atk.strike;
      cl.swing = 1.0 * atk.antic - 1.1 * atk.strike;
      cl.fore = 0.4 * atk.antic - 0.3 * atk.strike;
      cl.open = 0.7 * atk.antic;
      bodyRoll += -0.1 * atk.antic + 0.12 * atk.strike;
      claw[1].lift = -0.2 * atk.antic;
    } else if (style === 'volley' || style === 'cast' || style === 'summon') {
      // Rear back with claws spread, then spit.
      const pull = env(Math.max(0, a.attack), 0, 0.25, 0.3, 0.45) + atk.antic * 0.3;
      const spit = env(Math.max(0, a.attack), 0.28, 0.35, 0.6, 0.8);
      for (const cl of claw) {
        cl.lift = -0.5 * pull - 0.2 * spit;
        cl.swing = 0.6 * pull + 0.4 * spit;
        cl.open = 0.9 * (pull + spit);
      }
      bodyX = -0.25 * pull + 0.12 * spit;
      bodyZ = -0.1 * pull + 0.05 * spit;
    } else {
      // Pinch: both claws reach and snap.
      for (const cl of claw) {
        cl.lift = -0.3 * atk.antic + 0.1 * atk.strike;
        cl.fore = 0.3 * atk.antic - 0.4 * atk.strike;
        cl.open = 0.9 * atk.antic - 0.2 * atk.strike;
      }
      bodyZ = -0.1 * atk.antic + 0.25 * atk.strike;
    }
  }
  bodyX -= 0.12 * h;
  bodyZ -= 0.12 * h;
  bodyRoll += st.hurtSide * 0.08 * h;
  if (dead) {
    bodyY = -0.9 * dead;
    bodyX = 0.12 * dead;
    bodyRoll = st.deadSide * 0.15 * dead;
    for (const cl of claw) {
      cl.lift = 0.3 * dead;
      cl.swing = -0.3 * dead;
      cl.open = 0.5 * dead;
      cl.fore = 0.4 * dead;
    }
  }
  const kb = k(8);
  R(rig.body, bodyX, 0, bodyRoll, kb);
  P(rig.body, 0, bodyY, bodyZ, kb);
  (j.pincers ?? NONE).forEach((p, i) => {
    const cl = claw[i];
    const s = p.side;
    const kc = k(atk.strike > 0.3 ? 22 : 9);
    R(p.arm, cl.lift, s * cl.swing, 0, kc);
    R(p.fore, cl.fore, 0, 0, kc);
    R(p.hand, cl.hand, 0, 0, kc);
    R(p.finger, -Math.max(0, cl.open), 0, 0, k(cl.open > p.finger.rotation.x ? 12 : 26));
  });
  // Eye stalks swivel on their own; droop on death.
  (j.stalks ?? NONE).forEach((s, i) => R(s, 0.15 * Math.sin(t * 0.7 + i * 2) - 0.2 * atk.antic + 1.2 * dead, 0.3 * Math.sin(t * 0.5 + i * 3.1), 0, k(6)));
  if (j.jaw) R(j.jaw, 0.2 * Math.max(0, Math.sin(t * 6)) + 0.4 * (style === 'volley' ? atk.on : 0), 0, 0, k(14));
  animStrands(c, j.strands ?? NONE, 0.15, mv * 0.3);
  animSpiderLegs(c, j.limbs ?? NONE, 0.25, 0.35, mv, dead);
}

/** Robe tatters, tentacles, hair and seaweed: lagging waves, swept back by motion. */
function animStrands(c: Ctx, strands: THREE.Group[][], amp: number, trail: number, writhe = 0) {
  const { a, st, k } = c;
  const t = a.t + st.seed;
  const kk = k(6);
  strands.forEach((chainJ, i) => {
    chainJ.forEach((seg, n) => {
      const w = Math.sin(t * 2.3 + i * 1.3 - n * 0.9);
      const x = trail * (0.5 + n * 0.3) + amp * w * (n + 1) * 0.5 + writhe * Math.sin(t * 1.7 + i * 2.1 - n * 1.2);
      const z = amp * 0.6 * Math.sin(t * 1.9 + i * 0.7 - n * 1.1) * (n + 1) * 0.5 + writhe * 0.8 * Math.cos(t * 1.3 + i - n * 1.1);
      R(seg, x, 0, z, kk);
    });
  });
}

/** Floaters bob, lean into motion and sag to the ground on death. */
function hover(c: Ctx, height: number, bob: number) {
  const { rig, a, st, k } = c;
  const sc = rig.root.scale.x || 1;
  const mv = sstep(0.1, 1.5, st.v / sc);
  const t = a.t + st.seed;
  const dead = a.dead >= 0 ? sstep(0, 1.2, a.dead) : 0;
  const h = st.hurt * st.hurt;
  const y = Math.sin(t * 1.7) * bob * (1 - dead) - height * dead;
  const kb = k(6);
  R(rig.body, 0.25 * mv - 0.25 * h + 0.5 * dead, Math.sin(t * 0.6) * 0.1 * (1 - mv), Math.sin(t * 1.1) * 0.04 - st.turn * 0.05 + st.hurtSide * 0.15 * h + st.deadSide * 0.3 * dead, kb);
  P(rig.body, 0, y, -0.1 * h, kb);
  HOVER.mv = mv;
  HOVER.t = t;
  HOVER.dead = dead;
  HOVER.h = h;
  return HOVER;
}
const HOVER = { mv: 0, t: 0, dead: 0, h: 0 };

function animWraith(c: Ctx) {
  const { rig, j, a, k } = c;
  const { mv, t, dead } = hover(c, 0.75, 0.12);
  const hit = HIT[c.style] ?? 0.667;
  const atk = attackCurves(a, hit);
  const cast = c.style === 'cast' || c.style === 'volley' ? 1 : 0;
  R(rig.head, -0.15 * atk.antic + 0.2 * atk.strike + 0.4 * dead, Math.sin(t * 0.43) * 0.3 * (1 - atk.on), Math.sin(t * 0.7) * 0.12, k(8));
  if (j.chest) R(j.chest, -0.15 * atk.antic + 0.25 * atk.strike, 0, 0, k(10));
  for (const arm of j.arms ?? NONE) {
    const s = arm.side;
    const drift = Math.sin(t * 1.3 + s * 1.7) * 0.12;
    // Claws rise high behind the head, then rake forward and down.
    const raise = atk.antic * (1 - cast);
    const rake = atk.strike * (1 - cast);
    const reach = (atk.antic + atk.strike) * cast;
    R(arm.up, -0.2 * mv + drift - 2.4 * raise - 0.6 * rake - 1.3 * reach + 0.5 * dead, 0, s * (0.15 + 0.3 * raise - 0.1 * rake + 0.1 * reach), k(12));
    R(arm.mid, -0.4 - 0.6 * raise + 0.3 * rake - 0.2 * reach + Math.sin(t * 2 + s) * 0.1, 0, 0, k(12));
    R(arm.low, 0.2 * raise - 0.5 * rake - 0.4 * reach + Math.sin(t * 3.1 + s) * 0.15, 0, s * 0.2 * reach, k(14));
  }
  animStrands(c, j.strands ?? NONE, 0.12 + 0.05 * atk.on, mv * 0.8 + 0.6 * dead);
  for (const w of j.wisps ?? NONE) {
    const s = (0.5 + 0.06 * Math.sin(t * 11) + 0.04 * Math.sin(t * 27) + 0.3 * (atk.antic + atk.strike)) * (1 - dead);
    w.scale.set(s, s, s);
  }
}

function animEye(c: Ctx) {
  const { rig, j, a, st, dt, k } = c;
  const { mv, dead, h } = hover(c, 1.0, 0.15);
  const hit = HIT[c.style] ?? 0.667;
  const atk = attackCurves(a, hit);
  // Saccades: a new gaze target every second or two; blink every few seconds.
  st.look -= dt;
  if (st.look <= 0) {
    st.look = 0.6 + Math.random() * 1.6;
    st.lookX = (Math.random() - 0.5) * 0.5;
    st.lookY = (Math.random() - 0.5) * 0.8;
  }
  st.blink -= dt;
  if (st.blink < -0.18) st.blink = 2.5 + Math.random() * 4;
  const blink = st.blink < 0 ? Math.sin((-st.blink / 0.18) * Math.PI) : 0;
  const focus = Math.max(atk.antic, atk.strike, mv * 0.5);
  if (j.iris) R(j.iris, st.lookX * (1 - focus), st.lookY * (1 - focus), 0, k(st.look > 0.5 ? 25 : 18));
  // The slit pupil narrows as it glares and widens when hurt.
  if (j.pupil) j.pupil.scale.x += (1 - 0.6 * Math.max(atk.antic, atk.strike) + 0.8 * h - j.pupil.scale.x) * k(10);
  // Lids: half-lidded idle, wide open when it glares, shut on blink, hurt or death.
  const close = Math.max(blink, 0.6 * h, dead);
  const lid = 0.16 * (1 - focus) + 0.05 * focus - 0.25 * Math.max(atk.antic, atk.strike);
  (j.lids ?? NONE).forEach((l, i) => R(l, (i === 0 ? 1 : -1) * (lid + (0.9 - lid) * close), 0, 0, k(close > 0.3 ? 30 : 12)));
  R(rig.head, -0.2 * atk.antic + 0.25 * atk.strike, 0, 0, k(10));
  P(rig.head, 0, 0, -0.15 * atk.antic + 0.3 * atk.strike, k(12));
  animStrands(c, j.strands ?? NONE, 0.1, mv * 0.6 + dead * 0.4, 0.22 + 0.25 * atk.on);
}

const FACES = [0, -2.1, 2.1];

function animWitch(c: Ctx) {
  const { rig, j, a, k } = c;
  const { mv, t, dead } = hover(c, 1.1, 0.1);
  const style = c.style;
  const hit = HIT[style] ?? 0.667;
  const atk = attackCurves(a, hit);
  // The three faces take turns: every few seconds the head turns another one forward.
  const turnTo = atk.on > 0 ? 0 : FACES[Math.floor((t / 7) % 3)];
  const fury = a.fury;
  R(rig.head, -0.1 * atk.antic + 0.15 * atk.strike, turnTo, Math.sin(t * 0.5) * 0.08, k(2.5));
  const arms = j.arms ?? NONE;
  const right = arms[0], left = arms[1];
  let rUp = -0.15, rUpZ = 0, rMid = -0.5, lUp = -0.1, lUpZ = 0, lMid = -0.6, chestX = 0, chestY = 0;
  const sweep = style === 'sweep', slam = style === 'slam' || style === 'ring', summon = style === 'summon', tele = style === 'teleport';
  if (atk.on > 0 || atk.antic > 0) {
    if (sweep) {
      chestY = 0.5 * atk.antic - 0.7 * atk.strike;
      rUp = -0.9 * atk.antic - 1.2 * atk.strike;
      rUpZ = -0.9 * atk.antic + 0.6 * atk.strike;
      rMid = -0.3;
      lUp = -0.4 * atk.strike;
    } else if (slam) {
      rUp = -2.6 * atk.antic - 0.9 * atk.strike;
      lUp = -2.4 * atk.antic - 0.7 * atk.strike;
      rMid = -0.2;
      lMid = -0.2;
      chestX = -0.25 * atk.antic + 0.3 * atk.strike;
    } else if (summon) {
      const up = env(Math.max(0, a.attack), 0, 0.4, 0.85, 1);
      rUp = -1.2 * up;
      lUp = -1.2 * up;
      rUpZ = -0.9 * up;
      lUpZ = 0.9 * up;
      chestX = -0.3 * up;
    } else {
      // Cast / volley: staff thrust forward, the other hand flung back.
      const pull = env(Math.max(0, a.attack), 0, 0.25, 0.3, 0.4) + atk.antic * 0.5;
      const push = env(Math.max(0, a.attack), 0.28, 0.35, 0.7, 0.9) + atk.strike * 0.5;
      rUp = -0.4 * pull - 1.4 * push;
      rMid = -0.6 * pull + 0.1 * push;
      lUp = -0.8 * pull + 0.3 * push;
      lUpZ = 0.6 * pull;
      chestX = -0.15 * pull + 0.15 * push;
    }
  }
  if (tele) S(rig.body, 1 - 0.7 * sstep(0, 0.4, Math.max(0, a.attack, a.windup)), k(14));
  else S(rig.body, 1 - 0.3 * dead, k(8));
  if (j.chest) R(j.chest, chestX - 0.05 * fury, chestY, 0, k(10));
  if (right) {
    R(right.up, rUp + Math.sin(t * 0.9) * 0.05 + 0.5 * dead, 0, rUpZ, k(10));
    R(right.mid, rMid, 0, 0, k(10));
    R(right.low, 0.4, 0, 0, k(10));
  }
  if (left) {
    R(left.up, lUp + Math.sin(t * 1.1 + 1) * 0.05 + 0.5 * dead, 0, lUpZ, k(10));
    R(left.mid, lMid, 0, 0, k(10));
    R(left.low, 0.3, 0, 0, k(10));
  }
  animStrands(c, j.strands ?? NONE, 0.1 + 0.1 * (summon ? atk.on : 0), mv * 0.8 + dead * 0.5);
  if (j.glow) j.glow.emissiveIntensity += ((1 + fury * 0.6 + (summon || slam ? atk.on : 0) * 1.5 + Math.sin(t * 3) * 0.1) * (1 - dead) - j.glow.emissiveIntensity) * k(6);
  for (const w of j.wisps ?? NONE) {
    const s = (0.5 + 0.08 * Math.sin(t * 9 + w.id) + 0.05 * Math.sin(t * 23 + w.id) + (summon ? 0.4 * atk.on : 0)) * (1 - dead);
    w.scale.set(s, s * 1.3, s);
  }
}

function animImp(c: Ctx) {
  const { rig, j, a, st, k } = c;
  const sc = rig.root.scale.x || 1;
  const mv = sstep(0.2, 2.5, st.v / sc);
  const t = a.t + st.seed;
  const dead = a.dead >= 0 ? sstep(0, 0.7, a.dead) : 0;
  const h = st.hurt * st.hurt;
  const hit = HIT[c.style] ?? 0.667;
  const atk = attackCurves(a, hit);
  const flapRate = 11 + 3 * mv;
  const beat = Math.sin(t * flapRate);
  // Hovers with each wing beat; falls when slain.
  const bodyY = beat * 0.04 * (1 - dead) - 0.55 * dead;
  const kb = k(10);
  R(rig.body, 0.35 * mv - 0.3 * h + 0.15 * atk.strike - 0.1 * atk.antic - 1.3 * dead, -0.6 * atk.antic + 0.6 * atk.strike, -st.turn * 0.08 + st.hurtSide * 0.3 * h, kb);
  P(rig.body, 0, bodyY, -0.1 * h, kb);
  if (j.chest) R(j.chest, 0.1 * Math.sin(t * flapRate - 1) * 0.3, 0, 0, kb);
  R(rig.head, -0.25 * mv + Math.sin(t * 0.8) * 0.1 - 0.2 * h, Math.sin(t * 0.6) * 0.3 * (1 - atk.on), Math.sin(t * 1.3) * 0.1, k(12));
  if (j.jaw) R(j.jaw, 0.1 + 0.4 * atk.strike + 0.2 * Math.max(0, Math.sin(t * 2.3)) ** 4 + 0.4 * h, 0, 0, k(18));
  const arms = j.arms ?? NONE;
  for (const arm of arms) {
    const s = arm.side;
    const throwing = s < 0;
    const back = throwing ? atk.antic : 0;
    const fling = throwing ? atk.strike : 0;
    R(arm.up, -0.3 - 2.4 * back + 1.0 * fling - 0.6 * mv + Math.sin(t * 2 + s) * 0.1 + (throwing ? 0 : -0.5 * atk.antic) + 0.8 * dead, 0, s * (0.2 + 0.3 * back + 0.4 * dead), k(16));
    R(arm.mid, -0.6 - 1.0 * back + 0.7 * fling, 0, 0, k(16));
    R(arm.low, -0.2 + 0.3 * fling, 0, 0, k(16));
  }
  for (const l of j.limbs ?? NONE) {
    const kick = Math.sin(t * 5 + (l.side > 0 ? 0 : Math.PI)) * 0.25 * (0.3 + mv);
    R(l.up, 0.2 + 0.5 * mv + kick - 0.6 * dead, 0, l.side * 0.1, k(10));
    R(l.mid, 0.6 + 0.3 * mv, 0, 0, k(10));
    R(l.low, -0.6 - 0.2 * kick, 0, 0, k(10));
  }
  const tail = j.tail ?? NONE;
  tail.forEach((s, i) => R(s, -0.1 + 0.25 * mv + 0.1 * Math.sin(t * 3 - i), Math.sin(t * 2.2 - i * 0.7) * 0.35, 0, k(8)));
  for (const w of j.wings ?? NONE) animWing(c, w, dead ? 0 : 1, dead ? 0.8 : 0, flapRate);
}
