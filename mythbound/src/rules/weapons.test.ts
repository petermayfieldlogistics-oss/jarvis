import { describe, expect, it } from 'vitest';
import { WEAPONS, runeItem } from '../data/defs';
import { createCharacter, type CharacterChoice } from './character';
import { bleedChance, canWield, spellPowerMultiplier } from './combat';
import {
  MAX_KNIVES, RUNE_DROP_CHANCE, buyRune, buyWeapon, canBearRune, inscribe, isOffhand, isTwoHanded, meleeReach, pickUpKnife, refillKnives, runeDrop,
  family, runesHeld, shopStock, songOf, swingArc,
} from './weapons';
import { normalizeSave, newWorldState, type SaveData } from '../engine/state';

const choice = (over: Partial<CharacterChoice> = {}): CharacterChoice => ({
  name: 'Tester',
  classId: 'warrior',
  subclassId: 'swordsman',
  raceId: 'human',
  roleId: 'historian',
  expansion: false,
  ...over,
});
const mage = () => createCharacter(choice({ classId: 'mage', subclassId: null }));

describe('new weapons', () => {
  it('keeps class-only weapons to their class', () => {
    const w = createCharacter(choice());
    expect(canWield(w, 'iron-greatsword').ok).toBe(true);
    expect(canWield(w, 'willow-wand')).toMatchObject({ ok: false, reason: 'Only a Mage or Sorcerer can wield the Willow Wand.' });
    expect(canWield(mage(), 'battle-axe').ok).toBe(false);
    expect(canWield(mage(), 'rune-circle').ok).toBe(true);
    // Anyone can play an instrument or throw knives.
    expect(canWield(mage(), 'bards-lyre').ok).toBe(true);
    expect(canWield(w, 'throwing-knives').ok).toBe(true);
  });

  it('makes spells hit harder with a wand in hand', () => {
    const m = mage();
    const bare = spellPowerMultiplier(m, 'fire');
    m.weapons.push({ id: 'willow-wand', level: 1 });
    m.mainHand = m.weapons.length - 1;
    expect(spellPowerMultiplier(m, 'fire')).toBeCloseTo(bare * 1.15);
  });

  it('reaches far with a spear but narrowly, and wide with a greatsword', () => {
    expect(meleeReach(WEAPONS['ash-spear'])).toBeGreaterThan(meleeReach(WEAPONS['steel-longsword']));
    expect(meleeReach(WEAPONS['steel-longsword'])).toBeGreaterThan(meleeReach(WEAPONS['iron-sword']));
    // Knives and wands have a long range for their throws and bolts, not their stabs.
    expect(meleeReach(WEAPONS['throwing-knives'])).toBeLessThan(3);
    expect(meleeReach(WEAPONS['willow-wand'])).toBeLessThan(3);
    expect(swingArc('spear', 'light', false)).toBeGreaterThan(swingArc('sword', 'light', false));
    expect(swingArc('greatsword', 'light', false)).toBeLessThan(swingArc('sword', 'light', false));
    expect(swingArc('spear', 'heavy', false)).toBeLessThan(0);
    expect(swingArc('sword', 'spin', false)).toBeLessThan(-1);
  });

  it('trains longswords and greatswords with sword talents, battle axes with axe talents', () => {
    expect(family('greatsword')).toBe('sword');
    expect(family('longsword')).toBe('sword');
    expect(family('battleaxe')).toBe('axe');
    expect(family('wand')).toBe('wand');
    const c = createCharacter(choice());
    c.weapons.push({ id: 'battle-axe', level: 1 });
    c.mainHand = c.weapons.length - 1;
    // The battle axe makes foes bleed like any axe.
    expect(bleedChance(c)).toBeGreaterThanOrEqual(0.25);
  });

  it('knows which hand holds what', () => {
    expect(isOffhand('lyre') && isOffhand('runecircle') && isOffhand('bow')).toBe(true);
    expect(isOffhand('horn') || isOffhand('wand')).toBe(false);
    expect(isTwoHanded('greatsword') && isTwoHanded('battleaxe')).toBe(true);
    expect(isTwoHanded('longsword') || isTwoHanded('spear')).toBe(false);
    expect(songOf('lyre')).toBe('valor');
    expect(songOf('horn')).toBe('warcry');
    expect(songOf('sword')).toBe(null);
  });
});

describe('shops and throwing knives', () => {
  it('sells steel at the forge and curios at the stall', () => {
    expect(shopStock('brann').map((w) => w.id)).toEqual(expect.arrayContaining(['iron-greatsword', 'ash-spear', 'throwing-knives']));
    expect(shopStock('quill').map((w) => w.id)).toEqual(expect.arrayContaining(['willow-wand', 'rune-circle', 'bards-lyre', 'war-horn']));
    // Legendaries are never for sale.
    expect(shopStock('brann').some((w) => w.legendary)).toBe(false);
  });

  it('buys a weapon once, for its price', () => {
    const c = createCharacter(choice());
    expect(buyWeapon(c, 'ash-spear')).toBe('Not enough embers.');
    c.gold = 500;
    expect(buyWeapon(c, 'ash-spear')).toBe(null);
    expect(c.gold).toBe(500 - WEAPONS['ash-spear'].price!);
    expect(c.weapons.at(-1)).toEqual({ id: 'ash-spear', level: 1 });
    expect(buyWeapon(c, 'ash-spear')).toBe('You already have one.');
    expect(buyWeapon(c, 'sword-of-mars')).toBe('That is not for sale.');
  });

  it('fills the bandolier on purchase, at rest and by picking knives up', () => {
    const c = createCharacter(choice());
    expect(c.knives).toBe(0);
    refillKnives(c);
    expect(c.knives).toBe(0);
    c.gold = 500;
    buyWeapon(c, 'throwing-knives');
    expect(c.knives).toBe(MAX_KNIVES);
    expect(pickUpKnife(c)).toBe(false);
    c.knives = 3;
    expect(pickUpKnife(c)).toBe(true);
    expect(c.knives).toBe(4);
    refillKnives(c);
    expect(c.knives).toBe(MAX_KNIVES);
  });
});

describe('runes', () => {
  it('inscribes a rune from the pack and returns the old one', () => {
    const c = createCharacter(choice());
    expect(inscribe(c, 0, 'fire')).toBe(false);
    c.gold = 1000;
    expect(buyRune(c, 'fire')).toBe(true);
    expect(buyRune(c, 'frost')).toBe(true);
    expect(runesHeld(c)).toEqual([['fire', 1], ['frost', 1]]);
    expect(inscribe(c, 0, 'fire')).toBe(true);
    expect(c.weapons[0].rune).toBe('fire');
    expect(c.items[runeItem('fire')]).toBe(0);
    // The same rune again does nothing; a new one swaps in.
    expect(inscribe(c, 0, 'fire')).toBe(false);
    expect(inscribe(c, 0, 'frost')).toBe(true);
    expect(c.weapons[0].rune).toBe('frost');
    expect(c.items[runeItem('fire')]).toBe(1);
  });

  it('never runes a legendary', () => {
    expect(canBearRune('iron-sword')).toBe(true);
    expect(canBearRune('sword-of-mars')).toBe(false);
    expect(canBearRune('master-bolt')).toBe(false);
    expect(canBearRune('nope')).toBe(false);
  });

  it('drops runes matched to the foe, always from bosses', () => {
    expect(runeDrop('fire', false, RUNE_DROP_CHANCE + 0.01, 0)).toBe(null);
    expect(runeDrop('fire', false, 0, 0)).toBe('fire');
    expect(runeDrop('water', true, 0.99, 0)).toBe('frost');
    expect(runeDrop('wind', true, 0.99, 0)).toBe('storm');
    expect(runeDrop('dark', true, 0.99, 0)).toBe('venom');
    expect(runeDrop('none', true, 0.99, 0.99)).toBe('venom');
    expect(runeDrop('none', true, 0.99, 0)).toBe('fire');
  });

  it('loads older saves without knives or with unknown runes', () => {
    const c = createCharacter(choice());
    const old = JSON.parse(JSON.stringify({ character: c, world: newWorldState() })) as SaveData;
    delete (old.character as Partial<typeof c>).knives;
    (old.character.weapons[0] as { rune?: string }).rune = 'moon';
    old.character.weapons.push({ id: 'iron-axe', level: 1, rune: 'venom' });
    const fixed = normalizeSave(old);
    expect(fixed.character.knives).toBe(0);
    expect(fixed.character.weapons[0].rune).toBeUndefined();
    expect(fixed.character.weapons[1].rune).toBe('venom');
  });
});
