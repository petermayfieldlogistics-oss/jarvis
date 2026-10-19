// Pure rules for the story of the sun. Erebus, god of darkness, slew Helios and
// the land fell into endless night. Each of the six trials holds a fragment of
// the shattered sun; each fragment wakes a branch of the Sun Tree and pales the
// sky toward dawn. With all six the Eclipse opens, and when Erebus falls the
// hero rises as the new Sun God and day returns. No three.js here, so it can be tested.

/** Sun fragments sit in the pack; the Crown of Helios is the Sun God's relic. */
export const SUN_FRAGMENT = 'sun-fragment';
export const SUN_CROWN = 'sun-crown';
export const FRAGMENTS = 6;

/** The final trial: Erebus himself, open once all six fragments are found. */
export const ECLIPSE = 'eclipse';

type Pack = { items: Record<string, number> };

export const fragmentsOf = (c: Pack) => Math.max(0, Math.min(FRAGMENTS, Math.floor(c.items[SUN_FRAGMENT] ?? 0)));
export const isSunGod = (c: Pack) => (c.items[SUN_CROWN] ?? 0) > 0;
export const eclipseOpen = (c: Pack) => fragmentsOf(c) >= FRAGMENTS;

/**
 * Where the sky stands, as a minute of the day: midnight until the first
 * fragment, paling toward dawn with each one (the sixth leaves the sun just
 * under the rim). The Sun God's world keeps the real clock again.
 */
const SKY = [0, 150, 240, 285, 315, 335, 350];
export function skyMinute(realMinute: number, c: Pack): number {
  return isSunGod(c) ? realMinute : SKY[fragmentsOf(c)];
}

export interface SunNode {
  id: string;
  name: string;
  /** Woken by this many fragments. */
  fragment: number;
  boon: string;
  icon: string;
}

/** The Sun Tree: one branch per fragment, then the crown. */
export const SUN_TREE: SunNode[] = [
  { id: 'ember-heart', name: 'Ember Heart', fragment: 1, icon: '❤', boon: '+15% max health, and a warm light follows you through the dark.' },
  { id: 'burning-strikes', name: 'Burning Strikes', fragment: 2, icon: '🔥', boon: 'Your blows carry the sun: +15% damage, and every hit can set a foe alight.' },
  { id: 'solar-flare', name: 'Solar Flare', fragment: 3, icon: '☀', boon: 'Learn Solar Flare: a burst of sunlight that scorches and blinds everything around you.' },
  { id: 'dawnward', name: 'Dawnward', fragment: 4, icon: '🛡', boon: 'Creatures of darkness strike you 25% softer.' },
  { id: 'radiance', name: 'Radiance', fragment: 5, icon: '✺', boon: 'An aura of sunlight burns every foe close to you, every second.' },
  { id: 'phoenix-dawn', name: 'Phoenix Dawn', fragment: 6, icon: '🕊', boon: 'Once every five minutes, when you would fall, you rise again at full health.' },
];
export const SUN_GOD = { name: 'Sun God', icon: '👑', boon: 'You wear the Crown of Helios: +25% damage, +25% max health, a halo of light, and day returns to the world.' };

export const hasSun = (c: Pack, id: string) => {
  const n = SUN_TREE.find((s) => s.id === id);
  return !!n && fragmentsOf(c) >= n.fragment;
};

export const sunHpMul = (c: Pack) => (hasSun(c, 'ember-heart') ? 1.15 : 1) * (isSunGod(c) ? 1.25 : 1);
export const sunDamageMul = (c: Pack) => (hasSun(c, 'burning-strikes') ? 1.15 : 1) * (isSunGod(c) ? 1.25 : 1);
/** Blows from creatures of darkness, softened by Dawnward. */
export const sunGuardMul = (c: Pack, attackerDark: boolean) => (attackerDark && hasSun(c, 'dawnward') ? 0.75 : 1);
/** Burning Strikes: the chance a hit sets its foe alight. */
export const SUN_BURN_CHANCE = 0.2;

/** Radiance: how far it reaches and how hard it burns, by the hero's level. */
export const RADIANCE_RADIUS = 5;
export const radianceDps = (level: number, god: boolean) => (6 + level * 1.2) * (god ? 1.5 : 1);

/** Phoenix Dawn: seconds between rebirths. */
export const PHOENIX_COOLDOWN = 300;

/** The ghost of Helios lends this much more power for the rest of the fight with Erebus. */
export const HELIOS_BOON = { damage: 1.5, guard: 0.7 };
