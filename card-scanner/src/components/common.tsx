import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GAME_FILTERS, GAME_LABELS } from '../games';
import { cardPrice, CONDITIONS, formatMoney } from '../lib/collection';
import type { CardInfo, Condition, GameFilter } from '../types';

export function GameChips({ value, onChange }: { value: GameFilter; onChange: (g: GameFilter) => void }) {
  return (
    <div className="chips" role="radiogroup" aria-label="Game">
      {GAME_FILTERS.map((g) => (
        <button
          key={g.id}
          type="button"
          role="radio"
          aria-checked={value === g.id}
          className={`chip ${value === g.id ? 'chip-on' : ''}`}
          onClick={() => onChange(g.id)}
        >
          {g.label}
        </button>
      ))}
    </div>
  );
}

export function CardImage({ card, large, className }: { card: CardInfo; large?: boolean; className?: string }) {
  const src = large ? (card.imageLarge ?? card.imageSmall) : (card.imageSmall ?? card.imageLarge);
  // Remember which URL failed, so a different card shown here gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string>();
  if (!src || failedSrc === src) {
    return (
      <div className={`card-img card-img-missing ${className ?? ''}`}>
        <span>{card.name}</span>
      </div>
    );
  }
  return (
    <img
      className={`card-img ${className ?? ''}`}
      src={src}
      alt={card.name}
      loading="lazy"
      // Some card sites refuse image requests that come from other websites.
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
    />
  );
}

export function cardSubtitle(card: CardInfo): string {
  return [card.setName, card.number].filter(Boolean).join(' · ');
}

export function CardTile({
  card,
  onSelect,
  badge,
  showGame,
}: {
  card: CardInfo;
  onSelect: () => void;
  badge?: ReactNode;
  showGame?: boolean;
}) {
  return (
    <button type="button" className="tile" onClick={onSelect}>
      <div className="tile-img">
        <CardImage card={card} />
        {badge}
      </div>
      <div className="tile-body">
        <div className="tile-name">{card.name}</div>
        {showGame && <div className="tile-sub tile-game">{GAME_LABELS[card.game]}</div>}
        <div className="tile-sub">{cardSubtitle(card)}</div>
        {card.variant && <div className="tile-sub">{card.variant}</div>}
        <div className="tile-price">{formatMoney(cardPrice(card))}</div>
      </div>
    </button>
  );
}

export function CardGrid({ cards, onSelect }: { cards: CardInfo[]; onSelect: (c: CardInfo) => void }) {
  // Label each tile with its game when the list mixes games.
  const mixed = new Set(cards.map((c) => c.game)).size > 1;
  return (
    <div className="grid">
      {cards.map((c) => (
        <CardTile key={c.key} card={c} onSelect={() => onSelect(c)} showGame={mixed} />
      ))}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        // Tapping the dimmed backdrop closes the sheet.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet-inner">
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function Stepper({ value, min = 0, onChange }: { value: number; min?: number; onChange: (n: number) => void }) {
  return (
    <div className="stepper">
      <button type="button" aria-label="Fewer" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label="More" onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

export function PriceRows({ card }: { card: CardInfo }) {
  const p = card.prices;
  if (!p) return <p className="muted">No price data for this card yet.</p>;
  const rows: [string, string][] = [];
  if (p.usd !== undefined) rows.push(['Market', formatMoney({ amount: p.usd, currency: 'USD' })]);
  if (p.usdFoil !== undefined) rows.push(['Foil / holo', formatMoney({ amount: p.usdFoil, currency: 'USD' })]);
  if (p.usd === undefined && p.eur !== undefined) rows.push(['Market', formatMoney({ amount: p.eur, currency: 'EUR' })]);
  if (p.usdFoil === undefined && p.eurFoil !== undefined)
    rows.push(['Foil / holo', formatMoney({ amount: p.eurFoil, currency: 'EUR' })]);
  return (
    <dl className="prices">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
      {p.source && <div className="muted small">Source: {p.source}</div>}
    </dl>
  );
}

export function CardDetails({ card }: { card: CardInfo }) {
  return (
    <div className="details">
      <div className="muted">{GAME_LABELS[card.game]}{card.isMarvel ? ' · Marvel' : ''}</div>
      <div>{cardSubtitle(card)}</div>
      {(card.rarity || card.variant) && <div className="muted">{[card.rarity, card.variant].filter(Boolean).join(' · ')}</div>}
      <PriceRows card={card} />
      {card.url && (
        <a href={card.url} target="_blank" rel="noreferrer" className="link">
          View prices online ↗
        </a>
      )}
    </div>
  );
}

export interface AddOptions {
  quantity: number;
  foil: boolean;
  condition: Condition;
}

export function AddCardSheet({
  card,
  onAdd,
  onClose,
}: {
  card: CardInfo;
  onAdd: (card: CardInfo, opts: AddOptions) => void;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [foil, setFoil] = useState(false);
  const [condition, setCondition] = useState<Condition>('NM');
  return (
    <Sheet title={card.name} onClose={onClose}>
      <div className="sheet-card">
        <CardImage card={card} large className="sheet-img" />
        <CardDetails card={card} />
      </div>
      <div className="form-row">
        <label>Quantity</label>
        <Stepper value={quantity} min={1} onChange={setQuantity} />
      </div>
      <div className="form-row">
        <label htmlFor="foil">Foil / holo</label>
        <input id="foil" type="checkbox" className="switch" checked={foil} onChange={(e) => setFoil(e.target.checked)} />
      </div>
      <div className="form-row">
        <label htmlFor="cond">Condition</label>
        <select id="cond" value={condition} onChange={(e) => setCondition(e.target.value as Condition)}>
          {CONDITIONS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-block"
        onClick={() => {
          onAdd(card, { quantity, foil, condition });
          onClose();
        }}
      >
        Add to collection
      </button>
    </Sheet>
  );
}
