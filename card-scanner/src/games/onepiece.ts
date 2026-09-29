import { fetchJson } from '../lib/http';
import { safeGet, safeSet } from '../lib/storage';
import { nameSimilarity, normalizeName } from '../lib/fuzzy';
import type { CardInfo, GameProvider, ScanHints } from '../types';

// Card list: Punk Records, a static dataset built from the official One Piece
// card list and served from GitHub (free, no API key, works in any browser).
// https://github.com/buhbbl/punk-records
const DATA = 'https://raw.githubusercontent.com/buhbbl/punk-records/main/english';
// Prices: OPTCG API (TCGplayer market prices). Best-effort — if it's down or
// blocked we still identify the card, just without a price.
// https://optcgapi.com
const PRICE_API = 'https://optcgapi.com/api';

export interface PunkCard {
  card_id: string;
  name: string;
  pack_id: string;
  rarity?: string;
  category?: string;
  colors?: string[];
  img_url?: string;
}

interface PunkPack {
  id: string;
  raw_title?: string;
  title_parts?: { label?: string; prefix?: string; title?: string };
}

export interface OnePieceIndex {
  cards: Record<string, PunkCard>;
  packs: Record<string, PunkPack>;
}

interface OptcgPrice {
  card_image_id?: string;
  card_set_id?: string;
  market_price?: number | null;
  inventory_price?: number | null;
}

const CACHE_KEY = 'onepiece-index-v1';
const CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

let indexPromise: Promise<OnePieceIndex> | null = null;

export function loadIndex(): Promise<OnePieceIndex> {
  indexPromise ??= (async () => {
    const cached = await safeGet<{ savedAt: number; index: OnePieceIndex }>(CACHE_KEY);
    if (cached && Date.now() - cached.savedAt < CACHE_MAX_AGE_MS) return cached.index;
    try {
      const [cards, packs] = await Promise.all([
        fetchJson<Record<string, PunkCard>>(`${DATA}/index/cards_by_id.json`, { timeoutMs: 30000 }),
        fetchJson<Record<string, PunkPack>>(`${DATA}/packs.json`, { timeoutMs: 30000 }),
      ]);
      const index = { cards, packs };
      void safeSet(CACHE_KEY, { savedAt: Date.now(), index });
      return index;
    } catch (err) {
      // Offline: an old copy is better than nothing.
      if (cached) return cached.index;
      throw err;
    }
  })();
  indexPromise.catch(() => (indexPromise = null));
  return indexPromise;
}

/** "OP01-001_p2" → "OP01-001". */
export function baseId(cardId: string): string {
  return cardId.split('_')[0];
}

function variantLabel(cardId: string): string | undefined {
  const m = cardId.match(/_(p|r)(\d+)$/);
  if (!m) return undefined;
  return m[1] === 'p' ? `Alternate art ${m[2]}` : `Reprint ${m[2]}`;
}

function packName(index: OnePieceIndex, packId: string): string | undefined {
  const pack = index.packs[packId];
  if (!pack) return undefined;
  const { label, title, prefix } = pack.title_parts ?? {};
  if (title) return label ? `${title} [${label}]` : title;
  return pack.raw_title ?? prefix;
}

export function toCardInfo(index: OnePieceIndex, card: PunkCard): CardInfo {
  const id = baseId(card.card_id);
  return {
    key: `onepiece:${card.card_id}`,
    game: 'onepiece',
    id: card.card_id,
    name: card.name,
    setName: packName(index, card.pack_id),
    setCode: id.split('-')[0],
    number: id,
    rarity: card.rarity?.replace(/([a-z])([A-Z])/g, '$1 $2'),
    variant: variantLabel(card.card_id),
    imageSmall: card.img_url,
    imageLarge: card.img_url,
    url: `https://www.tcgplayer.com/search/one-piece-card-game/product?q=${encodeURIComponent(`${card.name} ${id}`)}`,
  };
}

/** Every printing of a card id: the base card plus alternate arts and reprints. */
export function printingsOf(index: OnePieceIndex, id: string): PunkCard[] {
  return Object.values(index.cards)
    .filter((c) => c.card_id === id || c.card_id.startsWith(`${id}_`))
    .sort((a, b) => a.card_id.localeCompare(b.card_id, 'en', { numeric: true }));
}

function priceEndpoint(id: string): string {
  if (id.startsWith('ST')) return `${PRICE_API}/decks/card/${id}/`;
  if (id.startsWith('P-')) return `${PRICE_API}/promos/card/${id}/`;
  return `${PRICE_API}/sets/card/${id}/`;
}

/** Market prices for all printings of one base card id, keyed by printing id. */
async function fetchPrices(id: string, fresh = false): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const rows = await fetchJson<OptcgPrice[]>(priceEndpoint(id), { timeoutMs: 8000, cache: !fresh });
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = row.card_image_id ?? row.card_set_id;
      const value = row.market_price ?? row.inventory_price;
      if (key && typeof value === 'number' && value > 0 && !out.has(key)) out.set(key, value);
    }
  } catch {
    // Prices are optional.
  }
  return out;
}

async function withPrices(cards: CardInfo[], fresh = false): Promise<CardInfo[]> {
  const bases = [...new Set(cards.map((c) => baseId(c.id)))].slice(0, 6);
  const priceMaps = await Promise.all(bases.map((b) => fetchPrices(b, fresh)));
  const all = new Map(priceMaps.flatMap((m) => [...m]));
  const updatedAt = new Date().toISOString();
  return cards.map((c) => {
    const usd = all.get(c.id);
    return usd !== undefined ? { ...c, prices: { usd, source: 'TCGplayer (OPTCG API)', updatedAt } } : c;
  });
}

/** Ids within one OCR slip of `id` (e.g. OP01-018 read as OP01-013). */
function nearbyIds(index: OnePieceIndex, id: string): string[] {
  const [prefix, num] = id.split('-');
  const out: string[] = [];
  for (const key of Object.keys(index.cards)) {
    if (key.includes('_')) continue;
    const [p, n] = key.split('-');
    if (p !== prefix || !n || n.length !== num.length) continue;
    let diff = 0;
    for (let i = 0; i < n.length; i++) if (n[i] !== num[i]) diff++;
    if (diff === 1) out.push(key);
  }
  return out;
}

function searchIndex(index: OnePieceIndex, query: string, limit = 40): PunkCard[] {
  const q = normalizeName(query);
  if (!q) return [];
  const idQuery = query.trim().toUpperCase();
  if (/^(OP|ST|EB|PRB)\d{2}(-\d{0,3})?$|^P-\d{0,3}$/.test(idQuery)) {
    return Object.values(index.cards)
      .filter((c) => c.card_id.startsWith(idQuery))
      .sort((a, b) => a.card_id.localeCompare(b.card_id, 'en', { numeric: true }))
      .slice(0, limit);
  }
  const bestPerName = new Map<string, number>();
  for (const c of Object.values(index.cards)) {
    const n = normalizeName(c.name);
    if (bestPerName.has(n)) continue;
    const s = n.includes(q) ? 0.95 + q.length / n.length / 100 : nameSimilarity(q, n);
    bestPerName.set(n, s);
  }
  const names = [...bestPerName.entries()]
    .filter(([, s]) => s >= 0.6)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([n]) => n);
  return names
    .flatMap((n) => Object.values(index.cards).filter((c) => normalizeName(c.name) === n))
    .slice(0, limit);
}

async function identify(hints: ScanHints): Promise<CardInfo[]> {
  const index = await loadIndex();
  const picked: PunkCard[] = [];
  const seen = new Set<string>();
  const add = (cards: PunkCard[]) => {
    for (const c of cards) {
      if (!seen.has(c.card_id)) {
        seen.add(c.card_id);
        picked.push(c);
      }
    }
  };

  for (const id of hints.onePieceIds) add(printingsOf(index, id));

  if (!picked.length) {
    // The id didn't exist — probably one misread digit. Use the name to choose
    // between the neighbours.
    for (const id of hints.onePieceIds) {
      const near = nearbyIds(index, id).map((n) => index.cards[n]);
      const ranked = hints.names.length
        ? near
            .map((c) => ({ c, s: Math.max(...hints.names.map((n) => nameSimilarity(n, c.name))) }))
            .filter((x) => x.s >= 0.6)
            .sort((a, b) => b.s - a.s)
            .map((x) => x.c)
        : near;
      for (const c of ranked.slice(0, 3)) add(printingsOf(index, c.card_id));
    }
  }

  if (!picked.length) {
    for (const name of hints.names.slice(0, 3)) add(searchIndex(index, name, 12));
  }

  return withPrices(picked.slice(0, 40).map((c) => toCardInfo(index, c)));
}

async function search(query: string): Promise<CardInfo[]> {
  const index = await loadIndex();
  return withPrices(searchIndex(index, query).map((c) => toCardInfo(index, c)));
}

async function refresh(cards: CardInfo[]): Promise<Map<string, CardInfo>> {
  const out = new Map<string, CardInfo>();
  const bases = [...new Set(cards.map((c) => baseId(c.id)))];
  const updatedAt = new Date().toISOString();
  for (const b of bases) {
    const prices = await fetchPrices(b, true);
    for (const c of cards) {
      const usd = prices.get(c.id);
      if (usd !== undefined) out.set(c.key, { ...c, prices: { usd, source: 'TCGplayer (OPTCG API)', updatedAt } });
    }
  }
  return out;
}

export const onepiece: GameProvider = {
  id: 'onepiece',
  label: 'One Piece',
  search,
  identify,
  refresh,
};
