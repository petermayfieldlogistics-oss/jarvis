// The wardrobe: a sheet over the bottom of the screen (beside the hero on a
// wide screen) to try on garments and dye colours. Purely for looks. Each tap
// dresses the hero (a new model, at most every 250 ms); Keep saves the outfit
// and shows it to friends. Closing any other way puts the old clothes back.

import { CHANNEL_NAME, CHANNELS, DYES, GARMENTS, RECIPES, STATION_NAME, dyeOf, garment, type DyeChannel, type Slot } from '../data/goods';
import { CLASSES } from '../data/defs';
import { ITEMS } from '../data/world';
import { dressedOf, knowsDye, lockedSlot, outfitKey, ownsGarment, wardrobeCounts, type Outfit } from '../rules/outfit';
import type { Game } from '../engine/game';

type Tab = Slot | 'colours';
const TABS: Tab[] = ['head', 'body', 'cloak', 'colours'];
const TAB_NAME: Record<Tab, string> = { head: 'Head', body: 'Body', cloak: 'Cloak', colours: 'Colours' };
/** Seconds between rebuilds of the hero while trying things on. */
const PREVIEW_GAP = 0.25;

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/** How to come by a garment or a colour (shown on a locked tile). */
function howToGet(kind: 'garment' | 'dye', id: string): string {
  const def = kind === 'garment' ? garment(id) : dyeOf(id);
  if (!def) return '';
  if (def.earned) return def.earned;
  const r = RECIPES.find((x) => x.makes.kind === kind && x.makes.id === id);
  const parts: string[] = [];
  if (r) parts.push(`${STATION_NAME[r.station]}: ${Object.entries(r.needs).map(([k, n]) => `${n} ${ITEMS[k]?.name ?? k}`).join(', ')}`);
  if (def.price) parts.push(`Quill sells it (${def.price})`);
  return parts.join(' · ');
}

export class Wardrobe {
  isOpen = false;
  private el: HTMLElement;
  private tab: Tab = 'head';
  private drawnTab: Tab | null = null;
  private channel: DyeChannel = 'cloth';
  private draft: Outfit | null = null;
  private saved: Outfit | null = null;
  /** The outfit on the model now, and when it was put on. */
  private shown = '';
  private builtAt = -9;
  private timer = 0;
  private check = 0;
  private cam = { yaw: 0, dist: 0, pitch: 0, heroYaw: 0 };

  constructor(parent: HTMLElement, private g: Game) {
    this.el = document.createElement('div');
    this.el.className = 'wardrobe hidden';
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.isOpen || e.key !== 'Escape') return;
        e.stopImmediatePropagation();
        this.close();
      },
      true,
    );
  }

  open() {
    const g = this.g;
    const why = g.player.wardrobeBlock(g);
    if (why) return g.hud.toast(why, 'warn');
    const c = g.player.c;
    this.saved = { ...c.wardrobe.outfit };
    this.draft = { ...c.wardrobe.outfit };
    this.shown = outfitKey(dressedOf(this.saved));
    this.isOpen = true;
    g.setMode('event');
    g.hud.prompt(null);
    // The hero turns to face the camera (which stays on the open side they came from,
    // not behind a loom or a shrine), the camera closes in, and frames them clear of the sheet.
    const cam = g.cam;
    const p = g.player;
    this.cam = { yaw: cam.yaw, dist: cam.dist, pitch: cam.pitch, heroYaw: p.yaw };
    p.yaw = cam.yaw - Math.PI;
    p.syncModel();
    cam.dist = 3.2;
    cam.pitch = 0.12;
    this.frame(true);
    this.render();
  }

  /** Puts the saved outfit back (unless kept) and hands the hero back to play. */
  close(keep = false) {
    if (!this.isOpen) return;
    const g = this.g;
    this.isOpen = false;
    clearTimeout(this.timer);
    if (!keep && this.saved && outfitKey(dressedOf(this.saved)) !== this.shown) g.player.restyle(dressedOf(this.saved));
    this.el.className = 'wardrobe hidden';
    this.el.innerHTML = '';
    const cam = g.cam;
    cam.yaw = this.cam.yaw;
    cam.dist = this.cam.dist;
    cam.pitch = this.cam.pitch;
    g.player.yaw = this.cam.heroYaw;
    g.player.syncModel();
    this.frame(false);
    if (g.mode === 'event') g.setMode('play');
  }

  /** A few times a second while open: a fight or a fall puts the old clothes back. */
  update(dt: number) {
    if (!this.isOpen || (this.check -= dt) > 0) return;
    this.check = 0.25;
    const why = this.g.player.wardrobeBlock(this.g);
    if (why) {
      this.close();
      this.g.hud.toast(why, 'warn');
    }
  }

  /** Shifts the view so the hero stands beside a wide sheet or above a tall one. */
  private frame(on: boolean) {
    const cam = this.g.camera;
    if (!on) {
      cam.clearViewOffset();
      return;
    }
    // Matches the sheet's CSS: a panel down the right in landscape, a bottom sheet (55%) otherwise.
    const w = window.innerWidth, h = window.innerHeight;
    if (w > h && w >= 700) cam.setViewOffset(w, h, Math.min(440, w * 0.46) / 2, 0, w, h);
    else cam.setViewOffset(w, h, 0, h * 0.27, w, h);
  }

  private onClick(e: Event) {
    const b = (e.target as HTMLElement).closest('button');
    if (!b || !this.draft) return;
    const g = this.g;
    const c = g.player.c;
    const d = b.dataset;
    if (d.tab) this.tab = d.tab as Tab;
    else if (d.ch) this.channel = d.ch as DyeChannel;
    else if (d.slot !== undefined) {
      const slot = d.slot as Slot;
      const id = d.id || null;
      if (id && !ownsGarment(c.wardrobe, id)) return g.hud.toast(`${garment(id)?.name}: ${howToGet('garment', id)}`);
      this.draft[slot] = id;
      this.preview();
    } else if (d.dye !== undefined) {
      const id = d.dye || null;
      if (id && !knowsDye(c.wardrobe, id)) return g.hud.toast(`${dyeOf(id)?.name}: ${howToGet('dye', id)}`);
      this.draft[this.channel] = id;
      this.preview();
    } else if (d.act === 'keep') {
      c.wardrobe.outfit = { ...this.draft };
      this.flush();
      g.save();
      g.coop.announceLook();
      g.audio.play('pickup');
      g.hud.toast('Outfit kept.', 'quest');
      return this.close(true);
    } else if (d.act === 'undo') {
      this.draft = { ...this.saved! };
      this.preview();
    } else if (d.act === 'close') return this.close();
    this.render();
  }

  /** Dresses the hero in the draft now, or as soon as the last rebuild is far enough behind. */
  private preview() {
    clearTimeout(this.timer);
    const wait = this.builtAt + PREVIEW_GAP - this.g.clock;
    if (wait <= 0) this.flush();
    else this.timer = window.setTimeout(() => this.flush(), wait * 1000);
  }

  private flush() {
    if (!this.isOpen || !this.draft) return;
    const dressed = dressedOf(this.draft);
    const key = outfitKey(dressed);
    if (key === this.shown) return;
    this.shown = key;
    this.builtAt = this.g.clock;
    this.g.player.restyle(dressed);
  }

  private render() {
    const c = this.g.player.c;
    const w = c.wardrobe;
    const o = this.draft!;
    const n = wardrobeCounts(w);
    const changed = outfitKey(dressedOf(o)) !== outfitKey(dressedOf(this.saved!));
    let body = '';
    if (this.tab === 'colours') {
      const chans = CHANNELS.map((ch) => {
        const hex = dyeOf(o[ch])?.hex;
        return `<button data-ch="${ch}" class="${ch === this.channel ? 'on' : ''}"><i class="wdot${hex === undefined ? ' own' : ''}" ${hex === undefined ? '' : `style="background:${css(hex)}"`}></i>${CHANNEL_NAME[ch]}</button>`;
      }).join('');
      const own = `<button data-dye="" class="wsw own${o[this.channel] === null ? ' on' : ''}" title="Class colour"><span>Class</span></button>`;
      const sw = DYES.map((dye) => {
        const known = knowsDye(w, dye.id);
        return known
          ? `<button data-dye="${dye.id}" class="wsw${o[this.channel] === dye.id ? ' on' : ''}" style="background:${css(dye.hex)}" title="${esc(dye.name)}"></button>`
          : `<button data-dye="${dye.id}" class="wsw locked" title="${esc(dye.name)}"><span>?</span></button>`;
      }).join('');
      const cur = dyeOf(o[this.channel]);
      body = `<div class="wchans">${chans}</div><div class="wswatches">${own}${sw}</div>
        <div class="whint">${esc(CHANNEL_NAME[this.channel])}: ${cur ? esc(cur.name) : 'your class’s own colour'}. Tap a <b>?</b> to see how to make it.</div>`;
    } else {
      const slot = this.tab;
      const lock = lockedSlot(c.raceId, slot);
      if (lock) body = `<div class="whint">${esc(lock)}</div>`;
      else {
        const tile = (id: string | null, name: string, sub: string, owned: boolean) =>
          `<button data-slot="${slot}" data-id="${id ?? ''}" class="wtile${o[slot] === id ? ' on' : ''}${owned ? '' : ' locked'}"><b>${esc(name)}</b><small>${esc(sub)}</small></button>`;
        body = `<div class="wtiles">${tile(null, 'Class’s own', `As a ${CLASSES[c.classId].name.toLowerCase()} dresses`, true)}${GARMENTS.filter((x) => x.slot === slot)
          .map((x) => (ownsGarment(w, x.id) ? tile(x.id, x.name, x.blurb, true) : tile(x.id, x.name, howToGet('garment', x.id), false)))
          .join('')}</div>`;
      }
    }
    // The sheet stays put (its slide-in plays once); only what is on it changes, and the list keeps its scroll on the same tab.
    this.el.className = 'wardrobe';
    let sheet = this.el.querySelector<HTMLElement>('.wsheet');
    if (!sheet) {
      this.el.innerHTML = '<div class="wsheet"></div>';
      sheet = this.el.firstElementChild as HTMLElement;
    }
    const scroll = this.drawnTab === this.tab ? (sheet.querySelector('.wbody')?.scrollTop ?? 0) : 0;
    this.drawnTab = this.tab;
    sheet.innerHTML = `
      <div class="whead"><div class="dtitle">Wardrobe</div><small>Clothes ${n.garments}/${n.ofGarments} · Colours ${n.dyes}/${n.ofDyes}</small></div>
      <div class="wtabs">${TABS.map((t) => `<button data-tab="${t}" class="${t === this.tab ? 'on' : ''}">${TAB_NAME[t]}</button>`).join('')}</div>
      <div class="wbody">${body}</div>
      <div class="wfoot"><button data-act="close">Close</button><button data-act="undo" ${changed ? '' : 'disabled'}>Undo</button><button data-act="keep" class="primary">Keep</button></div>`;
    sheet.querySelector('.wbody')!.scrollTop = scroll;
  }
}
