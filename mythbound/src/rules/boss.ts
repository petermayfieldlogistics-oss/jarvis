// Pure rules for the great foes: the shapes their blows cover, how much
// tougher they get with friends, when the hunted ones are about, and where
// the Leviathan can surface. No three.js here, so it can be tested.

/** Yaw convention everywhere: 0 faces +z, PI/2 faces +x (atan2(dx, dz)). */
export const yawTo = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz);
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Is (px, pz) inside a cone from (ox, oz) facing `yaw`, out to `radius`, `half` radians either side? `pad` is the target's own radius. */
export function inCone(px: number, pz: number, ox: number, oz: number, yaw: number, radius: number, half: number, pad = 0): boolean {
  const dx = px - ox, dz = pz - oz;
  const d = Math.hypot(dx, dz);
  if (d > radius + pad) return false;
  // Right at the apex counts (the target overlaps it).
  if (d <= pad + 0.3) return true;
  const off = Math.abs(wrapAngle(Math.atan2(dx, dz) - yaw));
  // A target's body pokes into the cone a little past its edge.
  return off <= half + Math.asin(Math.min(1, pad / d));
}

/** Is (px, pz) inside a strip starting at (ox, oz) and running `length` along `yaw`, `half` wide either side? */
export function inLine(px: number, pz: number, ox: number, oz: number, yaw: number, length: number, half: number, pad = 0): boolean {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const dx = px - ox, dz = pz - oz;
  const along = dx * fx + dz * fz;
  const across = Math.abs(dx * fz - dz * fx);
  return along >= -pad && along <= length + pad && across <= half + pad;
}

/** Inside a ring (a shockwave's expanding band) between r0 and r1 around (ox, oz)? */
export function inRing(px: number, pz: number, ox: number, oz: number, r0: number, r1: number, pad = 0): boolean {
  const d = Math.hypot(px - ox, pz - oz);
  return d >= r0 - pad && d <= r1 + pad;
}

/** A rolling wave: a wall `width` across that starts at (x, z) and runs along `yaw` at `speed`, with an open gap somewhere along it. */
export interface WaveSpec {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  /** Total width of the wall (it is centred on its start point). */
  width: number;
  /** Thickness of the crest that hurts. */
  depth: number;
  /** Centre of the gap, measured across the wall from its middle (+ is to the wall's right), and its width (0 for none). */
  gapAt: number;
  gap: number;
}

/** Does the wave's crest cover (px, pz) at `t` seconds after it set off? */
export function waveHits(w: WaveSpec, px: number, pz: number, t: number, pad = 0): boolean {
  const fx = Math.sin(w.yaw), fz = Math.cos(w.yaw);
  const dx = px - w.x, dz = pz - w.z;
  const along = dx * fx + dz * fz;
  // Across, measured to the wall's right (looking along its travel).
  const across = dx * -fz + dz * fx;
  if (Math.abs(across) > w.width / 2 + pad) return false;
  if (w.gap > 0 && Math.abs(across - w.gapAt) < w.gap / 2 - pad) return false;
  const front = w.speed * t;
  return along <= front + pad && along >= front - w.depth - pad;
}

/** Co-op: a great foe's health for `heroes` fighting it (each friend adds 60%). */
export function bossHealthScale(heroes: number): number {
  return 1 + 0.6 * Math.max(0, heroes - 1);
}

/** Is a hunted foe at home: past its cooldown, and (for night walkers) only after dark? */
export function lairOpen(lair: { night?: boolean }, isNight: boolean, now: number, readyAt: number): boolean {
  return now >= readyAt && (!lair.night || isNight);
}

/** Seconds before a slain hunted foe returns to its lair. */
export const LAIR_RESPAWN = 600;

/**
 * Directions (yaw from the arena's centre) where the Leviathan can surface:
 * the water just beyond the arena's edge must be deep enough to hide it.
 * `depthAt` is water depth (positive below the surface).
 */
export function surfaceAngles(cx: number, cz: number, ringR: number, depthAt: (x: number, z: number) => number, minDepth: number, n = 24): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI;
    // Check a little either side too, so it never surfaces half on a sandbar.
    let ok = true;
    for (const da of [-0.08, 0, 0.08]) {
      const x = cx + Math.sin(a + da) * ringR, z = cz + Math.cos(a + da) * ringR;
      if (depthAt(x, z) < minDepth) ok = false;
    }
    if (ok) out.push(a);
  }
  return out;
}

/** Where to surface next: the deep direction closest to the hero's, but not where it just was (if there is a choice). */
export function nextSurface(angles: number[], current: number, toward: number): number {
  if (!angles.length) return current;
  let best = angles[0], bestD = Infinity;
  for (const a of angles) {
    if (angles.length > 1 && Math.abs(wrapAngle(a - current)) < 0.3) continue;
    const d = Math.abs(wrapAngle(a - toward));
    if (d < bestD) (bestD = d), (best = a);
  }
  return best;
}

// ------------------------------------------------------------ difficulty --

/**
 * Once a great foe has fallen it can be fought again on a harder footing:
 * each tier beaten opens the next. A tier multiplies the foe's health, its
 * blows and its pace, lifts its level, and pays more experience and embers
 * plus Legend Shards (doubled the first time that tier falls).
 */
export interface BossTier {
  id: number;
  name: string;
  hp: number;
  damage: number;
  speed: number;
  /** Levels added to the foe (and to the level the journal recommends). */
  levels: number;
  xp: number;
  gold: number;
  shards: number;
  /** The colour the journal and the health bar give it. */
  color: string;
}

export const BOSS_TIERS: BossTier[] = [
  { id: 0, name: 'Normal', hp: 1, damage: 1, speed: 1, levels: 0, xp: 1, gold: 1, shards: 0, color: '#d8c8a0' },
  { id: 1, name: 'Heroic', hp: 2, damage: 1.45, speed: 1.08, levels: 8, xp: 2, gold: 2, shards: 2, color: '#6fd0ff' },
  { id: 2, name: 'Mythic', hp: 3.5, damage: 2, speed: 1.16, levels: 16, xp: 3.5, gold: 3, shards: 4, color: '#c080ff' },
  { id: 3, name: 'Godslayer', hp: 6, damage: 2.8, speed: 1.25, levels: 26, xp: 6, gold: 5, shards: 7, color: '#ff6a40' },
];

export const TOP_TIER = BOSS_TIERS.length - 1;

/** The hardest tier a hero may pick, given the hardest they have beaten (-1: never beaten). */
export const tierOpen = (best: number) => Math.max(0, Math.min(TOP_TIER, best + 1));

/** The tier a fight will use: the one picked, if it is open (otherwise the hardest open one). */
export const tierFor = (pick: number, best: number) => Math.max(0, Math.min(Math.floor(pick) || 0, tierOpen(best)));

/** The level the journal recommends for a foe on a tier. */
export const tierLevel = (baseLevel: number, tier: number) => baseLevel + (BOSS_TIERS[tier]?.levels ?? 0);

/** What felling a foe on a tier pays: experience and embers multiplied, and Legend Shards. */
export function tierReward(tier: number, firstTime: boolean, base: { xp: number; gold: number }): { xp: number; gold: number; shards: number } {
  const t = BOSS_TIERS[Math.max(0, Math.min(TOP_TIER, tier))];
  return { xp: Math.round(base.xp * t.xp), gold: Math.round(base.gold * t.gold), shards: t.shards * (firstTime ? 2 : 1) };
}
