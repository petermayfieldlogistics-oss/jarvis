import { nameSimilarity } from '../lib/fuzzy';
import type { CardInfo, GameFilter, GameId, GameProvider, ScanHints } from '../types';
import { lorcana } from './lorcana';
import { magic } from './magic';
import { onepiece } from './onepiece';
import { pokemon } from './pokemon';
import { yugioh } from './yugioh';

export const providers: Record<GameId, GameProvider> = { pokemon, onepiece, magic, yugioh, lorcana };

/** Order to try games in when a scan gives no clue (most common first). */
const ALL_GAMES: GameId[] = ['pokemon', 'magic', 'yugioh', 'onepiece', 'lorcana'];

export const GAME_FILTERS: { id: GameFilter; label: string }[] = [
  { id: 'auto', label: 'Any game' },
  { id: 'pokemon', label: 'Pokémon' },
  { id: 'onepiece', label: 'One Piece' },
  { id: 'magic', label: 'Magic' },
  { id: 'marvel', label: 'Marvel' },
  { id: 'yugioh', label: 'Yu-Gi-Oh!' },
  { id: 'lorcana', label: 'Lorcana' },
];

export const GAME_LABELS: Record<GameId, string> = {
  pokemon: 'Pokémon',
  onepiece: 'One Piece',
  magic: 'Magic',
  yugioh: 'Yu-Gi-Oh!',
  lorcana: 'Lorcana',
};

function providerFor(filter: GameFilter): GameId | null {
  if (filter === 'auto') return null;
  return filter === 'marvel' ? 'magic' : filter;
}

/** Which games to try, in order, for a scan. */
export function gamesToTry(filter: GameFilter, hints: ScanHints): GameId[] {
  const fixed = providerFor(filter);
  if (fixed) return [fixed];
  const order: GameId[] = [...hints.gameGuesses];
  for (const g of ALL_GAMES) if (!order.includes(g)) order.push(g);
  // Without any evidence for a game, only try the ones with something to look up.
  return order.filter((g) => hints.gameGuesses.includes(g) || hints.names.length > 0 || hints.onePieceIds.length > 0);
}

export interface IdentifyResult {
  game: GameId | null;
  candidates: CardInfo[];
  errors: string[];
  /** False when no printed code was read and the match rests on a fuzzy name. */
  confident: boolean;
}

function hasCodes(h: ScanHints): boolean {
  return (
    h.onePieceIds.length +
      h.pokemonNumbers.length +
      h.magicPrints.length +
      h.yugiohSetCodes.length +
      h.yugiohPasscodes.length +
      h.lorcanaPrints.length >
    0
  );
}

export async function identifyCard(filter: GameFilter, hints: ScanHints): Promise<IdentifyResult> {
  const errors: string[] = [];
  const marvelOnly = filter === 'marvel';
  const games = gamesToTry(filter, hints);
  const attempt = async (game: GameId): Promise<CardInfo[]> => {
    try {
      return await providers[game].identify(hints, { marvelOnly });
    } catch (err) {
      errors.push(`${GAME_LABELS[game]}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  };
  const names = hints.names.slice(0, 5);
  const fit = (c: CardInfo) => Math.max(0, ...names.map((n) => nameSimilarity(n, c.name)));

  // A printed code is strong evidence: try the likeliest games in order and
  // stop at the first that recognises the card.
  if (hasCodes(hints)) {
    for (const game of games) {
      const candidates = await attempt(game);
      if (candidates.length) return { game, candidates, errors, confident: true };
    }
    return { game: null, candidates: [], errors, confident: false };
  }

  // Only a name was readable. Names repeat across games ("Queen" is a One
  // Piece card and a word on Lorcana cards), so ask every game at once and
  // rank all the answers by how well they match what was read.
  const answers = await Promise.all(games.map(attempt));
  const ranked = answers
    .flatMap((list) => list.slice(0, 15))
    .map((card, order) => ({ card, order, score: fit(card) + (card.game === hints.gameGuesses[0] ? 0.05 : 0) }))
    .sort((a, b) => b.score - a.score || a.order - b.order);
  if (!ranked.length) return { game: null, candidates: [], errors, confident: false };
  return {
    game: ranked[0].card.game,
    candidates: ranked.slice(0, 40).map((r) => r.card),
    errors,
    confident: fit(ranked[0].card) >= 0.95,
  };
}

export async function searchCards(filter: GameFilter, query: string): Promise<{ results: CardInfo[]; errors: string[] }> {
  const fixed = providerFor(filter);
  const games: GameId[] = fixed ? [fixed] : ALL_GAMES;
  const errors: string[] = [];
  const lists = await Promise.all(
    games.map((g) =>
      providers[g].search(query, { marvelOnly: filter === 'marvel' }).catch((err) => {
        errors.push(`${GAME_LABELS[g]}: ${err instanceof Error ? err.message : String(err)}`);
        return [] as CardInfo[];
      }),
    ),
  );
  if (games.length === 1) return { results: lists[0], errors };
  // Interleave so one game's long list doesn't bury the others.
  const results: CardInfo[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i]) results.push(l[i]);
  return { results, errors };
}
