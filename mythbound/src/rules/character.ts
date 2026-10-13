import { MAX_KNIVES, classWields } from './weapons';
import { newSteed, normalizeSteed, type Steed } from './horse';
import { newWardrobe, normalizeWardrobe, type Wardrobe } from './outfit';
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

/** Content tops out around level 13; the levels past it are a long road for those who keep playing. */
export const MAX_LEVEL = 30;
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
  /** Zombies may shamble (the default) or stand upright. */
  hunched?: boolean;
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
  /** Zombie: Not Dead Yet has saved them since they last rested. */
  riseSpent: boolean;
  gold: number;
  flasks: number;
  flasksMax: number;
  weapons: WeaponInstance[];
  /** Index into weapons. */
  mainHand: number;
  arrows: { wood: number; steel: number };
  /** Throwing knives in the bandolier. */
  knives: number;
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
  /** The last milestone level (every 5) whose bonus skill point was given. */
  milestone: number;
  /** Skill resets so far (the first is free). */
  respecs: number;
  /** The hero's horse (called with B or 🐎). */
  steed: Steed;
  /** Clothes and dye colours (for looks only), and what is worn. */
  wardrobe: Wardrobe;
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
  let knives = 0;
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
    case 'ironfist':
      weapons.push({ id: 'iron-knuckles', level: 2 });
      break;
    case 'windwalker':
      weapons.push({ id: 'ash-quarterstaff', level: 2 }, { id: 'linen-wraps', level: 1 });
      break;
    case 'monk':
      weapons.push({ id: 'linen-wraps', level: 1 });
      break;
    case 'darkmage':
    case 'lightmage':
    case 'sorcerer':
      weapons.push({ id: 'willow-wand', level: 1 });
      break;
    case 'shadow':
      weapons.push({ id: 'shadow-dagger', level: 2 }, { id: 'throwing-knives', level: 1 });
      knives = MAX_KNIVES;
      break;
    case 'duelist':
      weapons.push({ id: 'duelist-saber', level: 2 }, { id: 'shadow-dagger', level: 1 });
      break;
    case 'rogue':
      weapons.push({ id: 'shadow-dagger', level: 1 });
      break;
  }
  if (weapons.some((w) => WEAPONS[w.id].kind === 'bow')) arrows.wood += 40;
  if (choice.raceId === 'elf' && classWields(choice.classId, 'bow')) {
    // Elves start at bow level 3: rangers swap their bow for it, others carry it (if their class can draw one).
    const bow = weapons.findIndex((w) => WEAPONS[w.id].kind === 'bow');
    if (bow >= 0 && weapons[bow].level < 3) weapons[bow] = { id: weapons[bow].id === 'copper-bow' ? 'copper-bow' : 'elven-bow', level: 3 };
    else if (bow < 0) weapons.push({ id: 'elven-bow', level: 3 });
    if (arrows.wood === 0) arrows.wood = 30;
  }
  if (choice.roleId === 'assassin' && !weapons.some((w) => w.id === 'shadow-dagger') && classWields(choice.classId, 'dagger')) weapons.push({ id: 'shadow-dagger', level: 1 });
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
    riseSpent: false,
    gold: 50,
    flasks: 3,
    flasksMax: 3,
    weapons,
    mainHand: 0,
    arrows,
    knives,
    knownSpells: [],
    spellSlots: [null, null, null, null],
    devilDeals: 0,
    lightSealedUntil: 0,
    lightPowerReadyAt: 0,
    tamed: [],
    items: {},
    milestone: 0,
    respecs: 0,
    steed: newSteed(rng),
    wardrobe: newWardrobe(),
  };
  for (const s of startingSpells(c)) learnSpell(c, s);
  return c;
}

export function startingSpells(c: Pick<Character, 'classId' | 'raceId' | 'roleId'> & Partial<Pick<Character, 'subclassId'>>): SpellId[] {
  const spells: SpellId[] = [];
  if (c.classId === 'mage') spells.push(...MAGE_STARTING_SPELLS);
  if (c.classId === 'ranger') spells.push('wrath-of-thor', 'way-of-the-wind');
  // The newer classes know their own arts from the start, their subclass's first.
  if (c.classId === 'monk') spells.push('palm-shockwave', 'meditate', c.subclassId === 'windwalker' ? 'cyclone-kick' : 'iron-skin');
  if (c.subclassId === 'darkmage') spells.push('shadow-bolt', 'life-drain', 'hex', 'summon-shade');
  if (c.subclassId === 'lightmage') spells.push('radiant-beam', 'smite-undead', 'mending-light', 'ward-of-dawn');
  if (c.classId === 'rogue') spells.push('smoke-bomb', 'poison-blades', c.subclassId === 'duelist' ? 'parry' : 'shadowstep');
  if (c.raceId === 'elf') spells.push('deal-with-the-devil', 'imp-familiar');
  if (c.roleId === 'knight') spells.push('holy-smite', 'radiant-heal', 'aegis-of-light');
  if (c.raceId === 'angelic') spells.push('holy-smite');
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
export function canLearnSpell(c: Pick<Character, 'classId' | 'raceId' | 'roleId'> & Partial<Pick<Character, 'subclassId'>>, spell: SpellId): boolean {
  const school = SPELLS[spell].school;
  // Each class's own arts are its alone.
  if (school === 'chi') return c.classId === 'monk';
  if (school === 'trick') return c.classId === 'rogue';
  if (school === 'shadow') return c.subclassId === 'darkmage';
  if (c.classId === 'sorcerer') {
    // Arcane tomes, and the path's own school (a Light Mage's is light).
    if (school === 'arcane') return true;
    if (school === 'light' && c.subclassId === 'lightmage') return true;
  }
  if (SORCERER_LIGHT.has(spell)) return c.subclassId === 'lightmage';
  if (c.classId === 'mage') return true;
  if (school === 'light' && (c.roleId === 'knight' || c.raceId === 'angelic') && spell !== 'power-of-the-light') return true;
  if (school === 'devil' && c.raceId === 'elf') return true;
  if (c.classId === 'ranger') return school === 'sky';
  return false;
}

/** The Light Mage's own spells (light school, but no tome teaches them to anyone else). */
const SORCERER_LIGHT = new Set<SpellId>(['radiant-beam', 'smite-undead', 'mending-light', 'ward-of-dawn']);

/** The classes that learn from a class tree and their subclass's tree. */
export const isNewClass = (classId: ClassId) => classId === 'monk' || classId === 'sorcerer' || classId === 'rogue';

/** The hero's first (for the older classes, only) skill tree. */
export function treeFor(c: Pick<Character, 'classId' | 'subclassId'>): TreeId {
  return treesFor(c)[0];
}

/**
 * Every tree the hero learns from: one for the older classes; a class tree
 * and the subclass's tree for the Monk, the Sorcerer and the Rogue.
 */
export function treesFor(c: Pick<Character, 'classId' | 'subclassId'>): TreeId[] {
  switch (c.subclassId) {
    case 'swordsman':
    case 'axeman':
    case 'bowman':
    case 'trainer':
    case 'elemental':
      return [c.subclassId];
  }
  if (isNewClass(c.classId)) {
    const own = c.classId as 'monk' | 'sorcerer' | 'rogue';
    return c.subclassId ? [own, c.subclassId as TreeId] : [own];
  }
  if (c.classId === 'warrior') return ['swordsman'];
  return [c.classId === 'ranger' ? 'ranger' : 'mage'];
}

export const rank = (c: Character, node: string) => c.skills[node] ?? 0;

// ------------------------------------------------------------- milestones --

export interface Milestone {
  level: number;
  name: string;
  text: string;
}

/** Every 5 levels: a bonus skill point and one of these perks, for good. */
export const MILESTONES: Milestone[] = [
  { level: 5, name: 'Second Wind', text: 'Stamina recovers 20% faster.' },
  { level: 10, name: 'Hardened', text: '+10% max health.' },
  { level: 15, name: 'Reaper', text: 'Kills restore 50% more health, mana and stamina.' },
  { level: 20, name: 'Deep Reserves', text: '+15% max mana and stamina.' },
  { level: 25, name: 'Fleet of Foot', text: '+6% movement speed.' },
  { level: 30, name: 'Mythbound', text: '+10% max health and mana.' },
];

const perk = (c: Pick<Character, 'level'>, level: number) => (c.level >= level ? 1 : 0);

/** Skill points a hero of this level has earned in all: one to start, one a level, one more every 5 levels. */
export function pointsEarned(level: number): number {
  const l = Math.min(MAX_LEVEL, Math.max(1, level));
  return l + Math.floor(l / 5);
}

/** Fills in what older saves lack, and pays the milestone points for levels reached before milestones existed. */
export function normalizeCharacter(c: Character): Character {
  if (typeof c.milestone !== 'number') {
    const reached = Math.floor(Math.min(c.level, MAX_LEVEL) / 5);
    c.skillPoints += reached;
    c.milestone = reached * 5;
  }
  if (typeof c.respecs !== 'number') c.respecs = 0;
  c.steed = normalizeSteed(c.steed);
  c.wardrobe = normalizeWardrobe(c.wardrobe);
  return c;
}

/** Relics from the elder foes live in the pack and work as long as they are carried. */
export const hasRelic = (c: Pick<Character, 'items'>, id: RelicId) => (c.items[id] ?? 0) > 0;

// ------------------------------------------------------------------ stats --

/** Per level: health, mana, and the class's extra stamina and speed. */
const GROWTH: Record<ClassId, { hp: number; mana: number; stamina: number; speed: number; manaRegen: number }> = {
  warrior: { hp: 12, mana: 2, stamina: 10, speed: 1, manaRegen: 0.8 },
  ranger: { hp: 9, mana: 4, stamina: 0, speed: 1, manaRegen: 1.3 },
  mage: { hp: 7, mana: 8, stamina: 0, speed: 1, manaRegen: 2.2 },
  monk: { hp: 10, mana: 3, stamina: 20, speed: 1.08, manaRegen: 1.0 },
  sorcerer: { hp: 7, mana: 9, stamina: 0, speed: 1, manaRegen: 2.4 },
  rogue: { hp: 9, mana: 3, stamina: 15, speed: 1.05, manaRegen: 1.0 },
};

/** A level 1 human of this class (no role bonuses): the numbers its creator card shows. */
export function classStats(classId: ClassId): { hp: number; mana: number; stamina: number; speed: number } {
  const c = createCharacter({ name: '-', classId, subclassId: subclassesFor(classId, false)[0] ?? null, raceId: 'human', roleId: 'historian', expansion: false }, () => 0.5);
  return { hp: maxHp(c), mana: maxMana(c), stamina: maxStamina(c), speed: moveSpeed(c) };
}

export function maxHp(c: Character): number {
  const perLevel = GROWTH[c.classId].hp;
  let base = CLASSES[c.classId].hp + perLevel * (c.level - 1) + (hasRelic(c, 'dragon-heart') ? 30 : 0);
  base += 15 * rank(c, 'iron-hide') + 12 * rank(c, 'hardy') + 14 * rank(c, 'tempered-body') + 20 * rank(c, 'iron-will');
  base *= 1 + 0.1 * perk(c, 10) + 0.1 * perk(c, 30);
  if (c.raceId === 'orc') base *= ORC.hp;
  return Math.max(1, Math.round(base - c.hpLost));
}

export function maxMana(c: Character): number {
  const perLevel = GROWTH[c.classId].mana;
  let m = CLASSES[c.classId].mana + perLevel * (c.level - 1);
  if (c.roleId === 'knight') m += 10;
  if (c.raceId === 'ancient') m += 15;
  if (hasRelic(c, 'tide-crown')) m += 20;
  m += 10 * rank(c, 'deep-well');
  if (c.raceId === 'elf') m *= 1.2;
  m *= 1 + 0.15 * perk(c, 20) + 0.1 * perk(c, 30);
  return Math.round(m);
}

/** Sailors, and whoever carries the Leviathan's pearl, swim without tiring. */
export function swimsTireless(c: Character): boolean {
  return c.roleId === 'sailor' || hasRelic(c, 'leviathan-pearl');
}

export function maxStamina(c: Character): number {
  const s = 100 + (c.raceId === 'elf' ? 20 : 0) + GROWTH[c.classId].stamina + 2 * (c.level - 1) + 15 * rank(c, 'trail-runner');
  return Math.round(s * (1 + 0.15 * perk(c, 20)));
}

/** Stamina recovered per second while not spending it. */
export function staminaRegen(c: Character): number {
  return 38 * (1 + 0.2 * perk(c, 5)) * (rank(c, 'windrunner') ? 1.3 : 1);
}

export function moveSpeed(c: Character): number {
  let s = 7 * GROWTH[c.classId].speed;
  if (c.raceId === 'elf') s *= 1.15;
  s *= 1 + 0.06 * rank(c, 'fleet-foot') + 0.05 * (rank(c, 'zephyr') + rank(c, 'footwork'));
  if (rank(c, 'avatar-of-wind')) s *= 1.1;
  s *= (1 + 0.06 * perk(c, 25)) * (rank(c, 'windrunner') ? 1.1 : 1);
  return s;
}

export function manaRegen(c: Character): number {
  const base = GROWTH[c.classId].manaRegen;
  return base * (1 + 0.3 * rank(c, 'flow')) * (c.raceId === 'orc' ? ORC.manaRegen : 1) * (hasRelic(c, 'tide-crown') ? 1.3 : 1);
}

/** Quick Draw: rangers draw every weapon faster. Multiplies draw/ready times. */
export function drawTimeMultiplier(c: Character): number {
  return c.classId === 'ranger' ? 0.5 : 1;
}

// ------------------------------------------------------------- experience --

/**
 * XP from one level to the next. Quadratic, so the steps grow smoothly (the
 * old power curve nearly tripled from level 1 to 2, then made the trials
 * grindy): about 4-6 kills of the right level for level 2, 15 at level 5 and
 * 20 at level 10, with quests and trial bosses covering a good share.
 */
export function xpToNext(level: number): number {
  return Math.round((30 + 42 * level + 10.5 * level * level) / 5) * 5;
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
    if (c.level % 5 === 0) {
      c.skillPoints++;
      c.milestone = c.level;
    }
    gained++;
  }
  if (c.level >= MAX_LEVEL) c.xp = 0;
  return gained;
}

/**
 * What a kill teaches this hero: foes more than two levels below teach less
 * (down to 40%), foes above teach more (up to 140%). Bosses always give it all.
 */
export function killXp(base: number, foeLevel: number, heroLevel: number, boss = false): number {
  if (boss) return Math.round(base);
  const d = foeLevel - heroLevel;
  const k = d >= 0 ? Math.min(1.4, 1 + 0.08 * d) : Math.max(0.4, Math.min(1, 1 + 0.08 * (d + 2)));
  return Math.round(base * k);
}

/** What a level-up gave: the stat gains, skill points and any milestone perk. */
export interface LevelRewards {
  hp: number;
  mana: number;
  stamina: number;
  points: number;
  milestones: Milestone[];
}

export function levelRewards(c: Character, fromLevel: number): LevelRewards {
  const before = { ...c, level: fromLevel };
  const milestones = MILESTONES.filter((m) => m.level > fromLevel && m.level <= c.level);
  return {
    hp: maxHp(c) - maxHp(before),
    mana: maxMana(c) - maxMana(before),
    stamina: maxStamina(c) - maxStamina(before),
    points: c.level - fromLevel + milestones.length,
    milestones,
  };
}

// ------------------------------------------------------------ kill regen --

export interface KillFoe {
  level: number;
  /** Model scale: bigger foes restore more. */
  scale: number;
  boss: boolean;
  /** Summoned by a boss: worth little. */
  minion?: boolean;
}

/** How much more kills restore, from skills and the Reaper perk. */
export function killRegenMultiplier(c: Character): number {
  return 1 + 0.5 * (rank(c, 'bloodlust') + rank(c, 'hunters-feast') + rank(c, 'inner-peace') + rank(c, 'cutpurse')) + 0.6 * rank(c, 'soul-harvest') + 0.5 * perk(c, 15);
}

/**
 * Health, mana and stamina a kill restores: a few percent for a small low-level
 * foe, more for big and high-level ones, and a big share for a boss.
 */
export function killRestore(c: Character, foe: KillFoe): { hp: number; mana: number; stamina: number } {
  const size = Math.min(1.5, Math.max(0.8, foe.scale));
  let k = foe.boss ? 0.4 : (0.04 + 0.003 * foe.level) * size * (foe.minion ? 0.4 : 1);
  k *= killRegenMultiplier(c);
  return {
    hp: maxHp(c) * k,
    mana: maxMana(c) * k * (foe.boss ? 1.25 : 0.8),
    stamina: maxStamina(c) * Math.min(1, k * 2.5),
  };
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

/** Zombie numbers: what a kill gives back, how the grave lets go once per rest, and the costs of being dead. */
export const ZOMBIE = { killHeal: 0.08, riseHp: 0.3, riseIframes: 2, fireTaken: 1.5, lightHeal: 0.5, prices: 1.25 };

/** Angelic numbers: wing flaps per jump, the glide, the Halo of Mercy, light and dark. */
export const ANGELIC = { flaps: 2, flapSpeed: 7.5, flapStamina: 14, glideFall: 2.2, glideSpeed: 1.25, haloRadius: 8, haloHeal: 0.02, lightPower: 1.25, darkTaken: 1.3 };

/** Orc numbers: hide, muscle, a thick skull, and the War Cry when badly hurt. */
export const ORC = {
  hp: 1.2, melee: 1.15, manaRegen: 0.65, spellPower: 0.85,
  warCry: { below: 0.35, duration: 8, cooldown: 60, radius: 6, stun: 1.5, damage: 1.25 },
};

/** Draco wings (from level 6) and angel wings (always) are out and can open. */
export function wingsGrown(c: Pick<Character, 'raceId' | 'level'>): boolean {
  return c.raceId === 'angelic' || (c.raceId === 'draco' && c.level >= 6);
}

/** Extra wing beats an angel gets per jump; a monk flips once in the air (twice with Feather Fall). */
export const airFlaps = (c: Pick<Character, 'raceId' | 'classId' | 'skills'>) =>
  c.raceId === 'angelic' ? ANGELIC.flaps : c.classId === 'monk' ? 1 + (c.skills['feather-fall'] ? 1 : 0) : 0;

/** Zombies have no breath to lose. */
export const drowns = (c: Pick<Character, 'raceId'>) => c.raceId !== 'zombie';

/** Share of max HP a kill gives back (the Hungry Dead). */
export const killHeal = (c: Pick<Character, 'raceId'>) => (c.raceId === 'zombie' ? ZOMBIE.killHeal : 0);

/** How well light magic and prayers mend the hero. */
export const lightHealMultiplier = (c: Pick<Character, 'raceId'>) => (c.raceId === 'zombie' ? ZOMBIE.lightHeal : 1);

/** What a merchant asks of this hero for something worth `cost`. */
export const shopPrice = (c: Pick<Character, 'raceId'>, cost: number) => Math.round(cost * (c.raceId === 'zombie' ? ZOMBIE.prices : 1));

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
