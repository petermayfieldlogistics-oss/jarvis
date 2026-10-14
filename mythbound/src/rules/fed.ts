// The one "Fed" slot: the buff from the last fruit (or sweet) eaten. One
// fruit at a time: the same fruit tops the timer up, a different one
// replaces it. It counts down by play time only (never the shared co-op
// clock, never time passed at a shrine), and death clears it. Everything
// here multiplies with the hero's other buffs. Pure rules: Character is
// imported only as a type (character.ts imports this file).

import { FRUITS, FRUIT_IDS, MEALS, type FedStat, type FruitId } from '../data/goods';
import type { DamageElement } from '../data/defs';
import type { Character } from './character';

export interface Fed {
  id: FruitId;
  /** Game minutes left. */
  left: number;
}

type HasFed = Pick<Character, 'fed'>;

/** The longest serving (a sunberry tart), and the most a saved buff may have left. */
export const LONGEST_SERVING = Math.max(...FRUIT_IDS.map((id) => FRUITS[id].lasts), ...Object.values(MEALS).map((m) => m.fedFor ?? 0));
export const FED_CAP = LONGEST_SERVING * 1.5;

/** A stat multiplier from the buff (1 when unfed, or when the fruit does something else). */
export function fedMul(c: HasFed, stat: FedStat): number {
  return c.fed ? (FRUITS[c.fed.id].mul?.[stat] ?? 1) : 1;
}

/** How much of this element's damage still lands (emberfig: fire ×0.65). */
export function fedTaken(c: HasFed, element: DamageElement): number {
  const t = c.fed ? FRUITS[c.fed.id].taken : undefined;
  return t && t.element === element ? t.mul : 1;
}

/** Share of max HP regenerated each second (heartapple). */
export const fedRegen = (c: HasFed) => (c.fed ? (FRUITS[c.fed.id].regen ?? 0) : 0);

/** Swims without tiring (tideberry). */
export const fedSwims = (c: HasFed) => !!c.fed && !!FRUITS[c.fed.id].swims;

/** Sees at night as a Dark Slayer does (duskcherry). */
export const fedNightVision = (c: HasFed) => !!c.fed && !!FRUITS[c.fed.id].nightVision;

export type FeedKind = 'new' | 'refresh' | 'replace';

/**
 * Fills the slot with a fruit's buff for `minutes`: the same fruit tops it
 * up to a full serving (never shortens it); a different one replaces it.
 */
export function feed(c: HasFed, id: FruitId, minutes: number): { kind: FeedKind; was: FruitId | null } {
  const m = Math.min(FED_CAP, Math.max(0, minutes));
  const cur = c.fed;
  if (cur && cur.id === id) {
    cur.left = Math.max(cur.left, m);
    return { kind: 'refresh', was: id };
  }
  c.fed = { id, left: m };
  return cur ? { kind: 'replace', was: cur.id } : { kind: 'new', was: null };
}

/** Counts the buff down by `minutes` of play. Returns the fruit that just wore off (or null). */
export function tickFed(c: HasFed, minutes: number): FruitId | null {
  const f = c.fed;
  if (!f) return null;
  f.left -= minutes;
  if (f.left > 0) return null;
  c.fed = null;
  return f.id;
}

/** Death clears the slot (resting and saving keep it). */
export function clearFed(c: HasFed) {
  c.fed = null;
}

/** A buff from a save made sane: unknown fruit, junk or spent numbers give none; a long one is capped. */
export function normalizeFed(raw: unknown): Fed | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Fed>;
  if (!FRUIT_IDS.includes(r.id as FruitId)) return null;
  const left = r.left;
  if (typeof left !== 'number' || !Number.isFinite(left) || left <= 0) return null;
  return { id: r.id as FruitId, left: Math.min(FED_CAP, left) };
}
