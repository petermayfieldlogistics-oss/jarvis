import { describe, expect, it } from 'vitest';
import { RACES } from '../data/defs';
import {
  airFlaps,
  canLearnSpell,
  createCharacter,
  drowns,
  killHeal,
  lightHealMultiplier,
  manaRegen,
  maxHp,
  shopPrice,
  startingSpells,
  validateChoice,
  wingsGrown,
  type CharacterChoice,
} from './character';
import { immuneToBleed, incomingDamage, newFury, outgoingDamage, spellPowerMultiplier } from './combat';

const choice = (over: Partial<CharacterChoice> = {}): CharacterChoice => ({
  name: 'Tester',
  classId: 'warrior',
  subclassId: 'swordsman',
  raceId: 'human',
  roleId: 'historian',
  expansion: false,
  ...over,
});
const hero = (over: Partial<CharacterChoice> = {}) => createCharacter(choice(over));
const melee = { kind: 'melee' as const, element: 'physical' as const, targetDark: false, undetected: false, fromBehind: false };
const taken = { blocking: false, stoneSkin: false, invulnerable: false };

describe('zombie, angelic and orc races', () => {
  it('are open to everyone and described on their cards', () => {
    for (const id of ['zombie', 'angelic', 'orc'] as const) {
      expect(validateChoice(choice({ raceId: id }), false)).toBeNull();
      expect(RACES[id].secret).toBeFalsy();
      expect(RACES[id].traits.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('lets zombies feed on kills, swim without drowning and shrug off bleeding', () => {
    const z = hero({ raceId: 'zombie' });
    expect(killHeal(z)).toBeGreaterThan(0);
    expect(killHeal(hero())).toBe(0);
    expect(drowns(z)).toBe(false);
    expect(drowns(hero())).toBe(true);
    expect(immuneToBleed(z, newFury())).toBe(true);
    expect(z.riseSpent).toBe(false);
  });

  it('makes zombies burn, heal poorly from the light and pay more', () => {
    const z = hero({ raceId: 'zombie' });
    expect(incomingDamage(z, 40, 'fire', taken)).toBe(60);
    expect(incomingDamage(z, 40, 'physical', taken)).toBe(40);
    expect(lightHealMultiplier(z)).toBe(0.5);
    expect(lightHealMultiplier(hero())).toBe(1);
    expect(shopPrice(z, 100)).toBe(125);
    expect(shopPrice(hero(), 100)).toBe(100);
  });

  it('gives angels wings from the start, light magic and a weakness to the dark', () => {
    const a = hero({ raceId: 'angelic', classId: 'ranger', subclassId: null });
    expect(wingsGrown(a)).toBe(true);
    expect(airFlaps(a)).toBe(2);
    expect(airFlaps(hero())).toBe(0);
    expect(startingSpells(a)).toContain('holy-smite');
    expect(canLearnSpell(a, 'radiant-heal')).toBe(true);
    expect(canLearnSpell(a, 'power-of-the-light')).toBe(false);
    expect(spellPowerMultiplier(a, 'light')).toBeCloseTo(1.25);
    expect(outgoingDamage(a, { ...melee, kind: 'bow', element: 'light', base: 100 }).amount).toBeGreaterThan(outgoingDamage(a, { ...melee, kind: 'bow', base: 100 }).amount);
    expect(incomingDamage(a, 100, 'dark', taken)).toBe(130);
  });

  it('only grows draco wings at level 6', () => {
    const d = hero({ raceId: 'draco' });
    expect(wingsGrown(d)).toBe(false);
    d.level = 6;
    expect(wingsGrown(d)).toBe(true);
  });

  it('makes orcs tougher and stronger in melee but slower with mana and spells', () => {
    const o = hero({ raceId: 'orc' });
    const h = hero();
    expect(maxHp(o)).toBe(Math.round(maxHp(h) * 1.2));
    expect(outgoingDamage(o, { ...melee, base: 100 }).amount).toBeGreaterThan(outgoingDamage(h, { ...melee, base: 100 }).amount);
    expect(manaRegen(o)).toBeLessThan(manaRegen(h));
    expect(spellPowerMultiplier(o, 'fire')).toBeLessThan(spellPowerMultiplier(h, 'fire'));
  });

  it("adds the War Cry's bonus to weapon blows, not spells", () => {
    const o = hero({ raceId: 'orc' });
    const plain = outgoingDamage(o, { ...melee, base: 100 });
    const roaring = outgoingDamage(o, { ...melee, base: 100, warCry: true });
    expect(roaring.amount).toBeCloseTo(plain.amount * 1.25, 0);
    expect(roaring.tags).toContain('warcry');
    const spell = outgoingDamage(o, { ...melee, kind: 'spell', element: 'fire', base: 100, warCry: true });
    expect(spell.tags).not.toContain('warcry');
  });

  it('keeps max HP lost to Soul or Power on top of the orc bonus', () => {
    const o = hero({ raceId: 'orc' });
    const full = maxHp(o);
    o.hpLost = 10;
    expect(maxHp(o)).toBe(full - 10);
  });
});
