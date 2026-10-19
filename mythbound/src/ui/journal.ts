// The journal's two big pages: the Area Map (a parchment map with a filter
// legend and a card for whatever is picked on it) and Quest Select (a quest
// book: grouped entries on the left, the picked one's details, objective,
// rewards and difficulty on the right). Menu (menu.ts) hosts them.

import { PERKS, WEAPONS } from '../data/defs';
import { ARENA, BOSSES, ECLIPSE_TRIAL, ELDER_TRIALS, EYES_RUINS, ITEMS, LAIRS, NPCS, QUESTS, SHRINES, TOWN, WEAPON_TRIALS, ZONES, type BossId, type QuestId, type ZoneId } from '../data/world';
import { rewardName } from '../engine/bosses';
import { questLines, trackedId, type QuestLine } from '../engine/questlog';
import { zoneAt } from '../engine/terrain';
import { BOSS_TIERS, tierLevel, tierOpen, tierReward } from '../rules/boss';
import type { Game } from '../engine/game';
import { mapImage, paintMap, toMap } from './mapimage';

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** Where the map names the outer lands. */
const REGION_LABELS: [number, number, ZoneId][] = [
  [-300, -720, 'peaks'], [640, -680, 'cinder'], [700, -200, 'dunes'], [-700, -150, 'elderwood'], [-620, 680, 'jungle'], [300, 760, 'ocean'],
];

// ------------------------------------------------------------------ map --

type Layer = 'quest' | 'shrine' | 'trial' | 'boss' | 'town' | 'party';

/** The filter legend: each layer's icon (drawn the same on the map) and name. */
const LAYERS: { id: Layer; icon: string; name: string; color: string }[] = [
  { id: 'quest', icon: '!', name: 'Quest target', color: '#ffd060' },
  { id: 'shrine', icon: '✦', name: 'Shrine (travel)', color: '#ffe8a0' },
  { id: 'trial', icon: '⚔', name: 'Trial', color: '#ff7058' },
  { id: 'boss', icon: '☠', name: 'Great foe', color: '#c890ff' },
  { id: 'town', icon: '♜', name: 'Town & sights', color: '#e0d0a8' },
  { id: 'party', icon: '●', name: 'Friends', color: '#6fd6ff' },
];

interface Marker {
  id: string;
  layer: Layer;
  x: number;
  z: number;
  label: string;
  /** Greyed out (a conquered trial, a slain foe). */
  done?: boolean;
}

// --------------------------------------------------------------- quests --

type Group = 'quests' | 'trials' | 'elders' | 'hunts' | 'done';

const GROUPS: [Group, string, string][] = [
  ['quests', 'Quests', 'Errands for the people of Hearthhold'],
  ['trials', 'The Six Trials', 'The weapons of the old gods'],
  ['elders', 'The Elder Foes', 'Relics in the deep places'],
  ['hunts', 'Monster Hunts', 'Bounties no one will touch'],
  ['done', 'Completed', 'Done and dusted'],
];

interface Entry {
  key: string;
  group: Group;
  name: string;
  where: string;
  /** Metres away (null: nowhere in particular). */
  dist: number | null;
  done: boolean;
  quest?: QuestId;
  boss?: BossId;
}

export class Journal {
  /** Layers switched off in the map's legend. */
  private hidden = new Set<Layer>();
  /** The marker picked on the map, and the entry picked in the quest book. */
  private mapPick: string | null = null;
  private questPick: string | null = null;
  /** Quest book groups folded shut. */
  private folded = new Set<Group>(['done']);

  constructor(private g: Game, private rerender: () => void, private travel: (shrineId: string) => void) {}

  // ------------------------------------------------------------ area map --

  private markers(): Marker[] {
    const g = this.g;
    const s = g.state;
    const out: Marker[] = [];
    const p = g.player.pos;
    for (const sh of SHRINES) if (s.shrinesFound.includes(sh.id)) out.push({ id: `s:${sh.id}`, layer: 'shrine', x: sh.x, z: sh.z, label: sh.name });
    for (const t of WEAPON_TRIALS) out.push({ id: `t:${t.id}`, layer: 'trial', x: t.x, z: t.z, label: t.name.replace('Trial of ', '').replace('the ', ''), done: s.trialsDone.includes(t.id) });
    if (s.quests.elders.state !== 'none') for (const t of ELDER_TRIALS) out.push({ id: `t:${t.id}`, layer: 'boss', x: t.x, z: t.z, label: BOSSES[t.boss].name, done: s.trialsDone.includes(t.id) });
    out.push({ id: `t:${ECLIPSE_TRIAL.id}`, layer: 'trial', x: ECLIPSE_TRIAL.x, z: ECLIPSE_TRIAL.z, label: 'Eclipse', done: s.trialsDone.includes(ECLIPSE_TRIAL.id) });
    if (s.quests.hunts.state !== 'none') for (const l of LAIRS) out.push({ id: `l:${l.id}`, layer: 'boss', x: l.x, z: l.z, label: BOSSES[l.boss].name, done: !!s.flags[`hunted-${l.boss}`] });
    out.push({ id: 'town', layer: 'town', x: TOWN.x, z: TOWN.z, label: 'Hearthhold' });
    out.push({ id: 'arena', layer: 'town', x: ARENA.x, z: ARENA.z, label: 'Arena of Ares' });
    if (s.flags.eyesRevealed) out.push({ id: 'eyes', layer: 'town', x: EYES_RUINS.x, z: EYES_RUINS.z, label: '◉ ◉ ◉' });
    if (s.lostEmbers) out.push({ id: 'embers', layer: 'town', x: s.lostEmbers.x, z: s.lostEmbers.z, label: 'Lost embers' });
    for (const r of g.coop.remotes.values()) if (r.ready) out.push({ id: `p:${r.id}`, layer: 'party', x: r.pos.x, z: r.pos.z, label: r.name, done: !r.alive });
    // Quest targets, unless one already sits on a mark of its own (a trial, a lair).
    const marks = out.length;
    for (const l of questLines(s, p.x, p.z)) {
      if (!l.target || out.slice(0, marks).some((m) => Math.hypot(m.x - l.target!.x, m.z - l.target!.z) < 12)) continue;
      out.push({ id: `q:${l.id}`, layer: 'quest', x: l.target.x, z: l.target.z, label: l.label });
    }
    return out;
  }

  mapPage(): string {
    const counts = new Map<Layer, number>();
    for (const m of this.markers()) counts.set(m.layer, (counts.get(m.layer) ?? 0) + 1);
    const legend = LAYERS.map((l) => `<button class="lyr${this.hidden.has(l.id) ? ' off' : ''}" data-layer="${l.id}"><span class="lic" style="color:${l.color}">${l.icon}</span>${esc(l.name)}<i>${counts.get(l.id) ?? 0}</i><span class="eye">${this.hidden.has(l.id) ? '◌' : '◉'}</span></button>`).join('');
    const card = this.mapPick ? this.mapCard(this.mapPick) : '';
    return `<div class="atlas${card ? ' picked' : ''}">
      <div class="afilter"><h4>Filter</h4>${legend}<p class="hint">${this.g.input.touch ? 'Tap' : 'Click'} a mark on the map to see what it is. Shrines let you travel.</p></div>
      <div class="amap"><canvas class="bigmap" width="720" height="720"></canvas></div>
      ${card ? `<div class="acard">${card}</div>` : ''}
    </div>`;
  }

  /** The card for a picked mark: what it is, and what can be done about it. */
  private mapCard(id: string): string {
    const g = this.g;
    const s = g.state;
    const p = g.player.pos;
    const away = (x: number, z: number) => `${Math.round(Math.hypot(x - p.x, z - p.z) / 10) * 10} m away`;
    const close = '<button class="aclose" data-mapclose="1">✕</button>';
    const [kind, key] = id.includes(':') ? [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)] : [id, ''];
    if (kind === 's') {
      const sh = SHRINES.find((x) => x.id === key);
      if (!sh) return '';
      return `${close}<h3 class="ct">${esc(sh.name)}</h3><p class="csub">Shrine · ${esc(ZONES[zoneOf(sh.x, sh.z)].name)}</p>
        <p class="cdesc">Rest restores you; a discovered shrine lets you travel back to it from anywhere (not while monsters hunt you).</p>
        <div class="cfoot"><span>${away(sh.x, sh.z)}</span><button data-travel="${sh.id}">Travel here</button></div>`;
    }
    if (kind === 'q') {
      const l = questLines(s, p.x, p.z).find((x) => x.id === key);
      if (!l) return '';
      const tracked = trackedId(s, questLines(s, p.x, p.z)) === l.id;
      return `${close}<h3 class="ct">${esc(QUESTS[l.id].name)}</h3><p class="csub">Quest · ${l.progress}/${l.goal}</p>
        <p class="cdesc">${esc(QUESTS[l.id].description)}</p>
        <h4 class="ch">Current objective</h4><p class="cobj"><span class="ji">!</span>${esc(l.objective)}${l.target ? ` <small>(${esc(l.target.name)})</small>` : ''}</p>
        ${this.questRewards(l.id)}
        <div class="cfoot">${l.target ? `<span>${away(l.target.x, l.target.z)}</span>` : '<span></span>'}${tracked ? '<span class="tag">Tracked</span>' : `<button data-track="${l.id}">Track</button>`}</div>`;
    }
    if (kind === 't' || kind === 'l') {
      const t = kind === 't' ? [...WEAPON_TRIALS, ...ELDER_TRIALS, ECLIPSE_TRIAL].find((x) => x.id === key) : null;
      const lair = kind === 'l' ? LAIRS.find((x) => x.id === key) : null;
      const boss = t ? t.boss : lair?.boss;
      if (!boss) return '';
      const x = t?.x ?? lair!.x, z = t?.z ?? lair!.z;
      return `${close}${this.bossDetail(boss, t?.name ?? lair!.name, t?.intro ?? lair!.hint, t ? t.level : BOSSES[boss].level)}
        <div class="cfoot"><span>${away(x, z)}</span></div>`;
    }
    if (kind === 'p') {
      const r = g.coop.remotes.get(Number(key));
      if (!r) return '';
      return `${close}<h3 class="ct">${esc(r.name)}</h3><p class="csub">Friend</p><div class="cfoot"><span>${away(r.pos.x, r.pos.z)}</span></div>`;
    }
    const sights: Record<string, [string, string, string, number, number]> = {
      town: ['Hearthhold', 'Town', 'Shops, Brann’s forge, Wren’s field and people who need help. Quests begin here.', TOWN.x, TOWN.z],
      arena: ['Arena of Ares', 'Arena', 'Duels and arena matches with friends (Co-op tab).', ARENA.x, ARENA.z],
      eyes: ['The Watching Ruins', 'Ruins', 'Three eyes, open in the stone.', EYES_RUINS.x, EYES_RUINS.z],
      embers: ['Lost embers', 'Where you fell', 'Your embers wait where you last died. Go and take them back.', s.lostEmbers?.x ?? 0, s.lostEmbers?.z ?? 0],
    };
    const v = sights[kind];
    if (!v) return '';
    return `${close}<h3 class="ct">${esc(v[0])}</h3><p class="csub">${esc(v[1])}</p><p class="cdesc">${esc(v[2])}</p><div class="cfoot"><span>${away(v[3], v[4])}</span></div>`;
  }

  drawMap(canvas: HTMLCanvasElement) {
    const g = this.g;
    const ctx = canvas.getContext('2d')!;
    const S = canvas.width;
    ctx.imageSmoothingEnabled = true;
    // Opening the map paints in a good deal more of it at once.
    paintMap(80, g.player.pos.x, g.player.pos.z);
    ctx.drawImage(mapImage(), 0, 0, S, S);
    // Old parchment: a warm wash, darker toward the edges.
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#c8a878';
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = 'source-over';
    const vig = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
    vig.addColorStop(0, 'rgba(40,26,10,0)');
    vig.addColorStop(1, 'rgba(26,16,6,0.6)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, S, S);
    this.compass(ctx, S - 62, 62, 40);
    // The outer lands' names, faint, over their regions.
    ctx.font = 'italic 15px Cinzel, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(250,236,200,0.6)';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 3;
    for (const [x, z, id] of REGION_LABELS) {
      const [rx, ry] = toMap(x, z, S);
      ctx.fillText(ZONES[id].name, rx, ry);
    }
    for (const m of this.markers()) {
      if (this.hidden.has(m.layer)) continue;
      const [mx, my] = toMap(m.x, m.z, S);
      const lyr = LAYERS.find((l) => l.id === m.layer)!;
      const picked = this.mapPick === m.id;
      // A dark diamond (a disc for friends) with the layer's icon, and its name beside it.
      ctx.save();
      ctx.translate(mx, my);
      ctx.fillStyle = 'rgba(16,11,6,0.88)';
      ctx.strokeStyle = picked ? '#fff2c0' : m.done ? '#7a7060' : lyr.color;
      ctx.lineWidth = picked ? 2.4 : 1.5;
      ctx.beginPath();
      const r = picked ? 12 : 9.5;
      if (m.layer === 'party') ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
      else (ctx.moveTo(0, -r), ctx.lineTo(r, 0), ctx.lineTo(0, r), ctx.lineTo(-r, 0), ctx.closePath());
      ctx.fill();
      ctx.stroke();
      if (picked) {
        ctx.strokeStyle = 'rgba(255,230,160,0.5)';
        ctx.beginPath();
        ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = m.done ? '#8a8070' : lyr.color;
      ctx.font = `bold ${m.layer === 'quest' ? 14 : 11}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(lyr.icon, 0, 1);
      ctx.restore();
      if (m.layer !== 'shrine' || picked) {
        ctx.font = '12px Cinzel, serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = m.done ? 'rgba(200,190,170,0.6)' : '#f4e6c4';
        ctx.shadowBlur = 3;
        ctx.fillText(m.label, mx + 13, my + 4);
      }
    }
    ctx.shadowBlur = 0;
    // The hero: an arrow pointing the way they face.
    const p = g.player;
    const [px, py] = toMap(p.pos.x, p.pos.z, S);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI - p.yaw);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#1a1208';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * S;
      const my = ((e.clientY - rect.top) / rect.height) * S;
      // The nearest visible mark within a finger's width on screen.
      let best: string | null = null;
      let bestD = (24 * S) / rect.width;
      for (const m of this.markers()) {
        if (this.hidden.has(m.layer)) continue;
        const [sx, sy] = toMap(m.x, m.z, S);
        const d = Math.hypot(sx - mx, sy - my);
        if (d < bestD) (best = m.id), (bestD = d);
      }
      this.mapPick = best;
      this.rerender();
    });
  }

  /** A compass rose in the map's corner. */
  private compass(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(60,40,16,0.85)';
    ctx.fillStyle = 'rgba(232,206,150,0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const long = i % 2 === 0;
      const a = (i * Math.PI) / 4;
      const len = long ? r : r * 0.55;
      ctx.beginPath();
      ctx.moveTo(Math.sin(a) * len, -Math.cos(a) * len);
      ctx.lineTo(Math.sin(a + 0.32) * r * 0.16, -Math.cos(a + 0.32) * r * 0.16);
      ctx.lineTo(Math.sin(a - 0.32) * r * 0.16, -Math.cos(a - 0.32) * r * 0.16);
      ctx.closePath();
      ctx.fillStyle = i === 0 ? 'rgba(170,40,24,0.95)' : long ? 'rgba(232,206,150,0.95)' : 'rgba(200,170,110,0.8)';
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#f6e6c0';
    ctx.font = 'bold 13px Cinzel, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;
    ctx.fillText('N', 0, -r - 10);
    ctx.restore();
  }

  // ---------------------------------------------------------- quest book --

  private entries(): Entry[] {
    const g = this.g;
    const s = g.state;
    const p = g.player.pos;
    const lines = questLines(s, p.x, p.z);
    const dist = (x: number, z: number) => Math.hypot(x - p.x, z - p.z);
    const out: Entry[] = [];
    for (const id of Object.keys(QUESTS) as QuestId[]) {
      const st = s.quests[id].state;
      if (st === 'none') continue;
      const l = lines.find((x) => x.id === id);
      out.push({
        key: `q:${id}`, group: st === 'done' ? 'done' : 'quests', name: QUESTS[id].name, quest: id, done: st === 'done',
        where: l?.target?.name ?? (st === 'done' ? 'Complete' : 'Anywhere'), dist: l?.target ? dist(l.target.x, l.target.z) : null,
      });
    }
    for (const t of WEAPON_TRIALS) out.push({ key: `t:${t.id}`, group: 'trials', name: t.name, boss: t.boss, done: s.trialsDone.includes(t.id), where: ZONES[zoneOf(t.x, t.z)].name, dist: dist(t.x, t.z) });
    if (s.quests.elders.state !== 'none') for (const t of ELDER_TRIALS) out.push({ key: `t:${t.id}`, group: 'elders', name: BOSSES[t.boss].name, boss: t.boss, done: s.trialsDone.includes(t.id), where: t.name, dist: dist(t.x, t.z) });
    if (s.quests.hunts.state !== 'none') for (const l of LAIRS) out.push({ key: `l:${l.id}`, group: 'hunts', name: BOSSES[l.boss].name, boss: l.boss, done: !!s.flags[`hunted-${l.boss}`], where: l.name, dist: dist(l.x, l.z) });
    return out;
  }

  questPage(): string {
    const g = this.g;
    const s = g.state;
    const p = g.player.pos;
    const list = this.entries();
    const tracked = trackedId(s, questLines(s, p.x, p.z));
    if (!this.questPick || !list.some((e) => e.key === this.questPick)) this.questPick = tracked ? `q:${tracked}` : (list.find((e) => !e.done)?.key ?? list[0]?.key ?? null);
    const groups = GROUPS.map(([id, name, blurb]) => {
      const items = list.filter((e) => e.group === id);
      if (!items.length) return '';
      const open = !this.folded.has(id);
      const rows = open
        ? items.map((e) => {
          const best = e.boss ? g.bossBest(e.boss) : -1;
          const badge = e.boss && best >= 0 ? `<em class="jtier" style="color:${BOSS_TIERS[best].color}">${BOSS_TIERS[best].name} ✓</em>` : e.quest === tracked ? '<em class="jtier">Tracked</em>' : '';
          return `<button class="jrow${e.key === this.questPick ? ' on' : ''}${e.done && !e.boss ? ' done' : ''}" data-qpick="${e.key}">
            <span class="jn">${esc(e.name)}${badge}</span><span class="jw">⌖ ${esc(e.where)}</span>${e.dist !== null ? `<span class="jd">${e.dist >= 1000 ? (e.dist / 1000).toFixed(1) + ' km' : Math.round(e.dist) + ' m'}</span>` : ''}</button>`;
        }).join('')
        : '';
      return `<div class="jgroup${open ? ' open' : ''}"><button class="jhead" data-qfold="${id}"><span class="chev">${open ? '▾' : '▸'}</span><b>${esc(name)}</b><small>${esc(blurb)} · ${items.filter((e) => e.done).length}/${items.length}</small></button>${rows}</div>`;
    }).join('');
    const pick = list.find((e) => e.key === this.questPick);
    return `<div class="qbook"><div class="qlist">${groups || '<p class="hint">Talk to the people of Hearthhold.</p>'}</div>
      <div class="qdetail">${pick ? this.entryDetail(pick, tracked) : '<p class="hint">Pick a quest.</p>'}</div></div>`;
  }

  private entryDetail(e: Entry, tracked: QuestId | null): string {
    const g = this.g;
    if (e.quest) {
      const q = QUESTS[e.quest];
      const st = g.state.quests[e.quest];
      const p = g.player.pos;
      const l: QuestLine | undefined = questLines(g.state, p.x, p.z).find((x) => x.id === e.quest);
      const giver = NPCS.find((n) => n.id === q.giver);
      return `<div class="jtitle"><span class="jicon">!</span><div><h2>${esc(q.name)}</h2><p class="csub">${giver ? `From ${esc(giver.name)}, ${esc(giver.title)}` : 'Quest'} · ${st.state === 'done' ? 'Complete' : `${Math.min(st.progress, q.goal)} / ${q.goal}`}</p></div></div>
        <p class="cdesc">${esc(q.description)}</p>
        ${l ? `<h4 class="ch">Current objective</h4><p class="cobj"><span class="ji">!</span>${esc(l.objective)}${l.target ? ` <small>(${esc(l.target.name)})</small>` : ''}</p>` : ''}
        ${this.questRewards(e.quest)}
        <div class="cfoot"><span></span>${l ? (tracked === e.quest ? '<span class="tag">Tracked</span>' : `<button data-track="${e.quest}">Track</button>`) : ''}</div>`;
    }
    if (!e.boss) return '';
    const key = e.key.slice(2);
    const t = [...WEAPON_TRIALS, ...ELDER_TRIALS].find((x) => x.id === key);
    const lair = LAIRS.find((x) => x.id === key);
    return this.bossDetail(e.boss, t?.name ?? lair?.name ?? '', t?.intro ?? lair?.hint ?? '', t ? t.level : BOSSES[e.boss].level);
  }

  /** A quest's rewards. */
  private questRewards(id: QuestId): string {
    const r = QUESTS[id].reward;
    const bits = [
      r.xp ? `<span class="rw"><b class="rxp">✦</b> ${r.xp} XP</span>` : '',
      r.gold ? `<span class="rw"><b class="rgold">●</b> ${r.gold} embers</span>` : '',
      r.item ? `<span class="rw"><b class="ritem">◆</b> ${esc(ITEMS[r.item]?.name ?? r.item)}</span>` : '',
      r.flask ? '<span class="rw"><b class="ritem">⚱</b> One more flask</span>' : '',
    ].filter(Boolean);
    return bits.length ? `<h4 class="ch">Rewards</h4><div class="rws">${bits.join('')}</div>` : '';
  }

  /** A great foe: the level its tier calls for, what it guards, the rewards, and the difficulty to fight it on. */
  private bossDetail(id: BossId, place: string, text: string, baseLevel: number): string {
    const g = this.g;
    const b = BOSSES[id];
    const best = g.bossBest(id);
    const tier = g.bossTier(id);
    const T = BOSS_TIERS[tier];
    const open = tierOpen(best);
    const r = tierReward(tier, tier > best, b);
    const beaten = best >= 0;
    const objective = !beaten
      ? b.mini ? `Hunt ${b.name} in ${place}` : `Defeat ${b.name} at the ${place} altar`
      : tier > best ? `Beat ${b.name} on ${T.name} to open the next difficulty` : `Fight ${b.name} again on ${T.name} (or harder)`;
    const chips = BOSS_TIERS.map((x) => {
      const locked = x.id > open;
      return `<button class="dchip${x.id === tier ? ' on' : ''}${locked ? ' locked' : ''}" style="--tc:${x.color}" ${locked ? 'disabled' : `data-tier="${id}:${x.id}"`}>${locked ? '🔒 ' : best >= x.id ? '✓ ' : ''}${x.name}<small>Lv ${tierLevel(baseLevel, x.id)}</small></button>`;
    }).join('');
    const reward = [
      `<span class="rw"><b class="rxp">✦</b> ${r.xp} XP</span>`,
      `<span class="rw"><b class="rgold">●</b> ${r.gold} embers</span>`,
      r.shards ? `<span class="rw"><b class="rshard">◆</b> ${r.shards} Legend Shards${tier > best ? ' (first time ×2)' : ''}</span>` : '',
      !beaten ? `<span class="rw"><b class="ritem">⚔</b> ${esc(rewardName(b.reward, WEAPONS))}</span>` : '',
    ].filter(Boolean).join('');
    const perkHint = r.shards ? '<p class="hint">Legend Shards set legend perks into legendary weapons at an anvil (like ' + Object.values(PERKS).slice(0, 3).map((p) => p.name).join(', ') + '…).</p>' : '';
    return `<div class="jtitle"><span class="jicon boss">☠</span><div><h2>${esc(b.name)}, ${esc(b.title)}</h2><p class="csub">Recommended level <b style="color:${T.color}">${tierLevel(baseLevel, tier)}</b> · ${esc(place)}</p></div></div>
      <p class="cdesc">${esc(text)}</p>
      <h4 class="ch">Current objective</h4><p class="cobj"><span class="ji">${beaten ? '⚔' : '!'}</span>${esc(objective)}</p>
      <h4 class="ch">Difficulty</h4>
      ${beaten ? `<div class="dchips">${chips}</div><p class="hint">${T.id ? `${T.name}: ×${T.hp} health, ×${T.damage} damage. ` : ''}Applies the next time you fight it${b.mini ? ' (when it next appears in its lair)' : ' (at its altar)'}.</p>` : '<p class="hint">Beat it once to open Heroic, Mythic and Godslayer.</p>'}
      <h4 class="ch">Rewards</h4><div class="rws">${reward}</div>${perkHint}`;
  }

  // ------------------------------------------------------------ bindings --

  bind(root: HTMLElement) {
    const g = this.g;
    root.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach((b) => b.addEventListener('click', () => {
      const l = b.dataset.layer as Layer;
      if (this.hidden.has(l)) this.hidden.delete(l);
      else this.hidden.add(l);
      this.rerender();
    }));
    root.querySelector('[data-mapclose]')?.addEventListener('click', () => {
      this.mapPick = null;
      this.rerender();
    });
    root.querySelectorAll<HTMLButtonElement>('[data-travel]').forEach((b) => b.addEventListener('click', () => this.travel(b.dataset.travel!)));
    root.querySelectorAll<HTMLButtonElement>('[data-qpick]').forEach((b) => b.addEventListener('click', () => {
      this.questPick = b.dataset.qpick!;
      this.rerender();
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-qfold]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.qfold as Group;
      if (this.folded.has(id)) this.folded.delete(id);
      else this.folded.add(id);
      this.rerender();
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-tier]').forEach((b) => b.addEventListener('click', () => {
      const [id, tier] = b.dataset.tier!.split(':');
      g.pickTier(id as BossId, Number(tier));
      g.audio.play('pickup');
      this.rerender();
    }));
    const map = root.querySelector<HTMLCanvasElement>('.bigmap');
    if (map) this.drawMap(map);
  }
}

/** The region a spot lies in. */
const zoneOf = (x: number, z: number): ZoneId => zoneAt(x, z);
