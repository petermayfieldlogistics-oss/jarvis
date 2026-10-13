// Goods from the homestead: crops (and their seeds) grown in Wren's field.
// Each becomes an ordinary item in a hero's pack (ITEMS in data/world.ts
// spreads goodsItems() in). Later features add their goods here too.

export type CropId = 'carrot' | 'wheat' | 'bluecap' | 'pumpkin' | 'flax' | 'madder' | 'woad' | 'weld';

export interface CropDef {
  id: CropId;
  name: string;
  plural: string;
  /** Embers for a pack of SEED_PACK seeds (before shop markups). */
  seedPrice: number;
  /** Game minutes to ripen in watered soil (dry soil grows at half speed). */
  grow: number;
  /** Crops a harvest brings in, least to most (before feeding). */
  yield: [number, number];
  /** What Wren pays for one. */
  sell: number;
  /** Grown for the loom (fibre and dye), not the table. */
  fibre?: boolean;
  /** Eaten: health and mana it restores. */
  heal?: number;
  mana?: number;
  /** How the plants look: leafy tops over a root, stalks of grain, mushroom caps, a vine with a gourd. */
  shape: 'tops' | 'stalks' | 'caps' | 'gourd';
  leaf: number;
  fruit: number;
  use: string;
}

export const CROPS: Record<CropId, CropDef> = {
  carrot: {
    id: 'carrot', name: 'Carrot', plural: 'carrots', seedPrice: 20, grow: 180, yield: [2, 3], sell: 4, heal: 20,
    shape: 'tops', leaf: 0x4e8a2a, fruit: 0xe0782a, use: 'Quick to grow. Eat for 20 HP.',
  },
  wheat: {
    id: 'wheat', name: 'Wheat', plural: 'wheat', seedPrice: 24, grow: 240, yield: [3, 5], sell: 3,
    shape: 'stalks', leaf: 0xc8a648, fruit: 0xe0c060, use: 'Golden grain for bread. Wren buys it.',
  },
  bluecap: {
    id: 'bluecap', name: 'Bluecap', plural: 'bluecaps', seedPrice: 32, grow: 300, yield: [2, 3], sell: 5, mana: 30,
    shape: 'caps', leaf: 0xd8d0b8, fruit: 0x3a6ac8, use: 'A mushroom of the shade. Eat for 30 mana.',
  },
  pumpkin: {
    id: 'pumpkin', name: 'Pumpkin', plural: 'pumpkins', seedPrice: 60, grow: 720, yield: [1, 2], sell: 18, heal: 60,
    shape: 'gourd', leaf: 0x3e7a2e, fruit: 0xe08a20, use: 'Slow, but filling. Eat for 60 HP.',
  },
  // Fibre and dye plants, for the loom.
  flax: {
    id: 'flax', name: 'Flax', plural: 'flax', seedPrice: 16, grow: 300, yield: [3, 4], sell: 2, fibre: true,
    shape: 'stalks', leaf: 0x5a8a4a, fruit: 0x8aa8e0, use: 'Blue-flowered fibre. The loom spins 3 into linen.',
  },
  madder: {
    id: 'madder', name: 'Madder', plural: 'madder', seedPrice: 24, grow: 420, yield: [2, 3], sell: 3, fibre: true,
    shape: 'tops', leaf: 0x4a7a3a, fruit: 0xa83a2a, use: 'Its root dyes cloth red.',
  },
  woad: {
    id: 'woad', name: 'Woad', plural: 'woad', seedPrice: 24, grow: 420, yield: [2, 3], sell: 3, fibre: true,
    shape: 'tops', leaf: 0x5a8a6a, fruit: 0xe0d040, use: 'Its leaves dye cloth blue.',
  },
  weld: {
    id: 'weld', name: 'Weld', plural: 'weld', seedPrice: 24, grow: 420, yield: [2, 3], sell: 3, fibre: true,
    shape: 'stalks', leaf: 0x7a9a3a, fruit: 0xd8c040, use: 'Dyer’s rocket: dyes cloth yellow.',
  },
};

export const CROP_IDS = Object.keys(CROPS) as CropId[];

/** Seeds come in packs of this many. */
export const SEED_PACK = 4;

export const seedItem = (id: CropId) => `seed-${id}`;

export interface GoodsItem {
  name: string;
  description: string;
  heal?: number;
  mana?: number;
}

/** Every crop and its seed, as items for the pack. */
export function goodsItems(): Record<string, GoodsItem> {
  const out: Record<string, GoodsItem> = {};
  for (const c of Object.values(CROPS)) {
    out[c.id] = { name: c.name, description: c.use, ...(c.heal ? { heal: c.heal } : {}), ...(c.mana ? { mana: c.mana } : {}) };
    out[seedItem(c.id)] = { name: `${c.name} seeds`, description: `Plant them in a seed bed in Wren's field. Ripe in about ${Math.round(c.grow / 60)} hours if watered.` };
  }
  return out;
}

// ---------------------------------------------------------------- crafting --

/** Where things are made: the cookfire and workbench by Wren's field, and any anvil. */
export type StationId = 'cookfire' | 'bench' | 'anvil' | 'loom';

export const STATIONS: { id: Exclude<StationId, 'anvil'>; name: string; x: number; z: number; label: string }[] = [
  { id: 'cookfire', name: 'Hearthhold Cookfire', x: 13.5, z: 13.5, label: 'Cook at the fire' },
  { id: 'bench', name: 'Workbench', x: 31.5, z: 4, label: 'Workbench: craft' },
  { id: 'loom', name: 'Loom', x: 22, z: -7.5, label: 'Loom: weave, dye and dress' },
];

export const STATION_NAME: Record<StationId, string> = { cookfire: 'Cookfire', bench: 'Workbench', anvil: 'Anvil', loom: 'Loom' };

/** Monster parts and the sea's leavings: crafting materials (Quill buys them). */
export const MATERIALS: Record<string, { name: string; description: string; sell: number }> = {
  hide: { name: 'Rough Hide', description: 'From wolves and boars. Lures, tools, horseshoes.', sell: 3 },
  silk: { name: 'Spider Silk', description: 'From spiderlings (and Broodmother). A strong fishing line.', sell: 3 },
  chitin: { name: 'Scorpion Chitin', description: 'From desert scorpions. Venom Runes.', sell: 6 },
  // Quill won't buy weed (a missed cast brings it in for nothing).
  kelp: { name: 'Sea Kelp', description: 'From the drowned, or a missed catch. Compost, Frost Runes.', sell: 0 },
  bone: { name: 'Old Bone', description: 'From skeletons. Arrows and compost.', sell: 3 },
  wisp: { name: 'Wraith Wisp', description: 'From wraiths. Storm Runes.', sell: 8 },
  cinder: { name: 'Cinder Heart', description: 'From imps and magma hounds. Ember Runes.', sell: 6 },
  linen: { name: 'Linen', description: 'Spun from flax at the loom (bandits carry some). Clothes.', sell: 4 },
  bronze: { name: 'Bronze Scrap', description: 'From the legionaries of Mars. Helms and plate.', sell: 10 },
  scale: { name: 'Drake Scale', description: 'From ash drakes. Drake Crimson dye.', sell: 15 },
  lens: { name: 'Watcher Lens', description: 'From watchers. Eyeglow dye.', sell: 12 },
};

/** Which foes drop which material, and how often (each hero rolls their own). */
export const MATERIAL_DROPS: Partial<Record<string, { item: string; chance: number }>> = {
  wolf: { item: 'hide', chance: 0.3 },
  boar: { item: 'hide', chance: 0.5 },
  spiderling: { item: 'silk', chance: 0.35 },
  scorpion: { item: 'chitin', chance: 0.35 },
  drowned: { item: 'kelp', chance: 0.35 },
  skeleton: { item: 'bone', chance: 0.35 },
  wraith: { item: 'wisp', chance: 0.25 },
  'fire-imp': { item: 'cinder', chance: 0.2 },
  'magma-hound': { item: 'cinder', chance: 0.25 },
  bandit: { item: 'linen', chance: 0.1 },
  'bandit-archer': { item: 'linen', chance: 0.1 },
  'mars-legionary': { item: 'bronze', chance: 0.4 },
  drake: { item: 'scale', chance: 0.4 },
  'eye-watcher': { item: 'lens', chance: 0.25 },
};

/** Cooked food: heals (and restores mana) more than what went into it. */
export const MEALS: Record<string, GoodsItem> = {
  'grilled-fish': { name: 'Grilled Fish', description: 'Restores 60 HP.', heal: 60 },
  'hearth-bread': { name: 'Hearth Bread', description: 'Restores 40 HP.', heal: 40 },
  'root-stew': { name: 'Root Stew', description: 'Restores 75 HP.', heal: 75 },
  'fish-pie': { name: "Fisher's Pie", description: 'Restores 160 HP.', heal: 160 },
  'bluecap-broth': { name: 'Bluecap Broth', description: 'Restores 90 mana and 20 HP.', heal: 20, mana: 90 },
  'pumpkin-soup': { name: 'Pumpkin Soup', description: 'Restores 70 HP and 20 mana.', heal: 70, mana: 20 },
  'golden-feast': { name: 'Golden Feast', description: 'Restores 300 HP and 100 mana.', heal: 300, mana: 100 },
};

/** Made things that are used up (compost, lures) or kept (tools: one is enough). */
export const SUPPLIES: Record<string, GoodsItem & { tool?: boolean }> = {
  compost: { name: 'Compost', description: 'Feed a seed bed before it is half grown: one more crop.' },
  lure: { name: 'Fishing Lure', description: 'Used up on a cast: a wider catch and a better chance of gold.' },
  'watering-can': { name: 'Watering Can', description: 'Watering one bed waters every bed you have, and it stays wet longer.', tool: true },
  'fishing-line': { name: 'Silk Fishing Line', description: 'A wider catch on every cast.', tool: true },
  horseshoes: { name: 'Horseshoes', description: 'Your horse gallops longer before it tires.', tool: true },
};

// ---------------------------------------------------------------- clothing --
// Purely for looks (no stats). Three slots; four dye channels. The arrays'
// order is the wire order in co-op: only ever append.

export type Build = 'heavy' | 'light' | 'robe' | 'gi';
export type HeadLook = 'helmet' | 'hood' | 'hat' | 'bare' | 'mask' | 'plume' | 'crown';
export type Slot = 'head' | 'body' | 'cloak';
export const SLOTS: Slot[] = ['head', 'body', 'cloak'];
/** What each dye colours: cloth (hood, hat, robe, trousers), the leather or plate, the trim, the cloak. */
export type DyeChannel = 'cloth' | 'armor' | 'trim' | 'cape';
export const CHANNELS: DyeChannel[] = ['cloth', 'armor', 'trim', 'cape'];
export const CHANNEL_NAME: Record<DyeChannel, string> = { cloth: 'Cloth', armor: 'Leather / plate', trim: 'Trim', cape: 'Cloak' };

type Make = { station: 'loom' | 'anvil'; group: string; needs: Record<string, number> };

export interface GarmentDef {
  id: string;
  name: string;
  slot: Slot;
  /** Head: what is drawn on the head, and a band over bare hair. */
  head?: HeadLook;
  band?: 'headband' | 'circlet';
  /** Body: the cut of the clothes. */
  build?: Build;
  /** Cloak: worn or not. */
  cape?: boolean;
  /** Every hero has it. */
  free?: boolean;
  make?: Make;
  /** Quill sells it, for this many embers. */
  price?: number;
  /** Won, not made: how. */
  earned?: string;
  blurb: string;
}

const loom = (group: string, needs: Record<string, number>): Make => ({ station: 'loom', group, needs });
const smith = (needs: Record<string, number>): Make => ({ station: 'anvil', group: 'Gear', needs });

export const GARMENTS: GarmentDef[] = [
  { id: 'bare-head', name: 'Bare Head', slot: 'head', head: 'bare', free: true, blurb: 'Nothing on your head.' },
  { id: 'hood', name: 'Traveller’s Hood', slot: 'head', head: 'hood', make: loom('Weave', { linen: 2 }), price: 60, blurb: 'A plain hood against the rain.' },
  { id: 'mask', name: 'Rogue’s Mask', slot: 'head', head: 'mask', make: loom('Weave', { linen: 2, silk: 1 }), blurb: 'A hood, and a mask over the lower face.' },
  { id: 'hat', name: 'Wide-Brimmed Hat', slot: 'head', head: 'hat', make: loom('Weave', { linen: 3 }), price: 80, blurb: 'A tall, wide-brimmed hat.' },
  { id: 'headband', name: 'Headband', slot: 'head', head: 'bare', band: 'headband', make: loom('Weave', { linen: 1 }), price: 30, blurb: 'A cloth band, in your trim colour.' },
  { id: 'circlet', name: 'Silver Circlet', slot: 'head', head: 'bare', band: 'circlet', make: smith({ 'ember-ore': 1, bronze: 1 }), blurb: 'A thin band of metal with a gem on the brow.' },
  { id: 'helm', name: 'Great Helm', slot: 'head', head: 'helmet', make: smith({ 'ember-ore': 3, hide: 1 }), blurb: 'A full steel helm.' },
  { id: 'galea', name: 'Legion Galea', slot: 'head', head: 'plume', make: smith({ 'ember-ore': 2, bronze: 3 }), blurb: 'A crested helm in the legion’s style.' },
  { id: 'crown', name: 'Crown of the Six', slot: 'head', head: 'crown', earned: 'Conquer all six weapon trials.', blurb: 'For one who has beaten every trial.' },
  { id: 'jerkin', name: 'Leather Jerkin', slot: 'body', build: 'light', make: loom('Tailor', { linen: 2, hide: 2 }), price: 140, blurb: 'Light leathers over a linen shirt.' },
  { id: 'robe', name: 'Scholar’s Robe', slot: 'body', build: 'robe', make: loom('Tailor', { linen: 5 }), price: 120, blurb: 'A long robe to the ankle.' },
  { id: 'gi', name: 'Training Gi', slot: 'body', build: 'gi', make: loom('Tailor', { linen: 3 }), price: 90, blurb: 'A wrap top, a sash and loose trousers.' },
  { id: 'plate', name: 'Plate Harness', slot: 'body', build: 'heavy', make: smith({ 'ember-ore': 5, hide: 2, bronze: 2 }), blurb: 'Plate over mail.' },
  { id: 'cloak', name: 'Wool Cloak', slot: 'cloak', cape: true, make: loom('Tailor', { linen: 3 }), price: 100, blurb: 'A cloak down the back, in your cloak colour.' },
  { id: 'no-cloak', name: 'No Cloak', slot: 'cloak', cape: false, free: true, blurb: 'Nothing down your back.' },
];

export const GARMENT_INDEX = new Map(GARMENTS.map((g, i) => [g.id, i]));
export const garment = (id: string | null | undefined) => (id ? GARMENTS[GARMENT_INDEX.get(id) ?? -1] ?? null : null);
/** A new cloak's colour, before it is dyed (a class's own cloak keeps its colour). */
export const UNDYED_CLOAK = 0x6a5a4a;

export interface DyeDef {
  id: string;
  name: string;
  hex: number;
  make?: { group: string; needs: Record<string, number> };
  /** Quill sells the colour, for this many embers. */
  price?: number;
  earned?: string;
  blurb: string;
}

const dye = (id: string, name: string, hex: number, group: 'Plant dyes' | 'Rare dyes', needs: Record<string, number>, blurb: string, price?: number): DyeDef => ({
  id, name, hex, make: { group, needs }, ...(price ? { price } : {}), blurb,
});

/** Making a dye teaches the colour for good: dye anything with it, as often as you like. */
export const DYES: DyeDef[] = [
  dye('madder', 'Madder Red', 0x9a2a22, 'Plant dyes', { madder: 3 }, 'A deep red, from madder root.', 40),
  dye('woad', 'Woad Blue', 0x2a4a8a, 'Plant dyes', { woad: 3 }, 'A strong blue, from woad leaves.', 40),
  dye('weld', 'Weld Yellow', 0xc8a83a, 'Plant dyes', { weld: 3 }, 'A warm yellow, from weld.', 40),
  dye('purple', 'Royal Purple', 0x5a2a6a, 'Plant dyes', { madder: 2, woad: 2 }, 'Red and blue in one vat.'),
  dye('green', 'Forest Green', 0x2e5a2a, 'Plant dyes', { woad: 2, weld: 2 }, 'Blue and yellow in one vat.'),
  dye('orange', 'Sunset Orange', 0xc8642a, 'Plant dyes', { madder: 2, weld: 2 }, 'Red and yellow in one vat.'),
  dye('cream', 'Undyed Cream', 0xd8cfb0, 'Plant dyes', { flax: 3 }, 'Bleached linen’s own colour.'),
  dye('charcoal', 'Charcoal', 0x2a2826, 'Rare dyes', { cinder: 2 }, 'Soot black, from cinder hearts.'),
  dye('bone', 'Bone White', 0xe8e2d0, 'Rare dyes', { bone: 3 }, 'Ground bone: a chalky white.'),
  dye('teal', 'Sea Teal', 0x2f8a86, 'Rare dyes', { kelp: 3 }, 'The colour of the shallows.'),
  dye('venom', 'Venom Green', 0x6abf2a, 'Rare dyes', { chitin: 2, weld: 1 }, 'A bright, poisonous green.'),
  dye('crimson', 'Drake Crimson', 0x7a1410, 'Rare dyes', { scale: 1, madder: 2 }, 'Darker than blood.'),
  dye('gold', 'Gold Leaf', 0xe0b84a, 'Rare dyes', { 'golden-fish': 1, 'ember-ore': 1 }, 'Beaten gold, for show.'),
  dye('eyeglow', 'Eyeglow', 0x8cff5a, 'Rare dyes', { lens: 1, wisp: 1 }, 'What the eye-cult dyed its robes with, so they say.'),
  { id: 'pearl', name: 'Pearl', hex: 0xe8e4f0, earned: 'Claim the Pearl of the Leviathan.', blurb: 'The sheen of the Leviathan’s pearl.' },
  { id: 'tidal', name: 'Tidal Blue', hex: 0x1f5f8a, earned: 'Claim the Crown of the Tides.', blurb: 'The deep sea’s blue.' },
  { id: 'dragonfire', name: 'Dragonfire', hex: 0xd8401a, earned: 'Claim the Heart of the Elder Dragon.', blurb: 'The Elder Dragon’s flame.' },
];

export const DYE_INDEX = new Map(DYES.map((d, i) => [d.id, i]));
export const dyeOf = (id: string | null | undefined) => (id ? DYES[DYE_INDEX.get(id) ?? -1] ?? null : null);

export type Output =
  | { kind: 'item'; id: string; n: number }
  | { kind: 'arrows'; type: 'wood' | 'steel'; n: number }
  /** A garment for the wardrobe, or a dye colour learned for good. */
  | { kind: 'garment'; id: string }
  | { kind: 'dye'; id: string };

export interface RecipeDef {
  id: string;
  name: string;
  station: StationId;
  group: string;
  /** Items used up (by item id). */
  needs: Record<string, number>;
  /** Wood arrows used up too. */
  arrows?: number;
  /** Embers it costs (a blacksmith pays half at the anvil). */
  gold?: number;
  makes: Output;
  /** Can be cooked by any shrine's flame. */
  camp?: boolean;
  /** A tool: made once. */
  once?: boolean;
  blurb: string;
}

const meal = (id: string, needs: Record<string, number>, n: number, camp = false): RecipeDef => ({
  id, name: MEALS[id].name, station: 'cookfire', group: 'Meals', needs, makes: { kind: 'item', id, n }, camp, blurb: MEALS[id].description,
});

export const RECIPES: RecipeDef[] = [
  // Cookfire.
  meal('grilled-fish', { fish: 1 }, 1, true),
  meal('hearth-bread', { wheat: 3 }, 2, true),
  meal('root-stew', { carrot: 3, wheat: 1 }, 2),
  meal('fish-pie', { fish: 2, carrot: 1, wheat: 1 }, 1),
  meal('bluecap-broth', { bluecap: 2, fish: 1 }, 1),
  meal('pumpkin-soup', { pumpkin: 1, carrot: 1 }, 2),
  meal('golden-feast', { 'golden-fish': 1, pumpkin: 1, 'hearth-bread': 2 }, 1),
  // Workbench.
  { id: 'bone-arrows', name: 'Bone Arrows', station: 'bench', group: 'Fletching', needs: { bone: 2 }, makes: { kind: 'arrows', type: 'wood', n: 20 }, blurb: '20 arrows.' },
  { id: 'steel-arrows', name: 'Steel Arrows', station: 'bench', group: 'Fletching', needs: { 'ember-ore': 1 }, arrows: 20, makes: { kind: 'arrows', type: 'steel', n: 20 }, blurb: 'Tips 20 wood arrows with steel: 30% harder hits.' },
  { id: 'compost-kelp', name: 'Kelp Compost', station: 'bench', group: 'Farm', needs: { kelp: 2 }, makes: { kind: 'item', id: 'compost', n: 2 }, blurb: SUPPLIES.compost.description },
  { id: 'compost-bone', name: 'Bonemeal Compost', station: 'bench', group: 'Farm', needs: { bone: 2 }, makes: { kind: 'item', id: 'compost', n: 2 }, blurb: SUPPLIES.compost.description },
  { id: 'fur-lure', name: 'Fishing Lures', station: 'bench', group: 'Fishing', needs: { hide: 1 }, makes: { kind: 'item', id: 'lure', n: 3 }, blurb: SUPPLIES.lure.description },
  { id: 'watering-can', name: 'Watering Can', station: 'bench', group: 'Farm', needs: { 'ember-ore': 1, hide: 2 }, makes: { kind: 'item', id: 'watering-can', n: 1 }, once: true, blurb: SUPPLIES['watering-can'].description },
  { id: 'fishing-line', name: 'Silk Fishing Line', station: 'bench', group: 'Fishing', needs: { silk: 2, 'ember-ore': 1 }, makes: { kind: 'item', id: 'fishing-line', n: 1 }, once: true, blurb: SUPPLIES['fishing-line'].description },
  // Anvil.
  { id: 'forge-rune-fire', name: 'Ember Rune', station: 'anvil', group: 'Runes', needs: { 'ember-ore': 2, cinder: 3 }, gold: 30, makes: { kind: 'item', id: 'rune-fire', n: 1 }, blurb: 'Hits set foes burning.' },
  { id: 'forge-rune-frost', name: 'Frost Rune', station: 'anvil', group: 'Runes', needs: { 'ember-ore': 2, kelp: 4 }, gold: 30, makes: { kind: 'item', id: 'rune-frost', n: 1 }, blurb: 'Hits slow foes with frost.' },
  { id: 'forge-rune-storm', name: 'Storm Rune', station: 'anvil', group: 'Runes', needs: { 'ember-ore': 2, wisp: 3 }, gold: 40, makes: { kind: 'item', id: 'rune-storm', n: 1 }, blurb: 'Hits arc lightning to two foes nearby.' },
  { id: 'forge-rune-venom', name: 'Venom Rune', station: 'anvil', group: 'Runes', needs: { 'ember-ore': 2, chitin: 3 }, gold: 30, makes: { kind: 'item', id: 'rune-venom', n: 1 }, blurb: 'Hits poison foes for a while.' },
  { id: 'horseshoes', name: 'Horseshoes', station: 'anvil', group: 'Gear', needs: { 'ember-ore': 3, hide: 2 }, makes: { kind: 'item', id: 'horseshoes', n: 1 }, once: true, blurb: SUPPLIES.horseshoes.description },
  // Loom.
  { id: 'linen', name: 'Linen', station: 'loom', group: 'Weave', needs: { flax: 3 }, makes: { kind: 'item', id: 'linen', n: 1 }, blurb: 'Spins 3 flax into a bolt of linen.' },
  // Clothes (loom and anvil) and dyes (loom), from their tables below.
  ...GARMENTS.filter((g) => g.make).map((g): RecipeDef => ({
    id: `sew-${g.id}`, name: g.name, station: g.make!.station, group: g.make!.group, needs: g.make!.needs, makes: { kind: 'garment', id: g.id }, once: true, blurb: g.blurb,
  })),
  ...DYES.filter((d) => d.make).map((d): RecipeDef => ({
    id: `dye-${d.id}`, name: d.name, station: 'loom', group: d.make!.group, needs: d.make!.needs, makes: { kind: 'dye', id: d.id }, once: true, blurb: d.blurb,
  })),
];

/** Materials, meals and supplies as items for the pack. */
export function craftedItems(): Record<string, GoodsItem> {
  const out: Record<string, GoodsItem> = {};
  for (const [id, m] of Object.entries(MATERIALS)) out[id] = { name: m.name, description: m.description };
  for (const [id, m] of Object.entries(MEALS)) out[id] = m;
  for (const [id, s] of Object.entries(SUPPLIES)) out[id] = { name: s.name, description: s.description };
  return out;
}
