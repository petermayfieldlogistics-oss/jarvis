import { describe, expect, it } from 'vitest';
import { emptyLayout, isEmptyLayout, layoutHash, normalizeLayout } from './layout';
import shipped from '../data/layout.json';

describe('world layout', () => {
  it('the shipped layout loads', () => {
    expect(normalizeLayout(shipped)).toBeTruthy();
  });

  it('junk becomes an empty layout', () => {
    for (const junk of [null, 3, 'x', [], { moved: 5, removed: 'a', added: {}, camps: [], brushes: null }]) {
      expect(isEmptyLayout(normalizeLayout(junk))).toBe(true);
    }
  });

  it('keeps good entries, clamps numbers and drops bad ones', () => {
    const l = normalizeLayout({
      moved: { 'piece:house-1': { x: 5, z: 6, rot: 1, scale: 99 }, bad: { x: 'a', z: 1 } },
      removed: ['plant:1,2:3', 'plant:1,2:3', 7],
      added: [{ id: 'add:1', kind: 'barrel', x: 1, z: 2, rot: 0, scale: 1 }, { id: 'add:1', kind: 'crate', x: 0, z: 0 }, { kind: 'x', x: 0, z: 0 }],
      camps: { 'camp:0': { x: 1, z: 2, radius: 500, enemies: [['wolf', 30], ['nope', 1], 'x'] }, 'add:2': { x: 1, z: 2, enemies: [] } },
      brushes: [{ x: 0, z: 0, radius: 10, mode: 'raise', amount: 3 }, { x: 0, z: 0, mode: 'explode' }],
    }, (id) => id !== 'nope');
    expect(l.moved['piece:house-1']).toEqual({ x: 5, z: 6, rot: 1, scale: 5 });
    expect(l.moved.bad).toBeUndefined();
    expect(l.removed).toEqual(['plant:1,2:3']);
    expect(l.added.map((a) => a.id)).toEqual(['add:1']);
    expect(l.camps['camp:0']).toEqual({ x: 1, z: 2, radius: 60, enemies: [['wolf', 8]] });
    expect(l.camps['add:2']).toBeUndefined();
    expect(l.brushes).toHaveLength(1);
  });

  it('hashes: empty is "0", the same layout gives the same hash, a change gives another', () => {
    expect(layoutHash(emptyLayout())).toBe('0');
    const a = normalizeLayout({ removed: ['b', 'a'], brushes: [{ x: 1, z: 1, radius: 5, mode: 'lake', amount: 2 }] });
    const b = normalizeLayout({ removed: ['a', 'b'], brushes: [{ x: 1, z: 1, radius: 5, mode: 'lake', amount: 2 }] });
    expect(layoutHash(a)).toBe(layoutHash(b));
    expect(layoutHash(a)).not.toBe(layoutHash({ ...a, removed: ['a'] }));
  });
});
