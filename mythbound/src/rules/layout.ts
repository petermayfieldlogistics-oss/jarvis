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
