import { describe, expect, it } from 'vitest';
import { createCharacter, normalizeCharacter } from './character';
import { COATS, HORSE, HORSE_NAMES, newSteed, normalizeSteed, rideBlock, rideSpeed, rideStep } from './horse';
import { normalizeSave, newWorldState, type SaveData } from '../engine/state';

const free = { alive: true, inTrial: false, threatened: false, sinceHurt: 99, swimming: false, flying: false, sailing: false, busy: false };

describe('horses', () => {
  it('gives every hero a named horse with a coat, old saves too', () => {
    const c = createCharacter({ name: 'T', classId: 'warrior', subclassId: 'swordsman', raceId: 'human', roleId: 'historian', expansion: false }, () => 0.3);
    expect(HORSE_NAMES).toContain(c.steed.name);
    expect(c.steed.coat).toBeGreaterThanOrEqual(0);
    expect(c.steed.coat).toBeLessThan(COATS.length);
    const old = JSON.parse(JSON.stringify({ character: c, world: newWorldState() })) as SaveData;
    delete (old.character as Partial<typeof c>).steed;
    const fixed = normalizeSave(old);
    expect(HORSE_NAMES).toContain(fixed.character.steed.name);
    // A damaged steed is mended, a good one kept.
    expect(normalizeSteed({ name: '', coat: 99 }, () => 0).coat).toBe(0);
    expect(normalizeSteed({ name: 'Pip', coat: 2 })).toEqual({ name: 'Pip', coat: 2 });
    expect(normalizeCharacter(c).steed).toEqual(c.steed);
    expect(newSteed(() => 0.999).coat).toBe(COATS.length - 1);
  });

  it('keeps horses out of fights, trials and water', () => {
    expect(rideBlock(free)).toBe(null);
    expect(rideBlock({ ...free, threatened: true })).toMatch(/fight/);
    expect(rideBlock({ ...free, sinceHurt: 1 })).toMatch(/fight/);
    expect(rideBlock({ ...free, inTrial: true })).toMatch(/trial/);
    expect(rideBlock({ ...free, swimming: true })).toMatch(/dry land/);
    expect(rideBlock({ ...free, sailing: true })).toMatch(/dry land/);
    expect(rideBlock({ ...free, flying: true })).toMatch(/Land/);
    expect(rideBlock({ ...free, alive: false })).not.toBe(null);
  });

  it('gallops on the horse’s stamina, then trots until it has rested', () => {
    expect(rideSpeed(true)).toBeGreaterThan(rideSpeed(false));
    let s = { stamina: HORSE.stamina, galloping: false };
    let t = 0;
    while (t < 30) {
      s = rideStep(s.stamina, true, s.galloping, 0.1);
      t += 0.1;
      if (!s.galloping) break;
    }
    // About seven seconds of gallop from full.
    expect(t).toBeGreaterThan(6);
    expect(t).toBeLessThan(8.5);
    expect(s.stamina).toBeLessThan(HORSE.rested);
    // Spent: still trotting while it rests, galloping again once rested.
    expect(rideStep(5, true, false, 0.1).galloping).toBe(false);
    expect(rideStep(HORSE.rested, true, false, 0.1).galloping).toBe(true);
    // A trot rests it.
    expect(rideStep(50, false, true, 1).stamina).toBe(50 + HORSE.regen);
    expect(rideStep(HORSE.stamina, false, false, 1).stamina).toBe(HORSE.stamina);
    // Each frame's step can reuse one result object.
    const out = { stamina: 0, galloping: false };
    expect(rideStep(50, true, true, 0.5, out)).toBe(out);
    expect(out).toEqual({ stamina: 50 - HORSE.gallopDrain * 0.5, galloping: true });
  });
});
