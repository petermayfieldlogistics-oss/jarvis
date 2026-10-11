import { describe, expect, it } from 'vitest';
import {
  addXp,
  canLearnSpell,
  createCharacter,
  dracoFireRegen,
  dracoFlightHours,
  dracoWaterDamagePerSecond,
  maxHp,
  maxMana,
  subclassesFor,
  tameableKinds,
  validateChoice,
  type CharacterChoice,
} from './character';
import {
  canCast,
  canWield,
  comboFor,
  hasBloodsteal,
  incomingDamage,
  newFury,
  onMeleeLanded,
  onMeleeMissed,
  outgoingDamage,
  powerShot,
  retribution,
  strikeDevilDeal,
  warriorMeleeMultiplier,
  devilRingAffects,
} from './combat';

const choice = (over: Partial<CharacterChoice> = {}): CharacterChoice => ({
  name: 'Tester',
  classId: 'warrior',
  subclassId: 'swordsman',
  raceId: 'human',
  roleId: 'historian',
  expansion: false,
  ...over,
});
const fixed = (v: number) => () => v;
const melee = { kind: 'melee' as const, element: 'physical' as const, targetDark: false, undetected: false, fromBehind: false };
const ctx = { gameMinutes: 0, mana: 100, inDesert: false, soulOrPower: false };

describe('classes', () => {
  it('gives each class its HP and mana', () => {
    const w = createCharacter(choice());
    expect(maxHp(w)).toBe(120);
    expect(maxMana(w)).toBe(20);
    const r = createCharacter(choice({ classId: 'ranger', subclassId: null }));
    expect(maxMana(r)).toBe(40);
    const m = createCharacter(choice({ classId: 'mage', subclassId: null }));
    expect(maxMana(m)).toBe(70);
  });

  it('starts mages with their five level 1 spells', () => {
    const m = createCharacter(choice({ classId: 'mage', subclassId: null }));
    expect(m.knownSpells).toEqual(['deal-with-the-devil', 'inferno', 'wrath-of-thor', 'waterspike', 'way-of-the-wind']);
  });

  it('limits rangers to sky magic unless they are elves', () => {
    const human = createCharacter(choice({ classId: 'ranger', subclassId: null }));
    expect(human.knownSpells).toEqual(['wrath-of-thor', 'way-of-the-wind']);
    expect(canLearnSpell(human, 'inferno')).toBe(false);
    expect(canLearnSpell(human, 'deal-with-the-devil')).toBe(false);
    const elf = createCharacter(choice({ classId: 'ranger', subclassId: null, raceId: 'elf' }));
    expect(canLearnSpell(elf, 'deal-with-the-devil')).toBe(true);
    expect(elf.knownSpells).toContain('imp-familiar');
  });

  it('starts rangers with a level 1 bow, elves with a level 3 bow', () => {
    expect(createCharacter(choice({ classId: 'ranger', subclassId: null })).weapons[0]).toEqual({ id: 'hunting-bow', level: 1 });
    const elf = createCharacter(choice({ classId: 'ranger', subclassId: null, raceId: 'elf' }));
    expect(elf.weapons[0].level).toBe(3);
    const elfWarrior = createCharacter(choice({ raceId: 'elf' }));
    expect(elfWarrior.weapons.some((w) => w.id === 'elven-bow' && w.level === 3)).toBe(true);
  });
});

describe('subclasses', () => {
  it('offers warrior subclasses without the expansion, and bowman with it', () => {
    expect(subclassesFor('warrior', false)).toEqual(['swordsman', 'axeman']);
    expect(subclassesFor('warrior', true)).toEqual(['swordsman', 'axeman', 'bowman']);
    expect(subclassesFor('ranger', false)).toEqual([]);
    expect(subclassesFor('ranger', true)).toEqual(['trainer']);
    expect(subclassesFor('mage', true)).toEqual(['elemental']);
  });

  it('equips each subclass with its starting gear', () => {
    expect(createCharacter(choice()).weapons[0]).toEqual({ id: 'iron-sword', level: 2 });
    expect(createCharacter(choice({ subclassId: 'axeman' })).weapons[0]).toEqual({ id: 'iron-axe', level: 2 });
    const bowman = createCharacter(choice({ subclassId: 'bowman', expansion: true }));
    expect(bowman.weapons[0]).toEqual({ id: 'copper-bow', level: 2 });
    expect(bowman.arrows.steel).toBe(50);
  });

  it('rejects the secret race until it is unlocked', () => {
    expect(validateChoice(choice({ raceId: 'ancient' }), false)).toMatch(/not yet known/);
    expect(validateChoice(choice({ raceId: 'ancient' }), true)).toBeNull();
  });

  it('lets trainers tame more creatures with each level', () => {
    const t = createCharacter(choice({ classId: 'ranger', subclassId: 'trainer', expansion: true }));
    expect(tameableKinds(t)).toEqual(['wolf']);
    t.level = 5;
    expect(tameableKinds(t)).toEqual(['wolf', 'boar', 'scorpion']);
  });
});

describe('warrior fury', () => {
  it('gives a flat 25% that does not stack normally', () => {
    const w = createCharacter(choice());
    const fury = newFury();
    expect(warriorMeleeMultiplier(w, fury)).toBe(1.25);
    onMeleeLanded(w, fury);
    onMeleeLanded(w, fury);
    expect(warriorMeleeMultiplier(w, fury)).toBe(1.25);
  });

  it('stacks in BloodRage and resets on a miss', () => {
    const w = createCharacter(choice());
    const fury = { ...newFury(), bloodrageActive: true };
    expect(warriorMeleeMultiplier(w, fury)).toBe(1.25);
    onMeleeLanded(w, fury);
    expect(warriorMeleeMultiplier(w, fury)).toBe(1.5);
    onMeleeLanded(w, fury);
    expect(warriorMeleeMultiplier(w, fury)).toBe(1.75);
    onMeleeMissed(fury);
    expect(warriorMeleeMultiplier(w, fury)).toBe(1.25);
  });

  it('stacks while wielding the Sword of Mars', () => {
    const w = createCharacter(choice());
    w.weapons.push({ id: 'sword-of-mars', level: 1 });
    w.mainHand = 1;
    const fury = newFury();
    onMeleeLanded(w, fury);
    expect(warriorMeleeMultiplier(w, fury)).toBe(1.5);
  });

  it('grants Bloodsteal from level 4 during BloodRage', () => {
    const w = createCharacter(choice());
    const fury = { ...newFury(), bloodrageActive: true };
    expect(hasBloodsteal(w, fury)).toBe(false);
    w.level = 4;
    expect(hasBloodsteal(w, fury)).toBe(true);
    expect(hasBloodsteal(w, newFury())).toBe(false);
  });

  it('blocks all damage with a shield', () => {
    const w = createCharacter(choice());
    expect(incomingDamage(w, 500, 'fire', { blocking: true, stoneSkin: false, invulnerable: false })).toBe(0);
    const m = createCharacter(choice({ classId: 'mage', subclassId: null }));
    expect(incomingDamage(m, 100, 'physical', { blocking: true, stoneSkin: false, invulnerable: false })).toBe(40);
  });

  it('applies the 25% to damage', () => {
    const w = createCharacter(choice());
    expect(outgoingDamage(w, { ...melee, base: 20, fury: newFury() }).amount).toBe(25);
  });
});

describe('bowman power shot', () => {
  it('deals 6x damage plus half damage in a radius that grows with level', () => {
    const b = createCharacter(choice({ subclassId: 'bowman', expansion: true }));
    const shot = powerShot(b)!;
    expect(shot.multiplier).toBe(6);
    expect(shot.splashFraction).toBe(0.5);
    b.level = 8;
    expect(powerShot(b)!.radius).toBeGreaterThan(shot.radius);
    expect(powerShot(createCharacter(choice()))).toBeNull();
  });
});

describe('races', () => {
  it('hurts Draco in water only at level 5', () => {
    const d = createCharacter(choice({ raceId: 'draco' }));
    d.level = 4;
    expect(dracoWaterDamagePerSecond(d)).toBe(0);
    d.level = 5;
    expect(dracoWaterDamagePerSecond(d)).toBeGreaterThan(0);
    d.level = 6;
    expect(dracoWaterDamagePerSecond(d)).toBe(0);
  });

  it('grows Draco flight by an hour each level from 6, and fire regen at 10', () => {
    const d = createCharacter(choice({ raceId: 'draco' }));
    d.level = 5;
    expect(dracoFlightHours(d)).toBe(0);
    d.level = 6;
    expect(dracoFlightHours(d)).toBe(1);
    d.level = 9;
    expect(dracoFlightHours(d)).toBe(4);
    expect(dracoFireRegen(d)).toBe(0);
    d.level = 10;
    expect(dracoFireRegen(d)).toBe(10);
    expect(incomingDamage(d, 40, 'fire', { blocking: false, stoneSkin: false, invulnerable: false })).toBe(20);
  });

  it('assigns elves an element with 25% odds and the secret with 33%', () => {
    expect(createCharacter(choice({ raceId: 'elf' }), fixed(0)).elfElement).toBe('earth');
    expect(createCharacter(choice({ raceId: 'elf' }), fixed(0.99)).elfElement).toBe('wind');
    expect(createCharacter(choice({ raceId: 'elf' }), fixed(0.2)).elfMystery).toBe(true);
    expect(createCharacter(choice({ raceId: 'elf' }), fixed(0.5)).elfMystery).toBe(false);
    expect(createCharacter(choice(), fixed(0)).elfMystery).toBe(false);
  });
});

describe('legendaries', () => {
  it('enforces class and role requirements', () => {
    const w = createCharacter(choice());
    expect(canWield(w, 'sword-of-mars').ok).toBe(true);
    expect(canWield(w, 'staff-of-hecate').ok).toBe(false);
    expect(canWield(w, 'hammer-of-hephaestus').ok).toBe(false);
    const smith = createCharacter(choice({ roleId: 'blacksmith' }));
    expect(canWield(smith, 'hammer-of-hephaestus').ok).toBe(true);
    const sailor = createCharacter(choice({ roleId: 'sailor' }));
    expect(canWield(sailor, 'trident-of-poseidon').ok).toBe(true);
  });

  it('lets only an elf ranger use the Bow of Artemis at full power', () => {
    const human = createCharacter(choice({ classId: 'ranger', subclassId: null }));
    expect(canWield(human, 'bow-of-artemis')).toMatchObject({ ok: true, partial: true });
    const elf = createCharacter(choice({ classId: 'ranger', subclassId: null, raceId: 'elf' }));
    expect(canWield(elf, 'bow-of-artemis')).toEqual({ ok: true });
    expect(canWield(createCharacter(choice()), 'bow-of-artemis').ok).toBe(false);
  });

  it('lets anyone throw the Master Bolt, but only rangers properly', () => {
    expect(canWield(createCharacter(choice()), 'master-bolt').partial).toBe(true);
    expect(canWield(createCharacter(choice({ classId: 'ranger', subclassId: null })), 'master-bolt')).toEqual({ ok: true });
  });
});

describe('spells', () => {
  it('seals light magic for 1, 2, 3 hours, then forever on the 4th deal', () => {
    const k = createCharacter(choice({ classId: 'mage', subclassId: null, roleId: 'knight' }));
    expect(strikeDevilDeal(k, 0)).toBe(1);
    expect(canCast(k, 'holy-smite', ctx).ok).toBe(false);
    expect(canCast(k, 'holy-smite', { ...ctx, gameMinutes: 61 }).ok).toBe(true);
    expect(strikeDevilDeal(k, 100)).toBe(2);
    expect(canCast(k, 'holy-smite', { ...ctx, gameMinutes: 219 }).ok).toBe(false);
    expect(strikeDevilDeal(k, 300)).toBe(3);
    expect(strikeDevilDeal(k, 1000)).toBe(Infinity);
    expect(canCast(k, 'holy-smite', { ...ctx, gameMinutes: 1e9 }).reason).toMatch(/Forever/);
  });

  it('only rings level 1-5 foes', () => {
    expect(devilRingAffects(5)).toBe(true);
    expect(devilRingAffects(6)).toBe(false);
  });

  it("won't bend water in the desert", () => {
    const m = createCharacter(choice({ classId: 'mage', subclassId: null }));
    expect(canCast(m, 'waterspike', { ...ctx, inDesert: true }).ok).toBe(false);
    expect(canCast(m, 'waterspike', ctx).ok).toBe(true);
  });

  it('allows Soul or Power only at 15 mana or less, then casting is free', () => {
    const m = createCharacter(choice({ classId: 'mage', subclassId: null }));
    m.knownSpells.push('soul-or-power');
    expect(canCast(m, 'soul-or-power', { ...ctx, mana: 16 }).ok).toBe(false);
    expect(canCast(m, 'soul-or-power', { ...ctx, mana: 15 }).ok).toBe(true);
    expect(canCast(m, 'inferno', { ...ctx, mana: 0, soulOrPower: true })).toEqual({ ok: true, cost: 0 });
  });

  it('returns 1.5x damage dealt with Blade of Retribution', () => {
    expect(retribution(100)).toBe(150);
  });

  it('finds combos in either order', () => {
    expect(comboFor('way-of-the-wind', 'inferno')?.name).toBe('Firestorm');
    expect(comboFor('inferno', 'inferno')).toBeNull();
  });
});

describe('roles', () => {
  it('gives historians 15% more experience', () => {
    const h = createCharacter(choice());
    const b = createCharacter(choice({ roleId: 'blacksmith' }));
    addXp(h, 40);
    addXp(b, 40);
    expect(h.xp).toBe(46);
    expect(b.xp).toBe(40);
  });

  it('lets assassins backstab for 4x and dark slayers hit dark things harder', () => {
    const a = createCharacter(choice({ classId: 'mage', subclassId: null, roleId: 'assassin' }));
    expect(outgoingDamage(a, { ...melee, base: 10, undetected: true, fromBehind: true }).amount).toBe(40);
    const d = createCharacter(choice({ classId: 'mage', subclassId: null, roleId: 'darkslayer' }));
    expect(outgoingDamage(d, { ...melee, base: 10, targetDark: true }).amount).toBe(15);
  });
});
