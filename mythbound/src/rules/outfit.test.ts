import { describe, expect, it } from 'vitest';
import { CLASSES, ROLES, SUBCLASSES, type ClassId, type RoleId, type SubclassId } from '../data/defs';
import { DYES, GARMENTS, garment, UNDYED_CLOAK } from '../data/goods';
import { WEAPON_TRIALS } from '../data/world';
import { createCharacter, normalizeCharacter, type Character, type CharacterChoice } from './character';
import { normalizeSave, newWorldState, type SaveData } from '../engine/state';
import {
  FREE_GARMENTS, PLAIN, applyOutfit, baseLook, buyLook, decodeOutfit, dressedOf, earnedUnlocks, encodeOutfit, grantDye, grantGarment, isPlain,
  lockedSlot, newWardrobe, normalizeWardrobe, outfitKey, plainOutfit, wardrobeBlock, wardrobeCounts, wearable, type Dressed,
} from './outfit';

const hex = (n: number | undefined) => (n === undefined ? undefined : `#${n.toString(16).padStart(6, '0')}`);

describe('class looks', () => {
  it('dresses every class, subclass and role as before', () => {
    const looks: Record<string, unknown> = {};
    for (const classId of Object.keys(CLASSES) as ClassId[]) {
      const subs: (SubclassId | null)[] = [null, ...(Object.values(SUBCLASSES).filter((s) => s.classId === classId).map((s) => s.id))];
      for (const sub of subs)
        for (const roleId of Object.keys(ROLES) as RoleId[]) {
          const l = baseLook(classId, sub, roleId);
          looks[`${classId}/${sub ?? '-'}/${roleId}`] = { ...l, armor: hex(l.armor), cloth: hex(l.cloth), accent: hex(l.accent), cape: hex(l.cape), headband: hex(l.headband), circlet: hex(l.circlet) };
        }
    }
    expect(looks).toMatchSnapshot();
  });
});

// ------------------------------------------------------------- wardrobe --

const hero = (over: Partial<CharacterChoice> = {}) =>
  createCharacter({ name: 'T', classId: 'warrior', subclassId: 'swordsman', raceId: 'human', roleId: 'historian', expansion: false, ...over }, () => 0.5);
const dressed = (over: Partial<Dressed>): Dressed => ({ ...PLAIN, ...over });

describe('the wardrobe in a save', () => {
  it('starts with the free garments, no colours and the class look', () => {
    const c = hero();
    expect(c.wardrobe.owned.sort()).toEqual([...FREE_GARMENTS].sort());
    expect(FREE_GARMENTS).toEqual(['bare-head', 'no-cloak']);
    expect(c.wardrobe.dyes).toEqual([]);
    expect(c.wardrobe.outfit).toEqual(plainOutfit());
    expect(isPlain(dressedOf(c.wardrobe.outfit))).toBe(true);
  });

  it('drops unknown, unowned and misplaced ids, and keeps the free garments', () => {
    const w = normalizeWardrobe({
      owned: ['hood', 'hood', 'robe', 'ghost-suit', 3, null],
      dyes: ['madder', 'madder', 'ultraviolet', 7],
      outfit: { head: 'hood', body: 'plate', cloak: 'robe', cloth: 'madder', armor: 'woad', trim: 'nope', cape: 42 },
    });
    expect(w.owned.sort()).toEqual(['bare-head', 'hood', 'no-cloak', 'robe']);
    expect(w.dyes).toEqual(['madder']);
    // The plate isn't owned, a robe isn't a cloak, woad isn't known.
    expect(w.outfit).toEqual({ ...plainOutfit(), head: 'hood', cloth: 'madder' });
    // Junk of every kind: a fresh wardrobe.
    for (const junk of [undefined, null, 7, 'x', [], { owned: 'hood', dyes: {}, outfit: [] }]) expect(normalizeWardrobe(junk)).toEqual(newWardrobe());
  });

  it('loads an old save without a wardrobe (and one with a damaged wardrobe)', () => {
    const c = hero();
    c.wardrobe.owned.push('hat');
    c.wardrobe.outfit.head = 'hat';
    const old = JSON.parse(JSON.stringify({ character: c, world: newWorldState() })) as SaveData;
    delete (old.character as Partial<Character>).wardrobe;
    const fixed = normalizeSave(old);
    expect(fixed.character.wardrobe).toEqual(newWardrobe());
    // Kept across a save and load.
    const back = normalizeSave(JSON.parse(JSON.stringify({ character: c, world: newWorldState() })) as SaveData);
    expect(back.character.wardrobe.outfit.head).toBe('hat');
    const bad = normalizeCharacter({ ...hero(), wardrobe: { owned: 'hood' } as never });
    expect(bad.wardrobe).toEqual(newWardrobe());
  });

  it('grants garments and colours once, and only real ones', () => {
    const w = newWardrobe();
    expect(grantGarment(w, 'hood')).toBe(true);
    expect(grantGarment(w, 'hood')).toBe(false);
    expect(grantGarment(w, 'cape-of-nope')).toBe(false);
    expect(grantDye(w, 'woad')).toBe(true);
    expect(grantDye(w, 'woad')).toBe(false);
    expect(grantDye(w, 'plaid')).toBe(false);
    expect(wardrobeCounts(w)).toEqual({ garments: 3, ofGarments: 15, dyes: 1, ofDyes: 17 });
  });

  it('keeps the wire order of garments and dyes (append only)', () => {
    expect(GARMENTS.map((g) => g.id)).toEqual(['bare-head', 'hood', 'mask', 'hat', 'headband', 'circlet', 'helm', 'galea', 'crown', 'jerkin', 'robe', 'gi', 'plate', 'cloak', 'no-cloak']);
    expect(DYES.slice(0, 17).map((d) => d.id)).toEqual(['madder', 'woad', 'weld', 'purple', 'green', 'orange', 'cream', 'charcoal', 'bone', 'teal', 'venom', 'crimson', 'gold', 'eyeglow', 'pearl', 'tidal', 'dragonfire']);
    // Every look can be had somehow: free, made, sold or earned.
    for (const x of [...GARMENTS, ...DYES]) expect(('free' in x && x.free) || 'make' in x || x.price || x.earned, x.id).toBeTruthy();
  });
});

describe('Quill’s clothes and colours', () => {
  it('sells what he stocks, once, for embers', () => {
    const c = hero();
    c.gold = 100;
    expect(buyLook(c, 'garment', 'hood')).toBe(null);
    expect(c.gold).toBe(40);
    expect(c.wardrobe.owned).toContain('hood');
    expect(buyLook(c, 'garment', 'hood')).toBe('You have it already.');
    expect(buyLook(c, 'garment', 'hat')).toBe('You need 80 embers.');
    expect(c.gold).toBe(40);
    // Not for sale: made or earned only.
    expect(buyLook(c, 'garment', 'mask')).toBe('Quill doesn’t sell that.');
    expect(buyLook(c, 'garment', 'crown')).toBe('Quill doesn’t sell that.');
    expect(buyLook(c, 'dye', 'purple')).toBe('Quill doesn’t sell that.');
    // A colour, at a marked-up price.
    expect(buyLook(c, 'dye', 'woad', 44)).toBe('You need 44 embers.');
    expect(buyLook(c, 'dye', 'woad', 40)).toBe(null);
    expect(c.gold).toBe(0);
    expect(c.wardrobe.dyes).toEqual(['woad']);
  });
});

describe('earned looks', () => {
  it('gives the crown for all six weapon trials and a colour per elder relic, once each', () => {
    const c = hero();
    const five = WEAPON_TRIALS.slice(0, 5).map((t) => t.id);
    expect(earnedUnlocks(c, five)).toEqual([]);
    const all = WEAPON_TRIALS.map((t) => t.id);
    expect(earnedUnlocks(c, all)).toEqual(['Crown of the Six']);
    expect(earnedUnlocks(c, all)).toEqual([]);
    c.items['leviathan-pearl'] = 1;
    c.items['dragon-heart'] = 1;
    expect(earnedUnlocks(c, all)).toEqual(['Pearl dye', 'Dragonfire dye']);
    c.items['tide-crown'] = 1;
    expect(earnedUnlocks(c, all)).toEqual(['Tidal Blue dye']);
    expect(c.wardrobe.owned).toContain('crown');
    expect(c.wardrobe.dyes.sort()).toEqual(['dragonfire', 'pearl', 'tidal']);
  });

  it('gives an old save what it had already earned', () => {
    const c = hero();
    c.items['tide-crown'] = 1;
    const world = { ...newWorldState(), trialsDone: WEAPON_TRIALS.map((t) => t.id) };
    const old = JSON.parse(JSON.stringify({ character: c, world })) as SaveData;
    delete (old.character as Partial<Character>).wardrobe;
    const loaded = normalizeSave(old);
    expect(earnedUnlocks(loaded.character, loaded.world.trialsDone)).toEqual(['Crown of the Six', 'Tidal Blue dye']);
  });
});

describe('dressing a hero', () => {
  it('puts head garments over the class’s own, clearing its band', () => {
    // A monk's own headband goes under a hood.
    const monk = baseLook('monk', 'windwalker', 'historian');
    expect(monk.headband).toBeDefined();
    const hooded = applyOutfit({ ...monk }, dressed({ head: garment('hood') }));
    expect(hooded.head).toBe('hood');
    expect(hooded.headband).toBeUndefined();
    // A headband takes the trim colour (or the accent), a circlet the trim (or silver).
    const war = baseLook('warrior', null, 'historian');
    expect(applyOutfit({ ...war }, dressed({ head: garment('headband') }))).toMatchObject({ head: 'bare', headband: war.accent, circlet: undefined });
    expect(applyOutfit({ ...war }, dressed({ head: garment('headband'), trim: 0x123456 }))).toMatchObject({ headband: 0x123456, accent: 0x123456 });
    expect(applyOutfit({ ...war }, dressed({ head: garment('circlet') }))).toMatchObject({ head: 'bare', circlet: 0xc8ccd4, headband: undefined });
    expect(applyOutfit({ ...war }, dressed({ head: garment('circlet'), trim: 0xe0b84a })).circlet).toBe(0xe0b84a);
    // Trim alone recolours the class's own band.
    expect(applyOutfit({ ...monk }, dressed({ trim: 0xabcdef })).headband).toBe(0xabcdef);
    const light = baseLook('sorcerer', 'lightmage', 'historian');
    expect(applyOutfit({ ...light }, dressed({ trim: 0xabcdef })).circlet).toBe(0xabcdef);
    expect(applyOutfit({ ...war }, dressed({ head: garment('galea') })).head).toBe('plume');
    expect(applyOutfit({ ...war }, dressed({ head: garment('crown') })).head).toBe('crown');
  });

  it('cuts the body, puts a cloak on or off, and dyes each channel', () => {
    const mage = baseLook('mage', null, 'historian');
    expect(mage.cape).toBeUndefined();
    const a = applyOutfit({ ...mage }, dressed({ body: garment('plate'), cloak: garment('cloak') }));
    expect(a.build).toBe('heavy');
    expect(a.cape).toBe(UNDYED_CLOAK);
    const war = baseLook('warrior', null, 'historian');
    // A class's own cloak keeps its colour; "No Cloak" takes it off.
    expect(applyOutfit({ ...war }, dressed({ cloak: garment('cloak') })).cape).toBe(war.cape);
    expect(applyOutfit({ ...war }, dressed({ cloak: garment('no-cloak') })).cape).toBeUndefined();
    const d = applyOutfit({ ...war }, dressed({ cloth: 1, armor: 2, trim: 3, cape: 4 }));
    expect(d).toMatchObject({ cloth: 1, armor: 2, accent: 3, cape: 4 });
    // A cloak colour shows only on a cloak.
    expect(applyOutfit({ ...mage }, dressed({ cape: 4 })).cape).toBeUndefined();
    expect(applyOutfit({ ...mage }, dressed({ cloak: garment('cloak'), cape: 4 })).cape).toBe(4);
    // Black is a colour, not "none".
    expect(applyOutfit({ ...war }, dressed({ cloth: 0 })).cloth).toBe(0);
    // Nothing chosen: unchanged.
    expect(applyOutfit({ ...war }, PLAIN)).toEqual(war);
  });

  it('leaves out what a race can’t wear', () => {
    expect(lockedSlot('angelic', 'cloak')).toMatch(/wings/);
    expect(lockedSlot('angelic', 'head')).toBe(null);
    expect(lockedSlot('ancient', 'head')).toMatch(/face/);
    expect(lockedSlot('ancient', 'body')).toBe(null);
    expect(lockedSlot('human', 'cloak')).toBe(null);
    const d = dressed({ head: garment('hat'), body: garment('robe'), cloak: garment('cloak'), cape: 5 });
    expect(wearable(d, 'angelic')).toEqual({ ...d, cloak: null });
    expect(wearable(d, 'ancient')).toEqual({ ...d, head: null });
    expect(wearable(d, 'human')).toBe(d);
  });

  it('only lets a hero change clothes somewhere safe', () => {
    const ok = { alive: true, riding: false, inTrial: false, threatened: false, sinceHurt: 99, swimming: false, flying: false, sailing: false, busy: false };
    expect(wardrobeBlock(ok)).toBe(null);
    expect(wardrobeBlock({ ...ok, riding: true })).toMatch(/horse/);
    expect(wardrobeBlock({ ...ok, swimming: true })).toMatch(/dry land/);
    expect(wardrobeBlock({ ...ok, threatened: true })).toBe('Change clothes somewhere safe.');
    expect(wardrobeBlock({ ...ok, inTrial: true })).toBe('Change clothes somewhere safe.');
    expect(wardrobeBlock({ ...ok, sinceHurt: 2 })).toBe('Change clothes somewhere safe.');
    expect(wardrobeBlock({ ...ok, busy: true })).toMatch(/Finish/);
    expect(wardrobeBlock({ ...ok, alive: false })).toBeTruthy();
  });
});

describe('outfits in co-op', () => {
  it('round-trips an outfit through the wire, colours as hex', () => {
    const o = { ...plainOutfit(), head: 'hood', body: 'robe', cloak: 'no-cloak', cloth: 'madder', trim: 'gold' };
    const d = dressedOf(o);
    const wire = encodeOutfit(d);
    expect(wire).toEqual([1, 10, 14, 0x9a2a22, -1, 0xe0b84a, -1]);
    expect(decodeOutfit(JSON.parse(JSON.stringify(wire)))).toEqual(d);
    expect(outfitKey(decodeOutfit(wire))).toBe(outfitKey(d));
    expect(encodeOutfit(PLAIN)).toEqual([-1, -1, -1, -1, -1, -1, -1]);
    expect(decodeOutfit(encodeOutfit(PLAIN))).toEqual(PLAIN);
  });

  it('reads junk from a friend as the class look', () => {
    for (const junk of [undefined, null, 'x', 5, {}, [], ['a', 'b']]) expect(decodeOutfit(junk)).toEqual(PLAIN);
    // Out of range, the wrong slot, a fraction, a colour too big: the class's own for that one.
    expect(decodeOutfit([99, 1, 10, 0x1000000, -5, 1.5, 'red'])).toEqual(PLAIN);
    expect(decodeOutfit([10, 1, 1, 0, 0, 0, 0])).toEqual({ ...PLAIN, cloth: 0, armor: 0, trim: 0, cape: 0 });
    // A newer build's extra entries are ignored.
    expect(decodeOutfit([3, -1, -1, -1, -1, -1, -1, 7, 8]).head?.id).toBe('hat');
  });
});
