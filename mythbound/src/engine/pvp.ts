// Player against player, over co-op. Three ways to fight: a duel (one
// challenges, the other accepts, a ring of fog rises between them), an arena
// match the host starts (everyone who joins is carried to the Arena of Ares:
// a free-for-all or two teams, first to the goal), and war mode (heroes who
// both turned it on may fight anywhere but in town and by the shrines).
//
// How blows land: a hero who is hostile to us gets a stand-in among our
// monsters (a Rival, with no body of its own; the friend's hero is drawn as
// ever). Every sword, arrow, spell, burst and pet that can hurt a monster can
// hurt the stand-in, and what it would take is sent to that player's game,
// which applies it to their hero with their own guard, rolls and armour. So
// each game decides what happens to its own hero, as in co-op against monsters.

import * as THREE from 'three';
import { ARENA, ENEMIES, SHRINES, TOWN, type Affinity, type EnemyDef, type EnemyId } from '../data/world';
import type { DamageElement } from '../data/defs';
import {
  DUEL, MATCH, PVP, TEAM_COLORS, TEAM_NAMES, duelGlory, foes, holdFor, matchGlory, matchResult, newHolds, newMatch, peaceful, pvpDamage, rankOf,
  recordFall, standings, teamScore, warGlory, won, type Match, type MatchMode, type MatchResult,
} from '../rules/pvp';
import { Boss, Enemy, STATUS_KEYS, newStatus } from './entities';
import { glowSprite, mat, disposeObject } from './models';
import { heightAt } from './terrain';
import { PvpHud, type ScoreRow } from '../ui/pvphud';
import type { Game } from './game';
import type { Msg, RemoteHero } from './coop';

const ELEMENTS = new Set<DamageElement>(['fire', 'water', 'wind', 'earth', 'physical', 'lightning', 'dark', 'light', 'true']);
const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const str = (x: unknown) => (typeof x === 'string' ? x : '');
const r1 = (n: number) => Math.round(n * 10) / 10;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

const RIVAL_DEF: EnemyDef = { ...ENEMIES.bandit, id: 'rival' as EnemyId, name: 'Rival', xp: 0, gold: 0, drop: undefined, tame: undefined, ranged: undefined };
const RIVAL_BODY = () => ({ root: new THREE.Group(), height: 1.8, animate() {} });

/** A hostile hero, standing among our monsters so our blows can find them. */
export class Rival extends Enemy {
  /** Effects after the last frame, to notice the ones our hero adds. */
  prev = newStatus();

  constructor(public hero: RemoteHero, private pvp: Pvp) {
    super('bandit', hero.pos.x, hero.pos.z, RIVAL_BODY());
    this.def = RIVAL_DEF;
    this.pvpId = hero.id;
    this.aware = true;
    this.awareness = 1;
    this.radius = 0.5;
    this.sync();
  }
  get name() {
    return this.hero.name;
  }
  get level() {
    return this.hero.level;
  }
  get dark() {
    return false;
  }
  get affinity(): Affinity {
    return 'none';
  }
  get bleeds() {
    return true;
  }
  sync() {
    this.pos.copy(this.hero.pos);
    this.yaw = this.hero.yaw;
    this.alive = this.hero.alive;
    this.maxHp = Math.max(1, this.hero.maxHp);
    this.hp = Math.max(0.01, Math.min(this.maxHp, this.hero.hp));
    this.model.root.position.copy(this.pos);
  }
  update(dt: number) {
    this.sync();
    this.hitFlash = Math.max(0, this.hitFlash - dt);
  }
  /** Knocked about here: the hero's own game moves them. */
  shove(dx: number, dz: number, force: number, up = 0) {
    this.pvp.knock(this, dx, dz, force, up);
  }
  becomeAware() {}
}

interface DuelRun {
  foe: number;
  center: THREE.Vector3;
  phase: 'countdown' | 'fight';
  t: number;
  ring: THREE.Object3D;
  /** The one who challenged calls a duel that runs out of time a draw. */
  challenger: boolean;
}

/** A duel between two other heroes (we keep out of their ring). */
interface OtherDuel {
  a: number;
  b: number;
  center: THREE.Vector3;
  ring: THREE.Object3D;
}

interface MatchRun {
  m: Match;
  phase: 'countdown' | 'fight' | 'over';
  t: number;
  ring: THREE.Object3D;
  /** This hero fights in it (others only see the ring). */
  inIt: boolean;
  /** Where this hero stood before the arena, to go back to. */
  home: THREE.Vector3 | null;
  result: MatchResult | null;
  /** Game clock when this fallen hero rises again (0: standing). */
  riseAt: number;
}

/** The host's invitation, while friends answer it. */
interface Invitation {
  mode: MatchMode;
  goal: number;
  time: number;
  until: number;
  yes: Set<number>;
  no: Set<number>;
}

/** Hurts and holds other heroes left on ours (each game times its own). */
interface Ailments {
  burn: number;
  poison: number;
  bleed: number;
  hex: number;
  wet: number;
  marked: number;
}

export class Pvp {
  hud: PvpHud;
  duel: DuelRun | null = null;
  match: MatchRun | null = null;
  /** Stand-ins for hostile heroes, by player id. */
  rivals = new Map<number, Rival>();
  /** A challenge or invitation waiting for this hero's answer. */
  private incoming: { from: number; until: number } | null = null;
  private matchInvite: { from: number; mode: MatchMode; goal: number; time: number; until: number } | null = null;
  /** Our challenge, waiting for theirs. */
  private outgoing: { to: number; until: number } | null = null;
  private invite: Invitation | null = null;
  /** We said yes to the host's call to the arena and wait for the match to begin. */
  private joining = false;
  private joinedAt = 0;
  /** After a duel: a rematch is a button press away for a little while. */
  private rematch: { foe: number; until: number } | null = null;
  private others: OtherDuel[] = [];
  private holds = newHolds();
  private ail: Ailments = { burn: 0, poison: 0, bleed: 0, hex: 0, wet: 0, marked: 0 };
  /** The last hero to strike ours, and when (for credit when ours falls). */
  private lastHit: { by: number; at: number } | null = null;
  /** Ticking hurts dealt to rivals, sent a few times a second rather than every frame. */
  private dots = new Map<number, Map<DamageElement, number>>();
  private dotSend = 0;
  /** Wins (duels) and kills (war mode) against each hero this sitting, so glory can't be farmed. */
  private beaten = new Map<number, number>();
  private warKills = new Map<number, number>();
  private fxTick = 0;
  private countShown = -1;
  /** Host: the next sweep of monsters out of the rings. */
  private sweep = 0;

  constructor(private g: Game) {
    this.hud = new PvpHud(g.hud.root);
    this.raiseArena();
  }

  /** The Arena of Ares stands always: a ring of standing stones with braziers (the fog rises only for a match). */
  private raiseArena() {
    const g = this.g;
    const root = new THREE.Group();
    const cy = heightAt(ARENA.x, ARENA.z);
    root.position.set(ARENA.x, cy, ARENA.z);
    const stone = mat(0x6a5e52, { rough: 0.95 });
    const cap = mat(0x8a2a1c, { rough: 0.8 });
    const pillar = new THREE.CylinderGeometry(0.45, 0.6, 3.6, 6);
    const top = new THREE.CylinderGeometry(0.7, 0.5, 0.5, 6);
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.sin(a) * (ARENA.radius + 1.6), z = Math.cos(a) * (ARENA.radius + 1.6);
      const y = heightAt(ARENA.x + x, ARENA.z + z) - cy;
      const p = new THREE.Mesh(pillar, stone);
      p.position.set(x, y + 1.8, z);
      p.castShadow = true;
      root.add(p);
      const t = new THREE.Mesh(top, cap);
      t.position.set(x, y + 3.85, z);
      root.add(t);
      const flame = glowSprite(0xff8030, 2.2);
      flame.position.set(x, y + 4.5, z);
      root.add(flame);
      g.world.addCollider(ARENA.x + x, ARENA.z + z, 0.6);
    }
    // The crossed-swords sigil of Ares at the heart, worn into the ground.
    const sigil = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.6, 32), new THREE.MeshBasicMaterial({ color: 0x9a3a24, side: THREE.DoubleSide }));
    sigil.rotation.x = -Math.PI / 2;
    sigil.position.y = 0.12;
    root.add(sigil);
    g.scene.add(root);
  }

  private get me() {
    return this.g.coop.myId;
  }
  private get now() {
    return this.g.clock;
  }
  private get record() {
    return this.g.player.c.pvp;
  }

  /** War mode is on for this hero. */
  get war() {
    return this.record.war;
  }

  /** A challenge or an invitation waits for our answer (the interact button answers it first). */
  get answering() {
    return !!this.incoming || !!this.matchInvite;
  }

  /** In a duel or an arena match (or about to be): no other fights start. */
  get busy() {
    return !!this.duel || !!this.match?.inIt || !!this.invite || this.joining;
  }

  nameOf(id: number): string {
    return id === this.me ? this.g.coop.myName : this.g.coop.remotes.get(id)?.name ?? 'A hero';
  }

  private send(to: number | 'all', m: Msg) {
    this.g.coop.pvpSend(to, m);
  }

  // ----------------------------------------------------------- hostility --

  /** Whether our hero and theirs fight right now. Both games decide the same from what they know. */
  hostile(id: number): boolean {
    const r = this.g.coop.remotes.get(id);
    if (!r || !r.ready || !r.alive || !r.pvp || !this.g.player.alive) return false;
    if (this.duel) return this.duel.foe === id && this.duel.phase === 'fight';
    const mt = this.match;
    if (mt?.inIt) return mt.phase === 'fight' && foes(mt.m, this.me, id);
    // Someone in the arena, or in a duel of their own, is out of reach.
    if (mt?.m.players.some((p) => p.id === id)) return false;
    if (this.others.some((d) => d.a === id || d.b === id)) return false;
    return this.war && r.war && !this.safe(this.g.player.pos) && !this.safe(r.pos);
  }

  private safe(p: THREE.Vector3) {
    return peaceful(p.x, p.z, TOWN, SHRINES);
  }

  // -------------------------------------------------------- dealing blows --

  /** Our blow on a rival: shown here at once, sent to their game to land. */
  strike(rv: Rival, amount: number, element: DamageElement, o: { source?: string; dot?: boolean; tags?: string[] }) {
    if (!this.hostile(rv.pvpId) || !(amount > 0)) return;
    if (o.dot) {
      let m = this.dots.get(rv.pvpId);
      if (!m) this.dots.set(rv.pvpId, (m = new Map()));
      m.set(element, (m.get(element) ?? 0) + amount);
      return;
    }
    const tags = (o.tags ?? []).filter((t) => typeof t === 'string').slice(0, 4);
    const p = this.g.player.pos;
    this.send(rv.pvpId, { k: 'pvh', a: r1(Math.min(5000, amount)), e: element, s: o.source ?? 'player', tg: tags, x: r1(p.x), z: r1(p.z) });
    const est = pvpDamage({ amount, element, source: o.source ?? 'player', tags, dot: false }, { maxHp: rv.maxHp, hexed: rv.status.hex > 0, wet: rv.status.wet > 0, marked: rv.status.marked > 0 });
    const g = this.g;
    g.fx.damageNumber(rv.center().add(new THREE.Vector3(0, 1, 0)), `${Math.round(est)}`, tags.includes('backstab') || tags.includes('ambush') || tags.includes('power') ? 'crit' : '');
    g.fx.impact(rv.center(), 0x8a0a0a, Math.min(1, est / 30));
    rv.hitFlash = 0.15;
    rv.anim.hurt = 1;
  }

  /** Our blow throws a rival: their game moves them. */
  knock(rv: Rival, dx: number, dz: number, force: number, up: number) {
    if (!this.hostile(rv.pvpId)) return;
    const d = Math.hypot(dx, dz) || 1;
    this.send(rv.pvpId, { k: 'pvk', x: r1(dx / d), z: r1(dz / d), f: r1(force), u: r1(up) });
  }

  // ------------------------------------------------------- taking blows --

  private takeHit(from: number, m: Msg) {
    const r = this.g.coop.remotes.get(from);
    const el = str(m.e) as DamageElement;
    if (!r || !ELEMENTS.has(el) || !this.hostile(from)) return;
    const g = this.g, p = g.player;
    if (Math.hypot(p.pos.x - r.pos.x, p.pos.z - r.pos.z) > PVP.maxReach) return;
    const dot = num(m.d) === 1;
    const tags = (Array.isArray(m.tg) ? m.tg : []).filter((t): t is string => typeof t === 'string');
    const amount = pvpDamage(
      { amount: Math.min(5000, num(m.a)), element: el, source: str(m.s), tags, dot },
      { maxHp: p.maxHp, hexed: this.ail.hex > 0, wet: this.ail.wet > 0, marked: this.ail.marked > 0 },
    );
    if (amount <= 0) return;
    this.lastHit = { by: from, at: this.now };
    g.damagePlayer(amount, el, dot ? null : this.rivals.get(from) ?? null, dot);
  }

  private takeHold(from: number, m: Msg) {
    if (!this.hostile(from)) return;
    const key = str(m.s), v = Math.min(20, num(m.v));
    if (!(v > 0)) return;
    const p = this.g.player, a = this.ail, t = this.now;
    this.lastHit = { by: from, at: t };
    switch (key) {
      case 'stun':
      case 'fear': {
        const h = holdFor(this.holds, 'hard', v, t);
        if (h > 0) {
          p.stagger = Math.max(p.stagger, h);
          p.attack = null;
        }
        return;
      }
      case 'root': {
        const h = holdFor(this.holds, 'root', v, t);
        if (h > 0) p.pvpRoot = Math.max(p.pvpRoot, h);
        return;
      }
      case 'slow':
      case 'blind':
        p.pvpSlow = Math.max(p.pvpSlow, Math.min(v, PVP.slow));
        return;
      case 'burn':
        a.burn = Math.max(a.burn, Math.min(v, PVP.burnMax));
        return;
      case 'poison':
        a.poison = Math.max(a.poison, Math.min(v, PVP.poisonMax));
        return;
      case 'bleed':
        a.bleed = Math.max(a.bleed, Math.min(v, PVP.bleedMax));
        return;
      case 'hex':
        a.hex = Math.max(a.hex, Math.min(v, PVP.hexMax));
        return;
      case 'wet':
        a.wet = Math.max(a.wet, Math.min(v, PVP.wetMax));
        return;
      case 'marked':
        a.marked = Math.max(a.marked, Math.min(v, PVP.markMax));
        return;
    }
  }

  private takeKnock(from: number, m: Msg) {
    if (!this.hostile(from)) return;
    const p = this.g.player;
    const dir = new THREE.Vector3(num(m.x), 0, num(m.z));
    if (dir.lengthSq() < 1e-4) return;
    dir.normalize();
    p.knockback(dir, Math.min(PVP.knockMax, num(m.f)));
    const up = Math.min(9, num(m.u));
    if (up > 0 && p.iframes <= 0 && p.ironSkin <= 0) p.vel.y = Math.max(p.vel.y, up);
  }

  /** The hero who felled ours, if one struck recently (0: none). */
  private killer(): number {
    const h = this.lastHit;
    return h && this.now - h.at < PVP.creditWindow && this.g.coop.remotes.has(h.by) ? h.by : 0;
  }

  /**
   * Our hero dropped to nothing. In a duel that's a yield; in the arena a
   * fall (they rise again shortly). True when PvP takes it from here.
   */
  spare(): boolean {
    const p = this.g.player;
    if (this.duel?.phase === 'fight') {
      p.hp = 1;
      const foe = this.duel.foe;
      this.send('all', { k: 'pvde', w: foe, l: this.me });
      this.finishDuel(foe, false);
      return true;
    }
    const mt = this.match;
    if (mt?.inIt && mt.phase === 'fight' && !mt.riseAt) {
      const by = this.killer();
      p.alive = false;
      p.hp = 0;
      p.anim.dead = 0;
      p.attack = null;
      this.g.mode = 'dead';
      this.g.audio.play('death');
      mt.riseAt = this.now + MATCH.respawn;
      this.send('all', { k: 'pvf', by, mt: 1 });
      this.fell(this.me, by, true, false);
      return true;
    }
    return false;
  }

  /** Our hero died in the open world: was it another hero's doing (war mode)? Their name, or null. */
  warDeath(): string | null {
    const by = this.killer();
    if (!by || this.busy || !this.war) return null;
    this.send('all', { k: 'pvf', by, w: 1 });
    this.fell(this.me, by, false, true);
    return this.nameOf(by);
  }

  /** Someone fell to someone (or to nothing): the feed, credit, and (host) the score. */
  private fell(victim: number, by: number, inMatch: boolean, war: boolean) {
    const g = this.g;
    const mine = by === this.me || victim === this.me;
    this.hud.feed(by ? this.nameOf(by) : null, this.nameOf(victim), mine);
    if (victim === this.me) {
      this.record.deaths++;
      if (by) g.hud.toast(`Felled by ${this.nameOf(by)}.`, 'warn');
    }
    if (by === this.me && victim !== this.me) {
      this.record.kills++;
      g.audio.play('victory');
      if (war) {
        const prior = this.warKills.get(victim) ?? 0;
        this.warKills.set(victim, prior + 1);
        this.gainGlory(warGlory(prior), `You slew ${this.nameOf(victim)}`);
      } else g.hud.toast(`You felled ${this.nameOf(victim)}!`, 'skill');
    }
    const mt = this.match;
    if (inMatch && mt && g.coop.isHost && mt.phase === 'fight') {
      recordFall(mt.m, victim, by);
      this.sendScores();
      this.checkEnd(false);
    }
  }

  private gainGlory(n: number, why: string) {
    const r = this.record;
    const before = rankOf(r.glory);
    r.glory += n;
    const after = rankOf(r.glory);
    // Friends see the new glory (and rank) on our nametag.
    this.g.coop.announceLook();
    this.g.hud.toast(`${why}: +${n} glory.`, 'skill');
    if (after.index > before.index) {
      // A toast, not a banner: the results card holds the middle of the screen.
      this.g.hud.toast(`A new rank in the arena: ${after.title}!`, 'skill');
      this.g.audio.play('levelup');
    }
  }

  // ---------------------------------------------------------------- duels --

  /** Why we can't duel this hero right now (null: we can). */
  duelBlocked(id: number): string | null {
    const g = this.g, r = g.coop.remotes.get(id);
    if (!g.coop.active) return 'Duels need a co-op game.';
    if (!r || !r.ready) return 'They are not here.';
    if (!r.pvp) return `${r.name}'s game is too old for duels.`;
    if (this.busy) return 'You are already in a fight.';
    if (this.match?.m.players.some((p) => p.id === id)) return `${r.name} is in the arena.`;
    if (this.others.some((d) => d.a === id || d.b === id)) return `${r.name} is in a duel.`;
    if (!g.player.alive || !r.alive) return 'Not now.';
    if (g.inTrial || r.inTrial) return 'Not during a trial.';
    if (g.player.pos.distanceTo(r.pos) > DUEL.range) return `Get closer to ${r.name} (within ${DUEL.range} m).`;
    return null;
  }

  challenge(id: number) {
    const why = this.duelBlocked(id);
    if (why) return this.g.hud.toast(why, 'warn');
    // They challenged us first: that's a yes.
    if (this.incoming?.from === id) return this.acceptDuel();
    this.outgoing = { to: id, until: this.now + DUEL.answer };
    this.send(id, { k: 'pvdq' });
    this.g.hud.toast(`You challenge ${this.nameOf(id)} to a duel.`);
  }

  private onChallenge(from: number) {
    if (this.busy || this.g.inTrial || !this.g.player.alive) return this.send(from, { k: 'pvdn', why: 'busy' });
    // Both challenged at once: fight.
    if (this.outgoing?.to === from) {
      this.incoming = { from, until: this.now + DUEL.answer };
      return this.acceptDuel();
    }
    this.incoming = { from, until: this.now + DUEL.answer };
    const name = this.nameOf(from);
    this.g.audio.play('horn');
    this.hud.ask(`⚔ ${name} challenges you to a duel!`, 'Accept (F)', 'Decline', () => this.acceptDuel(), () => this.declineDuel());
  }

  acceptDuel() {
    const inc = this.incoming;
    this.incoming = null;
    this.hud.closeAsk();
    if (!inc) return;
    const why = this.duelBlocked(inc.from);
    if (why) {
      this.send(inc.from, { k: 'pvdn', why: 'busy' });
      return this.g.hud.toast(why, 'warn');
    }
    const r = this.g.coop.remotes.get(inc.from)!;
    const c = this.g.player.pos.clone().add(r.pos).multiplyScalar(0.5);
    this.send(inc.from, { k: 'pvda', c: [r1(c.x), r1(c.z)] });
    this.send('all', { k: 'pvds', a: inc.from, b: this.me, c: [r1(c.x), r1(c.z)] });
    this.startDuel(inc.from, c, false);
  }

  declineDuel() {
    const inc = this.incoming;
    this.incoming = null;
    this.hud.closeAsk();
    if (inc) this.send(inc.from, { k: 'pvdn' });
  }

  private onAccepted(from: number, m: Msg) {
    if (this.outgoing?.to !== from || this.busy) return this.send(from, { k: 'pvdx' });
    this.outgoing = null;
    const c = Array.isArray(m.c) ? m.c : [];
    this.startDuel(from, new THREE.Vector3(num(c[0]), 0, num(c[1])), true);
  }

  private startDuel(foe: number, center: THREE.Vector3, challenger: boolean) {
    const g = this.g;
    center.y = heightAt(center.x, center.z);
    this.cancelPending();
    this.rematch = null;
    this.duel = { foe, center, phase: 'countdown', t: 0, ring: this.makeRing(center, DUEL.radius, 0xffc860, false), challenger };
    this.countShown = -1;
    this.prepare();
    g.audio.play('roar');
    g.hud.toast(`A duel with ${this.nameOf(foe)}! The first to fall yields.`);
  }

  /** The duel is over: `winner` won it (us or our foe), or it was a draw. */
  private finishDuel(winner: number, draw: boolean) {
    const d = this.duel;
    if (!d) return;
    const g = this.g, r = this.record;
    const foe = d.foe;
    const foeHero = g.coop.remotes.get(foe);
    this.endDuel();
    this.prepare();
    if (draw) {
      r.duelsDrawn++;
      this.gainGlory(5, 'A hard-fought draw');
      this.hud.result('DRAW', 'draw', [`You and ${this.nameOf(foe)} fought to a standstill.`]);
    } else if (winner === this.me) {
      r.duelsWon++;
      const prior = this.beaten.get(foe) ?? 0;
      this.beaten.set(foe, prior + 1);
      const glory = duelGlory(g.player.c.level, foeHero?.level ?? g.player.c.level, prior);
      this.gainGlory(glory, `You beat ${this.nameOf(foe)}`);
      g.audio.play('victory');
      this.hud.result('VICTORY', 'win', [`${this.nameOf(foe)} yields.`, `+${glory} glory · ${rankOf(r.glory).title}`]);
    } else {
      r.duelsLost++;
      this.gainGlory(2, 'You fought bravely');
      this.hud.result('DEFEAT', 'loss', [`You yield to ${this.nameOf(foe)}.`, 'Press F for a rematch.']);
    }
    this.rematch = { foe, until: this.now + 12 };
    g.save();
  }

  /** Take down the ring; the duel is over (no result). */
  private endDuel() {
    if (!this.duel) return;
    this.dropRing(this.duel.ring);
    this.duel = null;
    this.hud.score(null);
  }

  private onDuelEnded(from: number, m: Msg) {
    const w = num(m.w), l = num(m.l), draw = num(m.dr) === 1;
    const d = this.duel;
    if (d && (from === d.foe || w === d.foe || l === d.foe) && (w === this.me || l === this.me || draw)) return this.finishDuel(w, draw);
    // Someone else's duel: take their ring down.
    const i = this.others.findIndex((o) => (o.a === w || o.b === w) && (o.a === l || o.b === l || draw));
    if (i >= 0) {
      this.dropRing(this.others[i].ring);
      this.others.splice(i, 1);
      if (!draw && this.g.player.pos.distanceTo(this.g.coop.remotes.get(w)?.pos ?? this.g.player.pos) < 60) this.g.hud.toast(`${this.nameOf(w)} wins a duel against ${this.nameOf(l)}!`);
    }
  }

  // --------------------------------------------------------------- matches --

  /** Host: invite everyone to the arena. */
  startMatch(mode: MatchMode, goal: number, time: number) {
    const g = this.g;
    if (!g.coop.isHost) return g.hud.toast('Only the host can start an arena match.', 'warn');
    if (this.match || this.invite) return g.hud.toast('A match is already underway.', 'warn');
    if (this.duel) return g.hud.toast('Finish your duel first.', 'warn');
    if (g.activeTrial) return g.hud.toast('Not while a trial is on.', 'warn');
    if (![...g.coop.remotes.values()].some((r) => r.ready && r.pvp)) return g.hud.toast('You need a friend in your world (with a new enough game) to fight.', 'warn');
    if (!MATCH.goals.includes(goal) || !MATCH.times.includes(time)) return;
    this.invite = { mode, goal, time, until: this.now + MATCH.answer, yes: new Set([this.me]), no: new Set() };
    this.send('all', { k: 'pvmq', m: mode, g: goal, tl: time });
    g.hud.toast(`Arena match: ${mode === 'teams' ? 'two teams' : 'everyone for themselves'}, first to ${goal}. Waiting for answers…`, 'skill');
  }

  private onMatchInvite(from: number, m: Msg) {
    if (from !== this.g.coop.hostId) return;
    const mode: MatchMode = m.m === 'teams' ? 'teams' : 'ffa';
    const goal = MATCH.goals.includes(num(m.g)) ? num(m.g) : MATCH.goals[0];
    const time = MATCH.times.includes(num(m.tl)) ? num(m.tl) : MATCH.times[1];
    if (this.duel) return this.send(from, { k: 'pvmn' });
    this.matchInvite = { from, mode, goal, time, until: this.now + MATCH.answer };
    this.g.audio.play('horn');
    this.hud.ask(`⚔ ${this.nameOf(from)} calls everyone to the Arena of Ares: ${mode === 'teams' ? 'two teams' : 'everyone for themselves'}, first to ${goal} (${clock(time)}).`,
      'Join (F)', 'Not now', () => this.joinMatch(), () => this.skipMatch());
  }

  joinMatch() {
    const inv = this.matchInvite;
    this.matchInvite = null;
    this.hud.closeAsk();
    if (!inv) return;
    if (this.duel) {
      this.send(inv.from, { k: 'pvmn' });
      return this.g.hud.toast('Finish your duel first.', 'warn');
    }
    this.send(inv.from, { k: 'pvma' });
    this.joining = true;
    this.joinedAt = this.now;
    this.g.hud.toast('You answer the call. The match begins when everyone has answered.');
  }

  skipMatch() {
    const inv = this.matchInvite;
    this.matchInvite = null;
    this.hud.closeAsk();
    if (inv) this.send(inv.from, { k: 'pvmn' });
  }

  /** Host: everyone has answered (or time is up): to the arena, or call it off. */
  private launch() {
    const inv = this.invite!;
    this.invite = null;
    const g = this.g;
    const heroes = [...inv.yes]
      .map((id) => (id === this.me ? { id, name: this.nameOf(id), level: g.player.c.level } : (() => {
        const r = g.coop.remotes.get(id);
        return r && r.ready ? { id, name: r.name, level: r.level } : null;
      })()))
      .filter((h): h is { id: number; name: string; level: number } => !!h);
    if (heroes.length < MATCH.minPlayers) {
      g.hud.toast('Not enough fighters answered. The match is called off.', 'warn');
      for (const id of inv.yes) if (id !== this.me) this.send(id, { k: 'pvme', x: 1 });
      return;
    }
    const m = newMatch(inv.mode, inv.goal, inv.time, heroes);
    this.send('all', { k: 'pvmg', m: m.mode, g: m.goal, tl: m.time, p: m.players.map((p) => [p.id, p.team, p.name]) });
    this.beginMatch(m);
  }

  private onMatchGo(from: number, msg: Msg) {
    if (from !== this.g.coop.hostId) return;
    const players = (Array.isArray(msg.p) ? msg.p : []).slice(0, 8).map((x) => (Array.isArray(x) ? x : [])).map((x) => ({
      id: num(x[0]), team: num(x[1], -1), name: str(x[2]).slice(0, 20) || 'Hero', kills: 0, deaths: 0,
    }));
    const m: Match = { mode: msg.m === 'teams' ? 'teams' : 'ffa', goal: Math.max(1, num(msg.g, 5)), time: Math.max(60, num(msg.tl, 300)), players };
    this.beginMatch(m);
  }

  private beginMatch(m: Match) {
    const g = this.g, p = g.player;
    this.joining = false;
    if (this.match) this.closeMatch();
    const inIt = m.players.some((x) => x.id === this.me);
    const center = new THREE.Vector3(ARENA.x, heightAt(ARENA.x, ARENA.z), ARENA.z);
    this.match = { m, phase: 'countdown', t: 0, ring: this.makeRing(center, ARENA.radius, 0xe05030, true), inIt, home: null, result: null, riseAt: 0 };
    this.countShown = -1;
    this.matchInvite = null;
    this.hud.closeAsk();
    if (!inIt) return g.hud.toast(`An arena match begins at the Arena of Ares (${m.players.map((x) => x.name).join(', ')}).`);
    this.endDuel();
    this.cancelPending();
    this.match.home = p.pos.clone();
    this.toSpawn();
    this.prepare();
    g.audio.play('roar');
    const mine = m.players.find((x) => x.id === this.me);
    g.hud.banner('ARENA OF ARES', 'zone', m.mode === 'teams' && mine ? `You fight for ${TEAM_NAMES[mine.team]}` : `First to ${m.goal} wins`);
  }

  /** Our hero to their place on the arena's edge, facing the middle. */
  private toSpawn() {
    const mt = this.match!;
    const list = [...mt.m.players].sort((a, b) => a.team - b.team || a.id - b.id);
    const i = Math.max(0, list.findIndex((x) => x.id === this.me));
    let a: number;
    if (mt.m.mode === 'teams') {
      const mates = list.filter((x) => x.team === list[i].team);
      const j = mates.findIndex((x) => x.id === this.me);
      a = (list[i].team === 0 ? 0 : Math.PI) + (j - (mates.length - 1) / 2) * 0.45;
    } else a = (i / list.length) * Math.PI * 2;
    const rr = ARENA.radius * 0.72;
    const x = ARENA.x + Math.sin(a) * rr, z = ARENA.z + Math.cos(a) * rr;
    this.teleport(x, z, Math.atan2(ARENA.x - x, ARENA.z - z));
  }

  private teleport(x: number, z: number, yaw: number) {
    const g = this.g, p = g.player;
    if (p.riding) p.dismount(g);
    p.sailing = false;
    p.boat = null;
    p.flying = false;
    p.pos.set(x, heightAt(x, z), z);
    p.vel.set(0, 0, 0);
    p.yaw = yaw;
    g.camYaw = yaw;
  }

  private onMatchJoin(from: number, yes: boolean) {
    const inv = this.invite;
    if (!inv || !this.g.coop.isHost) {
      // Too late: the match started, or there is none.
      if (yes && this.match) this.send(from, { k: 'pvmn' });
      return;
    }
    (yes ? inv.yes : inv.no).add(from);
  }

  private sendScores() {
    const mt = this.match;
    if (!mt) return;
    this.send('all', { k: 'pvmc', s: mt.m.players.map((p) => [p.id, p.kills, p.deaths]) });
  }

  private onScores(from: number, msg: Msg) {
    const mt = this.match;
    if (!mt || from !== this.g.coop.hostId) return;
    for (const row of Array.isArray(msg.s) ? msg.s : []) {
      if (!Array.isArray(row)) continue;
      const p = mt.m.players.find((x) => x.id === num(row[0]));
      if (p) {
        p.kills = Math.max(0, num(row[1]));
        p.deaths = Math.max(0, num(row[2]));
      }
    }
  }

  /** Host: has the match been decided? */
  private checkEnd(timeUp: boolean) {
    const mt = this.match;
    if (!mt || mt.phase !== 'fight') return;
    const r = matchResult(mt.m, timeUp);
    if (!r) return;
    this.send('all', { k: 'pvme', r: [r.team, r.player, r.draw ? 1 : 0], s: mt.m.players.map((p) => [p.id, p.kills, p.deaths]) });
    this.endMatch(r);
  }

  private onMatchEnd(from: number, msg: Msg) {
    const mt = this.match;
    if (from !== this.g.coop.hostId) return;
    this.joining = false;
    if (num(msg.x) === 1) return this.g.hud.toast('Not enough fighters answered. The match is called off.');
    if (!mt) return;
    this.onScores(from, msg);
    const r = Array.isArray(msg.r) ? msg.r : [];
    this.endMatch({ team: num(r[0], -1), player: num(r[1]), draw: num(r[2]) === 1 });
  }

  private endMatch(r: MatchResult) {
    const mt = this.match;
    if (!mt || mt.phase === 'over') return;
    const g = this.g;
    mt.phase = 'over';
    mt.result = r;
    mt.t = 0;
    this.hud.down(null);
    if (!mt.inIt) {
      g.hud.toast(r.draw ? 'The arena match ends in a draw.' : mt.m.mode === 'teams' ? `${TEAM_NAMES[r.team]} wins the arena match!` : `${this.nameOf(r.player)} wins the arena match!`);
      return;
    }
    if (mt.riseAt) this.rise();
    const me = mt.m.players.find((x) => x.id === this.me);
    const win = won(mt.m, r, this.me);
    const glory = matchGlory(me?.kills ?? 0, win);
    const rec = this.record;
    rec.matchesPlayed++;
    if (win) rec.matchesWon++;
    this.gainGlory(glory, win ? 'Victory in the arena' : 'The arena remembers');
    if (win) g.audio.play('victory');
    const title = r.draw ? 'DRAW' : win ? 'VICTORY' : 'DEFEAT';
    const lines = mt.m.mode === 'teams'
      ? [`${TEAM_NAMES[0]} ${teamScore(mt.m, 0)} — ${teamScore(mt.m, 1)} ${TEAM_NAMES[1]}`]
      : standings(mt.m).slice(0, 4).map((p, i) => `${i + 1}. ${p.name}: ${p.kills} ⚔ ${p.deaths} ☠`);
    lines.push(`Your blows: ${me?.kills ?? 0} ⚔ ${me?.deaths ?? 0} ☠ · +${glory} glory · ${rankOf(rec.glory).title}`);
    this.hud.result(title, r.draw ? 'draw' : win ? 'win' : 'loss', lines, MATCH.results);
    g.save();
  }

  /** Leave the match (or it's over): home again, the ring comes down. */
  private closeMatch() {
    const mt = this.match;
    if (!mt) return;
    const g = this.g;
    if (mt.riseAt) this.rise();
    if (mt.inIt && mt.home) {
      this.teleport(mt.home.x, mt.home.z, g.player.yaw);
      this.prepare();
    }
    this.dropRing(mt.ring);
    this.match = null;
    this.hud.score(null);
    this.hud.down(null);
  }

  /** A participant walks away from the match (from the menu). */
  leaveMatch() {
    const mt = this.match;
    if (!mt?.inIt) return;
    if (this.g.coop.isHost) {
      this.dropFromMatch(this.me);
      this.sendScores();
    } else this.send(this.g.coop.hostId, { k: 'pvml' });
    mt.inIt = false;
    mt.m.players = mt.m.players.filter((p) => p.id !== this.me);
    this.closeMatch();
    this.g.hud.toast('You leave the arena.');
  }

  /** Host: a fighter left; with too few left, the match ends. */
  private dropFromMatch(id: number) {
    const mt = this.match;
    if (!mt || !this.g.coop.isHost) return;
    mt.m.players = mt.m.players.filter((p) => p.id !== id);
    this.send('all', { k: 'pvmc', s: mt.m.players.map((p) => [p.id, p.kills, p.deaths]), gone: id });
    if (mt.phase !== 'over' && mt.m.players.length < MATCH.minPlayers) {
      mt.phase = 'fight';
      this.checkEnd(true);
    }
  }

  /** A fallen hero rises at their spawn, shielded for a moment. */
  private rise() {
    const g = this.g, p = g.player;
    const mt = this.match;
    if (mt) mt.riseAt = 0;
    p.alive = true;
    p.anim.dead = -1;
    if (g.mode === 'dead') g.mode = 'play';
    if (mt && mt.phase !== 'over') this.toSpawn();
    this.prepare();
    p.iframes = MATCH.shield;
    this.hud.down(null);
  }

  // ------------------------------------------------------------ war mode --

  /** Turn war mode on or off (off waits until no hero has struck for a while). */
  setWar(on: boolean) {
    const g = this.g;
    if (!on && this.lastHit && this.now - this.lastHit.at < 15) return g.hud.toast('Not in the middle of a fight!', 'warn');
    this.record.war = on;
    g.hud.toast(on ? 'War mode: heroes who have it on too may attack you (and you them), but not in town or by the shrines.' : 'War mode is off.', on ? 'warn' : '');
    g.save();
  }

  // ----------------------------------------------------------- the prompt --

  /** What the interact button does about PvP here (null: nothing). */
  promptLabel(): string | null {
    if (this.incoming) return `Accept ${this.nameOf(this.incoming.from)}'s duel`;
    if (this.matchInvite) return 'Join the arena match';
    const g = this.g;
    if (this.busy || !g.coop.active || !g.player.alive) return null;
    const rm = this.rematch;
    if (rm && this.now < rm.until && !this.duelBlocked(rm.foe)) return `Rematch ${this.nameOf(rm.foe)}`;
    const r = this.nearFriend();
    return r ? `Duel ${r.name}` : null;
  }

  /** The friend standing right by our hero who could be challenged. */
  private nearFriend(): RemoteHero | null {
    const p = this.g.player.pos;
    let best: RemoteHero | null = null;
    let bestD = 3.2;
    for (const r of this.g.coop.remotes.values()) {
      if (!r.ready || !r.alive || !r.pvp) continue;
      const d = r.pos.distanceTo(p);
      if (d < bestD && !this.duelBlocked(r.id)) (bestD = d), (best = r);
    }
    return best;
  }

  interact() {
    if (this.incoming) return this.acceptDuel();
    if (this.matchInvite) return this.joinMatch();
    const rm = this.rematch;
    if (rm && this.now < rm.until) {
      this.rematch = null;
      return this.challenge(rm.foe);
    }
    const r = this.nearFriend();
    if (r) this.challenge(r.id);
  }

  // ---------------------------------------------------------- messages --

  /** A PvP message from another player's game. */
  handle(from: number, m: Msg) {
    if (!this.g.coop.remotes.has(from)) return;
    switch (m.k) {
      case 'pvh':
        return this.takeHit(from, m);
      case 'pvs':
        return this.takeHold(from, m);
      case 'pvk':
        return this.takeKnock(from, m);
      case 'pvf':
        return this.fell(from, num(m.by), num(m.mt) === 1, num(m.w) === 1);
      case 'pvdq':
        return this.onChallenge(from);
      case 'pvda':
        return this.onAccepted(from, m);
      case 'pvdn':
        if (this.outgoing?.to === from) {
          this.outgoing = null;
          this.g.hud.toast(m.why === 'busy' ? `${this.nameOf(from)} can't duel right now.` : `${this.nameOf(from)} declines the duel.`);
        }
        return;
      case 'pvdx':
        if (this.duel?.foe === from) {
          this.endDuel();
          this.g.hud.toast('The duel was called off.');
        }
        return;
      case 'pvds': {
        const a = num(m.a), b = num(m.b), c = Array.isArray(m.c) ? m.c : [];
        if (a === this.me || b === this.me || this.others.some((d) => d.a === a || d.b === a)) return;
        const center = new THREE.Vector3(num(c[0]), 0, num(c[1]));
        center.y = heightAt(center.x, center.z);
        this.others.push({ a, b, center, ring: this.makeRing(center, DUEL.radius, 0xffc860, false) });
        if (this.g.player.pos.distanceTo(center) < 60) this.g.hud.toast(`${this.nameOf(a)} and ${this.nameOf(b)} are dueling!`);
        return;
      }
      case 'pvde':
        return this.onDuelEnded(from, m);
      case 'pvmq':
        return this.onMatchInvite(from, m);
      case 'pvma':
        return this.onMatchJoin(from, true);
      case 'pvmn':
        if (this.g.coop.isHost) return this.onMatchJoin(from, false);
        // The host says our answer came too late.
        this.joining = false;
        return this.g.hud.toast('The match had already begun.');
      case 'pvmg':
        return this.onMatchGo(from, m);
      case 'pvmc': {
        const gone = num(m.gone);
        if (gone && this.match) this.match.m.players = this.match.m.players.filter((p) => p.id !== gone);
        return this.onScores(from, m);
      }
      case 'pvme':
        return this.onMatchEnd(from, m);
      case 'pvml':
        if (this.g.coop.isHost) this.dropFromMatch(from);
        return;
    }
  }

  /** A friend left the game: duels, matches and rivals forget them. */
  onLeave(id: number) {
    const rv = this.rivals.get(id);
    if (rv) this.dropRival(rv);
    if (this.duel?.foe === id) {
      // They ran: the duel is ours.
      this.send('all', { k: 'pvde', w: this.me, l: id });
      this.finishDuel(this.me, false);
    }
    for (let i = this.others.length - 1; i >= 0; i--) {
      if (this.others[i].a === id || this.others[i].b === id) {
        this.dropRing(this.others[i].ring);
        this.others.splice(i, 1);
      }
    }
    if (this.incoming?.from === id) {
      this.incoming = null;
      this.hud.closeAsk();
    }
    if (this.outgoing?.to === id) this.outgoing = null;
    if (this.match) {
      if (this.g.coop.isHost) this.dropFromMatch(id);
      else if (id === this.g.coop.hostId) this.closeMatch();
    }
  }

  /** Co-op ended: no more fights. */
  reset() {
    for (const rv of [...this.rivals.values()]) this.dropRival(rv);
    this.endDuel();
    this.closeMatch();
    for (const o of this.others) this.dropRing(o.ring);
    this.others = [];
    this.cancelPending();
    this.invite = null;
    this.joining = false;
    this.rematch = null;
    this.hud.closeResult();
    this.ail = { burn: 0, poison: 0, bleed: 0, hex: 0, wet: 0, marked: 0 };
  }

  private cancelPending() {
    if (this.incoming) this.send(this.incoming.from, { k: 'pvdn' });
    if (this.matchInvite) this.send(this.matchInvite.from, { k: 'pvmn' });
    this.incoming = null;
    this.matchInvite = null;
    this.outgoing = null;
    this.hud.closeAsk();
  }

  /** Full health, mana and stamina, and nothing ailing: before and after a fight. */
  private prepare() {
    const p = this.g.player;
    p.hp = p.maxHp;
    p.mana = p.maxMana;
    p.refillStamina();
    p.pvpRoot = p.pvpSlow = 0;
    this.ail = { burn: 0, poison: 0, bleed: 0, hex: 0, wet: 0, marked: 0 };
    this.lastHit = null;
  }

  // ---------------------------------------------------------------- rings --

  /** The fog wall of a duel or the arena match (the arena's stones stand always). */
  private makeRing(center: THREE.Vector3, radius: number, color: number, arena: boolean): THREE.Object3D {
    const g = this.g;
    const root = new THREE.Group();
    root.position.copy(center);
    const fog = new THREE.Mesh(
      new THREE.CylinderGeometry(radius + 0.4, radius + 0.4, 10, 48, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    );
    fog.position.y = 4;
    root.add(fog);
    const band = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.12, 6, 64), new THREE.MeshBasicMaterial({ color }));
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.2;
    root.add(band);
    if (arena) {
      // The sigil at the heart flares while a match is fought.
      const sigil = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.6, 32), new THREE.MeshBasicMaterial({ color: 0xff6a40, side: THREE.DoubleSide }));
      sigil.rotation.x = -Math.PI / 2;
      sigil.position.y = 0.15;
      root.add(sigil);
    }
    g.scene.add(root);
    return root;
  }

  private dropRing(o: THREE.Object3D) {
    o.removeFromParent();
    disposeObject(o);
  }

  // ------------------------------------------------------------- rivals --

  private dropRival(rv: Rival) {
    this.rivals.delete(rv.pvpId);
    this.dots.delete(rv.pvpId);
    if (this.g.enemies.includes(rv)) this.g.removeEnemy(rv);
  }

  /** Stand-ins for the heroes we fight now; their nametags turn red. */
  private syncRivals(dt: number) {
    const g = this.g;
    for (const r of g.coop.remotes.values()) {
      const want = this.hostile(r.id);
      let rv = this.rivals.get(r.id);
      // Swept away with the monsters (a rest at a shrine): stand it up again.
      if (rv && !g.enemies.includes(rv)) {
        this.rivals.delete(r.id);
        rv = undefined;
      }
      if (want && !rv) {
        rv = new Rival(r, this);
        this.rivals.set(r.id, rv);
        g.enemies.push(rv);
        g.scene.add(rv.model.root);
      } else if (!want && rv) {
        this.dropRival(rv);
        rv = undefined;
      }
      r.setHostile(want);
      if (!rv) continue;
      // What our hero did to them (burning, stunned, slowed…) goes to their game.
      for (const k of STATUS_KEYS) {
        if (rv.status[k] > rv.prev[k] + 0.05) this.send(r.id, { k: 'pvs', s: k, v: r1(rv.status[k]) });
        rv.status[k] = Math.max(0, rv.status[k] - dt);
        rv.prev[k] = rv.status[k];
      }
      rv.update(dt);
    }
    for (const rv of [...this.rivals.values()]) if (!g.coop.remotes.has(rv.pvpId)) this.dropRival(rv);
    // Ticking hurts, a few times a second.
    if ((this.dotSend -= dt) <= 0) {
      this.dotSend = 0.25;
      for (const [id, m] of this.dots) {
        for (const [el, a] of m) if (a > 0.05) this.send(id, { k: 'pvh', a: r1(a), e: el, s: 'dot', d: 1 });
        m.clear();
      }
    }
  }

  /** Burning, poison and bleeding other heroes left on ours. */
  private tickAilments(dt: number) {
    const g = this.g, p = g.player, a = this.ail;
    for (const k of Object.keys(a) as (keyof Ailments)[]) a[k] = Math.max(0, a[k] - dt);
    p.pvpRoot = Math.max(0, p.pvpRoot - dt);
    p.pvpSlow = Math.max(0, p.pvpSlow - dt);
    if (!p.alive) return;
    if (a.burn > 0) g.damagePlayer(PVP.burnDps * PVP.damage * dt, 'fire', null, true);
    if (a.poison > 0) g.damagePlayer(p.maxHp * PVP.poisonShare * dt, 'true', null, true);
    if (a.bleed > 0) g.damagePlayer(p.maxHp * PVP.bleedShare * dt, 'true', null, true);
    if ((this.fxTick -= dt) <= 0 && (a.burn > 0 || a.poison > 0 || a.bleed > 0)) {
      this.fxTick = 0.2;
      g.fx.emit(p.center(), { color: a.burn > 0 ? 0xff6020 : a.poison > 0 ? 0x70d040 : 0x9a1010, count: 3, speed: 1.2, life: 0.5, up: 1 });
    }
  }

  /** Host: the rings' wards keep monsters out, so heroes fight heroes. */
  private sweepRings() {
    const rings: [number, number, number][] = [];
    // Wide enough that archers and casters can't shoot in either.
    if (this.match && this.match.phase !== 'over') rings.push([ARENA.x, ARENA.z, ARENA.radius + 25]);
    if (this.duel) rings.push([this.duel.center.x, this.duel.center.z, DUEL.radius + 25]);
    for (const o of this.others) rings.push([o.center.x, o.center.z, DUEL.radius + 25]);
    if (!rings.length) return;
    const g = this.g;
    for (const e of [...g.enemies]) {
      if (e.pvpId || e instanceof Boss || !e.alive) continue;
      if (rings.some(([x, z, r]) => Math.hypot(e.pos.x - x, e.pos.z - z) < r)) g.removeEnemy(e);
    }
  }

  /** Keep fighters in their ring and everyone else out of it. */
  private fence() {
    const p = this.g.player;
    if (!p.alive) return;
    const keep = (c: THREE.Vector3, radius: number, inside: boolean) => {
      const dx = p.pos.x - c.x, dz = p.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-3) return;
      if (inside && d > radius - 0.6) {
        p.pos.x = c.x + (dx / d) * (radius - 0.6);
        p.pos.z = c.z + (dz / d) * (radius - 0.6);
      } else if (!inside && d < radius + 1) {
        p.pos.x = c.x + (dx / d) * (radius + 1);
        p.pos.z = c.z + (dz / d) * (radius + 1);
      }
    };
    if (this.duel) keep(this.duel.center, DUEL.radius, true);
    const mt = this.match;
    if (mt && mt.phase !== 'over') keep(new THREE.Vector3(ARENA.x, 0, ARENA.z), ARENA.radius, mt.inIt);
    for (const o of this.others) keep(o.center, DUEL.radius, false);
  }

  // ---------------------------------------------------------------- update --

  update(dt: number) {
    const g = this.g;
    this.hud.update(dt);
    if (!g.coop.active) {
      if (this.duel || this.match || this.rivals.size) this.reset();
      return;
    }
    const t = this.now;
    if (this.incoming && t > this.incoming.until) {
      this.incoming = null;
      this.hud.closeAsk();
    }
    if (this.matchInvite && t > this.matchInvite.until) {
      this.matchInvite = null;
      this.hud.closeAsk();
    }
    if (this.outgoing && t > this.outgoing.until) {
      this.g.hud.toast(`${this.nameOf(this.outgoing.to)} did not answer.`);
      this.outgoing = null;
    }
    if (this.rematch && t > this.rematch.until) this.rematch = null;
    if (this.joining && !this.match && t > this.joinedAt + MATCH.answer + 10) this.joining = false;
    const inv = this.invite;
    if (inv) {
      const asked = [...g.coop.remotes.values()].filter((r) => r.ready && r.pvp).map((r) => r.id);
      if (t > inv.until || asked.every((id) => inv.yes.has(id) || inv.no.has(id))) this.launch();
    }
    this.updateDuel(dt);
    this.updateMatch(dt);
    if (g.coop.isHost && (this.sweep -= dt) <= 0) {
      this.sweep = 0.5;
      this.sweepRings();
    }
    this.syncRivals(dt);
    this.tickAilments(dt);
    this.fence();
  }

  private updateDuel(dt: number) {
    const d = this.duel;
    if (!d) return;
    d.t += dt;
    if (d.phase === 'countdown') {
      const left = Math.ceil(DUEL.countdown - d.t);
      if (left !== this.countShown && left > 0) {
        this.countShown = left;
        this.hud.countdown(String(left));
        this.g.audio.play('windup');
      }
      if (d.t >= DUEL.countdown) {
        d.phase = 'fight';
        d.t = 0;
        // Both start whole, whatever happened during the count.
        this.prepare();
        this.hud.countdown('FIGHT!', true);
        this.g.audio.play('slam');
      }
    } else if (d.t > DUEL.maxTime && d.challenger) {
      // Too long: the challenger calls it a draw for both.
      this.send('all', { k: 'pvde', w: this.me, l: d.foe, dr: 1 });
      return this.finishDuel(0, true);
    }
    const foe = this.g.coop.remotes.get(d.foe);
    const hp = foe ? Math.round((100 * foe.hp) / Math.max(1, foe.maxHp)) : 0;
    this.hud.score(`⚔ Duel · <b>${esc(foe?.name ?? '…')}</b> <i style="--hp:${hp}%"></i>`, [], d.phase === 'fight' ? clock(DUEL.maxTime - d.t) : '');
  }

  private updateMatch(dt: number) {
    const mt = this.match;
    if (!mt) return;
    const g = this.g;
    mt.t += dt;
    if (mt.phase === 'countdown') {
      const left = Math.ceil(MATCH.countdown - mt.t);
      if (mt.inIt && left !== this.countShown && left > 0) {
        this.countShown = left;
        this.hud.countdown(String(left));
        g.audio.play('windup');
      }
      if (mt.t >= MATCH.countdown) {
        mt.phase = 'fight';
        mt.t = 0;
        if (mt.inIt) {
          this.prepare();
          this.hud.countdown('FIGHT!', true);
          g.audio.play('slam');
        }
      }
    } else if (mt.phase === 'fight') {
      if (g.coop.isHost && mt.t >= mt.m.time) this.checkEnd(true);
      if (mt.riseAt) {
        const left = mt.riseAt - this.now;
        this.hud.down(`Back in ${Math.max(1, Math.ceil(left))}…`);
        if (left <= 0) this.rise();
      }
    } else if (mt.t >= MATCH.results) {
      return this.closeMatch();
    }
    if (!mt.inIt) return;
    const rows: ScoreRow[] = standings(mt.m).map((p) => ({ name: p.name, kills: p.kills, deaths: p.deaths, color: p.team >= 0 ? hex(TEAM_COLORS[p.team]) : '', me: p.id === this.me }));
    const title = mt.m.mode === 'teams'
      ? `<span style="color:${hex(TEAM_COLORS[0])}">${TEAM_NAMES[0]} ${teamScore(mt.m, 0)}</span> — <span style="color:${hex(TEAM_COLORS[1])}">${teamScore(mt.m, 1)} ${TEAM_NAMES[1]}</span> · first to ${mt.m.goal}`
      : `Arena of Ares · first to ${mt.m.goal}`;
    this.hud.score(title, rows, mt.phase === 'fight' ? clock(mt.m.time - mt.t) : '');
  }

  /** For the menu: who could be challenged, and what is going on. */
  status() {
    const g = this.g;
    const rank = rankOf(this.record.glory);
    return {
      rank,
      record: this.record,
      duel: this.duel ? this.nameOf(this.duel.foe) : null,
      match: this.match ? { inIt: this.match.inIt, mode: this.match.m.mode, goal: this.match.m.goal, phase: this.match.phase } : null,
      inviting: !!this.invite,
      friends: [...g.coop.remotes.values()].filter((r) => r.ready).map((r) => ({ id: r.id, name: r.name, level: r.level, title: rankOf(r.glory).title, why: this.duelBlocked(r.id) })),
    };
  }
}
