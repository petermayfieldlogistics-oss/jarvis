import { describe, expect, it } from 'vitest';
import { heightAt, zoneAt, inLava, CRATER_FLOOR, LAVA_LEVEL } from './terrain';
import { SHRINES, TRIALS, TOWN, VOLCANO, NPCS, ISLAND } from '../data/world';
import { NELL_STALL } from '../data/goods';

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

  it('puts Nell and her stall in a gap of the town, moving no house', () => {
    // The house spots buildTown tries (keep in step with it), and the ones it skips for townsfolk.
    const spots: { x: number; z: number }[] = [];
    for (let ring = 0; ring < 2; ring++) {
      const r = ring ? 44 : 28, n = ring ? 14 : 8;
      for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) / n) * Math.PI * 2 + ring * 0.1;
        const x = TOWN.x + Math.cos(a) * r, z = TOWN.z + Math.sin(a) * r;
        if (Math.min(Math.abs(x - TOWN.x), Math.abs(z - TOWN.z)) < 7) continue;
        spots.push({ x, z });
      }
    }
    const near = (list: typeof NPCS, s: { x: number; z: number }) => list.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < 9);
    const others = NPCS.filter((n) => n.id !== 'nell');
    // Nell skips no house the others did not already skip (so the seeded layout is unchanged).
    for (const s of spots) expect(near(NPCS, s), JSON.stringify(s)).toBe(near(others, s));
    // Houses that are built stand well clear of her and of the stall.
    const built = spots.filter((s) => !near(NPCS, s) && Math.hypot(s.x, s.z - 42) >= 9);
    const nell = NPCS.find((n) => n.id === 'nell')!;
    for (const s of built) {
      expect(Math.hypot(s.x - nell.x, s.z - nell.z)).toBeGreaterThan(12);
      expect(Math.hypot(s.x - NELL_STALL.x, s.z - NELL_STALL.z)).toBeGreaterThan(10);
    }
    // Clear of the lamps, the Chronicler (and his desk) and the shrine; on dry land.
    // The two lamps nearest (buildTown puts them at these offsets from the town's centre: world (-20, 46) and (-6, 52)).
    for (const [lx, lz] of [[-20, 26], [-6, 32]]) expect(Math.hypot(NELL_STALL.x - (TOWN.x + lx), NELL_STALL.z - (TOWN.z + lz))).toBeGreaterThan(4.5);
    // The Chronicler's desk.
    expect(Math.hypot(NELL_STALL.x + 12, NELL_STALL.z - 37)).toBeGreaterThan(6);
    const chron = NPCS.find((n) => n.id === 'chronicler')!;
    expect(Math.hypot(nell.x - chron.x, nell.z - chron.z)).toBeGreaterThan(4);
    expect(Math.hypot(NELL_STALL.x - chron.x, NELL_STALL.z - chron.z)).toBeGreaterThan(6);
    const hearth = SHRINES.find((s) => s.id === 'hearth')!;
    expect(Math.hypot(NELL_STALL.x - hearth.x, NELL_STALL.z - hearth.z)).toBeGreaterThan(10);
    expect(heightAt(NELL_STALL.x, NELL_STALL.z)).toBeGreaterThan(0.5);
  });
});
