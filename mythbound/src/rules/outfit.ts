// What a hero wears: their class's own clothes, their role's colours, and
// over those, the garments and dyes they chose in the wardrobe. Purely for
// looks. Pure: the engine (player.ts) builds the model from the look.
//
// Saves keep garment and dye ids; co-op sends garment indices (GARMENTS is
// append-only) and colours as hex, so a friend on an older build with fewer
// dyes still sees the right colours.

import type { ClassId, RaceId, RoleId, SubclassId } from '../data/defs';
import {
  CHANNELS, DYE_INDEX, DYES, GARMENT_INDEX, GARMENTS, SLOTS, UNDYED_CLOAK, dyeOf, garment,
  type Build, type DyeChannel, type GarmentDef, type HeadLook, type Slot,
} from '../data/goods';
import { WEAPON_TRIALS } from '../data/world';
export type Look = {
  armor: number;
  cloth: number;
  accent: number;
  build: Build;
  head: HeadLook;
  cape?: number;
  headband?: number;
  circlet?: number;
  /** The class the clothes are cut for (heroes only). */
  garb?: ClassId;
  /** Glowing runes in a caster's clothes. */
  glow?: number;
  /** A sorcerer's beard (on races with a human face). */
  beard?: number;
};

/** Each class's clothes; the newer classes dress for their subclass. */
export function classLook(classId: ClassId, subclassId: SubclassId | null | undefined): Look {
  switch (classId) {
    case 'warrior':
      // Bright plate, a tattered tabard and scarf in the cloth colour; an axeman's steel is darker.
      return subclassId === 'axeman'
        ? { armor: 0x77736c, cloth: 0x6e2a16, accent: 0x9a7444, build: 'heavy', head: 'helmet', cape: 0x5c4028, garb: 'warrior' }
        : { armor: 0x8c8c8e, cloth: 0x8a1c18, accent: 0xb0904a, build: 'heavy', head: 'helmet', cape: 0x7a1c16, garb: 'warrior' };
    case 'ranger':
      // Leathers under a hood and leaf-cut cape (a quiver on the back, so no cloak): a bowman's
      // forest green, a beast trainer's tan.
      return subclassId === 'trainer'
        ? { armor: 0x5a3e26, cloth: 0x8a6a3c, accent: 0xa08a5a, build: 'light', head: 'hood', garb: 'ranger' }
        : { armor: 0x6a4a2c, cloth: 0x3e6030, accent: 0xb09050, build: 'light', head: 'hood', garb: 'ranger' };
    case 'mage':
      // Royal blue under a pointed hat, a navy shoulder cape and underrobe, gold, a glowing stone.
      return { armor: 0x232c5e, cloth: 0x34479a, accent: 0xd8b04a, build: 'robe', head: 'hat', garb: 'mage', glow: 0x7fd8ff };
    case 'monk':
      // A robe draped over one shoulder (its trousers take `armor`), a sash, a shaven head
      // with a mark on the brow in the sash's colour; a windwalker binds a band round it.
      return subclassId === 'windwalker'
        ? { armor: 0x4e6670, cloth: 0xdcd6c0, accent: 0x2f8a86, build: 'gi', head: 'bare', headband: 0x2f8a86, garb: 'monk' }
        : subclassId === 'ironfist'
          ? { armor: 0x3e2c22, cloth: 0x9a3a1a, accent: 0x2a2220, build: 'gi', head: 'bare', garb: 'monk' }
          : { armor: 0x9a5420, cloth: 0xd8781c, accent: 0x9a2018, build: 'gi', head: 'bare', garb: 'monk' };
    case 'sorcerer':
      // A tall hood and mantle (`armor`) over a flowing robe, a long beard: a lightmage's pale
      // and gold with a circlet under the hood, a darkmage's deep violet, eyes glowing in the dark.
      return subclassId === 'lightmage'
        ? { armor: 0xd6ccae, cloth: 0xece4cf, accent: 0xd8ac3e, build: 'robe', head: 'hood', circlet: 0xe0b84a, garb: 'sorcerer', glow: 0xffe6a0, beard: 0xf0ece2 }
        : { armor: 0x33283f, cloth: 0x4a3466, accent: 0x9a6ae0, build: 'robe', head: 'hood', garb: 'sorcerer', glow: 0xb07cff, beard: 0x9a96a2 };
    case 'rogue':
      // Dark leathers with lighter straps, a hood and a mask; a duelist shows oxblood, gold and a cloak.
      return subclassId === 'duelist'
        ? { armor: 0x5a2a26, cloth: 0x2e2224, accent: 0xc8a050, build: 'light', head: 'mask', cape: 0x7a1a1c, garb: 'rogue' }
        : { armor: 0x58546e, cloth: 0x363444, accent: 0xb4b8c4, build: 'light', head: 'mask', garb: 'rogue' };
  }
}

/** A role's colours over the class's clothes: a knight's pale steel, an assassin's black. */
export function roleTint(look: Look, classId: ClassId, roleId: RoleId): Look {
  if (roleId === 'knight') {
    look.armor = 0xc8c0a8;
    look.accent = 0xffe080;
    if (look.build !== 'gi') look.cape = 0xb8ae94;
  }
  if ((roleId === 'assassin' || roleId === 'darkslayer') && classId !== 'rogue') {
    look.cloth = 0x18161a;
    if (look.build !== 'gi') look.cape = 0x101012;
    if (classId !== 'warrior' && look.build !== 'gi') look.armor = 0x24222a;
  }
  return look;
}

/** A hero's own clothes before the wardrobe: class, subclass and role. */
export const baseLook = (classId: ClassId, subclassId: SubclassId | null | undefined, roleId: RoleId): Look =>
  roleTint(classLook(classId, subclassId), classId, roleId);

// --------------------------------------------------------------- wardrobe --

/** What is worn: a garment id per slot and a dye id per channel (null: the class's own). */
export type Outfit = Record<Slot | DyeChannel, string | null>;

export interface Wardrobe {
  /** Garments owned (the free ones always). */
  owned: string[];
  /** Dye colours learned. */
  dyes: string[];
  outfit: Outfit;
}

/** The slots and channels in wire order. */
export const OUTFIT_KEYS = [...SLOTS, ...CHANNELS] as const;

export const FREE_GARMENTS = GARMENTS.filter((g) => g.free).map((g) => g.id);

export const plainOutfit = (): Outfit => ({ head: null, body: null, cloak: null, cloth: null, armor: null, trim: null, cape: null });

export const newWardrobe = (): Wardrobe => ({ owned: [...FREE_GARMENTS], dyes: [], outfit: plainOutfit() });

const ids = (x: unknown, known: Map<string, number>): string[] =>
  Array.isArray(x) ? [...new Set(x.filter((v): v is string => typeof v === 'string' && known.has(v)))] : [];

/** Fills in a missing wardrobe and drops what isn't known or owned (old saves, edited saves). */
export function normalizeWardrobe(w: unknown): Wardrobe {
  const o = (w && typeof w === 'object' ? w : {}) as Partial<Record<keyof Wardrobe, unknown>>;
  const owned = ids(o.owned, GARMENT_INDEX);
  for (const id of FREE_GARMENTS) if (!owned.includes(id)) owned.push(id);
  const dyes = ids(o.dyes, DYE_INDEX);
  const raw = (o.outfit && typeof o.outfit === 'object' ? o.outfit : {}) as Record<string, unknown>;
  const outfit = plainOutfit();
  for (const slot of SLOTS) {
    const id = raw[slot];
    if (typeof id === 'string' && owned.includes(id) && garment(id)?.slot === slot) outfit[slot] = id;
  }
  for (const ch of CHANNELS) {
    const id = raw[ch];
    if (typeof id === 'string' && dyes.includes(id)) outfit[ch] = id;
  }
  return { owned, dyes, outfit };
}

export const ownsGarment = (w: Wardrobe, id: string) => w.owned.includes(id);
export const knowsDye = (w: Wardrobe, id: string) => w.dyes.includes(id);

/** Adds a garment or a dye colour (false: had it already, or no such thing). */
export function grantGarment(w: Wardrobe, id: string): boolean {
  if (!GARMENT_INDEX.has(id) || w.owned.includes(id)) return false;
  w.owned.push(id);
  return true;
}

export function grantDye(w: Wardrobe, id: string): boolean {
  if (!DYE_INDEX.has(id) || w.dyes.includes(id)) return false;
  w.dyes.push(id);
  return true;
}

/** Buys a garment or a colour from Quill (at `price`, after any markup). Returns why not, or null when bought. */
export function buyLook(c: { gold: number; wardrobe: Wardrobe }, kind: 'garment' | 'dye', id: string, price?: number): string | null {
  const def = kind === 'garment' ? garment(id) : dyeOf(id);
  if (!def?.price) return 'Quill doesn’t sell that.';
  if (kind === 'garment' ? ownsGarment(c.wardrobe, id) : knowsDye(c.wardrobe, id)) return 'You have it already.';
  const cost = price ?? def.price;
  if (c.gold < cost) return `You need ${cost} embers.`;
  c.gold -= cost;
  if (kind === 'garment') grantGarment(c.wardrobe, id);
  else grantDye(c.wardrobe, id);
  return null;
}

/**
 * What a hero has earned by deeds (the crown for all six weapon trials, a
 * colour for each elder relic). Given again on loading, so heroes who earned
 * them before the wardrobe existed have them. Returns the names newly given.
 */
export function earnedUnlocks(c: { items: Record<string, number>; wardrobe: Wardrobe }, trialsDone: readonly string[]): string[] {
  const got: string[] = [];
  if (WEAPON_TRIALS.every((t) => trialsDone.includes(t.id)) && grantGarment(c.wardrobe, 'crown')) got.push(garment('crown')!.name);
  const relicDyes: [string, string][] = [['leviathan-pearl', 'pearl'], ['tide-crown', 'tidal'], ['dragon-heart', 'dragonfire']];
  for (const [relic, d] of relicDyes) if ((c.items[relic] ?? 0) > 0 && grantDye(c.wardrobe, d)) got.push(`${dyeOf(d)!.name} dye`);
  return got;
}

// ------------------------------------------------------------------ looks --

/** An outfit made concrete: the garments, and colours as hex (null: the class's own). From a save or the wire. */
export interface Dressed {
  head: GarmentDef | null;
  body: GarmentDef | null;
  cloak: GarmentDef | null;
  cloth: number | null;
  armor: number | null;
  trim: number | null;
  cape: number | null;
}

export const PLAIN: Readonly<Dressed> = Object.freeze({ head: null, body: null, cloak: null, cloth: null, armor: null, trim: null, cape: null });

export function dressedOf(o: Outfit): Dressed {
  const hex = (id: string | null) => dyeOf(id)?.hex ?? null;
  return { head: garment(o.head), body: garment(o.body), cloak: garment(o.cloak), cloth: hex(o.cloth), armor: hex(o.armor), trim: hex(o.trim), cape: hex(o.cape) };
}

export const isPlain = (d: Dressed) => OUTFIT_KEYS.every((k) => d[k] === null);

/** Why a slot can't be changed for this race (null: it can). */
export function lockedSlot(raceId: RaceId, slot: Slot): string | null {
  if (raceId === 'angelic' && slot === 'cloak') return 'Your wings leave no room for a cloak.';
  if (raceId === 'ancient' && slot === 'head') return 'Your kind keeps its face hidden.';
  return null;
}

/** What keeps a hero from changing clothes now (null: nothing). */
export function wardrobeBlock(s: {
  alive: boolean;
  riding: boolean;
  inTrial: boolean;
  threatened: boolean;
  sinceHurt: number;
  swimming: boolean;
  flying: boolean;
  sailing: boolean;
  busy: boolean;
}): string | null {
  if (!s.alive) return 'Not now.';
  if (s.riding) return 'Get down from your horse first.';
  if (s.swimming || s.sailing || s.flying) return 'Change clothes on dry land.';
  if (s.inTrial || s.threatened || s.sinceHurt < 4) return 'Change clothes somewhere safe.';
  if (s.busy) return 'Finish what you are doing first.';
  return null;
}

/** The outfit without what this race can't wear. */
export function wearable(d: Dressed, raceId: RaceId): Dressed {
  if (!SLOTS.some((s) => d[s] && lockedSlot(raceId, s))) return d;
  const out = { ...d };
  for (const s of SLOTS) if (lockedSlot(raceId, s)) out[s] = null;
  return out;
}

const SILVER = 0xc8ccd4;

/** Garments and dyes over a hero's own look (before race touches: grave dust, wings, an ancient's hood). */
export function applyOutfit(look: Look, d: Dressed): Look {
  if (d.head?.head) {
    look.head = d.head.head;
    // A head garment replaces the class's own band.
    look.headband = d.head.band === 'headband' ? d.trim ?? look.accent : undefined;
    look.circlet = d.head.band === 'circlet' ? d.trim ?? SILVER : undefined;
  } else if (d.trim !== null) {
    if (look.headband !== undefined) look.headband = d.trim;
    if (look.circlet !== undefined) look.circlet = d.trim;
  }
  if (d.body?.build) look.build = d.body.build;
  if (d.cloak) look.cape = d.cloak.cape ? look.cape ?? UNDYED_CLOAK : undefined;
  if (d.cloth !== null) look.cloth = d.cloth;
  if (d.armor !== null) look.armor = d.armor;
  if (d.trim !== null) look.accent = d.trim;
  if (d.cape !== null && look.cape !== undefined) look.cape = d.cape;
  return look;
}

// ------------------------------------------------------------------- wire --

/** For co-op: [head, body, cloak] as GARMENTS indices, then [cloth, armor, trim, cape] as hex; -1 for the class's own. */
export function encodeOutfit(d: Dressed): number[] {
  const g = (x: GarmentDef | null) => (x ? GARMENT_INDEX.get(x.id) ?? -1 : -1);
  return [g(d.head), g(d.body), g(d.cloak), d.cloth ?? -1, d.armor ?? -1, d.trim ?? -1, d.cape ?? -1];
}

/** A friend's outfit from the wire, strictly checked (anything odd: the class's own). Extra entries are for newer builds. */
export function decodeOutfit(o: unknown): Dressed {
  if (!Array.isArray(o)) return PLAIN;
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : -1);
  const slot = (i: number, s: Slot) => {
    const g = GARMENTS[int(o[i])];
    return g && g.slot === s ? g : null;
  };
  const hex = (i: number) => {
    const v = int(o[i]);
    return v >= 0 && v <= 0xffffff ? v : null;
  };
  return { head: slot(0, 'head'), body: slot(1, 'body'), cloak: slot(2, 'cloak'), cloth: hex(3), armor: hex(4), trim: hex(5), cape: hex(6) };
}

/** Changes only when the drawn outfit does (a friend's model is rebuilt only then). */
export const outfitKey = (d: Dressed) => encodeOutfit(d).join(',');

/** Counts for the Hero tab: garments owned and colours learned, of all there are. */
export const wardrobeCounts = (w: Wardrobe) => ({ garments: w.owned.length, ofGarments: GARMENTS.length, dyes: w.dyes.length, ofDyes: DYES.length });
