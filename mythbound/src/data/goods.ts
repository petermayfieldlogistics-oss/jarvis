// Goods from the homestead: crops (and their seeds) grown in Wren's field.
// Each becomes an ordinary item in a hero's pack (ITEMS in data/world.ts
// spreads goodsItems() in). Later features add their goods here too.

export type CropId = 'carrot' | 'wheat' | 'bluecap' | 'pumpkin';

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
export type StationId = 'cookfire' | 'bench' | 'anvil';

export const STATIONS: { id: Exclude<StationId, 'anvil'>; name: string; x: number; z: number; label: string }[] = [
  { id: 'cookfire', name: 'Hearthhold Cookfire', x: 13.5, z: 13.5, label: 'Cook at the fire' },
  { id: 'bench', name: 'Workbench', x: 31.5, z: 4, label: 'Workbench: craft' },
];

export const STATION_NAME: Record<StationId, string> = { cookfire: 'Cookfire', bench: 'Workbench', anvil: 'Anvil' };

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

export type Output = { kind: 'item'; id: string; n: number } | { kind: 'arrows'; type: 'wood' | 'steel'; n: number };

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
];

/** Materials, meals and supplies as items for the pack. */
export function craftedItems(): Record<string, GoodsItem> {
  const out: Record<string, GoodsItem> = {};
  for (const [id, m] of Object.entries(MATERIALS)) out[id] = { name: m.name, description: m.description };
  for (const [id, m] of Object.entries(MEALS)) out[id] = m;
  for (const [id, s] of Object.entries(SUPPLIES)) out[id] = { name: s.name, description: s.description };
  return out;
}
