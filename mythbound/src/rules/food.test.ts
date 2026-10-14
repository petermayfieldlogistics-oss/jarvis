import { describe, expect, it } from 'vitest';
import { FOOD_IDS, SATCHEL_IDS, buyFruit, dealOfDay, eatItem, fishRoom, foodCount, fruitPrice, isFood, isFruit, marketDay, nellPays, newMarket, normalizeMarket, pickFood, pipFrom, satchelCount, sellFish } from './food';
import { CROPS, FISH_CAP, FRUITS, FRUIT_IDS, NELL, PIP_CHANCE, isPip } from '../data/goods';
import { createCharacter } from './character';

describe('eating', () => {
  it('knows fish and crops as food, not ore or seeds', () => {
    expect(isFood('fish') && isFood('golden-fish') && isFood('carrot') && isFood('pumpkin') && isFood('bluecap')).toBe(true);
    expect(isFood('ember-ore') || isFood('wheat') || isFood('seed-carrot')).toBe(false);
    expect(foodCount({ fish: 2, carrot: 3, 'ember-ore': 9, wheat: 4 })).toBe(5);
    expect(FOOD_IDS.length).toBeGreaterThan(3);
  });

  it('still picks fish as before: the golden one when badly hurt', () => {
    const pack = { fish: 1, 'golden-fish': 1 };
    expect(pickFood(pack, 0.39, 1)).toBe('golden-fish');
    expect(pickFood(pack, 0.41, 1)).toBe('fish');
    expect(pickFood({ 'golden-fish': 1 }, 0.9, 1)).toBe('golden-fish');
  });

  it('eats the smallest heal when lightly hurt, the biggest when badly hurt', () => {
    const pack = { fish: 1, carrot: 1, pumpkin: 1 };
    expect(pickFood(pack, 0.8, 1)).toBe('carrot');
    expect(pickFood(pack, 0.2, 1)).toBe('pumpkin');
  });

  it('eats for mana at full health, and nothing when full', () => {
    expect(pickFood({ bluecap: 1, fish: 1 }, 1, 0.5)).toBe('bluecap');
    expect(pickFood({ bluecap: 1, fish: 1 }, 1, 1)).toBe(null);
    expect(pickFood({ fish: 1 }, 1, 0.2)).toBe(null);
    expect(pickFood({}, 0.1, 0.1)).toBe(null);
    // Hurt with only mana food: eat it anyway for the mana.
    expect(pickFood({ bluecap: 1 }, 0.5, 0.5)).toBe('bluecap');
  });

  it('eats mixed meals for what they are mostly for', () => {
    // Broth is mostly mana: not eaten for a scratch while there is a fish.
    expect(pickFood({ fish: 1, 'bluecap-broth': 1 }, 0.8, 1)).toBe('fish');
    // Soup is mostly health: not eaten for mana while there is a bluecap.
    expect(pickFood({ bluecap: 1, 'pumpkin-soup': 1 }, 1, 0.3)).toBe('bluecap');
    // With nothing else, a mixed meal still does.
    expect(pickFood({ 'bluecap-broth': 1 }, 0.5, 1)).toBe('bluecap-broth');
    expect(pickFood({ 'pumpkin-soup': 1 }, 1, 0.5)).toBe('pumpkin-soup');
  });

  it('takes one from the pack', () => {
    const pack: Record<string, number> = { pumpkin: 2 };
    expect(eatItem(pack, 'pumpkin')).toEqual({ heal: 60, mana: 0, fed: null, pip: null });
    expect(pack.pumpkin).toBe(1);
    expect(eatItem(pack, 'wheat')).toBe(null);
    expect(eatItem({ fish: 0 }, 'fish')).toBe(null);
  });
});

describe('fruit and Nell', () => {
  const hero = (raceId: 'human' | 'zombie' = 'human') =>
    createCharacter({ name: 'T', classId: 'warrior', subclassId: 'swordsman', raceId, roleId: 'historian', expansion: false }, () => 0.5);

  it('never eats fruit or sweets on its own (X), and counts them apart', () => {
    for (const id of FRUIT_IDS) expect(pickFood({ [id]: 5 }, 0.1, 0.1)).toBe(null);
    expect(pickFood({ 'sunberry-tart': 3, 'heartapple-pie': 2 }, 0.1, 1)).toBe(null);
    expect(pickFood({ bloodorange: 3, fish: 1 }, 0.1, 1)).toBe('fish');
    expect(foodCount({ fish: 1, sunberry: 4, 'heartapple-pie': 1 })).toBe(1);
    expect(satchelCount({ fish: 1, sunberry: 4, 'heartapple-pie': 1 })).toBe(5);
    expect(SATCHEL_IDS).toContain('sunberry-tart');
    expect(isFruit('moonplum') && isFruit('heartapple-pie') && !isFruit('fish')).toBe(true);
  });

  it('keeps a pip from a raw sunberry or heartapple 35% of the time', () => {
    expect(pipFrom('sunberry', 0.34)).toBe('seed-sunberry');
    expect(pipFrom('heartapple', 0)).toBe('seed-heartapple');
    expect(pipFrom('sunberry', 0.35)).toBe(null);
    expect(pipFrom('emberfig', 0)).toBe(null);
    expect(pipFrom('sunberry-tart', 0)).toBe(null);
    expect(pipFrom('carrot', 0)).toBe(null);
    const c = hero();
    c.items = { sunberry: 2 };
    expect(eatItem(c.items, 'sunberry', c, 0.1)!.pip).toBe('seed-sunberry');
    expect(eatItem(c.items, 'sunberry', c, 0.9)!.pip).toBe(null);
    expect(c.items['seed-sunberry']).toBe(1);
    // Wren does not sell pips, and the pip crops grow the same fruit.
    expect(CROPS.sunberry.seedPrice).toBe(0);
    expect(CROPS.heartapple.seedPrice).toBe(0);
    expect(isPip('sunberry') && isPip('heartapple') && !isPip('carrot')).toBe(true);
    expect(CROPS.sunberry.buyer).toBe('nell');
  });

  it('picks one fresh fruit a day, the same all day, from every fruit in time', () => {
    const seen = new Set<string>();
    for (let d = 0; d < 200; d++) {
      const f = dealOfDay(d);
      expect(FRUIT_IDS).toContain(f);
      expect(dealOfDay(d)).toBe(f);
      seen.add(f);
    }
    expect(seen.size).toBe(FRUIT_IDS.length);
    expect(marketDay(0)).toBe(0);
    expect(marketDay(1439.9)).toBe(0);
    expect(marketDay(1440)).toBe(1);
    expect(marketDay(NaN)).toBe(0);
    const deal = dealOfDay(5);
    const c = hero();
    expect(fruitPrice(c, deal, 5)).toBe(Math.round(FRUITS[deal].price * 0.75));
    const other = FRUIT_IDS.find((id) => id !== deal)!;
    expect(fruitPrice(c, other, 5)).toBe(FRUITS[other].price);
    expect(fruitPrice(hero('zombie'), other, 5)).toBe(Math.round(FRUITS[other].price * 1.25));
  });

  it('sells fruit for embers', () => {
    const c = hero();
    c.gold = 100;
    const id = FRUIT_IDS.find((f) => f !== dealOfDay(0))!;
    expect(buyFruit(c, id, 0, 2)).toBe(null);
    expect(c.items[id]).toBe(2);
    expect(c.gold).toBe(100 - 2 * FRUITS[id].price);
    c.gold = 0;
    expect(buyFruit(c, id, 0)).toMatch(/Not enough/);
  });

  it('buys at most ten fish a day, and the count resets the next day', () => {
    const c = hero();
    const m = newMarket();
    c.items = { fish: 8, 'golden-fish': 5 };
    expect(fishRoom(m, 0)).toBe(FISH_CAP);
    expect(sellFish(c, m, 0, 'fish')).toEqual({ n: 8, gold: 8 * NELL.buyFish });
    expect(sellFish(c, m, 0, 'golden-fish')).toEqual({ n: 2, gold: 2 * NELL.buyGolden });
    expect(fishRoom(m, 0)).toBe(0);
    expect(sellFish(c, m, 0, 'golden-fish')).toEqual({ n: 0, gold: 0 });
    expect(c.items['golden-fish']).toBe(3);
    expect(fishRoom(m, 1)).toBe(FISH_CAP);
    expect(sellFish(c, m, 1, 'golden-fish', 1)).toEqual({ n: 1, gold: NELL.buyGolden });
    expect(m).toEqual({ day: 1, fish: 1 });
    expect(normalizeMarket({ day: 2.7, fish: 50 })).toEqual({ day: 2, fish: FISH_CAP });
  });

  it('always buys for less than she sells (no embers from nothing)', () => {
    const c = hero();
    expect(nellPays('fish')).toBeLessThan(NELL.fish);
    // Quill's two fish for 25 too.
    expect(nellPays('fish') * 2).toBeLessThan(25);
    expect(nellPays('golden-fish')).toBeLessThan(NELL.goldenFish);
    for (const id of FRUIT_IDS) {
      for (let d = 0; d < 20; d++) expect(nellPays(id)).toBeLessThan(fruitPrice(c, id, d));
      expect(nellPays(id)).toBe(Math.floor(FRUITS[id].price / 4));
    }
    expect(nellPays('lure') + nellPays('carrot') + nellPays('sunberry-tart')).toBe(0);
    // A bought sunberry's pip, grown and sold, never pays back the berry.
    const avg = (CROPS.sunberry.yield[0] + CROPS.sunberry.yield[1]) / 2;
    expect(PIP_CHANCE * avg * nellPays('sunberry')).toBeLessThan(fruitPrice(c, 'sunberry', 0) * 0.75);
    // The fish cap holds fish sales to about the income of a few kills a day.
    expect(FISH_CAP * NELL.buyGolden).toBeLessThanOrEqual(300);
  });
});
