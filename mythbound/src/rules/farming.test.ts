import { describe, expect, it } from 'vitest';
import { CROPS, SEED_PACK, seedItem } from '../data/goods';
import { FIELD, NPCS, QUESTS, plotCentre } from '../data/world';
import { createCharacter } from './character';
import {
  FARM, buySeeds, cropYield, digUp, feed, growthAt, harvest, isWet, newFarm, normalizeFarm, plant, progress, rentPlot, rentPrice, ripeCount,
  ripeIn, sellCrop, stageOf, water, waterAll,
} from './farming';
import { normalizeSave, newWorldState, type SaveData } from '../engine/state';

const hero = (raceId: 'human' | 'zombie' = 'human') =>
  createCharacter({ name: 'T', classId: 'warrior', subclassId: 'swordsman', raceId, roleId: 'historian', expansion: false }, () => 0.5);

describe('Wren’s field', () => {
  it('lays out nine beds east of the square, away from Wren', () => {
    const wren = NPCS.find((n) => n.id === 'wren')!;
    const centres = Array.from({ length: FARM.plots }, (_, i) => plotCentre(i));
    expect(centres[4]).toEqual({ x: FIELD.x, z: FIELD.z });
    for (const c of centres) expect(Math.hypot(c.x - wren.x, c.z - wren.z)).toBeGreaterThan(3);
    // Beds never overlap.
    for (let i = 0; i < centres.length; i++) for (let j = i + 1; j < centres.length; j++) expect(Math.hypot(centres[i].x - centres[j].x, centres[i].z - centres[j].z)).toBeGreaterThanOrEqual(FIELD.bed);
    expect(QUESTS.harvest.giver).toBe('wren');
  });
});

describe('growing', () => {
  it('plants a seed from the pack into a bed you own', () => {
    const c = hero();
    const f = newFarm();
    expect(plant(c, f, 0, 'carrot')).toMatch(/no carrot seeds/);
    c.items[seedItem('carrot')] = 2;
    expect(plant(c, f, 0, 'carrot')).toBe(null);
    expect(c.items[seedItem('carrot')]).toBe(1);
    expect(plant(c, f, 0, 'carrot')).toMatch(/already grows/);
    expect(plant(c, f, FARM.free, 'carrot')).toMatch(/Rent/);
    expect(plant(c, f, 99, 'carrot')).toMatch(/No such/);
    expect(c.items[seedItem('carrot')]).toBe(1);
  });

  it('grows at full speed while wet and half speed dry, and stops at ripe', () => {
    const c = hero();
    const f = newFarm();
    c.items[seedItem('carrot')] = 1;
    plant(c, f, 0, 'carrot');
    const p = f.plots[0]!;
    // Dry: half speed.
    f.clock = 60;
    expect(growthAt(p, f.clock)).toBe(30);
    expect(isWet(p, f.clock)).toBe(false);
    // Watered: full speed for four hours, then half again.
    expect(water(f, 0)).toBe(true);
    expect(isWet(p, f.clock)).toBe(true);
    f.clock = 60 + 100;
    expect(growthAt(p, f.clock)).toBe(130);
    // Watering again only tops it up: nothing gained.
    water(f, 0);
    expect(growthAt(p, f.clock)).toBe(130);
    f.clock += 50;
    expect(growthAt(p, f.clock)).toBe(CROPS.carrot.grow);
    f.clock += 1000;
    expect(growthAt(p, f.clock)).toBe(CROPS.carrot.grow);
  });

  it('dries out after a watering lasts', () => {
    const f = newFarm();
    f.plots[0] = { crop: 'pumpkin', grown: 0, at: 0, wetUntil: 0, fed: 0 };
    water(f, 0);
    f.clock = FARM.waterLasts + 100;
    expect(growthAt(f.plots[0]!, f.clock)).toBe(FARM.waterLasts + 100 * FARM.dryRate);
    expect(isWet(f.plots[0]!, f.clock)).toBe(false);
  });

  it('shows stages: seeded, sprouting, tall, ripe', () => {
    const f = newFarm();
    expect(stageOf(null, 0)).toBe(0);
    f.plots[0] = { crop: 'carrot', grown: 0, at: 0, wetUntil: 0, fed: 0 };
    const p = f.plots[0]!;
    const g = CROPS.carrot.grow;
    for (const [grown, stage] of [[0, 1], [g * 0.15, 2], [g * 0.5, 3], [g, 4]] as const) {
      p.grown = grown;
      expect(stageOf(p, 0)).toBe(stage);
    }
    p.grown = g * 0.25;
    expect(progress(p, 0)).toBeCloseTo(0.25);
    expect(ripeIn(p, 0)).toBeCloseTo(g * 0.75);
  });
});

describe('harvest, feeding and selling', () => {
  it('harvests only a ripe bed, within the crop’s yield, and clears it', () => {
    const c = hero();
    const f = newFarm();
    f.plots[0] = { crop: 'wheat', grown: CROPS.wheat.grow - 1, at: 0, wetUntil: 0, fed: 0 };
    expect(harvest(c, f, 0, 0.5)).toBe(null);
    f.plots[0]!.grown = CROPS.wheat.grow;
    expect(ripeCount(f)).toBe(1);
    expect(harvest(c, f, 0, 0)).toEqual({ crop: 'wheat', n: 3 });
    expect(c.items.wheat).toBe(3);
    expect(f.plots[0]).toBe(null);
    expect(f.harvests).toBe(1);
    // The roll spans the whole yield, top included.
    const p = { crop: 'wheat' as const, grown: 0, at: 0, wetUntil: 0, fed: 0 };
    expect(cropYield(p, 0)).toBe(3);
    expect(cropYield(p, 0.999)).toBe(5);
    expect(cropYield({ ...p, fed: 2 }, 0)).toBe(5);
  });

  it('feeds a bed a fish once, before it is half grown', () => {
    const c = hero();
    const f = newFarm();
    f.plots[0] = { crop: 'carrot', grown: 0, at: 0, wetUntil: 0, fed: 0 };
    expect(feed(c, f, 0, 'fish')).toMatch(/none/);
    c.items.fish = 2;
    c.items['golden-fish'] = 1;
    expect(feed(c, f, 0, 'carrot')).toMatch(/Nothing/);
    expect(feed(c, f, 0, 'golden-fish')).toBe(null);
    expect(f.plots[0]!.fed).toBe(2);
    expect(feed(c, f, 0, 'fish')).toMatch(/already/);
    f.plots[1] = { crop: 'carrot', grown: CROPS.carrot.grow * 0.6, at: 0, wetUntil: 0, fed: 0 };
    expect(feed(c, f, 1, 'fish')).toMatch(/half grown/);
    expect(c.items.fish).toBe(2);
  });

  it('waters every growing bed with a watering can, and feeds compost', () => {
    const c = hero();
    const f = newFarm();
    f.plots[0] = { crop: 'carrot', grown: 0, at: 0, wetUntil: 0, fed: 0 };
    f.plots[2] = { crop: 'wheat', grown: CROPS.wheat.grow, at: 0, wetUntil: 0, fed: 0 };
    expect(waterAll(f, FARM.canLasts)).toBe(1);
    expect(f.plots[0]!.wetUntil).toBe(FARM.canLasts);
    expect(f.plots[2]!.wetUntil).toBe(0);
    c.items.compost = 1;
    expect(feed(c, f, 0, 'compost')).toBe(null);
    expect(f.plots[0]!.fed).toBe(1);
    expect(c.items.compost).toBe(0);
  });

  it('digs a bed up', () => {
    const f = newFarm();
    f.plots[2] = { crop: 'carrot', grown: 10, at: 0, wetUntil: 0, fed: 0 };
    digUp(f, 2);
    expect(f.plots[2]).toBe(null);
  });

  it('sells seeds in packs and buys crops, with the zombie markup', () => {
    const c = hero();
    c.gold = 100;
    expect(buySeeds(c, 'pumpkin')).toBe(null);
    expect(c.gold).toBe(100 - CROPS.pumpkin.seedPrice);
    expect(c.items[seedItem('pumpkin')]).toBe(SEED_PACK);
    expect(buySeeds(c, 'pumpkin')).toMatch(/Not enough/);
    const z = hero('zombie');
    z.gold = 1000;
    buySeeds(z, 'carrot');
    expect(z.gold).toBe(1000 - Math.round(CROPS.carrot.seedPrice * 1.25));
    c.items.wheat = 7;
    expect(sellCrop(c, 'wheat')).toBe(7 * CROPS.wheat.sell);
    expect(c.items.wheat).toBe(0);
    expect(sellCrop(c, 'wheat')).toBe(0);
  });

  it('never pays more to grow than a crop sells for, so seeds always feed you first', () => {
    for (const crop of Object.values(CROPS)) {
      const perSeed = crop.seedPrice / SEED_PACK;
      const avg = (crop.yield[0] + crop.yield[1]) / 2;
      // Selling a harvest earns a little over the seed, never a fortune.
      expect(avg * crop.sell).toBeGreaterThan(perSeed * 0.5);
      expect(avg * crop.sell).toBeLessThan(perSeed * 4);
    }
  });

  it('rents further beds at rising prices, up to nine', () => {
    const c = hero();
    const f = newFarm();
    c.gold = 5000;
    let paid = 0;
    while (rentPrice(c, f) !== null) {
      const price = rentPrice(c, f)!;
      expect(rentPlot(c, f)).toBe(null);
      paid += price;
    }
    expect(f.owned).toBe(FARM.plots);
    expect(paid).toBe(FARM.rent.reduce((a, b) => a + b, 0));
    expect(rentPlot(c, f)).toMatch(/Every bed/);
    const poor = hero();
    poor.gold = 0;
    expect(rentPlot(poor, newFarm())).toMatch(/Not enough/);
  });
});

describe('saves', () => {
  it('gives an old save an empty field, and mends a damaged one', () => {
    const c = hero();
    const old = JSON.parse(JSON.stringify({ character: c, world: newWorldState() })) as SaveData;
    delete (old.world as Partial<typeof old.world>).farm;
    const fixed = normalizeSave(old);
    expect(fixed.world.farm).toEqual(newFarm());
    expect(normalizeFarm(undefined)).toEqual(newFarm());
    expect(normalizeFarm('junk')).toEqual(newFarm());
    const bad = normalizeFarm({
      clock: 500, owned: 99, harvests: -3,
      plots: [{ crop: 'mandrake', grown: 1 }, { crop: 'carrot', grown: 1e9, at: 9999, wetUntil: Infinity, fed: 7 }, null, { crop: 'wheat', grown: NaN }],
    });
    expect(bad.owned).toBe(FARM.plots);
    expect(bad.harvests).toBe(0);
    expect(bad.plots).toHaveLength(FARM.plots);
    expect(bad.plots[0]).toBe(null);
    expect(bad.plots[1]).toEqual({ crop: 'carrot', grown: CROPS.carrot.grow, at: 500, wetUntil: 0, fed: 2 });
    expect(bad.plots[3]!.grown).toBe(0);
  });

  it('keeps a field through a save', () => {
    const c = hero();
    const w = newWorldState();
    c.items[seedItem('bluecap')] = 1;
    plant(c, w.farm, 1, 'bluecap');
    w.farm.clock = 42;
    water(w.farm, 1);
    const back = normalizeSave(JSON.parse(JSON.stringify({ character: c, world: w })) as SaveData);
    expect(back.world.farm).toEqual(w.farm);
  });
});
