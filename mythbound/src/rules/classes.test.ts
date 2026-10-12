import { describe, expect, it } from 'vitest';
import { SPELLS, TREES, WEAPONS, type ClassId, type SubclassId } from '../data/defs';
import { airFlaps, canLearnSpell, classStats, createCharacter, maxHp, pointsEarned, treesFor, validateChoice, type CharacterChoice } from './character';
import {
  ambushPower, backstabMultiplier, dodgeReward, flurryBlows, flurryPower, hexSeconds, lightAttackSpeed, palmPower, rogueBladePower, rogueStealth, rollSpec, toxinDps,
  vanishCooldown, vanishSeconds,
} from './classes';
import { canWield, incomingDamage, outgoingDamage, spellCost, spellPowerMultiplier, type HitContext } from './combat';
import { learnSkill, lockReason, pointsSpent, treeOf } from './skills';
import { classWields } from './weapons';

const choice = (o: Partial<CharacterChoice>): CharacterChoice => ({ name: 'T', classId: 'monk', subclassId: 'ironfist', raceId: 'human', roleId: 'historian', expansion: false, ...o });
const hero = (o: Partial<CharacterChoice> = {}, level = 1) => {
  const c = createCharacter(choice(o), () => 0.5);
  c.level = level;
  c.skillPoints = pointsEarned(level);
  return c;
};
const hit = (o: Partial<HitContext> = {}): HitContext => ({ base: 10, kind: 'melee', element: 'physical', targetDark: false, undetected: false, fromBehind: false, ...o });

const NEW: [ClassId, SubclassId][] = [['monk', 'ironfist'], ['monk', 'windwalker'], ['sorcerer', 'darkmage'], ['sorcerer', 'lightmage'], ['rogue', 'shadow'], ['rogue', 'duelist']];

describe('the Monk, the Sorcerer and the Rogue', () => {
  it('need a subclass, and every subclass is open without the expansion', () => {
    for (const [classId, subclassId] of NEW) {
      expect(validateChoice(choice({ classId, subclassId: null }), false)).toBe('Pick a subclass.');
      expect(validateChoice(choice({ classId, subclassId }), false)).toBeNull();
    }
  });

  it('start with their own gear and arts', () => {
    const iron = hero({ subclassId: 'ironfist' });
    expect(iron.weapons).toEqual([{ id: 'iron-knuckles', level: 2 }]);
    expect(iron.knownSpells).toEqual(['palm-shockwave', 'meditate', 'iron-skin']);
    const wind = hero({ subclassId: 'windwalker' });
    expect(wind.weapons.map((w) => w.id)).toEqual(['ash-quarterstaff', 'linen-wraps']);
    expect(wind.knownSpells).toContain('cyclone-kick');
    const dark = hero({ classId: 'sorcerer', subclassId: 'darkmage' });
    expect(dark.weapons[0].id).toBe('willow-wand');
    expect(dark.knownSpells).toEqual(['shadow-bolt', 'life-drain', 'hex', 'summon-shade']);
    const light = hero({ classId: 'sorcerer', subclassId: 'lightmage' });
    expect(light.knownSpells).toEqual(['radiant-beam', 'smite-undead', 'mending-light', 'ward-of-dawn']);
    const shadow = hero({ classId: 'rogue', subclassId: 'shadow' });
    expect(shadow.weapons.map((w) => w.id)).toEqual(['shadow-dagger', 'throwing-knives']);
    expect(shadow.knives).toBe(12);
    expect(shadow.knownSpells).toEqual(['smoke-bomb', 'poison-blades', 'shadowstep']);
    const duel = hero({ classId: 'rogue', subclassId: 'duelist' });
    expect(duel.weapons[0].id).toBe('duelist-saber');
    expect(duel.knownSpells).toContain('parry');
  });

  it('carry nothing they cannot use: no elven bow for a monk elf, no second dagger for a rogue assassin', () => {
    expect(hero({ raceId: 'elf' }).weapons.some((w) => WEAPONS[w.id].kind === 'bow')).toBe(false);
    expect(hero({ classId: 'rogue', subclassId: 'duelist', raceId: 'elf' }).weapons.some((w) => w.id === 'elven-bow')).toBe(true);
    expect(hero({ classId: 'rogue', subclassId: 'shadow', roleId: 'assassin' }).weapons.filter((w) => w.id === 'shadow-dagger')).toHaveLength(1);
  });

  it('are balanced around the older three: tough warriors, deep sorcerers, fast monks', () => {
    const s = Object.fromEntries((['warrior', 'ranger', 'mage', 'monk', 'sorcerer', 'rogue'] as ClassId[]).map((id) => [id, classStats(id)]));
    expect(s.warrior.hp).toBeGreaterThan(s.monk.hp);
    expect(s.monk.hp).toBeGreaterThan(s.rogue.hp);
    expect(s.rogue.hp).toBeGreaterThan(s.mage.hp);
    expect(s.mage.hp).toBeGreaterThan(s.sorcerer.hp);
    expect(s.sorcerer.mana).toBeGreaterThan(s.mage.mana);
    expect(s.monk.speed).toBeGreaterThan(s.rogue.speed);
    expect(s.rogue.speed).toBeGreaterThan(s.warrior.speed);
    expect(s.monk.stamina).toBeGreaterThan(s.warrior.stamina);
  });

  it('keep to their own weapons, but a legendary chooses for itself', () => {
    const monk = hero();
    expect(canWield(monk, 'linen-wraps').ok).toBe(true);
    expect(canWield(monk, 'ironwood-staff').ok).toBe(true);
    expect(canWield(monk, 'iron-sword').ok).toBe(false);
    expect(canWield(monk, 'iron-sword').reason).toMatch(/Monk/);
    expect(canWield(hero({ classId: 'warrior', subclassId: 'swordsman' }), 'linen-wraps').ok).toBe(false);
    // Anyone may take up a quarterstaff (the older classes wield anything).
    expect(canWield(hero({ classId: 'warrior', subclassId: 'swordsman' }), 'ash-quarterstaff').ok).toBe(true);
    expect(canWield(hero({ roleId: 'blacksmith' }), 'hammer-of-hephaestus').ok).toBe(true);
    const sorc = hero({ classId: 'sorcerer', subclassId: 'darkmage' });
    expect(canWield(sorc, 'rune-circle').ok).toBe(true);
    expect(canWield(sorc, 'willow-wand').ok).toBe(true);
    expect(canWield(hero({ classId: 'ranger', subclassId: null }), 'willow-wand').ok).toBe(false);
    expect(canWield(sorc, 'iron-axe').ok).toBe(false);
    const rogue = hero({ classId: 'rogue', subclassId: 'shadow' });
    expect(canWield(rogue, 'hunting-bow').ok).toBe(true);
    expect(canWield(rogue, 'iron-greatsword').ok).toBe(false);
    expect(classWields('rogue', 'lyre')).toBe(true);
  });

  it("learn only their own path's spells", () => {
    const dark = hero({ classId: 'sorcerer', subclassId: 'darkmage' });
    const light = hero({ classId: 'sorcerer', subclassId: 'lightmage' });
    expect(canLearnSpell(dark, 'hex')).toBe(true);
    expect(canLearnSpell(light, 'hex')).toBe(false);
    expect(canLearnSpell(light, 'holy-smite')).toBe(true);
    expect(canLearnSpell(dark, 'holy-smite')).toBe(false);
    expect(canLearnSpell(dark, 'blade-of-retribution')).toBe(true);
    expect(canLearnSpell(dark, 'stone-skin')).toBe(false);
    // A mage learns any tome, but not another class's arts.
    const mage = hero({ classId: 'mage', subclassId: null });
    expect(canLearnSpell(mage, 'moonveil')).toBe(true);
    expect(canLearnSpell(mage, 'radiant-beam')).toBe(false);
    expect(canLearnSpell(mage, 'meditate')).toBe(false);
    expect(canLearnSpell(hero(), 'meditate')).toBe(true);
    expect(canLearnSpell(hero(), 'smoke-bomb')).toBe(false);
    expect(canLearnSpell(hero({ classId: 'rogue', subclassId: 'duelist' }), 'smoke-bomb')).toBe(true);
    // An elf keeps their imp magic whatever the class.
    expect(canLearnSpell(hero({ raceId: 'elf' }), 'imp-familiar')).toBe(true);
  });

  it('learn from a class tree and a subclass tree, each opening its own tiers', () => {
    const c = hero({}, 12);
    expect(treesFor(c)).toEqual(['monk', 'ironfist']);
    expect(treesFor(hero({ classId: 'warrior', subclassId: 'axeman' }))).toEqual(['axeman']);
    expect(treeOf(c, 'stone-fists')).toBe('ironfist');
    expect(treeOf(c, 'open-palm')).toBe('monk');
    expect(learnSkill(c, 'stone-fists')).toBe(true);
    expect(learnSkill(c, 'stone-fists')).toBe(true);
    // Two points in the subclass tree open its second tier, not the class tree's.
    expect(pointsSpent(c, 'ironfist')).toBe(2);
    expect(lockReason(c, TREES.monk.nodes.find((n) => n.id === 'swift-strikes')!, 'monk')).toMatch(/Spend 2 more/);
    expect(learnSkill(c, 'quaking-palm')).toBe(true);
    // Node ids never clash between a class tree and its subclass trees.
    for (const [cls, sub] of NEW) {
      const a = TREES[cls as 'monk'].nodes.map((n) => n.id);
      expect(TREES[sub as 'ironfist'].nodes.filter((n) => a.includes(n.id))).toEqual([]);
    }
  });

  it('give health from the trees, and a monk a flip in the air', () => {
    const c = hero();
    const base = maxHp(c);
    c.skills['tempered-body'] = 2;
    c.skills['iron-will'] = 1;
    expect(maxHp(c)).toBe(base + 28 + 20);
    expect(airFlaps(c)).toBe(1);
    c.skills['feather-fall'] = 1;
    expect(airFlaps(c)).toBe(2);
    expect(airFlaps(hero({ classId: 'rogue', subclassId: 'shadow' }))).toBe(0);
  });
});

describe('monk rules', () => {
  it('dashes and backflips; a rogue rolls quick and cheap', () => {
    const monk = hero();
    expect(rollSpec(monk, false).kind).toBe(1);
    expect(rollSpec(monk, true).kind).toBe(2);
    monk.skills['gale-step'] = 2;
    expect(rollSpec(monk, false).dist).toBeCloseTo(5.2 * 1.4);
    const rogue = hero({ classId: 'rogue', subclassId: 'shadow' });
    const warrior = hero({ classId: 'warrior', subclassId: 'swordsman' });
    expect(rollSpec(rogue, false).cost).toBeLessThan(rollSpec(warrior, false).cost);
    expect(rollSpec(rogue, false).iTo - rollSpec(rogue, false).iFrom).toBeGreaterThan(rollSpec(warrior, false).iTo - rollSpec(warrior, false).iFrom);
  });

  it('flurries harder as an Iron Fist and with its talents; a palm strike doubles on a stunned foe with Shattering Blow', () => {
    const iron = hero();
    const wind = hero({ subclassId: 'windwalker' });
    expect(flurryPower(iron)).toBeGreaterThan(flurryPower(wind));
    iron.skills['hundred-fists'] = 1;
    expect(flurryBlows(iron)).toBe(2);
    const p = palmPower(iron, true);
    iron.skills['shattering-blow'] = 1;
    expect(palmPower(iron, true)).toBeCloseTo(p * 2);
    expect(palmPower(iron, false)).toBeCloseTo(p);
  });

  it('strikes faster with Swift Strikes and hits harder with Open Palm (fists and staves only)', () => {
    const c = hero();
    c.skills['swift-strikes'] = 2;
    expect(lightAttackSpeed(c)).toBeCloseTo(0.84);
    const before = outgoingDamage(c, hit()).amount;
    c.skills['open-palm'] = 3;
    expect(outgoingDamage(c, hit()).amount).toBe(Math.round(before * 1.3));
  });

  it('dodges give back stamina and chi with Eye of the Storm', () => {
    const c = hero({ subclassId: 'windwalker' });
    expect(dodgeReward(c)).toEqual({ stamina: 0, mana: 0 });
    c.skills['eye-of-the-storm'] = 2;
    expect(dodgeReward(c)).toEqual({ stamina: 20, mana: 6 });
  });

  it('Iron Skin and the monk talents cut the damage taken', () => {
    const c = hero();
    const base = incomingDamage(c, 100, 'physical', { blocking: false, stoneSkin: false, invulnerable: false });
    expect(incomingDamage(c, 100, 'physical', { blocking: false, stoneSkin: false, invulnerable: false, ironSkin: true })).toBe(Math.round(base * 0.6));
    c.skills['iron-guard'] = 2;
    expect(incomingDamage(c, 100, 'physical', { blocking: true, stoneSkin: false, invulnerable: false })).toBe(10);
  });
});

describe('sorcerer rules', () => {
  it('hits 20% harder with raw power, and more down its own path', () => {
    const dark = hero({ classId: 'sorcerer', subclassId: 'darkmage' });
    const mage = hero({ classId: 'mage', subclassId: null });
    // Both hold a wand for a fair comparison (it adds its own 15%).
    mage.weapons = [{ id: 'willow-wand', level: 1 }];
    expect(spellPowerMultiplier(dark, 'fire')).toBeCloseTo(spellPowerMultiplier(mage, 'fire') * 1.2);
    const wand = spellPowerMultiplier(mage, 'fire');
    dark.skills['umbral-power'] = 2;
    expect(spellPowerMultiplier(dark, 'dark')).toBeCloseTo(wand * 1.2 * 1.2);
    expect(spellPowerMultiplier(dark, 'light')).toBeCloseTo(wand * 1.2);
  });

  it('pays for a beam by the tick, less with Channeler', () => {
    const c = hero({ classId: 'sorcerer', subclassId: 'lightmage' });
    expect(spellCost(c, 'radiant-beam')).toBe(SPELLS['radiant-beam'].mana);
    c.skills.channeler = 2;
    expect(spellCost(c, 'radiant-beam')).toBeCloseTo(2.1);
    c.skills.saint = 1;
    expect(spellCost(c, 'mending-light')).toBe(Math.round(SPELLS['mending-light'].mana * 0.8));
  });

  it('hexes longer with Hexer', () => {
    const c = hero({ classId: 'sorcerer', subclassId: 'darkmage' });
    expect(hexSeconds(c)).toBe(12);
    c.skills.hexer = 1;
    expect(hexSeconds(c)).toBe(17);
  });
});

describe('rogue rules', () => {
  const rogue = (o: Partial<CharacterChoice> = {}) => hero({ classId: 'rogue', subclassId: 'shadow', ...o });

  it('backstabs: +50% from behind, triple from stealth, four times for an assassin', () => {
    const c = rogue();
    expect(backstabMultiplier(c, false, false)).toBe(1);
    expect(backstabMultiplier(c, false, true)).toBe(1.5);
    expect(backstabMultiplier(c, true, false)).toBe(3);
    expect(backstabMultiplier(rogue({ roleId: 'assassin' }), true, true)).toBe(4);
    c.skills.lethality = 2;
    expect(backstabMultiplier(c, true, false)).toBeCloseTo(1 + 2 * 1.4);
  });

  it('puts it all together for a dagger in the back out of Vanish', () => {
    const c = rogue();
    const blade = 10 * rogueBladePower(c, 'shadow-dagger');
    expect(outgoingDamage(c, hit()).amount).toBe(Math.round(blade));
    const behind = outgoingDamage(c, hit({ fromBehind: true }));
    expect(behind.tags).toContain('backstab');
    expect(behind.amount).toBe(Math.round(blade * 1.5));
    const ambush = outgoingDamage(c, hit({ undetected: true, ambush: true }));
    expect(ambush.tags).toEqual(['backstab', 'ambush']);
    expect(ambush.amount).toBe(Math.round(10 * rogueBladePower(c, 'shadow-dagger') * 3 * ambushPower(c)));
    // A Shadow ambushes harder than a Duelist.
    expect(ambushPower(c)).toBeGreaterThan(ambushPower(rogue({ subclassId: 'duelist' })));
  });

  it('hides better, especially crouched', () => {
    const c = rogue();
    expect(rogueStealth(c, false)).toBeCloseTo(0.85);
    expect(rogueStealth(c, true)).toBeLessThan(rogueStealth(c, false));
    expect(rogueStealth(hero(), true)).toBe(1);
  });

  it('vanishes longer as a Shadow, and sooner with Escape Artist', () => {
    const c = rogue();
    expect(vanishSeconds(c)).toBe(8);
    expect(vanishSeconds(rogue({ subclassId: 'duelist' }))).toBe(6);
    c.skills['escape-artist'] = 1;
    expect(vanishCooldown(c)).toBeCloseTo(22.5);
  });

  it('poisons harder with level and Venomous', () => {
    const c = rogue();
    const d = toxinDps(c);
    c.level = 11;
    expect(toxinDps(c)).toBeCloseTo(d + 3.5);
    c.skills.venomous = 2;
    expect(toxinDps(c)).toBeCloseTo((d + 3.5) * 1.5);
  });

  it('hits harder on stunned, poisoned or bleeding foes with Cheap Shot and Coup de Grâce', () => {
    const c = rogue({ subclassId: 'duelist' });
    c.skills['cheap-shot'] = 2;
    const base = outgoingDamage(c, hit()).amount;
    expect(outgoingDamage(c, hit({ targetPoisoned: true })).amount).toBe(Math.round(base * 1.3));
    c.skills['coup-de-grace'] = 1;
    expect(outgoingDamage(c, hit({ targetBleeding: true, targetStunned: true })).amount).toBe(Math.round(base * 1.3 * 1.15));
  });
});
