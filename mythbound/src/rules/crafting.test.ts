import { describe, expect, it } from 'vitest';
import { MATERIALS, MEALS, RECIPES, SUPPLIES } from '../data/goods';
import { ENEMIES, ITEMS } from '../data/world';
import { RUNES, runeItem } from '../data/defs';
import { createCharacter, type CharacterChoice } from './character';
import { CROPS, SEED_PACK } from '../data/goods';
import { batches, craft, fishingPerks, hasTool, lacking, materialDrop, recipe, recipeGold, recipesAt, sellAll, sellValue } from './crafting';

const hero = (over: Partial<CharacterChoice> = {}) =>
  createCharacter({ name: 'T', classId: 'warrior', subclassId: 'swordsman', raceId: 'human', roleId: 'historian', expansion: false, ...over }, () => 0.5);

/** What an item is worth in embers, for checking that crafting never makes money from nothing. */
function worth(id: string): number {
  if (MATERIALS[id]) return MATERIALS[id].sell;
  const crop = Object.values(CROPS).find((c) => c.id === id);
  if (crop) return Math.max(crop.sell, crop.seedPrice / SEED_PACK);
  return { fish: 12, 'golden-fish': 70, 'ember-ore': 40 }[id] ?? 0;
}

describe('recipes', () => {
  it('only uses and makes things that exist', () => {
    for (const r of RECIPES) {
      for (const id of Object.keys(r.needs)) expect(ITEMS[id], `${r.id} needs ${id}`).toBeTruthy();
      if (r.makes.kind === 'item') expect(ITEMS[r.makes.id], `${r.id} makes ${r.makes.id}`).toBeTruthy();
    }
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    // New goods don't collide with existing items.
    for (const id of [...Object.keys(MATERIALS), ...Object.keys(MEALS), ...Object.keys(SUPPLIES)]) expect(['fish', 'golden-fish', 'ember-ore', 'free-upgrade']).not.toContain(id);
  });

  it('keeps each station to a few recipes per group (big touch buttons fit)', () => {
    for (const station of ['cookfire', 'bench', 'anvil'] as const) {
      const groups = new Map<string, number>();
      for (const r of recipesAt(station)) groups.set(r.group, (groups.get(r.group) ?? 0) + 1);
      expect(groups.size).toBeGreaterThan(0);
      for (const n of groups.values()) expect(n).toBeLessThanOrEqual(7);
    }
    // Camp cooking is a part of the cookfire's menu.
    const camp = recipesAt('cookfire', true);
    expect(camp.length).toBeGreaterThan(0);
    for (const r of camp) expect(recipesAt('cookfire')).toContain(r);
    expect(recipesAt('bench', true)).toHaveLength(0);
  });

  it('cooks meals that heal more than their raw food', () => {
    expect(MEALS['grilled-fish'].heal).toBeGreaterThan(ITEMS.fish.heal!);
    const stew = recipe('root-stew')!;
    const raw = Object.entries(stew.needs).reduce((s, [id, n]) => s + (ITEMS[id].heal ?? 0) * n, 0);
    expect(MEALS['root-stew'].heal! * (stew.makes.kind === 'item' ? stew.makes.n : 0)).toBeGreaterThan(raw);
  });

  it('never turns its inputs into more embers than they were worth', () => {
    for (const r of RECIPES) {
      if (r.makes.kind !== 'item') continue;
      const out = worth(r.makes.id) * r.makes.n;
      const cost = Object.entries(r.needs).reduce((s, [id, n]) => s + worth(id) * n, 0) + (r.gold ?? 0);
      expect(out, r.id).toBeLessThanOrEqual(cost);
    }
  });

  it('forges runes for less than Brann asks', () => {
    for (const r of RECIPES.filter((x) => x.group === 'Runes')) {
      const id = (r.makes as { id: string }).id;
      const rune = Object.values(RUNES).find((x) => runeItem(x.id) === id)!;
      const cost = Object.entries(r.needs).reduce((s, [k, n]) => s + worth(k) * n, 0) + (r.gold ?? 0);
      expect(cost).toBeLessThan(rune.price);
    }
  });
});

describe('making things', () => {
  it('makes as many batches as the pack allows, all or nothing per batch', () => {
    const c = hero();
    const bread = recipe('hearth-bread')!;
    expect(batches(c, bread)).toBe(0);
    expect(lacking(c, bread)).toEqual([{ id: 'wheat', have: 0, need: 3 }]);
    c.items.wheat = 7;
    expect(batches(c, bread)).toBe(2);
    expect(craft(c, bread, 5)).toBe(2);
    expect(c.items.wheat).toBe(1);
    expect(c.items['hearth-bread']).toBe(4);
    expect(craft(c, bread, 1)).toBe(0);
    expect(c.items['hearth-bread']).toBe(4);
  });

  it('fletches into the quiver, using wood arrows for steel', () => {
    const c = hero();
    c.items.bone = 4;
    expect(craft(c, recipe('bone-arrows')!, 9)).toBe(2);
    expect(c.arrows.wood).toBe(40);
    c.items['ember-ore'] = 1;
    expect(craft(c, recipe('steel-arrows')!, 1)).toBe(1);
    expect(c.arrows).toEqual({ wood: 20, steel: 20 });
    expect(c.items['ember-ore']).toBe(0);
    const empty = hero();
    empty.items['ember-ore'] = 3;
    expect(lacking(empty, recipe('steel-arrows')!)).toEqual([{ id: 'arrows', have: 0, need: 20 }]);
  });

  it('makes a tool once', () => {
    const c = hero();
    c.items['ember-ore'] = 5;
    c.items.hide = 9;
    const can = recipe('watering-can')!;
    expect(batches(c, can)).toBe(1);
    expect(craft(c, can, 3)).toBe(1);
    expect(hasTool(c, 'watering-can')).toBe(true);
    expect(batches(c, can)).toBe(0);
    expect(craft(c, can, 1)).toBe(0);
    expect(c.items.hide).toBe(7);
  });

  it('charges embers at the anvil, half for a blacksmith', () => {
    const c = hero();
    const rune = recipe('forge-rune-fire')!;
    c.items['ember-ore'] = 4;
    c.items.cinder = 6;
    c.gold = 40;
    expect(recipeGold(c, rune)).toBe(30);
    expect(batches(c, rune)).toBe(1);
    expect(craft(c, rune, 2)).toBe(1);
    expect(c.gold).toBe(10);
    expect(c.items['rune-fire']).toBe(1);
    const smith = hero({ roleId: 'blacksmith' });
    expect(recipeGold(smith, rune)).toBe(15);
    expect(recipeGold(smith, recipe('hearth-bread')!)).toBe(0);
  });
});

describe('materials and fishing', () => {
  it('drops materials from the right foes', () => {
    expect(materialDrop('wolf', 0)).toBe('hide');
    expect(materialDrop('wolf', 0.99)).toBe(null);
    expect(materialDrop('bandit', 0)).toBe(null);
    expect(materialDrop('nobody', 0)).toBe(null);
    for (const id of ['wolf', 'boar', 'spiderling', 'scorpion', 'drowned', 'skeleton', 'wraith', 'fire-imp', 'magma-hound']) expect(Object.hasOwn(ENEMIES, id)).toBe(true);
  });

  it('sells materials to Quill, nothing else', () => {
    const c = hero();
    c.items.wisp = 3;
    c.items['grilled-fish'] = 2;
    expect(sellValue('grilled-fish')).toBe(0);
    expect(sellAll(c, 'grilled-fish')).toBe(0);
    expect(sellAll(c, 'wisp')).toBe(3 * MATERIALS.wisp.sell);
    expect(c.items.wisp).toBe(0);
    expect(c.items['grilled-fish']).toBe(2);
  });

  it('widens the catch for sailors, a silk line and a lure', () => {
    const c = hero();
    expect(fishingPerks(c, false)).toEqual({ zone: 22, golden: 3 });
    c.items['fishing-line'] = 1;
    expect(fishingPerks(c, true)).toEqual({ zone: 36, golden: 5 });
    expect(fishingPerks(hero({ roleId: 'sailor' }), false).zone).toBe(34);
  });
});
