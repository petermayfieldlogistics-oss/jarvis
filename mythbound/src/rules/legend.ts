// Legend perks: legendary weapons (and the great foes' unique drops) take
// perks at an anvil, paid for with Legend Shards from great foes fought on
// Heroic or harder. A weapon opens more slots as it is upgraded. The numbers
// live here; the engine (game.ts, player.ts) plays them out.

import { LEGEND_SHARD, PERKS, WEAPONS, type PerkId, type WeaponInstance } from '../data/defs';

type Armed = { weapons: WeaponInstance[]; mainHand: number };
type Pack = { items: Record<string, number> };

/** What each perk does, in numbers. */
export const PERK = {
  vampiric: 0.08,
  executioner: { below: 0.35, power: 1.4 },
  swiftness: 0.85,
  thunderstrike: { every: 5, power: 1.2, radius: 3.5 },
  colossus: 1.15,
  soulFeast: 0.1,
  ruthless: { chance: 0.15, power: 2 },
  giantSlayer: 1.25,
  bulwark: 0.88,
  tempest: { chance: 0.2, shove: 8, slow: 2 },
};

/** Reaper's Edge reaps without any perk: it heals on every hit, cuts the hurt deeper, and feeds on kills. */
export const REAP = { heal: 0.12, below: 0.5, power: 1.3, killHeal: 0.08 };

/** Can this weapon take legend perks? */
export function takesPerks(weaponId: string): boolean {
  const def = WEAPONS[weaponId];
  return !!def && (!!def.legendary || !!def.legend);
}

/** Perk slots by weapon level: one to begin with, a second at level 5, a third at level 10. */
export function perkSlots(w: WeaponInstance): number {
  if (!takesPerks(w.id)) return 0;
  return 1 + (w.level >= 5 ? 1 : 0) + (w.level >= 10 ? 1 : 0);
}

/** The level a weapon needs to open each slot. */
export const SLOT_LEVELS = [1, 5, 10];

/** Legend Shards to set a perk in a slot (the deeper slots cost more; replacing one costs the same). */
export const perkCost = (slot: number) => [2, 4, 7][slot] ?? 7;

export const shardsHeld = (c: Pack) => c.items[LEGEND_SHARD] ?? 0;

/** The perks on the weapon in hand. */
export function perksOf(c: Armed): PerkId[] {
  return c.weapons[c.mainHand]?.perks ?? [];
}

export const hasPerk = (c: Armed, id: PerkId) => perksOf(c).includes(id);

export const holdsReaper = (c: Armed) => c.weapons[c.mainHand]?.id === 'reapers-edge';

/** Why a perk can't go in that slot, or null if it can. */
export function perkProblem(c: Armed & Pack, index: number, slot: number, perk: PerkId): string | null {
  const w = c.weapons[index];
  if (!w || !takesPerks(w.id)) return 'Only legendary weapons take legend perks.';
  if (!Object.hasOwn(PERKS, perk)) return 'No such perk.';
  if (slot < 0 || slot >= perkSlots(w)) return `Upgrade it to level ${SLOT_LEVELS[slot] ?? 10} to open that slot.`;
  const have = w.perks ?? [];
  if (have[slot] === perk) return 'That perk is already there.';
  if (have.some((p, i) => p === perk && i !== slot)) return 'The weapon already bears that perk.';
  if (shardsHeld(c) < perkCost(slot)) return `It takes ${perkCost(slot)} Legend Shards.`;
  return null;
}

/** Sets a perk into a slot (replacing what was there) and pays the shards. */
export function setPerk(c: Armed & Pack, index: number, slot: number, perk: PerkId): boolean {
  if (perkProblem(c, index, slot, perk)) return false;
  const w = c.weapons[index];
  const have = [...(w.perks ?? [])];
  // Slots fill in order: a perk set past the end lands in the first empty one.
  have[Math.min(slot, have.length)] = perk;
  w.perks = have;
  c.items[LEGEND_SHARD] = shardsHeld(c) - perkCost(slot);
  return true;
}

/** Old or edited saves: unknown perks, duplicates and perks past the open slots are dropped. */
export function normalizePerks(w: WeaponInstance) {
  if (!w.perks) return;
  if (!Array.isArray(w.perks)) {
    delete w.perks;
    return;
  }
  const seen = new Set<PerkId>();
  w.perks = w.perks.filter((p) => Object.hasOwn(PERKS, p) && !seen.has(p) && (seen.add(p), true)).slice(0, perkSlots(w));
  if (!w.perks.length) delete w.perks;
}
