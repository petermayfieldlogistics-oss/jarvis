import { describe, expect, it } from 'vitest';
import { eclipseOpen, fragmentsOf, hasSun, isSunGod, skyMinute, SUN_CROWN, SUN_FRAGMENT, SUN_TREE, sunDamageMul, sunGuardMul, sunHpMul } from './sun';

const pack = (frags: number, crown = false) => ({ items: { [SUN_FRAGMENT]: frags, ...(crown ? { [SUN_CROWN]: 1 } : {}) } });

describe('the sun', () => {
  it('counts fragments, capped at six', () => {
    expect(fragmentsOf({ items: {} })).toBe(0);
    expect(fragmentsOf(pack(3))).toBe(3);
    expect(fragmentsOf(pack(9))).toBe(6);
  });

  it('keeps the sky in night, paling toward dawn with each fragment', () => {
    const skies = [0, 1, 2, 3, 4, 5, 6].map((n) => skyMinute(720, pack(n)));
    expect(skies[0]).toBe(0);
    for (let i = 1; i < skies.length; i++) expect(skies[i]).toBeGreaterThan(skies[i - 1]);
    // Still before sunrise (6:00) with all six: only the Sun God brings the day.
    expect(skies[6]).toBeLessThan(360);
    expect(skyMinute(720, pack(6, true))).toBe(720);
  });

  it('wakes one branch of the Sun Tree per fragment', () => {
    expect(SUN_TREE.map((s) => s.fragment)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(hasSun(pack(0), 'ember-heart')).toBe(false);
    expect(hasSun(pack(1), 'ember-heart')).toBe(true);
    expect(hasSun(pack(4), 'radiance')).toBe(false);
    expect(hasSun(pack(5), 'radiance')).toBe(true);
  });

  it('opens the Eclipse with all six, and crowns the Sun God', () => {
    expect(eclipseOpen(pack(5))).toBe(false);
    expect(eclipseOpen(pack(6))).toBe(true);
    expect(isSunGod(pack(6))).toBe(false);
    expect(isSunGod(pack(6, true))).toBe(true);
  });

  it('strengthens the hero', () => {
    expect(sunHpMul(pack(0))).toBe(1);
    expect(sunHpMul(pack(1))).toBeCloseTo(1.15);
    expect(sunHpMul(pack(6, true))).toBeCloseTo(1.15 * 1.25);
    expect(sunDamageMul(pack(1))).toBe(1);
    expect(sunDamageMul(pack(2))).toBeCloseTo(1.15);
    expect(sunGuardMul(pack(4), true)).toBe(0.75);
    expect(sunGuardMul(pack(4), false)).toBe(1);
    expect(sunGuardMul(pack(3), true)).toBe(1);
  });
});
