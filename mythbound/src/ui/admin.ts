// The admin panel (admins only, P): builder mode and saving builds with their
// links, and a few powers over your own hero and the world around you.

import { ENEMIES, LAIRS, SHRINES, TOWN, TRIALS, type EnemyId } from '../data/world';
import { WEAPONS } from '../data/defs';
import { xpToNext } from '../rules/character';
import { heightAt } from '../engine/terrain';
import { buildLink } from '../engine/builder';
import type { Game } from '../engine/game';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Places to teleport to: the town, every shrine, trial and lair. */
const PLACES: { name: string; x: number; z: number }[] = [
  { name: 'Hearthhold', x: TOWN.x, z: TOWN.z + 22 },
  ...SHRINES.map((s) => ({ name: `Shrine: ${s.name}`, x: s.x + 3, z: s.z + 3 })),
  ...TRIALS.map((t) => ({ name: `Trial: ${t.name}`, x: t.x, z: t.z + t.radius + 6 })),
  ...LAIRS.map((l) => ({ name: `Lair: ${l.name}`, x: l.x, z: l.z + l.leash + 6 })),
];

export class AdminPanel {
  isOpen = false;
  private el: HTMLElement;
  private link = '';
  private myBuilds: { id: string; name: string; updatedAt: number }[] | null = null;
  private busy = '';

  constructor(private g: Game) {
    this.el = document.createElement('div');
    this.el.className = 'admin hidden';
    g.container.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.code === 'KeyP' && !e.repeat && this.g.admin && (this.g.mode === 'play' || this.isOpen)) this.toggle();
      else if (e.code === 'Escape' && this.isOpen) this.close();
      else if (e.code === 'KeyK' && !e.repeat && this.g.admin && this.g.mode === 'play') this.g.builder.toggle();
    });
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (!this.g.admin) return;
    this.isOpen = true;
    this.g.setMode('dialog');
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    this.isOpen = false;
    this.el.classList.add('hidden');
    this.g.setMode('play');
  }

  private render() {
    const g = this.g;
    const b = g.builder;
    const meta = b.meta;
    const builds = this.myBuilds
      ? this.myBuilds.length
        ? this.myBuilds.map((x) => `<div class="adm-row"><span>${esc(x.name)} <small>${new Date(x.updatedAt).toLocaleString()}</small></span><button data-open="${x.id}">Open</button><button data-copy="${esc(buildLink(x.id))}">Copy link</button></div>`).join('')
        : '<p class="hint">No saved builds yet.</p>'
      : '<button data-act="builds">Show my saved builds</button>';
    const places = PLACES.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('');
    const foes = Object.values(ENEMIES).map((e) => `<option value="${e.id}">${esc(e.name)} (level ${e.level})</option>`).join('');
    this.el.innerHTML = `<div class="adm-box">
      <div class="adm-head"><b>Admin panel</b> <small>${esc(g.accountName)}</small><button data-act="close">✕</button></div>
      <h3>Builder</h3>
      <div class="adm-row"><button data-act="builder">${b.active ? 'Leave builder mode (K)' : 'Enter builder mode (K)'}</button>
        <span class="hint">${b.count} changes${b.dirty ? ', not saved' : meta.id ? ', saved' : ''}</span></div>
      <div class="adm-row"><label>Name <input data-name maxlength="40" value="${esc(meta.name)}"></label>
        <button data-act="save">${meta.id ? 'Save' : 'Save and get a link'}</button>
        <button data-act="saveNew">Save as new</button></div>
      ${this.busy ? `<p class="hint">${esc(this.busy)}</p>` : ''}
      ${this.link ? `<div class="adm-row adm-link"><input readonly value="${esc(this.link)}"><button data-copy="${esc(this.link)}">Copy</button></div><p class="hint">Anyone who opens this link plays in your build.</p>` : ''}
      <div class="adm-row"><button data-act="fresh">Start an empty build</button></div>
      ${builds}
      <h3>Your hero</h3>
      <div class="adm-row"><button data-act="god">${g.godMode ? 'God mode: ON' : 'God mode: off'}</button><button data-act="heal">Heal fully</button></div>
      <div class="adm-row"><button data-act="gold">+1000 embers</button><button data-act="level">+1 level</button><button data-act="weapons">Every weapon</button></div>
      <h3>Teleport</h3>
      <div class="adm-row"><select data-place>${places}</select><button data-act="go">Go</button></div>
      <h3>World</h3>
      <div class="adm-row"><button data-time="360">Dawn</button><button data-time="720">Noon</button><button data-time="1110">Dusk</button><button data-time="0">Midnight</button></div>
      <div class="adm-row"><select data-foe>${foes}</select><button data-act="spawn">Spawn here</button><button data-act="clear">Clear monsters nearby</button></div>
    </div>`;
  }

  private async onClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const g = this.g;
    const p = g.player;
    if (t === this.el) return this.close();
    const copy = t.dataset.copy;
    if (copy) {
      void navigator.clipboard?.writeText(copy).then(() => g.hud.toast('Link copied.', 'skill'), () => g.hud.toast('Copy it from the box.', 'warn'));
      return;
    }
    if (t.dataset.open) {
      location.href = buildLink(t.dataset.open);
      return;
    }
    if (t.dataset.time) {
      g.passTime(Number(t.dataset.time));
      return g.hud.toast('Time changed.', 'skill');
    }
    switch (t.dataset.act) {
      case 'close':
        return this.close();
      case 'builder':
        this.close();
        return g.builder.toggle();
      case 'save':
      case 'saveNew': {
        const name = (this.el.querySelector<HTMLInputElement>('[data-name]')?.value.trim() || 'My build').slice(0, 40);
        if (t.dataset.act === 'saveNew') g.builder.meta.id = undefined;
        this.busy = 'Saving…';
        this.render();
        try {
          await g.cloud!.ready(() => {});
          this.link = await g.builder.save(name);
          this.busy = '';
          this.myBuilds = null;
          history.replaceState(history.state, '', `${location.pathname}?build=${g.builder.meta.id}`);
          g.hud.toast('Build saved. Its link is in the admin panel.', 'quest');
        } catch (err) {
          this.busy = `Could not save: ${err instanceof Error ? err.message : String(err)}`;
        }
        return this.render();
      }
      case 'fresh':
        g.builder.fresh();
        this.link = '';
        history.replaceState(history.state, '', location.pathname);
        return this.render();
      case 'builds':
        this.busy = 'Loading your builds…';
        this.render();
        try {
          this.myBuilds = await g.cloud!.builds();
          this.busy = '';
        } catch (err) {
          this.busy = `Could not load them: ${err instanceof Error ? err.message : String(err)}`;
        }
        return this.render();
      case 'god':
        g.godMode = !g.godMode;
        return this.render();
      case 'heal':
        p.hp = p.maxHp;
        p.mana = p.maxMana;
        p.stamina = p.maxStamina;
        return g.hud.toast('Healed.', 'skill');
      case 'gold':
        p.c.gold += 1000;
        return g.hud.toast('+1000 embers', 'skill');
      case 'level':
        g.gainXp(Math.max(1, xpToNext(p.c.level) - p.c.xp));
        return;
      case 'weapons':
        for (const w of Object.values(WEAPONS)) if (!p.c.weapons.some((x) => x.id === w.id)) p.c.weapons.push({ id: w.id, level: 1 });
        return g.hud.toast('Every weapon is in your pack.', 'skill');
      case 'go': {
        const place = PLACES[Number(this.el.querySelector<HTMLSelectElement>('[data-place]')?.value ?? 0)];
        if (!place) return;
        p.pos.set(place.x, heightAt(place.x, place.z) + (g.builder.active ? 6 : 0.5), place.z);
        p.vel.set(0, 0, 0);
        this.close();
        return g.hud.toast(place.name, 'skill');
      }
      case 'spawn': {
        const id = this.el.querySelector<HTMLSelectElement>('[data-foe]')?.value as EnemyId;
        if (!ENEMIES[id]) return;
        const a = p.yaw;
        g.spawnEnemy(id, p.pos.x + Math.sin(a) * 6, p.pos.z + Math.cos(a) * 6);
        return g.hud.toast(`${ENEMIES[id].name} appears.`, 'warn');
      }
      case 'clear': {
        let n = 0;
        for (const foe of [...g.enemies]) if (Math.hypot(foe.pos.x - p.pos.x, foe.pos.z - p.pos.z) < 60 && !('bdef' in foe)) (g.removeEnemy(foe), n++);
        return g.hud.toast(`Cleared ${n} monsters.`, 'skill');
      }
    }
  }
}
