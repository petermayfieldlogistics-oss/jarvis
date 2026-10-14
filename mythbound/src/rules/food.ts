// Eating: fish, crops and anything else in the pack that restores health or
// mana. X (or 🐟) picks what to eat; menus can eat a chosen item.

import { ITEMS } from '../data/world';

/** Seconds between bites (no eating a whole pantry in one breath). */
export const EAT_GAP = 1;

/** Items that can be eaten, by what they restore (fixed at load; no per-frame work). */
export const FOOD_IDS = Object.keys(ITEMS).filter((id) => (ITEMS[id].heal ?? 0) > 0 || (ITEMS[id].mana ?? 0) > 0);

export const isFood = (id: string) => FOOD_IDS.includes(id);

/** How many things to eat the hero carries. */
export function foodCount(items: Record<string, number>): number {
  let n = 0;
  for (const id of FOOD_IDS) n += Math.max(0, items[id] ?? 0);
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
    for (const id of FOOD_IDS) {
      const v = ITEMS[id][stat] ?? 0;
      if (v <= 0 || (items[id] ?? 0) <= 0 || (strict && (ITEMS[id][other] ?? 0) > v)) continue;
      if (biggest ? v > bestV : v < bestV) (bestV = v), (best = id);
    }
    if (best) return best;
  }
  return null;
}

/** Eats one: takes it from the pack and says what it restores (null when there is none). */
export function eatItem(items: Record<string, number>, id: string): { heal: number; mana: number } | null {
  if (!isFood(id) || (items[id] ?? 0) <= 0) return null;
  items[id]--;
  return { heal: ITEMS[id].heal ?? 0, mana: ITEMS[id].mana ?? 0 };
}
