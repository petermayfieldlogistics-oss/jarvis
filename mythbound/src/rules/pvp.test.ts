import { describe, expect, it } from 'vitest';
import {
  DUEL, GLORY, MATCH, PVP, RANKS, assignTeams, duelGlory, foes, holdFor, matchGlory, matchResult, newHolds, newMatch, normalizePvp, peaceful,
  pvpDamage, rankOf, recordFall, standings, teamScore, warGlory, won, type PvpBlow,
} from './pvp';

const blow = (over: Partial<PvpBlow> = {}): PvpBlow => ({ amount: 40, element: 'physical', source: 'player', tags: [], dot: false, ...over });
const target = { maxHp: 200, hexed: false, wet: false, marked: false };

describe('blows between heroes', () => {
  it('deal a share of what they would deal a monster', () => {
    expect(pvpDamage(blow(), target)).toBeCloseTo(40 * PVP.damage);
    expect(pvpDamage(blow({ amount: 0 }), target)).toBe(0);
    expect(pvpDamage(blow({ amount: -5 }), target)).toBe(0);
    expect(pvpDamage(blow({ amount: NaN }), target)).toBe(0);
  });

  it('never take more than a third of a hero in one blow', () => {
    expect(pvpDamage(blow({ amount: 10_000 }), target)).toBe(200 * PVP.hitCap);
  });

  it('turn killing blows (a backstab, the Devil) into heavy ones', () => {
    expect(pvpDamage(blow({ amount: 10_000, tags: ['backstab'] }), target)).toBe(200 * PVP.executeCap);
    expect(pvpDamage(blow({ amount: 10_000, source: 'devil', element: 'true' }), target)).toBe(200 * PVP.executeCap);
  });

  it('hurt more on the hexed, the marked, and soaked heroes struck by lightning', () => {
    const base = pvpDamage(blow({ element: 'lightning' }), target);
    expect(pvpDamage(blow({ element: 'lightning' }), { ...target, hexed: true })).toBeCloseTo(base * PVP.hexTaken);
    expect(pvpDamage(blow({ element: 'lightning' }), { ...target, marked: true })).toBeCloseTo(base * PVP.markTaken);
    expect(pvpDamage(blow({ element: 'lightning' }), { ...target, wet: true })).toBeCloseTo(base * PVP.wetLightning);
    expect(pvpDamage(blow({ element: 'fire' }), { ...target, wet: true })).toBeCloseTo(base);
  });

  it('let ticking hurts through a sliver at a time', () => {
    expect(pvpDamage(blow({ amount: 2, dot: true }), target)).toBeCloseTo(2 * PVP.damage);
    expect(pvpDamage(blow({ amount: 10_000, dot: true }), target)).toBe(10);
  });
});

describe('holds on heroes', () => {
  it('cap a stun, then let the next one slide off for a while', () => {
    const h = newHolds();
    expect(holdFor(h, 'hard', 3, 10)).toBe(PVP.hardHold);
    expect(holdFor(h, 'hard', 1, 10.5)).toBe(0);
    expect(holdFor(h, 'hard', 1, 10 + PVP.hardHold + PVP.hardImmune - 0.1)).toBe(0);
    expect(holdFor(h, 'hard', 0.6, 10 + PVP.hardHold + PVP.hardImmune + 0.1)).toBe(0.6);
  });

  it('keep roots apart from stuns', () => {
    const h = newHolds();
    expect(holdFor(h, 'hard', 1, 5)).toBe(1);
    expect(holdFor(h, 'root', 4, 5.2)).toBe(PVP.root);
    expect(holdFor(h, 'root', 1, 6)).toBe(0);
    expect(holdFor(h, 'root', 0, 99)).toBe(0);
  });
});

describe('arena matches', () => {
  const heroes = [
    { id: 1, name: 'Ari', level: 12 },
    { id: 2, name: 'Bo', level: 3 },
    { id: 3, name: 'Cy', level: 9 },
    { id: 4, name: 'Di', level: 6 },
  ];

  it('split heroes into even teams', () => {
    const t = assignTeams(heroes);
    expect(t.size).toBe(4);
    const sum = (team: number) => heroes.filter((h) => t.get(h.id) === team).reduce((s, h) => s + h.level, 0);
    expect(heroes.filter((h) => t.get(h.id) === 0)).toHaveLength(2);
    expect(Math.abs(sum(0) - sum(1))).toBeLessThanOrEqual(4);
    // Three heroes: two against one.
    const three = [...assignTeams(heroes.slice(0, 3)).values()];
    expect(three.filter((x) => x === 0).length * three.filter((x) => x === 1).length).toBe(2);
  });

  it('only count kills on foes', () => {
    const m = newMatch('teams', 5, 300, heroes);
    const [a, b] = [m.players.find((p) => p.team === 0)!, m.players.find((p) => p.team === 1)!];
    const mate = m.players.find((p) => p.team === 0 && p.id !== a.id)!;
    expect(foes(m, a.id, b.id)).toBe(true);
    expect(foes(m, a.id, mate.id)).toBe(false);
    expect(foes(m, a.id, a.id)).toBe(false);
    expect(recordFall(m, b.id, a.id)).toBe(a.id);
    expect(recordFall(m, mate.id, a.id)).toBe(0);
    expect(recordFall(m, a.id, 0)).toBe(0);
    expect(recordFall(m, 99, a.id)).toBe(0);
    expect(a.kills).toBe(1);
    expect(a.deaths).toBe(1);
    expect(mate.deaths).toBe(1);
    expect(teamScore(m, 0)).toBe(1);
  });

  it('end a team match at the goal, or on time with the leader (or a draw)', () => {
    const m = newMatch('teams', 2, 300, heroes.slice(0, 2));
    const [p0, p1] = [m.players.find((p) => p.team === 0)!, m.players.find((p) => p.team === 1)!];
    expect(matchResult(m, false)).toBeNull();
    expect(matchResult(m, true)).toEqual({ team: -1, player: 0, draw: true });
    recordFall(m, p1.id, p0.id);
    expect(matchResult(m, false)).toBeNull();
    expect(matchResult(m, true)).toEqual({ team: 0, player: 0, draw: false });
    recordFall(m, p1.id, p0.id);
    const r = matchResult(m, false)!;
    expect(r.team).toBe(0);
    expect(won(m, r, p0.id)).toBe(true);
    expect(won(m, r, p1.id)).toBe(false);
  });

  it('end a free-for-all at the goal; a tie on time is a draw', () => {
    const m = newMatch('ffa', 2, 300, heroes.slice(0, 3));
    expect(m.players.every((p) => p.team === -1)).toBe(true);
    recordFall(m, 2, 1);
    recordFall(m, 1, 3);
    expect(matchResult(m, true)?.draw).toBe(true);
    recordFall(m, 3, 1);
    const r = matchResult(m, false)!;
    expect(r).toEqual({ team: -1, player: 1, draw: false });
    expect(won(m, r, 1)).toBe(true);
    expect(won(m, r, 3)).toBe(false);
    expect(standings(m).map((p) => p.id)).toEqual([1, 3, 2]);
  });

  it('offers sensible goals and times', () => {
    expect(MATCH.goals.every((g) => g > 0)).toBe(true);
    expect(MATCH.times.every((t) => t >= 60)).toBe(true);
    expect(DUEL.radius).toBeGreaterThan(6);
  });
});

describe('glory and ranks', () => {
  it('rises with each rank threshold', () => {
    expect(rankOf(0)).toEqual({ index: 0, title: 'Recruit', next: RANKS[1].glory });
    expect(rankOf(RANKS[2].glory).title).toBe('Gladiator');
    expect(rankOf(RANKS[2].glory - 1).title).toBe('Brawler');
    expect(rankOf(1e9)).toEqual({ index: RANKS.length - 1, title: RANKS[RANKS.length - 1].title, next: null });
  });

  it('rewards upsets, and less for beating the same foe again', () => {
    expect(duelGlory(5, 5, 0)).toBe(GLORY.duelWin);
    expect(duelGlory(5, 8, 0)).toBe(GLORY.duelWin + 3 * GLORY.upset);
    expect(duelGlory(1, 50, 0)).toBe(GLORY.duelWin + GLORY.upsetMax);
    expect(duelGlory(9, 2, 0)).toBe(GLORY.duelWin);
    expect(duelGlory(5, 5, 1)).toBeLessThan(GLORY.duelWin);
    expect(duelGlory(5, 5, 100)).toBe(1);
    expect(warGlory(0)).toBe(GLORY.warKill);
    expect(warGlory(10)).toBe(1);
  });

  it('pays out a match for kills, playing and winning', () => {
    expect(matchGlory(0, false)).toBe(GLORY.matchPlayed);
    expect(matchGlory(3, true)).toBe(GLORY.matchPlayed + 3 * GLORY.kill + GLORY.matchWin);
  });

  it('repairs a saved record', () => {
    expect(normalizePvp(undefined).glory).toBe(0);
    const r = normalizePvp({ glory: 41.7, kills: -3, deaths: 'x', war: true, duelsWon: 2 });
    expect(r).toMatchObject({ glory: 41, kills: 0, deaths: 0, war: true, duelsWon: 2, matchesPlayed: 0 });
    expect(normalizePvp({ war: 'yes' }).war).toBe(false);
  });
});

describe('war mode', () => {
  const town = { x: 0, z: 20, radius: 62 };
  const shrines = [{ x: 200, z: 0 }];
  it('keeps the peace in town and by shrines', () => {
    expect(peaceful(0, 0, town, shrines)).toBe(true);
    expect(peaceful(205, 5, town, shrines)).toBe(true);
    expect(peaceful(120, -100, town, shrines)).toBe(false);
  });
});
