// Builder mode (admins only): fly anywhere, place building blocks, the town's
// props and the wild's trees and rocks, pick things up (the wild trees and
// rocks too), turn, size and delete them, and save the result as a build that
// anyone can open by its link. Step out of it (K) to play in what you built.

import * as THREE from 'three';
import { heightAt } from './terrain';
import { readLocal, writeLocal } from './state';
import { PAGES_URL } from './net';
import type { Collider, PlantHit, PropKind } from './world';
import type { Game } from './game';

/** A prop placed in the world: where its foot stands, its turn (radians) and size. */
export interface AddEdit {
  t: 'add';
  k: PropKind;
  x: number;
  y: number;
  z: number;
  r: number;
  s: number;
}
/** A wild tree or rock taken away, by where it grew. */
export interface CutEdit {
  t: 'cut';
  x: number;
  z: number;
}
export type Edit = AddEdit | CutEdit;

interface Item {
  kind: PropKind;
  name: string;
  /** Its footprint as colliders [x, z, r] in its own frame (none: walk through it). */
  cols: number[][];
  /** How tall it stands (its colliders' top, and where the next one stacks). */
  h: number;
  /** Grid it snaps to, metres. */
  grid: number;
}

const it = (kind: PropKind, name: string, cols: number[][], h: number, grid = 1): Item => ({ kind, name, cols, h, grid });

/** What builder mode can place, by category. */
export const CATEGORIES: { name: string; items: Item[] }[] = [
  {
    name: 'Build',
    items: [
      it('stone-block', 'Stone block', [[0, 0, 1.2]], 2, 2),
      it('wood-block', 'Wooden block', [[0, 0, 1.2]], 2, 2),
      it('wall', 'Stone wall', [[-1.5, 0, 0.5], [-0.5, 0, 0.5], [0.5, 0, 0.5], [1.5, 0, 0.5]], 3, 2),
      it('floor', 'Wooden floor', [], 0.24, 2),
      it('pillar', 'Pillar', [[0, 0, 0.6]], 4.4, 1),
      it('stairs', 'Stairs', [], 4, 1),
      it('arch', 'Arch', [[-1.8, 0, 0.55], [1.8, 0, 0.55]], 4.9, 1),
      it('roof', 'Roof', [], 2.2, 1),
      it('tower', 'Tower', [[0, 0, 2.1]], 9.4, 1),
    ],
  },
  {
    name: 'Town',
    items: [
      it('house', 'House', [[0, 0, 3.3]], 7, 1),
      it('big-house', 'Big house', [[0, 0, 4.9]], 9, 1),
      it('barrel', 'Barrel', [[0, 0, 0.45]], 1, 0.5),
      it('crate', 'Crate', [[0, 0, 0.65]], 1, 0.5),
      it('fence', 'Fence', [[-2.4, 0, 0.3], [0, 0, 0.3], [2.4, 0, 0.3]], 1.2, 1),
      it('banner', 'Banner', [[0, 0, 0.3]], 6, 0.5),
      it('brazier', 'Brazier', [[0, 0, 0.65]], 2, 0.5),
      it('lamp', 'Lamp post', [[0, 0, 0.2]], 3.3, 0.5),
      it('campfire', 'Campfire', [], 0.6, 0.5),
      it('tent', 'Tent', [[0, 0, 1.5]], 3, 1),
      it('well', 'Well', [[0, 0, 1.2]], 3, 1),
      it('statue', 'Statue', [[0, 0, 1]], 4.2, 1),
    ],
  },
  {
    name: 'Nature',
    items: [
      it('oak', 'Oak', [[0, 0, 0.8]], 9, 0.5),
      it('pine', 'Pine', [[0, 0, 0.7]], 9, 0.5),
      it('birch', 'Birch', [[0, 0, 0.7]], 9, 0.5),
      it('palm', 'Palm', [[0, 0, 0.5]], 9, 0.5),
      it('dead', 'Dead tree', [[0, 0, 0.7]], 9, 0.5),
      it('ashtree', 'Ash tree', [[0, 0, 0.7]], 9, 0.5),
      it('cactus', 'Cactus', [[0, 0, 0.7]], 3.4, 0.5),
      it('bush', 'Bush', [], 1.2, 0.5),
      it('rock', 'Rock', [[0, 0, 0.9]], 1.2, 0.5),
      it('crystal', 'Crystal', [[0, 0, 0.6]], 1.6, 0.5),
      it('mushroom', 'Glowing mushroom', [], 0.6, 0.5),
      it('flowers', 'Flowers', [], 0.4, 0.5),
    ],
  },
];
/** Each thing's picture on the item hotbar. */
const ICON: Record<string, string> = {
  'stone-block': '🧱', 'wood-block': '🪵', wall: '🏰', floor: '▦', pillar: '🏛', stairs: '🪜', arch: '⛩', roof: '🛖', tower: '🗼',
  house: '🏠', 'big-house': '🏘', barrel: '🛢', crate: '📦', fence: '🚧', banner: '🚩', brazier: '🔥', lamp: '🏮', campfire: '♨', tent: '⛺', well: '⛲', statue: '🗿',
  oak: '🌳', pine: '🌲', birch: '🌳', palm: '🌴', dead: '🍂', ashtree: '🌳', cactus: '🌵', bush: '🌿', rock: '🪨', crystal: '💎', mushroom: '🍄', flowers: '🌸',
};

/** What a left click does: build the picked thing, carry one about, knock one down, or copy one. */
type Mode = 'place' | 'move' | 'delete' | 'copy';
const MODES: { id: Mode; icon: string; name: string; tip: string }[] = [
  { id: 'place', icon: '🔨', name: 'Place', tip: 'Left click builds the picked thing' },
  { id: 'move', icon: '✋', name: 'Move', tip: 'Left click picks a thing up; click again to set it down' },
  { id: 'delete', icon: '🗑', name: 'Delete', tip: 'Left click knocks a thing down' },
  { id: 'copy', icon: '📋', name: 'Copy', tip: 'Left click copies a thing, then you place it' },
];
/** The marker's colour in each mode. */
const MODE_COLOR: Record<Mode, number> = { place: 0x60e0ff, move: 0xffd060, delete: 0xff5040, copy: 0x9aff80 };

const ITEMS = new Map<string, Item>(CATEGORIES.flatMap((c) => c.items.map((i) => [i.kind, i] as [string, Item])));
/** The wild plants' names when one is picked up. */
const WILD = new Set(['oak', 'pine', 'birch', 'palm', 'dead', 'ashtree', 'cactus', 'bush', 'rock', 'crystal']);

const DRAFT_KEY = 'mythbound.build.draft.v1';
const MAX_EDITS = 4000;
const spot = (x: number, z: number) => `${Math.round(x * 10)},${Math.round(z * 10)}`;
const num = (v: unknown, lo: number, hi: number, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** A build's changes as they arrive from the server or a draft: anything malformed is left out. */
export function cleanEdits(list: unknown): Edit[] {
  if (!Array.isArray(list)) return [];
  const out: Edit[] = [];
  for (const e of list.slice(0, MAX_EDITS)) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (o.t === 'cut') out.push({ t: 'cut', x: num(o.x, -900, 900), z: num(o.z, -900, 900) });
    else if (o.t === 'add' && typeof o.k === 'string' && ITEMS.has(o.k)) {
      out.push({ t: 'add', k: o.k as PropKind, x: num(o.x, -900, 900), y: num(o.y, -60, 600), z: num(o.z, -900, 900), r: num(o.r, -100, 100), s: num(o.s, 0.2, 5, 1) });
    }
  }
  return out;
}

interface Placed {
  e: AddEdit;
  obj: THREE.Object3D;
  cols: Collider[];
}

type Target =
  | { kind: 'placed'; p: Placed; point: THREE.Vector3; top: boolean }
  | { kind: 'plant'; hit: PlantHit; point: THREE.Vector3 }
  | { kind: 'ground'; point: THREE.Vector3 };

export interface BuildMeta {
  /** The saved build this is (its link), if it has been saved. */
  id?: string;
  name: string;
  owner?: string;
}

const _ray = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Builder {
  active = false;
  meta: BuildMeta = { name: 'My build' };
  /** Changes since the last save. */
  dirty = false;
  private placed: Placed[] = [];
  private cuts = new Map<string, CutEdit>();
  private cat = 0;
  private item = 0;
  private turn = 0;
  private size = 1;
  private snap = true;
  private mode: Mode = 'place';
  /** Picked up and following the aim; `was` is where it stood (put back on Escape). */
  private held: { p: Placed; was: AddEdit | null; turn: number; size: number } | null = null;
  private ghost: THREE.Object3D | null = null;
  private ghostKind = '';
  private target: Target | null = null;
  private marker: THREE.Mesh;
  private undo: string[] = [];
  private queue: string[] = [];
  private hud: HTMLElement;

  constructor(private g: Game) {
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x60e0ff, transparent: true, opacity: 0.85, depthWrite: false }));
    this.marker.visible = false;
    this.marker.renderOrder = 10;
    g.scene.add(this.marker);
    this.hud = document.createElement('div');
    this.hud.className = 'builder-hud hidden';
    g.container.appendChild(this.hud);
    // The hotbars and buttons answer clicks (when the mouse is free).
    this.hud.addEventListener('mousedown', (e) => e.stopPropagation());
    this.hud.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-bmode],[data-bcat],[data-bitem],[data-bact]');
      if (!t) return;
      if (t.dataset.bmode) this.queue.push(`mode:${t.dataset.bmode}`);
      else if (t.dataset.bcat) this.queue.push(`cat:${t.dataset.bcat}`);
      else if (t.dataset.bitem) this.queue.push(`item:${t.dataset.bitem}`);
      else if (t.dataset.bact === 'save') this.g.adminPanel.open();
      else if (t.dataset.bact === 'leave') this.exit();
      else if (t.dataset.bact) this.queue.push(t.dataset.bact);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.active || this.g.mode !== 'play' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.ctrlKey && e.code === 'KeyZ') return e.preventDefault(), void this.queue.push('undo');
      if (e.code === 'Tab') return e.preventDefault(), void this.queue.push(e.shiftKey ? 'cat:-' : 'cat:+');
      // Alt lets go of the mouse, so the hotbars can be clicked (clicking the world takes it back).
      if (e.code === 'AltLeft' || e.code === 'AltRight') return e.preventDefault(), void (document.pointerLockElement && document.exitPointerLock());
      if (['KeyQ', 'KeyE', 'KeyR', 'KeyT', 'KeyZ', 'KeyX', 'KeyG', 'KeyU', 'Delete', 'Backspace', 'Escape', 'Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
        if (e.code === 'Backspace') e.preventDefault();
        if (!e.repeat || e.code === 'KeyR' || e.code === 'KeyT' || e.code === 'KeyZ' || e.code === 'KeyX') this.queue.push(e.code);
      }
    });
    g.renderer.domElement.addEventListener('mousedown', (e) => {
      if (this.active && this.g.mode === 'play') this.queue.push(`click${e.button}`);
    });
  }

  // ---------------------------------------------------------- in and out --

  toggle() {
    if (this.active) this.exit();
    else this.enter();
  }

  enter() {
    const g = this.g;
    if (!g.admin) return g.hud.toast('Builder mode is for admins.', 'warn');
    if (g.player.riding) g.player.dismount(g);
    this.active = true;
    // Nothing built yet this session: pick up where the last unsaved build left off.
    if (!this.placed.length && !this.cuts.size && !this.meta.id) {
      const draft = readLocal<{ meta: BuildMeta; edits: Edit[] }>(DRAFT_KEY);
      if (draft?.edits?.length) {
        this.meta = { name: String(draft.meta?.name ?? 'My build').slice(0, 40), id: draft.meta?.id, owner: draft.meta?.owner };
        this.apply(cleanEdits(draft.edits));
        g.hud.toast(`Builder: carried on with "${this.meta.name}" (not saved yet).`, 'skill');
      }
    }
    this.hud.classList.remove('hidden');
    g.container.classList.add('building');
    g.hud.toast('Builder mode: fly with WASD, Space and C. K steps out again.', 'skill');
    this.render();
  }

  exit() {
    const g = this.g;
    if (this.held) this.drop();
    this.active = false;
    this.setGhost(null);
    this.marker.visible = false;
    this.hud.classList.add('hidden');
    g.container.classList.remove('building');
    // Down to the ground, gently.
    const p = g.player;
    p.pos.y = Math.max(heightAt(p.pos.x, p.pos.z), Math.min(p.pos.y, heightAt(p.pos.x, p.pos.z) + 0.5));
    p.vel.set(0, 0, 0);
    g.hud.toast(this.dirty ? 'Left builder mode. Your build is not saved yet (P, then Save).' : 'Left builder mode.', this.dirty ? 'warn' : 'skill');
  }

  // --------------------------------------------------------------- frame --

  update(dt: number) {
    const g = this.g;
    const input = g.input;
    // Flying: camera-relative WASD, Space up, C down, Shift fast.
    const fast = input.held.has('sprint') ? 3 : 1;
    const yaw = g.camYaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const mx = input.move.x, my = input.move.y;
    const up = (input.held.has('jump') ? 1 : 0) - (input.held.has('roll') ? 1 : 0);
    _v.set((fx * my - fz * mx) * 12 * fast, up * 9 * fast, (fz * my + fx * mx) * 12 * fast);
    g.player.buildFly(dt, _v);

    // The mouse wheel runs along the item hotbar.
    if (input.wheel) this.queue.push(input.wheel > 0 ? 'KeyE' : 'KeyQ');
    for (const q of this.queue.splice(0)) this.command(q);
    this.aim();
    this.show();
  }

  private command(q: string) {
    const cat = CATEGORIES[this.cat];
    switch (q) {
      case 'KeyQ':
      case 'KeyE':
        this.item = (this.item + (q === 'KeyE' ? 1 : cat.items.length - 1)) % cat.items.length;
        break;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
        this.setMode(MODES[Number(q.slice(5)) - 1].id);
        break;
      case 'undo-btn':
        this.undoLast();
        break;
      case 'grid':
        this.command('KeyG');
        return;
      default:
        if (q.startsWith('mode:')) this.setMode(q.slice(5) as Mode);
        else if (q.startsWith('cat:')) {
          const v = q.slice(4);
          this.cat = v === '+' ? (this.cat + 1) % CATEGORIES.length : v === '-' ? (this.cat + CATEGORIES.length - 1) % CATEGORIES.length : Math.max(0, Math.min(CATEGORIES.length - 1, Number(v)));
          this.item = 0;
        } else if (q.startsWith('item:')) {
          this.item = Math.max(0, Math.min(cat.items.length - 1, Number(q.slice(5))));
          if (this.mode !== 'place' && !this.held) this.setMode('place');
        }
        break;
      case 'KeyR':
      case 'KeyT': {
        const step = this.snap ? (this.current().grid >= 1 ? Math.PI / 2 : Math.PI / 4) : Math.PI / 12;
        this.turn += q === 'KeyR' ? step : -step;
        if (this.held) this.held.p.e.r = this.turn;
        break;
      }
      case 'KeyZ':
      case 'KeyX':
        this.size = Math.min(5, Math.max(0.25, this.size * (q === 'KeyX' ? 1.1 : 1 / 1.1)));
        if (this.held) this.held.p.e.s = this.size;
        break;
      case 'KeyG':
        this.snap = !this.snap;
        this.g.hud.toast(this.snap ? 'Snapping to the grid.' : 'Free placement.', 'skill');
        break;
      case 'KeyU':
      case 'undo':
        this.undoLast();
        break;
      case 'Delete':
      case 'Backspace':
        this.remove();
        break;
      case 'Escape':
        if (this.held) this.cancelHold();
        break;
      case 'click0':
        if (this.held) this.drop();
        else if (this.mode === 'move') this.pickUp();
        else if (this.mode === 'delete') this.remove();
        else if (this.mode === 'copy') {
          if (this.copyTarget()) this.setMode('place');
        } else this.place();
        break;
      case 'click2':
        this.pickUp();
        break;
      case 'click1':
        // Middle click: take the kind (and turn) of what you're looking at.
        if (this.copyTarget()) this.setMode('place');
        break;
    }
    this.render();
  }

  /** Switches what a left click does (anything carried is put back first, unless moving). */
  private setMode(m: Mode) {
    if (this.held && m !== 'move' && m !== 'place') this.cancelHold();
    this.mode = m;
  }

  /** Takes the kind, turn and size of what is aimed at; false if nothing is. */
  private copyTarget(): boolean {
    const t = this.target;
    if (t?.kind === 'placed') this.choose(t.p.e.k, t.p.e.r, t.p.e.s);
    else if (t?.kind === 'plant') this.choose(t.hit.kind as PropKind, t.hit.turn, t.hit.scale);
    else return false;
    this.g.hud.toast(`Copied: ${this.current().name}`, 'skill');
    return true;
  }

  private current(): Item {
    const cat = CATEGORIES[this.cat];
    return cat.items[Math.min(this.item, cat.items.length - 1)];
  }

  private choose(kind: PropKind, turn: number, size: number) {
    CATEGORIES.forEach((c, ci) => c.items.forEach((x, ii) => x.kind === kind && ((this.cat = ci), (this.item = ii))));
    this.turn = turn;
    this.size = size;
  }

  /** What the middle of the screen points at: a placed prop, a wild plant, or the ground. */
  private aim() {
    const g = this.g;
    _ray.setFromCamera(_center, g.camera);
    _ray.far = 160;
    const from = g.player.pos;
    let best: Target | null = null;
    let bestD = Infinity;
    const objs = this.placed.filter((p) => p !== this.held?.p && Math.abs(p.e.x - from.x) + Math.abs(p.e.z - from.z) < 200).map((p) => p.obj);
    for (const h of _ray.intersectObjects(objs, true)) {
      const p = this.placed.find((x) => x.obj === h.object || x.obj.getObjectById(h.object.id));
      if (!p) continue;
      const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : _v.set(0, 1, 0);
      best = { kind: 'placed', p, point: h.point.clone(), top: n.y > 0.7 };
      bestD = h.distance;
      break;
    }
    for (const h of _ray.intersectObjects(g.world.pickablePlants(from, 120), false)) {
      if (h.distance >= bestD) break;
      if (h.instanceId === undefined) continue;
      const hit = g.world.plantHit(h.object as THREE.InstancedMesh, h.instanceId);
      if (!hit || this.cuts.has(spot(hit.x, hit.z))) continue;
      best = { kind: 'plant', hit, point: h.point.clone() };
      bestD = h.distance;
      break;
    }
    // The ground: step along the ray until it goes under the land.
    const o = _ray.ray.origin, d = _ray.ray.direction;
    let prev = 0;
    for (let t = 0.5; t < Math.min(bestD, 160); t += 0.5) {
      if (o.y + d.y * t < heightAt(o.x + d.x * t, o.z + d.z * t)) {
        let a = prev, b = t;
        for (let i = 0; i < 8; i++) {
          const m = (a + b) / 2;
          if (o.y + d.y * m < heightAt(o.x + d.x * m, o.z + d.z * m)) b = m;
          else a = m;
        }
        const x = o.x + d.x * b, z = o.z + d.z * b;
        best = { kind: 'ground', point: new THREE.Vector3(x, heightAt(x, z), z) };
        break;
      }
      prev = t;
    }
    this.target = best;
  }

  /** Where the next prop would stand: on the ground (or on top of a block), on the grid. */
  private standAt(out: THREE.Vector3): boolean {
    const t = this.target;
    if (!t) return false;
    const item = this.held ? ITEMS.get(this.held.p.e.k)! : this.current();
    let { x, z } = t.point;
    if (this.snap) {
      const gs = item.grid;
      x = Math.round(x / gs) * gs;
      z = Math.round(z / gs) * gs;
    }
    let y = heightAt(x, z);
    // Stacking: on top of the block looked at.
    if (t.kind === 'placed' && t.top) {
      const below = ITEMS.get(t.p.e.k)!;
      y = Math.max(y, t.p.e.y + below.h * t.p.e.s);
      if (this.snap) (x = t.p.e.x), (z = t.p.e.z);
    }
    out.set(x, y, z);
    return true;
  }

  /** The ghost of what would be placed (or the prop being carried), and the ring at its foot. */
  private show() {
    const at = _p;
    const ok = this.standAt(at);
    if (this.held) {
      const e = this.held.p.e;
      if (ok) (e.x = at.x), (e.y = at.y), (e.z = at.z);
      this.pose(this.held.p);
      this.setGhost(null);
    } else {
      const item = this.current();
      this.setGhost(ok && this.mode === 'place' ? item.kind : null);
      if (this.ghost && ok) {
        this.ghost.position.copy(at);
        this.ghost.rotation.y = this.turn;
        this.ghost.scale.setScalar(this.size);
      }
    }
    const t = this.target;
    this.marker.visible = !!t;
    if (t) {
      const base = t.kind === 'placed' ? _v.set(t.p.e.x, t.p.e.y, t.p.e.z) : t.kind === 'plant' ? _v.set(t.hit.x, heightAt(t.hit.x, t.hit.z), t.hit.z) : at;
      this.marker.position.set(base.x, base.y + 0.08, base.z);
      const r = t.kind === 'placed' ? Math.max(0.6, ...ITEMS.get(t.p.e.k)!.cols.map((c) => Math.hypot(c[0], c[1]) + c[2]), 1) * t.p.e.s : t.kind === 'plant' ? 1.2 * t.hit.scale : 0.6;
      this.marker.scale.setScalar(r);
      (this.marker.material as THREE.MeshBasicMaterial).color.setHex(this.held ? 0xffd060 : t.kind === 'ground' && this.mode !== 'place' ? 0x8a8a8a : MODE_COLOR[this.mode]);
    }
  }

  private setGhost(kind: string | null) {
    if (kind === this.ghostKind) return;
    if (this.ghost) this.g.scene.remove(this.ghost);
    this.ghost = null;
    this.ghostKind = kind ?? '';
    if (!kind) return;
    this.ghost = this.g.world.makeProp(kind as PropKind);
    this.g.scene.add(this.ghost);
  }

  // -------------------------------------------------------------- editing --

  private snapshot() {
    this.undo.push(JSON.stringify(this.edits()));
    if (this.undo.length > 60) this.undo.shift();
    this.dirty = true;
  }

  private changed() {
    writeLocal(DRAFT_KEY, { meta: this.meta, edits: this.edits() });
  }

  private place() {
    if (!this.standAt(_p)) return;
    this.snapshot();
    this.spawn({ t: 'add', k: this.current().kind, x: _p.x, y: _p.y, z: _p.z, r: this.turn, s: this.size });
    this.changed();
  }

  /** Picks up what you're looking at: a placed prop, or a wild tree or rock (taken out of the wild and carried). */
  private pickUp() {
    const t = this.target;
    if (!t || t.kind === 'ground') return;
    this.snapshot();
    const keep = { turn: this.turn, size: this.size };
    if (t.kind === 'placed') {
      this.held = { p: t.p, was: { ...t.p.e }, ...keep };
      this.clearCols(t.p);
    } else {
      const h = t.hit;
      if (!WILD.has(h.kind)) return;
      this.cut(h.x, h.z);
      const p = this.spawn({ t: 'add', k: h.kind as PropKind, x: h.x, y: heightAt(h.x, h.z), z: h.z, r: h.turn, s: h.scale });
      this.clearCols(p);
      this.held = { p, was: null, ...keep };
    }
    this.turn = this.held.p.e.r;
    this.size = this.held.p.e.s;
  }

  private drop() {
    const h = this.held;
    if (!h) return;
    this.held = null;
    this.pose(h.p);
    this.addCols(h.p);
    // Back to what was being placed before.
    this.turn = h.turn;
    this.size = h.size;
    this.changed();
  }

  private cancelHold() {
    const h = this.held;
    if (!h) return;
    this.held = null;
    if (h.was) {
      Object.assign(h.p.e, h.was);
      this.pose(h.p);
      this.addCols(h.p);
      this.undo.pop();
    } else this.undoLast();
  }

  private remove() {
    if (this.held) {
      const p = this.held.p;
      this.held = null;
      this.despawn(p);
      this.changed();
      return;
    }
    const t = this.target;
    if (!t || t.kind === 'ground') return;
    this.snapshot();
    if (t.kind === 'placed') this.despawn(t.p);
    else this.cut(t.hit.x, t.hit.z);
    this.changed();
  }

  private undoLast() {
    const last = this.undo.pop();
    if (last === undefined) return this.g.hud.toast('Nothing to undo.', 'warn');
    this.held = null;
    this.apply(cleanEdits(JSON.parse(last)));
    this.changed();
  }

  private cut(x: number, z: number) {
    const k = spot(x, z);
    if (this.cuts.has(k)) return;
    this.cuts.set(k, { t: 'cut', x, z });
    this.g.world.cutPlant(x, z);
  }

  private spawn(e: AddEdit): Placed {
    const obj = this.g.world.makeProp(e.k);
    const p: Placed = { e, obj, cols: [] };
    this.g.scene.add(obj);
    this.pose(p);
    this.addCols(p);
    this.placed.push(p);
    return p;
  }

  private despawn(p: Placed) {
    this.clearCols(p);
    this.g.scene.remove(p.obj);
    this.placed = this.placed.filter((x) => x !== p);
  }

  private pose(p: Placed) {
    p.obj.position.set(p.e.x, p.e.y, p.e.z);
    p.obj.rotation.y = p.e.r;
    p.obj.scale.setScalar(p.e.s);
    p.obj.updateMatrixWorld(true);
  }

  private addCols(p: Placed) {
    this.clearCols(p);
    const item = ITEMS.get(p.e.k)!;
    const c = Math.cos(p.e.r), s = Math.sin(p.e.r);
    for (const [lx, lz, r] of item.cols) {
      const x = p.e.x + (lx * c + lz * s) * p.e.s, z = p.e.z + (-lx * s + lz * c) * p.e.s;
      p.cols.push(this.g.world.addCollider(x, z, r * p.e.s, p.e.y + item.h * p.e.s));
    }
  }

  private clearCols(p: Placed) {
    for (const c of p.cols) this.g.world.removeCollider(c);
    p.cols = [];
  }

  // ------------------------------------------------------- saving, loading --

  /** Every change, in the form saved to the server. */
  edits(): Edit[] {
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return [...this.cuts.values(), ...this.placed.map((p) => ({ ...p.e, x: r(p.e.x), y: r(p.e.y), z: r(p.e.z), r: r(p.e.r), s: r(p.e.s) }))];
  }

  get count() {
    return this.placed.length + this.cuts.size;
  }

  /** Makes the world match these changes (loading a build, or undoing). */
  apply(edits: Edit[]) {
    for (const p of [...this.placed]) this.despawn(p);
    const want = new Map<string, CutEdit>();
    for (const e of edits) if (e.t === 'cut') want.set(spot(e.x, e.z), e);
    for (const [k, c] of this.cuts) if (!want.has(k)) this.g.world.uncutPlant(c.x, c.z);
    for (const [k, c] of want) if (!this.cuts.has(k)) this.g.world.cutPlant(c.x, c.z);
    this.cuts = want;
    for (const e of edits) if (e.t === 'add') this.spawn({ ...e });
  }

  /** Opens a saved build (anyone with its link). */
  load(meta: BuildMeta, edits: Edit[]) {
    this.meta = meta;
    this.undo = [];
    this.apply(edits);
    this.dirty = false;
  }

  /** Starts an empty build (the world back as it was). */
  fresh() {
    this.snapshot();
    this.held = null;
    this.apply([]);
    this.meta = { name: 'My build' };
    this.changed();
  }

  /** Saves to the server (over this build if it is yours, else as a new one) and returns its link. */
  async save(name: string): Promise<string> {
    const g = this.g;
    if (this.held) this.drop();
    const mine = this.meta.id && (!this.meta.owner || this.meta.owner.toLowerCase() === g.accountName.toLowerCase());
    if (!g.cloud) throw new Error('Log in with your account to save builds.');
    const id = await g.cloud.saveBuild(name, this.edits(), mine ? this.meta.id : undefined);
    this.meta = { id, name, owner: g.accountName };
    this.dirty = false;
    this.changed();
    this.render();
    return buildLink(id);
  }

  /** The builder's screen: a trim round the edge, the build's name up top, and the mode and item hotbars below. */
  render() {
    if (!this.active) return;
    const item = this.current();
    const cat = CATEGORIES[this.cat];
    const name = this.meta.name.replace(/[<>&"]/g, '');
    const mode = MODES.find((m) => m.id === this.mode)!;
    const status = this.held
      ? `Carrying <b>${ITEMS.get(this.held.p.e.k)!.name}</b>: left click sets it down, Esc puts it back`
      : this.mode === 'place' ? `Placing <b>${item.name}</b> · size ${this.size.toFixed(2)} · turn ${Math.round(((this.turn * 180) / Math.PI) % 360)}°` : mode.tip;
    const modes = MODES.map((m, i) => `<button class="bslot mode${m.id === this.mode ? ' on' : ''}" data-bmode="${m.id}" title="${m.tip}"><i>${i + 1}</i><span>${m.icon}</span><em>${m.name}</em></button>`).join('');
    const tools = `<button class="bslot tool" data-bact="undo-btn" title="Undo (U)"><i>U</i><span>↶</span><em>Undo</em></button>
      <button class="bslot tool${this.snap ? ' on' : ''}" data-bact="grid" title="Snap to the grid (G)"><i>G</i><span>▦</span><em>Grid</em></button>
      <button class="bslot tool" data-bact="save" title="Save and get a link (P)"><i>P</i><span>💾</span><em>Save</em></button>
      <button class="bslot tool" data-bact="leave" title="Leave builder mode (K)"><i>K</i><span>⏏</span><em>Leave</em></button>`;
    const cats = CATEGORIES.map((c, i) => `<button class="bcat${i === this.cat ? ' on' : ''}" data-bcat="${i}">${c.name}</button>`).join('');
    const items = cat.items.map((x, i) => `<button class="bslot item${i === this.item && this.mode === 'place' ? ' on' : ''}" data-bitem="${i}" title="${x.name}"><span>${ICON[x.kind] ?? '◆'}</span><em>${x.name}</em></button>`).join('');
    this.hud.innerHTML = `<div class="bh-trim"><b class="c tl"></b><b class="c tr"></b><b class="c bl"></b><b class="c br"></b></div>
      <div class="bh-top"><span class="bh-title">Builder Mode</span><span class="bh-name">${name}</span><span class="bh-state${this.dirty ? ' warn' : ''}">${this.dirty ? 'not saved' : this.meta.id ? 'saved' : 'new'} · ${this.count} changes</span></div>
      <div class="bh-cross" style="--mc:#${MODE_COLOR[this.held ? 'move' : this.mode].toString(16).padStart(6, '0')}"></div>
      <div class="bh-bottom">
        <div class="bh-status">${status}</div>
        <div class="bh-items"><div class="bh-cats"><kbd>Tab</kbd>${cats}<span class="bh-qe"><kbd>Q</kbd><kbd>E</kbd></span></div><div class="bh-row">${items}</div></div>
        <div class="bh-bar">${modes}<span class="bh-sep"></span>${tools}</div>
        <div class="bh-keys">WASD fly · Space / C up and down · Shift fast · Wheel item · Alt free the mouse to click · Right click pick up · R/T turn · Z/X size · Del delete</div>
      </div>`;
  }
}

/** The link that opens a saved build. */
export function buildLink(id: string): string {
  const here = /github\.io$/.test(location.hostname) ? PAGES_URL : location.origin + location.pathname;
  return `${here}?build=${id}`;
}
