import { describe, expect, it } from 'vitest';
import { heightAt, zoneAt, inLava, CRATER_FLOOR, LAVA_LEVEL } from './terrain';
import { SHRINES, TRIALS, TOWN, VOLCANO, NPCS, ISLAND } from '../data/world';

describe('terrain', () => {
  it('puts places in their zones', () => {
    expect(zoneAt(TOWN.x, TOWN.z)).toBe('town');
    expect(zoneAt(-300, 10)).toBe('forest');
    expect(zoneAt(305, 40)).toBe('desert');
    expect(zoneAt(VOLCANO.x, VOLCANO.z)).toBe('volcano');
    expect(zoneAt(300, -260)).toBe('badlands');
    expect(zoneAt(-300, -265)).toBe('crossroads');
    expect(zoneAt(-335, 315)).toBe('swamp');
    expect(zoneAt(ISLAND.x, ISLAND.z)).toBe('coast');
  });

  it('keeps shrines, trials and townsfolk above water', () => {
    for (const p of [...SHRINES, ...TRIALS, ...NPCS]) expect(heightAt(p.x, p.z), JSON.stringify(p)).toBeGreaterThan(0.5);
  });

  it('has a crater with lava around a platform', () => {
    expect(heightAt(VOLCANO.x, VOLCANO.z)).toBeCloseTo(CRATER_FLOOR, 0);
    expect(heightAt(VOLCANO.x + 36, VOLCANO.z)).toBeLessThan(LAVA_LEVEL);
    expect(inLava(VOLCANO.x + 36, VOLCANO.z, LAVA_LEVEL)).toBe(true);
    expect(inLava(VOLCANO.x, VOLCANO.z, CRATER_FLOOR)).toBe(false);
    expect(CRATER_FLOOR).toBeGreaterThan(LAVA_LEVEL);
  });

  it('has a sea south of town', () => {
    expect(heightAt(0, 260)).toBeLessThan(-5);
  });
});
