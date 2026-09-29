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

describe('Yu-Gi-Oh! (YGOPRODeck)', () => {
  const blueEyes = {
    id: 89631139,
    name: 'Blue-Eyes White Dragon',
    ygoprodeck_url: 'https://ygoprodeck.com/card/blue-eyes-white-dragon-7485',
    card_sets: [
      { set_name: 'Legend of Blue Eyes White Dragon', set_code: 'LOB-EN001', set_rarity: 'Ultra Rare', set_rarity_code: '(UR)', set_price: '98.50' },
      { set_name: 'Legendary Collection', set_code: 'LC01-EN004', set_rarity: 'Ultra Rare', set_rarity_code: '(UR)', set_price: '4.10' },
      { set_name: 'Legendary Collection', set_code: 'LC01-EN004', set_rarity: 'Secret Rare', set_rarity_code: '(ScR)', set_price: '0' },
    ],
    card_images: [{ id: 89631139, image_url: 'https://images.ygoprodeck.com/images/cards/89631139.jpg', image_url_small: 'https://images.ygoprodeck.com/images/cards_small/89631139.jpg' }],
    card_prices: [{ tcgplayer_price: '1.99', cardmarket_price: '0.80' }],
  };

  it('identifies the exact printing from the set code', async () => {
    mockFetch({
      'https://db.ygoprodeck.com/api/v7/cardsetsinfo.php?setcode=LC01-EN004': { id: 89631139, name: 'Blue-Eyes White Dragon', set_code: 'LC01-EN004', set_rarity: 'Secret Rare' },
      'https://db.ygoprodeck.com/api/v7/cardinfo.php?id=89631139': { data: [blueEyes] },
    });
    const { yugioh } = await import('./yugioh');
    const results = await yugioh.identify(parseScan('', 'LC01-EN004 89631139 KONAMI'));
    expect(results.slice(0, 2).map((c) => [c.setCode, c.rarity])).toEqual([
      ['LC01-EN004', 'Secret Rare'],
      ['LC01-EN004', 'Ultra Rare'],
    ]);
    // No price for that printing → falls back to the card's TCGplayer price.
    expect(results[0].prices).toMatchObject({ usd: 1.99, eur: 0.8, source: 'TCGplayer' });
    expect(results[1].prices).toMatchObject({ usd: 4.1 });
    expect(results[0].key).toBe('yugioh:89631139:LC01-EN004:(ScR)');
  });

  it('identifies the card from its passcode and lists its printings', async () => {
    mockFetch({ 'https://db.ygoprodeck.com/api/v7/cardinfo.php?id=89631139': { data: [blueEyes] } });
    const { yugioh } = await import('./yugioh');
    const results = await yugioh.identify(parseScan('', '89631139'));
    expect(results[0]).toMatchObject({ name: 'Blue-Eyes White Dragon', setName: 'Any printing', prices: { usd: 1.99 } });
    expect(results).toHaveLength(4);
  });

  it('treats "no card found" (HTTP 400) as no results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"No card matching your query"}', { status: 400 })));
    const { yugioh } = await import('./yugioh');
    expect(await yugioh.search('zzzz')).toEqual([]);
  });

  it('refreshes prices for a batch of ids and keeps each printing', async () => {
    const calls = mockFetch({
      'https://db.ygoprodeck.com/api/v7/cardinfo.php?id=89631139': { data: [{ ...blueEyes, card_sets: [{ ...blueEyes.card_sets[0], set_price: '120.00' }] }] },
    });
    const { yugioh, toCardInfo } = await import('./yugioh');
    const owned = toCardInfo(blueEyes, blueEyes.card_sets[0]);
    const fresh = await yugioh.refresh([owned]);
    expect(fresh.get(owned.key)?.prices?.usd).toBe(120);
    expect(calls).toHaveLength(1);
  });
});

describe('Lorcana (Lorcast)', () => {
  const elsa = {
    id: 'crd_elsa',
    name: 'Elsa',
    version: 'Spirit of Winter',
    collector_number: '42',
    rarity: 'Super_rare',
    set: { id: 'set_1', code: '1', name: 'The First Chapter' },
    image_uris: { digital: { small: 's.avif', normal: 'n.avif', large: 'l.avif' } },
    prices: { usd: '35.84', usd_foil: '56.27' },
    tcgplayer_id: 508965,
  };

  it('identifies a card from the collector line', async () => {
    mockFetch({ 'https://api.lorcast.com/v0/cards/1/42': elsa });
    const { lorcana } = await import('./lorcana');
    const [best] = await lorcana.identify(parseScan('', '42/204 • EN • 1 ©Disney'));
    expect(best).toMatchObject({
      name: 'Elsa - Spirit of Winter',
      setName: 'The First Chapter',
      number: '42',
      rarity: 'Super rare',
      prices: { usd: 35.84, usdFoil: 56.27 },
      url: 'https://www.tcgplayer.com/product/508965',
    });
  });

  it('falls back to a name search', async () => {
    mockFetch({ 'https://api.lorcast.com/v0/cards/search?q=Elsa%20Spirit%20of%20Winter': { results: [elsa, { ...elsa, id: 'crd_other', name: 'Anna', version: 'Heir to Arendelle' }] } });
    const { lorcana } = await import('./lorcana');
    const results = await lorcana.identify({ ...parseScan('', ''), names: ['Elsa Spirit of Winter'] });
    expect(results.map((c) => c.id)).toEqual(['crd_elsa']);
  });
});

describe('name-only scans in "Any game" mode', () => {
  it('keeps the game whose answer matches the name best, not the first to answer', async () => {
    mockFetch({
      'https://raw.githubusercontent.com/buhbbl/punk-records/main/english/index/cards_by_id.json': cardsFixture,
      'https://raw.githubusercontent.com/buhbbl/punk-records/main/english/packs.json': packsFixture,
      'https://api.lorcast.com/v0/cards/search?q=ELSA%20Spirit%20of%20Winter': {
        results: [{ id: 'crd_elsa', name: 'Elsa', version: 'Spirit of Winter', collector_number: '42', set: { code: '1', name: 'The First Chapter' } }],
      },
    });
    const { identifyCard } = await import('./index');
    // "Nami Queen" is a loose One Piece match; the Lorcana name is exact.
    const hints = { ...parseScan('', ''), names: ['ELSA Spirit of Winter', 'Nami Queen'] };
    const res = await identifyCard('auto', hints);
    expect(res.game).toBe('lorcana');
    expect(res.candidates[0].name).toBe('Elsa - Spirit of Winter');
    expect(res.confident).toBe(true);
    // Other games' looser matches are still offered further down.
    expect(res.candidates.some((c) => c.game === 'onepiece')).toBe(true);
  });

  it('flags a fuzzy name-only match as a guess', async () => {
    mockFetch({
      'https://raw.githubusercontent.com/buhbbl/punk-records/main/english/index/cards_by_id.json': cardsFixture,
      'https://raw.githubusercontent.com/buhbbl/punk-records/main/english/packs.json': packsFixture,
    });
    const { identifyCard } = await import('./index');
    const res = await identifyCard('auto', { ...parseScan('', ''), names: ['Sanjii'] });
    expect(res.candidates[0].name).toBe('Sanji');
    expect(res.confident).toBe(false);
  });
});
