// What the newer weapons leave in the world: throwing knives lying where they
// landed (walk over them to pick them up), rune traps drawn on the ground, and
// wisps over foes a rune has set burning, freezing or sickening.

import * as THREE from 'three';
import type { DamageElement, RuneId } from '../data/defs';
import { RUNE_EFFECT, RUNE_TRAP, pickUpKnife } from '../rules/weapons';
import { buildThrowingKnife } from './models';
import { heightAt, WATER_LEVEL } from './terrain';
import type { Game } from './game';

const TAU = Math.PI * 2;
const MAX_DROPPED = 24;
/** Seconds a dropped knife waits to be picked up. */
const KNIFE_LIFE = 90;
const PICKUP_RANGE = 1.7;

export interface TrapSpec {
  x: number;
  z: number;
  radius: number;
  seconds: number;
  /** Damage each tick to every foe inside. */
  damage: number;
  element: DamageElement;
  color: number;
  /** Status seconds set on foes inside each tick. */
  slow: number;
  root: number;
  rune?: RuneId;
}

interface Trap extends TrapSpec {
  left: number;
  tick: number;
  at: THREE.Vector3;
}

/** A rogue's smoke cloud: foes inside are blinded, heroes inside hide. */
interface Smoke {
  x: number;
  z: number;
  y: number;
  radius: number;
  left: number;
  puff: number;
  /** A friend's: drawn here, and hidden in, but their game blinds the monsters. */
  remote: boolean;
}

/** Burning ground left by a fire power strike: foes inside keep burning. */
interface Zone {
  x: number;
  z: number;
  y: number;
  radius: number;
  left: number;
  tick: number;
  /** Damage a second to foes inside (0 for a friend's: their game deals it). */
  dps: number;
}

interface Dropped {
  obj: THREE.Object3D;
  age: number;
}

// One model per rune, cloned (sharing geometry) for every knife on the ground.
const knifeModels = new Map<string, THREE.Object3D>();
function knifeModel(rune?: RuneId) {
  const key = rune ?? '';
  let m = knifeModels.get(key);
  if (!m) knifeModels.set(key, (m = buildThrowingKnife(rune)));
  return m.clone();
}

export class Armory {
  private dropped: Dropped[] = [];
  private traps: Trap[] = [];
  private smokes: Smoke[] = [];
  private zones: Zone[] = [];
  private v = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {}

  /** A thrown knife comes to rest here (lost if it fell in deep water). */
  dropKnife(at: THREE.Vector3, rune?: RuneId) {
    const gy = heightAt(at.x, at.z);
    if (gy < WATER_LEVEL - 0.3) return;
    if (this.dropped.length >= MAX_DROPPED) this.removeKnife(0);
    const obj = knifeModel(rune);
    // Stuck point-first in the ground at a slant.
    obj.position.set(at.x, gy + 0.2, at.z);
    obj.rotation.set(Math.PI + (Math.random() - 0.5) * 0.9, Math.random() * TAU, (Math.random() - 0.5) * 0.9);
    this.scene.add(obj);
    this.dropped.push({ obj, age: 0 });
  }

  /** Draws a rune trap; the oldest fades when there are too many. */
  addTrap(g: Game, spec: TrapSpec) {
    const mine = this.traps;
    if (mine.length >= RUNE_TRAP.max) mine.shift();
    const at = new THREE.Vector3(spec.x, heightAt(spec.x, spec.z), spec.z);
    mine.push({ ...spec, left: spec.seconds, tick: 0, at });
    g.sfx.magicCircle(at, spec.color, spec.radius, spec.seconds);
  }

  /** A smoke bomb bursts here. Friends are told, so they see the cloud and can hide in it too. */
  addSmoke(g: Game, x: number, z: number, radius: number, seconds: number, remote = false) {
    if (!remote) g.sfx.smoke(x, z, radius, seconds);
    if (this.smokes.length >= 6) this.smokes.shift();
    const y = Math.max(heightAt(x, z), WATER_LEVEL);
    this.smokes.push({ x, z, y, radius, left: seconds, puff: 0, remote });
    // The burst: a ring of smoke rolling out, and a pop.
    for (let i = 0; i < 18; i++) g.fx.smokePuff(this.v.set(x, y, z), radius * 0.8);
    g.fx.shockwave(this.v.set(x, y + 0.2, z), radius, 0x8a8690, 0.4);
    g.audio.play('throw');
  }

  /** The ground burns here for a while (a fire power strike). Friends see it; only this game burns foes with it. */
  addZone(g: Game, x: number, z: number, radius: number, seconds: number, dps: number, remote = false) {
    if (!remote) g.sfx.zone(x, z, radius, seconds);
    if (this.zones.length >= 6) this.zones.shift();
    this.zones.push({ x, z, y: Math.max(heightAt(x, z), WATER_LEVEL), radius, left: seconds, tick: 0, dps: remote ? 0 : dps });
  }

  /** Whether a spot lies inside a smoke cloud. */
  inSmoke(x: number, z: number): boolean {
    for (const s of this.smokes) if (Math.hypot(x - s.x, z - s.z) < s.radius) return true;
    return false;
  }

  update(dt: number, g: Game) {
    this.updateKnives(dt, g);
    this.updateTraps(dt, g);
    this.updateSmokes(dt, g);
    this.updateZones(dt, g);
    this.statusWisps(dt, g);
  }

  clear() {
    while (this.dropped.length) this.removeKnife(0);
    this.traps.length = 0;
    this.smokes.length = 0;
    this.zones.length = 0;
  }

  private updateZones(dt: number, g: Game) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.left -= dt;
      if (z.left <= 0) {
        this.zones.splice(i, 1);
        continue;
      }
      // Flames lick up all over it, dying down at the end.
      const n = z.left > 1 ? 3 : 1;
      for (let k = 0; k < n; k++) {
        const th = Math.random() * TAU, r = Math.sqrt(Math.random()) * z.radius;
        g.fx.emit(this.v.set(z.x + Math.cos(th) * r, z.y + 0.1, z.z + Math.sin(th) * r), { color: Math.random() < 0.6 ? 0xff6a1a : 0xffb040, count: 1, speed: 0.4, up: 2.4, life: 0.6, size: 0.6 });
      }
      z.tick -= dt;
      if (z.tick > 0 || z.dps <= 0) continue;
      z.tick += 0.5;
      for (const e of g.enemies) {
        if (!e.alive || Math.abs(e.pos.y - z.y) > 3 || Math.hypot(e.pos.x - z.x, e.pos.z - z.z) > z.radius + e.radius * 0.5) continue;
        e.status.burn = Math.max(e.status.burn, 1.5);
        g.damageEnemy(e, z.dps * 0.5, 'fire', { source: 'player', dot: true });
      }
    }
  }

  private updateSmokes(dt: number, g: Game) {
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.left -= dt;
      if (s.left <= 0) {
        this.smokes.splice(i, 1);
        continue;
      }
      // Keep the cloud billowing (thinner as it clears).
      s.puff -= dt;
      if (s.puff <= 0) {
        s.puff = 0.12;
        const n = s.left > 1 ? 3 : 1;
        for (let k = 0; k < n; k++) g.fx.smokePuff(this.v.set(s.x, s.y, s.z), s.radius);
      }
      // Monsters inside lose sight (the host's, through this guest's copies too).
      if (s.remote && !g.coop.isHost) continue;
      for (const e of g.enemies) {
        if (!e.alive || Math.abs(e.pos.y - s.y) > 4) continue;
        if (Math.hypot(e.pos.x - s.x, e.pos.z - s.z) < s.radius + e.radius * 0.5) e.status.blind = Math.max(e.status.blind, 0.6);
      }
    }
  }

  private updateKnives(dt: number, g: Game) {
    const p = g.player;
    for (let i = this.dropped.length - 1; i >= 0; i--) {
      const d = this.dropped[i];
      d.age += dt;
      if (d.age > KNIFE_LIFE) {
        this.removeKnife(i);
        continue;
      }
      const o = d.obj.position;
      if (!p.alive || d.age < 0.3 || Math.abs(o.y - p.pos.y) > 2.5 || Math.hypot(o.x - p.pos.x, o.z - p.pos.z) > PICKUP_RANGE) continue;
      if (!pickUpKnife(p.c)) continue;
      g.fx.emit(this.v.copy(o).setY(o.y + 0.2), { color: 0xf0f4ff, count: 5, speed: 1.5, life: 0.35, size: 0.25 });
      this.removeKnife(i);
      g.audio.play('pickup');
    }
  }

  private removeKnife(i: number) {
    this.scene.remove(this.dropped[i].obj);
    this.dropped.splice(i, 1);
  }

  private updateTraps(dt: number, g: Game) {
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const t = this.traps[i];
      t.left -= dt;
      if (t.left <= 0) {
        this.traps.splice(i, 1);
        continue;
      }
      t.tick -= dt;
      if (t.tick > 0) continue;
      t.tick += RUNE_TRAP.tick;
      const status = t.rune ? RUNE_EFFECT[t.rune].status : undefined;
      let caught = 0;
      for (const e of g.enemies) {
        if (!e.alive || Math.abs(e.pos.y - t.at.y) > 3) continue;
        if (Math.hypot(e.pos.x - t.x, e.pos.z - t.z) > t.radius + e.radius * 0.5) continue;
        caught++;
        if (t.slow > 0) e.status.slow = Math.max(e.status.slow, t.slow);
        if (t.root > 0) e.status.root = Math.max(e.status.root, t.root);
        if (status) e.status[status] = Math.max(e.status[status], RUNE_EFFECT[t.rune!].seconds);
        g.damageEnemy(e, t.damage, t.element, { source: 'spell' });
      }
      // Sparks rise from the runes, more while they bite.
      g.fx.emit(this.v.set(t.x, t.at.y + 0.2, t.z), { color: t.color, count: caught ? 10 : 3, speed: 0.8, spread: t.radius * 0.6, up: 2.2, life: 0.7, size: 0.3 });
    }
  }

  private statusWisps(dt: number, g: Game) {
    const chance = dt * 5;
    for (const e of g.enemies) {
      if (!e.alive) continue;
      const s = e.status;
      if (s.burn <= 0 && s.poison <= 0 && s.slow <= 0) continue;
      if (Math.random() > chance) continue;
      const color = s.burn > 0 ? 0xff7a1a : s.poison > 0 ? 0x7cff3a : 0xa8e8ff;
      g.fx.emit(e.center(this.v), { color, count: 2, speed: 0.6, spread: e.radius, up: 1.2, life: 0.6, size: 0.3 });
    }
  }
}
