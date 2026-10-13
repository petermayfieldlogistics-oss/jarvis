// Crafting: recipes made at stations (the cookfire and workbench by Wren's
// field, any anvil, and a shrine's flame for simple camp cooking). Everything
// made or used is an ordinary item in the pack (or arrows). Pure rules: the
// engine (story.ts) plays them out.

import { MATERIALS, MATERIAL_DROPS, RECIPES, SUPPLIES, type Output, type RecipeDef, type StationId } from '../data/goods';
import type { Character } from './character';
import { grantDye, grantGarment, knowsDye, ownsGarment } from './outfit';

type Pack = Pick<Character, 'items' | 'arrows' | 'gold' | 'roleId' | 'wardrobe'>;

/** The recipes made here (at a shrine, only camp cooking). */
export function recipesAt(station: StationId, camp = false): RecipeDef[] {
  return RECIPES.filter((r) => r.station === station && (!camp || r.camp));
}

export const recipe = (id: string) => RECIPES.find((r) => r.id === id) ?? null;

/** A tool already in the pack (one is enough). */
export const hasTool = (c: Pick<Character, 'items'>, id: string) => (c.items[id] ?? 0) > 0;

/** Embers a recipe costs this hero: a blacksmith pays half at the anvil. */
export function recipeGold(c: Pick<Character, 'roleId'>, r: RecipeDef): number {
  const g = r.gold ?? 0;
  return r.station === 'anvil' && c.roleId === 'blacksmith' ? Math.ceil(g / 2) : g;
}

/** What is missing for one batch (empty when it can be made). */
export function lacking(c: Pack, r: RecipeDef): { id: string; have: number; need: number }[] {
  const out: { id: string; have: number; need: number }[] = [];
  for (const [id, need] of Object.entries(r.needs)) {
    const have = c.items[id] ?? 0;
    if (have < need) out.push({ id, have, need });
  }
  if (r.arrows && c.arrows.wood < r.arrows) out.push({ id: 'arrows', have: c.arrows.wood, need: r.arrows });
  return out;
}

/** Made once and already had: a tool in the pack, a garment in the wardrobe, a dye colour known. */
export function hasMade(c: Pick<Character, 'items' | 'wardrobe'>, r: RecipeDef): boolean {
  if (!r.once) return false;
  const out = r.makes;
  if (out.kind === 'item') return hasTool(c, out.id);
  if (out.kind === 'garment') return ownsGarment(c.wardrobe, out.id);
  if (out.kind === 'dye') return knowsDye(c.wardrobe, out.id);
  return false;
}

/** How many batches the pack (and purse) can make (a tool already owned: none). */
export function batches(c: Pack, r: RecipeDef): number {
  if (hasMade(c, r)) return 0;
  let n = Infinity;
  for (const [id, need] of Object.entries(r.needs)) n = Math.min(n, Math.floor((c.items[id] ?? 0) / need));
  if (r.arrows) n = Math.min(n, Math.floor(c.arrows.wood / r.arrows));
  const gold = recipeGold(c, r);
  if (gold > 0) n = Math.min(n, Math.floor(c.gold / gold));
  if (r.once) n = Math.min(n, 1);
  return n === Infinity ? 0 : Math.max(0, n);
}

/** Puts what a recipe makes into the pack (or the wardrobe). */
export function give(c: Pick<Character, 'items' | 'arrows' | 'wardrobe'>, out: Output, times = 1) {
  if (out.kind === 'arrows') c.arrows[out.type] += out.n * times;
  else if (out.kind === 'garment') grantGarment(c.wardrobe, out.id);
  else if (out.kind === 'dye') grantDye(c.wardrobe, out.id);
  else c.items[out.id] = (c.items[out.id] ?? 0) + out.n * times;
}

/** Makes a recipe up to `times` times (as many as the pack allows). Returns batches made. */
export function craft(c: Pack, r: RecipeDef, times: number): number {
  const n = Math.min(Math.max(0, Math.floor(times)), batches(c, r));
  if (n <= 0) return 0;
  for (const [id, need] of Object.entries(r.needs)) c.items[id] = (c.items[id] ?? 0) - need * n;
  if (r.arrows) c.arrows.wood -= r.arrows * n;
  c.gold -= recipeGold(c, r) * n;
  give(c, r.makes, n);
  return n;
}

/** A material from a foe, by a roll (0..1): null when it drops nothing. */
export function materialDrop(enemyId: string, roll: number): string | null {
  const d = MATERIAL_DROPS[enemyId];
  return d && roll < d.chance ? d.item : null;
}

/** What Quill pays for a material (0: not for sale). */
export const sellValue = (id: string) => MATERIALS[id]?.sell ?? 0;

/** Sells every one of a material to Quill. Returns the embers earned. */
export function sellAll(c: Pick<Character, 'items' | 'gold'>, id: string): number {
  const n = c.items[id] ?? 0;
  const each = sellValue(id);
  if (n <= 0 || each <= 0) return 0;
  c.items[id] = 0;
  c.gold += n * each;
  return n * each;
}

/**
 * A cast's catch zone (% of the track) and the golden window either side of
 * its middle: wider for sailors, with a silk line, and with a lure (used up).
 */
export function fishingPerks(c: Pick<Character, 'items' | 'roleId'>, lure: boolean): { zone: number; golden: number } {
  let zone = c.roleId === 'sailor' ? 34 : 22;
  if (hasTool(c, 'fishing-line')) zone += 6;
  if (lure) zone += 8;
  return { zone, golden: lure ? 5 : 3 };
}

/** Every tool a recipe can make. */
export const TOOLS = Object.keys(SUPPLIES).filter((id) => SUPPLIES[id].tool);
