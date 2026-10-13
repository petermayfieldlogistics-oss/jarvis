// Power strikes: hold heavy to charge a blow that bursts with the weapon's
// element (or its rune). Bows charge an elemental arrow; mages and sorcerers
// charge an empowered spell. Pure rules: the engine (player.ts) plays them out.

import { WEAPONS, type DamageElement, type RuneId, type SpellId, SPELLS, type WeaponKind } from '../data/defs';
import type { Character } from './character';

/** The bursts a power strike can make. Force: a plain shockwave (a weapon with no element). */
export type Burst = 'fire' | 'frost' | 'lightning' | 'earth' | 'wind' | 'light' | 'dark' | 'force';
export const BURSTS: Burst[] = ['fire', 'frost', 'lightning', 'earth', 'wind', 'light', 'dark', 'force'];

/** Charge timing (seconds of holding heavy), what it costs, and how long until the next. */
export const POWER = {
  /** Held this long, a heavy press becomes a charge (a quick tap is still a plain heavy). */
  start: 0.25,
  /** Fully charged after this long. */
  full: 1.25,
  /** Stamina a melee power strike costs (on top of the heavy), a charged arrow, and the drain while charging. */
  stamina: 22,
  arrowStamina: 12,
  drain: 5,
  /** An empowered spell costs this much more mana. */
  spellMana: 1.5,
  cooldown: 6,
};

/** 0..1 how charged a power strike is after holding heavy for `held` seconds. */
export function chargeLevel(held: number): number {
  if (held < POWER.start) return 0;
  return Math.min(1, (held - POWER.start) / (POWER.full - POWER.start));
}

/** The strike's own damage multiplier (on top of a heavy blow's): 1.5x barely charged, 2.5x full. */
export const strikePower = (charge: number) => 1.5 + charge;

/** An empowered spell's power multiplier. */
export const empowerPower = (charge: number) => 1.3 + 0.7 * charge;

/**
 * Whether a spell can be empowered: one that deals damage or mends. Pacts,
 * wards and tricks (Deal with the Devil, Soul or Power, Power of the Light…)
 * stay as they are.
 */
export const canEmpower = (spell: SpellId | null | undefined): spell is SpellId => !!spell && SPELLS[spell].power > 0;

/**
 * How a hero charges with this weapon: a blow, an arrow, a spell, or not at
 * all (instruments, or a wand with no spell it can empower).
 */
export function chargeKind(c: Pick<Character, 'classId'>, kind: WeaponKind, spell: SpellId | null | undefined): 'melee' | 'bow' | 'spell' | 'thrown' | null {
  if (kind === 'lyre' || kind === 'horn') return null;
  if (kind === 'bow') return 'bow';
  const empowered = canEmpower(spell);
  // Mages and sorcerers pour it into their selected spell.
  if ((c.classId === 'mage' || c.classId === 'sorcerer') && empowered) return 'spell';
  if (kind === 'knives' || kind === 'bolt') return 'thrown';
  if (kind === 'wand' || kind === 'runecircle') return empowered ? 'spell' : null;
  return 'melee';
}

const FROM_ELEMENT: Partial<Record<DamageElement, Burst>> = {
  fire: 'fire', water: 'frost', lightning: 'lightning', earth: 'earth', wind: 'wind', light: 'light', dark: 'dark',
};
const FROM_RUNE: Record<RuneId, Burst> = { fire: 'fire', frost: 'frost', storm: 'lightning', venom: 'earth' };

/**
 * A hero's own element, for a weapon that has none: an Elemental Wizard's or
 * an elf's element, a monk's wind, a Dark or Light Mage's path, the races
 * that carry fire, light or thunder in them, a Knight's light.
 */
export function heroBurst(c: Pick<Character, 'classId' | 'subclassId' | 'raceId' | 'roleId' | 'wizardElement' | 'elfElement'>): Burst {
  if (c.subclassId === 'elemental' && c.wizardElement) return FROM_ELEMENT[c.wizardElement]!;
  if (c.subclassId === 'darkmage') return 'dark';
  if (c.subclassId === 'lightmage' || c.roleId === 'knight' || c.raceId === 'angelic') return 'light';
  if (c.classId === 'monk') return 'wind';
  if (c.raceId === 'elf' && c.elfElement) return FROM_ELEMENT[c.elfElement]!;
  if (c.raceId === 'draco') return 'fire';
  if (c.raceId === 'ancient') return 'lightning';
  return 'force';
}

/** What a power strike bursts with: the rune on the weapon, else its element, else the hero's own. */
export function burstFor(c: Parameters<typeof heroBurst>[0], weaponId: string, rune?: RuneId): Burst {
  if (rune) return FROM_RUNE[rune];
  const def = WEAPONS[weaponId];
  return (def && FROM_ELEMENT[def.element]) ?? heroBurst(c);
}

/** What an empowered spell bursts with: its own element (a spell of no element, the hero's). */
export function spellBurst(c: Parameters<typeof heroBurst>[0], spell: SpellId): Burst {
  return FROM_ELEMENT[SPELLS[spell].element] ?? heroBurst(c);
}

/** The element a burst deals its damage in. */
export const BURST_ELEMENT: Record<Burst, DamageElement> = {
  fire: 'fire', frost: 'water', lightning: 'lightning', earth: 'earth', wind: 'wind', light: 'light', dark: 'dark', force: 'physical',
};

/** Each burst's colour (charge-up glow, trails and the burst itself). */
export const BURST_COLOR: Record<Burst, number> = {
  fire: 0xff6a1a, frost: 0x9ae8ff, lightning: 0xb8c8ff, earth: 0xc8a060, wind: 0xc8ffe4, light: 0xffe28a, dark: 0x9a4dff, force: 0xfff0d0,
};

export interface BurstSpec {
  /** Reach of the burst around where it lands (m). */
  radius: number;
  /** Its damage to every foe it reaches, as a share of the strike's own base damage. */
  share: number;
}

/**
 * What each burst does where it lands (the engine applies the effects):
 * fire leaves burning ground; frost freezes (roots) and slows; lightning
 * leaps to foes nearby and stuns; earth throws foes up; wind hurls them back;
 * light smites (twice as hard on the dark) and mends the striker; dark
 * drains life back to the striker; force is a staggering shockwave.
 */
export const BURST: Record<Burst, BurstSpec> = {
  fire: { radius: 3.5, share: 0.6 },
  frost: { radius: 3.5, share: 0.55 },
  lightning: { radius: 9, share: 0.5 },
  earth: { radius: 4, share: 0.5 },
  wind: { radius: 5, share: 0.4 },
  light: { radius: 3, share: 0.6 },
  dark: { radius: 3.5, share: 0.6 },
  force: { radius: 3.5, share: 0.5 },
};

/** The burst's damage scales with the charge too. */
export const burstScale = (charge: number) => 0.6 + 0.4 * charge;

/** Numbers for the effects of a burst at a charge (0..1). */
export function burstEffects(b: Burst, charge: number) {
  return {
    /** Burning ground: seconds it lasts and its radius. */
    groundSeconds: b === 'fire' ? 4 + 2 * charge : 0,
    groundRadius: 3,
    /** Frost: rooted (frozen) then slowed. */
    freeze: b === 'frost' ? 1.2 + 1.3 * charge : 0,
    slow: b === 'frost' ? 4 : 0,
    /** Lightning: foes it leaps to, and how long each is stunned. */
    chains: b === 'lightning' ? 3 + Math.round(2 * charge) : 0,
    stun: b === 'lightning' ? 1 : b === 'force' ? 0.6 : 0,
    /** Earth throws up, wind (and force, a little) hurls back. */
    lift: b === 'earth' ? 6 + 4 * charge : 0,
    shove: b === 'wind' ? 14 + 8 * charge : b === 'earth' ? 3 : b === 'force' ? 5 : 0,
    /** Light mends the striker (share of max HP); dark drains (share of the damage it dealt). */
    mend: b === 'light' ? 0.04 + 0.04 * charge : 0,
    drain: b === 'dark' ? 0.4 : 0,
  };
}
