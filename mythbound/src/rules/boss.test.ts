import { describe, expect, it } from 'vitest';
import { bossHealthScale, inCone, inLine, inRing, lairOpen, nextSurface, surfaceAngles, waveHits, wrapAngle, yawTo, type WaveSpec } from './boss';
import { createCharacter, maxHp, maxMana, manaRegen, swimsTireless } from './character';
import { incomingDamage } from './combat';
import { breathSweep, FLIGHT, LANDS } from '../engine/anim';

describe('boss hit shapes', () => {
  it('measures yaw like the game (0 = +z, PI/2 = +x)', () => {
    expect(yawTo(0, 0, 0, 5)).toBeCloseTo(0);
    expect(yawTo(0, 0, 5, 0)).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(wrapAngle(3 * Math.PI))).toBeCloseTo(Math.PI);
  });

  it('covers a cone in front and nothing behind or beyond it', () => {
    // A cone facing +z, 10 long, 30 degrees either side.
    const half = Math.PI / 6;
    expect(inCone(0, 5, 0, 0, 0, 10, half)).toBe(true);
    expect(inCone(2, 9, 0, 0, 0, 10, half)).toBe(true);
    expect(inCone(0, -5, 0, 0, 0, 10, half)).toBe(false);
    expect(inCone(0, 11, 0, 0, 0, 10, half)).toBe(false);
    expect(inCone(6, 5, 0, 0, 0, 10, half)).toBe(false);
    // A hero's body pokes in past the edge.
    expect(inCone(3.4, 5, 0, 0, 0, 10, half, 0.6)).toBe(true);
    // Turned to face +x.
    expect(inCone(5, 0, 0, 0, Math.PI / 2, 10, half)).toBe(true);
    expect(inCone(0, 5, 0, 0, Math.PI / 2, 10, half)).toBe(false);
    // Standing on the apex counts.
    expect(inCone(0.1, -0.1, 0, 0, 0, 10, 0.1, 0.5)).toBe(true);
  });

  it('covers a strip from its start along its length', () => {
    expect(inLine(0, 6, 0, 0, 0, 12, 2)).toBe(true);
    expect(inLine(1.9, 11, 0, 0, 0, 12, 2)).toBe(true);
    expect(inLine(2.5, 6, 0, 0, 0, 12, 2)).toBe(false);
    expect(inLine(0, -1, 0, 0, 0, 12, 2)).toBe(false);
    expect(inLine(0, 13, 0, 0, 0, 12, 2)).toBe(false);
    expect(inLine(6, 0.5, 0, 0, Math.PI / 2, 12, 2)).toBe(true);
  });

  it('covers a ring band only', () => {
    expect(inRing(5, 0, 0, 0, 4, 6)).toBe(true);
    expect(inRing(2, 0, 0, 0, 4, 6)).toBe(false);
    expect(inRing(0, 7, 0, 0, 4, 6)).toBe(false);
  });

  it('rolls a wave across the arena, missing the gap and what it has passed', () => {
    const w: WaveSpec = { x: 0, z: 0, yaw: 0, speed: 10, width: 40, depth: 2, gapAt: 8, gap: 6 };
    // The crest reaches z = 10 after a second.
    expect(waveHits(w, 0, 10, 1)).toBe(true);
    expect(waveHits(w, 0, 10, 0.5)).toBe(false);
    expect(waveHits(w, 0, 10, 1.5)).toBe(false);
    // The gap is 8 m to the wall's right (looking along +z, right is -x).
    expect(waveHits(w, -8, 10, 1)).toBe(false);
    expect(waveHits(w, 8, 10, 1)).toBe(true);
    // Past the wall's ends.
    expect(waveHits(w, 25, 10, 1)).toBe(false);
  });
});

describe('great foes', () => {
  it('get 60% tougher for each friend', () => {
    expect(bossHealthScale(1)).toBe(1);
    expect(bossHealthScale(2)).toBeCloseTo(1.6);
    expect(bossHealthScale(4)).toBeCloseTo(2.8);
    expect(bossHealthScale(0)).toBe(1);
  });

  it('keep hunted foes home only when ready (and night walkers only at night)', () => {
    expect(lairOpen({}, false, 10, 0)).toBe(true);
    expect(lairOpen({}, false, 10, 20)).toBe(false);
    expect(lairOpen({ night: true }, false, 10, 0)).toBe(false);
    expect(lairOpen({ night: true }, true, 10, 0)).toBe(true);
  });

  it('let the Leviathan surface only in deep water, near its prey', () => {
    // Deep water south of z = 0 (towards -z), land to the north.
    const depth = (_x: number, z: number) => (z < 0 ? 6 : -2);
    const angles = surfaceAngles(0, 0, 30, depth, 2, 24);
    expect(angles.length).toBeGreaterThan(6);
    for (const a of angles) expect(Math.cos(a)).toBeLessThan(0);
    // Prefers the side towards the hero, but moves on from where it is.
    const toward = Math.PI;
    const first = nextSurface(angles, 0, toward);
    expect(Math.abs(wrapAngle(first - toward))).toBeLessThan(0.3);
    const second = nextSurface(angles, first, toward);
    expect(Math.abs(wrapAngle(second - first))).toBeGreaterThan(0.25);
    expect(nextSurface([], 1.2, 0)).toBe(1.2);
  });

  it('share timings between gameplay and the animators', () => {
    // A breath sweeps from one side to the other.
    expect(breathSweep(0, 0.6)).toBeCloseTo(0.6);
    expect(breathSweep(1, 0.6)).toBeCloseTo(-0.6);
    expect(Math.abs(breathSweep(0.49, 0.6))).toBeLessThan(0.05);
    expect(FLIGHT.up).toBeLessThan(FLIGHT.dive);
    expect(FLIGHT.dive).toBeLessThan(FLIGHT.land);
    for (const hits of Object.values(LANDS)) for (const h of hits!) expect(h).toBeGreaterThan(0), expect(h).toBeLessThan(1);
  });
});

describe('relics', () => {
  const hero = () => createCharacter({ name: 'R', classId: 'warrior', subclassId: 'swordsman', raceId: 'human', roleId: 'historian', expansion: false }, () => 0.5);

  it('grant their boons only while carried', () => {
    const c = hero();
    const hp = maxHp(c), mana = maxMana(c), regen = manaRegen(c);
    expect(swimsTireless(c)).toBe(false);
    c.items['dragon-heart'] = 1;
    c.items['tide-crown'] = 1;
    c.items['leviathan-pearl'] = 1;
    expect(maxHp(c)).toBe(hp + 30);
    expect(maxMana(c)).toBe(mana + 20);
    expect(manaRegen(c)).toBeCloseTo(regen * 1.3);
    expect(swimsTireless(c)).toBe(true);
  });

  it('halve fire (dragon heart) and water (tide crown) damage', () => {
    const c = hero();
    const ctx = { blocking: false, stoneSkin: false, invulnerable: false };
    expect(incomingDamage(c, 40, 'fire', ctx)).toBe(40);
    c.items['dragon-heart'] = 1;
    expect(incomingDamage(c, 40, 'fire', ctx)).toBe(20);
    expect(incomingDamage(c, 40, 'water', ctx)).toBe(40);
    c.items['tide-crown'] = 1;
    expect(incomingDamage(c, 40, 'water', ctx)).toBe(20);
    expect(incomingDamage(c, 40, 'physical', ctx)).toBe(40);
  });
});
