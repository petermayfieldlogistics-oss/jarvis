// Monster population. Camps (SPAWNS) and walking patrols (PATROLS) are only
// placed in the world near the hero and remember who is left while away; a
// cleared camp returns a few minutes later once the hero has moved on.
// Wanderers top the wild up when it runs thin, more of them at night. In
// co-op the host's spawner does this around every hero.

import * as THREE from 'three';
import { AMBIENT, ENEMIES, PATROLS, SHRINES, SPAWNS, TOWN, TRIALS, VOLCANO, ZONES, type EnemyId, WORLD_HALF } from '../data/world';
import { Boss, type Enemy } from './entities';
import type { Hero } from './hero';
import { heightAt, inLava, zoneAt, WATER_LEVEL } from './terrain';
import type { Game } from './game';

/** Camps appear within SHOW metres of the hero and are put away beyond HIDE. */
const SHOW = 160;
const HIDE = 215;
/** Performance caps: all live monsters, and those near enough to be updated. */
const MAX_LIVE = 90;
const MAX_NEAR = 40;
const NEAR = 150;
/** A cleared camp returns after this many seconds, once the hero is this far away. */
const RESPAWN_MIN = 120;
const RESPAWN_MAX = 180;
const RESPAWN_AWAY = 70;
/** Wanderers: spawned this far from the hero to keep at least this many monsters within AMBIENT_COUNT_R. */
const AMBIENT_MIN_R = 62;
const AMBIENT_MAX_R = 118;
const AMBIENT_COUNT_R = 120;
const AMBIENT_DAY = 7;
const AMBIENT_NIGHT = 11;

interface Patrol {
  route: [number, number][];
  anchor: THREE.Vector3;
  next: number;
  dir: 1 | -1;
  speed: number;
}

interface Group {
  x: number;
  z: number;
  radius: number;
  roster: EnemyId[];
  /** Still alive but not placed (the hero is away). */
  left: EnemyId[];
  members: Enemy[];
  live: boolean;
  /** Spawner clock when a cleared camp returns; -1 when not cleared. */
  respawnAt: number;
  bonus: number;
  patrol: Patrol | null;
}

const expand = (list: [EnemyId, number][]) => list.flatMap(([id, n]) => Array<EnemyId>(n).fill(id));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Spawner {
  private groups: Group[] = [];
  private ambient: Enemy[] = [];
  private time = 0;
  private tick = 0;
  private ambientTimer = 2;
  private watcherTimer = 30;
  private present = new Set<Enemy>();
  /** Which hero the wild is topped up around next (co-op takes turns). */
  private turn = 0;

  constructor(private g: Game) {
    for (const s of SPAWNS) {
      const roster = expand(s.enemies);
      this.groups.push({ x: s.x, z: s.z, radius: s.radius, roster, left: [...roster], members: [], live: false, respawnAt: -1, bonus: s.bonus ?? 0, patrol: null });
    }
    for (const p of PATROLS) {
      const roster = expand(p.enemies);
      const speed = Math.min(2.2, Math.min(...roster.map((id) => ENEMIES[id].speed)) * 0.32);
      const [x, z] = p.route[0];
      this.groups.push({
        x, z, radius: 3, roster, left: [...roster], members: [], live: false, respawnAt: -1, bonus: p.bonus ?? 0,
        patrol: { route: p.route, anchor: new THREE.Vector3(x, 0, z), next: 1, dir: 1, speed },
      });
    }
  }

  /** Clears ordinary monsters and fills every camp again (resting, dying, starting). */
  spawnAll() {
    const g = this.g;
    for (const e of [...g.enemies]) if (!(e instanceof Boss) && !e.pvpId) g.removeEnemy(e);
    for (const gr of this.groups) {
      gr.members = [];
      gr.left = [...gr.roster];
      gr.live = false;
      gr.respawnAt = -1;
      this.resetPatrol(gr);
    }
    this.ambient = [];
    this.refresh(true);
  }

  update(dt: number) {
    this.time += dt;
    this.movePatrols(dt);
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.25;
      this.refresh(false);
    }
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 2.5;
      this.topUp();
    }
    this.watcherTimer -= dt;
    if (this.watcherTimer <= 0) {
      this.watcherTimer = 45;
      this.nightWatcher();
    }
  }

  /** Live monster counts: everywhere, and close enough to a hero to be active. */
  private counts() {
    let live = 0, near = 0;
    for (const e of this.g.enemies) {
      if (!e.alive || e.pvpId) continue;
      live++;
      if (this.g.heroDistance(e.pos.x, e.pos.z) < NEAR) near++;
    }
    return { live, near };
  }

  /** The caps grow a little with each friend, who brings their own patch of world. */
  private get maxLive() {
    return MAX_LIVE + 25 * (this.g.heroes.length - 1);
  }
  private get maxNear() {
    return MAX_NEAR + 15 * (this.g.heroes.length - 1);
  }

  /** Flat distance to the nearest hero. */
  private dist(x: number, z: number) {
    let d = Infinity;
    for (const h of this.g.heroes) d = Math.min(d, Math.hypot(h.pos.x - x, h.pos.z - z));
    return d;
  }

  /** The next living hero to spawn wanderers around. */
  private nextHero(): Hero | null {
    const hs = this.g.heroes;
    for (let k = 0; k < hs.length; k++) {
      const h = hs[(this.turn + k) % hs.length];
      if (h.alive) {
        this.turn = (this.turn + k + 1) % hs.length;
        return h;
      }
    }
    return null;
  }

  /** Books keeping for camps and patrols: who died, who to place, who to put away. */
  private refresh(all: boolean) {
    const g = this.g;
    this.present.clear();
    for (const e of g.enemies) this.present.add(e);
    const c = this.counts();
    let best: Group | null = null;
    let bestD = Infinity;
    for (const gr of this.groups) {
      for (let i = gr.members.length - 1; i >= 0; i--) {
        const e = gr.members[i];
        if (!e.alive || e.tamed) gr.members.splice(i, 1);
        else if (!this.present.has(e)) {
          // Removed from the world alive (a trial cleared its arena): keep them for later.
          gr.members.splice(i, 1);
          gr.left.push(e.def.id);
        }
      }
      if (gr.live && !gr.members.length) {
        gr.live = false;
        if (!gr.left.length) gr.respawnAt = this.time + rand(RESPAWN_MIN, RESPAWN_MAX);
        else this.depleted(gr);
      }
      const cx = gr.patrol ? gr.patrol.anchor.x : gr.x, cz = gr.patrol ? gr.patrol.anchor.z : gr.z;
      const d = this.dist(cx, cz);
      if (gr.live) {
        if (d > HIDE && !gr.members.some((e) => e.aware)) this.hide(gr);
        continue;
      }
      // Cleared (or thinned-out) camps fill up again a while later, out of the hero's sight.
      if (gr.respawnAt >= 0 && this.time >= gr.respawnAt && d > RESPAWN_AWAY) {
        gr.left = [...gr.roster];
        gr.respawnAt = -1;
        this.resetPatrol(gr);
      }
      if (!gr.left.length) continue;
      const t = g.activeTrial;
      if (d > SHOW || (t && Math.hypot(cx - t.x, cz - t.z) < t.radius + 20)) continue;
      // Places camps that should already be in view at once (start, rest, fast travel); the rest one per tick.
      if (all || d < 100) {
        if (this.fits(gr, d, c)) {
          this.show(gr);
          c.live += gr.members.length;
          if (d < NEAR) c.near += gr.members.length;
        }
      } else if (d < bestD) (best = gr), (bestD = d);
    }
    if (best && this.fits(best, bestD, c)) this.show(best);
  }

  private fits(gr: Group, d: number, c: { live: number; near: number }) {
    const n = gr.left.length;
    return c.live + n <= this.maxLive && (d > NEAR || c.near + n <= this.maxNear);
  }

  private show(gr: Group) {
    const g = this.g;
    const i = this.groups.indexOf(gr);
    const n = gr.left.length;
    gr.left.forEach((id, k) => {
      let x: number, z: number;
      let ox = 0, oz = 0;
      if (gr.patrol) {
        // March in a loose column around the anchor.
        const ang = (k / n) * Math.PI * 2;
        const r = n > 1 ? 2.2 : 0;
        ox = Math.cos(ang) * r;
        oz = Math.sin(ang) * r;
        x = gr.patrol.anchor.x + ox;
        z = gr.patrol.anchor.z + oz;
      } else [x, z] = this.spot(id, gr.x, gr.z, gr.radius);
      const e = g.spawnEnemy(id, x, z);
      e.spawnGroup = i;
      this.applyBonus(e, gr.bonus);
      if (gr.patrol) {
        e.patrol = { anchor: gr.patrol.anchor, ox, oz };
        e.state = 'patrol';
        e.yaw = Math.atan2(gr.patrol.route[gr.patrol.next][0] - x, gr.patrol.route[gr.patrol.next][1] - z);
      }
      gr.members.push(e);
    });
    gr.left = [];
    gr.live = true;
  }

  private hide(gr: Group) {
    for (const e of gr.members) {
      gr.left.push(e.def.id);
      this.g.removeEnemy(e);
    }
    gr.members = [];
    gr.live = false;
    this.depleted(gr);
  }

  /** A camp put away with losses starts its refill timer. */
  private depleted(gr: Group) {
    if (gr.left.length < gr.roster.length && gr.respawnAt < 0) gr.respawnAt = this.time + rand(RESPAWN_MIN, RESPAWN_MAX);
  }

  private resetPatrol(gr: Group) {
    const pa = gr.patrol;
    if (!pa) return;
    pa.anchor.set(pa.route[0][0], 0, pa.route[0][1]);
    pa.next = 1;
    pa.dir = 1;
  }

  /** Patrols walk their route there and back, waiting while any of them fights or lags behind. */
  private movePatrols(dt: number) {
    for (const gr of this.groups) {
      const pa = gr.patrol;
      if (!pa || !gr.live) continue;
      let hold = false;
      for (const e of gr.members) {
        const lag = Math.hypot(e.pos.x - pa.anchor.x - (e.patrol?.ox ?? 0), e.pos.z - pa.anchor.z - (e.patrol?.oz ?? 0));
        if (e.aware || e.state !== 'patrol' || lag > 6) {
          hold = true;
          break;
        }
      }
      if (hold) continue;
      const [tx, tz] = pa.route[pa.next];
      const dx = tx - pa.anchor.x, dz = tz - pa.anchor.z;
      const d = Math.hypot(dx, dz);
      if (d < 1) {
        if (pa.next + pa.dir < 0 || pa.next + pa.dir >= pa.route.length) pa.dir = pa.dir === 1 ? -1 : 1;
        pa.next += pa.dir;
        continue;
      }
      const step = Math.min(d, pa.speed * dt);
      pa.anchor.x += (dx / d) * step;
      pa.anchor.z += (dz / d) * step;
    }
  }

  /** A random spot in a camp, on dry land for monsters that avoid water. */
  private spot(id: EnemyId, x: number, z: number, radius: number): [number, number] {
    const wet = ENEMIES[id].affinity === 'water' || ENEMIES[id].body === 'floater';
    let bx = x, bz = z;
    for (let t = 0; t < 8; t++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      bx = x + Math.cos(a) * r;
      bz = z + Math.sin(a) * r;
      if (wet || heightAt(bx, bz) > WATER_LEVEL + 0.4) break;
    }
    return [bx, bz];
  }

  private applyBonus(e: Enemy, bonus: number) {
    if (bonus <= 0) return;
    e.levelBonus = bonus;
    e.maxHp = e.hp = Math.round(e.def.hp * (1 + bonus * 0.12));
  }

  private inArena(x: number, z: number, margin: number) {
    for (const t of TRIALS) if (Math.hypot(x - t.x, z - t.z) < t.radius + margin) return true;
    return false;
  }

  /** Can a wanderer appear here? Not in town, a trial arena, lava, the sea or the mountains at the edge. */
  private wild(x: number, z: number, wet: boolean) {
    if (Math.max(Math.abs(x), Math.abs(z)) > WORLD_HALF - 75) return false;
    if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.radius + 28) return false;
    if (this.inArena(x, z, 22)) return false;
    if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.crater + 8) return false;
    for (const s of SHRINES) if (Math.hypot(x - s.x, z - s.z) < 18) return false;
    const h = heightAt(x, z);
    if (inLava(x, z, h)) return false;
    return wet ? h > WATER_LEVEL - 2.5 : h > WATER_LEVEL + 0.4;
  }

  /** Keeps a minimum of monsters around the hero in the wild, picked by the region they appear in. */
  private topUp() {
    const g = this.g;
    for (let i = this.ambient.length - 1; i >= 0; i--) {
      const e = this.ambient[i];
      const gone = !e.alive || !g.enemies.includes(e);
      if (gone || (!e.aware && this.dist(e.pos.x, e.pos.z) > HIDE - 20)) {
        if (!gone) g.removeEnemy(e);
        this.ambient.splice(i, 1);
      }
    }
    const hero = this.nextHero();
    if (!hero) return;
    const p = hero.pos;
    if (zoneAt(p.x, p.z) === 'town') return;
    const t = g.activeTrial;
    if (t && Math.hypot(p.x - t.x, p.z - t.z) < t.radius + 40) return;
    let around = 0;
    for (const e of g.enemies) if (e.alive && !e.summoned && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < AMBIENT_COUNT_R) around++;
    const night = g.isNight;
    const want = night ? AMBIENT_NIGHT : AMBIENT_DAY;
    if (around >= want) return;
    const c = this.counts();
    for (let t = 0; t < 10; t++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(AMBIENT_MIN_R, AMBIENT_MAX_R);
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const zone = zoneAt(x, z);
      const table = AMBIENT[zone];
      if (!table) continue;
      const pool = night ? [...table.day, ...table.night] : table.day;
      const lead = pool[Math.floor(Math.random() * pool.length)];
      const def = ENEMIES[lead];
      const wet = def.affinity === 'water' || def.body === 'floater';
      if (!this.wild(x, z, wet)) continue;
      if (lead === 'eye-watcher' && this.watchers() >= 6) continue;
      let n = Math.round(rand(table.pack[0], table.pack[1] + (night ? 1 : 0)));
      // Big brutes come alone or in pairs.
      if (def.level >= 12 || lead === 'eye-watcher') n = Math.min(n, 2);
      n = Math.min(n, want - around + 1, this.maxLive - c.live, this.maxNear - c.near);
      if (n <= 0) return;
      // The Golden Reach stays gentle; elsewhere wanderers rise to the region's level.
      const nearTown = Math.hypot(x - TOWN.x, z - TOWN.z) < 170;
      for (let k = 0; k < n; k++) {
        // Mostly the same kind, sometimes a mixed band.
        const id = k > 0 && Math.random() < 0.3 ? pool[Math.floor(Math.random() * pool.length)] : lead;
        const [sx, sz] = this.spot(id, x, z, 6);
        if (!this.wild(sx, sz, ENEMIES[id].affinity === 'water' || ENEMIES[id].body === 'floater')) continue;
        const e = g.spawnEnemy(id, sx, sz);
        this.applyBonus(e, nearTown ? 0 : Math.max(0, Math.min(3, ZONES[zone].level - ENEMIES[id].level)));
        this.ambient.push(e);
      }
      return;
    }
  }

  private watchers() {
    let n = 0;
    for (const e of this.g.enemies) if (e.def.id === 'eye-watcher' && e.alive && !(e instanceof Boss)) n++;
    return n;
  }

  /** At night the Watchers drift in over the darker lands. */
  private nightWatcher() {
    const g = this.g;
    const hero = this.nextHero();
    if (!hero || !g.isNight || g.activeTrial || !['swamp', 'crossroads', 'badlands', 'volcano'].includes(zoneAt(hero.pos.x, hero.pos.z))) return;
    if (this.watchers() > 6) return;
    const c = this.counts();
    if (c.live >= this.maxLive || c.near >= this.maxNear) return;
    for (let t = 0; t < 6; t++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(55, 80);
      const x = hero.pos.x + Math.cos(a) * r;
      const z = hero.pos.z + Math.sin(a) * r;
      if (!this.wild(x, z, true) || heightAt(x, z) < 0) continue;
      this.ambient.push(g.spawnEnemy('eye-watcher', x, z));
      return;
    }
  }
}
