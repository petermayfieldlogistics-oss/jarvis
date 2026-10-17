import { CLASSES, COMBOS, LEGEND_SHARD, PERKS, RACES, ROLES, RUNES, SPELLS, SUBCLASSES, TEAM_COMBOS, TIER_POINTS, TREES, WEAPONS, type SpellId } from '../data/defs';
import { ITEMS, LORE, PAGES, SHRINES, WEAPON_TRIALS, type QuestId } from '../data/world';
import { dracoFlightHours, maxHp, maxMana, maxStamina, MAX_LEVEL, MAX_RENOWN, MILESTONES, rank, renownXp, treesFor, xpToNext } from '../rules/character';
import { perkSlots, takesPerks } from '../rules/legend';
import { canCombine, canWield, isLightSealed } from '../rules/combat';
import { findNode, learnSkill, nodeView, pointsSpent, rankText, respec, respecCost, type NodeView } from '../rules/skills';
import { questLines } from '../engine/questlog';
import { MAX_KNIVES, ownsKnives } from '../rules/weapons';
import { isFood, isFruit } from '../rules/food';
import { hasMade, recipeGold, recipesAt, TOOLS } from '../rules/crafting';
import { wardrobeCounts } from '../rules/outfit';
import { FRUITS, MATERIALS, STATION_NAME, spanText } from '../data/goods';
import { saveSettings } from '../engine/state';
import { DEFAULT_SERVER, PAGES_URL } from '../engine/net';
import { inviteLink } from '../rules/invite';
import { MATCH, type MatchMode } from '../rules/pvp';
import { heightAt } from '../engine/terrain';
import type { Game } from '../engine/game';
import { Journal } from './journal';

type Tab = 'character' | 'equipment' | 'skills' | 'spells' | 'quests' | 'map' | 'lore' | 'coop' | 'settings' | 'controls';

const TABS: [Tab, string][] = [
  ['character', 'Hero'], ['equipment', 'Inventory'], ['skills', 'Skills'], ['spells', 'Spells'], ['quests', 'Quests'],
  ['map', 'Map'], ['lore', 'Lore'], ['coop', 'Co-op'], ['settings', 'Settings'], ['controls', 'Controls'],
];

/** The big title over each page of the journal. */
const TITLES: Record<Tab, string> = {
  character: 'Hero', equipment: 'Inventory', skills: 'Skill Tree', spells: 'Spells & Arts', quests: 'Quest Select',
  map: 'Area Map', lore: 'Lore', coop: 'Co-op', settings: 'Settings', controls: 'Controls',
};

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

export class Menu {
  isOpen = false;
  private el: HTMLElement;
  private tab: Tab = 'character';
  private pickSpell: SpellId | null = null;
  /** The skill node whose details show beside the tree. */
  private pickNode: string | null = null;
  /** Which of the hero's trees the Skills tab shows (the newer classes have a class tree and a subclass tree). */
  private treeTab = 0;
  /** The reset button waits for a second tap. */
  private respecArmed = false;
  private coopCode = '';
  /** The arena match the host is setting up. */
  private pvpMode: MatchMode = 'ffa';
  private pvpGoal = MATCH.goals[0];
  private pvpTime = MATCH.times[1];
  /** The Area Map and Quest Select pages. */
  private journal: Journal;

  constructor(parent: HTMLElement, private g: Game) {
    this.el = document.createElement('div');
    this.el.className = 'menu hidden';
    parent.appendChild(this.el);
    this.journal = new Journal(g, () => this.isOpen && this.render(), (id) => this.travel(id));
    // Q and E leaf through the journal's pages.
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.repeat || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'KeyQ' || e.code === 'KeyE') this.turn(e.code === 'KeyE' ? 1 : -1);
    });
  }

  /** The next (or previous) page of the journal. */
  private turn(step: number) {
    const i = TABS.findIndex(([id]) => id === this.tab);
    this.tab = TABS[(i + step + TABS.length) % TABS.length][0];
    this.render();
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
    const g = this.g;
    const keys = !g.input.touch;
    // A diamond over a page with something new: points to spend, a quest to hand in.
    const news = (id: Tab) => (id === 'skills' && g.player.c.skillPoints > 0) || (id === 'quests' && questLines(g.state, g.player.pos.x, g.player.pos.z).some((l) => l.ready));
    this.el.innerHTML = `
      <div class="mpanel${entering ? ' in' : ''}">
        <div class="mhead"><h1>${TITLES[this.tab]}</h1><button data-act="resume" class="resume" title="Close">✕</button></div>
        <div class="mtabs">${keys ? '<button class="mkey" data-turn="-1">Q</button>' : ''}${TABS.map(([id, name]) => `<button data-tab="${id}" class="${id === this.tab ? 'on' : ''}">${news(id) ? '<span class="nd"></span>' : ''}${name}${id === 'skills' && g.player.c.skillPoints > 0 ? `<i class="badge">${g.player.c.skillPoints}</i>` : ''}</button>`).join('')}${keys ? '<button class="mkey" data-turn="1">E</button>' : ''}</div>
        <div class="mbody" data-tab="${this.tab}">${this.body()}</div>
        ${keys ? `<div class="mfoot"><span><kbd>Q</kbd><kbd>E</kbd> Switch</span>${this.tab === 'map' ? '<span><kbd>Click</kbd> Select</span>' : ''}${this.tab === 'quests' ? '<span><kbd>Click</kbd> Select</span>' : ''}<span><kbd>Esc</kbd> Back</span></div>` : ''}
      </div>`;
    this.el.querySelectorAll<HTMLButtonElement>('[data-turn]').forEach((b) => b.addEventListener('click', () => this.turn(Number(b.dataset.turn))));
    if (keep) this.el.querySelector<HTMLElement>('.mbody')!.scrollTop = keep;
    // Only the tab buttons: the body also carries data-tab, and re-rendering on a
    // click inside it would wipe out a text box as soon as it is tapped.
    this.el.querySelectorAll<HTMLButtonElement>('.mtabs button[data-tab]').forEach((b) => b.addEventListener('click', () => ((this.tab = b.dataset.tab as Tab), this.render())));
    this.el.querySelector('[data-act="resume"]')!.addEventListener('click', () => this.close());
    this.bind();
  }

  private body(): string {
    switch (this.tab) {
      case 'character': return this.character();
      case 'equipment': return this.equipment();
      case 'skills': return this.skills();
      case 'spells': return this.spells();
      case 'quests': return this.journal.questPage();
      case 'map': return this.journal.mapPage();
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
    if (c.raceId === 'zombie') lines.push(c.riseSpent ? 'Not Dead Yet: spent. Rest at a shrine to cheat death again.' : 'Not Dead Yet: ready.');
    if (c.devilDeals) lines.push(`Deals with the Devil: ${c.devilDeals}/4.${isLightSealed(c, this.g.gameMinutes) ? ' Light sealed.' : ''}`);
    if (c.hpLost) lines.push(`Max HP lost to Soul or Power: ${Math.round(c.hpLost)}.`);
    if (c.tamed.length) lines.push(`Tamed: ${c.tamed.join(', ')}.`);
    const wr = wardrobeCounts(c.wardrobe);
    const traits = (title: string, list: string[]) => `<div class="trait"><h4>${esc(title)}</h4><ul>${list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
    return `
      <h2>${esc(c.name)}</h2>
      <p class="sub">Level ${c.level} ${esc(RACES[c.raceId].name)} ${esc(CLASSES[c.classId].name)}${c.subclassId ? ` · ${esc(SUBCLASSES[c.subclassId].name)}` : ''} · ${esc(ROLES[c.roleId].name)}${c.expansion ? ' · Expansion' : ''}</p>
      <div class="stats">
        <div>HP <b>${Math.ceil(p.hp)} / ${maxHp(c)}</b></div>
        <div>Mana <b>${Math.floor(p.mana)} / ${maxMana(c)}</b></div>
        <div>Stamina <b>${maxStamina(c)}</b></div>
        <div>${c.level >= MAX_LEVEL ? `Renown <b>${c.renown} / ${MAX_RENOWN}</b>` : 'XP'} <b>${c.level >= MAX_LEVEL ? (c.renown >= MAX_RENOWN ? 'max' : `${c.xp} / ${renownXp()}`) : `${c.xp} / ${xpToNext(c.level)}`}</b></div>
        <div>Embers <b>${c.gold}</b></div>
        <div>Legend Shards <b>${c.items[LEGEND_SHARD] ?? 0}</b></div>
        <div>Trials <b>${WEAPON_TRIALS.filter((t) => this.g.state.trialsDone.includes(t.id)).length} / ${WEAPON_TRIALS.length}</b></div>
      </div>
      <div class="btnrow wardrow"><button data-act="wardrobe">Wardrobe</button><small>Clothes ${wr.garments}/${wr.ofGarments} · Colours ${wr.dyes}/${wr.ofDyes}</small></div>
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
        <div><b class="${def.legendary ? 'legend' : ''}">${esc(def.name)}</b> <small>Lv ${w.level} · ${def.kind} · ${def.damage + 4 * (w.level - 1)} dmg${def.element !== 'physical' ? ` · ${def.element}` : ''}</small>${w.rune ? ` <small style="color:#${RUNES[w.rune].color.toString(16).padStart(6, '0')}">ᚱ ${esc(RUNES[w.rune].name)}: ${esc(RUNES[w.rune].description)}</small>` : ''}
        ${def.description ? `<div class="desc">${esc(def.description)}</div>` : ''}
        ${takesPerks(w.id) ? `<div class="desc perks">${[0, 1, 2].map((k) => (w.perks?.[k] ? `<span class="perk">${PERKS[w.perks[k]].icon} ${esc(PERKS[w.perks[k]].name)}</span>` : k < perkSlots(w) ? '<span class="perk empty">◇ empty slot</span>' : `<span class="perk locked">🔒 Lv ${[1, 5, 10][k]}</span>`)).join('')}</div>` : ''}
        ${check.reason ? `<div class="desc warn">${esc(check.reason)}</div>` : ''}</div>
        ${i === c.mainHand ? '<span class="tag">Equipped</span>' : `<button data-equip="${i}" ${check.ok ? '' : 'disabled'}>Equip</button>`}
      </div>`;
    });
    // The pack in groups: food (each with an Eat button), tools, materials, and the rest.
    const held = Object.entries(c.items).filter(([, n]) => n > 0);
    const row = ([id, n]: [string, number]) =>
      `<div class="row"><div><b>${esc(ITEMS[id]?.name ?? id)}</b> ×${n}<div class="desc">${esc(ITEMS[id]?.description ?? '')}</div></div>${isFood(id) ? `<button data-eat="${esc(id)}">Eat</button>` : ''}</div>`;
    const group = (title: string, list: [string, number][]) => (list.length ? `<h4 class="sub">${title}</h4>${list.map(row).join('')}` : '');
    const food = held.filter(([id]) => isFood(id) && !isFruit(id));
    // Fruit and sweets: eaten for their buff (one at a time), never by X.
    const fruit = held.filter(([id]) => isFruit(id));
    const tools = held.filter(([id]) => TOOLS.includes(id) || id === 'compost' || id === 'lure');
    const mats = held.filter(([id]) => Object.hasOwn(MATERIALS, id));
    const other = held.filter(([id]) => !isFood(id) && !tools.some(([t]) => t === id) && !mats.some(([m]) => m === id));
    const items = [group('Food', food), group(`Fruit and sweets${c.fed ? ` · fed: ${FRUITS[c.fed.id].name}, ${spanText(c.fed.left)} left` : ''}`, fruit), group('Tools and supplies', tools), group('Materials', mats), group('Other', other)];
    // The recipe book: what each station makes, ticked once made.
    const book = (['cookfire', 'bench', 'anvil', 'loom'] as const).map((st) => `<h4 class="sub">${STATION_NAME[st]}</h4><div class="desc">${recipesAt(st).map((r) => `${this.g.state.flags[`made-${r.id}`] || hasMade(c, r) ? '✔ ' : ''}${esc(r.name)} <small>(${Object.entries(r.needs).map(([id, n]) => `${n} ${esc(ITEMS[id]?.name ?? id)}`).join(', ')}${r.arrows ? `, ${r.arrows} wood arrows` : ''}${r.gold ? `, ${recipeGold(c, r)} embers` : ''})</small>${r.camp ? ' <small>· any shrine</small>' : ''}`).join('<br>')}</div>`).join('');
    return `<h3>Weapons</h3>${weapons.join('')}
      <h3>Supplies</h3>
      <div class="row"><div><b>Flasks</b> ${c.flasks}/${c.flasksMax} <div class="desc">Restore half your health. Refilled at shrines.</div></div></div>
      ${ownsKnives(c) ? `<div class="row"><div><b>Throwing knives</b> ${c.knives}/${MAX_KNIVES} <div class="desc">Pick them up where they land. Refilled at shrines.</div></div></div>` : ''}
      ${c.arrows.wood + c.arrows.steel ? `<div class="row"><div><b>Arrows</b> ${c.arrows.wood} wood, ${c.arrows.steel} steel <div class="desc">Steel arrows hit 30% harder and are used first.</div></div></div>` : ''}
      ${items.join('') || ''}
      <details class="book"><summary><h3>Recipe book</h3></summary><p class="hint">Cook at the fire by Wren's field (fish and bread at any shrine too), craft at the workbench by the forge, smith at an anvil, weave and dye at the loom north of the field.</p>${book}</details>`;
  }

  /** The class's skill tree: tiers as rows, prerequisites as lines, the picked node's ranks beside it. */
  private skills(): string {
    const c = this.g.player.c;
    const ids = treesFor(c);
    this.treeTab = Math.min(this.treeTab, ids.length - 1);
    const treeId = ids[this.treeTab];
    const tree = TREES[treeId];
    // A point spent in either tree counts against the same pool; each tree opens its own tiers.
    const tabs = ids.length > 1
      ? `<div class="streetabs">${ids.map((id, i) => `<button data-tree="${i}" class="${i === this.treeTab ? 'on' : ''}">${esc(TREES[id].name)}<small>${pointsSpent(c, id)} spent</small></button>`).join('')}</div>`
      : '';
    const views = tree.nodes.map((n) => nodeView(c, n, treeId));
    const pick = views.find((v) => v.node.id === this.pickNode) ?? views.find((v) => v.ready) ?? views[0];
    this.pickNode = pick.node.id;
    const rows = Math.max(...tree.nodes.map((n) => n.tier));
    const spent = pointsSpent(c, treeId);
    const lines = tree.nodes.flatMap((n) => (n.req ?? []).map((id) => {
      const from = findNode(treeId, id);
      if (!from) return '';
      const cls = rank(c, n.id) ? 'on' : rank(c, id) ? 'open' : '';
      return `<line class="${cls}" x1="${from.col + 0.5}" y1="${from.tier - 0.5}" x2="${n.col + 0.5}" y2="${n.tier - 0.5}"/>`;
    })).join('');
    const tiers = Array.from({ length: rows }, (_, i) => {
      const need = TIER_POINTS[i + 1] ?? 0;
      return `<div class="stier${spent >= need ? ' open' : ''}"><b>${ROMAN[i]}</b>${spent >= need ? '' : `<small>🔒${need}</small>`}</div>`;
    }).join('');
    const nodes = views.map((v) => {
      const n = v.node;
      const cls = ['snode', v.rank && 'learned', v.maxed && 'maxed', v.ready && 'ready', !v.rank && v.reason && 'locked', n === pick.node && 'sel'].filter(Boolean).join(' ');
      const pips = Array.from({ length: n.maxRank }, (_, i) => `<i${i < v.rank ? ' class="on"' : ''}></i>`).join('');
      return `<button class="${cls}" data-node="${n.id}" style="grid-row:${n.tier};grid-column:${n.col + 1}" aria-label="${esc(n.name)}, rank ${v.rank} of ${n.maxRank}">
        <span class="si">${n.icon}</span><span class="sn">${esc(n.name)}</span><span class="sp">${pips}</span>${v.maxed ? '' : `<span class="sc">${v.cost}</span>`}</button>`;
    }).join('');
    const cost = respecCost(c);
    const resetLabel = this.respecArmed ? `Tap again to reset${cost ? ` (${cost} embers)` : ''}` : `Reset skills (${cost ? `${cost} embers` : 'free'})`;
    return `<div class="skilltab">
      ${tabs}
      <div class="shead"><h3>${esc(tree.name)}</h3><div class="spts${c.skillPoints ? ' have' : ''}"><b>${c.skillPoints}</b> point${c.skillPoints === 1 ? '' : 's'} to spend <small>· ${spent} spent</small></div></div>
      <div class="sbody">
        <div class="stree" style="--rows:${rows}">
          <div class="stiers">${tiers}</div>
          <div class="sgrid"><svg class="slines" viewBox="0 0 3 ${rows}" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${nodes}</div>
        </div>
        ${this.skillDetail(pick)}
      </div>
      <div class="sfoot"><button data-act="respec" class="${this.respecArmed ? 'armed' : ''}" ${!spent || c.gold < cost ? 'disabled' : ''}>${resetLabel}</button>
        <p class="hint">A point every level, and a bonus point every 5 levels. Deeper tiers open as you spend points in the tree, and cost more per rank.${ids.length > 1 ? ' Your class and subclass trees share your points.' : ''} The first reset is free.</p></div>
      <h3>Milestones</h3>
      <div class="miles">${MILESTONES.map((m) => `<div class="mile${c.level >= m.level ? ' on' : ''}"><b>★ ${m.level}</b><span>${esc(m.name)}<small>${esc(m.text)}</small></span></div>`).join('')}</div>
    </div>`;
  }

  private skillDetail(v: NodeView): string {
    const c = this.g.player.c;
    const n = v.node;
    const ranks = Array.from({ length: n.maxRank }, (_, i) => `<li class="${i < v.rank ? 'on' : i === v.rank ? 'next' : ''}">${n.maxRank > 1 ? `<b>Rank ${i + 1}</b> ` : ''}${esc(rankText(n, i + 1))}</li>`).join('');
    const req = n.req?.map((id) => `${esc(treesFor(c).map((t) => findNode(t, id)).find(Boolean)?.name ?? id)}${rank(c, id) ? ' ✔' : ''}`).join(', ');
    const status = v.maxed ? '<p class="sok">Mastered.</p>' : v.reason ? `<p class="swarn">🔒 ${esc(v.reason)}.</p>` : !v.ready ? `<p class="swarn">Needs ${v.cost} skill point${v.cost === 1 ? '' : 's'}.</p>` : '';
    return `<div class="sdetail">
      <div class="sdh"><span class="si">${n.icon}</span><div><b>${esc(n.name)}</b><small>Tier ${ROMAN[n.tier - 1]} · ${v.cost} point${v.cost === 1 ? '' : 's'} a rank · rank ${v.rank}/${n.maxRank}</small></div></div>
      <ul class="sranks">${ranks}</ul>
      ${req ? `<p class="sreq">Needs: ${req}</p>` : ''}${n.level > 1 ? `<p class="sreq">From level ${n.level}</p>` : ''}
      ${status}
      <button class="primary slearn" data-learn="${n.id}" ${v.ready ? '' : 'disabled'}>${v.maxed ? 'Mastered' : `${v.rank ? 'Rank up' : 'Learn'} · ${v.cost} point${v.cost === 1 ? '' : 's'}`}</button>
    </div>`;
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
      return `<div class="row${this.pickSpell === s ? ' on' : ''}"><div><b>${esc(d.name)}</b> <small>${p.costOf(s)} ${d.stamina ? 'stamina' : 'mana'} · ${d.school === 'martial' ? 'art of war' : d.school === 'hunt' ? "hunter's art" : d.school}${d.cooldown ? ` · ${d.cooldown}s` : ''}</small><div class="desc">${esc(d.description)}</div></div>
        <button data-pick="${s}">${this.pickSpell === s ? 'Pick a slot ↑' : 'Assign'}</button></div>`;
    });
    const combos = canCombine(c)
      ? `<h3>Combinations</h3><p class="hint">Turn on Combine (G / ⊕), then cast: the selected spell joins the one in the next slot.</p>${COMBOS.filter((k) => k.spells.every((s) => c.knownSpells.includes(s))).map((k) => `<div class="row"><div><b>${esc(k.name)}</b> <small>${esc(SPELLS[k.spells[0]].name)} + ${esc(SPELLS[k.spells[1]].name)}</small><div class="desc">${esc(k.description)}</div></div></div>`).join('')}`
      : c.classId === 'mage' ? '<p class="hint">At level 3 you can combine two spells into one.</p>'
        : c.classId === 'monk' ? '<p class="hint">Techniques spend chi (your mana). Every blow that lands brings some back.</p>'
          : c.classId === 'sorcerer' ? '<p class="hint">Hold cast on a channelled spell to keep its beam flowing; it drains mana while held.</p>'
            : c.classId === 'rogue' ? '<p class="hint">Tricks spend your mana. Vanish (R) first, and your next strike is an ambush.</p>'
              : c.classId === 'warrior' ? '<p class="hint">Arts of war spend stamina, not mana, and only warriors know them. Battle Shout comes at level 6, Unbreakable at 12.</p>'
                : c.classId === 'ranger' ? "<p class=\"hint\">Hunter's arts spend stamina, not mana, and only rangers know them. Snare Trap comes at level 6, Evasive Leap at 12.</p>" : '';
    return `<h3>Spell bar</h3><div class="sslots">${slots}</div><p class="hint">Tap cast for the main form; hold it for the alternate (Inferno: ring of fire, Way of the Wind: slowing gale, Deal with the Devil: lock on to take a single foe).</p><h3>Known spells</h3>${list.join('')}${combos}`;
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
      <label>Camera follows you (touch) <input type="checkbox" ${s.camFollow !== false ? 'checked' : ''} data-set="camFollow"></label>
      <div class="btnrow"><button data-act="reload">Save &amp; reload</button><button data-act="quit">Save &amp; quit to title</button></div>
    </div>`;
  }

  /** The link that brings a friend straight into this room (always the online game's address, which co-op needs). */
  private inviteLink(): string {
    const here = /github\.io$|^localhost$|^127\.0\.0\.1$/.test(location.hostname);
    return inviteLink(here ? location.origin + location.pathname : PAGES_URL, this.g.coop.room);
  }

  private coopName(): string {
    const c = this.g.player.c;
    return this.g.settings.coopName || this.g.accountName || c.classId[0].toUpperCase() + c.classId.slice(1);
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
          ? `<p>Your room code:</p><div class="code">${esc(co.room)}</div>
            <div class="btnrow"><button class="primary" data-act="coop-invite">Share invite link</button></div>
            <input type="text" class="invitelink" readonly value="${esc(this.inviteLink())}">
            <p class="hint">Send friends the link: they sign in, pick a hero and land in your world. Or they can open Mythbound, go to Menu → Co-op, type the code and press Join.</p>`
          : `<p>You are in <b>${esc(host?.name ?? 'the host')}</b>’s world (room <b>${esc(co.room)}</b>).</p>`}
        <ul class="who"><li>${co.isHost ? '♛ ' : ''}${esc(name)} <small>(you)</small></li>${party.map((m) => `<li>${m.host ? '♛ ' : ''}${esc(m.name)} <small>level ${m.level}${m.alive ? '' : ' · fallen'}</small></li>`).join('')}</ul>
        ${status}
        <div class="btnrow"><button data-act="coop-leave">Leave co-op</button></div>
        <p class="hint">${co.isHost
          ? 'Your world is shared: keep this tab open and in view, or it pauses for everyone. Resting at a shrine no longer brings monsters back while friends are here.'
          : 'Monsters, bosses and the time of day come from the host. Your hero, items and progress are yours and save on this device.'}</p>
        ${this.pvpSection()}
        ${this.teamCombos()}
      </div>`;
    }
    const pages = !/github\.io$|^localhost$|^127\.0\.0\.1$/.test(location.hostname);
    return `<div class="coop form">
      <p>Play together with up to 3 friends. One of you hosts, and everyone joins that world: its monsters, bosses and time of day are shared. Each of you keeps your own hero, items and progress.</p>
      <label>Your name <input type="text" maxlength="20" data-coop="name" value="${esc(name)}"></label>
      <div class="btnrow"><button data-act="coop-host"${co.busy ? ' disabled' : ''}>Host a game</button></div>
      <label>Join with a room code <span><input type="text" class="codein" maxlength="6" data-coop="code" placeholder="ABCDE" value="${esc(this.coopCode)}"> <button class="primary" data-act="coop-join"${co.busy ? ' disabled' : ''}>Join</button></span></label>
      ${status}
      ${pages ? `<p class="hint">Co-op needs the online version of the game: <a href="${PAGES_URL}" target="_blank" rel="noopener">${PAGES_URL}</a></p>` : ''}
      <p class="hint">The free server naps when nobody is playing, so the first connection can take up to a minute.</p>
      <details><summary class="hint">Server address</summary><label>Address <input type="text" data-coop="server" value="${esc(s.coopServer || DEFAULT_SERVER)}"></label></details>
      ${this.pvpSection()}
      ${this.teamCombos()}
    </div>`;
  }

  /** Duels, the Arena of Ares and war mode (in co-op), with this hero's rank and record. */
  private pvpSection(): string {
    const g = this.g;
    const st = g.pvp.status();
    const rec = st.record;
    const head = `<div class="pvpsec"><h3>⚔ Player against player</h3>
      <p class="prank"><b>${esc(st.rank.title)}</b> · ${rec.glory} glory${st.rank.next !== null ? ` <small>(${st.rank.next - rec.glory} more to the next rank)</small>` : ''}</p>
      <p class="hint">Duels won ${rec.duelsWon}, lost ${rec.duelsLost}${rec.duelsDrawn ? `, drawn ${rec.duelsDrawn}` : ''} · Arena wins ${rec.matchesWon} of ${rec.matchesPlayed} · Heroes felled ${rec.kills} · Falls ${rec.deaths}</p>`;
    if (!g.coop.active) return `${head}<p class="hint">Host or join a co-op game to duel your friends, fight in the Arena of Ares, or turn on war mode.</p></div>`;
    const now = st.duel
      ? `<p>In a duel with <b>${esc(st.duel)}</b>. The first to fall yields.</p>`
      : st.match?.inIt ? `<p>Fighting in the Arena of Ares.</p><div class="btnrow"><button data-act="pvp-leave">Leave the arena</button></div>` : '';
    const friends = st.friends.length
      ? `<ul class="who duels">${st.friends.map((f) => `<li><span>${esc(f.name)} <small>level ${f.level} · ${esc(f.title)}</small></span><button data-duel="${f.id}"${f.why ? ` disabled title="${esc(f.why)}"` : ''}>⚔ Duel</button>${f.why ? `<small class="why">${esc(f.why)}</small>` : ''}</li>`).join('')}</ul>`
      : '<p class="hint">No friends here yet.</p>';
    const opt = <T extends string | number>(v: T, label: string, cur: T) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
    const arena = g.coop.isHost
      ? `<div class="arena"><b>Arena of Ares</b> <small>(south-east of town; everyone who joins is carried there and back)</small>
          <label>Mode <select data-pvp="mode">${opt<MatchMode>('ffa', 'Everyone for themselves', this.pvpMode)}${opt<MatchMode>('teams', 'Two teams', this.pvpMode)}</select></label>
          <label>First to <select data-pvp="goal">${MATCH.goals.map((n) => opt(n, `${n} falls`, this.pvpGoal)).join('')}</select></label>
          <label>Time <select data-pvp="time">${MATCH.times.map((n) => opt(n, `${n / 60} minutes`, this.pvpTime)).join('')}</select></label>
          <div class="btnrow"><button class="primary" data-act="pvp-match"${st.match || st.inviting ? ' disabled' : ''}>Call everyone to the arena</button></div></div>`
      : '<p class="hint">The host can call everyone to the Arena of Ares for a match.</p>';
    return `${head}${now}<p class="hint">Challenge a friend here, or stand by them and press F (✋ on touch). Duels heal you both before and after, and nobody dies.</p>
      ${friends}${arena}
      <label class="war">War mode <input type="checkbox" data-pvp="war"${rec.war ? ' checked' : ''}></label>
      <p class="hint">With war mode on, heroes who turned it on too can attack you anywhere but in town and by the shrines. Falling to one costs no embers.</p></div>`;
  }

  /** The team combos two heroes' elements make together. */
  private teamCombos(): string {
    const cap = (x: string) => x[0].toUpperCase() + x.slice(1);
    return `<details class="tcombos"><summary class="hint">Team combos</summary>
      <p class="hint">Strike the same foe as a friend within 4 seconds, each with a different element (a spell, a rune, an elemental weapon or a power strike), and the two combine.</p>
      ${TEAM_COMBOS.map((k) => `<div class="row"><div><b>${esc(k.name)}</b> <small>${cap(k.elements[0])} + ${cap(k.elements[1])}</small><div class="desc">${esc(k.description)}</div></div></div>`).join('')}
    </details>`;
  }

  private controls(): string {
    const k = (...keys: string[]) => keys.map((x) => `<kbd>${x}</kbd>`).join('');
    return `<div class="cols keys"><div><h4>Keyboard &amp; mouse</h4><ul>
      <li>${k('W', 'A', 'S', 'D')} move · mouse: look (click to capture)</li>
      <li>${k('Shift')} tap: <b>shift lock</b> (face where the camera looks, over-the-shoulder view, crosshair) · hold: sprint</li>
      <li>${k('C')} roll / dodge · ${k('Space')} jump · ${k('Z')} sneak</li>
      <li>Left click: attack · hold with a bow to draw, release to shoot</li>
      <li>${k('E')} heavy attack (Swordsman: Spinner Flourish) · hold to charge a <b>power strike</b></li>
      <li>Right click: block / raise shield</li>
      <li>${k('Tab')} or middle click: lock on</li>
      <li>${k('Q')} cast (hold for alternate form) · ${k('1')}–${k('4')} / wheel: choose spell</li>
      <li>${k('R')} class ability (BloodRage, Power Shot, Tame, Combine, Volley)</li>
      <li>${k('G')} combine spells (Mage Lv 3+) · ${k('V')} fly (Draco Lv 6+) · ${k('B')} call or ride your horse (Shift gallops)</li>
      <li>${k('H')} drink flask · ${k('X')} eat (fish, crops) · ${k('Y')} satchel (fruit and sweets) · ${k('T')} switch weapon</li>
      <li>${k('F')} interact · ${k('M')} map · ${k('Esc')} / ${k('I')} menu</li>
      <li>${k('J')} fold or open the quest bar (click a quest there to track it)</li></ul></div>
      <div><h4>Touch</h4><ul>
      <li>Left side: virtual joystick (push past the ring to sprint; it glows)</li>
      <li>Right side: drag to look</li>
      <li>⚔ attack (hold with a bow) · 💥 heavy (hold to charge a power strike) · ⤿ roll · ⤒ jump</li>
      <li>🛡 block · ✦ cast (hold for alternate) · ❂ ability · ⚗ flask</li>
      <li>Tap a spell slot to choose it; tap ❂ there to use your ability</li>
      <li>Top row: 🔒 shift lock · ◎ lock on · ⇄ weapon · ▼ sneak · 🪽 fly · 🐎 horse (push the stick far to gallop) · ⊕ combine · 🐟 eat (fish, crops) · 🍎 satchel (fruit and sweets, when you carry some) · 🗺 map · ☰ menu</li>
      <li>✋ appears when you can interact</li>
      <li>Quest bar (top left): tap its header to fold it, tap a quest to track it</li></ul></div></div>`;
  }

  private bind() {
    const g = this.g;
    const c = g.player.c;
    this.el.querySelectorAll<HTMLButtonElement>('[data-eat]').forEach((b) =>
      b.addEventListener('click', () => {
        g.player.eatItem(g, b.dataset.eat!);
        this.render();
      }),
    );
    this.el.querySelectorAll<HTMLButtonElement>('[data-equip]').forEach((b) =>
      b.addEventListener('click', () => {
        c.mainHand = Number(b.dataset.equip);
        g.player.equip();
        this.render();
      }),
    );
    this.el.querySelectorAll<HTMLButtonElement>('[data-tree]').forEach((b) =>
      b.addEventListener('click', () => {
        this.treeTab = Number(b.dataset.tree);
        this.pickNode = null;
        this.render();
      }),
    );
    this.el.querySelectorAll<HTMLButtonElement>('[data-node]').forEach((b) =>
      b.addEventListener('click', () => {
        this.pickNode = b.dataset.node!;
        this.render();
      }),
    );
    this.el.querySelector<HTMLButtonElement>('[data-learn]')?.addEventListener('click', (e) => {
      if (!learnSkill(c, (e.currentTarget as HTMLElement).dataset.learn!)) return;
      g.audio.play('pickup');
      this.render();
    });
    this.el.querySelector('[data-act="wardrobe"]')?.addEventListener('click', () => g.openWardrobe());
    this.el.querySelector('[data-act="respec"]')?.addEventListener('click', () => {
      if (!this.respecArmed) {
        this.respecArmed = true;
        setTimeout(() => {
          if (!this.respecArmed) return;
          this.respecArmed = false;
          if (this.isOpen && this.tab === 'skills') this.render();
        }, 3000);
        return this.render();
      }
      this.respecArmed = false;
      if (respec(c)) {
        // Max health or mana lost with Iron Hide, Deep Well and the like can't be left over.
        g.player.hp = Math.min(g.player.hp, g.player.maxHp);
        g.player.mana = Math.min(g.player.mana, g.player.maxMana);
        g.hud.toast(`Skills reset: ${c.skillPoints} points to spend.`, 'skill');
        g.audio.play('holy');
      }
      this.render();
    });
    this.el.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((b) =>
      b.addEventListener('click', () => {
        g.state.tracked = b.dataset.track as QuestId;
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
    // Player against player.
    this.el.querySelectorAll<HTMLButtonElement>('[data-duel]').forEach((b) => b.addEventListener('click', () => {
      g.pvp.challenge(Number(b.dataset.duel));
      this.close();
    }));
    this.el.querySelector<HTMLSelectElement>('[data-pvp="mode"]')?.addEventListener('change', (e) => (this.pvpMode = (e.target as HTMLSelectElement).value === 'teams' ? 'teams' : 'ffa'));
    this.el.querySelector<HTMLSelectElement>('[data-pvp="goal"]')?.addEventListener('change', (e) => (this.pvpGoal = Number((e.target as HTMLSelectElement).value)));
    this.el.querySelector<HTMLSelectElement>('[data-pvp="time"]')?.addEventListener('change', (e) => (this.pvpTime = Number((e.target as HTMLSelectElement).value)));
    this.el.querySelector('[data-act="pvp-match"]')?.addEventListener('click', () => {
      g.pvp.startMatch(this.pvpMode, this.pvpGoal, this.pvpTime);
      this.render();
    });
    this.el.querySelector('[data-act="pvp-leave"]')?.addEventListener('click', () => {
      g.pvp.leaveMatch();
      this.render();
    });
    this.el.querySelector<HTMLInputElement>('[data-pvp="war"]')?.addEventListener('change', (e) => {
      g.pvp.setWar((e.target as HTMLInputElement).checked);
      this.render();
    });
    const link = this.el.querySelector<HTMLInputElement>('.invitelink');
    link?.addEventListener('focus', () => link.select());
    this.el.querySelector('[data-act="coop-invite"]')?.addEventListener('click', async () => {
      const url = this.inviteLink();
      // Phones get the share sheet (Messages, Discord…); elsewhere the link goes on the clipboard.
      if (navigator.share && g.input.touch) {
        try {
          await navigator.share({ title: 'Mythbound', text: `Join my Mythbound world (room ${g.coop.room})`, url });
          return;
        } catch (err) {
          if ((err as Error).name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        g.hud.toast('Invite link copied. Paste it to your friends.', 'skill');
      } catch {
        link?.focus();
        g.hud.toast('Copy the link under the button and send it to your friends.');
      }
    });
    this.el.querySelector('[data-act="reload"]')?.addEventListener('click', () => {
      g.save();
      location.reload();
    });
    this.el.querySelector('[data-act="quit"]')?.addEventListener('click', () => {
      g.save();
      g.onQuit();
    });
    this.journal.bind(this.el);
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
