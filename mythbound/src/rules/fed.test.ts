import { describe, expect, it } from 'vitest';
import { FRUITS, FRUIT_IDS, MEALS } from '../data/goods';
import { ITEMS } from '../data/world';
import { createCharacter, manaRegen, moveSpeed, normalizeCharacter, staminaRegen, swimsTireless, type Character } from './character';
import { incomingDamage } from './combat';
import { FED_CAP, LONGEST_SERVING, clearFed, feed, fedMul, fedNightVision, fedRegen, fedSwims, fedTaken, normalizeFed, tickFed } from './fed';
import { eatItem } from './food';
import { normalizeSave, newWorldState, type SaveData } from '../engine/state';

const hero = (raceId: 'human' | 'zombie' = 'human'): Character =>
  createCharacter({ name: 'T', classId: 'warrior', subclassId: 'swordsman', raceId, roleId: 'historian', expansion: false }, () => 0.5);

const ctx = { blocking: false, stoneSkin: false, invulnerable: false };

describe('the Fed slot', () => {
  it('starts empty', () => {
    expect(hero().fed).toBe(null);
  });

  it('holds one fruit: the same one refreshes (never shortens), another replaces it', () => {
    const c = hero();
    expect(feed(c, 'sunberry', 360)).toEqual({ kind: 'new', was: null });
    c.fed!.left = 100;
    expect(feed(c, 'sunberry', 360)).toEqual({ kind: 'refresh', was: 'sunberry' });
    expect(c.fed).toEqual({ id: 'sunberry', left: 360 });
    // A tart's longer serving is kept when a raw berry is eaten after it.
    feed(c, 'sunberry', 540);
    feed(c, 'sunberry', 360);
    expect(c.fed!.left).toBe(540);
    expect(feed(c, 'emberfig', 480)).toEqual({ kind: 'replace', was: 'sunberry' });
    expect(c.fed).toEqual({ id: 'emberfig', left: 480 });
    // Never past the cap, whatever is asked.
    feed(c, 'emberfig', 1e9);
    expect(c.fed!.left).toBe(FED_CAP);
  });

  it('wears off with play time, down to nothing', () => {
    const c = hero();
    feed(c, 'windpear', 10);
    expect(tickFed(c, 4)).toBe(null);
    expect(c.fed!.left).toBe(6);
    expect(tickFed(c, 6)).toBe('windpear');
    expect(c.fed).toBe(null);
    expect(tickFed(c, 1)).toBe(null);
  });

  it('is cleared by death', () => {
    const c = hero();
    feed(c, 'bloodorange', 300);
    clearFed(c);
    expect(c.fed).toBe(null);
    expect(fedMul(c, 'damage')).toBe(1);
  });

  it('gives each fruit its own effect, and nothing when unfed', () => {
    const c = hero();
    for (const s of ['stamina', 'mana', 'speed', 'damage'] as const) expect(fedMul(c, s)).toBe(1);
    expect(fedRegen(c)).toBe(0);
    expect(fedTaken(c, 'fire')).toBe(1);
    expect(fedSwims(c) || fedNightVision(c)).toBe(false);
    const on = (id: keyof typeof FRUITS) => ((c.fed = { id, left: 100 }), c);
    expect(fedMul(on('sunberry'), 'stamina')).toBe(1.3);
    expect(fedMul(c, 'speed')).toBe(1);
    expect(fedRegen(on('heartapple'))).toBe(0.003);
    expect(fedMul(on('moonplum'), 'mana')).toBe(1.4);
    expect(fedMul(on('windpear'), 'speed')).toBe(1.08);
    expect(fedTaken(on('emberfig'), 'fire')).toBe(0.65);
    expect(fedTaken(c, 'water')).toBe(1);
    expect(fedTaken(on('tideberry'), 'water')).toBe(0.65);
    expect(fedSwims(c)).toBe(true);
    expect(fedTaken(on('duskcherry'), 'dark')).toBe(0.65);
    expect(fedNightVision(c)).toBe(true);
    expect(fedMul(on('bloodorange'), 'damage')).toBe(1.12);
    // Nothing for XP or embers, and every buff is modest.
    for (const id of FRUIT_IDS) {
      const f = FRUITS[id];
      for (const v of Object.values(f.mul ?? {})) expect(v).toBeLessThanOrEqual(1.4);
      expect(Object.keys(f.mul ?? {}).every((k) => ['stamina', 'mana', 'speed', 'damage'].includes(k))).toBe(true);
      expect(f.lasts).toBeLessThanOrEqual(LONGEST_SERVING);
    }
  });

  it('feeds the stat functions', () => {
    const c = hero();
    const base = { st: staminaRegen(c), mana: manaRegen(c), speed: moveSpeed(c) };
    c.fed = { id: 'sunberry', left: 100 };
    expect(staminaRegen(c)).toBeCloseTo(base.st * 1.3);
    expect(moveSpeed(c)).toBeCloseTo(base.speed);
    c.fed = { id: 'moonplum', left: 100 };
    expect(manaRegen(c)).toBeCloseTo(base.mana * 1.4);
    c.fed = { id: 'windpear', left: 100 };
    expect(moveSpeed(c)).toBeCloseTo(base.speed * 1.08);
    expect(swimsTireless(c)).toBe(false);
    c.fed = { id: 'tideberry', left: 100 };
    expect(swimsTireless(c)).toBe(true);
  });

  it('wards against an element, multiplying with the dragon heart', () => {
    const c = hero();
    c.fed = { id: 'emberfig', left: 100 };
    expect(incomingDamage(c, 1000, 'fire', ctx)).toBe(650);
    expect(incomingDamage(c, 1000, 'water', ctx)).toBe(1000);
    c.items['dragon-heart'] = 1;
    expect(incomingDamage(c, 1000, 'fire', ctx)).toBe(325);
  });

  it('is filled by eating fruit and sweets, never by meals or crops', () => {
    const c = hero();
    c.items = { emberfig: 1, 'sunberry-tart': 1, 'root-stew': 1, carrot: 1 };
    expect(eatItem(c.items, 'root-stew', c)!.fed).toBe(null);
    expect(eatItem(c.items, 'carrot', c)!.fed).toBe(null);
    expect(c.fed).toBe(null);
    const fig = eatItem(c.items, 'emberfig', c)!;
    expect(fig).toMatchObject({ heal: 5, fed: { id: 'emberfig', minutes: 480, kind: 'new' } });
    const tart = eatItem(c.items, 'sunberry-tart', c)!;
    expect(tart).toMatchObject({ heal: 40, fed: { id: 'sunberry', minutes: MEALS['sunberry-tart'].fedFor, kind: 'replace', was: 'emberfig' } });
    expect(c.fed).toEqual({ id: 'sunberry', left: 540 });
    expect(ITEMS.sunberry.fed).toBe('sunberry');
  });
});

describe('saves', () => {
  it('turns a junk buff into none, and caps a long one', () => {
    expect(normalizeFed(undefined)).toBe(null);
    expect(normalizeFed('sunberry')).toBe(null);
    expect(normalizeFed({ id: 'mandrake', left: 50 })).toBe(null);
    expect(normalizeFed({ id: 'sunberry', left: NaN })).toBe(null);
    expect(normalizeFed({ id: 'sunberry', left: null })).toBe(null);
    expect(normalizeFed({ id: 'sunberry', left: 0 })).toBe(null);
    expect(normalizeFed({ id: 'sunberry', left: -5 })).toBe(null);
    expect(normalizeFed({ id: 'sunberry', left: 1e9 })).toEqual({ id: 'sunberry', left: FED_CAP });
    expect(normalizeFed({ id: 'moonplum', left: 42 })).toEqual({ id: 'moonplum', left: 42 });
    const c = hero();
    (c as unknown as { fed: unknown }).fed = { id: 'sunberry', left: 'lots' };
    expect(normalizeCharacter(c).fed).toBe(null);
  });

  it('loads an old save (no fed, no market), and keeps a buff and the market through a save', () => {
    const c = hero();
    const old = JSON.parse(JSON.stringify({ character: c, world: newWorldState() })) as SaveData;
    delete (old.character as Partial<Character>).fed;
    delete (old.world as Partial<typeof old.world>).market;
    const fixed = normalizeSave(old);
    expect(fixed.character.fed).toBe(null);
    expect(fixed.world.market).toEqual({ day: 0, fish: 0 });
    c.fed = { id: 'duskcherry', left: 123 };
    const w = newWorldState();
    w.market = { day: 3, fish: 7 };
    const back = normalizeSave(JSON.parse(JSON.stringify({ character: c, world: w })) as SaveData);
    expect(back.character.fed).toEqual({ id: 'duskcherry', left: 123 });
    expect(back.world.market).toEqual({ day: 3, fish: 7 });
    // A damaged market is mended.
    const bad = JSON.parse(JSON.stringify({ character: c, world: w })) as SaveData;
    (bad.world as unknown as { market: unknown }).market = { day: -4, fish: 99 };
    expect(normalizeSave(bad).world.market).toEqual({ day: 0, fish: 10 });
    (bad.world as unknown as { market: unknown }).market = 'junk';
    expect(normalizeSave(bad).world.market).toEqual({ day: 0, fish: 0 });
  });
});
