import { describe, expect, it } from 'vitest';
import { STICK, followTurn, stickMove } from './touch';

describe('touch stick', () => {
  it('ignores a resting thumb, then speeds up to a full run', () => {
    expect(stickMove(4, 3)).toEqual({ x: 0, y: 0 });
    const half = stickMove(0, -(STICK.dead + (STICK.full - STICK.dead) / 2));
    expect(half.x).toBeCloseTo(0);
    expect(half.y).toBeCloseTo(0.5);
    expect(stickMove(STICK.full * 2, 0)).toEqual({ x: 1, y: -0 });
  });

  it('keeps sprinting past the ring, and the stick follows before the thumb runs out', () => {
    expect(STICK.walk).toBeLessThan(STICK.sprint);
    expect(STICK.sprint).toBeLessThan(STICK.drag);
  });
});

describe('camera follow', () => {
  it('swings toward a hero running across the view, never round to face one running back', () => {
    const turn = followTurn(Math.PI / 2, 7, 1 / 60);
    expect(turn).toBeGreaterThan(0);
    expect(turn).toBeLessThan(0.05);
    expect(followTurn(-Math.PI / 2, 7, 1 / 60)).toBeLessThan(0);
    expect(followTurn(Math.PI - 0.1, 7, 1 / 60)).toBe(0);
    expect(followTurn(1, 1, 1 / 60)).toBe(0);
  });
});
