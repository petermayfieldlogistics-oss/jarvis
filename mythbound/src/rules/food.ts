// Eating: fish, crops and anything else in the pack that restores health or
// mana. X (or 🐟) picks what to eat, but never fruit or sweets (their buff is
// worth more than a heal); the satchel (Y or 🍎) and menus eat a chosen item.
// Nell's stall: fruit, fish and lures, the deal of the day, and the fish she
// buys (a few a day).

import { CROPS, FISH_CAP, FRUITS, FRUIT_IDS, NELL, PIP_CHANCE, seedItem, type CropId, type FruitId } from '../data/goods';
import { ITEMS } from '../data/world';
import { shopPrice, type Character } from './character';
import { feed, type FeedKind } from './fed';

/** Seconds between bites (no eating a whole pantry in one breath). */
export const EAT_GAP = 1;

/** Items that can be eaten, by what they restore (fixed at load; no per-frame work). */
export const FOOD_IDS = Object.keys(ITEMS).filter((id) => (ITEMS[id].heal ?? 0) > 0 || (ITEMS[id].mana ?? 0) > 0);

export const isFood = (id: string) => FOOD_IDS.includes(id);

/** Fruit and sweets: eaten for their buff, from the satchel (fixed at load). */
export const SATCHEL_IDS = FOOD_IDS.filter((id) => !!ITEMS[id].fed);
const PLAIN_IDS = FOOD_IDS.filter((id) => !ITEMS[id].fed);

export const isFruit = (id: string) => !!ITEMS[id]?.fed;

/** How many things X can eat the hero carries (fruit and sweets aside). */
export function foodCount(items: Record<string, number>): number {
  let n = 0;
  for (const id of PLAIN_IDS) n += Math.max(0, items[id] ?? 0);
  return n;
}

/** How much fruit and sweets the hero carries (the 🍎 button shows only then). */
export function satchelCount(items: Record<string, number>): number {
  let n = 0;
  for (const id of SATCHEL_IDS) n += Math.max(0, items[id] ?? 0);
  return n;
}

/**
 * What to eat: when hurt, the smallest healing food (the biggest below 40%
 * health, as with golden fish); at full health, something for mana if mana
 * is down. Null when there is nothing worth eating.
 */
export function pickFood(items: Record<string, number>, hpFrac: number, manaFrac: number): string | null {
  const heal = hpFrac < 1 ? pickFor(items, 'heal', hpFrac < 0.4) : null;
  return heal ?? (manaFrac < 1 ? pickFor(items, 'mana', false) : null);
}

/** The food for one need: foods mostly for that need first, a mixed meal mostly for the other only when there is nothing else. */
function pickFor(items: Record<string, number>, stat: 'heal' | 'mana', biggest: boolean): string | null {
  const other = stat === 'heal' ? 'mana' : 'heal';
  for (const strict of [true, false]) {
    let best: string | null = null;
    let bestV = biggest ? -1 : Infinity;
    // Fruit and sweets are never eaten for a quick heal.
    for (const id of PLAIN_IDS) {
      const v = ITEMS[id][stat] ?? 0;
      if (v <= 0 || (items[id] ?? 0) <= 0 || (strict && (ITEMS[id][other] ?? 0) > v)) continue;
      if (biggest ? v > bestV : v < bestV) (bestV = v), (best = id);
    }
    if (best) return best;
  }
  return null;
}

export interface Eaten {
  heal: number;
  mana: number;
  /** Fruit and sweets: the buff it gave, and what it did to the slot. */
  fed: { id: FruitId; minutes: number; kind: FeedKind; was: FruitId | null } | null;
  /** A pip kept (a seed item id), from a raw sunberry or heartapple. */
  pip: string | null;
}

/**
 * Eats one: takes it from the pack and says what it restores. Fruit and
 * sweets fill the Fed slot (when `c` is given); a raw pip fruit keeps a pip
 * on a roll (0..1) under PIP_CHANCE. Null when there is none.
 */
export function eatItem(items: Record<string, number>, id: string, c?: Pick<Character, 'fed'>, roll = 1): Eaten | null {
  if (!isFood(id) || (items[id] ?? 0) <= 0) return null;
  items[id]--;
  const def = ITEMS[id];
  let fed: Eaten['fed'] = null;
  if (def.fed && c) {
    const minutes = def.fedFor ?? FRUITS[def.fed].lasts;
    fed = { id: def.fed, minutes, ...feed(c, def.fed, minutes) };
  }
  const pip = pipFrom(id, roll);
  if (pip) items[pip] = (items[pip] ?? 0) + 1;
  return { heal: def.heal ?? 0, mana: def.mana ?? 0, fed, pip };
}

/** The pip a raw fruit leaves on a roll (0..1): sunberry and heartapple only, and only when the roll is under PIP_CHANCE. */
export function pipFrom(id: string, roll: number): string | null {
  if (!Object.hasOwn(CROPS, id) || CROPS[id as CropId].seedPrice > 0 || !Object.hasOwn(FRUITS, id)) return null;
  return roll < PIP_CHANCE ? seedItem(id as CropId) : null;
}

// ------------------------------------------------------------ Nell's stall --

/** What Nell has seen today: her day (play time, never the shared clock) and the fish bought on it. */
export interface Market {
  day: number;
  fish: number;
}

export const newMarket = (): Market => ({ day: 0, fish: 0 });

/** Nell's day: one per 1440 minutes of this hero's play time (never the co-op clock, never passed time). */
export const marketDay = (playTime: number) => Math.max(0, Math.floor((Number.isFinite(playTime) ? playTime : 0) / 1440));

/** A market from a save, made sane. */
export function normalizeMarket(raw: unknown): Market {
  const m = newMarket();
  if (!raw || typeof raw !== 'object') return m;
  const r = raw as Partial<Market>;
  if (typeof r.day === 'number' && Number.isFinite(r.day)) m.day = Math.max(0, Math.floor(r.day));
  if (typeof r.fish === 'number' && Number.isFinite(r.fish)) m.fish = Math.max(0, Math.min(FISH_CAP, Math.floor(r.fish)));
  return m;
}

/** Today's fresh fruit (25% off): the same all day, from a hash of the day. */
export function dealOfDay(day: number): FruitId {
  let h = Math.imul((Math.floor(day) | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return FRUIT_IDS[(h >>> 0) % FRUIT_IDS.length];
}

/** What a fruit costs this hero today (the fresh one is 25% off; zombies pay more). */
export function fruitPrice(c: Pick<Character, 'raceId'>, id: FruitId, day: number): number {
  const base = FRUITS[id].price;
  return shopPrice(c, dealOfDay(day) === id ? Math.round(base * (1 - NELL.deal)) : base);
}

/** Buys `n` of a fruit. Returns why not, or null. */
export function buyFruit(c: Pick<Character, 'raceId' | 'gold' | 'items'>, id: FruitId, day: number, n = 1): string | null {
  const cost = fruitPrice(c, id, day) * n;
  if (n < 1) return 'Nothing to buy.';
  if (c.gold < cost) return 'Not enough embers.';
  c.gold -= cost;
  c.items[id] = (c.items[id] ?? 0) + n;
  return null;
}

/** What Nell pays for one: fish and golden fish (capped a day), fruit at a quarter of her price. 0: she won't buy it. */
export function nellPays(id: string): number {
  if (id === 'fish') return NELL.buyFish;
  if (id === 'golden-fish') return NELL.buyGolden;
  if (Object.hasOwn(FRUITS, id)) return Math.floor(FRUITS[id as FruitId].price / 4);
  return 0;
}

/** Fish she will still take today. */
export function fishRoom(market: Market, day: number): number {
  return day === market.day ? Math.max(0, FISH_CAP - market.fish) : FISH_CAP;
}

/**
 * Sells fish (or golden fish) to Nell, as many as she will still take today.
 * A new day resets her count. Returns how many and the embers earned.
 */
export function sellFish(c: Pick<Character, 'gold' | 'items'>, market: Market, day: number, id: 'fish' | 'golden-fish', n = Infinity): { n: number; gold: number } {
  if (day !== market.day) {
    market.day = day;
    market.fish = 0;
  }
  const k = Math.max(0, Math.min(Math.floor(n), c.items[id] ?? 0, FISH_CAP - market.fish));
  if (k <= 0) return { n: 0, gold: 0 };
  c.items[id] = (c.items[id] ?? 0) - k;
  market.fish += k;
  const gold = k * nellPays(id);
  c.gold += gold;
  return { n: k, gold };
}

/** Sells every one of a fruit to Nell (no cap: she pays a quarter of her price). */
export function sellFruit(c: Pick<Character, 'gold' | 'items'>, id: FruitId): number {
  const n = c.items[id] ?? 0;
  if (n <= 0) return 0;
  const gold = n * nellPays(id);
  c.items[id] = 0;
  c.gold += gold;
  return gold;
}
