import { CLASSES, SPELLS, WEAPONS, COMBOS, type DamageElement, type LegendaryId, type SpellId, type ComboDef, type Element } from '../data/defs';
import { ANGELIC, hasRelic, ORC, ZOMBIE, rank, type Character } from './character';
import { ambushPower, backstabMultiplier, finisherPower, IRON_SKIN, opportunistPower, pathPower, RAW_POWER, rogueBladePower } from './classes';
import { KIND_NAME, WAND, classWields, family, isMartial } from './weapons';

// -------------------------------------------------------- warrior fury --

/** BloodRage costs, lasts and recharges (seconds). */
export const BLOODRAGE = { mana: 12, duration: 20, cooldown: 40 };
/** BloodRage lasts longer with Battle Trance. */
export const bloodrageDuration = (c: Character) => BLOODRAGE.duration + 5 * rank(c, 'battle-trance');
/** Stacking would otherwise be unbounded; 12 stacks is already 4x damage. */
export const MAX_FURY_STACKS = 12;

export interface FuryState {
  /** Consecutive landed hits. */
  stacks: number;
  bloodrageActive: boolean;
}

export const newFury = (): FuryState => ({ stacks: 0, bloodrageActive: false });

/** The warrior's 25% buff stacks only with the Sword of Mars or in BloodRage. */
export function furyStacks(c: Character, fury: FuryState): boolean {
  if (c.classId !== 'warrior') return false;
  return fury.bloodrageActive || WEAPONS[c.weapons[c.mainHand]?.id]?.legendary === 'sword-of-mars';
}

/** Warrior melee multiplier for the hit about to land. */
export function warriorMeleeMultiplier(c: Character, fury: FuryState): number {
  if (c.classId !== 'warrior') return 1;
  if (!furyStacks(c, fury)) return 1.25;
  // This hit counts as one more stack: the first hit is +25%, the second +50%…
  return 1 + 0.25 * Math.min(MAX_FURY_STACKS, fury.stacks + 1);
}

export function onMeleeLanded(c: Character, fury: FuryState): void {
  if (furyStacks(c, fury)) fury.stacks = Math.min(MAX_FURY_STACKS, fury.stacks + 1);
}

/** A swing that hits nothing resets the stacks. */
export function onMeleeMissed(fury: FuryState): void {
  fury.stacks = 0;
}

/** Level 4+ warriors in BloodRage gain Bloodsteal. */
export function hasBloodsteal(c: Character, fury: FuryState): boolean {
  return c.classId === 'warrior' && c.subclassId !== 'bowman' && fury.bloodrageActive && c.level >= 4;
}

/** Bowmen trade BloodRage for Power Shot. */
export function hasBloodrage(c: Character): boolean {
  return c.classId === 'warrior' && c.subclassId !== 'bowman';
}

// ------------------------------------------------------------ power shot --

export function powerShot(c: Character): { multiplier: number; splashFraction: number; radius: number } | null {
  if (c.subclassId !== 'bowman') return null;
  const radius = (3 + 0.75 * c.level) * (rank(c, 'deadeye') ? 1.5 : 1);
  return { multiplier: rank(c, 'killshot') ? 8 : 6, splashFraction: 0.5, radius };
}

// ---------------------------------------------------------- legendaries --

export interface WieldCheck {
  ok: boolean;
  /** Wieldable, but not at full power. */
  partial?: boolean;
  reason?: string;
}

export function canWield(c: Character, weaponId: string): WieldCheck {
  const def = WEAPONS[weaponId];
  if (def?.classes && !def.classes.includes(c.classId)) {
    return { ok: false, reason: `Only a ${def.classes.map((k) => CLASSES[k].name).join(' or ')} can wield the ${def.name}.` };
  }
  // The newer classes keep to their own weapons (a legendary chooses for itself).
  if (def && !def.legendary && !classWields(c.classId, def.kind)) {
    return { ok: false, reason: `A ${CLASSES[c.classId].name} does not fight with ${KIND_NAME[def.kind].endsWith('s') ? '' : 'a '}${KIND_NAME[def.kind]}.` };
  }
  const legendary = WEAPONS[weaponId]?.legendary as LegendaryId | undefined;
  switch (legendary) {
    case undefined:
      return { ok: true };
    case 'sword-of-mars':
      return c.classId === 'warrior' ? { ok: true } : { ok: false, reason: 'Only a Warrior can lift the Sword of Mars.' };
    case 'bow-of-artemis':
      if (c.classId !== 'ranger') return { ok: false, reason: 'The Bow of Artemis answers only to Rangers.' };
      return c.raceId === 'elf' ? { ok: true } : { ok: true, partial: true, reason: 'Only an Elf ranger unlocks its full power.' };
    case 'master-bolt':
      return c.classId === 'ranger' ? { ok: true } : { ok: true, partial: true, reason: 'Only a Ranger can use the Master Bolt properly. It bites back.' };
    case 'staff-of-hecate':
      return c.classId === 'mage' ? { ok: true } : { ok: false, reason: 'Only a Mage can wield the Staff of Hecate.' };
    case 'hammer-of-hephaestus':
      return c.roleId === 'blacksmith' ? { ok: true } : { ok: false, reason: 'Only a Blacksmith can wield the Hammer of Hephaestus.' };
    case 'trident-of-poseidon':
      return c.roleId === 'sailor' ? { ok: true } : { ok: false, reason: "Only a Sailor can wield Poseidon's Trident." };
  }
}

export const mainWeapon = (c: Character) => c.weapons[c.mainHand];
export const legendaryEquipped = (c: Character, id: LegendaryId) => WEAPONS[mainWeapon(c)?.id]?.legendary === id;

// --------------------------------------------------------------- damage --

export interface HitContext {
  /** Base damage before multipliers. */
  base: number;
  kind: 'melee' | 'bow' | 'spell' | 'thrown';
  element: DamageElement;
  targetDark: boolean;
  /** The target has not noticed the hero. */
  undetected: boolean;
  /** The hero is behind the target. */
  fromBehind: boolean;
  /** Warrior fury state, for melee hits. */
  fury?: FuryState;
  /** Ranger bow draw, 0-1. */
  draw?: number;
  /** The hero's and the target's health, 0-1 (Last Stand, Executioner). */
  heroHp?: number;
  targetHp?: number;
  /** An orc's War Cry is still ringing. */
  warCry?: boolean;
  /** The foe's state (Cheap Shot, Coup de Grâce). */
  targetStunned?: boolean;
  targetPoisoned?: boolean;
  targetBleeding?: boolean;
  /** A rogue's first strike out of Vanish. */
  ambush?: boolean;
  /** A combo's last swing. */
  finisher?: boolean;
}

export interface HitResult {
  amount: number;
  tags: string[];
}

export function outgoingDamage(c: Character, hit: HitContext): HitResult {
  let dmg = hit.base;
  const tags: string[] = [];
  const weapon = WEAPONS[mainWeapon(c)?.id];

  if (hit.kind === 'melee') {
    if (hit.fury) {
      const m = warriorMeleeMultiplier(c, hit.fury);
      dmg *= m;
      if (m > 1.25) tags.push(`x${m.toFixed(2)}`);
    }
    const fam = weapon && family(weapon.kind);
    if (fam === 'sword') dmg *= 1 + 0.1 * rank(c, 'keen-edge');
    if (fam === 'axe') dmg *= 1 + 0.12 * rank(c, 'heavy-hand');
    if (rank(c, 'blade-master')) dmg *= 1.15;
    if (rank(c, 'berserker')) dmg *= 1.15;
    if (weapon && isMartial(weapon.kind)) dmg *= 1 + 0.1 * rank(c, 'open-palm');
    if (rank(c, 'grandmaster') || rank(c, 'virtuoso')) dmg *= 1.15;
    if (hit.finisher) dmg *= finisherPower(c);
    if (c.raceId === 'orc') dmg *= ORC.melee;
  }
  if (hit.kind === 'melee' || hit.kind === 'thrown') {
    dmg *= rogueBladePower(c, mainWeapon(c)?.id);
    dmg *= opportunistPower(c, !!hit.targetStunned, !!hit.targetPoisoned, !!hit.targetBleeding);
  }
  if (hit.kind === 'bow') {
    if (c.classId === 'ranger') dmg *= 1.3;
    dmg *= 1 + 0.1 * (rank(c, 'fletcher') + rank(c, 'steady-aim'));
    dmg *= 0.35 + 0.65 * (hit.draw ?? 1);
    if ((hit.draw ?? 1) >= 0.999) dmg *= 1 + 0.12 * rank(c, 'eagle-eye');
    if (legendaryEquipped(c, 'bow-of-artemis') && c.raceId === 'elf') dmg *= 1.5;
  }
  if (hit.kind === 'thrown' && legendaryEquipped(c, 'master-bolt') && c.classId !== 'ranger') {
    dmg *= 0.5;
  }
  if (hit.kind === 'spell') {
    dmg *= spellPowerMultiplier(c, hit.element);
  } else if (hit.element === 'light' && c.raceId === 'angelic') {
    // Spells get this through spellPowerMultiplier; arrows of light here.
    dmg *= ANGELIC.lightPower;
  }
  if (hit.warCry && hit.kind !== 'spell') {
    dmg *= ORC.warCry.damage;
    tags.push('warcry');
  }
  if (hit.undetected) dmg *= 1 + 0.15 * rank(c, 'ambusher');
  if (hit.targetHp !== undefined && hit.targetHp < 0.3) dmg *= 1 + 0.15 * rank(c, 'executioner');
  if (hit.kind !== 'spell' && hit.heroHp !== undefined && hit.heroHp < 0.3 && rank(c, 'last-stand')) dmg *= 1.25;
  if (hit.targetDark && c.roleId === 'darkslayer') {
    dmg *= 1.5;
    tags.push('slayer');
  }
  if (hit.targetDark && hit.element === 'light') dmg *= 2;
  if (c.classId === 'rogue' && (hit.kind === 'melee' || hit.kind === 'thrown')) {
    // A rogue's backstab (from behind, or unseen), and an ambush out of Vanish.
    const m = backstabMultiplier(c, hit.undetected, hit.fromBehind);
    if (m > 1) {
      dmg *= m;
      tags.push('backstab');
    }
    if (hit.ambush) {
      dmg *= ambushPower(c);
      tags.push('ambush');
    }
  } else if (hit.undetected && hit.fromBehind && c.roleId === 'assassin' && hit.kind === 'melee') {
    dmg *= 4;
    tags.push('backstab');
  } else if (hit.undetected && hit.kind === 'melee') {
    dmg *= 1.5;
    tags.push('sneak');
  }
  return { amount: Math.max(1, Math.round(dmg)), tags };
}

export function spellPowerMultiplier(c: Character, element: DamageElement): number {
  let m = (1 + 0.1 * rank(c, 'focus')) * (1 + 0.08 * rank(c, 'arcane-mastery'));
  if (rank(c, 'archmage')) m *= 1.15;
  if (c.raceId === 'elf') m *= 1.2;
  if (c.raceId === 'elf' && c.elfElement === element) m *= 1.25;
  if (c.subclassId === 'elemental' && c.wizardElement === element) m *= (1.5 + 0.1 * rank(c, 'attunement')) * (rank(c, 'elemental-avatar') ? 1.2 : 1);
  if (legendaryEquipped(c, 'staff-of-hecate')) m *= 1.4;
  if (WEAPONS[mainWeapon(c)?.id]?.kind === 'wand') m *= WAND.spellPower;
  if (c.classId === 'ranger' && (element === 'lightning' || element === 'wind') && rank(c, 'storm-caller')) m *= 1.2;
  if (c.raceId === 'angelic' && element === 'light') m *= ANGELIC.lightPower;
  if (c.raceId === 'orc') m *= ORC.spellPower;
  if (c.classId === 'sorcerer') m *= RAW_POWER * pathPower(c, element) * (rank(c, 'overflow') ? 1.15 : 1);
  return m;
}

export interface IncomingContext {
  blocking: boolean;
  stoneSkin: boolean;
  invulnerable: boolean;
  /** A monk's Iron Skin. */
  ironSkin?: boolean;
}

/** Damage the hero actually takes. */
export function incomingDamage(c: Character, amount: number, element: DamageElement, ctx: IncomingContext): number {
  if (ctx.invulnerable) return 0;
  // A warrior's shield blocks all damage.
  if (ctx.blocking && c.classId === 'warrior') return 0;
  let dmg = amount;
  // A guard lets 40% through (a monk's Iron Guard turns more aside).
  if (ctx.blocking) dmg *= Math.max(0.1, 0.4 - 0.15 * rank(c, 'iron-guard'));
  if (element === 'fire' && c.raceId === 'draco') dmg *= 0.5;
  if (element === 'fire' && c.raceId === 'zombie') dmg *= ZOMBIE.fireTaken;
  if (element === 'dark' && c.raceId === 'angelic') dmg *= ANGELIC.darkTaken;
  if (element === 'fire' && hasRelic(c, 'dragon-heart')) dmg *= 0.5;
  if (element === 'water' && hasRelic(c, 'tide-crown')) dmg *= 0.5;
  if (c.raceId === 'elf' && c.elfElement === element) dmg *= 0.5;
  if (c.subclassId === 'elemental' && c.wizardElement === element) dmg *= rank(c, 'elemental-ward') ? 0 : 0.5;
  if (ctx.stoneSkin) dmg *= 0.5;
  if (ctx.ironSkin) dmg *= IRON_SKIN.taken;
  dmg *= (1 - 0.08 * rank(c, 'stalwart')) * (1 - 0.07 * rank(c, 'arcane-ward'));
  dmg *= (1 - 0.07 * rank(c, 'diamond-soul')) * (1 - 0.08 * (rank(c, 'mountain-stance') + rank(c, 'dancer'))) * (1 - 0.06 * (rank(c, 'shadow-shroud') + rank(c, 'sanctified')));
  return Math.round(dmg);
}

/** Bleeding can't touch a warrior with Bloodsteal, or a zombie (no blood to lose). */
export function immuneToBleed(c: Character, fury: FuryState): boolean {
  return c.raceId === 'zombie' || hasBloodsteal(c, fury);
}

export function bleedChance(c: Character): number {
  const weapon = WEAPONS[mainWeapon(c)?.id];
  if (!weapon) return 0;
  const fam = family(weapon.kind);
  if (fam === 'axe') return 0.25 + 0.15 * rank(c, 'rend') + 0.25 * rank(c, 'berserker');
  if (fam === 'sword' || fam === 'dagger' || fam === 'spear') return 0.12 + 0.1 * rank(c, 'bleeding-edge');
  // Tiger claws rake.
  if (weapon.id === 'tiger-claws') return 0.2;
  return 0;
}

// --------------------------------------------------------------- spells --

export interface CastContext {
  /** Current game time in minutes. */
  gameMinutes: number;
  mana: number;
  inDesert: boolean;
  soulOrPower: boolean;
}

export interface CastCheck {
  ok: boolean;
  reason?: string;
  cost: number;
}

export function spellCost(c: Character, spell: SpellId): number {
  const def = SPELLS[spell];
  let cost = def.mana;
  if (c.subclassId === 'elemental' && c.wizardElement === def.element) cost *= rank(c, 'elemental-avatar') ? 0.75 * 0.85 : 0.75;
  cost *= 1 - 0.08 * rank(c, 'spell-thrift');
  if (def.school === 'sky') cost *= 1 - 0.15 * rank(c, 'thunderhead');
  if (def.school === 'shadow' && rank(c, 'lord-of-shadows')) cost *= 0.8;
  if (def.school === 'light' && rank(c, 'saint')) cost *= 0.8;
  if (def.channel) cost *= 1 - 0.15 * rank(c, 'channeler');
  if (legendaryEquipped(c, 'staff-of-hecate')) cost *= 0.7;
  return def.channel ? Math.max(1, Math.round(cost * 10) / 10) : Math.round(cost);
}

export const isLightSealed = (c: Character, gameMinutes: number) => gameMinutes < c.lightSealedUntil;

export function canCast(c: Character, spell: SpellId, ctx: CastContext): CastCheck {
  const def = SPELLS[spell];
  const cost = spellCost(c, spell);
  if (!c.knownSpells.includes(spell)) return { ok: false, reason: 'You do not know that spell.', cost };
  if (def.school === 'light' && isLightSealed(c, ctx.gameMinutes)) {
    return {
      ok: false,
      cost,
      reason: c.lightSealedUntil === Infinity ? 'The Devil owns your light. Forever.' : 'Your light is sealed by the Devil.',
    };
  }
  if (spell === 'waterspike' && ctx.inDesert) return { ok: false, reason: 'There is no water in the desert to bend.', cost };
  if (spell === 'power-of-the-light' && ctx.gameMinutes < c.lightPowerReadyAt) {
    return { ok: false, reason: 'The light has not returned yet.', cost };
  }
  if (spell === 'soul-or-power') {
    if (ctx.soulOrPower) return { ok: false, reason: 'Your soul is already bargained.', cost: 0 };
    if (ctx.mana > 15) return { ok: false, reason: 'Only at 15 mana or less.', cost: 0 };
    return { ok: true, cost: 0 };
  }
  if (!ctx.soulOrPower && ctx.mana < cost) return { ok: false, reason: 'Not enough mana.', cost };
  return { ok: true, cost: ctx.soulOrPower ? 0 : cost };
}

/**
 * Records a Deal with the Devil. Light magic is sealed for 1, 2, then 3 hours;
 * the 4th deal seals it forever. Returns the hours sealed (Infinity = forever).
 */
export function strikeDevilDeal(c: Character, gameMinutes: number): number {
  c.devilDeals++;
  const hours = c.devilDeals >= 4 ? Infinity : c.devilDeals;
  c.lightSealedUntil = hours === Infinity ? Infinity : Math.max(c.lightSealedUntil, gameMinutes + hours * 60);
  return hours;
}

/** Ring version of Deal with the Devil: only level 1–5 foes. */
export const devilRingAffects = (enemyLevel: number) => enemyLevel >= 1 && enemyLevel <= 5;

export function castPowerOfTheLight(c: Character, gameMinutes: number): void {
  c.lightPowerReadyAt = gameMinutes + 60;
}

/** Blade of Retribution: everything the target has dealt, 1.5x. */
export const retribution = (targetDamageDealt: number) => Math.round(targetDamageDealt * 1.5);

/** Soul or Power: damage taken while bargained is lost from max HP forever. */
export function soulOrPowerToll(c: Character, damageTaken: number): void {
  c.hpLost += damageTaken;
}

export const canCombine = (c: Character) => c.classId === 'mage' && c.level >= 3;

export function comboFor(a: SpellId, b: SpellId): ComboDef | null {
  return COMBOS.find((k) => (k.spells[0] === a && k.spells[1] === b) || (k.spells[0] === b && k.spells[1] === a)) ?? null;
}

export function comboCost(c: Character, combo: ComboDef): number {
  const sum = spellCost(c, combo.spells[0]) + spellCost(c, combo.spells[1]);
  return Math.round(sum * 0.8 * (rank(c, 'harmony') ? 0.8 : 1));
}

export function comboPower(combo: ComboDef): number {
  const sum = SPELLS[combo.spells[0]].power + SPELLS[combo.spells[1]].power;
  return Math.max(30, sum) * 1.3;
}

export function cooldownMultiplier(c: Character): number {
  return (1 - 0.15 * rank(c, 'quickening')) * (rank(c, 'archmage') ? 0.9 : 1);
}

/** Elemental weaknesses that the Historian can read off a foe. */
export function elementWeakness(element: Element | 'dark' | 'none'): DamageElement | null {
  switch (element) {
    case 'fire':
      return 'water';
    case 'water':
      return 'lightning';
    case 'earth':
      return 'wind';
    case 'wind':
      return 'fire';
    case 'dark':
      return 'light';
    default:
      return null;
  }
}
