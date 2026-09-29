import { useMemo, useRef, useState } from 'react';
import { GAME_LABELS } from '../games';
import {
  CONDITIONS,
  formatMoney,
  matchesGame,
  parseBackup,
  toBackup,
  toCsv,
  totals,
  unitPrice,
} from '../lib/collection';
import type { CollectionItem, Condition, GameId } from '../types';
import { CardDetails, CardImage, Sheet, Stepper } from './common';

type GameTab = 'all' | GameId | 'marvel';
type SortKey = 'value' | 'name' | 'added' | 'set';

const GAME_TABS: { id: GameTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pokemon', label: 'Pokémon' },
  { id: 'onepiece', label: 'One Piece' },
  { id: 'magic', label: 'Magic' },
  { id: 'marvel', label: 'Marvel' },
  { id: 'yugioh', label: 'Yu-Gi-Oh!' },
  { id: 'lorcana', label: 'Lorcana' },
];

interface Props {
  items: CollectionItem[];
  onUpdate: (uid: string, patch: Partial<CollectionItem>) => void;
  onRemove: (uid: string) => void;
  onImport: (items: CollectionItem[]) => void;
  onRefreshPrices: () => Promise<string>;
  onGoScan: () => void;
}

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function itemValue(item: CollectionItem): number {
  const p = unitPrice(item);
  return p ? p.amount * item.quantity : -1;
}

export function CollectionView({ items, onUpdate, onRemove, onImport, onRefreshPrices, onGoScan }: Props) {
  const [game, setGame] = useState<GameTab>('all');
  const [sort, setSort] = useState<SortKey>('value');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const q = text.trim().toLowerCase();
    const list = items.filter(
      (i) =>
        matchesGame(i.card, game) &&
        (!q || `${i.card.name} ${i.card.setName ?? ''} ${i.card.number ?? ''}`.toLowerCase().includes(q)),
    );
    const by: Record<SortKey, (a: CollectionItem, b: CollectionItem) => number> = {
      value: (a, b) => itemValue(b) - itemValue(a),
      name: (a, b) => a.card.name.localeCompare(b.card.name),
      added: (a, b) => b.addedAt.localeCompare(a.addedAt),
      set: (a, b) =>
        (a.card.setName ?? '').localeCompare(b.card.setName ?? '') ||
        (a.card.number ?? '').localeCompare(b.card.number ?? '', undefined, { numeric: true }),
    };
    return [...list].sort(by[sort]);
  }, [items, game, sort, text]);

  const t = totals(visible);
  const editingItem = items.find((i) => i.uid === editing);

  const refresh = async () => {
    setBusy(true);
    setMessage('Updating prices…');
    try {
      setMessage(await onRefreshPrices());
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = parseBackup(await file.text());
      onImport(imported);
      setMessage(`Imported ${imported.length} entries.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const stamp = new Date().toISOString().slice(0, 10);

  if (!items.length) {
    return (
      <section className="collection empty">
        <h2>Your collection is empty</h2>
        <p className="muted">Scan or search for a card and tap “Add”. Your collection is saved on this device.</p>
        <button type="button" className="btn btn-primary" onClick={onGoScan}>
          Scan a card
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => importRef.current?.click()}>
          Restore a backup
        </button>
        <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
        {message && <p className="muted">{message}</p>}
      </section>
    );
  }

  return (
    <section className="collection">
      <div className="summary">
        <div>
          <div className="summary-value">
            {formatMoney({ amount: t.usd, currency: 'USD' })}
            {t.eur > 0 && <span className="summary-eur"> + {formatMoney({ amount: t.eur, currency: 'EUR' })}</span>}
          </div>
          <div className="muted small">
            {t.cards} {t.cards === 1 ? 'card' : 'cards'} · {t.unique} different
            {t.unpriced ? ` · ${t.unpriced} without a price` : ''}
          </div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={refresh} disabled={busy}>
          {busy ? 'Updating…' : 'Update prices'}
        </button>
      </div>
      {message && <p className="muted small">{message}</p>}

      <div className="chips">
        {GAME_TABS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`chip ${game === g.id ? 'chip-on' : ''}`}
            onClick={() => setGame(g.id)}
            aria-pressed={game === g.id}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input type="search" placeholder="Filter" value={text} onChange={(e) => setText(e.target.value)} aria-label="Filter collection" />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by">
          <option value="value">Most valuable</option>
          <option value="name">Name</option>
          <option value="added">Recently added</option>
          <option value="set">Set</option>
        </select>
      </div>

      <div className="grid">
        {visible.map((i) => {
          const p = unitPrice(i);
          return (
            <button key={i.uid} type="button" className="tile" onClick={() => setEditing(i.uid)}>
              <div className="tile-img">
                <CardImage card={i.card} />
                {i.quantity > 1 && <span className="badge qty">×{i.quantity}</span>}
                {i.foil && <span className="badge foil">Foil</span>}
              </div>
              <div className="tile-body">
                <div className="tile-name">{i.card.name}</div>
                <div className="tile-sub">{[i.card.setName, i.card.number].filter(Boolean).join(' · ')}</div>
                <div className="tile-price">
                  {p ? formatMoney({ amount: p.amount * i.quantity, currency: p.currency }) : '—'}
                  {i.condition !== 'NM' && <span className="muted"> · {i.condition}</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="backup">
        <h3>Backup &amp; export</h3>
        <p className="muted small">Your collection lives in this browser. Save a backup now and then, or to move it to another device.</p>
        <div className="backup-actions">
          <button type="button" className="btn btn-secondary" onClick={() => download(`card-collection-${stamp}.json`, toBackup(items), 'application/json')}>
            Save backup
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => importRef.current?.click()}>
            Restore backup
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => download(`card-collection-${stamp}.csv`, toCsv(items), 'text/csv')}>
            Export spreadsheet (CSV)
          </button>
        </div>
        <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
      </div>

      {editingItem && (
        <ItemSheet item={editingItem} onUpdate={onUpdate} onRemove={onRemove} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}

function ItemSheet({
  item,
  onUpdate,
  onRemove,
  onClose,
}: {
  item: CollectionItem;
  onUpdate: (uid: string, patch: Partial<CollectionItem>) => void;
  onRemove: (uid: string) => void;
  onClose: () => void;
}) {
  const p = unitPrice(item);
  return (
    <Sheet title={item.card.name} onClose={onClose}>
      <div className="sheet-card">
        <CardImage card={item.card} large className="sheet-img" />
        <CardDetails card={item.card} />
      </div>
      <div className="form-row">
        <label>Quantity</label>
        <Stepper value={item.quantity} min={1} onChange={(n) => onUpdate(item.uid, { quantity: n })} />
      </div>
      <div className="form-row">
        <label htmlFor="edit-foil">Foil / holo</label>
        <input
          id="edit-foil"
          type="checkbox"
          className="switch"
          checked={item.foil}
          onChange={(e) => onUpdate(item.uid, { foil: e.target.checked })}
        />
      </div>
      <div className="form-row">
        <label htmlFor="edit-cond">Condition</label>
        <select id="edit-cond" value={item.condition} onChange={(e) => onUpdate(item.uid, { condition: e.target.value as Condition })}>
          {CONDITIONS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row column">
        <label htmlFor="edit-notes">Notes</label>
        <textarea
          id="edit-notes"
          rows={2}
          value={item.notes ?? ''}
          placeholder="e.g. graded PSA 9, in binder 2"
          onChange={(e) => onUpdate(item.uid, { notes: e.target.value })}
        />
      </div>
      <p className="muted small">
        {GAME_LABELS[item.card.game]} · Value {p ? formatMoney({ amount: p.amount * item.quantity, currency: p.currency }) : 'unknown'} · Added{' '}
        {new Date(item.addedAt).toLocaleDateString()}
      </p>
      <button
        type="button"
        className="btn btn-danger btn-block"
        onClick={() => {
          if (confirm(`Remove ${item.card.name} from your collection?`)) {
            onRemove(item.uid);
            onClose();
          }
        }}
      >
        Remove from collection
      </button>
    </Sheet>
  );
}
