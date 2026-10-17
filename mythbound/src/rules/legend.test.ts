import { describe, expect, it } from 'vitest';
import { LEGEND_SHARD, SPELLS, type PerkId } from '../data/defs';
import { BOSS_TIERS, tierFor, tierLevel, tierOpen, tierReward } from './boss';
import { artsDue, canLearnSpell, createCharacter, learnSpell, maxHp, normalizeCharacter, type CharacterChoice } from './character';
import { canCast, incomingDamage, outgoingDamage, spellCost, type HitContext } from './combat';
import { hasPerk, normalizePerks, perkCost, perkProblem, perkSlots, setPerk, takesPerks } from './legend';

const choice = (over: Partial<CharacterChoice> = {}): CharacterChoice => ({
  name: 'Tester', classId: 'warrior', subclassId: 'swordsman', raceId: 'human', roleId: 'historian', expansion: false, ...over,
});
const hit = (over: Partial<HitContext> = {}): HitContext => ({ base: 100, kind: 'melee', element: 'physical', targetDark: false, undetected: false, fromBehind: false, ...over });

describe('legend perks', () => {
  it('only legendary weapons and the unique drops take them, with slots opening at 5 and 10', () => {
    expect(takesPerks('sword-of-mars')).toBe(true);
    expect(takesPerks('reapers-edge')).toBe(true);
    expect(takesPerks('venomfang')).toBe(true);
    expect(takesPerks('iron-sword')).toBe(false);
    expect(perkSlots({ id: 'iron-sword', level: 10 })).toBe(0);
    expect(perkSlots({ id: 'sword-of-mars', level: 1 })).toBe(1);
    expect(perkSlots({ id: 'sword-of-mars', level: 5 })).toBe(2);
    expect(perkSlots({ id: 'sword-of-mars', level: 12 })).toBe(3);
  });

  it('costs Legend Shards, fills slots in order, and never doubles a perk', () => {
    const c = createCharacter(choice());
    c.weapons = [{ id: 'iron-sword', level: 1 }, { id: 'reapers-edge', level: 5 }];
    expect(perkProblem(c, 0, 0, 'vampiric')).toMatch(/legendary/);
    expect(perkProblem(c, 1, 0, 'vampiric')).toMatch(/Shards/);
    c.items[LEGEND_SHARD] = 10;
    expect(setPerk(c, 1, 0, 'vampiric')).toBe(true);
    expect(c.items[LEGEND_SHARD]).toBe(10 - perkCost(0));
    expect(perkProblem(c, 1, 1, 'vampiric')).toMatch(/already/);
    expect(perkProblem(c, 1, 2, 'ruthless')).toMatch(/level 10/);
    expect(setPerk(c, 1, 1, 'ruthless')).toBe(true);
    expect(c.weapons[1].perks).toEqual(['vampiric', 'ruthless']);
    // Replacing a perk costs the slot's price again.
    c.items[LEGEND_SHARD] = perkCost(0);
    expect(setPerk(c, 1, 0, 'executioner')).toBe(true);
    expect(c.weapons[1].perks).toEqual(['executioner', 'ruthless']);
    expect(c.items[LEGEND_SHARD]).toBe(0);
    c.mainHand = 1;
    expect(hasPerk(c, 'executioner')).toBe(true);
    c.mainHand = 0;
    expect(hasPerk(c, 'executioner')).toBe(false);
  });

  it('cleans up perks an old or edited save carries', () => {
    const w = { id: 'sword-of-mars', level: 1, perks: ['vampiric', 'vampiric', 'nonsense', 'ruthless'] as PerkId[] };
    normalizePerks(w);
    expect(w.perks).toEqual(['vampiric']);
    const plain = { id: 'iron-sword', level: 9, perks: ['vampiric'] as PerkId[] };
    normalizePerks(plain);
    expect(plain.perks).toBeUndefined();
  });

  it('changes damage dealt and taken', () => {
    const c = createCharacter(choice());
    c.weapons = [{ id: 'sword-of-mars', level: 10, perks: ['executioner', 'giant-slayer', 'bulwark'] }];
    c.mainHand = 0;
    const base = outgoingDamage(c, hit({ targetHp: 0.9 })).amount;
    expect(outgoingDamage(c, hit({ targetHp: 0.2 })).amount).toBe(Math.round(base * 1.4));
    expect(outgoingDamage(c, hit({ targetHp: 0.9, targetBoss: true })).amount).toBe(Math.round(base * 1.25));
    expect(incomingDamage(c, 100, 'physical', { blocking: false, stoneSkin: false, invulnerable: false })).toBe(88);
    c.weapons[0].perks = ['ruthless'];
    expect(outgoingDamage(c, hit({ roll: 0.05 })).tags).toContain('crit');
    expect(outgoingDamage(c, hit({ roll: 0.5 })).tags).not.toContain('crit');
    c.weapons[0].perks = ['colossus'];
    const big = maxHp(c);
    c.weapons[0].perks = [];
    expect(big).toBe(Math.round(maxHp(c) * 1.15));
  });

  it("makes Reaper's Edge reap the badly hurt", () => {
    const c = createCharacter(choice());
    c.weapons = [{ id: 'reapers-edge', level: 1 }];
    c.mainHand = 0;
    const healthy = outgoingDamage(c, hit({ targetHp: 0.8 })).amount;
    expect(outgoingDamage(c, hit({ targetHp: 0.3 })).amount).toBe(Math.round(healthy * 1.3));
  });
});

describe('boss difficulty', () => {
  it('opens one tier past the hardest beaten', () => {
    expect(tierOpen(-1)).toBe(0);
    expect(tierOpen(0)).toBe(1);
    expect(tierOpen(2)).toBe(3);
    expect(tierOpen(3)).toBe(3);
    expect(tierFor(3, 0)).toBe(1);
    expect(tierFor(1, 2)).toBe(1);
    expect(tierFor(2, -1)).toBe(0);
  });

  it('grows harder and pays more each tier, shards doubled the first time', () => {
    for (let i = 1; i < BOSS_TIERS.length; i++) {
      const a = BOSS_TIERS[i - 1], b = BOSS_TIERS[i];
      expect(b.hp).toBeGreaterThan(a.hp);
      expect(b.damage).toBeGreaterThan(a.damage);
      expect(b.xp).toBeGreaterThan(a.xp);
      expect(b.shards).toBeGreaterThan(a.shards);
    }
    expect(tierReward(0, true, { xp: 400, gold: 200 })).toEqual({ xp: 400, gold: 200, shards: 0 });
    expect(tierReward(2, false, { xp: 400, gold: 200 })).toEqual({ xp: 1400, gold: 600, shards: 4 });
    expect(tierReward(2, true, { xp: 400, gold: 200 }).shards).toBe(8);
    expect(tierLevel(4, 3)).toBe(30);
  });
});

describe('warrior and ranger arts', () => {
  it('belong to their class alone, paid in stamina', () => {
    const warrior = createCharacter(choice());
    const ranger = createCharacter(choice({ classId: 'ranger', subclassId: null }));
    const mage = createCharacter(choice({ classId: 'mage', subclassId: null }));
    expect(warrior.knownSpells).toEqual(expect.arrayContaining(['shield-charge', 'ground-slam']));
    expect(ranger.knownSpells).toEqual(expect.arrayContaining(['arrow-rain', 'mark-prey']));
    expect(canLearnSpell(warrior, 'arrow-rain')).toBe(false);
    expect(canLearnSpell(ranger, 'shield-charge')).toBe(false);
    expect(canLearnSpell(mage, 'shield-charge')).toBe(false);
    expect(canLearnSpell(mage, 'snare-trap')).toBe(false);
    expect(spellCost(warrior, 'shield-charge')).toBe(SPELLS['shield-charge'].stamina);
    const ctx = { gameMinutes: 0, mana: 0, inDesert: false, soulOrPower: false };
    expect(canCast(warrior, 'shield-charge', { ...ctx, stamina: 100 }).ok).toBe(true);
    expect(canCast(warrior, 'shield-charge', { ...ctx, stamina: 5 }).reason).toBe('Not enough stamina.');
  });

  it('come with levels, and older heroes learn them on loading', () => {
    const c = createCharacter(choice());
    expect(artsDue(c)).toEqual([]);
    c.level = 12;
    expect(artsDue(c)).toEqual(['battle-shout', 'unbreakable']);
    for (const s of artsDue(c)) learnSpell(c, s);
    expect(artsDue(c)).toEqual([]);
    const old = createCharacter(choice({ classId: 'ranger', subclassId: null }));
    old.level = 7;
    old.knownSpells = ['wrath-of-thor'];
    normalizeCharacter(old);
    expect(old.knownSpells).toEqual(['wrath-of-thor', 'arrow-rain', 'mark-prey', 'snare-trap']);
  });
});
