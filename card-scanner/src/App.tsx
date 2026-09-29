import { useCallback, useEffect, useRef, useState } from 'react';
import { CollectionView } from './components/CollectionView';
import { Scanner } from './components/Scanner';
import { SearchPanel } from './components/SearchPanel';
import type { AddOptions } from './components/common';
import { GAME_LABELS, providers } from './games';
import { addCard, formatMoney, mergeCollections, totals } from './lib/collection';
import { loadCollection, saveCollection } from './lib/storage';
import type { CardInfo, CollectionItem, GameFilter, GameId } from './types';

type Tab = 'scan' | 'search' | 'collection';

const FILTER_KEY = 'game-filter';

function readFilter(): GameFilter {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    if (v === 'auto' || v === 'pokemon' || v === 'onepiece' || v === 'magic' || v === 'marvel') return v;
  } catch {
    // Storage blocked; fall through to the default.
  }
  return 'auto';
}

export default function App() {
  const [tab, setTab] = useState<Tab>('scan');
  const [items, setItems] = useState<CollectionItem[] | null>(null);
  const [filter, setFilterState] = useState<GameFilter>(readFilter);
  const [searchSeed, setSearchSeed] = useState('');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number>(undefined);

  useEffect(() => {
    void loadCollection().then(setItems);
  }, []);

  // Persist after every change (but not before the saved copy has loaded).
  useEffect(() => {
    if (items) void saveCollection(items);
  }, [items]);

  const setFilter = (f: GameFilter) => {
    setFilterState(f);
    try {
      localStorage.setItem(FILTER_KEY, f);
    } catch {
      // Not important enough to surface.
    }
  };

  const showToast = (text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2500);
  };

  const onAdd = useCallback((card: CardInfo, opts: AddOptions) => {
    setItems((prev) => addCard(prev ?? [], card, opts));
    showToast(`Added ${opts.quantity > 1 ? `${opts.quantity}× ` : ''}${card.name}${opts.foil ? ' (foil)' : ''}`);
  }, []);

  const onUpdate = (uid: string, patch: Partial<CollectionItem>) =>
    setItems((prev) => (prev ?? []).map((i) => (i.uid === uid ? { ...i, ...patch } : i)));

  const onRemove = (uid: string) => setItems((prev) => (prev ?? []).filter((i) => i.uid !== uid));

  const onImport = (incoming: CollectionItem[]) => setItems((prev) => mergeCollections(prev ?? [], incoming));

  const onRefreshPrices = async (): Promise<string> => {
    const current = items ?? [];
    const byGame = new Map<GameId, CardInfo[]>();
    for (const i of current) {
      const list = byGame.get(i.card.game) ?? [];
      if (!list.some((c) => c.key === i.card.key)) list.push(i.card);
      byGame.set(i.card.game, list);
    }
    const updated = new Map<string, CardInfo>();
    const failed: string[] = [];
    for (const [game, cards] of byGame) {
      try {
        for (const [key, card] of await providers[game].refresh(cards)) updated.set(key, card);
      } catch {
        failed.push(GAME_LABELS[game]);
      }
    }
    setItems((prev) =>
      (prev ?? []).map((i) => {
        const fresh = updated.get(i.card.key);
        return fresh ? { ...i, card: { ...i.card, ...fresh, key: i.card.key } } : i;
      }),
    );
    const total = [...byGame.values()].reduce((n, l) => n + l.length, 0);
    return `Updated prices for ${updated.size} of ${total} cards.${failed.length ? ` Couldn’t reach: ${failed.join(', ')}.` : ''}`;
  };

  const t = totals(items ?? []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Card Scanner</h1>
        <button type="button" className="topbar-value" onClick={() => setTab('collection')}>
          {t.cards} {t.cards === 1 ? 'card' : 'cards'} · {formatMoney({ amount: t.usd, currency: 'USD' })}
        </button>
      </header>

      <main>
        {tab === 'scan' && (
          <Scanner
            filter={filter}
            onFilterChange={setFilter}
            onAdd={onAdd}
            onSearchInstead={(q) => {
              setSearchSeed(q);
              setTab('search');
            }}
          />
        )}
        {tab === 'search' && (
          <SearchPanel filter={filter} onFilterChange={setFilter} initialQuery={searchSeed} onAdd={onAdd} />
        )}
        {tab === 'collection' &&
          (items ? (
            <CollectionView
              items={items}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onImport={onImport}
              onRefreshPrices={onRefreshPrices}
              onGoScan={() => setTab('scan')}
            />
          ) : (
            <p className="status">
              <span className="spinner" /> Loading your collection…
            </p>
          ))}
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <nav className="tabbar" aria-label="Sections">
        {(
          [
            ['scan', 'Scan', '◉'],
            ['search', 'Search', '⌕'],
            ['collection', 'Collection', '▦'],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'active' : ''}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            <span className="tab-icon" aria-hidden="true">
              {icon}
            </span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
