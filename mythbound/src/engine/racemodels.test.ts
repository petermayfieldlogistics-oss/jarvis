import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ClassId, RaceId, SubclassId } from '../data/defs';
import { buildPlayerRig } from './player';

const RACES: RaceId[] = ['human', 'elf', 'draco', 'orc', 'angelic', 'zombie', 'ancient'];
const CLASSES: [ClassId, SubclassId | null][] = [
  ['warrior', null], ['ranger', null], ['mage', null], ['monk', null], ['monk', 'windwalker'], ['sorcerer', null], ['sorcerer', 'lightmage'], ['rogue', null], ['rogue', 'duelist'],
];

const hero = (raceId: RaceId, classId: ClassId, subclassId: SubclassId | null) => buildPlayerRig({ raceId, classId, subclassId, roleId: 'historian', hunched: true });

const meshes = (root: THREE.Object3D) => {
  const out: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh);
  });
  return out;
};

describe('race models', () => {
  it('every race in every class builds within a phone-friendly budget, in at most three draw calls', () => {
    for (const race of RACES) {
      for (const [cls, sub] of CLASSES) {
        const rig = hero(race, cls, sub);
        expect(rig.root.userData.tris, `${race} ${cls} ${sub}`).toBeLessThan(8000);
        expect(meshes(rig.root).length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('builds clean geometry: finite points and normals, every vertex fully bound to a bone', () => {
    for (const race of RACES) {
      const rig = hero(race, 'monk', null);
      for (const m of meshes(rig.root)) {
        const g = m.geometry;
        const pos = g.attributes.position.array;
        const nor = g.attributes.normal.array;
        for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i]) && Number.isFinite(nor[i]), race).toBe(true);
        const sw = g.attributes.skinWeight;
        const si = g.attributes.skinIndex;
        for (let i = 0; i < sw.count; i++) {
          expect(Math.abs(sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i) - 1)).toBeLessThan(1e-4);
          expect(si.getX(i)).toBeLessThan(m.skeleton.bones.length);
        }
      }
    }
  });

  it('keeps the gameplay parts: draco wings and tail, angel wings and halo', () => {
    const draco = hero('draco', 'warrior', null);
    expect(draco.wings).toBeDefined();
    expect(draco.tail).toBeDefined();
    const angel = hero('angelic', 'mage', null);
    expect(angel.wings?.userData.feather).toBe(true);
    let halo = false;
    angel.head.traverse((o) => (halo ||= o !== angel.head && o.userData.y !== undefined));
    expect(halo).toBe(true);
  });

  it('gives each race its own model (the look cache keys on every race cue)', () => {
    const tris = RACES.map((r) => hero(r, 'monk', null).root.userData.tris);
    expect(new Set(tris).size).toBe(RACES.length);
  });
});
