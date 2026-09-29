import { fetchJsonOrNull, mapLimit } from '../lib/http';
import { nameSimilarity } from '../lib/fuzzy';
import type { CardInfo, GameProvider, Prices, ScanHints } from '../types';

// Lorcast: free Disney Lorcana API with TCGplayer prices (modelled on Scryfall).
// https://lorcast.com/docs/api — asks for 50–100 ms between requests.
const API = 'https://api.lorcast.com/v0';

interface ImageSizes {
  small?: string;
  normal?: string;
  large?: string;
}

export interface LorcastCard {
  id: string;
  name: string;
  version?: string | null;
  collector_number: string;
  rarity?: string;
  set: { id?: string; code: string; name: string };
  image_uris?: { digital?: ImageSizes };
  prices?: { usd?: string | null; usd_foil?: string | null };
  tcgplayer_id?: number | null;
}

function price(v: string | null | undefined): number | undefined {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** "Mickey Mouse - Brave Little Tailor": Lorcana cards are a character plus a version. */
function fullName(c: LorcastCard): string {
  return c.version ? `${c.name} - ${c.version}` : c.name;
}

export function toCardInfo(c: LorcastCard): CardInfo {
  const img = c.image_uris?.digital;
  const prices: Prices = { usd: price(c.prices?.usd), usdFoil: price(c.prices?.usd_foil), source: 'TCGplayer (Lorcast)' };
  // Enchanted and other foil-only cards only have a foil price.
  if (prices.usd === undefined) prices.usd = prices.usdFoil;
  return {
    key: `lorcana:${c.id}`,
    game: 'lorcana',
    id: c.id,
    name: fullName(c),
    setName: c.set.name,
    setCode: c.set.code,
    number: c.collector_number,
    rarity: c.rarity?.replace(/_/g, ' '),
    imageSmall: img?.normal ?? img?.small,
    imageLarge: img?.large ?? img?.normal,
    prices: prices.usd !== undefined ? prices : undefined,
    url: c.tcgplayer_id
      ? `https://www.tcgplayer.com/product/${c.tcgplayer_id}`
      : `https://www.tcgplayer.com/search/lorcana-tcg/product?q=${encodeURIComponent(fullName(c))}`,
  };
}

function getCard(set: string, number: string, fresh = false): Promise<LorcastCard | null> {
  return fetchJsonOrNull<LorcastCard>(`${API}/cards/${encodeURIComponent(set)}/${encodeURIComponent(number)}`, {
    cache: !fresh,
  });
}

async function searchCards(q: string): Promise<LorcastCard[]> {
  const res = await fetchJsonOrNull<{ results?: LorcastCard[] }>(`${API}/cards/search?q=${encodeURIComponent(q)}`);
  return res?.results ?? [];
}

function bestSimilarity(query: string, c: LorcastCard): number {
  return Math.max(
    nameSimilarity(query, fullName(c)),
    nameSimilarity(query, c.name),
    c.version ? nameSimilarity(query, c.version) : 0,
  );
}

async function identify(hints: ScanHints): Promise<CardInfo[]> {
  const scored = new Map<string, { card: LorcastCard; score: number }>();
  const consider = (card: LorcastCard | null, score: number) => {
    if (!card) return;
    const prev = scored.get(card.id);
    if (!prev || prev.score < score) scored.set(card.id, { card, score });
  };

  // 1) "12/204 • EN • 3" → set 3, card 12.
  for (const p of hints.lorcanaPrints.slice(0, 3)) {
    consider(await getCard(p.set, p.number).catch(() => null), 20);
  }

  // 2) Name search (character name, optionally with the version).
  if (!scored.size) {
    const numbers = hints.lorcanaPrints.map((p) => p.number);
    for (const name of hints.names.slice(0, 3)) {
      let cards = await searchCards(name).catch(() => []);
      // OCR noise in a long name can sink the search; retry with the first word.
      const first = name.split(' ')[0];
      if (!cards.length && first.length >= 3 && first !== name) cards = await searchCards(first).catch(() => []);
      for (const card of cards.slice(0, 40)) {
        const sim = bestSimilarity(name, card);
        if (sim < 0.6) continue;
        consider(card, sim * 5 + (numbers.includes(card.collector_number) ? 4 : 0));
      }
      if (scored.size) break;
    }
  }
  return [...scored.values()].sort((a, b) => b.score - a.score).map((s) => toCardInfo(s.card));
}

async function search(query: string): Promise<CardInfo[]> {
  const q = query.trim();
  if (!q) return [];
  const cards = await searchCards(q);
  return [...cards]
    .sort((a, b) => bestSimilarity(q, b) - bestSimilarity(q, a))
    .slice(0, 60)
    .map(toCardInfo);
}

async function refresh(cards: CardInfo[]): Promise<Map<string, CardInfo>> {
  const out = new Map<string, CardInfo>();
  await mapLimit(cards, 2, async (c) => {
    if (!c.setCode || !c.number) return;
    const card = await getCard(c.setCode, c.number, true).catch(() => null);
    if (card) out.set(c.key, toCardInfo(card));
  });
  return out;
}

export const lorcana: GameProvider = {
  id: 'lorcana',
  label: 'Lorcana',
  search,
  identify,
  refresh,
};
