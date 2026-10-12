import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../data/world';
import { TIER_COST, TIER_POINTS, TREES, type TreeId } from '../data/defs';
import {
  addXp,
  createCharacter,
  killRestore,
  killXp,
  levelRewards,
  maxHp,
  maxMana,
  maxStamina,
  MAX_LEVEL,
  MILESTONES,
  moveSpeed,
  normalizeCharacter,
  pointsEarned,
  staminaRegen,
  xpToNext,
  type Character,
  type CharacterChoice,
} from './character';
import { incomingDamage, outgoingDamage, powerShot, spellCost, type HitContext } from './combat';
import { learnSkill, lockReason, nodeView, pointsSpent, rankText, respec, respecCost } from './skills';

const choice = (over: Partial<CharacterChoice> = {}): CharacterChoice => ({
  name: 'Tester',
  classId: 'warrior',
  subclassId: 'swordsman',
  raceId: 'human',
  roleId: 'knight',
  expansion: false,
  ...over,
});
const hero = (over: Partial<CharacterChoice> = {}, level = 1): Character => {
  const c = createCharacter(choice(over), () => 0.5);
  c.level = level;
  c.skillPoints = pointsEarned(level);
  return c;
};

describe('experience', () => {
  it('climbs smoothly: every step bigger than the last, never a sudden jump', () => {
    for (let l = 1; l < MAX_LEVEL; l++) {
      expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
      expect(xpToNext(l + 1) / xpToNext(l)).toBeLessThan(1.9);
    }
    // Level 2 takes a handful of wolves; level 10 takes about 18 foes of its level.
    expect(xpToNext(1) / ENEMIES.wolf.xp).toBeLessThan(7);
    expect(xpToNext(10) / ENEMIES['eye-watcher'].xp).toBeGreaterThan(12);
    expect(xpToNext(10) / ENEMIES['eye-watcher'].xp).toBeLessThan(25);
  });

  it('raises the level cap to 30 and pays a bonus point every 5 levels', () => {
    expect(MAX_LEVEL).toBe(30);
    const c = createCharacter(choice());
    const levels: number[] = [];
    while (c.level < MAX_LEVEL) {
      addXp(c, xpToNext(c.level));
      levels.push(c.level);
      expect(c.skillPoints).toBe(pointsEarned(c.level));
    }
    expect(c.level).toBe(30);
    expect(c.milestone).toBe(30);
    addXp(c, 1e6);
    expect(c.level).toBe(30);
    expect(c.xp).toBe(0);
    expect(pointsEarned(30)).toBe(36);
  });

  it('weighs kills against the hero level, but bosses always give it all', () => {
    expect(killXp(100, 5, 5)).toBe(100);
    expect(killXp(100, 4, 6)).toBe(100); // two levels of grace
    expect(killXp(100, 1, 6)).toBeLessThan(100);
    expect(killXp(100, 1, 20)).toBe(40);
    expect(killXp(100, 9, 5)).toBe(132);
    expect(killXp(100, 20, 1)).toBe(140);
    expect(killXp(400, 4, 20, true)).toBe(400);
  });

  it('spells out what a level-up gave, milestones included', () => {
    const c = hero({}, 4);
    c.xp = 0;
    addXp(c, xpToNext(4));
    const r = levelRewards(c, 4);
    expect(r.hp).toBe(12);
    expect(r.mana).toBe(2);
    expect(r.stamina).toBe(2);
    expect(r.points).toBe(2);
    expect(r.milestones.map((m) => m.name)).toEqual(['Second Wind']);
  });

  it('applies the milestone perks', () => {
    const c = hero({}, 9);
    const hp9 = maxHp(c), regen = staminaRegen(c), speed = moveSpeed(c);
    c.level = 10;
    expect(maxHp(c)).toBe(Math.round((hp9 + 12) * 1.1));
    expect(staminaRegen(c)).toBe(regen);
    c.level = 20;
    expect(maxStamina(c)).toBe(Math.round((100 + 10 + 38) * 1.15));
    c.level = 25;
    expect(moveSpeed(c)).toBeCloseTo(speed * 1.06);
    expect(MILESTONES.map((m) => m.level)).toEqual([5, 10, 15, 20, 25, 30]);
  });

  it('pays old saves their milestone points once', () => {
    const c = hero({}, 12) as Partial<Character> & Character;
    c.skillPoints = 3;
    delete (c as Partial<Character>).milestone;
    delete (c as Partial<Character>).respecs;
    normalizeCharacter(c);
    expect(c.skillPoints).toBe(5);
    expect(c.milestone).toBe(10);
    expect(c.respecs).toBe(0);
    normalizeCharacter(c);
    expect(c.skillPoints).toBe(5);
  });
});

describe('kill regen', () => {
  it('restores a little from small foes, more from big and strong ones, much more from bosses', () => {
    const c = hero({}, 5);
    const wolf = killRestore(c, { level: 1, scale: 1, boss: false });
    const drake = killRestore(c, { level: 13, scale: 1.4, boss: false });
    const boss = killRestore(c, { level: 4, scale: 2.6, boss: true });
    const minion = killRestore(c, { level: 1, scale: 1, boss: false, minion: true });
    expect(wolf.hp).toBeGreaterThan(0);
    expect(wolf.hp).toBeLessThan(maxHp(c) * 0.06);
    expect(wolf.mana).toBeGreaterThan(0);
    expect(wolf.stamina).toBeGreaterThan(0);
    expect(drake.hp).toBeGreaterThan(wolf.hp * 2);
    expect(boss.hp).toBeGreaterThan(drake.hp * 3);
    expect(boss.mana).toBeGreaterThan(maxMana(c) * 0.4);
    expect(minion.hp).toBeLessThan(wolf.hp);
  });

  it('restores more with a kill regen skill and the Reaper perk', () => {
    const c = hero({}, 5);
    const base = killRestore(c, { level: 3, scale: 1, boss: false }).hp;
    c.skills.bloodlust = 2;
    expect(killRestore(c, { level: 3, scale: 1, boss: false }).hp).toBeCloseTo(base * 2);
    const m = hero({ classId: 'mage', subclassId: null }, 14);
    const before = killRestore(m, { level: 3, scale: 1, boss: false }).mana;
    m.level = 15;
    expect(killRestore(m, { level: 3, scale: 1, boss: false }).mana).toBeGreaterThan(before * 1.45);
  });
});

describe('skill trees', () => {
  const OLD: Partial<Record<TreeId, string[]>> = {
    swordsman: ['keen-edge', 'wide-flourish', 'riposte', 'lunge', 'blade-dancer'],
    axeman: ['heavy-hand', 'rend', 'cleave', 'throwing-axe', 'earthsplitter'],
    bowman: ['steady-aim', 'shadow-step', 'piercing-shot', 'reclaim', 'deadeye'],
    ranger: ['fletcher', 'fleet-foot', 'volley', 'storm-caller', 'hunters-mark'],
    trainer: ['pack-bond', 'feral-bite', 'whistle', 'second-beast', 'fletcher'],
    mage: ['deep-well', 'focus', 'flow', 'quickening', 'harmony'],
    elemental: ['attunement', 'deep-well', 'flow', 'elemental-ward', 'harmony'],
  };
  const REGEN = ['bloodlust', 'hunters-feast', 'soul-harvest', 'inner-peace', 'cutpurse'];
  /** The newer classes' subclass trees sit beside a class tree, so they are smaller and the class tree holds the kill-regen node. */
  const SUBTREE: TreeId[] = ['ironfist', 'windwalker', 'darkmage', 'lightmage', 'shadow', 'duelist'];

  for (const [id, tree] of Object.entries(TREES) as [TreeId, (typeof TREES)[TreeId]][]) {
    it(`${id}: keeps every saved skill, draws a sound tree and fits the points a hero earns`, () => {
      const ids = tree.nodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const old of OLD[id] ?? []) expect(ids).toContain(old);
      const sub = SUBTREE.includes(id);
      if (!sub) expect(ids.some((n) => REGEN.includes(n))).toBe(true);
      const cells = new Set(tree.nodes.map((n) => `${n.tier},${n.col}`));
      expect(cells.size).toBe(tree.nodes.length);
      let total = 0;
      for (const n of tree.nodes) {
        expect(n.col).toBeGreaterThanOrEqual(0);
        expect(n.col).toBeLessThanOrEqual(2);
        expect(n.tier).toBeGreaterThanOrEqual(1);
        expect(n.tier).toBeLessThan(TIER_POINTS.length);
        for (const r of n.req ?? []) {
          const from = tree.nodes.find((x) => x.id === r);
          expect(from, `${n.id} needs ${r}`).toBeDefined();
          expect(from!.tier).toBeLessThan(n.tier);
        }
        total += n.maxRank * TIER_COST[n.tier];
      }
      // Enough to keep spending into the late 20s, never more than a max-level hero earns.
      expect(total).toBeGreaterThanOrEqual(sub ? 18 : 28);
      expect(total).toBeLessThanOrEqual(pointsEarned(MAX_LEVEL));
    });
  }

  it('opens tiers by points spent, then checks level and prerequisites', () => {
    const c = hero({}, 20);
    const tree = TREES.swordsman;
    const node = (id: string) => tree.nodes.find((n) => n.id === id)!;
    expect(lockReason(c, node('wide-flourish'))).toMatch(/Spend 2 more points/);
    expect(learnSkill(c, 'wide-flourish')).toBe(false);
    expect(learnSkill(c, 'iron-hide')).toBe(true);
    expect(learnSkill(c, 'iron-hide')).toBe(true);
    // Tier 2 is open, but Wide Flourish still needs Keen Edge.
    expect(lockReason(c, node('wide-flourish'))).toMatch(/Keen Edge/);
    expect(learnSkill(c, 'riposte')).toBe(true);
    expect(pointsSpent(c)).toBe(3);
    const low = hero({}, 2);
    low.skills = { 'iron-hide': 2 };
    expect(lockReason(low, node('riposte'))).toBe('Reach level 3');
  });

  it('charges more for deeper tiers and stops at the max rank', () => {
    const c = hero({}, 20);
    for (const id of ['keen-edge', 'keen-edge', 'keen-edge', 'wide-flourish', 'wide-flourish']) expect(learnSkill(c, id)).toBe(true);
    const before = c.skillPoints;
    expect(learnSkill(c, 'lunge')).toBe(true);
    expect(c.skillPoints).toBe(before - 2);
    expect(learnSkill(c, 'lunge')).toBe(false);
    expect(nodeView(c, TREES.swordsman.nodes.find((n) => n.id === 'lunge')!).maxed).toBe(true);
  });

  it('won’t spend points the hero does not have', () => {
    const c = hero({}, 1);
    expect(learnSkill(c, 'keen-edge')).toBe(true);
    expect(c.skillPoints).toBe(0);
    expect(learnSkill(c, 'keen-edge')).toBe(false);
  });

  it('resets for free once, then for embers, handing back every point earned', () => {
    const c = hero({}, 12);
    c.gold = 1000;
    learnSkill(c, 'keen-edge');
    learnSkill(c, 'iron-hide');
    expect(respecCost(c)).toBe(0);
    expect(respec(c)).toBe(true);
    expect(c.skills).toEqual({});
    expect(c.skillPoints).toBe(pointsEarned(12));
    expect(c.gold).toBe(1000);
    expect(respecCost(c)).toBe(300);
    expect(respec(c)).toBe(true);
    expect(c.gold).toBe(700);
    c.gold = 10;
    expect(respec(c)).toBe(false);
  });

  it('describes each rank', () => {
    const keen = TREES.swordsman.nodes[0];
    expect(rankText(keen, 1)).toBe('+10% sword damage.');
    expect(rankText(keen, 3)).toBe('+30% sword damage.');
    const riposte = TREES.swordsman.nodes.find((n) => n.id === 'riposte')!;
    expect(rankText(riposte, 1)).toBe(riposte.description);
  });

  it('wires the new skills into the rules', () => {
    const w = hero({}, 10);
    const hp = maxHp(w);
    w.skills['iron-hide'] = 2;
    expect(maxHp(w)).toBe(Math.round(hp + 30 * 1.1));
    expect(incomingDamage(w, 100, 'physical', { blocking: false, stoneSkin: false, invulnerable: false })).toBe(100);
    w.skills.stalwart = 2;
    expect(incomingDamage(w, 100, 'physical', { blocking: false, stoneSkin: false, invulnerable: false })).toBe(84);
    const m = hero({ classId: 'mage', subclassId: null }, 10);
    const cost = spellCost(m, 'inferno');
    m.skills['spell-thrift'] = 2;
    expect(spellCost(m, 'inferno')).toBe(Math.round(12 * 0.84));
    expect(spellCost(m, 'inferno')).toBeLessThan(cost);
    const b = hero({ subclassId: 'bowman', expansion: true }, 12);
    expect(powerShot(b)!.multiplier).toBe(6);
    b.skills.killshot = 1;
    expect(powerShot(b)!.multiplier).toBe(8);
  });

  it('applies the situational damage skills only when they should', () => {
    const hit = (over: Partial<HitContext>): HitContext => ({ base: 100, kind: 'melee', element: 'physical', targetDark: false, undetected: false, fromBehind: false, ...over });
    const a = hero({ subclassId: 'axeman' }, 12);
    const plain = outgoingDamage(a, hit({ heroHp: 0.2, targetHp: 0.2 })).amount;
    // Last Stand: weapon hits while the hero is low, never spells.
    a.skills['last-stand'] = 1;
    expect(outgoingDamage(a, hit({ heroHp: 0.2 })).amount).toBe(Math.round(plain * 1.25));
    expect(outgoingDamage(a, hit({ heroHp: 0.5 })).amount).toBe(plain);
    const spell = outgoingDamage(a, hit({ kind: 'spell', heroHp: 0.2 })).amount;
    a.skills['last-stand'] = 0;
    expect(outgoingDamage(a, hit({ kind: 'spell', heroHp: 0.2 })).amount).toBe(spell);
    // Executioner: foes below 30% health.
    a.skills.executioner = 2;
    expect(outgoingDamage(a, hit({ targetHp: 0.25 })).amount).toBe(Math.round(plain * 1.3));
    expect(outgoingDamage(a, hit({ targetHp: 0.9 })).amount).toBe(plain);
    // Ambusher: foes that have not noticed the hero.
    const b = hero({ subclassId: 'bowman' }, 12);
    const seen = outgoingDamage(b, hit({ kind: 'bow' })).amount;
    b.skills.ambusher = 2;
    expect(outgoingDamage(b, hit({ kind: 'bow' })).amount).toBe(seen);
    expect(outgoingDamage(b, hit({ kind: 'bow', undetected: true })).amount).toBe(Math.round(seen * 1.3));
  });
});
