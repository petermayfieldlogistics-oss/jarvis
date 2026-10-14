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
