// Horses: every hero has one to call. Riding is quicker than running;
// galloping spends the horse's own stamina. No riding into a fight or a
// trial, and a blow throws the rider. Pure rules: the engine (player.ts,
// horse.ts) plays them out.

/** A hero's horse: its name and coat (an index into COATS). */
export interface Steed {
  name: string;
  coat: number;
}

export interface Coat {
  id: string;
  name: string;
  body: number;
  mane: number;
  /** Socks and blaze. */
  marks: number;
}

export const COATS: Coat[] = [
  { id: 'bay', name: 'Bay', body: 0x7a4628, mane: 0x23150c, marks: 0x23150c },
  { id: 'chestnut', name: 'Chestnut', body: 0x9a4e24, mane: 0x6a2e12, marks: 0xe8dcc4 },
  { id: 'black', name: 'Black', body: 0x2a2624, mane: 0x141210, marks: 0x141210 },
  { id: 'grey', name: 'Dapple grey', body: 0x9c9a96, mane: 0xd8d6d0, marks: 0x5a5856 },
  { id: 'palomino', name: 'Palomino', body: 0xd2a656, mane: 0xf2e6c8, marks: 0xf2e6c8 },
  { id: 'white', name: 'White', body: 0xe2ded4, mane: 0xc8c2b4, marks: 0x8a8476 },
];

export const HORSE_NAMES = ['Ember', 'Thistle', 'Bramble', 'Ash', 'Comet', 'Willow', 'Storm', 'Juniper', 'Sable', 'Hazel', 'Rook', 'Clover', 'Dusk', 'Briar'];

export const HORSE = {
  /** Speeds (m/s): a trot, and a gallop while sprinting. */
  trot: 8,
  gallop: 14,
  /** The horse's stamina: galloping spends it, anything else restores it. */
  stamina: 100,
  gallopDrain: 14,
  regen: 20,
  /** A spent horse can't gallop again until it has this much back. */
  rested: 25,
  /** Close enough to climb on (m). */
  mountRange: 3.5,
  /** A called horse comes galloping from this far away. */
  callFrom: 24,
  /** A monster this close that is hunting the hero means a fight: no mounting. */
  threatRange: 18,
  /** Seconds after taking a blow before the hero can mount. */
  hurtLock: 4,
  /** Left farther than this, the horse wanders home (call it again). */
  leaveRange: 80,
  /** Too deep to wade: the horse won't go on. */
  wadeDepth: 1.1,
};

export const newSteed = (rng: () => number = Math.random): Steed => ({
  name: HORSE_NAMES[Math.floor(rng() * HORSE_NAMES.length) % HORSE_NAMES.length],
  coat: Math.floor(rng() * COATS.length) % COATS.length,
});

/** A steed from an older save (or a damaged one) made whole. */
export function normalizeSteed(s: Partial<Steed> | undefined, rng: () => number = Math.random): Steed {
  const fresh = newSteed(rng);
  return {
    name: typeof s?.name === 'string' && s.name.trim() ? s.name.slice(0, 20) : fresh.name,
    coat: Number.isInteger(s?.coat) && s!.coat! >= 0 && s!.coat! < COATS.length ? s!.coat! : fresh.coat,
  };
}

/** What keeps a hero from riding right now (null: nothing). */
export function rideBlock(s: {
  alive: boolean;
  inTrial: boolean;
  threatened: boolean;
  sinceHurt: number;
  swimming: boolean;
  flying: boolean;
  sailing: boolean;
  busy: boolean;
}): string | null {
  if (!s.alive) return 'Not now.';
  if (s.inTrial) return 'No horse will enter a trial.';
  if (s.swimming || s.sailing) return 'Get to dry land first.';
  if (s.flying) return 'Land first.';
  if (s.threatened || s.sinceHurt < HORSE.hurtLock) return 'Not in the middle of a fight!';
  if (s.busy) return 'Finish what you are doing first.';
  return null;
}

/**
 * A moment of riding: whether the horse gallops (the rider wants to and it
 * has the wind for it) and its stamina after. A spent horse trots until it
 * has rested a little.
 */
export function rideStep(
  stamina: number,
  wantGallop: boolean,
  wasGalloping: boolean,
  dt: number,
  out: { stamina: number; galloping: boolean } = { stamina: 0, galloping: false },
): { stamina: number; galloping: boolean } {
  const can = stamina > 0 && (wasGalloping || stamina >= HORSE.rested);
  const galloping = wantGallop && can;
  const next = galloping ? stamina - HORSE.gallopDrain * dt : stamina + HORSE.regen * dt;
  out.stamina = Math.max(0, Math.min(HORSE.stamina, next));
  out.galloping = galloping && next > 0;
  return out;
}

/** How fast the horse goes. */
export const rideSpeed = (galloping: boolean) => (galloping ? HORSE.gallop : HORSE.trot);
