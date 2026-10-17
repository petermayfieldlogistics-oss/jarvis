// A hero's horse: a low-poly model with jointed legs, neck and tail, and
// its gaits (stand, walk, trot, gallop). The player (and a co-op friend's
// copy) moves it; this only builds and poses it.

import * as THREE from 'three';
import { COATS } from '../rules/horse';
import { worldGeometry, worldMesh } from './assets';
import { box, compact, cone, mat, part } from './models';

/** Height of the saddle's seat above the ground (the rider sits here). */
export const SEAT = 1.62;

export interface HorseRig {
  root: THREE.Group;
  /** Barrel, saddle and all that rides on it (bobs and rocks with the gait). */
  body: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  tail: THREE.Group;
  /** Upper legs (front left, front right, hind left, hind right), and the lower leg of each. */
  legs: THREE.Group[];
  shins: THREE.Group[];
  /** Gait cycle (radians) and how much it gallops (smoothed). */
  phase: number;
  gallop: number;
  move: number;
  /** How high the body bobs this frame (the rider rises with it). */
  bob: number;
}

const NECK_TILT = 0.62;
const TAIL_TILT = 0.38;

/** Builds a horse in one of the coats (rules/horse COATS). */
export function buildHorse(coatIndex: number): HorseRig {
  const coat = COATS[coatIndex] ?? COATS[0];
  if (worldMesh('horse.body')) return blendHorse(coat);
  const hide = mat(coat.body, { rough: 0.85 });
  const mane = mat(coat.mane, { rough: 0.95 });
  const marks = mat(coat.marks, { rough: 0.9 });
  const hoof = mat(0x2a2420, { rough: 0.7 });
  const leather = mat(0x5a3418, { rough: 0.7 });
  const cloth = mat(0x7a1e1e, { rough: 0.95 });
  const brass = mat(0xc8a050, { rough: 0.35, metal: 0.7 });
  const dark = mat(0x101010, { rough: 0.4 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // Barrel, chest and rump.
  part(box(0.56, 0.6, 1.5), hide, 0, 1.25, 0, body);
  part(box(0.52, 0.56, 0.42), hide, 0, 1.22, 0.72, body).rotation.x = -0.2;
  part(box(0.58, 0.58, 0.46), hide, 0, 1.3, -0.68, body);
  part(box(0.4, 0.2, 1.1), hide, 0, 0.98, 0, body);
  // Saddle: blanket, seat, pommel and cantle, girth and stirrups.
  part(box(0.66, 0.05, 0.64), cloth, 0, 1.56, -0.05, body);
  part(box(0.5, 0.08, 0.5), leather, 0, 1.6, -0.05, body);
  part(box(0.3, 0.12, 0.08), leather, 0, 1.67, 0.2, body);
  part(box(0.38, 0.1, 0.07), leather, 0, 1.66, -0.29, body);
  part(box(0.6, 0.62, 0.07), leather, 0, 1.25, 0.05, body);
  for (const s of [-1, 1]) {
    part(box(0.02, 0.42, 0.03), leather, s * 0.31, 1.33, -0.02, body);
    part(box(0.08, 0.03, 0.12), brass, s * 0.31, 1.11, -0.02, body);
  }

  // Neck, mane and head (the head hangs off the end of the neck).
  const neck = new THREE.Group();
  neck.position.set(0, 1.42, 0.8);
  neck.rotation.x = NECK_TILT;
  body.add(neck);
  part(box(0.28, 0.95, 0.4), hide, 0, 0.42, 0, neck);
  part(box(0.07, 0.98, 0.12), mane, 0, 0.44, -0.21, neck);
  const head = new THREE.Group();
  head.position.set(0, 0.86, 0.02);
  head.rotation.x = 0.9;
  neck.add(head);
  part(box(0.28, 0.32, 0.42), hide, 0, 0.02, 0.13, head);
  part(box(0.22, 0.25, 0.38), hide, 0, -0.04, 0.48, head);
  part(box(0.23, 0.08, 0.14), marks, 0, 0.13, 0.32, head);
  part(box(0.04, 0.05, 0.05), dark, 0.13, 0.08, 0.16, head);
  part(box(0.04, 0.05, 0.05), dark, -0.13, 0.08, 0.16, head);
  for (const s of [-1, 1]) part(cone(0.05, 0.16, 4), hide, s * 0.08, 0.22, 0.0, head).rotation.x = -0.4;
  part(box(0.06, 0.08, 0.2), mane, 0, 0.19, 0.05, head);
  // Bridle and reins.
  part(box(0.3, 0.04, 0.04), leather, 0, -0.04, 0.54, head);
  part(box(0.28, 0.04, 0.04), leather, 0, 0.1, 0.06, head);

  const tail = new THREE.Group();
  tail.position.set(0, 1.46, -0.92);
  tail.rotation.x = TAIL_TILT;
  body.add(tail);
  part(box(0.1, 0.2, 0.1), mane, 0, -0.08, 0, tail);
  part(box(0.13, 0.36, 0.1), mane, 0, -0.34, -0.01, tail);
  part(box(0.09, 0.34, 0.07), mane, 0, -0.66, -0.03, tail);

  // Legs: a thigh or forearm that swings, a cannon that folds, a hoof.
  const legs: THREE.Group[] = [];
  const shins: THREE.Group[] = [];
  const sock = coat.id === 'chestnut' || coat.id === 'palomino';
  for (const [x, z, hind] of [[0.17, 0.6, false], [-0.17, 0.6, false], [0.18, -0.62, true], [-0.18, -0.62, true]] as const) {
    const leg = new THREE.Group();
    leg.position.set(x, 1.02, z);
    body.add(leg);
    part(box(hind ? 0.18 : 0.15, 0.52, hind ? 0.26 : 0.2), hide, 0, -0.24, 0, leg);
    const shin = new THREE.Group();
    shin.position.set(0, -0.5, 0);
    leg.add(shin);
    part(box(0.11, 0.42, 0.12), sock ? marks : hide, 0, -0.21, 0, shin);
    part(box(0.14, 0.09, 0.16), hoof, 0, -0.46, 0.01, shin);
    legs.push(leg);
    shins.push(shin);
  }
  // Merge the parts that never move apart (fewer draw calls on phones).
  compact(root);
  root.traverse((o) => (o.castShadow = true));
  return { root, body, neck, head, tail, legs, shins, phase: 0, gallop: 0, move: 0, bob: 0 };
}

let horseMat: THREE.MeshStandardMaterial | null = null;

/**
 * The horse modelled in Blender (blender/world.py), in the same jointed
 * pieces: the coat, mane and markings fill its colour slots.
 */
function blendHorse(coat: (typeof COATS)[number]): HorseRig {
  const sock = coat.id === 'chestnut' || coat.id === 'palomino';
  const slots = [coat.body, coat.mane, coat.marks, sock ? coat.marks : coat.body];
  horseMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const piece = (name: string, parent: THREE.Object3D) => {
    const mesh = new THREE.Mesh(worldGeometry(worldMesh(name)!, slots), horseMat!);
    mesh.castShadow = true;
    parent.add(mesh);
  };
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  piece('horse.body', body);
  const neck = new THREE.Group();
  neck.position.set(0, 1.42, 0.8);
  neck.rotation.x = NECK_TILT;
  body.add(neck);
  piece('horse.neck', neck);
  const head = new THREE.Group();
  head.position.set(0, 0.86, 0.02);
  head.rotation.x = 0.9;
  neck.add(head);
  piece('horse.head', head);
  const tail = new THREE.Group();
  tail.position.set(0, 1.46, -0.92);
  tail.rotation.x = TAIL_TILT;
  body.add(tail);
  piece('horse.tail', tail);
  const legs: THREE.Group[] = [];
  const shins: THREE.Group[] = [];
  for (const [x, z, hind] of [[0.17, 0.6, false], [-0.17, 0.6, false], [0.18, -0.62, true], [-0.18, -0.62, true]] as const) {
    const leg = new THREE.Group();
    leg.position.set(x, 1.02, z);
    body.add(leg);
    piece(hind ? 'horse.haunch' : 'horse.thigh', leg);
    const shin = new THREE.Group();
    shin.position.set(0, -0.5, 0);
    leg.add(shin);
    piece('horse.shin', shin);
    legs.push(leg);
    shins.push(shin);
  }
  return { root, body, neck, head, tail, legs, shins, phase: 0, gallop: 0, move: 0, bob: 0 };
}

// Where each leg is in the stride (fractions of a cycle): a trot moves the
// diagonal pairs together; a gallop lands hind, hind, fore, fore.
const TROT = [0, 0.5, 0.5, 0];
const GALLOP = [0.55, 0.65, 0, 0.1];
const TAU = Math.PI * 2;

/**
 * Poses the horse for a frame: `speed` in m/s over ground, `t` seconds of
 * play (idle motion). Walk, trot and gallop blend by speed.
 */
export function animateHorse(h: HorseRig, dt: number, speed: number, t: number) {
  const move = Math.min(1, speed / 2);
  const gallopW = Math.min(1, Math.max(0, (speed - 9) / 3));
  h.move += (move - h.move) * Math.min(1, dt * 8);
  h.gallop += (gallopW - h.gallop) * Math.min(1, dt * 5);
  // Longer strides at speed: a cycle covers about 2 m at a walk, 3.6 at a trot, 5.5 at a gallop.
  const stride = speed < 4 ? 2 + speed * 0.4 : speed < 10 ? 3.6 : 5.5;
  h.phase = (h.phase + (speed * dt * TAU) / stride) % TAU;
  const g = h.gallop, m = h.move;
  const amp = (0.32 + 0.18 * Math.min(1, speed / 8) + 0.3 * g) * m;
  for (let i = 0; i < 4; i++) {
    const off = (TROT[i] + (GALLOP[i] - TROT[i]) * g) * TAU;
    const p = h.phase + off;
    const s = Math.sin(p);
    // Swinging forward is a negative turn about X; the lower leg folds back on the way forward.
    h.legs[i].rotation.x = -amp * s;
    const lift = Math.max(0, Math.cos(p));
    h.shins[i].rotation.x = (i < 2 ? 1.1 : 0.7) * lift * m * (0.5 + 0.5 * Math.min(1, speed / 6));
  }
  // The body bobs twice a stride at a trot, once (and rocks) at a gallop; idle, it breathes.
  const trotBob = 0.035 * Math.abs(Math.sin(h.phase * 2)) * m * (1 - g);
  const gallopBob = 0.09 * (0.5 + 0.5 * Math.sin(h.phase)) * g;
  h.bob = trotBob + gallopBob + (1 - m) * 0.008 * Math.sin(t * 1.6);
  h.body.position.y = h.bob;
  h.body.rotation.x = 0.07 * Math.sin(h.phase + 0.6) * g;
  // The neck nods with the gallop and dips a little when standing.
  h.neck.rotation.x = NECK_TILT + 0.14 * Math.sin(h.phase + 1.2) * g + 0.05 * Math.sin(h.phase * 2) * m * (1 - g) + (1 - m) * (0.08 + 0.04 * Math.sin(t * 0.7));
  h.head.rotation.y = (1 - m) * 0.15 * Math.sin(t * 0.37);
  // The tail streams out at speed and swishes at rest.
  h.tail.rotation.x = TAIL_TILT + 0.35 * g + 0.12 * m * (1 - g) + 0.06 * Math.sin(h.phase * 2) * m;
  h.tail.rotation.z = 0.12 * Math.sin(t * (1.7 + 2 * m)) * (1 - 0.6 * g);
}
