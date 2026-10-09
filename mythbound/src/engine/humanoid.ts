// Humanoid heroes, townsfolk, humanoid monsters and humanoid bosses: the rig
// builder and its animator.

import * as THREE from 'three';
import { box, cone, cyl, mat, part, pivot, sphere } from './models';
import { ease, type AnimState } from './anim';

// --------------------------------------------------------------- humanoid --

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

export function buildHumanoid(look: HumanoidLook): Rig {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const metal = look.build === 'heavy';
  const armorM = mat(look.armor, { rough: metal ? 0.35 : 0.8, metal: metal ? 0.75 : 0 });
  const clothM = mat(look.cloth, { rough: 0.9 });
  const skinM = mat(look.skin, { rough: 0.7 });
  const accentM = mat(look.accent, { rough: 0.4, metal: 0.6 });

  // Torso.
  if (look.build === 'robe') {
    part(cyl(0.22, 0.42, 1.05, 10), clothM, 0, 0.75, 0, body);
    part(box(0.46, 0.5, 0.28), clothM, 0, 1.32, 0, body);
    part(box(0.5, 0.06, 0.3), accentM, 0, 1.08, 0, body);
  } else {
    part(box(0.48, 0.58, 0.28), armorM, 0, 1.32, 0, body);
    part(box(0.42, 0.22, 0.26), clothM, 0, 0.98, 0, body);
    part(box(0.5, 0.06, 0.3), accentM, 0, 1.08, 0, body);
    if (metal) {
      part(box(0.2, 0.12, 0.3), armorM, -0.3, 1.58, 0, body).rotation.z = 0.35;
      part(box(0.2, 0.12, 0.3), armorM, 0.3, 1.58, 0, body).rotation.z = -0.35;
    }
  }

  // Head.
  const head = pivot(body, 0, 1.66, 0);
  switch (look.head) {
    case 'helmet':
      part(box(0.27, 0.3, 0.29), armorM, 0, 0.06, 0, head);
      part(box(0.2, 0.03, 0.02), mat(0x111111), 0, 0.08, 0.146, head);
      break;
    case 'plume':
      part(box(0.27, 0.3, 0.29), armorM, 0, 0.06, 0, head);
      part(box(0.04, 0.22, 0.4), mat(0x9a1a14), 0, 0.28, -0.02, head);
      break;
    case 'crown':
      part(sphere(0.14), skinM, 0, 0.05, 0, head);
      for (let i = 0; i < 5; i++) part(cone(0.03, 0.12, 4), accentM, Math.cos(i * 1.25) * 0.12, 0.2, Math.sin(i * 1.25) * 0.12, head);
      break;
    case 'hood':
      part(sphere(0.14), skinM, 0, 0.04, 0.02, head);
      part(cone(0.22, 0.42, 8), clothM, 0, 0.12, -0.03, head);
      break;
    case 'hat':
      part(sphere(0.14), skinM, 0, 0.04, 0, head);
      part(cyl(0.3, 0.3, 0.03, 12), clothM, 0, 0.13, 0, head);
      part(cone(0.16, 0.5, 8), clothM, 0, 0.38, -0.04, head).rotation.x = -0.25;
      break;
    case 'skull':
      part(sphere(0.15), mat(0xd8d0b8), 0, 0.05, 0, head);
      break;
    case 'bare':
      part(sphere(0.14), skinM, 0, 0.05, 0, head);
      part(sphere(0.145, 10, 6, ), mat(0x2a1e14), 0, 0.09, -0.02, head).scale.set(1, 0.7, 1);
      break;
  }
  if (look.ears) {
    part(cone(0.03, 0.18, 4), skinM, -0.15, 0.08, 0, head).rotation.z = 1.1;
    part(cone(0.03, 0.18, 4), skinM, 0.15, 0.08, 0, head).rotation.z = -1.1;
  }
  if (look.horns) {
    const hornM = mat(0x2a2420, { rough: 0.5 });
    part(cone(0.04, 0.25, 5), hornM, -0.1, 0.24, -0.04, head).rotation.set(-0.5, 0, 0.4);
    part(cone(0.04, 0.25, 5), hornM, 0.1, 0.24, -0.04, head).rotation.set(-0.5, 0, -0.4);
  }
  if (look.glowEyes !== undefined) {
    const eyeM = mat(look.glowEyes, { emissive: look.glowEyes, emissiveIntensity: 3 });
    part(sphere(0.025, 6, 4), eyeM, -0.055, 0.07, 0.14, head).castShadow = false;
    part(sphere(0.025, 6, 4), eyeM, 0.055, 0.07, 0.14, head).castShadow = false;
  }

  // Arms.
  const armL = pivot(body, -0.32, 1.54, 0);
  const armR = pivot(body, 0.32, 1.54, 0);
  for (const arm of [armL, armR]) {
    part(box(0.14, 0.34, 0.14), look.build === 'robe' ? clothM : armorM, 0, -0.17, 0, arm);
    part(box(0.12, 0.3, 0.12), look.build === 'heavy' ? armorM : clothM, 0, -0.47, 0, arm);
    part(box(0.1, 0.1, 0.1), look.build === 'heavy' ? armorM : skinM, 0, -0.66, 0, arm);
  }
  const handR = pivot(armR, 0, -0.66, 0.02);
  handR.rotation.x = Math.PI / 2;
  const handL = pivot(armL, 0, -0.62, 0.06);

  // Legs.
  const legL = pivot(body, -0.12, 0.92, 0);
  const legR = pivot(body, 0.12, 0.92, 0);
  if (look.build !== 'robe') {
    for (const leg of [legL, legR]) {
      part(box(0.17, 0.45, 0.18), clothM, 0, -0.22, 0, leg);
      part(box(0.15, 0.42, 0.16), look.build === 'heavy' ? armorM : mat(0x2a2018, { rough: 0.9 }), 0, -0.64, 0.01, leg);
      part(box(0.16, 0.08, 0.26), mat(0x1e1814, { rough: 0.9 }), 0, -0.88, 0.04, leg);
    }
  }

  const rig: Rig = { root, body, head, armL, armR, legL, legR, handR, handL, height: 1.85 };

  if (look.cape !== undefined) {
    const capeGeo = new THREE.PlaneGeometry(0.62, 1.25, 1, 4);
    capeGeo.translate(0, -0.62, 0);
    const cape = new THREE.Mesh(capeGeo, mat(look.cape, { rough: 0.95, side: THREE.DoubleSide }));
    cape.position.set(0, 1.6, -0.16);
    cape.castShadow = true;
    cape.userData.keep = true;
    body.add(cape);
    rig.cape = cape;
  }
  if (look.tail) {
    const tail = pivot(body, 0, 0.95, -0.14);
    part(cone(0.08, 0.9, 6), mat(look.skin, { rough: 0.6 }), 0, 0, -0.42, tail).rotation.x = -Math.PI / 2 - 0.4;
    rig.tail = tail;
  }
  if (look.wings) {
    const wings = pivot(body, 0, 1.45, -0.16);
    const wingM = mat(0x3a2a24, { rough: 0.7, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const w = pivot(wings, 0, 0, 0);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, side * 1.3, 0.5, -0.1, side * 1.1, -0.6, -0.1, 0, 0, 0, side * 1.1, -0.6, -0.1, side * 0.3, -0.7, 0], 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, wingM);
      m.castShadow = true;
      w.add(m);
      w.userData.side = side;
    }
    rig.wings = wings;
  }
  root.scale.setScalar(look.scale ?? 1);
  return rig;
}

export function animateHumanoid(rig: Rig, a: AnimState): void {
  const swing = Math.sin(a.phase) * 0.7 * a.moving;
  rig.legL.rotation.x = swing;
  rig.legR.rotation.x = -swing;
  rig.armL.rotation.set(-swing * 0.6, 0, 0.05);
  rig.armR.rotation.set(swing * 0.6, 0, -0.05);
  rig.body.rotation.set(0, 0, 0);
  rig.body.position.set(0, Math.abs(Math.cos(a.phase)) * 0.06 * a.moving, 0);
  rig.head.rotation.set(0, 0, 0);

  if (a.crouching) {
    rig.body.position.y -= 0.3;
    rig.body.rotation.x = 0.35;
    rig.legL.rotation.x += -0.6;
    rig.legR.rotation.x += -0.6;
  }
  if (a.swimming) {
    rig.body.rotation.x = 1.2;
    rig.body.position.y = 0.6;
    rig.armL.rotation.x = -2.5 + Math.sin(a.t * 4) * 0.8;
    rig.armR.rotation.x = -2.5 - Math.sin(a.t * 4) * 0.8;
  }
  if (a.airborne && !a.flying && !a.swimming) {
    rig.legL.rotation.x = -0.6;
    rig.legR.rotation.x = 0.3;
  }
  if (a.flying) {
    rig.body.rotation.x = 0.5 * a.moving;
    rig.legL.rotation.x = 0.4;
    rig.legR.rotation.x = 0.5;
  }
  if (a.blocking) {
    rig.armL.rotation.set(-1.35, 0.6, 0.2);
  }
  if (a.draw > 0 || a.attackStyle === 'bow' && a.attack >= 0) {
    // Bow in the left hand, string hand pulling back.
    const d = a.attack >= 0 ? 1 - a.attack : a.draw;
    rig.body.rotation.y = 0.35;
    rig.armL.rotation.set(-Math.PI / 2, 0.35, 0);
    rig.armR.rotation.set(-Math.PI / 2 + 0.1, -0.2 - 0.9 * d, 0);
    rig.head.rotation.y = -0.35;
  }

  if (a.attack >= 0) {
    const p = a.attack;
    switch (a.attackStyle) {
      case 'slash': {
        const k = p < 0.35 ? ease(p / 0.35) : 1 - ease((p - 0.35) / 0.65) * 0.1;
        const s = p < 0.35 ? -ease(p / 0.35) : -1 + 2 * ease(Math.min(1, (p - 0.35) / 0.35));
        rig.armR.rotation.set(-1.4 - 0.5 * k, 0, -0.9 * (1 - k * 0.2));
        rig.body.rotation.y = -s * 0.9;
        break;
      }
      case 'overhead': {
        const up = p < 0.45 ? ease(p / 0.45) : 1 - ease(Math.min(1, (p - 0.45) / 0.25));
        rig.armR.rotation.set(-0.4 - 2.4 * up, 0, -0.1);
        rig.armL.rotation.set(-0.4 - 2.2 * up, 0, 0.1);
        rig.body.rotation.x = 0.35 * (1 - up);
        break;
      }
      case 'thrust': {
        const k = p < 0.4 ? -ease(p / 0.4) * 0.6 : ease(Math.min(1, (p - 0.4) / 0.3));
        rig.armR.rotation.set(-1.5, 0, 0);
        rig.armR.position.z = 0.35 * k;
        rig.body.rotation.x = 0.2 * k;
        break;
      }
      case 'spin':
        rig.armR.rotation.set(-1.5, 0, -1.2);
        rig.armL.rotation.set(-1.2, 0, 1.2);
        rig.body.rotation.y = -p * Math.PI * 2;
        break;
      case 'cast': {
        const k = Math.sin(p * Math.PI);
        rig.armR.rotation.set(-1.2 - 0.8 * k, 0, -0.2);
        rig.armL.rotation.set(-1.2 - 0.8 * k, 0, 0.2);
        break;
      }
      case 'throw': {
        const k = p < 0.5 ? ease(p / 0.5) : 1 - ease((p - 0.5) / 0.5);
        rig.armR.rotation.set(-2.8 * k + (p > 0.5 ? -1.4 * (1 - k) : 0), 0, -0.1);
        break;
      }
      case 'bow':
        break;
    }
  }
  if (a.attackStyle !== 'thrust' || a.attack < 0) rig.armR.position.z = 0;

  if (a.rolling >= 0) {
    rig.body.rotation.x = a.rolling * Math.PI * 2;
    rig.body.position.y = 0.6 - Math.sin(a.rolling * Math.PI) * 0.3;
    rig.legL.rotation.x = rig.legR.rotation.x = -1.5;
  }
  if (rig.cape) rig.cape.rotation.x = 0.15 + 0.5 * a.moving + (a.airborne ? 0.6 : 0) + Math.sin(a.t * 3) * 0.04;
  if (rig.tail) rig.tail.rotation.y = Math.sin(a.t * 2 + a.phase) * 0.4;
  if (rig.wings) {
    rig.wings.visible = rig.wings.userData.enabled !== false;
    const flap = a.flying ? Math.sin(a.t * 12) * 0.7 : 0.15;
    for (const w of rig.wings.children) w.rotation.y = (w.userData.side as number) * (flap - 0.2);
  }
  if (a.dead >= 0) {
    rig.body.rotation.x = -Math.min(1, a.dead * 2) * Math.PI / 2;
    rig.body.position.y = 0.2 * Math.min(1, a.dead * 2);
  }
}

export function buildBossHumanoid(model: 'colossus' | 'golem' | 'champion', color: number, scale: number): Rig {
  let rig: Rig;
  if (model === 'colossus') {
    rig = buildHumanoid({ skin: 0x9a8a6a, armor: color, cloth: 0x6a5a40, accent: 0x40a0ff, build: 'heavy', head: 'helmet', glowEyes: 0x60c0ff, cape: 0x5a4a30, scale });
    const glow = mat(0x8fd0ff, { emissive: 0x40a0ff, emissiveIntensity: 2 });
    part(sphere(0.12), glow, 0, 1.35, 0.16, rig.body).castShadow = false;
  } else if (model === 'golem') {
    rig = buildHumanoid({ skin: color, armor: color, cloth: 0x1a1210, accent: 0xff5010, build: 'heavy', head: 'helmet', glowEyes: 0xff6010, scale });
    const lava = mat(0xff6a20, { emissive: 0xff4010, emissiveIntensity: 2.5 });
    for (let i = 0; i < 8; i++) part(box(0.5, 0.03, 0.02), lava, 0, 1.05 + i * 0.07, 0.145, rig.body).rotation.z = Math.sin(i * 2.3) * 0.5;
    part(box(0.28, 0.03, 0.3), lava, 0, 1.6, 0, rig.body);
  } else {
    rig = buildHumanoid({ skin: 0xb08a6a, armor: 0x8a5a2a, cloth: color, accent: 0xd8b060, build: 'heavy', head: 'plume', cape: 0x7a1410, scale });
  }
  return rig;
}
