import * as THREE from 'three';
import { ENEMIES, type Affinity, type BossAttack, type BossDef, type EnemyDef, type EnemyId } from '../data/world';
import type { CreatureKind, DamageElement } from '../data/defs';
import { buildShield, buildWeapon, compact } from './models';
import { animateHumanoid, buildBossHumanoid, buildHumanoid, type Rig } from './humanoid';
import { animateCreature, buildCrab, buildFloater, buildImp, buildInsect, buildQuad, type CreatureRig } from './creatures';
import { newAnim, type AnimState, type AttackStyle } from './anim';
import { heightAt, WATER_LEVEL } from './terrain';
import type { Game } from './game';

// ------------------------------------------------------------------ models --

export interface Model {
  root: THREE.Group;
  height: number;
  animate(a: AnimState): void;
  humanoid?: Rig;
}

function humanoidModel(rig: Rig): Model {
  compact(rig.root);
  return { root: rig.root, height: rig.height * rig.root.scale.y, animate: (a) => animateHumanoid(rig, a), humanoid: rig };
}
function creatureModel(rig: CreatureRig): Model {
  compact(rig.root);
  return { root: rig.root, height: rig.height, animate: (a) => animateCreature(rig, a) };
}

export function enemyModel(def: EnemyDef): Model {
  switch (def.id) {
    case 'bandit': {
      const rig = buildHumanoid({ skin: 0xb08a6a, armor: 0x5b4a3a, cloth: 0x3a3024, accent: 0x6a5a40, build: 'light', head: 'hood', cape: 0x3a2e22 });
      rig.handR.add(buildWeapon('sword'));
      return humanoidModel(rig);
    }
    case 'bandit-archer': {
      const rig = buildHumanoid({ skin: 0xb08a6a, armor: 0x4d5a3a, cloth: 0x2e3424, accent: 0x5a5a40, build: 'light', head: 'hood' });
      rig.handL.add(buildWeapon('bow'));
      return humanoidModel(rig);
    }
    case 'skeleton': {
      const rig = buildHumanoid({ skin: 0xcfc7ad, armor: 0x8a8270, cloth: 0x3a342a, accent: 0x5a4a30, build: 'light', head: 'skull', glowEyes: 0x60a0ff });
      rig.handR.add(buildWeapon('sword'));
      return humanoidModel(rig);
    }
    case 'drowned': {
      const rig = buildHumanoid({ skin: 0x5a7a6a, armor: 0x3a4a44, cloth: 0x2a3a34, accent: 0x40605a, build: 'light', head: 'bare', glowEyes: 0x60ffe0, scale: def.scale });
      rig.handR.add(buildWeapon('trident'));
      return humanoidModel(rig);
    }
    case 'mars-legionary': {
      const rig = buildHumanoid({ skin: 0xa07a5a, armor: 0x8a5a2a, cloth: 0x7a2a22, accent: 0xc8a050, build: 'heavy', head: 'plume', cape: 0x6a1a14, scale: def.scale });
      rig.handR.add(buildWeapon('sword'));
      rig.handL.add(buildShield());
      return humanoidModel(rig);
    }
    case 'wolf':
      return creatureModel(buildQuad(def.color, 'wolf', def.scale));
    case 'boar':
      return creatureModel(buildQuad(def.color, 'boar', def.scale));
    case 'magma-hound':
      return creatureModel(buildQuad(def.color, 'hound', def.scale));
    case 'drake':
      return creatureModel(buildQuad(def.color, 'drake', def.scale));
    case 'scorpion':
      return creatureModel(buildInsect(def.color, def.scale));
    case 'wraith':
      return creatureModel(buildFloater(def.color, 'wraith', def.scale));
    case 'eye-watcher':
      return creatureModel(buildFloater(def.color, 'eye', def.scale));
    case 'fire-imp':
      return creatureModel(buildImp(def.color, def.scale));
  }
}

export function bossModel(def: BossDef): Model {
  switch (def.model) {
    case 'stag':
      return creatureModel(buildQuad(def.color, 'stag', def.scale));
    case 'crab':
      return creatureModel(buildCrab(def.color, def.scale));
    case 'witch':
      return creatureModel(buildFloater(def.color, 'witch', def.scale));
    default: {
      const rig = buildBossHumanoid(def.model, def.color, def.scale);
      const weapon = def.model === 'champion' ? buildWeapon('sword') : def.model === 'golem' ? buildWeapon('hammer') : buildWeapon('bolt');
      rig.handR.add(weapon);
      if (def.model === 'champion') rig.handL.add(buildShield());
      return humanoidModel(rig);
    }
  }
}

// ------------------------------------------------------------ move timing --
//
// Every attack runs windup -> strike -> recover. During the windup the
// gameplay code ramps anim.windup 0->1 (the anticipation pose); the strike
// then drives anim.attack 0->1 and the blow lands at a fixed point of it.
// The two animators read anim.attack differently, so the mapping depends on
// the body.

/** Strike progress at which each blow lands on the humanoid animator (it starts a telegraphed move past its anticipation). */
const HUMANOID_HITS: Partial<Record<AttackStyle, number[]>> = {
  slash: [0.22], slash2: [0.2], slash3: [0.22], overhead: [0.22], thrust: [0.18], heavy: [0.22], spin: [0.2],
  cast: [0.17], throw: [0.19], bow: [0.21], combo: [0.08, 0.42, 0.76],
  sweep: [0.15], slam: [0.11], stomp: [0.11], ring: [0.1], leap: [0.93], volley: [0.17], strikes: [0.18], summon: [0.18], teleport: [0.3],
};
/** Where each move lands through anim.attack on the creature animator (mirrors creatures.ts; its anticipation peaks at 70% of it). */
const CREATURE_HIT: Partial<Record<AttackStyle, number>> = {
  sweep: 0.62, slam: 0.9, overhead: 0.9, stomp: 0.8, ring: 0.92, volley: 0.32, summon: 0.8, roar: 0.8, leap: 1, strikes: 0.5,
};

interface Timing {
  /** anim.attack at the start of the strike. */
  a0: number;
  /** Strike progress (0..1) of each blow. */
  hits: number[];
}

function strikeTiming(humanoid: boolean, style: AttackStyle): Timing {
  if (humanoid) return { a0: 0, hits: HUMANOID_HITS[style] ?? [0.22] };
  if (style === 'charge') return { a0: 0, hits: [0] };
  const hit = CREATURE_HIT[style] ?? 0.667;
  // The windup already showed the creature's anticipation: start the strike where it peaks.
  const a0 = hit * 0.7;
  return { a0, hits: [hit >= 1 ? 1 : (hit - a0) / (1 - a0)] };
}

interface Move {
  style: AttackStyle;
  /** Seconds of anticipation, of strike plus follow-through, and of standing open afterwards. */
  windup: number;
  strike: number;
  recover: number;
  /** Forward root motion (m/s) during the strike until the blow lands. */
  lunge?: number;
  /** Fires the monster's projectile instead of a melee blow (`shots` in a fan). */
  ranged?: boolean;
  shots?: number;
  dmg?: number;
}

const m = (style: AttackStyle, windup: number, strike: number, recover: number, o: Partial<Move> = {}): Move => ({ style, windup, strike, recover, ...o });

/** Each monster's repertoire: melee moves are cycled in order, ranged moves picked at range. */
const MOVESET: Record<EnemyId, { melee: Move[]; ranged?: Move[] }> = {
  wolf: { melee: [m('bite', 0.55, 0.5, 0.55, { lunge: 9 })] },
  boar: { melee: [m('bite', 0.75, 0.55, 0.85, { lunge: 11 })] },
  'magma-hound': { melee: [m('bite', 0.6, 0.5, 0.6, { lunge: 9.5 }), m('bite', 0.5, 0.5, 0.7, { lunge: 7 })] },
  scorpion: { melee: [m('claw', 0.55, 0.5, 0.5, { lunge: 2 }), m('sting', 0.8, 0.55, 0.8, { dmg: 1.35 })] },
  bandit: { melee: [m('slash', 0.5, 0.55, 0.45, { lunge: 2.5 }), m('slash2', 0.5, 0.55, 0.5, { lunge: 2.5 }), m('overhead', 0.75, 0.6, 0.7, { lunge: 3, dmg: 1.3 })] },
  'bandit-archer': { melee: [m('slash', 0.55, 0.55, 0.6, { dmg: 0.7 })], ranged: [m('bow', 0.8, 0.55, 0.6, { ranged: true })] },
  skeleton: { melee: [m('slash', 0.6, 0.55, 0.6, { lunge: 2 }), m('slash2', 0.55, 0.55, 0.65, { lunge: 2 })] },
  drowned: { melee: [m('thrust', 0.7, 0.55, 0.7, { lunge: 4.5 })] },
  'mars-legionary': { melee: [m('combo', 0.6, 1.5, 0.8, { lunge: 2.2, dmg: 0.65 }), m('heavy', 0.8, 0.7, 0.9, { lunge: 3, dmg: 1.5 })] },
  wraith: { melee: [m('claw', 0.5, 0.5, 0.55, { lunge: 3 })], ranged: [m('cast', 0.7, 0.6, 0.6, { ranged: true })] },
  'eye-watcher': { melee: [m('cast', 0.5, 0.5, 0.6)], ranged: [m('cast', 0.75, 0.6, 0.7, { ranged: true })] },
  'fire-imp': { melee: [m('claw', 0.5, 0.45, 0.5, { lunge: 3 })], ranged: [m('throw', 0.6, 0.55, 0.6, { ranged: true })] },
  drake: { melee: [m('bite', 0.65, 0.55, 0.7, { lunge: 6 })], ranged: [m('volley', 0.8, 0.7, 0.8, { ranged: true, shots: 3, dmg: 0.6 })] },
};

/** Colours for affinity effects (boss auras, rune circles, shockwaves). */
export const AFFINITY_COLOR: Record<Affinity, number> = { fire: 0xff5a18, water: 0x40c0ff, wind: 0x8ab8ff, earth: 0x8ed060, dark: 0xa060ff, none: 0xffd080 };

// ------------------------------------------------------------------ actors --

export interface Status {
  bleed: number;
  burn: number;
  wet: number;
  slow: number;
  root: number;
  stun: number;
  fear: number;
  marked: number;
}

const newStatus = (): Status => ({ bleed: 0, burn: 0, wet: 0, slow: 0, root: 0, stun: 0, fear: 0, marked: 0 });
const STATUS_KEYS = Object.keys(newStatus()) as (keyof Status)[];

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export abstract class Actor {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  hp: number;
  maxHp: number;
  radius = 0.6;
  alive = true;
  deadFor = 0;
  status = newStatus();
  /** Damage this creature has dealt to all beings: Blade of Retribution. */
  damageDealt = 0;
  anim = newAnim();
  model: Model;
  /** Animation level of detail: far-away models are posed every few frames. */
  private animTick = Math.floor(Math.random() * 4);
  constructor(model: Model, hp: number) {
    this.model = model;
    this.hp = this.maxHp = hp;
  }
  abstract get name(): string;
  abstract get level(): number;
  abstract get dark(): boolean;
  abstract get affinity(): Affinity;
  get bleeds() {
    return true;
  }
  get height() {
    return this.model.height;
  }
  center(out = new THREE.Vector3()) {
    out.copy(this.pos);
    out.y += this.height * 0.55;
    return out;
  }
  faceTowards(x: number, z: number, dt: number, rate = 8) {
    const target = Math.atan2(x - this.pos.x, z - this.pos.z);
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * rate);
  }
  /** Writes ground speed and the movement direction relative to facing (local +x, +z forward) into the animation state. */
  protected setMotion(vx: number, vz: number) {
    const a = this.anim;
    const sp = Math.hypot(vx, vz);
    a.speed = sp;
    a.moving = Math.min(1, sp / 3);
    if (sp < 0.05) {
      a.moveX = a.moveZ = 0;
      return;
    }
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const k = Math.min(1, sp / 1.5) / sp;
    a.moveX = (vx * c - vz * s) * k;
    a.moveZ = (vx * s + vz * c) * k;
  }
  syncModel(dt: number, stride = 1) {
    this.anim.t += dt;
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    if (stride > 1 && ++this.animTick % stride !== 0) return;
    this.model.animate(this.anim);
  }
}

/** A slot in a walking patrol: follow `anchor` (moved by the spawner) at an offset. */
export interface PatrolSlot {
  anchor: THREE.Vector3;
  ox: number;
  oz: number;
}

type AiState = 'idle' | 'wander' | 'patrol' | 'chase' | 'circle' | 'windup' | 'strike' | 'recover' | 'stagger' | 'flee' | 'return';

export class Enemy extends Actor {
  def: EnemyDef;
  home: THREE.Vector3;
  state: AiState = 'idle';
  stateTime = 0;
  /** 0-1: how close it is to noticing the player. */
  awareness = 0;
  aware = false;
  lostSight = 0;
  attackCd = 1;
  wanderTarget = new THREE.Vector3();
  spawnGroup = -1;
  /** True for minions summoned in a boss fight. */
  summoned = false;
  /** Tamed by a Trainer: it left the wild for good, so its camp won't bring it back. */
  tamed = false;
  hitFlash = 0;
  levelBonus = 0;
  /** Set for members of a walking patrol. */
  patrol: PatrolSlot | null = null;
  /** The move being performed (windup/strike/recover). */
  move: Move | null = null;
  private timing: Timing = { a0: 0, hits: [0.22] };
  private hitIdx = 0;
  private combo = 0;
  /** Circling: -1/1 strafe side, or 0 to back off. */
  private side = 1;
  private circleFor = 0;
  private lastHp: number;
  private poise = 0;
  private staggerFor = 0;
  private staggerImmune = 0;
  private knock = new THREE.Vector3();

  constructor(id: EnemyId, x: number, z: number, model?: Model) {
    const def = ENEMIES[id];
    super(model ?? enemyModel(def), def.hp);
    this.def = def;
    this.pos.set(x, heightAt(x, z), z);
    this.home = this.pos.clone();
    this.radius = 0.55 * def.scale * (def.body === 'quad' || def.body === 'insect' || def.body === 'drake' ? 1.3 : 1);
    this.yaw = Math.random() * Math.PI * 2;
    this.lastHp = this.hp;
    this.combo = Math.floor(Math.random() * 3);
    this.model.root.traverse((o) => (o.castShadow = true));
  }
  get name() {
    return this.def.name;
  }
  get level() {
    return this.def.level + this.levelBonus;
  }
  get dark() {
    return this.def.dark;
  }
  get affinity() {
    return this.def.affinity;
  }
  get bleeds() {
    return this.def.bleeds;
  }
  get flies() {
    return this.def.body === 'floater';
  }
  /** Low on health and fighting: faster and fiercer. */
  get enraged() {
    return this.aware && this.hp < this.maxHp * 0.35;
  }
  /** Stops effects that follow this monster (called when it leaves the world). */
  dispose() {}

  update(dt: number, g: Game) {
    const a = this.anim;
    if (!this.alive) {
      this.deadFor += dt;
      a.dead = this.deadFor;
      a.attack = -1;
      a.windup = 0;
      a.draw = 0;
      this.setMotion(0, 0);
      this.syncModel(dt);
      return;
    }
    const p = g.player;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    this.stateTime += dt;
    this.attackCd -= dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.tickStatus(dt, g);
    this.checkStagger(dt, g, dx, dz, dist);

    // Noticing the player.
    if (!this.aware && p.alive) {
      const facing = Math.cos(Math.atan2(dx, dz) - this.yaw);
      const sight = 30 * (g.isNight ? 0.7 : 1);
      let rate = 0;
      if (dist < sight && (facing > 0.3 || dist < 7) && !g.world.blocked(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) {
        rate = (1.4 * (1 - dist / sight) + (dist < 4 ? 2 : 0)) * p.stealthFactor();
      }
      this.awareness = Math.max(0, Math.min(1, this.awareness + (rate > 0 ? rate * dt : -0.25 * dt)));
      if (this.awareness >= 1) this.becomeAware(g);
    } else if (this.aware) {
      if (dist > 70 || !p.alive || (p.stealthFactor() === 0 && dist > 6)) this.lostSight += dt;
      else this.lostSight = 0;
      if (this.lostSight > 6) {
        this.aware = false;
        this.awareness = 0.3;
        this.endMove();
        this.state = 'return';
      }
    }

    const fury = this.enraged;
    a.fury += ((fury ? 1 : 0) - a.fury) * Math.min(1, dt * 3);
    let speed = this.def.speed * (this.status.slow > 0 ? 0.5 : 1) * (this.status.root > 0 ? 0 : 1) * (fury ? 1.15 : 1);
    let moveX = 0, moveZ = 0;
    // Root motion (lunges, knockback) is added on top of steering.
    let rootX = 0, rootZ = 0;
    const stunned = this.status.stun > 0;
    if (stunned && this.state !== 'stagger') {
      this.endMove();
      this.state = 'recover';
      this.stateTime = 0;
    }

    if (this.state === 'stagger') {
      rootX = this.knock.x;
      rootZ = this.knock.z;
      this.knock.multiplyScalar(Math.max(0, 1 - dt * 6));
      a.hurt = Math.max(a.hurt, 0.8 * (1 - this.stateTime / this.staggerFor));
      if (this.stateTime >= this.staggerFor) this.setState(this.aware ? 'chase' : 'idle');
    } else if (this.status.fear > 0 && !stunned) {
      this.endMove();
      if (this.state === 'windup' || this.state === 'strike') this.setState('chase');
      moveX = -dx / (dist || 1);
      moveZ = -dz / (dist || 1);
      this.faceTowards(this.pos.x + moveX, this.pos.z + moveZ, dt);
    } else if (!stunned) {
      switch (this.state) {
        case 'idle':
          if (this.aware) this.setState('chase');
          else if (this.patrol) this.setState('patrol');
          else if (this.stateTime > 2 + Math.random() * 3) {
            this.setState('wander');
            const ang = Math.random() * Math.PI * 2;
            this.wanderTarget.set(this.home.x + Math.cos(ang) * 8, 0, this.home.z + Math.sin(ang) * 8);
          }
          break;
        case 'wander': {
          if (this.aware) {
            this.setState('chase');
            break;
          }
          const wx = this.wanderTarget.x - this.pos.x, wz = this.wanderTarget.z - this.pos.z;
          const wd = Math.hypot(wx, wz);
          if (wd < 1 || this.stateTime > 8) this.setState('idle');
          else {
            moveX = wx / wd;
            moveZ = wz / wd;
            speed *= 0.35;
            this.faceTowards(this.wanderTarget.x, this.wanderTarget.z, dt, 4);
          }
          break;
        }
        case 'patrol': {
          if (this.aware) {
            this.setState('chase');
            break;
          }
          if (!this.patrol) {
            this.setState('idle');
            break;
          }
          const tx = this.patrol.anchor.x + this.patrol.ox, tz = this.patrol.anchor.z + this.patrol.oz;
          this.home.set(tx, this.pos.y, tz);
          const px = tx - this.pos.x, pz = tz - this.pos.z;
          const pd = Math.hypot(px, pz);
          if (pd > 0.8) {
            moveX = px / pd;
            moveZ = pz / pd;
            // Walk with the band, jog to catch up.
            speed = Math.min(speed, Math.max(1.6, Math.min(pd * 0.9, pd > 5 ? this.def.speed * 0.6 : 2.6)));
            this.faceTowards(tx, tz, dt, 4);
          }
          break;
        }
        case 'return': {
          const hx = this.home.x - this.pos.x, hz = this.home.z - this.pos.z;
          const hd = Math.hypot(hx, hz);
          if (this.aware) this.setState('chase');
          else if (hd < 2) {
            this.setState(this.patrol ? 'patrol' : 'idle');
            this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5);
          } else {
            moveX = hx / hd;
            moveZ = hz / hd;
            speed *= 0.7;
            this.faceTowards(this.home.x, this.home.z, dt);
          }
          break;
        }
        case 'chase': {
          if (!this.aware) {
            this.setState('return');
            break;
          }
          if (this.status.fear <= 0 && g.player.roleId === 'darkslayer' && this.dark && this.hp < this.maxHp * 0.3 && dist < 14) {
            this.status.fear = 4;
            g.fx.damageNumber(this.center(), 'dread', 'info');
          }
          this.faceTowards(p.pos.x, p.pos.z, dt);
          const set = MOVESET[this.def.id];
          const ranged = this.def.ranged;
          const reach = this.def.reach + this.radius + 0.4;
          const melee = set.melee[this.combo % set.melee.length];
          // Lunging biters spring from a little farther out.
          const lungeReach = reach + (melee.lunge ?? 0) * 0.12;
          if (ranged && set.ranged && dist > 5) {
            if (dist > ranged.range) {
              moveX = dx / dist;
              moveZ = dz / dist;
            } else if (this.attackCd <= 0 && !g.world.blocked(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) this.beginMove(set.ranged[0]);
            else if (dist < ranged.range * 0.45) {
              moveX = -dx / dist;
              moveZ = -dz / dist;
              speed *= 0.6;
            } else if (dist > ranged.range * 0.8) {
              moveX = dx / dist;
              moveZ = dz / dist;
              speed *= 0.7;
            } else {
              // Sidestep while reloading.
              moveX = (dz / dist) * this.side;
              moveZ = (-dx / dist) * this.side;
              speed *= 0.35;
            }
          } else if (dist < lungeReach) {
            if (this.attackCd <= 0 && this.mayAttack(g)) this.beginMove(melee);
            else if (dist > reach * 0.6) this.startCircle(dist < reach ? 0.5 : 0.8, Math.random() < 0.25 ? 0 : this.side);
          } else {
            // Shooters too close to shoot back away; everyone else closes in.
            const k = ranged ? -0.7 : 1;
            moveX = (dx / dist) * k;
            moveZ = (dz / dist) * k;
          }
          if (Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z) > 90 && !this.summoned) {
            this.aware = false;
            this.setState('return');
          }
          break;
        }
        case 'circle': {
          if (!this.aware) {
            this.setState('return');
            break;
          }
          this.faceTowards(p.pos.x, p.pos.z, dt, 6);
          const ux = dx / (dist || 1), uz = dz / (dist || 1);
          if (this.side === 0) {
            // Back off a step, guard up.
            moveX = -ux;
            moveZ = -uz;
            speed *= 0.55;
          } else {
            // Strafe around the hero, holding a little distance.
            const want = this.def.reach + this.radius + 1.6;
            const radial = Math.max(-0.6, Math.min(0.6, (dist - want) * 0.4));
            moveX = uz * this.side + ux * radial;
            moveZ = -ux * this.side + uz * radial;
            const l = Math.hypot(moveX, moveZ) || 1;
            moveX /= l;
            moveZ /= l;
            speed *= 0.42;
          }
          const reach = this.def.reach + this.radius + 0.4;
          if (this.stateTime > this.circleFor || (this.attackCd <= 0 && dist < reach && this.stateTime > 0.35 && this.mayAttack(g))) this.setState('chase');
          break;
        }
        case 'windup': {
          const mv = this.move!;
          this.faceTowards(p.pos.x, p.pos.z, dt, mv.ranged ? 6 : 4);
          const w = fury ? Math.max(0.5, mv.windup * 0.85) : mv.windup;
          a.windup = Math.min(1, this.stateTime / w);
          a.attack = -1;
          if (mv.style === 'bow') a.draw = a.windup;
          if (this.stateTime >= w) {
            this.setState('strike');
            this.hitIdx = 0;
            a.attack = this.timing.a0;
            if (mv.style === 'bow') g.audio.play('bow');
            else if (this.model.humanoid && dist < 20) g.audio.play('swing');
          }
          break;
        }
        case 'strike': {
          const mv = this.move!;
          const k = Math.min(1, this.stateTime / mv.strike);
          const hits = this.timing.hits;
          a.attack = this.timing.a0 + (1 - this.timing.a0) * k;
          a.draw = mv.style === 'bow' && k < hits[0] ? 1 : 0;
          // The anticipation has played; the strike curve takes over.
          a.windup = 0;
          if (this.hitIdx === 0) {
            // Track the hero a little until the blow commits.
            this.faceTowards(p.pos.x, p.pos.z, dt, 2);
            if (mv.lunge && dist > this.radius + p.radius + 0.25) {
              rootX = Math.sin(this.yaw) * mv.lunge;
              rootZ = Math.cos(this.yaw) * mv.lunge;
            }
          } else {
            // Multi-hit moves keep pressing forward.
            if (this.hitIdx < hits.length && mv.lunge && dist > this.radius + p.radius + 0.4) {
              this.faceTowards(p.pos.x, p.pos.z, dt, 3);
              rootX = Math.sin(this.yaw) * mv.lunge * 0.8;
              rootZ = Math.cos(this.yaw) * mv.lunge * 0.8;
            }
          }
          while (this.hitIdx < hits.length && k >= hits[this.hitIdx]) {
            this.hitIdx++;
            this.resolveMove(g, mv);
          }
          if (k >= 1) {
            this.setState('recover');
            a.attack = -1;
            a.windup = 0;
          }
          break;
        }
        case 'recover': {
          const r = this.move ? this.move.recover : 0.7;
          if (this.stateTime > r) {
            this.move = null;
            this.afterRecover();
          }
          break;
        }
        case 'flee':
          break;
      }
    }

    if (this.state !== 'windup' && this.state !== 'strike') {
      a.attack = -1;
      a.windup = this.state === 'recover' ? 0 : Math.max(0, a.windup - dt * 6);
      a.draw = 0;
    }

    this.vel.x = moveX * speed + rootX;
    this.vel.z = moveZ * speed + rootZ;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (this.aware && dist < 20) this.separate(g, dist);
    // The trial's fog keeps wandering monsters out of a boss arena.
    const t = g.activeTrial;
    if (t && !this.summoned) {
      const ax = this.pos.x - t.x, az = this.pos.z - t.z, ad = Math.hypot(ax, az), lim = t.radius + 2;
      if (ad < lim && ad > 1e-3) this.pos.set(t.x + (ax / ad) * lim, this.pos.y, t.z + (az / ad) * lim);
    }
    g.world.resolve(this.pos, this.radius);
    const ground = heightAt(this.pos.x, this.pos.z);
    // Most monsters will not wade into deep water; the drowned and floaters will.
    if (ground < WATER_LEVEL - 1.2 && this.def.affinity !== 'water' && !this.flies) {
      this.pos.x -= this.vel.x * dt * 1.5;
      this.pos.z -= this.vel.z * dt * 1.5;
    }
    this.pos.y = Math.max(heightAt(this.pos.x, this.pos.z), this.def.affinity === 'water' ? -3 : WATER_LEVEL - 0.6);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.setMotion(this.vel.x, this.vel.z);
    a.phase += sp * dt * (this.def.body === 'quad' ? 2.2 : 2.6);
    if (this.move) a.attackStyle = this.move.style;
    // Far, unaware monsters are posed less often.
    const lod = this.aware ? 1 : dist > 90 ? 4 : dist > 45 ? 2 : 1;
    this.syncModel(dt, lod);
  }

  becomeAware(g: Game) {
    if (this.aware) return;
    this.aware = true;
    this.awareness = 1;
    if (this.state !== 'stagger') this.setState('chase');
    this.lostSight = 0;
    // A short, staggered reaction so a pack does not strike in unison.
    this.attackCd = Math.max(this.attackCd, 0.3 + Math.random() * 0.6);
    // Pack behaviour: wake nearby kin.
    for (const e of g.enemies) {
      if (e !== this && e.alive && !e.aware && e.pos.distanceTo(this.pos) < 14) {
        e.awareness = Math.max(e.awareness, 0.8);
      }
    }
  }

  protected setState(s: AiState) {
    this.state = s;
    this.stateTime = 0;
  }

  private beginMove(mv: Move) {
    this.move = mv;
    this.timing = strikeTiming(!!this.model.humanoid, mv.style);
    this.anim.attackStyle = mv.style;
    this.setState('windup');
    const set = MOVESET[this.def.id];
    if (!mv.ranged) this.combo++;
    const cd = mv.ranged ? 2.2 + Math.random() * 0.8 : 0.9 + Math.random() * 0.7 + (set.melee.length > 1 ? 0 : 0.3);
    this.attackCd = mv.windup + mv.strike + cd * (this.enraged ? 0.75 : 1);
  }

  private endMove() {
    if (this.state === 'windup' || this.state === 'strike') this.move = null;
    this.anim.attack = -1;
    this.anim.windup = 0;
    this.anim.draw = 0;
  }

  /** Only a couple of monsters swing at the hero at once; the rest circle and wait. */
  private mayAttack(g: Game) {
    let n = 0;
    for (const e of g.enemies) {
      if (e === this || !e.alive || (e.state !== 'windup' && e.state !== 'strike') || e.move?.ranged) continue;
      if (Math.abs(e.pos.x - g.player.pos.x) + Math.abs(e.pos.z - g.player.pos.z) < 14 && ++n >= 2) {
        this.attackCd = 0.25 + Math.random() * 0.4;
        return false;
      }
    }
    return true;
  }

  private startCircle(seconds: number, side: number) {
    this.side = side;
    this.circleFor = seconds * (0.7 + Math.random() * 0.6);
    this.setState('circle');
  }

  /** What to do once a move has played out: press on, circle, or step back. */
  private afterRecover() {
    const id = this.def.id;
    const r = Math.random();
    if (!this.aware) return this.setState('idle');
    this.side = Math.random() < 0.5 ? -1 : 1;
    if (id === 'bandit' || id === 'mars-legionary') {
      if (r < 0.3) return this.startCircle(0.5, 0);
      if (r < 0.65) return this.startCircle(1.3, this.side);
    } else if (id === 'skeleton' || id === 'drowned') {
      if (r < 0.3) return this.startCircle(1.1, this.side);
    } else if (id === 'wolf' || id === 'magma-hound') {
      // Hit and run: hop back, then circle the prey.
      if (r < 0.45) return this.startCircle(0.4, 0);
      if (r < 0.75) return this.startCircle(1.2, this.side);
    } else if (id === 'bandit-archer' || id === 'fire-imp') {
      if (r < 0.5) return this.startCircle(0.9, this.side);
    }
    this.setState('chase');
  }

  private resolveMove(g: Game, mv: Move) {
    const p = g.player;
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const dmg = Math.round(this.damage() * (mv.dmg ?? 1));
    const ranged = this.def.ranged;
    if (mv.ranged && ranged) {
      const shots = mv.shots ?? 1;
      const fwd = _w.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      for (let i = 0; i < shots; i++) {
        const from = this.center().addScaledVector(fwd, this.radius * 0.8);
        from.y += this.height * 0.1;
        const to = p.center();
        // Lead the target a little.
        to.addScaledVector(p.vel, (dist / ranged.speed) * 0.5);
        if (shots > 1) {
          const spread = (i - (shots - 1) / 2) * 0.16;
          _v.subVectors(to, from).applyAxisAngle(THREE.Object3D.DEFAULT_UP, spread);
          to.copy(from).add(_v);
        }
        g.spawnProjectile({ from, to, speed: ranged.speed, kind: ranged.projectile, owner: 'enemy', damage: dmg, element: elementOf(this.def.affinity), source: this, gravity: ranged.projectile === 'arrow' ? 6 : 0 });
      }
      if (mv.style === 'throw' || mv.style === 'cast' || mv.style === 'volley') g.audio.play('throw');
      return;
    }
    const facing = Math.cos(Math.atan2(dx, dz) - this.yaw);
    if (dist < this.def.reach + this.radius + 0.9 && facing > 0.2 && Math.abs(p.pos.y - this.pos.y) < 3) {
      g.damagePlayer(dmg, elementOf(this.def.affinity), this);
    }
  }

  /** Heavy blows (a quarter of its health at once, or a flurry) knock a monster off balance. */
  private checkStagger(dt: number, g: Game, dx: number, dz: number, dist: number) {
    const lost = this.lastHp - this.hp;
    this.lastHp = this.hp;
    this.staggerImmune = Math.max(0, this.staggerImmune - dt);
    this.poise = Math.max(0, this.poise - this.maxHp * 0.3 * dt);
    if (lost <= 0 || this.hp <= 0) return;
    this.poise += lost;
    if (this.staggerImmune > 0 || (lost < this.maxHp * 0.25 && this.poise < this.maxHp * 0.45)) return;
    this.poise = 0;
    this.endMove();
    const beast = this.def.body !== 'humanoid';
    this.staggerFor = this.def.id === 'mars-legionary' ? 0.5 : beast ? 0.55 : 0.7;
    this.staggerImmune = this.staggerFor + 1.2;
    const push = (this.def.id === 'mars-legionary' || this.def.id === 'drake' ? 2 : 4.5) / (dist || 1);
    this.knock.set(-dx * push, 0, -dz * push);
    this.attackCd = Math.max(this.attackCd, this.staggerFor + 0.3);
    this.setState('stagger');
    this.anim.hurt = 1;
    if (!this.flies) g.fx.dust(this.pos, 5);
  }

  /** Keeps a crowd from stacking on one spot (and off the hero). */
  private separate(g: Game, dist: number) {
    for (const o of g.enemies) {
      if (o === this || !o.alive) continue;
      const min = this.radius + o.radius;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      if (Math.abs(ox) > min || Math.abs(oz) > min) continue;
      const d = Math.hypot(ox, oz);
      if (d < min && d > 1e-4) {
        const k = ((min - d) * (o instanceof Boss ? 1 : 0.5)) / d;
        this.pos.x += ox * k;
        this.pos.z += oz * k;
      }
    }
    const p = g.player;
    const min = this.radius + p.radius + 0.1;
    if (dist < min && dist > 1e-4 && Math.abs(p.pos.y - this.pos.y) < 2) {
      const k = (min - dist) / dist;
      this.pos.x -= (p.pos.x - this.pos.x) * k;
      this.pos.z -= (p.pos.z - this.pos.z) * k;
    }
  }

  damage() {
    return Math.round(this.def.damage * (1 + this.levelBonus * 0.12));
  }

  private tickStatus(dt: number, g: Game) {
    const s = this.status;
    for (const k of STATUS_KEYS) s[k] = Math.max(0, s[k] - dt);
    if (s.bleed > 0) g.damageEnemy(this, Math.max(1.5, this.maxHp * 0.025) * dt, 'true', { dot: true });
    if (s.burn > 0) g.damageEnemy(this, 4 * dt * (this.affinity === 'fire' ? 0 : 1), 'fire', { dot: true });
  }
}

export function elementOf(a: Affinity): DamageElement {
  return a === 'none' ? 'physical' : a;
}

// ----------------------------------------------------------------- bosses --

/** Seconds of telegraph (windup), strike and the open window afterwards, per attack. */
const BOSS_TIMING: Record<BossAttack, { w: number; s: number; r: number }> = {
  sweep: { w: 0.8, s: 0.75, r: 0.9 },
  combo: { w: 0.55, s: 1.7, r: 1.1 },
  charge: { w: 0.85, s: 1.25, r: 1.1 },
  slam: { w: 1.0, s: 0.8, r: 1.1 },
  ring: { w: 1.2, s: 0.8, r: 1.2 },
  volley: { w: 0.7, s: 1.2, r: 0.9 },
  strikes: { w: 0.9, s: 1.1, r: 1.0 },
  summon: { w: 0.9, s: 1.0, r: 1.2 },
  teleport: { w: 0.6, s: 0.25, r: 0 },
  leap: { w: 0.75, s: 1.2, r: 1.3 },
};

type Stage = 'windup' | 'strike' | 'recover';
type TelegraphHandle = ReturnType<Game['fx']['telegraph']>;

export class Boss extends Enemy {
  bdef: BossDef;
  phase = 1;
  attack: BossAttack | null = null;
  /** Seconds into the current attack (all stages). */
  attackTime = 0;
  stage: Stage = 'windup';
  stageTime = 0;
  hits = 0;
  cooldown = 0.8;
  chargeDir = new THREE.Vector3();
  leapFrom = new THREE.Vector3();
  leapTo = new THREE.Vector3();
  arena: { x: number; z: number; radius: number };
  /** Seconds left of the opening roar (or the phase-two roar). */
  roarLeft = 1.6;
  private roarDur = 1.6;
  private roared = false;
  private fired = 0;
  private dur = { w: 1, s: 1, r: 1 };
  private btiming: Timing = { a0: 0, hits: [0.2] };
  private last: BossAttack | null = null;
  private dustT = 0;
  private telegraphs: TelegraphHandle[] = [];
  private auraFx: { stop(): void } | null = null;
  private bossPoise = 0;
  private bossStagger = 0;
  private bossStaggerImmune = 0;
  private bossLastHp: number;
  private strafeSide = 1;

  constructor(def: BossDef, arena: { x: number; z: number; radius: number }) {
    super('wolf', arena.x, arena.z - arena.radius * 0.5, bossModel(def));
    this.bdef = def;
    this.arena = arena;
    this.hp = this.maxHp = def.hp;
    this.bossLastHp = this.hp;
    this.radius = def.model === 'crab' ? 3.2 : def.model === 'stag' ? 2.2 : 0.55 * def.scale + 0.4;
    this.aware = true;
    this.state = 'chase';
    this.summoned = true;
    this.anim.attackStyle = 'roar';
  }
  get name() {
    return this.bdef.name;
  }
  get level() {
    return this.bdef.level;
  }
  get dark() {
    return this.bdef.dark;
  }
  get affinity() {
    return this.bdef.affinity;
  }
  get bleeds() {
    return this.bdef.model !== 'witch' && this.bdef.model !== 'golem' && this.bdef.model !== 'colossus';
  }
  get flies() {
    return this.bdef.model === 'witch';
  }
  get enraged() {
    return this.phase === 2;
  }
  get color() {
    return AFFINITY_COLOR[this.bdef.affinity];
  }
  damage() {
    return Math.round(this.bdef.damage * (this.phase === 2 ? 1.15 : 1));
  }
  dispose() {
    this.auraFx?.stop();
    this.auraFx = null;
    this.cancelTelegraphs();
  }

  update(dt: number, g: Game) {
    const a = this.anim;
    if (!this.alive) {
      if (this.auraFx) this.dispose();
      this.model.root.visible = true;
      this.deadFor += dt;
      a.dead = this.deadFor;
      a.attack = -1;
      a.windup = 0;
      this.setMotion(0, 0);
      this.syncModel(dt);
      return;
    }
    const p = g.player;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    for (const k of STATUS_KEYS) this.status[k] = Math.max(0, this.status[k] - dt);
    if (this.status.bleed > 0) g.damageEnemy(this, 6 * dt, 'true', { dot: true });
    if (this.status.burn > 0 && this.affinity !== 'fire') g.damageEnemy(this, 6 * dt, 'fire', { dot: true });
    this.checkPoise(dt, g);

    if (this.phase === 1 && this.hp < this.maxHp * 0.5) {
      this.phase = 2;
      g.hud.toast(`${this.bdef.name} is enraged!`, 'boss');
      g.fx.ring(this.center(), 10, 0xff4020, 0.8);
      g.audio.play('roar');
      g.shake(0.5);
      this.auraFx = g.fx.aura(this.model.root, this.color, 3600);
      // Roar into the second phase once the current move is done.
      if (!this.attack || this.stage === 'recover') this.startRoar(1.2);
    }
    a.fury += ((this.phase === 2 ? 1 : 0) - a.fury) * Math.min(1, dt * 2);
    const speedMul = (this.phase === 2 ? 1.25 : 1) * (this.status.slow > 0 ? 0.6 : 1) * (this.status.root > 0 ? 0 : 1);
    let moveX = 0, moveZ = 0;
    let speed = this.bdef.speed * speedMul;
    a.attack = -1;
    a.windup = 0;

    if (this.bossStagger > 0) {
      // Stance broken: reeling and open (any roar waits until it recovers).
      this.bossStagger -= dt;
      a.hurt = Math.max(a.hurt, 0.9);
    } else if (this.roarLeft > 0) {
      // The opening (or enraged) roar: rear up and bellow before fighting.
      this.roarLeft -= dt;
      const k = 1 - Math.max(0, this.roarLeft) / this.roarDur;
      a.attackStyle = 'roar';
      a.attack = Math.min(0.999, k);
      this.faceTowards(p.pos.x, p.pos.z, dt, 3);
      if (!this.roared && k > 0.38) {
        this.roared = true;
        g.shake(0.45);
        g.fx.ring(this.center(), 7, this.color, 0.7);
        g.fx.dust(this.pos, 24);
      }
      if (this.roarLeft <= 0) {
        a.attack = -1;
        this.cooldown = 0.4;
      }
    } else if (this.status.stun > 0) {
      // Stunned: stands open.
    } else if (!this.attack) {
      this.cooldown -= dt * (this.phase === 2 ? 1.4 : 1);
      this.faceTowards(p.pos.x, p.pos.z, dt, 4);
      const close = this.radius + 4;
      if (dist > close + 2) {
        moveX = dx / dist;
        moveZ = dz / dist;
      } else if (dist > 0.1) {
        // Prowl around the hero between attacks.
        moveX = (dz / dist) * this.strafeSide;
        moveZ = (-dx / dist) * this.strafeSide;
        if (dist < close - 1.5) (moveX -= dx / dist), (moveZ -= dz / dist);
        speed *= 0.35;
      }
      if (this.cooldown <= 0 && p.alive) this.chooseAttack(dist, g);
    } else {
      const r = this.runAttack(dt, g, dist);
      moveX = r[0];
      moveZ = r[1];
      speed = r[2];
    }

    const vx = moveX * speed, vz = moveZ * speed;
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;
    // Stay inside the arena.
    const ax = this.pos.x - this.arena.x, az = this.pos.z - this.arena.z;
    const ad = Math.hypot(ax, az);
    if (ad > this.arena.radius - this.radius) {
      this.pos.x = this.arena.x + (ax / ad) * (this.arena.radius - this.radius);
      this.pos.z = this.arena.z + (az / ad) * (this.arena.radius - this.radius);
    }
    if (!(this.attack === 'leap' && this.stage === 'strike')) this.pos.y = heightAt(this.pos.x, this.pos.z) + (this.flies ? 0.3 : 0);
    this.setMotion(vx, vz);
    a.phase += Math.hypot(vx, vz) * dt * 1.4;
    this.syncModel(dt);
  }

  private startRoar(seconds: number) {
    this.roarLeft = this.roarDur = seconds;
    this.roared = false;
    this.attack = null;
    this.model.root.visible = true;
  }

  /** Bosses ignore small hits, but a burst of damage breaks their stance and leaves them open. */
  private checkPoise(dt: number, g: Game) {
    const lost = this.bossLastHp - this.hp;
    this.bossLastHp = this.hp;
    this.bossStaggerImmune = Math.max(0, this.bossStaggerImmune - dt);
    this.bossPoise = Math.max(0, this.bossPoise - this.maxHp * 0.04 * dt);
    if (lost <= 0) return;
    this.bossPoise += lost;
    if (this.bossPoise < this.maxHp * 0.12 || this.bossStaggerImmune > 0 || this.roarLeft > 0) return;
    if (this.attack === 'leap' && this.stage === 'strike') return;
    this.bossPoise = 0;
    this.bossStagger = 1.5;
    this.bossStaggerImmune = 12;
    this.cancelTelegraphs();
    this.model.root.visible = true;
    this.attack = null;
    this.cooldown = 0.5;
    this.anim.hurt = 1;
    g.fx.damageNumber(this.center().add(_v.set(0, this.height * 0.5, 0)), 'STAGGERED', 'crit');
    g.fx.dust(this.pos, 18);
    g.shake(0.3);
  }

  private cancelTelegraphs() {
    // Visual-only circles: let them vanish now.
    for (const t of this.telegraphs) if (!t.done && !t.onDone) t.age = t.delay;
    this.telegraphs.length = 0;
  }

  private chooseAttack(dist: number, g: Game) {
    const near = dist < this.radius + 6;
    const options = this.bdef.attacks.filter((a) => {
      if (a === 'sweep' || a === 'combo') return near;
      if (a === 'charge' || a === 'leap') return dist > 8;
      if (a === 'summon') return g.enemies.filter((e) => e.summoned && e.alive && !(e instanceof Boss)).length < 3;
      return true;
    });
    if (!options.length) return;
    // Avoid the same move twice in a row when there is a choice.
    const pool = options.length > 1 ? options.filter((a) => a !== this.last) : options;
    this.begin(pool[Math.floor(Math.random() * pool.length)], g);
  }

  private begin(attack: BossAttack, g: Game, windup?: number) {
    const p = g.player;
    const base = BOSS_TIMING[attack];
    const two = this.phase === 2;
    this.attack = this.last = attack;
    this.attackTime = 0;
    this.stage = 'windup';
    this.stageTime = 0;
    this.hits = 0;
    this.fired = 0;
    this.dustT = 0;
    this.telegraphs.length = 0;
    this.dur = { w: windup ?? base.w * (two ? 0.8 : 1), s: base.s * (two ? 0.9 : 1), r: base.r * (two ? 0.7 : 1) };
    this.btiming = strikeTiming(!!this.model.humanoid, attack);
    this.anim.attackStyle = attack;
    this.strafeSide = Math.random() < 0.5 ? -1 : 1;
    const { w, s } = this.dur;
    const landAt = w + this.btiming.hits[0] * s;
    const feet = _v.copy(this.pos);
    switch (attack) {
      case 'charge':
        this.chargeDir.set(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z).normalize();
        break;
      case 'leap':
        this.leapFrom.copy(this.pos);
        this.leapTo.copy(p.pos);
        this.telegraphs.push(g.fx.telegraph(this.leapTo.x, this.leapTo.z, 5, landAt));
        break;
      case 'slam':
        this.leapTo.copy(p.pos);
        this.telegraphs.push(g.fx.telegraph(p.pos.x, p.pos.z, 4.5, landAt));
        break;
      case 'ring':
        this.telegraphs.push(g.fx.telegraph(this.pos.x, this.pos.z, 10, landAt, 0xffa020));
        g.fx.magicCircle(feet, this.color, 4.5, w + s * 0.5);
        break;
      case 'summon':
        g.fx.magicCircle(feet, this.color, 5, w + s);
        break;
      case 'strikes': {
        g.fx.magicCircle(feet, 0x80b0ff, 4, w + s);
        const n = this.phase === 2 ? 7 : 5;
        for (let i = 0; i < n; i++) {
          const ang = Math.random() * Math.PI * 2;
          const r = i === 0 ? 0 : 3 + Math.random() * 8;
          const x = p.pos.x + Math.cos(ang) * r;
          const z = p.pos.z + Math.sin(ang) * r;
          // The first bolt falls as the arm comes down, the rest ripple outward.
          g.fx.telegraph(x, z, 3, landAt + 0.15 + i * 0.14, 0x80b0ff, () => {
            if (!this.alive) return;
            const at = new THREE.Vector3(x, heightAt(x, z), z);
            g.fx.lightning(at.clone().add(new THREE.Vector3(0, 30, 0)), at);
            g.fx.impact(at, 0x9fc8ff, 0.6);
            if (Math.hypot(g.player.pos.x - x, g.player.pos.z - z) < 3.2 && g.player.pos.y - at.y < 3) g.damagePlayer(this.damage(), 'lightning', this);
            g.audio.play('slam');
          });
        }
        break;
      }
      case 'teleport':
        g.fx.magicCircle(feet, this.color, 3, w + 0.2);
        break;
    }
    g.audio.play('windup');
  }

  /** Advances the current attack; returns [moveX, moveZ, speed]. */
  private runAttack(dt: number, g: Game, dist: number): [number, number, number] {
    const p = g.player;
    const a = this.anim;
    const { w, s, r } = this.dur;
    this.attackTime += dt;
    this.stageTime += dt;
    if (this.stage === 'windup' && this.stageTime >= w) {
      this.stage = 'strike';
      this.stageTime = 0;
      if (this.attack === 'charge') this.chargeDir.set(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z).normalize();
      if (this.attack === 'sweep' || this.attack === 'combo') g.audio.play('swing');
      if (this.attack === 'teleport') return this.teleport(g);
    } else if (this.stage === 'strike' && this.stageTime >= s) {
      this.stage = 'recover';
      this.stageTime = 0;
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
      a.attack = this.btiming.a0 + (1 - this.btiming.a0) * k;
    } else {
      // Recovery: the boss is open.
      a.windup = 0;
      a.attack = -1;
    }
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    const reach = this.radius + 4.5;
    const swingHit = () => {
      const facing = Math.cos(Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) - this.yaw);
      if (dist < reach && facing > -0.1) g.damagePlayer(this.damage(), elementOf(this.affinity), this);
      const at = this.center().add(_w.set(fwdX, 0, fwdZ).multiplyScalar(this.radius + 2));
      g.fx.impact(at, this.color, 0.5);
    };
    const groundAt = (x: number, z: number) => _w.set(x, heightAt(x, z) + 0.2, z);

    switch (this.attack) {
      case 'sweep':
        if (this.stage === 'windup') this.faceTowards(p.pos.x, p.pos.z, dt, 3);
        if (this.stage === 'strike' && this.hits === 0 && k >= hits[0]) {
          this.hits = 1;
          swingHit();
        }
        return this.stage === 'strike' && this.hits === 0 ? [fwdX, fwdZ, 2] : [0, 0, 0];
      case 'combo': {
        if (this.stage === 'recover') return [0, 0, 0];
        this.faceTowards(p.pos.x, p.pos.z, dt, this.stage === 'windup' ? 4 : 5);
        if (this.stage === 'strike') {
          while (this.hits < hits.length && k >= hits[this.hits]) {
            this.hits++;
            swingHit();
            g.audio.play('swing');
          }
          return [fwdX, fwdZ, this.hits < hits.length && dist > this.radius + 1.5 ? 2.5 : 0];
        }
        return [0, 0, 0];
      }
      case 'charge':
        if (this.stage === 'windup') {
          this.faceTowards(p.pos.x, p.pos.z, dt, 6);
          if (t > w * 0.6 && this.hits === 0) {
            // Paw the ground.
            this.dustT -= dt;
            if (this.dustT <= 0) (this.dustT = 0.18), g.fx.dust(this.pos, 3);
          }
          return [0, 0, 0];
        }
        if (this.stage === 'strike') {
          this.yaw = Math.atan2(this.chargeDir.x, this.chargeDir.z);
          if (dist < this.radius + 1.5 && this.hits === 0) {
            this.hits = 1;
            g.damagePlayer(Math.round(this.damage() * 1.2), 'physical', this);
            g.player.knockback(this.chargeDir, 12);
            g.fx.impact(p.center(), 0xe0d0b0, 0.9);
            g.shake(0.4);
          }
          this.dustT -= dt;
          if (this.dustT <= 0) {
            this.dustT = 0.1;
            g.fx.dust(this.pos, 6);
          }
          // Stop short at the arena wall.
          const ex = this.pos.x + this.chargeDir.x * 2 - this.arena.x, ez = this.pos.z + this.chargeDir.z * 2 - this.arena.z;
          if (Math.hypot(ex, ez) > this.arena.radius - this.radius) this.stageTime = Math.max(this.stageTime, s);
          return [this.chargeDir.x, this.chargeDir.z, this.bdef.speed * 3.2];
        }
        // Skid to a halt.
        return t < 0.35 ? [this.chargeDir.x, this.chargeDir.z, this.bdef.speed * 3.2 * (1 - t / 0.35)] : [0, 0, 0];
      case 'slam': {
        if (this.stage === 'windup') {
          this.faceTowards(this.leapTo.x, this.leapTo.z, dt, 4);
          // Close in on a distant target while raising the blow.
          const td = Math.hypot(this.leapTo.x - this.pos.x, this.leapTo.z - this.pos.z);
          return td > this.radius + 5 ? [(this.leapTo.x - this.pos.x) / td, (this.leapTo.z - this.pos.z) / td, this.bdef.speed * 0.8] : [0, 0, 0];
        }
        if (this.stage === 'strike' && this.hits === 0 && k >= hits[0]) {
          this.hits = 1;
          const hit = Math.hypot(p.pos.x - this.leapTo.x, p.pos.z - this.leapTo.z) < 4.5;
          if (hit) g.damagePlayer(Math.round(this.damage() * 1.3), elementOf(this.affinity), this);
          const at = groundAt(this.leapTo.x, this.leapTo.z);
          if (this.bdef.projectile === 'water') g.fx.spikes(at.x, at.z, 0x40c0ff, 9, 3.5);
          else g.fx.ring(at, 4.5, this.affinity === 'fire' ? 0xff5010 : 0xd8c8a0, 0.5);
          g.fx.impact(at, this.color, 1);
          g.fx.dust(at, 22);
          g.shake(0.5);
          g.audio.play('slam');
        }
        return [0, 0, 0];
      }
      case 'ring':
        if (this.stage === 'strike' && this.hits === 0 && k >= hits[0]) {
          this.hits = 1;
          if (dist < 10 + p.radius) g.damagePlayer(Math.round(this.damage() * 1.1), elementOf(this.affinity), this);
          g.fx.ring(this.center(), 10, this.color, 0.6);
          g.fx.impact(groundAt(this.pos.x, this.pos.z), this.color, 1);
          for (let i = 0; i < 8; i++) {
            const ang = (i / 8) * Math.PI * 2;
            g.fx.dust(groundAt(this.pos.x + Math.cos(ang) * 4, this.pos.z + Math.sin(ang) * 4), 3);
          }
          g.shake(0.6);
          g.audio.play('slam');
        }
        return [0, 0, 0];
      case 'volley': {
        this.faceTowards(p.pos.x, p.pos.z, dt, 4);
        if (this.stage !== 'strike') return [0, 0, 0];
        const shots = this.phase === 2 ? 7 : 5;
        const p0 = hits[0];
        while (this.fired < shots && k >= p0 + (this.fired / shots) * 0.55) {
          const spread = (this.fired - (shots - 1) / 2) * 0.12;
          const from = this.center();
          from.y += this.height * 0.2;
          const dir = new THREE.Vector3(p.pos.x - from.x, p.center(_w).y - from.y, p.pos.z - from.z).normalize();
          dir.applyAxisAngle(THREE.Object3D.DEFAULT_UP, spread);
          const to = from.clone().addScaledVector(dir, 40);
          const kind = this.bdef.projectile === 'lightning' ? 'orb' : this.bdef.projectile;
          g.spawnProjectile({ from, to, speed: 24, kind, owner: 'enemy', damage: Math.round(this.damage() * 0.6), element: elementOf(this.affinity), source: this, gravity: kind === 'arrow' ? 3 : 0 });
          this.fired++;
          this.hits = 1;
        }
        return [0, 0, 0];
      }
      case 'strikes':
        // The telegraphs deal the damage when they fill.
        if (this.stage === 'windup') this.faceTowards(p.pos.x, p.pos.z, dt, 3);
        if (this.stage === 'strike' && k >= hits[0]) this.hits = 1;
        return [0, 0, 0];
      case 'summon':
        if (this.stage === 'strike' && this.hits === 0 && k >= hits[0]) {
          this.hits = 1;
          if (this.bdef.summon) {
            for (let i = 0; i < (this.phase === 2 ? 3 : 2); i++) {
              const ang = Math.random() * Math.PI * 2;
              const x = this.pos.x + Math.cos(ang) * 5, z = this.pos.z + Math.sin(ang) * 5;
              const e = g.spawnEnemy(this.bdef.summon, x, z);
              e.summoned = true;
              e.aware = true;
              e.state = 'chase';
              e.attackCd = 1 + Math.random();
              g.fx.magicCircle(e.pos, this.color, 1.6, 1.2);
              g.fx.emit(e.center(), { color: 0xa070ff, count: 25, speed: 4, life: 0.6 });
            }
          }
          g.shake(0.25);
        }
        return [0, 0, 0];
      case 'teleport':
        // Flicker out during the windup.
        this.model.root.visible = this.stage !== 'windup' || Math.floor(t * 20) % 2 === 0;
        return [0, 0, 0];
      case 'leap': {
        if (this.stage === 'windup') {
          this.faceTowards(this.leapTo.x, this.leapTo.z, dt, 5);
          return [0, 0, 0];
        }
        if (this.stage === 'strike') {
          const land = Math.max(0.05, hits[0]);
          const q = Math.min(1, k / land);
          this.pos.lerpVectors(this.leapFrom, this.leapTo, q);
          this.pos.y = heightAt(this.pos.x, this.pos.z) + Math.sin(q * Math.PI) * 10;
          if (q >= 1 && this.hits === 0) {
            this.hits = 1;
            if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 5) g.damagePlayer(Math.round(this.damage() * 1.4), elementOf(this.affinity), this);
            const at = groundAt(this.pos.x, this.pos.z);
            g.fx.ring(at, 5, 0xffa040, 0.5);
            g.fx.impact(at, this.color, 1);
            g.fx.dust(at, 30);
            g.shake(0.8);
            g.audio.play('slam');
          }
        }
        return [0, 0, 0];
      }
      default:
        this.attack = null;
        this.cooldown = 1;
        return [0, 0, 0];
    }
  }

  /** Vanish, reappear behind the hero and strike at once. */
  private teleport(g: Game): [number, number, number] {
    const p = g.player;
    g.fx.emit(this.center(), { color: 0x8040ff, count: 40, speed: 6, life: 0.6 });
    const behind = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    let x = p.pos.x + Math.sin(behind) * 4, z = p.pos.z + Math.cos(behind) * 4;
    // Keep the landing spot inside the arena.
    const ax = x - this.arena.x, az = z - this.arena.z, ad = Math.hypot(ax, az), lim = this.arena.radius - this.radius;
    if (ad > lim) (x = this.arena.x + (ax / ad) * lim), (z = this.arena.z + (az / ad) * lim);
    this.pos.set(x, heightAt(x, z), z);
    this.yaw = Math.atan2(p.pos.x - x, p.pos.z - z);
    this.model.root.visible = true;
    g.fx.emit(this.center(), { color: 0x8040ff, count: 40, speed: 6, life: 0.6 });
    g.fx.magicCircle(this.pos, this.color, 2.5, 0.8);
    this.begin('sweep', g, this.phase === 2 ? 0.4 : 0.5);
    this.last = 'teleport';
    return [0, 0, 0];
  }
}

// ------------------------------------------------------------------ allies --

export type AllyKind = CreatureKind | 'imp' | 'lizard';

export class Ally extends Actor {
  kind: AllyKind;
  ttl: number;
  attackCd = 0;
  target: Enemy | null = null;
  baseDamage: number;
  ranged: boolean;
  speed: number;
  /** Seconds left of the current attack (0 when idle). */
  attacking = 0;
  private lvl: number;
  private struck = false;
  private static readonly ATTACK = 0.6;

  constructor(kind: AllyKind, x: number, z: number, level: number, ttl = Infinity, hpMul = 1, dmgMul = 1) {
    const model = allyModel(kind);
    const def = kind === 'imp' || kind === 'lizard' ? null : ENEMIES[kind === 'magma-hound' ? 'magma-hound' : kind];
    const hp = def ? def.hp * 1.5 : kind === 'imp' ? 60 : 40;
    super(model, Math.round(hp * hpMul));
    this.kind = kind;
    this.ttl = ttl;
    this.lvl = level;
    this.baseDamage = (def ? def.damage : kind === 'imp' ? 9 : 6) * dmgMul * (1 + level * 0.06);
    this.ranged = kind === 'imp' || kind === 'drake';
    this.speed = def ? def.speed * 1.1 : 8;
    this.pos.set(x, heightAt(x, z), z);
    this.radius = 0.5;
    this.anim.attackStyle = this.ranged ? (kind === 'imp' ? 'throw' : 'volley') : kind === 'scorpion' ? 'sting' : 'bite';
  }
  get name() {
    return this.kind;
  }
  get level() {
    return this.lvl;
  }
  get dark() {
    return false;
  }
  get affinity(): Affinity {
    return this.kind === 'imp' || this.kind === 'magma-hound' || this.kind === 'drake' ? 'fire' : 'none';
  }

  update(dt: number, g: Game) {
    if (!this.alive) return;
    this.ttl -= dt;
    this.attackCd -= dt;
    const p = g.player;
    if (!this.target || !this.target.alive || this.target.pos.distanceTo(p.pos) > 30) {
      this.target = null;
      let best = 22;
      for (const e of g.enemies) {
        if (!e.alive || !e.aware) continue;
        const d = e.pos.distanceTo(this.pos);
        if (d < best) (best = d), (this.target = e);
      }
    }
    let goal = p.pos;
    let stopAt = 3.5;
    if (this.target) {
      goal = this.target.pos;
      stopAt = this.ranged ? 12 : this.target.radius + this.radius + 1.2;
    }
    const dx = goal.x - this.pos.x;
    const dz = goal.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    let mx = 0, mz = 0;
    if (d > stopAt && this.attacking <= 0) {
      mx = dx / d;
      mz = dz / d;
    }
    if (d > 40) this.pos.set(p.pos.x - 2, p.pos.y, p.pos.z - 2);
    const sp = this.speed * (d > 10 && !this.target ? 1.6 : 1);
    this.pos.x += mx * sp * dt;
    this.pos.z += mz * sp * dt;
    g.world.resolve(this.pos, this.radius);
    const ground = heightAt(this.pos.x, this.pos.z);
    this.pos.y = this.kind === 'imp' ? Math.max(ground, 0) + 1.6 + Math.sin(this.anim.t * 3) * 0.2 : Math.max(ground, WATER_LEVEL - 0.6);
    this.faceTowards(goal.x, goal.z, dt);
    if (this.target && d <= stopAt + 0.5 && this.attackCd <= 0 && this.attacking <= 0) {
      this.attackCd = this.ranged ? 1.6 : 1.1;
      this.attacking = Ally.ATTACK;
      this.struck = false;
    }
    // The blow lands partway through the move, in time with the animation.
    const k = this.attacking > 0 ? 1 - this.attacking / Ally.ATTACK : -1;
    if (k >= (this.ranged ? 0.4 : 0.6) && !this.struck && this.target?.alive) {
      this.struck = true;
      if (this.ranged) {
        g.spawnProjectile({ from: this.center(), to: this.target.center(), speed: 26, kind: 'fireball', owner: 'ally', damage: Math.round(this.baseDamage), element: 'fire', source: this, gravity: 0 });
      } else {
        g.damageEnemy(this.target, this.baseDamage, this.affinity === 'fire' ? 'fire' : 'physical', { source: 'ally' });
      }
    }
    this.attacking = Math.max(0, this.attacking - dt);
    this.setMotion(mx * sp, mz * sp);
    this.anim.phase += this.anim.moving * dt * 8;
    this.anim.attack = k;
    this.syncModel(dt);
    if (this.ttl <= 0) this.alive = false;
  }
}

export function allyModel(kind: AllyKind): Model {
  switch (kind) {
    case 'imp':
      return creatureModel(buildImp(0xc04a20, 0.8));
    case 'lizard': {
      const rig = buildQuad(0x3a5a3a, 'drake', 0.45);
      return creatureModel(rig);
    }
    case 'wolf':
      return creatureModel(buildQuad(0x8a8478, 'wolf', 1));
    case 'boar':
      return creatureModel(buildQuad(0x6a4a30, 'boar', 1.1));
    case 'magma-hound':
      return creatureModel(buildQuad(0x3a2018, 'hound', 1.2));
    case 'scorpion':
      return creatureModel(buildInsect(0x8a6a3a, 1.1));
    case 'drake':
      return creatureModel(buildQuad(0x4a2a24, 'drake', 1.2));
  }
}
