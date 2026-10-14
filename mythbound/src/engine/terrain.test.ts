import { describe, expect, it } from 'vitest';
import { heightAt, zoneAt, inLava, CRATER_FLOOR, LAVA_LEVEL } from './terrain';
import { SHRINES, TRIALS, TOWN, VOLCANO, NPCS, ISLAND, ISLES, LAVA_POOLS, OASES } from '../data/world';

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

describe('the outer lands', () => {
  it('lies around the heartland, each land in its quarter', () => {
    expect(zoneAt(-250, -700)).toBe('peaks');
    expect(zoneAt(650, -650)).toBe('cinder');
    expect(zoneAt(700, -150)).toBe('dunes');
    expect(zoneAt(-700, -100)).toBe('elderwood');
    expect(zoneAt(-650, 650)).toBe('jungle');
    expect(zoneAt(250, 750)).toBe('ocean');
  });

  it('keeps its shrines on dry, flat ground', () => {
    for (const s of SHRINES) {
      expect(heightAt(s.x, s.z), s.id).toBeGreaterThan(0.5);
      expect(Math.abs(heightAt(s.x + 3, s.z) - heightAt(s.x, s.z)), s.id).toBeLessThan(1.5);
    }
  });

  it('has lava pools, oases and islands in the open sea', () => {
    for (const p of LAVA_POOLS) expect(inLava(p.x, p.z, heightAt(p.x, p.z))).toBe(true);
    for (const o of OASES) expect(heightAt(o.x, o.z)).toBeLessThan(-1);
    for (const s of ISLES) expect(heightAt(s.x, s.z)).toBeGreaterThan(2);
    expect(heightAt(500, 800)).toBeLessThan(-10);
  });

  it('rises into mountains at the edge of the world (the sea runs on)', () => {
    expect(heightAt(-880, 0)).toBeGreaterThan(30);
    expect(heightAt(300, 890)).toBeLessThan(-5);
  });

  it('blends into the heartland without cliffs', () => {
    // Walk outward from the heartland in each direction: no step steeper than a hillside.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, -0.7], [-0.7, 0.7]]) {
      let last = heightAt(dx * 380, dz * 380);
      for (let r = 382; r <= 800; r += 2) {
        const h = heightAt(dx * r, dz * r);
        // (A trial's arena is levelled into the slope, with its own banks.)
        const arena = TRIALS.some((t) => Math.hypot(dx * r - t.x, dz * r - t.z) < t.radius + 30);
        // Only where the outer lands blend in (inside it is the heartland's own ground, mesas and all).
        const edge = Math.max(Math.abs(dx * r), Math.abs(dz * r));
        if (!arena && edge > 395 && edge < 560) expect(Math.abs(h - last), `${dx},${dz} at ${r}`).toBeLessThan(2.6);
        last = h;
      }
    }
  });
});
