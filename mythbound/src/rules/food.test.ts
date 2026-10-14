import { describe, expect, it } from 'vitest';
import { FOOD_IDS, eatItem, foodCount, isFood, pickFood } from './food';

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

  it('takes one from the pack', () => {
    const pack: Record<string, number> = { pumpkin: 2 };
    expect(eatItem(pack, 'pumpkin')).toEqual({ heal: 60, mana: 0 });
    expect(pack.pumpkin).toBe(1);
    expect(eatItem(pack, 'wheat')).toBe(null);
    expect(eatItem({ fish: 0 }, 'fish')).toBe(null);
  });
});
