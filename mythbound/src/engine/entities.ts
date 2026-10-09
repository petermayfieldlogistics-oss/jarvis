import * as THREE from 'three';
import { ENEMIES, type Affinity, type BossAttack, type BossDef, type EnemyDef, type EnemyId } from '../data/world';
import type { CreatureKind, DamageElement } from '../data/defs';
import { buildShield, buildWeapon, compact } from './models';
import { animateHumanoid, buildBossHumanoid, buildHumanoid, type Rig } from './humanoid';
import { animateCreature, buildCrab, buildFloater, buildImp, buildInsect, buildQuad, type CreatureRig } from './creatures';
import { newAnim, type AnimState } from './anim';
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
    return out.copy(this.pos).add(new THREE.Vector3(0, this.height * 0.55, 0));
  }
  faceTowards(x: number, z: number, dt: number, rate = 8) {
    const target = Math.atan2(x - this.pos.x, z - this.pos.z);
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * rate);
  }
  syncModel(dt: number) {
    this.anim.t += dt;
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    this.model.animate(this.anim);
  }
}

type AiState = 'idle' | 'wander' | 'chase' | 'windup' | 'recover' | 'flee' | 'return';

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
  hitFlash = 0;
  levelBonus = 0;

  constructor(id: EnemyId, x: number, z: number) {
    const def = ENEMIES[id];
    super(enemyModel(def), def.hp);
    this.def = def;
    this.pos.set(x, heightAt(x, z), z);
    this.home = this.pos.clone();
    this.radius = 0.55 * def.scale * (def.body === 'quad' || def.body === 'insect' || def.body === 'drake' ? 1.3 : 1);
    this.yaw = Math.random() * Math.PI * 2;
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

  update(dt: number, g: Game) {
    if (!this.alive) {
      this.deadFor += dt;
      this.anim.dead = this.deadFor;
      this.anim.attack = -1;
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
      if (dist > 70 || !p.alive || p.stealthFactor() === 0 && dist > 6) this.lostSight += dt;
      else this.lostSight = 0;
      if (this.lostSight > 6) {
        this.aware = false;
        this.awareness = 0.3;
        this.state = 'return';
      }
    }

    let speed = this.def.speed * (this.status.slow > 0 ? 0.5 : 1) * (this.status.root > 0 ? 0 : 1);
    let moveX = 0, moveZ = 0;
    const stunned = this.status.stun > 0;
    if (stunned) {
      this.state = 'recover';
      this.anim.attack = -1;
    }

    if (this.status.fear > 0 && !stunned) {
      moveX = -dx / (dist || 1);
      moveZ = -dz / (dist || 1);
      this.faceTowards(this.pos.x + moveX, this.pos.z + moveZ, dt);
    } else if (!stunned) {
      switch (this.state) {
        case 'idle':
          if (this.aware) this.state = 'chase';
          else if (this.stateTime > 2 + Math.random() * 3) {
            this.state = 'wander';
            this.stateTime = 0;
            const a = Math.random() * Math.PI * 2;
            this.wanderTarget.set(this.home.x + Math.cos(a) * 8, 0, this.home.z + Math.sin(a) * 8);
          }
          break;
        case 'wander': {
          if (this.aware) {
            this.state = 'chase';
            break;
          }
          const wx = this.wanderTarget.x - this.pos.x, wz = this.wanderTarget.z - this.pos.z;
          const wd = Math.hypot(wx, wz);
          if (wd < 1 || this.stateTime > 8) {
            this.state = 'idle';
            this.stateTime = 0;
          } else {
            moveX = wx / wd;
            moveZ = wz / wd;
            speed *= 0.35;
            this.faceTowards(this.wanderTarget.x, this.wanderTarget.z, dt, 4);
          }
          break;
        }
        case 'return': {
          const hx = this.home.x - this.pos.x, hz = this.home.z - this.pos.z;
          const hd = Math.hypot(hx, hz);
          if (this.aware) this.state = 'chase';
          else if (hd < 2) {
            this.state = 'idle';
            this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5);
          } else {
            moveX = hx / hd;
            moveZ = hz / hd;
            this.faceTowards(this.home.x, this.home.z, dt);
          }
          break;
        }
        case 'chase': {
          if (!this.aware) {
            this.state = 'return';
            break;
          }
          if (this.status.fear <= 0 && g.player.roleId === 'darkslayer' && this.dark && this.hp < this.maxHp * 0.3 && dist < 14) {
            this.status.fear = 4;
            g.fx.damageNumber(this.center(), 'dread', 'info');
          }
          this.faceTowards(p.pos.x, p.pos.z, dt);
          const ranged = this.def.ranged;
          if (ranged && dist < ranged.range && dist > 5) {
            if (this.attackCd <= 0) this.beginAttack();
            else if (dist < ranged.range * 0.45) {
              moveX = -dx / dist;
              moveZ = -dz / dist;
              speed *= 0.6;
            }
          } else if (dist < this.def.reach + this.radius + 0.4) {
            if (this.attackCd <= 0) this.beginAttack();
          } else {
            moveX = dx / dist;
            moveZ = dz / dist;
          }
          if (Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z) > 90 && !this.summoned) {
            this.aware = false;
            this.state = 'return';
          }
          break;
        }
        case 'windup': {
          this.faceTowards(p.pos.x, p.pos.z, dt, 3);
          const windup = 0.6;
          this.anim.attack = Math.min(1, this.stateTime / (windup + 0.3));
          if (this.stateTime >= windup && !this.anim.blocking) {
            this.anim.blocking = true; // reused as "attack resolved" flag
            this.resolveAttack(g, dist);
          }
          if (this.stateTime >= windup + 0.3) {
            this.state = 'recover';
            this.stateTime = 0;
            this.anim.attack = -1;
            this.anim.blocking = false;
          }
          break;
        }
        case 'recover':
          if (this.stateTime > 0.7) {
            this.state = this.aware ? 'chase' : 'idle';
            this.stateTime = 0;
          }
          break;
        case 'flee':
          break;
      }
    }

    this.vel.x = moveX * speed;
    this.vel.z = moveZ * speed;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    g.world.resolve(this.pos, this.radius);
    const ground = heightAt(this.pos.x, this.pos.z);
    // Most monsters will not wade into deep water; the drowned and floaters will.
    if (ground < WATER_LEVEL - 1.2 && this.def.affinity !== 'water' && !this.flies) {
      this.pos.x -= this.vel.x * dt * 1.5;
      this.pos.z -= this.vel.z * dt * 1.5;
    }
    this.pos.y = Math.max(heightAt(this.pos.x, this.pos.z), this.def.affinity === 'water' ? -3 : WATER_LEVEL - 0.6);
    const moving = Math.hypot(this.vel.x, this.vel.z);
    this.anim.moving = Math.min(1, moving / 3);
    this.anim.phase += moving * dt * (this.def.body === 'quad' ? 2.2 : 2.6);
    if (this.state !== 'windup') this.anim.attack = -1;
    this.anim.attackStyle = this.def.ranged && this.def.body === 'humanoid' ? 'bow' : 'slash';
    this.syncModel(dt);
  }

  becomeAware(g: Game) {
    if (this.aware) return;
    this.aware = true;
    this.awareness = 1;
    this.state = 'chase';
    this.lostSight = 0;
    // Pack behaviour: wake nearby kin.
    for (const e of g.enemies) {
      if (e !== this && e.alive && !e.aware && e.pos.distanceTo(this.pos) < 14) {
        e.awareness = Math.max(e.awareness, 0.8);
      }
    }
  }

  private beginAttack() {
    this.state = 'windup';
    this.stateTime = 0;
    this.attackCd = this.def.ranged ? 2.2 : 1.4 + Math.random() * 0.6;
    this.anim.blocking = false;
  }

  private resolveAttack(g: Game, dist: number) {
    const p = g.player;
    const ranged = this.def.ranged;
    if (ranged && dist > 5) {
      const from = this.center();
      const to = p.center();
      // Lead the target a little.
      to.addScaledVector(p.vel, dist / ranged.speed * 0.5);
      g.spawnProjectile({ from, to, speed: ranged.speed, kind: ranged.projectile, owner: 'enemy', damage: this.damage(), element: elementOf(this.def.affinity), source: this, gravity: ranged.projectile === 'arrow' ? 6 : 0 });
      return;
    }
    const facing = Math.cos(Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) - this.yaw);
    if (dist < this.def.reach + this.radius + 0.9 && facing > 0.2) {
      g.damagePlayer(this.damage(), elementOf(this.def.affinity), this);
    }
  }

  damage() {
    return Math.round(this.def.damage * (1 + this.levelBonus * 0.12));
  }

  private tickStatus(dt: number, g: Game) {
    const s = this.status;
    for (const k of Object.keys(s) as (keyof Status)[]) s[k] = Math.max(0, s[k] - dt);
    if (s.bleed > 0) g.damageEnemy(this, Math.max(1.5, this.maxHp * 0.025) * dt, 'true', { dot: true });
    if (s.burn > 0) g.damageEnemy(this, 4 * dt * (this.affinity === 'fire' ? 0 : 1), 'fire', { dot: true });
  }
}

export function elementOf(a: Affinity): DamageElement {
  return a === 'none' ? 'physical' : a;
}

// ----------------------------------------------------------------- bosses --

export class Boss extends Enemy {
  bdef: BossDef;
  phase = 1;
  attack: BossAttack | null = null;
  attackTime = 0;
  hits = 0;
  cooldown = 2;
  chargeDir = new THREE.Vector3();
  leapFrom = new THREE.Vector3();
  leapTo = new THREE.Vector3();
  arena: { x: number; z: number; radius: number };
  private fired = 0;

  constructor(def: BossDef, arena: { x: number; z: number; radius: number }) {
    super('wolf', arena.x, arena.z - arena.radius * 0.5);
    this.bdef = def;
    this.arena = arena;
    this.model = bossModel(def);
    this.model.root.traverse((o) => (o.castShadow = true));
    this.hp = this.maxHp = def.hp;
    this.radius = def.model === 'crab' ? 3.2 : def.model === 'stag' ? 2.2 : 0.55 * def.scale + 0.4;
    this.aware = true;
    this.state = 'chase';
    this.summoned = true;
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
  damage() {
    return Math.round(this.bdef.damage * (this.phase === 2 ? 1.15 : 1));
  }

  update(dt: number, g: Game) {
    if (!this.alive) {
      this.deadFor += dt;
      this.anim.dead = this.deadFor;
      this.syncModel(dt);
      return;
    }
    const p = g.player;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    for (const k of Object.keys(this.status) as (keyof Status)[]) this.status[k] = Math.max(0, this.status[k] - dt);
    if (this.status.bleed > 0) g.damageEnemy(this, 6 * dt, 'true', { dot: true });
    if (this.status.burn > 0 && this.affinity !== 'fire') g.damageEnemy(this, 6 * dt, 'fire', { dot: true });

    if (this.phase === 1 && this.hp < this.maxHp * 0.5) {
      this.phase = 2;
      g.hud.toast(`${this.bdef.name} is enraged!`, 'boss');
      g.fx.ring(this.center(), 10, 0xff4020, 0.8);
      g.audio.play('roar');
    }
    const speedMul = (this.phase === 2 ? 1.25 : 1) * (this.status.slow > 0 ? 0.6 : 1) * (this.status.root > 0 ? 0 : 1);
    let moveX = 0, moveZ = 0;
    let speed = this.bdef.speed * speedMul;
    this.anim.attack = -1;

    if (this.status.stun > 0) {
      // Staggered.
    } else if (!this.attack) {
      this.cooldown -= dt * (this.phase === 2 ? 1.4 : 1);
      this.faceTowards(p.pos.x, p.pos.z, dt, 4);
      if (dist > this.radius + 3) {
        moveX = dx / dist;
        moveZ = dz / dist;
      }
      if (this.cooldown <= 0 && p.alive) this.chooseAttack(dist, g);
    } else {
      this.attackTime += dt * (this.phase === 2 ? 1.2 : 1);
      const r = this.runAttack(dt, g, dist);
      moveX = r[0];
      moveZ = r[1];
      speed = r[2];
    }

    this.pos.x += moveX * speed * dt;
    this.pos.z += moveZ * speed * dt;
    // Stay inside the arena.
    const ax = this.pos.x - this.arena.x, az = this.pos.z - this.arena.z;
    const ad = Math.hypot(ax, az);
    if (ad > this.arena.radius - this.radius) {
      this.pos.x = this.arena.x + (ax / ad) * (this.arena.radius - this.radius);
      this.pos.z = this.arena.z + (az / ad) * (this.arena.radius - this.radius);
    }
    if (this.attack !== 'leap') this.pos.y = heightAt(this.pos.x, this.pos.z) + (this.flies ? 0.3 : 0);
    const moving = Math.hypot(moveX, moveZ) * speed;
    this.anim.moving = Math.min(1, moving / 3);
    this.anim.phase += moving * dt * 1.4;
    this.syncModel(dt);
  }

  private chooseAttack(dist: number, g: Game) {
    const options = this.bdef.attacks.filter((a) => {
      if (a === 'sweep' || a === 'combo') return dist < this.radius + 6;
      if (a === 'charge' || a === 'leap') return dist > 8;
      if (a === 'summon') return g.enemies.filter((e) => e.summoned && e.alive && !(e instanceof Boss)).length < 3;
      return true;
    });
    if (!options.length) return;
    this.attack = options[Math.floor(Math.random() * options.length)];
    this.attackTime = 0;
    this.hits = 0;
    this.fired = 0;
    if (this.attack === 'charge') this.chargeDir.set(g.player.pos.x - this.pos.x, 0, g.player.pos.z - this.pos.z).normalize();
    if (this.attack === 'leap') {
      this.leapFrom.copy(this.pos);
      this.leapTo.copy(g.player.pos);
      g.fx.telegraph(this.leapTo.x, this.leapTo.z, 5, 1.1);
    }
    if (this.attack === 'slam') {
      g.fx.telegraph(g.player.pos.x, g.player.pos.z, 4.5, 1.2);
      this.leapTo.copy(g.player.pos);
    }
    if (this.attack === 'ring') g.fx.telegraph(this.pos.x, this.pos.z, 10, 1.4, 0xffa020);
    if (this.attack === 'strikes') {
      const n = this.phase === 2 ? 7 : 5;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = i === 0 ? 0 : 3 + Math.random() * 8;
        const x = g.player.pos.x + Math.cos(a) * r;
        const z = g.player.pos.z + Math.sin(a) * r;
        g.fx.telegraph(x, z, 3, 1.3 + i * 0.12, 0x80b0ff, () => {
          if (!this.alive) return;
          const at = new THREE.Vector3(x, heightAt(x, z), z);
          g.fx.lightning(at.clone().add(new THREE.Vector3(0, 30, 0)), at);
          if (Math.hypot(g.player.pos.x - x, g.player.pos.z - z) < 3.2 && g.player.pos.y - at.y < 3) g.damagePlayer(this.damage(), 'lightning', this);
          g.audio.play('slam');
        });
      }
    }
    g.audio.play('windup');
  }

  /** Returns [moveX, moveZ, speed]. */
  private runAttack(dt: number, g: Game, dist: number): [number, number, number] {
    const p = g.player;
    const t = this.attackTime;
    const end = (cool: number) => {
      this.attack = null;
      this.cooldown = cool * (this.phase === 2 ? 0.7 : 1);
    };
    const reach = this.radius + 4.5;
    const swingHit = () => {
      const facing = Math.cos(Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) - this.yaw);
      if (dist < reach && facing > -0.1) g.damagePlayer(this.damage(), elementOf(this.affinity), this);
      g.fx.emit(this.center().addScaledVector(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), this.radius + 2), { color: 0xffe0b0, count: 12, speed: 6, life: 0.3 });
    };
    switch (this.attack) {
      case 'sweep':
        this.anim.attack = Math.min(1, t / 1.2);
        this.anim.attackStyle = 'slash';
        if (t < 0.6) this.faceTowards(p.pos.x, p.pos.z, dt, 3);
        if (t >= 0.75 && this.hits === 0) {
          this.hits = 1;
          swingHit();
          g.audio.play('swing');
        }
        if (t > 1.3) end(1.5);
        return [0, 0, 0];
      case 'combo': {
        const k = (t % 0.7) / 0.7;
        this.anim.attack = k;
        this.anim.attackStyle = this.hits % 2 ? 'overhead' : 'slash';
        this.faceTowards(p.pos.x, p.pos.z, dt, 5);
        if (t >= 0.45 + this.hits * 0.7 && this.hits < 3) {
          this.hits++;
          swingHit();
          g.audio.play('swing');
        }
        if (t > 2.3) end(1.8);
        return [Math.sin(this.yaw), Math.cos(this.yaw), this.hits < 3 ? 2.5 : 0];
      }
      case 'charge':
        this.anim.attack = -1;
        if (t < 0.6) {
          this.faceTowards(p.pos.x, p.pos.z, dt, 6);
          this.chargeDir.set(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z).normalize();
          return [0, 0, 0];
        }
        if (t < 1.7) {
          if (dist < this.radius + 1.5 && this.hits === 0) {
            this.hits = 1;
            g.damagePlayer(Math.round(this.damage() * 1.2), 'physical', this);
            g.player.knockback(this.chargeDir, 12);
          }
          g.fx.emit(this.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), { color: 0xa09070, count: 2, speed: 2, life: 0.6, size: 1.4 });
          return [this.chargeDir.x, this.chargeDir.z, this.bdef.speed * 3.2];
        }
        end(1.6);
        return [0, 0, 0];
      case 'slam':
        this.anim.attack = Math.min(1, t / 1.3);
        this.anim.attackStyle = 'overhead';
        if (t >= 1.2 && this.hits === 0) {
          this.hits = 1;
          const hit = Math.hypot(p.pos.x - this.leapTo.x, p.pos.z - this.leapTo.z) < 4.5;
          if (hit) g.damagePlayer(Math.round(this.damage() * 1.3), elementOf(this.affinity), this);
          const at = new THREE.Vector3(this.leapTo.x, heightAt(this.leapTo.x, this.leapTo.z) + 0.3, this.leapTo.z);
          if (this.bdef.projectile === 'water') g.fx.spikes(at.x, at.z, 0x40c0ff, 9, 3.5);
          else g.fx.ring(at, 4.5, this.affinity === 'fire' ? 0xff5010 : 0xd8c8a0, 0.5);
          g.shake(0.5);
          g.audio.play('slam');
        }
        if (t > 1.8) end(1.4);
        return [0, 0, 0];
      case 'ring':
        this.anim.attack = Math.min(1, t / 1.5);
        this.anim.attackStyle = 'overhead';
        if (t >= 1.4 && this.hits === 0) {
          this.hits = 1;
          if (dist < 10 + p.radius) g.damagePlayer(Math.round(this.damage() * 1.1), elementOf(this.affinity), this);
          g.fx.ring(this.center(), 10, this.affinity === 'fire' ? 0xff5010 : this.affinity === 'water' ? 0x40c0ff : this.affinity === 'dark' ? 0xa060ff : 0xffd080, 0.6);
          g.shake(0.6);
          g.audio.play('slam');
        }
        if (t > 2) end(1.8);
        return [0, 0, 0];
      case 'volley': {
        this.anim.attack = Math.min(1, t / 1.6);
        this.anim.attackStyle = 'cast';
        this.faceTowards(p.pos.x, p.pos.z, dt, 4);
        const shots = this.phase === 2 ? 7 : 5;
        const due = Math.floor((t - 0.5) / 0.12);
        while (this.fired < shots && this.fired <= due) {
          const spread = (this.fired - (shots - 1) / 2) * 0.12;
          const from = this.center().add(new THREE.Vector3(0, this.height * 0.2, 0));
          const dir = new THREE.Vector3(p.pos.x - from.x, p.center().y - from.y, p.pos.z - from.z).normalize();
          dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
          const to = from.clone().addScaledVector(dir, 40);
          const kind = this.bdef.projectile === 'lightning' ? 'orb' : this.bdef.projectile;
          g.spawnProjectile({ from, to, speed: 24, kind, owner: 'enemy', damage: Math.round(this.damage() * 0.6), element: elementOf(this.affinity), source: this, gravity: kind === 'arrow' ? 3 : 0 });
          this.fired++;
        }
        if (t > 1.8) end(1.6);
        return [0, 0, 0];
      }
      case 'strikes':
        this.anim.attack = Math.min(1, t / 1.6);
        this.anim.attackStyle = 'cast';
        // The telegraphs deal the damage when they fill.
        if (t > 2.4) end(2);
        return [0, 0, 0];
      case 'summon':
        this.anim.attack = Math.min(1, t / 1.2);
        this.anim.attackStyle = 'cast';
        if (t > 1 && this.hits === 0 && this.bdef.summon) {
          this.hits = 1;
          for (let i = 0; i < (this.phase === 2 ? 3 : 2); i++) {
            const a = Math.random() * Math.PI * 2;
            const e = g.spawnEnemy(this.bdef.summon, this.pos.x + Math.cos(a) * 5, this.pos.z + Math.sin(a) * 5);
            e.summoned = true;
            e.aware = true;
            e.state = 'chase';
            g.fx.emit(e.center(), { color: 0xa070ff, count: 25, speed: 4, life: 0.6 });
          }
        }
        if (t > 1.5) end(3);
        return [0, 0, 0];
      case 'teleport':
        if (t < 0.5) {
          this.model.root.visible = Math.floor(t * 20) % 2 === 0;
          return [0, 0, 0];
        }
        if (this.hits === 0) {
          this.hits = 1;
          g.fx.emit(this.center(), { color: 0x8040ff, count: 40, speed: 6, life: 0.6 });
          const behind = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
          this.pos.set(p.pos.x + Math.sin(behind) * 4, p.pos.y, p.pos.z + Math.cos(behind) * 4);
          this.model.root.visible = true;
          g.fx.emit(this.center(), { color: 0x8040ff, count: 40, speed: 6, life: 0.6 });
          this.attack = 'sweep';
          this.attackTime = 0.2;
          this.hits = 0;
        }
        return [0, 0, 0];
      case 'leap': {
        const k = Math.min(1, t / 1.1);
        this.pos.lerpVectors(this.leapFrom, this.leapTo, k);
        this.pos.y = heightAt(this.pos.x, this.pos.z) + Math.sin(k * Math.PI) * 10;
        this.anim.attack = k;
        this.anim.attackStyle = 'overhead';
        if (k >= 1 && this.hits === 0) {
          this.hits = 1;
          if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 5) g.damagePlayer(Math.round(this.damage() * 1.4), elementOf(this.affinity), this);
          g.fx.ring(this.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 5, 0xffa040, 0.5);
          g.shake(0.8);
          g.audio.play('slam');
        }
        if (t > 1.6) end(1.6);
        return [0, 0, 0];
      }
      default:
        end(1);
        return [0, 0, 0];
    }
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
  attacking = 0;
  private lvl: number;

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
    this.attacking = Math.max(0, this.attacking - dt);
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
    if (d > stopAt) {
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
    if (this.target && d <= stopAt + 0.5 && this.attackCd <= 0) {
      this.attackCd = this.ranged ? 1.6 : 1.1;
      this.attacking = 0.4;
      if (this.ranged) {
        g.spawnProjectile({ from: this.center(), to: this.target.center(), speed: 26, kind: 'fireball', owner: 'ally', damage: Math.round(this.baseDamage), element: 'fire', source: this, gravity: 0 });
      } else {
        g.damageEnemy(this.target, this.baseDamage, this.affinity === 'fire' ? 'fire' : 'physical', { source: 'ally' });
      }
    }
    this.anim.moving = Math.min(1, (Math.abs(mx) + Math.abs(mz)) * sp / 3);
    this.anim.phase += this.anim.moving * dt * 8;
    this.anim.attack = this.attacking > 0 ? 1 - this.attacking / 0.4 : -1;
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
