// Farming: seed beds in Wren's field at Hearthhold. Each hero tends their
// own (it saves with their world); crops grow on the farm's own clock, which
// runs only while the game is played: not while time is passed at a shrine
// (no sleeping a harvest in), and not on the host's clock in co-op. Pure
// rules: the engine (farm.ts, story.ts) plays them out.

import { CROPS, CROP_IDS, SEED_PACK, seedItem, type CropId } from '../data/goods';
import { shopPrice, type Character } from './character';

export const FARM = {
  /** Seed beds in the field, and how many are yours from the start. */
  plots: 9,
  free: 3,
  /** Embers to rent each further bed, in order. */
  rent: [120, 120, 120, 250, 250, 250],
  /** A watering keeps the soil wet this many game minutes. Dry soil grows at `dryRate`. */
  waterLasts: 240,
  dryRate: 0.5,
  /** Growth (share of the crop's time) where it sprouts, grows tall, and is ripe. */
  stageAt: [0.15, 0.5, 1] as const,
  /** Feeding a bed a fish or compost (before it is half grown) brings in more. */
  feed: { fish: 1, 'golden-fish': 2, compost: 1 } as Record<string, number>,
  /** With a watering can, the soil stays wet this long. */
  canLasts: 360,
  feedBefore: 0.5,
};

export interface Plot {
  crop: CropId;
  /** Minutes grown as of `at` (farm clock). */
  grown: number;
  at: number;
  /** Farm clock until which the soil is wet. */
  wetUntil: number;
  /** Extra crops from feeding (0: not fed). */
  fed: number;
}

export interface FarmState {
  /** Game minutes the farm has seen (play and passed time). */
  clock: number;
  /** Beds rented so far (counting the free ones). */
  owned: number;
  plots: (Plot | null)[];
  /** Harvests brought in, all told. */
  harvests: number;
}

export const newFarm = (): FarmState => ({ clock: 0, owned: FARM.free, plots: new Array(FARM.plots).fill(null), harvests: 0 });

const finite = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A farm from a save (an old save has none) made whole: bad beds are cleared, numbers made sane. */
export function normalizeFarm(raw: unknown): FarmState {
  const f = newFarm();
  if (!raw || typeof raw !== 'object') return f;
  const r = raw as Partial<FarmState>;
  f.clock = Math.max(0, finite(r.clock));
  f.owned = Math.max(FARM.free, Math.min(FARM.plots, Math.round(finite(r.owned, FARM.free))));
  f.harvests = Math.max(0, Math.round(finite(r.harvests)));
  const plots = Array.isArray(r.plots) ? r.plots : [];
  for (let i = 0; i < FARM.plots; i++) {
    const p = plots[i] as Partial<Plot> | null | undefined;
    if (!p || typeof p !== 'object' || !CROP_IDS.includes(p.crop as CropId)) continue;
    const crop = p.crop as CropId;
    f.plots[i] = {
      crop,
      grown: Math.max(0, Math.min(CROPS[crop].grow, finite(p.grown))),
      at: Math.max(0, Math.min(f.clock, finite(p.at))),
      wetUntil: Math.max(0, Math.min(f.clock + Math.max(FARM.waterLasts, FARM.canLasts), finite(p.wetUntil))),
      fed: Math.max(0, Math.min(2, Math.round(finite(p.fed)))),
    };
  }
  return f;
}

/** Minutes a crop has grown by `clock`: full speed while wet, half when dry, never past ripe. */
export function growthAt(p: Plot, clock: number): number {
  const span = Math.max(0, clock - p.at);
  const wet = Math.max(0, Math.min(span, p.wetUntil - p.at));
  return Math.min(CROPS[p.crop].grow, p.grown + wet + (span - wet) * FARM.dryRate);
}

/** 0..1 of the way to ripe. */
export const progress = (p: Plot, clock: number) => growthAt(p, clock) / CROPS[p.crop].grow;

/** 0 empty, 1 seeded, 2 sprouting, 3 growing tall, 4 ripe. */
export function stageOf(p: Plot | null, clock: number): 0 | 1 | 2 | 3 | 4 {
  if (!p) return 0;
  const k = progress(p, clock);
  return k >= FARM.stageAt[2] ? 4 : k >= FARM.stageAt[1] ? 3 : k >= FARM.stageAt[0] ? 2 : 1;
}

export const isWet = (p: Plot, clock: number) => clock < p.wetUntil;

/** Game minutes until ripe if it is kept watered from now. */
export const ripeIn = (p: Plot, clock: number) => Math.max(0, CROPS[p.crop].grow - growthAt(p, clock));

/** Brings a bed's growth up to now (before its water changes). */
function bank(p: Plot, clock: number) {
  p.grown = growthAt(p, clock);
  p.at = clock;
}

/** Sows a seed from the pack. Returns why not, or null. */
export function plant(c: Pick<Character, 'items'>, farm: FarmState, i: number, crop: CropId): string | null {
  if (i < 0 || i >= FARM.plots) return 'No such bed.';
  if (i >= farm.owned) return 'Rent this bed from Wren first.';
  if (farm.plots[i]) return 'Something already grows here.';
  const seed = seedItem(crop);
  if ((c.items[seed] ?? 0) <= 0) return `You have no ${CROPS[crop].name.toLowerCase()} seeds.`;
  c.items[seed]--;
  farm.plots[i] = { crop, grown: 0, at: farm.clock, wetUntil: 0, fed: 0 };
  return null;
}

/** Waters a bed: wet for a while (watering again only tops it up). */
export function water(farm: FarmState, i: number): boolean {
  const p = farm.plots[i];
  if (!p || stageOf(p, farm.clock) === 4) return false;
  bank(p, farm.clock);
  p.wetUntil = farm.clock + FARM.waterLasts;
  return true;
}

/** Waters every growing bed you have (a watering can), wet for `lasts`. Returns how many. */
export function waterAll(farm: FarmState, lasts: number): number {
  let n = 0;
  for (let i = 0; i < farm.owned; i++) {
    const p = farm.plots[i];
    if (!p || stageOf(p, farm.clock) === 4) continue;
    bank(p, farm.clock);
    p.wetUntil = Math.max(p.wetUntil, farm.clock + lasts);
    n++;
  }
  return n;
}

/** Feeds a bed a fish, a golden fish or compost: more at harvest. Once a crop, before it is half grown. */
export function feed(c: Pick<Character, 'items'>, farm: FarmState, i: number, item: string): string | null {
  const p = farm.plots[i];
  const bonus = FARM.feed[item];
  if (!p || !bonus) return 'Nothing to feed.';
  if (p.fed > 0) return 'This bed has been fed already.';
  if (progress(p, farm.clock) >= FARM.feedBefore) return 'Too late: feed it before it is half grown.';
  if ((c.items[item] ?? 0) <= 0) return 'You have none.';
  c.items[item]--;
  p.fed = bonus;
  return null;
}

/** How many a harvest brings in for a roll (0..1). */
export function cropYield(p: Plot, roll: number): number {
  const [lo, hi] = CROPS[p.crop].yield;
  return lo + Math.min(hi - lo, Math.floor(Math.max(0, roll) * (hi - lo + 1))) + p.fed;
}

/** Harvests a ripe bed into the pack and clears it. Returns how many, or null if it is not ripe. */
export function harvest(c: Pick<Character, 'items'>, farm: FarmState, i: number, roll: number): { crop: CropId; n: number } | null {
  const p = farm.plots[i];
  if (!p || stageOf(p, farm.clock) !== 4) return null;
  const n = cropYield(p, roll);
  c.items[p.crop] = (c.items[p.crop] ?? 0) + n;
  farm.plots[i] = null;
  farm.harvests++;
  return { crop: p.crop, n };
}

/** Pulls a bed up (the crop is lost). */
export function digUp(farm: FarmState, i: number) {
  farm.plots[i] = null;
}

/** What the next bed costs to rent (null when all are yours). */
export function rentPrice(c: Pick<Character, 'raceId'>, farm: FarmState): number | null {
  if (farm.owned >= FARM.plots) return null;
  return shopPrice(c, FARM.rent[farm.owned - FARM.free]);
}

export function rentPlot(c: Pick<Character, 'raceId' | 'gold'>, farm: FarmState): string | null {
  const price = rentPrice(c, farm);
  if (price === null) return 'Every bed is yours.';
  if (c.gold < price) return 'Not enough embers.';
  c.gold -= price;
  farm.owned++;
  return null;
}

/** A pack of seeds from Wren. */
export function buySeeds(c: Pick<Character, 'raceId' | 'gold' | 'items'>, crop: CropId): string | null {
  const price = shopPrice(c, CROPS[crop].seedPrice);
  if (c.gold < price) return 'Not enough embers.';
  c.gold -= price;
  const seed = seedItem(crop);
  c.items[seed] = (c.items[seed] ?? 0) + SEED_PACK;
  return null;
}

/** Sells every crop of a kind to Wren. Returns the embers earned. */
export function sellCrop(c: Pick<Character, 'gold' | 'items'>, crop: CropId): number {
  const n = c.items[crop] ?? 0;
  if (n <= 0) return 0;
  const earned = n * CROPS[crop].sell;
  c.items[crop] = 0;
  c.gold += earned;
  return earned;
}

/** Ripe beds right now. */
export function ripeCount(farm: FarmState): number {
  let n = 0;
  for (const p of farm.plots) if (p && stageOf(p, farm.clock) === 4) n++;
  return n;
}

/** A crop's name for a bedful: "carrots", but "wheat" and "madder" (no plural). */
export const uncountable = (id: CropId) => CROPS[id].plural === CROPS[id].name.toLowerCase();

/** One line for crops that ripened together: "Your carrots are ripe…", "Your madder is ripe…", "Your flax, woad and pumpkins are ripe…". */
export function ripeNews(crops: readonly CropId[]): string {
  const list = [...new Set(crops)];
  const words = list.map((id) => CROPS[id].plural);
  const named = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0];
  return `Your ${named} ${list.length === 1 && uncountable(list[0]) ? 'is' : 'are'} ripe in Wren's field.`;
}
