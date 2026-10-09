import * as THREE from 'three';
import { SPELLS, WEAPONS, type DamageElement, type SpellId, type WeaponKind } from '../data/defs';
import {
  dracoFireRegen, dracoFlightHours, dracoWaterDamagePerSecond, drawTimeMultiplier, manaRegen, maxHp, maxMana, maxStamina, maxTamed, moveSpeed, rank,
  tameableKinds, weaponDamage, type Character,
} from '../rules/character';
import {
  BLOODRAGE, bleedChance, canCast, canCombine, canWield, castPowerOfTheLight, comboCost, comboFor, comboPower, cooldownMultiplier, devilRingAffects, hasBloodrage,
  hasBloodsteal, immuneToBleed, mainWeapon, newFury, onMeleeLanded, onMeleeMissed, powerShot, retribution, spellCost, spellPowerMultiplier, strikeDevilDeal,
  type FuryState,
} from '../rules/combat';
import { buildShield, buildWeapon, compact, disposeObject } from './models';
import { animateHumanoid, buildHumanoid, type Rig } from './humanoid';
import { newAnim } from './anim';
import { heightAt, inLava, SWIM_DEPTH, WATER_LEVEL } from './terrain';
import { Ally, Boss, Enemy } from './entities';
import type { Game } from './game';

type AttackKind = 'light' | 'heavy' | 'spin' | 'throw' | 'cast' | 'bow';

interface Attack {
  kind: AttackKind;
  t: number;
  duration: number;
  hitAt: number;
  done: boolean;
  landed: boolean;
  combo: number;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  c: Character;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  radius = 0.45;
  hp: number;
  mana: number;
  stamina: number;
  alive = true;
  fury: FuryState = newFury();
  bloodrageUntil = 0;
  bloodrageReadyAt = 0;
  abilityReadyAt = 0;
  powerShotArmed = false;
  grounded = true;
  flying = false;
  flightLeft = 0;
  swimming = false;
  sailing = false;
  crouching = false;
  blocking = false;
  rollT = -1;
  rollDir = new THREE.Vector3();
  iframes = 0;
  stagger = 0;
  blackout = 0;
  attack: Attack | null = null;
  comboStep = 0;
  drawing = 0;
  castHeld = -1;
  selected = 0;
  combineMode = false;
  cooldowns = new Map<string, number>();
  speedBuff = 0;
  stoneSkin = 0;
  aegis = 0;
  moonveil = 0;
  soulOrPower = false;
  healing = 0;
  lockTarget: Enemy | null = null;
  gazeTick = 0;
  thunderCd = 0;
  waterHurt = 0;
  drown = 0;
  rig: Rig;
  anim = newAnim();
  boat: THREE.Object3D | null = null;
  private weaponMesh: THREE.Object3D | null = null;
  private shieldMesh: THREE.Object3D | null = null;
  private now = 0;

  constructor(c: Character) {
    this.c = c;
    this.hp = maxHp(c);
    this.mana = maxMana(c);
    this.stamina = maxStamina(c);
    this.rig = buildPlayerRig(c);
    compact(this.rig.root);
    this.rig.root.traverse((o) => (o.castShadow = true));
    this.equip();
    this.flightLeft = dracoFlightHours(c) * 60;
  }

  get roleId() {
    return this.c.roleId;
  }
  get maxHp() {
    return maxHp(this.c);
  }
  get maxMana() {
    return maxMana(this.c);
  }
  get maxStamina() {
    return maxStamina(this.c);
  }
  get weaponKind(): WeaponKind {
    return WEAPONS[mainWeapon(this.c).id].kind;
  }
  get spell(): SpellId | null {
    return this.c.spellSlots[this.selected] ?? null;
  }
  center(out = new THREE.Vector3()) {
    return out.copy(this.pos).add(new THREE.Vector3(0, this.crouching ? 0.8 : 1.15, 0));
  }

  /** How noticeable the hero is (0 = invisible). */
  stealthFactor(): number {
    if (this.moonveil > 0) return 0;
    let f = 1;
    if (this.crouching) f *= this.c.roleId === 'assassin' ? 0.2 : 0.4;
    f *= 1 / (1 + 0.25 * rank(this.c, 'shadow-step'));
    if (this.c.raceId === 'elf') f *= 0.85;
    return f;
  }

  /** Re-attaches the main weapon (and a warrior's shield) to the model. */
  equip() {
    for (const old of [this.weaponMesh, this.shieldMesh]) {
      if (!old) continue;
      old.removeFromParent();
      disposeObject(old);
    }
    const w = WEAPONS[mainWeapon(this.c).id];
    this.weaponMesh = compact(buildWeapon(w.kind, !!w.legendary));
    if (w.kind === 'bow') this.rig.handL.add(this.weaponMesh);
    else this.rig.handR.add(this.weaponMesh);
    if (this.c.classId === 'warrior' && w.kind !== 'bow') {
      this.shieldMesh = buildShield();
      this.shieldMesh.position.set(-0.08, 0, 0.1);
      this.shieldMesh.rotation.y = -Math.PI / 2;
      this.rig.handL.add(this.shieldMesh);
    }
    this.weaponMesh.traverse((o) => (o.castShadow = true));
  }

  ready(key: string) {
    return (this.cooldowns.get(key) ?? 0) <= this.now;
  }
  cooldownLeft(key: string) {
    return Math.max(0, (this.cooldowns.get(key) ?? 0) - this.now);
  }

  knockback(dir: THREE.Vector3, force: number) {
    this.vel.x += dir.x * force;
    this.vel.z += dir.z * force;
    this.vel.y = 4;
    this.grounded = false;
    this.stagger = 0.4;
    this.attack = null;
  }

  heal(amount: number) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  // ---------------------------------------------------------------- update --

  update(dt: number, g: Game) {
    this.now += dt;
    const input = g.input;
    const c = this.c;
    if (!this.alive) {
      this.anim.dead += dt;
      this.anim.t += dt;
      this.syncModel();
      return;
    }

    // Timers.
    this.iframes = Math.max(0, this.iframes - dt);
    this.stagger = Math.max(0, this.stagger - dt);
    this.blackout = Math.max(0, this.blackout - dt);
    this.speedBuff = Math.max(0, this.speedBuff - dt);
    this.stoneSkin = Math.max(0, this.stoneSkin - dt);
    this.aegis = Math.max(0, this.aegis - dt);
    this.moonveil = Math.max(0, this.moonveil - dt);
    if (this.fury.bloodrageActive && this.now > this.bloodrageUntil) {
      this.fury.bloodrageActive = false;
      this.fury.stacks = 0;
      g.hud.toast('BloodRage fades.');
    }
    if (this.healing > 0) {
      const step = Math.min(this.healing, this.maxHp * 0.6 * dt);
      this.healing -= step;
      this.heal(step);
    }

    const busy = this.blackout > 0 || this.stagger > 0;
    const canAct = !busy && this.rollT < 0 && !this.sailing;

    // Lock-on.
    if (input.pressed.has('lock')) {
      if (this.lockTarget) this.lockTarget = null;
      else this.lockTarget = g.findTarget(30, 0.5, true);
    }
    if (this.lockTarget && (!this.lockTarget.alive || this.lockTarget.pos.distanceTo(this.pos) > 40)) this.lockTarget = null;

    // Spell slots.
    for (let i = 0; i < 4; i++) if (input.pressed.has(`slot${i + 1}` as 'slot1')) this.selectSlot(i, g);
    if (input.pressed.has('nextSpell')) this.selectSlot((this.selected + 1) % 4, g, true);
    if (input.wheel) this.selectSlot((this.selected + (input.wheel > 0 ? 1 : 3)) % 4, g, true);
    if (input.pressed.has('combine')) this.toggleCombine(g);

    if (input.pressed.has('crouch') && !this.flying && !this.swimming) this.crouching = !this.crouching;
    if (input.pressed.has('swap') && canAct) this.swapWeapon(g);
    if (input.pressed.has('heal') && canAct) this.drinkFlask(g);
    if (input.pressed.has('eat') && canAct) this.eat(g);
    if (input.pressed.has('ability') && canAct) this.useAbility(g);

    // Movement intent relative to the camera.
    const camYaw = g.camYaw;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const mx = input.move.x, my = input.move.y;
    let wantX = fx * my - fz * mx;
    let wantZ = fz * my + fx * mx;
    const wantLen = Math.hypot(wantX, wantZ);
    const sprint = input.held.has('sprint') && wantLen > 0.1 && this.stamina > 1 && !this.crouching;
    let speed = moveSpeed(c) * (sprint ? 1.55 : 1) * (this.crouching ? 0.5 : 1) * (this.speedBuff > 0 ? 1.6 : 1);
    if (this.blocking || this.drawing > 0) speed *= 0.45;
    if (this.attack && this.attack.kind !== 'cast') speed *= 0.25;
    if (busy) speed = 0;

    // Water.
    const ground = heightAt(this.pos.x, this.pos.z);
    const depth = WATER_LEVEL - ground;
    const walksOnWater = WEAPONS[mainWeapon(c).id].legendary === 'trident-of-poseidon';
    this.swimming = !this.sailing && !this.flying && !walksOnWater && depth > SWIM_DEPTH && this.pos.y < WATER_LEVEL + 0.2;
    if (this.swimming) {
      speed = c.roleId === 'sailor' ? 5.5 : 3.6;
      this.crouching = false;
      this.blocking = false;
      if (c.roleId !== 'sailor') this.stamina = Math.max(0, this.stamina - 3.5 * dt);
      if (this.stamina <= 0) {
        this.drown += dt;
        if (this.drown > 1) {
          this.drown = 0;
          g.damagePlayer(10, 'true', null, true);
          g.hud.toast('You are drowning!', 'warn');
        }
      }
    }
    if (this.sailing) {
      speed = depth > 0.4 ? 16 : 0;
      if (input.pressed.has('interact') || input.pressed.has('jump')) this.disembark(g);
    }

    // Rolling.
    if (input.pressed.has('roll') && canAct && !this.swimming && !this.flying && this.stamina >= 10) {
      this.rollT = 0;
      this.stamina -= 18;
      this.attack = null;
      this.drawing = 0;
      this.crouching = false;
      if (wantLen > 0.1) this.rollDir.set(wantX / wantLen, 0, wantZ / wantLen);
      else this.rollDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.iframes = 0.42;
      g.audio.play('roll');
    }
    if (this.rollT >= 0) {
      this.rollT += dt / 0.55;
      wantX = this.rollDir.x;
      wantZ = this.rollDir.z;
      speed = 11 * (1 - this.rollT * 0.5);
      if (this.rollT >= 1) this.rollT = -1;
    }

    // Facing.
    const target = this.lockTarget;
    if (target && this.rollT < 0) {
      this.faceTowards(target.pos.x, target.pos.z, dt, 12);
    } else if (wantLen > 0.1 && (!this.attack || this.attack.t < 0.15)) {
      this.faceTowards(this.pos.x + wantX, this.pos.z + wantZ, dt, this.rollT >= 0 ? 30 : 10);
    } else if ((this.drawing > 0 || this.attack?.kind === 'cast') && !target) {
      this.yaw = rotateTowards(this.yaw, camYaw, dt * 14);
    }

    // Integrate horizontal velocity (with knockback decay).
    const len = Math.hypot(wantX, wantZ);
    const tx = len > 0.01 ? (wantX / Math.max(1, len)) * speed : 0;
    const tz = len > 0.01 ? (wantZ / Math.max(1, len)) * speed : 0;
    const accel = this.grounded || this.swimming || this.flying ? 14 : 3;
    this.vel.x += (tx - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (tz - this.vel.z) * Math.min(1, dt * accel);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    g.world.resolve(this.pos, this.radius);
    for (const e of g.enemies) {
      if (!e.alive) continue;
      const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz);
      const min = this.radius + e.radius;
      if (d < min && d > 1e-4 && Math.abs(this.pos.y - e.pos.y) < 2.5) {
        this.pos.x = e.pos.x + (dx / d) * min;
        this.pos.z = e.pos.z + (dz / d) * min;
      }
    }

    // Vertical: jump, gravity, flight.
    const hours = dracoFlightHours(c);
    // Wings recover fully after an hour (game time) on the ground.
    if (hours > 0 && !this.flying && this.grounded) this.flightLeft = Math.min(hours * 60, this.flightLeft + dt * hours);
    const startFly = hours > 0 && this.flightLeft > 1 && (input.pressed.has('fly') || (input.pressed.has('jump') && !this.grounded && !this.swimming));
    if (this.flying && (input.pressed.has('fly') || this.flightLeft <= 0)) {
      this.flying = false;
      if (this.flightLeft <= 0) g.hud.toast('Your wings are spent.');
    } else if (startFly && !this.flying && canAct) {
      this.flying = true;
      this.crouching = false;
      g.hud.toast(`Flight: ${Math.ceil(this.flightLeft / 60)} game hour(s)`);
    }
    if (this.flying) {
      this.flightLeft -= dt;
      const up = (input.held.has('jump') ? 1 : 0) - (input.held.has('crouch') ? 1 : 0);
      this.vel.y += (up * 8 - this.vel.y) * Math.min(1, dt * 4);
      this.pos.y += this.vel.y * dt;
      this.pos.y = Math.min(this.pos.y, 160);
    } else if (this.sailing) {
      this.pos.y = WATER_LEVEL + 0.4;
      this.vel.y = 0;
    } else if (this.swimming) {
      this.vel.y = 0;
      this.pos.y += (WATER_LEVEL - 1.1 - this.pos.y) * Math.min(1, dt * 5);
    } else {
      if (input.pressed.has('jump') && this.grounded && canAct) {
        this.vel.y = 8.5;
        this.grounded = false;
        this.crouching = false;
        this.stamina -= 6;
      }
      this.vel.y -= 24 * dt;
      this.pos.y += this.vel.y * dt;
    }
    const floor = walksOnWater ? Math.max(ground, WATER_LEVEL) : ground;
    if (!this.swimming && !this.sailing && this.pos.y <= floor) {
      if (!this.grounded && this.vel.y < -22) g.damagePlayer(Math.round((-this.vel.y - 22) * 4), 'true', null, true);
      this.pos.y = floor;
      this.vel.y = 0;
      this.grounded = true;
      if (this.flying && input.held.has('crouch')) this.flying = false;
    } else if (!this.swimming && !this.sailing) {
      this.grounded = this.pos.y - floor < 0.05;
    }
    if (this.flying) this.grounded = false;

    // Hazards.
    if (inLava(this.pos.x, this.pos.z, this.pos.y) && !this.flying) {
      const regen = dracoFireRegen(c);
      if (regen > 0) this.heal(regen * dt);
      else g.damagePlayer(30 * dt, 'fire', null, true);
    }
    const inWater = depth > 0.3 && this.pos.y < WATER_LEVEL + 0.1 && !this.sailing && !this.flying;
    const wdps = dracoWaterDamagePerSecond(c);
    if (inWater && wdps > 0) {
      this.waterHurt += dt;
      if (this.waterHurt > 0.5) {
        this.waterHurt = 0;
        g.damagePlayer(wdps * 0.5, 'true', null, true);
        g.hud.toast('The water burns your scales!', 'warn');
      }
    }

    // Stamina and mana.
    const spending = sprint || this.blocking || this.attack || this.rollT >= 0 || this.drawing > 0;
    if (sprint) this.stamina -= 14 * dt;
    if (!spending && !(this.swimming && c.roleId !== 'sailor')) this.stamina = Math.min(this.maxStamina, this.stamina + 38 * dt);
    this.stamina = Math.max(0, this.stamina);
    if (!this.soulOrPower) this.mana = Math.min(this.maxMana, this.mana + manaRegen(c) * dt);
    else this.mana = 0;

    // Blocking.
    this.blocking = input.held.has('block') && canAct && !this.attack && !this.swimming && !this.flying && this.weaponKind !== 'bow' && this.stamina > 0;

    // Attacks.
    if (canAct && !this.swimming) this.handleAttack(dt, g);
    if (this.attack) this.updateAttack(dt, g);

    // Casting: tap for the main form, hold for the alternate.
    if (canAct && input.pressed.has('cast')) this.castHeld = 0;
    if (this.castHeld >= 0) {
      this.castHeld += dt;
      if (input.released.has('cast') || this.castHeld > 0.6) {
        const alt = this.castHeld >= 0.35;
        this.castHeld = -1;
        if (canAct) this.cast(g, alt);
      }
    }

    // Race passives.
    if (c.raceId === 'ancient') this.ancientPowers(dt, g);

    // Interaction is handled by Game (it owns the world state).
    this.syncAnim(dt, sprint);
    this.syncModel();
  }

  private faceTowards(x: number, z: number, dt: number, rate: number) {
    this.yaw = rotateTowards(this.yaw, Math.atan2(x - this.pos.x, z - this.pos.z), dt * rate);
  }

  // ---------------------------------------------------------------- combat --

  private handleAttack(dt: number, g: Game) {
    const input = g.input;
    const kind = this.weaponKind;
    if (kind === 'bow') {
      if (input.held.has('attack') && !this.attack) {
        if (this.drawing === 0 && this.arrows() <= 0) {
          if (input.pressed.has('attack')) g.hud.toast('No arrows.');
          return;
        }
        const drawTime = 0.9 * drawTimeMultiplier(this.c);
        this.drawing = Math.min(1, this.drawing + dt / drawTime);
        this.stamina -= 4 * dt;
        if (this.drawing > 0 && this.drawing < 0.05) g.audio.play('draw');
      }
      if (input.released.has('attack') && this.drawing > 0) {
        this.fireArrow(g, Math.max(0.25, this.drawing));
        this.drawing = 0;
      }
      if (input.pressed.has('heavy') && this.c.classId !== 'mage') {
        // Melee bash with a dagger, if carried.
        const dagger = this.c.weapons.findIndex((w) => WEAPONS[w.id].kind === 'dagger');
        if (dagger >= 0) {
          this.c.mainHand = dagger;
          this.equip();
          g.hud.toast('Dagger drawn.');
        }
      }
      return;
    }
    if (kind === 'bolt') {
      if (input.pressed.has('attack') || input.pressed.has('heavy')) this.startAttack('throw', 0.75, 0.45);
      return;
    }
    const w = WEAPONS[mainWeapon(this.c).id];
    const quick = drawTimeMultiplier(this.c) < 1 ? 0.85 : 1;
    const dur = (1 / w.speed) * 0.9 * quick;
    if (input.pressed.has('attack') && (!this.attack || this.attack.t > this.attack.duration * 0.7) && this.stamina > 0) {
      this.stamina -= 12 * (1 - 0.2 * rank(this.c, 'blade-dancer'));
      this.comboStep = this.attack ? this.comboStep + 1 : 0;
      this.startAttack('light', dur, 0.45);
    } else if (input.pressed.has('heavy') && !this.attack && this.stamina > 0) {
      this.stamina -= 25 * (1 - 0.2 * rank(this.c, 'blade-dancer'));
      if (this.c.subclassId === 'swordsman') {
        this.startAttack('spin', dur * 1.5, 0.5);
        g.hud.toast('Spinner Flourish!', 'skill');
      } else if (this.c.subclassId === 'axeman' && rank(this.c, 'throwing-axe')) {
        this.startAttack('throw', 0.7, 0.45);
      } else {
        this.startAttack('heavy', dur * 1.6, 0.55);
        if (rank(this.c, 'lunge')) this.knockback(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 9), (this.stagger = 0);
      }
    }
  }

  private startAttack(kind: AttackKind, duration: number, hitAt: number) {
    this.attack = { kind, t: 0, duration, hitAt: duration * hitAt, done: false, landed: false, combo: this.comboStep };
    this.crouching = this.crouching && this.c.roleId === 'assassin';
  }

  private updateAttack(dt: number, g: Game) {
    const a = this.attack!;
    a.t += dt;
    if (!a.done && a.t >= a.hitAt) {
      a.done = true;
      if (a.kind === 'light' || a.kind === 'heavy' || a.kind === 'spin') {
        a.landed = this.meleeHit(g, a);
        if (this.c.classId === 'warrior') {
          if (a.landed) onMeleeLanded(this.c, this.fury);
          else onMeleeMissed(this.fury);
        }
        g.audio.play(a.landed ? 'hit' : 'swing');
      } else if (a.kind === 'throw') {
        this.throwWeapon(g);
      }
      if (a.landed && this.c.subclassId === 'axeman' && a.kind === 'heavy' && !this.grounded && rank(this.c, 'earthsplitter')) {
        g.fx.ring(this.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 5, 0xc8a070);
      }
    }
    if (a.t >= a.duration) this.attack = null;
  }

  private meleeHit(g: Game, a: Attack): boolean {
    const w = mainWeapon(this.c);
    const def = WEAPONS[w.id];
    const reach = def.range + (a.kind === 'spin' ? 0.8 + 0.3 * rank(this.c, 'wide-flourish') * def.range : 0);
    const arc = a.kind === 'spin' ? -1.01 : rank(this.c, 'cleave') ? -0.2 : 0.25;
    let base = weaponDamage(w) * (a.kind === 'heavy' ? 1.8 : a.kind === 'spin' ? 1.3 * (1 + 0.2 * rank(this.c, 'wide-flourish')) : 1);
    if (a.combo >= 2 && a.kind === 'light') base *= 1.15;
    let landed = false;
    const fwdYaw = this.yaw;
    for (const e of g.enemies) {
      if (!e.alive) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > reach + e.radius || Math.abs(e.pos.y - this.pos.y) > 3 + e.height) continue;
      const facing = Math.cos(Math.atan2(dx, dz) - fwdYaw);
      if (facing < arc && d > e.radius + 0.4) continue;
      const fromBehind = Math.cos(Math.atan2(-dx, -dz) - e.yaw) < -0.3;
      g.hitEnemyWithWeapon(e, base, 'melee', def.element, { fromBehind, fury: this.fury });
      landed = true;
      if (e.bleeds && Math.random() < bleedChance(this.c)) e.status.bleed = 4;
      if (def.legendary === 'hammer-of-hephaestus' || def.legendary === 'sword-of-mars') e.status.burn = 3;
    }
    if (landed) g.shake(a.kind === 'heavy' ? 0.25 : 0.12);
    return landed;
  }

  arrows() {
    return this.c.arrows.steel + this.c.arrows.wood;
  }

  private fireArrow(g: Game, draw: number) {
    const steel = this.c.arrows.steel > 0;
    const keep = rank(this.c, 'reclaim') && Math.random() < 0.4;
    if (!keep) {
      if (steel) this.c.arrows.steel--;
      else this.c.arrows.wood--;
    }
    const w = mainWeapon(this.c);
    const def = WEAPONS[w.id];
    const base = weaponDamage(w) * (steel ? 1.3 : 1);
    const from = this.center().add(new THREE.Vector3(Math.sin(this.yaw) * 0.6, 0.35, Math.cos(this.yaw) * 0.6));
    const to = g.aimPoint(70);
    const ps = this.powerShotArmed ? powerShot(this.c) : null;
    this.powerShotArmed = false;
    const artemis = def.legendary === 'bow-of-artemis';
    const pierce = (rank(this.c, 'piercing-shot') ? 1 : 0) + (artemis ? 2 : 0);
    const shoot = (dest: THREE.Vector3) =>
      g.spawnProjectile({ from, to: dest, speed: 50 + 30 * draw, kind: 'arrow', owner: 'player', damage: base, element: def.element, gravity: 9 * (1.2 - draw), draw, pierce, powerShot: ps ?? undefined, source: null });
    shoot(to);
    if (draw >= 1 && rank(this.c, 'volley')) {
      for (const s of [-0.08, 0.08]) shoot(to.clone().sub(from).applyAxisAngle(UP, s).add(from));
    }
    g.audio.play('bow');
  }

  private throwWeapon(g: Game) {
    const w = mainWeapon(this.c);
    const def = WEAPONS[w.id];
    const from = this.center().add(new THREE.Vector3(0, 0.6, 0));
    const to = g.aimPoint(def.kind === 'bolt' ? 60 : 30);
    if (def.kind === 'bolt') {
      const check = canWield(this.c, w.id);
      g.spawnProjectile({ from, to, speed: 70, kind: 'bolt', owner: 'player', damage: weaponDamage(w), element: 'lightning', gravity: 0, source: null, explode: 3 });
      if (check.partial) {
        g.damagePlayer(5, 'lightning', null, true);
        g.hud.toast('The Master Bolt bites your hand.', 'warn');
      }
    } else {
      g.spawnProjectile({ from, to, speed: 30, kind: 'axe', owner: 'player', damage: weaponDamage(w) * 1.4, element: 'physical', gravity: 4, source: null });
    }
    g.audio.play('throw');
  }

  // --------------------------------------------------------------- ability --

  abilityName(): string {
    const c = this.c;
    if (c.subclassId === 'bowman') return 'Power Shot';
    if (hasBloodrage(c)) return 'BloodRage';
    if (c.subclassId === 'trainer') return 'Tame';
    if (c.classId === 'mage') return canCombine(c) ? 'Combine' : 'Combine (Lv 3)';
    return 'Volley';
  }

  abilityCooldown(): number {
    if (hasBloodrage(this.c)) return Math.max(0, this.bloodrageReadyAt - this.now);
    return Math.max(0, this.abilityReadyAt - this.now);
  }

  private useAbility(g: Game) {
    const c = this.c;
    if (c.subclassId === 'bowman') {
      if (this.abilityReadyAt > this.now) return g.hud.toast('Power Shot is not ready.');
      if (this.weaponKind !== 'bow') return g.hud.toast('Power Shot needs a bow.');
      this.powerShotArmed = true;
      this.abilityReadyAt = this.now + 8;
      g.hud.toast('Power Shot ready: strike while unseen.', 'skill');
      return;
    }
    if (hasBloodrage(c)) {
      if (this.fury.bloodrageActive) return;
      if (this.bloodrageReadyAt > this.now) return g.hud.toast('BloodRage is not ready.');
      if (!this.soulOrPower && this.mana < BLOODRAGE.mana) return g.hud.toast('Not enough mana.');
      if (!this.soulOrPower) this.mana -= BLOODRAGE.mana;
      this.fury.bloodrageActive = true;
      this.fury.stacks = 0;
      this.bloodrageUntil = this.now + BLOODRAGE.duration;
      this.bloodrageReadyAt = this.now + BLOODRAGE.cooldown;
      g.hud.toast(c.level >= 4 ? 'BLOODRAGE! Bloodsteal awakens.' : 'BLOODRAGE!', 'rage');
      g.fx.emit(this.center(), { color: 0xff1010, count: 50, speed: 5, life: 0.8, size: 0.8 });
      g.audio.play('roar');
      return;
    }
    if (c.subclassId === 'trainer') return this.tame(g);
    if (c.classId === 'mage') return this.toggleCombine(g);
    // Ranger volley: three quick arrows.
    if (this.abilityReadyAt > this.now) return g.hud.toast('Volley is not ready.');
    if (this.weaponKind !== 'bow' || this.arrows() < 3) return g.hud.toast('Volley needs a bow and 3 arrows.');
    this.abilityReadyAt = this.now + 10;
    for (let i = 0; i < 3; i++) setTimeout(() => this.alive && this.fireArrow(g, 0.9), i * 120);
  }

  private tame(g: Game) {
    const kinds = tameableKinds(this.c);
    const target = this.lockTarget ?? g.findTarget(8, 0.3, false);
    if (!target || target instanceof Boss) return g.hud.toast('Nothing to tame nearby.');
    const kind = target.def.tame;
    if (!kind) return g.hud.toast(`A ${target.name} cannot be tamed.`);
    if (!kinds.includes(kind)) return g.hud.toast(`You need more levels to tame a ${target.name}.`);
    if (target.aware && target.hp > target.maxHp * 0.4) return g.hud.toast('Weaken it first, or approach unseen.');
    if (g.allies.filter((a) => a.ttl === Infinity && a.kind !== 'lizard').length >= maxTamed(this.c)) {
      const old = g.allies.find((a) => a.ttl === Infinity && a.kind !== 'lizard');
      if (old) g.removeAlly(old);
    }
    g.removeEnemy(target);
    g.addAlly(new Ally(kind, target.pos.x, target.pos.z, this.c.level, Infinity, 1 + 0.25 * rank(this.c, 'pack-bond'), 1 + 0.2 * rank(this.c, 'feral-bite')));
    if (!this.c.tamed.includes(kind)) this.c.tamed.push(kind);
    g.hud.toast(`Tamed a ${target.name}!`, 'skill');
    g.audio.play('pickup');
  }

  private toggleCombine(g: Game) {
    if (!canCombine(this.c)) return g.hud.toast(this.c.classId === 'mage' ? 'Mages combine spells from level 3.' : 'Only mages can combine spells.');
    this.combineMode = !this.combineMode;
    const a = this.spell;
    const b = this.c.spellSlots[(this.selected + 1) % 4];
    const combo = a && b ? comboFor(a, b) : null;
    g.hud.toast(this.combineMode ? (combo ? `Combine: ${combo.name}` : 'Combine: these two spells do not combine.') : 'Combine off.', 'skill');
  }

  private selectSlot(i: number, g: Game, skipEmpty = false) {
    if (skipEmpty) {
      for (let k = 0; k < 4 && !this.c.spellSlots[i]; k++) i = (i + 1) % 4;
    }
    this.selected = i;
    const s = this.c.spellSlots[i];
    if (s) g.hud.toast(SPELLS[s].name);
  }

  private swapWeapon(g: Game) {
    const n = this.c.weapons.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.c.mainHand + k) % n;
      const check = canWield(this.c, this.c.weapons[i].id);
      if (check.ok) {
        this.c.mainHand = i;
        this.equip();
        this.drawing = 0;
        g.hud.toast(WEAPONS[this.c.weapons[i].id].name + (check.partial ? ` (${check.reason})` : ''));
        return;
      }
    }
  }

  private drinkFlask(g: Game) {
    if (this.c.flasks <= 0) return g.hud.toast('Your flasks are empty. Rest at a shrine.');
    if (this.hp >= this.maxHp) return;
    this.c.flasks--;
    this.healing += this.maxHp * 0.5;
    this.stagger = 0.5;
    g.fx.emit(this.center(), { color: 0xffc040, count: 30, speed: 2, life: 0.8, up: 2 });
    g.audio.play('drink');
  }

  private eat(g: Game) {
    const items = this.c.items;
    const kind = (items['golden-fish'] ?? 0) > 0 && this.hp < this.maxHp * 0.4 ? 'golden-fish' : (items.fish ?? 0) > 0 ? 'fish' : (items['golden-fish'] ?? 0) > 0 ? 'golden-fish' : null;
    if (!kind) return g.hud.toast('You have nothing to eat.');
    items[kind]--;
    this.heal(kind === 'fish' ? 35 : 90);
    g.hud.toast(kind === 'fish' ? 'You eat a fish. (+35 HP)' : 'You eat a golden fish. (+90 HP)');
  }

  // ---------------------------------------------------------------- spells --

  private castCooldown(key: string, seconds: number) {
    this.cooldowns.set(key, this.now + seconds * cooldownMultiplier(this.c));
  }

  private spellDamage(power: number, element: DamageElement) {
    return power * spellPowerMultiplier(this.c, element) * (1 + 0.06 * (this.c.level - 1));
  }

  private cast(g: Game, alt: boolean) {
    const spell = this.spell;
    if (!spell) return g.hud.toast('No spell in this slot.');
    const c = this.c;
    const ctx = { gameMinutes: g.gameMinutes, mana: this.mana, inDesert: g.zone === 'desert', soulOrPower: this.soulOrPower };

    if (this.combineMode) {
      const other = c.spellSlots[(this.selected + 1) % 4];
      const combo = other ? comboFor(spell, other) : null;
      if (!combo) return g.hud.toast('These two spells do not combine.');
      const a = canCast(c, combo.spells[0], ctx);
      const b = canCast(c, combo.spells[1], ctx);
      if (!a.ok && a.reason !== 'Not enough mana.') return g.hud.toast(a.reason!);
      if (!b.ok && b.reason !== 'Not enough mana.') return g.hud.toast(b.reason!);
      const cost = this.soulOrPower ? 0 : comboCost(c, combo);
      if (this.mana < cost && !this.soulOrPower) return g.hud.toast('Not enough mana.');
      if (!this.ready(combo.id)) return g.hud.toast(`${combo.name} is not ready.`);
      this.mana -= cost;
      this.castCooldown(combo.id, 6);
      this.startAttack('cast', 0.6, 0.4);
      this.castCombo(g, combo.id, this.spellDamage(comboPower(combo), combo.element));
      g.hud.toast(combo.name + '!', 'skill');
      g.audio.play('spell');
      return;
    }

    const check = canCast(c, spell, ctx);
    if (!check.ok) return g.hud.toast(check.reason!, 'warn');
    if (!this.ready(spell)) return g.hud.toast(`${SPELLS[spell].name} is not ready (${this.cooldownLeft(spell).toFixed(0)}s).`);
    const def = SPELLS[spell];
    const target = this.lockTarget ?? g.findTarget(30, 0.75, false);
    const aim = target ? target.center() : g.aimPoint(30);
    const power = this.spellDamage(def.power, def.element);

    switch (spell) {
      case 'deal-with-the-devil': {
        // Locked on (or hold): the single foe. Otherwise a ring of level 1-5 foes.
        const single = this.lockTarget ?? (alt ? target : null);
        let killed = 0;
        if (single) {
          g.damageEnemy(single, single.hp + 1, 'true', { source: 'devil' });
          g.fx.pillar(single.center(), 0xff2020, 2);
          killed = 1;
        } else {
          for (const e of [...g.enemies]) {
            if (e.alive && !(e instanceof Boss) && devilRingAffects(e.level) && e.pos.distanceTo(this.pos) < 14) {
              g.damageEnemy(e, e.hp + 1, 'true', { source: 'devil' });
              killed++;
            }
          }
          g.fx.ring(this.center(), 14, 0xff2020, 0.9);
        }
        const hours = strikeDevilDeal(c, g.gameMinutes);
        this.blackout = 2.5;
        this.attack = null;
        g.hud.blackout(2.5);
        g.hud.toast(
          hours === Infinity ? 'The Devil takes your light. Forever.' : `The deal is struck. Your light is sealed for ${hours} hour${hours > 1 ? 's' : ''}.`,
          'devil',
        );
        if (!killed) g.hud.toast('…and nothing was there to take.', 'warn');
        g.audio.play('devil');
        break;
      }
      case 'inferno':
        if (alt) {
          g.fx.ring(this.center().setY(this.pos.y + 0.3), 7, 0xff5010, 0.7);
          for (const e of g.enemies) if (e.alive && e.pos.distanceTo(this.pos) < 7.5) {
            g.damageEnemy(e, power * 0.9, 'fire', { source: 'spell' });
            e.status.burn = 3;
          }
        } else {
          g.spawnProjectile({ from: this.center().add(new THREE.Vector3(0, 0.4, 0)), to: aim, speed: 30, kind: 'fireball', owner: 'player', damage: power, element: 'fire', gravity: 0, source: null, explode: 2.5, burn: true });
        }
        break;
      case 'wrath-of-thor': {
        const at = aim.clone();
        g.fx.lightning(at.clone().add(new THREE.Vector3(0, 30, 0)), at);
        for (const e of g.enemies) if (e.alive && e.center().distanceTo(at) < 3.5) {
          g.damageEnemy(e, power * (e.status.wet > 0 ? 2 : 1), 'lightning', { source: 'spell' });
          e.status.stun = Math.max(e.status.stun, 0.6);
        }
        g.addTornado(at, 3.5, power * 0.15, 0x9ab0c8);
        break;
      }
      case 'waterspike': {
        const at = target ? target.pos.clone() : aim;
        g.fx.spikes(at.x, at.z);
        for (const e of g.enemies) if (e.alive && Math.hypot(e.pos.x - at.x, e.pos.z - at.z) < 2.8) {
          g.damageEnemy(e, power, 'water', { source: 'spell' });
          e.status.wet = 6;
          e.vel.y = 5;
        }
        break;
      }
      case 'way-of-the-wind':
        if (alt) {
          const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          for (const e of g.enemies) {
            const to = e.pos.clone().sub(this.pos);
            if (e.alive && to.length() < 14 && to.normalize().dot(fwd) > 0.5) e.status.slow = 6;
          }
          g.fx.emit(this.center(), { color: 0xd0f0ff, count: 60, speed: 14, life: 0.6, size: 0.7, drift: fwd.multiplyScalar(10) });
        } else {
          this.speedBuff = 8;
          g.fx.emit(this.center(), { color: 0xd0f0ff, count: 40, speed: 6, life: 0.6 });
        }
        break;
      case 'blade-of-retribution': {
        if (!target) return g.hud.toast('No target.');
        const dmg = retribution(target.damageDealt);
        if (dmg <= 0) {
          g.hud.toast(`${target.name} has harmed no one.`);
        } else {
          g.damageEnemy(target, dmg, 'true', { source: 'spell' });
          g.hud.toast(`Retribution: ${dmg} returned.`, 'skill');
        }
        g.fx.pillar(target.center(), 0xe0e0ff, 1);
        break;
      }
      case 'soul-or-power':
        this.soulOrPower = true;
        this.mana = 0;
        g.hud.toast('Your soul is bargained. Spells are free; every wound is forever.', 'devil');
        break;
      case 'power-of-the-light':
        this.hp = this.maxHp;
        this.mana = this.maxMana;
        castPowerOfTheLight(c, g.gameMinutes);
        g.fx.pillar(this.pos.clone(), 0xfff0b0, 2);
        break;
      case 'imp-familiar':
        g.addAlly(new Ally('imp', this.pos.x + 1, this.pos.z - 1, c.level, 30));
        g.fx.emit(this.center(), { color: 0xff5010, count: 40, speed: 4, life: 0.6 });
        break;
      case 'holy-smite':
        if (!target) return g.hud.toast('No target.');
        g.fx.pillar(target.pos.clone(), 0xfff0b0, 1.5);
        g.damageEnemy(target, power, 'light', { source: 'spell' });
        break;
      case 'radiant-heal':
        this.heal(power);
        g.fx.emit(this.center(), { color: 0xfff0b0, count: 40, speed: 2, life: 1, up: 2 });
        break;
      case 'aegis-of-light':
        this.aegis = 3;
        g.fx.ring(this.center(), 2, 0xfff0b0, 0.5);
        break;
      case 'stone-skin':
        this.stoneSkin = 12;
        g.fx.emit(this.center(), { color: 0xa08060, count: 40, speed: 3, life: 0.8 });
        break;
      case 'moonveil':
        this.moonveil = 10;
        for (const e of g.enemies) if (e.aware && !(e instanceof Boss) && e.pos.distanceTo(this.pos) > 5) (e.aware = false), (e.awareness = 0), (e.state = 'return');
        g.fx.emit(this.center(), { color: 0x8090ff, count: 40, speed: 3, life: 0.8 });
        break;
    }
    if (spell !== 'soul-or-power') this.mana -= check.cost;
    this.castCooldown(spell, def.cooldown);
    if (spell !== 'deal-with-the-devil') this.startAttack('cast', 0.55, 0.4);
    if (def.school === 'light') g.audio.play('holy');
    else g.audio.play('spell');
  }

  private castCombo(g: Game, id: string, power: number) {
    const target = this.lockTarget ?? g.findTarget(30, 0.75, false);
    const aim = target ? target.center() : g.aimPoint(30);
    switch (id) {
      case 'firestorm':
        g.addTornado(aim, 4.5, power * 0.25, 0xff5010, 6, true);
        break;
      case 'storm-surge':
        g.fx.spikes(aim.x, aim.z, 0x60b0ff, 12, 5);
        g.fx.lightning(aim.clone().add(new THREE.Vector3(0, 30, 0)), aim);
        for (const e of g.enemies) if (e.alive && e.pos.distanceTo(aim) < 6) {
          e.status.wet = 6;
          g.damageEnemy(e, power * 2, 'lightning', { source: 'spell' });
          e.status.stun = 1;
        }
        break;
      case 'scalding-geyser':
        g.fx.spikes(aim.x, aim.z, 0xffa060, 10, 4);
        g.fx.emit(aim, { color: 0xffffff, count: 80, speed: 8, life: 1.2, up: 10, size: 1.4 });
        for (const e of g.enemies) if (e.alive && e.pos.distanceTo(aim) < 5) {
          g.damageEnemy(e, power, 'fire', { source: 'spell' });
          e.status.burn = 5;
        }
        break;
      case 'tempest': {
        const near = g.enemies.filter((e) => e.alive && e.pos.distanceTo(this.pos) < 16).slice(0, 6);
        for (const e of near) {
          g.fx.lightning(e.center().add(new THREE.Vector3(0, 25, 0)), e.center());
          g.damageEnemy(e, power * 0.8 * (e.status.wet > 0 ? 2 : 1), 'lightning', { source: 'spell' });
        }
        g.addTornado(this.pos.clone(), 6, power * 0.1, 0x9ab0c8, 4);
        break;
      }
      case 'thunderfire':
        g.spawnProjectile({ from: this.center().add(new THREE.Vector3(0, 0.4, 0)), to: aim, speed: 55, kind: 'bolt', owner: 'player', damage: power, element: 'fire', gravity: 0, source: null, explode: 4.5, burn: true });
        break;
      case 'frost-gale': {
        const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        for (const e of g.enemies) {
          const to = e.pos.clone().sub(this.pos);
          if (e.alive && to.length() < 16 && to.normalize().dot(fwd) > 0.45) {
            e.status.root = 3;
            e.status.wet = 4;
            g.damageEnemy(e, power * 0.6, 'water', { source: 'spell' });
          }
        }
        g.fx.emit(this.center(), { color: 0xc0f0ff, count: 90, speed: 16, life: 0.8, size: 0.6, drift: fwd.multiplyScalar(12) });
        break;
      }
    }
  }

  // ----------------------------------------------------------- the ancient --

  private ancientPowers(dt: number, g: Game) {
    this.gazeTick -= dt;
    this.thunderCd -= dt;
    if (this.gazeTick <= 0) {
      this.gazeTick = 1;
      for (const e of g.enemies) {
        if (!e.alive || !e.aware) continue;
        const d = e.pos.distanceTo(this.pos);
        const facing = Math.cos(Math.atan2(this.pos.x - e.pos.x, this.pos.z - e.pos.z) - e.yaw);
        if (d < 15 && facing > 0.5) {
          g.damageEnemy(e, 3 + this.c.level, 'dark', { source: 'gaze', quiet: true });
          g.fx.emit(e.center(), { color: 0x40ff80, count: 4, speed: 1, life: 0.6 });
        }
      }
    }
    if (this.hp < this.maxHp * 0.3 && this.thunderCd <= 0) {
      const t = g.findTarget(12, -1, true);
      if (t) {
        this.thunderCd = 2.5;
        g.fx.lightning(t.center().add(new THREE.Vector3(0, 25, 0)), t.center(), 0x80ffa0);
        g.damageEnemy(t, 20 + 2 * this.c.level, 'lightning', { source: 'spell' });
      }
    }
  }

  // ----------------------------------------------------------------- boats --

  board(g: Game, boat: THREE.Object3D) {
    this.sailing = true;
    this.boat = boat;
    this.crouching = false;
    this.pos.set(boat.position.x, WATER_LEVEL + 0.4, boat.position.z);
    g.hud.toast('You take the helm. (F or Jump to step ashore)');
  }

  private disembark(g: Game) {
    // Find land within a few steps.
    for (let r = 2; r <= 8; r += 2) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = this.pos.x + Math.sin(this.yaw + a) * r;
        const z = this.pos.z + Math.cos(this.yaw + a) * r;
        if (heightAt(x, z) > WATER_LEVEL + 0.2) {
          this.sailing = false;
          if (this.boat) this.boat.position.set(this.pos.x, WATER_LEVEL + 0.05, this.pos.z);
          this.boat = null;
          this.pos.set(x, heightAt(x, z), z);
          return;
        }
      }
    }
    g.hud.toast('No shore close enough.');
  }

  // ------------------------------------------------------------- animation --

  private syncAnim(dt: number, sprint: boolean) {
    const a = this.anim;
    a.t += dt;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    a.moving = Math.min(1, speed / 4);
    a.phase += speed * dt * (sprint ? 1.6 : 1.9);
    a.blocking = this.blocking;
    a.crouching = this.crouching && this.grounded;
    a.swimming = this.swimming;
    a.flying = this.flying;
    a.airborne = !this.grounded && !this.swimming && !this.sailing;
    a.rolling = this.rollT;
    a.draw = this.drawing;
    a.dead = -1;
    if (this.attack) {
      a.attack = Math.min(1, this.attack.t / this.attack.duration);
      const kind = this.weaponKind;
      a.attackStyle =
        this.attack.kind === 'cast' ? 'cast'
        : this.attack.kind === 'spin' ? 'spin'
        : this.attack.kind === 'throw' ? 'throw'
        : this.attack.kind === 'heavy' || kind === 'axe' && this.attack.combo % 2 === 1 || kind === 'hammer' ? 'overhead'
        : kind === 'dagger' || kind === 'trident' ? 'thrust'
        : 'slash';
    } else a.attack = -1;
    if (this.rig.wings) this.rig.wings.userData.enabled = dracoFlightHours(this.c) > 0;
    if (this.sailing) {
      a.moving = 0;
      a.crouching = true;
    }
  }

  private syncModel() {
    const r = this.rig.root;
    r.position.copy(this.pos);
    r.rotation.y = this.yaw;
    r.visible = this.moonveil <= 0 || Math.floor(this.anim.t * 6) % 3 !== 0;
    animateHumanoid(this.rig, this.anim);
    if (this.boat) {
      this.boat.position.set(this.pos.x, WATER_LEVEL + 0.05 + Math.sin(this.anim.t * 2) * 0.06, this.pos.z);
      this.boat.rotation.y = this.yaw;
      r.position.y = WATER_LEVEL + 0.35;
    }
  }

  hasBloodsteal() {
    return hasBloodsteal(this.c, this.fury);
  }
  immuneToBleed() {
    return immuneToBleed(this.c, this.fury);
  }
  costOf(spell: SpellId) {
    return spellCost(this.c, spell);
  }
}

function rotateTowards(from: number, to: number, step: number) {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return from + d * Math.min(1, step);
}

export function buildPlayerRig(c: Character): Rig {
  const skin = c.raceId === 'draco' ? 0x5a6a4a : c.raceId === 'elf' ? 0xe0c8a8 : c.raceId === 'ancient' ? 0x3a3a44 : 0xc89a78;
  const look = {
    warrior: { armor: 0x7a7468, cloth: 0x4a3a2a, accent: 0xb0904a, build: 'heavy' as const, head: 'helmet' as const, cape: 0x5a1a14 },
    ranger: { armor: 0x4a5a3a, cloth: 0x2e3a26, accent: 0x8a7a4a, build: 'light' as const, head: 'hood' as const, cape: 0x2a3a22 },
    mage: { armor: 0x3a2e5a, cloth: 0x2a2244, accent: 0xc0a050, build: 'robe' as const, head: 'hat' as const, cape: undefined },
  }[c.classId];
  if (c.roleId === 'knight') {
    look.armor = 0xc8c0a8;
    look.accent = 0xffe080;
    look.cape = 0xe8e0c8;
  }
  if (c.roleId === 'assassin' || c.roleId === 'darkslayer') {
    look.cloth = 0x18161a;
    look.cape = 0x101012;
    if (c.classId !== 'warrior') look.armor = 0x24222a;
  }
  return buildHumanoid({
    skin,
    ...look,
    head: c.raceId === 'ancient' ? 'hood' : look.head,
    ears: c.raceId === 'elf',
    horns: c.raceId === 'draco',
    tail: c.raceId === 'draco',
    wings: c.raceId === 'draco',
    glowEyes: c.raceId === 'ancient' ? 0x40ff80 : undefined,
  });
}
