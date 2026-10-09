import * as THREE from 'three';
import { SPELLS, WEAPONS } from '../data/defs';
import { EYES_RUINS, SHRINES, TRIALS, ZONES } from '../data/world';
import { dracoFlightHours, xpToNext, MAX_LEVEL } from '../rules/character';
import { canCombine, comboFor, elementWeakness, isLightSealed, mainWeapon } from '../rules/combat';
import { Boss } from '../engine/entities';
import type { Game } from '../engine/game';
import { mapImage, toMap } from './mapimage';

const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);

const SPELL_ICON: Record<string, string> = {
  devil: '😈', fire: '🔥', sky: '⚡', water: '💧', light: '✨', arcane: '🜂', earth: '🪨',
};

export class Hud {
  root: HTMLElement;
  numberLayer: HTMLElement;
  private bars: { hp: HTMLElement; hpGhost: HTMLElement; mana: HTMLElement; stam: HTMLElement; hpText: HTMLElement; manaText: HTMLElement };
  private status: HTMLElement;
  private info: HTMLElement;
  private spells: HTMLElement;
  private bossEl: HTMLElement;
  private bossFill: HTMLElement;
  private bossName: HTMLElement;
  private promptEl: HTMLElement;
  private toasts: HTMLElement;
  private bannerEl: HTMLElement;
  private zoneEl: HTMLElement;
  private mini: HTMLCanvasElement;
  private reticle: HTMLElement;
  private hurtEl: HTMLElement;
  private blackEl: HTMLElement;
  private eyesEl: HTMLElement;
  private xpFill: HTMLElement;
  private bars3d: HTMLElement[] = [];
  private barLayer: HTMLElement;
  private crosshair: HTMLElement;
  private hpGhost = 1;
  private hurtLevel = 0;
  private bannerTimer = 0;
  private lastSpellKey = '';
  private v = new THREE.Vector3();

  constructor(parent: HTMLElement, private g: Game) {
    const root = document.createElement('div');
    root.className = 'hud';
    root.innerHTML = `
      <div class="vignette hurt"></div>
      <div class="vignette eyes"></div>
      <div class="blackout"></div>
      <div class="barlayer"></div>
      <div class="numbers"></div>
      <div class="crosshair">·</div>
      <div class="reticle"></div>
      <div class="tl">
        <div class="bar hp"><div class="ghost"></div><div class="fill"></div><span></span></div>
        <div class="bar mana"><div class="fill"></div><span></span></div>
        <div class="bar stam"><div class="fill"></div></div>
        <div class="status"></div>
      </div>
      <div class="tr">
        <canvas class="mini" width="150" height="150"></canvas>
        <div class="zone"></div>
      </div>
      <div class="bl"><div class="info"></div></div>
      <div class="bc">
        <div class="prompt"></div>
        <div class="spells"></div>
        <div class="xp"><div class="fill"></div></div>
      </div>
      <div class="boss hidden"><div class="bname"></div><div class="bbar"><div class="fill"></div></div></div>
      <div class="toasts"></div>
      <div class="banner"></div>`;
    parent.appendChild(root);
    this.root = root;
    const q = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
    this.numberLayer = q('.numbers');
    this.bars = {
      hp: q('.bar.hp .fill'), hpGhost: q('.bar.hp .ghost'), mana: q('.bar.mana .fill'), stam: q('.bar.stam .fill'),
      hpText: q('.bar.hp span'), manaText: q('.bar.mana span'),
    };
    this.status = q('.status');
    this.info = q('.info');
    this.spells = q('.spells');
    this.bossEl = q('.boss');
    this.bossFill = q('.boss .fill');
    this.bossName = q('.bname');
    this.promptEl = q('.prompt');
    this.toasts = q('.toasts');
    this.bannerEl = q('.banner');
    this.zoneEl = q('.zone');
    this.mini = q('.mini');
    this.reticle = q('.reticle');
    this.hurtEl = q('.vignette.hurt');
    this.blackEl = q('.blackout');
    this.eyesEl = q('.vignette.eyes');
    this.xpFill = q('.xp .fill');
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
  }

  toast(text: string, kind = '') {
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
    this.bannerEl.innerHTML = `<div class="btext">${esc(text)}</div>${sub ? `<div class="bsub">${esc(sub)}</div>` : ''}`;
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
    this.eyesEl.style.opacity = String(k);
  }

  prompt(label: string | null) {
    const text = label ? `${this.g.input.touch ? '✋' : '[F]'} ${label}` : '';
    if (this.promptEl.textContent !== text) this.promptEl.textContent = text;
    this.promptEl.style.visibility = label ? 'visible' : 'hidden';
  }

  setBoss(name: string | null, hp = 0, max = 1) {
    if (!name) {
      this.bossEl.classList.add('hidden');
      return;
    }
    this.bossEl.classList.remove('hidden');
    if (this.bossName.textContent !== name) this.bossName.textContent = name;
    this.bossFill.style.width = `${Math.max(0, (hp / max) * 100)}%`;
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

  update(dt: number) {
    const g = this.g;
    const p = g.player;
    const c = p.c;
    const hpK = Math.max(0, p.hp / p.maxHp);
    this.hpGhost = Math.max(hpK, this.hpGhost - dt * 0.4);
    this.bars.hp.style.width = `${hpK * 100}%`;
    this.bars.hpGhost.style.width = `${this.hpGhost * 100}%`;
    this.bars.mana.style.width = `${(p.mana / p.maxMana) * 100}%`;
    this.bars.stam.style.width = `${(p.stamina / p.maxStamina) * 100}%`;
    this.bars.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    this.bars.manaText.textContent = p.soulOrPower ? 'SOUL BARGAINED' : `${Math.floor(p.mana)} / ${p.maxMana}`;
    (this.bars.hp.parentElement as HTMLElement).style.width = `${Math.min(46, 16 + p.maxHp / 12)}vw`;
    (this.bars.mana.parentElement as HTMLElement).style.width = `${Math.min(40, 12 + p.maxMana / 6)}vw`;

    // Status chips.
    const chips: string[] = [];
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
    if (c.elfMystery && c.mysteryRevealed) chips.push('<b class="devil">Eye-Touched</b>');
    const statusHtml = chips.join('');
    if (this.status.innerHTML !== statusHtml) this.status.innerHTML = statusHtml;

    // Info: flasks, embers, ammo, weapon.
    const w = WEAPONS[mainWeapon(c).id];
    const infoHtml = `<div>⚗ ${c.flasks}/${c.flasksMax}${(c.items.fish ?? 0) + (c.items['golden-fish'] ?? 0) ? `  🐟 ${(c.items.fish ?? 0) + (c.items['golden-fish'] ?? 0)}` : ''}</div>
      <div class="embers">✦ ${c.gold}</div>
      <div>${esc(w.name)} <small>Lv ${mainWeapon(c).level}</small>${w.kind === 'bow' ? ` · ${c.arrows.steel ? `${c.arrows.steel} steel + ` : ''}${c.arrows.wood} arrows` : ''}</div>`;
    if (this.info.innerHTML !== infoHtml) this.info.innerHTML = infoHtml;

    // Spell bar.
    const ability = p.abilityName();
    const abilityCd = p.abilityCooldown();
    const key = JSON.stringify([c.spellSlots, p.selected, Math.ceil(abilityCd), ability, p.combineMode, Math.floor(p.mana), c.spellSlots.map((s) => (s ? Math.ceil(p.cooldownLeft(s)) : 0)), isLightSealed(c, g.gameMinutes)]);
    if (key !== this.lastSpellKey) {
      this.lastSpellKey = key;
      const slots = c.spellSlots.map((s, i) => {
        if (!s) return `<div class="slot empty" data-slot="${i}"><i>${i + 1}</i></div>`;
        const def = SPELLS[s];
        const cd = p.cooldownLeft(s);
        const cost = p.costOf(s);
        const blocked = (def.school === 'light' && isLightSealed(c, g.gameMinutes)) || (!p.soulOrPower && cost > p.mana);
        return `<div data-slot="${i}" class="slot${i === p.selected ? ' sel' : ''}${blocked ? ' off' : ''}${p.combineMode && i === (p.selected + 1) % 4 ? ' combo' : ''}" title="${esc(def.name)}">
          <span class="ic">${SPELL_ICON[def.school] ?? '✦'}</span><i>${i + 1}</i><em>${esc(def.name)}</em><small>${cost}</small>${cd > 0 ? `<div class="cd">${Math.ceil(cd)}</div>` : ''}</div>`;
      });
      const abilityHtml = `<div data-ability="1" class="slot ability${abilityCd > 0 ? ' off' : ''}"><span class="ic">❂</span><i>R</i><em>${esc(ability)}</em>${abilityCd > 0 ? `<div class="cd">${Math.ceil(abilityCd)}</div>` : ''}</div>`;
      this.spells.innerHTML = (c.knownSpells.length ? slots.join('') : '') + abilityHtml;
      if (canCombine(c)) this.spells.classList.add('can-combine');
    }

    this.xpFill.style.width = c.level >= MAX_LEVEL ? '100%' : `${(c.xp / xpToNext(c.level)) * 100}%`;

    // Vignettes.
    this.hurtLevel = Math.max(0, this.hurtLevel - dt * 1.2);
    const low = hpK < 0.3 ? 0.35 + 0.15 * Math.sin(performance.now() / 200) : 0;
    this.hurtEl.style.opacity = String(Math.max(this.hurtLevel, low));
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.className = 'banner';
    }

    // Zone and clock.
    const day = g.dayMinutes;
    const hh = Math.floor(day / 60), mm = Math.floor(day % 60);
    const zoneHtml = `${esc(ZONES[g.zone].name)}<br><small>${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${g.isNight ? '☾' : '☀'} · Lv ${c.level}${c.skillPoints ? ` · ${c.skillPoints} pt` : ''}</small>`;
    if (this.zoneEl.innerHTML !== zoneHtml) this.zoneEl.innerHTML = zoneHtml;
    this.drawMinimap();

    // Lock-on reticle.
    const t = p.lockTarget;
    if (t && this.project(t.center())) {
      this.reticle.style.display = 'block';
      this.reticle.style.transform = `translate(${this.v.x}px, ${this.v.y}px) translate(-50%, -50%)`;
    } else this.reticle.style.display = 'none';
    this.crosshair.style.display = (p.drawing > 0 || p.weaponKind === 'bow' || p.weaponKind === 'bolt') && !t ? 'block' : 'none';

    this.updateEnemyBars();
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
      if (!this.project(e.center().add(new THREE.Vector3(0, e.height * 0.6 + 0.4, 0)))) continue;
      let el = this.bars3d[n];
      if (!el) {
        el = document.createElement('div');
        el.className = 'ebar';
        el.innerHTML = '<div class="fill"></div><div class="aware"></div><span></span>';
        this.barLayer.appendChild(el);
        this.bars3d.push(el);
      }
      el.style.display = 'block';
      el.style.transform = `translate(${this.v.x}px, ${this.v.y}px) translate(-50%, -50%)`;
      (el.children[0] as HTMLElement).style.width = `${(e.hp / e.maxHp) * 100}%`;
      const aware = el.children[1] as HTMLElement;
      aware.style.width = e.aware ? '0' : `${e.awareness * 100}%`;
      const weak = elementWeakness(e.affinity);
      const label = historian ? `${e.name} Lv${e.level} · ${Math.ceil(e.hp)}${weak ? ` · weak: ${weak}` : ''}` : e.aware ? '' : e.awareness > 0.05 ? '?' : '';
      const span = el.children[2] as HTMLElement;
      if (span.textContent !== label) span.textContent = label;
      n++;
    }
    for (let i = n; i < this.bars3d.length; i++) this.bars3d[i].style.display = 'none';
  }

  private drawMinimap() {
    const g = this.g;
    const ctx = this.mini.getContext('2d')!;
    const S = 150;
    const p = g.player.pos;
    const img = mapImage();
    const range = 110; // world units across half the minimap
    const scale = img.width / 900;
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(g.camYaw - Math.PI);
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
    if (g.state.flags.eyesRevealed) dot(EYES_RUINS.x, EYES_RUINS.z, '#60ff90', 3.5);
    for (const e of g.enemies) if (e.alive && e.aware) dot(e.pos.x, e.pos.z, '#e03020', 2);
    if (g.state.lostEmbers) dot(g.state.lostEmbers.x, g.state.lostEmbers.z, '#ffb040', 3);
    ctx.restore();
    // The player arrow always points up the screen.
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(-(g.player.yaw - g.camYaw));
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-5, 5);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(220,190,120,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    // North marker.
    const na = g.camYaw - Math.PI - Math.PI / 2;
    ctx.fillStyle = '#e8d8a8';
    ctx.font = 'bold 11px serif';
    ctx.fillText('N', S / 2 + Math.cos(na) * (S / 2 - 10) - 4, S / 2 + Math.sin(na) * (S / 2 - 10) + 4);
  }
}
