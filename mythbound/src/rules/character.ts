import {
  CLASSES,
  MAGE_STARTING_SPELLS,
  SPELLS,
  SUBCLASSES,
  TAMEABLE,
  WEAPONS,
  type ClassId,
  type CreatureKind,
  type Element,
  type RaceId,
  type RelicId,
  type RoleId,
  type SpellId,
  type SubclassId,
  type TreeId,
  type WeaponInstance,
} from '../data/defs';

export const MAX_LEVEL = 20;
/** Real seconds per game minute: one game hour is one real minute. */
export const GAME_MINUTES_PER_SECOND = 1;

export interface CharacterChoice {
  name: string;
  classId: ClassId;
  subclassId: SubclassId | null;
  raceId: RaceId;
  roleId: RoleId;
  expansion: boolean;
  /** Elemental wizards pick theirs. */
  wizardElement?: Element;
}

export interface Character extends CharacterChoice {
  level: number;
  xp: number;
  skillPoints: number;
  skills: Record<string, number>;
  /** Elves are born to one element at random. */
  elfElement: Element | null;
  /** The 33% elf secret. Hidden until it shows itself. */
  elfMystery: boolean;
  mysteryRevealed: boolean;
  /** Max HP lost forever to Soul or Power. */
  hpLost: number;
  gold: number;
  flasks: number;
  flasksMax: number;
  weapons: WeaponInstance[];
  /** Index into weapons. */
  mainHand: number;
  arrows: { wood: number; steel: number };
  knownSpells: SpellId[];
  /** Up to four spells on the quick bar. */
  spellSlots: (SpellId | null)[];
  devilDeals: number;
  /** Game minute until which light magic is sealed. Infinity is forever. */
  lightSealedUntil: number;
  /** Game minute when Power of the Light can be cast again. */
  lightPowerReadyAt: number;
  tamed: CreatureKind[];
  items: Record<string, number>;
}

/** Deterministic randomness is injected so creation can be tested. */
export type Rng = () => number;

const ELEMENTS: Element[] = ['earth', 'fire', 'water', 'wind'];

export function subclassesFor(classId: ClassId, expansion: boolean): SubclassId[] {
  return Object.values(SUBCLASSES)
    .filter((s) => s.classId === classId && (expansion || !s.expansion))
    .map((s) => s.id);
}

export function validateChoice(choice: CharacterChoice, ancientUnlocked: boolean): string | null {
  const subs = subclassesFor(choice.classId, choice.expansion);
  if (subs.length > 0 && !choice.subclassId) return 'Pick a subclass.';
  if (choice.subclassId && !subs.includes(choice.subclassId)) return 'That subclass is not available.';
  if (choice.raceId === 'ancient' && !ancientUnlocked) return 'That race is… not yet known.';
  if (choice.subclassId === 'elemental' && !choice.wizardElement) return 'Pick your element.';
  if (!choice.name.trim()) return 'Name your hero.';
  return null;
}

export function createCharacter(choice: CharacterChoice, rng: Rng = Math.random): Character {
  const weapons: WeaponInstance[] = [];
  const arrows = { wood: 0, steel: 0 };
  switch (choice.subclassId ?? choice.classId) {
    case 'swordsman':
      weapons.push({ id: 'iron-sword', level: 2 });
      break;
    case 'axeman':
      weapons.push({ id: 'iron-axe', level: 2 });
      break;
    case 'bowman':
      weapons.push({ id: 'copper-bow', level: 2 });
      arrows.steel = 50;
      break;
    case 'warrior':
      weapons.push({ id: 'iron-sword', level: 1 });
      break;
    case 'ranger':
    case 'trainer':
      weapons.push({ id: 'hunting-bow', level: 1 });
      break;
    case 'mage':
    case 'elemental':
      weapons.push({ id: 'oak-staff', level: 1 });
      break;
  }
  if (weapons.some((w) => WEAPONS[w.id].kind === 'bow')) arrows.wood += 40;
  if (choice.raceId === 'elf') {
    // Elves start at bow level 3: rangers swap their bow for it, others carry it.
    const bow = weapons.findIndex((w) => WEAPONS[w.id].kind === 'bow');
    if (bow >= 0 && weapons[bow].level < 3) weapons[bow] = { id: weapons[bow].id === 'copper-bow' ? 'copper-bow' : 'elven-bow', level: 3 };
    else if (bow < 0) weapons.push({ id: 'elven-bow', level: 3 });
    if (arrows.wood === 0) arrows.wood = 30;
  }
  if (choice.roleId === 'assassin') weapons.push({ id: 'shadow-dagger', level: 1 });
  if (choice.classId === 'ranger' || choice.subclassId === 'bowman') {
    // A melee backup for when they close in.
    if (!weapons.some((w) => WEAPONS[w.id].kind === 'dagger')) weapons.push({ id: 'shadow-dagger', level: 1 });
  }

  const elfElement = choice.raceId === 'elf' ? ELEMENTS[Math.min(3, Math.floor(rng() * 4))] : null;
  const elfMystery = choice.raceId === 'elf' && rng() < 1 / 3;

  const c: Character = {
    ...choice,
    level: 1,
    xp: 0,
    skillPoints: 1,
    skills: {},
    elfElement,
    elfMystery,
    mysteryRevealed: false,
    hpLost: 0,
    gold: 50,
    flasks: 3,
    flasksMax: 3,
    weapons,
    mainHand: 0,
    arrows,
    knownSpells: [],
    spellSlots: [null, null, null, null],
    devilDeals: 0,
    lightSealedUntil: 0,
    lightPowerReadyAt: 0,
    tamed: [],
    items: {},
  };
  for (const s of startingSpells(c)) learnSpell(c, s);
  return c;
}

export function startingSpells(c: Pick<Character, 'classId' | 'raceId' | 'roleId'>): SpellId[] {
  const spells: SpellId[] = [];
  if (c.classId === 'mage') spells.push(...MAGE_STARTING_SPELLS);
  if (c.classId === 'ranger') spells.push('wrath-of-thor', 'way-of-the-wind');
  if (c.raceId === 'elf') spells.push('deal-with-the-devil', 'imp-familiar');
  if (c.roleId === 'knight') spells.push('holy-smite', 'radiant-heal', 'aegis-of-light');
  return [...new Set(spells)];
}

export function learnSpell(c: Character, spell: SpellId): boolean {
  if (c.knownSpells.includes(spell)) return false;
  c.knownSpells.push(spell);
  const free = c.spellSlots.indexOf(null);
  if (free >= 0) c.spellSlots[free] = spell;
  return true;
}

/**
 * Whether this hero's class/race/role lets them learn a spell at all. Rangers
 * are limited to sky magic (plus Imp magic if they are elves); warriors cast
 * only what their race or role grants; mages can learn everything.
 */
export function canLearnSpell(c: Pick<Character, 'classId' | 'raceId' | 'roleId'>, spell: SpellId): boolean {
  const school = SPELLS[spell].school;
  if (c.classId === 'mage') return true;
  if (school === 'light' && c.roleId === 'knight' && spell !== 'power-of-the-light') return true;
  if (school === 'devil' && c.raceId === 'elf') return true;
  if (c.classId === 'ranger') return school === 'sky';
  return false;
}

export function treeFor(c: Pick<Character, 'classId' | 'subclassId'>): TreeId {
  switch (c.subclassId) {
    case 'swordsman':
    case 'axeman':
    case 'bowman':
    case 'trainer':
    case 'elemental':
      return c.subclassId;
  }
  if (c.classId === 'warrior') return 'swordsman';
  return c.classId === 'ranger' ? 'ranger' : 'mage';
}

export const rank = (c: Character, node: string) => c.skills[node] ?? 0;

/** Relics from the elder foes live in the pack and work as long as they are carried. */
export const hasRelic = (c: Pick<Character, 'items'>, id: RelicId) => (c.items[id] ?? 0) > 0;

// ------------------------------------------------------------------ stats --

export function maxHp(c: Character): number {
  const perLevel = c.classId === 'warrior' ? 12 : c.classId === 'ranger' ? 9 : 7;
  const base = CLASSES[c.classId].hp + perLevel * (c.level - 1) + (hasRelic(c, 'dragon-heart') ? 30 : 0);
  return Math.max(1, base - c.hpLost);
}

export function maxMana(c: Character): number {
  const perLevel = c.classId === 'mage' ? 8 : c.classId === 'ranger' ? 4 : 2;
  let m = CLASSES[c.classId].mana + perLevel * (c.level - 1);
  if (c.roleId === 'knight') m += 10;
  if (c.raceId === 'ancient') m += 15;
  if (hasRelic(c, 'tide-crown')) m += 20;
  m += 10 * rank(c, 'deep-well');
  if (c.raceId === 'elf') m *= 1.2;
  return Math.round(m);
}

/** Sailors, and whoever carries the Leviathan's pearl, swim without tiring. */
export function swimsTireless(c: Character): boolean {
  return c.roleId === 'sailor' || hasRelic(c, 'leviathan-pearl');
}

export function maxStamina(c: Character): number {
  return 100 + (c.raceId === 'elf' ? 20 : 0) + (c.classId === 'warrior' ? 10 : 0) + 2 * (c.level - 1);
}

export function moveSpeed(c: Character): number {
  let s = 7;
  if (c.raceId === 'elf') s *= 1.15;
  s *= 1 + 0.06 * rank(c, 'fleet-foot');
  return s;
}

export function manaRegen(c: Character): number {
  const base = c.classId === 'mage' ? 2.2 : c.classId === 'ranger' ? 1.3 : 0.8;
  return base * (1 + 0.3 * rank(c, 'flow')) * (hasRelic(c, 'tide-crown') ? 1.3 : 1);
}

/** Quick Draw: rangers draw every weapon faster. Multiplies draw/ready times. */
export function drawTimeMultiplier(c: Character): number {
  return c.classId === 'ranger' ? 0.5 : 1;
}

export function xpToNext(level: number): number {
  return Math.round(60 * Math.pow(level, 1.55));
}

/** Adds experience; returns how many levels were gained. */
export function addXp(c: Character, amount: number): number {
  if (c.roleId === 'historian') amount *= 1.15;
  c.xp += Math.round(amount);
  let gained = 0;
  while (c.level < MAX_LEVEL && c.xp >= xpToNext(c.level)) {
    c.xp -= xpToNext(c.level);
    c.level++;
    c.skillPoints++;
    gained++;
  }
  if (c.level >= MAX_LEVEL) c.xp = 0;
  return gained;
}

// ------------------------------------------------------------------ races --

/** Draco take damage in water at exactly level 5, "but not after and before". */
export function dracoWaterDamagePerSecond(c: Character): number {
  return c.raceId === 'draco' && c.level === 5 ? 6 : 0;
}

/** Hours of flight the Draco's wings sustain: 1 at level 6, +1 per level after. */
export function dracoFlightHours(c: Character): number {
  return c.raceId === 'draco' && c.level >= 6 ? c.level - 5 : 0;
}

export function dracoFireRegen(c: Character): number {
  return c.raceId === 'draco' && c.level >= 10 ? 10 : 0;
}

export function tameableKinds(c: Character): CreatureKind[] {
  if (c.subclassId !== 'trainer') return [];
  return TAMEABLE.filter((t) => c.level >= t.level).map((t) => t.kind);
}

export function maxTamed(c: Character): number {
  return c.subclassId === 'trainer' ? 1 + rank(c, 'second-beast') : 0;
}

/** Upgrade cost at the anvil. Blacksmiths pay half. */
export function upgradeCost(c: Character, weapon: WeaponInstance): { gold: number; ore: number } {
  const legendary = !!WEAPONS[weapon.id].legendary;
  let gold = Math.round(40 * Math.pow(weapon.level, 1.4) * (legendary ? 2 : 1));
  let ore = weapon.level >= 3 ? weapon.level - 2 : 0;
  if (c.roleId === 'blacksmith') {
    gold = Math.round(gold / 2);
    ore = Math.floor(ore / 2);
  }
  return { gold, ore };
}

export const MAX_WEAPON_LEVEL = 10;

export function weaponDamage(w: WeaponInstance): number {
  return WEAPONS[w.id].damage + 4 * (w.level - 1);
}
