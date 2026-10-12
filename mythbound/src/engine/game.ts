import * as THREE from 'three';
import { ANCIENT_GLYPH, RUNES, WEAPONS, runeItem, type DamageElement, type RuneId } from '../data/defs';
import { BOSSES, ENEMIES, EYES_RUINS, NPCS, ORE_NODES, QUESTS, SHRINES, TRIALS, ZONES, type BossDef, type BossId, type EnemyId, type QuestId, type TrialDef, type ZoneId } from '../data/world';
import { addXp, dracoFlightHours, maxHp, type Character } from '../rules/character';
import { elementWeakness, incomingDamage, outgoingDamage, soulOrPowerToll, type FuryState } from '../rules/combat';
import { runeDrop } from '../rules/weapons';
import { Audio } from './audio';
import { CameraRig } from './camera';
import { createPost, type Post } from './post';
import { Spawner } from './spawner';
import { Ally, Boss, Enemy, type Actor } from './entities';
import { Coop, RemoteHero, type KillInfo } from './coop';
import type { Hero } from './hero';
import { SharedFx } from './sharedfx';
import { Fx } from './fx';
import { Input } from './input';
import { buildThrowingKnife, buildWeapon, compact, disposeObject, glowSprite, mat } from './models';
import { Armory } from './armory';
import { animateHumanoid, buildHumanoid, type Rig } from './humanoid';
import { newAnim } from './anim';
import { Player } from './player';
import { loadUnlocks, saveUnlocks, writeSave, type SaveData, type Settings, type WorldState } from './state';
import { heightAt, zoneAt, WATER_LEVEL } from './terrain';
import { World, type Interactable } from './world';
import { Story } from './story';
import { Hud } from '../ui/hud';
import { Dialog } from '../ui/dialog';
import { Menu } from '../ui/menu';

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
}

interface Projectile extends ProjectileSpec {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  mesh: THREE.Object3D;
  hit: Set<Actor>;
}

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
  fog = new THREE.FogExp2(0xb8a27a, 0.006);
  world: World;
  fx: Fx;
  input: Input;
  audio = new Audio();
  hud: Hud;
  dialog: Dialog;
  menu: Menu;
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
  /** The heroes monsters can hunt: the local hero first, then any friends. */
  heroes: Hero[] = [];
  isNight = false;
  nearest: Interactable | null = null;
  eyeStare = 0;
  /** Hit-stop: seconds of near-frozen action left after a heavy blow. */
  private freeze = 0;
  private last = 0;
  private elapsed = 0;
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
    this.sfx = new SharedFx(this);
    this.coop = new Coop(this);
    this.coop.onChange = () => this.menu.coopChanged();

    this.buildNpcs();
    this.setPlayer(character);
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
    if (p) this.player.pos.set(p[0], p[1], p[2]);
    else this.player.pos.set(shrine.x + 2, heightAt(shrine.x + 2, shrine.z + 3), shrine.z + 3);
    this.cam.yaw = Math.PI;
    this.refreshHeroes();
    this.summonLizardKin();
    this.updateTouchButtons();
  }

  updateTouchButtons() {
    const c = this.player.c;
    this.input.setTouchButtons({
      fly: c.raceId === 'draco',
      combine: c.classId === 'mage',
      cast: c.knownSpells.length > 0,
      nextSpell: c.knownSpells.length > 1,
      eat: true,
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
      }[n.id as 'orrin'] ?? { armor: n.color, cloth: n.color, accent: 0x888888, build: 'light' as const, head: 'bare' as const };
      const rig = buildHumanoid({ skin: 0xc89a78, ...look, cape: n.id === 'lumen' ? 0xe8e0c8 : undefined });
      if (n.id === 'brann') rig.handR.add(buildWeapon('hammer'));
      if (n.id === 'mara') rig.handR.add(buildWeapon('trident'));
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
    else if (e.alive && this.coop.isHost) this.coop.gone(e);
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

  spawnProjectile(spec: ProjectileSpec, fromNet = false) {
    if (!fromNet) this.coop.shareProjectile(spec);
    const dir = spec.to.clone().sub(spec.from);
    const dist = dir.length();
    dir.normalize();
    const vel = dir.multiplyScalar(spec.speed);
    // Aim up a little to make arcing shots land where intended.
    if (spec.gravity > 0) vel.y += (spec.gravity * dist) / spec.speed / 2;
    const mesh = projectileMesh(spec.kind, spec.color, spec.rune);
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
  hitEnemyWithWeapon(e: Enemy, base: number, kind: 'melee' | 'bow' | 'thrown', element: DamageElement, o: { fromBehind?: boolean; fury?: FuryState; draw?: number }) {
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
    });
    this.damageEnemy(e, r.amount, element, { source: 'player', tags: r.tags });
    if (kind === 'bow' && c.skills['hunters-mark']) e.status.marked = 8;
  }

  damageEnemy(e: Enemy, amount: number, element: DamageElement, o: { source?: string; dot?: boolean; quiet?: boolean; tags?: string[]; by?: number } = {}) {
    if (!e.alive || amount <= 0) return;
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
    if (element === 'lightning' && e.status.wet > 0 && o.source !== 'spell') dmg *= 1.5;
    e.hp = guest ? Math.max(1, e.hp - dmg) : e.hp - dmg;
    e.hitFlash = 0.15;
    if (!o.dot) e.anim.hurt = 1;
    // Bloodsteal: every point of damage a bleeding foe takes heals the hero.
    if (e.status.bleed > 0 && !remote && this.player.hasBloodsteal()) this.player.heal(dmg);
    if (!o.dot) {
      const tags = o.tags?.filter((t) => t !== 'sneak') ?? [];
      const text = `${Math.round(dmg)}${tags.includes('backstab') ? ' BACKSTAB' : ''}`;
      this.fx.damageNumber(e.center().add(new THREE.Vector3(0, e.height * 0.5, 0)), text, tags.includes('backstab') || tags.includes('power') ? 'crit' : weak === element ? 'weak' : '');
      this.fx.impact(e.center(), e.bleeds ? 0x8a0a0a : 0xd8d0c0, Math.min(1, dmg / 40));
    }
    if (guest) return;
    if (!e.aware && !o.quiet && o.source !== 'devil') e.becomeAware(this);
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy) {
    e.alive = false;
    e.hp = 0;
    this.corpses.push({ e, t: 0 });
    if (this.player.lockTarget === e) this.player.lockTarget = null;
    const isBoss = e instanceof Boss;
    const info: KillInfo = {
      id: isBoss ? e.bdef.id : e.def.id,
      boss: isBoss,
      xp: isBoss ? e.bdef.xp : e.summoned ? e.def.xp * 0.3 : e.def.xp,
      gold: isBoss ? e.bdef.gold : Math.round(e.def.gold * (0.6 + Math.random() * 0.8)),
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
      c.gold += info.gold;
      this.gainXp(info.xp);
      const def = bossDef ? null : ENEMIES[info.id as EnemyId];
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
      // Now and then a rune (always from a boss), matched to what the foe was made of.
      const rune = runeDrop(bossDef ? bossDef.affinity : def!.affinity, !!bossDef, Math.random(), Math.random());
      if (rune) {
        c.items[runeItem(rune)] = (c.items[runeItem(rune)] ?? 0) + 1;
        this.hud.toast(`Found a ${RUNES[rune].name}! Inscribe it on a weapon at an anvil.`, 'quest');
      }
    }
    // A felled boss lifts the fog; those who fought it win the trial.
    if (bossDef) {
      if (this.inTrial || credited) this.completeTrial(bossDef);
      else this.endTrial(true);
    }
  }

  gainXp(xp: number) {
    const gained = addXp(this.player.c, xp);
    if (gained > 0) {
      this.player.hp = this.player.maxHp;
      this.player.mana = this.player.maxMana;
      this.player.refillStamina();
      this.player.flightLeft = dracoFlightHours(this.player.c) * 60;
      this.hud.banner(`LEVEL ${this.player.c.level}`, 'level', 'Skill point gained');
      this.audio.play('levelup');
      this.fx.emit(this.player.center(), { color: 0xffd070, count: 80, speed: 6, life: 1.2, up: 3 });
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
    const p = this.player;
    if (!p.alive || amount <= 0 || this.mode === 'dead') return;
    if (!environmental && p.iframes > 0) return;
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
        p.stagger = 1;
        p.blocking = false;
        blocking = false;
        amount *= 0.5;
        this.hud.toast('Guard broken!', 'warn');
      } else if (warrior) {
        this.fx.damageNumber(p.center(), 'BLOCKED', 'info');
        if (source instanceof Enemy && !(source instanceof Boss) && p.c.skills.riposte) source.status.stun = 1.2;
        return;
      }
    }
    let dmg = incomingDamage(p.c, amount, element, { blocking, stoneSkin: p.stoneSkin > 0, invulnerable: p.aegis > 0 });
    if (p.c.elfMystery && p.c.mysteryRevealed && element === 'dark') dmg *= 1.2;
    dmg = Math.round(dmg * 10) / 10;
    if (dmg <= 0) return;
    if (source) source.damageDealt += dmg;
    if (p.soulOrPower) {
      soulOrPowerToll(p.c, dmg);
      this.hud.toast(`-${Math.round(dmg)} max HP, forever.`, 'devil');
    }
    p.hp = Math.min(p.hp, maxHp(p.c)) - dmg;
    if (dmg >= 1) {
      p.anim.hurt = 1;
      this.hud.hurt(Math.min(1, dmg / 30));
      this.audio.play('hurt');
      this.shake(Math.min(0.5, dmg / 40));
    }
    if (source && !environmental && Math.random() < 0.15 && element === 'physical' && !p.immuneToBleed()) {
      this.hud.toast('You are bleeding.', 'warn');
      this.addPlayerBleed();
    }
    if (p.hp <= 0) this.playerDied();
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
    if (c.gold > 0) {
      this.state.lostEmbers = { x: p.pos.x, y: Math.max(p.pos.y, WATER_LEVEL), z: p.pos.z, amount: c.gold };
      c.gold = 0;
    }
    this.hud.banner('YOU DIED', 'death', cause);
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
    if (peer === undefined && this.state.trialsDone.includes(t.id)) return this.hud.toast('You have already conquered this trial.');
    const boss = new Boss(BOSSES[t.boss], { x: t.x, z: t.z, radius: t.radius });
    // Everyone near the altar is sealed in; more heroes, a tougher boss.
    const inside = (h: Hero) => Math.hypot(h.pos.x - t.x, h.pos.z - t.z) < t.radius + 3;
    const ids: number[] = [];
    for (const r of this.coop.remotes.values()) {
      r.inTrial = r.ready && r.alive && inside(r);
      if (r.inTrial) ids.push(r.id);
    }
    const me = peer === undefined || inside(this.player);
    if (me) ids.push(this.coop.myId);
    if (ids.length > 1) boss.scaleHealth(1 + 0.6 * (ids.length - 1));
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
      this.hud.banner(t.name, 'zone', t.intro);
      this.audio.play('roar');
      this.audio.setMood(1, BOSSES[t.boss].dark);
    } else this.hud.toast(`The fog rises over the ${t.name}.`);
    if (inside && this.state.quests.trials.state === 'none') this.state.quests.trials.state = 'active';
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
      this.questProgress('trials', 1);
    }
    this.save();
  }

  private placeLegendary(weaponId: string) {
    const trial = TRIALS.find((t) => BOSSES[t.boss].reward === weaponId);
    if (!trial || this.loot.has(weaponId)) return;
    const g = new THREE.Group();
    const w = buildWeapon(WEAPONS[weaponId].kind, true);
    w.position.y = 0.4;
    g.add(w);
    const glow = glowSprite(0xffd070, 3);
    glow.position.y = 1;
    g.add(glow);
    const x = trial.x + 3, z = trial.z + 3;
    g.position.set(x, heightAt(x, z) + 0.6, z);
    this.scene.add(g);
    this.loot.set(weaponId, g);
    this.world.interactables.push({ id: `legendary-${weaponId}`, kind: 'loot', x, y: g.position.y, z, radius: 3, label: `Take the ${WEAPONS[weaponId].name}`, object: g });
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
    this.nearest = best;
    const label = best ? this.story.label(best) : null;
    this.hud.prompt(label);
    // While sailing the interact button steps ashore (the player handles it).
    this.input.setInteract(label ?? (this.player.sailing ? 'Step ashore' : null));
    if (best && this.input.pressed.has('interact')) this.story.interact(best);
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

    if (this.mode === 'play') {
      if (input.pressed.has('menu')) this.menu.open();
      else if (input.pressed.has('map')) this.menu.open('map');
    } else if (this.mode === 'menu' && (input.pressed.has('menu') || input.pressed.has('map'))) {
      this.menu.close();
    }

    if (playing) {
      // 1 game minute per real second (a co-op guest follows the host's clock).
      if (!this.coop.isGuest) this.state.gameMinutes += dt;
      this.state.playTime += dt;
      this.isNight = this.world.isNight(this.dayMinutes);

      this.cam.look(this);

      this.player.update(gdt, this);
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
      if (!this.coop.isGuest) this.spawner.update(dt);
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
    this.cam.update(dt, this);
    this.world.update(dt, t, this.dayMinutes, this.player.pos, this.zone, this.player.c.roleId === 'darkslayer', this.fog);
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
      pr.pos.addScaledVector(pr.vel, dt);
      pr.mesh.position.copy(pr.pos);
      if (pr.kind === 'arrow' || pr.kind === 'bolt') pr.mesh.lookAt(pr.pos.clone().add(pr.vel));
      if (pr.kind === 'axe' || pr.kind === 'knife') pr.mesh.rotation.x += dt * (pr.kind === 'knife' ? 28 : 20);
      if (pr.kind === 'wand') {
        pr.mesh.lookAt(pr.pos.clone().add(pr.vel));
        if (Math.random() < 0.6) this.fx.emit(pr.pos, { color: pr.color ?? 0xb070ff, count: 1, speed: 0.4, life: 0.3, size: 0.35 });
      }
      if (pr.kind === 'fireball' && Math.random() < 0.6) this.fx.emit(pr.pos, { color: 0xff6020, count: 1, speed: 0.5, life: 0.4, size: 0.8 });
      if (pr.kind === 'orb' && Math.random() < 0.5) this.fx.emit(pr.pos, { color: 0xa070ff, count: 1, speed: 0.5, life: 0.4, size: 0.6 });
      let impact = false;
      if (pr.pos.y < heightAt(pr.pos.x, pr.pos.z) || pr.life <= 0) impact = true;
      if (pr.owner === 'enemy') {
        // Each player's game checks its own hero; the shot's copies elsewhere check theirs.
        const p = this.player;
        if (p.alive && p.center().distanceTo(pr.pos) < 0.9 + (p.crouching ? 0 : 0.2)) {
          this.damagePlayer(pr.damage, pr.element, pr.source);
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
            if (pr.owner !== 'remote') this.projectileHit(pr, e);
            if ((pr.pierce ?? 0) > 0) pr.pierce!--;
            else {
              impact = true;
              break;
            }
          }
        }
      }
      if (impact) {
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
        // Our thrown knives wait where they fell to be picked up again.
        if (pr.kind === 'knife' && pr.owner === 'player') this.armory.dropKnife(pr.pos, pr.rune);
        this.scene.remove(pr.mesh);
        disposeObject(pr.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private projectileHit(pr: Projectile, e: Enemy) {
    if (pr.owner === 'ally') {
      this.damageEnemy(e, pr.damage, pr.element, { source: 'ally' });
      return;
    }
    const kind = pr.kind === 'arrow' ? 'bow' : pr.kind === 'fireball' || pr.kind === 'orb' || pr.kind === 'water' || pr.kind === 'wand' ? null : 'thrown';
    if (pr.powerShot && !e.aware) {
      // Power Shot: 6x damage while undetected, and 0.5 NDP to everything nearby.
      const r = outgoingDamage(this.player.c, { base: pr.damage, kind: 'bow', element: pr.element, targetDark: e.dark, undetected: true, fromBehind: false, draw: pr.draw });
      this.damageEnemy(e, r.amount * pr.powerShot.multiplier, pr.element, { source: 'player', tags: ['power'] });
      this.fx.ring(e.center(), pr.powerShot.radius, 0xffd070, 0.5);
      this.hud.toast('POWER SHOT!', 'skill');
      for (const o of this.enemies) if (o !== e && o.alive && o.pos.distanceTo(e.pos) < pr.powerShot.radius) this.damageEnemy(o, r.amount * pr.powerShot.splashFraction, pr.element, { source: 'player' });
      return;
    }
    if (kind) this.hitEnemyWithWeapon(e, pr.damage, kind, pr.element, { draw: pr.draw });
    else this.damageEnemy(e, pr.damage, pr.element, { source: 'spell' });
    if (pr.burn) e.status.burn = 3;
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
      if (c.t > 3.5) {
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
      this.hud.setBoss(null);
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

function projectileMesh(kind: ProjectileKind, color = 0xb070ff, rune?: RuneId): THREE.Object3D {
  const g = new THREE.Group();
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
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 5), mat(0xfff2a0, { emissive: 0xffe060, emissiveIntensity: 4 }));
      m.rotation.x = Math.PI / 2;
      g.add(m);
      g.add(glowSprite(0xfff0a0, 2.5));
      break;
    }
    case 'axe':
      g.add(buildWeapon('axe'));
      break;
  }
  return g;
}
