import type { CardInfo, GameFilter, GameId, GameProvider, ScanHints } from '../types';
import { magic } from './magic';
import { onepiece } from './onepiece';
import { pokemon } from './pokemon';

export const providers: Record<GameId, GameProvider> = { pokemon, onepiece, magic };

export const GAME_FILTERS: { id: GameFilter; label: string }[] = [
  { id: 'auto', label: 'Any game' },
  { id: 'pokemon', label: 'Pokémon' },
  { id: 'onepiece', label: 'One Piece' },
  { id: 'magic', label: 'Magic' },
  { id: 'marvel', label: 'Marvel' },
];

export const GAME_LABELS: Record<GameId, string> = {
  pokemon: 'Pokémon',
  onepiece: 'One Piece',
  magic: 'Magic',
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
  for (const g of ['pokemon', 'magic', 'onepiece'] as GameId[]) if (!order.includes(g)) order.push(g);
  // Without any evidence for a game, only try the ones with something to look up.
  return order.filter((g) => hints.gameGuesses.includes(g) || hints.names.length > 0 || hints.onePieceIds.length > 0);
}

export interface IdentifyResult {
  game: GameId | null;
  candidates: CardInfo[];
  errors: string[];
}

export async function identifyCard(filter: GameFilter, hints: ScanHints): Promise<IdentifyResult> {
  const errors: string[] = [];
  const marvelOnly = filter === 'marvel';
  for (const game of gamesToTry(filter, hints)) {
    try {
      const candidates = await providers[game].identify(hints, { marvelOnly });
      if (candidates.length) return { game, candidates, errors };
    } catch (err) {
      errors.push(`${GAME_LABELS[game]}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { game: null, candidates: [], errors };
}

export async function searchCards(filter: GameFilter, query: string): Promise<{ results: CardInfo[]; errors: string[] }> {
  const fixed = providerFor(filter);
  const games: GameId[] = fixed ? [fixed] : ['pokemon', 'onepiece', 'magic'];
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
