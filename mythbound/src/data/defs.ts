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
}

export type TreeId = 'swordsman' | 'axeman' | 'bowman' | 'ranger' | 'trainer' | 'mage' | 'elemental';

export const TREES: Record<TreeId, { name: string; nodes: SkillNode[] }> = {
  swordsman: {
    name: "Swordsman's Tree",
    nodes: [
      { id: 'keen-edge', name: 'Keen Edge', description: '+10% sword damage per rank.', maxRank: 3, level: 1 },
      { id: 'wide-flourish', name: 'Wide Flourish', description: 'Spinner Flourish reaches 30% farther and hits 20% harder per rank.', maxRank: 2, level: 2 },
      { id: 'riposte', name: 'Riposte', description: 'Blocking right before a hit staggers the attacker.', maxRank: 1, level: 3 },
      { id: 'lunge', name: 'Lunge', description: 'Heavy attacks dash forward.', maxRank: 1, level: 4 },
      { id: 'blade-dancer', name: 'Blade Dancer', description: 'Attacks cost 20% less stamina per rank.', maxRank: 2, level: 5 },
    ],
  },
  axeman: {
    name: 'Axeman Tree',
    nodes: [
      { id: 'heavy-hand', name: 'Heavy Hand', description: '+12% axe damage per rank.', maxRank: 3, level: 1 },
      { id: 'rend', name: 'Rend', description: '+15% chance per rank to make enemies bleed.', maxRank: 2, level: 2 },
      { id: 'cleave', name: 'Cleave', description: 'Swings hit everything in a wider arc.', maxRank: 1, level: 3 },
      { id: 'throwing-axe', name: 'Throwing Axe', description: 'Heavy attack hurls a spinning axe.', maxRank: 1, level: 4 },
      { id: 'earthsplitter', name: 'Earthsplitter', description: 'Jump attacks slam the ground around you.', maxRank: 1, level: 5 },
    ],
  },
  bowman: {
    name: 'Bowman Tree',
    nodes: [
      { id: 'steady-aim', name: 'Steady Aim', description: '+10% bow damage per rank.', maxRank: 3, level: 1 },
      { id: 'shadow-step', name: 'Shadow Step', description: 'Enemies take 25% longer per rank to notice you.', maxRank: 2, level: 2 },
      { id: 'piercing-shot', name: 'Piercing Shot', description: 'Arrows pass through the first enemy.', maxRank: 1, level: 3 },
      { id: 'reclaim', name: 'Reclaim', description: '40% chance to keep an arrow.', maxRank: 1, level: 4 },
      { id: 'deadeye', name: 'Deadeye', description: 'Power Shot reaches 50% farther.', maxRank: 1, level: 5 },
    ],
  },
  ranger: {
    name: 'Ranger Tree',
    nodes: [
      { id: 'fletcher', name: 'Fletcher', description: '+10% bow damage per rank.', maxRank: 3, level: 1 },
      { id: 'fleet-foot', name: 'Fleet Foot', description: '+6% movement speed per rank.', maxRank: 2, level: 2 },
      { id: 'volley', name: 'Volley', description: 'Fully drawn shots loose two extra arrows.', maxRank: 1, level: 3 },
      { id: 'storm-caller', name: 'Storm Caller', description: 'Sky spells are 20% stronger.', maxRank: 1, level: 4 },
      { id: 'hunters-mark', name: "Hunter's Mark", description: 'Arrows mark targets: +15% damage taken from all sources.', maxRank: 1, level: 5 },
    ],
  },
  trainer: {
    name: 'Trainer Tree',
    nodes: [
      { id: 'pack-bond', name: 'Pack Bond', description: 'Tamed creatures have +25% health per rank.', maxRank: 2, level: 1 },
      { id: 'feral-bite', name: 'Feral Bite', description: 'Tamed creatures deal +20% damage per rank.', maxRank: 2, level: 2 },
      { id: 'whistle', name: 'Whistle', description: 'Tamed creatures regenerate when near you.', maxRank: 1, level: 3 },
      { id: 'second-beast', name: 'Second Beast', description: 'Keep two tamed creatures at once.', maxRank: 1, level: 5 },
      { id: 'fletcher', name: 'Fletcher', description: '+10% bow damage per rank.', maxRank: 2, level: 1 },
    ],
  },
  mage: {
    name: 'Arcane Tree',
    nodes: [
      { id: 'deep-well', name: 'Deep Well', description: '+10 max mana per rank.', maxRank: 3, level: 1 },
      { id: 'focus', name: 'Focus', description: '+10% spell power per rank.', maxRank: 3, level: 2 },
      { id: 'flow', name: 'Flow', description: 'Mana regenerates 30% faster per rank.', maxRank: 2, level: 2 },
      { id: 'quickening', name: 'Quickening', description: 'Spell cooldowns 15% shorter per rank.', maxRank: 2, level: 4 },
      { id: 'harmony', name: 'Harmony', description: 'Combined spells cost 20% less.', maxRank: 1, level: 5 },
    ],
  },
  elemental: {
    name: 'Elemental Tree',
    nodes: [
      { id: 'attunement', name: 'Attunement', description: 'Your element hits 10% harder per rank.', maxRank: 3, level: 1 },
      { id: 'deep-well', name: 'Deep Well', description: '+10 max mana per rank.', maxRank: 3, level: 1 },
      { id: 'flow', name: 'Flow', description: 'Mana regenerates 30% faster per rank.', maxRank: 2, level: 2 },
      { id: 'elemental-ward', name: 'Elemental Ward', description: 'Immune to your own element.', maxRank: 1, level: 4 },
      { id: 'harmony', name: 'Harmony', description: 'Combined spells cost 20% less.', maxRank: 1, level: 5 },
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
