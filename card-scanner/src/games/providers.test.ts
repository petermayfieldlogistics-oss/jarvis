import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseScan } from '../ocr/parse';
import cardsFixture from './__fixtures__/onepiece-cards.json';
import packsFixture from './__fixtures__/onepiece-packs.json';

type Routes = Record<string, unknown | ((init?: RequestInit) => unknown)>;

/** Stub global fetch with exact-URL routes; anything else is a 404. */
function mockFetch(routes: Routes) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (!(url in routes)) return new Response('not found', { status: 404 });
      const body = routes[url];
      const value = typeof body === 'function' ? (body as (i?: RequestInit) => unknown)(init) : body;
      return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Pokémon (TCGdex)', () => {
  const pikachu = {
    id: 'sv01-025',
    localId: '025',
    name: 'Pikachu',
    image: 'https://assets.tcgdex.net/en/sv/sv01/025',
    rarity: 'Common',
    set: { id: 'sv01', name: 'Scarlet & Violet', cardCount: { total: 258, official: 198 } },
    pricing: {
      tcgplayer: {
        unit: 'USD',
        updated: '2026-09-01T00:00:00Z',
        normal: { productId: 478000, marketPrice: 0.21, midPrice: 0.3 },
        'reverse-holofoil': { productId: 478000, marketPrice: 0.95 },
      },
      cardmarket: { unit: 'EUR', trend: 0.12, 'trend-holo': 0.5 },
    },
  };

  it('identifies a card from its collector number and set size alone', async () => {
    const calls = mockFetch({
      'https://api.tcgdex.net/v2/en/sets': [
        { id: 'sv01', name: 'Scarlet & Violet', cardCount: { total: 258, official: 198 } },
        { id: 'swsh1', name: 'Sword & Shield', cardCount: { total: 216, official: 202 } },
      ],
      'https://api.tcgdex.net/v2/en/sets/sv01/025': pikachu,
    });
    const { pokemon } = await import('./pokemon');
    const hints = parseScan('', 'SVI EN 025/198');
    const [best] = await pokemon.identify(hints);
    expect(best.name).toBe('Pikachu');
    expect(best.number).toBe('025/198');
    expect(best.prices).toMatchObject({ usd: 0.21, usdFoil: 0.95, eur: 0.12, eurFoil: 0.5 });
    expect(best.imageSmall).toBe('https://assets.tcgdex.net/en/sv/sv01/025/low.webp');
    expect(best.url).toBe('https://www.tcgplayer.com/product/478000');
    expect(calls).not.toContain('https://api.tcgdex.net/v2/en/sets/swsh1/025');
  });

  it('falls back to a name search filtered by number', async () => {
    mockFetch({
      'https://api.tcgdex.net/v2/en/cards?name=Pikachu': [
        { id: 'base1-58', localId: '58', name: 'Pikachu' },
        { id: 'sv01-025', localId: '025', name: 'Pikachu' },
      ],
      'https://api.tcgdex.net/v2/en/cards/sv01-025': pikachu,
      'https://api.tcgdex.net/v2/en/cards/base1-58': { ...pikachu, id: 'base1-58', localId: '58' },
    });
    const { pokemon } = await import('./pokemon');
    // Number without a readable set size.
    const hints = { ...parseScan('BASIC Pikachu HP 60', ''), pokemonNumbers: [{ number: '25' }] };
    const results = await pokemon.identify(hints);
    expect(results.map((c) => c.id)).toEqual(['sv01-025']);
  });
});

describe('Magic (Scryfall)', () => {
  const bolt = {
    id: 'abc',
    oracle_id: 'o1',
    name: 'Lightning Bolt',
    set: 'm11',
    set_name: 'Magic 2011',
    collector_number: '149',
    rarity: 'common',
    games: ['paper'],
    image_uris: { small: 's.jpg', normal: 'n.jpg', large: 'l.jpg' },
    prices: { usd: '1.50', usd_foil: '5.00', eur: '1.20', eur_foil: null },
    purchase_uris: { tcgplayer: 'https://tcgplayer.example/bolt' },
  };

  it('looks up an exact printing from set code and collector number', async () => {
    mockFetch({ 'https://api.scryfall.com/cards/m11/149': bolt });
    const { magic } = await import('./magic');
    const [best] = await magic.identify(parseScan('', '0149 C\nM11 • EN'));
    expect(best).toMatchObject({ name: 'Lightning Bolt', setCode: 'M11', number: '149' });
    expect(best.prices).toMatchObject({ usd: 1.5, usdFoil: 5, eur: 1.2 });
  });

  it('puts Marvel printings first in Marvel mode', async () => {
    const spidey = { ...bolt, id: 'spm1', set: 'spm', set_name: "Marvel's Spider-Man", collector_number: '10' };
    mockFetch({
      'https://api.scryfall.com/cards/named?fuzzy=Lightning%20Bolt': bolt,
      'https://api.scryfall.com/cards/search?q=oracleid%3Ao1&unique=prints&order=released': { data: [bolt, spidey] },
    });
    const { magic } = await import('./magic');
    const results = await magic.identify(parseScan('Lightning Bolt', ''), { marvelOnly: true });
    expect(results[0]).toMatchObject({ id: 'spm1', isMarvel: true });
  });
});

describe('One Piece (Punk Records + OPTCG API)', () => {
  const routes: Routes = {
    'https://raw.githubusercontent.com/buhbbl/punk-records/main/english/index/cards_by_id.json': cardsFixture,
    'https://raw.githubusercontent.com/buhbbl/punk-records/main/english/packs.json': packsFixture,
    'https://optcgapi.com/api/sets/card/OP01-001/': [
      { card_image_id: 'OP01-001', market_price: 0.35 },
      { card_image_id: 'OP01-001_p1', market_price: 12.5 },
    ],
  };

  it('returns every printing of the scanned card id, with prices', async () => {
    mockFetch(routes);
    const { onepiece } = await import('./onepiece');
    const results = await onepiece.identify(parseScan('', 'L OP01-001 LEADER'));
    expect(results.map((c) => c.id)).toEqual(['OP01-001', 'OP01-001_p1', 'OP01-001_p2']);
    expect(results[0]).toMatchObject({ name: 'Roronoa Zoro', setName: 'ROMANCE DAWN [OP-01]', prices: { usd: 0.35 } });
    expect(results[1]).toMatchObject({ variant: 'Alternate art 1', prices: { usd: 12.5 } });
    expect(results[2].prices).toBeUndefined();
  });

  it('recovers from a single misread digit using the card name', async () => {
    mockFetch(routes);
    const { onepiece } = await import('./onepiece');
    // The card says OP01-016 (Nami) but OCR read OP01-026, which doesn't exist
    // here. Its one-digit neighbours include Nami and several others.
    const hints = { ...parseScan('', 'OP01-026'), names: ['Nami'] };
    const results = await onepiece.identify(hints);
    expect(results[0]).toMatchObject({ id: 'OP01-016', name: 'Nami' });
  });

  it('still identifies cards when the price API is unreachable', async () => {
    mockFetch({ ...routes, 'https://optcgapi.com/api/sets/card/OP01-001/': () => { throw new Error('CORS'); } });
    const { onepiece } = await import('./onepiece');
    const results = await onepiece.identify(parseScan('', 'OP01-001'));
    expect(results[0].name).toBe('Roronoa Zoro');
  });

  it('searches by name and by id prefix', async () => {
    mockFetch(routes);
    const { onepiece } = await import('./onepiece');
    const byName = await onepiece.search('chopper');
    expect(byName[0].name).toBe('Tony Tony.Chopper');
    const byId = await onepiece.search('ST01-012');
    expect(byId.every((c) => c.id.startsWith('ST01-012'))).toBe(true);
  });
});

describe('auto game detection', () => {
  it('routes a One Piece scan to the One Piece provider', async () => {
    mockFetch({
      'https://raw.githubusercontent.com/buhbbl/punk-records/main/english/index/cards_by_id.json': cardsFixture,
      'https://raw.githubusercontent.com/buhbbl/punk-records/main/english/packs.json': packsFixture,
    });
    const { identifyCard } = await import('./index');
    const res = await identifyCard('auto', parseScan('', 'OP01-013 ©EIICHIRO ODA/SHUEISHA'));
    expect(res.game).toBe('onepiece');
    expect(res.candidates[0].name).toBe('Sanji');
  });
});

describe('Magic set code OCR repair', () => {
  it('tries letter/digit swaps when the exact set code misses', async () => {
    mockFetch({ 'https://api.scryfall.com/cards/m11/149': { id: 'b', name: 'Lightning Bolt', set: 'm11', set_name: 'Magic 2011', collector_number: '149' } });
    const { magic, setCodeVariants } = await import('./magic');
    expect(setCodeVariants('mi1')).toContain('m11');
    const [best] = await magic.identify(parseScan('', '0149 C\nMI1 • EN'));
    expect(best?.setCode).toBe('M11');
  });
});

describe('auto mode fallbacks', () => {
  it('falls back to a One Piece name search when only a name was readable', async () => {
    mockFetch({
      'https://api.tcgdex.net/v2/en/cards?name=Sanji': [],
      'https://raw.githubusercontent.com/buhbbl/punk-records/main/english/index/cards_by_id.json': cardsFixture,
      'https://raw.githubusercontent.com/buhbbl/punk-records/main/english/packs.json': packsFixture,
    });
    const { identifyCard } = await import('./index');
    const hints = { ...parseScan('', ''), names: ['Sanji'] };
    const res = await identifyCard('auto', hints);
    expect(res.game).toBe('onepiece');
    expect(res.candidates[0].name).toBe('Sanji');
  });
});
