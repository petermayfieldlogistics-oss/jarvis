export type GameId = 'pokemon' | 'onepiece' | 'magic';

/** What the scanner/search is restricted to. "marvel" is Magic's Marvel sets. */
export type GameFilter = 'auto' | GameId | 'marvel';

export interface Prices {
  /** Prices in US dollars (TCGplayer market price where available). */
  usd?: number;
  usdFoil?: number;
  /** Prices in euros (Cardmarket trend price) — used when no USD price exists. */
  eur?: number;
  eurFoil?: number;
  source?: string;
  updatedAt?: string;
}

export interface CardInfo {
  /** Globally unique key: `${game}:${id}`. */
  key: string;
  game: GameId;
  /** The data provider's own id (TCGdex id, Scryfall id, One Piece card id). */
  id: string;
  name: string;
  setName?: string;
  setCode?: string;
  /** Collector number as printed on the card. */
  number?: string;
  rarity?: string;
  /** Short description of the printing, e.g. "Alternate art". */
  variant?: string;
  imageSmall?: string;
  imageLarge?: string;
  prices?: Prices;
  /** Where to see or buy the card. */
  url?: string;
  /** Magic: The Gathering cards from a Marvel set. */
  isMarvel?: boolean;
}

export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';

export interface CollectionItem {
  uid: string;
  card: CardInfo;
  quantity: number;
  foil: boolean;
  condition: Condition;
  addedAt: string;
  notes?: string;
}

/** Everything the scanner could read off a card, ready for lookups. */
export interface ScanHints {
  /** One Piece card ids, e.g. "OP01-001", "ST10-002", "P-041". */
  onePieceIds: string[];
  /** Pokémon collector numbers, e.g. { number: "025", total: "198" }. */
  pokemonNumbers: { number: string; total?: string }[];
  /** Magic set code + collector number, e.g. { set: "mom", number: "123" }. */
  magicPrints: { set?: string; number?: string }[];
  /** Likely card names, best first. */
  names: string[];
  /** Which game the text looks like, best first (only games with some evidence). */
  gameGuesses: GameId[];
  rawText: string;
}

export interface GameProvider {
  id: GameId;
  label: string;
  /** Text search, used by the manual search box and as a scan fallback. */
  search(query: string, opts?: { marvelOnly?: boolean }): Promise<CardInfo[]>;
  /** Look up candidates for a scanned card. Best match first. */
  identify(hints: ScanHints, opts?: { marvelOnly?: boolean }): Promise<CardInfo[]>;
  /** Re-fetch current data (mainly prices) for cards of this game. */
  refresh(cards: CardInfo[]): Promise<Map<string, CardInfo>>;
}
