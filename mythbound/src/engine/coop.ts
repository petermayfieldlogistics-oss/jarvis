// Co-op for 2-4 players. One player hosts: their game runs the world (every
// monster, boss and the time of day) and tells the others what happens. The
// others (guests) see copies of the host's monsters, send their hits to the
// host, and receive the blows that land on them. Each hero is run by their
// own game, and characters, items and progress stay on each player's device.

import * as THREE from 'three';
import { COMBO_ELEMENTS, RUNES, TEAM_COMBOS, WEAPONS, type ClassId, type ComboElement, type DamageElement, type TeamComboDef, type RaceId, type RoleId, type RuneId, type SubclassId } from '../data/defs';
import { SONG, SONGS, type SongId } from '../rules/weapons';
import { BURST_COLOR, BURSTS, type Burst } from '../rules/power';
import { BOSSES, ENEMIES, TRIALS, type BossId, type EnemyId } from '../data/world';
import { mainWeapon } from '../rules/combat';
import { newAnim, strideRate, type AttackStyle } from './anim';
import { allyModel, Boss, Enemy, STATUS_KEYS, newStatus, type AllyKind, type MirrorSample, type Model } from './entities';
import { makeBoss } from './bosses';
import { animateHumanoid, type Rig } from './humanoid';
import type { Hero } from './hero';
import { buildBoat, disposeObject } from './models';
import { DEFAULT_SERVER, Net, type ServerMsg } from './net';
import { attachGear, BLADE, buildPlayerRig, chargeSparks, ELEMENT_COLOR, heroDressed, limbTrail, poseBowString, RAGE_RED, RIDER_HIP, TIMING } from './player';
import { decodeOutfit, encodeOutfit, isPlain, outfitKey } from '../rules/outfit';
import { rankOf } from '../rules/pvp';
import { animateHorse, buildHorse, SEAT, type HorseRig } from './horse';
import { COATS, HORSE } from '../rules/horse';
import { WATER_LEVEL } from './terrain';
import type { Game, ProjectileKind, ProjectileSpec } from './game';

export type CoopRole = 'off' | 'host' | 'guest';

/** Messages go out in bundles this often (the server allows 90 a second per player). */
const SEND_EVERY = 1 / 12;
/** Others are drawn this far in the past so their motion can be smoothed between updates. */
const INTERP = 0.13;
/** The host tells each guest about monsters within this many metres of them. */
const RANGE = 150;
/** A guest forgets a monster it has not heard about for this long. */
const MIRROR_TIMEOUT = 2.5;
/** Heroes this close to a kill share its rewards. */
const SHARE_RANGE = 70;
const MAX_SNAPSHOT = 70;

const STYLES: AttackStyle[] = [
  'slash', 'slash2', 'slash3', 'overhead', 'thrust', 'spin', 'heavy', 'cast', 'bow', 'throw', 'roar',
  'bite', 'claw', 'sting', 'sweep', 'charge', 'slam', 'leap', 'stomp', 'volley', 'ring', 'summon', 'teleport', 'strikes', 'combo',
  // The great foes' moves (appended: the indices above must not move).
  'breath', 'gust', 'flight', 'strike', 'tail', 'dive', 'wave', 'whirlpool', 'trident', 'geyser', 'reap', 'drain', 'web',
  // Added later: new entries go on the end so indexes stay stable.
  'cleave', 'strum', 'song', 'blow',
  // The Monk, the Sorcerer and the Rogue.
  'jab', 'cross', 'kick', 'palm', 'flurry', 'meditate', 'cyclone', 'channel', 'parry',
];
const STYLE_INDEX = new Map(STYLES.map((s, i) => [s, i]));
const PET_KINDS: AllyKind[] = ['wolf', 'boar', 'scorpion', 'magma-hound', 'drake', 'imp', 'lizard', 'shade'];
const PROJECTILES = new Set<ProjectileKind>(['arrow', 'fireball', 'orb', 'water', 'bolt', 'axe', 'knife', 'wand']);
const ELEMENTS = new Set<DamageElement>(['fire', 'water', 'wind', 'earth', 'physical', 'lightning', 'dark', 'light', 'true']);
const CLASSES = new Set<ClassId>(['warrior', 'ranger', 'mage', 'monk', 'sorcerer', 'rogue']);
/** Subclasses that change how a hero looks (the newer classes dress for their path). */
const LOOK_SUBCLASSES = new Set<SubclassId>(['ironfist', 'windwalker', 'darkmage', 'lightmage', 'shadow', 'duelist']);
const RACES = new Set<RaceId>(['elf', 'draco', 'human', 'zombie', 'angelic', 'orc', 'ancient']);
const ROLES = new Set<RoleId>(['historian', 'blacksmith', 'sailor', 'darkslayer', 'knight', 'assassin']);

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const vec = (v: THREE.Vector3): [number, number, number] => [r2(v.x), r2(v.y), r2(v.z)];
const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const str = (x: unknown) => (typeof x === 'string' ? x : '');
/** A rune id from the wire (own keys only, so 'toString' is no rune). */
const runeOf = (x: unknown) => (Object.hasOwn(RUNES, str(x)) ? (str(x) as RuneId) : undefined);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const now = () => performance.now() / 1000;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export type Msg = Record<string, unknown> & { k: string };

/** What a kill is worth; the host sends it to everyone. */
export interface KillInfo {
  /** Monster id, or the boss id for a boss. */
  id: string;
  boss: boolean;
  xp: number;
  gold: number;
  x: number;
  z: number;
  /** Ids of the players who hurt it. */
  by: number[];
  /** Its level (with any level bonus) and whether a boss summoned it; older hosts leave these out. */
  lv?: number;
  minion?: boolean;
  /** A great foe's difficulty tier (older hosts leave it out). */
  tier?: number;
}

// ------------------------------------------------------------ remote hero --

interface HeroSample {
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  attack: number;
  style: AttackStyle;
  draw: number;
  rolling: number;
  /** What the roll is: a roll, a dash, a backflip or an air flip (AnimState.rollKind). */
  rollKind: number;
  /** Holding a move's wind-up (charging a power strike), what it will burst with, and how charged it is. */
  windup: number;
  charge: Burst | undefined;
  chargeLevel: number;
  fury: number;
  flags: number;
  /** Their horse's coat while it is out (-1: none), and where it stands when nobody rides it. */
  horse: number;
  horseAt: number[] | null;
}

interface Pet {
  kind: AllyKind;
  model: Model;
  anim: ReturnType<typeof newAnim>;
  pos: THREE.Vector3;
  want: THREE.Vector3;
  yaw: number;
  attack: number;
}

/** A friend's hero, drawn from the updates their game sends. */
export class RemoteHero implements Hero {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  alive = true;
  radius = 0.45;
  crouching = false;
  roleId: RoleId = 'historian';
  classId: ClassId = 'warrior';
  subclassId: SubclassId | null = null;
  raceId: RaceId = 'human';
  hp = 100;
  maxHp = 100;
  level = 1;
  stealth = 1;
  /** Inside a trial's fog (as their game last said). */
  inTrial = false;
  /** Their game knows player-versus-player; their glory; war mode on. */
  pvp = false;
  glory = 0;
  war = false;
  /** We fight them now (their nametag turns red). */
  hostile = false;
  weaponId = '';
  weaponRune: RuneId | undefined;
  rig: Rig | null = null;
  /** Their horse while they ride (and its coat). */
  private horse: HorseRig | null = null;
  private horseCoat = -1;
  anim = newAnim();
  private weapon: THREE.Object3D | null = null;
  private tag: THREE.Sprite | null = null;
  private boat: THREE.Object3D | null = null;
  private samples: HeroSample[] = [];
  private latest: HeroSample | null = null;
  private pets: Pet[] = [];
  private view = new THREE.Vector3();
  private tv = new THREE.Vector3();
  private tv2 = new THREE.Vector3();
  private looks = '';

  constructor(public id: number, public name: string, private scene: THREE.Scene) {}

  center(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + (this.crouching ? 0.8 : 1.15), this.pos.z);
  }

  stealthFactor() {
    return this.stealth;
  }

  get ready() {
    return !!this.rig && !!this.latest;
  }

  /** Who they are: rebuilds the model when their class, race or role is new. */
  setup(m: Msg) {
    const c = str(m.c) as ClassId, r = str(m.r) as RaceId, ro = str(m.ro) as RoleId;
    if (!CLASSES.has(c) || !RACES.has(r) || !ROLES.has(ro)) return;
    this.name = str(m.n).slice(0, 20) || this.name;
    this.level = num(m.lv, this.level);
    this.pvp = num(m.pv) === 1;
    this.glory = Math.max(0, num(m.gl));
    this.classId = c;
    this.raceId = r;
    this.roleId = ro;
    const sc = str(m.sc) as SubclassId;
    this.subclassId = LOOK_SUBCLASSES.has(sc) ? sc : null;
    // A zombie shambles unless its player stood it up straight.
    const hunched = num(m.hu, 1) !== 0;
    // Their outfit (garments and colours), if they wear one; older builds send none.
    const dressed = decodeOutfit(m.o);
    const looks = `${c}/${this.subclassId}/${r}/${ro}/${hunched}/${outfitKey(dressed)}`;
    if (looks !== this.looks) {
      this.looks = looks;
      this.disposeModel();
      const rig = buildPlayerRig({ classId: c, subclassId: this.subclassId, raceId: r, roleId: ro, hunched }, dressed);
      rig.root.traverse((o) => (o.castShadow = true));
      rig.root.visible = false;
      this.rig = rig;
      this.weaponId = '';
      this.scene.add(rig.root);
    }
    this.setWeapon(str(m.w), str(m.wr));
    this.makeTag();
  }

  private setWeapon(id: string, runeId: string) {
    const rune = runeOf(runeId);
    if (!this.rig || (id === this.weaponId && rune === this.weaponRune) || !WEAPONS[id]) return;
    this.weaponId = id;
    this.weaponRune = rune;
    for (const hand of [this.rig.handL, this.rig.handR]) {
      for (const child of [...hand.children]) {
        if (child.userData.gear) {
          child.removeFromParent();
          disposeObject(child);
        }
      }
    }
    const gear = attachGear(this.rig, this.classId, id, rune);
    gear.weapon.userData.gear = true;
    if (gear.shield) gear.shield.userData.gear = true;
    this.weapon = gear.weapon;
  }

  private makeTag() {
    if (!this.rig) return;
    if (this.tag) {
      this.tag.removeFromParent();
      (this.tag.material as THREE.SpriteMaterial).map?.dispose();
      this.tag.material.dispose();
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '600 30px Cinzel, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    const text = `${this.hostile ? '⚔ ' : ''}${this.name}  ${this.level}`;
    ctx.strokeText(text, 128, 34);
    ctx.fillStyle = this.hostile ? '#ff6a58' : '#9fe0ff';
    ctx.fillText(text, 128, 34);
    // An arena rank under the name, once they have one.
    const rank = rankOf(this.glory);
    if (rank.index > 0) {
      ctx.font = 'italic 600 21px Cinzel, Georgia, serif';
      ctx.lineWidth = 5;
      ctx.strokeText(rank.title, 128, 70);
      ctx.fillStyle = '#f0c870';
      ctx.fillText(rank.title, 128, 70);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    tag.scale.set(2.2, 0.825, 1);
    tag.position.y = 2.31;
    tag.renderOrder = 5;
    this.rig.root.add(tag);
    this.tag = tag;
  }

  /** We start (or stop) fighting them: their nametag says so. */
  setHostile(on: boolean) {
    if (on === this.hostile) return;
    this.hostile = on;
    this.makeTag();
  }

  /** A state update from their game. */
  receive(m: Msg, t: number) {
    const p = arr(m.p), v = arr(m.v), a = arr(m.a);
    const s: HeroSample = {
      t,
      x: num(p[0]), y: num(p[1]), z: num(p[2]),
      vx: num(v[0]), vy: num(v[1]), vz: num(v[2]),
      yaw: num(m.y),
      attack: num(a[0], -1),
      style: STYLES[num(a[1])] ?? 'slash',
      draw: num(a[2]),
      rolling: num(a[3], -1),
      rollKind: Math.max(0, Math.min(3, Math.round(num(a[7])))),
      windup: Math.max(0, Math.min(1, num(a[8]))),
      charge: BURSTS[num(a[9], -1)],
      chargeLevel: Math.max(0, Math.min(1, num(a[10]))),
      fury: num(a[4]),
      flags: num(a[6]),
      horse: Math.min(COATS.length - 1, Math.round(num(m.hc, -1))),
      horseAt: Array.isArray(m.ha) ? arr(m.ha).slice(0, 5).map((x) => num(x)) : null,
    };
    if (!this.latest) this.pos.set(s.x, s.y, s.z);
    this.latest = s;
    this.samples.push(s);
    if (this.samples.length > 8) this.samples.shift();
    const hp = num(m.hp, this.hp);
    if (hp < this.hp - 0.5) this.anim.hurt = 1;
    this.hp = hp;
    this.maxHp = Math.max(1, num(m.mh, this.maxHp));
    const alive = num(m.al, 1) === 1;
    if (alive !== this.alive) this.anim.dead = alive ? -1 : 0;
    this.alive = alive;
    this.stealth = Math.max(0, Math.min(1, num(m.sf, 1)));
    this.crouching = (s.flags & 2) !== 0;
    this.war = (s.flags & 2048) !== 0;
    this.inTrial = num(m.it) === 1;
    this.anim.landing = Math.max(this.anim.landing, num(a[5]));
    const lv = num(m.lv, this.level);
    if (lv !== this.level) {
      this.level = lv;
      this.makeTag();
    }
    this.setWeapon(str(m.w), str(m.wr));
    this.receivePets(arr(m.pt));
  }

  private receivePets(list: unknown[]) {
    for (let i = 0; i < Math.min(list.length, 6); i++) {
      const e = arr(list[i]);
      const kind = PET_KINDS[num(e[0], -1)];
      if (!kind) continue;
      let pet = this.pets[i];
      if (pet && pet.kind !== kind) {
        this.scene.remove(pet.model.root);
        disposeObject(pet.model.root);
        pet = undefined!;
      }
      if (!pet) {
        const model = allyModel(kind);
        model.root.traverse((o) => (o.castShadow = true));
        this.scene.add(model.root);
        const at = new THREE.Vector3(num(e[1]), num(e[2]), num(e[3]));
        pet = { kind, model, anim: newAnim(), pos: at.clone(), want: at, yaw: num(e[4]), attack: -1 };
        pet.anim.attackStyle = kind === 'imp' ? 'throw' : kind === 'drake' ? 'volley' : kind === 'scorpion' ? 'sting' : 'bite';
        this.pets[i] = pet;
      }
      pet.want.set(num(e[1]), num(e[2]), num(e[3]));
      pet.yaw = num(e[4]);
      pet.attack = num(e[5], -1);
    }
    while (this.pets.length > Math.min(list.length, 6)) {
      const pet = this.pets.pop()!;
      this.scene.remove(pet.model.root);
      disposeObject(pet.model.root);
    }
  }

  /** Moves and animates the model, drawing it `INTERP` behind the newest update. */
  update(dt: number, g: Game, t: number) {
    const L = this.latest;
    const rig = this.rig;
    if (!L || !rig) return;
    // Where they are now, as best we know (monsters chase this).
    const ex = Math.min(0.25, Math.max(0, t - L.t));
    this.pos.set(L.x + L.vx * ex, L.y, L.z + L.vz * ex);
    this.vel.set(L.vx, L.vy, L.vz);
    this.yaw = L.yaw;

    // Where to draw them: between the two updates around (t - INTERP).
    const at = t - INTERP;
    const s = this.samples;
    let j = -1;
    for (let k = s.length - 1; k >= 0; k--) {
      if (s[k].t <= at) {
        j = k;
        break;
      }
    }
    const A = s[Math.max(0, j)];
    const B = j >= 0 && j < s.length - 1 ? s[j + 1] : A;
    const span = B.t - A.t;
    const k = j < 0 ? 0 : span > 1e-4 ? Math.min(1, (at - A.t) / span) : 1;
    const view = this.view.set(A.x + (B.x - A.x) * k, A.y + (B.y - A.y) * k, A.z + (B.z - A.z) * k);
    if (j === s.length - 1) view.set(A.x + A.vx * Math.min(0.2, at - A.t), A.y, A.z + A.vz * Math.min(0.2, at - A.t));
    const yaw = A.yaw + wrap(B.yaw - A.yaw) * k;
    const vx = A.vx + (B.vx - A.vx) * k, vz = A.vz + (B.vz - A.vz) * k;
    while (s.length > 2 && s[1].t <= at) s.shift();

    const a = this.anim;
    const f = A.flags;
    a.t += dt;
    const speed = Math.hypot(vx, vz);
    const sailing = (f & 32) !== 0;
    a.speed = sailing ? 0 : speed;
    a.moving = sailing ? 0 : Math.min(1, speed / 4);
    a.phase += speed * dt * strideRate(speed);
    if (speed > 0.05 && !sailing) {
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      const kk = Math.min(1, speed / 2.5) / speed;
      a.moveX = (vx * cy - vz * sy) * kk;
      a.moveZ = (vx * sy + vz * cy) * kk;
    } else a.moveX = a.moveZ = 0;
    a.attack = A.attack >= 0 && B.attack >= A.attack ? A.attack + (B.attack - A.attack) * k : A.attack;
    a.attackStyle = A.attack >= 0 ? A.style : B.style;
    a.draw = A.draw + (B.draw - A.draw) * k;
    a.rolling = A.rolling >= 0 && B.rolling >= A.rolling ? A.rolling + (B.rolling - A.rolling) * k : A.rolling;
    a.rollKind = A.rolling >= 0 ? A.rollKind : B.rollKind;
    a.fury = A.fury;
    a.windup = B.windup;
    // A friend charging a power strike: sparks gather in its colour.
    if (B.charge && this.alive) chargeSparks(g, this.center(this.tv), BURST_COLOR[B.charge], B.chargeLevel);
    a.blocking = (f & 1) !== 0;
    a.crouching = (f & 2) !== 0 || sailing;
    a.swimming = (f & 4) !== 0;
    a.flying = (f & 8) !== 0;
    a.airborne = (f & 16) !== 0;
    if (this.alive) a.dead = -1;
    else a.dead += dt;
    if (rig.wings) {
      const w = rig.wings.userData;
      w.enabled = (f & 128) !== 0;
      // An angel's wing beat and glide.
      w.spread = (f & 256) !== 0;
      w.soar = (f & 512) !== 0;
    }

    const root = rig.root;
    root.position.copy(view);
    root.rotation.y = yaw;
    root.visible = (f & 64) === 0 || Math.floor(a.t * 6) % 3 !== 0;
    if (sailing) {
      if (!this.boat) {
        this.boat = buildBoat();
        this.scene.add(this.boat);
      }
      this.boat.visible = true;
      this.boat.position.set(view.x, WATER_LEVEL + 0.05 + Math.sin(a.t * 2) * 0.06, view.z);
      this.boat.rotation.y = yaw;
      root.position.y = WATER_LEVEL + 0.35;
    } else if (this.boat) this.boat.visible = false;
    // Their horse: under them as they ride (they sit the saddle), or standing (or running) where it is.
    const riding = (f & 1024) !== 0 && A.horse >= 0;
    a.riding = riding ? Math.min(1, speed / HORSE.gallop) : -1;
    if (A.horse >= 0 && (riding || A.horseAt)) {
      if (!this.horse || this.horseCoat !== A.horse) {
        this.dropHorse();
        this.horse = buildHorse(A.horse);
        this.horseCoat = A.horse;
        this.scene.add(this.horse.root);
      }
      const h = this.horse;
      h.root.visible = riding ? root.visible : true;
      if (riding) {
        h.root.position.copy(view);
        h.root.rotation.y = yaw;
        animateHorse(h, dt, speed, a.t);
        a.speed = a.moving = a.moveX = a.moveZ = 0;
        a.airborne = a.crouching = false;
        a.phase = h.phase;
        root.position.y = view.y + SEAT + h.bob - RIDER_HIP;
      } else {
        const P = A.horseAt!, Q = B.horseAt ?? P;
        h.root.position.set(P[0] + (Q[0] - P[0]) * k, P[1] + (Q[1] - P[1]) * k, P[2] + (Q[2] - P[2]) * k);
        h.root.rotation.y = P[3] + wrap(Q[3] - P[3]) * k;
        animateHorse(h, dt, P[4] + (Q[4] - P[4]) * k, a.t);
      }
    } else if (this.horse) this.horse.root.visible = false;
    animateHumanoid(rig, a);
    const weapon = this.weapon;
    if (weapon && WEAPONS[this.weaponId]?.kind === 'bow') poseBowString(rig, weapon, a, true);
    this.trail(g);
    this.updatePets(dt);
  }

  /** The weapon trail through the active part of a swing, as the hero's own game draws it. */
  private trail(g: Game) {
    const a = this.anim;
    const w = this.weapon;
    const def = WEAPONS[this.weaponId];
    if (!w || !def || def.kind === 'bow' || a.attack < 0) return;
    // A monk's fists and feet streak as their own game draws them.
    if (this.rig && (def.kind === 'wraps' || a.attackStyle === 'flurry' || a.attackStyle === 'cyclone')) {
      return limbTrail(g, this.rig, a.attackStyle, a.attack, this.subclassId === 'ironfist' ? 0xffc27a : this.subclassId === 'windwalker' ? 0xa8fff0 : 0x9af0d0);
    }
    const tm = TIMING[a.attackStyle];
    if (!tm || a.attackStyle === 'cast' || a.attackStyle === 'roar' || a.attackStyle === 'bow') return;
    if (a.attack < tm.from - 0.04 || a.attack > (a.attackStyle === 'throw' ? tm.hit : tm.to)) return;
    const [b0, b1] = BLADE[def.kind];
    if (!b1) return;
    w.updateWorldMatrix(true, false);
    const base = w.localToWorld(this.tv.set(0, b0, 0));
    const tip = w.localToWorld(this.tv2.set(0, b1, 0));
    const color = a.fury > 0.5 ? RAGE_RED : this.weaponRune ? RUNES[this.weaponRune].color : def.element === 'physical' && def.legendary ? 0xffd27a : ELEMENT_COLOR[def.element];
    const spin = a.attackStyle === 'spin';
    g.fx.trailPoint(w, base, tip, color, spin ? 0.7 : 0.55, spin ? 0.5 : 0.22);
  }

  private updatePets(dt: number) {
    for (const pet of this.pets) {
      const before = pet.pos.clone();
      pet.pos.lerp(pet.want, Math.min(1, dt * 8));
      if (pet.pos.distanceToSquared(pet.want) > 400) pet.pos.copy(pet.want);
      const sp = before.distanceTo(pet.pos) / Math.max(1e-3, dt);
      const an = pet.anim;
      an.t += dt;
      an.speed = sp;
      an.moving = Math.min(1, sp / 3);
      an.moveZ = an.moving;
      an.moveX = 0;
      an.phase += sp * dt * 2.2;
      an.attack = pet.attack;
      pet.model.root.position.copy(pet.pos);
      pet.model.root.rotation.y = pet.yaw;
      pet.model.animate(an);
    }
  }

  private disposeModel() {
    if (this.rig) {
      this.scene.remove(this.rig.root);
      disposeObject(this.rig.root);
    }
    this.rig = null;
    this.weapon = null;
    this.tag = null;
  }

  private dropHorse() {
    if (!this.horse) return;
    this.scene.remove(this.horse.root);
    disposeObject(this.horse.root);
    this.horse = null;
    this.horseCoat = -1;
  }

  dispose() {
    this.disposeModel();
    this.dropHorse();
    if (this.boat) {
      this.scene.remove(this.boat);
      disposeObject(this.boat);
      this.boat = null;
    }
    for (const pet of this.pets) {
      this.scene.remove(pet.model.root);
      disposeObject(pet.model.root);
    }
    this.pets = [];
  }
}

// -------------------------------------------------------------- the link --

export class Coop {
  role: CoopRole = 'off';
  /** True while connecting (waking the server can take a minute). */
  busy = false;
  /** A line for the Co-op menu. */
  status = 'Not connected.';
  room = '';
  myId = 0;
  hostId = 0;
  remotes = new Map<number, RemoteHero>();
  /** Called when anything the menu shows changes. */
  onChange: () => void = () => {};
  private net = new Net();
  /** Real time of the next bundle (slow frames must not slow the link). */
  private nextSend = 0;
  private out = new Map<number | 'all' | 'host', Msg[]>();
  /** Guest: copies of the host's monsters by their shared id. */
  private mirrors = new Map<number, Enemy>();
  private need = new Set<number>();
  private needAt = 0;
  /** Host: which monsters each guest has been told about. */
  private known = new Map<number, Set<number>>();
  private snapTick = 0;
  /** Guest: the host's clock (game minutes) and when we heard it, to run the day in step. */
  private hostMinutes = 0;
  private hostMinutesAt = 0;
  /** The name friends know this player by. */
  myName = 'Hero';

  constructor(private g: Game) {
    this.net.onMessage = (m) => this.onServer(m);
    this.net.onDrop = () => {
      if (this.role !== 'off') this.backToSolo('Lost the connection to the co-op server.');
    };
  }

  get active() {
    return this.role !== 'off';
  }
  get isHost() {
    return this.role === 'host';
  }
  get isGuest() {
    return this.role === 'guest';
  }
  /** True when the world is being shared with someone. */
  get sharing() {
    return this.role === 'guest' || (this.role === 'host' && this.remotes.size > 0);
  }

  // ------------------------------------------------------------ rooms --

  async host(server: string, name: string) {
    this.myName = name;
    await this.open(server, () => this.net.create(name));
  }

  async join(server: string, code: string, name: string) {
    const room = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (room.length < 4) {
      this.setStatus('Type the room code your friend sees.');
      return;
    }
    this.myName = name;
    await this.open(server, () => this.net.join(room, name));
  }

  private async open(server: string, then: () => void) {
    if (this.busy) return;
    if (this.active) this.leave();
    this.busy = true;
    try {
      await this.net.connect(server || DEFAULT_SERVER, (s) => this.setStatus(s));
      this.setStatus('Opening the room…');
      then();
    } catch (err) {
      this.busy = false;
      this.net.close();
      const blocked = location.hostname.endsWith('claude.ai') || location.hostname.endsWith('claudeusercontent.com');
      this.setStatus(blocked ? 'This page cannot reach the internet. Play co-op from the GitHub Pages link below.' : (err as Error).message);
    }
  }

  leave() {
    if (!this.active && !this.busy) return;
    this.net.close();
    this.backToSolo('You left the co-op game.');
  }

  /** The game is closing: just hang up. */
  shutdown() {
    this.net.close();
    this.role = 'off';
    this.busy = false;
  }

  private setStatus(s: string) {
    this.status = s;
    this.onChange();
  }

  private onServer(m: ServerMsg) {
    const g = this.g;
    switch (m.t) {
      case 'created':
        this.busy = false;
        this.role = 'host';
        this.room = m.room;
        this.myId = this.hostId = m.id;
        this.sendHello('all');
        this.setStatus(`Hosting room ${m.room}. Friends join with this code.`);
        g.hud.toast(`Co-op room ${m.room} is open.`, 'skill');
        break;
      case 'joined':
        this.busy = false;
        this.role = 'guest';
        this.room = m.room;
        this.myId = m.id;
        this.hostId = m.hostId;
        for (const p of m.players) if (p.id !== m.id) this.addRemote(p.id, p.name);
        this.becomeGuest();
        this.sendHello('all');
        this.setStatus(`Joined room ${m.room}.`);
        g.hud.toast(`Joined ${this.remotes.get(m.hostId)?.name ?? 'the host'}'s world.`, 'skill');
        break;
      case 'peer-join':
        this.addRemote(m.id, m.name);
        this.sendHello(m.id);
        if (this.isHost && g.activeTrial) this.queue(m.id, { k: 'trial', id: g.activeTrial.id, in: [] });
        g.hud.toast(`${m.name} joined.`, 'skill');
        this.onChange();
        break;
      case 'peer-leave': {
        const r = this.remotes.get(m.id);
        if (r) g.hud.toast(`${r.name} left.`);
        this.removeRemote(m.id);
        this.onChange();
        break;
      }
      case 'closed':
        this.net.close();
        this.backToSolo(m.reason === 'host-left' ? 'The host closed the game. Back to your own world.' : 'The host disconnected. Back to your own world.');
        break;
      case 'error':
        this.busy = false;
        if (!this.active) this.net.close();
        this.setStatus(m.message);
        g.hud.toast(m.message, 'warn');
        break;
      case 'msg':
        this.onPeer(m.from, m.d);
        break;
    }
  }

  private addRemote(id: number, name: string) {
    if (this.remotes.has(id)) return;
    this.remotes.set(id, new RemoteHero(id, name, this.g.scene));
    this.g.refreshHeroes();
  }

  private removeRemote(id: number) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.g.pvp.onLeave(id);
    r.dispose();
    this.remotes.delete(id);
    this.known.delete(id);
    this.out.delete(id);
    this.g.refreshHeroes();
  }

  /** Guest: hand the world over to the host (their monsters replace ours). */
  private becomeGuest() {
    const g = this.g;
    if (g.activeTrial) g.endTrial(false);
    g.clearEnemies();
    this.mirrors.clear();
    this.need.clear();
  }

  private backToSolo(message: string) {
    const g = this.g;
    const wasGuest = this.role === 'guest';
    g.pvp.reset();
    this.role = 'off';
    this.busy = false;
    this.room = '';
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this.out.clear();
    this.known.clear();
    if (wasGuest) {
      if (g.activeTrial) g.endTrial(false);
      g.clearEnemies();
      this.mirrors.clear();
      g.spawnAll(true);
    }
    this.myId = this.hostId = 0;
    this.hostMinutesAt = 0;
    g.refreshHeroes();
    this.setStatus(message);
    g.hud.toast(message);
  }

  // ---------------------------------------------------------- sending --

  private queue(to: number | 'all' | 'host', m: Msg) {
    let list = this.out.get(to);
    if (!list) this.out.set(to, (list = []));
    list.push(m);
  }

  private flush() {
    for (const [to, list] of this.out) {
      if (!list.length) continue;
      // Keep each bundle well under the server's size limit.
      for (let i = 0; i < list.length; i += 40) this.net.send(to, { k: 'b', m: list.slice(i, i + 40) });
    }
    this.out.clear();
  }

  private sendHello(to: number | 'all') {
    const c = this.g.player.c;
    const dressed = heroDressed(c);
    this.queue(to, {
      k: 'hi', n: this.myName, c: c.classId, sc: c.subclassId ?? '', r: c.raceId, ro: c.roleId, hu: c.hunched === false ? 0 : 1, lv: c.level, w: mainWeapon(c).id, wr: mainWeapon(c).rune ?? '',
      pv: 1, gl: c.pvp.glory,
      ...(isPlain(dressed) ? {} : { o: encodeOutfit(dressed) }),
    });
  }

  private lookSentAt = -9;
  private lookTimer = 0;

  /** A new outfit kept in the wardrobe: friends see it (at most every 2 s; the latest one wins). */
  announceLook() {
    if (!this.active) return;
    clearTimeout(this.lookTimer);
    const wait = this.lookSentAt + 2 - now();
    if (wait <= 0) {
      this.lookSentAt = now();
      this.sendHello('all');
    } else this.lookTimer = window.setTimeout(() => this.announceLook(), wait * 1000);
  }

  /** Player-versus-player messages (engine/pvp.ts). */
  pvpSend(to: number | 'all', m: Msg) {
    if (this.active) this.queue(to, m);
  }

  /** Our hero's state, for everyone else to draw. */
  private sendState() {
    const g = this.g;
    const p = g.player;
    const a = p.anim;
    const w = p.rig.wings?.userData;
    const flags = (a.blocking ? 1 : 0) | (p.crouching ? 2 : 0) | (a.swimming ? 4 : 0) | (a.flying ? 8 : 0) | (a.airborne ? 16 : 0) | (p.sailing ? 32 : 0) | (p.unseen ? 64 : 0) |
      (w?.enabled ? 128 : 0) | (w?.spread ? 256 : 0) | (w?.soar ? 512 : 0) | (p.riding ? 1024 : 0) | (g.pvp.war ? 2048 : 0);
    const pets: number[][] = [];
    for (const al of g.allies) {
      if (pets.length >= 6 || !al.alive) continue;
      pets.push([PET_KINDS.indexOf(al.kind), r2(al.pos.x), r2(al.pos.y), r2(al.pos.z), r2(al.yaw), r2(al.anim.attack)]);
    }
    this.queue('all', {
      k: 'st',
      p: vec(p.pos),
      v: [r2(p.vel.x), r2(p.vel.y), r2(p.vel.z)],
      y: r2(p.yaw),
      a: [r2(a.attack), STYLE_INDEX.get(a.attackStyle) ?? 0, r2(a.draw), r2(a.rolling), r2(a.fury), r2(a.landing), flags, a.rollKind, r2(a.windup), p.charge ? BURSTS.indexOf(p.charge.burst) : -1, p.charge ? r2(p.charge.level) : 0],
      hp: r1(p.hp),
      mh: Math.round(p.maxHp),
      al: p.alive ? 1 : 0,
      sf: r2(p.stealthFactor()),
      lv: p.c.level,
      w: mainWeapon(p.c).id,
      wr: mainWeapon(p.c).rune ?? '',
      it: g.inTrial ? 1 : 0,
      hc: p.horse ? p.c.steed.coat : -1,
      ha: p.horse && !p.riding ? [r2(p.horse.pos.x), r2(p.horse.pos.y), r2(p.horse.pos.z), r2(p.horse.yaw), r2(p.horse.speed)] : undefined,
      pt: pets,
    });
  }

  /** Host: each guest hears about the monsters near them. */
  private sendSnapshots() {
    const g = this.g;
    this.snapTick++;
    for (const r of this.remotes.values()) {
      if (!r.ready) continue;
      let known = this.known.get(r.id);
      if (!known || known.size > 600) this.known.set(r.id, (known = new Set()));
      const near: [number, Enemy][] = [];
      for (const e of g.enemies) {
        if (!e.alive || e.pvpId) continue;
        const d = Math.abs(e.pos.x - r.pos.x) + Math.abs(e.pos.z - r.pos.z);
        if (d < RANGE * 1.3 || e instanceof Boss) near.push([e instanceof Boss ? -1 : d, e]);
      }
      if (near.length > MAX_SNAPSHOT) near.sort((x, y) => x[0] - y[0]).length = MAX_SNAPSHOT;
      const list: unknown[] = [];
      const fresh: unknown[] = [];
      for (const [, e] of near) {
        // Monsters standing idle are sent a third as often (it saves the free server's bandwidth).
        const idle = !e.aware && e.anim.speed < 0.1 && e.anim.attack < 0 && !(e instanceof Boss);
        if (idle && known.has(e.nid) && (this.snapTick + e.nid) % 3 !== 0) continue;
        if (!known.has(e.nid)) {
          known.add(e.nid);
          if (e instanceof Boss) fresh.push([e.nid, 'boss', e.bdef.id, e.place || (g.activeTrial?.id ?? ''), Math.round(e.maxHp)]);
          else fresh.push([e.nid, e.def.id, e.levelBonus, Math.round(e.maxHp), e.summoned ? 1 : 0]);
        }
        const a = e.anim;
        const boss = e instanceof Boss ? e : null;
        const flags = (e.aware ? 1 : 0) | (e.model.root.visible || !boss ? 2 : 0) | (boss && boss.phase === 2 ? 4 : 0);
        let status: number[] | 0 = 0;
        for (const k of STATUS_KEYS) {
          if (e.status[k] > 0) {
            status = STATUS_KEYS.map((key) => r1(e.status[key]));
            break;
          }
        }
        list.push([e.nid, r2(e.pos.x), r2(e.pos.y), r2(e.pos.z), r2(e.yaw), r1(e.hp), flags, r2(a.attack), r2(a.windup), STYLE_INDEX.get(a.attackStyle) ?? 0, r2(a.draw), r2(a.fury), status, Math.round(e.damageDealt)]);
      }
      this.queue(r.id, { k: 'sn', gm: r1(g.state.gameMinutes), e: list, nw: fresh });
    }
  }

  // ------------------------------------------------------ game -> net --

  /** An effect (see SharedFx) for the players close enough to see it. */
  shareFx(f: string, a: unknown[], x: number, z: number) {
    if (!this.sharing) return;
    const m: Msg = { k: 'fx', f, a };
    if (this.isGuest) return this.queue('all', m);
    for (const r of this.remotes.values()) if (Math.abs(r.pos.x - x) + Math.abs(r.pos.z - z) < 220) this.queue(r.id, m);
  }

  /** A projectile: monsters' shots can hit any hero; heroes' shots are only shown to the others. */
  shareProjectile(spec: ProjectileSpec) {
    if (!this.sharing || spec.owner === 'remote') return;
    const m: Msg = {
      k: 'pj',
      o: spec.owner === 'enemy' ? 1 : 0,
      kd: spec.kind,
      f: vec(spec.from),
      to: vec(spec.to),
      s: r2(spec.speed),
      gr: r2(spec.gravity),
      d: r1(spec.damage),
      e: spec.element,
      src: spec.source instanceof Enemy ? spec.source.nid : 0,
      x: spec.explode ?? 0,
      b: spec.burn ? 1 : 0,
      cl: spec.color ?? 0,
      ru: spec.rune ?? '',
      bk: spec.boomerang ? 1 : 0,
      bu: spec.burst ? BURSTS.indexOf(spec.burst.kind) : -1,
    };
    if (spec.owner !== 'enemy') return this.queue('all', m);
    if (!this.isHost) return;
    for (const r of this.remotes.values()) if (Math.abs(r.pos.x - spec.from.x) + Math.abs(r.pos.z - spec.from.z) < RANGE * 1.3) this.queue(r.id, m);
  }

  /** A song from a lyre or war horn: friends close enough to hear it take it up. */
  shareSong(id: SongId, pos: THREE.Vector3) {
    if (this.sharing) this.queue('all', { k: 'song', s: id, p: vec(pos) });
  }

  /** A heal or a ward of light for friends within `radius` of `pos`. */
  shareBuff(kind: 'mend' | 'ward' | 'shout', pos: THREE.Vector3, amount: number, radius: number) {
    if (this.sharing) this.queue('all', { k: 'buff', b: kind, p: vec(pos), a: r1(amount), r: r1(radius) });
  }

  /** Guest: knock one of the host's monsters back (and up); the host's game moves it. */
  shove(e: Enemy, dx: number, dz: number, force: number, up: number) {
    if (this.isGuest && e.net) this.queue('host', { k: 'shv', id: e.nid, x: r2(dx), z: r2(dz), f: r1(force), u: r1(up) });
  }

  /** Our hero vanished: the host's monsters within `range` (Infinity: all) stop hunting us. */
  dropAggro(range: number) {
    if (this.isGuest) this.queue('host', { k: 'drop', r: Number.isFinite(range) ? r1(range) : 0 });
  }

  /** A whirlwind (spell) for the others to see. */
  shareTornado(pos: THREE.Vector3, radius: number, color: number, life: number, seek: boolean) {
    if (this.sharing) this.queue('all', { k: 'tor', p: vec(pos), r: r2(radius), c: color, l: r2(life), s: seek ? 1 : 0 });
  }

  /** Guest: a blow on one of the host's monsters. */
  hit(e: Enemy, amount: number, element: DamageElement, o: { source?: string; dot?: boolean; quiet?: boolean; tags?: string[] }) {
    this.queue('host', { k: 'hit', id: e.nid, a: r2(amount), e: element, s: o.source ?? '', dt: o.dot ? 1 : 0, q: o.quiet ? 1 : 0, tg: o.tags ?? [] });
  }

  /** Guest: a runed blow brought an element to the host's monster (for team combos). */
  noteElement(e: Enemy, el: ComboElement, amount: number) {
    this.queue('host', { k: 'te', id: e.nid, el, a: r2(amount) });
  }

  /** Host: a team combo went off; every friend sees it (and its heroes mend or drain). */
  teamCombo(def: TeamComboDef, at: THREE.Vector3, heroes: [number, ComboElement][], bonus: number) {
    this.queue('all', { k: 'tc', c: def.id, p: vec(at), h: heroes.map(([id]) => id), el: heroes.map(([, el]) => el), b: r1(bonus) });
  }

  tamed(e: Enemy) {
    if (this.isGuest && e.net) this.queue('host', { k: 'tame', id: e.nid });
  }

  /** Guest: ask the host to begin a trial. */
  requestTrial(id: string) {
    this.queue('host', { k: 'trq', id });
    this.g.hud.toast('Asking the host to begin the trial…');
  }

  /** Host: a blow landed on a friend; their game decides what it does (dodges, blocks). */
  hurt(r: RemoteHero, amount: number, element: DamageElement, source: Enemy | null) {
    this.queue(r.id, { k: 'hurt', a: r1(amount), e: element, s: source?.nid ?? 0 });
  }

  knock(r: RemoteHero, dir: THREE.Vector3, force: number) {
    this.queue(r.id, { k: 'kb', x: r2(dir.x), z: r2(dir.z), f: r1(force) });
  }

  /** Host: a monster died; everyone near (or who hurt it) is rewarded by their own game. */
  killed(e: Enemy, info: KillInfo) {
    this.queue('all', { k: 'kill', nid: e.nid, ...info });
  }

  /** Host: a monster left the world alive (tamed, or cleared from an arena). */
  gone(e: Enemy) {
    if (this.sharing) this.queue('all', { k: 'gone', id: e.nid });
  }

  trialStarted(id: string, inside: number[]) {
    if (this.sharing) this.queue('all', { k: 'trial', id, in: inside });
  }

  trialFailed() {
    if (this.sharing) this.queue('all', { k: 'trend' });
  }

  /** Guest: the copy of a monster is gone from this world. */
  forget(e: Enemy) {
    if (e.net && this.mirrors.get(e.nid) === e) this.mirrors.delete(e.nid);
  }

  /** Should this game reward the local hero for a kill? */
  credited(info: KillInfo) {
    if (!this.sharing) return true;
    const p = this.g.player.pos;
    return info.by.includes(this.myId) || Math.hypot(p.x - info.x, p.z - info.z) < SHARE_RANGE;
  }

  // ------------------------------------------------------ net -> game --

  private onPeer(from: number, d: unknown) {
    if (!d || typeof d !== 'object') return;
    const m = d as Msg;
    if (m.k === 'b') {
      for (const inner of arr(m.m)) if (inner && typeof inner === 'object') this.handle(from, inner as Msg);
    } else this.handle(from, m);
  }

  private handle(from: number, m: Msg) {
    const g = this.g;
    const fromHost = from === this.hostId;
    const r = this.remotes.get(from);
    if (typeof m.k === 'string' && m.k.startsWith('pv')) return g.pvp.handle(from, m);
    switch (m.k) {
      case 'hi':
        r?.setup(m);
        this.joinedWorld(r);
        this.onChange();
        return;
      case 'st':
        r?.receive(m, now());
        this.joinedWorld(r);
        return;
      case 'fx':
        g.sfx.play(str(m.f), arr(m.a));
        return;
      case 'pj':
        return this.onProjectile(m, fromHost, from);
      case 'song': {
        const id = str(m.s) as SongId;
        const p = arr(m.p);
        const pl = g.player;
        if (!Object.hasOwn(SONGS, id) || !pl.alive || g.pvp.hostile(from) || Math.hypot(pl.pos.x - num(p[0]), pl.pos.z - num(p[2])) > SONG.radius) return;
        pl.applySong(g, id, r?.name ?? 'A friend');
        return;
      }
      case 'buff': {
        const p = arr(m.p);
        const pl = g.player;
        if (!pl.alive || g.pvp.hostile(from) || Math.hypot(pl.pos.x - num(p[0]), pl.pos.z - num(p[2])) > Math.min(30, num(m.r, 12))) return;
        const amount = Math.max(0, Math.min(500, num(m.a)));
        if (m.b === 'ward') pl.receiveWard(g, amount, r?.name ?? 'A friend');
        else if (m.b === 'shout') pl.receiveShout(g, amount, r?.name ?? 'A friend');
        else if (m.b === 'mend') pl.receiveMend(g, amount, r?.name ?? 'A friend');
        return;
      }
      case 'tor': {
        const p = arr(m.p);
        g.addTornado(new THREE.Vector3(num(p[0]), num(p[1]), num(p[2])), Math.min(10, num(m.r, 3)), 0, num(m.c, 0x9ab0c8), Math.min(10, num(m.l, 3)), num(m.s) === 1, true);
        return;
      }
    }
    if (this.isHost && r) {
      switch (m.k) {
        case 'hit': {
          const e = this.find(num(m.id));
          const el = str(m.e) as DamageElement;
          if (!e || !ELEMENTS.has(el)) return;
          const source = str(m.s);
          // A deal with the Devil takes the whole life, whatever the guest's copy showed.
          const amount = source === 'devil' ? e.hp + 1 : Math.min(5000, num(m.a));
          g.damageEnemy(e, amount, el, { source: source || 'player', dot: num(m.dt) === 1, quiet: num(m.q) === 1, tags: arr(m.tg).filter((x): x is string => typeof x === 'string'), by: from });
          return;
        }
        case 'te': {
          const e = this.find(num(m.id));
          const el = str(m.el) as ComboElement;
          if (e && COMBO_ELEMENTS.includes(el)) g.teamHit(e, from, el, Math.min(5000, num(m.a)));
          return;
        }
        case 'sts': {
          const e = this.find(num(m.id));
          const key = str(m.s) as (typeof STATUS_KEYS)[number];
          if (e && STATUS_KEYS.includes(key)) e.status[key] = Math.max(e.status[key], Math.min(20, num(m.v)));
          return;
        }
        case 'shv': {
          const e = this.find(num(m.id));
          if (e) e.shove(num(m.x), num(m.z), Math.min(30, num(m.f)), Math.min(14, num(m.u)));
          return;
        }
        case 'drop': {
          // A friend vanished: monsters hunting them (near them, or all) lose the trail.
          const range = num(m.r) || Infinity;
          for (const e of g.enemies) {
            if (!e.alive || e instanceof Boss || !e.aware || e.target !== r || e.pos.distanceTo(r.pos) > range) continue;
            e.aware = false;
            e.awareness = 0;
            e.state = 'return';
          }
          return;
        }
        case 'tame': {
          const e = this.find(num(m.id));
          if (!e || e instanceof Boss) return;
          e.tamed = true;
          g.removeEnemy(e);
          return;
        }
        case 'trq': {
          const t = TRIALS.find((x) => x.id === str(m.id));
          if (!t) return;
          if (g.activeTrial) this.queue(from, { k: 'note', text: 'Another trial is already underway.' });
          else g.startTrial(t, from);
          return;
        }
        case 'need':
          for (const id of arr(m.ids)) this.known.get(from)?.delete(num(id));
          return;
      }
    }
    if (this.isGuest && fromHost) {
      switch (m.k) {
        case 'sn':
          return this.onSnapshot(m);
        case 'hurt': {
          const el = str(m.e) as DamageElement;
          if (ELEMENTS.has(el)) g.damagePlayer(Math.min(2000, num(m.a)), el, this.mirrors.get(num(m.s)) ?? null);
          return;
        }
        case 'kb':
          g.player.knockback(new THREE.Vector3(num(m.x), 0, num(m.z)), Math.min(30, num(m.f)));
          return;
        case 'kill':
          return this.onKill(m);
        case 'gone': {
          const e = this.mirrors.get(num(m.id));
          if (e) g.removeEnemy(e);
          return;
        }
        case 'trial': {
          const t = TRIALS.find((x) => x.id === str(m.id));
          if (t) g.trialBegan(t, arr(m.in).includes(this.myId));
          return;
        }
        case 'trend':
          if (g.activeTrial) {
            g.endTrial(false);
            g.hud.toast('The trial is lost. The fog lifts.');
          }
          return;
        case 'note':
          g.hud.toast(str(m.text).slice(0, 80));
          return;
        case 'tc': {
          const def = TEAM_COMBOS.find((k) => k.id === str(m.c));
          const p = arr(m.p), h = arr(m.h), el = arr(m.el);
          const heroes: [number, ComboElement][] = [];
          for (let i = 0; i < 2; i++) {
            const e = str(el[i]) as ComboElement;
            if (COMBO_ELEMENTS.includes(e)) heroes.push([num(h[i]), e]);
          }
          if (def && heroes.length === 2) g.showTeamCombo(def, new THREE.Vector3(num(p[0]), num(p[1]), num(p[2])), heroes, Math.min(5000, num(m.b)));
          return;
        }
      }
    }
  }

  /** A friend counts as a hero (monsters hunt them) once we know who and where they are. */
  private joinedWorld(r: RemoteHero | undefined) {
    if (r && r.ready && !this.g.heroes.includes(r)) this.g.refreshHeroes();
  }

  private find(nid: number): Enemy | null {
    for (const e of this.g.enemies) if (e.nid === nid && e.alive) return e;
    return null;
  }

  private onProjectile(m: Msg, fromHost: boolean, from: number) {
    const enemy = num(m.o) === 1;
    if (enemy && !(this.isGuest && fromHost)) return;
    const kind = str(m.kd) as ProjectileKind;
    const el = str(m.e) as DamageElement;
    if (!PROJECTILES.has(kind) || !ELEMENTS.has(el)) return;
    const f = arr(m.f), to = arr(m.to);
    this.g.spawnProjectile(
      {
        from: new THREE.Vector3(num(f[0]), num(f[1]), num(f[2])),
        to: new THREE.Vector3(num(to[0]), num(to[1]), num(to[2])),
        speed: Math.max(1, Math.min(200, num(m.s, 30))),
        kind,
        owner: enemy ? 'enemy' : 'remote',
        damage: Math.min(2000, num(m.d)),
        element: el,
        gravity: Math.min(40, num(m.gr)),
        source: enemy ? (this.mirrors.get(num(m.src)) ?? null) : null,
        explode: Math.min(10, num(m.x)) || undefined,
        burn: num(m.b) === 1,
        color: num(m.cl) || undefined,
        // Shown only: a friend's rune glows on their knife, its effect lands in their game.
        rune: runeOf(m.ru),
        // A friend's thunderbolt flies back to them.
        boomerang: num(m.bk) === 1,
        // A friend's charged shot glows (its burst lands in their game, and its effects are shared).
        glowing: BURSTS[num(m.bu, -1)],
        home: () => {
          const r = this.remotes.get(from);
          return r ? r.pos.clone().setY(r.pos.y + 1.3) : null;
        },
      },
      true,
    );
  }

  private onSnapshot(m: Msg) {
    const g = this.g;
    const t = now();
    // Day and night follow the host.
    this.hostMinutes = num(m.gm, g.state.gameMinutes);
    this.hostMinutesAt = t;
    for (const raw of arr(m.nw)) {
      const n = arr(raw);
      const nid = num(n[0]);
      if (!this.mirrors.has(nid)) this.makeMirror(nid, n);
    }
    for (const raw of arr(m.e)) {
      const n = arr(raw);
      const nid = num(n[0]);
      const e = this.mirrors.get(nid);
      if (!e) {
        this.need.add(nid);
        continue;
      }
      const net = e.net!;
      const s: MirrorSample = {
        t,
        x: num(n[1]), y: num(n[2]), z: num(n[3]), yaw: num(n[4]),
        attack: num(n[7], -1), windup: num(n[8]), style: STYLES[num(n[9])] ?? 'slash', draw: num(n[10]), fury: num(n[11]),
      };
      if (!net.samples.length) {
        e.pos.set(s.x, s.y, s.z);
        e.yaw = s.yaw;
      }
      net.samples.push(s);
      if (net.samples.length > 10) net.samples.shift();
      net.seen = t;
      const hp = num(n[5], e.hp);
      // Someone else's blow: flinch.
      if (hp < e.hp - 0.5) {
        e.anim.hurt = Math.max(e.anim.hurt, 0.7);
        e.hitFlash = 0.12;
      }
      e.hp = hp;
      const flags = num(n[6]);
      e.aware = (flags & 1) !== 0;
      net.visible = (flags & 2) !== 0;
      net.phase2 = (flags & 4) !== 0;
      if (e instanceof Boss) e.phase = net.phase2 ? 2 : 1;
      const st = n[12];
      if (Array.isArray(st)) {
        STATUS_KEYS.forEach((k, i) => {
          const v = num(st[i]);
          if (v > e.status[k]) e.status[k] = v;
          net.prevStatus[k] = e.status[k];
        });
      }
      e.damageDealt = num(n[13], e.damageDealt);
    }
  }

  private makeMirror(nid: number, n: unknown[]) {
    const g = this.g;
    let e: Enemy;
    if (n[1] === 'boss') {
      const def = BOSSES[str(n[2]) as BossId];
      // A trial's boss, or a hunted foe in its lair.
      const boss = def ? makeBoss(def, str(n[3])) : null;
      if (!def || !boss) return;
      boss.scaleHealth(num(n[4], def.hp) / def.hp);
      boss.roarLeft = 0;
      e = boss;
      if (!def.mini) g.boss = boss;
    } else {
      const id = str(n[1]) as EnemyId;
      if (!ENEMIES[id]) return;
      e = new Enemy(id, 0, 0);
      e.levelBonus = num(n[2]);
      e.maxHp = e.hp = Math.max(1, num(n[3], e.maxHp));
      e.summoned = num(n[4]) === 1;
    }
    e.nid = nid;
    e.net = { samples: [], seen: now(), visible: true, phase2: false, prevStatus: newStatus() };
    g.enemies.push(e);
    g.scene.add(e.model.root);
    this.mirrors.set(nid, e);
  }

  private onKill(m: Msg) {
    const g = this.g;
    const info: KillInfo = {
      id: str(m.id),
      boss: m.boss === true,
      xp: Math.min(100000, num(m.xp)),
      gold: Math.min(100000, num(m.gold)),
      x: num(m.x),
      z: num(m.z),
      by: arr(m.by).map((x) => num(x)),
      lv: typeof m.lv === 'number' ? Math.max(1, Math.min(90, num(m.lv))) : undefined,
      minion: m.minion === true,
      tier: typeof m.tier === 'number' ? Math.max(0, Math.min(3, Math.floor(num(m.tier)))) : undefined,
    };
    const e = this.mirrors.get(num(m.nid));
    if (e) {
      this.mirrors.delete(e.nid);
      g.killMirror(e);
    }
    g.remoteKill(info);
  }

  // ------------------------------------------------------------ frame --

  update(dt: number) {
    if (!this.active) return;
    const g = this.g;
    const t = now();
    for (const r of this.remotes.values()) r.update(dt, g, t);
    if (this.isGuest) {
      // The host's clock, carried forward in real time between updates (a game minute a second).
      if (this.hostMinutesAt) g.state.gameMinutes = this.hostMinutes + Math.min(3, t - this.hostMinutesAt);
      // Forget monsters the host stopped telling us about (far away, or gone).
      for (const e of [...this.mirrors.values()]) if (e.alive && t - e.net!.seen > MIRROR_TIMEOUT) g.removeEnemy(e);
      // Effects our hero put on monsters (burning, stunned, slowed...) go to the host.
      for (const e of this.mirrors.values()) {
        const prev = e.net!.prevStatus;
        for (const k of STATUS_KEYS) {
          if (e.status[k] > prev[k] + 0.05) this.queue('host', { k: 'sts', id: e.nid, s: k, v: r1(e.status[k]) });
          prev[k] = e.status[k];
        }
      }
      if (this.need.size && t >= this.needAt) {
        this.needAt = t + 0.5;
        this.queue('host', { k: 'need', ids: [...this.need].slice(0, 60) });
        this.need.clear();
      }
    }
    if (t >= this.nextSend && this.net.open) {
      // A steady 12 a second; after a stall, start afresh rather than catch up.
      this.nextSend = this.nextSend + SEND_EVERY < t ? t + SEND_EVERY : this.nextSend + SEND_EVERY;
      this.sendState();
      if (this.isHost) this.sendSnapshots();
      this.flush();
    }
  }

  /** Room code, players and their health, for the menu and HUD. */
  party(): { name: string; level: number; hp: number; maxHp: number; alive: boolean; host: boolean }[] {
    return [...this.remotes.values()].map((r) => ({ name: r.name, level: r.level, hp: r.hp, maxHp: r.maxHp, alive: r.alive, host: r.id === this.hostId }));
  }
}
