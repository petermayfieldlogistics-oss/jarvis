// Rules for the Monk, the Sorcerer and the Rogue: their R abilities,
// techniques and tricks, movement, backstabs and poison. The numbers live
// here so the engine (player.ts) only has to play them out.

import { WEAPONS, type SpellId } from '../data/defs';
import { rank, type Character } from './character';
import { family } from './weapons';

const has = (c: Pick<Character, 'skills'>, id: string) => (c.skills[id] ?? 0) > 0;

// ------------------------------------------------------------------ monk --

/** Flurry of Blows (the monk's R): eight punches on the foe in front. */
export const FLURRY = { stamina: 22, cooldown: 9, duration: 1.15, reach: 2.4, power: 0.62, dash: 8 };

/** Each punch's share of the weapon's damage. */
export function flurryPower(c: Character): number {
  return FLURRY.power * (1 + 0.12 * rank(c, 'stone-fists')) * (has(c, 'grandmaster') ? 1.3 : 1) * (c.subclassId === 'ironfist' ? 1.2 : 1);
}

/** Hundred Fists: every punch lands twice. */
export const flurryBlows = (c: Character) => (has(c, 'hundred-fists') ? 2 : 1);

/** Chi (mana) each landed blow gives a monk back. */
export const chiOnHit = (c: Character) => (c.classId === 'monk' ? 2 + rank(c, 'chi-flow') : 0);

/** A palm strike's damage multiplier (the unarmed heavy). */
export function palmPower(c: Character, targetStunned: boolean): number {
  return 1.9 * (1 + 0.15 * rank(c, 'hard-palm')) * (c.subclassId === 'ironfist' ? 1.2 : 1) * (targetStunned && has(c, 'shattering-blow') ? 2 : 1);
}

/** How far a palm strike or Palm Shockwave throws a foe (m/s of shove). */
export const PALM_SHOVE = 9;

/** Palm Shockwave: a cone of force in front. */
export const PALM_WAVE = { range: 8, cos: 0.55, shove: 14 };
export const palmWaveRange = (c: Character) => PALM_WAVE.range * (1 + 0.25 * rank(c, 'quaking-palm'));

/** Meditate: seconds of sitting, health (share of max) and chi a second. */
export const MEDITATE = { seconds: 4, heal: 0.09, chi: 8 };
export const meditateHeal = (c: Character) => MEDITATE.heal * (has(c, 'deep-breath') ? 1.3 : 1);

/** Iron Skin: damage taken is multiplied by `taken`, and nothing knocks the monk down. */
export const IRON_SKIN = { seconds: 8, taken: 0.6 };
export const ironSkinSeconds = (c: Character) => IRON_SKIN.seconds + (has(c, 'unstoppable') ? 4 : 0);

/** Cyclone Kick: a leaping spin kick that throws foes up. */
export const CYCLONE = { radius: 3.6, lift: 7, duration: 0.9 };
export const cyclonePower = (c: Character) => 1 + 0.2 * rank(c, 'cyclone');

/** A monk's roll is a dash, its backstep a backflip; a rogue's roll is quick and safe. */
export interface RollSpec {
  time: number;
  dist: number;
  /** Invulnerable from iFrom to iTo seconds into it. */
  iFrom: number;
  iTo: number;
  /** Stamina it costs. */
  cost: number;
  /** 0 roll, 1 dash, 2 backflip (see AnimState.rollKind). */
  kind: number;
  /** Upward speed at the start (a hop). */
  hop: number;
}

export const ROLL: RollSpec = { time: 0.6, dist: 3.9, iFrom: 0.08, iTo: 0.4, cost: 18, kind: 0, hop: 0 };
export const BACKSTEP: RollSpec = { time: 0.42, dist: 2.3, iFrom: 0.05, iTo: 0.26, cost: 12, kind: 0, hop: 3.2 };

/** The dodge a hero makes: a roll (or, standing still, a backstep). */
export function rollSpec(c: Character, backstep: boolean): RollSpec {
  const tumble = 1 - 0.25 * rank(c, 'tumble');
  if (c.classId === 'monk') {
    if (backstep) return { time: 0.5, dist: 3.2, iFrom: 0.02, iTo: 0.36, cost: 12 * tumble, kind: 2, hop: 6 };
    return { time: 0.34, dist: 5.2 * (1 + 0.2 * rank(c, 'gale-step')), iFrom: 0.02, iTo: 0.28, cost: 16 * tumble * (has(c, 'avatar-of-wind') ? 0.5 : 1), kind: 1, hop: 0 };
  }
  if (c.classId === 'rogue') {
    // Evasive: quicker, a little farther, safer for longer, and cheaper.
    if (backstep) return { ...BACKSTEP, iTo: 0.32, cost: 9 * tumble };
    return { time: 0.5, dist: 4.4, iFrom: 0.04, iTo: 0.42, cost: 13.5 * tumble, kind: 0, hop: 0 };
  }
  return backstep ? { ...BACKSTEP, cost: BACKSTEP.cost * tumble } : { ...ROLL, cost: ROLL.cost * tumble };
}

/** What dodging a blow (rolling, dashing or flipping through it) gives back: stamina and chi. */
export function dodgeReward(c: Character): { stamina: number; mana: number } {
  return { stamina: 10 * (rank(c, 'eye-of-the-storm') + rank(c, 'slippery')), mana: 3 * rank(c, 'eye-of-the-storm') };
}

/** Light attacks come faster with Swift Strikes (monk) and En Garde (duelist): their duration is multiplied by this. */
export const lightAttackSpeed = (c: Character) => 1 - 0.08 * rank(c, 'swift-strikes') - 0.06 * rank(c, 'en-garde');

/** Combo finishers: damage, and how long they stun (Pressure Points). */
export const finisherPower = (c: Character) => 1 + 0.2 * rank(c, 'flourish');
export const finisherStun = (c: Character, boss: boolean) => 0.6 * rank(c, 'pressure-points') * (boss ? 0.5 : 1);

// -------------------------------------------------------------- sorcerer --

/** Arcane Surge (the sorcerer's R): spells cost nothing and hit harder for a while. */
export const SURGE = { seconds: 8, cooldown: 50, power: 1.25 };
export const surgeSeconds = (c: Character) => SURGE.seconds + (has(c, 'surge-mastery') ? 4 : 0);
export const surgeCooldown = (c: Character) => SURGE.cooldown * (has(c, 'surge-mastery') ? 0.8 : 1);

/** Raw Power: every sorcerer spell hits this much harder. */
export const RAW_POWER = 1.2;

/** A channelled beam: it ticks this often (seconds), reaching this far. */
export const BEAM = { tick: 0.25, range: 24 };
export const beamRange = (c: Character) => BEAM.range * (has(c, 'overflow') ? 1.3 : 1);
/** Mana a beam costs each tick. */
export const beamCost = (c: Character, mana: number) => mana * (1 - 0.15 * rank(c, 'channeler'));

/** Life Drain gives back this share of the damage it deals. */
export const drainHeal = (c: Character) => 0.5 * (1 + 0.2 * rank(c, 'hunger'));

/** A sorcerer's wand bolts and rune traps (Wandcraft), and what they cost. */
export const wandcraft = (c: Character) => 1 + 0.2 * rank(c, 'wandcraft');
export const focusDiscount = (c: Character) => (c.classId === 'sorcerer' ? 0.7 : 1);

/** Hex: the cursed take more and deal less. */
export const HEX = { seconds: 12, taken: 1.25, dealt: 0.75, leap: 12 };
export const hexSeconds = (c: Character) => HEX.seconds + (has(c, 'hexer') ? 5 : 0);
/** Foes a hex leaps to when its bearer dies. */
export const hexLeaps = (c: Character) => (has(c, 'plague-hex') ? 2 : 1);

/** Summoned shades: how many, how long, how strong. */
export const SHADE = { seconds: 25 };
export const shadeCount = (c: Character) => (has(c, 'second-shade') ? 2 : 1);
export const shadeMultiplier = (c: Character) => 1 + 0.3 * rank(c, 'shade-lord');

/** Smite Undead: more against the dark, and a stun. */
export const SMITE = { dark: 1.5, stun: 1.5, radius: 3 };
export const smiteStun = (c: Character) => SMITE.stun + (has(c, 'judgement') ? 1 : 0);

/** Mending Light and Ward of Dawn reach friends this far (m). */
export const lightReach = (c: Character) => 12 * (has(c, 'beacon') ? 1.5 : 1);
export const mendAmount = (c: Character, power: number) => power * (1 + 0.15 * rank(c, 'gentle-hands')) * (has(c, 'saint') ? 1.2 : 1);
export const WARD = { seconds: 10, mend: 0.02 };
export const wardAmount = (c: Character, power: number) => power * (1 + 0.25 * rank(c, 'dawn-ward')) * (has(c, 'saint') ? 1.2 : 1);

/** Spell cost and power by the sorcerer's path (their school). */
export function pathPower(c: Character, element: string): number {
  if (c.subclassId === 'darkmage' && element === 'dark') return (1 + 0.1 * rank(c, 'umbral-power')) * (has(c, 'lord-of-shadows') ? 1.15 : 1);
  if (c.subclassId === 'lightmage' && element === 'light') return 1 + 0.1 * rank(c, 'radiance');
  return 1;
}

// ----------------------------------------------------------------- rogue --

/** Vanish (the rogue's R): unseen for a while; the next strike is an ambush. */
export const VANISH = { seconds: 6, cooldown: 30 };
export const vanishSeconds = (c: Character) => VANISH.seconds + (c.subclassId === 'shadow' ? 2 : 0) + 2 * rank(c, 'shadow-veil') + (has(c, 'master-thief') ? 3 : 0);
export const vanishCooldown = (c: Character) => VANISH.cooldown * (has(c, 'escape-artist') ? 0.75 : 1);

/** An ambush (the first strike out of Vanish, or on an unaware foe) multiplies a rogue's blow by this. */
export function ambushPower(c: Character): number {
  return (c.subclassId === 'shadow' ? 2.5 : 2) * (1 + 0.2 * rank(c, 'night-blade')) * (has(c, 'living-shadow') ? 1.25 : 1);
}

/** Assassinate: an ambush on a foe this badly hurt kills it outright. */
export const ASSASSINATE = 0.4;

/**
 * A rogue's backstab: from stealth, triple damage (an assassin's four times);
 * from behind an aware foe, +50%. Lethality adds to the bonus.
 */
export function backstabMultiplier(c: Character, undetected: boolean, fromBehind: boolean): number {
  let m = 1;
  if (undetected) m = c.roleId === 'assassin' && fromBehind ? 4 : 3;
  else if (fromBehind) m = 1.5;
  if (m > 1) m = 1 + (m - 1) * (1 + 0.2 * rank(c, 'lethality'));
  return m;
}

/** Daggers and knives in a rogue's hands. */
export function rogueBladePower(c: Character, weaponId: string | undefined): number {
  const def = weaponId ? WEAPONS[weaponId] : undefined;
  if (c.classId !== 'rogue' || !def || family(def.kind) !== 'dagger') return 1;
  return 1.15 * (1 + 0.1 * rank(c, 'sharp-knives')) * (has(c, 'master-thief') ? 1.15 : 1);
}

/** How noticeable a rogue is: quiet feet, more so crouched. */
export function rogueStealth(c: Character, crouching: boolean): number {
  if (c.classId !== 'rogue') return 1;
  let f = 0.85 / (1 + 0.25 * rank(c, 'soft-steps'));
  if (crouching) f *= has(c, 'living-shadow') ? 0.35 : 0.75;
  return f;
}

/** Smoke Bomb: a cloud foes are lost in. */
export const SMOKE = { seconds: 6, radius: 4 };
export const smokeRadius = (c: Character) => SMOKE.radius * (1 + 0.3 * rank(c, 'thick-smoke'));

/** Poison Blades: how long the coating lasts, how long each poisoning lasts, and its stacks. */
export const POISON = { coat: 20, seconds: 5, stacks: 3 };
/** Extra poison damage a second per stack (on top of the poison status). */
export const toxinDps = (c: Character) => (1.5 + 0.35 * c.level) * (1 + 0.25 * rank(c, 'venomous'));

/** Shadowstep: how far, and how its cooldown shrinks with Blink. */
export const SHADOWSTEP = { range: 16, ghost: 2, mark: 6 };
export const blinkCooldown = (c: Character) => 1 - 0.2 * rank(c, 'blink');

/** Parry: the window to catch a blow (seconds) and the riposte's damage multiplier. */
export const PARRY = { window: 0.45, riposte: 3 };
export const parryWindow = (c: Character) => PARRY.window * (has(c, 'perfect-parry') ? 1.5 : 1);
export const riposteMultiplier = (c: Character) => (has(c, 'riposte-master') ? 4 : PARRY.riposte);
/** Virtuoso halves Parry's cooldown. */
export const parryCooldown = (c: Character) => (has(c, 'virtuoso') ? 0.5 : 1);

/** Cheap Shot (stunned or poisoned foes) and Coup de Grâce (bleeding foes). */
export function opportunistPower(c: Character, stunned: boolean, poisoned: boolean, bleeding: boolean): number {
  return (stunned || poisoned ? 1 + 0.15 * rank(c, 'cheap-shot') : 1) * (bleeding ? 1 + 0.15 * rank(c, 'coup-de-grace') : 1);
}

/** Cutpurse: foes drop this many more embers. */
export const emberBonus = (c: Character) => 1 + 0.15 * rank(c, 'cutpurse');

// --------------------------------------------------------------- spells --

/** Spells whose cooldown a subclass talent shortens (Shadowstep with Blink, Parry with Virtuoso, Meditate with Deep Breath). */
export function spellCooldownMultiplier(c: Character, spell: SpellId): number {
  if (spell === 'shadowstep') return blinkCooldown(c);
  if (spell === 'parry') return parryCooldown(c);
  if (spell === 'meditate') return has(c, 'deep-breath') ? 0.7 : 1;
  return 1;
}
