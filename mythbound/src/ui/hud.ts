import * as THREE from 'three';
import { SPELLS, WEAPONS, type SpellId, type WeaponKind } from '../data/defs';
import { EYES_RUINS, LAIRS, SHRINES, TRIALS, ZONES, type QuestId } from '../data/world';
import { dracoFlightHours, xpToNext, MAX_LEVEL } from '../rules/character';
import { comboFor, elementWeakness, isLightSealed, mainWeapon } from '../rules/combat';
import { Boss } from '../engine/entities';
import type { Game } from '../engine/game';
import { nextQuestHint, questLines, trackedId, type QuestLine, type QuestTarget } from '../engine/questlog';
import { saveSettings } from '../engine/state';
import { mapImage, toMap } from './mapimage';

/** Two or three letters that tell spells apart on small touch slots. */
const shortName = (name: string) => {
  const words = name.replace(/^(the|of)\s+/i, '').split(/\s+/).filter((w) => !/^(of|the)$/i.test(w));
  return (words.length > 1 ? words.map((w) => w[0]).join('') : name.slice(0, 3)).slice(0, 3).toUpperCase();
};

const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);

const SPELL_ICON: Record<string, string> = {
  devil: '😈', fire: '🔥', sky: '⚡', water: '💧', light: '✨', arcane: '🜂', earth: '🪨',
};

const WEAPON_ICON: Record<WeaponKind, string> = {
  sword: '⚔', axe: '⚔', bow: '➶', staff: '⚚', dagger: '🗡', hammer: '⚒', trident: 'Ψ', bolt: 'ϟ',
};

/** The HUD runs every frame, so writes go through here and only reach the DOM when a value changes. */
const written = new WeakMap<HTMLElement, Map<string, string>>();
function put(el: HTMLElement, key: 'text' | 'html' | 'class' | string, value: string) {
  let m = written.get(el);
  if (!m) written.set(el, (m = new Map()));
  if (m.get(key) === value) return;
  m.set(key, value);
  if (key === 'text') el.textContent = value;
  else if (key === 'html') el.innerHTML = value;
  else if (key === 'class') el.className = value;
  else el.style.setProperty(key, value);
}

/** Fill widths in 0.1% steps. */
const pct = (k: number) => `${Math.round(Math.max(0, Math.min(1, k)) * 1000) / 10}%`;

interface Bar { root: HTMLElement; fill: HTMLElement; ghost: HTMLElement | null; val: HTMLElement | null; ghostK: number; cls: string }

interface SlotView {
  el: HTMLElement;
  cd: HTMLElement;
  cdText: HTMLElement;
  cost: HTMLElement | null;
  spell: SpellId | null; // null: the class ability
  base: string;
  mask: number;
  cdq: number;
}

const COMPASS = [
  ['N', -Math.PI / 2],
  ['E', 0],
  ['S', Math.PI / 2],
  ['W', Math.PI],
] as const;

export class Hud {
  root: HTMLElement;
  numberLayer: HTMLElement;
  private hp: Bar;
  private mana: Bar;
  private stam: Bar;
  private status: HTMLElement;
  private partyEl: HTMLElement;
  private partyT = 0;
  private info: HTMLElement;
  private spells: HTMLElement;
  private bossEl: HTMLElement;
  private bossFill: HTMLElement;
  private bossGhostEl: HTMLElement;
  private bossName: HTMLElement;
  private promptEl: HTMLElement;
  private toasts: HTMLElement;
  private bannerEl: HTMLElement;
  private zoneEl: HTMLElement;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private miniScale: number;
  private bezel: HTMLCanvasElement | null = null;
  private reticle: HTMLElement;
  private hurtEl: HTMLElement;
  private blackEl: HTMLElement;
  private eyesEl: HTMLElement;
  private xpFill: HTMLElement;
  private xpLevel: HTMLElement;
  private xpNum: HTMLElement;
  private txpFill: HTMLElement;
  private txpLevel: HTMLElement;
  private xpShown = -1;
  private tl: HTMLElement;
  private questEl: HTMLElement;
  private questT = 0;
  private questKey = '';
  private questArrow: HTMLElement | null = null;
  private questTarget: QuestTarget | null = null;
  private arrowDeg = NaN;
  /** Phone-sized screens: the quest bar starts folded and never lists every quest. */
  private phone = matchMedia('(max-height: 500px), (max-width: 600px)');
  private bars3d: HTMLElement[] = [];
  private barLayer: HTMLElement;
  private crosshair: HTMLElement;
  private slots: SlotView[] = [];
  private slotKey = '';
  private cdTotal = new Map<string, number>();
  private cdLast = new Map<string, number>();
  private bossK = 1;
  private bossGhost = 1;
  private bossShown = false;
  private hurtLevel = 0;
  private bannerTimer = 0;
  private calm = matchMedia('(prefers-reduced-motion: reduce)');
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();

  constructor(parent: HTMLElement, private g: Game) {
    const root = document.createElement('div');
    root.className = 'hud';
    root.innerHTML = `
      <div class="vignette hurt"></div>
      <div class="vignette eyes"></div>
      <div class="blackout"></div>
      <div class="barlayer"></div>
      <div class="numbers"></div>
      <div class="crosshair"></div>
      <div class="reticle"></div>
      <div class="tl">
        <div class="bar hp"><div class="track"><div class="ghost"></div><div class="fill"></div></div><span class="val"></span></div>
        <div class="bar mana"><div class="track"><div class="ghost"></div><div class="fill"></div></div><span class="val"></span></div>
        <div class="bar stam"><div class="track"><div class="fill"></div></div></div>
        <div class="txp"><div class="fill"></div><span></span></div>
        <div class="status"></div>
        <div class="qbar"></div>
        <div class="party"></div>
      </div>
      <div class="tr">
        <div class="mframe"><canvas class="mini"></canvas></div>
        <div class="zlabel"></div>
      </div>
      <div class="bl"><div class="info"></div></div>
      <div class="bc">
        <div class="spells"></div>
        <div class="xp"><b class="xlv"></b><div class="fill"></div><small class="xnum"></small></div>
      </div>
      <div class="prompt"></div>
      <div class="bossbar hidden">
        <div class="bplate"><div class="bname"></div></div>
        <div class="bbar"><div class="track"><div class="ghost"></div><div class="fill"></div></div><div class="cracks"></div></div>
      </div>
      <div class="toasts"></div>
      <div class="banner"></div>`;
    parent.appendChild(root);
    this.root = root;
    const q = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
    const bar = (s: string): Bar => ({ root: q(s), fill: q(`${s} .fill`), ghost: q(`${s} .ghost`), val: q(`${s} .val`), ghostK: 1, cls: '' });
    this.numberLayer = q('.numbers');
    this.hp = bar('.bar.hp');
    this.mana = bar('.bar.mana');
    this.stam = bar('.bar.stam');
    this.status = q('.status');
    this.partyEl = q('.party');
    this.info = q('.info');
    this.spells = q('.spells');
    this.bossEl = q('.bossbar');
    this.bossFill = q('.bossbar .fill');
    this.bossGhostEl = q('.bossbar .ghost');
    this.bossName = q('.bname');
    this.promptEl = q('.prompt');
    this.toasts = q('.toasts');
    this.bannerEl = q('.banner');
    this.zoneEl = q('.zlabel');
    this.mini = q('.mini');
    this.miniScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.mini.width = this.mini.height = Math.round(150 * this.miniScale);
    this.miniCtx = this.mini.getContext('2d')!;
    this.reticle = q('.reticle');
    this.hurtEl = q('.vignette.hurt');
    this.blackEl = q('.blackout');
    this.eyesEl = q('.vignette.eyes');
    this.xpFill = q('.xp .fill');
    this.xpLevel = q('.xp .xlv');
    this.xpNum = q('.xp .xnum');
    this.txpFill = q('.txp .fill');
    this.txpLevel = q('.txp span');
    this.tl = q('.tl');
    this.questEl = q('.qbar');
    this.barLayer = q('.barlayer');
    this.crosshair = q('.crosshair');
    // Tap a spell slot to select it; tap the ability slot to use it.
    this.spells.addEventListener('pointerdown', (e) => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('.slot');
      if (!slot || g.mode !== 'play') return;
      e.preventDefault();
      if (slot.dataset.ability) g.input.tap('ability');
      else if (slot.dataset.slot) g.input.tap(`slot${Number(slot.dataset.slot) + 1}` as 'slot1');
    });
    // Quest bar: the header folds it; tapping another quest tracks it, and
    // tapping the tracked one moves on to the next (all phones can show).
    this.questEl.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLElement>('[data-q], [data-qnext]');
      if (!t.closest('[data-qtoggle]') && !row) return;
      e.preventDefault();
      e.stopPropagation();
      if (row?.dataset.q) g.state.tracked = row.dataset.q as QuestId;
      else if (row) this.trackNextQuest();
      else this.toggleQuests();
      this.questKey = '';
      this.updateQuests();
    });
  }

  /** Folded to one line: the player's choice, or by default on phones. */
  private get questsFolded() {
    return this.g.settings.questsCollapsed ?? this.phone.matches;
  }

  private trackNextQuest() {
    const p = this.g.player.pos;
    const lines = questLines(this.g.state, p.x, p.z);
    const i = lines.findIndex((l) => l.id === trackedId(this.g.state, lines));
    if (lines.length > 1) this.g.state.tracked = lines[(i + 1) % lines.length].id;
  }

  toggleQuests() {
    this.g.settings.questsCollapsed = !this.questsFolded;
    saveSettings(this.g.settings);
    this.questKey = '';
  }

  toast(text: string, kind = '') {
    // Every quest change says so: refresh the quest bar on the next frame.
    if (kind === 'quest') this.questT = 0;
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.prepend(el);
    while (this.toasts.children.length > 5) this.toasts.lastElementChild!.remove();
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3800);
  }

  banner(text: string, kind: 'death' | 'victory' | 'zone' | 'level', sub?: string) {
    this.bannerEl.className = `banner show ${kind}`;
    this.bannerEl.innerHTML = `<div class="btext">${esc(text)}</div><div class="bline"></div>${sub ? `<div class="bsub">${esc(sub)}</div>` : ''}`;
    this.bannerTimer = kind === 'death' ? 99 : kind === 'zone' ? 3 : 4;
  }

  clearBanner() {
    this.bannerEl.className = 'banner';
    this.bannerTimer = 0;
  }

  blackout(seconds: number) {
    this.blackEl.style.transition = 'opacity 0.3s';
    this.blackEl.style.opacity = '1';
    setTimeout(() => {
      this.blackEl.style.transition = 'opacity 1.2s';
      this.blackEl.style.opacity = '0';
    }, seconds * 1000 - 600);
  }

  glitch(seconds: number) {
    this.root.parentElement!.classList.add('glitching');
    setTimeout(() => this.root.parentElement!.classList.remove('glitching'), seconds * 1000);
  }

  hurt(k: number) {
    this.hurtLevel = Math.min(1, this.hurtLevel + 0.3 + k);
  }

  eyes(k: number) {
    put(this.eyesEl, 'opacity', String(Math.round(k * 100) / 100));
  }

  prompt(label: string | null) {
    put(this.promptEl, 'html', label ? `${this.g.input.touch ? '<kbd>✋</kbd>' : '<kbd>F</kbd>'}${esc(label)}` : '');
    put(this.promptEl, 'visibility', label ? 'visible' : 'hidden');
  }

  setBoss(name: string | null, hp = 0, max = 1) {
    if (!name) {
      put(this.bossEl, 'class', 'bossbar hidden');
      this.bossShown = false;
      return;
    }
    this.bossK = Math.max(0, Math.min(1, hp / max));
    if (!this.bossShown) this.bossGhost = this.bossK;
    this.bossShown = true;
    put(this.bossEl, 'class', this.g.boss?.phase === 2 ? 'bossbar p2' : 'bossbar');
    const cut = name.indexOf(', ');
    put(this.bossName, 'html', cut < 0 ? esc(name) : `${esc(name.slice(0, cut))}<small>${esc(name.slice(cut + 2))}</small>`);
    put(this.bossFill, 'width', pct(this.bossK));
  }

  /** Timing minigame: stop the marker inside the green zone. */
  fishing(sailor: boolean): Promise<'none' | 'fish' | 'golden'> {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'fishing';
      const zoneW = sailor ? 34 : 22;
      const zoneX = 15 + Math.random() * (70 - zoneW);
      el.innerHTML = `<div class="panel"><div class="dtitle">Fishing</div><div class="dsub">${this.g.input.touch ? 'Tap' : 'Click or press F/Space'} when the hook is in the green.</div>
        <div class="ftrack"><div class="fzone" style="left:${zoneX}%;width:${zoneW}%"></div><div class="fgold" style="left:${zoneX + zoneW / 2 - 3}%;width:6%"></div><div class="fhook"></div></div></div>`;
      this.root.appendChild(el);
      this.prompt(null);
      const hook = el.querySelector<HTMLElement>('.fhook')!;
      let t = Math.random() * 3;
      let raf = 0;
      let wait = 0.6 + Math.random() * 1.4;
      const start = performance.now();
      let pos = 0;
      const tick = () => {
        const now = (performance.now() - start) / 1000;
        if (now > wait) {
          t += 0.016 * (sailor ? 1.1 : 1.5);
          pos = 50 + 48 * Math.sin(t * 2.2);
          hook.style.left = `${pos}%`;
          hook.classList.add('bite');
        }
        if (now > wait + 7) return finish();
        raf = requestAnimationFrame(tick);
      };
      const finish = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey, true);
        el.remove();
        const now = (performance.now() - start) / 1000;
        if (now < wait) return resolve('none');
        const inZone = pos >= zoneX && pos <= zoneX + zoneW;
        const gold = Math.abs(pos - (zoneX + zoneW / 2)) < 3;
        resolve(!inZone ? 'none' : gold || (sailor && Math.random() < 0.15) ? 'golden' : 'fish');
      };
      const onKey = (e: KeyboardEvent) => {
        if (['KeyF', 'Space', 'Enter'].includes(e.code)) {
          e.stopImmediatePropagation();
          e.preventDefault();
          finish();
        }
      };
      el.addEventListener('pointerdown', finish);
      window.addEventListener('keydown', onKey, true);
      raf = requestAnimationFrame(tick);
    });
  }

  /** One stat bar: fill, delayed ghost, state classes and the number. */
  private setBar(b: Bar, base: string, k: number, dt: number, extra: string, text: string | null) {
    k = Math.max(0, Math.min(1, k));
    b.ghostK = Math.max(k, b.ghostK - dt * 0.4);
    put(b.fill, 'width', pct(k));
    if (b.ghost) put(b.ghost, 'width', pct(b.ghostK));
    const cls = `${base}${k >= 0.999 ? ' full' : ''}${extra}`;
    if (cls !== b.cls) put(b.root, 'class', (b.cls = cls));
    if (b.val && text !== null) put(b.val, 'html', text);
  }

  update(dt: number) {
    const g = this.g;
    const p = g.player;
    const c = p.c;
    const hpK = Math.max(0, p.hp / p.maxHp);
    const low = hpK < 0.3 && p.alive;
    this.setBar(this.hp, 'bar hp', hpK, dt, low ? ' low' : '', `<b>${Math.ceil(p.hp)}</b> / ${p.maxHp}`);
    this.setBar(this.mana, 'bar mana', p.mana / p.maxMana, dt, p.soulOrPower ? ' soul' : '', p.soulOrPower ? 'SOUL BARGAINED' : `<b>${Math.floor(p.mana)}</b> / ${p.maxMana}`);
    this.setBar(this.stam, 'bar stam', p.stamina / p.maxStamina, dt, p.exhausted ? ' low exhausted' : p.stamina < p.maxStamina * 0.25 ? ' low' : '', null);
    put(this.stam.root, 'width', `${Math.round(Math.min(34, 14 + p.maxStamina / 8) * 10) / 10}vw`);
    put(this.hp.root, 'width', `${Math.round(Math.min(46, 16 + p.maxHp / 12) * 10) / 10}vw`);
    put(this.mana.root, 'width', `${Math.round(Math.min(40, 12 + p.maxMana / 6) * 10) / 10}vw`);

    // Status chips.
    const chips: string[] = [];
    if (g.cam.shiftLock) chips.push(`<b class="sl">Shift lock${!g.input.touch && !g.input.pointerLocked ? ' · click to aim' : ''}</b>`);
    if (p.fury.bloodrageActive) chips.push(`<b class="rage">BloodRage ×${(1 + 0.25 * (p.fury.stacks + 1)).toFixed(2)}${p.hasBloodsteal() ? ' · Bloodsteal' : ''}</b>`);
    if (p.powerShotArmed) chips.push('<b class="skill">Power Shot armed</b>');
    if (p.combineMode) {
      const a = p.spell, b = c.spellSlots[(p.selected + 1) % 4];
      const combo = a && b ? comboFor(a, b) : null;
      chips.push(`<b class="skill">Combine: ${combo ? combo.name : '—'}</b>`);
    }
    if (p.soulOrPower) chips.push('<b class="devil">Soul or Power</b>');
    if (isLightSealed(c, g.gameMinutes)) chips.push(`<b class="devil">Light sealed${c.lightSealedUntil === Infinity ? ' forever' : ` ${Math.ceil((c.lightSealedUntil - g.gameMinutes) / 60)}h`}</b>`);
    if (p.speedBuff > 0) chips.push('<b>Wind</b>');
    if (p.stoneSkin > 0) chips.push('<b>Stone Skin</b>');
    if (p.aegis > 0) chips.push('<b class="skill">Aegis</b>');
    if (p.moonveil > 0) chips.push('<b>Moonveil</b>');
    if (p.crouching) chips.push('<b>Sneaking</b>');
    if (dracoFlightHours(c) > 0) chips.push(`<b>Wings ${Math.floor(p.flightLeft / 60)}h ${Math.floor(p.flightLeft % 60)}m</b>`);
    if (c.raceId === 'zombie' && !c.riseSpent) chips.push('<b class="skill">Not Dead Yet</b>');
    if (p.warCry > 0) chips.push(`<b class="rage">War Cry ${Math.ceil(p.warCry)}s</b>`);
    if (p.gliding) chips.push('<b>Gliding</b>');
    if (c.elfMystery && c.mysteryRevealed) chips.push('<b class="devil">Eye-Touched</b>');
    put(this.status, 'html', chips.join(''));

    // Info: flasks, fish, embers, weapon and ammo.
    const w = WEAPONS[mainWeapon(c).id];
    const fish = (c.items.fish ?? 0) + (c.items['golden-fish'] ?? 0);
    put(this.info, 'html', `<div><span class="ico">⚗</span>${c.flasks}/${c.flasksMax}${fish ? `<span class="ico fish">🐟</span>${fish}` : ''}</div>
      <div class="embers"><span class="ico">✦</span>${c.gold}</div>
      <div><span class="ico">${WEAPON_ICON[w.kind] ?? '⚔'}</span>${esc(w.name)} <small>Lv ${mainWeapon(c).level}</small>${w.kind === 'bow' ? ` <small>·</small> ${c.arrows.steel ? `${c.arrows.steel} steel + ` : ''}${c.arrows.wood} arrows` : ''}</div>`);

    this.updateSpells();
    this.partyT -= dt;
    if (this.partyT <= 0) {
      this.partyT = 0.2;
      this.updateParty();
    }
    const xpk = c.level >= MAX_LEVEL ? '100%' : pct(c.xp / xpToNext(c.level));
    put(this.xpFill, 'width', xpk);
    put(this.txpFill, 'width', xpk);
    if (this.xpShown !== c.level * 1e7 + c.xp) {
      this.xpShown = c.level * 1e7 + c.xp;
      this.xpLevel.textContent = this.txpLevel.textContent = `Lv ${c.level}`;
      this.xpNum.textContent = c.level >= MAX_LEVEL ? 'MAX' : `${c.xp} / ${xpToNext(c.level)} XP`;
    }
    this.questT -= dt;
    if (this.questT <= 0) {
      this.questT = 0.25;
      this.updateQuests();
    }
    this.pointQuestArrow();

    // Vignettes.
    this.hurtLevel = Math.max(0, this.hurtLevel - dt * 1.2);
    const lowPulse = low ? (this.calm.matches ? 0.4 : 0.35 + 0.15 * Math.sin(performance.now() / 200)) : 0;
    put(this.hurtEl, 'opacity', String(Math.round(Math.max(this.hurtLevel, lowPulse) * 100) / 100));
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.className = 'banner';
    }

    // Boss damage ghost.
    if (this.bossShown) {
      this.bossGhost = Math.max(this.bossK, this.bossGhost - dt * 0.35);
      put(this.bossGhostEl, 'width', pct(this.bossGhost));
    }

    // Zone and clock.
    const day = g.dayMinutes;
    const hh = Math.floor(day / 60), mm = Math.floor(day % 60);
    put(this.zoneEl, 'html', `${esc(ZONES[g.zone].name)}<br><small>${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${g.isNight ? '☾' : '☀'} · Lv ${c.level}${c.skillPoints ? ` · ${c.skillPoints} pt` : ''}</small>`);
    this.drawMinimap();

    // Lock-on reticle, and the crosshair for bows, bolts and shift lock.
    const t = p.lockTarget;
    if (t && this.project(t.center())) {
      put(this.reticle, 'display', 'block');
      this.reticle.style.transform = `translate(${this.v.x}px, ${this.v.y}px) translate(-50%, -50%)`;
    } else put(this.reticle, 'display', 'none');
    const aim = !t && (g.cam.shiftLock || p.drawing > 0 || p.weaponKind === 'bow' || p.weaponKind === 'bolt');
    put(this.crosshair, 'display', aim ? 'block' : 'none');
    if (aim) {
      put(this.crosshair, 'class', g.cam.shiftLock ? 'crosshair sl' : 'crosshair');
      put(this.crosshair, '--k', String(Math.round(p.drawing * 20) / 20));
    }

    this.updateEnemyBars();
  }

  /** The quest bar: active quests with progress, the tracked one with where to go. Rebuilt only when something shown changes. */
  private updateQuests() {
    const g = this.g;
    const p = g.player.pos;
    const lines = questLines(g.state, p.x, p.z);
    const tracked = trackedId(g.state, lines);
    const main = lines.find((l) => l.id === tracked) ?? nextQuestHint(g.state);
    // Phones never show the whole list: open, the bar adds one line for the tracked quest.
    const view = this.questsFolded ? 'folded' : this.phone.matches ? 'mini' : 'full';
    this.questTarget = main?.target ?? null;
    const dist = main?.target ? Math.hypot(main.target.x - p.x, main.target.z - p.z) : 0;
    const key = `${view}|${main?.id}|${main?.label}|${Math.round(dist / 10)}|${lines.map((l) => `${l.id}${l.progress}`).join(',')}`;
    if (key !== this.questKey) {
      this.questKey = key;
      put(this.questEl, 'class', !main ? 'qbar none' : view === 'full' ? 'qbar' : `qbar line ${view}`);
      put(this.questEl, 'html', main ? this.questHtml(main, lines, view, dist) : '');
      this.questArrow = this.questEl.querySelector('.qarrow');
      this.arrowDeg = NaN;
      this.pointQuestArrow();
    }
    // Touch layouts stack the info panel below this column, wherever it ends.
    put(this.root, '--tlb', `${Math.round(this.tl.offsetTop + this.tl.offsetHeight)}px`);
  }

  private questHtml(main: QuestLine, lines: QuestLine[], view: 'folded' | 'mini' | 'full', dist: number): string {
    const count = (l: QuestLine) => (l.goal ? (l.ready ? '<em class="ok">✔</em>' : `<em>${l.progress}/${l.goal}</em>`) : '');
    const where = main.target ? `<i class="qarrow"></i>${dist < 12 ? 'here' : `${Math.round(dist / 10) * 10} m`}` : '';
    const more = lines.length > 1 ? `<small>${lines.length}</small>` : '';
    const bar = (l: QuestLine) => (l.goal && !l.ready ? `<div class="qprog"><b style="width:${Math.round((l.progress / l.goal) * 100)}%"></b></div>` : '');
    // Where to go when a place is known, else what to do (always for a quest to hand in, or a hint).
    const place = (l: QuestLine) => esc(l.target && l.goal && !l.ready ? l.target.name : l.objective);
    if (view !== 'full') {
      const head = `<div class="qhead" data-qtoggle="1"><i class="qtog">${view === 'mini' ? '▾' : '▸'}</i><span class="qt"><span>${esc(main.label)}</span>${count(main)}</span>${where ? `<span class="qdir">${where}</span>` : ''}${more}</div>`;
      if (view === 'folded') return head;
      return `${head}<div class="qrow on${main.ready ? ' ready' : ''}"${lines.length > 1 ? ' data-qnext="1"' : ''}>${bar(main)}<div class="qsub">${place(main)}</div></div>`;
    }
    const rows = (lines.length ? lines : [main]).map((l) => {
      if (l !== main) return `<div class="qrow" data-q="${l.id}"><div class="qt"><span>${esc(l.label)}</span>${count(l)}</div></div>`;
      const sub = `${where}${where ? ' · ' : ''}${place(l)}`;
      return `<div class="qrow on${l.ready ? ' ready' : ''}"${lines.length > 1 ? ' data-qnext="1"' : ''}><div class="qt"><span>${esc(l.label)}</span>${count(l)}</div>${bar(l)}<div class="qsub">${sub}</div></div>`;
    });
    return `<div class="qhead" data-qtoggle="1"><i class="qtog">▾</i><b>Quests</b>${more}</div>${rows.join('')}`;
  }

  /** Turns the tracked quest's arrow toward its goal, relative to the camera (in 5° steps, so the DOM rarely changes). */
  private pointQuestArrow() {
    const t = this.questTarget;
    if (!this.questArrow || !t) return;
    const p = this.g.player.pos;
    const rel = Math.atan2(t.x - p.x, t.z - p.z) - this.g.camYaw;
    const deg = (((Math.round((-rel * 180) / Math.PI / 5) * 5) % 360) + 360) % 360;
    if (deg === this.arrowDeg) return;
    this.arrowDeg = deg;
    this.questArrow.style.transform = `rotate(${deg}deg)`;
  }

  /** Co-op: the room code and each friend's health. */
  private updateParty() {
    const co = this.g.coop;
    if (!co.active) return put(this.partyEl, 'html', '');
    const rows = co.party().map((m) => {
      const k = m.alive ? Math.max(0, Math.min(1, m.hp / m.maxHp)) : 0;
      return `<div class="pm${m.alive ? '' : ' down'}"><span>${m.host ? '♛ ' : ''}${esc(m.name)} <small>${m.level}</small></span><i><b style="width:${Math.round(k * 100)}%"></b></i></div>`;
    });
    const head = `<div class="proom">${co.isHost ? 'Hosting' : 'Co-op'} · <b>${esc(co.room)}</b>${co.isHost && !rows.length ? ' · waiting for friends' : ''}</div>`;
    put(this.partyEl, 'html', head + rows.join(''));
  }

  /** Fraction of a cooldown still to run; the total is the largest remaining time seen since it started. */
  private cdFrac(key: string, left: number): number {
    const last = this.cdLast.get(key) ?? 0;
    this.cdLast.set(key, left);
    if (left <= 0) return 0;
    let total = this.cdTotal.get(key) ?? 0;
    if (left > last + 0.05 || total < left) this.cdTotal.set(key, (total = left));
    return left / total;
  }

  private updateSpells() {
    const g = this.g;
    const p = g.player;
    const c = p.c;
    const ability = p.abilityName();
    const key = `${c.knownSpells.length ? c.spellSlots.join(',') : ''}|${ability}`;
    if (key !== this.slotKey) {
      this.slotKey = key;
      const html = c.knownSpells.length
        ? c.spellSlots.map((s, i) => {
          if (!s) return `<div class="slot empty" data-slot="${i}"><i>${i + 1}</i></div>`;
          const def = SPELLS[s];
          return `<div data-slot="${i}" class="slot" title="${esc(def.name)}"><span class="ic">${SPELL_ICON[def.school] ?? '✦'}</span><i>${i + 1}</i><em>${esc(def.name)}</em><u>${esc(shortName(def.name))}</u><small></small><div class="cd"><b></b></div></div>`;
        }).join('')
        : '';
      this.spells.innerHTML = `${html}<div data-ability="1" class="slot ability" title="${esc(ability)}"><span class="ic">❂</span><i>R</i><em>${esc(ability)}</em><div class="cd"><b></b></div></div>`;
      this.slots = [];
      for (const el of Array.from(this.spells.children) as HTMLElement[]) {
        if (el.classList.contains('empty')) continue;
        const ab = !!el.dataset.ability;
        this.slots.push({
          el, cd: el.querySelector('.cd')!, cdText: el.querySelector('.cd b')!, cost: el.querySelector('small'),
          spell: ab ? null : c.spellSlots[Number(el.dataset.slot)], base: ab ? 'slot ability' : 'slot', mask: -1, cdq: -1,
        });
      }
    }
    const sealed = isLightSealed(c, g.gameMinutes);
    for (const s of this.slots) {
      let left: number, blocked: boolean, sel = false, combo = false, active = false;
      if (s.spell) {
        const i = Number(s.el.dataset.slot);
        const cost = p.costOf(s.spell);
        left = p.cooldownLeft(s.spell);
        blocked = (SPELLS[s.spell].school === 'light' && sealed) || (!p.soulOrPower && cost > p.mana);
        sel = i === p.selected;
        combo = p.combineMode && i === (p.selected + 1) % 4;
        put(s.cost!, 'text', String(cost));
      } else {
        left = p.abilityCooldown();
        blocked = p.abilityName() === 'Combine (Lv 3)';
        active = p.fury.bloodrageActive || p.powerShotArmed || p.combineMode;
      }
      const frac = this.cdFrac(s.spell ?? 'ability', left);
      const mask = (sel ? 1 : 0) | (blocked ? 2 : 0) | (combo ? 4 : 0) | (left > 0 ? 8 : 0) | (active ? 16 : 0);
      if (mask !== s.mask) {
        s.mask = mask;
        s.el.className = `${s.base}${sel ? ' sel' : ''}${blocked ? ' off' : ''}${combo ? ' combo' : ''}${left > 0 ? ' cooling' : ''}${active ? ' active' : ''}`;
      }
      if (left > 0) {
        const q = Math.round(frac * 240);
        if (q !== s.cdq) s.cd.style.setProperty('--cd', String((s.cdq = q) / 240));
        put(s.cdText, 'text', String(Math.ceil(left)));
      }
    }
  }

  private project(pos: THREE.Vector3): boolean {
    this.v.copy(pos).project(this.g.camera);
    if (this.v.z > 1) return false;
    this.v.x = (this.v.x * 0.5 + 0.5) * window.innerWidth;
    this.v.y = (-this.v.y * 0.5 + 0.5) * window.innerHeight;
    return true;
  }

  private updateEnemyBars() {
    const g = this.g;
    const p = g.player;
    const historian = p.c.roleId === 'historian';
    let n = 0;
    for (const e of g.enemies) {
      if (!e.alive || e instanceof Boss) continue;
      const d = e.pos.distanceTo(p.pos);
      if (d > 28 || (e.hp >= e.maxHp && !e.aware && e.awareness < 0.05 && !historian)) continue;
      const head = e.center();
      if (!this.project(this.v2.set(head.x, head.y + e.height * 0.6 + 0.4, head.z))) continue;
      let el = this.bars3d[n];
      if (!el) {
        el = document.createElement('div');
        el.className = 'ebar';
        el.innerHTML = '<div class="fill"></div><div class="aware"></div><span></span>';
        this.barLayer.appendChild(el);
        this.bars3d.push(el);
      }
      put(el, 'display', 'block');
      el.style.transform = `translate(${this.v.x}px, ${this.v.y}px) translate(-50%, -50%)`;
      put(el.children[0] as HTMLElement, 'width', pct(e.hp / e.maxHp));
      put(el.children[1] as HTMLElement, 'width', e.aware ? '0' : pct(e.awareness));
      const weak = historian ? elementWeakness(e.affinity) : null;
      const label = historian ? `${e.name} Lv${e.level} · ${Math.ceil(e.hp)}${weak ? ` · weak: ${weak}` : ''}` : e.aware ? '' : e.awareness > 0.05 ? '?' : '';
      put(el.children[2] as HTMLElement, 'text', label);
      n++;
    }
    for (let i = n; i < this.bars3d.length; i++) put(this.bars3d[i], 'display', 'none');
  }

  /** The bezel band with its tick marks, drawn once (it turns with the camera, the ticks are uniform). */
  private bezelImage(): HTMLCanvasElement {
    if (this.bezel) return this.bezel;
    const r = this.miniScale;
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(150 * r);
    const ctx = cv.getContext('2d')!;
    ctx.scale(r, r);
    ctx.translate(75, 75);
    const R = 73;
    // Dark metal band.
    const band = ctx.createRadialGradient(0, 0, R - 13, 0, 0, R);
    band.addColorStop(0, '#0c0907');
    band.addColorStop(0.45, '#2c2318');
    band.addColorStop(0.7, '#191410');
    band.addColorStop(1, '#3a2e1f');
    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.arc(0, 0, R - 12, 0, Math.PI * 2, true);
    ctx.fill();
    // Gold rings either side of the band.
    const ring = (rad: number, w: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.stroke();
    };
    ring(R - 0.8, 1.6, '#d8b468');
    ring(R - 2.4, 0.8, 'rgba(10,8,6,0.9)');
    ring(R - 12, 1.4, '#b8944e');
    ring(R - 13.2, 1, 'rgba(0,0,0,0.75)');
    // Ticks every 15 degrees, longer every 45.
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      if (i % 6 === 0) continue; // the letters sit here
      const long = i % 3 === 0;
      ctx.strokeStyle = long ? '#e8cf90' : 'rgba(216,180,104,0.6)';
      ctx.lineWidth = long ? 1.4 : 0.9;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (R - 3.5), Math.sin(a) * (R - 3.5));
      ctx.lineTo(Math.cos(a) * (R - (long ? 9.5 : 7)), Math.sin(a) * (R - (long ? 9.5 : 7)));
      ctx.stroke();
    }
    this.bezel = cv;
    return cv;
  }

  private drawMinimap() {
    const g = this.g;
    const ctx = this.miniCtx;
    const S = 150;
    const p = g.player.pos;
    const img = mapImage();
    const range = 110; // world units across half the minimap
    const scale = img.width / 900;
    const rot = g.camYaw - Math.PI;
    ctx.setTransform(this.miniScale, 0, 0, this.miniScale, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 12, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0b0a08';
    ctx.fillRect(0, 0, S, S);
    ctx.translate(S / 2, S / 2);
    ctx.rotate(rot);
    const [mx, my] = toMap(p.x, p.z, img.width);
    const k = (S / 2) / (range * scale);
    ctx.scale(k, k);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(img, -mx, -my);
    ctx.globalAlpha = 1;
    const dot = (x: number, z: number, color: string, r: number) => {
      const [ax, ay] = toMap(x, z, img.width);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(ax - mx, ay - my, r / k, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const s of SHRINES) if (g.state.shrinesFound.includes(s.id)) dot(s.x, s.z, '#ffd070', 3);
    for (const t of TRIALS) dot(t.x, t.z, g.state.trialsDone.includes(t.id) ? '#8a8a8a' : '#ff5a40', 3.5);
    if (g.state.quests.hunts.state !== 'none') for (const l of LAIRS) dot(l.x, l.z, '#c080ff', 3.5);
    if (g.state.flags.eyesRevealed) dot(EYES_RUINS.x, EYES_RUINS.z, '#60ff90', 3.5);
    for (const e of g.enemies) if (e.alive && e.aware) dot(e.pos.x, e.pos.z, '#e03020', 2);
    if (g.state.lostEmbers) dot(g.state.lostEmbers.x, g.state.lostEmbers.z, '#ffb040', 3);
    for (const r of g.coop.remotes.values()) if (r.ready) dot(r.pos.x, r.pos.z, r.alive ? '#6fd6ff' : '#4a6a78', 3.5);
    ctx.restore();
    // Inner shadow so the map sinks into the bezel.
    const shade = ctx.createRadialGradient(S / 2, S / 2, S / 2 - 30, S / 2, S / 2, S / 2 - 12);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 12, 0, Math.PI * 2);
    ctx.fill();
    // The bezel turns with the camera; the letters stay upright.
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(rot);
    ctx.drawImage(this.bezelImage(), -S / 2, -S / 2, S, S);
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [letter, off] of COMPASS) {
      const a = rot + off;
      const x = S / 2 + Math.cos(a) * (S / 2 - 8), y = S / 2 + Math.sin(a) * (S / 2 - 8);
      const north = letter === 'N';
      ctx.font = north ? 'bold 11px Cinzel, Georgia, serif' : '600 9px Cinzel, Georgia, serif';
      ctx.fillStyle = '#000';
      ctx.fillText(letter, x + 0.6, y + 1);
      ctx.fillStyle = north ? '#ff7a4a' : '#f2dca0';
      ctx.fillText(letter, x, y + 0.4);
    }
    // North pointer: a small red-gold wedge inside the ring.
    const na = rot - Math.PI / 2;
    ctx.save();
    ctx.translate(S / 2 + Math.cos(na) * (S / 2 - 17), S / 2 + Math.sin(na) * (S / 2 - 17));
    ctx.rotate(na + Math.PI / 2);
    ctx.fillStyle = '#e0503a';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -3.5);
    ctx.lineTo(3, 2.5);
    ctx.lineTo(-3, 2.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // The player arrow always points up the screen.
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(-(g.player.yaw - g.camYaw));
    ctx.fillStyle = '#fff4d8';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
