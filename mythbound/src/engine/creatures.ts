// Creatures and non-humanoid bosses: wolves, boars, hounds, the stag, drakes,
// scorpions, wraiths, watchers, imps, the crab and the witch; builders and
// animator.

import * as THREE from 'three';
import { box, cone, cyl, mat, part, pivot, sphere, buildWeapon } from './models';
import { buildHumanoid } from './humanoid';
import type { AnimState } from './anim';

export interface CreatureRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  legs: THREE.Group[];
  extra: THREE.Object3D[];
  kind: string;
  height: number;
}

export function buildQuad(color: number, kind: 'wolf' | 'boar' | 'hound' | 'stag' | 'drake', scale = 1): CreatureRig {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const furM = mat(color, { rough: 0.95 });
  const dark = mat(0x111111, { rough: 0.8 });
  const isBoar = kind === 'boar';
  const legH = kind === 'stag' ? 1.1 : kind === 'drake' ? 0.7 : 0.6;
  const bodyLen = kind === 'stag' ? 1.6 : kind === 'drake' ? 2 : 1.25;
  part(box(isBoar ? 0.75 : 0.55, isBoar ? 0.6 : 0.5, bodyLen), furM, 0, legH + 0.25, 0, body);
  const head = pivot(body, 0, legH + 0.4, bodyLen / 2);
  part(box(0.34, 0.32, 0.42), furM, 0, 0, 0.12, head);
  part(box(0.22, 0.18, 0.3), furM, 0, -0.06, 0.42, head);
  const extra: THREE.Object3D[] = [];
  if (kind === 'wolf' || kind === 'hound') {
    part(cone(0.06, 0.16, 4), furM, -0.1, 0.22, 0.05, head);
    part(cone(0.06, 0.16, 4), furM, 0.1, 0.22, 0.05, head);
    const tail = part(cyl(0.04, 0.08, 0.6, 5), furM, 0, legH + 0.35, -bodyLen / 2 - 0.25, body);
    tail.rotation.x = -0.9;
    extra.push(tail);
  }
  if (kind === 'hound') {
    const lava = mat(0xff5a1a, { emissive: 0xff4010, emissiveIntensity: 2 });
    for (let i = 0; i < 4; i++) part(box(0.57, 0.04, 0.05), lava, 0, legH + 0.25 + (i % 2) * 0.12, -0.4 + i * 0.25, body).castShadow = false;
    part(sphere(0.04), lava, -0.1, 0.05, 0.33, head);
    part(sphere(0.04), lava, 0.1, 0.05, 0.33, head);
  } else {
    part(sphere(0.03), mat(0xffd070, { emissive: 0x806020 }), -0.1, 0.06, 0.33, head);
    part(sphere(0.03), mat(0xffd070, { emissive: 0x806020 }), 0.1, 0.06, 0.33, head);
  }
  if (isBoar) {
    part(cone(0.03, 0.18, 4), mat(0xe8e0c8), -0.1, -0.1, 0.55, head).rotation.x = -1.1;
    part(cone(0.03, 0.18, 4), mat(0xe8e0c8), 0.1, -0.1, 0.55, head).rotation.x = -1.1;
  }
  if (kind === 'stag') {
    const antler = mat(0xcfc3a0, { rough: 0.6 });
    for (const s of [-1, 1]) {
      const a = pivot(head, s * 0.12, 0.2, 0.05);
      part(cyl(0.025, 0.04, 0.7, 5), antler, 0, 0.35, 0, a).rotation.z = -s * 0.5;
      part(cyl(0.02, 0.03, 0.4, 5), antler, s * 0.25, 0.6, 0.05, a).rotation.z = -s * 1.1;
      part(cyl(0.02, 0.03, 0.4, 5), antler, s * 0.15, 0.75, -0.05, a).rotation.z = s * 0.2;
      part(cyl(0.02, 0.03, 0.35, 5), antler, s * 0.38, 0.8, 0.0, a).rotation.z = -s * 0.4;
    }
    const glow = mat(0x9fffd0, { emissive: 0x40ffa0, emissiveIntensity: 2.5 });
    part(sphere(0.045), glow, -0.12, 0.05, 0.33, head);
    part(sphere(0.045), glow, 0.12, 0.05, 0.33, head);
  }
  if (kind === 'drake') {
    head.position.y += 0.4;
    part(cone(0.05, 0.3, 4), dark, -0.1, 0.24, -0.05, head).rotation.x = -0.6;
    part(cone(0.05, 0.3, 4), dark, 0.1, 0.24, -0.05, head).rotation.x = -0.6;
    const tail = part(cone(0.18, 1.6, 6), furM, 0, legH + 0.25, -bodyLen / 2 - 0.7, body);
    tail.rotation.x = -Math.PI / 2;
    const wingM = mat(0x2a1a16, { side: THREE.DoubleSide, rough: 0.7 });
    for (const s of [-1, 1]) {
      const w = pivot(body, s * 0.3, legH + 0.5, 0.2);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, s * 2, 0.6, -0.4, s * 1.6, 0, -1.2, 0, 0, 0, s * 1.6, 0, -1.2, 0, 0, -0.8], 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, wingM);
      m.castShadow = true;
      w.add(m);
      w.userData.side = s;
      extra.push(w);
    }
  }
  const legs: THREE.Group[] = [];
  for (const [x, z] of [[-0.2, bodyLen / 2 - 0.15], [0.2, bodyLen / 2 - 0.15], [-0.2, -bodyLen / 2 + 0.15], [0.2, -bodyLen / 2 + 0.15]]) {
    const leg = pivot(body, x, legH + 0.1, z);
    part(box(0.12, legH + 0.1, 0.14), furM, 0, -(legH + 0.1) / 2, 0, leg);
    legs.push(leg);
  }
  root.scale.setScalar(scale);
  extra.forEach((e) => (e.userData.keep = true));
  return { root, body, head, legs, extra, kind, height: (legH + 0.7) * scale };
}

export function buildInsect(color: number, scale = 1): CreatureRig {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const shell = mat(color, { rough: 0.4, metal: 0.2 });
  part(box(0.8, 0.35, 1.0), shell, 0, 0.45, 0, body);
  const head = pivot(body, 0, 0.45, 0.55);
  part(box(0.5, 0.25, 0.3), shell, 0, 0, 0, head);
  for (const s of [-1, 1]) {
    const claw = pivot(head, s * 0.35, 0, 0.15);
    part(box(0.12, 0.12, 0.5), shell, 0, 0, 0.25, claw);
    part(box(0.2, 0.14, 0.25), shell, 0, 0, 0.55, claw);
  }
  // Segmented tail curling over the back with a stinger.
  const tail = pivot(body, 0, 0.55, -0.5);
  let seg: THREE.Object3D = tail;
  for (let i = 0; i < 5; i++) {
    const s = pivot(seg, 0, 0, i === 0 ? 0 : -0.24);
    s.rotation.x = -0.45;
    part(box(0.18 - i * 0.02, 0.16, 0.26), shell, 0, 0, -0.12, s);
    seg = s;
  }
  part(cone(0.06, 0.25, 5), mat(0x1a1410, { rough: 0.3 }), 0, 0, -0.35, seg).rotation.x = -Math.PI / 2 - 0.6;
  const legs: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const s = i % 2 ? 1 : -1;
    const leg = pivot(body, s * 0.4, 0.4, 0.3 - Math.floor(i / 2) * 0.3);
    part(box(0.5, 0.06, 0.06), shell, s * 0.25, -0.15, 0, leg).rotation.z = s * -0.6;
    legs.push(leg);
  }
  root.scale.setScalar(scale);
  return { root, body, head, legs, extra: [tail], kind: 'insect', height: 0.9 * scale };
}

export function buildFloater(color: number, kind: 'wraith' | 'eye' | 'witch', scale = 1): CreatureRig {
  const root = new THREE.Group();
  const body = pivot(root, 0, 1.0, 0);
  const head = pivot(body, 0, 0.9, 0);
  const extra: THREE.Object3D[] = [];
  if (kind === 'eye') {
    part(sphere(0.6, 16, 12), mat(0xe8dcc8, { rough: 0.3 }), 0, 0, 0, head);
    const iris = part(sphere(0.32, 12, 8), mat(0xa01010, { emissive: 0xff2020, emissiveIntensity: 1.5 }), 0, 0, 0.36, head);
    iris.scale.z = 0.5;
    part(sphere(0.14, 8, 6), mat(0x050505), 0, 0, 0.48, head).scale.z = 0.4;
    for (let i = 0; i < 6; i++) {
      const t = part(cone(0.08, 1.2, 5), mat(color, { rough: 0.9 }), Math.cos(i) * 0.35, -0.2, Math.sin(i) * 0.35 - 0.2, body);
      t.rotation.set(Math.PI + Math.sin(i) * 0.4, 0, Math.cos(i) * 0.4);
      extra.push(t);
    }
  } else {
    const robe = mat(color, { rough: 0.95, transparent: kind === 'wraith' ? 0.85 : undefined });
    part(cone(0.55, 1.8, 10, ), robe, 0, -0.1, 0, body).rotation.x = Math.PI;
    part(box(0.6, 0.5, 0.35), robe, 0, 0.55, 0, body);
    part(cone(0.3, 0.6, 8), robe, 0, 0.15, -0.02, head);
    const eyeColor = kind === 'witch' ? 0xb070ff : 0x80b0ff;
    const eyeM = mat(eyeColor, { emissive: eyeColor, emissiveIntensity: 3 });
    part(sphere(0.04, 6, 4), eyeM, -0.08, 0.0, 0.2, head).castShadow = false;
    part(sphere(0.04, 6, 4), eyeM, 0.08, 0.0, 0.2, head).castShadow = false;
    for (const s of [-1, 1]) {
      const arm = pivot(body, s * 0.38, 0.65, 0);
      part(cone(0.12, 0.9, 6), robe, 0, -0.4, 0.1, arm).rotation.x = Math.PI - 0.3;
      extra.push(arm);
    }
    if (kind === 'witch') {
      // Three faces: maiden, mother, crone.
      for (const [i, c] of [[-1, 0xe8e0d0], [1, 0x8a8070]] as const) {
        const face = part(sphere(0.13, 8, 6), mat(c, { rough: 0.4 }), i * 0.24, 0.0, 0.05, head);
        face.rotation.y = i * 1.2;
      }
      part(sphere(0.14, 8, 6), mat(0xb8b0a0, { rough: 0.4 }), 0, 0.0, 0.12, head);
      const staff = buildWeapon('staff', true);
      staff.position.set(0.5, -0.6, 0.2);
      body.add(staff);
    }
  }
  root.scale.setScalar(scale);
  extra.forEach((e) => (e.userData.keep = true));
  return { root, body, head, legs: [], extra, kind, height: 2.2 * scale };
}

export function buildImp(color: number, scale = 1): CreatureRig {
  const rig = buildHumanoid({ skin: color, armor: color, cloth: 0x2a1410, accent: 0xff6a20, build: 'light', head: 'bare', horns: true, tail: true, glowEyes: 0xffa020, scale: 0.7 * scale });
  return { root: rig.root, body: rig.body, head: rig.head, legs: [rig.legL, rig.legR], extra: [rig.armL, rig.armR], kind: 'imp', height: 1.3 * scale };
}

export function animateCreature(rig: CreatureRig, a: AnimState): void {
  const k = a.moving;
  rig.legs.forEach((leg, i) => {
    leg.rotation.x = Math.sin(a.phase + (i % 2 ? Math.PI : 0) + (i >= 2 ? Math.PI / 2 : 0)) * 0.6 * k;
  });
  rig.body.rotation.set(0, 0, 0);
  rig.head.rotation.set(0, 0, 0);
  if (rig.kind === 'wraith' || rig.kind === 'eye' || rig.kind === 'witch') {
    rig.body.position.y = 1.0 + Math.sin(a.t * 2) * 0.15;
    rig.extra.forEach((e, i) => (e.rotation.z = Math.sin(a.t * 3 + i) * 0.2));
  }
  if (rig.kind === 'drake') {
    for (const w of rig.extra) w.rotation.z = (w.userData.side as number) * Math.sin(a.t * (a.flying ? 10 : 1.5)) * (a.flying ? 0.6 : 0.1);
  }
  if (a.attack >= 0) {
    const p = Math.sin(a.attack * Math.PI);
    if (rig.kind === 'insect') rig.extra[0].rotation.x = -0.8 * p;
    else if (rig.kind === 'imp') (rig.extra[1] as THREE.Object3D).rotation.x = -2.5 * p;
    else if (rig.kind === 'wraith' || rig.kind === 'witch') rig.extra.forEach((e) => (e.rotation.x = -1.6 * p));
    else {
      rig.body.rotation.x = -0.25 * p;
      rig.head.rotation.x = 0.5 * p;
      rig.body.position.z = 0.3 * p;
    }
  } else rig.body.position.z = 0;
  if (a.dead >= 0) {
    rig.body.rotation.z = Math.min(1, a.dead * 2) * Math.PI / 2;
    if (rig.kind === 'wraith' || rig.kind === 'eye' || rig.kind === 'witch') rig.body.position.y = 1 - Math.min(1, a.dead) * 1.0;
  }
}

export function buildCrab(color: number, scale: number): CreatureRig {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const shell = mat(color, { rough: 0.35, metal: 0.3 });
  const barnacle = mat(0x8a9a8a, { rough: 0.9 });
  part(sphere(1.1, 14, 10), shell, 0, 1.2, 0, body).scale.set(1.3, 0.55, 1);
  for (let i = 0; i < 12; i++) part(cone(0.1, 0.3, 5), barnacle, Math.cos(i * 1.7) * 0.9, 1.6, Math.sin(i * 1.7) * 0.6, body);
  const head = pivot(body, 0, 1.4, 0.9);
  const eyeM = mat(0x60ffe0, { emissive: 0x20ffd0, emissiveIntensity: 2.5 });
  for (const s of [-1, 1]) {
    part(cyl(0.04, 0.05, 0.5, 5), shell, s * 0.3, 0.25, 0, head);
    part(sphere(0.09), eyeM, s * 0.3, 0.52, 0, head);
  }
  const extra: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const claw = pivot(body, s * 1.2, 1.2, 0.7);
    part(box(0.3, 0.3, 1.0), shell, 0, 0, 0.4, claw);
    part(box(0.55, 0.45, 0.7), shell, 0, 0.1, 1.1, claw);
    part(box(0.2, 0.2, 0.6), shell, s * -0.15, -0.2, 1.35, claw);
    extra.push(claw);
  }
  const legs: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const s = i % 2 ? 1 : -1;
    const leg = pivot(body, s * 1.1, 1.0, 0.3 - Math.floor(i / 2) * 0.45);
    part(box(1.2, 0.14, 0.14), shell, s * 0.6, -0.4, 0, leg).rotation.z = s * -0.7;
    legs.push(leg);
  }
  root.scale.setScalar(scale);
  return { root, body, head, legs, extra, kind: 'crab', height: 2 * scale };
}
