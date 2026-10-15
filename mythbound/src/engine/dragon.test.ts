import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { animateCreature, buildDragon } from './creatures';
import { newAnim, type AttackStyle } from './anim';
import { BOSSES } from '../data/world';

const def = BOSSES['elder-dragon'];
const at = (o: THREE.Object3D) => (o.userData.w as THREE.Vector3).toArray().map((v) => Math.round(v * 1000) / 1000);

describe('the Elder Dragon model', () => {
  it('keeps the joints (and their places) that its moves drive', () => {
    const rig = buildDragon(def.color, def.scale);
    const j = rig.j!;
    expect(rig.kind).toBe('dragon');
    expect(j.neck).toHaveLength(5);
    expect(j.tail).toHaveLength(9);
    expect(j.limbs).toHaveLength(4);
    for (const l of j.limbs!) expect(l.ik).toBeDefined();
    expect(j.wings).toHaveLength(2);
    for (const w of j.wings!) expect(w.fingers).toHaveLength(4);
    expect(j.glow).toBeDefined();
    // The breath leaves from the jaw, and the flight and strikes are posed about these joints.
    expect(at(rig.body)).toEqual([0, 1.35, 0]);
    expect(at(j.chest!)).toEqual([0, 1.41, 0.55]);
    expect(at(j.hips!)).toEqual([0, 1.35, -0.65]);
    expect(at(rig.head)).toEqual([0, 2.68, 2.02]);
    expect(at(j.jaw!)).toEqual([0, 2.61, 2.12]);
    expect(at(j.wings![1].hand)).toEqual([2.45, 2.35, 0.52]);
    expect(at(j.tail![8])).toEqual([0, 0.711, -4.717]);
  });

  it('stays cheap enough for phones: few draw calls, well under 25k triangles', () => {
    const rig = buildDragon(def.color, def.scale);
    let tris = 0, meshes = 0;
    const mats = new Set<THREE.Material>();
    rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++;
      mats.add(m.material as THREE.Material);
      tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    });
    expect(meshes).toBeLessThanOrEqual(4);
    expect(mats.size).toBeLessThanOrEqual(4);
    expect(tris).toBeLessThan(15000);
  });

  it('plays every one of its moves without breaking the pose', () => {
    const rig = buildDragon(def.color, def.scale);
    const a = newAnim();
    const p = new THREE.Vector3();
    for (const style of ['bite', 'claw', 'breath', 'gust', 'ring', 'flight'] as AttackStyle[]) {
      a.attackStyle = style;
      for (let i = 0; i < 60; i++) {
        a.t += 1 / 30;
        a.windup = i < 20 ? i / 20 : 0;
        a.attack = i < 20 ? -1 : (i - 20) / 40;
        animateCreature(rig, a);
      }
      rig.root.updateMatrixWorld(true);
      rig.j!.jaw!.getWorldPosition(p);
      expect(Number.isFinite(p.x + p.y + p.z), style).toBe(true);
    }
  });
});
