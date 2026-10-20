// Models made in Blender (see blender/*.py), loaded once before the world is
// built. Each comes out by name as a fresh copy that shares its geometry and
// materials with every other copy. Anything missing (an offline single-file
// copy, a failed download) falls back to the models built in code.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import weaponsUrl from '../assets/weapons.glb?url';
import creaturesUrl from '../assets/creatures.bin.gz?url';
import worldUrl from '../assets/world.bin.gz?url';

const models = new Map<string, THREE.Object3D>();
let loading: Promise<void> | null = null;

/**
 * A creature surface modelled in Blender (blender/beasts.py), ready to bind
 * to the game's own skeleton. Its vertices carry colour slots the
 * creature's own colour fills in (see blendGeometry).
 */
export interface BlendSurface {
  pos: Float32Array;
  nrm: Int8Array;
  si: Uint8Array;
  sw: Uint8Array;
  idx: Uint16Array | Uint32Array;
  /** Colour slot, shade (occlusion and markings), fixed colour. */
  slot: Uint8Array;
  shade: Uint8Array;
  rgb: Uint8Array;
}

export interface BlendCreature {
  bones: number;
  bind: number[][];
  /** The game's own surfaces this model replaces (dropped even where it brings none of its own). */
  replace: string[];
  surfaces: Map<string, BlendSurface>;
}

const creatures = new Map<string, BlendCreature>();

type SurfaceHead = { surf: string; verts: number; tris: number; big: boolean; bytes: number; box: number[] };

/** Reads creatures.bin: 'MBC3', a JSON header, then each surface's arrays in turn. */
function readCreatures(buf: ArrayBuffer) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x3343424d) throw new Error('not a creatures file');
  const hl = dv.getUint32(4, true);
  const heads = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl))) as { kind: string; bones: number; bind: number[][]; replace?: string[]; surfaces: SurfaceHead[] }[];
  let off = 8 + hl;
  const take = (n: number) => buf.slice(off, (off += n));
  for (const h of heads) {
    const surfaces = new Map<string, BlendSurface>();
    for (const s of h.surfaces) {
      const nv = s.verts;
      const wide = s.big ? 4 : 2;
      const start = off;
      // Positions come quantized to 16 bits within the surface's box.
      const q = new Uint16Array(take(nv * 6));
      const pos = new Float32Array(nv * 3);
      const [x0, y0, z0, x1, y1, z1] = s.box;
      const lo = [x0, y0, z0], span = [x1 - x0, y1 - y0, z1 - z0];
      for (let i = 0; i < nv * 3; i++) pos[i] = lo[i % 3] + (q[i] / 65535) * span[i % 3];
      const nrm = new Int8Array(take(nv * 3));
      const slot = new Uint8Array(take(nv));
      const shade = new Uint8Array(take(nv));
      const rgb = new Uint8Array(take(nv * 3));
      const si = new Uint8Array(take(nv * 4));
      const sw = new Uint8Array(take(nv * 4));
      const idx = s.big ? new Uint32Array(take(s.tris * 3 * wide)) : new Uint16Array(take(s.tris * 3 * wide));
      off = start + s.bytes;
      surfaces.set(s.surf, { pos, nrm, si, sw, idx, slot, shade, rgb });
    }
    creatures.set(h.kind, { bones: h.bones, bind: h.bind, replace: h.replace ?? [...surfaces.keys()], surfaces });
  }
}

/**
 * The Blender model for a body, if there is one and it was made over this
 * very skeleton (same bones, same bind pose).
 */
export function blendBody(kind: string, bones: THREE.Object3D[]): BlendCreature | null {
  const c = creatures.get(kind);
  if (!c) return null;
  const v = new THREE.Vector3();
  const same = c.bones === bones.length && c.bind.every((w, i) => bones[i].getWorldPosition(v).distanceTo(new THREE.Vector3(...w)) <= 0.01);
  if (!same) {
    // Modelled over a skeleton that has since changed: the body as built in code.
    blendMisses.add(kind);
    return null;
  }
  return c;
}

/** Bodies whose Blender model no longer fits their skeleton (shown by tests and the dev console). */
export const blendMisses = new Set<string>();

/** Loads every Blender model (at most once). Never rejects: what fails to load is simply left out. */
export function loadAssets(): Promise<void> {
  loading ??= Promise.all([loadWeapons(), loadCreatures(), loadWorld()]).then(() => {
    settled = true;
  });
  return loading;
}

let settled = false;
/** Each model file's bytes so far, and in all (-1 while not known: the server hasn't said, or won't). */
const downloads: { got: number; size: number }[] = [];

/** How far the models' download has got, in bytes (total 0 while not yet known), and whether it's over. */
export function assetProgress(): { loaded: number; total: number; done: boolean } {
  let loaded = 0, total = 0;
  for (const d of downloads) {
    loaded += d.got;
    total = d.size >= 0 && total >= 0 ? total + d.size : -1;
  }
  return { loaded, total: Math.max(0, total), done: settled };
}

/** A file's bytes, counted as they come in (see assetProgress). */
async function download(url: string): Promise<ArrayBuffer> {
  const d = { got: 0, size: -1 };
  downloads.push(d);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    // A length is only the file's own when the server didn't compress it on the way.
    d.size = r.headers.get('content-encoding') ? -1 : Number(r.headers.get('content-length')) || -1;
    if (!r.body) return await r.arrayBuffer();
    const reader = r.body.getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      d.got += value.length;
    }
    const out = new Uint8Array(d.got);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out.buffer;
  } finally {
    d.size = d.got;
  }
}

let held = false;
const kept: (() => void)[] = [];
/** Puts a model that arrived into use, or keeps it for the next game while one runs (see holdAssets). */
function arrive(use: () => void) {
  if (held) kept.push(use);
  else use();
}

/**
 * While a game runs, models that arrive (on a slow connection the game may
 * start without them) wait for the next one, so a world never mixes the
 * built-in models and the Blender ones.
 */
export function holdAssets(hold: boolean) {
  held = hold;
  if (hold) return;
  for (const use of kept.splice(0)) {
    try {
      use();
    } catch (err) {
      console.warn('Blender models not loaded; using the built-in ones.', err);
    }
  }
}

/**
 * A gzipped file, unpacked (the model files are stored gzipped: half the
 * download). Some servers unpack it on the way (sending it with a gzip
 * encoding); what arrives still packed is unpacked here.
 */
function fetchGzipped(url: string): Promise<ArrayBuffer> {
  return download(url)
    .then((buf) => {
      const head = new Uint8Array(buf, 0, 2);
      if (head[0] !== 0x1f || head[1] !== 0x8b) return buf;
      if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('no DecompressionStream'));
      return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    });
}

/** 'MBPK': a creatures or scenery file the build packed (see scripts/pack-models.mjs). */
const PACKED = 0x4b50424d;

/**
 * A model file as Blender wrote it. The build packs them: each model's (or
 * surface's) positions and triangle indices delta-coded and split into byte
 * planes, which gzip squeezes far better. This undoes that, finding them from
 * the header just as scripts/pack-models.mjs does.
 */
export function unpack(buf: ArrayBuffer): ArrayBuffer {
  if (buf.byteLength < 4 || new DataView(buf).getUint32(0, true) !== PACKED) return buf;
  const out = new Uint8Array(buf.slice(4));
  const hl = new DataView(out.buffer).getUint32(4, true);
  type Block = { verts: number; tris: number; big: boolean; bytes: number; surfaces?: Block[] };
  const heads = JSON.parse(new TextDecoder().decode(out.subarray(8, 8 + hl))) as Block[];
  let off = 8 + hl;
  for (const b of heads.flatMap((h) => (Array.isArray(h.surfaces) ? h.surfaces : [h]))) {
    const w = b.big ? 4 : 2;
    decode(out, off, b.verts * 3, 2, 3);
    decode(out, off + b.bytes - b.tris * 3 * w, b.tris * 3, w, 1);
    off += b.bytes;
  }
  return out.buffer;
}

/** Byte planes back to values (u16 or u32), each the zigzagged change from the one `stride` before. */
function decode(buf: Uint8Array, at: number, count: number, w: 2 | 4, stride: number) {
  const vals = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    let zz = 0;
    for (let k = 0; k < w; k++) zz |= buf[at + k * count + i] << (8 * k);
    zz >>>= 0;
    const d = (zz >>> 1) ^ -(zz & 1);
    const p = i >= stride ? vals[i - stride] : 0;
    vals[i] = w === 2 ? (p + d) & 0xffff : (p + d) >>> 0;
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < count; i++) {
    if (w === 2) dv.setUint16(at + i * 2, vals[i], true);
    else dv.setUint32(at + i * 4, vals[i], true);
  }
}

function loadCreatures(): Promise<void> {
  return fetchGzipped(creaturesUrl)
    .then((buf) => arrive(() => readCreatures(unpack(buf))))
    .catch((err) => console.warn('Blender creatures not loaded; using the built-in ones.', err));
}

function loadWorld(): Promise<void> {
  return fetchGzipped(worldUrl)
    .then((buf) => arrive(() => readWorld(unpack(buf))))
    .catch((err) => console.warn('Blender scenery not loaded; using the built-in one.', err));
}

/**
 * A piece of scenery modelled in Blender (blender/world.py): its vertices'
 * colours (occlusion baked in), the colour slot each takes from its
 * placement (0 for none), and for plants how much the land tints it and
 * how much it glows.
 */
export interface WorldMesh {
  pos: Float32Array;
  nrm: Float32Array;
  rgb: Uint8Array;
  slot: Uint8Array;
  tint: Uint8Array;
  glow: Uint8Array;
  idx: Uint16Array | Uint32Array;
}

const scenery = new Map<string, WorldMesh>();

/** Reads world.bin: 'MBW1', a JSON header, then each model's arrays in turn. */
function readWorld(buf: ArrayBuffer) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x3157424d) throw new Error('not a world file');
  const hl = dv.getUint32(4, true);
  const heads = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl))) as { name: string; verts: number; tris: number; big: boolean; bytes: number; box: number[] }[];
  let off = 8 + hl;
  const take = (n: number) => buf.slice(off, (off += n));
  for (const h of heads) {
    const nv = h.verts;
    const start = off;
    const q = new Uint16Array(take(nv * 6));
    const pos = new Float32Array(nv * 3);
    const [x0, y0, z0, x1, y1, z1] = h.box;
    const lo = [x0, y0, z0], span = [x1 - x0, y1 - y0, z1 - z0];
    for (let i = 0; i < nv * 3; i++) pos[i] = lo[i % 3] + (q[i] / 65535) * span[i % 3];
    const n8 = new Int8Array(take(nv * 3));
    const nrm = new Float32Array(nv * 3);
    for (let i = 0; i < nv * 3; i++) nrm[i] = n8[i] / 127;
    const rgb = new Uint8Array(take(nv * 3));
    const slot = new Uint8Array(take(nv));
    const tint = new Uint8Array(take(nv));
    const glow = new Uint8Array(take(nv));
    const idx = h.big ? new Uint32Array(take(h.tris * 12)) : new Uint16Array(take(h.tris * 6));
    off = start + h.bytes;
    scenery.set(h.name, { pos, nrm, rgb, slot, tint, glow, idx });
  }
}

/** The Blender model of a piece of scenery, or null if there is none. */
export function worldMesh(name: string): WorldMesh | null {
  return scenery.get(name) ?? null;
}

const _srgb = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/**
 * A piece of scenery as geometry: position, normal and colour (each slot's
 * vertices tinted by `slots[slot]`, a hex colour). Each call makes a fresh copy.
 */
export function worldGeometry(m: WorldMesh, slots: number[] = []): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = m.pos.length / 3;
  const col = new Float32Array(n * 3);
  const tints = slots.map((h) => [_srgb[(h >> 16) & 255], _srgb[(h >> 8) & 255], _srgb[h & 255]]);
  for (let i = 0; i < n; i++) {
    const t = m.slot[i] ? tints[m.slot[i] - 1] : undefined;
    for (let c = 0; c < 3; c++) col[i * 3 + c] = _srgb[m.rgb[i * 3 + c]] * (t ? t[c] : 1);
  }
  g.setAttribute('position', new THREE.BufferAttribute(m.pos.slice(), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.nrm.slice(), 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(m.idx, 1));
  return g;
}

function loadWeapons(): Promise<void> {
  // The build ships the .glb gzipped (see scripts/pack-models.mjs).
  return fetchGzipped(weaponsUrl)
    .then((buf) => new GLTFLoader().parseAsync(buf, ''))
    .then((gltf) => arrive(() => {
      for (const o of [...gltf.scene.children]) {
        o.traverse((m) => {
          if ((m as THREE.Mesh).isMesh) {
            m.castShadow = true;
            m.receiveShadow = false;
            // Copies share this geometry: compact() must not merge it, nor disposeObject() free it.
            m.userData.keep = true;
            m.userData.shared = true;
          }
        });
        o.position.set(0, 0, 0);
        models.set(o.name, o);
      }
    }))
    .catch((err) => console.warn('Blender models not loaded; using the built-in ones.', err));
}

/** A copy of the Blender model with this name, or null if there is none. */
export function blendModel(name: string): THREE.Object3D | null {
  const m = models.get(name);
  return m ? m.clone() : null;
}

const _base = new THREE.Color();
const _c = new THREE.Color();

/**
 * A Blender surface as a skinned geometry, coloured from the creature's
 * colour (its own, a pale belly colour, a dark marking colour, or a fixed
 * one) times its baked shade.
 */
export function blendGeometry(b: BlendSurface, colour = 0x808080, glow = false): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = b.pos.length / 3;
  const col = new Float32Array(n * 3);
  _base.setHex(colour);
  const light = _base.clone().lerp(new THREE.Color(0xeadcc4), 0.6);
  const dark = _base.clone().multiplyScalar(0.42);
  for (let i = 0; i < n; i++) {
    const slot = b.slot[i];
    if (slot === 0) _c.copy(_base);
    else if (slot === 1) _c.copy(light);
    else if (slot === 2) _c.copy(dark);
    else _c.setRGB(b.rgb[i * 3] / 255, b.rgb[i * 3 + 1] / 255, b.rgb[i * 3 + 2] / 255, THREE.SRGBColorSpace);
    // Glow is pure colour (it lights itself); the rest is shaded.
    if (!glow) _c.multiplyScalar(b.shade[i] / 255);
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  const nrm = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) nrm[i] = b.nrm[i] / 127;
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) sw[i] = b.sw[i] / 255;
  g.setAttribute('position', new THREE.BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(b.si), 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(b.idx, 1));
  return g;
}

/** The name a humanoid look's Blender remodel goes by (a short hash of its look). */
export function humanoidKey(look: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < look.length; i++) h = Math.imul(h ^ look.charCodeAt(i), 0x01000193) >>> 0;
  return `h-${h.toString(16).padStart(8, '0')}`;
}
