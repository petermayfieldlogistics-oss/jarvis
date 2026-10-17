import * as THREE from 'three';
import { ANCIENT_GLYPH, LEGEND_SHARD, RUNES, SPELLS, WEAPONS, runeItem, type ComboElement, type DamageElement, type RuneId, type TeamComboDef } from '../data/defs';
import { BOSSES, ENEMIES, EYES_RUINS, ITEMS, NPCS, ORE_NODES, QUESTS, SHRINES, TRIALS, ZONES, type BossDef, type BossId, type EnemyId, type QuestId, type TrialDef, type ZoneId } from '../data/world';
import { addXp, artsDue, dracoFlightHours, killHeal, killRestore, killXp, learnSpell, levelRewards, maxHp, rank, type Character } from '../rules/character';
import { satchelCount } from '../rules/food';
import { clearFed, fedNightVision } from '../rules/fed';
import { BOSS_TIERS, bossHealthScale, tierFor, tierOpen, tierReward } from '../rules/boss';
import { hasPerk, holdsReaper, PERK, REAP } from '../rules/legend';
import { elementWeakness, incomingDamage, outgoingDamage, PREY, soulOrPowerToll, type FuryState } from '../rules/combat';
import { emberBonus, HEX } from '../rules/classes';
import { BURST_COLOR, type Burst } from '../rules/power';
import { comboElement, noteTeamHit, TEAM, teamBonus, type TeamMark } from '../rules/teamcombo';
import { materialDrop } from '../rules/crafting';
import { runeDrop } from '../rules/weapons';
import { earnedUnlocks } from '../rules/outfit';
import { Audio } from './audio';
import { CameraRig } from './camera';
import { createPost, type Post } from './post';
import { Spawner } from './spawner';
import { Ally, Boss, Enemy, type Actor } from './entities';
import { buildRelic, clearHazards, huntedNear, isRelic, Lairs, makeBoss, rewardName, updateHazards } from './bosses';
import { Coop, RemoteHero, type KillInfo } from './coop';
import { Pvp, type Rival } from './pvp';
import type { Hero } from './hero';
import { SharedFx } from './sharedfx';
import { Fx } from './fx';
import { Input } from './input';
import { buildHoe, buildThrowingKnife, buildWeapon, compact, disposeObject, glowSprite, mat } from './models';
import { Armory } from './armory';
import { FarmView } from './farm';
import { animateHumanoid, buildHumanoid, type Rig } from './humanoid';
import { newAnim } from './anim';
import { ELEMENT_COLOR, Player } from './player';
import { loadUnlocks, saveUnlocks, writeSave, type SaveData, type Settings, type WorldState } from './state';
import { heightAt, zoneAt, WATER_LEVEL } from './terrain';
import { World, type Interactable } from './world';
import { Story } from './story';
import { Builder } from './builder';
import { AdminPanel } from '../ui/admin';
import type { Cloud } from './cloud';
import { Hud } from '../ui/hud';
import { Dialog } from '../ui/dialog';
import { Menu } from '../ui/menu';
import { Wardrobe } from '../ui/wardrobe';

export type ProjectileKind = 'arrow' | 'fireball' | 'orb' | 'water' | 'bolt' | 'axe' | 'knife' | 'wand';

export interface ProjectileSpec {
  from: THREE.Vector3;
  to: THREE.Vector3;
  speed: number;
  kind: ProjectileKind;
  /** 'remote': another player's shot, shown here but only their game deals its damage. */
  owner: 'player' | 'enemy' | 'ally' | 'remote';
  damage: number;
  element: DamageElement;
  gravity: number;
  source: Actor | null;
  draw?: number;
  pierce?: number;
  powerShot?: { multiplier: number; splashFraction: number; radius: number };
  explode?: number;
  burn?: boolean;
  /** A rune on the weapon that loosed it: its effect lands with the hit. */
  rune?: RuneId;
  /** Glow of a wand bolt. */
  color?: number;
  /** Slows what it hits for this many seconds (a withering shadow bolt). */
  slow?: number;
  /** A rogue's knife: coated in poison, or thrown out of Vanish (an ambush). */
  poison?: boolean;
  ambush?: boolean;
  /** A power strike's burst where it lands (a charged arrow, knife, axe or bolt): its kind, how charged, and the strike's base damage. */
  burst?: { kind: Burst; charge: number; base: number };
  /** A friend's charged shot, shown glowing here (its burst lands in their game). */
  glowing?: Burst;
  /** Strikes, then flies back to `home` (the hand that threw it), hitting again on the way. */
  boomerang?: boolean;
  home?: () => THREE.Vector3 | null;
}

interface Projectile extends ProjectileSpec {
  /** The last foe it struck (a burst centres on it). */
  struck?: Enemy;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  mesh: THREE.Object3D;
  hit: Set<Actor>;
  returning?: boolean;
}

/** How far a returning throw flies before it turns for home. */
const BOOMERANG_RANGE = 46;

interface Tornado {
  pos: THREE.Vector3;
  radius: number;
  dps: number;
  color: number;
  life: number;
  seek: boolean;
  /** Another player's spell: shown here, harmless here. */
  remote: boolean;
}

interface Npc {
  id: string;
  rig: Rig;
  anim: ReturnType<typeof newAnim>;
  pos: THREE.Vector3;
  facing: number;
}

export type Mode = 'play' | 'dialog' | 'menu' | 'dead' | 'event';

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  post: Post;
  cam: CameraRig;
  spawner: Spawner;
  /** The hunted great foes (the Reaper, the Giant Spider) in their lairs. */
  lairs: Lairs;
  fog = new THREE.FogExp2(0xb8a27a, 0.006);
  world: World;
  /** This hero's crops in Wren's field. */
  farm!: FarmView;
  fx: Fx;
  input: Input;
  audio = new Audio();
  hud: Hud;
  dialog: Dialog;
  menu: Menu;
  wardrobe: Wardrobe;
  story: Story;
  player!: Player;
  enemies: Enemy[] = [];
  allies: Ally[] = [];
  npcs: Npc[] = [];
  projectiles: Projectile[] = [];
  tornados: Tornado[] = [];
  /** Knives on the ground and rune traps. */
  armory: Armory;
  state: WorldState;
  mode: Mode = 'play';
  zone: ZoneId = 'town';
  /** The trial whose fog is up in this world (in co-op, maybe someone else's fight). */
  activeTrial: TrialDef | null = null;
  /** The local hero is inside the active trial's fog. */
  inTrial = false;
  private trialTime = 0;
  boss: Boss | null = null;
  /** Effects every player sees (monsters' attacks, heroes' blows and spells). */
  sfx: SharedFx;
  coop: Coop;
  /** Duels, arena matches and war mode between co-op heroes. */
  pvp: Pvp;
  /** The heroes monsters can hunt: the local hero first, then any friends. */
  heroes: Hero[] = [];
  isNight = false;
  nearest: Interactable | null = null;
  eyeStare = 0;
  /** Hit-stop: seconds of near-frozen action left after a heavy blow. */
  private freeze = 0;
  private last = 0;
  private elapsed = 0;
  /** Seconds of play (team combos time the heroes' blows by it). */
  clock = 0;
  private running = false;
  private lastZone: ZoneId | null = null;
  private corpses: { e: Enemy; t: number }[] = [];
  private loot = new Map<string, THREE.Object3D>();
  private embersObj: THREE.Object3D | null = null;
  private autosave = 60;
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  onQuit: () => void = () => {};
  /** Where saves are kept on this device (an account slot has its own copy). */
  storeKey: string | undefined;
  /** Called after every save (an account slot uploads it). */
  onSaved: (data: SaveData) => void = () => {};
  /** Called when something is unlocked for every hero (an account keeps it too). */
  onUnlock: () => void = () => {};
  /** Signed-in username, if any (friends in co-op see it). */
  accountName = '';
  /** The server says this account is an admin: builder mode (K) and the admin panel (P). */
  admin = false;
  /** Admin panel: no harm comes to the hero. */
  godMode = false;
  /** The account service (saving builds); null when playing without it. */
  cloud: Cloud | null = null;
  builder!: Builder;
  adminPanel!: AdminPanel;

  constructor(
    public container: HTMLElement,
    character: Character,
    state: WorldState,
    public settings: Settings,
  ) {
    this.state = state;
    const q = settings.quality;
    // Low renders straight to the canvas without antialiasing; medium and high
    // render through post-processing, whose own target is multisampled.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'game-canvas';

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 4000);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0x000000);

    this.post = createPost(this.renderer, this.scene, this.camera, q);
    this.cam = new CameraRig(this.camera);

    const ui = document.createElement('div');
    ui.className = 'ui';
    container.appendChild(ui);
    this.hud = new Hud(ui, this);
    this.dialog = new Dialog(ui);
    this.menu = new Menu(ui, this);
    this.wardrobe = new Wardrobe(ui, this);
    this.input = new Input(this.renderer.domElement);
    this.input.sensitivity = settings.sensitivity;
    this.input.invertY = settings.invertY;
    if (settings.touch === 'on') this.input.touch = true;
    if (settings.touch === 'off') this.input.touch = false;
    if (this.input.touch) {
      this.input.buildTouch(ui);
      document.body.classList.add('is-touch');
    }
    this.audio.setVolume(settings.volume);

    this.world = new World(this.scene, q);
    this.fx = new Fx(this.scene, this.camera, this.hud.numberLayer, q === 'low');
    this.armory = new Armory(this.scene);
    this.story = new Story(this);
    this.spawner = new Spawner(this);
    this.lairs = new Lairs(this);
    this.sfx = new SharedFx(this);
    this.coop = new Coop(this);
    this.coop.onChange = () => this.menu.coopChanged();
    this.pvp = new Pvp(this);

    this.buildNpcs();
    this.farm = new FarmView(this.scene, this.world.interactables);
    this.setPlayer(character);
    this.builder = new Builder(this);
    this.adminPanel = new AdminPanel(this);
    this.spawnAll();
    this.restoreWorldObjects();

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  // ------------------------------------------------------------------ setup --

  private setPlayer(c: Character) {
    if (this.player) this.scene.remove(this.player.rig.root);
    this.player = new Player(c);
    this.scene.add(this.player.rig.root);
    const p = this.state.pos;
    const shrine = SHRINES.find((s) => s.id === this.state.lastShrine) ?? SHRINES[0];
    // A saved spot is put back on the ground (the land may have changed under it since: the old edge mountains are gone);
    // one now under the sea goes back to the shrine.
    if (p && heightAt(p[0], p[2]) > -1) this.player.pos.set(p[0], Math.min(p[1], heightAt(p[0], p[2]) + 0.5), p[2]);
    else this.player.pos.set(shrine.x + 2, heightAt(shrine.x + 2, shrine.z + 3), shrine.z + 3);
    this.cam.yaw = Math.PI;
    this.refreshHeroes();
    this.summonLizardKin();
    this.updateTouchButtons();
    // Heroes who earned the crown or a relic's colour before the wardrobe existed get them now.
    this.grantEarned();
  }

  /** What deeds have earned for the wardrobe (the crown, the relics' colours): given once, with a toast. */
  grantEarned(): boolean {
    const got = earnedUnlocks(this.player.c, this.state.trialsDone);
    for (const name of got) this.hud.toast(`Wardrobe: ${name} unlocked`, 'quest');
    return got.length > 0;
  }

  updateTouchButtons() {
    const c = this.player.c;
    this.input.setTouchButtons({
      fly: c.raceId === 'draco',
      combine: c.classId === 'mage',
      cast: c.knownSpells.length > 0,
      nextSpell: c.knownSpells.length > 1,
      eat: true,
      // The satchel (fruit and sweets) only while there are some to eat.
      satchel: satchelCount(c.items) > 0,
    });
  }

  private buildNpcs() {
    for (const n of NPCS) {
      const look = {
        orrin: { armor: 0x4a3f6a, cloth: 0x2e2840, accent: 0xc0a050, build: 'robe' as const, head: 'hood' as const },
        brann: { armor: 0x5a3a22, cloth: 0x3a2a1c, accent: 0x8a8a8a, build: 'light' as const, head: 'bare' as const },
        lumen: { armor: 0xd8cfa8, cloth: 0xe8e0c8, accent: 0xffd080, build: 'robe' as const, head: 'hood' as const },
        quill: { armor: 0x3a5a4a, cloth: 0x2a3a30, accent: 0xc0a050, build: 'light' as const, head: 'hat' as const },
        mara: { armor: 0x2a4a6a, cloth: 0x223a50, accent: 0x8a8a6a, build: 'light' as const, head: 'bare' as const },
        chronicler: { armor: 0x1e1e22, cloth: 0x161618, accent: 0x6a6a6a, build: 'robe' as const, head: 'hood' as const },
        wren: { armor: 0x4a3a24, cloth: 0x7a6a3a, accent: 0xc8a050, build: 'light' as const, head: 'hat' as const },
        nell: { armor: 0x2a4a5a, cloth: 0x3a6a7a, accent: 0x2f8a86, build: 'light' as const, head: 'bare' as const, headband: 0x2f8a86 },
      }[n.id as 'orrin'] ?? { armor: n.color, cloth: n.color, accent: 0x888888, build: 'light' as const, head: 'bare' as const };
      const rig = buildHumanoid({ skin: 0xc89a78, ...look, cape: n.id === 'lumen' ? 0xe8e0c8 : undefined });
      if (n.id === 'brann') rig.handR.add(buildWeapon('hammer'));
      if (n.id === 'mara') rig.handR.add(buildWeapon('trident'));
      // Wren leans on a hoe.
      if (n.id === 'wren') rig.handR.add(buildHoe());
      compact(rig.root);
      const pos = new THREE.Vector3(n.x, heightAt(n.x, n.z), n.z);
      rig.root.position.copy(pos);
      rig.root.rotation.y = n.facing;
      rig.root.traverse((o) => (o.castShadow = true));
      this.scene.add(rig.root);
      this.npcs.push({ id: n.id, rig, anim: newAnim(), pos, facing: n.facing });
      this.world.addCollider(n.x, n.z, 0.6);
      this.world.interactables.push({ id: `npc-${n.id}`, kind: 'npc', x: n.x, y: pos.y + 1, z: n.z, radius: 3.2, label: `Talk to ${n.name}` });
    }
  }

  /** Hides what has been taken and places unclaimed loot and lost embers. */
  restoreWorldObjects() {
    for (const it of this.world.interactables) {
      if (this.state.taken.includes(it.id)) {
        it.used = true;
        if (it.object) it.object.visible = false;
      }
    }
    for (const id of this.state.unclaimed) this.placeLegendary(id);
    this.placeEmbers();
  }

  // ---------------------------------------------------------------- enemies --

  spawnEnemy(id: EnemyId, x: number, z: number): Enemy {
    const e = new Enemy(id, x, z);
    this.enemies.push(e);
    this.scene.add(e.model.root);
    return e;
  }

  removeEnemy(e: Enemy) {
    if (e.net) this.coop.forget(e);
    else if (e.alive && this.coop.isHost && !e.pvpId) this.coop.gone(e);
    e.dispose();
    this.scene.remove(e.model.root);
    disposeObject(e.model.root);
    this.enemies = this.enemies.filter((x) => x !== e);
    if (this.player.lockTarget === e) this.player.lockTarget = null;
  }

  /** Takes every monster (and corpse) out of the world: switching between our world and a host's. */
  clearEnemies() {
    for (const e of [...this.enemies]) this.removeEnemy(e);
    this.corpses = [];
    this.boss = null;
    this.lairs.clear();
    clearHazards();
  }

  /** Fills every camp again. In co-op the host's world is shared, so resting doesn't reset it (and guests have no monsters of their own). */
  spawnAll(force = false) {
    if (this.coop?.isGuest || (this.coop?.sharing && !force)) return;
    this.spawner.spawnAll();
  }

  addAlly(a: Ally) {
    this.allies.push(a);
    a.model.root.traverse((o) => (o.castShadow = true));
    this.scene.add(a.model.root);
  }

  removeAlly(a: Ally) {
    this.scene.remove(a.model.root);
    disposeObject(a.model.root);
    this.allies = this.allies.filter((x) => x !== a);
  }

  // ----------------------------------------------------------------- heroes --

  refreshHeroes() {
    this.heroes = [this.player, ...[...(this.coop?.remotes.values() ?? [])].filter((r) => r.ready)];
  }

  /** The nearest living hero (the preferred one counts `bias` metres closer), or the local hero when none qualify. */
  nearestHero(pos: THREE.Vector3, prefer: Hero | null, bias: number, filter?: (h: Hero) => boolean): Hero {
    let best: Hero | null = null;
    let bestD = Infinity;
    for (const h of this.heroes) {
      if (!h.alive || (filter && !filter(h))) continue;
      const d = Math.hypot(h.pos.x - pos.x, h.pos.z - pos.z) - (h === prefer ? bias : 0);
      if (d < bestD) (bestD = d), (best = h);
    }
    return best ?? this.player;
  }

  /** Distance (Manhattan, flat) from a point to the nearest hero. */
  heroDistance(x: number, z: number) {
    let d = Infinity;
    for (const h of this.heroes) d = Math.min(d, Math.abs(h.pos.x - x) + Math.abs(h.pos.z - z));
    return d;
  }

  /** A monster's blow on a hero: here, or sent to the friend's game. */
  damageHero(h: Hero, amount: number, element: DamageElement, source: Enemy | null) {
    // A hexed monster hits softer.
    if (source && source.status.hex > 0) amount *= HEX.dealt;
    if (h === this.player) return this.damagePlayer(amount, element, source);
    if (h instanceof RemoteHero && h.alive) {
      this.coop.hurt(h, amount, element, source);
      if (source) source.damageDealt += amount;
    }
  }

  knockHero(h: Hero, dir: THREE.Vector3, force: number) {
    if (h === this.player) this.player.knockback(dir, force);
    else if (h instanceof RemoteHero) this.coop.knock(h, dir, force);
  }

  private summonLizardKin() {
    for (const a of this.allies.filter((x) => x.kind === 'lizard')) this.removeAlly(a);
    if (this.player.c.raceId !== 'ancient') return;
    for (let i = 0; i < 2; i++) this.addAlly(new Ally('lizard', this.player.pos.x + i * 2 - 1, this.player.pos.z - 2, this.player.c.level));
  }

  // ----------------------------------------------------------------- combat --

  findTarget(maxDist: number, minDot: number, awareOnly: boolean): Enemy | null {
    const fwd = this.v.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    let best: Enemy | null = null;
    let bestScore = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || (awareOnly && !e.aware && !(e instanceof Boss))) continue;
      const to = this.v2.copy(e.pos).sub(this.player.pos);
      const d = to.length();
      if (d > maxDist) continue;
      to.y = 0;
      const dot = to.normalize().dot(fwd);
      if (dot < minDot) continue;
      const score = d * (2 - dot);
      if (score < bestScore) (bestScore = score), (best = e);
    }
    return best;
  }

  /** Where the hero is aiming: the lock-on target, an enemy near the crosshair, or the ground. */
  aimPoint(maxDist: number): THREE.Vector3 {
    if (this.player.lockTarget) return this.player.lockTarget.center();
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    // Nearest enemy close to the aim ray.
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const c = e.center();
      const t = c.clone().sub(origin).dot(dir);
      if (t < 0 || t > maxDist + this.camDist) continue;
      const off = origin.clone().addScaledVector(dir, t).distanceTo(c);
      if (off < Math.max(1.2, e.radius + 0.6) && t < bestD) (bestD = t), (best = e);
    }
    if (best) return best.center();
    const p = origin.clone();
    for (let t = 0; t < maxDist + this.camDist; t += 0.75) {
      p.copy(origin).addScaledVector(dir, t);
      if (p.y < heightAt(p.x, p.z)) return p;
    }
    return origin.addScaledVector(dir, maxDist + this.camDist);
  }

  /** An empowered spell's burst, for the first projectile the spell looses (see Player.cast). */
  projectileBurst: ProjectileSpec['burst'] | null = null;

  spawnProjectile(spec: ProjectileSpec, fromNet = false) {
    if (spec.owner === 'player' && this.projectileBurst && !spec.burst) {
      spec = { ...spec, burst: this.projectileBurst };
      this.projectileBurst = null;
    }
    if (!fromNet) this.coop.shareProjectile(spec);
    const dir = spec.to.clone().sub(spec.from);
    const dist = dir.length();
    dir.normalize();
    const vel = dir.multiplyScalar(spec.speed);
    // Aim up a little to make arcing shots land where intended.
    if (spec.gravity > 0) vel.y += (spec.gravity * dist) / spec.speed / 2;
    const mesh = projectileMesh(spec.kind, spec.color, spec.rune, !!(spec.burst || spec.glowing));
    mesh.position.copy(spec.from);
    if (spec.kind === 'knife') {
      // Tumbles end over end in the plane of its flight.
      mesh.rotation.order = 'YXZ';
      mesh.rotation.y = Math.atan2(vel.x, vel.z);
    }
    this.scene.add(mesh);
    this.projectiles.push({ ...spec, pos: spec.from.clone(), vel, life: 4, mesh, hit: new Set() });
  }

  addTornado(pos: THREE.Vector3, radius: number, dps: number, color: number, life = 3, seek = false, remote = false) {
    if (!remote) this.coop.shareTornado(pos, radius, color, life, seek);
    this.tornados.push({ pos: pos.clone(), radius, dps, color, life, seek, remote });
  }

  shake(a: number) {
    this.cam.shake(a);
  }

  /** Briefly freezes the action so a heavy blow lands with weight. */
  hitStop(seconds: number) {
    this.freeze = Math.max(this.freeze, seconds);
  }

  /** Camera yaw; the hero moves relative to it. */
  get camYaw() {
    return this.cam.yaw;
  }
  set camYaw(v: number) {
    this.cam.yaw = v;
  }
  get camDist() {
    return this.cam.dist;
  }

  /** Damage from the hero's weapon: applies class, race, role and stealth rules. */
  hitEnemyWithWeapon(e: Enemy, base: number, kind: 'melee' | 'bow' | 'thrown', element: DamageElement, o: { fromBehind?: boolean; fury?: FuryState; draw?: number; finisher?: boolean; ambush?: boolean }) {
    const c = this.player.c;
    const r = outgoingDamage(c, {
      base: base * this.player.songDamage(),
      kind,
      element,
      targetDark: e.dark,
      undetected: !e.aware,
      fromBehind: !!o.fromBehind,
      fury: o.fury,
      draw: o.draw,
      heroHp: this.player.hp / this.player.maxHp,
      targetHp: e.hp / e.maxHp,
      warCry: this.player.warCry > 0,
      targetStunned: e.status.stun > 0,
      targetPoisoned: e.status.poison > 0,
      targetBleeding: e.status.bleed > 0,
      ambush: o.ambush,
      finisher: o.finisher,
      targetBoss: e instanceof Boss,
      roll: Math.random(),
      shout: this.player.shout > 0,
      focused: this.player.useFocus(),
    });
    this.damageEnemy(e, r.amount, element, { source: 'player', tags: r.tags });
    if (kind === 'bow' && c.skills['hunters-mark']) e.status.marked = 8;
    this.legendHit(e, r.amount);
  }

  /** What the weapon in hand does on a hit: Reaper's Edge reaps, and its legend perks. */
  private legendHit(e: Enemy, dealt: number) {
    const p = this.player;
    const c = p.c;
    const heal = dealt * ((holdsReaper(c) ? REAP.heal : 0) + (hasPerk(c, 'vampiric') ? PERK.vampiric : 0));
    if (heal >= 0.5 && p.alive && p.hp < p.maxHp) {
      p.heal(heal);
      if (heal >= 2) this.fx.emit(p.center(), { color: holdsReaper(c) ? 0x60ffa0 : 0xff4060, count: 4, speed: 1.2, life: 0.5, up: 1 });
    }
    if (hasPerk(c, 'thunderstrike') && ++p.perkHits % PERK.thunderstrike.every === 0) {
      const at = e.pos.clone();
      this.fx.lightning(at.clone().add(new THREE.Vector3(0, 24, 0)), e.center());
      this.audio.play('zap');
      for (const f of [...this.enemies]) {
        if (f.alive && f.pos.distanceTo(at) < PERK.thunderstrike.radius + f.radius) this.damageEnemy(f, dealt * PERK.thunderstrike.power, 'lightning', { source: 'player' });
      }
    }
    if (hasPerk(c, 'tempest') && e.alive && Math.random() < PERK.tempest.chance) {
      if (!(e instanceof Boss)) this.shoveEnemy(e, e.pos.x - p.pos.x, e.pos.z - p.pos.z, PERK.tempest.shove);
      e.status.slow = Math.max(e.status.slow, PERK.tempest.slow);
      this.fx.emit(e.center(), { color: 0xc8ffe4, count: 14, speed: 4, life: 0.5 });
    }
  }

  /** Knocks a monster back (and maybe up): here, or (a guest's copy) by asking the host, whose game moves it. */
  shoveEnemy(e: Enemy, dx: number, dz: number, force: number, up = 0) {
    if (!e.alive) return;
    if (e.net) this.coop.shove(e, dx, dz, force, up);
    else e.shove(dx, dz, force, up);
  }

  damageEnemy(e: Enemy, amount: number, element: DamageElement, o: { source?: string; dot?: boolean; quiet?: boolean; tags?: string[]; by?: number } = {}) {
    if (!e.alive || amount <= 0) return;
    // A hostile hero's stand-in: the blow goes to their game (engine/pvp.ts).
    if (e.pvpId) return this.pvp.strike(e as Rival, amount, element, o);
    // A guest's blow goes to the host, whose game owns the monster; show it here at once.
    const guest = !!e.net;
    if (guest) this.coop.hit(e, amount, element, o);
    const remote = o.by !== undefined && o.by !== this.coop.myId;
    e.hitBy.add(o.by ?? this.coop.myId);
    let dmg = amount;
    const weak = elementWeakness(e.affinity === 'none' ? 'none' : e.affinity);
    if (weak && weak === element) dmg *= 1.5;
    if (e.affinity !== 'none' && e.affinity !== 'dark' && element === e.affinity) dmg *= 0.5;
    if (e.status.marked > 0) dmg *= 1.15;
    // The ranger's marked prey takes more from the ranger.
    if (e === this.player.prey && e.status.marked > 0 && !remote && o.source !== 'combo') dmg *= PREY.mine;
    // A hexed foe takes more from everyone.
    if (e.status.hex > 0) dmg *= HEX.taken;
    // Striking (or casting at) a foe ends a rogue's Vanish.
    if (!remote && !o.dot && (o.source === 'player' || o.source === 'spell') && this.player.vanish > 0) this.player.vanish = 0;
    if (element === 'lightning' && e.status.wet > 0 && o.source !== 'spell') dmg *= 1.5;
    e.hp = guest ? Math.max(1, e.hp - dmg) : e.hp - dmg;
    e.hitFlash = 0.15;
    if (!o.dot) e.anim.hurt = 1;
    // Bloodsteal: every point of damage a bleeding foe takes heals the hero.
    if (e.status.bleed > 0 && !remote && this.player.hasBloodsteal()) this.player.heal(dmg);
    if (!o.dot) {
      const tags = o.tags?.filter((t) => t !== 'sneak') ?? [];
      const text = `${Math.round(dmg)}${tags.includes('ambush') ? ' AMBUSH' : tags.includes('backstab') ? ' BACKSTAB' : ''}`;
      this.fx.damageNumber(e.center().add(new THREE.Vector3(0, e.height * 0.5, 0)), text, tags.includes('backstab') || tags.includes('ambush') || tags.includes('power') ? 'crit' : weak === element ? 'weak' : '');
      this.fx.impact(e.center(), e.bleeds ? 0x8a0a0a : 0xd8d0c0, Math.min(1, dmg / 40));
    }
    if (guest) return;
    if (!e.aware && !o.quiet && o.source !== 'devil') e.becomeAware(this);
    // With friends, the host's game watches for two heroes' elements meeting on this foe.
    if (this.coop.isHost && !o.dot && (o.source === 'player' || o.source === 'spell')) this.teamHit(e, o.by ?? this.coop.myId, element, dmg);
    if (e.alive && e.hp <= 0) this.killEnemy(e);
  }

  // ------------------------------------------------------- team combos --

  /** A blow brought an element without dealing it (a runed weapon): it still counts toward a team combo. */
  noteElement(e: Enemy, el: ComboElement, dmg: number) {
    if (!e.alive) return;
    if (e.net) this.coop.noteElement(e, el, dmg);
    else if (this.coop.isHost) this.teamHit(e, this.coop.myId, el, dmg);
  }

  /** Host: a hero's blow lands; with another hero's element on the same foe a moment ago, they combine. */
  teamHit(e: Enemy, hero: number, element: DamageElement, dmg: number) {
    const el = comboElement(element);
    if (!el) return;
    const hit: TeamMark = { hero, el, at: this.clock, dmg };
    const r = noteTeamHit(e.team, hit);
    if (r) this.teamCombo(e, r.def, r.partner, hit);
  }

  /** Host: a team combo bursts on the foe and those around it; everyone sees it. */
  private teamCombo(e: Enemy, def: TeamComboDef, a: TeamMark, b: TeamMark) {
    const bonus = teamBonus(def, a.dmg, b.dmg);
    const fx = def.effect;
    const at = e.pos.clone();
    const center = e.center();
    for (const f of [...this.enemies]) {
      if (!f.alive) continue;
      const dx = f.pos.x - at.x, dz = f.pos.z - at.z;
      const d = Math.hypot(dx, dz);
      if (f !== e && (d > def.radius + f.radius || Math.abs(f.pos.y - at.y) > 4)) continue;
      // Bosses shrug off half of what holds them.
      const k = f instanceof Boss ? 0.5 : 1;
      const s = f.status;
      if (fx.burn) s.burn = Math.max(s.burn, fx.burn);
      if (fx.wet) s.wet = Math.max(s.wet, fx.wet);
      if (fx.slow) s.slow = Math.max(s.slow, fx.slow);
      if (fx.hex) s.hex = Math.max(s.hex, fx.hex);
      if (fx.blind) s.blind = Math.max(s.blind, fx.blind * k);
      if (fx.root) s.root = Math.max(s.root, fx.root * k);
      if (fx.stun) s.stun = Math.max(s.stun, fx.stun * k);
      if (fx.fear) s.fear = Math.max(s.fear, fx.fear * k);
      if (fx.shove || fx.lift) f.shove(d > 0.3 ? dx : 1, d > 0.3 ? dz : 0, fx.shove ?? 3, fx.lift ?? 0);
      // A void pulls them in (no further than the middle).
      if (fx.pull && d > 1) f.shove(-dx, -dz, fx.pull * Math.min(1, d / def.radius), 0);
      f.hitBy.add(a.hero);
      const dark = fx.vsDark && f.dark ? fx.vsDark : 1;
      this.damageEnemy(f, bonus * (f === e ? 1 : TEAM.splash) * dark, def.element, { source: 'combo', by: b.hero, tags: ['combo'] });
    }
    const heroes: [number, ComboElement][] = [[a.hero, a.el], [b.hero, b.el]];
    this.coop.teamCombo(def, center, heroes, bonus);
    this.showTeamCombo(def, center, heroes, bonus);
  }

  /** Everyone: a team combo went off at `at` (its heroes mend or drain). */
  showTeamCombo(def: TeamComboDef, at: THREE.Vector3, heroes: [number, ComboElement][], bonus: number) {
    const [c1, c2] = heroes.map(([, el]) => ELEMENT_COLOR[el]);
    const who = heroes.map(([id]) => this.heroName(id)).join(' + ');
    const mine = heroes.some(([id]) => id === this.coop.myId);
    const near = mine || this.player.pos.distanceTo(at) < 40;
    if (near) this.hud.teamCombo(def.name, who, c1, c2);
    // Each hero's element streaks to the foe, and the two burst together.
    const v = new THREE.Vector3();
    for (const [id, el] of heroes) {
      const h = id === this.coop.myId ? this.player : this.coop.remotes.get(id);
      if (h) this.fx.beam(h.center(v), at, ELEMENT_COLOR[el], 0.16, 0.35);
    }
    const ground = v.set(at.x, heightAt(at.x, at.z) + 0.15, at.z);
    this.fx.shockwave(ground, def.radius, c1, 0.5);
    this.fx.shockwave(ground, def.radius * 0.65, c2, 0.4);
    this.fx.ring(ground, def.radius, c2, 0.8);
    this.fx.flash(at, c1, 45, 20);
    this.fx.emit(at, { color: c1, count: 30, speed: 6, life: 0.7, size: 0.6, up: 1.5 });
    this.fx.emit(at, { color: c2, count: 30, speed: 6, life: 0.7, size: 0.6, up: 1.5 });
    if (near) {
      this.audio.play('zap');
      this.audio.play('slam');
      this.shake(mine ? 0.35 : 0.15);
    }
    // Light mends, dark drains: the two heroes share it.
    if (mine && this.player.alive && (def.effect.mend || def.effect.drain)) {
      const p = this.player;
      const got = Math.min(p.maxHp - p.hp, (def.effect.mend ?? 0) * p.maxHp + (def.effect.drain ?? 0) * bonus);
      if (got >= 1) {
        p.heal(got);
        this.fx.damageNumber(p.center(v).setY(p.pos.y + 2), `+${Math.round(got)}`, 'heal');
      }
    }
  }

  /** A hero's name as friends know it (yours, as you gave it when you joined). */
  heroName(id: number): string {
    if (id === this.coop.myId) return this.coop.myName;
    return this.coop.remotes.get(id)?.name ?? 'A friend';
  }

  private killEnemy(e: Enemy) {
    e.alive = false;
    e.hp = 0;
    this.corpses.push({ e, t: 0 });
    if (this.player.lockTarget === e) this.player.lockTarget = null;
    this.player.onFoeDied(this, e);
    const isBoss = e instanceof Boss;
    const info: KillInfo = {
      id: isBoss ? e.bdef.id : e.def.id,
      boss: isBoss,
      // Monsters out of their home region (a level bonus) are tougher, and teach more.
      xp: isBoss ? tierReward(e.tier, false, e.bdef).xp : (e.summoned ? e.def.xp * 0.3 : e.def.xp) * (1 + 0.12 * e.levelBonus),
      lv: e.level,
      minion: e.summoned,
      gold: isBoss ? tierReward(e.tier, false, e.bdef).gold : Math.round(e.def.gold * (0.6 + Math.random() * 0.8)),
      tier: isBoss ? e.tier : undefined,
      x: Math.round(e.pos.x),
      z: Math.round(e.pos.z),
      by: [...e.hitBy],
    };
    if (this.coop.sharing) this.coop.killed(e, info);
    this.reward(info);
  }

  /** Guest: the host's monster died. */
  killMirror(e: Enemy) {
    e.alive = false;
    e.hp = 0;
    e.net = null;
    this.corpses.push({ e, t: 0 });
    if (this.player.lockTarget === e) this.player.lockTarget = null;
    this.player.onFoeDied(this, e);
  }

  /** Guest: a kill in the host's world (ours to reward if we were part of it). */
  remoteKill(info: KillInfo) {
    if (info.boss || ENEMIES[info.id as EnemyId]) this.reward(info);
  }

  /** XP, embers, quest progress and drops for a kill (in co-op, if the hero was part of it). */
  private reward(info: KillInfo) {
    const bossDef = info.boss ? BOSSES[info.id as BossId] : null;
    const credited = this.coop.credited(info);
    if (credited) {
      const c = this.player.c;
      // The Hungry Dead: a zombie feeds on every kill it took part in.
      const fed = killHeal(c) * this.player.maxHp;
      if (fed > 0 && this.player.alive && this.player.hp < this.player.maxHp) {
        this.player.heal(fed);
        this.fx.damageNumber(this.player.center().add(new THREE.Vector3(0, 0.9, 0)), `+${Math.round(fed)}`, 'heal');
        this.fx.emit(this.player.center(), { color: 0x9cff60, count: 12, speed: 1.5, life: 0.7, up: 1.5 });
      }
      const def = bossDef ? null : ENEMIES[info.id as EnemyId];
      const level = info.lv ?? (bossDef ? bossDef.level : def!.level);
      c.gold += Math.round(info.gold * emberBonus(c));
      this.player.onKill();
      // Each hero's own game weighs the kill against their own level.
      this.gainXp(killXp(info.xp, level, c.level, info.boss));
      this.killRegen(level, bossDef ? 2 : def!.scale, info.boss, !!info.minion);
      if (bossDef ? bossDef.dark : def!.dark) this.questProgress('dead', 1);
      if (def && def.id.startsWith('bandit')) this.questProgress('bounty', 1);
      if (def && def.drop && Math.random() < def.drop.chance) {
        if (def.drop.item === 'arrows') {
          if (this.player.weaponKind === 'bow' || c.weapons.some((w) => WEAPONS[w.id].kind === 'bow')) {
            c.arrows.wood += 5;
            this.hud.toast('+5 arrows');
          }
        } else {
          c.items[def.drop.item] = (c.items[def.drop.item] ?? 0) + 1;
          this.hud.toast(`+1 ${def.drop.item === 'ember-ore' ? 'Ember Ore' : def.drop.item}`);
          if (def.drop.item === 'ember-ore') this.questProgress('ore', 0);
        }
      }
      // Crafting materials: hides, bones, silk… (each hero rolls their own).
      const mat = def ? materialDrop(def.id, Math.random()) : null;
      if (mat) {
        c.items[mat] = (c.items[mat] ?? 0) + 1;
        this.hud.toast(`+1 ${ITEMS[mat].name}`);
      }
      // Now and then a rune (always from a boss), matched to what the foe was made of.
      const rune = runeDrop(bossDef ? bossDef.affinity : def!.affinity, !!bossDef, Math.random(), Math.random());
      if (rune) {
        c.items[runeItem(rune)] = (c.items[runeItem(rune)] ?? 0) + 1;
        this.hud.toast(`Found a ${RUNES[rune].name}! Inscribe it on a weapon at an anvil.`, 'quest');
      }
    }
    if (bossDef && credited) this.tierFelled(bossDef, info.tier ?? 0);
    // A hunted foe has no fog: those who fought it share the spoils.
    if (bossDef?.mini) {
      if (credited) this.huntDone(bossDef);
    } else if (bossDef) {
      // A felled boss lifts the fog; those who fought it win the trial.
      if (this.inTrial || credited) this.completeTrial(bossDef);
      else this.endTrial(true);
    }
  }

  /** A kill restores a little health, mana and stamina (much more for a boss), with a green and blue burst. */
  private killRegen(level: number, scale: number, boss: boolean, minion: boolean) {
    const p = this.player;
    if (!p.alive) return;
    const r = killRestore(p.c, { level, scale, boss, minion });
    const hp = Math.min(r.hp, Math.max(0, p.maxHp - p.hp));
    const mana = p.soulOrPower ? 0 : Math.min(r.mana, Math.max(0, p.maxMana - p.mana));
    p.heal(hp);
    p.mana += mana;
    p.stamina = Math.min(p.maxStamina, p.stamina + r.stamina);
    const at = p.center();
    this.fx.emit(at, { color: 0x58f078, count: boss ? 60 : 12, speed: boss ? 4 : 2, life: 0.9, size: 0.45, up: 2.5, drag: 1.2 });
    this.fx.emit(at, { color: 0x5aa8ff, count: boss ? 40 : 8, speed: boss ? 3.5 : 1.6, life: 0.9, size: 0.4, up: 2.2, drag: 1.2 });
    if (boss) this.fx.ring(p.pos.clone().setY(p.pos.y + 0.2), 4, 0x60ff90, 0.8);
    at.y += 0.9;
    if (hp >= 1) this.fx.damageNumber(at, `+${Math.round(hp)}`, 'heal');
    if (mana >= 1) this.fx.damageNumber(at, `+${Math.round(mana)}`, 'mana');
  }

  // ------------------------------------------------------- difficulty --

  /** The hardest tier this hero has beaten a great foe on (-1: never). */
  bossBest(id: BossId): number {
    return this.state.bossBest[id] ?? -1;
  }

  /** The tier the next fight with a great foe will be on. */
  bossTier(id: BossId): number {
    return tierFor(this.state.bossPick[id] ?? 0, this.bossBest(id));
  }

  /** Picks the tier for a great foe's next fight (only open tiers). */
  pickTier(id: BossId, tier: number) {
    this.state.bossPick[id] = Math.max(0, Math.min(tier, tierOpen(this.bossBest(id))));
  }

  /** A great foe fell on a tier: Legend Shards (twice over the first time), and the next tier opens. */
  private tierFelled(boss: BossDef, tier: number) {
    const best = this.bossBest(boss.id);
    const first = tier > best;
    if (first) this.state.bossBest[boss.id] = tier;
    const { shards } = tierReward(tier, first, boss);
    const c = this.player.c;
    if (shards > 0) {
      c.items[LEGEND_SHARD] = (c.items[LEGEND_SHARD] ?? 0) + shards;
      setTimeout(() => this.hud.toast(`+${shards} Legend Shards${first ? ' (first time on ' + BOSS_TIERS[tier].name + ')' : ''}. Set legend perks at an anvil.`, 'quest'), 3400);
    }
    if (first && tier < BOSS_TIERS.length - 1) {
      const next = BOSS_TIERS[tier + 1];
      setTimeout(() => this.hud.toast(`${boss.name} can now be fought on ${next.name}. Pick it in your journal (Quests).`, 'quest'), 4800);
    }
  }

  /** A hunted foe slain: its unique drop the first time, ore and a bounty mark every time. */
  private huntDone(boss: BossDef) {
    const c = this.player.c;
    const flag = `hunted-${boss.id}`;
    const first = !this.state.flags[flag];
    setTimeout(() => {
      this.hud.banner('MONSTER SLAIN', 'victory', `${boss.name}, ${boss.title}`);
      this.audio.play('victory');
    }, 1000);
    c.items['ember-ore'] = (c.items['ember-ore'] ?? 0) + 2;
    this.hud.toast('+2 Ember Ore');
    // Broodmother leaves silk enough for a fishing line.
    if (boss.id === 'giant-spider') {
      c.items.silk = (c.items.silk ?? 0) + 3;
      this.hud.toast('+3 Spider Silk');
    }
    if (first) {
      this.state.flags[flag] = true;
      if (!c.weapons.some((w) => w.id === boss.reward)) {
        c.weapons.push({ id: boss.reward, level: 1 });
        setTimeout(() => this.hud.toast(`You claim ${WEAPONS[boss.reward].name}! (see your pack)`, 'quest'), 2600);
      }
      this.questProgress('hunts', 1);
    }
    this.save();
  }

  gainXp(xp: number) {
    const c = this.player.c;
    const from = c.level;
    const renown = c.renown;
    const gained = addXp(c, xp);
    if (c.renown > renown) {
      this.hud.banner(`RENOWN ${c.renown}`, 'level', `+${c.renown - renown}% health and damage`);
      this.audio.play('levelup');
    }
    // A warrior's or ranger's new art comes with its level.
    for (const art of artsDue(c)) {
      learnSpell(c, art);
      setTimeout(() => this.hud.toast(`New art: ${SPELLS[art].name}! (see Spells in your journal)`, 'skill'), 2600);
    }
    if (gained > 0) {
      this.player.hp = this.player.maxHp;
      this.player.mana = this.player.maxMana;
      this.player.refillStamina();
      this.player.flightLeft = dracoFlightHours(c) * 60;
      // The banner spells out what the level gave.
      const up = levelRewards(c, from);
      const gains = [up.hp && `+${up.hp} HP`, up.mana && `+${up.mana} mana`, up.stamina && `+${up.stamina} stamina`, `+${up.points} skill point${up.points === 1 ? '' : 's'}`];
      // Milestones get their own line (a toast would sit on top of it on phones).
      const star = up.milestones.map((m) => `★ Milestone · ${m.name}: ${m.text}`);
      this.hud.banner(`LEVEL ${c.level}`, 'level', [gains.filter(Boolean).join(' · '), ...star].join('\n'));
      this.audio.play('levelup');
      this.fx.emit(this.player.center(), { color: 0xffd070, count: up.milestones.length ? 140 : 80, speed: 6, life: 1.2, up: 3 });
      if (up.milestones.length) this.fx.ring(this.player.pos.clone(), 6, 0xffd070, 0.9);
      this.checkLevelEvents();
      this.summonLizardKin();
    }
  }

  private checkLevelEvents() {
    const c = this.player.c;
    if (c.raceId === 'draco' && c.level === 5) this.hud.toast('Your scales tighten. Water will burn you this year.', 'warn');
    if (c.raceId === 'draco' && c.level === 6) this.hud.toast('Your wings have grown! Press V (or 🪽) to fly.', 'skill');
    if (c.raceId === 'draco' && c.level === 10) this.hud.toast('Fire is a bath now: lava heals you.', 'skill');
    if (c.classId === 'warrior' && c.subclassId !== 'bowman' && c.level === 4) this.hud.toast('Bloodsteal unlocked: in BloodRage, bleeding foes feed you.', 'skill');
    if (c.classId === 'mage' && c.level === 3) this.hud.toast('You can now combine spells (G / ⊕).', 'skill');
  }

  /** All damage to the hero goes through here. */
  damagePlayer(amount: number, element: DamageElement, source: Actor | null, environmental = false) {
    // Building, or an admin's god mode: no harm.
    if (this.builder?.active || this.godMode) return;
    const p = this.player;
    if (!p.alive || amount <= 0 || this.mode === 'dead') return;
    if (!environmental && p.iframes > 0) {
      // Rolled (dashed, flipped) clean through it.
      if (p.rollT >= 0) p.dodged(this);
      return;
    }
    // A duelist's parry turns the blow aside and answers it.
    if (!environmental && source && p.parryWindow > 0) return p.parried(this, source);
    let blocking = false;
    if (p.blocking && source) {
      const facing = Math.cos(Math.atan2(source.pos.x - p.pos.x, source.pos.z - p.pos.z) - p.yaw);
      if (facing > 0.1) blocking = true;
    }
    if (blocking) {
      // Every blocked blow costs stamina (a shield takes it better). The blow
      // that breaks the guard staggers the hero and half of it gets through.
      const warrior = p.c.classId === 'warrior';
      p.spend(warrior ? 10 + amount * 0.4 : 5 + amount * 0.3, 0.6);
      this.audio.play('block');
      this.fx.emit(p.center().add(new THREE.Vector3(Math.sin(p.yaw) * 0.6, 0.2, Math.cos(p.yaw) * 0.6)), { color: 0xffe0a0, count: 14, speed: 5, life: 0.3 });
      if (p.stamina <= 0) {
        if (p.ironSkin <= 0) p.stagger = 1;
        p.blocking = false;
        blocking = false;
        amount *= 0.5;
        this.hud.toast('Guard broken!', 'warn');
      } else if (warrior) {
        this.fx.damageNumber(p.center(), 'BLOCKED', 'info');
        if (source instanceof Enemy && !(source instanceof Boss) && p.c.skills.riposte) source.status.stun = 1.2;
        return;
      } else if (source instanceof Enemy && !(source instanceof Boss) && p.c.skills['counter-strike']) {
        // An Iron Fist's guard stuns whoever struck it.
        source.status.stun = Math.max(source.status.stun, 1.2);
      }
    }
    let dmg = incomingDamage(p.c, amount, element, { blocking, stoneSkin: p.stoneSkin > 0, invulnerable: p.aegis > 0, ironSkin: p.ironSkin > 0, unbreakable: p.unbreakable > 0 });
    // A Ward of Dawn soaks up what it can.
    if (p.ward > 0 && dmg > 0) {
      const soak = Math.min(p.ward, dmg);
      p.ward -= soak;
      dmg -= soak;
      this.fx.emit(p.center(), { color: 0xfff0b0, count: 8, speed: 2.5, life: 0.35 });
    }
    if (p.c.elfMystery && p.c.mysteryRevealed && element === 'dark') dmg *= 1.2;
    // Mana Shield: a fifth of the blow drains mana instead.
    if (rank(p.c, 'mana-shield') && !p.soulOrPower && p.mana > 0) {
      const drain = Math.min(p.mana, dmg * 0.2);
      p.mana -= drain;
      dmg -= drain;
    }
    dmg = Math.round(dmg * 10) / 10;
    if (dmg <= 0) return;
    if (source) source.damageDealt += dmg;
    if (p.soulOrPower) {
      soulOrPowerToll(p.c, dmg);
      this.hud.toast(`-${Math.round(dmg)} max HP, forever.`, 'devil');
    }
    p.hp = Math.min(p.hp, maxHp(p.c)) - dmg;
    // Unbreakable: nothing takes the warrior below 1.
    if (p.unbreakable > 0 && p.hp < 1) p.hp = 1;
    if (dmg >= 1) {
      p.endMeditation();
      // A blow throws a rider (and no climbing on for a moment).
      if (!environmental) p.struck(this);
      p.anim.hurt = 1;
      this.hud.hurt(Math.min(1, dmg / 30));
      this.audio.play('hurt');
      this.shake(Math.min(0.5, dmg / 40));
    }
    if (source && !environmental && Math.random() < 0.15 && element === 'physical' && !p.immuneToBleed()) {
      this.hud.toast('You are bleeding.', 'warn');
      this.addPlayerBleed();
    }
    if (p.hp <= 0) {
      // A duel's yield, or a fall in the arena: PvP takes it from here.
      if (this.pvp.spare()) return;
      if (!p.notDeadYet(this)) this.playerDied();
    }
  }

  private bleedTimer = 0;
  private addPlayerBleed() {
    this.bleedTimer = 3;
  }

  // ------------------------------------------------------------------ death --

  playerDied(cause?: string) {
    const p = this.player;
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    p.anim.dead = 0;
    this.mode = 'dead';
    this.audio.play('death');
    const c = p.c;
    // Death clears the Fed slot (resting and saving keep it).
    clearFed(c);
    // Felled by another hero in war mode: no embers are lost.
    const slayer = this.pvp.warDeath();
    if (c.gold > 0 && !slayer) {
      this.state.lostEmbers = { x: p.pos.x, y: Math.max(p.pos.y, WATER_LEVEL), z: p.pos.z, amount: c.gold };
      c.gold = 0;
    }
    this.hud.banner('YOU DIED', 'death', slayer ? `Slain by ${slayer}` : cause);
    setTimeout(() => this.running && this.respawn(), 4200);
  }

  private respawn() {
    const p = this.player;
    const shrine = SHRINES.find((s) => s.id === this.state.lastShrine) ?? SHRINES[0];
    // With friends still fighting, the trial goes on without us.
    if (this.coop.sharing && this.activeTrial) this.inTrial = false;
    else this.endTrial(false);
    p.alive = true;
    p.anim.dead = -1;
    p.c.flasks = p.c.flasksMax;
    p.hp = p.maxHp;
    p.mana = p.maxMana;
    p.refillStamina();
    p.soulOrPower = false;
    p.c.riseSpent = false;
    p.sailing = false;
    p.flying = false;
    p.boat = null;
    p.pos.set(shrine.x + 2, heightAt(shrine.x + 2, shrine.z + 3), shrine.z + 3);
    p.vel.set(0, 0, 0);
    this.spawnAll();
    this.summonLizardKin();
    this.placeEmbers();
    this.mode = 'play';
    this.hud.clearBanner();
    this.save();
  }

  private placeEmbers() {
    if (this.embersObj) {
      this.scene.remove(this.embersObj);
      disposeObject(this.embersObj);
    }
    this.embersObj = null;
    this.world.interactables = this.world.interactables.filter((i) => i.id !== 'embers');
    const l = this.state.lostEmbers;
    if (!l) return;
    const g = glowSprite(0xffb040, 2.5);
    g.position.set(l.x, l.y + 0.8, l.z);
    this.scene.add(g);
    this.embersObj = g;
    this.world.interactables.push({ id: 'embers', kind: 'loot', x: l.x, y: l.y + 0.8, z: l.z, radius: 3, label: `Recover ${l.amount} embers`, object: g });
  }

  // ----------------------------------------------------------------- trials --

  /** Begins a trial (in co-op the host runs it; `peer` is the friend who asked). */
  startTrial(t: TrialDef, peer?: number) {
    if (this.activeTrial) return;
    if (this.coop.isGuest) return this.coop.requestTrial(t.id);
    const boss = makeBoss(BOSSES[t.boss], t.id);
    if (!boss) return;
    // A conquered trial is fought again on the tier picked for it.
    boss.setTier(this.bossTier(t.boss));
    // Everyone near the altar is sealed in; more heroes, a tougher boss.
    const inside = (h: Hero) => Math.hypot(h.pos.x - t.x, h.pos.z - t.z) < t.radius + 3;
    const ids: number[] = [];
    for (const r of this.coop.remotes.values()) {
      r.inTrial = r.ready && r.alive && inside(r);
      if (r.inTrial) ids.push(r.id);
    }
    const me = peer === undefined || inside(this.player);
    if (me) ids.push(this.coop.myId);
    if (ids.length > 1) boss.scaleHealth(bossHealthScale(ids.length));
    this.boss = boss;
    this.enemies.push(boss);
    this.scene.add(boss.model.root);
    // Clear the arena of wandering monsters.
    for (const e of [...this.enemies]) if (e !== boss && Math.hypot(e.pos.x - t.x, e.pos.z - t.z) < t.radius + 6) this.removeEnemy(e);
    this.trialBegan(t, me);
    this.coop.trialStarted(t.id, ids);
  }

  /** The fog rises: everyone sees it; those inside are sealed in. */
  trialBegan(t: TrialDef, inside: boolean) {
    this.activeTrial = t;
    this.inTrial = inside;
    this.trialTime = 0;
    const fog = this.world.trialFog.get(t.id);
    if (fog) fog.visible = true;
    if (inside) {
      const tier = this.boss?.tier ?? 0;
      this.hud.banner(tier ? `${t.name} · ${BOSS_TIERS[tier].name}` : t.name, 'zone', t.intro);
      this.audio.play('roar');
      this.audio.setMood(1, BOSSES[t.boss].dark);
    } else this.hud.toast(`The fog rises over the ${t.name}.`);
    if (inside && !t.elder && this.state.quests.trials.state === 'none') this.state.quests.trials.state = 'active';
  }

  endTrial(won: boolean) {
    const t = this.activeTrial;
    if (!t) return;
    const fog = this.world.trialFog.get(t.id);
    if (fog) fog.visible = false;
    // The dead (the boss included) fade out on their own.
    for (const e of [...this.enemies]) if (e.summoned && e.alive) this.removeEnemy(e);
    this.boss = null;
    this.activeTrial = null;
    this.inTrial = false;
    this.fx.clearTelegraphs();
    clearHazards();
    this.audio.setMood(0, false);
    if (!won) this.hud.setBoss(null);
  }

  private completeTrial(boss: BossDef) {
    const t = this.activeTrial ?? TRIALS.find((x) => x.boss === boss.id);
    if (!t) return;
    // In co-op a trial can be fought again to help a friend; the weapon is only won once.
    const first = !this.state.trialsDone.includes(t.id);
    if (first) this.state.trialsDone.push(t.id);
    this.hud.setBoss(null);
    setTimeout(() => {
      this.hud.banner('GREAT FOE FELLED', 'victory', `${boss.name}, ${boss.title}`);
      this.audio.play('victory');
    }, 1200);
    this.endTrial(true);
    if (first) {
      this.state.unclaimed.push(boss.reward);
      this.placeLegendary(boss.reward);
      this.questProgress(t.elder ? 'elders' : 'trials', 1);
      // The sixth weapon trial earns the Crown of the Six.
      this.grantEarned();
    }
    this.save();
  }

  private placeLegendary(weaponId: string) {
    const trial = TRIALS.find((t) => BOSSES[t.boss].reward === weaponId);
    if (!trial || this.loot.has(weaponId)) return;
    const g = new THREE.Group();
    if (isRelic(weaponId)) g.add(buildRelic(weaponId));
    else {
      const w = buildWeapon(WEAPONS[weaponId].kind, true, undefined, weaponId);
      w.position.y = 0.4;
      g.add(w);
      const glow = glowSprite(0xffd070, 3);
      glow.position.y = 1;
      g.add(glow);
    }
    const x = trial.x + 3, z = trial.z + 3;
    g.position.set(x, heightAt(x, z) + 0.6, z);
    this.scene.add(g);
    this.loot.set(weaponId, g);
    this.world.interactables.push({ id: `legendary-${weaponId}`, kind: 'loot', x, y: g.position.y, z, radius: 3, label: `Take the ${rewardName(weaponId, WEAPONS)}`, object: g });
  }

  claimLegendary(weaponId: string) {
    const obj = this.loot.get(weaponId);
    if (obj) this.scene.remove(obj);
    this.loot.delete(weaponId);
    this.state.unclaimed = this.state.unclaimed.filter((x) => x !== weaponId);
    this.world.interactables = this.world.interactables.filter((i) => i.id !== `legendary-${weaponId}`);
  }

  // ----------------------------------------------------------------- quests --

  questProgress(id: QuestId, n: number) {
    const q = this.state.quests[id];
    if (q.state !== 'active') return;
    q.progress = Math.min(QUESTS[id].goal, q.progress + n);
    if (id === 'ore') q.progress = Math.min(QUESTS.ore.goal, this.player.c.items['ember-ore'] ?? 0);
    if (id === 'fish') q.progress = Math.min(QUESTS.fish.goal, q.progress);
    if (n > 0) this.hud.toast(`${QUESTS[id].name}: ${q.progress}/${QUESTS[id].goal}`, 'quest');
    if (q.progress >= QUESTS[id].goal && n > 0) this.hud.toast(`${QUESTS[id].name}: complete! Return to ${NPCS.find((x) => x.id === QUESTS[id].giver)?.name}.`, 'quest');
  }

  // ------------------------------------------------------------ interaction --

  private updateInteraction() {
    const p = this.player.pos;
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of this.world.interactables) {
      if (it.used || (it.kind === 'trial' && this.activeTrial)) continue;
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d < it.radius && d < bestD && Math.abs(it.y - p.y) < 4) (best = it), (bestD = d);
    }
    if (this.player.sailing) best = null;
    // By your waiting horse (and nearer it than anything else): climb on.
    const horse = this.player.horsePrompt();
    if (horse && best && this.player.horse!.pos.distanceTo(p) < bestD) best = null;
    this.nearest = best;
    // A duel to answer (or start, standing by a friend), an arena to join: PvP's turn.
    const pvp = this.player.sailing ? null : this.pvp.promptLabel();
    const urgent = pvp !== null && this.pvp.answering;
    const label = urgent ? pvp : best ? this.story.label(best) : horse ?? pvp;
    this.hud.prompt(label);
    // While sailing the interact button steps ashore (the player handles it).
    this.input.setInteract(label ?? (this.player.sailing ? 'Step ashore' : null));
    if (!this.input.pressed.has('interact')) return;
    if (urgent) this.pvp.interact();
    else if (best) this.story.interact(best);
    else if (horse) this.player.mountHorse(this);
    else if (pvp) this.pvp.interact();
  }

  // ---------------------------------------------------------------- saving --

  save() {
    const p = this.player;
    this.state.pos = this.inTrial || !p.alive ? null : [p.pos.x, Math.max(p.pos.y, heightAt(p.pos.x, p.pos.z)), p.pos.z];
    if (p.sailing || p.flying || p.swimming) this.state.pos = null;
    const data: SaveData = { character: p.c, world: this.state };
    const ok = writeSave(data, this.storeKey);
    if (!ok && !this.storeKey) this.hud.toast('Could not save (storage unavailable).', 'warn');
    this.onSaved(data);
  }

  unlockAncient() {
    const u = loadUnlocks();
    if (!u.ancient) {
      u.ancient = true;
      saveUnlocks(u);
      this.onUnlock();
      return true;
    }
    return false;
  }

  get gameMinutes() {
    return this.state.gameMinutes;
  }
  get dayMinutes() {
    return ((this.state.gameMinutes % 1440) + 1440) % 1440;
  }

  passTime(toMinute: number) {
    if (this.coop.isGuest) return this.hud.toast('In co-op the host’s world keeps the time.');
    const day = this.dayMinutes;
    let delta = toMinute - day;
    if (delta <= 0) delta += 1440;
    this.state.gameMinutes += delta;
  }

  // ------------------------------------------------------------------- loop --

  start() {
    this.running = true;
    this.last = performance.now();
    // Name the zone the hero actually starts in (a save can be anywhere).
    this.zone = this.lastZone = zoneAt(this.player.pos.x, this.player.pos.z);
    this.hud.banner(ZONES[this.zone].name, 'zone');
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.elapsed += dt;
      this.update(dt);
      this.render(dt);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    this.coop.shutdown();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (document.pointerLockElement) document.exitPointerLock();
    this.renderer.dispose();
    this.container.innerHTML = '';
  }

  /** Advances the game without rendering (used by automated tests). */
  simulate(seconds: number, step = 1 / 30) {
    for (let t = 0; t < seconds; t += step) this.update(step);
  }

  /** The wardrobe (from the loom, a shrine or the Hero tab). */
  openWardrobe() {
    if (this.menu.isOpen) this.menu.close();
    this.wardrobe.open();
  }

  setMode(m: Mode) {
    this.mode = m;
    this.input.enabled = m === 'play';
    if (m !== 'play' && document.pointerLockElement) document.exitPointerLock();
    // Back from a menu or conversation (a click or key press): capture the mouse again for shift lock.
    if (m === 'play' && this.cam.shiftLock) this.input.requestLock();
    this.input.setTouchVisible(m === 'play' || m === 'dead');
  }

  private update(dt: number) {
    const input = this.input;
    input.poll();
    const t = this.elapsed;
    // With friends the world never pauses (menus and conversations included).
    const playing = this.mode === 'play' || this.mode === 'dead' || this.coop.sharing;
    // Hit-stop slows the action (not the camera or HUD) for a moment.
    const gdt = this.freeze > 0 ? dt * 0.06 : dt;
    this.freeze = Math.max(0, this.freeze - dt);
    this.clock += dt;

    if (this.mode === 'play') {
      if (input.pressed.has('menu')) this.menu.open();
      else if (input.pressed.has('map')) this.menu.open('map');
      if (input.pressed.has('quests')) this.hud.toggleQuests();
    } else if (this.mode === 'menu' && (input.pressed.has('menu') || input.pressed.has('map'))) {
      this.menu.close();
    }

    if (playing) {
      // 1 game minute per real second (a co-op guest follows the host's clock).
      if (!this.coop.isGuest) this.state.gameMinutes += dt;
      this.state.playTime += dt;
      // The field keeps its own clock (a co-op guest's crops grow at home pace too).
      this.state.farm.clock += dt;
      this.farm.update(dt, this);
      this.isNight = this.world.isNight(this.dayMinutes);

      this.cam.look(this);

      // Builder mode: the hero flies and builds; the monsters hold still.
      const building = this.builder.active;
      if (building) this.builder.update(dt);
      else this.player.update(gdt, this);
    }
    if (playing && !this.builder.active) {
      updateHazards(this, gdt);
      this.armory.update(gdt, this);
      if (this.bleedTimer > 0) {
        this.bleedTimer -= dt;
        if (this.player.immuneToBleed()) this.bleedTimer = 0;
        else this.damagePlayer(2 * dt, 'true', null, true);
      }

      const pp = this.player.pos;
      const many = this.heroes.length > 1;
      const mirrorAt = performance.now() / 1000 - 0.13;
      for (const e of this.enemies) {
        // Hostile heroes' stand-ins follow them (engine/pvp.ts moves them).
        if (e.pvpId) continue;
        if (e.net && e.alive) {
          e.updateMirror(gdt, this, mirrorAt);
          continue;
        }
        const d = Math.abs(e.pos.x - pp.x) + Math.abs(e.pos.z - pp.z);
        // Monsters near any hero think; the model is only drawn near this one.
        const active = d < 150 || e instanceof Boss || (many && this.heroDistance(e.pos.x, e.pos.z) < 150);
        if (!(e instanceof Boss)) e.model.root.visible = d < 150;
        // Watchers leave the eye-touched alone unless provoked.
        if (e.def.id === 'eye-watcher' && this.player.c.mysteryRevealed && this.player.c.elfMystery && e.hp >= e.maxHp && !(e instanceof Boss)) {
          e.aware = false;
          e.awareness = 0;
        }
        if (active) e.update(gdt, this);
      }
      for (const a of [...this.allies]) {
        a.update(gdt, this);
        if (!a.alive) {
          this.fx.emit(a.center(), { color: 0xff6020, count: 20, speed: 3, life: 0.5 });
          this.removeAlly(a);
        }
      }
      this.updateProjectiles(gdt);
      this.updateTornados(gdt);
      this.updateCorpses(gdt);
      this.updateNpcs(dt);
      this.updateTrial(dt);
      this.updateZone();
      this.updateEyes(dt);
      if (!this.coop.isGuest) {
        this.spawner.update(dt);
        this.lairs.update();
      }
      this.updateOre();
      if (this.mode === 'play') this.updateInteraction();
      else this.hud.prompt(null);

      this.autosave -= dt;
      if (this.autosave <= 0 && this.mode === 'play' && !this.inTrial) {
        this.autosave = 60;
        this.save();
      }
    }

    this.coop.update(dt);
    this.pvp.update(dt);
    this.wardrobe.update(dt);
    this.cam.update(dt, this);
    // The host runs the monsters around every hero, so it needs the trees' colliders there too.
    const others = this.world.others;
    let n = 0;
    if (this.coop.isHost) for (const r of this.coop.remotes.values()) if (r.ready) ((others[n] ??= { x: 0, z: 0 }).x = r.pos.x), (others[n++].z = r.pos.z);
    others.length = n;
    this.world.update(dt, t, this.dayMinutes, this.player.pos, this.zone, this.player.c.roleId === 'darkslayer' || fedNightVision(this.player.c), this.fog);
    this.fx.update(gdt);
    this.hud.update(dt);
    input.endFrame();
  }

  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      pr.vel.y -= pr.gravity * dt;
      const prev = pr.pos.clone();
      if (pr.returning) {
        // Homing back to the thrower's hand; caught when it arrives.
        const home = pr.home?.() ?? null;
        const to = home ? home.clone().sub(pr.pos) : null;
        if (!to || pr.life <= 0 || to.length() < Math.max(1.1, pr.speed * 1.2 * dt)) {
          this.dropProjectile(i, !!to);
          continue;
        }
        pr.vel.copy(to).multiplyScalar((pr.speed * 1.2) / to.length());
      }
      pr.pos.addScaledVector(pr.vel, dt);
      if (pr.returning) pr.pos.y = Math.max(pr.pos.y, heightAt(pr.pos.x, pr.pos.z) + 0.6);
      pr.mesh.position.copy(pr.pos);
      if (pr.kind === 'arrow' || pr.kind === 'bolt') pr.mesh.lookAt(pr.pos.clone().add(pr.vel));
      if (pr.kind === 'bolt') {
        // The thunderbolt spins in flight and sheds sparks.
        pr.mesh.rotateZ(pr.life * 18);
        if (Math.random() < 0.7) this.fx.emit(pr.pos, { color: Math.random() < 0.5 ? 0xbfe0ff : 0xfff2a0, count: 1, speed: 2.5, life: 0.25, size: 0.35 });
      }
      if (pr.kind === 'axe' || pr.kind === 'knife') pr.mesh.rotation.x += dt * (pr.kind === 'knife' ? 28 : 20);
      if (pr.kind === 'wand') {
        pr.mesh.lookAt(pr.pos.clone().add(pr.vel));
        if (Math.random() < 0.6) this.fx.emit(pr.pos, { color: pr.color ?? 0xb070ff, count: 1, speed: 0.4, life: 0.3, size: 0.35 });
      }
      if (pr.kind === 'fireball' && Math.random() < 0.6) this.fx.emit(pr.pos, { color: 0xff6020, count: 1, speed: 0.5, life: 0.4, size: 0.8 });
      // A charged shot streams its burst's colour.
      const streak = pr.burst?.kind ?? pr.glowing;
      if (streak) this.fx.emit(pr.pos, { color: BURST_COLOR[streak], count: 2, speed: 0.6, life: 0.4, size: 0.5 });
      if (pr.kind === 'orb' && Math.random() < 0.5) this.fx.emit(pr.pos, { color: 0xa070ff, count: 1, speed: 0.5, life: 0.4, size: 0.6 });
      let impact = false;
      if (!pr.returning && (pr.pos.y < heightAt(pr.pos.x, pr.pos.z) || pr.life <= 0)) impact = true;
      if (pr.boomerang && !pr.returning && pr.pos.distanceTo(pr.from) > BOOMERANG_RANGE) impact = true;
      if (pr.owner === 'enemy') {
        // Each player's game checks its own hero; the shot's copies elsewhere check theirs.
        const p = this.player;
        if (p.alive && p.center().distanceTo(pr.pos) < 0.9 + (p.crouching ? 0 : 0.2)) {
          this.damagePlayer(pr.damage * (pr.source && pr.source.status.hex > 0 ? HEX.dealt : 1), pr.element, pr.source);
          impact = true;
        }
      } else {
        for (const e of this.enemies) {
          if (!e.alive || pr.hit.has(e)) continue;
          const c = e.center();
          // Segment-sphere test so fast arrows can't tunnel.
          const seg = pr.pos.clone().sub(prev);
          const t = Math.max(0, Math.min(1, c.clone().sub(prev).dot(seg) / Math.max(1e-6, seg.lengthSq())));
          const closest = prev.clone().addScaledVector(seg, t);
          if (closest.distanceTo(c) < e.radius + 0.35 + e.height * 0.25) {
            pr.hit.add(e);
            pr.struck = e;
            if (pr.owner !== 'remote') this.projectileHit(pr, e);
            // On the way home it cuts through everything in its path.
            if (pr.returning) continue;
            if ((pr.pierce ?? 0) > 0) pr.pierce!--;
            else {
              impact = true;
              break;
            }
          }
        }
      }
      if (impact) {
        // A charged shot bursts where it lands (once; a returning bolt doesn't burst again).
        if (pr.burst && pr.owner === 'player') {
          this.player.burst(this, pr.burst.kind, pr.pos.clone(), pr.burst.charge, pr.burst.base, pr.struck ?? null);
          pr.burst = undefined;
        }
        if (pr.explode) {
          this.fx.ring(pr.pos.clone(), pr.explode, pr.color ?? (pr.element === 'lightning' ? 0xd8e8ff : 0xff6020), 0.45);
          if (pr.owner !== 'remote') for (const e of this.enemies) if (e.alive && !pr.hit.has(e) && e.center().distanceTo(pr.pos) < pr.explode + e.radius) {
            this.damageEnemy(e, pr.damage * 0.7, pr.element, { source: 'spell' });
            if (pr.burn) e.status.burn = 3;
          }
          if (pr.owner !== 'remote') this.shake(0.15);
        } else {
          const color = pr.kind === 'wand' ? (pr.color ?? 0xb070ff) : pr.kind === 'fireball' ? 0xff6020 : pr.kind === 'orb' ? 0xa070ff : pr.kind === 'water' ? 0x60b0ff : 0xc0b090;
          this.fx.emit(pr.pos, { color, count: 10, speed: 3, life: 0.35 });
        }
        // A returning throw turns for home instead of falling.
        if (pr.boomerang && !pr.returning) {
          pr.returning = true;
          pr.hit.clear();
          pr.gravity = 0;
          pr.damage *= 0.5;
          pr.explode = undefined;
          pr.life = 4;
          continue;
        }
        // Our thrown knives wait where they fell to be picked up again.
        if (pr.kind === 'knife' && pr.owner === 'player') this.armory.dropKnife(pr.pos, pr.rune);
        this.dropProjectile(i, false);
      }
    }
  }

  /** Takes a projectile out of play (a returning one is caught, or lost if `caught` is false). */
  private dropProjectile(i: number, caught: boolean) {
    const pr = this.projectiles[i];
    this.scene.remove(pr.mesh);
    disposeObject(pr.mesh);
    this.projectiles.splice(i, 1);
    if (pr.boomerang && pr.owner === 'player') this.player.catchBolt(this, caught);
  }

  private projectileHit(pr: Projectile, e: Enemy) {
    if (pr.owner === 'ally') {
      this.damageEnemy(e, pr.damage, pr.element, { source: 'ally' });
      return;
    }
    const kind = pr.kind === 'arrow' ? 'bow' : pr.kind === 'fireball' || pr.kind === 'orb' || pr.kind === 'water' || pr.kind === 'wand' ? null : 'thrown';
    if (pr.powerShot && !e.aware) {
      // Power Shot: 6x damage while undetected, and 0.5 NDP to everything nearby.
      const p = this.player;
      const r = outgoingDamage(p.c, { base: pr.damage, kind: 'bow', element: pr.element, targetDark: e.dark, undetected: true, fromBehind: false, draw: pr.draw, heroHp: p.hp / p.maxHp, targetHp: e.hp / e.maxHp, warCry: p.warCry > 0 });
      this.damageEnemy(e, r.amount * pr.powerShot.multiplier, pr.element, { source: 'player', tags: ['power'] });
      this.fx.ring(e.center(), pr.powerShot.radius, 0xffd070, 0.5);
      this.hud.toast('POWER SHOT!', 'skill');
      for (const o of this.enemies) if (o !== e && o.alive && o.pos.distanceTo(e.pos) < pr.powerShot.radius) this.damageEnemy(o, r.amount * pr.powerShot.splashFraction, pr.element, { source: 'player' });
      return;
    }
    if (kind) this.hitEnemyWithWeapon(e, pr.damage, kind, pr.element, { draw: pr.draw, ambush: pr.ambush });
    else this.damageEnemy(e, pr.damage, pr.element, { source: 'spell' });
    if (pr.burn) e.status.burn = 3;
    if (pr.slow) e.status.slow = Math.max(e.status.slow, pr.slow);
    if (pr.poison) this.player.envenom(this, e);
    if (pr.element === 'lightning') e.status.stun = Math.max(e.status.stun, 0.4);
    if (pr.rune) this.player.applyRune(this, e, pr.damage, pr.rune);
  }

  private updateTornados(dt: number) {
    for (let i = this.tornados.length - 1; i >= 0; i--) {
      const t = this.tornados[i];
      t.life -= dt;
      if (t.seek) {
        let best: Enemy | null = null;
        let bd = 25;
        for (const e of this.enemies) if (e.alive && e.pos.distanceTo(t.pos) < bd) (bd = e.pos.distanceTo(t.pos)), (best = e);
        if (best) t.pos.addScaledVector(best.pos.clone().sub(t.pos).setY(0).normalize(), dt * 6);
      }
      t.pos.y = heightAt(t.pos.x, t.pos.z);
      for (let k = 0; k < 3; k++) {
        const a = Math.random() * Math.PI * 2;
        const h = Math.random() * 6;
        const r = t.radius * (0.3 + h / 8);
        this.fx.emit(new THREE.Vector3(t.pos.x + Math.cos(a) * r, t.pos.y + h, t.pos.z + Math.sin(a) * r), { color: t.color, count: 1, speed: 1, life: 0.5, size: 0.9, drift: new THREE.Vector3(-Math.sin(a) * 8, 2, Math.cos(a) * 8) });
      }
      for (const e of this.enemies) {
        if (t.remote || !e.alive || e instanceof Boss) continue;
        const d = Math.hypot(e.pos.x - t.pos.x, e.pos.z - t.pos.z);
        if (d < t.radius * 1.6) {
          e.pos.x += ((t.pos.x - e.pos.x) / (d || 1)) * dt * 4;
          e.pos.z += ((t.pos.z - e.pos.z) / (d || 1)) * dt * 4;
          this.damageEnemy(e, t.dps * dt, t.color === 0xff5010 ? 'fire' : 'wind', { dot: true, source: 'spell' });
        }
      }
      if (!t.remote && this.boss && this.boss.alive && this.boss.pos.distanceTo(t.pos) < t.radius + this.boss.radius) this.damageEnemy(this.boss, t.dps * dt, 'wind', { dot: true, source: 'spell' });
      if (t.life <= 0) this.tornados.splice(i, 1);
    }
  }

  private updateCorpses(dt: number) {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.t += dt;
      c.e.update(dt, this);
      // A felled boss lies a while longer.
      if (c.t > (c.e instanceof Boss ? 6 : 3.5)) {
        this.fx.emit(c.e.center(), { color: 0xffc070, count: 16, speed: 1.5, life: 1, up: 1.5 });
        this.removeEnemy(c.e);
        this.corpses.splice(i, 1);
      }
    }
  }

  private updateNpcs(dt: number) {
    const p = this.player.pos;
    for (const n of this.npcs) {
      n.anim.t += dt;
      const d = n.pos.distanceTo(p);
      // Townsfolk far off (deep in the fog) are neither drawn nor moved, and
      // those a little nearer are drawn but not animated (cheap on phones).
      const near = d < 150;
      if (n.rig.root.visible !== near) n.rig.root.visible = near;
      if (d > 90) continue;
      const want = d < 8 ? Math.atan2(p.x - n.pos.x, p.z - n.pos.z) : n.facing;
      let diff = want - n.rig.root.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      n.rig.root.rotation.y += diff * Math.min(1, dt * 3);
      n.anim.attack = n.id === 'brann' && d > 8 ? (n.anim.t % 1.4) / 1.4 : -1;
      n.anim.attackStyle = 'overhead';
      animateHumanoid(n.rig, n.anim);
    }
  }

  private updateTrial(dt: number) {
    const t = this.activeTrial;
    if (!t) {
      // No fog up: a hunted foe in a fight close by still gets its bar.
      const h = huntedNear(this);
      this.hud.setBoss(h ? `${h.bdef.name}, ${h.bdef.title}` : null, h?.hp ?? 0, h?.maxHp ?? 1);
      return;
    }
    const p = this.player.pos;
    const dx = p.x - t.x, dz = p.z - t.z;
    const d = Math.hypot(dx, dz);
    this.trialTime += dt;
    if (this.inTrial) {
      // The fog wall keeps you in.
      if (d > t.radius - 0.6 && this.player.alive) {
        p.x = t.x + (dx / d) * (t.radius - 0.6);
        p.z = t.z + (dz / d) * (t.radius - 0.6);
      }
    } else if (d < t.radius + 1 && d > 1e-3 && this.player.alive) {
      // Someone else's fight: the fog bars the way.
      p.x = t.x + (dx / d) * (t.radius + 1);
      p.z = t.z + (dz / d) * (t.radius + 1);
    }
    // Host: the trial is lost once no one inside is standing (alone, death ends it on respawn).
    if (!this.coop.isGuest && this.trialTime > 3) {
      let standing = this.inTrial && this.player.alive;
      for (const r of this.coop.remotes.values()) if (r.inTrial && r.alive) standing = true;
      if (!standing && (this.coop.sharing || !this.inTrial)) {
        this.endTrial(false);
        this.coop.trialFailed();
        this.hud.toast('The trial is lost. The fog lifts.');
        return;
      }
    }
    if (this.boss) this.hud.setBoss(this.boss.alive ? `${this.boss.bdef.name}, ${this.boss.bdef.title}` : null, this.boss.hp, this.boss.maxHp);
  }

  private updateZone() {
    const p = this.player.pos;
    this.zone = zoneAt(p.x, p.z);
    if (this.zone !== this.lastZone) {
      if (this.lastZone !== null) this.hud.banner(ZONES[this.zone].name, 'zone');
      this.lastZone = this.zone;
      this.audio.setMood(this.inTrial ? 1 : 0, this.zone === 'crossroads' || this.zone === 'swamp');
    }
    // The elf secret wakes at night once the hero has grown a little, or near the eyes.
    const c = this.player.c;
    if (c.elfMystery && !c.mysteryRevealed && ((this.isNight && c.level >= 3) || Math.hypot(p.x - EYES_RUINS.x, p.z - EYES_RUINS.z) < 60)) {
      c.mysteryRevealed = true;
      this.story.revealMystery();
    }
  }

  /** Looking at the eye carvings for too long. */
  private updateEyes(dt: number) {
    const p = this.player;
    const d = Math.hypot(p.pos.x - EYES_RUINS.x, p.pos.z - EYES_RUINS.z);
    let staring = false;
    if (d < 30 && p.alive && this.mode === 'play') {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const to = new THREE.Vector3(EYES_RUINS.x, heightAt(EYES_RUINS.x, EYES_RUINS.z) + 3, EYES_RUINS.z).sub(this.camera.position).normalize();
      // Inside the ring every direction holds an eye.
      staring = d < 13 || dir.dot(to) > 0.94;
    }
    this.eyeStare = staring ? this.eyeStare + dt : Math.max(0, this.eyeStare - dt * 2);
    this.hud.eyes(Math.min(1, this.eyeStare / 3.5));
    if (this.eyeStare > 3.5) {
      this.eyeStare = 0;
      this.story.lookedAtTheEyes();
    }
  }

  private updateOre() {
    for (const [id, at] of Object.entries(this.state.oreRegrow)) {
      if (this.gameMinutes >= at) {
        delete this.state.oreRegrow[id];
        const it = this.world.interactables.find((i) => i.id === id);
        if (it) {
          it.used = false;
          if (it.object) it.object.visible = true;
        }
      }
    }
    void ORE_NODES;
  }

  private render(dt: number) {
    this.post.render(dt);
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.post.setSize(window.innerWidth, window.innerHeight);
  };

  private onVisibility = () => {
    if (document.hidden && this.mode === 'play') this.menu.open();
    this.last = performance.now();
  };

  get glyph() {
    return ANCIENT_GLYPH;
  }
}

function projectileMesh(kind: ProjectileKind, color = 0xb070ff, rune?: RuneId, glow = false): THREE.Object3D {
  const g = new THREE.Group();
  // A charged shot glows with its burst.
  if (glow) g.add(glowSprite(color, 1.6));
  switch (kind) {
    case 'knife': {
      // Tumbling end over end about its local x.
      const k = buildThrowingKnife(rune);
      k.position.y = -0.1;
      g.add(k);
      break;
    }
    case 'wand': {
      // A bright dart of light, pointed along +z.
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), mat(color, { emissive: color, emissiveIntensity: 3 }));
      m.scale.set(0.7, 0.7, 2.6);
      g.add(m);
      g.add(glowSprite(color, 1.1));
      break;
    }
    case 'arrow': {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 4), mat(0x8a6a40));
      shaft.rotation.x = Math.PI / 2;
      g.add(shaft);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.15, 4), mat(0x888888, { metal: 0.8, rough: 0.3 }));
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.5;
      g.add(tip);
      break;
    }
    case 'fireball':
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), mat(0xffa040, { emissive: 0xff5010, emissiveIntensity: 3 })));
      g.add(glowSprite(0xff6020, 2.2));
      break;
    case 'orb':
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), mat(0xc090ff, { emissive: 0x8040ff, emissiveIntensity: 3 })));
      g.add(glowSprite(0x9060ff, 1.8));
      break;
    case 'water':
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), mat(0x60b0ff, { emissive: 0x2060a0, emissiveIntensity: 1, transparent: 0.8 })));
      break;
    case 'bolt': {
      // The thunderbolt itself, laid along the flight (+z).
      const m = buildWeapon('bolt', true);
      m.rotation.x = Math.PI / 2;
      g.add(m);
      g.add(glowSprite(0xfff0a0, 2.8));
      g.add(glowSprite(0x8ec8ff, 4.2, 0.45));
      break;
    }
    case 'axe':
      g.add(buildWeapon('axe'));
      break;
  }
  return g;
}
