// Writes each creature's skeleton and skin (as built in code) to
// blender/rigs/<kind>.json, for blender/creatures.py to remodel.
//   npx vite-node scripts/dump-creatures.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

// Glow sprites draw on a canvas; a stand-in is enough here.
const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const C = await import('../src/engine/creatures');
const H = await import('../src/engine/humanoid');
const E = await import('../src/engine/entities');
const W = await import('../src/data/world');
const { humanoidKey } = await import('../src/engine/assets');
type Rig = ReturnType<typeof C.buildQuad>;

/** Every creature body, by the name the game knows it by. */
export const KINDS: Record<string, () => Rig> = {
  wolf: () => C.buildQuad(0x5d5852, 'wolf'),
  hound: () => C.buildQuad(0x3a2018, 'hound'),
  boar: () => C.buildQuad(0x5a3f2b, 'boar'),
  stag: () => C.buildQuad(0x4a4232, 'stag', 1),
  drake: () => C.buildQuad(0x4a2a24, 'drake'),
  insect: () => C.buildInsect(0x7a5a32),
  wraith: () => C.buildFloater(0x6c6290, 'wraith'),
  eye: () => C.buildFloater(0x2a2030, 'eye'),
  witch: () => C.buildFloater(0x2a2030, 'witch', 1),
  imp: () => C.buildImp(0xb0401c),
  crab: () => C.buildCrab(0x2a6a7a, 1),
  serpent: () => C.buildSerpent(0x2a5a6a, 1),
  dragon: () => C.buildDragon(0x6a2a1a, 1),
  siren: () => C.buildSiren(0x3a7a8a, 1),
  reaper: () => C.buildReaper(0x15131a, 1),
  spider: () => C.buildSpider(0x2a221c, 1),
};

// The humanoid monsters and great foes: build each once, then dump every look that was made.
for (const def of Object.values(W.ENEMIES)) if (def.body === 'humanoid') E.enemyModel(def);
for (const def of Object.values(W.BOSSES)) if (['colossus', 'golem', 'champion'].includes(def.model)) E.bossModel(def);
for (const [key, rig] of H.humanoidTemplates()) KINDS[humanoidKey(key)] = () => rig as unknown as Rig;

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'blender', 'rigs');
mkdirSync(out, { recursive: true });
const round = (a: ArrayLike<number>, k = 1e4) => Array.from(a, (v) => Math.round(v * k) / k);
for (const [kind, build] of Object.entries(KINDS)) {
  const rig = build();
  rig.root.scale.setScalar(1);
  rig.root.updateMatrixWorld(true);
  let bones: THREE.Object3D[] | null = null;
  const surfaces: Record<string, unknown> = {};
  rig.root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    // The ink outline is drawn from the parts as they are; it is not remodelled.
    if (!m.isSkinnedMesh || !m.geometry.attributes.color) return;
    bones ??= m.skeleton.bones;
    const g = m.geometry;
    surfaces[m.name] = {
      pos: round(g.attributes.position.array),
      nrm: round(g.attributes.normal.array, 1e3),
      col: round(g.attributes.color.array, 1e3),
      cs: g.attributes.color.itemSize,
      si: Array.from(g.attributes.skinIndex.array),
      sw: round(g.attributes.skinWeight.array, 1e3),
      idx: Array.from(g.index!.array),
    };
  });
  const list = bones as THREE.Object3D[] | null;
  if (!list) continue;
  const data = {
    kind,
    // Bind-pose positions in the creature's own space (its root is unscaled and unmoved here).
    bones: list.map((b) => ({ parent: list.indexOf(b.parent as THREE.Object3D), w: round(b.getWorldPosition(new THREE.Vector3()).toArray()) })),
    surfaces,
  };
  writeFileSync(join(out, `${kind}.json`), JSON.stringify(data));
  const verts = Object.values(surfaces).reduce((n: number, s) => n + (s as { pos: number[] }).pos.length / 3, 0);
  console.log(kind, list.length, 'bones', Object.keys(surfaces).join('+'), verts, 'verts');
}
