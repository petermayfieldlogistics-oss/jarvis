import { describe, expect, it } from 'vitest';
import { createCharacter, type CharacterChoice } from './character';
import {
  BURST, BURSTS, BURST_COLOR, BURST_ELEMENT, POWER, burstEffects, burstFor, burstScale, canEmpower, chargeKind, chargeLevel, empowerPower,
  heroBurst, spellBurst, strikePower,
} from './power';

const hero = (over: Partial<CharacterChoice> = {}) =>
  createCharacter({ name: 'Tester', classId: 'warrior', subclassId: 'swordsman', raceId: 'human', roleId: 'historian', expansion: false, ...over });

describe('charging a power strike', () => {
  it('is a plain heavy on a tap, and charges fully after a held second', () => {
    expect(chargeLevel(0.1)).toBe(0);
    expect(chargeLevel(POWER.start)).toBe(0);
    expect(chargeLevel((POWER.start + POWER.full) / 2)).toBeCloseTo(0.5);
    expect(chargeLevel(POWER.full)).toBe(1);
    expect(chargeLevel(9)).toBe(1);
  });

  it('hits harder the longer it is held', () => {
    expect(strikePower(0)).toBe(1.5);
    expect(strikePower(1)).toBe(2.5);
    expect(empowerPower(1)).toBeGreaterThan(empowerPower(0));
    expect(burstScale(1)).toBe(1);
    expect(burstScale(0)).toBeLessThan(1);
  });

  it('charges a blow, an arrow, a throw or a spell by weapon and class', () => {
    const w = hero();
    expect(chargeKind(w, 'sword', null)).toBe('melee');
    expect(chargeKind(w, 'bow', 'wrath-of-thor')).toBe('bow');
    expect(chargeKind(w, 'knives', null)).toBe('thrown');
    expect(chargeKind(w, 'bolt', null)).toBe('thrown');
    // Instruments never charge.
    expect(chargeKind(w, 'lyre', null)).toBe(null);
    expect(chargeKind(w, 'horn', null)).toBe(null);
    // A mage or sorcerer empowers their selected spell, whatever is in hand.
    const m = hero({ classId: 'mage', subclassId: null });
    expect(chargeKind(m, 'staff', 'wrath-of-thor')).toBe('spell');
    expect(chargeKind(m, 'wand', 'shadow-bolt')).toBe('spell');
    // With no spell that can be empowered: the staff's blow, and a wand not at all.
    expect(chargeKind(m, 'staff', null)).toBe('melee');
    expect(chargeKind(m, 'wand', null)).toBe(null);
    expect(chargeKind(m, 'wand', 'deal-with-the-devil')).toBe(null);
    // Anyone else with a spell still charges their weapon.
    expect(chargeKind(hero({ classId: 'monk', subclassId: null }), 'wraps', 'palm-shockwave')).toBe('melee');
  });

  it('empowers spells that hurt or mend, not pacts and wards', () => {
    expect(canEmpower('wrath-of-thor')).toBe(true);
    expect(canEmpower('radiant-heal')).toBe(true);
    expect(canEmpower('deal-with-the-devil')).toBe(false);
    expect(canEmpower('soul-or-power')).toBe(false);
    expect(canEmpower('power-of-the-light')).toBe(false);
    expect(canEmpower(null)).toBe(false);
  });
});

describe('what a power strike bursts with', () => {
  it('takes the rune first, then the weapon, then the hero', () => {
    const w = hero();
    expect(burstFor(w, 'iron-sword')).toBe('force');
    expect(burstFor(w, 'iron-sword', 'fire')).toBe('fire');
    expect(burstFor(w, 'iron-sword', 'frost')).toBe('frost');
    expect(burstFor(w, 'iron-sword', 'storm')).toBe('lightning');
    expect(burstFor(w, 'iron-sword', 'venom')).toBe('earth');
    // A legendary with an element bursts with it.
    expect(burstFor(w, 'master-bolt')).toBe('lightning');
    // A Draconian's blow carries fire; a monk's, wind; a Knight's, light.
    expect(burstFor(hero({ raceId: 'draco' }), 'iron-sword')).toBe('fire');
    expect(burstFor(hero({ classId: 'monk', subclassId: null }), 'linen-wraps')).toBe('wind');
    expect(burstFor(hero({ roleId: 'knight' }), 'iron-sword')).toBe('light');
  });

  it("gives casters their path's element", () => {
    expect(heroBurst(hero({ classId: 'mage', subclassId: 'darkmage' }))).toBe('dark');
    expect(heroBurst(hero({ classId: 'mage', subclassId: 'lightmage' }))).toBe('light');
    const e = hero({ classId: 'mage', subclassId: 'elemental' });
    e.wizardElement = 'water';
    expect(heroBurst(e)).toBe('frost');
    expect(spellBurst(e, 'inferno')).toBe('fire');
  });

  it('has a colour, an element and a reach for every burst', () => {
    for (const b of BURSTS) {
      expect(BURST_COLOR[b]).toBeGreaterThan(0);
      expect(BURST_ELEMENT[b]).toBeTruthy();
      expect(BURST[b].radius).toBeGreaterThan(0);
      expect(BURST[b].share).toBeGreaterThan(0);
    }
  });

  it('gives each element its own effect, stronger when fully charged', () => {
    expect(burstEffects('fire', 1).groundSeconds).toBeGreaterThan(burstEffects('fire', 0).groundSeconds);
    expect(burstEffects('frost', 0).groundSeconds).toBe(0);
    expect(burstEffects('frost', 1).freeze).toBeGreaterThan(burstEffects('frost', 0).freeze);
    expect(burstEffects('frost', 0).slow).toBeGreaterThan(0);
    expect(burstEffects('lightning', 1).chains).toBe(5);
    expect(burstEffects('lightning', 0).stun).toBeGreaterThan(0);
    expect(burstEffects('earth', 1).lift).toBeGreaterThan(0);
    expect(burstEffects('wind', 1).shove).toBeGreaterThan(burstEffects('force', 1).shove);
    expect(burstEffects('light', 1).mend).toBeGreaterThan(0);
    expect(burstEffects('dark', 0).drain).toBeGreaterThan(0);
    // Each has only its own.
    expect(burstEffects('wind', 1)).toMatchObject({ groundSeconds: 0, freeze: 0, chains: 0, lift: 0, mend: 0, drain: 0 });
  });
});
