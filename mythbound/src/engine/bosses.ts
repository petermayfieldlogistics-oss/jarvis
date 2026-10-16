// The great foes beyond the six trials. The Leviathan, the Queen of the Sea
// and the Elder Dragon are fought in fog arenas like the trials and each
// guards a relic; the Reaper and the Giant Spider are hunted in their lairs
// (no fog) and come back a while after they fall. Their moves live here so
// entities.ts keeps only the shared boss machinery. The host decides every
// hit; the looks that follow the animation (breath, foam, the spider's silk)
// are worked out from the mirrored pose, so co-op guests see them too.

import * as THREE from 'three';
import { BOSSES, LAIRS, TRIALS, type BossAttack, type BossDef, type BossId, type LairDef } from '../data/world';
import { RELICS, type RelicId } from '../data/defs';
import { bossHealthScale, inCone, inLine, lairOpen, LAIR_RESPAWN, nextSurface, surfaceAngles, waveHits, wrapAngle, yawTo, type WaveSpec } from '../rules/boss';
import { BREATH_SPAN, breathSweep, FLIGHT, LANDS } from './anim';
import { Boss, elementOf, type Enemy } from './entities';
import { compact, glowSprite, mat } from './models';
import { heightAt, WATER_LEVEL, waterDepth } from './terrain';
import type { Game } from './game';
import type { Hero } from './hero';

/** Moves only the great foes have; everything else is the shared Boss's. */
const SPECIAL = new Set<BossAttack>(['bite', 'claw', 'breath', 'gust', 'flight', 'strike', 'tail', 'dive', 'wave', 'whirlpool', 'trident', 'geyser', 'reap', 'drain', 'web', 'burrow', 'gaze']);
const GREAT = new Set<BossId>(['leviathan', 'sea-queen', 'elder-dragon', 'reaper', 'giant-spider']);
const CURVED = new Set<BossAttack>(['bite', 'claw', 'gust']);

/**
 * The Leviathan's measurements in metres. Its neck rises from the sea `ring`
 * from the shoal's centre; its body (the hit box) is `body` across, so a hero
 * near that side of the shoal can reach it; its struck head lies `strike`
 * along the sand until `lies` of the strike. The animator (creatures.ts)
 * poses the same distances.
 */
export const SERPENT = { ring: 30.5, sink: 1.6, body: 11, strike: 21, lies: 0.7, tailX: 7, tailZ: 14, tailR: 6 };
/** The Elder Dragon's flight: altitude and circle. */
const SKY = { alt: 15, circle: 13, spin: 0.55 };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Vector3();
const _col = new THREE.Color();

// ----------------------------------------------------------------- hazards --
//
// Whirlpools and webs act on the hero at this keyboard: the host shares the
// effect and every player's game pulls or slows its own hero (the host still
// decides the damage).

interface Hazard {
  kind: 'pull' | 'web';
  x: number;
  z: number;
  r: number;
  left: number;
  pull: number;
  /** Just landed: a web catching you holds you fast for a moment. */
  fresh: boolean;
  hold: number;
}
const hazards: Hazard[] = [];

export function addHazard(kind: Hazard['kind'], x: number, z: number, r: number, seconds: number, pull: number) {
  if (hazards.length > 16) hazards.shift();
  hazards.push({ kind, x, z, r, left: seconds, pull, fresh: true, hold: 0 });
}

export function clearHazards() {
  hazards.length = 0;
}

/** Call after the hero has moved this frame: pulls into whirlpools, sticks in webs. */
export function updateHazards(g: Game, dt: number) {
  const p = g.player;
  for (let i = hazards.length - 1; i >= 0; i--) {
    const h = hazards[i];
    h.left -= dt;
    h.hold = Math.max(0, h.hold - dt);
    if (h.left <= 0) {
      hazards.splice(i, 1);
      continue;
    }
    const fresh = h.fresh;
    h.fresh = false;
    if (!p.alive || p.flying || p.sailing) continue;
    const dx = h.x - p.pos.x, dz = h.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > h.r + p.radius) continue;
    if (h.kind === 'pull') {
      // Strongest at the rim's inner half; running (or rolling) out still works.
      if (d > 0.4) {
        const s = (h.pull * (1 - 0.35 * (d / h.r)) * dt) / d;
        p.pos.x += dx * s;
        p.pos.z += dz * s;
      }
    } else {
      if (fresh) {
        h.hold = 1.1;
        g.hud.toast('Caught in the web!', 'warn');
      }
      // Undo most of this frame's step: stuck fast, then wading through silk.
      const k = h.hold > 0 ? 1 : 0.55;
      p.pos.x -= p.vel.x * dt * k;
      p.pos.z -= p.vel.z * dt * k;
    }
  }
}

// -------------------------------------------------------------- the foes --

interface Wave {
  spec: WaveSpec;
  t: number;
  life: number;
  hit: Set<Hero>;
}

export class GreatBoss extends Boss {
  /** A hunted foe's lair (no fog: it wakes when a hero comes close). */
  lair: LairDef | null;
  /** Hunted foes: fighting (else resting in the lair). */
  engaged: boolean;
  private serpent: boolean;
  /** Seconds since it appeared: spaces out the big moves. */
  private clock = 0;
  /** Facing locked for the current move (strikes, breath, waves land where they were aimed). */
  private lock = 0;
  private spot = new THREE.Vector3();
  private spots: THREE.Vector3[] = [];
  private tick = 0;
  /** Height above the ground: the dragon in flight, the spider hanging from its thread. */
  private alt = 0;
  private flyFrom = new THREE.Vector3();
  private flewAt = -100;
  private waveAt = -100;
  private waves: Wave[] = [];
  private pools: { x: number; z: number; left: number; t: number }[] = [];
  private poison: { h: Hero; left: number; t: number }[] = [];
  /** The Leviathan: where it can surface (yaw from the shoal's centre), and where it is. */
  private surfaces: number[] = [];
  private surf = 0;
  private away = 0;
  private chain = false;
  private waved = false;
  private died = false;
  private wander = new THREE.Vector3();
  private wanderT = 0;
  private lastGaze = -1;
  private thread: THREE.Mesh | null = null;
  private fxAcc = 0;
  /** Waits under the sand until a hero comes close (the Sandworm). */
  private buried = false;
  private gazeAt = -100;
  private trail = 0;

  constructor(def: BossDef, arena: { x: number; z: number; radius: number }, lair: LairDef | null) {
    super(def, arena);
    this.lair = lair;
    this.engaged = !lair;
    this.serpent = def.model === 'serpent';
    const own: Partial<Record<string, number>> = { dragon: 3, spider: 1.9, siren: 1.1, reaper: 0.9 };
    this.radius = this.serpent ? SERPENT.body : (own[def.model] ?? this.radius);
    // The Sandworm waits under the sand.
    this.buried = def.attacks.includes('burrow');
    if (this.serpent) {
      this.surfaces = surfaceAngles(arena.x, arena.z, SERPENT.ring, waterDepth, 3);
      // Rise first on the sea side facing the land.
      this.surf = nextSurface(this.surfaces, 99, 0);
      this.placeSerpent();
      this.yaw = yawTo(this.pos.x, this.pos.z, arena.x, arena.z);
    }
    if (lair) {
      this.pos.set(lair.x, heightAt(lair.x, lair.z), lair.z);
      this.home.copy(this.pos);
      this.aware = false;
      this.roarLeft = 0;
      this.anim.attackStyle = 'bite';
      this.wander.copy(this.pos);
      if (def.model === 'spider') {
        // It waits up in the canopy on a silk thread: look up.
        this.alt = 9;
        this.thread = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 4, 1, true), mat(0xe8e8e0, { emissive: 0x808078, emissiveIntensity: 0.3 }));
        this.thread.scale.y = 30;
        this.thread.position.y = 15;
        this.model.root.add(this.thread);
      }
    }
  }

  get bleeds() {
    return this.bdef.model !== 'reaper' && !this.bdef.bloodless;
  }

  /**
   * While the Leviathan's head lies on the sand after a strike, blows land all
   * along its neck (its hit circle grows out to the head). Worked out from the
   * pose, so a guest's copy agrees with the host's.
   */
  private reach() {
    if (!this.serpent) return;
    const a = this.anim;
    const lying = a.attackStyle === 'strike' && a.attack > LANDS.strike![0] && a.attack < SERPENT.lies;
    this.radius = lying ? SERPENT.strike - 2 : SERPENT.body;
  }

  private placeSerpent() {
    const a = this.arena;
    this.pos.set(a.x + Math.sin(this.surf) * SERPENT.ring, WATER_LEVEL - SERPENT.sink, a.z + Math.cos(this.surf) * SERPENT.ring);
  }

  // ------------------------------------------------------------- frame --

  update(dt: number, g: Game) {
    this.clock += dt;
    // The spider hangs head-down from its thread while up in the canopy.
    this.anim.flying = this.thread !== null && this.alt > 1;
    if (this.alive && this.lair) {
      if (!this.engaged) {
        this.rest(dt, g);
        this.cosmetics(dt, g);
        return;
      }
      // Everyone left the lair: give up, go home and heal.
      if (this.foes(g).length === 0) {
        this.away += dt;
        if (this.away > 6) this.disengage(g);
      } else this.away = 0;
    }
    if (this.alive && this.alt < 0 && !(this.attack === 'burrow' && this.stage !== 'recover')) {
      // Bursting up out of the sand.
      const was = this.alt;
      this.alt = Math.min(0, this.alt + dt * 16);
      if (was < -2 && this.alt >= -2) {
        g.sfx.dust(this.pos, 40, 0xc8a878);
        g.sfx.shake(this.pos, 0.5);
        g.sfx.sound('slam', this.pos);
      }
      this.model.root.visible = this.alt > -5;
    }
    if (this.alive && this.alt > 0 && !(this.attack === 'flight' && this.stage === 'strike')) {
      // Dropping from the canopy (or back to earth).
      this.alt = Math.max(0, this.alt - dt * 18);
      if (this.alt === 0 && this.lair) {
        g.sfx.dust(this.pos, 26);
        g.sfx.shake(this.pos, 0.4);
        g.sfx.sound('slam', this.pos);
      }
    }
    super.update(dt, g);
    this.reach();
    if (!this.alive) {
      if (!this.died) this.deathFx(g);
    } else this.tickHazards(dt, g);
    this.cosmetics(dt, g);
  }

  updateMirror(dt: number, g: Game, at: number) {
    this.anim.flying = this.thread !== null && this.pos.y - heightAt(this.pos.x, this.pos.z) > 1.2;
    super.updateMirror(dt, g, at);
    this.reach();
    // The host's pose carries the spider's hang and the dragon's flight (pos.y).
    this.cosmetics(dt, g);
  }

  protected confine() {
    if (this.serpent) {
      this.pos.y = WATER_LEVEL - SERPENT.sink;
      return;
    }
    super.confine();
    if (!(this.attack === 'leap' && this.stage === 'strike')) this.pos.y += this.alt;
  }

  /** A hunted foe at rest: the Reaper drifts among the graves, the spider hangs and waits. */
  private rest(dt: number, g: Game) {
    const a = this.anim;
    a.attack = -1;
    a.windup = 0;
    a.fury = 0;
    let vx = 0, vz = 0;
    if (this.bdef.model === 'spider') {
      this.alt = Math.min(9, this.alt + dt * 6);
      this.yaw += dt * 0.15;
    } else if (this.buried) {
      // Under the sand, only a slow ripple shows where it waits.
      this.alt = -7;
      this.model.root.visible = false;
      this.trail -= dt;
      if (this.trail <= 0) {
        this.trail = 1.2;
        const ang = Math.random() * Math.PI * 2;
        g.sfx.dust(_w.set(this.pos.x + Math.cos(ang) * 2, heightAt(this.pos.x, this.pos.z), this.pos.z + Math.sin(ang) * 2), 3, 0xc8a878);
      }
    } else {
      this.wanderT -= dt;
      const dx = this.wander.x - this.pos.x, dz = this.wander.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (this.wanderT <= 0 || d < 0.6) {
        this.wanderT = 4 + Math.random() * 5;
        const ang = Math.random() * Math.PI * 2, r = Math.random() * 9;
        this.wander.set(this.home.x + Math.cos(ang) * r, 0, this.home.z + Math.sin(ang) * r);
      } else {
        const sp = Math.min(1.6, d);
        vx = (dx / d) * sp;
        vz = (dz / d) * sp;
        this.faceTowards(this.wander.x, this.wander.z, dt, 2);
      }
    }
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;
    this.pos.y = heightAt(this.pos.x, this.pos.z) + this.alt;
    this.setMotion(vx, vz);
    this.syncModel(dt);
    // A hero close by (or a blow from afar) wakes it.
    const notice = this.bdef.model === 'spider' ? 15 : this.buried ? 16 : 20;
    const near = g.heroes.some((h) => h.alive && Math.hypot(h.pos.x - this.pos.x, h.pos.z - this.pos.z) < notice);
    if (near || this.hp < this.maxHp) this.engage(g);
  }

  private engage(g: Game) {
    this.engaged = true;
    this.aware = true;
    this.away = 0;
    this.cooldown = 0.6;
    this.startRoar(1.5);
    g.sfx.sound('roar', this.pos, 90);
    g.sfx.toast(`${this.bdef.name}, ${this.bdef.title}!`, 'boss', this.pos);
  }

  private disengage(g: Game) {
    this.engaged = false;
    this.aware = false;
    this.away = 0;
    this.attack = null;
    this.cancelTelegraphs();
    this.hp = this.maxHp;
    this.phase = 1;
    this.anim.fury = 0;
    this.auraFx?.stop();
    this.auraFx = null;
    this.pos.copy(this.home);
    this.wander.copy(this.home);
    this.model.root.visible = !this.buried;
    g.sfx.emit(this.center(), { color: AFFINITY[this.bdef.id], count: 30, speed: 4, life: 0.8 });
  }

  // ---------------------------------------------------------- choosing --

  protected chooseAttack(dist: number, g: Game) {
    const two = this.phase === 2;
    const near = dist < this.radius + 5;
    const minions = g.enemies.filter((e) => e.summoned && e.alive && !(e instanceof Boss)).length;
    const opts: BossAttack[] = [];
    const add = (a: BossAttack, n = 1) => {
      for (let i = 0; i < n; i++) opts.push(a);
    };
    switch (this.bdef.id) {
      case 'leviathan':
        // Nobody within reach of its neck: dive and come up beside them.
        if (dist > 27 && this.last !== 'dive') return this.begin('dive', g);
        if (dist < SERPENT.strike) add('strike', 3);
        if (dist > 9 && dist < 25) add('tail', 2);
        add('breath', 2);
        if (dist > 10) add('volley');
        if (this.clock - this.waveAt > (two ? 11 : 17)) add('wave', 3);
        if (this.last !== 'dive' && Math.random() < 0.08) add('dive');
        break;
      case 'elder-dragon':
        // It takes to the sky once badly hurt, and again now and then.
        if ((two || this.hp < this.maxHp * 0.7) && this.clock - this.flewAt > (two ? 16 : 30)) return this.begin('flight', g);
        if (near) add('bite', 2), add('claw', 2), add('ring');
        if (dist < 12) add('gust');
        if (dist > 5 && dist < 20) add('breath', 2);
        break;
      case 'sea-queen':
        if (near) add('trident', 3), add('ring');
        if (dist > 6) add('volley', 2);
        add('whirlpool', 2);
        if (minions < (two ? 4 : 3)) add('summon');
        if (dist > 12) add('teleport');
        if (two) add('geyser', 3);
        break;
      case 'reaper':
        if (near) add('reap', 3);
        if (dist < 15) add('drain', 2);
        if (dist > 5) add('teleport', 2);
        if (minions < 3) add('summon');
        break;
      case 'giant-spider':
        if (near) add('bite', 3);
        if (dist > 6 && dist < 24) add('web', 2);
        if (dist > 8) add('leap', 2);
        if (minions < 5) add('summon');
        break;
      default:
        // The beasts of legend: each move where it makes sense.
        for (const m of this.bdef.attacks) {
          switch (m) {
            case 'bite': case 'claw': case 'sweep': case 'combo':
              if (near) add(m, 2);
              break;
            case 'slam':
              if (dist < this.radius + 9) add(m);
              break;
            case 'ring':
              if (dist < 9) add(m);
              break;
            case 'breath':
              if (dist > 3 && dist < 17) add(m, 2);
              break;
            case 'gust':
              if (dist < 12) add(m);
              break;
            case 'web':
              if (dist > 6 && dist < 24) add(m);
              break;
            case 'charge': case 'leap':
              if (dist > 8) add(m);
              break;
            case 'burrow':
              // Far off, or now and then up close: it dives and comes up beneath you.
              if (dist > 10 || Math.random() < 0.25) add(m, dist > 10 ? 2 : 1);
              break;
            case 'gaze':
              if (this.clock - this.gazeAt > (two ? 9 : 13)) add(m, 2);
              break;
            case 'summon':
              if (minions < (two ? 4 : 3)) add(m);
              break;
            case 'teleport':
              if (dist > 7) add(m);
              break;
            case 'volley': case 'strikes':
              if (dist > 5) add(m);
              break;
            default:
              add(m);
          }
        }
        // Nothing fits (a hero just out of reach): close in with whatever reaches.
        if (!opts.length) for (const m of this.bdef.attacks) if (m === 'volley' || m === 'strikes' || m === 'leap' || m === 'charge' || m === 'burrow') add(m);
    }
    if (!opts.length) return;
    const pool = opts.filter((a) => a !== this.last);
    const list = pool.length ? pool : opts;
    this.begin(list[Math.floor(Math.random() * list.length)], g);
  }

  // --------------------------------------------------------- beginning --

  protected begin(attack: BossAttack, g: Game, windup?: number) {
    super.begin(attack, g, windup);
    if (!SPECIAL.has(attack)) return;
    // Our strikes run anim.attack 0..1 straight through and land at LANDS; the
    // bites, claws and gusts are posed by the creature attack curves, whose
    // strike starts where the anticipation peaks.
    const lands = LANDS[attack] ?? [0.3];
    if (CURVED.has(attack)) {
      const a0 = lands[0] * 0.7;
      this.btiming = { a0, hits: [(lands[0] - a0) / (1 - a0)] };
    } else this.btiming = { a0: 0, hits: lands };
    this.tick = 0;
    const p = this.target ?? g.player;
    const { w, s } = this.dur;
    const landAt = w + this.btiming.hits[0] * s;
    const water = this.affinity === 'water';
    this.lock = yawTo(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
    switch (attack) {
      case 'strike':
        this.telegraphs.push(g.sfx.telegraphShape('line', this.pos.x, this.pos.z, this.lock, SERPENT.strike, 2.6, landAt, 0xff4020));
        g.sfx.sound('roar', this.pos, 90);
        break;
      case 'tail': {
        // Its tail comes up on its right: turn so the slam falls on the hero.
        this.lock -= Math.atan2(SERPENT.tailX, SERPENT.tailZ);
        this.tailSpot(this.lock, this.spot);
        this.telegraphs.push(g.sfx.telegraph(this.spot.x, this.spot.z, SERPENT.tailR, landAt, 0xff4020));
        break;
      }
      case 'breath': {
        const o = this.breathOrigin(this.lock, _v);
        this.telegraphs.push(g.sfx.telegraphShape('cone', o.x, o.z, this.lock, this.breathRange(), BREATH_SPAN + 0.25, w, water ? 0x40b0ff : 0xff6a20));
        break;
      }
      case 'wave': {
        this.waveAt = this.clock;
        // The wave rolls from the serpent across the shoal; the gap sits a run away from the hero.
        this.lock = yawTo(this.pos.x, this.pos.z, this.arena.x, this.arena.z);
        const fx = Math.sin(this.lock), fz = Math.cos(this.lock);
        const sx = this.pos.x + fx * 2, sz = this.pos.z + fz * 2;
        const heroAcross = (p.pos.x - sx) * -fz + (p.pos.z - sz) * fx;
        const side = Math.random() < 0.5 ? -1 : 1;
        let gapAt = heroAcross + side * (6 + Math.random() * 5);
        if (Math.abs(gapAt) > 18) gapAt = heroAcross - side * (6 + Math.random() * 5);
        gapAt = Math.max(-19, Math.min(19, gapAt));
        this.spot.set(sx, gapAt, sz);
        const gap = this.phase === 2 ? 6.5 : 8;
        // The safe lane through the wall.
        this.telegraphs.push(g.sfx.telegraphShape('line', sx + -fz * gapAt, sz + fx * gapAt, this.lock, 58, gap / 2, landAt, 0x90ffd8));
        if (!this.waved) g.sfx.toast('The sea rises! Run for the gap in the wave!', 'warn', this.pos);
        this.waved = true;
        g.sfx.sound('roar', this.pos, 90);
        break;
      }
      case 'dive':
        g.sfx.sound('roar', this.pos, 90);
        break;
      case 'whirlpool': {
        this.spots = [new THREE.Vector3(p.pos.x, 0, p.pos.z)];
        if (this.phase === 2) {
          const other = this.foes(g).find((h) => h !== p);
          const ang = Math.random() * Math.PI * 2;
          this.spots.push(other ? new THREE.Vector3(other.pos.x, 0, other.pos.z) : new THREE.Vector3(p.pos.x + Math.cos(ang) * 11, 0, p.pos.z + Math.sin(ang) * 11));
        }
        for (const sp of this.spots) {
          this.clampIn(sp);
          this.telegraphs.push(g.sfx.telegraph(sp.x, sp.z, 8, landAt, 0x40a0ff));
        }
        g.sfx.magicCircle(this.pos, 0x40c0ff, 3.5, w + 0.6);
        g.sfx.sound('spell', this.pos);
        break;
      }
      case 'geyser': {
        this.spots = this.foes(g).map((h) => new THREE.Vector3(h.pos.x, 0, h.pos.z));
        for (let i = 0; i < 2; i++) {
          const ang = Math.random() * Math.PI * 2, r = 4 + Math.random() * 10;
          this.spots.push(new THREE.Vector3(p.pos.x + Math.cos(ang) * r, 0, p.pos.z + Math.sin(ang) * r));
        }
        for (const sp of this.spots) {
          this.clampIn(sp);
          const x = sp.x, z = sp.z;
          g.sfx.telegraph(x, z, 3.2, landAt, 0x60d0ff, () => {
            if (!this.alive) return;
            for (const h of this.foes(g)) {
              if (Math.hypot(h.pos.x - x, h.pos.z - z) < 3.2 + h.radius) {
                g.damageHero(h, Math.round(this.damage() * 1.2), 'water', this);
                g.knockHero(h, _q.set(h.pos.x - x, 0, h.pos.z - z).normalize(), 6);
              }
            }
            g.sfx.spikes(x, z, 0x60c8ff, 9, 2.6);
            g.sfx.pillar(_w.set(x, heightAt(x, z), z), 0x80e0ff, 1.6);
            g.sfx.sound('slam', _w);
          });
        }
        g.sfx.magicCircle(this.pos, 0x60d0ff, 4, w + s * 0.3);
        break;
      }
      case 'reap':
        this.telegraphs.push(g.sfx.telegraphShape('cone', this.pos.x, this.pos.z, this.lock, 6.8, 1.3, landAt, 0x60ffa0));
        break;
      case 'drain':
        g.sfx.magicCircle(this.pos, 0x60ffa0, 3, w + s);
        g.sfx.sound('devil', this.pos);
        break;
      case 'web': {
        // Lead the hero a little: webs land where they're going.
        const v = p.vel;
        this.spot.set(p.pos.x + v.x * 0.5, 0, p.pos.z + v.z * 0.5);
        this.clampIn(this.spot);
        this.telegraphs.push(g.sfx.telegraph(this.spot.x, this.spot.z, 3.6, landAt, 0xf0f0e8));
        break;
      }
      case 'gust':
        this.telegraphs.push(g.sfx.telegraphShape('cone', this.pos.x, this.pos.z, this.lock, 16, 0.75, landAt, 0xc8e0ff));
        break;
      case 'flight':
        this.flewAt = this.clock;
        this.flyFrom.copy(this.pos);
        g.sfx.sound('roar', this.pos, 90);
        break;
      case 'burrow': {
        // Down into the sand, and up again beneath where the hero is running to.
        this.flyFrom.copy(this.pos);
        this.spot.set(p.pos.x + p.vel.x * 0.5, 0, p.pos.z + p.vel.z * 0.5);
        this.clampIn(this.spot);
        this.telegraphs.push(g.sfx.telegraph(this.spot.x, this.spot.z, 5, landAt, 0xd8b070));
        g.sfx.sound('roar', this.pos, 90);
        break;
      }
      case 'gaze':
        this.gazeAt = this.clock;
        g.sfx.magicCircle(this.pos, 0x9aff60, 3.2, w + 0.3);
        g.sfx.toast(`${this.bdef.name} raises her eyes. Look away!`, 'warn', this.pos);
        g.sfx.sound('devil', this.pos);
        break;
    }
  }

  /** Keeps a target spot inside the arena. */
  private clampIn(v: THREE.Vector3) {
    const a = this.arena;
    const dx = v.x - a.x, dz = v.z - a.z, d = Math.hypot(dx, dz), lim = a.radius - 2;
    if (d > lim) v.set(a.x + (dx / d) * lim, v.y, a.z + (dz / d) * lim);
    return v;
  }

  private tailSpot(yaw: number, out: THREE.Vector3) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    return out.set(this.pos.x + SERPENT.tailX * c + SERPENT.tailZ * s, 0, this.pos.z - SERPENT.tailX * s + SERPENT.tailZ * c);
  }

  /** Where a breath's cone starts on the ground: the serpent's neck, the dragon's jaws. */
  private breathOrigin(yaw: number, out: THREE.Vector3) {
    const d = this.serpent ? 0 : this.radius * 0.8;
    return out.set(this.pos.x + Math.sin(yaw) * d, 0, this.pos.z + Math.cos(yaw) * d);
  }

  private breathRange() {
    return this.serpent ? 25 : 19;
  }

  // ---------------------------------------------------------- striking --

  protected runAttack(dt: number, g: Game, dist: number): [number, number, number] {
    const attack = this.attack!;
    if (!SPECIAL.has(attack)) return super.runAttack(dt, g, dist);
    const p = this.target ?? g.player;
    const a = this.anim;
    const { w, s, r } = this.dur;
    this.attackTime += dt;
    this.stageTime += dt;
    if (this.stage === 'windup' && this.stageTime >= w) {
      this.stage = 'strike';
      this.stageTime = 0;
      if (attack === 'web') {
        // The silk glob arcs from the spinnerets to the spot.
        const from = this.center(_v).addScaledVector(_w.set(-Math.sin(this.yaw), 0.4, -Math.cos(this.yaw)), 1.2);
        g.sfx.meteor(from, _w.set(this.spot.x, heightAt(this.spot.x, this.spot.z) + 0.3, this.spot.z), this.btiming.hits[0] * s, 0xffffff);
        g.sfx.sound('throw', this.pos);
      }
      if (attack === 'reap' || attack === 'claw') g.sfx.sound('swing', this.pos);
    } else if (this.stage === 'strike' && this.stageTime >= s) {
      this.stage = 'recover';
      this.stageTime = 0;
      this.alt = 0;
      if (attack === 'reap' && this.phase === 2 && !this.chain && Math.random() < 0.5) {
        // Enraged, the Reaper reverses its swing at once.
        this.chain = true;
        this.begin('reap', g, 0.35);
        return [0, 0, 0];
      }
      this.chain = false;
    } else if (this.stage === 'recover' && this.stageTime >= r) {
      this.attack = null;
      this.cooldown = (0.5 + Math.random() * 0.7) * (this.phase === 2 ? 0.6 : 1);
      if (this.phase === 2 && this.roarDur !== 1.2) this.startRoar(1.2);
      return [0, 0, 0];
    }
    const t = this.stageTime;
    const k = this.stage === 'strike' ? Math.min(1, t / s) : 0;
    const hits = this.btiming.hits;
    if (this.stage === 'windup') {
      a.windup = Math.min(1, t / w);
      a.attack = -1;
    } else if (this.stage === 'strike') {
      a.windup = 0;
      a.attack = Math.min(0.999, this.btiming.a0 + (1 - this.btiming.a0) * k);
    } else {
      a.windup = 0;
      a.attack = -1;
    }
    const striking = this.stage === 'strike';
    const landed = striking && this.hits < hits.length && k >= hits[this.hits];
    if (landed) this.hits++;
    const el = elementOf(this.affinity);
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);

    switch (attack) {
      case 'strike':
        this.turnTo(this.lock, dt, striking ? 30 : 5);
        if (landed) {
          for (const h of this.foes(g)) {
            if (!inLine(h.pos.x, h.pos.z, this.pos.x, this.pos.z, this.lock, SERPENT.strike, 2.6, h.radius)) continue;
            g.damageHero(h, Math.round(this.damage() * 1.4), el, this);
            // Thrown aside, away from the neck's line.
            const side = (h.pos.x - this.pos.x) * Math.cos(this.lock) - (h.pos.z - this.pos.z) * Math.sin(this.lock) > 0 ? 1 : -1;
            g.knockHero(h, _q.set(Math.cos(this.lock) * side, 0, -Math.sin(this.lock) * side), 9);
          }
          for (const d of [9, 14, 19]) {
            const x = this.pos.x + Math.sin(this.lock) * d, z = this.pos.z + Math.cos(this.lock) * d;
            g.sfx.dust(_w.set(x, heightAt(x, z), z), 12, 0xd8eef8);
          }
          const hx = this.pos.x + Math.sin(this.lock) * 17, hz = this.pos.z + Math.cos(this.lock) * 17;
          g.sfx.impact(_w.set(hx, heightAt(hx, hz) + 1, hz), 0x80d8ff, 1);
          g.sfx.shake(this.pos, 0.7);
          g.sfx.sound('slam', _w);
        }
        return [0, 0, 0];
      case 'tail':
        this.turnTo(this.lock, dt, 6);
        if (landed) {
          const x = this.spot.x, z = this.spot.z;
          for (const h of this.foes(g)) {
            if (Math.hypot(h.pos.x - x, h.pos.z - z) > SERPENT.tailR + h.radius) continue;
            g.damageHero(h, Math.round(this.damage() * 1.5), el, this);
            g.knockHero(h, _q.set(h.pos.x - x, 0, h.pos.z - z).normalize(), 11);
          }
          g.sfx.spikes(x, z, 0x60c0ff, 10, 4);
          g.sfx.ring(_w.set(x, heightAt(x, z) + 0.3, z), SERPENT.tailR, 0x80d8ff, 0.6);
          g.sfx.dust(_w, 24, 0xd8eef8);
          g.sfx.shake(_w, 0.8);
          g.sfx.sound('slam', _w);
        }
        return [0, 0, 0];
      case 'breath': {
        this.turnTo(this.lock, dt, striking ? 30 : 4);
        if (striking && k > 0.06 && k < 0.92) {
          this.tick -= dt;
          if (this.tick <= 0) {
            this.tick = 0.22;
            const beam = this.lock + breathSweep(k, BREATH_SPAN);
            const o = this.breathOrigin(this.lock, _v);
            for (const h of this.foes(g)) {
              if (inCone(h.pos.x, h.pos.z, o.x, o.z, beam, this.breathRange(), 0.26, h.radius)) g.damageHero(h, Math.round(this.damage() * 0.3), el, this);
            }
          }
        }
        return [0, 0, 0];
      }
      case 'wave':
        this.turnTo(this.lock, dt, 4);
        if (landed) {
          const spec: WaveSpec = { x: this.spot.x, z: this.spot.z, yaw: this.lock, speed: 9, width: 64, depth: 3, gapAt: this.spot.y, gap: this.phase === 2 ? 6.5 : 8 };
          const life = 60 / spec.speed;
          g.sfx.wave(spec, life);
          this.waves.push({ spec, t: 0, life, hit: new Set() });
          g.sfx.shake(this.pos, 0.6);
          g.sfx.sound('slam', this.pos, 90);
        }
        return [0, 0, 0];
      case 'dive':
        if (striking && k > 0.3 && k < hits[0]) this.model.root.visible = false;
        if (landed) {
          // Up again on the side nearest the hero.
          const toward = yawTo(this.arena.x, this.arena.z, p.pos.x, p.pos.z);
          this.surf = nextSurface(this.surfaces, this.surf, toward);
          this.placeSerpent();
          this.yaw = this.lock = yawTo(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
          this.model.root.visible = true;
          const x = this.pos.x + Math.sin(this.yaw) * 3, z = this.pos.z + Math.cos(this.yaw) * 3;
          g.sfx.spikes(x, z, 0x60c0ff, 12, 5);
          g.sfx.ring(_w.set(x, WATER_LEVEL + 0.3, z), 9, 0x80d8ff, 0.7);
          g.sfx.shake(this.pos, 0.6);
          g.sfx.sound('slam', this.pos, 90);
          for (const h of this.foes(g)) {
            if (Math.hypot(h.pos.x - this.pos.x, h.pos.z - this.pos.z) > 10.5) continue;
            g.damageHero(h, this.damage(), el, this);
            g.knockHero(h, _q.set(h.pos.x - this.pos.x, 0, h.pos.z - this.pos.z).normalize(), 12);
          }
        }
        return [0, 0, 0];
      case 'whirlpool':
        this.faceTowards(p.pos.x, p.pos.z, dt, 3);
        if (landed) {
          const life = this.phase === 2 ? 5.5 : 4.5;
          for (const sp of this.spots) {
            g.sfx.whirlpool(sp.x, sp.z, 8, life, this.phase === 2 ? 4.2 : 3.3);
            this.pools.push({ x: sp.x, z: sp.z, left: life, t: 0 });
          }
          g.sfx.sound('spell', this.pos);
        }
        return [0, 0, 0];
      case 'trident': {
        if (this.stage === 'recover') return [0, 0, 0];
        this.faceTowards(p.pos.x, p.pos.z, dt, 5);
        if (landed) {
          for (const h of this.foes(g)) if (inCone(h.pos.x, h.pos.z, this.pos.x, this.pos.z, this.yaw, this.radius + 4.2, 0.5, h.radius)) g.damageHero(h, Math.round(this.damage() * 0.8), el, this);
          g.sfx.impact(this.center(_w).addScaledVector(_q.set(fwdX, 0, fwdZ), this.radius + 2.5), 0x80e8ff, 0.6);
          g.sfx.sound('swing', this.pos);
        }
        return striking && this.hits < hits.length && dist > this.radius + 1.5 ? [fwdX, fwdZ, 3] : [0, 0, 0];
      }
      case 'geyser':
        // The telegraphs erupt on their own.
        this.faceTowards(p.pos.x, p.pos.z, dt, 3);
        return [0, 0, 0];
      case 'reap':
        this.turnTo(this.lock, dt, striking ? 30 : 6);
        if (landed) {
          for (const h of this.foes(g)) if (inCone(h.pos.x, h.pos.z, this.pos.x, this.pos.z, this.lock, 6.8, 1.3, h.radius)) g.damageHero(h, Math.round(this.damage() * 1.3), 'dark', this);
          g.sfx.impact(this.center(_w).addScaledVector(_q.set(fwdX, 0, fwdZ), 3), 0x60ffa0, 0.8);
          g.sfx.sound('slam', this.pos);
        }
        return striking && k < hits[0] && dist > this.radius + 1.5 ? [fwdX, fwdZ, 4] : [0, 0, 0];
      case 'drain': {
        // Turns slowly: step out of its gaze to break the drain.
        this.faceTowards(p.pos.x, p.pos.z, dt, striking ? 1.2 : 4);
        if (striking && k > hits[0] && k < 0.92) {
          this.tick -= dt;
          if (this.tick <= 0) {
            this.tick = 0.3;
            for (const h of this.foes(g)) {
              if (!inCone(h.pos.x, h.pos.z, this.pos.x, this.pos.z, this.yaw, 15, 0.45, h.radius)) continue;
              const dmg = Math.round(this.damage() * 0.22);
              g.damageHero(h, dmg, 'dark', this);
              this.hp = Math.min(this.maxHp, this.hp + dmg * 1.5);
              const from = h.center(_w);
              const to = this.center(_v).add(_q.set(0, 0.6, 0));
              g.sfx.emit(from, { color: 0x60ffa0, count: 10, speed: 1, life: 0.55, size: 0.6, drift: _q.subVectors(to, from).multiplyScalar(1.8) });
            }
          }
        }
        return [0, 0, 0];
      }
      case 'web':
        this.faceTowards(this.spot.x, this.spot.z, dt, 5);
        if (landed) {
          const x = this.spot.x, z = this.spot.z;
          g.sfx.web(x, z, 3.6, 7);
          for (const h of this.foes(g)) if (Math.hypot(h.pos.x - x, h.pos.z - z) < 3.6 + h.radius) g.damageHero(h, Math.round(this.damage() * 0.4), 'earth', this);
        }
        return [0, 0, 0];
      case 'bite': {
        if (this.stage === 'windup') this.faceTowards(p.pos.x, p.pos.z, dt, 5);
        if (landed) {
          const spider = this.bdef.model === 'spider';
          const venom = spider || !!this.bdef.venom;
          for (const h of this.foes(g)) {
            if (!inCone(h.pos.x, h.pos.z, this.pos.x, this.pos.z, this.yaw, this.radius + 3.2, 0.7, h.radius)) continue;
            g.damageHero(h, Math.round(this.damage() * (spider ? 1 : 1.3)), venom ? 'earth' : 'physical', this);
            if (venom) this.poisonHero(h, g);
          }
          g.sfx.impact(this.center(_w).addScaledVector(_q.set(fwdX, 0, fwdZ), this.radius + 1), venom ? 0x9aff40 : 0xffd0a0, 0.7);
          g.sfx.sound('hit', this.pos);
        }
        return striking && k < hits[0] && dist > this.radius + 1 ? [fwdX, fwdZ, this.bdef.model === 'spider' ? 9 : 6] : [0, 0, 0];
      }
      case 'claw':
        if (this.stage === 'windup') this.faceTowards(p.pos.x, p.pos.z, dt, 4);
        if (landed) {
          for (const h of this.foes(g)) {
            if (!inCone(h.pos.x, h.pos.z, this.pos.x, this.pos.z, this.yaw, this.radius + 4.5, 1.1, h.radius)) continue;
            g.damageHero(h, this.damage(), 'physical', this);
            g.knockHero(h, _q.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), 8);
          }
          g.sfx.dust(_w.copy(this.pos).addScaledVector(_q.set(fwdX, 0, fwdZ), this.radius + 2), 14);
        }
        return [0, 0, 0];
      case 'gust':
        this.turnTo(this.lock, dt, 5);
        if (landed) {
          for (const h of this.foes(g)) {
            if (!inCone(h.pos.x, h.pos.z, this.pos.x, this.pos.z, this.lock, 16, 0.75, h.radius)) continue;
            g.damageHero(h, Math.round(this.damage() * 0.5), 'wind', this);
            g.knockHero(h, _q.set(h.pos.x - this.pos.x, 0, h.pos.z - this.pos.z).normalize(), 18);
          }
          for (const d of [4, 8, 12]) g.sfx.dust(_w.copy(this.pos).addScaledVector(_q.set(Math.sin(this.lock), 0, Math.cos(this.lock)), d), 10);
          g.sfx.shake(this.pos, 0.4);
          g.sfx.sound('roll', this.pos);
        }
        return [0, 0, 0];
      case 'flight':
        return this.fly(dt, g, k, striking);
      case 'burrow':
        return this.burrow(dt, g, k, landed);
      case 'gaze':
        this.faceTowards(p.pos.x, p.pos.z, dt, striking ? 1.5 : 3);
        if (landed) {
          // Whoever is facing her is caught by her stare (each player's own game turns its hero to stone).
          for (const h of this.foes(g)) if (this.meets(h)) g.damageHero(h, Math.round(this.damage() * 0.5), 'earth', this);
          g.sfx.ring(this.center(_w), 28, 0x9aff60, 0.6);
        }
        return [0, 0, 0];
    }
    return [0, 0, 0];
  }

  /** Is this hero looking at the Gorgon (facing her, near enough to meet her eyes)? */
  private meets(h: Hero) {
    const d = Math.hypot(h.pos.x - this.pos.x, h.pos.z - this.pos.z);
    return d < 28 && Math.cos(wrapAngle(h.yaw - yawTo(h.pos.x, h.pos.z, this.pos.x, this.pos.z))) > 0.35;
  }

  /** The Sandworm's dive: it sinks, tunnels toward the mark (a ripple runs over the sand) and bursts up under it. */
  private burrow(dt: number, g: Game, k: number, landed: boolean): [number, number, number] {
    const land = this.btiming.hits[0];
    if (this.stage === 'windup') {
      this.alt = -7 * Math.min(1, this.stageTime / this.dur.w) ** 1.6;
      this.model.root.visible = this.alt > -5;
      this.trail -= dt;
      if (this.trail <= 0) (this.trail = 0.1), g.sfx.dust(this.pos, 8, 0xc8a878);
      return [0, 0, 0];
    }
    if (this.stage === 'strike' && k < land) {
      const q = k / land;
      this.alt = -7;
      this.model.root.visible = false;
      this.pos.x = this.flyFrom.x + (this.spot.x - this.flyFrom.x) * q;
      this.pos.z = this.flyFrom.z + (this.spot.z - this.flyFrom.z) * q;
      this.yaw = yawTo(this.flyFrom.x, this.flyFrom.z, this.spot.x, this.spot.z) || this.yaw;
      this.trail -= dt;
      if (this.trail <= 0) {
        this.trail = 0.07;
        g.sfx.dust(_w.set(this.pos.x, heightAt(this.pos.x, this.pos.z), this.pos.z), 5, 0xc8a878);
      }
      return [0, 0, 0];
    }
    if (landed) {
      // Up through the sand, jaws first.
      this.pos.x = this.spot.x;
      this.pos.z = this.spot.z;
      this.alt = -3;
      this.model.root.visible = true;
      const at = _w.set(this.pos.x, heightAt(this.pos.x, this.pos.z) + 0.3, this.pos.z);
      for (const h of this.foes(g)) {
        if (Math.hypot(h.pos.x - at.x, h.pos.z - at.z) > 5 + h.radius) continue;
        g.damageHero(h, Math.round(this.damage() * 1.45), 'earth', this);
        g.knockHero(h, _q.set(h.pos.x - at.x, 0, h.pos.z - at.z).normalize(), 14);
      }
      g.sfx.ring(at, 5.5, 0xd8b070, 0.6);
      g.sfx.dust(at, 50, 0xc8a878);
      g.sfx.impact(at, 0xd8b070, 1);
      g.sfx.shake(at, 0.9);
      g.sfx.sound('slam', at, 90);
    }
    // Out of the sand by the end of the strike.
    this.alt = Math.min(0, this.alt + dt * 14);
    this.model.root.visible = true;
    return [0, 0, 0];
  }

  /** Turns towards a fixed facing (moves land where they were aimed). */
  private turnTo(yaw: number, dt: number, rate: number) {
    this.yaw += wrapAngle(yaw - this.yaw) * Math.min(1, dt * rate);
  }

  /** The Elder Dragon's flight: take off, circle raining fire, dive and land in a slam. */
  private fly(dt: number, g: Game, k: number, striking: boolean): [number, number, number] {
    const p = this.target ?? g.player;
    if (!striking) {
      this.faceTowards(p.pos.x, p.pos.z, dt, 3);
      return [0, 0, 0];
    }
    const A = this.arena;
    const R = Math.min(SKY.circle, A.radius - this.radius - 1);
    const s = this.dur.s;
    const ang0 = yawTo(A.x, A.z, this.flyFrom.x, this.flyFrom.z);
    const ang = ang0 + SKY.spin * Math.max(0, k - FLIGHT.up) * s;
    const cx = A.x + Math.sin(ang) * R, cz = A.z + Math.cos(ang) * R;
    if (k < FLIGHT.dive) {
      // Lift off and swing out onto the circle, then wheel around it.
      const up = Math.min(1, k / FLIGHT.up);
      const e = up * up * (3 - 2 * up);
      this.alt = SKY.alt * e;
      const nx = this.flyFrom.x + (cx - this.flyFrom.x) * e, nz = this.flyFrom.z + (cz - this.flyFrom.z) * e;
      // Face along the circle (it flies anticlockwise seen from above).
      if (k > FLIGHT.up * 0.5) this.turnTo(yawTo(this.pos.x, this.pos.z, nx, nz) || this.yaw, dt, 6);
      this.pos.x = nx;
      this.pos.z = nz;
      // Fire rain on the heroes below.
      if (k > FLIGHT.up + 0.03 && k < FLIGHT.dive - 0.1) {
        this.tick -= dt;
        if (this.tick <= 0) {
          this.tick = this.phase === 2 ? 0.32 : 0.42;
          const foes = this.foes(g);
          const h = foes.length ? foes[Math.floor(Math.random() * foes.length)] : p;
          const ra = Math.random() * Math.PI * 2, rr = Math.random() * 4.5;
          const x = h.pos.x + Math.cos(ra) * rr + h.vel.x * 0.6, z = h.pos.z + Math.sin(ra) * rr + h.vel.z * 0.6;
          const delay = 1.1;
          g.sfx.telegraph(x, z, 3.4, delay, 0xff6020, () => {
            if (!this.alive) return;
            for (const f of this.foes(g)) if (Math.hypot(f.pos.x - x, f.pos.z - z) < 3.4 + f.radius) g.damageHero(f, this.damage(), 'fire', this);
            g.sfx.ring(_w.set(x, heightAt(x, z) + 0.2, z), 3.4, 0xff6020, 0.45);
          });
          g.sfx.meteor(this.center(_v).add(_q.set(0, 1, 0)), _w.set(x, heightAt(x, z) + 0.2, z), delay, 0xff6a20);
        }
      }
      if (k >= FLIGHT.dive - 0.08 && this.hits === 0 && this.tick > -50) {
        // Pick where to come down, and show it.
        this.tick = -100;
        this.spot.set(p.pos.x, 0, p.pos.z);
        this.clampIn(this.spot);
        g.sfx.telegraph(this.spot.x, this.spot.z, 7, (FLIGHT.land - k) * s, 0xff3010);
        this.flyFrom.set(this.pos.x, 0, this.pos.z);
        g.sfx.sound('roar', this.pos, 90);
      }
      return [0, 0, 0];
    }
    if (k < FLIGHT.land) {
      // The dive: falls on its prey.
      const u = (k - FLIGHT.dive) / (FLIGHT.land - FLIGHT.dive);
      this.alt = SKY.alt * (1 - u * u);
      this.pos.x = this.flyFrom.x + (this.spot.x - this.flyFrom.x) * u;
      this.pos.z = this.flyFrom.z + (this.spot.z - this.flyFrom.z) * u;
      this.turnTo(yawTo(this.flyFrom.x, this.flyFrom.z, this.spot.x, this.spot.z), dt, 8);
      return [0, 0, 0];
    }
    this.alt = 0;
    if (this.hits === 0) {
      this.hits = 1;
      const x = this.pos.x, z = this.pos.z;
      for (const h of this.foes(g)) {
        if (Math.hypot(h.pos.x - x, h.pos.z - z) > 7 + h.radius) continue;
        g.damageHero(h, Math.round(this.damage() * 1.6), 'fire', this);
        g.knockHero(h, _q.set(h.pos.x - x, 0, h.pos.z - z).normalize(), 15);
      }
      const at = _w.set(x, heightAt(x, z) + 0.3, z);
      g.sfx.ring(at, 7.5, 0xff5010, 0.7);
      g.sfx.impact(at, 0xff8030, 1);
      g.sfx.dust(at, 36, 0x3a2a24);
      g.sfx.shake(at, 0.9);
      g.sfx.sound('slam', at, 90);
    }
    return [0, 0, 0];
  }

  /** Vanishes and steps out of the shadows behind the hero (the Queen rises from a pool instead). */
  protected teleport(g: Game): [number, number, number] {
    const p = this.target ?? g.player;
    const queen = this.bdef.model === 'siren';
    const color = queen ? 0x40c0ff : this.bdef.id === 'reaper' ? 0x60ffa0 : AFFINITY[this.bdef.id];
    g.sfx.emit(this.center(), { color, count: 40, speed: 6, life: 0.6 });
    const behind = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const d = queen ? 5 : 3.2;
    const v = this.clampIn(_v.set(p.pos.x + Math.sin(behind) * d, 0, p.pos.z + Math.cos(behind) * d));
    this.pos.set(v.x, heightAt(v.x, v.z), v.z);
    this.yaw = yawTo(v.x, v.z, p.pos.x, p.pos.z);
    this.model.root.visible = true;
    g.sfx.emit(this.center(), { color, count: 40, speed: 6, life: 0.6 });
    if (queen) g.sfx.spikes(v.x, v.z, 0x60c0ff, 6, 1.8);
    else g.sfx.magicCircle(this.pos, color, 2.5, 0.8);
    // It strikes as it arrives: with its own best blow.
    const blow: BossAttack = queen ? 'trident' : this.bdef.id === 'reaper' ? 'reap' : this.bdef.attacks.includes('bite') ? 'bite' : 'sweep';
    this.begin(blow, g, this.phase === 2 ? 0.4 : 0.55);
    this.last = 'teleport';
    return [0, 0, 0];
  }

  /** The spider's brood hatches from silk, the drowned rise through a spring; the Reaper keeps its runes. */
  protected summonFx(at: THREE.Vector3, seconds: number, g: Game) {
    if (this.bdef.model === 'spider') {
      // Egg sacs split open round her: silk and dust, no runes.
      g.sfx.dust(at, 26, 0xe8e4d4);
      g.sfx.emit(_v.copy(at).add(_q.set(0, 1, 0)), { color: 0xe8e2cc, count: 24, speed: 4, life: 0.7, up: 1.5 });
      g.sfx.sound('throw', at);
    } else super.summonFx(at, seconds, g);
  }

  protected arrivalFx(e: Enemy, g: Game) {
    if (this.bdef.model === 'spider') {
      g.sfx.emit(e.center(_w), { color: 0xe8e2cc, count: 18, speed: 3, life: 0.5, up: 1 });
      g.sfx.dust(e.pos, 8, 0xd8d4c0);
    } else if (this.bdef.model === 'siren') {
      g.sfx.spikes(e.pos.x, e.pos.z, 0x60c0ff, 6, 1.6);
      g.sfx.emit(e.center(_w), { color: 0x80e0ff, count: 20, speed: 3, life: 0.6, up: 2 });
    } else super.arrivalFx(e, g);
  }

  private poisonHero(h: Hero, g: Game) {
    const cur = this.poison.find((x) => x.h === h);
    if (cur) cur.left = 4;
    else this.poison.push({ h, left: 4, t: 1 });
    if (h === g.player) g.hud.toast('Poisoned!', 'warn');
  }

  /** Waves rolling, whirlpools churning, venom burning: the host's damage over time. */
  private tickHazards(dt: number, g: Game) {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.t += dt;
      if (w.t > w.life) {
        this.waves.splice(i, 1);
        continue;
      }
      for (const h of this.foes(g)) {
        if (w.hit.has(h) || !waveHits(w.spec, h.pos.x, h.pos.z, w.t, h.radius)) continue;
        w.hit.add(h);
        g.damageHero(h, Math.round(this.damage() * 1.3), 'water', this);
        g.knockHero(h, _q.set(Math.sin(w.spec.yaw), 0, Math.cos(w.spec.yaw)), 14);
      }
    }
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const pl = this.pools[i];
      pl.left -= dt;
      pl.t -= dt;
      if (pl.left <= 0) {
        this.pools.splice(i, 1);
        continue;
      }
      if (pl.t > 0) continue;
      pl.t = 0.5;
      for (const h of this.foes(g)) if (Math.hypot(h.pos.x - pl.x, h.pos.z - pl.z) < 2.6 + h.radius) g.damageHero(h, Math.round(this.damage() * 0.35), 'water', this);
    }
    for (let i = this.poison.length - 1; i >= 0; i--) {
      const ps = this.poison[i];
      ps.left -= dt;
      ps.t -= dt;
      if (ps.left <= 0 || !ps.h.alive) {
        this.poison.splice(i, 1);
        continue;
      }
      if (ps.t > 0) continue;
      ps.t = 1;
      g.damageHero(ps.h, Math.max(1, Math.round(this.damage() * 0.12)), 'earth', this);
      g.sfx.emit(ps.h.center(_w), { color: 0x9aff40, count: 8, speed: 1.2, life: 0.6, up: 1 });
    }
  }

  // ------------------------------------------------------------- looks --

  /** Effects that follow the pose, worked out the same way on every player's screen. */
  private cosmetics(dt: number, g: Game) {
    const a = this.anim;
    const rig = this.model.creature;
    if (this.thread) this.thread.visible = this.alive && this.pos.y - heightAt(this.pos.x, this.pos.z) > 1.2;
    if (!rig || !this.alive || !this.model.root.visible) return;
    const near = Math.abs(g.player.pos.x - this.pos.x) + Math.abs(g.player.pos.z - this.pos.z) < 160;
    if (!near) return;
    const low = g.settings.quality === 'low';
    const ps = g.fx.particles;
    const gz = a.attackStyle === 'gaze' ? a.attack : -1;
    if (gz >= LANDS.gaze![0] && this.lastGaze < LANDS.gaze![0]) {
      // The Gorgon's stare: a hero facing her turns to stone (each game its own hero).
      g.fx.flash(this.center(_v), 0x9aff60, 40, 30);
      if (this.meets(g.player)) g.player.petrify(g, this.phase === 2 ? 2.2 : 1.7);
    }
    this.lastGaze = gz;
    if (a.attackStyle === 'breath' && a.attack > 0.04 && a.attack < 0.94) {
      // A torrent from the jaws along the sweep.
      const water = this.affinity === 'water';
      const venom = this.affinity === 'earth', shadow = this.affinity === 'dark';
      const mouth = (rig.j?.jaw ?? rig.head).getWorldPosition(_v);
      const beam = this.yaw + breathSweep(a.attack, BREATH_SPAN);
      const reach = this.breathRange();
      const o = this.breathOrigin(this.yaw, _w);
      const tx = o.x + Math.sin(beam) * reach * 0.75, tz = o.z + Math.cos(beam) * reach * 0.75;
      _q.set(tx - mouth.x, heightAt(tx, tz) - mouth.y, tz - mouth.z);
      const len = _q.length();
      _q.multiplyScalar(1 / len);
      const n = low ? 4 : 9;
      for (let i = 0; i < n; i++) {
        const sp = len * (1.4 + Math.random() * 0.5);
        _col.setHex(water ? (Math.random() < 0.4 ? 0xe8f8ff : 0x50b8f0) : venom ? (Math.random() < 0.4 ? 0xd0ff80 : 0x60c020) : shadow ? (Math.random() < 0.4 ? 0xd0a0ff : 0x6a30c0) : Math.random() < 0.4 ? 0xffe070 : 0xff5a14);
        ps.spawn(mouth.x, mouth.y, mouth.z, _q.x * sp + (Math.random() - 0.5) * 3, _q.y * sp + (Math.random() - 0.5) * 3, _q.z * sp + (Math.random() - 0.5) * 3, 0.55 + Math.random() * 0.2, 0.9 + Math.random() * 0.9, _col, water ? 3 : -1, 1.6, 0.4, 0.9);
      }
      if (Math.random() < 0.5) g.fx.dust(_w.set(tx, heightAt(tx, tz), tz), 2, water ? 0xd8eef8 : 0x3a3030);
    }
    this.fxAcc += dt * (low ? 6 : 14);
    if (this.serpent) {
      // Foam where the neck and coils break the surface.
      while (this.fxAcc >= 1) {
        this.fxAcc -= 1;
        const ang = Math.random() * Math.PI * 2, r = 2 + Math.random() * 2.2;
        const back = Math.random() < 0.4 ? 9 + Math.random() * 18 : 0;
        const x = this.pos.x + Math.cos(ang) * r - Math.sin(this.yaw) * back, z = this.pos.z + Math.sin(ang) * r - Math.cos(this.yaw) * back;
        _col.setHex(0xe0f4ff);
        g.fx.soft.spawn(x, WATER_LEVEL + 0.1, z, Math.cos(ang) * 1.5, 0.6 + Math.random(), Math.sin(ang) * 1.5, 0.8 + Math.random() * 0.6, 0.8 + Math.random() * 0.8, _col, 1, 1.4, 1.2, 0.55);
      }
    } else if (this.bdef.model === 'dragon') {
      // Embers drift off the old wyrm's hide.
      while (this.fxAcc >= 1) {
        this.fxAcc -= 1;
        const c = rig.body.getWorldPosition(_v);
        _col.setHex(Math.random() < 0.5 ? 0xff7020 : 0xffb040);
        ps.spawn(c.x + (Math.random() - 0.5) * 4, c.y + Math.random() * 2, c.z + (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 0.6, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 0.6, 1 + Math.random(), 0.2 + Math.random() * 0.2, _col, -0.4, -0.4, 0.3, 1);
      }
      if (this.alt > 1 && this.alt < 9) g.fx.dust(_w.set(this.pos.x, heightAt(this.pos.x, this.pos.z), this.pos.z), 2, 0x3a2a24);
    } else this.fxAcc = 0;
  }

  /** Each great foe falls in its own way (played on every screen). */
  private deathFx(g: Game) {
    this.died = true;
    const c = this.center(_v);
    const fx = g.fx;
    switch (this.bdef.model) {
      case 'serpent':
        fx.spikes(this.pos.x, this.pos.z, 0x60c0ff, 14, 6);
        fx.ring(_w.set(this.pos.x, WATER_LEVEL + 0.3, this.pos.z), 16, 0x80d8ff, 1.2);
        fx.emit(c, { color: 0xd8f4ff, count: 90, speed: 9, life: 1.4, size: 1.2, gravity: 8, up: 8 });
        break;
      case 'dragon':
        fx.ring(_w.copy(this.pos).add(_q.set(0, 0.4, 0)), 12, 0xff5010, 1);
        fx.emit(c, { color: 0xff7020, count: 120, speed: 8, life: 1.6, size: 0.9, up: 5 });
        fx.flash(c, 0xff6020, 80, 50);
        break;
      case 'siren':
        fx.pillar(_w.copy(this.pos), 0x80e8ff, 2.2);
        fx.spikes(this.pos.x, this.pos.z, 0x60d0ff, 12, 3);
        fx.emit(c, { color: 0x80f0ff, count: 80, speed: 6, life: 1.2, up: 3 });
        break;
      case 'reaper':
        fx.emit(c, { color: 0x60ffa0, count: 110, speed: 5, life: 1.6, size: 0.8, up: 4 });
        fx.pillar(_w.copy(this.pos), 0x60ffa0, 1.2);
        break;
      default:
        fx.emit(c, { color: AFFINITY[this.bdef.id], count: 60, speed: 6, life: 0.9, up: 2 });
        fx.dust(this.pos, this.bdef.mini ? 50 : 30);
    }
    if (Math.abs(g.player.pos.x - this.pos.x) + Math.abs(g.player.pos.z - this.pos.z) < 120) {
      g.audio.play('roar');
      g.shake(0.6);
    }
  }
}

/** Glow colours for each foe's minor effects. */
const AFFINITY: Record<BossId, number> = {
  cernunna: 0x60ffb0, thalassor: 0x40c0ff, zephyron: 0x80b0ff, ignaroth: 0xff6a20, champion: 0xff4030, 'hecate-shade': 0xa070ff,
  leviathan: 0x40c0ff, 'sea-queen': 0x60e0ff, 'elder-dragon': 0xff6020, reaper: 0x60ffa0, 'giant-spider': 0x9aff40,
  'bandit-king': 0xffc060, 'erymanthian-boar': 0xc89a60, 'satyr-king': 0x9aff60, 'teumessian-fox': 0xffa040, 'captain-skarr': 0x60c0ff, talos: 0xffa040,
  'nemean-lion': 0xffd070, 'scorpion-king': 0xb0ff40, hydra: 0x9aff40, empusa: 0x80ff90, cacus: 0xff6a20, orthrus: 0xff5a14, cerberus: 0xb070ff,
  alecto: 0xff4060, minotaur: 0xd89a60, 'bronze-bull': 0xff8a30, 'frost-king': 0x9ad8ff, lykaon: 0xc0e8ff, callisto: 0xfff0b0, chimera: 0xff7020,
  'ash-lord': 0xff6a20, salamander: 0xff5010, sandworm: 0xd8b070, sphinx: 0xa0d0ff, memnon: 0xffd060, manticore: 0xff6040, dryas: 0x80ff80,
  argus: 0xb0a0ff, orion: 0xe0f0ff, python: 0x9aff40, medusa: 0x9aff60, arachne: 0xffd860, polyphemus: 0xffc060, celaeno: 0xa0c0ff, karkinos: 0x60d0ff,
};

/** The boss for a trial or lair: the great foes get their own moves. */
export function makeBoss(def: BossDef, place: string): Boss | null {
  const trial = TRIALS.find((t) => t.id === place);
  const lair = LAIRS.find((l) => l.id === place) ?? null;
  const arena = trial ? { x: trial.x, z: trial.z, radius: trial.radius } : lair ? { x: lair.x, z: lair.z, radius: lair.leash } : null;
  if (!arena) return null;
  const b = GREAT.has(def.id) || def.mini ? new GreatBoss(def, arena, lair) : new Boss(def, arena);
  b.place = place;
  return b;
}

/** A hunted foe in a fight near the hero (for the health bar), on the host or a guest's copy. */
export function huntedNear(g: Game): Boss | null {
  const p = g.player.pos;
  let best: Boss | null = null;
  let bestD = 55;
  for (const e of g.enemies) {
    if (!(e instanceof Boss) || !e.bdef.mini || !e.alive || !e.aware) continue;
    const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
    if (d < bestD) (bestD = d), (best = e);
  }
  return best;
}

// ------------------------------------------------------------------ lairs --

/** Host: puts the hunted foes in their lairs when a hero is near (and, for night walkers, after dark). */
export class Lairs {
  private foes = new Map<string, Boss>();
  /** Seconds of play after which each lair is filled again. */
  private readyAt = new Map<string, number>();

  constructor(private g: Game) {}

  update() {
    const g = this.g;
    if (g.coop.isGuest) return;
    const now = g.state.playTime;
    for (const l of LAIRS) {
      const cur = this.foes.get(l.id);
      if (cur && !g.enemies.includes(cur)) {
        // Slain (its corpse has faded) or swept away: it comes back in time.
        this.foes.delete(l.id);
        if (!cur.alive) this.readyAt.set(l.id, now + LAIR_RESPAWN);
        continue;
      }
      const near = g.heroDistance(l.x, l.z) < 150;
      if (!cur) {
        if (near && lairOpen(l, g.isNight, now, this.readyAt.get(l.id) ?? 0)) this.spawn(l);
      } else if (cur.alive && !cur.aware && ((l.night && !g.isNight) || !near)) {
        // Dawn sends the night walker away; with no one about, the lair rests.
        g.removeEnemy(cur);
        this.foes.delete(l.id);
      }
    }
  }

  private spawn(l: LairDef) {
    const g = this.g;
    const b = makeBoss(BOSSES[l.boss], l.id);
    if (!b) return;
    // Tougher for a party: count the heroes about.
    const party = g.heroes.filter((h) => Math.abs(h.pos.x - l.x) + Math.abs(h.pos.z - l.z) < 220).length;
    if (party > 1) b.scaleHealth(bossHealthScale(party));
    g.enemies.push(b);
    g.scene.add(b.model.root);
    this.foes.set(l.id, b);
  }

  /** Taken out with every other monster (switching worlds). */
  clear() {
    this.foes.clear();
  }

  private seenT = 0;

  /** Every player: coming within sight of a beast of legend's lair marks it on the map. */
  discover(dt: number) {
    const g = this.g;
    this.seenT -= dt;
    if (this.seenT > 0 || !g.player.alive) return;
    this.seenT = 1;
    const p = g.player.pos;
    for (const l of LAIRS) {
      if (!l.legend || g.state.flags[`seen-${l.id}`] || Math.hypot(p.x - l.x, p.z - l.z) > 110) continue;
      g.state.flags[`seen-${l.id}`] = true;
      g.hud.toast(`Lair found: ${l.name}. ${BOSSES[l.boss].name} dwells here.`, 'quest');
    }
  }
}

// ----------------------------------------------------------------- relics --

/** The relic a great foe leaves in its arena: a pearl in a clam, a crown of coral, a burning heart. */
export function buildRelic(id: RelicId): THREE.Group {
  const g = new THREE.Group();
  const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  let glow = 0xffffff;
  if (id === 'leviathan-pearl') {
    const shell = mat(0x9ab8b0, { rough: 0.5 });
    const lo = part(new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), shell, 0, 0.35, 0);
    lo.scale.y = 0.45;
    const hi = part(new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), shell, 0, 0.36, -0.1);
    hi.scale.y = 0.45;
    hi.rotation.x = -0.9;
    hi.position.set(0, 0.42, -0.32);
    part(new THREE.SphereGeometry(0.22, 14, 10), mat(0xf4f0ff, { rough: 0.15, emissive: 0x80f0ff, emissiveIntensity: 1.2 }), 0, 0.5, 0.02);
    glow = 0x80f0ff;
  } else if (id === 'tide-crown') {
    part(new THREE.CylinderGeometry(0.32, 0.3, 0.14, 16, 1, true), mat(0xd8b058, { rough: 0.35, metal: 0.6, side: THREE.DoubleSide }), 0, 0.5, 0);
    const coral = mat(0xe86a7a, { rough: 0.6 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const h = i % 2 ? 0.22 : 0.34;
      const s = part(new THREE.ConeGeometry(0.045, h, 5), coral, Math.sin(a) * 0.3, 0.57 + h / 2, Math.cos(a) * 0.3);
      s.rotation.set(Math.cos(a) * 0.2, 0, -Math.sin(a) * 0.2);
      part(new THREE.SphereGeometry(0.04, 6, 4), mat(0xf2eee2, { rough: 0.2, emissive: 0x60fff0, emissiveIntensity: 0.8 }), Math.sin(a) * 0.32, 0.5, Math.cos(a) * 0.32);
    }
    glow = 0x60fff0;
  } else {
    const heart = part(new THREE.IcosahedronGeometry(0.3, 1), mat(0x8a1a10, { rough: 0.3, emissive: 0xff4010, emissiveIntensity: 1.6 }), 0, 0.55, 0);
    heart.scale.set(1, 1.2, 0.9);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const c = part(new THREE.ConeGeometry(0.06, 0.32, 4), mat(0x2a1210, { rough: 0.5 }), Math.sin(a) * 0.24, 0.62, Math.cos(a) * 0.24);
      c.rotation.set(Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6);
    }
    glow = 0xff6020;
  }
  // A stone plinth under it.
  part(new THREE.CylinderGeometry(0.55, 0.65, 0.3, 10), mat(0x6a665e), 0, 0.12, 0);
  compact(g);
  const s = glowSprite(glow, 2.4);
  s.position.y = 0.9;
  g.add(s);
  return g;
}

export const isRelic = (id: string): id is RelicId => id in RELICS;

/** What a great foe guards, by name: a legendary weapon or a relic. */
export function rewardName(id: string, weapons: Record<string, { name: string }>): string {
  return isRelic(id) ? RELICS[id].name : (weapons[id]?.name ?? id);
}
