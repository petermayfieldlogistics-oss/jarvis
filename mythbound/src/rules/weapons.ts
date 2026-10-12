// Rules for the newer weapons: how they are held, how far and how wide they
// hit, throwing-knife stacks, runes inscribed at an anvil, the bard's songs
// and what the town's shops sell.

import { RUNES, WEAPONS, runeItem, type DamageElement, type RuneId, type ShopId, type WeaponDef, type WeaponKind } from '../data/defs';
import type { Affinity } from '../data/world';
import type { Character } from './character';

// ------------------------------------------------------------- handling --

/** Held in the left hand; the right stays free. */
export const isOffhand = (k: WeaponKind) => k === 'bow' || k === 'lyre' || k === 'runecircle';
/** Both hands on the grip, so no shield on the arm. */
export const isTwoHanded = (k: WeaponKind) => k === 'greatsword' || k === 'battleaxe';
/** Played rather than swung. */
export const isInstrument = (k: WeaponKind) => k === 'lyre' || k === 'horn';

/** The older kind whose talents (Keen Edge, Heavy Hand, Rend) and bleeding a weapon shares. */
export const family = (k: WeaponKind): WeaponKind =>
  k === 'longsword' || k === 'greatsword' ? 'sword' : k === 'battleaxe' ? 'axe' : k === 'knives' ? 'dagger' : k;

/** Weapons whose `range` is a throw or a spell keep this reach up close (stabbing with a knife, a wand's bonk). */
const CLOSE_REACH: Partial<Record<WeaponKind, number>> = { knives: 1.9, wand: 1.6, runecircle: 1.6, lyre: 1.8, horn: 1.8 };

/** How far a melee blow reaches. */
export const meleeReach = (def: WeaponDef) => CLOSE_REACH[def.kind] ?? def.range;

/**
 * How wide a blow sweeps: the cosine of its half-angle from the facing
 * (lower is wider, below -1 is all round). Spear thrusts are long and narrow;
 * greatswords and battle axes cleave wide.
 */
export function swingArc(kind: WeaponKind, move: 'light' | 'heavy' | 'spin', cleave: boolean): number {
  if (move === 'spin') return -1.01;
  if (kind === 'spear') return move === 'heavy' ? -0.6 : 0.55;
  if (kind === 'greatsword' || kind === 'battleaxe') return cleave ? -0.45 : -0.25;
  return cleave ? -0.2 : 0.25;
}

// ------------------------------------------------------- casting focus --

/** Wand bolts cost a little mana; a wand in hand makes spells hit harder. */
export const WAND = { mana: 2, heavyMana: 7, spellPower: 1.15 };

/** Rune traps drawn on the ground, and the binding seal around the caster. */
export const RUNE_TRAP = { mana: 6, radius: 2.6, seconds: 8, tick: 0.5, max: 3, slow: 1 };
export const RUNE_SEAL = { mana: 14, radius: 4.5, seconds: 4, root: 2.5 };

// -------------------------------------------------------- throwing knives --

export const MAX_KNIVES = 12;
/** A heavy throw looses this many in a fan. */
export const KNIFE_VOLLEY = 3;

export const ownsKnives = (c: Character) => c.weapons.some((w) => WEAPONS[w.id]?.kind === 'knives');

/** Resting refills the stack (if the hero carries throwing knives at all). */
export function refillKnives(c: Character) {
  if (ownsKnives(c)) c.knives = MAX_KNIVES;
}

/** A knife picked up where it landed. False when the bandolier is full. */
export function pickUpKnife(c: Character): boolean {
  if (c.knives >= MAX_KNIVES) return false;
  c.knives++;
  return true;
}

// ------------------------------------------------------------------ runes --

export interface RuneEffect {
  /** A status set on the foe for `seconds`. */
  status?: 'burn' | 'slow' | 'poison';
  seconds: number;
  /** Lightning leaps to this many foes nearby for a share of the hit. */
  chain?: number;
  element: DamageElement;
}

export const RUNE_EFFECT: Record<RuneId, RuneEffect> = {
  fire: { status: 'burn', seconds: 3, element: 'fire' },
  frost: { status: 'slow', seconds: 2.5, element: 'water' },
  storm: { chain: 2, seconds: 0, element: 'lightning' },
  venom: { status: 'poison', seconds: 5, element: 'earth' },
};
/** A storm rune's leap: this share of the hit, this far. */
export const STORM_CHAIN = { share: 0.4, range: 6 };

/** Legendary weapons carry their own power; thrown bolts have nowhere to hold a rune. */
export const canBearRune = (weaponId: string) => !!WEAPONS[weaponId] && !WEAPONS[weaponId].legendary && WEAPONS[weaponId].kind !== 'bolt';

/** Inscribes a rune from the pack on a weapon; a rune it already bore goes back in the pack. */
export function inscribe(c: Character, weaponIndex: number, rune: RuneId): boolean {
  const w = c.weapons[weaponIndex];
  const item = runeItem(rune);
  if (!w || !RUNES[rune] || (c.items[item] ?? 0) <= 0 || w.rune === rune || !canBearRune(w.id)) return false;
  c.items[item]--;
  if (w.rune) c.items[runeItem(w.rune)] = (c.items[runeItem(w.rune)] ?? 0) + 1;
  w.rune = rune;
  return true;
}

/** Runes in the pack, as [id, count]. */
export const runesHeld = (c: Character) =>
  (Object.keys(RUNES) as RuneId[]).map((id) => [id, c.items[runeItem(id)] ?? 0] as const).filter(([, n]) => n > 0);

/** Normal foes drop a rune now and then; bosses always do. */
export const RUNE_DROP_CHANCE = 0.04;
const ANY: RuneId[] = ['fire', 'frost', 'storm', 'venom'];

/** The rune a felled foe leaves (if any), matched to what it is made of. `roll` and `pick` are 0..1 randoms. */
export function runeDrop(affinity: Affinity, boss: boolean, roll: number, pick: number): RuneId | null {
  if (!boss && roll >= RUNE_DROP_CHANCE) return null;
  switch (affinity) {
    case 'fire':
      return 'fire';
    case 'water':
      return 'frost';
    case 'wind':
      return 'storm';
    case 'earth':
    case 'dark':
      return 'venom';
    case 'none':
      return ANY[Math.min(3, Math.floor(pick * 4))];
  }
}

// ------------------------------------------------------------------ songs --

export type SongId = 'valor' | 'warcry';

export interface SongDef {
  name: string;
  /** Allies' damage multiplier while it lasts. */
  damage: number;
  /** Allies' move speed multiplier. */
  speed: number;
  /** HP per second. */
  regen: number;
  color: number;
  /** What it does to foes close by. */
  foe: 'stun' | 'fear';
  foeSeconds: number;
}

export const SONGS: Record<SongId, SongDef> = {
  valor: { name: 'Song of Valor', damage: 1.25, speed: 1, regen: 4, color: 0xffd25a, foe: 'stun', foeSeconds: 2 },
  warcry: { name: 'War Cry', damage: 1.2, speed: 1.2, regen: 0, color: 0xff7a3a, foe: 'fear', foeSeconds: 4 },
};
/** Allies within `radius` hear a song for `seconds`; foes within `foeRadius` suffer it. */
export const SONG = { radius: 14, foeRadius: 9, seconds: 12, cooldown: 15 };

export const songOf = (kind: WeaponKind): SongId | null => (kind === 'lyre' ? 'valor' : kind === 'horn' ? 'warcry' : null);

// ------------------------------------------------------------------ shops --

export const shopStock = (shop: ShopId) => Object.values(WEAPONS).filter((w) => w.shop === shop && w.price !== undefined);

/** Buys a weapon: null when it worked, else why not. */
export function buyWeapon(c: Character, id: string): string | null {
  const def = WEAPONS[id];
  if (!def || def.price === undefined) return 'That is not for sale.';
  if (c.weapons.some((w) => w.id === id)) return 'You already have one.';
  if (c.gold < def.price) return 'Not enough embers.';
  c.gold -= def.price;
  c.weapons.push({ id, level: 1 });
  if (def.kind === 'knives') c.knives = MAX_KNIVES;
  return null;
}

/** Buys an uninscribed rune for the pack. */
export function buyRune(c: Character, rune: RuneId): boolean {
  const def = RUNES[rune];
  if (!def || c.gold < def.price) return false;
  c.gold -= def.price;
  c.items[runeItem(rune)] = (c.items[runeItem(rune)] ?? 0) + 1;
  return true;
}
