// Game content: classes, subclasses, races, roles, weapons and spells, as
// written in the design notes. The rules that use these live in src/rules/.

export type ClassId = 'warrior' | 'ranger' | 'mage';
export type SubclassId = 'swordsman' | 'axeman' | 'bowman' | 'trainer' | 'elemental';
export type RaceId = 'elf' | 'draco' | 'human' | 'zombie' | 'angelic' | 'orc' | 'ancient';
export type RoleId = 'historian' | 'blacksmith' | 'sailor' | 'darkslayer' | 'knight' | 'assassin';
export type Element = 'fire' | 'water' | 'wind' | 'earth';
export type DamageElement = Element | 'physical' | 'lightning' | 'dark' | 'light' | 'true';

/** The ancient race's name. Its language is lost; this is all that remains. */
export const ANCIENT_GLYPH = '༼ ∞ኒ';

export interface ClassDef {
  id: ClassId;
  name: string;
  hp: number;
  mana: number;
  blurb: string;
  traits: string[];
}

export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    hp: 120,
    mana: 20,
    blurb: 'Steel, shield and fury.',
    traits: [
      '+25% melee damage (does not stack, unless wielding the Sword of Mars or in BloodRage)',
      '120 HP, 20 max mana',
      'Raising a shield blocks ALL damage',
      'BloodRage: the 25% buff stacks with every hit that lands, and resets on a miss',
      'Level 4+: Bloodsteal during BloodRage (immune to bleeding; heal for damage dealt to bleeding foes)',
    ],
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    hp: 100,
    mana: 40,
    blurb: 'Swift hands, sky magic, sharp arrows.',
    traits: [
      'Quick Draw: draws every weapon faster, in all regards',
      'Extra bow damage',
      'A requirement for the Bow of Artemis',
      'The only class besides the Mage that can cast Wrath of Thor',
      'Limited to sky magic, but the only class that properly wields the Master Bolt',
      '40 max mana. Elf rangers can also cast Imp (Devil) magic',
      'Starts with a level 1 bow',
    ],
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    hp: 80,
    mana: 70,
    blurb: 'The class with the most magic.',
    traits: [
      'Starts with 70 mana',
      'Level 3+: combine two spells into one',
      'Level 1 spells: Deal with the Devil, Inferno, Wrath of Thor, Waterspike, Way of the Wind',
      'More spells are hidden in the world',
      'The only class that can wield the Staff of Hecate',
    ],
  },
};

export interface SubclassDef {
  id: SubclassId;
  classId: ClassId;
  name: string;
  expansion: boolean;
  blurb: string;
  traits: string[];
}

export const SUBCLASSES: Record<SubclassId, SubclassDef> = {
  swordsman: {
    id: 'swordsman',
    classId: 'warrior',
    name: 'Swordsman',
    expansion: false,
    blurb: 'Blade and flourish.',
    traits: ['Starts with a level 2 iron sword', 'Spinner Flourish (spin attack)', "Swordsman's upgrade tree"],
  },
  axeman: {
    id: 'axeman',
    classId: 'warrior',
    name: 'Axeman',
    expansion: false,
    blurb: 'Heavy, brutal, bleeding.',
    traits: ['Starts with a level 2 iron axe', 'Axeman upgrade tree'],
  },
  bowman: {
    id: 'bowman',
    classId: 'warrior',
    name: 'Bowman',
    expansion: true,
    blurb: 'A warrior who kills from the dark.',
    traits: [
      'Starts with a level 2 copper bow and 50 steel arrows',
      'Power Shot instead of BloodRage: while undetected, 6x damage plus 0.5 NDP to nearby enemies',
      'Power Shot radius grows with level',
    ],
  },
  trainer: {
    id: 'trainer',
    classId: 'ranger',
    name: 'Trainer',
    expansion: true,
    blurb: 'Beasts answer your call.',
    traits: ['Can tame certain creatures', 'More creatures become tameable with each level'],
  },
  elemental: {
    id: 'elemental',
    classId: 'mage',
    name: 'Elemental Wizard',
    expansion: true,
    blurb: 'Bound to one element.',
    traits: ['Choose fire, water, wind or earth', 'Spells of that element are 50% stronger and 25% cheaper', 'Resist that element'],
  },
};

export interface RaceDef {
  id: RaceId;
  name: string;
  blurb: string;
  traits: string[];
  secret?: boolean;
}

export const RACES: Record<RaceId, RaceDef> = {
  elf: {
    id: 'elf',
    name: 'Elf',
    blurb: 'Clever, nimble, and sometimes… ******.',
    traits: [
      'Increased IQ: +20% max mana and spell power',
      'Agility: faster movement and more stamina',
      'Starts with a level 3 bow',
      'Imp magic (sometimes called "Devil magic")',
      'Randomly an earth, fire, water or wind elf (25% each)',
      '33% chance of ******',
    ],
  },
  draco: {
    id: 'draco',
    name: 'Draco',
    blurb: 'Scales, horns, and wings that grow with you.',
    traits: [
      'Takes damage in water at level 5 (but not before or after)',
      'Level 6: wings sustain flight for 1 game hour, +1 hour every level after',
      'Takes less fire damage',
      'Level 10: regenerates 10 HP a second in fire or lava',
    ],
  },
  human: {
    id: 'human',
    name: 'Human',
    blurb: "Well, they're just… human.",
    traits: ['No buffs', 'No downsides either'],
  },
  zombie: {
    id: 'zombie',
    name: 'Zombie',
    blurb: 'Dead, but not done. Stitched back together, and hungry.',
    traits: [
      'Not Dead Yet: once per rest, a killing blow leaves you standing at 30% HP',
      'Hungry Dead: every kill you take part in heals 8% of your max HP',
      'No breath, no blood: never drowns and never bleeds',
      'Dry old bones: fire hurts 50% more',
      'Light magic and prayers heal you only half as much',
      'Merchants hold their noses: prices +25%',
    ],
  },
  angelic: {
    id: 'angelic',
    name: 'Angelic',
    blurb: 'A halo, white wings, and a light that mends your friends.',
    traits: [
      'Wings of Light: jump again in the air to flap (twice), hold Jump to glide',
      'Radiant: +25% light damage, and knows Holy Smite',
      'Halo of Mercy: co-op friends (and tamed beasts) within 8 m heal 2% of their max HP a second',
      'Dark damage hurts 30% more',
    ],
  },
  orc: {
    id: 'orc',
    name: 'Orc',
    blurb: 'Big, green and loud. Hits like a falling tree.',
    traits: [
      'Thick hide: +20% max HP',
      'Brute strength: +15% melee damage',
      'War Cry: below 35% HP you roar, stunning foes nearby and dealing +25% damage for 8 s (once a minute)',
      'Thick skull: mana comes back 35% slower and spells hit 15% softer',
    ],
  },
  ancient: {
    id: 'ancient',
    name: ANCIENT_GLYPH,
    blurb: 'A race so old its language has been lost to time.',
    secret: true,
    traits: [
      'The Gaze: enemies that see you suffer',
      'Thunderheart: when your heart breaks (below 30% HP), thunder answers',
      'Lizard-kin: small dragon-like lizards fight beside you',
      '…we think it is humanoid',
    ],
  },
};

export interface RoleDef {
  id: RoleId;
  name: string;
  blurb: string;
  traits: string[];
}

export const ROLES: Record<RoleId, RoleDef> = {
  historian: {
    id: 'historian',
    name: 'Historian',
    blurb: "Knows things some say they shouldn't know.",
    traits: [
      'Reads ancient carvings and lore stones others cannot',
      "Sees enemies' health and weaknesses",
      '+15% experience',
    ],
  },
  blacksmith: {
    id: 'blacksmith',
    name: 'Blacksmith',
    blurb: 'Great at forging.',
    traits: ['Upgrades weapons at any anvil for half the cost', 'Can wield the Hammer of Hephaestus'],
  },
  sailor: {
    id: 'sailor',
    name: 'Sailor',
    blurb: 'Good with boats and fishing.',
    traits: ['Can sail boats from any dock', 'Better catches when fishing', "Swims without tiring", "Can wield Poseidon's Trident"],
  },
  darkslayer: {
    id: 'darkslayer',
    name: 'Dark Slayer',
    blurb: 'No one has survived to see them and tell anyone.',
    traits: [
      '+50% damage to dark creatures',
      'Night vision',
      'Dread aura: wounded dark creatures flee',
    ],
  },
  knight: {
    id: 'knight',
    name: 'Knight of the Light',
    blurb: 'Holy knights who wield the light.',
    traits: ['Light magic: Holy Smite, Radiant Heal, Aegis of Light', '+10 max mana'],
  },
  assassin: {
    id: 'assassin',
    name: 'Assassin',
    blurb: "Ah well, I couldn't really let him write about us now, could I?",
    traits: [
      'Crouch to move unseen',
      'Backstabs on unaware enemies deal 4x damage',
      'Starts with a dagger',
      'The chronicler is… edited',
    ],
  },
};

// ---------------------------------------------------------------- weapons --

export type WeaponKind = 'sword' | 'axe' | 'bow' | 'staff' | 'dagger' | 'hammer' | 'trident' | 'bolt';

export type LegendaryId = 'sword-of-mars' | 'bow-of-artemis' | 'master-bolt' | 'staff-of-hecate' | 'hammer-of-hephaestus' | 'trident-of-poseidon';

export interface WeaponDef {
  id: string;
  name: string;
  kind: WeaponKind;
  damage: number;
  /** Attacks per second at normal speed. */
  speed: number;
  range: number;
  element: DamageElement;
  legendary?: LegendaryId;
  description?: string;
}

export const WEAPONS: Record<string, WeaponDef> = {
  'iron-sword': { id: 'iron-sword', name: 'Iron Sword', kind: 'sword', damage: 12, speed: 1.6, range: 2.6, element: 'physical' },
  'iron-axe': { id: 'iron-axe', name: 'Iron Axe', kind: 'axe', damage: 16, speed: 1.15, range: 2.5, element: 'physical' },
  'hunting-bow': { id: 'hunting-bow', name: 'Hunting Bow', kind: 'bow', damage: 9, speed: 1.2, range: 60, element: 'physical' },
  'copper-bow': { id: 'copper-bow', name: 'Copper Bow', kind: 'bow', damage: 11, speed: 1.1, range: 70, element: 'physical' },
  'elven-bow': { id: 'elven-bow', name: 'Elven Bow', kind: 'bow', damage: 10, speed: 1.3, range: 70, element: 'physical' },
  'oak-staff': { id: 'oak-staff', name: 'Oak Staff', kind: 'staff', damage: 7, speed: 1.4, range: 2.6, element: 'physical' },
  'shadow-dagger': { id: 'shadow-dagger', name: 'Shadow Dagger', kind: 'dagger', damage: 8, speed: 2.4, range: 1.9, element: 'physical' },
  'sword-of-mars': {
    id: 'sword-of-mars', name: 'Sword of Mars', kind: 'sword', damage: 30, speed: 1.6, range: 3, element: 'fire', legendary: 'sword-of-mars',
    description: "The war god's blade. A warrior's 25% buff stacks with every hit while holding it.",
  },
  'bow-of-artemis': {
    id: 'bow-of-artemis', name: 'Bow of Artemis', kind: 'bow', damage: 26, speed: 1.4, range: 90, element: 'light', legendary: 'bow-of-artemis',
    description: 'Moonlit arrows that pierce. Requires a Ranger; only an Elf ranger unlocks its full power.',
  },
  'master-bolt': {
    id: 'master-bolt', name: 'Master Bolt', kind: 'bolt', damage: 34, speed: 0.9, range: 50, element: 'lightning', legendary: 'master-bolt',
    description: "Zeus' thunderbolt. Anyone can hurl it, but only a Ranger can use it properly.",
  },
  'staff-of-hecate': {
    id: 'staff-of-hecate', name: 'Staff of Hecate', kind: 'staff', damage: 14, speed: 1.4, range: 2.8, element: 'dark', legendary: 'staff-of-hecate',
    description: 'Spells cost 30% less and hit 40% harder. Mages only.',
  },
  'hammer-of-hephaestus': {
    id: 'hammer-of-hephaestus', name: 'Hammer of Hephaestus', kind: 'hammer', damage: 34, speed: 0.95, range: 2.8, element: 'fire', legendary: 'hammer-of-hephaestus',
    description: 'Every blow is a forge-strike of fire. Blacksmiths only; lets you upgrade weapons anywhere.',
  },
  'trident-of-poseidon': {
    id: 'trident-of-poseidon', name: "Poseidon's Trident", kind: 'trident', damage: 28, speed: 1.3, range: 3.6, element: 'water', legendary: 'trident-of-poseidon',
    description: 'Commands the sea. Sailors only; lets you walk on water.',
  },
};

export interface WeaponInstance {
  id: string;
  level: number;
}

// ------------------------------------------------------------------ spells --

export type SpellSchool = 'devil' | 'fire' | 'water' | 'sky' | 'light' | 'arcane' | 'earth';

export type SpellId =
  | 'deal-with-the-devil'
  | 'inferno'
  | 'wrath-of-thor'
  | 'waterspike'
  | 'way-of-the-wind'
  | 'blade-of-retribution'
  | 'soul-or-power'
  | 'power-of-the-light'
  | 'imp-familiar'
  | 'holy-smite'
  | 'radiant-heal'
  | 'aegis-of-light'
  | 'stone-skin'
  | 'moonveil';

export interface SpellDef {
  id: SpellId;
  name: string;
  school: SpellSchool;
  element: DamageElement;
  mana: number;
  /** Seconds. */
  cooldown: number;
  power: number;
  description: string;
  /** Found as a tome in the world rather than known from the start. */
  hidden?: boolean;
}

export const SPELLS: Record<SpellId, SpellDef> = {
  'deal-with-the-devil': {
    id: 'deal-with-the-devil', name: 'Deal with the Devil', school: 'devil', element: 'dark', mana: 35, cooldown: 30, power: 0,
    description: 'One-shots any one foe, or a ring of level 1–5 foes. You black out, and light magic is sealed for 1, then 2, then 3 hours. The 4th deal seals it forever.',
  },
  inferno: {
    id: 'inferno', name: 'Inferno', school: 'fire', element: 'fire', mana: 12, cooldown: 1.2, power: 26,
    description: 'Magical flames: a fireball, or (hold) a ring of fire around you.',
  },
  'wrath-of-thor': {
    id: 'wrath-of-thor', name: 'Wrath of Thor', school: 'sky', element: 'lightning', mana: 16, cooldown: 4, power: 34,
    description: 'Lightning and tornadoes and stuff. Calls lightning onto your target and a tornado that drags foes.',
  },
  waterspike: {
    id: 'waterspike', name: 'Waterspike', school: 'water', element: 'water', mana: 10, cooldown: 1.5, power: 22,
    description: 'Water bending. Spikes erupt from the ground in any biome, except the desert.',
  },
  'way-of-the-wind': {
    id: 'way-of-the-wind', name: 'Way of the Wind', school: 'sky', element: 'wind', mana: 8, cooldown: 10, power: 0,
    description: 'A speed boost for you, or (hold) a gale that slows enemies.',
  },
  'blade-of-retribution': {
    id: 'blade-of-retribution', name: 'Blade of Retribution', school: 'arcane', element: 'true', mana: 25, cooldown: 20, power: 0, hidden: true,
    description: 'Every point of damage the target has ever dealt, to all beings combined, is sent back at it with 1.5x the power.',
  },
  'soul-or-power': {
    id: 'soul-or-power', name: 'Soul or Power', school: 'arcane', element: 'true', mana: 0, cooldown: 5, power: 0, hidden: true,
    description: 'At 15 mana or less: consumes it all, then lets you cast at 0 mana. BUT every point of damage you take is lost from your max health forever. Ends when you rest.',
  },
  'power-of-the-light': {
    id: 'power-of-the-light', name: 'Power of the Light', school: 'light', element: 'light', mana: 0, cooldown: 0, power: 0, hidden: true,
    description: 'All mana and health restored instantly. Cooldown: 1 hour (game time).',
  },
  'imp-familiar': {
    id: 'imp-familiar', name: 'Imp Familiar', school: 'devil', element: 'fire', mana: 15, cooldown: 25, power: 8,
    description: 'Imp magic: summons a cackling imp that hurls fire at your foes for 30 seconds.',
  },
  'holy-smite': {
    id: 'holy-smite', name: 'Holy Smite', school: 'light', element: 'light', mana: 10, cooldown: 3, power: 30,
    description: 'A pillar of light strikes your target. Double damage to dark creatures.',
  },
  'radiant-heal': {
    id: 'radiant-heal', name: 'Radiant Heal', school: 'light', element: 'light', mana: 14, cooldown: 8, power: 45,
    description: 'Restores health.',
  },
  'aegis-of-light': {
    id: 'aegis-of-light', name: 'Aegis of Light', school: 'light', element: 'light', mana: 18, cooldown: 30, power: 0,
    description: 'Three seconds of untouchable light.',
  },
  'stone-skin': {
    id: 'stone-skin', name: 'Stone Skin', school: 'earth', element: 'earth', mana: 14, cooldown: 25, power: 0, hidden: true,
    description: 'Halves damage taken for 12 seconds.',
  },
  moonveil: {
    id: 'moonveil', name: 'Moonveil', school: 'arcane', element: 'dark', mana: 16, cooldown: 30, power: 0, hidden: true,
    description: 'Become unseen for 10 seconds, or until you strike.',
  },
};

export const MAGE_STARTING_SPELLS: SpellId[] = ['deal-with-the-devil', 'inferno', 'wrath-of-thor', 'waterspike', 'way-of-the-wind'];

/** Spells found as tomes in the world, in the order the map places them. */
export const HIDDEN_SPELLS: SpellId[] = ['blade-of-retribution', 'soul-or-power', 'power-of-the-light', 'stone-skin', 'moonveil'];

export interface ComboDef {
  id: string;
  name: string;
  spells: [SpellId, SpellId];
  element: DamageElement;
  description: string;
}

/** What two spells become when a level 3+ mage combines them. */
export const COMBOS: ComboDef[] = [
  { id: 'firestorm', name: 'Firestorm', spells: ['inferno', 'way-of-the-wind'], element: 'fire', description: 'A tornado of flame that hunts your foes.' },
  { id: 'storm-surge', name: 'Storm Surge', spells: ['wrath-of-thor', 'waterspike'], element: 'lightning', description: 'Electrified water: soaked enemies take double lightning.' },
  { id: 'scalding-geyser', name: 'Scalding Geyser', spells: ['inferno', 'waterspike'], element: 'fire', description: 'Boiling steam bursts from the ground.' },
  { id: 'tempest', name: 'Tempest', spells: ['wrath-of-thor', 'way-of-the-wind'], element: 'lightning', description: 'A wide storm of lightning around you.' },
  { id: 'thunderfire', name: 'Thunderfire', spells: ['inferno', 'wrath-of-thor'], element: 'fire', description: 'A burning bolt that explodes on impact.' },
  { id: 'frost-gale', name: 'Frost Gale', spells: ['waterspike', 'way-of-the-wind'], element: 'water', description: 'Freezing wind that roots enemies in place.' },
];

// --------------------------------------------------------- upgrade trees --

export interface SkillNode {
  id: string;
  name: string;
  description: string;
  maxRank: number;
  /** Level the hero must reach before the node opens. */
  level: number;
  /** Row of the tree, 1-5: deeper tiers open as points go into the tree (TIER_POINTS) and cost more (TIER_COST). */
  tier: number;
  /** Column 0-2: loosely offence, sustain, defence. */
  col: number;
  /** Nodes of the same tree that need a rank first. */
  req?: string[];
  icon: string;
  /** What the ranks add, each {n} multiplied by the rank: '+{10}% sword damage.' reads '+20%…' at rank 2. */
  per?: string;
}

/** Points spent in a tree before each tier opens (indexed by tier). */
export const TIER_POINTS = [0, 0, 2, 5, 9, 14];
/** Skill points one rank costs at each tier. */
export const TIER_COST = [0, 1, 1, 2, 2, 3];

export type TreeId = 'swordsman' | 'axeman' | 'bowman' | 'ranger' | 'trainer' | 'mage' | 'elemental';

type Shared = Omit<SkillNode, 'tier' | 'col'>;

// Nodes several trees share (a hero only ever has one tree, so an id means the same thing everywhere).
const BLOODLUST: Shared = { id: 'bloodlust', name: 'Bloodlust', icon: '🩸', maxRank: 2, level: 1, description: 'Kills restore 50% more health, mana and stamina per rank.', per: 'Kills restore {50}% more.' };
const IRON_HIDE: Shared = { id: 'iron-hide', name: 'Iron Hide', icon: '🦾', maxRank: 3, level: 1, description: '+15 max health per rank.', per: '+{15} max health.' };
const STALWART: Shared = { id: 'stalwart', name: 'Stalwart', icon: '🏰', maxRank: 2, level: 3, description: 'Take 8% less damage per rank.', per: 'Take {8}% less damage.' };
const BATTLE_TRANCE: Shared = { id: 'battle-trance', name: 'Battle Trance', icon: '🔥', maxRank: 2, level: 5, description: 'BloodRage lasts 5 seconds longer per rank.', per: 'BloodRage lasts {5} s longer.' };
const LAST_STAND: Shared = { id: 'last-stand', name: 'Last Stand', icon: '💢', maxRank: 1, level: 9, description: 'Below 30% health your weapon hits deal 25% more damage.' };
const FLEET_FOOT: Shared = { id: 'fleet-foot', name: 'Fleet Foot', icon: '💨', maxRank: 2, level: 2, description: '+6% movement speed per rank.', per: '+{6}% movement speed.' };
const EAGLE_EYE: Shared = { id: 'eagle-eye', name: 'Eagle Eye', icon: '🦅', maxRank: 2, level: 8, description: 'Fully drawn arrows deal 12% more damage per rank.', per: 'Fully drawn arrows deal {12}% more damage.' };
const FEAST: Shared = { id: 'hunters-feast', name: "Hunter's Feast", icon: '🍖', maxRank: 2, level: 1, description: 'Kills restore 50% more health, mana and stamina per rank.', per: 'Kills restore {50}% more.' };
const TRAIL_RUNNER: Shared = { id: 'trail-runner', name: 'Trail Runner', icon: '🥾', maxRank: 2, level: 1, description: '+15 max stamina per rank.', per: '+{15} max stamina.' };
const HARDY: Shared = { id: 'hardy', name: 'Hardy', icon: '❤', maxRank: 2, level: 2, description: '+12 max health per rank.', per: '+{12} max health.' };
const TUMBLE: Shared = { id: 'tumble', name: 'Tumble', icon: '🤸', maxRank: 2, level: 5, description: 'Rolls cost 25% less stamina per rank.', per: 'Rolls cost {25}% less stamina.' };
const SOUL_HARVEST: Shared = { id: 'soul-harvest', name: 'Soul Harvest', icon: '👻', maxRank: 2, level: 1, description: 'Kills restore 60% more health, mana and stamina per rank.', per: 'Kills restore {60}% more.' };
const DEEP_WELL: Shared = { id: 'deep-well', name: 'Deep Well', icon: '🔮', maxRank: 3, level: 1, description: '+10 max mana per rank.', per: '+{10} max mana.' };
const SPELL_THRIFT: Shared = { id: 'spell-thrift', name: 'Spell Thrift', icon: '🪙', maxRank: 2, level: 2, description: 'Spells cost 8% less mana per rank.', per: 'Spells cost {8}% less mana.' };
const FLOW: Shared = { id: 'flow', name: 'Flow', icon: '🌊', maxRank: 2, level: 2, description: 'Mana regenerates 30% faster per rank.', per: 'Mana regenerates {30}% faster.' };
const HARMONY: Shared = { id: 'harmony', name: 'Harmony', icon: '☯', maxRank: 1, level: 5, description: 'Combined spells cost 20% less.' };
const ARCANE_WARD: Shared = { id: 'arcane-ward', name: 'Arcane Ward', icon: '🔰', maxRank: 2, level: 5, description: 'Take 7% less damage per rank.', per: 'Take {7}% less damage.' };
const ARCANE_MASTERY: Shared = { id: 'arcane-mastery', name: 'Arcane Mastery', icon: '📜', maxRank: 2, level: 8, description: '+8% spell power per rank.', per: '+{8}% spell power.' };

const at = (n: Shared, tier: number, col: number, more: Partial<SkillNode> = {}): SkillNode => ({ ...n, tier, col, ...more });

/**
 * One tree per class (or subclass). Every id older saves may hold is kept, with
 * the same effect; the newer nodes fill the gaps, and each class has one that
 * makes kills restore more (Bloodlust, Hunter's Feast, Soul Harvest).
 */
export const TREES: Record<TreeId, { name: string; nodes: SkillNode[] }> = {
  swordsman: {
    name: "Swordsman's Tree",
    nodes: [
      { id: 'keen-edge', name: 'Keen Edge', icon: '⚔', tier: 1, col: 0, maxRank: 3, level: 1, description: '+10% sword damage per rank.', per: '+{10}% sword damage.' },
      at(BLOODLUST, 1, 1),
      at(IRON_HIDE, 1, 2),
      { id: 'wide-flourish', name: 'Wide Flourish', icon: '🌀', tier: 2, col: 0, maxRank: 2, level: 2, req: ['keen-edge'], description: 'Spinner Flourish reaches 30% farther and hits 20% harder per rank.', per: 'Spinner Flourish reaches {30}% farther and hits {20}% harder.' },
      { id: 'riposte', name: 'Riposte', icon: '🛡', tier: 2, col: 2, maxRank: 1, level: 3, req: ['iron-hide'], description: 'Blocking a blow staggers the attacker.' },
      { id: 'lunge', name: 'Lunge', icon: '➤', tier: 3, col: 0, maxRank: 1, level: 4, req: ['wide-flourish'], description: 'Heavy attacks and Spinner Flourish dash forward.' },
      { id: 'blade-dancer', name: 'Blade Dancer', icon: '🍃', tier: 3, col: 1, maxRank: 2, level: 5, req: ['bloodlust'], description: 'Attacks cost 20% less stamina per rank.', per: 'Attacks cost {20}% less stamina.' },
      at(STALWART, 3, 2, { req: ['riposte'], level: 5 }),
      at(BATTLE_TRANCE, 4, 0, { req: ['lunge'], level: 8 }),
      at(LAST_STAND, 4, 2, { req: ['stalwart'] }),
      { id: 'blade-master', name: 'Blade Master', icon: '👑', tier: 5, col: 1, maxRank: 1, level: 12, req: ['blade-dancer'], description: '+15% melee damage, and attacks cost 15% less stamina.' },
    ],
  },
  axeman: {
    name: 'Axeman Tree',
    nodes: [
      { id: 'heavy-hand', name: 'Heavy Hand', icon: '🪓', tier: 1, col: 0, maxRank: 3, level: 1, description: '+12% axe damage per rank.', per: '+{12}% axe damage.' },
      at(BLOODLUST, 1, 1),
      at(IRON_HIDE, 1, 2),
      { id: 'rend', name: 'Rend', icon: '🔪', tier: 2, col: 0, maxRank: 2, level: 2, req: ['heavy-hand'], description: '+15% chance per rank to make enemies bleed.', per: '+{15}% chance to make enemies bleed.' },
      { id: 'cleave', name: 'Cleave', icon: '🌙', tier: 2, col: 1, maxRank: 1, level: 3, req: ['heavy-hand'], description: 'Swings hit everything in a wider arc.' },
      at(STALWART, 2, 2, { req: ['iron-hide'] }),
      { id: 'throwing-axe', name: 'Throwing Axe', icon: '🪃', tier: 3, col: 0, maxRank: 1, level: 4, req: ['rend'], description: 'Heavy attack hurls a spinning axe.' },
      { id: 'earthsplitter', name: 'Earthsplitter', icon: '💥', tier: 3, col: 1, maxRank: 1, level: 5, req: ['cleave'], description: 'Jump attacks slam the ground around you.' },
      at(BATTLE_TRANCE, 3, 2, { req: ['stalwart'] }),
      { id: 'executioner', name: 'Executioner', icon: '💀', tier: 4, col: 0, maxRank: 2, level: 8, req: ['throwing-axe'], description: 'Hits on foes below 30% health deal 15% more damage per rank.', per: 'Foes below 30% health take {15}% more damage.' },
      at(LAST_STAND, 4, 2, { req: ['battle-trance'] }),
      { id: 'berserker', name: 'Berserker', icon: '👹', tier: 5, col: 1, maxRank: 1, level: 12, req: ['earthsplitter'], description: '+15% melee damage and +25% chance to make enemies bleed.' },
    ],
  },
  bowman: {
    name: 'Bowman Tree',
    nodes: [
      { id: 'steady-aim', name: 'Steady Aim', icon: '🎯', tier: 1, col: 0, maxRank: 3, level: 1, description: '+10% bow damage per rank.', per: '+{10}% bow damage.' },
      at(BLOODLUST, 1, 1),
      at(IRON_HIDE, 1, 2),
      { id: 'piercing-shot', name: 'Piercing Shot', icon: '➶', tier: 2, col: 0, maxRank: 1, level: 3, req: ['steady-aim'], description: 'Arrows pass through the first enemy.' },
      { id: 'shadow-step', name: 'Shadow Step', icon: '👣', tier: 2, col: 1, maxRank: 2, level: 2, description: 'Enemies take 25% longer per rank to notice you.', per: 'Enemies take {25}% longer to notice you.' },
      at(FLEET_FOOT, 2, 2, { req: ['iron-hide'] }),
      { id: 'reclaim', name: 'Reclaim', icon: '♻', tier: 3, col: 0, maxRank: 1, level: 4, req: ['piercing-shot'], description: '40% chance to keep an arrow.' },
      { id: 'deadeye', name: 'Deadeye', icon: '👁', tier: 3, col: 1, maxRank: 1, level: 5, req: ['shadow-step'], description: 'Power Shot reaches 50% farther.' },
      at(STALWART, 3, 2, { req: ['fleet-foot'], level: 5 }),
      at(EAGLE_EYE, 4, 0, { req: ['reclaim'] }),
      { id: 'ambusher', name: 'Ambusher', icon: '🌑', tier: 4, col: 1, maxRank: 2, level: 8, req: ['deadeye'], description: 'Hits on foes that have not noticed you deal 15% more damage per rank.', per: 'Unaware foes take {15}% more damage.' },
      { id: 'killshot', name: 'Killshot', icon: '☄', tier: 5, col: 1, maxRank: 1, level: 12, req: ['ambusher'], description: 'Power Shot deals 8x damage instead of 6x.' },
    ],
  },
  ranger: {
    name: 'Ranger Tree',
    nodes: [
      { id: 'fletcher', name: 'Fletcher', icon: '🏹', tier: 1, col: 0, maxRank: 3, level: 1, description: '+10% bow damage per rank.', per: '+{10}% bow damage.' },
      at(FEAST, 1, 1),
      at(TRAIL_RUNNER, 1, 2),
      { id: 'volley', name: 'Volley', icon: '🌧', tier: 2, col: 0, maxRank: 1, level: 3, req: ['fletcher'], description: 'Fully drawn shots loose two extra arrows.' },
      at(HARDY, 2, 1, { req: ['hunters-feast'] }),
      at(FLEET_FOOT, 2, 2, { req: ['trail-runner'] }),
      { id: 'hunters-mark', name: "Hunter's Mark", icon: '✴', tier: 3, col: 0, maxRank: 1, level: 5, req: ['volley'], description: 'Arrows mark targets: +15% damage taken from all sources.' },
      { id: 'storm-caller', name: 'Storm Caller', icon: '⛈', tier: 3, col: 1, maxRank: 1, level: 4, req: ['hardy'], description: 'Sky spells are 20% stronger.' },
      at(TUMBLE, 3, 2, { req: ['fleet-foot'] }),
      at(EAGLE_EYE, 4, 0, { req: ['hunters-mark'] }),
      { id: 'thunderhead', name: 'Thunderhead', icon: '🌩', tier: 4, col: 1, maxRank: 2, level: 8, req: ['storm-caller'], description: 'Sky spells cost 15% less mana per rank.', per: 'Sky spells cost {15}% less mana.' },
      { id: 'windrunner', name: 'Windrunner', icon: '🌬', tier: 5, col: 1, maxRank: 1, level: 12, req: ['thunderhead'], description: '+10% movement speed, and stamina recovers 30% faster.' },
    ],
  },
  trainer: {
    name: 'Trainer Tree',
    nodes: [
      { id: 'pack-bond', name: 'Pack Bond', icon: '🐺', tier: 1, col: 0, maxRank: 2, level: 1, description: 'Tamed creatures have +25% health per rank.', per: 'Tamed creatures have +{25}% health.' },
      at(FEAST, 1, 1),
      { id: 'fletcher', name: 'Fletcher', icon: '🏹', tier: 1, col: 2, maxRank: 2, level: 1, description: '+10% bow damage per rank.', per: '+{10}% bow damage.' },
      { id: 'feral-bite', name: 'Feral Bite', icon: '🦷', tier: 2, col: 0, maxRank: 2, level: 2, req: ['pack-bond'], description: 'Tamed creatures deal +20% damage per rank.', per: 'Tamed creatures deal +{20}% damage.' },
      at(HARDY, 2, 1, { req: ['hunters-feast'] }),
      at(TRAIL_RUNNER, 2, 2, { req: ['fletcher'], level: 2 }),
      { id: 'whistle', name: 'Whistle', icon: '🎵', tier: 3, col: 0, maxRank: 1, level: 3, req: ['feral-bite'], description: 'Tamed creatures regenerate when near you.' },
      { id: 'second-beast', name: 'Second Beast', icon: '🐾', tier: 3, col: 1, maxRank: 1, level: 5, req: ['feral-bite'], description: 'Keep two tamed creatures at once.' },
      at(FLEET_FOOT, 3, 2, { req: ['trail-runner'], level: 4 }),
      at(TUMBLE, 4, 0, { req: ['whistle'], level: 8 }),
      at(EAGLE_EYE, 4, 2, { req: ['fleet-foot'] }),
      { id: 'alpha-call', name: 'Alpha Call', icon: '🌕', tier: 5, col: 1, maxRank: 1, level: 12, req: ['second-beast'], description: 'Tamed creatures have 30% more health and deal 30% more damage.' },
    ],
  },
  mage: {
    name: 'Arcane Tree',
    nodes: [
      { id: 'focus', name: 'Focus', icon: '🔆', tier: 1, col: 0, maxRank: 3, level: 2, description: '+10% spell power per rank.', per: '+{10}% spell power.' },
      at(SOUL_HARVEST, 1, 1),
      at(DEEP_WELL, 1, 2),
      at(SPELL_THRIFT, 2, 0, { req: ['focus'] }),
      at(FLOW, 2, 1, { req: ['soul-harvest'] }),
      at(HARDY, 2, 2, { req: ['deep-well'] }),
      { id: 'quickening', name: 'Quickening', icon: '⏳', tier: 3, col: 0, maxRank: 2, level: 4, req: ['spell-thrift'], description: 'Spell cooldowns 15% shorter per rank.', per: 'Spell cooldowns {15}% shorter.' },
      at(HARMONY, 3, 1, { req: ['flow'] }),
      at(ARCANE_WARD, 3, 2, { req: ['hardy'] }),
      at(ARCANE_MASTERY, 4, 0, { req: ['quickening'] }),
      { id: 'mana-shield', name: 'Mana Shield', icon: '💠', tier: 4, col: 2, maxRank: 1, level: 9, req: ['arcane-ward'], description: 'A fifth of the damage you take drains mana instead of health.' },
      { id: 'archmage', name: 'Archmage', icon: '🧙', tier: 5, col: 1, maxRank: 1, level: 12, req: ['harmony'], description: '+15% spell power and 10% shorter cooldowns.' },
    ],
  },
  elemental: {
    name: 'Elemental Tree',
    nodes: [
      { id: 'attunement', name: 'Attunement', icon: '♨', tier: 1, col: 0, maxRank: 3, level: 1, description: 'Your element hits 10% harder per rank.', per: 'Your element hits {10}% harder.' },
      at(SOUL_HARVEST, 1, 1),
      at(DEEP_WELL, 1, 2),
      at(SPELL_THRIFT, 2, 0, { req: ['attunement'] }),
      at(FLOW, 2, 1, { req: ['soul-harvest'] }),
      at(HARDY, 2, 2, { req: ['deep-well'] }),
      { id: 'focus', name: 'Focus', icon: '🔆', tier: 3, col: 0, maxRank: 2, level: 4, req: ['spell-thrift'], description: '+10% spell power per rank.', per: '+{10}% spell power.' },
      at(HARMONY, 3, 1, { req: ['flow'] }),
      { id: 'elemental-ward', name: 'Elemental Ward', icon: '🌡', tier: 3, col: 2, maxRank: 1, level: 4, req: ['hardy'], description: 'Immune to your own element.' },
      at(ARCANE_MASTERY, 4, 0, { req: ['focus'] }),
      at(ARCANE_WARD, 4, 2, { req: ['elemental-ward'], level: 8 }),
      { id: 'elemental-avatar', name: 'Elemental Avatar', icon: '🌋', tier: 5, col: 1, maxRank: 1, level: 12, req: ['arcane-mastery'], description: 'Your element hits 20% harder and its spells cost 15% less.' },
    ],
  },
};

// --------------------------------------------------------------- taming --

export type CreatureKind = 'wolf' | 'boar' | 'scorpion' | 'magma-hound' | 'drake';

/** Creature a Trainer can tame, and the level they need. */
export const TAMEABLE: { kind: CreatureKind; level: number; name: string }[] = [
  { kind: 'wolf', level: 1, name: 'Wolf' },
  { kind: 'boar', level: 3, name: 'Boar' },
  { kind: 'scorpion', level: 5, name: 'Giant Scorpion' },
  { kind: 'magma-hound', level: 7, name: 'Magma Hound' },
  { kind: 'drake', level: 9, name: 'Drake' },
];
