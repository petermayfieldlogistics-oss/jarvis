import * as THREE from 'three';
import { RUNES, SPELLS, WEAPONS, type ClassId, type ComboElement, type DamageElement, type RaceId, type RuneId, type SpellId, type SpellSchool, type SubclassId, type WeaponKind } from '../data/defs';
import {
  airFlaps, ANGELIC, dracoFireRegen, dracoFlightHours, dracoWaterDamagePerSecond, drawTimeMultiplier, drowns, lightHealMultiplier, manaRegen, maxHp, maxMana,
  maxStamina, maxTamed, moveSpeed, ORC, rank, staminaRegen, swimsTireless, tameableKinds, weaponDamage, wingsGrown, ZOMBIE, GAME_MINUTES_PER_SECOND, type Character,
} from '../rules/character';
import {
  BLOODRAGE, bleedChance, bloodrageDuration, canCast, canCombine, canWield, castPowerOfTheLight, comboCost, comboFor, comboPower, cooldownMultiplier, devilRingAffects, hasBloodrage,
  hasBloodsteal, immuneToBleed, mainWeapon, newFury, onMeleeLanded, onMeleeMissed, powerShot, retribution, spellCost, spellPowerMultiplier, strikeDevilDeal,
  type FuryState,
} from '../rules/combat';
import {
  KNIFE_VOLLEY, RUNE_EFFECT, RUNE_SEAL, RUNE_TRAP, SONG, SONGS, STORM_CHAIN, WAND, isOffhand, isTwoHanded, meleeReach, songOf, swingArc, type SongId,
} from '../rules/weapons';
import {
  ASSASSINATE, ROLL, beamRange, BEAM, chiOnHit, CYCLONE, cyclonePower, dodgeReward, drainHeal, finisherStun, FLURRY, flurryBlows, flurryPower, focusDiscount, HEX,
  hexLeaps, hexSeconds, ironSkinSeconds, lightAttackSpeed, lightReach, MEDITATE, meditateHeal, mendAmount, PALM_SHOVE, palmPower, palmWaveRange, PALM_WAVE, parryWindow,
  POISON, riposteMultiplier, rogueStealth, rollSpec, shadeCount, shadeMultiplier, SHADE, SHADOWSTEP, SMITE, smiteStun, smokeRadius, SMOKE, spellCooldownMultiplier,
  SURGE, surgeCooldown, surgeSeconds, toxinDps, vanishCooldown, vanishSeconds, wandcraft, WARD, wardAmount, type RollSpec,
} from '../rules/classes';
import { buildShield, buildWeapon, buildWraps, compact, disposeObject, setBowString } from './models';
import { animateHumanoid, buildHumanoid, type Rig } from './humanoid';
import { FLURRY_AT, newAnim, type AnimState, type AttackStyle } from './anim';
import {
  BURST, BURST_COLOR, BURST_ELEMENT, burstEffects, burstFor, burstScale, chargeKind, chargeLevel, empowerPower, POWER, spellBurst, strikePower, type Burst,
} from '../rules/power';
import { heightAt, inLava, SWIM_DEPTH, WATER_LEVEL } from './terrain';
import { gallopDrain, HORSE, rideBlock, rideSpeed, rideStep } from '../rules/horse';
import { hasTool } from '../rules/crafting';
import { applyOutfit, baseLook, dressedOf, isPlain, PLAIN, wardrobeBlock, wearable, type Dressed } from '../rules/outfit';
import { EAT_GAP, eatItem, foodCount, pickFood } from '../rules/food';
import { fedMul, fedRegen, tickFed } from '../rules/fed';
import { FRUITS, spanText } from '../data/goods';
import { ITEMS } from '../data/world';
import { animateHorse, buildHorse, SEAT, type HorseRig } from './horse';
import { Ally, Boss, Enemy, type Actor } from './entities';
import type { Game } from './game';
import type { Action } from './input';

// zap: a wand bolt; rune: a rune trap or seal; play: a lyre or war horn.
// flurry: a monk's storm of punches; cyclone: a spinning kick; meditate: sitting
// to heal; channel: a held beam; parry: a duelist's guard; riposte: its answer.
type AttackKind = 'light' | 'heavy' | 'spin' | 'throw' | 'cast' | 'bow' | 'roar' | 'zap' | 'rune' | 'play' | 'flurry' | 'cyclone' | 'meditate' | 'channel' | 'parry' | 'riposte';

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
  /** An orc's War Cry rather than a BloodRage roar. */
  warCry?: boolean;
  finisher: boolean;
  /** Facing chosen at the start of the swing. */
  aim: number;
  /** Where the animation starts (a bow loose begins at the release). */
  anim0: number;
  /** The heavy version of a zap, rune or play. */
  big: boolean;
  /** Knives thrown so far in a volley (punches so far in a flurry). */
  shots: number;
  /** Extra damage multiplier for this move (a riposte). */
  mult: number;
  /** A power strike: the burst it lands with and how charged it was. */
  power?: { burst: Burst; charge: number };
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
  cleave: { hit: 0.5, from: 0.4, to: 0.72, step: 0.5 },
  slam: { hit: 0.62, from: 0.52, to: 0.72, step: 0.7 },
  sweep: { hit: 0.55, from: 0.45, to: 0.74, step: 0.3 },
  volley: { hit: 0.5, from: 0.4, to: 0.5, step: 0 },
  summon: { hit: 0.55, from: 0, to: 0.8, step: 0 },
  jab: { hit: 0.4, from: 0.3, to: 0.55, step: 0.35 },
  cross: { hit: 0.42, from: 0.32, to: 0.58, step: 0.4 },
  kick: { hit: 0.44, from: 0.34, to: 0.62, step: 0.5 },
  palm: { hit: 0.53, from: 0.44, to: 0.72, step: 0.8 },
  flurry: { hit: FLURRY_AT[0], from: 0.1, to: 0.86, step: 0 },
  cyclone: { hit: 0.42, from: 0.26, to: 0.76, step: 0.6 },
  meditate: { hit: 1, from: 0, to: 1, step: 0 },
  channel: { hit: 1, from: 0, to: 1, step: 0 },
  parry: { hit: 1, from: 0, to: 1, step: 0 },
  strum: { hit: 0.45, from: 0, to: 0.6, step: 0 },
  song: { hit: 0.72, from: 0, to: 0.85, step: 0 },
  blow: { hit: 0.42, from: 0, to: 0.8, step: 0 },
};

/** When each knife of a volley leaves the hand (the volley move's three throws). */
const VOLLEY_AT = [0.5, 0.66, 0.82];

/** The next light swing may follow this long after the last one ended. */
const COMBO_WINDOW = 0.6;
/** Presses are remembered this long while a move finishes. */
const BUFFER = 0.4;

/** The part of the weapon that leaves a trail, along its local +Y from the grip: [start, tip]. */
export const BLADE: Record<WeaponKind, [number, number]> = {
  sword: [0.55, 1.2], axe: [0.6, 1.0], hammer: [0.8, 1.2], dagger: [0.2, 0.5], trident: [1.35, 2.0], staff: [1.1, 1.6], bolt: [0.4, 1.0], bow: [0, 0],
  greatsword: [0.75, 1.8], longsword: [0.6, 1.34], spear: [1.3, 1.82], battleaxe: [0.72, 1.14], knives: [0.08, 0.27], wand: [0.3, 0.45],
  runecircle: [0, 0], lyre: [0, 0], horn: [0, 0],
  // Fists and feet leave their own trails (see limbTrail); a quarterstaff's upper end does.
  wraps: [0, 0], quarterstaff: [0.62, 1.12],
};

export const ELEMENT_COLOR: Record<DamageElement, number> = {
  physical: 0xdfe8ff, fire: 0xff7a1a, light: 0xffd25a, lightning: 0xa8d0ff, dark: 0x9a4dff, water: 0x3ee0ff, wind: 0xc8ffe4, earth: 0xc8a070, true: 0xffffff,
};

const SCHOOL_COLOR: Record<SpellSchool, number> = {
  devil: 0xb8121a, fire: 0xff6a1a, sky: 0xa8ccff, water: 0x2ad8ff, light: 0xffd25a, arcane: 0xa060ff, earth: 0xa8743a,
  chi: 0x7ff0c8, shadow: 0x8a3cff, trick: 0xb8b0a0,
};

export const RAGE_RED = 0xff2a12;
const UP = new THREE.Vector3(0, 1, 0);
const smooth01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** The light combo for each weapon: three steps, the last a finisher. */
function lightStyle(kind: WeaponKind, step: number): AttackStyle {
  // Fists: a left jab, a right cross, a high kick to finish.
  if (kind === 'wraps') return step === 0 ? 'jab' : step === 1 ? 'cross' : 'kick';
  // A quarterstaff sweeps back and forth, then drives its end in.
  if (kind === 'quarterstaff') return step === 0 ? 'slash2' : step === 1 ? 'slash' : 'thrust';
  if (kind === 'dagger' || kind === 'knives') return step === 1 ? 'slash2' : 'thrust';
  if (kind === 'trident') return step === 2 ? 'slash3' : 'thrust';
  // Jab, jab, lunge.
  if (kind === 'spear') return 'thrust';
  // Big two-handed sweeps one way, then back, then down.
  if (kind === 'greatsword' || kind === 'battleaxe') return step === 0 ? 'heavy' : step === 1 ? 'cleave' : 'overhead';
  if (step === 2) return kind === 'axe' || kind === 'hammer' ? 'overhead' : 'slash3';
  return step === 1 ? 'slash2' : 'slash';
}

/** The heavy blow for each weapon (warrior subclasses may replace it). */
function heavyStyle(kind: WeaponKind): AttackStyle {
  if (kind === 'wraps') return 'palm';
  if (kind === 'axe' || kind === 'hammer') return 'overhead';
  if (kind === 'greatsword') return 'slam';
  if (kind === 'spear') return 'sweep';
  return 'heavy';
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
  /** On horseback (the hero's position is the horse's). */
  riding = false;
  /** The hero's horse while it is out in the world (called, waiting, or ridden). */
  horse: { rig: HorseRig; pos: THREE.Vector3; yaw: number; speed: number; state: 'coming' | 'waiting' | 'fleeing'; t: number } | null = null;
  /** The horse's own stamina (galloping spends it). */
  steedStamina = HORSE.stamina;
  galloping = false;
  /** When the hero last took a blow (no mounting just after). */
  private hurtAt = -99;
  private rideHintAt = -99;
  private horseDt = 0;
  private lastBite = -99;
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
  /** Angelic: wing beats left before touching down, the last beat's spread, and a held glide. */
  flapsLeft = 0;
  flapT = 0;
  gliding = false;
  /** Orc: War Cry seconds left, and when it can sound again. */
  warCry = 0;
  warCryReadyAt = 0;
  /** Halo of Mercy: seconds until the next sparkle on someone it mends. */
  private mercyFx = 0;
  /** A song from a lyre or war horn (this hero's or a friend's) and its seconds left. */
  song: SongId | null = null;
  songLeft = 0;
  // ---- The Monk, the Sorcerer and the Rogue.
  /** Monk: Iron Skin seconds left. */
  ironSkin = 0;
  /** Rogue: seconds unseen (Vanish); the next strike out of it is an ambush. */
  vanish = 0;
  /** Rogue: seconds of Poison Blades left. */
  poisonBlades = 0;
  /** Duelist: seconds left to catch a blow with Parry. */
  parryWindow = 0;
  /** Sorcerer: Arcane Surge seconds left. */
  surge = 0;
  /** Ward of Dawn (this hero's or a friend's): damage it can still soak, and its seconds left. */
  ward = 0;
  wardLeft = 0;
  /** Wind Walker's Tailwind: seconds of extra speed left. */
  tailwind = 0;
  /** Shadowstep's Ghost: seconds unseen after a blink. */
  ghost = 0;
  /** Standing in smoke (a rogue's, or a friend's): all but invisible. */
  inSmoke = false;
  /** Foes this hero has hexed (when one dies, the hex leaps on). */
  hexed = new Set<Enemy>();
  /** A Light Mage's Renewal: health still to mend, and how much a second. */
  private renew = 0;
  private renewRate = 0;
  /** A monk's flip in the air: progress 0..1, or -1. */
  private airFlip = -1;
  /** The dodge being made (a roll, a dash, a backflip). */
  private rollSpec: RollSpec = ROLL;
  /** Foes a Wind Blades dash has already cut. */
  private dashHit = new Set<Enemy>();
  /** A held beam (Life Drain, Radiant Beam): the foe it holds and the next tick. */
  /** A beam spell flowing (`flow`: seconds an empowered beam keeps flowing without the cast button held). */
  private channel: { spell: SpellId; target: Enemy | null; tick: number; share: number; flow: number } | null = null;
  /** Poison stacks this hero keeps ticking on foes (Poison Blades). */
  private toxins: { e: Enemy; stacks: number; left: number; tick: number }[] = [];
  /** Things that happen a moment after a move starts (a palm's shockwave, a smoke bomb landing). */
  private later: { at: number; run: () => void }[] = [];
  // ---- Power strikes (hold heavy).
  /** Seconds heavy has been held (-1: not held). */
  private heavyHeld = -1;
  /** Shown "not ready" for this hold already. */
  private heavyWarned = false;
  /** This hold may become a charge (decided once it is held long enough, or let go). */
  private heavyPending = false;
  /** An empowered spell's burst, for the spell about to be cast. */
  private empowerBurst: { kind: Burst; charge: number } | null = null;
  /** A power strike being charged: how it is aimed, what it bursts with, and how charged it is. */
  charge: { kind: 'melee' | 'bow' | 'spell' | 'thrown'; burst: Burst; t: number; level: number; full: boolean; style: AttackStyle } | null = null;
  /** When the next power strike can be charged. */
  powerReadyAt = 0;
  /** The move about to start is a power strike (a released charge). */
  private powerNext: { burst: Burst; charge: number } | null = null;
  /** An empowered spell's multiplier while it is cast (and while its beam flows). */
  private empower = 1;
  private chargeAura: { stop(): void } | null = null;
  private ironAura: { stop(): void } | null = null;
  private surgeAura: { stop(): void } | null = null;
  private wardAura: { stop(): void } | null = null;
  rig: Rig;
  anim = newAnim();
  boat: THREE.Object3D | null = null;
  private weaponMesh: THREE.Object3D | null = null;
  /** The Master Bolt is in flight (the hand is empty until it comes back). */
  boltOut = false;
  private boltOutT = 0;
  private boltV = new THREE.Vector3();
  private shieldMesh: THREE.Object3D | null = null;
  /** Seconds this hero has been in play (cooldowns count against it). */
  now = 0;
  private rollTime = 0;
  private backstep = false;
  private queued: 'light' | 'heavy' | null = null;
  private queuedAt = -9;
  private rollQueuedAt = -9;
  private lastSwingEnd = -9;
  private lastKind: AttackKind | null = null;
  private rageAura: { stop(): void } | null = null;
  private shotAura: { stop(): void } | null = null;
  private songAura: { stop(): void } | null = null;
  private tv = new THREE.Vector3();
  private tv2 = new THREE.Vector3();

  constructor(c: Character) {
    this.c = c;
    this.hp = maxHp(c);
    this.mana = maxMana(c);
    this.stamina = maxStamina(c);
    this.rig = buildPlayerRig(c, heroDressed(c));
    compact(this.rig.root);
    this.rig.root.traverse((o) => (o.castShadow = true));
    this.equip();
    this.flightLeft = dracoFlightHours(c) * 60;
    this.flapsLeft = airFlaps(c);
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
    if (this.moonveil > 0 || this.vanish > 0 || this.ghost > 0) return 0;
    let f = 1;
    if (this.crouching) f *= this.c.roleId === 'assassin' ? 0.2 : 0.4;
    f *= 1 / (1 + 0.25 * rank(this.c, 'shadow-step'));
    if (this.c.raceId === 'elf') f *= 0.85;
    f *= rogueStealth(this.c, this.crouching);
    if (this.inSmoke) f *= 0.1;
    return f;
  }

  /** Hidden from sight (Moonveil, Vanish, Ghost): the model flickers, friends see it too. */
  get unseen() {
    return this.moonveil > 0 || this.vanish > 0 || this.ghost > 0;
  }

  /** What keeps the hero from changing clothes now (null: nothing). */
  wardrobeBlock(g: Game): string | null {
    return wardrobeBlock({
      alive: this.alive,
      riding: this.riding,
      inTrial: g.inTrial,
      threatened: this.threatened(g),
      sinceHurt: this.now - this.hurtAt,
      swimming: this.swimming,
      flying: this.flying,
      sailing: this.sailing,
      busy: !!this.attack || !!this.charge || this.rollT >= 0 || this.stagger > 0 || this.blackout > 0,
    });
  }

  /** Dresses the hero in an outfit: a new model in place of the old (the wardrobe's preview, and Keep). */
  restyle(dressed: Dressed) {
    const old = this.rig;
    const parent = old.root.parent;
    // Auras hang off the old model; they come back on the new one next frame.
    this.stopAuras();
    const rig = buildPlayerRig(this.c, dressed);
    compact(rig.root);
    rig.root.traverse((o) => (o.castShadow = true));
    this.rig = rig;
    this.equip();
    old.root.removeFromParent();
    disposeObject(old.root);
    parent?.add(rig.root);
    // Posed at once, so a paused game never shows it standing stiff.
    this.syncModel();
  }

  private stopAuras() {
    for (const a of [this.rageAura, this.songAura, this.shotAura, this.chargeAura, this.ironAura, this.surgeAura, this.wardAura]) a?.stop();
    this.rageAura = this.songAura = this.shotAura = this.chargeAura = this.ironAura = this.surgeAura = this.wardAura = null;
  }

  /** Re-attaches the main weapon (and a warrior's shield) to the model. */
  equip() {
    // A new weapon in hand: whatever was thrown no longer counts as away.
    this.boltOut = false;
    for (const old of [this.weaponMesh, this.shieldMesh]) {
      if (!old) continue;
      old.removeFromParent();
      disposeObject(old);
    }
    const w = mainWeapon(this.c);
    const gear = attachGear(this.rig, this.c.classId, w.id, w.rune);
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
    // A well-timed roll slips through charges as well as blows; Iron Skin stands its ground.
    if (this.iframes > 0 || this.ironSkin > 0) return;
    this.endMeditation();
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
    this.horseDt = dt;
    const input = g.input;
    const c = this.c;
    // A thunderbolt that never finds its way home comes back to the hand anyway.
    if (this.boltOut && (this.boltOutT += dt) > 6) this.catchBolt(g, false);
    if (!this.alive) {
      if (this.riding) this.dismount(g);
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
    this.flapT = Math.max(0, this.flapT - dt);
    this.tickClassTimers(dt, g);
    // The Fed slot: counts down by play time (a game minute a second), a heartapple mends.
    if (c.fed) {
      const regen = fedRegen(c);
      if (regen > 0) this.heal(this.maxHp * regen * dt);
      const gone = tickFed(c, dt * GAME_MINUTES_PER_SECOND);
      if (gone) g.hud.toast(`Your ${FRUITS[gone].name} wears off.`);
    }
    if (this.warCry > 0 && (this.warCry -= dt) <= 0) g.hud.toast('The War Cry fades.');
    if (this.song) {
      this.songLeft -= dt;
      this.heal(SONGS[this.song].regen * dt);
      if (this.songLeft <= 0) this.song = null;
    }
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
    const canAct = !busy && this.rollT < 0 && !this.sailing && !this.riding;

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

    if (input.pressed.has('crouch') && !this.flying && !this.swimming && !this.riding) this.crouching = !this.crouching;
    if (input.pressed.has('swap') && canAct) this.swapWeapon(g);
    if (input.pressed.has('heal') && canAct) this.drinkFlask(g);
    if (input.pressed.has('eat') && canAct) this.eat(g);
    if (input.pressed.has('satchel') && g.mode === 'play') g.story.satchel();
    if (input.pressed.has('ability') && canAct) this.useAbility(g);
    // The horse: call it, climb on, get down. Reaching for a weapon hops down first.
    if (input.pressed.has('horse')) this.horseButton(g);
    else if (this.riding && !busy && isDismountPress(input)) this.dismount(g);
    if (this.horse) this.updateHorse(dt, g);

    // Movement intent relative to the camera.
    const camYaw = g.camYaw;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const mx = input.move.x, my = input.move.y;
    let wantX = fx * my - fz * mx;
    let wantZ = fz * my + fx * mx;
    const wantLen = Math.hypot(wantX, wantZ);
    const sprint = input.held.has('sprint') && wantLen > 0.1 && !this.exhausted && this.stamina > 0 && !this.swimming && !this.crouching && !this.blocking && this.drawing === 0 && !this.attack && !this.riding;
    let speed = moveSpeed(c) * (sprint ? 1.55 : 1) * (this.crouching ? 0.5 : 1) * (this.speedBuff > 0 ? 1.6 : 1) * (this.song ? SONGS[this.song].speed : 1) * (this.tailwind > 0 ? 1.3 : 1);
    if (this.blocking || this.drawing > 0 || this.charge) speed *= 0.45;
    const atk = this.attack;
    // Moving (or rolling) stands a meditating monk up.
    if (atk?.kind === 'meditate' && (wantLen > 0.3 || input.pressed.has('roll') || input.pressed.has('jump'))) this.endMeditation();
    if (atk && atk.kind === 'channel') speed *= 0.3;
    else if (atk && atk.kind !== 'cast') speed *= atk.kind === 'roar' || atk.kind === 'meditate' || atk.kind === 'parry' ? 0 : atk.t < atk.chainAt ? 0.2 : 0.45;
    // Facing the camera or a foe, walking backward is slower.
    if ((shiftLock || this.lockTarget) && wantLen > 0.1 && !this.sailing) {
      const ahead = (wantX * Math.sin(this.yaw) + wantZ * Math.cos(this.yaw)) / wantLen;
      if (ahead < 0) speed *= 1 + 0.28 * ahead;
    }
    // A glide carries an angel further than a jump.
    if (this.gliding) speed *= ANGELIC.glideSpeed;
    if (busy) speed = 0;
    // On horseback: a trot, or a gallop (sprint) on the horse's wind.
    if (this.riding) {
      const step = rideStep(this.steedStamina, input.held.has('sprint') && wantLen > 0.1, this.galloping, dt, RIDE_STEP, gallopDrain(hasTool(c, 'horseshoes')));
      if (this.galloping && !step.galloping && step.stamina <= 0) g.hud.toast(`${this.c.steed.name} is winded.`);
      this.steedStamina = step.stamina;
      this.galloping = step.galloping;
      speed = busy || wantLen <= 0.1 ? 0 : rideSpeed(this.galloping) * Math.min(1, wantLen);
    } else this.steedStamina = Math.min(HORSE.stamina, this.steedStamina + HORSE.regen * dt);

    // Water.
    const ground = heightAt(this.pos.x, this.pos.z);
    const depth = WATER_LEVEL - ground;
    const walksOnWater = WEAPONS[mainWeapon(c).id].legendary === 'trident-of-poseidon';
    this.swimming = !this.sailing && !this.riding && !this.flying && !walksOnWater && depth > SWIM_DEPTH && this.pos.y < WATER_LEVEL + 0.2;
    if (this.swimming) {
      speed = c.roleId === 'sailor' ? 5.5 : 3.6;
      this.crouching = false;
      this.blocking = false;
      // Zombies have no breath to lose and sailors or pearl-bearers never tire: swimming costs them nothing.
      if (!swimsTireless(c) && drowns(c)) this.stamina = Math.max(0, this.stamina - 3.5 * dt);
      if (this.stamina <= 0 && drowns(c)) {
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
      const R = this.rollSpec;
      this.rollTime += dt;
      if (R.kind === 1) this.dashing(g);
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
    if (this.riding) {
      // A horse turns toward where it is steered and goes the way it faces (slower through a sharp turn).
      if (wantLen > 0.1) {
        this.faceTowards(this.pos.x + wantX, this.pos.z + wantZ, dt, this.galloping ? 4 : 6);
        const along = (wantX * Math.sin(this.yaw) + wantZ * Math.cos(this.yaw)) / wantLen;
        const k = wantLen * Math.max(0.25, along);
        wantX = Math.sin(this.yaw) * k;
        wantZ = Math.cos(this.yaw) * k;
      }
    } else if (this.rollT >= 0) {
      if (!this.backstep) this.faceTowards(this.pos.x + this.rollDir.x, this.pos.z + this.rollDir.z, dt, 30);
    } else if (swinging) {
      // A swing commits to its direction once the blade starts moving.
      if (a.t < a.from) this.yaw = rotateTowards(this.yaw, target ? Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z) : a.aim, dt, 24);
    } else if (target) {
      this.faceTowards(target.pos.x, target.pos.z, dt, 12);
    } else if ((shiftLock && !this.sailing) || this.drawing > 0 || a || this.charge) {
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
      const accel = this.riding ? (this.grounded ? 3.2 : 0.5) : this.grounded || this.swimming || this.flying ? 14 : this.gliding ? 6 : 3;
      this.vel.x += (tx - this.vel.x) * Math.min(1, dt * accel);
      this.vel.z += (tz - this.vel.z) * Math.min(1, dt * accel);
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // A horse wades the shallows but won't swim.
    if (this.riding && WATER_LEVEL - heightAt(this.pos.x, this.pos.z) > HORSE.wadeDepth) {
      this.pos.x -= this.vel.x * dt;
      this.pos.z -= this.vel.z * dt;
      this.vel.x = this.vel.z = 0;
      if (this.now - this.rideHintAt > 4) {
        this.rideHintAt = this.now;
        g.hud.toast(`${this.c.steed.name} won't swim. Get down to go on.`);
      }
    }
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
      if (input.pressed.has('jump') && this.grounded && this.riding) {
        // The horse jumps (a fence, a stream).
        this.vel.y = 7.5;
        this.grounded = false;
      } else if (input.pressed.has('jump') && this.grounded && canAct) {
        this.vel.y = 8.5;
        this.grounded = false;
        this.crouching = false;
        this.spend(6);
      } else if (input.pressed.has('jump') && !this.grounded && this.flapsLeft > 0 && canAct && !this.exhausted) {
        this.flap(g);
      }
      this.vel.y -= 24 * dt;
      // Wings of Light: holding Jump on the way down glides (and lands softly).
      this.gliding = c.raceId === 'angelic' && !this.grounded && this.vel.y < 0 && input.held.has('jump') && !this.attack && !this.riding;
      if (this.gliding) this.vel.y = Math.max(this.vel.y, -ANGELIC.glideFall);
      this.pos.y += this.vel.y * dt;
    }
    const floor = walksOnWater ? Math.max(ground, WATER_LEVEL) : ground;
    if (!this.swimming && !this.sailing && this.pos.y <= floor) {
      const fall = -this.vel.y;
      if (!this.grounded && this.vel.y < -22 && !rank(c, 'feather-fall')) g.damagePlayer(Math.round((-this.vel.y - 22) * 4), 'true', null, true);
      if (wasAirborne && fall > 3 && !this.flying) this.land(g, fall);
      this.pos.y = floor;
      this.vel.y = 0;
      this.grounded = true;
      if (this.flying && input.held.has('crouch')) this.flying = false;
    } else if (!this.swimming && !this.sailing) {
      this.grounded = this.pos.y - floor < 0.05;
    }
    if (this.flying) this.grounded = false;
    if (this.grounded || this.swimming || this.sailing || this.flying) this.gliding = false;
    if (this.grounded || this.swimming) this.flapsLeft = airFlaps(c);
    if (this.airFlip >= 0) {
      this.airFlip += dt / 0.55;
      if (this.airFlip >= 1 || this.grounded || this.swimming) this.airFlip = -1;
    }

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
    if (!spending && this.staminaWait <= 0 && !(this.swimming && !swimsTireless(c) && drowns(c))) this.stamina = Math.min(this.maxStamina, this.stamina + staminaRegen(c) * dt * (this.blocking ? 0.4 : 1));
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
    this.updateCharge(dt, g, canAct && !this.swimming && !this.sailing && !this.flying);
    if (this.attack) this.updateAttack(dt, g);

    // Casting: tap for the main form, hold for the alternate. A channelled
    // spell starts at once and pours out for as long as the button is held.
    if (canAct && input.pressed.has('cast')) {
      const sp = this.spell;
      if (sp && SPELLS[sp].channel && !this.combineMode) this.startChannel(g, sp);
      else this.castHeld = 0;
    }
    if (this.channel) this.updateChannel(dt, g, input.held.has('cast'), canAct);
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
    if (c.raceId === 'orc' && this.hp < this.maxHp * ORC.warCry.below && this.now >= this.warCryReadyAt) this.startWarCry(g);
    this.mercy(dt, g);

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
    // A monk dashes (or backflips), a rogue rolls quick and low, everyone else rolls.
    const R = (this.rollSpec = rollSpec(this.c, this.backstep));
    this.rollT = 0;
    this.rollTime = 0;
    this.spend(R.cost);
    if (this.attack) this.finishAttack();
    this.stopChannel();
    this.cancelCharge();
    this.queued = null;
    this.powerNext = null;
    this.drawing = 0;
    this.crouching = false;
    this.blocking = false;
    if (this.backstep) {
      this.rollDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.vel.y = R.hop;
      this.grounded = false;
    } else {
      this.rollDir.set(wantX / wantLen, 0, wantZ / wantLen);
    }
    if (R.kind === 1) {
      this.dashHit.clear();
      g.sfx.emit(this.center(this.tv), { color: this.chiColor(), count: 16, speed: 2, life: 0.4, size: 0.4, drift: this.tv2.copy(this.rollDir).multiplyScalar(-6) });
    }
    g.sfx.dust(this.pos, this.backstep ? 5 : 8);
    g.audio.play('roll');
  }

  /** A dash leaves a streak of chi; with Wind Blades it cuts the foes it passes through. */
  private dashing(g: Game) {
    if (Math.random() < 0.7) g.fx.emit(this.center(this.tv), { color: this.chiColor(), count: 2, speed: 0.4, life: 0.35, size: 0.5 });
    if (!rank(this.c, 'wind-blades')) return;
    const w = mainWeapon(this.c);
    for (const e of g.enemies) {
      if (!e.alive || this.dashHit.has(e) || Math.abs(e.pos.y - this.pos.y) > 2.5) continue;
      if (Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) > e.radius + 1.1) continue;
      this.dashHit.add(e);
      g.hitEnemyWithWeapon(e, weaponDamage(w) * 0.5, 'melee', 'wind', {});
      g.fx.impact(e.center(this.tv), 0xc8ffe4, 0.5);
    }
  }

  /** A monk's colour of chi (trails, dashes), by path. */
  chiColor(): number {
    return this.c.subclassId === 'ironfist' ? 0xffc27a : this.c.subclassId === 'windwalker' ? 0xa8fff0 : 0x9af0d0;
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
    const song = this.alive && !!this.song;
    if (song && !this.songAura) this.songAura = g.fx.aura(this.rig.root, SONGS[this.song!].color, Infinity);
    else if (!song && this.songAura) {
      this.songAura.stop();
      this.songAura = null;
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
      // Heavy: held, a charged elemental arrow; tapped, the dagger comes out.
      if (input.pressed.has('heavy') && !this.attack) {
        this.heavyHeld = 0;
        this.heavyWarned = false;
        this.heavyPending = this.canCharge();
        if (!this.heavyPending) this.drawDagger(g);
      }
      return;
    }

    if (input.pressed.has('attack')) (this.queued = 'light'), (this.queuedAt = this.now);
    // Heavy: a tap is a heavy blow; held, it charges a power strike (decided as it is held or let go).
    if (input.pressed.has('heavy')) {
      this.heavyHeld = 0;
      this.heavyWarned = false;
      this.heavyPending = this.canCharge();
      if (!this.heavyPending) (this.queued = 'heavy'), (this.queuedAt = this.now);
    }
    if (!this.queued) return;
    if (this.now - this.queuedAt > BUFFER) {
      this.queued = null;
      this.powerNext = null;
      return;
    }
    const cur = this.attack;
    // Wait for the current move to reach the point where the next may follow.
    if (cur && cur.t < cur.chainAt) return;
    // Out of stamina: keep the press (it expires after BUFFER) until some is back.
    if (this.stamina <= 0) return;
    // The thunderbolt is still out: a press just before it lands in the hand throws again at once.
    if (kind === 'bolt' && this.boltOut) return;
    const heavy = this.queued === 'heavy';
    this.queued = null;

    if (kind === 'bolt') {
      this.spend(8);
      this.startAttack('throw', 'throw', 0.5, { power: heavy ? this.takePower() : undefined });
    } else if (kind === 'knives' && this.c.knives > 0) {
      // Quick throws; a heavy looses a fan of three in quick succession (a charged one, one blazing knife).
      const power = heavy ? this.takePower() : undefined;
      if (power) {
        this.spend(10);
        this.startAttack('throw', 'throw', 0.55, { step: 0, power });
      } else if (heavy && this.c.knives > 1) {
        this.spend(16);
        this.startAttack('throw', 'volley', 0.95, { step: 0 });
      } else {
        this.spend(6);
        this.startAttack('throw', 'throw', 0.5, { step: 0 });
      }
    } else if (kind === 'wand' || kind === 'runecircle') {
      const wand = kind === 'wand';
      // A sorcerer's focus costs less; in an Arcane Surge, nothing.
      const cost = this.surge > 0 ? 0 : Math.round((wand ? (heavy ? WAND.heavyMana : WAND.mana) : heavy ? RUNE_SEAL.mana : RUNE_TRAP.mana) * focusDiscount(this.c));
      if (this.mana < cost && !this.soulOrPower) {
        g.hud.toast('Not enough mana.');
        return;
      }
      if (!this.soulOrPower) this.mana -= cost;
      if (wand) this.startAttack('zap', heavy ? 'cast' : 'thrust', heavy ? 0.7 : 0.4, { big: heavy, step: 0 });
      else this.startAttack('rune', heavy ? 'summon' : 'cast', heavy ? 1.0 : 0.7, { big: heavy, step: 0 });
    } else if (kind === 'lyre' || kind === 'horn') {
      // The heavy plays a song for everyone near; it needs a breath between songs.
      let song = heavy;
      if (song && !this.ready('song')) {
        g.hud.toast(`Your next song is ready in ${Math.ceil(this.cooldownLeft('song'))}s.`);
        song = false;
      }
      const w = WEAPONS[mainWeapon(this.c).id];
      this.spend(song ? 20 : 10);
      const style = kind === 'horn' ? 'blow' : song ? 'song' : 'strum';
      this.startAttack('play', style, (song ? 1.5 : 0.7) / Math.sqrt(w.speed), { big: song, step: 0 });
    } else {
      const w = WEAPONS[mainWeapon(this.c).id];
      const quick = drawTimeMultiplier(this.c) < 1 ? 0.85 : 1;
      const dur = (1 / w.speed) * 0.9 * quick * (heavy ? 1 : lightAttackSpeed(this.c));
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
        // A released charge makes this heavy a power strike.
        const power = this.takePower();
        if (this.c.subclassId === 'swordsman') {
          this.startAttack('spin', 'spin', dur * 1.5, { power, ...(rank(this.c, 'lunge') ? { step: 2.2 } : {}) });
          g.hud.toast('Spinner Flourish!', 'skill');
        } else if (this.c.subclassId === 'axeman' && rank(this.c, 'throwing-axe')) {
          this.startAttack('throw', 'throw', 0.7, { power });
        } else if (kind === 'battleaxe' || kind === 'quarterstaff') {
          // The battle axe (and a quarterstaff) whirls all the way round.
          this.startAttack('spin', 'spin', dur * (kind === 'quarterstaff' ? 1.25 : 1.35), { power });
        } else if (kind === 'wraps') {
          // A palm strike: a step in and both palms driven into the foe.
          this.startAttack('heavy', 'palm', Math.max(0.6, dur * 1.9), { power, step: 0.9 + 2.2 * rank(this.c, 'lunge') });
        } else {
          // A lunge carries the heavy blow several steps forward.
          this.startAttack('heavy', heavyStyle(kind), dur * 1.6, { power, step: 0.9 + 2.2 * rank(this.c, 'lunge') });
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

  private startAttack(kind: AttackKind, style: AttackStyle, duration: number, o: { finisher?: boolean; step?: number; big?: boolean; mult?: number; power?: { burst: Burst; charge: number } } = {}) {
    const tm = TIMING[style] ?? TIMING.slash!;
    if (this.attack) this.finishAttack();
    if (kind !== 'channel') this.stopChannel();
    // Held and multi-blow moves run their own clock (flurry punches, beams, sitting, a parry).
    const own = kind === 'flurry' || kind === 'channel' || kind === 'meditate' || kind === 'parry';
    const fixed = kind === 'roar' || kind === 'meditate' || kind === 'parry';
    this.attack = {
      kind,
      style,
      // A power strike was wound up while charging: it goes straight into the blow.
      t: o.power ? Math.max(0, tm.from - 0.14) * duration : 0,
      duration,
      hitAt: tm.hit * duration,
      from: tm.from * duration,
      to: tm.to * duration,
      chainAt: (fixed ? 1 : tm.to) * duration,
      cancelAt: (fixed ? 1 : kind === 'cast' || kind === 'bow' ? 0 : Math.min(tm.to, tm.hit + 0.06)) * duration,
      step: o.step ?? tm.step * (o.finisher ? 1.3 : 1),
      stepFrom: Math.max(0, tm.from - 0.14) * duration,
      done: own,
      landed: false,
      combo: this.comboStep,
      finisher: !!o.finisher,
      aim: this.yaw,
      anim0: kind === 'bow' ? 0.62 : 0,
      big: !!o.big,
      shots: 0,
      mult: o.mult ?? 1,
      power: o.power,
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
    if (a.kind === 'flurry') {
      // Each punch of the storm lands on its own beat.
      while (a.shots < FLURRY_AT.length && a.t >= FLURRY_AT[a.shots] * a.duration) this.flurryPunch(g, a.shots++);
    } else if (a.kind === 'meditate') {
      this.meditate(dt, g, a);
    }
    if (a.style === 'volley') {
      // Each knife of the fan leaves the hand on its own throw.
      while (a.shots < KNIFE_VOLLEY && a.t >= VOLLEY_AT[a.shots] * a.duration) {
        this.throwKnife(g, (a.shots - 1) * 0.12);
        // Knife Rain: two more fan out wider with the last throw.
        if (a.shots === KNIFE_VOLLEY - 1 && rank(this.c, 'knife-rain')) for (const turn of [-0.3, 0.3]) this.throwKnife(g, turn);
        a.shots++;
      }
      a.done = a.shots > 0;
    }
    if (!a.done && a.t >= a.hitAt) {
      a.done = true;
      if (a.kind === 'light' || a.kind === 'heavy' || a.kind === 'spin' || a.kind === 'riposte') {
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
        if (a.warCry) this.warCryFx(g);
        else this.roarFx(g);
      } else if (a.kind === 'zap') {
        this.wandBolt(g, a.big);
      } else if (a.kind === 'rune') {
        this.drawRune(g, a.big);
      } else if (a.kind === 'play') {
        this.play(g, a.big);
      } else if (a.kind === 'cyclone') {
        this.cycloneHit(g);
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
    const c = this.c;
    const w = mainWeapon(c);
    const def = WEAPONS[w.id];
    const range = meleeReach(def);
    const palm = a.kind === 'heavy' && def.kind === 'wraps';
    // A roundhouse finisher reaches farther; a quarterstaff whirl farther still with Whirling Staff.
    const finisher = a.finisher && a.kind === 'light';
    const kickReach = finisher && def.kind === 'wraps' && rank(c, 'roundhouse') ? range * 0.3 : 0;
    const whirl = a.kind === 'spin' && def.kind === 'quarterstaff' ? rank(c, 'whirling-staff') : 0;
    const reach = range + kickReach + (a.kind === 'spin' ? 0.8 + 0.3 * rank(c, 'wide-flourish') * range + 0.25 * whirl * range : 0);
    const arc = swingArc(def.kind, a.kind === 'spin' ? 'spin' : a.kind === 'heavy' ? 'heavy' : 'light', rank(c, 'cleave') > 0);
    let base = weaponDamage(w) * (a.kind === 'heavy' ? (palm ? 1 : 1.8) : a.kind === 'spin' ? 1.3 * (1 + 0.2 * rank(c, 'wide-flourish')) * (1 + 0.15 * whirl) : 1) * a.mult;
    if (finisher) base *= 1.35;
    // A power strike hits far harder, then bursts.
    const pw = a.power;
    if (pw) base *= strikePower(pw.charge);
    let landed = false;
    const fwdYaw = this.yaw;
    const ambush = this.vanish > 0;
    for (const e of g.enemies) {
      if (!e.alive) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > reach + e.radius || Math.abs(e.pos.y - this.pos.y) > 3 + e.height) continue;
      const facing = Math.cos(Math.atan2(dx, dz) - fwdYaw);
      if (facing < arc && d > e.radius + 0.4) continue;
      const fromBehind = Math.cos(Math.atan2(-dx, -dz) - e.yaw) < -0.3;
      const boss = e instanceof Boss;
      // Assassinate: an ambush on a badly hurt foe ends it.
      if (ambush && rank(c, 'assassinate') && !boss && e.hp < e.maxHp * ASSASSINATE) {
        g.damageEnemy(e, e.hp + 1, 'true', { source: 'player', tags: ['backstab'] });
        g.sfx.damageNumber(e.center(this.tv).setY(e.pos.y + e.height + 0.4), 'ASSASSINATED', 'crit');
        landed = true;
        continue;
      }
      const hitBase = palm ? weaponDamage(w) * palmPower(c, e.status.stun > 0) * a.mult * (pw ? strikePower(pw.charge) : 1) : base;
      g.hitEnemyWithWeapon(e, hitBase, 'melee', def.element, { fromBehind, fury: this.fury, finisher, ambush });
      landed = true;
      if (e.bleeds && Math.random() < bleedChance(c)) e.status.bleed = 4;
      if (def.legendary === 'hammer-of-hephaestus' || def.legendary === 'sword-of-mars') e.status.burn = 3;
      if (def.element !== 'physical') g.sfx.impact(e.center(this.tv), ELEMENT_COLOR[def.element], 0.7);
      if (w.rune) this.applyRune(g, e, base, w.rune);
      if (this.poisonBlades > 0) this.envenom(g, e);
      // A palm strike (or a roundhouse) throws the foe back; pressure points stun it.
      if (palm) g.shoveEnemy(e, dx, dz, PALM_SHOVE);
      else if (kickReach) g.shoveEnemy(e, dx, dz, 6);
      if (finisher && rank(c, 'pressure-points')) e.status.stun = Math.max(e.status.stun, finisherStun(c, boss));
    }
    if (landed) {
      // Hit-stop and shake scaled to the blow.
      const big = a.kind === 'heavy' ? 1 : a.kind === 'spin' ? 0.7 : a.finisher ? 0.75 : 0;
      g.hitStop(0.055 + 0.065 * big);
      g.shake(0.12 + 0.2 * big);
      this.gainChi(chiOnHit(c));
      if (ambush) g.hud.toast('Ambush!', 'skill');
      if (palm) g.sfx.shockwave(this.tv.set(this.pos.x + Math.sin(this.yaw) * 1.2, this.pos.y + 1.1, this.pos.z + Math.cos(this.yaw) * 1.2), 1.6, this.chiColor(), 0.25);
    }
    if (pw) {
      // The burst lands where the blow did: in front, or all round for a whirl.
      const d = a.kind === 'spin' ? 0 : Math.min(reach, 2.2);
      const at = new THREE.Vector3(this.pos.x + Math.sin(fwdYaw) * d, this.pos.y, this.pos.z + Math.cos(fwdYaw) * d);
      at.y = Math.max(heightAt(at.x, at.z), WATER_LEVEL);
      this.burst(g, pw.burst, at, pw.charge, weaponDamage(w), null);
    }
    return landed;
  }

  /** Chi (a monk's mana) flowing back. */
  private gainChi(n: number) {
    if (n > 0 && !this.soulOrPower) this.mana = Math.min(this.maxMana, this.mana + n);
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
    if ((a.kind !== 'heavy' && !a.finisher) || !this.weaponMesh || !BLADE[this.weaponKind][1]) return;
    // A blade driven into the ground kicks up dirt.
    this.weaponMesh.updateWorldMatrix(true, false);
    const tip = this.weaponMesh.localToWorld(this.tv.set(0, BLADE[this.weaponKind][1], 0));
    const gy = heightAt(tip.x, tip.z);
    if (tip.y - gy < 0.7) {
      tip.y = Math.max(gy, WATER_LEVEL);
      g.sfx.dust(tip, a.kind === 'heavy' ? 14 : 8);
      g.sfx.impact(tip.setY(tip.y + 0.15), 0xffd8a0, a.kind === 'heavy' ? 0.5 : 0.3);
      if (a.kind === 'heavy') g.shake(0.18);
      // A greatsword's slam sends a shock along the ground.
      if (a.style === 'slam') {
        g.sfx.shockwave(tip, 4, this.trailColor(), 0.4);
        g.sfx.dust(tip, 10);
        g.shake(0.25);
      }
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

  /** Angelic: a beat of the wings in mid-air, a burst upward. */
  private flap(g: Game) {
    this.flapsLeft--;
    if (this.c.classId === 'monk') {
      // A front flip off the air itself.
      this.vel.y = 8.2;
      this.airFlip = 0;
      this.spend(10);
      g.sfx.emit(this.center(this.tv), { color: this.chiColor(), count: 14, speed: 2.4, life: 0.5, size: 0.35, up: -1, drag: 2 });
      g.audio.play('roll');
      return;
    }
    this.flapT = 0.35;
    this.vel.y = ANGELIC.flapSpeed;
    this.spend(ANGELIC.flapStamina);
    g.sfx.emit(this.pos, { color: 0xfffaf0, count: 10, speed: 2.5, life: 0.7, size: 0.18, up: -1, drag: 2 });
    g.audio.play('roll');
  }

  /** Orc War Cry: badly hurt, the orc roars. Foes close by reel, and its blows land harder for a while. */
  private startWarCry(g: Game) {
    const W = ORC.warCry;
    this.warCry = W.duration;
    this.warCryReadyAt = this.now + W.cooldown;
    // Stunned at once, so the roar itself is safe; bosses don't flinch.
    for (const e of g.enemies) {
      if (e.alive && !(e instanceof Boss) && e.pos.distanceTo(this.pos) < W.radius) e.status.stun = Math.max(e.status.stun, W.stun);
    }
    g.hud.toast('WAR CRY! Foes reel and your blows land harder.', 'rage');
    g.audio.play('roar');
    if (this.grounded && !this.swimming && !this.sailing && !this.flying && this.rollT < 0) {
      this.startAttack('roar', 'roar', 0.8);
      this.attack!.warCry = true;
      this.queued = null;
    } else this.warCryFx(g);
  }

  private warCryFx(g: Game) {
    const at = this.center(this.tv);
    g.sfx.emit(at, { color: 0xc8e060, count: 30, speed: 4, life: 0.6, size: 0.4, up: 1.5, drag: 1.5 });
    g.sfx.shockwave(at.set(this.pos.x, this.pos.y + 0.12, this.pos.z), ORC.warCry.radius, 0xd8c050, 0.5);
    g.sfx.shockwave(at, 3.5, 0x9ad040, 0.3);
    g.sfx.dust(this.pos, 18, 0x8a7a5a);
    g.shake(0.4);
  }

  /** Zombie, Not Dead Yet: the first killing blow since the hero last rested only knocks them down. */
  notDeadYet(g: Game): boolean {
    if (this.c.raceId !== 'zombie' || this.c.riseSpent || !this.alive) return false;
    this.c.riseSpent = true;
    this.hp = Math.round(this.maxHp * ZOMBIE.riseHp);
    this.iframes = ZOMBIE.riseIframes;
    this.stagger = 0.5;
    this.attack = null;
    const at = this.center(this.tv);
    g.sfx.emit(at, { color: 0x9cff60, count: 40, speed: 3, life: 0.9, up: 2 });
    g.sfx.shockwave(at.set(this.pos.x, this.pos.y + 0.12, this.pos.z), 3, 0x8ae050, 0.5);
    g.hud.toast('NOT DEAD YET! Rest at a shrine to cheat death again.', 'skill');
    g.audio.play('devil');
    return true;
  }

  /**
   * Angelic Halo of Mercy: an angel mends friends close by. Each game heals its own hero (when an
   * angel friend is near) and its own beasts (near any angel), so nothing extra crosses the network.
   */
  private mercy(dt: number, g: Game) {
    const angel = this.c.raceId === 'angelic' && this.alive;
    let angels = angel && g.allies.length > 0;
    for (const r of g.coop.remotes.values()) if (r.raceId === 'angelic' || angel) angels = true;
    if (!angels) return;
    this.mercyFx -= dt;
    const sparkle = this.mercyFx <= 0;
    if (sparkle) this.mercyFx = 0.6;
    const k = ANGELIC.haloHeal * dt;
    if (this.alive && this.hp < this.maxHp && this.haloNear(g, this.pos, false)) {
      this.heal(this.maxHp * k * lightHealMultiplier(this.c));
      if (sparkle) g.fx.emit(this.center(this.tv), MERCY_SPARKLE);
    }
    for (const al of g.allies) {
      if (!al.alive || al.hp >= al.maxHp || !this.haloNear(g, al.pos, angel)) continue;
      al.hp = Math.min(al.maxHp, al.hp + al.maxHp * k);
      if (sparkle) g.fx.emit(al.center(this.tv), MERCY_SPARKLE);
    }
    // The angel sees the friends it mends glow too.
    if (angel && sparkle) {
      for (const r of g.coop.remotes.values()) {
        if (r.alive && r.ready && r.hp < r.maxHp && r.pos.distanceTo(this.pos) < ANGELIC.haloRadius) g.fx.emit(r.center(this.tv), MERCY_SPARKLE);
      }
    }
  }

  /** An angel's halo reaches this spot (`self`: our own hero counts as one). */
  private haloNear(g: Game, at: THREE.Vector3, self: boolean) {
    const R = ANGELIC.haloRadius;
    if (self && Math.hypot(at.x - this.pos.x, at.z - this.pos.z) < R) return true;
    for (const r of g.coop.remotes.values()) if (r.raceId === 'angelic' && r.alive && r.ready && Math.hypot(at.x - r.pos.x, at.z - r.pos.z) < R) return true;
    return false;
  }

  private trailColor(): number {
    if (this.attack?.power) return BURST_COLOR[this.attack.power.burst];
    if (this.fury.bloodrageActive) return RAGE_RED;
    const w = mainWeapon(this.c);
    if (w.rune) return RUNES[w.rune].color;
    const def = WEAPONS[w.id];
    return def.element === 'physical' && def.legendary ? 0xffd27a : ELEMENT_COLOR[def.element];
  }

  /** Feeds the weapon trail while the blade is in its active window. */
  private weaponTrail(g: Game) {
    const a = this.attack;
    const w = this.weaponMesh;
    if (!a || !w) return;
    // Fists and feet trail their own streaks.
    if (this.weaponKind === 'wraps' || a.kind === 'flurry' || a.kind === 'cyclone') return limbTrail(g, this.rig, a.style, a.t / a.duration, this.chiColor());
    if (a.kind !== 'light' && a.kind !== 'heavy' && a.kind !== 'spin' && a.kind !== 'throw' && a.kind !== 'riposte') return;
    const kind = this.weaponKind;
    if (kind === 'bow') return;
    if (a.t < a.from - 0.04 * a.duration || a.t > (a.kind === 'throw' ? a.hitAt : a.to)) return;
    const [b0, b1] = BLADE[kind];
    if (!b1) return;
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

  private fireArrow(g: Game, draw: number, burst?: { kind: Burst; charge: number }) {
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
    // A charged arrow flies true and hard, glowing with its burst.
    const pb = burst ? { kind: burst.kind, charge: burst.charge, base } : undefined;
    const shoot = (dest: THREE.Vector3, b?: typeof pb) =>
      g.spawnProjectile({
        from, to: dest, speed: 50 + 30 * draw + (b ? 15 : 0), kind: 'arrow', owner: 'player', damage: base * (b ? strikePower(b.charge) : 1), element: def.element, gravity: b ? 2 : 9 * (1.2 - draw), draw, pierce,
        powerShot: ps ?? undefined, source: null, rune: w.rune, burst: b, color: b ? BURST_COLOR[b.kind] : undefined,
      });
    shoot(to, pb);
    if (draw >= 1 && rank(this.c, 'volley')) {
      for (const s of [-0.08, 0.08]) shoot(to.clone().sub(from).applyAxisAngle(UP, s).add(from));
    }
    g.audio.play('bow');
  }

  private throwWeapon(g: Game) {
    const w = mainWeapon(this.c);
    const def = WEAPONS[w.id];
    if (def.kind === 'knives') return this.throwKnife(g, 0);
    const from = this.center().add(new THREE.Vector3(0, 0.6, 0));
    const to = g.aimPoint(def.kind === 'bolt' ? 60 : 30);
    if (def.kind === 'bolt') {
      const check = canWield(this.c, w.id);
      // It strikes, then flies back to the hand (hitting again on the way).
      const pw = this.attack?.power;
      g.spawnProjectile({
        from, to, speed: 70, kind: 'bolt', owner: 'player', damage: weaponDamage(w) * (pw ? strikePower(pw.charge) : 1), element: 'lightning', gravity: 0, source: null, explode: 3, boomerang: true, home: () => this.boltHome(),
        burst: pw ? { kind: pw.burst, charge: pw.charge, base: weaponDamage(w) } : undefined,
      });
      this.boltOut = true;
      this.boltOutT = 0;
      if (this.weaponMesh) this.weaponMesh.visible = false;
      if (check.partial) {
        g.damagePlayer(5, 'lightning', null, true);
        g.hud.toast('The Master Bolt bites your hand.', 'warn');
      }
    } else {
      const pw = this.attack?.power;
      g.spawnProjectile({
        from, to, speed: 30, kind: 'axe', owner: 'player', damage: weaponDamage(w) * 1.4 * (pw ? strikePower(pw.charge) : 1), element: 'physical', gravity: 4, source: null, rune: w.rune,
        burst: pw ? { kind: pw.burst, charge: pw.charge, base: weaponDamage(w) * 1.4 } : undefined, color: pw ? BURST_COLOR[pw.burst] : undefined,
      });
    }
    g.audio.play('throw');
  }

  /** Where a returning thunderbolt flies to: the throwing hand (none once the hero is down). */
  private boltHome(): THREE.Vector3 | null {
    if (!this.alive) return null;
    return this.rig.handR.getWorldPosition(this.boltV);
  }

  /** The thunderbolt is back in hand (or lost, and returns quietly). */
  catchBolt(g: Game, caught: boolean) {
    if (!this.boltOut) return;
    this.boltOut = false;
    if (this.weaponMesh) this.weaponMesh.visible = true;
    if (!caught) return;
    g.audio.play('zap');
    g.fx.emit(this.rig.handR.getWorldPosition(this.boltV), { color: 0xbfe0ff, count: 10, speed: 3, life: 0.3, size: 0.4 });
  }

  /** One throwing knife, `turn` radians off the aim (a volley fans out). */
  private throwKnife(g: Game, turn: number) {
    const c = this.c;
    if (c.knives <= 0) return;
    c.knives--;
    const w = mainWeapon(c);
    const from = this.center().add(this.tv.set(Math.sin(this.yaw) * 0.4, 0.45, Math.cos(this.yaw) * 0.4));
    const to = g.aimPoint(WEAPONS[w.id].range);
    if (turn) to.sub(from).applyAxisAngle(UP, turn).add(from);
    const pw = turn === 0 ? this.attack?.power : undefined;
    g.spawnProjectile({
      from, to, speed: 46 + (pw ? 14 : 0), kind: 'knife', owner: 'player', damage: weaponDamage(w) * (pw ? strikePower(pw.charge) : 1), element: 'physical', gravity: pw ? 2 : 5, source: null, rune: w.rune,
      poison: this.poisonBlades > 0, ambush: this.vanish > 0, burst: pw ? { kind: pw.burst, charge: pw.charge, base: weaponDamage(w) } : undefined, color: pw ? BURST_COLOR[pw.burst] : undefined,
    });
    g.audio.play('throw');
    if (c.knives === 0) g.hud.toast('Out of knives! Pick them up, or rest at a shrine.', 'warn');
  }

  /** A wand's bolt: quick and cheap, or (heavy) a bolt that bursts. */
  private wandBolt(g: Game, big: boolean) {
    const w = mainWeapon(this.c);
    const fx = w.rune ? RUNE_EFFECT[w.rune] : null;
    const element: DamageElement = fx ? fx.element : 'physical';
    const color = w.rune ? RUNES[w.rune].color : 0xb070ff;
    const power = weaponDamage(w) * spellPowerMultiplier(this.c, element) * wandcraft(this.c) * this.songDamage() * (big ? 2.2 : 1);
    const tip = this.weaponTip(this.tv2);
    const from = tip ?? this.center().add(this.tv.set(Math.sin(this.yaw) * 0.6, 0.4, Math.cos(this.yaw) * 0.6));
    g.spawnProjectile({ from: from.clone(), to: g.aimPoint(WEAPONS[w.id].range), speed: big ? 38 : 60, kind: 'wand', owner: 'player', damage: power, element, gravity: 0, source: null, explode: big ? 2.6 : undefined, rune: w.rune, color });
    g.sfx.emit(from, { color, count: big ? 14 : 6, speed: 2, life: 0.3, size: 0.3 });
    g.audio.play(big ? 'spell' : 'zap');
  }

  /** The rune circle: a trap drawn where the hero aims, or (heavy) a binding seal all around. */
  private drawRune(g: Game, big: boolean) {
    const w = mainWeapon(this.c);
    const fx = w.rune ? RUNE_EFFECT[w.rune] : null;
    const element: DamageElement = fx ? fx.element : 'physical';
    const color = w.rune ? RUNES[w.rune].color : 0x46f0c8;
    const power = weaponDamage(w) * spellPowerMultiplier(this.c, element) * wandcraft(this.c) * this.songDamage();
    if (big) {
      g.armory.addTrap(g, { x: this.pos.x, z: this.pos.z, radius: RUNE_SEAL.radius, seconds: RUNE_SEAL.seconds, damage: power * 0.25, element, color, slow: 0, root: RUNE_SEAL.root, rune: w.rune });
      // It snaps shut on everything inside at once.
      for (const e of g.enemies) {
        if (!e.alive || e.pos.distanceTo(this.pos) > RUNE_SEAL.radius + e.radius) continue;
        g.damageEnemy(e, power * 1.2, element, { source: 'spell' });
        e.status.root = Math.max(e.status.root, RUNE_SEAL.root);
      }
      g.sfx.shockwave(this.tv.set(this.pos.x, this.pos.y + 0.15, this.pos.z), RUNE_SEAL.radius, color, 0.45);
      g.sfx.flash(this.center(this.tv), color, 16, 10);
      g.shake(0.15);
    } else {
      // Drawn on the ground where the hero aims, no farther than the circle reaches.
      const at = g.aimPoint(WEAPONS[w.id].range);
      const dx = at.x - this.pos.x, dz = at.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const k = d > WEAPONS[w.id].range ? WEAPONS[w.id].range / d : 1;
      g.armory.addTrap(g, { x: this.pos.x + dx * k, z: this.pos.z + dz * k, radius: RUNE_TRAP.radius, seconds: RUNE_TRAP.seconds, damage: power * 0.35, element, color, slow: RUNE_TRAP.slow, root: 0, rune: w.rune });
    }
    g.sfx.sound('rune', this.pos);
  }

  /** A lyre's chord or a war horn's blast at the foes in front; the heavy plays a song for everyone near. */
  private play(g: Game, song: boolean) {
    const w = mainWeapon(this.c);
    const def = WEAPONS[w.id];
    const horn = def.kind === 'horn';
    const at = this.center(this.tv2);
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    const color = w.rune ? RUNES[w.rune].color : horn ? 0xffb070 : 0xffe08a;
    if (song) {
      const id = songOf(def.kind)!;
      const sd = SONGS[id];
      this.cooldowns.set('song', this.now + SONG.cooldown);
      this.applySong(g, id);
      g.coop.shareSong(id, this.pos);
      for (const e of g.enemies) {
        if (!e.alive || e.pos.distanceTo(this.pos) > SONG.foeRadius + e.radius) continue;
        e.status[sd.foe] = Math.max(e.status[sd.foe], sd.foeSeconds);
        g.damageEnemy(e, weaponDamage(w) * 0.6 * this.songDamage(), 'physical', { source: 'player' });
        if (w.rune) this.applyRune(g, e, weaponDamage(w), w.rune);
      }
      g.sfx.shockwave(this.tv.set(this.pos.x, this.pos.y + 0.15, this.pos.z), SONG.radius, sd.color, 0.7);
      g.sfx.shockwave(this.tv, SONG.foeRadius, color, 0.45);
      g.sfx.emit(at, { color: sd.color, count: 40, speed: 5, life: 1, size: 0.45, up: 2, drag: 1.5 });
      g.sfx.flash(at, sd.color, 20, 14);
      g.sfx.damageNumber(this.tv.set(this.pos.x, this.pos.y + 2.4, this.pos.z), horn ? 'WAR CRY!' : '♪ ♫ ♪', 'song');
      g.sfx.sound(horn ? 'horn' : 'song', this.pos, 80);
      g.hud.toast(`${sd.name}!`, 'skill');
      g.shake(0.2);
      return;
    }
    // Ripples of sound roll out ahead; foes caught in them are dazed (lyre) or flee (horn).
    const range = def.range;
    let landed = false;
    for (const e of g.enemies) {
      if (!e.alive || Math.abs(e.pos.y - this.pos.y) > 3 + e.height) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius || (dx * fwdX + dz * fwdZ) / (d || 1) < 0.35) continue;
      g.hitEnemyWithWeapon(e, weaponDamage(w) * (1.2 - 0.5 * (d / range)), 'melee', def.element, { fury: this.fury });
      if (horn) e.status.fear = Math.max(e.status.fear, 2.5);
      else e.status.stun = Math.max(e.status.stun, 0.9);
      if (w.rune) this.applyRune(g, e, weaponDamage(w), w.rune);
      landed = true;
    }
    for (let i = 1; i <= 3; i++) {
      const d = i * range * 0.28;
      g.sfx.shockwave(this.tv.set(this.pos.x + fwdX * d, this.pos.y + 0.9, this.pos.z + fwdZ * d), 0.6 + i * 0.55, color, 0.25 + i * 0.08);
    }
    g.sfx.emit(at.addScaledVector(this.tv.set(fwdX, 0, fwdZ), 0.6), { color, count: 16, speed: 3, life: 0.7, size: 0.35, up: 1, drift: this.tv.set(fwdX * 5, 0.6, fwdZ * 5) });
    if (!horn) g.sfx.damageNumber(at.setY(at.y + 0.9), '♪ ♫', 'song');
    g.sfx.sound(horn ? 'horn' : 'strum', this.pos);
    if (landed) {
      g.hitStop(0.05);
      g.shake(0.12);
    }
  }

  /** A song takes hold: harder blows (and more) for its length. */
  applySong(g: Game, id: SongId, from?: string) {
    const sd = SONGS[id];
    this.song = id;
    this.songLeft = SONG.seconds;
    if (from) g.hud.toast(`${from} plays the ${sd.name}! You strike harder${sd.speed > 1 ? ' and run faster' : ''}.`, 'skill');
  }

  /** Damage multiplier from a song (and a blood orange): used by every weapon hit. */
  songDamage() {
    return (this.song ? SONGS[this.song].damage : 1) * fedMul(this.c, 'damage');
  }

  /** A runed weapon's hit: burn, frost, poison, or lightning leaping to foes nearby. */
  applyRune(g: Game, e: Enemy, base: number, rune: RuneId) {
    const fx = RUNE_EFFECT[rune];
    const color = RUNES[rune].color;
    if (fx.status) e.status[fx.status] = Math.max(e.status[fx.status], fx.seconds);
    // The rune's element joins a friend's in a team combo.
    g.noteElement(e, RUNE_ELEMENT[rune], base);
    if (fx.chain) {
      const from = e.center();
      let n = 0;
      for (const o of g.enemies) {
        if (n >= fx.chain) break;
        if (o === e || !o.alive || o.pos.distanceTo(e.pos) > STORM_CHAIN.range) continue;
        g.sfx.lightning(from, o.center(this.tv), color);
        g.damageEnemy(o, base * STORM_CHAIN.share, 'lightning', { source: 'player' });
        o.status.stun = Math.max(o.status.stun, 0.3);
        n++;
      }
    }
    g.fx.impact(e.center(this.tv), color, 0.5);
  }

  /** Where the main weapon's tip is in the world (null when nothing is in hand). */
  private weaponTip(out: THREE.Vector3): THREE.Vector3 | null {
    const m = this.weaponMesh;
    const tip = BLADE[this.weaponKind][1];
    if (!m || !tip) return null;
    m.updateWorldMatrix(true, false);
    return m.localToWorld(out.set(0, tip, 0));
  }

  // --------------------------------------------------------------- ability --

  abilityName(): string {
    const c = this.c;
    if (c.classId === 'monk') return 'Flurry of Blows';
    if (c.classId === 'rogue') return 'Vanish';
    if (c.classId === 'sorcerer') return 'Arcane Surge';
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
    if (c.classId === 'monk') return this.flurry(g);
    if (c.classId === 'rogue') return this.startVanish(g);
    if (c.classId === 'sorcerer') return this.startSurge(g);
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

  // ------------------------------------------------- monk, sorcerer, rogue --

  /** Flurry of Blows: a storm of punches on the foe in front (a Wind Walker dashes to it first). */
  private flurry(g: Game) {
    if (this.abilityReadyAt > this.now) return g.hud.toast(`Flurry of Blows is ready in ${Math.ceil(this.abilityReadyAt - this.now)}s.`);
    if (this.exhausted || this.stamina < 5) return g.hud.toast('Too winded.');
    this.spend(FLURRY.stamina);
    this.abilityReadyAt = this.now + FLURRY.cooldown;
    if (this.c.subclassId === 'windwalker') {
      const t = this.lockTarget ?? g.findTarget(FLURRY.dash + 2, 0.4, false);
      if (t && t.pos.distanceTo(this.pos) > t.radius + 1.6) {
        // Across the gap in a gust.
        const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        const go = Math.min(FLURRY.dash, d - t.radius - 1.1);
        g.sfx.emit(this.center(this.tv), { color: this.chiColor(), count: 18, speed: 2, life: 0.45, size: 0.45 });
        this.pos.x += (dx / d) * go;
        this.pos.z += (dz / d) * go;
        this.pos.y = Math.max(this.pos.y, heightAt(this.pos.x, this.pos.z));
        this.yaw = Math.atan2(dx, dz);
        g.sfx.dust(this.pos, 8);
      }
    }
    this.startAttack('flurry', 'flurry', FLURRY.duration, { step: 0 });
    this.attack!.aim = this.pickAim(g, 0, 0, 0);
    this.queued = null;
    g.hud.toast('Flurry of Blows!', 'skill');
    g.audio.play('swing');
  }

  /** One punch of a flurry (the last one throws them back with Storm Kick). */
  private flurryPunch(g: Game, i: number) {
    const c = this.c;
    const w = mainWeapon(c);
    const base = weaponDamage(w) * flurryPower(c) * this.songDamage();
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    const last = i === FLURRY_AT.length - 1;
    let landed = false;
    for (const e of g.enemies) {
      if (!e.alive || Math.abs(e.pos.y - this.pos.y) > 3 + e.height) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > FLURRY.reach + e.radius || ((dx * fwdX + dz * fwdZ) / (d || 1) < 0.3 && d > e.radius + 0.4)) continue;
      const fromBehind = Math.cos(Math.atan2(-dx, -dz) - e.yaw) < -0.3;
      for (let k = 0; k < flurryBlows(c); k++) g.hitEnemyWithWeapon(e, base, 'melee', 'physical', { fromBehind });
      if (this.poisonBlades > 0) this.envenom(g, e);
      if (last && rank(c, 'storm-kick')) g.shoveEnemy(e, dx, dz, 12);
      landed = true;
    }
    const hand = i % 2 === 0 ? this.rig.handL : this.rig.handR;
    hand.getWorldPosition(this.tv);
    if (landed) {
      g.fx.impact(this.tv, 0xffe8c0, 0.35);
      g.hitStop(0.03);
      g.shake(0.08);
      g.audio.play('hit');
      this.gainChi(1);
    }
    if (last && rank(c, 'storm-kick')) {
      g.sfx.shockwave(this.tv2.set(this.pos.x + fwdX * 2, this.pos.y + 1, this.pos.z + fwdZ * 2), 3.5, 0xc8ffe4, 0.35);
      g.sfx.emit(this.tv, { color: 0xd8fff0, count: 30, speed: 8, life: 0.5, size: 0.5, drift: this.tv2.set(fwdX * 9, 0.5, fwdZ * 9) });
    }
  }

  /** Cyclone Kick lands: everything around is struck and thrown into the air. */
  private cycloneHit(g: Game) {
    const def = SPELLS['cyclone-kick'];
    const power = this.spellDamage(def.power * cyclonePower(this.c), 'wind');
    let landed = false;
    for (const e of g.enemies) {
      if (!e.alive || Math.abs(e.pos.y - this.pos.y) > 3.5 + e.height) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      if (Math.hypot(dx, dz) > CYCLONE.radius + e.radius) continue;
      g.damageEnemy(e, power, 'wind', { source: 'player' });
      g.shoveEnemy(e, dx, dz, 5, CYCLONE.lift);
      landed = true;
    }
    g.sfx.shockwave(this.tv.set(this.pos.x, this.pos.y + 0.6, this.pos.z), CYCLONE.radius + 0.6, 0xc8ffe4, 0.4);
    g.sfx.emit(this.center(this.tv), { color: 0xd8fff0, count: 40, speed: 7, life: 0.5, size: 0.5, up: 2 });
    g.sfx.sound('swing', this.pos);
    if (landed) {
      g.hitStop(0.07);
      g.shake(0.22);
      this.gainChi(chiOnHit(this.c));
    }
  }

  /** Sitting in meditation: health and chi flow back each second. */
  private meditate(dt: number, g: Game, a: Attack) {
    const sitting = a.t > 0.35 && a.t < a.duration - 0.35;
    if (!sitting) return;
    this.heal(this.maxHp * meditateHeal(this.c) * dt);
    this.gainChi(MEDITATE.chi * dt);
    this.stamina = Math.min(this.maxStamina, this.stamina + 20 * dt);
    if (Math.random() < dt * 6) g.fx.emit(this.center(this.tv), { color: 0x9af0d0, count: 2, speed: 0.6, life: 1.1, size: 0.3, up: 1.4 });
  }

  /** A meditating monk stands up (moved, struck, or done). */
  endMeditation() {
    const a = this.attack;
    if (a?.kind === 'meditate' && a.t < a.duration - 0.35) a.t = Math.max(a.t, a.duration - 0.35);
  }

  /** Vanish: gone from every foe's sight; the next strike is an ambush. */
  private startVanish(g: Game) {
    if (this.abilityReadyAt > this.now) return g.hud.toast(`Vanish is ready in ${Math.ceil(this.abilityReadyAt - this.now)}s.`);
    this.vanish = vanishSeconds(this.c);
    this.abilityReadyAt = this.now + vanishCooldown(this.c);
    this.dropAggro(g, Infinity);
    g.sfx.emit(this.center(this.tv), { color: 0x4a4650, count: 40, speed: 2.5, life: 1.1, size: 1.1, up: 0.8, drag: 1.5 });
    g.sfx.sound('roll', this.pos);
    g.hud.toast('Vanished. Your next strike is an ambush.', 'skill');
  }

  /** Every foe close enough (not great foes) forgets the hero; in co-op the host's monsters too. */
  private dropAggro(g: Game, range: number) {
    for (const e of g.enemies) {
      if (!e.alive || e.net || e instanceof Boss || !e.aware || e.pos.distanceTo(this.pos) > range) continue;
      e.aware = false;
      e.awareness = 0;
      e.state = 'return';
    }
    g.coop.dropAggro(range);
  }

  /** Arcane Surge: for a while, spells cost nothing and hit harder. */
  private startSurge(g: Game) {
    if (this.abilityReadyAt > this.now) return g.hud.toast(`Arcane Surge is ready in ${Math.ceil(this.abilityReadyAt - this.now)}s.`);
    this.surge = surgeSeconds(this.c);
    this.abilityReadyAt = this.now + surgeCooldown(this.c);
    const color = this.pathColor();
    g.sfx.magicCircle(this.pos, color, 3.2, 1.6);
    g.sfx.emit(this.center(this.tv), { color, count: 50, speed: 4, life: 0.9, size: 0.5, up: 2 });
    g.sfx.flash(this.center(this.tv), color, 20, 12);
    g.hud.toast('ARCANE SURGE! Spells are free and stronger.', 'skill');
    g.audio.play('spell');
    if (!this.attack && this.grounded) this.startAttack('cast', 'summon', 0.7);
  }

  /** A sorcerer's colour: violet for the Dark Mage, gold for the Light Mage. */
  pathColor(): number {
    return this.c.subclassId === 'lightmage' ? 0xffd870 : this.c.subclassId === 'darkmage' ? 0x9a4dff : 0xa060ff;
  }

  /** Poison Blades: a blow (or a knife) poisons; stacks tick here, on top of the poison status. */
  envenom(g: Game, e: Enemy) {
    e.status.poison = Math.max(e.status.poison, POISON.seconds);
    let t = this.toxins.find((x) => x.e === e);
    if (!t) this.toxins.push((t = { e, stacks: 0, left: 0, tick: 0.5 }));
    t.stacks = Math.min(POISON.stacks, t.stacks + 1);
    t.left = POISON.seconds;
    g.fx.emit(e.center(this.tv), { color: 0x7cff3a, count: 6 + t.stacks * 3, speed: 1.4, life: 0.6, size: 0.3 });
  }

  /** A ward of light soaks up damage for a while (cast here, or by a friend). */
  receiveWard(g: Game, amount: number, from?: string) {
    this.ward = Math.max(this.ward, amount);
    this.wardLeft = WARD.seconds;
    if (from) g.hud.toast(`${from} wards you with light.`, 'skill');
  }

  /** Healing from a friend's Mending Light. */
  receiveMend(g: Game, amount: number, from?: string) {
    const got = Math.min(amount * lightHealMultiplier(this.c), this.maxHp - this.hp);
    this.heal(got);
    if (got >= 1) g.fx.damageNumber(this.center(this.tv).setY(this.pos.y + 2), `+${Math.round(got)}`, 'heal');
    g.fx.emit(this.center(this.tv), { color: 0xfff0b0, count: 24, speed: 1.6, life: 0.9, up: 2 });
    if (from) g.hud.toast(`${from} mends you.`, 'skill');
  }

  /** A blow caught by Parry: turned aside, and answered with a riposte. */
  parried(g: Game, source: Actor) {
    this.parryWindow = 0;
    g.sfx.emit(this.center(this.tv).addScaledVector(this.tv2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 0.7), { color: 0xfff2c0, count: 26, speed: 6, life: 0.35, size: 0.4 });
    g.sfx.sound('block', this.pos);
    g.fx.damageNumber(this.center(this.tv).setY(this.pos.y + 2.1), 'PARRY', 'crit');
    g.hitStop(0.09);
    this.yaw = Math.atan2(source.pos.x - this.pos.x, source.pos.z - this.pos.z);
    if (rank(this.c, 'momentum')) {
      this.stamina = Math.min(this.maxStamina, this.stamina + 25);
      this.cooldowns.set('parry', 0);
    }
    this.startAttack('riposte', 'thrust', 0.42, { mult: riposteMultiplier(this.c), step: 0.8 });
    this.attack!.aim = this.yaw;
  }

  /** A foe died: a hex on it leaps on (and feeds a Soul Siphon). */
  onFoeDied(g: Game, e: Enemy) {
    if (!this.hexed.delete(e)) return;
    if (rank(this.c, 'soul-siphon')) this.gainChi(10);
    let n = hexLeaps(this.c);
    const from = e.center();
    const near = g.enemies.filter((o) => o.alive && o !== e && o.status.hex <= 0 && o.pos.distanceTo(e.pos) < HEX.leap).sort((a, b) => a.pos.distanceTo(e.pos) - b.pos.distanceTo(e.pos));
    for (const o of near) {
      if (n-- <= 0) break;
      o.status.hex = hexSeconds(this.c);
      this.hexed.add(o);
      g.sfx.lightning(from, o.center(this.tv), 0x9a4dff);
    }
  }

  /** The hero took part in a kill: Tailwind, and Phantom stretching a Vanish. */
  onKill() {
    if (rank(this.c, 'tailwind')) this.tailwind = 4;
    if (this.vanish > 0 && rank(this.c, 'phantom')) this.vanish += 2;
  }

  /** Dodged a blow mid-roll (Eye of the Storm, Slippery). */
  dodged(g: Game) {
    const r = dodgeReward(this.c);
    if (!r.stamina && !r.mana) return;
    this.stamina = Math.min(this.maxStamina, this.stamina + r.stamina);
    this.gainChi(r.mana);
    g.fx.emit(this.center(this.tv), { color: 0xd8fff0, count: 10, speed: 2, life: 0.4 });
  }

  /** The newer classes' timers: Iron Skin, Vanish, wards, surges, poison, smoke. */
  private tickClassTimers(dt: number, g: Game) {
    this.ironSkin = Math.max(0, this.ironSkin - dt);
    this.poisonBlades = Math.max(0, this.poisonBlades - dt);
    this.parryWindow = Math.max(0, this.parryWindow - dt);
    this.tailwind = Math.max(0, this.tailwind - dt);
    this.ghost = Math.max(0, this.ghost - dt);
    if (this.vanish > 0 && (this.vanish -= dt) <= 0) g.hud.toast('You step out of the shadows.');
    if (this.surge > 0 && (this.surge -= dt) <= 0) g.hud.toast('The surge ebbs.');
    if (this.wardLeft > 0) {
      this.wardLeft -= dt;
      if (rank(this.c, 'aegis-ward')) this.heal(this.maxHp * WARD.mend * dt);
      if (this.wardLeft <= 0 || this.ward <= 0) this.ward = this.wardLeft = 0;
    }
    if (this.renew > 0) {
      const step = Math.min(this.renew, this.renewRate * dt);
      this.renew -= step;
      this.heal(step);
    }
    for (let i = this.later.length - 1; i >= 0; i--) {
      if (this.now < this.later[i].at) continue;
      const run = this.later[i].run;
      this.later.splice(i, 1);
      run();
    }
    for (let i = this.toxins.length - 1; i >= 0; i--) {
      const t = this.toxins[i];
      t.left -= dt;
      t.tick -= dt;
      if (!t.e.alive || t.left <= 0) {
        this.toxins.splice(i, 1);
        continue;
      }
      if (t.tick <= 0) {
        t.tick += 0.5;
        g.damageEnemy(t.e, toxinDps(this.c) * t.stacks * 0.5, 'true', { dot: true, source: 'player' });
      }
    }
    for (const e of this.hexed) if (!e.alive || e.status.hex <= 0) this.hexed.delete(e);
    this.inSmoke = g.armory.inSmoke(this.pos.x, this.pos.z);
    // Auras for Iron Skin, the surge and a ward.
    this.ironAura = this.auraFor(g, this.ironAura, this.ironSkin > 0, 0xc8a070);
    this.surgeAura = this.auraFor(g, this.surgeAura, this.surge > 0, this.pathColor());
    this.wardAura = this.auraFor(g, this.wardAura, this.ward > 0, 0xfff0b0);
  }

  private auraFor(g: Game, aura: { stop(): void } | null, on: boolean, color: number) {
    if (on && this.alive && !aura) return g.fx.aura(this.rig.root, color, Infinity);
    if ((!on || !this.alive) && aura) {
      aura.stop();
      return null;
    }
    return aura;
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

  // ------------------------------------------------------- power strikes --

  /** Whether holding heavy can charge a power strike now (if not, a press is a plain heavy). */
  private canCharge(): boolean {
    const kind = chargeKind(this.c, this.weaponKind, this.spell);
    if (!kind || this.swimming || this.sailing || this.flying || this.now < this.powerReadyAt) return false;
    if (kind === 'bow' && this.arrows() <= 0) return false;
    if (kind === 'thrown' && (this.weaponKind === 'knives' ? this.c.knives <= 0 : this.boltOut)) return false;
    if (kind === 'spell') {
      const s = this.spell!;
      const cost = spellCost(this.c, s) * POWER.spellMana;
      return this.ready(s) && (this.mana >= cost || this.surge > 0 || this.soulOrPower);
    }
    return this.stamina >= 10 && !this.exhausted;
  }

  /** The heavy move this weapon makes (its wind-up is the charging pose). */
  private heavyMoveStyle(): AttackStyle {
    const kind = this.weaponKind;
    if (this.c.subclassId === 'swordsman' || kind === 'battleaxe' || kind === 'quarterstaff') return 'spin';
    if (this.c.subclassId === 'axeman' && rank(this.c, 'throwing-axe')) return 'throw';
    return heavyStyle(kind);
  }

  /** Holding heavy: a tap is a plain heavy; held, it charges until let go. */
  private updateCharge(dt: number, g: Game, able: boolean) {
    if (this.heavyHeld < 0) return;
    this.heavyHeld += dt;
    const held = g.input.held.has('heavy');
    if (!this.heavyPending) {
      // It could not charge (cooldown, or nothing to pay with): say so if held on.
      if (held && this.heavyHeld > 0.45 && !this.heavyWarned) {
        this.heavyWarned = true;
        if (this.now < this.powerReadyAt) g.hud.toast(`Power strike ready in ${Math.ceil(this.powerReadyAt - this.now)}s.`);
      }
      if (!held) this.heavyHeld = -1;
      return;
    }
    if (!able) return this.cancelCharge();
    const ch = this.charge;
    if (!ch) {
      if (!held) {
        // A tap: the heavy blow (with a bow, the dagger).
        this.heavyHeld = -1;
        this.heavyPending = false;
        if (this.weaponKind === 'bow') this.drawDagger(g);
        else (this.queued = 'heavy'), (this.queuedAt = this.now);
        return;
      }
      const busy = !!this.attack && this.attack.t < this.attack.chainAt;
      if (this.heavyHeld >= POWER.start && !busy) this.beginCharge(g);
      return;
    }
    ch.t += dt;
    ch.level = chargeLevel(ch.t);
    this.spend(POWER.drain * dt, 0.4);
    if (ch.kind === 'bow') this.drawing = Math.max(0.15, ch.level);
    const color = BURST_COLOR[ch.burst];
    chargeSparks(g, this.center(this.tv), color, ch.level);
    if (ch.level >= 1 && !ch.full) {
      ch.full = true;
      g.fx.ring(this.tv.set(this.pos.x, this.pos.y + 0.2, this.pos.z), 1.6, color, 0.45);
      g.fx.flash(this.center(this.tv), color, 12, 8);
      g.audio.play('zap');
    }
    if (!held || this.stamina <= 0) this.releaseCharge(g);
  }

  private beginCharge(g: Game) {
    const kind = chargeKind(this.c, this.weaponKind, this.spell)!;
    const w = mainWeapon(this.c);
    const burst = kind === 'spell' ? spellBurst(this.c, this.spell!) : burstFor(this.c, w.id, w.rune);
    const style: AttackStyle = kind === 'spell' ? 'cast' : kind === 'bow' ? 'bow' : kind === 'thrown' ? 'throw' : this.heavyMoveStyle();
    if (this.attack) this.finishAttack();
    this.queued = null;
    this.charge = { kind, burst, t: POWER.start, level: 0, full: false, style };
    this.chargeAura?.stop();
    this.chargeAura = g.fx.aura(this.rig.root, BURST_COLOR[burst], Infinity);
    g.sfx.sound('windup', this.pos);
  }

  /** Let go: the power strike (or charged arrow, or empowered spell) comes out. */
  private releaseCharge(g: Game) {
    const ch = this.charge!;
    this.cancelCharge();
    const charge = ch.level;
    this.powerReadyAt = this.now + POWER.cooldown;
    const color = BURST_COLOR[ch.burst];
    g.sfx.emit(this.center(this.tv), { color, count: 16 + Math.round(16 * charge), speed: 4, life: 0.4, size: 0.45 });
    if (ch.kind === 'bow') {
      if (this.arrows() <= 0) return;
      this.spend(POWER.arrowStamina);
      this.drawing = 0;
      this.fireArrow(g, 1, { kind: ch.burst, charge });
      this.startAttack('bow', 'bow', 0.32);
      return;
    }
    if (ch.kind === 'spell') {
      this.empower = empowerPower(charge);
      this.empowerBurst = { kind: ch.burst, charge };
      this.cast(g, false);
      this.empowerBurst = null;
      // A beam stays empowered while it flows.
      if (!this.channel) this.empower = 1;
      return;
    }
    // A blow or a throw: the heavy move, as a power strike.
    this.powerNext = { burst: ch.burst, charge };
    this.queued = 'heavy';
    this.queuedAt = this.now;
  }

  /** Charging stops without striking (a roll, a stagger, the water). */
  private cancelCharge() {
    this.heavyHeld = -1;
    this.heavyPending = false;
    if (this.charge?.kind === 'bow') this.drawing = 0;
    this.charge = null;
    this.chargeAura?.stop();
    this.chargeAura = null;
  }

  /** The power strike a heavy move is about to make (paid for now). */
  private takePower() {
    const p = this.powerNext;
    this.powerNext = null;
    if (p) this.spend(POWER.stamina, 0.6);
    return p ?? undefined;
  }

  /** A bow's quick heavy: the dagger comes out. */
  private drawDagger(g: Game) {
    if (this.c.classId === 'mage') return;
    const dagger = this.c.weapons.findIndex((w) => WEAPONS[w.id].kind === 'dagger');
    if (dagger < 0) return;
    this.c.mainHand = dagger;
    this.equip();
    g.hud.toast('Dagger drawn.');
  }

  /**
   * A power strike bursts where it lands: its element's effect on every foe
   * in reach. Damage, statuses and shoves reach the host's monsters in
   * co-op; the effects are shared so friends see them.
   */
  burst(g: Game, b: Burst, at: THREE.Vector3, charge: number, base: number, primary: Enemy | null) {
    const spec = BURST[b];
    const fx = burstEffects(b, charge);
    const dmg = base * spec.share * burstScale(charge);
    const el = BURST_ELEMENT[b];
    const color = BURST_COLOR[b];
    let dealt = 0;
    const strike = (e: Enemy, k = 1) => {
      g.damageEnemy(e, dmg * k, el, { source: 'player' });
      dealt += dmg * k;
    };
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    const up = this.tv.set(at.x, at.y + 1, at.z);
    if (b === 'lightning') {
      // It leaps from foe to foe, stunning each.
      const byDist = (o: THREE.Vector3) => (x: Enemy, y: Enemy) => x.pos.distanceTo(o) - y.pos.distanceTo(o);
      let cur: Enemy | null = primary?.alive ? primary : (g.enemies.filter((e) => e.alive && e.pos.distanceTo(at) < 5 + e.radius).sort(byDist(at))[0] ?? null);
      const done = new Set<Enemy>();
      const from = up.clone();
      g.sfx.lightning(this.tv2.set(at.x, at.y + 24, at.z), at.clone(), color);
      for (let i = 0; i <= fx.chains && cur; i++) {
        done.add(cur);
        const to = cur.center();
        g.sfx.lightning(from, to, color);
        strike(cur, i === 0 ? 1 : 0.8);
        cur.status.stun = Math.max(cur.status.stun, fx.stun * (cur instanceof Boss ? 0.4 : 1));
        from.copy(to);
        const c0: Enemy = cur;
        cur = g.enemies.filter((e) => e.alive && !done.has(e) && e.pos.distanceTo(c0.pos) < 7 + e.radius).sort(byDist(c0.pos))[0] ?? null;
      }
    } else {
      for (const e of g.enemies) {
        if (!e.alive || Math.abs(e.pos.y - at.y) > 4 || Math.hypot(e.pos.x - at.x, e.pos.z - at.z) > spec.radius + e.radius) continue;
        const boss = e instanceof Boss;
        strike(e, b === 'light' && e.dark ? 2 : 1);
        let dx = e.pos.x - at.x, dz = e.pos.z - at.z;
        if (Math.hypot(dx, dz) < 0.3) (dx = fwdX), (dz = fwdZ);
        if (fx.freeze) {
          e.status.root = Math.max(e.status.root, fx.freeze * (boss ? 0.5 : 1));
          e.status.slow = Math.max(e.status.slow, fx.slow);
          e.status.wet = Math.max(e.status.wet, 3);
        }
        if (fx.stun) e.status.stun = Math.max(e.status.stun, fx.stun * (boss ? 0.5 : 1));
        if (b === 'fire') e.status.burn = Math.max(e.status.burn, 3);
        if (fx.lift || fx.shove) g.shoveEnemy(e, dx, dz, fx.shove, fx.lift);
      }
    }
    if (fx.groundSeconds) g.armory.addZone(g, at.x, at.z, fx.groundRadius, fx.groundSeconds, base * 0.3);
    if (fx.mend && this.alive) {
      const got = Math.min(this.maxHp - this.hp, this.maxHp * fx.mend * lightHealMultiplier(this.c));
      this.heal(got);
      if (got >= 1) g.fx.damageNumber(this.center(this.tv2).setY(this.pos.y + 2), `+${Math.round(got)}`, 'heal');
    }
    if (fx.drain && dealt > 0 && this.alive) {
      const got = Math.min(this.maxHp - this.hp, dealt * fx.drain);
      this.heal(got);
      if (got >= 1) g.fx.damageNumber(this.center(this.tv2).setY(this.pos.y + 2), `+${Math.round(got)}`, 'heal');
      g.sfx.beam(up, this.center(this.tv2), color, 0.35);
    }
    // What it looks like.
    const ground = this.tv2.set(at.x, at.y + 0.15, at.z);
    g.sfx.shockwave(ground, spec.radius * (b === 'lightning' ? 0.4 : 1), color, 0.45);
    g.sfx.flash(up, color, 30 + 20 * charge, 16);
    switch (b) {
      case 'fire':
        g.sfx.ring(ground, spec.radius, 0xff5010, 0.6);
        g.sfx.emit(up, { color: 0xff7a1a, count: 40, speed: 5, life: 0.7, size: 0.7, up: 3 });
        break;
      case 'frost':
        g.sfx.spikes(at.x, at.z, 0xbfefff, 9, spec.radius * 0.8);
        g.sfx.emit(up, { color: 0xd8f6ff, count: 40, speed: 5, life: 0.8, size: 0.5, up: 1 });
        break;
      case 'earth':
        g.sfx.spikes(at.x, at.z, 0x9a7a52, 8, spec.radius * 0.75);
        g.sfx.dust(ground, 24, 0x9a8060);
        break;
      case 'wind':
        g.sfx.emit(up, { color: 0xd8fff0, count: 50, speed: 12, life: 0.5, size: 0.6, drag: 2 });
        break;
      case 'light':
        g.sfx.pillar(at.clone(), 0xfff0b0, spec.radius * 0.8);
        break;
      case 'dark':
        g.sfx.emit(up, { color: 0x9a4dff, count: 40, speed: 3.5, life: 0.9, size: 0.6, up: 1.5 });
        break;
      case 'force':
        g.sfx.dust(ground, 20);
        g.sfx.shockwave(ground, spec.radius * 0.6, 0xffffff, 0.3);
        break;
    }
    g.sfx.sound(b === 'lightning' ? 'zap' : b === 'light' ? 'holy' : 'slam', at);
    g.shake(0.25 + 0.2 * charge);
    g.hitStop(0.06);
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

  /** X / 🐟: eats what suits (the biggest heal when badly hurt; mana food at full health). */
  private eat(g: Game) {
    const items = this.c.items;
    if (foodCount(items) <= 0) return g.hud.toast('You have nothing to eat.');
    const id = pickFood(items, (this.hp + this.healing) / this.maxHp, this.soulOrPower ? 1 : this.mana / this.maxMana);
    if (!id) return g.hud.toast("You're not hungry.");
    this.eatItem(g, id);
  }

  /** A fruit asked to replace the current buff (a second tap within a few seconds eats it). */
  private replaceAsk: { id: string; at: number } | null = null;

  /**
   * Eats one of something (X, the satchel or the Gear menu): a bite a second
   * at most, not mid-roll, staggered or in the saddle, and it heals over a
   * moment like a flask (so pausing the game to eat is no quicker than
   * eating in play). Fruit and sweets fill the Fed slot; one that would
   * replace a different fruit's buff needs a second tap (or `sure`).
   */
  eatItem(g: Game, id: string, sure = false): boolean {
    if (!this.alive) return false;
    if (this.blackout > 0 || this.stagger > 0 || this.rollT >= 0) return g.hud.toast('Not now!'), false;
    if (this.riding || this.sailing) return g.hud.toast('Get down first.'), false;
    // The game's clock runs on while the menu is open (the hero's own pauses with it).
    if (g.clock - this.lastBite < EAT_GAP) return g.hud.toast('Still chewing…'), false;
    const fruit = ITEMS[id]?.fed;
    const cur = this.c.fed;
    if (fruit && cur && cur.id !== fruit && (this.c.items[id] ?? 0) > 0 && !sure) {
      const ask = this.replaceAsk;
      if (!ask || ask.id !== id || g.clock - ask.at > 4) {
        this.replaceAsk = { id, at: g.clock };
        g.hud.toast(`Tap again to eat it: ${FRUITS[fruit].name} would replace ${FRUITS[cur.id].name}.`, 'warn');
        return false;
      }
    }
    this.replaceAsk = null;
    const got = eatItem(this.c.items, id, this.c, Math.random());
    if (!got) return g.hud.toast('You have none.'), false;
    this.lastBite = g.clock;
    this.healing += got.heal;
    const mana = this.soulOrPower ? 0 : Math.min(this.maxMana - this.mana, got.mana);
    this.mana += mana;
    const name = ITEMS[id].name.toLowerCase();
    const gains = `${got.heal ? ` (+${got.heal} HP)` : ''}${mana >= 1 ? ` (+${Math.round(mana)} mana)` : ''}`;
    if (got.fed) {
      const f = FRUITS[got.fed.id];
      const what = `${f.short} for ${spanText(this.c.fed?.left ?? got.fed.minutes)}`;
      g.hud.toast(
        got.fed.kind === 'replace' && got.fed.was
          ? `${f.name} replaces ${FRUITS[got.fed.was].name}: ${what}.`
          : got.fed.kind === 'refresh' ? `${f.name} again: ${what}.` : `Fed: ${what}.${gains}`,
        'skill',
      );
      // Friends see the sparkle in the fruit's colour (the buff itself is this hero's alone).
      g.sfx.emit(this.center(), { color: f.color, count: 22, speed: 2.2, life: 0.8, size: 0.28, up: 2.5 });
    } else g.hud.toast(`You eat ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}.${gains}`);
    if (got.pip) {
      const flags = g.state.flags;
      if (!flags['first-pip']) {
        flags['first-pip'] = true;
        g.hud.toast("You kept the pip. Plant it in Wren's field!", 'quest');
      } else g.hud.toast(`+1 ${ITEMS[id].name.toLowerCase()} pip`, 'quest');
    }
    g.audio.play('drink');
    g.updateTouchButtons();
    return true;
  }

  // ---------------------------------------------------------------- spells --

  private castCooldown(key: string, seconds: number) {
    const own = Object.hasOwn(SPELLS, key) ? spellCooldownMultiplier(this.c, key as SpellId) : 1;
    this.cooldowns.set(key, this.now + seconds * cooldownMultiplier(this.c) * own);
  }

  private spellDamage(power: number, element: DamageElement) {
    return power * spellPowerMultiplier(this.c, element) * (1 + 0.06 * (this.c.level - 1)) * (this.surge > 0 ? SURGE.power : 1) * this.empower * fedMul(this.c, 'damage');
  }

  // -------------------------------------------------------------- beams --

  /** A channelled spell starts: it pours out while the button is held. */
  private startChannel(g: Game, spell: SpellId) {
    const free = this.surge > 0 || this.soulOrPower;
    const check = canCast(this.c, spell, { gameMinutes: g.gameMinutes, mana: free ? Infinity : this.mana, inDesert: g.zone === 'desert', soulOrPower: false });
    if (!check.ok) return g.hud.toast(check.reason!, 'warn');
    if (!this.ready(spell)) return g.hud.toast(`${SPELLS[spell].name} is not ready (${this.cooldownLeft(spell).toFixed(0)}s).`);
    this.startAttack('channel', 'channel', 3600);
    this.channel = { spell, target: null, tick: 0, share: 0, flow: 0 };
    // An empowered beam opens with a burst on its foe, then flows on its own a while.
    const eb = this.empowerBurst;
    if (eb) {
      this.channel.flow = 1.5 + 1.5 * eb.charge;
      const t = this.lockTarget ?? g.findTarget(beamRange(this.c), 0.8, false);
      if (t) this.burst(g, eb.kind, t.pos.clone(), eb.charge, this.spellDamage(SPELLS[spell].power * 6, SPELLS[spell].element), t);
    }
    g.sfx.magicCircle(this.pos, this.pathColor(), 1.5, 0.8);
    g.audio.play(SPELLS[spell].school === 'light' ? 'holy' : 'spell');
  }

  private updateChannel(dt: number, g: Game, held: boolean, able: boolean) {
    const ch = this.channel!;
    const a = this.attack;
    const c = this.c;
    ch.flow -= dt;
    if (!able || !(held || ch.flow > 0) || !a || a.kind !== 'channel' || !this.alive || this.swimming || this.sailing) return this.stopChannel();
    const def = SPELLS[ch.spell];
    const range = beamRange(c);
    // Hold on to the foe while it stays in reach; otherwise find the one ahead.
    if (!ch.target || !ch.target.alive || ch.target.pos.distanceTo(this.pos) > range + 2) ch.target = this.lockTarget ?? g.findTarget(range, 0.8, false);
    const t = ch.target;
    if (t) this.yaw = rotateTowards(this.yaw, Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z), dt, 12);
    const color = ch.spell === 'life-drain' ? 0x9a4dff : 0xffe08a;
    const from = this.weaponTip(this.tv2) ?? this.center(this.tv2);
    const to = t ? t.center(this.tv) : this.tv.copy(from).add(BEAM_AHEAD.set(Math.sin(this.yaw) * range * 0.5, 0, Math.cos(this.yaw) * range * 0.5));
    g.fx.beam(from, to, color, ch.spell === 'life-drain' ? 0.1 : 0.14, 0.06);
    ch.share -= dt;
    if (ch.share <= 0) {
      ch.share = 0.12;
      g.sfx.beam(from, to, color, 0.18, false);
    }
    ch.tick -= dt;
    if (ch.tick > 0) return;
    ch.tick += BEAM.tick;
    const free = this.surge > 0 || this.soulOrPower;
    const cost = free ? 0 : spellCost(c, ch.spell);
    if (this.mana < cost) {
      g.hud.toast('Not enough mana.');
      return this.stopChannel();
    }
    this.mana -= cost;
    if (!t) return;
    let dmg = this.spellDamage(def.power, def.element);
    // Dark creatures burn faster under a lance of light.
    if (ch.spell === 'radiant-beam' && t.dark) dmg *= 1.33;
    g.damageEnemy(t, dmg, def.element, { source: 'spell' });
    g.fx.impact(to, color, 0.35);
    if (ch.spell === 'life-drain') {
      this.heal(dmg * drainHeal(c));
      g.fx.emit(to, { color: 0xc08aff, count: 4, speed: 1, life: 0.5, size: 0.35, drift: BEAM_AHEAD.subVectors(from, to).multiplyScalar(2) });
      if (rank(c, 'death-grip')) t.status.slow = Math.max(t.status.slow, 1);
    } else {
      if (rank(c, 'searing-light')) t.status.slow = Math.max(t.status.slow, 1);
      if (rank(c, 'sunfire') && t.dark) t.status.burn = Math.max(t.status.burn, 3);
    }
  }

  private stopChannel() {
    const ch = this.channel;
    if (!ch) return;
    this.channel = null;
    this.empower = 1;
    this.castCooldown(ch.spell, SPELLS[ch.spell].cooldown);
    if (this.attack?.kind === 'channel') this.finishAttack();
  }

  /** Palm Shockwave lands: a cone of force throws foes back. */
  private palmWave(g: Game, power: number, reach: number) {
    if (!this.alive) return;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    for (const e of g.enemies) {
      if (!e.alive || Math.abs(e.pos.y - this.pos.y) > 3 + e.height) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > reach + e.radius || ((dx * fx + dz * fz) / (d || 1) < PALM_WAVE.cos && d > e.radius + 0.5)) continue;
      g.damageEnemy(e, power * (1 - 0.4 * Math.min(1, d / reach)), 'wind', { source: 'spell' });
      g.shoveEnemy(e, dx, dz, PALM_WAVE.shove * (1 - 0.5 * Math.min(1, d / reach)));
    }
    const color = this.chiColor();
    for (let i = 1; i <= 3; i++) {
      const d = (i / 3) * reach * 0.8;
      g.sfx.shockwave(this.tv.set(this.pos.x + fx * d, this.pos.y + 1.0, this.pos.z + fz * d), 0.7 + i * 0.7, color, 0.25 + i * 0.07);
    }
    g.sfx.emit(this.center(this.tv), { color, count: 30, speed: 4, life: 0.5, size: 0.5, drift: this.tv2.set(fx * 14, 0.4, fz * 14) });
    g.sfx.sound('slam', this.pos);
    g.shake(0.2);
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

    // In an Arcane Surge spells cost nothing.
    const free = this.surge > 0;
    const check = canCast(c, spell, free ? { ...ctx, mana: Infinity } : ctx);
    if (!check.ok) return g.hud.toast(check.reason!, 'warn');
    if (free) check.cost = 0;
    // An empowered spell costs half as much again.
    else if (this.empower > 1 && !this.soulOrPower) {
      check.cost = Math.round(check.cost * POWER.spellMana);
      if (this.mana < check.cost) return g.hud.toast('Not enough mana.');
    }
    if (!this.ready(spell)) return g.hud.toast(`${SPELLS[spell].name} is not ready (${this.cooldownLeft(spell).toFixed(0)}s).`);
    const def = SPELLS[spell];
    if (def.channel) return this.startChannel(g, spell);
    const target = this.lockTarget ?? g.findTarget(30, 0.75, false);
    const aim = target ? target.center() : g.aimPoint(30);
    const power = this.spellDamage(def.power, def.element);
    // An empowered attack spell bursts where it lands: with the first thing it looses, or right on its target.
    const eb = this.empowerBurst && def.power > 0 && !SELF_SPELLS.has(spell) ? this.empowerBurst : null;
    if (eb) g.projectileBurst = { kind: eb.kind, charge: eb.charge, base: power };
    // The move that plays (null: the spell starts its own), and whether a rune circle marks it.
    let pose: AttackStyle | null = 'cast';
    let circle = def.school !== 'chi' && def.school !== 'trick';

    switch (spell) {
      // ---- Monk techniques.
      case 'palm-shockwave': {
        pose = null;
        this.startAttack('cast', 'palm', 0.75, { step: 0.6 });
        const reach = palmWaveRange(c);
        this.later.push({ at: this.now + 0.75 * 0.53, run: () => this.palmWave(g, power, reach) });
        break;
      }
      case 'meditate':
        if (!this.grounded || this.swimming || this.sailing) return g.hud.toast('Find your footing first.');
        pose = null;
        this.startAttack('meditate', 'meditate', MEDITATE.seconds + 0.7);
        g.hud.toast('You sit and breathe…', 'skill');
        break;
      case 'iron-skin':
        this.ironSkin = ironSkinSeconds(c);
        pose = 'roar';
        g.sfx.emit(this.center(this.tv), { color: 0xc8a070, count: 36, speed: 2.5, life: 0.7, size: 0.4, up: 1 });
        g.sfx.shockwave(this.tv.set(this.pos.x, this.pos.y + 0.15, this.pos.z), 2.5, 0xc8a070, 0.35);
        g.hud.toast('Iron Skin!', 'skill');
        break;
      case 'cyclone-kick':
        pose = null;
        this.startAttack('cyclone', 'cyclone', CYCLONE.duration, { step: 1.4 });
        if (this.grounded) {
          this.vel.y = 6;
          this.grounded = false;
        }
        break;
      // ---- Dark Mage.
      case 'shadow-bolt': {
        const n = alt ? 3 : 1;
        if (alt && !free && !this.soulOrPower && this.mana < check.cost * 3) return g.hud.toast('Not enough mana.');
        if (alt && !this.soulOrPower) this.mana -= check.cost * 2;
        const from = this.weaponTip(this.tv2)?.clone() ?? this.center().add(this.tv.set(0, 0.4, 0));
        for (let i = 0; i < n; i++) {
          const to = aim.clone();
          if (n > 1) to.sub(from).applyAxisAngle(UP, (i - 1) * 0.14).add(from);
          g.spawnProjectile({ from: from.clone(), to, speed: 44, kind: 'orb', owner: 'player', damage: power, element: 'dark', gravity: 0, source: null, color: 0x9a4dff, slow: rank(c, 'withering') ? 1.5 : 0 });
        }
        break;
      }
      case 'hex':
        if (!target) return g.hud.toast('No target.');
        target.status.hex = hexSeconds(c);
        this.hexed.add(target);
        g.sfx.magicCircle(target.pos, 0x9a4dff, 1.6, 1.2);
        g.sfx.emit(target.center(), { color: 0x9a4dff, count: 30, speed: 1.5, life: 1, up: 1.5 });
        g.sfx.damageNumber(target.center().setY(target.pos.y + target.height + 0.3), 'HEXED', 'info');
        break;
      case 'summon-shade':
        for (let i = 0; i < shadeCount(c); i++) {
          const ally = new Ally('shade', this.pos.x + (i ? -1.3 : 1.3), this.pos.z - 1, c.level, SHADE.seconds, shadeMultiplier(c), shadeMultiplier(c));
          g.addAlly(ally);
          g.sfx.emit(ally.center(), { color: 0x3a2a5a, count: 40, speed: 2.5, life: 1, size: 0.9, up: 1 });
        }
        break;
      // ---- Light Mage.
      case 'smite-undead': {
        if (!target) return g.hud.toast('No target.');
        const smite = (e: Enemy, k: number) => {
          g.damageEnemy(e, power * k * (e.dark ? SMITE.dark : 1), 'light', { source: 'spell' });
          if (!e.dark) return;
          e.status.stun = Math.max(e.status.stun, smiteStun(c));
          if (rank(c, 'sunfire')) e.status.burn = Math.max(e.status.burn, 4);
        };
        smite(target, 1);
        if (rank(c, 'judgement')) for (const e of g.enemies) if (e !== target && e.alive && e.pos.distanceTo(target.pos) < SMITE.radius + e.radius) smite(e, 0.6);
        g.sfx.magicCircle(target.pos, SCHOOL_COLOR.light, rank(c, 'judgement') ? 3 : 2, 1);
        g.sfx.pillar(target.pos.clone(), 0xfff0b0, rank(c, 'judgement') ? 2.6 : 1.6);
        break;
      }
      case 'mending-light': {
        const amount = mendAmount(c, power);
        this.receiveMend(g, amount);
        if (rank(c, 'renewal')) {
          this.renew = amount * 0.3;
          this.renewRate = this.renew / 5;
        }
        const R = lightReach(c);
        for (const al of g.allies) if (al.alive && al.pos.distanceTo(this.pos) < R) al.hp = Math.min(al.maxHp, al.hp + amount);
        g.coop.shareBuff('mend', this.pos, amount, R);
        g.sfx.ring(this.center().setY(this.pos.y + 0.3), R, 0xfff0b0, 0.8);
        break;
      }
      case 'ward-of-dawn': {
        const amount = wardAmount(c, power);
        this.receiveWard(g, amount);
        const R = lightReach(c);
        g.coop.shareBuff('ward', this.pos, amount, R);
        g.sfx.ring(this.center().setY(this.pos.y + 0.3), R, 0xffe8a0, 0.8);
        g.sfx.shockwave(this.center(this.tv), 2.2, 0xfff0b0, 0.5);
        break;
      }
      // ---- Rogue tricks.
      case 'smoke-bomb': {
        pose = null;
        this.startAttack('throw', 'throw', 0.5, { step: 0 });
        const at = g.aimPoint(16);
        const dx = at.x - this.pos.x, dz = at.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        const k = d > 14 ? 14 / d : 1;
        const x = this.pos.x + dx * k, z = this.pos.z + dz * k;
        const r = smokeRadius(c);
        this.later.push({ at: this.now + 0.3, run: () => g.armory.addSmoke(g, x, z, r, SMOKE.seconds) });
        g.audio.play('throw');
        break;
      }
      case 'poison-blades':
        this.poisonBlades = POISON.coat;
        pose = 'parry';
        g.sfx.emit(this.center(this.tv), { color: 0x7cff3a, count: 30, speed: 1.5, life: 0.8, up: 1 });
        g.hud.toast('Your blades drip with poison.', 'skill');
        break;
      case 'shadowstep': {
        const t = this.lockTarget ?? g.findTarget(SHADOWSTEP.range, 0.5, false);
        if (!t || t.pos.distanceTo(this.pos) > SHADOWSTEP.range + t.radius) return g.hud.toast('No foe close enough.');
        pose = null;
        const back = t.radius + 0.9;
        const x = t.pos.x - Math.sin(t.yaw) * back, z = t.pos.z - Math.cos(t.yaw) * back;
        g.sfx.emit(this.center(this.tv), { color: 0x2a2030, count: 30, speed: 2, life: 0.7, size: 0.8, up: 0.6 });
        this.pos.set(x, Math.max(heightAt(x, z), this.pos.y - 3), z);
        g.world.resolve(this.pos, this.radius);
        this.vel.set(0, 0, 0);
        this.yaw = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
        if (rank(c, 'ghost')) this.ghost = SHADOWSTEP.ghost;
        if (rank(c, 'death-mark')) t.status.marked = Math.max(t.status.marked, SHADOWSTEP.mark);
        g.sfx.emit(this.center(this.tv), { color: 0x2a2030, count: 30, speed: 2, life: 0.7, size: 0.8, up: 0.6 });
        g.sfx.sound('roll', this.pos);
        break;
      }
      case 'parry':
        pose = null;
        this.startAttack('parry', 'parry', parryWindow(c) + 0.3);
        this.parryWindow = parryWindow(c);
        break;
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
        this.heal(power * lightHealMultiplier(c));
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
    if (eb && g.projectileBurst) {
      // Nothing was loosed (a strike from the sky, spikes from the ground): it bursts on the target now.
      g.projectileBurst = null;
      const at = target ? target.pos.clone() : aim.clone().setY(heightAt(aim.x, aim.z));
      this.burst(g, eb.kind, at, eb.charge, power, target);
    }
    if (eb) g.hud.toast(`Empowered ${def.name}!`, 'skill');
    if (spell === 'deal-with-the-devil') circle = false;
    else if (pose) this.startAttack('cast', pose, 0.55);
    if (circle) {
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
    if (this.riding) this.dismount(g);
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

  // ---------------------------------------------------------------- horses --

  /** 🐎 / B: get down, climb on a horse that is close, or call it. */
  private horseButton(g: Game) {
    if (this.riding) return this.dismount(g);
    const h = this.horse;
    if (h && h.state !== 'fleeing' && h.pos.distanceTo(this.pos) < HORSE.mountRange) return this.mount(g);
    const why = this.rideBlock(g);
    if (why) return g.hud.toast(why, 'warn');
    if (h) {
      // Already out (even bolting): it turns and comes at a run.
      h.state = 'coming';
      h.t = 0;
      g.audio.play('horn');
      return;
    }
    this.callHorse(g);
  }

  /** What keeps the hero off horseback now (null: nothing). */
  private rideBlock(g: Game): string | null {
    return rideBlock({
      alive: this.alive,
      inTrial: g.inTrial,
      threatened: this.threatened(g),
      sinceHurt: this.now - this.hurtAt,
      swimming: this.swimming,
      flying: this.flying,
      sailing: this.sailing,
      busy: !!this.attack || this.rollT >= 0 || this.stagger > 0 || this.blackout > 0,
    });
  }

  /**
   * A fight: a monster close by is up and hunting. (Any aware one counts: a
   * co-op guest's copies of the host's monsters don't know whom they hunt.)
   */
  private threatened(g: Game): boolean {
    for (const e of g.enemies) {
      if (e.alive && e.aware && e.pos.distanceTo(this.pos) < HORSE.threatRange) return true;
    }
    return false;
  }

  /** A whistle: the horse comes galloping from a little way off (on land). */
  private callHorse(g: Game) {
    if (this.horse) this.sendHorseHome();
    const back = g.camYaw + Math.PI;
    const at = new THREE.Vector3();
    let found = false;
    for (const r of [HORSE.callFrom, HORSE.callFrom * 0.6, 10, 5]) {
      for (let i = 0; i < 12 && !found; i++) {
        const a = back + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.45;
        const x = this.pos.x + Math.sin(a) * r, z = this.pos.z + Math.cos(a) * r;
        if (heightAt(x, z) > WATER_LEVEL + 0.2) (at.set(x, heightAt(x, z), z), (found = true));
      }
      if (found) break;
    }
    if (!found) at.copy(this.pos);
    const rig = buildHorse(this.c.steed.coat);
    this.rig.root.parent?.add(rig.root);
    this.horse = { rig, pos: at, yaw: Math.atan2(this.pos.x - at.x, this.pos.z - at.z), speed: 0, state: 'coming', t: 0 };
    g.audio.play('horn');
    g.hud.toast(`You whistle for ${this.c.steed.name}.`);
  }

  private mount(g: Game) {
    const h = this.horse;
    if (!h) return;
    const why = this.rideBlock(g);
    if (why) return g.hud.toast(why, 'warn');
    this.riding = true;
    this.galloping = false;
    this.crouching = false;
    this.blocking = false;
    this.drawing = 0;
    this.cancelCharge();
    this.stopChannel();
    this.queued = null;
    this.pos.copy(h.pos);
    this.yaw = h.yaw;
    this.vel.set(0, 0, 0);
    h.state = 'waiting';
    g.audio.play('draw');
    g.hud.toast(g.input.touch ? `Riding ${this.c.steed.name}: push the stick far to gallop, 🐎 to get down.` : `Riding ${this.c.steed.name}: Shift to gallop, B to get down.`);
  }

  /** Down from the saddle, beside the horse (it waits there). Thrown, the horse bolts. */
  dismount(g: Game, thrown = false) {
    const h = this.horse;
    if (!this.riding || !h) return;
    this.riding = false;
    this.galloping = false;
    h.pos.copy(this.pos);
    h.yaw = this.yaw;
    h.speed = 0;
    h.state = thrown ? 'fleeing' : 'waiting';
    h.t = 0;
    // Step off to the left (or wherever there is ground).
    const lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw);
    for (const side of [1, -1]) {
      const x = this.pos.x + lx * side * 1.1, z = this.pos.z + lz * side * 1.1;
      if (heightAt(x, z) > WATER_LEVEL - SWIM_DEPTH) {
        this.pos.set(x, Math.max(this.pos.y, heightAt(x, z)), z);
        break;
      }
    }
    this.vel.set(0, 0, 0);
    if (thrown) {
      this.stagger = Math.max(this.stagger, 0.7);
      this.anim.landing = 1;
      g.hud.toast('Thrown from the saddle!', 'warn');
    }
  }

  /** A blow landed: no mounting for a moment, and a rider is thrown. */
  struck(g: Game) {
    this.hurtAt = this.now;
    if (this.riding) this.dismount(g, true);
  }

  /** The prompt by your waiting horse (null: none). */
  horsePrompt(): string | null {
    const h = this.horse;
    if (this.riding || !h || h.state === 'fleeing' || h.pos.distanceTo(this.pos) > HORSE.mountRange) return null;
    return `Ride ${this.c.steed.name}`;
  }

  /** The prompt's action: climb on. */
  mountHorse(g: Game) {
    if (this.horsePrompt()) this.mount(g);
  }

  /** The horse when nobody rides it: coming at a gallop, waiting, or bolting off. */
  private updateHorse(dt: number, g: Game) {
    const h = this.horse!;
    h.t += dt;
    if (this.riding) {
      if (!this.alive) this.dismount(g);
      else if (g.inTrial) {
        this.dismount(g);
        g.hud.toast(`${this.c.steed.name} won't go into the fog.`);
      }
      return;
    }
    const dx = this.pos.x - h.pos.x, dz = this.pos.z - h.pos.z;
    const d = Math.hypot(dx, dz);
    let want = 0;
    if (h.state === 'coming') {
      want = d > 8 ? HORSE.gallop : d > 2.4 ? HORSE.trot * 0.6 : 0;
      h.yaw = rotateTowards(h.yaw, Math.atan2(dx, dz), dt, 5);
      if (d <= 2.4) {
        h.state = 'waiting';
        // Called and arrived: up you get, unless a fight has started.
        if (!this.rideBlock(g)) this.mount(g);
      }
    } else if (h.state === 'fleeing') {
      want = HORSE.gallop;
      h.yaw = rotateTowards(h.yaw, Math.atan2(-dx, -dz), dt, 4);
      if (h.t > 4) return this.sendHorseHome();
    } else if (d > HORSE.leaveRange) return this.sendHorseHome();
    h.speed += (want - h.speed) * Math.min(1, dt * 3);
    h.pos.x += Math.sin(h.yaw) * h.speed * dt;
    h.pos.z += Math.cos(h.yaw) * h.speed * dt;
    h.pos.y = Math.max(heightAt(h.pos.x, h.pos.z), WATER_LEVEL - HORSE.wadeDepth);
  }

  /** The horse wanders home (call it again to bring it back). */
  sendHorseHome() {
    const h = this.horse;
    if (!h) return;
    if (this.riding) this.riding = false;
    h.rig.root.removeFromParent();
    disposeObject(h.rig.root);
    this.horse = null;
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
    // A plain backstep is a hop; a monk's is a backflip (rollKind 2).
    a.rolling = this.backstep && this.rollSpec.kind === 0 ? -1 : this.rollT;
    a.rollKind = this.rollSpec.kind;
    if (this.rollT < 0 && this.airFlip >= 0) {
      a.rolling = this.airFlip;
      a.rollKind = 3;
    }
    a.draw = this.drawing;
    a.fury = this.fury.bloodrageActive ? 1 : 0;
    a.windup = 0;
    a.dead = -1;
    const at = this.attack;
    if (at) {
      a.attack = Math.min(1, at.anim0 + ((1 - at.anim0) * at.t) / at.duration);
      // Held moves run on their own clock: settle into the pose, hold it, and (sitting) get up at the end.
      if (at.kind === 'channel') a.attack = Math.min(0.6, (0.3 * at.t) / 0.18);
      else if (at.kind === 'meditate') {
        const t = at.t, d = at.duration;
        a.attack = t < 0.35 ? (0.3 * t) / 0.35 : t < d - 0.35 ? 0.3 + (0.4 * (t - 0.35)) / (d - 0.7) : Math.min(1, 0.7 + (0.3 * (t - (d - 0.35))) / 0.35);
      }
      a.attackStyle = at.style;
    } else a.attack = -1;
    // Charging a power strike: held in the move's wind-up (a bow just draws).
    const ch = this.charge;
    if (ch && !at && ch.kind !== 'bow') {
      a.attackStyle = ch.style;
      a.windup = Math.min(1, 0.4 + 0.6 * ch.level);
    }
    if (this.rig.wings) {
      const w = this.rig.wings.userData;
      w.enabled = wingsGrown(this.c);
      w.spread = this.flapT > 0 || this.gliding;
      w.soar = this.gliding;
    }
    if (this.sailing) {
      a.moving = 0;
      a.crouching = true;
    }
    // In the saddle: sitting, leaning in with the gallop.
    a.riding = this.riding ? Math.min(1, Math.hypot(this.vel.x, this.vel.z) / HORSE.gallop) : -1;
    if (this.riding) {
      a.moving = 0;
      a.speed = 0;
      a.airborne = false;
      a.crouching = false;
      if (this.horse) a.phase = this.horse.rig.phase;
    }
  }

  syncModel() {
    const r = this.rig.root;
    r.position.copy(this.pos);
    r.rotation.y = this.yaw;
    r.visible = !this.unseen || Math.floor(this.anim.t * 6) % 3 !== 0;
    animateHumanoid(this.rig, this.anim);
    if (this.boat) {
      this.boat.position.set(this.pos.x, WATER_LEVEL + 0.05 + Math.sin(this.anim.t * 2) * 0.06, this.pos.z);
      this.boat.rotation.y = this.yaw;
      r.position.y = WATER_LEVEL + 0.35;
    }
    const h = this.horse;
    if (h) {
      const hr = h.rig.root;
      if (this.riding) {
        h.pos.copy(this.pos);
        h.yaw = this.yaw;
        h.speed = Math.hypot(this.vel.x, this.vel.z);
      }
      hr.position.copy(h.pos);
      hr.rotation.y = h.yaw;
      animateHorse(h.rig, this.horseDt, h.speed, this.anim.t);
      // The rider sits the saddle and rises with the horse's stride.
      if (this.riding) r.position.y = this.pos.y + SEAT + h.rig.bob - RIDER_HIP;
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

/**
 * Puts a weapon in the right hand (a bow, lyre or rune circle in the left)
 * and, for a warrior with a hand free, a shield on the arm.
 */
export function attachGear(rig: Rig, classId: ClassId, weaponId: string, rune?: RuneId): { weapon: THREE.Object3D; shield: THREE.Object3D | null } {
  const w = WEAPONS[weaponId];
  if (w.kind === 'wraps') {
    // Wraps on both fists; the left one rides where a shield would (but is not one).
    const weapon = buildWraps(weaponId, false, rune);
    const left = buildWraps(weaponId, true);
    left.userData.offhand = true;
    rig.handR.add(weapon);
    rig.handL.add(left);
    return { weapon, shield: left };
  }
  const weapon = compact(buildWeapon(w.kind, !!w.legendary, rune));
  if (isOffhand(w.kind)) rig.handL.add(weapon);
  else rig.handR.add(weapon);
  let shield: THREE.Object3D | null = null;
  if (classId === 'warrior' && !isOffhand(w.kind) && !isTwoHanded(w.kind)) {
    shield = buildShield();
    shield.position.set(-0.08, 0, 0.1);
    shield.rotation.y = -Math.PI / 2;
    rig.handL.add(shield);
  }
  weapon.traverse((o) => (o.castShadow = true));
  return { weapon, shield };
}

/** Reaching for a weapon (or a dodge) on horseback hops the hero down first. */
const DISMOUNT_ACTIONS: readonly Action[] = ['attack', 'heavy', 'block', 'cast', 'ability', 'roll'];
const isDismountPress = (input: { pressed: Set<Action> }) => {
  for (const x of DISMOUNT_ACTIONS) if (input.pressed.has(x)) return true;
  return false;
};
/** Reused for each frame's riding step. */
const RIDE_STEP = { stamina: 0, galloping: false };

/** How high a seated rider's hips sit above their feet's rest height (the seat lifts them onto the saddle). */
export const RIDER_HIP = 0.95;

/** The element each rune brings to a team combo. */
const RUNE_ELEMENT: Record<RuneId, ComboElement> = { fire: 'fire', frost: 'water', storm: 'lightning', venom: 'earth' };

/** Spells that mend, shield or summon: empowered, they grow stronger but don't burst. */
const SELF_SPELLS = new Set<SpellId>(['radiant-heal', 'mending-light', 'ward-of-dawn', 'imp-familiar', 'summon-shade', 'power-of-the-light']);

const SPARK = new THREE.Vector3();
const SPARK_DRIFT = new THREE.Vector3();
/** Sparks drawn in toward a hero charging a power strike (more, and bigger, the more it is charged). */
export function chargeSparks(g: Game, at: THREE.Vector3, color: number, level: number) {
  const n = level >= 1 ? 3 : Math.random() < 0.4 + 0.6 * level ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const th = Math.random() * Math.PI * 2, ph = (Math.random() - 0.3) * 1.4, r = 1.3 + Math.random() * 0.5;
    SPARK.set(at.x + Math.cos(th) * Math.cos(ph) * r, at.y + Math.sin(ph) * r, at.z + Math.sin(th) * Math.cos(ph) * r);
    SPARK_DRIFT.subVectors(at, SPARK).multiplyScalar(1 / 0.35);
    g.fx.emit(SPARK, { color, count: 1, speed: 0, life: 0.35, size: 0.25 + 0.35 * level, drift: SPARK_DRIFT });
  }
}

const BEAM_AHEAD = new THREE.Vector3();
const LA = new THREE.Vector3();
const LB = new THREE.Vector3();
const LC = new THREE.Vector3();
/** Streaks behind the fists and feet of unarmed moves (a jab's left fist, a kick's right foot), for any hero. */
export function limbTrail(g: Game, rig: Rig, style: AttackStyle, v: number, color: number) {
  const tm = TIMING[style];
  if (!tm || v < tm.from - 0.04 || v > tm.to) return;
  const L: [THREE.Object3D, THREE.Object3D] = [rig.foreArmL!, rig.handL];
  const R: [THREE.Object3D, THREE.Object3D] = [rig.foreArmR!, rig.handR];
  const limbs = style === 'jab' ? [L] : style === 'cross' ? [R] : style === 'palm' || style === 'flurry' ? [L, R] : style === 'kick' || style === 'cyclone' ? [[rig.shinR!, rig.footR!] as [THREE.Object3D, THREE.Object3D]] : null;
  if (!limbs || !L[0]) return;
  for (const [joint, end] of limbs) {
    end.updateWorldMatrix(true, false);
    joint.getWorldPosition(LA);
    end.getWorldPosition(LB);
    // From partway down the limb to just past the fist (or the toes).
    LC.subVectors(LB, LA);
    g.fx.trailPoint(end, LA.addScaledVector(LC, 0.55), LB.addScaledVector(LC, 0.32), color, 0.8, 0.16);
  }
}

const NOCK = new THREE.Vector3();
const MERCY_SPARKLE = { color: 0xfff0a0, count: 5, speed: 1, life: 0.8, size: 0.15, up: 1.5 };
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

const SKIN: Record<RaceId, number> = {
  human: 0xc89a78, elf: 0xe0c8a8, draco: 0x5a6a4a, ancient: 0x3a3a44, zombie: 0x86967a, angelic: 0xf4e0c6, orc: 0x6c8c48,
};
const GRAVE_DUST = new THREE.Color(0x5e5a4a);
/** A colour faded with grave dust. */
const faded = (hex: number) => new THREE.Color(hex).lerp(GRAVE_DUST, 0.45).getHex();

/** What the hero wears, from the wardrobe. */
export const heroDressed = (c: Pick<Character, 'wardrobe'>): Dressed => (c.wardrobe ? dressedOf(c.wardrobe.outfit) : PLAIN);

/**
 * A hero's model: their class's clothes, their role's colours, the outfit
 * from the wardrobe, then their race (grave dust dulls every dye; wings leave
 * no room for a cloak; an ancient keeps its hood).
 */
export function buildPlayerRig(c: Pick<Character, 'classId' | 'raceId' | 'roleId' | 'hunched'> & { subclassId?: SubclassId | null }, dressed: Dressed = PLAIN): Rig {
  const skin = SKIN[c.raceId];
  const worn = wearable(dressed, c.raceId);
  const look = applyOutfit(baseLook(c.classId, c.subclassId, c.roleId), worn);
  if (c.raceId === 'zombie') {
    look.cloth = faded(look.cloth);
    look.armor = faded(look.armor);
    if (look.cape !== undefined) look.cape = faded(look.cape);
  }
  if (c.raceId === 'angelic') {
    // Gold trim (unless dyed), and the wings take the place of a cape.
    if (worn.trim === null) look.accent = 0xffd36a;
    look.cape = undefined;
  }
  const orc = c.raceId === 'orc';
  // Race cues left undefined stay out of the model's cache key.
  return buildHumanoid({
    skin,
    ...look,
    head: c.raceId === 'ancient' ? 'hood' : look.head,
    ears: c.raceId === 'elf',
    horns: c.raceId === 'draco',
    tail: c.raceId === 'draco',
    wings: c.raceId === 'draco',
    glowEyes: c.raceId === 'ancient' ? 0x40ff80 : c.raceId === 'zombie' ? 0xc8ff52 : undefined,
    hair: c.raceId === 'angelic' ? 0xf2d27a : orc ? 0x1c1814 : undefined,
    tusks: orc || undefined,
    brawn: orc ? 1.14 : undefined,
    scale: orc ? 1.05 : undefined,
    halo: c.raceId === 'angelic' ? 0xffe28a : undefined,
    featherWings: c.raceId === 'angelic' ? 0xfaf6ee : undefined,
    stitches: c.raceId === 'zombie' || undefined,
    hunch: c.raceId === 'zombie' && c.hunched !== false ? 0.36 : undefined,
    // A hero in their own clothes shares the cached model; a custom outfit is built (and freed) on its own.
  }, isPlain(worn));
}
