// The world of Mythbound: zones, places, people, monsters and stories.
// Coordinates are world units; north is -z.

import { ANCIENT_GLYPH, RELICS, RUNES, runeItem, type CreatureKind, type SpellId } from './defs';
import { craftedItems, goodsItems } from './goods';

export const WORLD_HALF = 450;

export type ZoneId = 'town' | 'plains' | 'forest' | 'desert' | 'volcano' | 'coast' | 'swamp' | 'crossroads' | 'badlands';

export interface ZoneDef {
  id: ZoneId;
  name: string;
  /** Fog/haze tint by day. */
  fog: number;
  /** Ground colours: flat and steep. */
  ground: number;
  rock: number;
  level: number;
}

export const ZONES: Record<ZoneId, ZoneDef> = {
  town: { id: 'town', name: 'Hearthhold', fog: 0xb8a27a, ground: 0x6b5d45, rock: 0x6a645a, level: 1 },
  plains: { id: 'plains', name: 'The Golden Reach', fog: 0xc2a46a, ground: 0x7a7038, rock: 0x6d675c, level: 1 },
  forest: { id: 'forest', name: 'Whisperwood', fog: 0x6f7a62, ground: 0x34432a, rock: 0x4d5148, level: 3 },
  desert: { id: 'desert', name: 'The Ashen Dunes', fog: 0xc79a62, ground: 0xb08a58, rock: 0x8c6a48, level: 6 },
  volcano: { id: 'volcano', name: 'Molten Peak', fog: 0x9a5a3e, ground: 0x46382f, rock: 0x54423a, level: 9 },
  coast: { id: 'coast', name: 'The Sunken Coast', fog: 0x8296a0, ground: 0xb8a882, rock: 0x6c6e6a, level: 5 },
  swamp: { id: 'swamp', name: 'The Weeping Mire', fog: 0x4f5a44, ground: 0x2f3324, rock: 0x3b3d33, level: 8 },
  crossroads: { id: 'crossroads', name: "Hecate's Crossroads", fog: 0x4a4466, ground: 0x3a3842, rock: 0x4a4752, level: 10 },
  badlands: { id: 'badlands', name: 'The Field of Mars', fog: 0x9c6e4e, ground: 0x6b4b36, rock: 0x5e4636, level: 11 },
};

export const TOWN = { x: 0, z: 20, radius: 62 };
export const VOLCANO = { x: 0, z: -315, radius: 160, crater: 42, platform: 30 };
export const ISLAND = { x: 70, z: 262, radius: 40 };

// --------------------------------------------------------------- monsters --

export type EnemyId =
  | 'wolf' | 'boar' | 'bandit' | 'bandit-archer' | 'skeleton' | 'wraith' | 'scorpion'
  | 'fire-imp' | 'magma-hound' | 'drowned' | 'eye-watcher' | 'mars-legionary' | 'drake' | 'spiderling';

export type BodyType = 'humanoid' | 'quad' | 'floater' | 'insect' | 'imp' | 'drake';
export type Affinity = 'fire' | 'water' | 'wind' | 'earth' | 'dark' | 'none';

export interface EnemyDef {
  id: EnemyId;
  name: string;
  body: BodyType;
  hp: number;
  damage: number;
  speed: number;
  level: number;
  affinity: Affinity;
  dark: boolean;
  xp: number;
  gold: number;
  color: number;
  scale: number;
  reach: number;
  ranged?: { projectile: 'arrow' | 'fireball' | 'orb' | 'water'; range: number; speed: number };
  tame?: CreatureKind;
  /** Item dropped and its chance. */
  drop?: { item: string; chance: number };
  bleeds: boolean;
}

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  wolf: { id: 'wolf', name: 'Grey Wolf', body: 'quad', hp: 32, damage: 7, speed: 8.5, level: 1, affinity: 'none', dark: false, xp: 14, gold: 3, color: 0x5d5852, scale: 1, reach: 2, tame: 'wolf', bleeds: true },
  boar: { id: 'boar', name: 'Tusked Boar', body: 'quad', hp: 60, damage: 10, speed: 7, level: 3, affinity: 'earth', dark: false, xp: 24, gold: 4, color: 0x5a3f2b, scale: 1.15, reach: 2.2, tame: 'boar', bleeds: true },
  bandit: { id: 'bandit', name: 'Bandit', body: 'humanoid', hp: 48, damage: 9, speed: 5.4, level: 2, affinity: 'none', dark: false, xp: 22, gold: 14, color: 0x5b4a3a, scale: 1, reach: 2.4, bleeds: true, drop: { item: 'arrows', chance: 0.3 } },
  'bandit-archer': { id: 'bandit-archer', name: 'Bandit Archer', body: 'humanoid', hp: 36, damage: 8, speed: 5, level: 3, affinity: 'none', dark: false, xp: 24, gold: 12, color: 0x4d5a3a, scale: 1, reach: 2, ranged: { projectile: 'arrow', range: 34, speed: 38 }, bleeds: true, drop: { item: 'arrows', chance: 0.6 } },
  skeleton: { id: 'skeleton', name: 'Restless Bones', body: 'humanoid', hp: 55, damage: 12, speed: 5, level: 5, affinity: 'dark', dark: true, xp: 34, gold: 10, color: 0xcfc7ad, scale: 1, reach: 2.5, bleeds: false },
  wraith: { id: 'wraith', name: 'Hollow Wraith', body: 'floater', hp: 62, damage: 13, speed: 5.5, level: 7, affinity: 'dark', dark: true, xp: 46, gold: 16, color: 0x6c6290, scale: 1.1, reach: 2.4, ranged: { projectile: 'orb', range: 28, speed: 18 }, bleeds: false },
  scorpion: { id: 'scorpion', name: 'Dune Scorpion', body: 'insect', hp: 75, damage: 13, speed: 6.5, level: 6, affinity: 'earth', dark: false, xp: 40, gold: 12, color: 0x7a5a32, scale: 1.2, reach: 2.6, tame: 'scorpion', bleeds: true },
  'fire-imp': { id: 'fire-imp', name: 'Cinder Imp', body: 'imp', hp: 42, damage: 11, speed: 6.5, level: 8, affinity: 'fire', dark: false, xp: 44, gold: 15, color: 0xb0401c, scale: 0.85, reach: 1.8, ranged: { projectile: 'fireball', range: 30, speed: 22 }, bleeds: true, drop: { item: 'ember-ore', chance: 0.35 } },
  'magma-hound': { id: 'magma-hound', name: 'Magma Hound', body: 'quad', hp: 100, damage: 16, speed: 8, level: 9, affinity: 'fire', dark: false, xp: 60, gold: 18, color: 0x3a2018, scale: 1.3, reach: 2.4, tame: 'magma-hound', bleeds: true, drop: { item: 'ember-ore', chance: 0.5 } },
  drowned: { id: 'drowned', name: 'The Drowned', body: 'humanoid', hp: 72, damage: 12, speed: 4.6, level: 6, affinity: 'water', dark: false, xp: 40, gold: 14, color: 0x4f6a66, scale: 1.05, reach: 2.4, bleeds: true },
  'eye-watcher': { id: 'eye-watcher', name: 'Watcher', body: 'floater', hp: 85, damage: 15, speed: 5, level: 10, affinity: 'dark', dark: true, xp: 70, gold: 25, color: 0x2a2030, scale: 1.2, reach: 2.4, ranged: { projectile: 'orb', range: 32, speed: 20 }, bleeds: false },
  'mars-legionary': { id: 'mars-legionary', name: 'Legionary of Mars', body: 'humanoid', hp: 150, damage: 20, speed: 5.8, level: 12, affinity: 'fire', dark: false, xp: 90, gold: 35, color: 0x7a2a22, scale: 1.15, reach: 2.8, bleeds: true },
  drake: { id: 'drake', name: 'Ash Drake', body: 'drake', hp: 180, damage: 22, speed: 7, level: 13, affinity: 'fire', dark: false, xp: 120, gold: 40, color: 0x4a2a24, scale: 1.4, reach: 3, ranged: { projectile: 'fireball', range: 30, speed: 24 }, tame: 'drake', bleeds: true },
  // Hatched by the Giant Spider in its fights: quick and weak.
  spiderling: { id: 'spiderling', name: 'Spiderling', body: 'insect', hp: 20, damage: 5, speed: 8.5, level: 4, affinity: 'earth', dark: false, xp: 8, gold: 1, color: 0x2a221c, scale: 0.45, reach: 1.3, bleeds: true },
};

// ------------------------------------------------------------------ bosses --

export type BossId = 'cernunna' | 'thalassor' | 'zephyron' | 'ignaroth' | 'champion' | 'hecate-shade' | 'leviathan' | 'sea-queen' | 'elder-dragon' | 'reaper' | 'giant-spider';
export type BossAttack =
  | 'sweep' | 'charge' | 'slam' | 'volley' | 'strikes' | 'summon' | 'teleport' | 'leap' | 'ring' | 'combo'
  // The elder foes' and the hunted foes' own moves (engine/bosses.ts).
  | 'bite' | 'claw' | 'breath' | 'gust' | 'flight' | 'strike' | 'tail' | 'dive' | 'wave' | 'whirlpool' | 'trident' | 'geyser' | 'reap' | 'drain' | 'web';

export interface BossDef {
  id: BossId;
  name: string;
  title: string;
  model: 'stag' | 'crab' | 'colossus' | 'golem' | 'champion' | 'witch' | 'serpent' | 'dragon' | 'siren' | 'reaper' | 'spider';
  hp: number;
  damage: number;
  level: number;
  affinity: Affinity;
  dark: boolean;
  xp: number;
  gold: number;
  scale: number;
  color: number;
  speed: number;
  attacks: BossAttack[];
  summon?: EnemyId;
  projectile: 'arrow' | 'fireball' | 'orb' | 'water' | 'lightning';
  /** A trial's weapon or relic, left in its arena; a hunted foe's unique drop. */
  reward: string;
  /** Hunted, not a trial: it haunts a lair (LAIRS) with no fog, and returns a while after it falls. */
  mini?: boolean;
  /** Shouted when it is enraged (below half health). */
  rage?: string;
}

export const BOSSES: Record<BossId, BossDef> = {
  cernunna: {
    id: 'cernunna', name: 'Cernunna', title: 'the Antlered Shade', model: 'stag', hp: 700, damage: 18, level: 4, affinity: 'earth', dark: false,
    xp: 400, gold: 200, scale: 2.6, color: 0x4a4232, speed: 9, attacks: ['charge', 'sweep', 'summon', 'volley'], summon: 'wolf', projectile: 'arrow', reward: 'bow-of-artemis',
  },
  thalassor: {
    id: 'thalassor', name: 'Thalassor', title: 'the Tide Tyrant', model: 'crab', hp: 950, damage: 20, level: 6, affinity: 'water', dark: false,
    xp: 600, gold: 260, scale: 3, color: 0x3e5f66, speed: 5, attacks: ['slam', 'volley', 'ring', 'sweep'], summon: 'drowned', projectile: 'water', reward: 'trident-of-poseidon',
  },
  zephyron: {
    id: 'zephyron', name: 'Zephyron', title: 'the Storm Colossus', model: 'colossus', hp: 1100, damage: 22, level: 8, affinity: 'wind', dark: false,
    xp: 800, gold: 320, scale: 3.4, color: 0x8a8070, speed: 5, attacks: ['strikes', 'sweep', 'slam', 'ring'], projectile: 'lightning', reward: 'master-bolt',
  },
  ignaroth: {
    id: 'ignaroth', name: 'Ignaroth', title: 'the Molten Forge', model: 'golem', hp: 1400, damage: 26, level: 10, affinity: 'fire', dark: false,
    xp: 1000, gold: 400, scale: 3.6, color: 0x2a1c18, speed: 4.5, attacks: ['slam', 'volley', 'ring', 'leap'], summon: 'fire-imp', projectile: 'fireball', reward: 'hammer-of-hephaestus',
  },
  champion: {
    id: 'champion', name: 'Aresios', title: 'Champion of Mars', model: 'champion', hp: 1500, damage: 28, level: 12, affinity: 'fire', dark: false,
    xp: 1200, gold: 450, scale: 1.9, color: 0x6a2018, speed: 8, attacks: ['combo', 'leap', 'charge', 'sweep'], summon: 'mars-legionary', projectile: 'fireball', reward: 'sword-of-mars',
  },
  'hecate-shade': {
    id: 'hecate-shade', name: 'Shade of Hecate', title: 'Queen of the Crossroads', model: 'witch', hp: 1300, damage: 25, level: 13, affinity: 'dark', dark: true,
    xp: 1300, gold: 500, scale: 2.2, color: 0x2a2440, speed: 6, attacks: ['teleport', 'volley', 'ring', 'summon'], summon: 'wraith', projectile: 'orb', reward: 'staff-of-hecate',
  },
  // The elder foes: beyond the six trials, each guards a relic.
  leviathan: {
    id: 'leviathan', name: 'The Leviathan', title: 'Coil of the Abyss', model: 'serpent', hp: 2600, damage: 30, level: 12, affinity: 'water', dark: false,
    xp: 1800, gold: 700, scale: 1.4, color: 0x24525e, speed: 0, attacks: ['strike', 'tail', 'breath', 'wave', 'volley', 'dive'], projectile: 'water', reward: 'leviathan-pearl',
    rage: 'The Leviathan thrashes, and the sea boils!',
  },
  'sea-queen': {
    id: 'sea-queen', name: 'Queen Nerissa', title: 'Queen of the Sea', model: 'siren', hp: 2200, damage: 28, level: 12, affinity: 'water', dark: false,
    xp: 1600, gold: 650, scale: 1.3, color: 0x2f8a96, speed: 6.5, attacks: ['volley', 'whirlpool', 'trident', 'summon', 'teleport', 'ring', 'geyser'], summon: 'drowned', projectile: 'water', reward: 'tide-crown',
    rage: 'The sea rises for its Queen!',
  },
  'elder-dragon': {
    id: 'elder-dragon', name: 'Pyrrhax', title: 'the Elder Dragon', model: 'dragon', hp: 3200, damage: 34, level: 15, affinity: 'fire', dark: false,
    xp: 2400, gold: 900, scale: 2.3, color: 0x5a1a12, speed: 5.5, attacks: ['bite', 'claw', 'breath', 'gust', 'ring', 'flight'], projectile: 'fireball', reward: 'dragon-heart',
    rage: 'Pyrrhax roars, and the mountain answers with fire!',
  },
  // The hunted: no trial, they haunt their lairs.
  reaper: {
    id: 'reaper', name: 'The Reaper', title: 'Harvester of the Mire', model: 'reaper', hp: 820, damage: 22, level: 9, affinity: 'dark', dark: true,
    xp: 650, gold: 220, scale: 1, color: 0x15131a, speed: 6, attacks: ['reap', 'teleport', 'drain', 'summon'], summon: 'skeleton', projectile: 'orb', reward: 'reapers-edge', mini: true,
    rage: "The Reaper's lantern flares. It hungers.",
  },
  'giant-spider': {
    id: 'giant-spider', name: 'Broodmother', title: 'the Giant Spider', model: 'spider', hp: 520, damage: 15, level: 5, affinity: 'earth', dark: false,
    xp: 380, gold: 140, scale: 2.3, color: 0x2a221c, speed: 7.5, attacks: ['bite', 'leap', 'web', 'summon'], summon: 'spiderling', projectile: 'arrow', reward: 'venomfang', mini: true,
    rage: 'Broodmother shrieks, and the hollow crawls with her young!',
  },
};

// ------------------------------------------------------------------ places --

export interface TrialDef {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  boss: BossId;
  level: number;
  intro: string;
  /** An elder foe's lair: fought like a trial but not one of the six (it guards a relic). */
  elder?: boolean;
}

export const TRIALS: TrialDef[] = [
  { id: 'hunt', name: 'Trial of the Hunt', x: -300, z: 10, radius: 28, boss: 'cernunna', level: 4, intro: 'Antlers scrape the dark between the trees.' },
  { id: 'tides', name: 'Trial of Tides', x: ISLAND.x, z: ISLAND.z, radius: 28, boss: 'thalassor', level: 6, intro: 'The sea pulls back. Something vast rises.' },
  { id: 'storms', name: 'Trial of Storms', x: 305, z: 40, radius: 30, boss: 'zephyron', level: 8, intro: 'The sky darkens. A colossus of sand and thunder wakes.' },
  { id: 'forge', name: 'Trial of the Forge', x: VOLCANO.x, z: VOLCANO.z, radius: 26, boss: 'ignaroth', level: 10, intro: 'The mountain’s heart beats like a hammer.' },
  { id: 'war', name: 'Trial of War', x: 300, z: -260, radius: 30, boss: 'champion', level: 12, intro: 'The crowd of ghosts roars for blood.' },
  { id: 'crossroads', name: 'Trial of the Crossroads', x: -300, z: -265, radius: 28, boss: 'hecate-shade', level: 13, intro: 'Three roads. Three faces. One queen.' },
  // The elder foes. Both sea lairs are headlands joined to the beach: no boat needed.
  { id: 'deep', name: "Serpent's Shoal", x: 230, z: 192, radius: 24, boss: 'leviathan', level: 11, intro: 'The tide pulls back. Coils as wide as towers rise from the sea.', elder: true },
  { id: 'court', name: 'Drowned Court', x: -40, z: 184, radius: 24, boss: 'sea-queen', level: 12, intro: 'A song rises from the waves. The Queen of the Sea holds court.', elder: true },
  { id: 'roost', name: "Dragon's Roost", x: 0, z: -398, radius: 28, boss: 'elder-dragon', level: 14, intro: 'Ash falls like snow. Something vast unfolds its wings.', elder: true },
];

/** The six weapon trials; the elder lairs are fought the same way but are not part of that quest. */
export const WEAPON_TRIALS = TRIALS.filter((t) => !t.elder);
export const ELDER_TRIALS = TRIALS.filter((t) => t.elder);

export interface LairDef {
  id: string;
  name: string;
  boss: BossId;
  x: number;
  z: number;
  /** How far it follows a hero from its lair before giving up. */
  leash: number;
  /** Only there after dark. */
  night?: boolean;
  hint: string;
}

/** Where the hunted great foes dwell. */
export const LAIRS: LairDef[] = [
  { id: 'hollow', name: 'Silken Hollow', boss: 'giant-spider', x: -220, z: -115, leash: 30, hint: 'Deep in Whisperwood, webs as wide as sails. Look up.' },
  { id: 'graves', name: 'Mourner’s Rest', boss: 'reaper', x: -290, z: 140, leash: 32, night: true, hint: 'A graveyard in the Weeping Mire. The Reaper walks it after dark.' },
];

export interface ShrineDef {
  id: string;
  name: string;
  x: number;
  z: number;
}

export const SHRINES: ShrineDef[] = [
  { id: 'hearth', name: 'Hearthhold Shrine', x: 0, z: 42 },
  { id: 'whisper', name: 'Whisperwood Glade', x: -205, z: 50 },
  { id: 'shore', name: 'Sunken Shore', x: 45, z: 140 },
  { id: 'dunes', name: 'Dune Watch', x: 210, z: -10 },
  { id: 'ashfoot', name: 'Ashfoot', x: 30, z: -165 },
  { id: 'mars', name: 'Gate of Mars', x: 230, z: -215 },
  { id: 'crossing', name: 'Moonlit Crossing', x: -215, z: -200 },
  { id: 'mire', name: 'Mire’s Edge', x: -210, z: 190 },
];

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  x: number;
  z: number;
  color: number;
  /** Faces this direction (radians, 0 = +z). */
  facing: number;
}

export const NPCS: NpcDef[] = [
  { id: 'orrin', name: 'Orrin', title: 'Keeper of the Archive', x: -30, z: 8, color: 0x4a3f6a, facing: 1.2 },
  { id: 'brann', name: 'Brann', title: 'Smith', x: 32, z: 18, color: 0x6a3a22, facing: -1.4 },
  { id: 'lumen', name: 'Sister Lumen', title: 'Chapel of Light', x: 0, z: -20, color: 0xd8cfa8, facing: 0 },
  { id: 'quill', name: 'Quill', title: 'Merchant', x: 14, z: 36, color: 0x3a5a4a, facing: Math.PI },
  { id: 'mara', name: 'Mara', title: 'Fisher', x: 20, z: 143, color: 0x2a4a6a, facing: Math.PI },
  { id: 'chronicler', name: 'The Chronicler', title: 'Paid Not to Ask', x: -12, z: 40, color: 0x2a2a2a, facing: Math.PI },
  { id: 'wren', name: 'Wren', title: 'Farmer', x: 13, z: 8, color: 0x7a6a3a, facing: Math.PI / 2 },
];

/**
 * Wren's field: a 3x3 grid of seed beds east of the square (bed `i` is at
 * `plotCentre(i)`). Beds 0-2, the ones every hero gets, are the row by the
 * gate nearest Wren.
 */
export const FIELD = { x: 22, z: 2, pitch: 3.4, bed: 2.6 };
export function plotCentre(i: number): { x: number; z: number } {
  return { x: FIELD.x + ((i % 3) - 1) * FIELD.pitch, z: FIELD.z + (1 - Math.floor(i / 3)) * FIELD.pitch };
}

/** Docks: sailors board boats here. */
export const DOCKS = [{ x: 30, z: 150, facing: 0 }, { x: -110, z: 150, facing: 0 }];
/** Anvils where weapons are upgraded. */
export const ANVILS = [{ x: 28, z: 14 }, { x: 45, z: -170 }];

export interface TomeDef {
  spell: SpellId;
  x: number;
  z: number;
}

export const TOMES: TomeDef[] = [
  { spell: 'blade-of-retribution', x: 286, z: -238 },
  { spell: 'soul-or-power', x: -318, z: 278 },
  { spell: 'power-of-the-light', x: 6, z: -36 },
  { spell: 'stone-skin', x: 255, z: 95 },
  { spell: 'moonveil', x: -270, z: -230 },
];

export interface LoreDef {
  id: string;
  x: number;
  z: number;
  title: string;
  /** Written in the lost tongue: only historians read it. */
  ancient?: boolean;
  text: string;
}

export const LORE: LoreDef[] = [
  {
    id: 'giant', x: 8, z: -120, title: 'The Giant Who Holds the World', ancient: true,
    text: 'Before the empire there was the Giant, who held the earth in the palm of its hand. The people worshipped it. Then they stopped. Then it closed its hand.',
  },
  {
    id: 'thunder', x: 236, z: 70, title: 'Thunder and a Broken Heart', ancient: true,
    text: `${ANCIENT_GLYPH}… followed by thunder, and a broken heart. The empire fell to something divine. The lizards that looked like small dragons were the only ones who wept.`,
  },
  {
    id: 'trials', x: -40, z: 2, title: 'On the Six Trials',
    text: 'Six weapons of the old gods were sealed in six trials, each guarded by a thing that should not live. Sword, bow, bolt, staff, hammer, trident. Whoever claims them must be worthy of them, or they will not answer.',
  },
  {
    id: 'draco', x: 120, z: -150, title: 'Of the Draco',
    text: 'Draco hatch without wings. In their fifth year water burns them; in their sixth, they fly. By their tenth, fire is a bath.',
  },
  {
    id: 'elves', x: -180, z: 30, title: 'Elven Song (fragment)',
    text: 'One in three of us is born ******. We do not say the word. We do not say what it means. We only watch, and wait for it to wake.',
  },
  {
    id: 'mars', x: 262, z: -205, title: 'The Field of Mars',
    text: 'Here the god of war held games. The losers still fight. They do not know they lost.',
  },
  {
    id: 'hecate', x: -248, z: -222, title: 'Three Roads',
    text: 'At the crossroads the witch-queen waits with three faces: maiden, mother, crone. Each one lies. Only the staff tells the truth.',
  },
  {
    id: 'eyes-warning', x: -255, z: 240, title: 'Scratched Into a Tree', ancient: true,
    text: 'DO NOT LOOK AT THE EYES. Residue suggests the carvings were once dyed to glow in the dark. Everyone who saw them died shortly after. Always horribly. Always painfully.',
  },
  {
    id: 'leviathan', x: 200, z: 150, title: 'The Coil of the Abyss',
    text: 'Fishers say the Leviathan sleeps coiled around the shoal to the east. When the sea pulls back from the point, run. Where its head falls, nothing stands. Where its head lies, strike.',
  },
  {
    id: 'court', x: -12, z: 141, title: 'The Drowned Court',
    text: 'Beneath the western waves a queen holds court among the drowned. Her song pulls sailors under and her whirlpools pull them in. Run against the pull, or roll free.',
  },
  {
    id: 'wyrm', x: -36, z: -372, title: 'The Elder Wyrm',
    text: 'Older than the mountain’s fire, it roosts on the far side of Molten Peak. When its throat glows, get out of the way. When it takes to the sky, watch the ground for falling fire.',
  },
  {
    id: 'mourners', x: -274, z: 126, title: 'Mourner’s Rest',
    text: 'When the moon is up, the Reaper comes to collect what the Mire owes. It steps through shadow to stand behind you, and drinks the life of any who stand too long in its gaze.',
  },
  {
    id: 'silk', x: -200, z: -104, title: 'Silken Hollow',
    text: 'Nothing lives in this hollow but webs, bones and silence. The webs hold fast; the bite festers. Whatever spun them is very big, and very patient. Look up.',
  },
];

/** The Chronicler's missing pages. Finding all three reveals the ruins. */
export const PAGES = [
  { id: 'page-1', x: 330, z: 120, text: 'In the oldest books and scrolls these things can be found: ' + ANCIENT_GLYPH + ', sometimes followed by thunder and a broken heart…' },
  { id: 'page-2', x: -340, z: -150, text: '…depictions of small lizards that somewhat resemble dragons. A giant holding the earth in the palm of its hand. And eyes. Lots of eyes.' },
  { id: 'page-3', x: -150, z: 285, text: 'Wait, I looked at the eyes. I’M NEXT! Why am I writing this? Please no, I’ll do anything NOOO__________' },
];

/** Where the eyes are carved. */
export const EYES_RUINS = { x: -335, z: 315 };

export interface SpawnDef {
  x: number;
  z: number;
  radius: number;
  enemies: [EnemyId, number][];
  /** Extra levels (damage and health) for monsters out of their home region. */
  bonus?: number;
}

/** Monster camps. A cleared camp returns a few minutes later, once the hero has moved on. */
export const SPAWNS: SpawnDef[] = [
  // The Golden Reach, around town (levels 1-3).
  { x: -70, z: -50, radius: 18, enemies: [['wolf', 3]] },
  { x: 80, z: -40, radius: 18, enemies: [['bandit', 2], ['bandit-archer', 1]] },
  { x: 70, z: 95, radius: 16, enemies: [['wolf', 3]] },
  { x: -80, z: 100, radius: 16, enemies: [['bandit', 2], ['bandit-archer', 1]] },
  { x: 110, z: -95, radius: 16, enemies: [['bandit', 2], ['bandit-archer', 1]] },
  // Along the four roads, just outside the walls.
  { x: 100, z: 26, radius: 10, enemies: [['bandit', 2]] },
  { x: -100, z: 14, radius: 10, enemies: [['wolf', 2]] },
  { x: 6, z: -84, radius: 10, enemies: [['bandit', 2]] },
  { x: -10, z: 112, radius: 10, enemies: [['wolf', 2]] },
  // Whisperwood.
  { x: -170, z: -60, radius: 22, enemies: [['wolf', 4]] },
  { x: -240, z: 110, radius: 20, enemies: [['boar', 2], ['wolf', 1]] },
  { x: -260, z: -80, radius: 20, enemies: [['bandit', 3], ['bandit-archer', 2]] },
  { x: -350, z: 60, radius: 18, enemies: [['boar', 3]] },
  { x: -150, z: 20, radius: 16, enemies: [['wolf', 3]] },
  { x: -330, z: -60, radius: 18, enemies: [['wolf', 3]] },
  { x: -135, z: -110, radius: 16, enemies: [['bandit', 2], ['bandit-archer', 1]] },
  // The Sunken Coast.
  { x: 135, z: 140, radius: 14, enemies: [['drowned', 3]] },
  { x: -60, z: 140, radius: 14, enemies: [['drowned', 2], ['bandit-archer', 1]] },
  { x: 205, z: 150, radius: 14, enemies: [['drowned', 3]] },
  { x: 300, z: 145, radius: 16, enemies: [['drowned', 2], ['scorpion', 1]] },
  // The Ashen Dunes.
  { x: 200, z: 80, radius: 24, enemies: [['scorpion', 3]] },
  { x: 350, z: -40, radius: 24, enemies: [['scorpion', 2], ['wraith', 1]] },
  { x: 260, z: 150, radius: 22, enemies: [['wraith', 2]] },
  { x: 195, z: 42, radius: 16, enemies: [['scorpion', 2], ['bandit-archer', 1]] },
  { x: 260, z: -60, radius: 20, enemies: [['scorpion', 3]] },
  { x: 355, z: 110, radius: 18, enemies: [['scorpion', 2], ['wraith', 1]] },
  { x: 210, z: -95, radius: 18, enemies: [['scorpion', 2]] },
  // Molten Peak.
  { x: -60, z: -230, radius: 22, enemies: [['fire-imp', 3]] },
  { x: 70, z: -240, radius: 22, enemies: [['magma-hound', 2]] },
  { x: 40, z: -360, radius: 18, enemies: [['fire-imp', 2], ['drake', 1]] },
  { x: -80, z: -320, radius: 18, enemies: [['magma-hound', 2], ['fire-imp', 1]] },
  { x: 90, z: -310, radius: 18, enemies: [['fire-imp', 3]] },
  { x: -95, z: -360, radius: 18, enemies: [['drake', 1], ['fire-imp', 2]] },
  { x: -25, z: -252, radius: 12, enemies: [['fire-imp', 2], ['magma-hound', 1]] },
  // The Weeping Mire.
  { x: -280, z: 230, radius: 24, enemies: [['drowned', 3], ['eye-watcher', 1]] },
  { x: -360, z: 180, radius: 20, enemies: [['eye-watcher', 2]] },
  { x: -200, z: 250, radius: 20, enemies: [['drowned', 2], ['wraith', 1]] },
  { x: -365, z: 245, radius: 16, enemies: [['wraith', 1], ['drowned', 1]] },
  { x: -168, z: 162, radius: 14, enemies: [['drowned', 2]] },
  // Hecate's Crossroads.
  { x: -230, z: -280, radius: 22, enemies: [['skeleton', 4]] },
  { x: -360, z: -200, radius: 20, enemies: [['wraith', 2], ['skeleton', 2]] },
  { x: -200, z: -330, radius: 18, enemies: [['wraith', 1], ['skeleton', 2]] },
  { x: -280, z: -170, radius: 18, enemies: [['skeleton', 3]] },
  { x: -350, z: -330, radius: 18, enemies: [['skeleton', 2], ['wraith', 1]] },
  // The Field of Mars.
  { x: 220, z: -300, radius: 24, enemies: [['skeleton', 3], ['mars-legionary', 1]] },
  { x: 360, z: -200, radius: 22, enemies: [['mars-legionary', 2]] },
  { x: 300, z: -330, radius: 18, enemies: [['mars-legionary', 1], ['skeleton', 2]] },
  { x: 190, z: -170, radius: 18, enemies: [['skeleton', 3]] },
  { x: 290, z: -150, radius: 18, enemies: [['mars-legionary', 1], ['skeleton', 2]] },
];

export interface PatrolDef {
  /** Waypoints, walked there and back again. */
  route: [number, number][];
  enemies: [EnemyId, number][];
  bonus?: number;
}

/** Bands that walk between waypoints and fight wherever they meet the hero. */
export const PATROLS: PatrolDef[] = [
  { route: [[95, -12], [62, -78], [-10, -92], [-62, -72]], enemies: [['bandit', 2], ['bandit-archer', 1]] },
  { route: [[-96, 48], [-104, 108], [-50, 128]], enemies: [['wolf', 3]] },
  { route: [[-160, -20], [-230, -42], [-255, 45]], enemies: [['bandit', 2], ['bandit-archer', 1]] },
  { route: [[240, 25], [300, -85], [215, -55]], enemies: [['scorpion', 2], ['wraith', 1]] },
  { route: [[-105, -282], [-62, -205], [62, -205], [105, -282]], enemies: [['magma-hound', 3]] },
  { route: [[112, 150], [200, 158], [282, 148]], enemies: [['drowned', 3]] },
  { route: [[-255, 282], [-330, 215], [-262, 166]], enemies: [['wraith', 1], ['drowned', 2]] },
  { route: [[-190, -228], [-240, -335], [-345, -345]], enemies: [['skeleton', 3]] },
  { route: [[215, -262], [255, -335], [330, -322]], enemies: [['mars-legionary', 1], ['skeleton', 2]] },
];

/**
 * Wandering monsters that keep the wild from feeling empty: picked by the
 * region the spawn point lies in. `night` entries only appear after dark.
 */
export const AMBIENT: Partial<Record<ZoneId, { day: EnemyId[]; night: EnemyId[]; pack: [number, number] }>> = {
  plains: { day: ['wolf', 'wolf', 'bandit', 'boar'], night: ['wolf', 'bandit-archer'], pack: [1, 3] },
  forest: { day: ['wolf', 'boar', 'bandit', 'bandit-archer'], night: ['wolf', 'skeleton'], pack: [2, 3] },
  desert: { day: ['scorpion', 'scorpion', 'bandit-archer'], night: ['wraith', 'skeleton'], pack: [1, 3] },
  coast: { day: ['drowned', 'bandit-archer'], night: ['drowned', 'wraith'], pack: [1, 3] },
  volcano: { day: ['fire-imp', 'magma-hound'], night: ['fire-imp', 'eye-watcher'], pack: [1, 3] },
  swamp: { day: ['drowned', 'wraith'], night: ['eye-watcher', 'wraith'], pack: [1, 3] },
  crossroads: { day: ['skeleton', 'wraith'], night: ['skeleton', 'eye-watcher'], pack: [2, 3] },
  badlands: { day: ['skeleton', 'mars-legionary'], night: ['skeleton', 'eye-watcher'], pack: [1, 3] },
};

/** Ember ore veins in the volcano. */
export const ORE_NODES = [
  { x: -40, z: -200 }, { x: 60, z: -210 }, { x: -90, z: -290 }, { x: 95, z: -300 }, { x: 0, z: -230 },
];

/** Good fishing water: anywhere along the shore, best at these spots. */
export const FISHING_SPOTS = [{ x: 30, z: 158 }, { x: -110, z: 158 }, { x: 160, z: 158 }];

// ------------------------------------------------------------------ quests --

export type QuestId = 'trials' | 'ore' | 'fish' | 'dead' | 'bounty' | 'tomes' | 'pages' | 'elders' | 'hunts' | 'harvest';

export interface QuestDef {
  id: QuestId;
  name: string;
  giver: string;
  goal: number;
  description: string;
  reward: { gold?: number; xp?: number; flask?: boolean; item?: string };
}

export const QUESTS: Record<QuestId, QuestDef> = {
  trials: {
    id: 'trials', name: 'The Six Trials', giver: 'orrin', goal: 6,
    description: 'Conquer the six trials and claim the weapons of the old gods.',
    reward: { gold: 2000, xp: 3000 },
  },
  ore: {
    id: 'ore', name: 'Ember Ore', giver: 'brann', goal: 3,
    description: 'Bring Brann 3 Ember Ore from Molten Peak (veins, imps and hounds).',
    reward: { gold: 150, xp: 200, item: 'free-upgrade' },
  },
  fish: {
    id: 'fish', name: 'A Good Catch', giver: 'mara', goal: 3,
    description: 'Catch 3 fish at the Sunken Coast.',
    reward: { gold: 60, xp: 80 },
  },
  dead: {
    id: 'dead', name: 'The Restless Dead', giver: 'lumen', goal: 10,
    description: 'Lay 10 dark creatures to rest.',
    reward: { xp: 400, flask: true },
  },
  bounty: {
    id: 'bounty', name: 'Bandit Bounty', giver: 'quill', goal: 8,
    description: 'Thin out the bandits on the roads.',
    reward: { gold: 180, xp: 150 },
  },
  tomes: {
    id: 'tomes', name: 'More Spells to Find', giver: 'orrin', goal: 5,
    description: 'Five lost spell tomes are hidden across the land. Find them.',
    reward: { xp: 600, gold: 300 },
  },
  pages: {
    id: 'pages', name: 'The Missing Pages', giver: 'chronicler', goal: 3,
    description: 'The Chronicler lost three pages of an old manuscript. They were "taken by the wind". Find them.',
    reward: { xp: 300 },
  },
  elders: {
    id: 'elders', name: 'The Elder Foes', giver: 'orrin', goal: 3,
    description: "Slay the three elder foes: the Leviathan at the Serpent's Shoal, the Queen of the Sea in the Drowned Court and the Elder Dragon on its roost beyond Molten Peak.",
    reward: { gold: 1500, xp: 2500 },
  },
  hunts: {
    id: 'hunts', name: 'Monster Hunts', giver: 'quill', goal: 2,
    description: 'Quill posted two bounties: Broodmother, the Giant Spider of Silken Hollow, and the Reaper that walks Mourner’s Rest after dark.',
    reward: { gold: 400, xp: 500 },
  },
  harvest: {
    id: 'harvest', name: "Wren's Field", giver: 'wren', goal: 4,
    description: 'Plant, water and bring in four harvests from the seed beds in Wren’s field.',
    reward: { gold: 80, xp: 150, item: 'seed-pumpkin' },
  },
};

// ------------------------------------------------------------------- items --

export const ITEMS: Record<string, { name: string; description: string; heal?: number; mana?: number }> = {
  fish: { name: 'Fish', description: 'Restores 35 HP.', heal: 35 },
  'golden-fish': { name: 'Golden Fish', description: 'Restores 90 HP.', heal: 90 },
  'ember-ore': { name: 'Ember Ore', description: 'Glowing ore from Molten Peak. Used to upgrade weapons.' },
  'free-upgrade': { name: "Brann's Token", description: 'One free weapon upgrade at any anvil.' },
  ...Object.fromEntries(Object.values(RELICS).map((r) => [r.id, { name: r.name, description: `Relic. ${r.boon}` }])),
  // Uninscribed runes, waiting for an anvil.
  ...Object.fromEntries(Object.values(RUNES).map((r) => [runeItem(r.id), { name: r.name, description: `${r.description} Inscribe it on a weapon at an anvil.` }])),
  // Crops and seeds from Wren's field.
  ...goodsItems(),
  // Materials, meals and supplies made at stations.
  ...craftedItems(),
};
