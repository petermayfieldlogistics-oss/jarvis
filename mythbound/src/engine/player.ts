import * as THREE from 'three';
import { SPELLS, WEAPONS, type ClassId, type DamageElement, type SpellId, type SpellSchool, type WeaponKind } from '../data/defs';
import {
  dracoFireRegen, dracoFlightHours, dracoWaterDamagePerSecond, drawTimeMultiplier, manaRegen, maxHp, maxMana, maxStamina, maxTamed, moveSpeed, rank,
  staminaRegen, tameableKinds, weaponDamage, type Character,
} from '../rules/character';
import {
  BLOODRAGE, bleedChance, bloodrageDuration, canCast, canCombine, canWield, castPowerOfTheLight, comboCost, comboFor, comboPower, cooldownMultiplier, devilRingAffects, hasBloodrage,
  hasBloodsteal, immuneToBleed, mainWeapon, newFury, onMeleeLanded, onMeleeMissed, powerShot, retribution, spellCost, spellPowerMultiplier, strikeDevilDeal,
  type FuryState,
} from '../rules/combat';
import { buildShield, buildWeapon, compact, disposeObject, setBowString } from './models';
import { animateHumanoid, buildHumanoid, type Rig } from './humanoid';
import { newAnim, type AnimState, type AttackStyle } from './anim';
import { heightAt, inLava, SWIM_DEPTH, WATER_LEVEL } from './terrain';
import { Ally, Boss, Enemy } from './entities';
import type { Game } from './game';

type AttackKind = 'light' | 'heavy' | 'spin' | 'throw' | 'cast' | 'bow' | 'roar';

interface Attack {
  kind: AttackKind;
  style: AttackStyle;
  t: number;
  duration: number;
  /** Seconds into the move: the blow lands. */
  hitAt: number;
  /** The blade's active window (trails), seconds. */
  from: number;
  to: number;
  /** From here the next move may follow (buffered presses fire). */
  chainAt: number;
  /** From here a roll may cut the recovery short. */
  cancelAt: number;
  /** Forward step (root motion) in metres, spread from stepFrom to hitAt. */
  step: number;
  stepFrom: number;
  done: boolean;
  landed: boolean;
  combo: number;
  finisher: boolean;
  /** Facing chosen at the start of the swing. */
  aim: number;
  /** Where the animation starts (a bow loose begins at the release). */
  anim0: number;
}

/**
 * When each move lands, its active window and its forward step, as fractions
 * of the move's duration. They follow the hit keys of the humanoid animator.
 */
export const TIMING: Partial<Record<AttackStyle, { hit: number; from: number; to: number; step: number }>> = {
  slash: { hit: 0.46, from: 0.35, to: 0.64, step: 0.45 },
  slash2: { hit: 0.44, from: 0.33, to: 0.62, step: 0.4 },
  slash3: { hit: 0.5, from: 0.41, to: 0.72, step: 0.75 },
  overhead: { hit: 0.56, from: 0.46, to: 0.76, step: 0.6 },
  heavy: { hit: 0.56, from: 0.45, to: 0.8, step: 0.9 },
  thrust: { hit: 0.46, from: 0.34, to: 0.62, step: 0.65 },
  spin: { hit: 0.5, from: 0.24, to: 0.84, step: 0.3 },
  throw: { hit: 0.45, from: 0.32, to: 0.45, step: 0.2 },
  cast: { hit: 0.4, from: 0, to: 0.7, step: 0 },
  bow: { hit: 0, from: 0, to: 0, step: 0 },
  roar: { hit: 0.36, from: 0, to: 1, step: 0 },
};

/** The next light swing may follow this long after the last one ended. */
const COMBO_WINDOW = 0.6;
/** Presses are remembered this long while a move finishes. */
const BUFFER = 0.4;
const ROLL = { time: 0.6, dist: 3.9, iFrom: 0.08, iTo: 0.4 };
const BACKSTEP = { time: 0.42, dist: 2.3, iFrom: 0.05, iTo: 0.26 };

/** The part of the weapon that leaves a trail, along its local +Y from the grip: [start, tip]. */
export const BLADE: Record<WeaponKind, [number, number]> = {
  sword: [0.55, 1.2], axe: [0.6, 1.0], hammer: [0.8, 1.2], dagger: [0.2, 0.5], trident: [1.35, 2.0], staff: [1.1, 1.6], bolt: [0.4, 1.0], bow: [0, 0],
};

export const ELEMENT_COLOR: Record<DamageElement, number> = {
  physical: 0xdfe8ff, fire: 0xff7a1a, light: 0xffd25a, lightning: 0xa8d0ff, dark: 0x9a4dff, water: 0x3ee0ff, wind: 0xc8ffe4, earth: 0xc8a070, true: 0xffffff,
};

const SCHOOL_COLOR: Record<SpellSchool, number> = {
  devil: 0xb8121a, fire: 0xff6a1a, sky: 0xa8ccff, water: 0x2ad8ff, light: 0xffd25a, arcane: 0xa060ff, earth: 0xa8743a,
};

export const RAGE_RED = 0xff2a12;
const UP = new THREE.Vector3(0, 1, 0);
const smooth01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** The light combo for each weapon: three steps, the last a finisher. */
function lightStyle(kind: WeaponKind, step: number): AttackStyle {
  if (kind === 'dagger') return step === 1 ? 'slash2' : 'thrust';
  if (kind === 'trident') return step === 2 ? 'slash3' : 'thrust';
  if (step === 2) return kind === 'axe' || kind === 'hammer' ? 'overhead' : 'slash3';
  return step === 1 ? 'slash2' : 'slash';
}

export class Player {
  c: Character;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  radius = 0.45;
  hp: number;
  mana: number;
  stamina: number;
  /** Seconds until stamina starts coming back after it was spent. */
  staminaWait = 0;
  /** Ran dry: no sprinting or blocking until a third of it is back. */
  exhausted = false;
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
  /** Running flat out this frame (the camera widens its view). */
  sprinting = false;
  /** -1, or 0..1 through a roll or backstep. */
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
  private rollTime = 0;
  private backstep = false;
  private queued: 'light' | 'heavy' | null = null;
  private queuedAt = -9;
  private rollQueuedAt = -9;
  private lastSwingEnd = -9;
  private lastKind: AttackKind | null = null;
  private rageAura: { stop(): void } | null = null;
  private shotAura: { stop(): void } | null = null;
  private tv = new THREE.Vector3();
  private tv2 = new THREE.Vector3();

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

  /** Pays for an action. Spending pauses regen briefly; running dry leaves the hero winded. */
  spend(n: number, wait = 0.4) {
    this.stamina = Math.max(0, this.stamina - n);
    if (this.stamina <= 0) {
      this.exhausted = true;
      wait = 1;
    }
    this.staminaWait = Math.max(this.staminaWait, wait);
  }

  /** Full stamina (resting, respawning, levelling up). */
  refillStamina() {
    this.stamina = this.maxStamina;
    this.staminaWait = 0;
    this.exhausted = false;
  }
  get weaponKind(): WeaponKind {
    return WEAPONS[mainWeapon(this.c).id].kind;
  }
  get spell(): SpellId | null {
    return this.c.spellSlots[this.selected] ?? null;
  }
  center(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + (this.crouching ? 0.8 : 1.15), this.pos.z);
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
    const gear = attachGear(this.rig, this.c.classId, mainWeapon(this.c).id);
    this.weaponMesh = gear.weapon;
    this.shieldMesh = gear.shield;
  }

  ready(key: string) {
    return (this.cooldowns.get(key) ?? 0) <= this.now;
  }
  cooldownLeft(key: string) {
    return Math.max(0, (this.cooldowns.get(key) ?? 0) - this.now);
  }

  knockback(dir: THREE.Vector3, force: number) {
    // A well-timed roll slips through charges as well as blows.
    if (this.iframes > 0) return;
    this.vel.x += dir.x * force;
    this.vel.z += dir.z * force;
    this.vel.y = 4;
    this.grounded = false;
    this.stagger = 0.4;
    this.attack = null;
    this.rollT = -1;
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
      this.sprinting = false;
      this.attack = null;
      this.rollT = -1;
      this.syncAuras(g);
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
    this.syncAuras(g);
    if (this.healing > 0) {
      const step = Math.min(this.healing, this.maxHp * 0.6 * dt);
      this.healing -= step;
      this.heal(step);
    }

    // Shift lock: the hero faces where the camera looks.
    if (input.pressed.has('shiftlock')) {
      g.cam.shiftLock = !g.cam.shiftLock;
      input.setShiftLock(g.cam.shiftLock);
      g.hud.toast(g.cam.shiftLock ? 'Shift lock on' : 'Shift lock off');
    }
    const shiftLock = g.cam.shiftLock;

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
    const sprint = input.held.has('sprint') && wantLen > 0.1 && !this.exhausted && this.stamina > 0 && !this.swimming && !this.crouching && !this.blocking && this.drawing === 0 && !this.attack;
    let speed = moveSpeed(c) * (sprint ? 1.55 : 1) * (this.crouching ? 0.5 : 1) * (this.speedBuff > 0 ? 1.6 : 1);
    if (this.blocking || this.drawing > 0) speed *= 0.45;
    const atk = this.attack;
    if (atk && atk.kind !== 'cast') speed *= atk.kind === 'roar' ? 0 : atk.t < atk.chainAt ? 0.2 : 0.45;
    // Facing the camera or a foe, walking backward is slower.
    if ((shiftLock || this.lockTarget) && wantLen > 0.1 && !this.sailing) {
      const ahead = (wantX * Math.sin(this.yaw) + wantZ * Math.cos(this.yaw)) / wantLen;
      if (ahead < 0) speed *= 1 + 0.28 * ahead;
    }
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
    this.sprinting = sprint && !this.swimming && !this.sailing && this.rollT < 0;

    // Rolling: buffered, and allowed to cut a swing's recovery short.
    if (input.pressed.has('roll')) this.rollQueuedAt = this.now;
    if (this.now - this.rollQueuedAt < BUFFER && canAct && !this.swimming && !this.flying && this.grounded && this.stamina > 0 && (!this.attack || this.attack.t >= this.attack.cancelAt)) {
      this.rollQueuedAt = -9;
      this.startRoll(g, wantX, wantZ, wantLen);
    }
    if (this.rollT >= 0) {
      const R = this.backstep ? BACKSTEP : ROLL;
      this.rollTime += dt;
      const u = Math.min(1, this.rollTime / R.time);
      this.rollT = u;
      if (this.rollTime >= R.iFrom && this.rollTime < R.iTo) this.iframes = Math.max(this.iframes, R.iTo - this.rollTime);
      // Root motion: a burst that eases out (position follows 1 - (1 - u)^2).
      wantX = this.rollDir.x;
      wantZ = this.rollDir.z;
      speed = (R.dist * 2 * (1 - u)) / R.time;
      if (u >= 1) this.endRoll(g);
    }

    // Facing.
    const target = this.lockTarget;
    const a = this.attack;
    const swinging = !!a && a.kind !== 'cast' && a.kind !== 'bow';
    if (this.rollT >= 0) {
      if (!this.backstep) this.faceTowards(this.pos.x + this.rollDir.x, this.pos.z + this.rollDir.z, dt, 30);
    } else if (swinging) {
      // A swing commits to its direction once the blade starts moving.
      if (a.t < a.from) this.yaw = rotateTowards(this.yaw, target ? Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z) : a.aim, dt, 24);
    } else if (target) {
      this.faceTowards(target.pos.x, target.pos.z, dt, 12);
    } else if ((shiftLock && !this.sailing) || this.drawing > 0 || a) {
      this.yaw = rotateTowards(this.yaw, camYaw, dt, shiftLock ? 22 : 14);
    } else if (wantLen > 0.1) {
      this.faceTowards(this.pos.x + wantX, this.pos.z + wantZ, dt, 10);
    }

    // Integrate horizontal velocity (with knockback decay).
    const len = Math.hypot(wantX, wantZ);
    const tx = len > 0.01 ? (wantX / Math.max(1, len)) * speed : 0;
    const tz = len > 0.01 ? (wantZ / Math.max(1, len)) * speed : 0;
    if (this.rollT >= 0) {
      this.vel.x = tx;
      this.vel.z = tz;
    } else {
      const accel = this.grounded || this.swimming || this.flying ? 14 : 3;
      this.vel.x += (tx - this.vel.x) * Math.min(1, dt * accel);
      this.vel.z += (tz - this.vel.z) * Math.min(1, dt * accel);
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (this.attack) this.rootMotion(dt, g);
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
    const wasAirborne = !this.grounded;
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
        this.spend(6);
      }
      this.vel.y -= 24 * dt;
      this.pos.y += this.vel.y * dt;
    }
    const floor = walksOnWater ? Math.max(ground, WATER_LEVEL) : ground;
    if (!this.swimming && !this.sailing && this.pos.y <= floor) {
      const fall = -this.vel.y;
      if (!this.grounded && this.vel.y < -22) g.damagePlayer(Math.round((-this.vel.y - 22) * 4), 'true', null, true);
      if (wasAirborne && fall > 3 && !this.flying) this.land(g, fall);
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

    // Stamina and mana. Regen waits a moment after spending (a beat longer
    // when run dry) and trickles while guarding.
    const spending = sprint || this.attack || this.rollT >= 0 || this.drawing > 0;
    if (sprint) this.spend(14 * dt);
    if (!spending) this.staminaWait = Math.max(0, this.staminaWait - dt);
    if (!spending && this.staminaWait <= 0 && !(this.swimming && c.roleId !== 'sailor')) this.stamina = Math.min(this.maxStamina, this.stamina + staminaRegen(c) * dt * (this.blocking ? 0.4 : 1));
    if (this.exhausted && this.stamina >= this.maxStamina * 0.3) this.exhausted = false;
    if (!this.soulOrPower) this.mana = Math.min(this.maxMana, this.mana + manaRegen(c) * dt);
    else this.mana = 0;

    // Blocking.
    this.blocking = input.held.has('block') && canAct && !this.attack && !this.swimming && !this.flying && this.weaponKind !== 'bow' && !this.exhausted && this.stamina > 0;

    // Attacks.
    if (canAct && !this.swimming) this.handleAttack(dt, g, wantX, wantZ, wantLen);
    else if (input.pressed.has('attack') || input.pressed.has('heavy')) {
      // Remember a press made mid-roll so the swing comes out as it ends.
      this.queued = input.pressed.has('heavy') ? 'heavy' : 'light';
      this.queuedAt = this.now;
    }
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
    this.syncAnim(dt);
    this.syncModel();
    this.weaponTrail(g);
  }

  private faceTowards(x: number, z: number, dt: number, rate: number) {
    this.yaw = rotateTowards(this.yaw, Math.atan2(x - this.pos.x, z - this.pos.z), dt, rate);
  }

  /** Starts a roll toward the input direction, or a backstep hop without one. */
  private startRoll(g: Game, wantX: number, wantZ: number, wantLen: number) {
    this.backstep = wantLen <= 0.1;
    this.rollT = 0;
    this.rollTime = 0;
    this.spend((this.backstep ? 12 : 18) * (1 - 0.25 * rank(this.c, 'tumble')));
    if (this.attack) this.finishAttack();
    this.queued = null;
    this.drawing = 0;
    this.crouching = false;
    this.blocking = false;
    if (this.backstep) {
      this.rollDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.vel.y = 3.2;
      this.grounded = false;
    } else {
      this.rollDir.set(wantX / wantLen, 0, wantZ / wantLen);
    }
    g.sfx.dust(this.pos, this.backstep ? 5 : 8);
    g.audio.play('roll');
  }

  private endRoll(g: Game) {
    this.rollT = -1;
    if (!this.backstep) g.sfx.dust(this.tv.copy(this.pos).addScaledVector(this.rollDir, 0.3), 10);
    this.backstep = false;
  }

  /** Touching down: a knee bend scaled by the fall, and dust after a big one. */
  private land(g: Game, fall: number) {
    this.anim.landing = Math.max(this.anim.landing, Math.min(1, 0.2 + (fall - 3) / 13));
    if (fall > 9) {
      g.sfx.dust(this.pos, Math.min(22, 4 + fall));
      if (fall > 15) g.shake(Math.min(0.3, fall / 70));
    }
  }

  /** Keeps the BloodRage and Power Shot auras in step with their states. */
  private syncAuras(g: Game) {
    const rage = this.alive && this.fury.bloodrageActive;
    if (rage && !this.rageAura) this.rageAura = g.fx.aura(this.rig.root, RAGE_RED, Math.max(0.5, this.bloodrageUntil - this.now));
    else if (!rage && this.rageAura) {
      this.rageAura.stop();
      this.rageAura = null;
    }
    const shot = this.alive && this.powerShotArmed;
    if (shot && !this.shotAura) this.shotAura = g.fx.aura(this.rig.root, 0xffd060, Infinity);
    else if (!shot && this.shotAura) {
      this.shotAura.stop();
      this.shotAura = null;
    }
  }

  // ---------------------------------------------------------------- combat --

  private handleAttack(dt: number, g: Game, wantX: number, wantZ: number, wantLen: number) {
    const input = g.input;
    const kind = this.weaponKind;
    if (kind === 'bow') {
      const loosing = this.attack?.kind === 'bow';
      if (input.held.has('attack') && (!this.attack || loosing)) {
        if (this.drawing === 0 && this.arrows() <= 0) {
          if (input.pressed.has('attack')) g.hud.toast('No arrows.');
          return;
        }
        if (loosing) this.attack = null;
        const drawTime = 0.9 * drawTimeMultiplier(this.c);
        this.drawing = Math.min(1, this.drawing + dt / drawTime);
        this.spend(4 * dt);
        if (this.drawing > 0 && this.drawing < 0.05) g.audio.play('draw');
      }
      if (input.released.has('attack') && this.drawing > 0) {
        this.fireArrow(g, Math.max(0.25, this.drawing));
        this.drawing = 0;
        // The follow-through of the loose.
        this.startAttack('bow', 'bow', 0.32);
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

    if (input.pressed.has('attack')) (this.queued = 'light'), (this.queuedAt = this.now);
    if (input.pressed.has('heavy')) (this.queued = 'heavy'), (this.queuedAt = this.now);
    if (!this.queued) return;
    if (this.now - this.queuedAt > BUFFER) {
      this.queued = null;
      return;
    }
    const cur = this.attack;
    // Wait for the current move to reach the point where the next may follow.
    if (cur && cur.t < cur.chainAt) return;
    // Out of stamina: keep the press (it expires after BUFFER) until some is back.
    if (this.stamina <= 0) return;
    const heavy = this.queued === 'heavy';
    this.queued = null;

    if (kind === 'bolt') {
      this.startAttack('throw', 'throw', 0.75);
    } else {
      const w = WEAPONS[mainWeapon(this.c).id];
      const quick = drawTimeMultiplier(this.c) < 1 ? 0.85 : 1;
      const dur = (1 / w.speed) * 0.9 * quick;
      const thrift = 1 - 0.2 * rank(this.c, 'blade-dancer') - 0.15 * rank(this.c, 'blade-master');
      if (!heavy) {
        const chained = cur ? cur.kind === 'light' : this.lastKind === 'light' && this.now - this.lastSwingEnd < COMBO_WINDOW;
        this.comboStep = chained ? (this.comboStep + 1) % 3 : 0;
        this.spend(12 * thrift);
        const finisher = this.comboStep === 2;
        this.startAttack('light', lightStyle(kind, this.comboStep), dur * (finisher ? 1.25 : 1), { finisher });
      } else {
        this.spend(25 * thrift);
        this.comboStep = 0;
        if (this.c.subclassId === 'swordsman') {
          this.startAttack('spin', 'spin', dur * 1.5, rank(this.c, 'lunge') ? { step: 2.2 } : {});
          g.hud.toast('Spinner Flourish!', 'skill');
        } else if (this.c.subclassId === 'axeman' && rank(this.c, 'throwing-axe')) {
          this.startAttack('throw', 'throw', 0.7);
        } else {
          // A lunge carries the heavy blow several steps forward.
          this.startAttack('heavy', kind === 'axe' || kind === 'hammer' ? 'overhead' : 'heavy', dur * 1.6, { step: 0.9 + 2.2 * rank(this.c, 'lunge') });
        }
      }
    }
    if (this.attack) this.attack.aim = this.pickAim(g, wantX, wantZ, wantLen);
  }

  /** Which way a new swing should face: the lock-on, the camera in shift lock, the stick, or a foe close in front. */
  private pickAim(g: Game, wantX: number, wantZ: number, wantLen: number): number {
    const t = this.lockTarget;
    if (t) return Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    const shift = g.cam.shiftLock;
    const yaw = shift ? g.camYaw : wantLen > 0.1 ? Math.atan2(wantX, wantZ) : this.yaw;
    const reach = WEAPONS[mainWeapon(this.c).id].range + 1.5;
    const cone = shift ? 0.8 : 0.35;
    let best = yaw;
    let bestD = Infinity;
    for (const e of g.enemies) {
      if (!e.alive || Math.abs(e.pos.y - this.pos.y) > 3) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz) - e.radius;
      if (d > reach || d >= bestD) continue;
      const dir = Math.atan2(dx, dz);
      if (Math.cos(dir - yaw) < cone) continue;
      best = dir;
      bestD = d;
    }
    return best;
  }

  private startAttack(kind: AttackKind, style: AttackStyle, duration: number, o: { finisher?: boolean; step?: number } = {}) {
    const tm = TIMING[style] ?? TIMING.slash!;
    if (this.attack) this.finishAttack();
    const fixed = kind === 'roar';
    this.attack = {
      kind,
      style,
      t: 0,
      duration,
      hitAt: tm.hit * duration,
      from: tm.from * duration,
      to: tm.to * duration,
      chainAt: (fixed ? 1 : tm.to) * duration,
      cancelAt: (fixed ? 1 : kind === 'cast' || kind === 'bow' ? 0 : Math.min(tm.to, tm.hit + 0.06)) * duration,
      step: o.step ?? tm.step * (o.finisher ? 1.3 : 1),
      stepFrom: Math.max(0, tm.from - 0.14) * duration,
      done: false,
      landed: false,
      combo: this.comboStep,
      finisher: !!o.finisher,
      aim: this.yaw,
      anim0: kind === 'bow' ? 0.62 : 0,
    };
    this.crouching = this.crouching && this.c.roleId === 'assassin';
  }

  private finishAttack() {
    const a = this.attack;
    if (!a) return;
    this.lastKind = a.kind;
    this.lastSwingEnd = this.now;
    this.attack = null;
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
        this.swingFx(g, a);
      } else if (a.kind === 'throw') {
        this.throwWeapon(g);
      } else if (a.kind === 'roar') {
        this.roarFx(g);
      }
      if (a.landed && this.c.subclassId === 'axeman' && a.kind === 'heavy' && !this.grounded && rank(this.c, 'earthsplitter')) {
        g.sfx.ring(this.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 5, 0xc8a070);
      }
    }
    if (this.attack === a && a.t >= a.duration) this.finishAttack();
  }

  /** The swing's forward step, stopping short of a foe in the way. */
  private rootMotion(dt: number, g: Game) {
    const a = this.attack!;
    if (a.step <= 0 || a.t + dt <= a.stepFrom || a.t >= a.hitAt) return;
    const span = Math.max(1e-3, a.hitAt - a.stepFrom);
    let d = a.step * (smooth01((a.t + dt - a.stepFrom) / span) - smooth01((a.t - a.stepFrom) / span));
    if (d <= 0) return;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    for (const e of g.enemies) {
      if (!e.alive || Math.abs(e.pos.y - this.pos.y) > 2.5) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0 || Math.abs(dx * fz - dz * fx) > e.radius + this.radius) continue;
      d = Math.min(d, Math.max(0, ahead - e.radius - this.radius - 0.3));
    }
    this.pos.x += fx * d;
    this.pos.z += fz * d;
  }

  private meleeHit(g: Game, a: Attack): boolean {
    const w = mainWeapon(this.c);
    const def = WEAPONS[w.id];
    const reach = def.range + (a.kind === 'spin' ? 0.8 + 0.3 * rank(this.c, 'wide-flourish') * def.range : 0);
    const arc = a.kind === 'spin' ? -1.01 : rank(this.c, 'cleave') ? -0.2 : 0.25;
    let base = weaponDamage(w) * (a.kind === 'heavy' ? 1.8 : a.kind === 'spin' ? 1.3 * (1 + 0.2 * rank(this.c, 'wide-flourish')) : 1);
    if (a.finisher && a.kind === 'light') base *= 1.35;
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
      if (def.element !== 'physical') g.sfx.impact(e.center(this.tv), ELEMENT_COLOR[def.element], 0.7);
    }
    if (landed) {
      // Hit-stop and shake scaled to the blow.
      const big = a.kind === 'heavy' ? 1 : a.kind === 'spin' ? 0.7 : a.finisher ? 0.75 : 0;
      g.hitStop(0.055 + 0.065 * big);
      g.shake(0.12 + 0.2 * big);
    }
    return landed;
  }

  /** Dust and sparks for the bigger moves as they land. */
  private swingFx(g: Game, a: Attack) {
    if (a.kind === 'spin') {
      // A ring of dust thrown out by the turning feet, and a shock along the ground.
      const reach = WEAPONS[mainWeapon(this.c).id].range;
      for (let i = 0; i < 8; i++) {
        const t = (i / 8) * Math.PI * 2;
        g.sfx.dust(this.tv.set(this.pos.x + Math.cos(t) * 1.1, this.pos.y, this.pos.z + Math.sin(t) * 1.1), 3);
      }
      g.sfx.shockwave(this.tv.set(this.pos.x, this.pos.y + 0.12, this.pos.z), reach + 0.8, this.trailColor(), 0.32);
      return;
    }
    if ((a.kind !== 'heavy' && !a.finisher) || !this.weaponMesh) return;
    // A blade driven into the ground kicks up dirt.
    this.weaponMesh.updateWorldMatrix(true, false);
    const tip = this.weaponMesh.localToWorld(this.tv.set(0, BLADE[this.weaponKind][1], 0));
    const gy = heightAt(tip.x, tip.z);
    if (tip.y - gy < 0.7) {
      tip.y = Math.max(gy, WATER_LEVEL);
      g.sfx.dust(tip, a.kind === 'heavy' ? 14 : 8);
      g.sfx.impact(tip.setY(tip.y + 0.15), 0xffd8a0, a.kind === 'heavy' ? 0.5 : 0.3);
      if (a.kind === 'heavy') g.shake(0.18);
    }
  }

  /** The BloodRage roar at its peak. */
  private roarFx(g: Game) {
    const at = this.center(this.tv);
    g.sfx.emit(at, { color: 0xff1a10, count: 36, speed: 4, life: 0.6, size: 0.45, up: 1.5, drag: 1.5 });
    g.sfx.flash(at, RAGE_RED, 20, 10);
    g.sfx.shockwave(at.set(this.pos.x, this.pos.y + 0.12, this.pos.z), 6, RAGE_RED, 0.45);
    g.sfx.shockwave(at, 3.5, 0xffa080, 0.3);
    g.sfx.dust(this.pos, 16, 0x8a6a5a);
    g.shake(0.35);
  }

  private trailColor(): number {
    if (this.fury.bloodrageActive) return RAGE_RED;
    const def = WEAPONS[mainWeapon(this.c).id];
    return def.element === 'physical' && def.legendary ? 0xffd27a : ELEMENT_COLOR[def.element];
  }

  /** Feeds the weapon trail while the blade is in its active window. */
  private weaponTrail(g: Game) {
    const a = this.attack;
    const w = this.weaponMesh;
    if (!a || !w || (a.kind !== 'light' && a.kind !== 'heavy' && a.kind !== 'spin' && a.kind !== 'throw')) return;
    const kind = this.weaponKind;
    if (kind === 'bow') return;
    if (a.t < a.from - 0.04 * a.duration || a.t > (a.kind === 'throw' ? a.hitAt : a.to)) return;
    const [b0, b1] = BLADE[kind];
    w.updateWorldMatrix(true, false);
    const base = w.localToWorld(this.tv.set(0, b0, 0));
    const tip = w.localToWorld(this.tv2.set(0, b1, 0));
    const life = a.kind === 'spin' ? 0.5 : a.kind === 'heavy' || a.finisher ? 0.26 : 0.2;
    // Only the outer part of the blade leaves a trail (not a wedge from the hilt).
    g.fx.trailPoint(w, base, tip, this.trailColor(), a.kind === 'spin' ? 0.7 : 0.55, life);
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
      this.bloodrageUntil = this.now + bloodrageDuration(c);
      this.bloodrageReadyAt = this.now + BLOODRAGE.cooldown;
      g.hud.toast(c.level >= 4 ? 'BLOODRAGE! Bloodsteal awakens.' : 'BLOODRAGE!', 'rage');
      // A planted roar; it can't be cut short by attacks or rolls.
      this.startAttack('roar', 'roar', 0.8);
      this.queued = null;
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
    g.sfx.magicCircle(target.pos, 0x50ff70, 2.2, 1.6);
    target.tamed = true;
    g.coop.tamed(target);
    g.removeEnemy(target);
    const alpha = 0.3 * rank(this.c, 'alpha-call');
    g.addAlly(new Ally(kind, target.pos.x, target.pos.z, this.c.level, Infinity, 1 + 0.25 * rank(this.c, 'pack-bond') + alpha, 1 + 0.2 * rank(this.c, 'feral-bite') + alpha));
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
    g.sfx.emit(this.center(), { color: 0xffc040, count: 30, speed: 2, life: 0.8, up: 2 });
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
      this.startAttack('cast', 'cast', 0.6);
      g.sfx.magicCircle(this.pos, ELEMENT_COLOR[combo.element], 2.6, 1.5);
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
        g.sfx.magicCircle(this.pos, SCHOOL_COLOR.devil, single ? 4 : 7.5, 4.2);
        let killed = 0;
        if (single) {
          g.damageEnemy(single, single.hp + 1, 'true', { source: 'devil' });
          g.sfx.pillar(single.center(), 0xff2020, 2);
          killed = 1;
        } else {
          for (const e of [...g.enemies]) {
            if (e.alive && !(e instanceof Boss) && devilRingAffects(e.level) && e.pos.distanceTo(this.pos) < 14) {
              g.damageEnemy(e, e.hp + 1, 'true', { source: 'devil' });
              killed++;
            }
          }
          g.sfx.ring(this.center(), 14, 0xff2020, 0.9);
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
          g.sfx.ring(this.center().setY(this.pos.y + 0.3), 7, 0xff5010, 0.7);
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
        g.sfx.magicCircle(at, SCHOOL_COLOR.sky, 3.2, 0.9);
        g.sfx.lightning(at.clone().add(new THREE.Vector3(0, 30, 0)), at);
        for (const e of g.enemies) if (e.alive && e.center().distanceTo(at) < 3.5) {
          g.damageEnemy(e, power * (e.status.wet > 0 ? 2 : 1), 'lightning', { source: 'spell' });
          e.status.stun = Math.max(e.status.stun, 0.6);
        }
        g.addTornado(at, 3.5, power * 0.15, 0x9ab0c8);
        break;
      }
      case 'waterspike': {
        const at = target ? target.pos.clone() : aim;
        g.sfx.magicCircle(at, SCHOOL_COLOR.water, 2.6, 0.9);
        g.sfx.spikes(at.x, at.z);
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
          g.sfx.emit(this.center(), { color: 0xd0f0ff, count: 60, speed: 14, life: 0.6, size: 0.7, drift: fwd.multiplyScalar(10) });
        } else {
          this.speedBuff = 8;
          g.sfx.emit(this.center(), { color: 0xd0f0ff, count: 40, speed: 6, life: 0.6 });
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
        g.sfx.pillar(target.center(), 0xe0e0ff, 1);
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
        g.sfx.pillar(this.pos.clone(), 0xfff0b0, 2);
        break;
      case 'imp-familiar':
        g.addAlly(new Ally('imp', this.pos.x + 1, this.pos.z - 1, c.level, 30));
        g.sfx.emit(this.center(), { color: 0xff5010, count: 40, speed: 4, life: 0.6 });
        break;
      case 'holy-smite':
        if (!target) return g.hud.toast('No target.');
        g.sfx.magicCircle(target.pos, SCHOOL_COLOR.light, 1.8, 0.9);
        g.sfx.pillar(target.pos.clone(), 0xfff0b0, 1.5);
        g.damageEnemy(target, power, 'light', { source: 'spell' });
        break;
      case 'radiant-heal':
        this.heal(power);
        g.sfx.emit(this.center(), { color: 0xfff0b0, count: 40, speed: 2, life: 1, up: 2 });
        break;
      case 'aegis-of-light':
        this.aegis = 3;
        g.sfx.ring(this.center(), 2, 0xfff0b0, 0.5);
        break;
      case 'stone-skin':
        this.stoneSkin = 12;
        g.sfx.emit(this.center(), { color: 0xa08060, count: 40, speed: 3, life: 0.8 });
        break;
      case 'moonveil':
        this.moonveil = 10;
        for (const e of g.enemies) if (e.aware && !(e instanceof Boss) && e.pos.distanceTo(this.pos) > 5) (e.aware = false), (e.awareness = 0), (e.state = 'return');
        g.sfx.emit(this.center(), { color: 0x8090ff, count: 40, speed: 3, life: 0.8 });
        break;
    }
    if (spell !== 'soul-or-power') this.mana -= check.cost;
    this.castCooldown(spell, def.cooldown);
    if (spell !== 'deal-with-the-devil') {
      this.startAttack('cast', 'cast', 0.55);
      // A rune circle at the caster's feet in the colour of the school.
      const big = spell === 'power-of-the-light' || spell === 'soul-or-power';
      g.sfx.magicCircle(this.pos, SCHOOL_COLOR[def.school], big ? 3.2 : 1.7, big ? 2 : 1.3);
    }
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
        g.sfx.spikes(aim.x, aim.z, 0x60b0ff, 12, 5);
        g.sfx.lightning(aim.clone().add(new THREE.Vector3(0, 30, 0)), aim);
        for (const e of g.enemies) if (e.alive && e.pos.distanceTo(aim) < 6) {
          e.status.wet = 6;
          g.damageEnemy(e, power * 2, 'lightning', { source: 'spell' });
          e.status.stun = 1;
        }
        break;
      case 'scalding-geyser':
        g.sfx.spikes(aim.x, aim.z, 0xffa060, 10, 4);
        g.sfx.emit(aim, { color: 0xffffff, count: 80, speed: 8, life: 1.2, up: 10, size: 1.4 });
        for (const e of g.enemies) if (e.alive && e.pos.distanceTo(aim) < 5) {
          g.damageEnemy(e, power, 'fire', { source: 'spell' });
          e.status.burn = 5;
        }
        break;
      case 'tempest': {
        const near = g.enemies.filter((e) => e.alive && e.pos.distanceTo(this.pos) < 16).slice(0, 6);
        for (const e of near) {
          g.sfx.lightning(e.center().add(new THREE.Vector3(0, 25, 0)), e.center());
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
        g.sfx.emit(this.center(), { color: 0xc0f0ff, count: 90, speed: 16, life: 0.8, size: 0.6, drift: fwd.multiplyScalar(12) });
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
          g.sfx.emit(e.center(), { color: 0x40ff80, count: 4, speed: 1, life: 0.6 });
        }
      }
    }
    if (this.hp < this.maxHp * 0.3 && this.thunderCd <= 0) {
      const t = g.findTarget(12, -1, true);
      if (t) {
        this.thunderCd = 2.5;
        g.sfx.lightning(t.center().add(new THREE.Vector3(0, 25, 0)), t.center(), 0x80ffa0);
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
    g.hud.toast(g.input.touch ? 'You take the helm. (tap ✋ or ⤒ to step ashore)' : 'You take the helm. (F or Jump to step ashore)');
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

  private syncAnim(dt: number) {
    const a = this.anim;
    a.t += dt;
    const vx = this.vel.x, vz = this.vel.z;
    const speed = Math.hypot(vx, vz);
    a.speed = this.sailing ? 0 : speed;
    a.moving = Math.min(1, speed / 4);
    a.phase += speed * dt * (this.sprinting ? 1.6 : 1.9);
    // Travel in the rig's own frame: x along its local +X, z forward (the
    // same frame entities.ts writes and humanoid.ts turns the hips toward).
    if (speed > 0.05 && !this.sailing) {
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      const k = Math.min(1, speed / 2.5) / speed;
      a.moveX = (vx * cy - vz * sy) * k;
      a.moveZ = (vx * sy + vz * cy) * k;
    } else a.moveX = a.moveZ = 0;
    a.blocking = this.blocking;
    a.crouching = this.crouching && this.grounded;
    a.swimming = this.swimming;
    a.flying = this.flying;
    a.airborne = !this.grounded && !this.swimming && !this.sailing;
    a.rolling = this.backstep ? -1 : this.rollT;
    a.draw = this.drawing;
    a.fury = this.fury.bloodrageActive ? 1 : 0;
    a.windup = 0;
    a.dead = -1;
    const at = this.attack;
    if (at) {
      a.attack = Math.min(1, at.anim0 + ((1 - at.anim0) * at.t) / at.duration);
      a.attackStyle = at.style;
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
    this.updateBowString();
  }

  private updateBowString() {
    const bow = this.weaponMesh;
    if (bow && this.weaponKind === 'bow') poseBowString(this.rig, bow, this.anim, this.arrows() > 0);
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

/**
 * Turns toward an angle with frame-rate-independent easing and a top turning
 * speed, so the hero never snaps round in a single frame (even at 30 fps).
 */
function rotateTowards(from: number, to: number, dt: number, rate: number, maxSpeed = 14) {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  let turn = d * (1 - Math.exp(-rate * dt));
  const cap = maxSpeed * dt;
  if (turn > cap) turn = cap;
  else if (turn < -cap) turn = -cap;
  return from + turn;
}

/** Puts a weapon in the right hand (a bow in the left) and, for a warrior, a shield on the arm. */
export function attachGear(rig: Rig, classId: ClassId, weaponId: string): { weapon: THREE.Object3D; shield: THREE.Object3D | null } {
  const w = WEAPONS[weaponId];
  const weapon = compact(buildWeapon(w.kind, !!w.legendary));
  if (w.kind === 'bow') rig.handL.add(weapon);
  else rig.handR.add(weapon);
  let shield: THREE.Object3D | null = null;
  if (classId === 'warrior' && w.kind !== 'bow') {
    shield = buildShield();
    shield.position.set(-0.08, 0, 0.1);
    shield.rotation.y = -Math.PI / 2;
    rig.handL.add(shield);
  }
  weapon.traverse((o) => (o.castShadow = true));
  return { weapon, shield };
}

const NOCK = new THREE.Vector3();
/** Draws a bow's string back to the pulling hand, with an arrow nocked while aiming. */
export function poseBowString(rig: Rig, bow: THREE.Object3D, a: AnimState, arrows: boolean) {
  const pulling = a.draw > 0 || (a.attackStyle === 'bow' && a.attack >= 0 && a.attack < 0.12);
  const n = NOCK.set(0, 0, -0.191);
  if (pulling) {
    rig.root.updateMatrixWorld(true);
    rig.handR.getWorldPosition(n);
    bow.worldToLocal(n);
    n.x = Math.max(-0.06, Math.min(0.06, n.x));
    n.y = Math.max(-0.12, Math.min(0.12, n.y));
    n.z = Math.max(-0.95, Math.min(-0.191, n.z));
  }
  setBowString(bow, n, a.draw > 0 && arrows);
}

export function buildPlayerRig(c: Pick<Character, 'classId' | 'raceId' | 'roleId'>): Rig {
  const skin = c.raceId === 'draco' ? 0x5a6a4a : c.raceId === 'elf' ? 0xe0c8a8 : c.raceId === 'ancient' ? 0x3a3a44 : 0xc89a78;
  const look = {
    warrior: { armor: 0x7a7468, cloth: 0x4a3a2a, accent: 0xb0904a, build: 'heavy' as const, head: 'helmet' as const, cape: 0x5a1a14 },
    ranger: { armor: 0x4a5a3a, cloth: 0x2e3a26, accent: 0x8a7a4a, build: 'light' as const, head: 'hood' as const, cape: 0x2a3a22 },
    mage: { armor: 0x3a2e5a, cloth: 0x2a2244, accent: 0xc0a050, build: 'robe' as const, head: 'hat' as const, cape: undefined },
  }[c.classId];
  if (c.roleId === 'knight') {
    look.armor = 0xc8c0a8;
    look.accent = 0xffe080;
    look.cape = 0xb8ae94;
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
