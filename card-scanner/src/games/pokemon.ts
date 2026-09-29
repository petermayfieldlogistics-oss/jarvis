import { fetchJson, fetchJsonOrNull, mapLimit } from '../lib/http';
import { nameSimilarity } from '../lib/fuzzy';
import type { CardInfo, GameProvider, Prices, ScanHints } from '../types';

// TCGdex: free, open-source Pokémon TCG API with TCGplayer and Cardmarket prices.
// https://tcgdex.dev
const API = 'https://api.tcgdex.net/v2/en';

interface TcgdexBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

interface TcgdexSetBrief {
  id: string;
  name: string;
  cardCount: { total: number; official: number };
}

type TcgplayerVariant = { marketPrice?: number | null; midPrice?: number | null; productId?: number };

export interface TcgdexCard extends TcgdexBrief {
  rarity?: string;
  set: TcgdexSetBrief;
  pricing?: {
    tcgplayer?: ({ updated?: string; unit?: string } & Record<string, TcgplayerVariant | string | undefined>) | null;
    cardmarket?: ({ updated?: string; unit?: string } & Record<string, number | string | null | undefined>) | null;
  };
}

const NON_FOIL_KEYS = ['normal', 'unlimited', '1st-edition', '1st-edition-normal', 'unlimited-normal'];
const FOIL_KEYS = ['holofoil', 'reverse-holofoil', 'holo', 'reverse', 'unlimited-holofoil', '1st-edition-holofoil'];

function variantPrice(v: unknown): number | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { marketPrice, midPrice } = v as TcgplayerVariant;
  const p = marketPrice ?? midPrice;
  return typeof p === 'number' && p > 0 ? p : undefined;
}

export function tcgdexPrices(card: TcgdexCard): Prices | undefined {
  const tp = card.pricing?.tcgplayer;
  const cm = card.pricing?.cardmarket;
  const prices: Prices = {};
  if (tp) {
    const first = (keys: string[]) => keys.map((k) => variantPrice(tp[k])).find((p) => p !== undefined);
    prices.usd = first(NON_FOIL_KEYS);
    prices.usdFoil = first(FOIL_KEYS);
    // Holo-only cards (most rares) have no "normal" price; use the holo one.
    if (prices.usd === undefined) prices.usd = prices.usdFoil;
    if (prices.usd !== undefined) prices.source = 'TCGplayer';
    prices.updatedAt = tp.updated;
  }
  if (cm) {
    const num = (k: string) => (typeof cm[k] === 'number' && (cm[k] as number) > 0 ? (cm[k] as number) : undefined);
    prices.eur = num('trend') ?? num('avg');
    prices.eurFoil = num('trend-holo') ?? num('avg-holo');
    prices.source ??= prices.eur !== undefined ? 'Cardmarket' : undefined;
    prices.updatedAt ??= cm.updated as string | undefined;
  }
  return Object.values(prices).some((v) => typeof v === 'number') ? prices : undefined;
}

function tcgplayerUrl(card: TcgdexCard): string {
  const tp = card.pricing?.tcgplayer;
  const productId = tp
    ? Object.values(tp)
        .map((v) => (v && typeof v === 'object' ? (v as TcgplayerVariant).productId : undefined))
        .find(Boolean)
    : undefined;
  return productId
    ? `https://www.tcgplayer.com/product/${productId}`
    : `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(`${card.name} ${card.set.name}`)}`;
}

export function toCardInfo(card: TcgdexCard): CardInfo {
  return {
    key: `pokemon:${card.id}`,
    game: 'pokemon',
    id: card.id,
    name: card.name,
    setName: card.set?.name,
    setCode: card.set?.id,
    number: card.set?.cardCount?.official ? `${card.localId}/${card.set.cardCount.official}` : card.localId,
    rarity: card.rarity,
    imageSmall: card.image ? `${card.image}/low.webp` : undefined,
    imageLarge: card.image ? `${card.image}/high.webp` : undefined,
    prices: tcgdexPrices(card),
    url: tcgplayerUrl(card),
  };
}

function getCard(id: string, fresh = false): Promise<TcgdexCard | null> {
  return fetchJsonOrNull<TcgdexCard>(`${API}/cards/${encodeURIComponent(id)}`, { cache: !fresh });
}

function getSets(): Promise<TcgdexSetBrief[]> {
  return fetchJson<TcgdexSetBrief[]>(`${API}/sets`);
}

function searchByName(name: string): Promise<TcgdexBrief[]> {
  return fetchJson<TcgdexBrief[]>(`${API}/cards?name=${encodeURIComponent(name)}`).catch(() => []);
}

/** "025" and "25" are the same collector number; "TG05" only matches "TG05". */
function sameNumber(a: string, b: string): boolean {
  const na = a.toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1');
  const nb = b.toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1');
  return na === nb;
}

async function identify(hints: ScanHints): Promise<CardInfo[]> {
  const scored = new Map<string, { card: TcgdexCard; score: number }>();
  const consider = (card: TcgdexCard | null, score: number) => {
    if (!card) return;
    const prev = scored.get(card.id);
    if (!prev || prev.score < score) scored.set(card.id, { card, score });
  };

  const numbers = hints.pokemonNumbers.slice(0, 3);
  const names = hints.names.slice(0, 3);

  // 1) Number + set size ("025/198") pins a card down without needing the name.
  const numbered = numbers.filter((n) => n.total && /^\d+$/.test(n.total));
  if (numbered.length) {
    const sets = await getSets().catch(() => []);
    await Promise.all(
      numbered.flatMap(({ number, total }) => {
        const matchingSets = sets.filter((s) => s.cardCount?.official === parseInt(total!, 10)).slice(0, 8);
        const localIds = [...new Set([number, number.replace(/^0+(?=\d)/, '')])];
        return matchingSets.map(async (set) => {
          for (const localId of localIds) {
            const card = await fetchJsonOrNull<TcgdexCard>(`${API}/sets/${set.id}/${localId}`).catch(() => null);
            if (card) {
              const nameBonus = names.length ? Math.max(...names.map((n) => nameSimilarity(n, card.name))) * 4 : 0;
              consider(card, 6 + nameBonus);
              return;
            }
          }
        });
      }),
    );
  }

  // 2) Name search, narrowed by collector number when we have one.
  for (const name of names) {
    let briefs = await searchByName(name);
    if (!briefs.length) {
      // OCR may have mangled a suffix or second word; retry with the first word.
      const first = name.split(' ')[0];
      if (first.length >= 4 && first !== name) briefs = await searchByName(first);
    }
    if (!briefs.length) continue;

    let pool = briefs;
    if (numbers.length) {
      const withNumber = briefs.filter((b) => numbers.some((n) => sameNumber(b.localId, n.number)));
      if (withNumber.length) pool = withNumber;
    }
    pool = [...pool].sort((a, b) => nameSimilarity(name, b.name) - nameSimilarity(name, a.name)).slice(0, 12);
    const cards = await mapLimit(pool, 6, (b) => getCard(b.id).catch(() => null));
    for (const card of cards) {
      if (!card) continue;
      let score = nameSimilarity(name, card.name) * 4;
      for (const n of numbers) {
        if (sameNumber(card.localId, n.number)) score += 3;
        if (n.total && String(card.set?.cardCount?.official) === n.total.replace(/^0+/, '')) score += 2;
      }
      consider(card, score);
    }
    if (scored.size >= 3) break;
  }

  return [...scored.values()].sort((a, b) => b.score - a.score).map((s) => toCardInfo(s.card));
}

async function search(query: string): Promise<CardInfo[]> {
  const q = query.trim();
  if (!q) return [];
  const briefs = await searchByName(q);
  const ranked = [...briefs].sort((a, b) => nameSimilarity(q, b.name) - nameSimilarity(q, a.name)).slice(0, 24);
  const cards = await mapLimit(ranked, 6, (b) => getCard(b.id).catch(() => null));
  return cards.filter((c): c is TcgdexCard => !!c).map(toCardInfo);
}

async function refresh(cards: CardInfo[]): Promise<Map<string, CardInfo>> {
  const out = new Map<string, CardInfo>();
  await mapLimit(cards, 4, async (c) => {
    const card = await getCard(c.id, true).catch(() => null);
    if (card) out.set(c.key, toCardInfo(card));
  });
  return out;
}

export const pokemon: GameProvider = {
  id: 'pokemon',
  label: 'Pokémon',
  search,
  identify,
  refresh,
};
