import { fetchJson, HttpError } from '../lib/http';
import { nameSimilarity } from '../lib/fuzzy';
import { parseScan } from '../ocr/parse';
import type { CardInfo, GameProvider, Prices, ScanHints } from '../types';

// YGOPRODeck: free Yu-Gi-Oh! API with TCGplayer/Cardmarket prices.
// https://ygoprodeck.com/api-guide/ — max 20 requests/second, and card images
// must not be hotlinked over and over: the service worker (public/sw.js)
// keeps a copy of each image on the device after the first view.
const API = 'https://db.ygoprodeck.com/api/v7';

interface YgoSet {
  set_name: string;
  set_code: string;
  set_rarity: string;
  set_rarity_code?: string;
  set_price?: string;
  set_edition?: string;
}

export interface YgoCard {
  id: number;
  name: string;
  type?: string;
  ygoprodeck_url?: string;
  card_sets?: YgoSet[];
  card_images?: { id: number; image_url: string; image_url_small: string }[];
  card_prices?: { tcgplayer_price?: string; cardmarket_price?: string }[];
}

interface SetLookup {
  id: number;
  name: string;
  set_code: string;
  set_rarity: string;
}

function price(v: string | undefined): number | undefined {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A card, or one printing of it when `set` is given (set code + rarity). */
export function toCardInfo(card: YgoCard, set?: YgoSet): CardInfo {
  const image = card.card_images?.[0];
  const cardPrices = card.card_prices?.[0];
  const prices: Prices = {
    // A printing's own price where YGOPRODeck has one; otherwise the card's.
    usd: price(set?.set_price) ?? price(cardPrices?.tcgplayer_price),
    eur: price(cardPrices?.cardmarket_price),
    source: set && price(set.set_price) !== undefined ? 'TCGplayer (this printing)' : 'TCGplayer',
  };
  return {
    key: set ? `yugioh:${card.id}:${set.set_code}:${set.set_rarity_code || set.set_rarity}` : `yugioh:${card.id}`,
    game: 'yugioh',
    id: String(card.id),
    name: card.name,
    setName: set?.set_name ?? 'Any printing',
    setCode: set?.set_code,
    number: set?.set_code,
    rarity: set?.set_rarity,
    variant: set?.set_edition,
    imageSmall: image?.image_url_small,
    imageLarge: image?.image_url,
    prices: prices.usd !== undefined || prices.eur !== undefined ? prices : undefined,
    url: card.ygoprodeck_url ?? `https://www.tcgplayer.com/search/yugioh/product?q=${encodeURIComponent(card.name)}`,
  };
}

/** YGOPRODeck answers "no match" with HTTP 400; treat that as an empty result. */
async function cardinfo(query: string, fresh = false): Promise<YgoCard[]> {
  try {
    const res = await fetchJson<{ data: YgoCard[] }>(`${API}/cardinfo.php?${query}`, { cache: !fresh });
    return res.data ?? [];
  } catch (err) {
    if (err instanceof HttpError && (err.status === 400 || err.status === 404)) return [];
    throw err;
  }
}

/** "LOB-001" (old North American) is listed as "LOB-EN001". */
function setCodeVariants(code: string): string[] {
  const m = code.match(/^([A-Z0-9]+)-(\d{3})$/);
  return m ? [code, `${m[1]}-EN${m[2]}`] : [code];
}

/** All printings of `card` with this set code, the rarity YGOPRODeck suggested first. */
function printingsWithCode(card: YgoCard, code: string, rarity?: string): YgoSet[] {
  return (card.card_sets ?? [])
    .filter((s) => s.set_code === code)
    .sort((a, b) => Number(b.set_rarity === rarity) - Number(a.set_rarity === rarity));
}

async function identify(hints: ScanHints): Promise<CardInfo[]> {
  const out: CardInfo[] = [];
  const seen = new Set<string>();
  const add = (c: CardInfo) => {
    if (!seen.has(c.key)) {
      seen.add(c.key);
      out.push(c);
    }
  };

  // 1) Set code → the exact printing (all rarities printed under that code).
  for (const raw of hints.yugiohSetCodes.slice(0, 3)) {
    for (const code of setCodeVariants(raw)) {
      let lookup: SetLookup | null = null;
      try {
        lookup = await fetchJson<SetLookup>(`${API}/cardsetsinfo.php?setcode=${encodeURIComponent(code)}`);
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
      }
      if (!lookup?.id) continue;
      const [card] = await cardinfo(`id=${lookup.id}`);
      if (card) {
        for (const set of printingsWithCode(card, code, lookup.set_rarity)) add(toCardInfo(card, set));
        if (!out.length) add(toCardInfo(card));
      }
      break;
    }
  }

  // 2) Passcode → the card; list its printings so the right one can be picked.
  for (const passcode of hints.yugiohPasscodes.slice(0, 2)) {
    const [card] = await cardinfo(`id=${passcode}`);
    if (!card) continue;
    const codes = hints.yugiohSetCodes;
    const sets = card.card_sets ?? [];
    const matching = sets.filter((s) => codes.includes(s.set_code));
    for (const set of matching) add(toCardInfo(card, set));
    add(toCardInfo(card));
    for (const set of sets.slice(0, 40)) add(toCardInfo(card, set));
  }
  if (out.length) return out;

  // 3) Name search.
  for (const name of hints.names.slice(0, 3)) {
    const cards = await cardinfo(`fname=${encodeURIComponent(name)}`);
    if (!cards.length) continue;
    const ranked = [...cards].sort((a, b) => nameSimilarity(name, b.name) - nameSimilarity(name, a.name));
    if (nameSimilarity(name, ranked[0].name) < 0.6) continue;
    for (const card of ranked.slice(0, 12)) add(toCardInfo(card));
    // A near-exact name: offer its printings too.
    if (nameSimilarity(name, ranked[0].name) >= 0.9) {
      for (const set of (ranked[0].card_sets ?? []).slice(0, 30)) add(toCardInfo(ranked[0], set));
    }
    break;
  }
  return out;
}

async function search(query: string): Promise<CardInfo[]> {
  const q = query.trim();
  if (!q) return [];
  const code = q.toUpperCase();
  if (/^[A-Z0-9]{2,4}-[A-Z]{0,2}\d{3}$/.test(code)) {
    return identify({ ...parseScan('', ''), yugiohSetCodes: [code] });
  }
  if (/^\d{8}$/.test(q)) return (await cardinfo(`id=${q}`)).map((c) => toCardInfo(c));
  const cards = await cardinfo(`fname=${encodeURIComponent(q)}`);
  const ranked = [...cards].sort((a, b) => nameSimilarity(q, b.name) - nameSimilarity(q, a.name));
  const results = ranked.slice(0, 40).map((c) => toCardInfo(c));
  // An exact name: list its printings right after it.
  if (ranked[0] && ranked[0].name.toLowerCase() === q.toLowerCase()) {
    results.splice(1, 0, ...(ranked[0].card_sets ?? []).slice(0, 30).map((s) => toCardInfo(ranked[0], s)));
  }
  return results;
}

async function refresh(cards: CardInfo[]): Promise<Map<string, CardInfo>> {
  const out = new Map<string, CardInfo>();
  const ids = [...new Set(cards.map((c) => c.id))];
  // cardinfo.php takes a comma-separated list of ids.
  for (let i = 0; i < ids.length; i += 50) {
    const fresh = await cardinfo(`id=${ids.slice(i, i + 50).join(',')}`, true);
    const byId = new Map(fresh.map((c) => [String(c.id), c]));
    for (const c of cards) {
      const card = byId.get(c.id);
      if (!card) continue;
      const set = c.setCode
        ? (card.card_sets ?? []).find((s) => s.set_code === c.setCode && s.set_rarity === c.rarity)
        : undefined;
      out.set(c.key, { ...toCardInfo(card, set), key: c.key });
    }
  }
  return out;
}

export const yugioh: GameProvider = {
  id: 'yugioh',
  label: 'Yu-Gi-Oh!',
  search,
  identify,
  refresh,
};
