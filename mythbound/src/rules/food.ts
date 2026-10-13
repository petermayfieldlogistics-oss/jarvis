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
  let best: string | null = null;
  if (hpFrac < 1) {
    const big = hpFrac < 0.4;
    let bestHeal = big ? -1 : Infinity;
    for (const id of FOOD_IDS) {
      const heal = ITEMS[id].heal ?? 0;
      if (heal <= 0 || (items[id] ?? 0) <= 0) continue;
      if (big ? heal > bestHeal : heal < bestHeal) (bestHeal = heal), (best = id);
    }
    if (best) return best;
  }
  if (manaFrac < 1) {
    let bestMana = Infinity;
    for (const id of FOOD_IDS) {
      const mana = ITEMS[id].mana ?? 0;
      if (mana <= 0 || (items[id] ?? 0) <= 0) continue;
      if (mana < bestMana) (bestMana = mana), (best = id);
    }
  }
  return best;
}

/** Eats one: takes it from the pack and says what it restores (null when there is none). */
export function eatItem(items: Record<string, number>, id: string): { heal: number; mana: number } | null {
  if (!isFood(id) || (items[id] ?? 0) <= 0) return null;
  items[id]--;
  return { heal: ITEMS[id].heal ?? 0, mana: ITEMS[id].mana ?? 0 };
}
