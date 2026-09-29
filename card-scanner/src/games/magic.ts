import { fetchJson, fetchJsonOrNull, HttpError } from '../lib/http';
import { nameSimilarity } from '../lib/fuzzy';
import type { CardInfo, GameProvider, Prices, ScanHints } from '../types';

// Scryfall: free Magic: The Gathering API with daily TCGplayer/Cardmarket prices.
// https://scryfall.com/docs/api
const API = 'https://api.scryfall.com';

interface ImageUris {
  small?: string;
  normal?: string;
  large?: string;
}

export interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity?: string;
  lang?: string;
  games?: string[];
  image_uris?: ImageUris;
  card_faces?: { name: string; image_uris?: ImageUris }[];
  prices?: Record<string, string | null>;
  purchase_uris?: Record<string, string>;
  scryfall_uri?: string;
  border_color?: string;
  frame_effects?: string[];
  full_art?: boolean;
  promo?: boolean;
  finishes?: string[];
  released_at?: string;
}

interface ScryfallList {
  data: ScryfallCard[];
  has_more?: boolean;
}

/** Marvel cards live in Magic's "Universes Beyond" Marvel sets (Spider-Man, Marvel Super Heroes, …). */
export const MARVEL_SET_NAME = /marvel|spider-man/i;

function price(v: string | null | undefined): number | undefined {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function variantLabel(c: ScryfallCard): string | undefined {
  const parts: string[] = [];
  if (c.border_color === 'borderless') parts.push('Borderless');
  if (c.frame_effects?.includes('showcase')) parts.push('Showcase');
  if (c.frame_effects?.includes('extendedart')) parts.push('Extended art');
  if (c.full_art) parts.push('Full art');
  if (c.finishes?.length === 1 && c.finishes[0] === 'etched') parts.push('Etched');
  if (c.promo) parts.push('Promo');
  return parts.length ? parts.join(', ') : undefined;
}

export function toCardInfo(c: ScryfallCard): CardInfo {
  const images = c.image_uris ?? c.card_faces?.[0]?.image_uris;
  const prices: Prices = {
    usd: price(c.prices?.usd),
    usdFoil: price(c.prices?.usd_foil) ?? price(c.prices?.usd_etched),
    eur: price(c.prices?.eur),
    eurFoil: price(c.prices?.eur_foil),
    source: 'Scryfall',
  };
  // Foil-only printings only have a foil price.
  if (prices.usd === undefined && c.finishes && !c.finishes.includes('nonfoil')) prices.usd = prices.usdFoil;
  return {
    key: `magic:${c.id}`,
    game: 'magic',
    id: c.id,
    name: c.name,
    setName: c.set_name,
    setCode: c.set.toUpperCase(),
    number: c.collector_number,
    rarity: c.rarity ? c.rarity[0].toUpperCase() + c.rarity.slice(1) : undefined,
    variant: variantLabel(c),
    imageSmall: images?.normal ?? images?.small,
    imageLarge: images?.large ?? images?.normal,
    prices: prices.usd !== undefined || prices.eur !== undefined || prices.usdFoil !== undefined ? prices : undefined,
    url: c.purchase_uris?.tcgplayer ?? c.scryfall_uri,
    isMarvel: MARVEL_SET_NAME.test(c.set_name),
  };
}

const isPaper = (c: ScryfallCard) => !c.games || c.games.includes('paper');

/** Set codes mix letters and digits ("m11", "2x2"), which OCR swaps: "mi1" → "m11". */
export function setCodeVariants(code: string): string[] {
  return [
    ...new Set([
      code,
      code.replace(/[il]/g, '1'),
      code.replace(/o/g, '0'),
      code.replace(/1/g, 'i'),
      code.replace(/0/g, 'o'),
    ]),
  ];
}

async function searchCards(q: string, extra = ''): Promise<ScryfallCard[]> {
  const url = `${API}/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=released${extra}`;
  const list = await fetchJsonOrNull<ScryfallList>(url);
  return (list?.data ?? []).filter(isPaper);
}

function marvelFirst(cards: CardInfo[], marvelOnly?: boolean): CardInfo[] {
  if (!marvelOnly) return cards;
  const marvel = cards.filter((c) => c.isMarvel);
  return marvel.length ? [...marvel, ...cards.filter((c) => !c.isMarvel)] : cards;
}

async function identify(hints: ScanHints, opts?: { marvelOnly?: boolean }): Promise<CardInfo[]> {
  const scored = new Map<string, { card: ScryfallCard; score: number }>();
  const consider = (card: ScryfallCard, score: number) => {
    const prev = scored.get(card.id);
    if (!prev || prev.score < score) scored.set(card.id, { card, score });
  };

  // 1) Set code + collector number is an exact printing.
  for (const p of hints.magicPrints) {
    if (!p.set || !p.number) continue;
    for (const set of setCodeVariants(p.set)) {
      const card = await fetchJsonOrNull<ScryfallCard>(`${API}/cards/${set}/${p.number}`).catch(() => null);
      if (card) {
        consider(card, 20);
        break;
      }
    }
  }

  // 2) Fuzzy name → all printings of that card, ranked by what else we read.
  const setCodes = hints.magicPrints.flatMap((p) => (p.set ? setCodeVariants(p.set) : []));
  const numbers = [
    ...hints.magicPrints.map((p) => p.number),
    ...hints.pokemonNumbers.map((n) => n.number.replace(/^0+(?=\d)/, '')),
  ].filter(Boolean) as string[];

  for (const name of hints.names.slice(0, 3)) {
    const named = await fetchJsonOrNull<ScryfallCard>(`${API}/cards/named?fuzzy=${encodeURIComponent(name)}`).catch(
      () => null,
    );
    if (!named) continue;
    const prints = named.oracle_id ? await searchCards(`oracleid:${named.oracle_id}`).catch(() => [named]) : [named];
    for (const card of prints.slice(0, 60)) {
      let score = 5 + nameSimilarity(name, card.name) * 2;
      if (setCodes.includes(card.set)) score += 6;
      if (numbers.includes(card.collector_number)) score += 4;
      consider(card, score);
    }
    break;
  }

  const ranked = [...scored.values()].sort((a, b) => b.score - a.score).map((s) => toCardInfo(s.card));
  return marvelFirst(ranked, opts?.marvelOnly).slice(0, 40);
}

async function search(query: string, opts?: { marvelOnly?: boolean }): Promise<CardInfo[]> {
  const q = query.trim();
  if (!q) return [];
  let cards = await searchCards(q).catch(() => []);
  if (!cards.length) {
    // Typos: Scryfall's fuzzy lookup, then every printing of that card.
    const named = await fetchJsonOrNull<ScryfallCard>(`${API}/cards/named?fuzzy=${encodeURIComponent(q)}`).catch(
      () => null,
    );
    if (named?.oracle_id) cards = await searchCards(`oracleid:${named.oracle_id}`).catch(() => [named]);
  }
  return marvelFirst(cards.map(toCardInfo), opts?.marvelOnly).slice(0, 60);
}

async function refresh(cards: CardInfo[]): Promise<Map<string, CardInfo>> {
  const out = new Map<string, CardInfo>();
  // /cards/collection takes up to 75 cards per request.
  for (let i = 0; i < cards.length; i += 75) {
    const batch = cards.slice(i, i + 75);
    try {
      const res = await fetchJson<ScryfallList>(`${API}/cards/collection`, {
        cache: false,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifiers: batch.map((c) => ({ id: c.id })) }),
        },
      });
      for (const card of res.data) out.set(`magic:${card.id}`, toCardInfo(card));
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
    }
  }
  return out;
}

export const magic: GameProvider = {
  id: 'magic',
  label: 'Magic: The Gathering',
  search,
  identify,
  refresh,
};
