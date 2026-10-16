// Player against player: duels, arena matches and war mode. The numbers and
// the pure decisions live here; engine/pvp.ts runs them over co-op.

import type { DamageElement } from '../data/defs';

/** How blows between heroes are tamed (monster numbers would end a fight in two hits). */
export const PVP = {
  /** Blows between heroes deal this share of what they would deal a monster. */
  damage: 0.55,
  /** No single blow takes more than this share of the target's health. */
  hitCap: 0.3,
  /** A blow that would end a monster outright (a backstab, a deal with the Devil) takes at most this share. */
  executeCap: 0.4,
  /** Seconds a stun or fear can hold a hero, and how long after it they cannot be held again. */
  hardHold: 1,
  hardImmune: 4,
  /** Roots: the longest, and the grace after one. */
  root: 1.5,
  rootImmune: 4,
  /** Slows: the longest, and how fast a slowed hero still moves. */
  slow: 3,
  slowFactor: 0.6,
  /** Burning, poison and bleeding on a hero: damage a second and the longest each lasts. */
  burnDps: 3,
  burnMax: 4,
  /** Poison and bleeding take a share of the hero's health a second. */
  poisonShare: 0.01,
  poisonMax: 5,
  bleedShare: 0.012,
  bleedMax: 4,
  /** A hexed hero takes more; a soaked one takes more from lightning; a marked one a little more. */
  hexTaken: 1.15,
  hexMax: 6,
  wetLightning: 1.5,
  wetMax: 6,
  markTaken: 1.1,
  markMax: 8,
  /** The hardest a blow can throw a hero. */
  knockMax: 9,
  /** Credit for a fall goes to the last hero who struck within this many seconds. */
  creditWindow: 10,
  /** Blows from further than this are not believed (metres). */
  maxReach: 90,
};

export const DUEL = {
  /** The ring's radius (metres) and the farthest a challenge reaches. */
  radius: 12,
  range: 30,
  /** Seconds to answer a challenge, of countdown, and before a duel is called a draw. */
  answer: 20,
  countdown: 3,
  maxTime: 180,
};

export type MatchMode = 'ffa' | 'teams';

export const MATCH = {
  /** Kill goals and time limits (seconds) the host can choose. */
  goals: [5, 10, 15],
  times: [180, 300, 600],
  /** Seconds friends have to answer an invitation, and of countdown. */
  answer: 12,
  countdown: 5,
  /** A fallen hero rises after this long, and can't be hurt for a moment after. */
  respawn: 4,
  shield: 2.5,
  /** Seconds the results show before everyone goes home. */
  results: 7,
  minPlayers: 2,
};

export const TEAM_NAMES = ['Crimson', 'Azure'] as const;
export const TEAM_COLORS = [0xe0453a, 0x3a8ae0] as const;

// ---------------------------------------------------------------- damage --

export interface PvpBlow {
  /** What the blow would have dealt a monster. */
  amount: number;
  element: DamageElement;
  /** What dealt it: 'player', 'spell', 'devil', 'ally'... */
  source: string;
  tags: string[];
  dot: boolean;
}

export interface PvpTarget {
  maxHp: number;
  hexed: boolean;
  wet: boolean;
  marked: boolean;
}

/** What a blow from another hero takes off this one (before armour and wards, which the hero's own game applies). */
export function pvpDamage(b: PvpBlow, t: PvpTarget): number {
  if (!(b.amount > 0)) return 0;
  const execute = b.source === 'devil' || b.tags.includes('backstab');
  let dmg = b.amount * PVP.damage;
  if (t.hexed) dmg *= PVP.hexTaken;
  if (t.marked) dmg *= PVP.markTaken;
  if (t.wet && b.element === 'lightning') dmg *= PVP.wetLightning;
  // A ticking hurt is a sliver at a time; only whole blows are capped.
  if (b.dot) return Math.min(dmg, t.maxHp * 0.05);
  return Math.min(dmg, t.maxHp * (execute ? PVP.executeCap : PVP.hitCap));
}

// ----------------------------------------------------------------- holds --

export type HoldKind = 'hard' | 'root';

export interface Holds {
  /** Game-clock time until which each kind of hold slides off. */
  hardImmune: number;
  rootImmune: number;
}

export const newHolds = (): Holds => ({ hardImmune: 0, rootImmune: 0 });

/** How long a stun/fear (hard) or a root really holds a hero, given how recently one did; 0 if it slides off. */
export function holdFor(h: Holds, kind: HoldKind, want: number, now: number): number {
  if (!(want > 0)) return 0;
  if (kind === 'hard') {
    if (now < h.hardImmune) return 0;
    const t = Math.min(want, PVP.hardHold);
    h.hardImmune = now + t + PVP.hardImmune;
    return t;
  }
  if (now < h.rootImmune) return 0;
  const t = Math.min(want, PVP.root);
  h.rootImmune = now + t + PVP.rootImmune;
  return t;
}

// ---------------------------------------------------------------- matches --

export interface MatchPlayer {
  id: number;
  name: string;
  /** 0 or 1 in a team match; -1 in a free-for-all. */
  team: number;
  kills: number;
  deaths: number;
}

export interface Match {
  mode: MatchMode;
  goal: number;
  /** Seconds the match may run. */
  time: number;
  players: MatchPlayer[];
}

export interface MatchResult {
  /** The winning team (team matches), or -1. */
  team: number;
  /** The winning hero (free-for-all), or 0. */
  player: number;
  draw: boolean;
}

/** Splits heroes into two teams of even strength (by level), the strongest first. */
export function assignTeams(heroes: { id: number; level: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  const sums = [0, 0], counts = [0, 0];
  const sorted = [...heroes].sort((a, b) => b.level - a.level || a.id - b.id);
  for (const h of sorted) {
    // Fill the smaller team first; with equal numbers, the weaker one.
    const t = counts[0] !== counts[1] ? (counts[0] < counts[1] ? 0 : 1) : sums[0] <= sums[1] ? 0 : 1;
    out.set(h.id, t);
    sums[t] += h.level;
    counts[t]++;
  }
  return out;
}

export function newMatch(mode: MatchMode, goal: number, time: number, heroes: { id: number; name: string; level: number }[]): Match {
  const teams = mode === 'teams' ? assignTeams(heroes) : null;
  return {
    mode,
    goal,
    time,
    players: heroes.map((h) => ({ id: h.id, name: h.name, team: teams?.get(h.id) ?? -1, kills: 0, deaths: 0 })),
  };
}

/** Whether two heroes in a match fight each other. */
export function foes(m: Match, a: number, b: number): boolean {
  if (a === b) return false;
  const pa = m.players.find((p) => p.id === a), pb = m.players.find((p) => p.id === b);
  if (!pa || !pb) return false;
  return m.mode === 'ffa' || pa.team !== pb.team;
}

/** A hero fell: a death for them and, if a foe felled them, a kill for the foe. Returns the killer's id (0: none). */
export function recordFall(m: Match, victim: number, killer: number): number {
  const v = m.players.find((p) => p.id === victim);
  if (!v) return 0;
  v.deaths++;
  const k = m.players.find((p) => p.id === killer);
  if (!k || !foes(m, victim, killer)) return 0;
  k.kills++;
  return k.id;
}

export function teamScore(m: Match, team: number): number {
  let s = 0;
  for (const p of m.players) if (p.team === team) s += p.kills;
  return s;
}

/** Players best first: most kills, then fewest deaths. */
export function standings(m: Match): MatchPlayer[] {
  return [...m.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
}

/** The match's result once it is decided (the goal reached, or `timeUp`); null while it goes on. */
export function matchResult(m: Match, timeUp: boolean): MatchResult | null {
  if (m.mode === 'teams') {
    const a = teamScore(m, 0), b = teamScore(m, 1);
    if (a >= m.goal || b >= m.goal || timeUp) {
      if (a === b) return { team: -1, player: 0, draw: true };
      return { team: a > b ? 0 : 1, player: 0, draw: false };
    }
    return null;
  }
  const [first, second] = standings(m);
  if (!first) return timeUp ? { team: -1, player: 0, draw: true } : null;
  if (first.kills >= m.goal || timeUp) {
    if (second && second.kills === first.kills) return { team: -1, player: 0, draw: true };
    return { team: -1, player: first.id, draw: false };
  }
  return null;
}

/** Whether this hero is on the winning side. */
export function won(m: Match, r: MatchResult, id: number): boolean {
  if (r.draw) return false;
  if (m.mode === 'teams') return m.players.find((p) => p.id === id)?.team === r.team;
  return r.player === id;
}

// --------------------------------------------------------- glory and rank --

export const GLORY = {
  duelWin: 15,
  /** A win over a higher level adds this much per level of difference (to `upsetMax`). */
  upset: 3,
  upsetMax: 15,
  duelLoss: 2,
  duelDraw: 5,
  kill: 4,
  matchWin: 20,
  matchPlayed: 5,
  /** A war-mode kill in the open world. */
  warKill: 6,
};

export const RANKS = [
  { glory: 0, title: 'Recruit' },
  { glory: 30, title: 'Brawler' },
  { glory: 100, title: 'Gladiator' },
  { glory: 250, title: 'Champion' },
  { glory: 500, title: 'Warlord' },
  { glory: 1000, title: 'Legend of the Arena' },
];

export function rankOf(glory: number): { index: number; title: string; next: number | null } {
  let i = 0;
  while (i + 1 < RANKS.length && glory >= RANKS[i + 1].glory) i++;
  return { index: i, title: RANKS[i].title, next: i + 1 < RANKS.length ? RANKS[i + 1].glory : null };
}

/**
 * Glory for winning a duel: more for beating a higher level; less each time
 * the same foe is beaten again in one sitting (`priorWins`), so it can't be farmed.
 */
export function duelGlory(myLevel: number, foeLevel: number, priorWins: number): number {
  const base = GLORY.duelWin + Math.min(GLORY.upsetMax, GLORY.upset * Math.max(0, foeLevel - myLevel));
  return Math.max(1, Math.round(base / (1 + priorWins)));
}

/** Glory from an arena match: kills, playing it out, and winning. */
export function matchGlory(kills: number, winner: boolean): number {
  return GLORY.matchPlayed + GLORY.kill * kills + (winner ? GLORY.matchWin : 0);
}

/** Glory for a war-mode kill (less each time the same hero falls to you in one sitting). */
export function warGlory(priorKills: number): number {
  return Math.max(1, Math.round(GLORY.warKill / (1 + priorKills)));
}

export interface PvpRecord {
  glory: number;
  duelsWon: number;
  duelsLost: number;
  duelsDrawn: number;
  kills: number;
  deaths: number;
  matchesWon: number;
  matchesPlayed: number;
  /** War mode: open-world fights with other heroes who have it on too. */
  war: boolean;
}

export const newPvpRecord = (): PvpRecord => ({ glory: 0, duelsWon: 0, duelsLost: 0, duelsDrawn: 0, kills: 0, deaths: 0, matchesWon: 0, matchesPlayed: 0, war: false });

/** A saved record, repaired (older saves have none). */
export function normalizePvp(x: unknown): PvpRecord {
  const r = newPvpRecord();
  if (!x || typeof x !== 'object') return r;
  const o = x as Record<string, unknown>;
  for (const k of Object.keys(r) as (keyof PvpRecord)[]) {
    if (k === 'war') r.war = o.war === true;
    else {
      const v = o[k];
      r[k] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
    }
  }
  return r;
}

// ------------------------------------------------------------- war mode --

/** Places war mode keeps the peace: the town, and close by a shrine. */
export function peaceful(x: number, z: number, town: { x: number; z: number; radius: number }, shrines: { x: number; z: number }[]): boolean {
  if (Math.hypot(x - town.x, z - town.z) < town.radius + 10) return true;
  return shrines.some((s) => Math.hypot(x - s.x, z - s.z) < 16);
}
