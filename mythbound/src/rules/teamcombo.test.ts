import { describe, expect, it } from 'vitest';
import { COMBO_ELEMENTS, TEAM_COMBOS } from '../data/defs';
import { TEAM, comboElement, newTeamMemory, noteTeamHit, teamBonus, teamComboFor } from './teamcombo';

describe('team combos', () => {
  it('has one combo for every pair of different elements', () => {
    expect(TEAM_COMBOS).toHaveLength(21);
    expect(new Set(TEAM_COMBOS.map((k) => k.id)).size).toBe(21);
    for (const a of COMBO_ELEMENTS) {
      for (const b of COMBO_ELEMENTS) {
        if (a === b) expect(teamComboFor(a, b)).toBe(null);
        else expect(teamComboFor(a, b)).toBe(teamComboFor(b, a));
        if (a !== b) expect(teamComboFor(a, b)).not.toBe(null);
      }
    }
    expect(teamComboFor('fire', 'water')!.name).toBe('Scalding Steam');
    expect(teamComboFor('lightning', 'water')!.name).toBe('Conduction');
    expect(teamComboFor('dark', 'light')!.element).toBe('true');
  });

  it('only counts elemental blows', () => {
    expect(comboElement('physical')).toBe(null);
    expect(comboElement('true')).toBe(null);
    expect(comboElement('fire')).toBe('fire');
  });

  it('combines two heroes, two elements, one foe, within the window', () => {
    const mem = newTeamMemory();
    expect(noteTeamHit(mem, { hero: 1, el: 'fire', at: 10, dmg: 20 })).toBe(null);
    const r = noteTeamHit(mem, { hero: 2, el: 'water', at: 12, dmg: 30 });
    expect(r?.def.id).toBe('scalding-steam');
    expect(r?.partner).toMatchObject({ hero: 1, el: 'fire', dmg: 20 });
    // Spent: the next blow starts afresh, and the foe rests a moment.
    expect(mem.marks).toHaveLength(0);
    expect(noteTeamHit(mem, { hero: 1, el: 'lightning', at: 12.5, dmg: 20 })).toBe(null);
    expect(noteTeamHit(mem, { hero: 2, el: 'water', at: 13, dmg: 20 })).toBe(null);
    expect(noteTeamHit(mem, { hero: 1, el: 'lightning', at: 12 + TEAM.cooldown + 0.1, dmg: 20 })?.def.id).toBe('conduction');
  });

  it('never combines a hero with themselves or the same element', () => {
    const mem = newTeamMemory();
    noteTeamHit(mem, { hero: 1, el: 'fire', at: 0, dmg: 10 });
    expect(noteTeamHit(mem, { hero: 1, el: 'water', at: 1, dmg: 10 })).toBe(null);
    const two = newTeamMemory();
    noteTeamHit(two, { hero: 1, el: 'fire', at: 0, dmg: 10 });
    expect(noteTeamHit(two, { hero: 2, el: 'fire', at: 1, dmg: 10 })).toBe(null);
    // Hero 2's fire and hero 1's water (its latest) still combine.
    expect(noteTeamHit(two, { hero: 1, el: 'water', at: 1.5, dmg: 10 })?.def.id).toBe('scalding-steam');
  });

  it('forgets blows older than the window', () => {
    const mem = newTeamMemory();
    noteTeamHit(mem, { hero: 1, el: 'earth', at: 0, dmg: 10 });
    expect(noteTeamHit(mem, { hero: 2, el: 'wind', at: TEAM.window + 0.5, dmg: 10 })).toBe(null);
    expect(mem.marks).toHaveLength(1);
  });

  it('adds a share of both blows, never less than the least', () => {
    const steam = teamComboFor('fire', 'water')!;
    expect(teamBonus(steam, 50, 50)).toBeCloseTo(60);
    expect(teamBonus(steam, 1, 1)).toBe(TEAM.minBonus);
    expect(teamBonus(teamComboFor('light', 'dark')!, 50, 50)).toBeGreaterThan(teamBonus(steam, 50, 50));
  });
});
