// Models made in Blender (see blender/*.py), loaded once before the world is
// built. Each comes out by name as a fresh copy that shares its geometry and
// materials with every other copy. Anything missing (an offline single-file
// copy, a failed download) falls back to the models built in code.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import weaponsUrl from '../assets/weapons.glb?url';
import creaturesUrl from '../assets/creatures.bin?url';

const models = new Map<string, THREE.Object3D>();
let loading: Promise<void> | null = null;

/** A creature surface remodelled in Blender (blender/creatures.py), ready to bind to the game's own skeleton. */
export interface BlendSurface {
  pos: Float32Array;
  nrm: Int8Array;
  ao: Uint8Array;
  /** The vertex of the game's own surface whose colour this vertex takes. */
  src: Uint16Array | Uint32Array;
  si: Uint8Array;
  sw: Uint8Array;
  idx: Uint16Array | Uint32Array;
}

interface BlendCreature {
  bones: number;
  bind: number[][];
  surfaces: Map<string, BlendSurface>;
}

const creatures = new Map<string, BlendCreature>();

/** Reads creatures.bin: 'MBC2', a JSON header, then each surface's arrays in turn. */
function readCreatures(buf: ArrayBuffer) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x3243424d) throw new Error('not a creatures file');
  const hl = dv.getUint32(4, true);
  const heads = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl))) as {
    kind: string; bones: number; bind: number[][]; surfaces: { surf: string; verts: number; tris: number; big: boolean; bytes: number; box: number[] }[];
  }[];
  let off = 8 + hl;
  const take = (n: number) => buf.slice(off, (off += n));
  for (const h of heads) {
    const surfaces = new Map<string, BlendSurface>();
    for (const s of h.surfaces) {
      const nv = s.verts;
      const wide = s.big ? 4 : 2;
      // Positions come quantized to 16 bits within the surface's box.
      const q = new Uint16Array(take(nv * 6));
      const pos = new Float32Array(nv * 3);
      const [x0, y0, z0, x1, y1, z1] = s.box;
      const lo = [x0, y0, z0], span = [x1 - x0, y1 - y0, z1 - z0];
      for (let i = 0; i < nv * 3; i++) pos[i] = lo[i % 3] + (q[i] / 65535) * span[i % 3];
      surfaces.set(s.surf, {
        pos,
        nrm: new Int8Array(take(nv * 3)),
        ao: new Uint8Array(take(nv)),
        src: s.big ? new Uint32Array(take(nv * wide)) : new Uint16Array(take(nv * wide)),
        si: new Uint8Array(take(nv * 4)),
        sw: new Uint8Array(take(nv * 4)),
        idx: s.big ? new Uint32Array(take(s.tris * 3 * wide)) : new Uint16Array(take(s.tris * 3 * wide)),
      });
    }
    creatures.set(h.kind, { bones: h.bones, bind: h.bind, surfaces });
  }
}

/**
 * A creature surface remodelled in Blender, if there is one for this body and
 * it was made over this very skeleton (same bones, same bind pose).
 */
export function blendCreature(kind: string, surf: string, bones: THREE.Object3D[]): BlendSurface | null {
  const c = creatures.get(kind);
  const s = c?.surfaces.get(surf);
  if (!c || !s) return null;
  const v = new THREE.Vector3();
  const same = c.bones === bones.length && c.bind.every((w, i) => bones[i].getWorldPosition(v).distanceTo(new THREE.Vector3(...w)) <= 0.01);
  if (!same) {
    // Remodelled over a skeleton that has since changed: the body as built in code.
    blendMisses.add(`${kind}/${surf}`);
    return null;
  }
  return s;
}

/** Bodies whose Blender remodel no longer fits their skeleton (shown by tests and the dev console). */
export const blendMisses = new Set<string>();

/** Loads every Blender model (at most once). Never rejects: what fails to load is simply left out. */
export function loadAssets(): Promise<void> {
  loading ??= Promise.all([loadWeapons(), loadCreatures()]).then(() => {});
  return loading;
}

function loadCreatures(): Promise<void> {
  return fetch(creaturesUrl)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then(readCreatures)
    .catch((err) => console.warn('Blender creatures not loaded; using the built-in ones.', err));
}

function loadWeapons(): Promise<void> {
  return new GLTFLoader()
    .loadAsync(weaponsUrl)
    .then((gltf) => {
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
    })
    .catch((err) => console.warn('Blender models not loaded; using the built-in ones.', err));
}

/** A copy of the Blender model with this name, or null if there is none. */
export function blendModel(name: string): THREE.Object3D | null {
  const m = models.get(name);
  return m ? m.clone() : null;
}

/** A Blender surface as a skinned geometry, coloured from the game's own surface (so every colour of a creature works) and shaded by its baked occlusion. */
export function blendGeometry(b: BlendSurface, own: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = b.ao.length;
  const from = own.attributes.color;
  const cs = from.itemSize;
  const col = new Float32Array(n * cs);
  for (let i = 0; i < n; i++) {
    const k = b.ao[i] / 255;
    const s = b.src[i];
    for (let c = 0; c < 3; c++) col[i * cs + c] = from.getComponent(s, c) * k;
    if (cs === 4) col[i * cs + 3] = from.getComponent(s, 3);
  }
  const nrm = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) nrm[i] = b.nrm[i] / 127;
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) sw[i] = b.sw[i] / 255;
  g.setAttribute('position', new THREE.BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, cs));
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
