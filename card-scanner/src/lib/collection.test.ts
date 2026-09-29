import { describe, expect, it } from 'vitest';
import type { CardInfo } from '../types';
import { addCard, mergeCollections, parseBackup, toBackup, toCsv, totals, unitPrice } from './collection';

const zoro: CardInfo = {
  key: 'onepiece:OP01-001',
  game: 'onepiece',
  id: 'OP01-001',
  name: 'Roronoa Zoro',
  prices: { usd: 0.5 },
};
const bolt: CardInfo = {
  key: 'magic:abc',
  game: 'magic',
  id: 'abc',
  name: 'Lightning Bolt, "Classic"',
  prices: { usd: 1.5, usdFoil: 5 },
};
const euroOnly: CardInfo = { key: 'pokemon:x', game: 'pokemon', id: 'x', name: 'Eevee', prices: { eur: 2 } };

describe('collection', () => {
  it('stacks identical cards but keeps foils and conditions separate', () => {
    let items = addCard([], bolt);
    items = addCard(items, bolt, { quantity: 2 });
    items = addCard(items, bolt, { foil: true });
    items = addCard(items, bolt, { condition: 'LP' });
    expect(items.map((i) => [i.quantity, i.foil, i.condition])).toEqual([
      [1, false, 'LP'],
      [1, true, 'NM'],
      [3, false, 'NM'],
    ]);
  });

  it('prices foils with the foil price and totals by currency', () => {
    const items = addCard(addCard(addCard([], bolt, { foil: true, quantity: 2 }), zoro, { quantity: 3 }), euroOnly);
    expect(unitPrice(items[2])).toEqual({ amount: 5, currency: 'USD' });
    expect(totals(items)).toEqual({ cards: 6, unique: 3, usd: 11.5, eur: 2, unpriced: 0 });
  });

  it('exports CSV with quoting', () => {
    const csv = toCsv(addCard([], bolt, { quantity: 2 }));
    const [header, row] = csv.trim().split('\r\n');
    expect(header.startsWith('Game,Name,Set')).toBe(true);
    expect(row).toContain('"Lightning Bolt, ""Classic"""');
    expect(row).toContain(',2,no,NM,1.50,USD,3.00,');
  });

  it('round-trips a JSON backup and merges it', () => {
    const items = addCard(addCard([], bolt), zoro, { quantity: 2 });
    const restored = parseBackup(toBackup(items));
    expect(restored).toEqual(items);
    const merged = mergeCollections(items, restored);
    expect(merged.map((i) => i.quantity)).toEqual([4, 2]);
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('name,qty\nbolt,1')).toThrow(/backup/);
    expect(() => parseBackup('{"items":[{"foo":1}]}')).toThrow(/backup/);
  });
});
