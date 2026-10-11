import { CLASSES, COMBOS, RACES, ROLES, SPELLS, SUBCLASSES, TREES, WEAPONS, type SpellId } from '../data/defs';
import { EYES_RUINS, ITEMS, LORE, PAGES, QUESTS, SHRINES, TRIALS, BOSSES, type QuestId } from '../data/world';
import { dracoFlightHours, maxHp, maxMana, maxStamina, rank, treeFor, xpToNext } from '../rules/character';
import { canCombine, canWield, isLightSealed } from '../rules/combat';
import { saveSettings } from '../engine/state';
import { DEFAULT_SERVER, PAGES_URL } from '../engine/net';
import { heightAt } from '../engine/terrain';
import type { Game } from '../engine/game';
import { mapImage, toMap } from './mapimage';

type Tab = 'character' | 'equipment' | 'skills' | 'spells' | 'quests' | 'map' | 'lore' | 'coop' | 'settings' | 'controls';

const TABS: [Tab, string][] = [
  ['character', 'Hero'], ['equipment', 'Gear'], ['skills', 'Skills'], ['spells', 'Spells'], ['quests', 'Quests'],
  ['map', 'Map'], ['lore', 'Lore'], ['coop', 'Co-op'], ['settings', 'Settings'], ['controls', 'Controls'],
];

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export class Menu {
  isOpen = false;
  private el: HTMLElement;
  private tab: Tab = 'character';
  private pickSpell: SpellId | null = null;
  private coopCode = '';

  constructor(parent: HTMLElement, private g: Game) {
    this.el = document.createElement('div');
    this.el.className = 'menu hidden';
    parent.appendChild(this.el);
  }

  open(tab: Tab = this.tab) {
    this.tab = tab;
    this.isOpen = true;
    this.g.setMode('menu');
    this.render(true);
  }

  /** The co-op link changed (connected, someone joined...): refresh the Co-op tab if it is showing. */
  coopChanged() {
    if (this.isOpen && this.tab === 'coop') this.render();
  }

  close() {
    this.isOpen = false;
    this.el.className = 'menu hidden';
    this.g.setMode('play');
  }

  /** Rebuilds the panel; only opening it plays the entrance, and re-rendering the same tab keeps its scroll. */
  private render(entering = false) {
    const prev = this.el.querySelector<HTMLElement>('.mbody');
    const keep = !entering && prev?.dataset.tab === this.tab ? prev.scrollTop : 0;
    this.el.className = 'menu';
    this.el.innerHTML = `
      <div class="mpanel${entering ? ' in' : ''}">
        <div class="mtabs">${TABS.map(([id, name]) => `<button data-tab="${id}" class="${id === this.tab ? 'on' : ''}">${name}</button>`).join('')}
          <button data-act="resume" class="resume">Resume</button></div>
        <div class="mbody" data-tab="${this.tab}">${this.body()}</div>
      </div>`;
    if (keep) this.el.querySelector<HTMLElement>('.mbody')!.scrollTop = keep;
    this.el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => ((this.tab = b.dataset.tab as Tab), this.render())));
    this.el.querySelector('[data-act="resume"]')!.addEventListener('click', () => this.close());
    this.bind();
  }

  private body(): string {
    switch (this.tab) {
      case 'character': return this.character();
      case 'equipment': return this.equipment();
      case 'skills': return this.skills();
      case 'spells': return this.spells();
      case 'quests': return this.quests();
      case 'map': return '<canvas class="bigmap" width="640" height="640"></canvas><p class="hint">Click a discovered shrine (gold) to travel there. Red: trials. Grey: conquered.</p>';
      case 'lore': return this.lore();
      case 'coop': return this.coopTab();
      case 'settings': return this.settingsTab();
      case 'controls': return this.controls();
    }
  }

  private character(): string {
    const c = this.g.player.c;
    const p = this.g.player;
    const lines: string[] = [];
    if (c.elfElement) lines.push(`${c.elfElement[0].toUpperCase() + c.elfElement.slice(1)} elf: your element hits harder and hurts you less.`);
    if (c.raceId === 'elf') lines.push(c.elfMystery ? (c.mysteryRevealed ? 'Eye-Touched (the ****** has woken).' : '******') : 'Not ******. (Probably.)');
    if (c.wizardElement) lines.push(`Elemental Wizard of ${c.wizardElement}.`);
    if (dracoFlightHours(c)) lines.push(`Wings: ${dracoFlightHours(c)} hour(s) of flight.`);
    if (c.devilDeals) lines.push(`Deals with the Devil: ${c.devilDeals}/4.${isLightSealed(c, this.g.gameMinutes) ? ' Light sealed.' : ''}`);
    if (c.hpLost) lines.push(`Max HP lost to Soul or Power: ${Math.round(c.hpLost)}.`);
    if (c.tamed.length) lines.push(`Tamed: ${c.tamed.join(', ')}.`);
    const traits = (title: string, list: string[]) => `<div class="trait"><h4>${esc(title)}</h4><ul>${list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
    return `
      <h2>${esc(c.name)}</h2>
      <p class="sub">Level ${c.level} ${esc(RACES[c.raceId].name)} ${esc(CLASSES[c.classId].name)}${c.subclassId ? ` · ${esc(SUBCLASSES[c.subclassId].name)}` : ''} · ${esc(ROLES[c.roleId].name)}${c.expansion ? ' · Expansion' : ''}</p>
      <div class="stats">
        <div>HP <b>${Math.ceil(p.hp)} / ${maxHp(c)}</b></div>
        <div>Mana <b>${Math.floor(p.mana)} / ${maxMana(c)}</b></div>
        <div>Stamina <b>${maxStamina(c)}</b></div>
        <div>XP <b>${c.xp} / ${xpToNext(c.level)}</b></div>
        <div>Embers <b>${c.gold}</b></div>
        <div>Trials <b>${this.g.state.trialsDone.length} / 6</b></div>
      </div>
      ${lines.length ? `<ul class="notes">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
      <div class="cols traits">
        ${traits(CLASSES[c.classId].name, CLASSES[c.classId].traits)}
        ${c.subclassId ? traits(SUBCLASSES[c.subclassId].name, SUBCLASSES[c.subclassId].traits) : ''}
        ${traits(RACES[c.raceId].name, RACES[c.raceId].traits)}
        ${traits(ROLES[c.roleId].name, ROLES[c.roleId].traits)}
      </div>`;
  }

  private equipment(): string {
    const c = this.g.player.c;
    const weapons = c.weapons.map((w, i) => {
      const def = WEAPONS[w.id];
      const check = canWield(c, w.id);
      return `<div class="row${i === c.mainHand ? ' on' : ''}">
        <div><b class="${def.legendary ? 'legend' : ''}">${esc(def.name)}</b> <small>Lv ${w.level} · ${def.kind} · ${def.damage + 4 * (w.level - 1)} dmg${def.element !== 'physical' ? ` · ${def.element}` : ''}</small>
        ${def.description ? `<div class="desc">${esc(def.description)}</div>` : ''}
        ${check.reason ? `<div class="desc warn">${esc(check.reason)}</div>` : ''}</div>
        ${i === c.mainHand ? '<span class="tag">Equipped</span>' : `<button data-equip="${i}" ${check.ok ? '' : 'disabled'}>Equip</button>`}
      </div>`;
    });
    const items = Object.entries(c.items).filter(([, n]) => n > 0).map(([id, n]) => `<div class="row"><div><b>${esc(ITEMS[id]?.name ?? id)}</b> ×${n}<div class="desc">${esc(ITEMS[id]?.description ?? '')}</div></div></div>`);
    return `<h3>Weapons</h3>${weapons.join('')}
      <h3>Supplies</h3>
      <div class="row"><div><b>Flasks</b> ${c.flasks}/${c.flasksMax} <div class="desc">Restore half your health. Refilled at shrines.</div></div></div>
      ${c.arrows.wood + c.arrows.steel ? `<div class="row"><div><b>Arrows</b> ${c.arrows.wood} wood, ${c.arrows.steel} steel <div class="desc">Steel arrows hit 30% harder and are used first.</div></div></div>` : ''}
      ${items.join('') || ''}`;
  }

  private skills(): string {
    const c = this.g.player.c;
    const tree = TREES[treeFor(c)];
    return `<h3>${esc(tree.name)} <small>${c.skillPoints} point${c.skillPoints === 1 ? '' : 's'} to spend</small></h3>
      ${tree.nodes.map((n) => {
        const r = rank(c, n.id);
        const locked = c.level < n.level;
        const can = !locked && r < n.maxRank && c.skillPoints > 0;
        return `<div class="row${r ? ' on' : ''}"><div><b>${esc(n.name)}</b> <small>${r}/${n.maxRank}${locked ? ` · needs level ${n.level}` : ''}</small><div class="desc">${esc(n.description)}</div></div>
          <button data-skill="${n.id}" ${can ? '' : 'disabled'}>+</button></div>`;
      }).join('')}
      <p class="hint">You gain a skill point every level.</p>`;
  }

  private spells(): string {
    const c = this.g.player.c;
    const p = this.g.player;
    if (!c.knownSpells.length) {
      return `<p>You know no spells. ${c.classId === 'warrior' ? 'Warriors rely on steel, fury and their 20 mana for BloodRage.' : ''}</p><p class="hint">Spell tomes are hidden around the world. Some classes cannot learn them.</p>`;
    }
    const slots = c.spellSlots.map((s, i) => `<button class="sslot${this.pickSpell ? ' target' : ''}" data-slot="${i}"><i>${i + 1}</i> ${s ? esc(SPELLS[s].name) : '<em>empty</em>'}</button>`).join('');
    const list = c.knownSpells.map((s) => {
      const d = SPELLS[s];
      return `<div class="row${this.pickSpell === s ? ' on' : ''}"><div><b>${esc(d.name)}</b> <small>${p.costOf(s)} mana · ${d.school}${d.cooldown ? ` · ${d.cooldown}s` : ''}</small><div class="desc">${esc(d.description)}</div></div>
        <button data-pick="${s}">${this.pickSpell === s ? 'Pick a slot ↑' : 'Assign'}</button></div>`;
    });
    const combos = canCombine(c)
      ? `<h3>Combinations</h3><p class="hint">Turn on Combine (G / ⊕), then cast: the selected spell joins the one in the next slot.</p>${COMBOS.filter((k) => k.spells.every((s) => c.knownSpells.includes(s))).map((k) => `<div class="row"><div><b>${esc(k.name)}</b> <small>${esc(SPELLS[k.spells[0]].name)} + ${esc(SPELLS[k.spells[1]].name)}</small><div class="desc">${esc(k.description)}</div></div></div>`).join('')}`
      : c.classId === 'mage' ? '<p class="hint">At level 3 you can combine two spells into one.</p>' : '';
    return `<h3>Spell bar</h3><div class="sslots">${slots}</div><p class="hint">Tap cast for the main form; hold it for the alternate (Inferno: ring of fire, Way of the Wind: slowing gale, Deal with the Devil: lock on to take a single foe).</p><h3>Known spells</h3>${list.join('')}${combos}`;
  }

  private quests(): string {
    const st = this.g.state.quests;
    const ids = Object.keys(QUESTS) as QuestId[];
    const active = ids.filter((id) => st[id].state === 'active');
    const done = ids.filter((id) => st[id].state === 'done');
    const row = (id: QuestId) => `<div class="row${st[id].state === 'done' ? ' done' : ''}"><div><b>${esc(QUESTS[id].name)}</b> <small>${st[id].state === 'done' ? 'complete' : `${st[id].progress}/${QUESTS[id].goal}`}</small><div class="desc">${esc(QUESTS[id].description)}</div></div></div>`;
    const trials = TRIALS.map((t) => `<div class="row${this.g.state.trialsDone.includes(t.id) ? ' done' : ''}"><div><b>${esc(t.name)}</b> <small>level ${t.level}</small><div class="desc">${esc(BOSSES[t.boss].name)} guards the ${esc(WEAPONS[BOSSES[t.boss].reward].name)}.</div></div></div>`);
    return `<h3>Active</h3>${active.map(row).join('') || '<p class="hint">Talk to the people of Hearthhold.</p>'}
      <h3>The Six Trials</h3>${trials.join('')}
      ${done.length ? `<h3>Completed</h3>${done.map(row).join('')}` : ''}`;
  }

  private lore(): string {
    const s = this.g.state;
    const read = LORE.filter((l) => s.loreRead.includes(l.id));
    const pages = PAGES.filter((p) => s.taken.includes(p.id));
    return `${read.length ? read.map((l) => `<div class="row"><div><b>${esc(l.title)}</b><div class="desc">${esc(l.text)}</div></div></div>`).join('') : '<p class="hint">Lore stones glow gold. Ancient carvings glow green, and only Historians can read them.</p>'}
      ${pages.length ? `<h3>Torn pages</h3>${pages.map((p) => `<div class="row"><div class="desc">${esc(p.text)}</div></div>`).join('')}` : ''}`;
  }

  private settingsTab(): string {
    const s = this.g.settings;
    return `<div class="form">
      <label>Graphics quality <select data-set="quality">${['low', 'medium', 'high'].map((q) => `<option ${s.quality === q ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
      <p class="hint">Quality applies after reloading. High adds bloom and sharper shadows.</p>
      <label>Look sensitivity <input type="range" min="0.3" max="2.5" step="0.1" value="${s.sensitivity}" data-set="sensitivity"></label>
      <label>Invert look Y <input type="checkbox" ${s.invertY ? 'checked' : ''} data-set="invertY"></label>
      <label>Volume <input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-set="volume"></label>
      <label>Touch controls <select data-set="touch">${['auto', 'on', 'off'].map((q) => `<option ${s.touch === q ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
      <div class="btnrow"><button data-act="reload">Save &amp; reload</button><button data-act="quit">Save &amp; quit to title</button></div>
    </div>`;
  }

  private coopName(): string {
    const c = this.g.player.c;
    return this.g.settings.coopName || c.classId[0].toUpperCase() + c.classId.slice(1);
  }

  private coopTab(): string {
    const co = this.g.coop;
    const s = this.g.settings;
    const name = this.coopName();
    const status = `<div class="cstatus${co.busy ? ' busy' : ''}">${esc(co.status)}</div>`;
    if (co.active) {
      const party = co.party();
      const host = party.find((m) => m.host);
      return `<div class="coop form">
        ${co.isHost
          ? `<p>Your room code:</p><div class="code">${esc(co.room)}</div><p class="hint">Friends open Mythbound, go to Menu → Co-op, type this code and press Join.</p>`
          : `<p>You are in <b>${esc(host?.name ?? 'the host')}</b>’s world (room <b>${esc(co.room)}</b>).</p>`}
        <ul class="who"><li>${co.isHost ? '♛ ' : ''}${esc(name)} <small>(you)</small></li>${party.map((m) => `<li>${m.host ? '♛ ' : ''}${esc(m.name)} <small>level ${m.level}${m.alive ? '' : ' · fallen'}</small></li>`).join('')}</ul>
        ${status}
        <div class="btnrow"><button data-act="coop-leave">Leave co-op</button></div>
        <p class="hint">${co.isHost
          ? 'Your world is shared: keep this tab open and in view, or it pauses for everyone. Resting at a shrine no longer brings monsters back while friends are here.'
          : 'Monsters, bosses and the time of day come from the host. Your hero, items and progress are yours and save on this device.'}</p>
      </div>`;
    }
    const pages = !/github\.io$|^localhost$|^127\.0\.0\.1$/.test(location.hostname);
    return `<div class="coop form">
      <p>Play together with up to 3 friends. One of you hosts, and everyone joins that world: its monsters, bosses and time of day are shared. Each of you keeps your own hero, items and progress.</p>
      <label>Your name <input type="text" maxlength="20" data-coop="name" value="${esc(name)}"></label>
      <div class="btnrow"><button data-act="coop-host"${co.busy ? ' disabled' : ''}>Host a game</button></div>
      <label>Join with a room code <span><input type="text" class="codein" maxlength="6" data-coop="code" placeholder="ABCDE" value="${esc(this.coopCode)}"> <button data-act="coop-join"${co.busy ? ' disabled' : ''}>Join</button></span></label>
      ${status}
      ${pages ? `<p class="hint">Co-op needs the online version of the game: <a href="${PAGES_URL}" target="_blank" rel="noopener">${PAGES_URL}</a></p>` : ''}
      <p class="hint">The free server naps when nobody is playing, so the first connection can take up to a minute.</p>
      <details><summary class="hint">Server address</summary><label>Address <input type="text" data-coop="server" value="${esc(s.coopServer || DEFAULT_SERVER)}"></label></details>
    </div>`;
  }

  private controls(): string {
    const k = (...keys: string[]) => keys.map((x) => `<kbd>${x}</kbd>`).join('');
    return `<div class="cols keys"><div><h4>Keyboard &amp; mouse</h4><ul>
      <li>${k('W', 'A', 'S', 'D')} move · mouse: look (click to capture)</li>
      <li>${k('Shift')} tap: <b>shift lock</b> (face where the camera looks, over-the-shoulder view, crosshair) · hold: sprint</li>
      <li>${k('C')} roll / dodge · ${k('Space')} jump · ${k('Z')} sneak</li>
      <li>Left click: attack · hold with a bow to draw, release to shoot</li>
      <li>${k('E')} heavy attack (Swordsman: Spinner Flourish)</li>
      <li>Right click: block / raise shield</li>
      <li>${k('Tab')} or middle click: lock on</li>
      <li>${k('Q')} cast (hold for alternate form) · ${k('1')}–${k('4')} / wheel: choose spell</li>
      <li>${k('R')} class ability (BloodRage, Power Shot, Tame, Combine, Volley)</li>
      <li>${k('G')} combine spells (Mage Lv 3+) · ${k('V')} fly (Draco Lv 6+)</li>
      <li>${k('H')} drink flask · ${k('X')} eat fish · ${k('T')} switch weapon</li>
      <li>${k('F')} interact · ${k('M')} map · ${k('Esc')} / ${k('I')} menu</li></ul></div>
      <div><h4>Touch</h4><ul>
      <li>Left side: virtual joystick (push far to sprint)</li>
      <li>Right side: drag to look</li>
      <li>⚔ attack (hold with a bow) · 💥 heavy · ⤿ roll · ⤒ jump</li>
      <li>🛡 block · ✦ cast (hold for alternate) · ❂ ability · ⚗ flask</li>
      <li>Tap a spell slot to choose it; tap ❂ there to use your ability</li>
      <li>Top row: 🔒 shift lock · ◎ lock on · ⇄ weapon · ▼ sneak · 🪽 fly · ⊕ combine · 🐟 eat · 🗺 map · ☰ menu</li>
      <li>✋ appears when you can interact</li></ul></div></div>`;
  }

  private bind() {
    const g = this.g;
    const c = g.player.c;
    this.el.querySelectorAll<HTMLButtonElement>('[data-equip]').forEach((b) =>
      b.addEventListener('click', () => {
        c.mainHand = Number(b.dataset.equip);
        g.player.equip();
        this.render();
      }),
    );
    this.el.querySelectorAll<HTMLButtonElement>('[data-skill]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.skill!;
        if (c.skillPoints <= 0) return;
        c.skillPoints--;
        c.skills[id] = (c.skills[id] ?? 0) + 1;
        g.audio.play('pickup');
        this.render();
      }),
    );
    this.el.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) =>
      b.addEventListener('click', () => {
        this.pickSpell = b.dataset.pick as SpellId;
        this.render();
      }),
    );
    this.el.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.slot);
        if (this.pickSpell) {
          const prev = c.spellSlots.indexOf(this.pickSpell);
          if (prev >= 0) c.spellSlots[prev] = c.spellSlots[i];
          c.spellSlots[i] = this.pickSpell;
          this.pickSpell = null;
        } else c.spellSlots[i] = null;
        this.render();
      }),
    );
    this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-set]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const key = inp.dataset.set as keyof typeof g.settings;
        const s = g.settings as unknown as Record<string, unknown>;
        if (inp instanceof HTMLInputElement && inp.type === 'checkbox') s[key] = inp.checked;
        else if (inp instanceof HTMLInputElement) s[key] = Number(inp.value);
        else s[key] = inp.value;
        g.input.sensitivity = g.settings.sensitivity;
        g.input.invertY = g.settings.invertY;
        g.audio.setVolume(g.settings.volume);
        saveSettings(g.settings);
      }),
    );
    const coopSet = (key: 'coopName' | 'coopServer', value: string) => {
      g.settings[key] = value.trim();
      saveSettings(g.settings);
    };
    this.el.querySelector<HTMLInputElement>('[data-coop="name"]')?.addEventListener('change', (e) => coopSet('coopName', (e.target as HTMLInputElement).value.slice(0, 20)));
    this.el.querySelector<HTMLInputElement>('[data-coop="server"]')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLInputElement).value.trim();
      coopSet('coopServer', v === DEFAULT_SERVER ? '' : v);
    });
    const code = this.el.querySelector<HTMLInputElement>('[data-coop="code"]');
    code?.addEventListener('input', () => (this.coopCode = code.value.toUpperCase()));
    code?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.el.querySelector<HTMLButtonElement>('[data-act="coop-join"]')?.click();
    });
    this.el.querySelectorAll<HTMLInputElement>('input[type="text"]').forEach((inp) => inp.addEventListener('keydown', (e) => e.stopPropagation()));
    this.el.querySelector('[data-act="coop-host"]')?.addEventListener('click', () => {
      const name = this.el.querySelector<HTMLInputElement>('[data-coop="name"]')?.value.trim().slice(0, 20);
      if (name) coopSet('coopName', name);
      void g.coop.host(g.settings.coopServer || DEFAULT_SERVER, this.coopName());
    });
    this.el.querySelector('[data-act="coop-join"]')?.addEventListener('click', () => {
      const name = this.el.querySelector<HTMLInputElement>('[data-coop="name"]')?.value.trim().slice(0, 20);
      if (name) coopSet('coopName', name);
      void g.coop.join(g.settings.coopServer || DEFAULT_SERVER, this.coopCode, this.coopName());
    });
    this.el.querySelector('[data-act="coop-leave"]')?.addEventListener('click', () => g.coop.leave());
    this.el.querySelector('[data-act="reload"]')?.addEventListener('click', () => {
      g.save();
      location.reload();
    });
    this.el.querySelector('[data-act="quit"]')?.addEventListener('click', () => {
      g.save();
      g.onQuit();
    });
    const map = this.el.querySelector<HTMLCanvasElement>('.bigmap');
    if (map) this.drawMap(map);
  }

  private drawMap(canvas: HTMLCanvasElement) {
    const g = this.g;
    const ctx = canvas.getContext('2d')!;
    const S = canvas.width;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mapImage(), 0, 0, S, S);
    ctx.fillStyle = 'rgba(10,8,6,0.15)';
    ctx.fillRect(0, 0, S, S);
    const label = (x: number, z: number, text: string, color: string, r: number) => {
      const [px, py] = toMap(x, z, S);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
      ctx.font = '12px Cinzel, serif';
      ctx.fillStyle = '#f0e2c0';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 3;
      ctx.fillText(text, px + r + 3, py + 4);
      ctx.shadowBlur = 0;
    };
    label(0, 20, 'Hearthhold', '#d8c8a0', 5);
    for (const t of TRIALS) label(t.x, t.z, t.name.replace('Trial of ', '').replace('the ', ''), g.state.trialsDone.includes(t.id) ? '#8a8a8a' : '#ff5a40', 6);
    for (const s of SHRINES) if (g.state.shrinesFound.includes(s.id)) label(s.x, s.z, '', '#ffd070', 5);
    if (g.state.flags.eyesRevealed) label(EYES_RUINS.x, EYES_RUINS.z, '◉ ◉ ◉', '#60ff90', 5);
    if (g.state.lostEmbers) label(g.state.lostEmbers.x, g.state.lostEmbers.z, 'Lost embers', '#ffb040', 4);
    for (const r of g.coop.remotes.values()) if (r.ready) label(r.pos.x, r.pos.z, r.name, r.alive ? '#6fd6ff' : '#4a6a78', 5);
    const p = g.player;
    const [px, py] = toMap(p.pos.x, p.pos.z, S);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI - p.yaw);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.fill();
    ctx.restore();
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * S;
      const my = ((e.clientY - rect.top) / rect.height) * S;
      for (const s of SHRINES) {
        if (!g.state.shrinesFound.includes(s.id)) continue;
        const [sx, sy] = toMap(s.x, s.z, S);
        if (Math.hypot(sx - mx, sy - my) < 14) return this.travel(s.id);
      }
    });
  }

  private travel(id: string) {
    const g = this.g;
    if (g.inTrial) return g.hud.toast('The fog holds you here.');
    if (g.enemies.some((e) => e.alive && e.aware && e.pos.distanceTo(g.player.pos) < 25)) return g.hud.toast('You cannot travel while enemies hunt you.');
    if (g.player.sailing) return g.hud.toast('Step ashore first.');
    const s = SHRINES.find((x) => x.id === id)!;
    const p = g.player;
    p.pos.set(s.x + 2, heightAt(s.x + 2, s.z + 3), s.z + 3);
    p.vel.set(0, 0, 0);
    p.flying = false;
    g.state.lastShrine = id;
    g.hud.toast(`Travelled to ${s.name}.`);
    this.close();
  }
}
