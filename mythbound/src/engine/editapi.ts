// What the world offers the editor (src/ui/editor.ts). The world implements
// it; the editor only ever talks to the world through it.

import type { EnemyId } from '../data/world';
import type { Brush, Camp, Layout } from '../rules/layout';

export type EditLayer = 'pieces' | 'plants' | 'camps' | 'npcs';

/** Something in the world the editor can show, select and change. */
export interface EditItem {
  layer: EditLayer;
  id: string;
  /** Palette kind (for added things) or a short type name. */
  kind: string;
  label: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  /** Rough size, for picking and the selection ring. */
  radius: number;
  height: number;
  /** Can be looked at but not moved or removed (trial arenas, the volcano...). */
  fixed?: boolean;
  /** Camps only. */
  camp?: Camp;
}

export interface PaletteEntry {
  layer: 'pieces' | 'plants' | 'camps';
  kind: string;
  label: string;
  /** Palette tab: e.g. "Buildings", "Props", "Trees", "Rocks", "Plants", "Camps". */
  group: string;
}

export interface WorldEditApi {
  /** A copy of the layout as it stands (what Publish saves). */
  layout(): Layout;
  /** Replaces the whole layout (undo, load from file) and rebuilds what changed. */
  load(layout: Layout): void;
  /** Things in a layer within r metres of (x, z), nearest first. */
  items(layer: EditLayer, x: number, z: number, r: number): EditItem[];
  palette(): PaletteEntry[];
  /** Moves, turns and sizes something; shows at once and records it in the layout. */
  move(layer: EditLayer, id: string, x: number, z: number, rot: number, scale: number): void;
  /** Places a new thing from the palette; returns its id. */
  add(kind: string, x: number, z: number, rot: number): string;
  /** Takes something away (built-in things are recorded as removed). */
  remove(layer: EditLayer, id: string): void;
  /** Changes a camp's size and monsters. */
  setCamp(id: string, radius: number, enemies: [EnemyId, number][]): void;
  /** Adds a ground brush stroke and rebuilds the ground, plants and colliders it touches. */
  brush(b: Brush): void;
  /** Ground height at (x, z), with the layout's brushes. */
  heightAt(x: number, z: number): number;
}
