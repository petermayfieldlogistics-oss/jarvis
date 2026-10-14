// The world layout: the owner's edits to the hand-built world, made in the
// editor and published as src/data/layout.json. Every player loads the same
// file, so co-op worlds match. An empty layout is the world exactly as built.
//
// Ids of built-in things are stable names given by the world code
// (for example "piece:house-3", "plant:4,7:12", "camp:5", "npc:nell").
// Things added in the editor get ids "add:<n>".

import type { EnemyId } from '../data/world';

export const LAYOUT_VERSION = 1;

/** Where something stands: ground position, turn (radians) and size. */
export interface Place {
  x: number;
  z: number;
  rot: number;
  scale: number;
}

/** A new thing placed from the palette (a prop, a building or a plant). */
export interface Added extends Place {
  id: string;
  kind: string;
}

/** A monster camp: where, how wide, and which monsters (kind and count). */
export interface Camp {
  x: number;
  z: number;
  radius: number;
  enemies: [EnemyId, number][];
}

export type BrushMode = 'raise' | 'lower' | 'flatten' | 'lake';

/**
 * A ground brush, a circle with a soft edge. raise/lower add or take away
 * `amount` metres at the centre; flatten pulls the ground toward the height
 * `amount`; lake digs to `amount` metres below the water line.
 */
export interface Brush {
  x: number;
  z: number;
  radius: number;
  mode: BrushMode;
  amount: number;
}

export interface Layout {
  v: number;
  /** Built-in pieces, plants and NPCs moved, by id. */
  moved: Record<string, Place>;
  /** Built-in pieces, plants and camps taken away, by id. */
  removed: string[];
  /** Pieces and plants added from the palette. */
  added: Added[];
  /** Camps: built-in ones changed (by their "camp:<i>" id) and new ones ("add:<n>"). */
  camps: Record<string, Camp>;
  /** Ground brushes, applied in order. */
  brushes: Brush[];
}

export const emptyLayout = (): Layout => ({ v: LAYOUT_VERSION, moved: {}, removed: [], added: [], camps: {}, brushes: [] });

// ------------------------------------------------------------ checking --

/** Limits that keep a layout small enough for every phone. */
export const LAYOUT_LIMITS = { added: 3000, removed: 20000, moved: 5000, camps: 400, brushes: 4000, campEnemies: 6, campCount: 8 };

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v: unknown, max = 80) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
const MODES: BrushMode[] = ['raise', 'lower', 'flatten', 'lake'];

function place(v: unknown): Place | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (typeof p.x !== 'number' || typeof p.z !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
  return { x: num(p.x, -2000, 2000, 0), z: num(p.z, -2000, 2000, 0), rot: num(p.rot, -100, 100, 0), scale: num(p.scale, 0.2, 5, 1) };
}

/**
 * A layout from a file or the network, made safe: junk entries are dropped,
 * numbers clamped, sizes capped. `enemyOk` says which monster ids exist.
 */
export function normalizeLayout(raw: unknown, enemyOk: (id: string) => boolean = () => true): Layout {
  const out = emptyLayout();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (r.moved && typeof r.moved === 'object') {
    for (const [id, v] of Object.entries(r.moved as Record<string, unknown>).slice(0, LAYOUT_LIMITS.moved)) {
      const p = str(id) && place(v);
      if (p) out.moved[id] = p;
    }
  }
  if (Array.isArray(r.removed)) out.removed = [...new Set(r.removed.map((x) => str(x)).filter((x): x is string => !!x))].slice(0, LAYOUT_LIMITS.removed);
  if (Array.isArray(r.added)) {
    for (const v of r.added.slice(0, LAYOUT_LIMITS.added)) {
      const p = place(v);
      const a = v as Record<string, unknown>;
      const id = str(a?.id), kind = str(a?.kind);
      if (p && id && kind && !out.added.some((x) => x.id === id)) out.added.push({ id, kind, ...p });
    }
  }
  if (r.camps && typeof r.camps === 'object') {
    for (const [id, v] of Object.entries(r.camps as Record<string, unknown>).slice(0, LAYOUT_LIMITS.camps)) {
      const c = v as Record<string, unknown>;
      if (!str(id) || !c || typeof c.x !== 'number' || typeof c.z !== 'number' || !Array.isArray(c.enemies)) continue;
      const enemies = (c.enemies as unknown[])
        .filter((e): e is [EnemyId, number] => Array.isArray(e) && typeof e[0] === 'string' && enemyOk(e[0]) && typeof e[1] === 'number')
        .slice(0, LAYOUT_LIMITS.campEnemies)
        .map(([id, n]) => [id, Math.round(num(n, 1, LAYOUT_LIMITS.campCount, 1))] as [EnemyId, number]);
      if (!enemies.length) continue;
      out.camps[id] = { x: num(c.x, -2000, 2000, 0), z: num(c.z, -2000, 2000, 0), radius: num(c.radius, 4, 60, 16), enemies };
    }
  }
  if (Array.isArray(r.brushes)) {
    for (const v of r.brushes.slice(0, LAYOUT_LIMITS.brushes)) {
      const b = v as Record<string, unknown>;
      if (!b || typeof b.x !== 'number' || typeof b.z !== 'number' || !MODES.includes(b.mode as BrushMode)) continue;
      out.brushes.push({ x: num(b.x, -2000, 2000, 0), z: num(b.z, -2000, 2000, 0), radius: num(b.radius, 1, 120, 8), mode: b.mode as BrushMode, amount: num(b.amount, -60, 120, 1) });
    }
  }
  return out;
}

/** True when the layout changes nothing. */
export const isEmptyLayout = (l: Layout) =>
  !Object.keys(l.moved).length && !l.removed.length && !l.added.length && !Object.keys(l.camps).length && !l.brushes.length;

/** A short fingerprint of a layout, so co-op players can check they have the same world. "0" for an empty one. */
export function layoutHash(l: Layout): string {
  if (isEmptyLayout(l)) return '0';
  const text = JSON.stringify([l.moved, [...l.removed].sort(), l.added, l.camps, l.brushes]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
