import { describe, expect, it } from 'vitest';
import { BOSSES, TRIALS, WEAPON_TRIALS, ZONES } from '../data/world';
import { MAX_LEVEL, xpToNext } from './character';
import { foeDamageMul, foeHpMul, slowerPast10 } from './pacing';

describe('pacing', () => {
  it('spreads the six trials from level 10 to 40, and Erebus at the top', () => {
    const levels = WEAPON_TRIALS.map((t) => t.level);
    expect(levels[0]).toBe(10);
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
    expect(TRIALS.find((t) => t.final)!.level).toBe(MAX_LEVEL);
  });

  it('makes every great foe far tougher than a whole camp of its region', () => {
    for (const t of TRIALS) {
      const b = BOSSES[t.boss];
      expect(b.hp, b.id).toBeGreaterThanOrEqual(500 * t.level);
      expect(b.level, b.id).toBe(t.level);
    }
  });

  it('raises monsters with their region', () => {
    expect(foeHpMul(0)).toBe(1);
    expect(foeHpMul(10)).toBeCloseTo(2.4);
    expect(foeDamageMul(10)).toBeCloseTo(2.3);
    expect(ZONES.cinder.level).toBeGreaterThan(ZONES.forest.level);
  });

  it('keeps the first levels quick and the later ones long', () => {
    expect(slowerPast10(5)).toBe(1);
    expect(slowerPast10(50)).toBeGreaterThan(4);
    let total = 0;
    for (let l = 1; l < MAX_LEVEL; l++) total += xpToNext(l);
    expect(total).toBeGreaterThan(1_000_000);
  });
});
