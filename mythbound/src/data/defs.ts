// Game content: classes, subclasses, races, roles, weapons and spells, as
// written in the design notes. The rules that use these live in src/rules/.

export type ClassId = 'warrior' | 'ranger' | 'mage' | 'monk' | 'sorcerer' | 'rogue';
export type SubclassId =
  | 'swordsman' | 'axeman' | 'bowman' | 'trainer' | 'elemental'
  | 'ironfist' | 'windwalker' | 'darkmage' | 'lightmage' | 'shadow' | 'duelist';
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
      'Arts of War (stamina, warriors only): Shield Charge and Ground Slam; Battle Shout at level 6, Unbreakable at 12',
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
      "Hunter's Arts (stamina, rangers only): Arrow Rain and Mark Prey; Snare Trap at level 6, Evasive Leap at 12",
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
  monk: {
    id: 'monk',
    name: 'Monk',
    hp: 105,
    mana: 35,
    blurb: 'Fists, feet and a quiet mind.',
    traits: [
      'Martial arts: hand wraps jab, cross and kick in quick combos; heavy is a palm strike that throws foes back',
      'Fights with hand wraps, quarterstaffs, staves and spears',
      'Chi: mana is chi. Every landed blow restores some; techniques spend it',
      'Fleet: faster, +20 stamina. Rolls become dashes, a backstep is a backflip, and a second jump flips in the air',
      'Flurry of Blows (R): a storm of strikes on the foe in front',
      'Techniques: Palm Shockwave and Meditate (heal)',
    ],
  },
  sorcerer: {
    id: 'sorcerer',
    name: 'Sorcerer',
    hp: 75,
    mana: 80,
    blurb: 'Raw power, poured straight from the soul.',
    traits: [
      'Raw Power: spells hit 20% harder',
      'Channelled spells: hold cast to pour out a beam (it drains mana while held)',
      'Wand and rune-circle master: wand bolts and rune traps cost less mana',
      'Fights with wands, rune circles, staves and daggers',
      'Arcane Surge (R): for 8 s spells cost nothing and hit 25% harder',
      'Walks one of two paths: the Dark Mage or the Light Mage',
    ],
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    hp: 95,
    mana: 30,
    blurb: 'Knives in the dark, gone before the body falls.',
    traits: [
      'Backstab: blows from behind deal +50%; from stealth, triple damage',
      'Daggers and throwing knives hit 15% harder. Fights with daggers, knives, swords and bows',
      'Evasive: rolls are quicker, cheaper and safer',
      'Quiet feet: harder to notice, even more so crouched',
      'Vanish (R): every foe but the great ones loses you; your next strike is an ambush (a backstab, and then some)',
      'Tricks: Smoke Bomb and Poison Blades (poison stacks on foes)',
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
  ironfist: {
    id: 'ironfist',
    classId: 'monk',
    name: 'Iron Fist',
    expansion: false,
    blurb: 'Bones like iron, fists like hammers.',
    traits: ['Starts with level 2 Iron Knuckle wraps', 'Iron Skin: 40% less damage and nothing knocks you down, for 8 s', 'Flurry of Blows and palm strikes hit harder', 'Iron Fist tree'],
  },
  windwalker: {
    id: 'windwalker',
    classId: 'monk',
    name: 'Wind Walker',
    expansion: false,
    blurb: 'Light as a breeze, fast as a gale.',
    traits: ['Starts with a level 2 quarterstaff and hand wraps', 'Cyclone Kick: a leaping spin kick that throws foes into the air', 'Flurry of Blows dashes to the foe first', 'Wind Walker tree'],
  },
  darkmage: {
    id: 'darkmage',
    classId: 'sorcerer',
    name: 'Dark Mage',
    expansion: false,
    blurb: 'Shadow, hunger and curses.',
    traits: ['Shadow Bolt (hold: a volley of three)', 'Life Drain: a channelled beam that heals you', 'Hex: a cursed foe takes more and deals less', 'Summon Shade: your shadow fights beside you'],
  },
  lightmage: {
    id: 'lightmage',
    classId: 'sorcerer',
    name: 'Light Mage',
    expansion: false,
    blurb: 'Radiance that burns the dead and shields the living.',
    traits: ['Radiant Beam: a channelled lance of light (double on dark creatures)', 'Smite Undead: a pillar that crushes the dead and stuns', 'Mending Light: heals you and friends nearby', 'Ward of Dawn: shields you and friends nearby'],
  },
  shadow: {
    id: 'shadow',
    classId: 'rogue',
    name: 'Shadow',
    expansion: false,
    blurb: 'Unseen, unheard, unforgiving.',
    traits: ['Starts with a level 2 dagger and throwing knives', 'Shadowstep: blink behind your target', 'Longer Vanish, deadlier ambushes', 'Shadow tree'],
  },
  duelist: {
    id: 'duelist',
    classId: 'rogue',
    name: 'Duelist',
    expansion: false,
    blurb: 'Steel, footwork and a smile.',
    traits: ['Starts with a level 2 duelling saber and a dagger', 'Parry: turn the next blow aside and riposte for triple damage', 'Quicker light combos', 'Duelist tree'],
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

export type WeaponKind =
  | 'sword' | 'axe' | 'bow' | 'staff' | 'dagger' | 'hammer' | 'trident' | 'bolt'
  | 'greatsword' | 'longsword' | 'spear' | 'battleaxe' | 'knives' | 'wand' | 'runecircle' | 'lyre' | 'horn'
  // Monks: wrapped fists, and the plain fighting staff.
  | 'wraps' | 'quarterstaff';

export type LegendaryId = 'sword-of-mars' | 'bow-of-artemis' | 'master-bolt' | 'staff-of-hecate' | 'hammer-of-hephaestus' | 'trident-of-poseidon';

/** Who sells a weapon (or rune): Brann the smith or Quill the merchant. */
export type ShopId = 'brann' | 'quill';

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
  /** A great foe's unique drop: not a god's weapon, but it takes legend perks like one. */
  legend?: boolean;
  description?: string;
  /** Only these classes can wield it. */
  classes?: ClassId[];
  /** Sold in town for this many embers. */
  price?: number;
  shop?: ShopId;
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
  // Unique drops: anyone can wield them.
  'reapers-edge': {
    id: 'reapers-edge', name: "Reaper's Edge", kind: 'sword', damage: 31, speed: 1.65, range: 3.2, element: 'dark', legend: true,
    description: "Forged from the Reaper's scythe. Cold as the grave; it cuts with darkness. Reaps: its hits heal you for 12% of the damage, foes below half health take 30% more, and every kill gives back 8% of your health.",
  },
  venomfang: {
    id: 'venomfang', name: 'Venomfang', kind: 'dagger', damage: 12, speed: 2.6, range: 2, element: 'earth', legend: true,
    description: "The Giant Spider's fang, wrapped for a grip. Quick, and it bites with the earth.",
  },
  // Sold in Hearthhold: steel at Brann's forge, curios at Quill's stall.
  'steel-longsword': {
    id: 'steel-longsword', name: 'Steel Longsword', kind: 'longsword', damage: 15, speed: 1.35, range: 2.9, element: 'physical', price: 140, shop: 'brann',
    description: 'A hand-and-a-half blade: longer reach than a sword, and its heavy swing takes both hands.',
  },
  'iron-greatsword': {
    id: 'iron-greatsword', name: 'Iron Greatsword', kind: 'greatsword', damage: 25, speed: 0.8, range: 3.3, element: 'physical', classes: ['warrior'], price: 260, shop: 'brann',
    description: 'Huge and slow. Wide sweeps hit everything in front; the heavy slam shakes the ground. Two hands, no shield.',
  },
  'ash-spear': {
    id: 'ash-spear', name: 'Ash Spear', kind: 'spear', damage: 13, speed: 1.3, range: 3.9, element: 'physical', price: 120, shop: 'brann',
    description: 'Thrusts that reach farther than any blade, and a wide heavy sweep that clears the ground around you.',
  },
  'battle-axe': {
    id: 'battle-axe', name: 'Battle Axe', kind: 'battleaxe', damage: 23, speed: 0.85, range: 3, element: 'physical', classes: ['warrior'], price: 240, shop: 'brann',
    description: 'Double-bitted and two-handed. Cleaving sweeps; the heavy whirls it all the way round. Foes bleed.',
  },
  'throwing-knives': {
    id: 'throwing-knives', name: 'Throwing Knives', kind: 'knives', damage: 8, speed: 2.4, range: 32, element: 'physical', price: 110, shop: 'brann',
    description: 'Thrown in quick volleys (heavy: three at once). Pick them back up where they land; resting at a shrine refills them.',
  },
  'willow-wand': {
    id: 'willow-wand', name: 'Willow Wand', kind: 'wand', damage: 7, speed: 2.4, range: 40, element: 'physical', classes: ['mage', 'sorcerer'], price: 150, shop: 'quill',
    description: 'Quick arcane bolts for 2 mana (heavy: a bursting bolt for 7). Your spells hit 15% harder while it is in hand. Mages and sorcerers only.',
  },
  'rune-circle': {
    id: 'rune-circle', name: 'Circle of Runes', kind: 'runecircle', damage: 10, speed: 1.1, range: 24, element: 'physical', classes: ['mage', 'sorcerer'], price: 190, shop: 'quill',
    description: 'A ring of runes orbits your hand. Draw rune traps on the ground that burn and slow foes inside (heavy: a binding seal around you). Mages and sorcerers only.',
  },
  'bards-lyre': {
    id: 'bards-lyre', name: "Bard's Lyre", kind: 'lyre', damage: 9, speed: 1.3, range: 8, element: 'physical', price: 160, shop: 'quill',
    description: 'Strum a chord that dazes foes in front. Heavy: Song of Valor. Friends nearby hit harder and heal; foes are stunned.',
  },
  'war-horn': {
    id: 'war-horn', name: 'War Horn', kind: 'horn', damage: 11, speed: 1, range: 9, element: 'physical', price: 160, shop: 'quill',
    description: 'A blast that sends foes fleeing. Heavy: War Cry. Friends nearby run faster and strike harder; foes cower.',
  },
  // Monks fight with their hands; anyone may take up a quarterstaff.
  'linen-wraps': {
    id: 'linen-wraps', name: 'Linen Hand Wraps', kind: 'wraps', damage: 7, speed: 2.7, range: 1.8, element: 'physical', classes: ['monk'],
    description: 'Wrapped fists: a jab, a cross and a spinning kick. Heavy is a palm strike that throws foes back. Monks only.',
  },
  'iron-knuckles': {
    id: 'iron-knuckles', name: 'Iron Knuckle Wraps', kind: 'wraps', damage: 10, speed: 2.5, range: 1.8, element: 'physical', classes: ['monk'],
    description: 'Wraps sewn over iron knuckles. Every blow lands like a small hammer. Monks only.',
  },
  'tiger-claws': {
    id: 'tiger-claws', name: 'Tiger Claw Wraps', kind: 'wraps', damage: 13, speed: 2.6, range: 1.9, element: 'physical', classes: ['monk'], price: 200, shop: 'brann',
    description: 'Black wraps with three steel claws over the knuckles. Foes bleed. Monks only.',
  },
  'ash-quarterstaff': {
    id: 'ash-quarterstaff', name: 'Ash Quarterstaff', kind: 'quarterstaff', damage: 11, speed: 1.6, range: 3.0, element: 'physical',
    description: 'A plain staff of ash, shod with iron at both ends. Quick sweeps; the heavy whirls it round you.',
  },
  'ironwood-staff': {
    id: 'ironwood-staff', name: 'Ironwood Quarterstaff', kind: 'quarterstaff', damage: 15, speed: 1.5, range: 3.1, element: 'physical', price: 170, shop: 'brann',
    description: 'Dense black ironwood bound in brass. It rings like a bell when it lands.',
  },
  'duelist-saber': {
    id: 'duelist-saber', name: "Duelist's Saber", kind: 'sword', damage: 10, speed: 2.1, range: 2.5, element: 'physical', price: 150, shop: 'brann',
    description: 'Light and quick: made for footwork, feints and ripostes.',
  },
};

// -------------------------------------------------------------------- runes --

export type RuneId = 'fire' | 'frost' | 'storm' | 'venom';

export interface RuneDef {
  id: RuneId;
  name: string;
  /** Glow on the weapon, its trail and its hits. */
  color: number;
  description: string;
  price: number;
}

/** Runes are inscribed on a weapon at an anvil and add their effect to its hits. */
export const RUNES: Record<RuneId, RuneDef> = {
  fire: { id: 'fire', name: 'Ember Rune', color: 0xff6a1a, description: 'Hits set foes burning.', price: 160 },
  frost: { id: 'frost', name: 'Frost Rune', color: 0x7fdcff, description: 'Hits slow foes with frost.', price: 160 },
  storm: { id: 'storm', name: 'Storm Rune', color: 0xb8a8ff, description: 'Hits arc lightning to two foes nearby.', price: 180 },
  venom: { id: 'venom', name: 'Venom Rune', color: 0x7cff3a, description: 'Hits poison foes for a while.', price: 160 },
};

/** The inventory item that holds an uninscribed rune. */
export const runeItem = (id: RuneId) => `rune-${id}`;

export interface WeaponInstance {
  id: string;
  level: number;
  /** A rune inscribed at an anvil. */
  rune?: RuneId;
  /** Legend perks set into a legendary weapon at an anvil, one a slot. */
  perks?: PerkId[];
}

// ------------------------------------------------------------- legend perks --

export type PerkId = 'vampiric' | 'executioner' | 'swiftness' | 'thunderstrike' | 'colossus' | 'soul-feast' | 'ruthless' | 'giant-slayer' | 'bulwark' | 'tempest';

export interface PerkDef {
  id: PerkId;
  name: string;
  icon: string;
  text: string;
}

/** Set into legendary weapons (and the great foes' unique drops) at an anvil with Legend Shards. */
export const PERKS: Record<PerkId, PerkDef> = {
  vampiric: { id: 'vampiric', name: 'Vampiric', icon: '🩸', text: 'Hits heal you for 8% of the damage they deal.' },
  executioner: { id: 'executioner', name: 'Executioner', icon: '💀', text: 'Foes below 35% health take 40% more.' },
  swiftness: { id: 'swiftness', name: 'Swiftness', icon: '💨', text: 'Attacks are 15% faster.' },
  thunderstrike: { id: 'thunderstrike', name: 'Thunderstrike', icon: '⚡', text: 'Every 5th hit calls down lightning on the foe and those around it.' },
  colossus: { id: 'colossus', name: 'Colossus', icon: '🗿', text: '+15% max health while it is in hand.' },
  'soul-feast': { id: 'soul-feast', name: 'Soul Feast', icon: '👻', text: 'Kills restore 10% of your health and mana.' },
  ruthless: { id: 'ruthless', name: 'Ruthless', icon: '🎯', text: '15% chance for a hit to deal double damage.' },
  'giant-slayer': { id: 'giant-slayer', name: 'Giant Slayer', icon: '🐉', text: 'Great foes take 25% more.' },
  bulwark: { id: 'bulwark', name: 'Bulwark', icon: '🛡', text: 'Take 12% less damage while it is in hand.' },
  tempest: { id: 'tempest', name: 'Tempest', icon: '🌪', text: 'Hits have a 20% chance to knock foes back and slow them.' },
};

/** The pack item that pays for legend perks: dropped by great foes on Heroic and harder. */
export const LEGEND_SHARD = 'legend-shard';

// ------------------------------------------------------------------ relics --

export type RelicId = 'leviathan-pearl' | 'dragon-heart' | 'tide-crown';

/** Won from the three elder foes: kept in the pack, each grants a lasting boon to any hero. */
export const RELICS: Record<RelicId, { id: RelicId; name: string; boon: string }> = {
  'leviathan-pearl': { id: 'leviathan-pearl', name: 'Pearl of the Leviathan', boon: '+1 flask, and you swim without tiring.' },
  'tide-crown': { id: 'tide-crown', name: 'Crown of the Tides', boon: '+20 max mana, mana flows 30% faster, and water hurts you half as much.' },
  'dragon-heart': { id: 'dragon-heart', name: 'Heart of the Elder Dragon', boon: '+30 max HP, and fire hurts you half as much.' },
};

// ------------------------------------------------------------------ spells --

/** chi: a monk's techniques; shadow: the Dark Mage's; trick: a rogue's; martial: a warrior's arts of war; hunt: a ranger's. */
export type SpellSchool = 'devil' | 'fire' | 'water' | 'sky' | 'light' | 'arcane' | 'earth' | 'chi' | 'shadow' | 'trick' | 'martial' | 'hunt';

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
  | 'moonveil'
  // Monk techniques.
  | 'palm-shockwave'
  | 'meditate'
  | 'iron-skin'
  | 'cyclone-kick'
  // Sorcerer: the Dark Mage and the Light Mage.
  | 'shadow-bolt'
  | 'life-drain'
  | 'hex'
  | 'summon-shade'
  | 'radiant-beam'
  | 'smite-undead'
  | 'mending-light'
  | 'ward-of-dawn'
  // Rogue tricks.
  | 'smoke-bomb'
  | 'poison-blades'
  | 'shadowstep'
  | 'parry'
  // Warrior arts of war (stamina, warriors only).
  | 'shield-charge'
  | 'ground-slam'
  | 'battle-shout'
  | 'unbreakable'
  // Ranger hunter's arts (stamina, rangers only).
  | 'arrow-rain'
  | 'mark-prey'
  | 'snare-trap'
  | 'evasive-leap';

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
  /** Held: a beam that costs `mana` and deals `power` every channel tick while the cast button is held. */
  channel?: boolean;
  /** Paid in stamina instead of mana (the warrior's and the ranger's arts). */
  stamina?: number;
  /** Learnt on reaching this level (the warrior's and the ranger's arts). */
  level?: number;
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
  // ---- Monk techniques (chi is the monk's mana).
  'palm-shockwave': {
    id: 'palm-shockwave', name: 'Palm Shockwave', school: 'chi', element: 'wind', mana: 10, cooldown: 5, power: 24,
    description: 'A palm thrust that looses a cone of force: foes in front are hurled back and staggered.',
  },
  meditate: {
    id: 'meditate', name: 'Meditate', school: 'chi', element: 'light', mana: 0, cooldown: 30, power: 0,
    description: 'Sit and breathe for up to 4 seconds: heal 9% of your health and 8 chi a second. Moving, striking or being hit ends it.',
  },
  'iron-skin': {
    id: 'iron-skin', name: 'Iron Skin', school: 'chi', element: 'earth', mana: 14, cooldown: 24, power: 0,
    description: 'For 8 seconds take 40% less damage, and nothing staggers you or knocks you down.',
  },
  'cyclone-kick': {
    id: 'cyclone-kick', name: 'Cyclone Kick', school: 'chi', element: 'wind', mana: 12, cooldown: 6, power: 26,
    description: 'Leap and spin: a whirling kick that strikes all around and throws foes into the air.',
  },
  // ---- Dark Mage.
  'shadow-bolt': {
    id: 'shadow-bolt', name: 'Shadow Bolt', school: 'shadow', element: 'dark', mana: 8, cooldown: 0.8, power: 26,
    description: 'A fast bolt of shadow. Hold to loose three in a fan (for triple the mana).',
  },
  'life-drain': {
    id: 'life-drain', name: 'Life Drain', school: 'shadow', element: 'dark', mana: 3, cooldown: 1, power: 6, channel: true,
    description: 'Hold to pour a dark beam into a foe: it withers, and you heal half of what it loses. Costs mana while held.',
  },
  hex: {
    id: 'hex', name: 'Hex', school: 'shadow', element: 'dark', mana: 14, cooldown: 8, power: 0,
    description: 'Curse a foe for 12 seconds: it takes 25% more damage and deals 25% less. If it dies cursed, the hex leaps to a foe nearby.',
  },
  'summon-shade': {
    id: 'summon-shade', name: 'Summon Shade', school: 'shadow', element: 'dark', mana: 22, cooldown: 30, power: 10,
    description: 'Your shadow tears free and fights beside you for 25 seconds.',
  },
  // ---- Light Mage.
  'radiant-beam': {
    id: 'radiant-beam', name: 'Radiant Beam', school: 'light', element: 'light', mana: 3, cooldown: 1, power: 6, channel: true,
    description: 'Hold to pour a lance of light into a foe (double against dark creatures). Costs mana while held.',
  },
  'smite-undead': {
    id: 'smite-undead', name: 'Smite Undead', school: 'light', element: 'light', mana: 14, cooldown: 6, power: 34,
    description: 'A pillar of light on your target. Dark creatures and the dead take 50% more and are stunned.',
  },
  'mending-light': {
    id: 'mending-light', name: 'Mending Light', school: 'light', element: 'light', mana: 16, cooldown: 10, power: 40,
    description: 'Heals you, your beasts, and co-op friends within 12 m.',
  },
  'ward-of-dawn': {
    id: 'ward-of-dawn', name: 'Ward of Dawn', school: 'light', element: 'light', mana: 18, cooldown: 22, power: 30,
    description: 'A shield of light on you and co-op friends within 12 m. It soaks up damage for 10 seconds.',
  },
  // ---- Rogue tricks.
  'smoke-bomb': {
    id: 'smoke-bomb', name: 'Smoke Bomb', school: 'trick', element: 'physical', mana: 10, cooldown: 16, power: 0,
    description: 'Throw a smoke bomb: for 6 seconds foes in the cloud lose sight of everyone and stumble slowly, and inside it you are nearly invisible.',
  },
  'poison-blades': {
    id: 'poison-blades', name: 'Poison Blades', school: 'trick', element: 'earth', mana: 10, cooldown: 24, power: 0,
    description: 'Coat your blades for 20 seconds: blows and thrown knives poison foes. Poison stacks up to three times.',
  },
  shadowstep: {
    id: 'shadowstep', name: 'Shadowstep', school: 'trick', element: 'dark', mana: 10, cooldown: 8, power: 0,
    description: 'Blink behind your target (up to 16 m away), facing its back.',
  },
  parry: {
    id: 'parry', name: 'Parry', school: 'trick', element: 'physical', mana: 6, cooldown: 5, power: 0,
    description: 'Raise your blade for a heartbeat: the next blow is turned aside, and you riposte for triple damage.',
  },
  // ---- Warrior arts of war: paid in stamina, and warriors alone know them.
  'shield-charge': {
    id: 'shield-charge', name: 'Shield Charge', school: 'martial', element: 'physical', mana: 0, stamina: 25, level: 1, cooldown: 9, power: 1.6,
    description: 'Charge at a foe up to 14 m away and crash into it: it is stunned and thrown back, and anything in your path is knocked aside.',
  },
  'ground-slam': {
    id: 'ground-slam', name: 'Ground Slam', school: 'martial', element: 'earth', mana: 0, stamina: 30, level: 1, cooldown: 12, power: 2,
    description: 'Leap and bring your weapon down: the ground cracks, and every foe within 5 m is hurt and thrown up.',
  },
  'battle-shout': {
    id: 'battle-shout', name: 'Battle Shout', school: 'martial', element: 'physical', mana: 0, stamina: 20, level: 6, cooldown: 35, power: 0,
    description: 'A roar that steels you and co-op friends nearby: +25% damage and stamina flows back for 12 seconds. Lesser foes near you cower.',
  },
  unbreakable: {
    id: 'unbreakable', name: 'Unbreakable', school: 'martial', element: 'physical', mana: 0, stamina: 35, level: 12, cooldown: 75, power: 0,
    description: 'For 7 seconds you take half damage and cannot fall below 1 health, and you heal 25% of your health over that time.',
  },
  // ---- Ranger hunter's arts: paid in stamina, and rangers alone know them.
  'arrow-rain': {
    id: 'arrow-rain', name: 'Arrow Rain', school: 'hunt', element: 'physical', mana: 0, stamina: 25, level: 1, cooldown: 12, power: 0.55,
    description: 'Loose a flight of arrows high into the sky: they rain down on the spot you aim at, striking every foe within 5 m six times. Costs no arrows.',
  },
  'mark-prey': {
    id: 'mark-prey', name: 'Mark Prey', school: 'hunt', element: 'physical', mana: 0, stamina: 10, level: 1, cooldown: 10, power: 0,
    description: 'Mark a foe for 15 seconds: it takes 15% more from everyone and 25% more from you, it cannot hide from you, and killing it gives back stamina.',
  },
  'snare-trap': {
    id: 'snare-trap', name: 'Snare Trap', school: 'hunt', element: 'physical', mana: 0, stamina: 20, level: 6, cooldown: 14, power: 1.2,
    description: 'Throw a snare: it springs where it lands, cutting and holding fast every foe within 3.5 m for 3 seconds (great foes for 1).',
  },
  'evasive-leap': {
    id: 'evasive-leap', name: 'Evasive Leap', school: 'hunt', element: 'wind', mana: 0, stamina: 18, level: 12, cooldown: 8, power: 0,
    description: 'Spring back out of harm (untouchable in the air). Your next shot or blow within 4 seconds deals double damage.',
  },
};

/** The warrior's arts of war and the ranger's hunter's arts, by class. */
export const CLASS_ARTS: Partial<Record<ClassId, SpellId[]>> = {
  warrior: ['shield-charge', 'ground-slam', 'battle-shout', 'unbreakable'],
  ranger: ['arrow-rain', 'mark-prey', 'snare-trap', 'evasive-leap'],
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

/** The elements heroes can join in a team combo (physical and true damage never combine). */
export type ComboElement = 'fire' | 'water' | 'wind' | 'earth' | 'lightning' | 'light' | 'dark';
export const COMBO_ELEMENTS: ComboElement[] = ['fire', 'water', 'wind', 'earth', 'lightning', 'light', 'dark'];

/**
 * A team combo: two heroes strike the same foe with two different elements
 * in quick succession (co-op). `power` is the bonus as a share of both
 * blows; it bursts on every foe within `radius` (half to those around).
 * The effects are seconds of each status, or for lift/shove a force,
 * mend a share of max health and drain a share of the bonus, for both heroes.
 */
export interface TeamComboDef {
  id: string;
  name: string;
  elements: [ComboElement, ComboElement];
  element: DamageElement;
  power: number;
  radius: number;
  effect: {
    burn?: number; blind?: number; root?: number; slow?: number; stun?: number; fear?: number; hex?: number; wet?: number;
    lift?: number; shove?: number; pull?: number; mend?: number; drain?: number; vsDark?: number;
  };
  description: string;
}

/** What two heroes' elements make together on the same foe. Every pair of the seven has one. */
export const TEAM_COMBOS: TeamComboDef[] = [
  { id: 'scalding-steam', name: 'Scalding Steam', elements: ['fire', 'water'], element: 'fire', power: 0.6, radius: 4, effect: { blind: 3, burn: 2 }, description: 'Steam scalds and blinds every foe nearby.' },
  { id: 'wildfire', name: 'Wildfire', elements: ['fire', 'wind'], element: 'fire', power: 0.6, radius: 6, effect: { burn: 5 }, description: 'The wind carries the flames to every foe around.' },
  { id: 'magma-burst', name: 'Magma Burst', elements: ['fire', 'earth'], element: 'fire', power: 0.8, radius: 3.5, effect: { burn: 3, lift: 7 }, description: 'Molten rock bursts up under them.' },
  { id: 'plasma-blast', name: 'Plasma Blast', elements: ['fire', 'lightning'], element: 'lightning', power: 1, radius: 4, effect: { stun: 0.8, burn: 2 }, description: 'A searing blast that stuns and burns.' },
  { id: 'solar-flare', name: 'Solar Flare', elements: ['fire', 'light'], element: 'light', power: 0.7, radius: 4.5, effect: { blind: 3, burn: 3 }, description: 'A flare like the sun: blinding and burning.' },
  { id: 'hellfire', name: 'Hellfire', elements: ['fire', 'dark'], element: 'fire', power: 0.8, radius: 4, effect: { burn: 4, fear: 2.5 }, description: 'Black flames that burn and terrify.' },
  { id: 'blizzard', name: 'Blizzard', elements: ['water', 'wind'], element: 'water', power: 0.6, radius: 5, effect: { root: 2.5, slow: 5, wet: 4 }, description: 'A freezing gale: foes freeze where they stand.' },
  { id: 'quagmire', name: 'Quagmire', elements: ['water', 'earth'], element: 'earth', power: 0.5, radius: 5, effect: { root: 3, slow: 6 }, description: 'The ground turns to sucking mud.' },
  { id: 'conduction', name: 'Conduction', elements: ['water', 'lightning'], element: 'lightning', power: 0.9, radius: 6, effect: { stun: 1.5, wet: 3 }, description: 'Lightning races through the water: every soaked foe is stunned.' },
  { id: 'holy-tide', name: 'Holy Tide', elements: ['water', 'light'], element: 'light', power: 0.5, radius: 4, effect: { slow: 3, mend: 0.12 }, description: 'A shining wave that slows foes and mends you both.' },
  { id: 'black-tide', name: 'Black Tide', elements: ['water', 'dark'], element: 'dark', power: 0.6, radius: 4, effect: { slow: 4, drain: 0.3 }, description: 'Dark water drags at foes and feeds you both their life.' },
  { id: 'sandstorm', name: 'Sandstorm', elements: ['wind', 'earth'], element: 'earth', power: 0.5, radius: 5.5, effect: { blind: 4, slow: 3 }, description: 'Whirling sand blinds and slows everything in it.' },
  { id: 'tempest', name: 'Tempest', elements: ['wind', 'lightning'], element: 'lightning', power: 0.8, radius: 7, effect: { stun: 1 }, description: 'A storm that strikes every foe far around.' },
  { id: 'radiant-gale', name: 'Radiant Gale', elements: ['wind', 'light'], element: 'light', power: 0.5, radius: 5, effect: { shove: 14, mend: 0.08 }, description: 'A blast of light hurls foes away and mends you both.' },
  { id: 'howling-void', name: 'Howling Void', elements: ['wind', 'dark'], element: 'dark', power: 0.6, radius: 5, effect: { pull: 9, fear: 3 }, description: 'A shrieking void drags foes together, terrified.' },
  { id: 'thunderquake', name: 'Thunderquake', elements: ['earth', 'lightning'], element: 'lightning', power: 0.8, radius: 4.5, effect: { stun: 1.5, lift: 5 }, description: 'The ground thunders and throws foes up, stunned.' },
  { id: 'hallowed-ground', name: 'Hallowed Ground', elements: ['earth', 'light'], element: 'light', power: 0.6, radius: 4, effect: { root: 2, mend: 0.1 }, description: 'Holy stone holds foes fast and mends you both.' },
  { id: 'grave-grip', name: 'Grave Grip', elements: ['earth', 'dark'], element: 'dark', power: 0.7, radius: 4, effect: { root: 3, drain: 0.25 }, description: 'Hands from the grave hold foes and drain them for you both.' },
  { id: 'judgement', name: 'Judgement', elements: ['lightning', 'light'], element: 'light', power: 1.2, radius: 3, effect: { stun: 1, vsDark: 2 }, description: 'Holy lightning: twice as hard on creatures of the dark.' },
  { id: 'black-lightning', name: 'Black Lightning', elements: ['lightning', 'dark'], element: 'lightning', power: 0.9, radius: 5, effect: { hex: 6, stun: 0.8 }, description: 'Cursed lightning hexes foes: they take more from everyone.' },
  { id: 'eclipse', name: 'Eclipse', elements: ['light', 'dark'], element: 'true', power: 1.5, radius: 5, effect: {}, description: 'Light and dark collide: it harms everything, whatever it resists.' },
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

export type TreeId =
  | 'swordsman' | 'axeman' | 'bowman' | 'ranger' | 'trainer' | 'mage' | 'elemental'
  // The newer classes have a class tree and a tree for each subclass, and learn from both.
  | 'monk' | 'ironfist' | 'windwalker' | 'sorcerer' | 'darkmage' | 'lightmage' | 'rogue' | 'shadow' | 'duelist';

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
const LUNGE: Shared = { id: 'lunge', name: 'Lunge', icon: '➤', maxRank: 1, level: 4, description: 'Heavy attacks dash forward.' };

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
  // ------------------------------------------------------------------ monk --
  monk: {
    name: 'Way of the Fist',
    nodes: [
      { id: 'open-palm', name: 'Open Palm', icon: '✋', tier: 1, col: 0, maxRank: 3, level: 1, description: '+10% damage with hand wraps and quarterstaffs per rank.', per: '+{10}% hand-wrap and quarterstaff damage.' },
      { id: 'inner-peace', name: 'Inner Peace', icon: '☯', tier: 1, col: 1, maxRank: 2, level: 1, description: 'Kills restore 50% more health, chi and stamina per rank.', per: 'Kills restore {50}% more.' },
      { id: 'tempered-body', name: 'Tempered Body', icon: '🧘', tier: 1, col: 2, maxRank: 3, level: 1, description: '+14 max health per rank.', per: '+{14} max health.' },
      { id: 'swift-strikes', name: 'Swift Strikes', icon: '👊', tier: 2, col: 0, maxRank: 2, level: 2, req: ['open-palm'], description: 'Light attacks are 8% faster per rank.', per: 'Light attacks are {8}% faster.' },
      { id: 'chi-flow', name: 'Chi Flow', icon: '🌀', tier: 2, col: 1, maxRank: 2, level: 2, req: ['inner-peace'], description: 'Landed blows restore 1 more chi per rank.', per: 'Landed blows restore {1} more chi.' },
      at(FLEET_FOOT, 2, 2, { req: ['tempered-body'] }),
      { id: 'roundhouse', name: 'Roundhouse', icon: '🦶', tier: 3, col: 0, maxRank: 1, level: 4, req: ['swift-strikes'], description: 'Your combo finisher reaches 30% farther and knocks foes back.' },
      { id: 'deep-breath', name: 'Deep Breath', icon: '🌬', tier: 3, col: 1, maxRank: 1, level: 4, req: ['chi-flow'], description: 'Meditate heals 30% faster and recharges 30% sooner.' },
      at(TUMBLE, 3, 2, { req: ['fleet-foot'], level: 4 }),
      { id: 'pressure-points', name: 'Pressure Points', icon: '📍', tier: 4, col: 0, maxRank: 2, level: 8, req: ['roundhouse'], description: 'Combo finishers stun foes for 0.6 s per rank (half as long on great foes).', per: 'Finishers stun for {0.6} s.' },
      { id: 'diamond-soul', name: 'Diamond Soul', icon: '💎', tier: 4, col: 2, maxRank: 2, level: 8, req: ['tumble'], description: 'Take 7% less damage per rank.', per: 'Take {7}% less damage.' },
      { id: 'grandmaster', name: 'Grandmaster', icon: '🥋', tier: 5, col: 1, maxRank: 1, level: 12, req: ['deep-breath'], description: '+15% melee damage, and Flurry of Blows hits 30% harder.' },
    ],
  },
  ironfist: {
    name: 'Iron Fist Tree',
    nodes: [
      { id: 'stone-fists', name: 'Stone Fists', icon: '🪨', tier: 1, col: 0, maxRank: 3, level: 1, description: 'Flurry of Blows hits 12% harder per rank.', per: 'Flurry of Blows hits {12}% harder.' },
      { id: 'hard-palm', name: 'Hard Palm', icon: '✊', tier: 1, col: 1, maxRank: 2, level: 1, description: 'Heavy palm strikes hit 15% harder per rank.', per: 'Palm strikes hit {15}% harder.' },
      { id: 'iron-will', name: 'Iron Will', icon: '🛡', tier: 1, col: 2, maxRank: 2, level: 1, description: '+20 max health per rank.', per: '+{20} max health.' },
      { id: 'quaking-palm', name: 'Quaking Palm', icon: '〰', tier: 2, col: 0, maxRank: 2, level: 2, req: ['stone-fists'], description: 'Palm Shockwave reaches 25% farther per rank.', per: 'Palm Shockwave reaches {25}% farther.' },
      { id: 'iron-guard', name: 'Iron Guard', icon: '🤜', tier: 2, col: 2, maxRank: 2, level: 2, req: ['iron-will'], description: 'Your guard turns aside 15% more of each blow per rank.', per: 'Guarding turns aside {15}% more.' },
      { id: 'unstoppable', name: 'Unstoppable', icon: '🗿', tier: 3, col: 1, maxRank: 1, level: 5, req: ['hard-palm'], description: 'Iron Skin lasts 4 seconds longer.' },
      { id: 'counter-strike', name: 'Counter Strike', icon: '↩', tier: 3, col: 2, maxRank: 1, level: 5, req: ['iron-guard'], description: 'Blocking a blow stuns the attacker.' },
      { id: 'shattering-blow', name: 'Shattering Blow', icon: '💥', tier: 4, col: 0, maxRank: 1, level: 8, req: ['quaking-palm'], description: 'Palm strikes deal double damage to stunned foes.' },
      { id: 'mountain-stance', name: 'Mountain Stance', icon: '⛰', tier: 4, col: 2, maxRank: 2, level: 8, req: ['counter-strike'], description: 'Take 8% less damage per rank.', per: 'Take {8}% less damage.' },
      { id: 'hundred-fists', name: 'Hundred Fists', icon: '👐', tier: 5, col: 1, maxRank: 1, level: 12, req: ['unstoppable'], description: 'Every punch of Flurry of Blows lands twice.' },
    ],
  },
  windwalker: {
    name: 'Wind Walker Tree',
    nodes: [
      { id: 'gale-step', name: 'Gale Step', icon: '💨', tier: 1, col: 0, maxRank: 2, level: 1, description: 'Dashes carry you 20% farther per rank.', per: 'Dashes carry you {20}% farther.' },
      { id: 'zephyr', name: 'Zephyr', icon: '🍃', tier: 1, col: 1, maxRank: 2, level: 1, description: '+5% movement speed per rank.', per: '+{5}% movement speed.' },
      { id: 'whirling-staff', name: 'Whirling Staff', icon: '🥢', tier: 1, col: 2, maxRank: 2, level: 1, description: 'The quarterstaff whirl reaches 25% farther and hits 15% harder per rank.', per: 'The whirl reaches {25}% farther and hits {15}% harder.' },
      { id: 'cyclone', name: 'Cyclone', icon: '🌪', tier: 2, col: 0, maxRank: 2, level: 2, req: ['gale-step'], description: 'Cyclone Kick hits 20% harder per rank.', per: 'Cyclone Kick hits {20}% harder.' },
      { id: 'feather-fall', name: 'Feather Fall', icon: '🪶', tier: 2, col: 1, maxRank: 1, level: 3, req: ['zephyr'], description: 'No more fall damage, and you can flip twice in the air.' },
      { id: 'wind-blades', name: 'Wind Blades', icon: '🗡', tier: 3, col: 0, maxRank: 1, level: 5, req: ['cyclone'], description: 'Dashing through foes cuts them for half your weapon damage.' },
      { id: 'tailwind', name: 'Tailwind', icon: '🎐', tier: 3, col: 2, maxRank: 1, level: 4, req: ['whirling-staff'], description: 'Kills give 4 seconds of +30% speed.' },
      { id: 'storm-kick', name: 'Storm Kick', icon: '🌩', tier: 4, col: 0, maxRank: 1, level: 8, req: ['wind-blades'], description: 'Flurry of Blows ends in a gust that hurls foes back.' },
      { id: 'eye-of-the-storm', name: 'Eye of the Storm', icon: '👁', tier: 4, col: 1, maxRank: 2, level: 8, req: ['feather-fall'], description: 'Dodging a blow with a dash or flip restores 10 stamina and 3 chi per rank.', per: 'A dodge restores {10} stamina and {3} chi.' },
      { id: 'avatar-of-wind', name: 'Avatar of Wind', icon: '🌀', tier: 5, col: 1, maxRank: 1, level: 12, req: ['eye-of-the-storm'], description: '+10% movement speed, and dashes cost half the stamina.' },
    ],
  },
  // -------------------------------------------------------------- sorcerer --
  sorcerer: {
    name: 'Sorcery',
    nodes: [
      { id: 'focus', name: 'Focus', icon: '🔆', tier: 1, col: 0, maxRank: 3, level: 1, description: '+10% spell power per rank.', per: '+{10}% spell power.' },
      at(SOUL_HARVEST, 1, 1),
      at(DEEP_WELL, 1, 2),
      { id: 'channeler', name: 'Channeler', icon: '📡', tier: 2, col: 0, maxRank: 2, level: 2, req: ['focus'], description: 'Channelled beams cost 15% less mana per rank.', per: 'Channelled beams cost {15}% less mana.' },
      at(FLOW, 2, 1, { req: ['soul-harvest'] }),
      at(HARDY, 2, 2, { req: ['deep-well'] }),
      { id: 'wandcraft', name: 'Wandcraft', icon: '🪄', tier: 3, col: 0, maxRank: 2, level: 4, req: ['channeler'], description: 'Wand bolts and rune traps hit 20% harder per rank.', per: 'Wand bolts and rune traps hit {20}% harder.' },
      { id: 'surge-mastery', name: 'Surge Mastery', icon: '⚡', tier: 3, col: 1, maxRank: 1, level: 5, req: ['flow'], description: 'Arcane Surge lasts 4 seconds longer and recharges 20% sooner.' },
      at(ARCANE_WARD, 3, 2, { req: ['hardy'] }),
      at(ARCANE_MASTERY, 4, 0, { req: ['wandcraft'] }),
      { id: 'mana-shield', name: 'Mana Shield', icon: '💠', tier: 4, col: 2, maxRank: 1, level: 9, req: ['arcane-ward'], description: 'A fifth of the damage you take drains mana instead of health.' },
      { id: 'overflow', name: 'Overflow', icon: '🌊', tier: 5, col: 1, maxRank: 1, level: 12, req: ['surge-mastery'], description: '+15% spell power, and channelled beams reach 30% farther.' },
    ],
  },
  darkmage: {
    name: 'Dark Mage Tree',
    nodes: [
      { id: 'umbral-power', name: 'Umbral Power', icon: '🌑', tier: 1, col: 0, maxRank: 3, level: 1, description: 'Shadow spells hit 10% harder per rank.', per: 'Shadow spells hit {10}% harder.' },
      { id: 'hunger', name: 'Hunger', icon: '🩸', tier: 1, col: 1, maxRank: 2, level: 1, description: 'Life Drain heals 20% more per rank.', per: 'Life Drain heals {20}% more.' },
      { id: 'shadow-shroud', name: 'Shadow Shroud', icon: '🦇', tier: 1, col: 2, maxRank: 2, level: 1, description: 'Take 6% less damage per rank.', per: 'Take {6}% less damage.' },
      { id: 'hexer', name: 'Hexer', icon: '🕯', tier: 2, col: 0, maxRank: 1, level: 2, req: ['umbral-power'], description: 'Hex lasts 5 seconds longer.' },
      { id: 'shade-lord', name: 'Shade Lord', icon: '👤', tier: 2, col: 1, maxRank: 2, level: 3, req: ['hunger'], description: 'Your shade has 30% more health and damage per rank.', per: 'Your shade has {30}% more health and damage.' },
      { id: 'withering', name: 'Withering', icon: '🥀', tier: 3, col: 0, maxRank: 1, level: 5, req: ['hexer'], description: 'Shadow Bolts slow foes for 1.5 seconds.' },
      { id: 'soul-siphon', name: 'Soul Siphon', icon: '👻', tier: 3, col: 1, maxRank: 1, level: 5, req: ['shade-lord'], description: 'Killing a hexed foe restores 10 mana.' },
      { id: 'death-grip', name: 'Death Grip', icon: '🖐', tier: 3, col: 2, maxRank: 1, level: 4, req: ['shadow-shroud'], description: 'Life Drain also slows its target.' },
      { id: 'plague-hex', name: 'Plague Hex', icon: '☣', tier: 4, col: 0, maxRank: 1, level: 8, req: ['withering'], description: 'When a hexed foe dies, the hex leaps to two foes instead of one.' },
      { id: 'second-shade', name: 'Second Shade', icon: '👥', tier: 4, col: 1, maxRank: 1, level: 8, req: ['soul-siphon'], description: 'Summon Shade calls two shades.' },
      { id: 'lord-of-shadows', name: 'Lord of Shadows', icon: '♛', tier: 5, col: 1, maxRank: 1, level: 12, req: ['second-shade'], description: 'Shadow spells cost 20% less and hit 15% harder.' },
    ],
  },
  lightmage: {
    name: 'Light Mage Tree',
    nodes: [
      { id: 'radiance', name: 'Radiance', icon: '☀', tier: 1, col: 0, maxRank: 3, level: 1, description: 'Light spells hit 10% harder per rank.', per: 'Light spells hit {10}% harder.' },
      { id: 'gentle-hands', name: 'Gentle Hands', icon: '🤲', tier: 1, col: 1, maxRank: 2, level: 1, description: 'Mending Light heals 15% more per rank.', per: 'Mending Light heals {15}% more.' },
      { id: 'sanctified', name: 'Sanctified', icon: '✝', tier: 1, col: 2, maxRank: 2, level: 1, description: 'Take 6% less damage per rank.', per: 'Take {6}% less damage.' },
      { id: 'searing-light', name: 'Searing Light', icon: '🔦', tier: 2, col: 0, maxRank: 1, level: 2, req: ['radiance'], description: 'Radiant Beam dazzles: foes under it are slowed.' },
      { id: 'beacon', name: 'Beacon', icon: '🗼', tier: 2, col: 1, maxRank: 1, level: 3, req: ['gentle-hands'], description: 'Mending Light and Ward of Dawn reach 50% farther.' },
      { id: 'dawn-ward', name: 'Dawn Ward', icon: '🔰', tier: 2, col: 2, maxRank: 2, level: 2, req: ['sanctified'], description: 'Ward of Dawn soaks up 25% more per rank.', per: 'Ward of Dawn soaks up {25}% more.' },
      { id: 'judgement', name: 'Judgement', icon: '⚖', tier: 3, col: 0, maxRank: 1, level: 5, req: ['searing-light'], description: 'Smite Undead strikes every foe within 3 m of the target and stuns 1 second longer.' },
      { id: 'renewal', name: 'Renewal', icon: '🌱', tier: 3, col: 1, maxRank: 1, level: 5, req: ['beacon'], description: 'Mending Light keeps healing: 30% more over 5 seconds.' },
      { id: 'aegis-ward', name: 'Aegis Ward', icon: '🛡', tier: 3, col: 2, maxRank: 1, level: 5, req: ['dawn-ward'], description: 'While Ward of Dawn holds, it mends 2% of your health a second.' },
      { id: 'sunfire', name: 'Sunfire', icon: '🔥', tier: 4, col: 0, maxRank: 1, level: 8, req: ['judgement'], description: 'Light spells set dark creatures burning.' },
      { id: 'saint', name: 'Saint', icon: '😇', tier: 5, col: 1, maxRank: 1, level: 12, req: ['renewal'], description: 'Light spells cost 20% less, and heals and wards are 20% stronger.' },
    ],
  },
  // ----------------------------------------------------------------- rogue --
  rogue: {
    name: "Rogue's Tree",
    nodes: [
      { id: 'sharp-knives', name: 'Sharp Knives', icon: '🔪', tier: 1, col: 0, maxRank: 3, level: 1, description: 'Daggers and throwing knives hit 10% harder per rank.', per: 'Daggers and knives hit {10}% harder.' },
      { id: 'cutpurse', name: 'Cutpurse', icon: '💰', tier: 1, col: 1, maxRank: 2, level: 1, description: 'Kills restore 50% more health, mana and stamina, and foes drop 15% more embers, per rank.', per: 'Kills restore {50}% more; foes drop {15}% more embers.' },
      at(TRAIL_RUNNER, 1, 2),
      { id: 'lethality', name: 'Lethality', icon: '🎯', tier: 2, col: 0, maxRank: 2, level: 2, req: ['sharp-knives'], description: 'Backstabs deal 20% more per rank.', per: 'Backstabs deal {20}% more.' },
      { id: 'soft-steps', name: 'Soft Steps', icon: '👣', tier: 2, col: 1, maxRank: 2, level: 2, req: ['cutpurse'], description: 'Foes take 25% longer to notice you per rank.', per: 'Foes take {25}% longer to notice you.' },
      at(HARDY, 2, 2, { req: ['trail-runner'] }),
      { id: 'venomous', name: 'Venomous', icon: '🐍', tier: 3, col: 0, maxRank: 2, level: 4, req: ['lethality'], description: 'Your poison deals 25% more damage per rank.', per: 'Your poison deals {25}% more damage.' },
      { id: 'escape-artist', name: 'Escape Artist', icon: '🎩', tier: 3, col: 1, maxRank: 1, level: 5, req: ['soft-steps'], description: 'Vanish recharges 25% sooner.' },
      at(TUMBLE, 3, 2, { req: ['hardy'], level: 4 }),
      { id: 'cheap-shot', name: 'Cheap Shot', icon: '🥊', tier: 4, col: 0, maxRank: 2, level: 8, req: ['venomous'], description: 'Blows on stunned or poisoned foes deal 15% more per rank.', per: 'Stunned or poisoned foes take {15}% more.' },
      { id: 'slippery', name: 'Slippery', icon: '🫧', tier: 4, col: 2, maxRank: 2, level: 8, req: ['tumble'], description: 'Rolling through a blow restores 10 stamina per rank.', per: 'A dodge restores {10} stamina.' },
      { id: 'master-thief', name: 'Master Thief', icon: '🗝', tier: 5, col: 1, maxRank: 1, level: 12, req: ['escape-artist'], description: 'Daggers and knives hit 15% harder, and Vanish lasts 3 seconds longer.' },
    ],
  },
  shadow: {
    name: 'Shadow Tree',
    nodes: [
      { id: 'night-blade', name: 'Night Blade', icon: '🌒', tier: 1, col: 0, maxRank: 3, level: 1, description: 'Ambushes out of Vanish deal 20% more per rank.', per: 'Ambushes deal {20}% more.' },
      { id: 'blink', name: 'Blink', icon: '✨', tier: 1, col: 1, maxRank: 2, level: 1, description: 'Shadowstep recharges 20% sooner per rank.', per: 'Shadowstep recharges {20}% sooner.' },
      { id: 'thick-smoke', name: 'Thick Smoke', icon: '🌫', tier: 1, col: 2, maxRank: 2, level: 1, description: 'Smoke Bomb clouds are 30% wider per rank.', per: 'Smoke clouds are {30}% wider.' },
      { id: 'knife-rain', name: 'Knife Rain', icon: '🌧', tier: 2, col: 0, maxRank: 1, level: 3, req: ['night-blade'], description: 'Heavy throws loose two more knives.' },
      { id: 'shadow-veil', name: 'Shadow Veil', icon: '🕶', tier: 2, col: 2, maxRank: 2, level: 2, req: ['thick-smoke'], description: 'Vanish lasts 2 seconds longer per rank.', per: 'Vanish lasts {2} s longer.' },
      { id: 'death-mark', name: 'Death Mark', icon: '☠', tier: 3, col: 0, maxRank: 1, level: 5, req: ['knife-rain'], description: 'Shadowstep marks its target: it takes 15% more damage for 6 seconds.' },
      { id: 'ghost', name: 'Ghost', icon: '👻', tier: 3, col: 1, maxRank: 1, level: 5, req: ['blink'], description: 'After a Shadowstep you are unseen for 2 seconds.' },
      { id: 'assassinate', name: 'Assassinate', icon: '⚰', tier: 4, col: 0, maxRank: 1, level: 8, req: ['death-mark'], description: 'An ambush on a foe below 40% health kills it outright (not great foes).' },
      { id: 'phantom', name: 'Phantom', icon: '🌀', tier: 4, col: 2, maxRank: 1, level: 8, req: ['shadow-veil'], description: 'Kills while vanished stretch Vanish by 2 seconds.' },
      { id: 'living-shadow', name: 'Living Shadow', icon: '🖤', tier: 5, col: 1, maxRank: 1, level: 12, req: ['ghost'], description: 'Crouched, you are all but invisible; ambushes deal 25% more.' },
    ],
  },
  duelist: {
    name: 'Duelist Tree',
    nodes: [
      { id: 'en-garde', name: 'En Garde', icon: '🤺', tier: 1, col: 0, maxRank: 3, level: 1, description: 'Light attacks are 6% faster per rank.', per: 'Light attacks are {6}% faster.' },
      { id: 'flourish', name: 'Flourish', icon: '🎭', tier: 1, col: 1, maxRank: 2, level: 1, description: 'Combo finishers hit 20% harder per rank.', per: 'Combo finishers hit {20}% harder.' },
      { id: 'footwork', name: 'Footwork', icon: '🩰', tier: 1, col: 2, maxRank: 2, level: 1, description: '+5% movement speed per rank.', per: '+{5}% movement speed.' },
      at(LUNGE, 2, 0, { req: ['en-garde'], level: 3 }),
      { id: 'perfect-parry', name: 'Perfect Parry', icon: '⚔', tier: 2, col: 1, maxRank: 1, level: 3, req: ['flourish'], description: "Parry's window is 50% longer." },
      { id: 'riposte-master', name: 'Riposte Master', icon: '↪', tier: 2, col: 2, maxRank: 1, level: 3, req: ['footwork'], description: 'Ripostes deal four times the damage instead of three.' },
      { id: 'bleeding-edge', name: 'Bleeding Edge', icon: '🩸', tier: 3, col: 0, maxRank: 2, level: 5, req: ['lunge'], description: 'Swords and daggers make foes bleed 10% more often per rank.', per: 'Foes bleed {10}% more often.' },
      { id: 'momentum', name: 'Momentum', icon: '🔁', tier: 3, col: 1, maxRank: 1, level: 5, req: ['perfect-parry'], description: 'A successful parry restores 25 stamina and its cooldown.' },
      { id: 'coup-de-grace', name: 'Coup de Grâce', icon: '🗡', tier: 4, col: 0, maxRank: 2, level: 8, req: ['bleeding-edge'], description: 'Blows on bleeding foes deal 15% more per rank.', per: 'Bleeding foes take {15}% more.' },
      { id: 'dancer', name: 'Dancer', icon: '💃', tier: 4, col: 2, maxRank: 2, level: 8, req: ['riposte-master'], description: 'Take 8% less damage per rank.', per: 'Take {8}% less damage.' },
      { id: 'virtuoso', name: 'Virtuoso', icon: '🌟', tier: 5, col: 1, maxRank: 1, level: 12, req: ['momentum'], description: '+15% melee damage, and Parry recharges twice as fast.' },
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
