import type { CardInfo, CollectionItem, Condition, GameId } from '../types';

export const CONDITIONS: { id: Condition; label: string }[] = [
  { id: 'NM', label: 'Near Mint' },
  { id: 'LP', label: 'Lightly Played' },
  { id: 'MP', label: 'Moderately Played' },
  { id: 'HP', label: 'Heavily Played' },
  { id: 'DMG', label: 'Damaged' },
];

function newUid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Add copies of a card; stacks onto an existing entry with the same card, finish and condition. */
export function addCard(
  items: CollectionItem[],
  card: CardInfo,
  opts: { quantity?: number; foil?: boolean; condition?: Condition } = {},
): CollectionItem[] {
  const quantity = Math.max(1, opts.quantity ?? 1);
  const foil = opts.foil ?? false;
  const condition = opts.condition ?? 'NM';
  const idx = items.findIndex((i) => i.card.key === card.key && i.foil === foil && i.condition === condition);
  if (idx >= 0) {
    const next = [...items];
    next[idx] = { ...next[idx], card, quantity: next[idx].quantity + quantity };
    return next;
  }
  return [{ uid: newUid(), card, quantity, foil, condition, addedAt: new Date().toISOString() }, ...items];
}

export interface Money {
  amount: number;
  currency: 'USD' | 'EUR';
}

/** Price of one copy, preferring US dollars. */
export function unitPrice(item: Pick<CollectionItem, 'card' | 'foil'>): Money | null {
  const p = item.card.prices;
  if (!p) return null;
  const usd = item.foil ? (p.usdFoil ?? p.usd) : (p.usd ?? p.usdFoil);
  if (usd !== undefined) return { amount: usd, currency: 'USD' };
  const eur = item.foil ? (p.eurFoil ?? p.eur) : (p.eur ?? p.eurFoil);
  if (eur !== undefined) return { amount: eur, currency: 'EUR' };
  return null;
}

export function cardPrice(card: CardInfo): Money | null {
  return unitPrice({ card, foil: false });
}

export interface Totals {
  cards: number;
  unique: number;
  usd: number;
  eur: number;
  unpriced: number;
}

export function totals(items: CollectionItem[]): Totals {
  const t: Totals = { cards: 0, unique: items.length, usd: 0, eur: 0, unpriced: 0 };
  for (const item of items) {
    t.cards += item.quantity;
    const p = unitPrice(item);
    if (!p) t.unpriced += item.quantity;
    else if (p.currency === 'USD') t.usd += p.amount * item.quantity;
    else t.eur += p.amount * item.quantity;
  }
  return t;
}

export function formatMoney(m: Money | null | undefined): string {
  if (!m) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: m.currency }).format(m.amount);
}

export function matchesGame(card: CardInfo, filter: GameId | 'marvel' | 'all'): boolean {
  if (filter === 'all') return true;
  if (filter === 'marvel') return !!card.isMarvel;
  return card.game === filter;
}

// ---- Export / import -------------------------------------------------------

const CSV_COLUMNS = [
  'Game', 'Name', 'Set', 'Set Code', 'Number', 'Rarity', 'Variant', 'Quantity', 'Foil', 'Condition',
  'Unit Price', 'Currency', 'Total Value', 'Link', 'Card Key', 'Added',
] as const;

function csvCell(v: string | number | undefined): string {
  const s = v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(items: CollectionItem[]): string {
  const rows = items.map((i) => {
    const p = unitPrice(i);
    return [
      i.card.game, i.card.name, i.card.setName, i.card.setCode, i.card.number, i.card.rarity, i.card.variant,
      i.quantity, i.foil ? 'yes' : 'no', i.condition,
      p ? p.amount.toFixed(2) : '', p?.currency ?? '', p ? (p.amount * i.quantity).toFixed(2) : '',
      i.card.url, i.card.key, i.addedAt,
    ].map(csvCell).join(',');
  });
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}

export interface BackupFile {
  app: 'card-scanner';
  version: 1;
  exportedAt: string;
  items: CollectionItem[];
}

export function toBackup(items: CollectionItem[]): string {
  const file: BackupFile = { app: 'card-scanner', version: 1, exportedAt: new Date().toISOString(), items };
  return JSON.stringify(file, null, 2);
}

function isItem(x: unknown): x is CollectionItem {
  const i = x as CollectionItem;
  return !!i && typeof i === 'object' && !!i.card && typeof i.card.key === 'string' && typeof i.card.name === 'string'
    && typeof i.quantity === 'number';
}

/** Read a backup made by toBackup(). Throws with a readable message if it isn't one. */
export function parseBackup(text: string): CollectionItem[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t a Card Scanner backup (.json).');
  }
  const items = Array.isArray(data) ? data : (data as BackupFile)?.items;
  if (!Array.isArray(items) || !items.every(isItem)) throw new Error('That file isn’t a Card Scanner backup.');
  return items.map((i) => ({
    ...i,
    uid: i.uid || newUid(),
    foil: !!i.foil,
    condition: CONDITIONS.some((c) => c.id === i.condition) ? i.condition : 'NM',
    quantity: Math.max(1, Math.round(i.quantity)),
    addedAt: i.addedAt || new Date().toISOString(),
  }));
}

/** Merge imported items into the collection, stacking duplicates. */
export function mergeCollections(current: CollectionItem[], incoming: CollectionItem[]): CollectionItem[] {
  let out = current;
  for (const i of [...incoming].reverse()) {
    out = addCard(out, i.card, { quantity: i.quantity, foil: i.foil, condition: i.condition });
  }
  return out;
}
