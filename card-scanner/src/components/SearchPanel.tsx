import { useEffect, useRef, useState } from 'react';
import { searchCards } from '../games';
import type { CardInfo, GameFilter } from '../types';
import { AddCardSheet, CardGrid, GameChips, type AddOptions } from './common';

interface Props {
  filter: GameFilter;
  onFilterChange: (f: GameFilter) => void;
  initialQuery: string;
  onAdd: (card: CardInfo, opts: AddOptions) => void;
}

const PLACEHOLDER: Record<GameFilter, string> = {
  auto: 'Card name, e.g. Charizard, Luffy or Dark Magician',
  pokemon: 'Pokémon card name, e.g. Pikachu ex',
  onepiece: 'Name or id, e.g. Zoro or OP01-025',
  magic: 'Card name, e.g. Lightning Bolt',
  marvel: 'Card name, e.g. Spider-Man',
  yugioh: 'Name, set code or passcode, e.g. Dark Magician',
  lorcana: 'Card name, e.g. Elsa or Stitch',
};

export function SearchPanel({ filter, onFilterChange, initialQuery, onAdd }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<CardInfo[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<CardInfo | null>(null);
  const requestId = useRef(0);

  const run = async (q: string, f: GameFilter) => {
    if (!q.trim()) return;
    const id = ++requestId.current;
    setBusy(true);
    const res = await searchCards(f, q);
    // Ignore answers to searches the user has already replaced.
    if (id !== requestId.current) return;
    setResults(res.results);
    setErrors(res.errors);
    setBusy(false);
  };

  useEffect(() => {
    setQuery(initialQuery);
    if (initialQuery) void run(initialQuery, filter);
    // Only when a new query is handed over (e.g. "Search by name instead").
  }, [initialQuery]);

  return (
    <section className="search">
      <GameChips
        value={filter}
        onChange={(f) => {
          onFilterChange(f);
          void run(query, f);
        }}
      />
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(query, filter);
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={PLACEHOLDER[filter]}
          aria-label="Card name"
          enterKeyHint="search"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !query.trim()}>
          Search
        </button>
      </form>

      {busy && (
        <p className="status" role="status">
          <span className="spinner" /> Searching…
        </p>
      )}
      {!busy && results && results.length === 0 && (
        <p className="muted">No cards found{errors.length ? ' — some card databases couldn’t be reached.' : '.'}</p>
      )}
      {!busy && errors.length > 0 && results && results.length > 0 && (
        <p className="muted small">Some card databases couldn’t be reached, so results may be incomplete.</p>
      )}
      {results && results.length > 0 && <CardGrid cards={results} onSelect={setSelected} />}

      {selected && <AddCardSheet card={selected} onAdd={onAdd} onClose={() => setSelected(null)} />}
    </section>
  );
}
