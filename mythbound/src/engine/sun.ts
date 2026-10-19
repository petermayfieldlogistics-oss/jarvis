import * as THREE from 'three';
import type { Game } from './game';
import { Boss, type Enemy } from './entities';
import { buildHumanoid, animateHumanoid, type Rig } from './humanoid';
import { newAnim } from './anim';
import { glowSprite } from './models';
import { WEAPON_TRIALS } from '../data/world';
import { learnSpell } from '../rules/character';
import {
  FRAGMENTS, fragmentsOf, hasSun, HELIOS_BOON, isSunGod, PHOENIX_COOLDOWN, RADIANCE_RADIUS, radianceDps, ECLIPSE,
  SUN_BURN_CHANCE, SUN_CROWN, SUN_FRAGMENT, SUN_GOD, SUN_TREE, sunDamageMul, sunGuardMul,
} from '../rules/sun';

const GOLD = 0xffd27a;

/**
 * The story of the sun in play (rules/sun.ts has the numbers): fragments won
 * from the six trials, the Sun Tree's powers, the ghost of Helios in the fight
 * with Erebus, and the ending that crowns the hero Sun God.
 */
export class SunPowers {
  /** The ghost of Helios has lent the hero his power (for the rest of the fight with Erebus). */
  helios = false;
  private phoenixAt = 0;
  private radT = 0;
  private ghost: { rig: Rig; anim: ReturnType<typeof newAnim>; t: number; mats: THREE.Material[] } | null = null;
  private halo: THREE.Group | null = null;

  constructor(private g: Game) {}

  private get c() {
    return this.g.player.c;
  }

  /** Older saves: a fragment for each weapon trial already won (and the spells they teach). */
  sync() {
    const won = WEAPON_TRIALS.filter((t) => this.g.state.trialsDone.includes(t.id)).length;
    if (fragmentsOf(this.c) < won) this.c.items[SUN_FRAGMENT] = won;
    // (Erebus fell, but the game closed before the dawn: the crown is still owed.)
    if (this.g.state.trialsDone.includes(ECLIPSE) && !isSunGod(this.c)) this.c.items[SUN_CROWN] = 1;
    this.learn();
    this.openEclipse();
  }

  /** All six fragments: the Eclipse quest begins (and ends once the hero is crowned). */
  private openEclipse() {
    const q = this.g.state.quests.eclipse;
    if (!q) return;
    if (isSunGod(this.c)) q.state = 'done';
    else if (fragmentsOf(this.c) >= FRAGMENTS && q.state === 'none') q.state = 'active';
  }

  private learn() {
    if (hasSun(this.c, 'solar-flare')) learnSpell(this.c, 'solar-flare');
  }

  /** A weapon trial won for the first time: its sun fragment, and the branch it wakes. */
  fragmentWon() {
    const c = this.c;
    c.items[SUN_FRAGMENT] = fragmentsOf(c) + 1;
    const n = fragmentsOf(c);
    const node = SUN_TREE[n - 1];
    this.learn();
    this.openEclipse();
    setTimeout(() => {
      this.g.hud.banner(`SUN FRAGMENT ${n} / ${FRAGMENTS}`, 'level', `${node.name} wakes on the Sun Tree`);
      this.g.sfx.pillar(this.g.player.pos.clone(), GOLD, 2.4);
      this.g.audio.play('levelup');
      this.g.hud.toast(n < FRAGMENTS ? 'The night pales a little. Dawn is closer.' : 'All six fragments blaze. The Eclipse has opened on the hill where Helios fell.', 'quest');
    }, 5200);
  }

  /** The hero's blows and spells, strengthened by the sun (and by Helios, while he fights beside you). */
  damageMul() {
    return sunDamageMul(this.c) * (this.helios ? HELIOS_BOON.damage : 1);
  }

  guardMul(attackerDark: boolean) {
    return sunGuardMul(this.c, attackerDark) * (this.helios ? HELIOS_BOON.guard : 1);
  }

  /** Burning Strikes: a hit can set its foe alight. */
  onHit(e: Enemy) {
    if (!hasSun(this.c, 'burning-strikes') || !e.alive || e.affinity === 'fire' || Math.random() > SUN_BURN_CHANCE) return;
    e.status.burn = Math.max(e.status.burn, 3);
    this.g.fx.emit(e.center(), { color: 0xffb040, count: 10, speed: 3, life: 0.5, up: 1 });
  }

  /** Phoenix Dawn: the blow that would have felled the hero raises them instead. */
  phoenix(): boolean {
    const p = this.g.player;
    if (!hasSun(this.c, 'phoenix-dawn') || this.g.state.playTime < this.phoenixAt) return false;
    this.phoenixAt = this.g.state.playTime + PHOENIX_COOLDOWN;
    p.hp = p.maxHp;
    this.g.sfx.pillar(p.pos.clone(), 0xffa040, 2.5);
    this.g.sfx.ring(p.center(), 6, GOLD, 0.8);
    this.g.fx.emit(p.center(), { color: 0xffc060, count: 60, speed: 6, life: 1, up: 3 });
    this.g.hud.toast('Phoenix Dawn! You rise again.', 'quest');
    this.g.audio.play('levelup');
    return true;
  }

  update(dt: number) {
    const g = this.g;
    const p = g.player;
    const c = this.c;
    p.sunMul ??= () => this.damageMul();
    // Radiance: sunlight burns the foes closest to the hero.
    if (hasSun(c, 'radiance') && p.alive && g.mode === 'play') {
      this.radT -= dt;
      if (this.radT <= 0) {
        this.radT = 1;
        const dps = radianceDps(c.level, isSunGod(c));
        let hit = false;
        for (const e of g.enemies) {
          if (!e.alive || e.pvpId || !e.aware || e.pos.distanceTo(p.pos) > RADIANCE_RADIUS + e.radius) continue;
          g.damageEnemy(e, dps, 'light', { source: 'player', dot: true });
          hit = true;
        }
        if (hit) g.fx.ring(p.center(), RADIANCE_RADIUS, GOLD, 0.45);
      }
    }
    // A warm light round the hero once the Sun Tree wakes; the Sun God's halo.
    g.world.heroWarm = hasSun(c, 'ember-heart') ? (isSunGod(c) ? 1 : 0.7) : 0;
    const head = p.rig.head;
    if (isSunGod(c) && this.halo?.parent !== head) {
      this.halo?.removeFromParent();
      this.halo ??= sunHalo();
      head.add(this.halo);
    }
    if (this.halo) this.halo.rotation.y += dt * 0.6;
    // The ghost of Helios floats beside the hero, then fades.
    const gh = this.ghost;
    if (gh) {
      gh.t += dt;
      gh.anim.t += dt;
      const side = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw)).multiplyScalar(2.6);
      const want = p.pos.clone().add(side).add(new THREE.Vector3(0, 0.9 + Math.sin(gh.t * 1.6) * 0.25, 0));
      gh.rig.root.position.lerp(want, Math.min(1, dt * 3));
      gh.rig.root.rotation.y = p.yaw;
      animateHumanoid(gh.rig, gh.anim);
      const fade = Math.min(1, gh.t / 1.5) * (1 - Math.max(0, Math.min(1, (gh.t - 14) / 3)));
      for (const m of gh.mats) m.opacity = 0.62 * fade;
      if (gh.t > 17) this.dropGhost();
    }
  }

  /** Erebus comes down out of the sky over the hill. */
  eclipseBegins(boss: Boss) {
    const g = this.g;
    g.sfx.pillar(boss.pos.clone(), 0x6a40c0, 2.2);
    // A violet fire about him, so the god of darkness can be seen in his own night.
    boss.auraFx ??= g.fx.aura(boss.model.root, 0x8a50ff, 3600);
    g.sfx.magicCircle(boss.pos.clone(), 0x8a50ff, 7, 3.4);
    g.sfx.shake(boss.pos, 0.6);
    g.hud.toast('The stars go out, one by one.', 'boss');
  }

  /** Erebus at half health: the ghost of Helios rises and lends the hero his fire. */
  heliosRises(boss: Boss) {
    const g = this.g;
    const p = g.player;
    this.helios = true;
    this.dropGhost();
    const rig = buildHumanoid({ skin: 0xffe6b0, armor: 0xffd070, cloth: 0xfff2c8, accent: 0xffffff, build: 'robe', head: 'crown', halo: 0xffe28a, featherWings: 0xfff4d8, glowEyes: 0xffffff, garb: 'mage', scale: 1.25 }, false);
    const mats: THREE.Material[] = [];
    rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const list = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => {
        const n = x.clone() as THREE.MeshStandardMaterial;
        n.transparent = true;
        n.opacity = 0;
        n.depthWrite = false;
        if ('emissive' in n) (n.emissive.setHex(0xffc860), (n.emissiveIntensity = 0.9));
        mats.push(n);
        return n;
      });
      m.material = Array.isArray(m.material) ? list : list[0];
      m.castShadow = false;
    });
    rig.root.position.copy(p.pos).add(new THREE.Vector3(0, 6, 0));
    g.scene.add(rig.root);
    this.ghost = { rig, anim: newAnim(), t: 0, mats };
    g.sfx.pillar(p.pos.clone(), GOLD, 1.2);
    g.sfx.ring(p.center(), 8, GOLD, 1);
    g.fx.aura(p.rig.root, GOLD, 600);
    g.hud.banner('HELIOS', 'level', '"He took my sky, not my fire. Take it, and finish this."');
    g.audio.play('levelup');
    void boss;
  }

  /** The fight with Erebus ended (lost or won): the borrowed fire goes back. */
  fightOver() {
    this.helios = false;
    this.dropGhost();
  }

  private dropGhost() {
    if (!this.ghost) return;
    this.ghost.rig.root.removeFromParent();
    for (const m of this.ghost.mats) m.dispose();
    this.ghost = null;
  }

  /** Erebus falls: the crown of the sun, the ending and the credits, then the first day. */
  erebusFell() {
    const g = this.g;
    g.claimLegendary(SUN_CROWN);
    g.state.quests.eclipse.state = 'done';
    setTimeout(() => {
      this.fightOver();
      g.hud.blackout(2.6);
      setTimeout(() => this.ending(), 1300);
    }, 2400);
  }

  private ending() {
    const g = this.g;
    const name = this.c.name;
    const pages = [
      { title: 'Erebus Falls', text: 'The god of darkness comes apart like smoke in a wind. For a moment there is nothing at all: no moon, no stars, only you on the hill where Helios died.' },
      { title: 'Helios', text: `The ghost of the sun god kneels beside you, faint as the last ember of a fire.\n\n"The sun cannot stay dead while someone still carries its fire. You carried six pieces of it across the whole broken land, ${name}. Wear my crown. Light the world."` },
      { title: 'The Sun Reborn', text: 'The six fragments rise out of your pack and spin together above the hill. They catch, and burn, and become one.\n\nAnd the light goes into you.' },
    ];
    const show = (i: number) => {
      const pg = pages[i];
      g.story.open({ title: pg.title, subtitle: i === pages.length - 1 ? SUN_GOD.name : undefined, text: pg.text, options: [{ label: i < pages.length - 1 ? 'Continue' : 'Rise', action: () => (i < pages.length - 1 ? show(i + 1) : this.credits()) }] });
    };
    show(0);
  }

  private credits() {
    const g = this.g;
    g.setMode('event');
    const el = document.createElement('div');
    el.className = 'credits';
    el.style.cssText = 'position:fixed;inset:0;z-index:60;background:radial-gradient(ellipse at 50% 120%,#5a3410 0%,#120a06 55%,#000 100%);color:#f4e2b8;overflow:hidden;font-family:inherit;text-align:center;cursor:pointer';
    const roll = document.createElement('div');
    roll.style.cssText = 'position:absolute;left:0;right:0;top:100%;line-height:1.7;font-size:20px;letter-spacing:0.04em;animation:creditsRoll 34s linear forwards';
    const head = (t: string) => `<div style="font-size:15px;opacity:.65;margin-top:38px;text-transform:uppercase;letter-spacing:.2em">${t}</div>`;
    roll.innerHTML = `
      <div style="font-size:54px;color:#ffd27a;letter-spacing:.12em;text-shadow:0 0 30px #ff9a30">MYTHBOUND</div>
      <div style="opacity:.8">The Sun Reborn</div>
      ${head('The Story')}<div>Erebus slew Helios and the land fell into endless night.</div><div>Six trials. Six fragments of a broken sun.</div><div>One hero who carried them home.</div>
      ${head('Starring')}<div>${esc(this.c.name)} as the Sun God</div><div>Helios, the sun that was</div><div>Erebus, God of Darkness</div>
      ${head('And')}<div>Orrin, Keeper of the Archive</div><div>Brann the smith · Lumen · Quill · Mara · Wren · Nell</div><div>The Chronicler</div>
      ${head('The Six Trials')}<div>Cernunna · Thalassor · Zephyron</div><div>Ignaroth · Aresios · the Shade of Hecate</div>
      ${head('Made by')}<div>The Mythbound team</div><div>Built with Claude Code</div>
      ${head('Thank you for playing')}<div style="margin-top:20px;font-size:26px;color:#ffd27a">The sun rises again.</div><div style="height:40vh"></div>`;
    el.appendChild(roll);
    const style = document.createElement('style');
    style.textContent = '@keyframes creditsRoll{from{transform:translateY(0)}to{transform:translateY(-100%) translateY(-60vh)}}';
    el.appendChild(style);
    const skip = document.createElement('div');
    skip.textContent = 'Tap or press any key to skip';
    skip.style.cssText = 'position:absolute;bottom:14px;right:18px;font-size:13px;opacity:.55';
    el.appendChild(skip);
    document.body.appendChild(el);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.remove();
      window.removeEventListener('keydown', finish);
      this.dawn();
    };
    el.addEventListener('click', finish);
    setTimeout(() => window.addEventListener('keydown', finish), 800);
    roll.addEventListener('animationend', finish);
  }

  /** After the credits: the first sunrise, and the Sun God walks on. */
  private dawn() {
    const g = this.g;
    // Just before sunrise, so the hero watches it come up.
    const day = ((g.state.gameMinutes % 1440) + 1440) % 1440;
    g.state.gameMinutes += (330 - day + 1440) % 1440;
    // Crowned now, as the sun comes up (the night held until this moment).
    this.c.items[SUN_CROWN] = 1;
    g.setMode('play');
    g.hud.banner('SUN GOD', 'victory', 'Day returns to the land.');
    g.audio.play('victory');
    g.save();
  }
}

/** The Sun God's crown of light: a gold ring and a glow over the head. */
function sunHalo(): THREE.Group {
  const grp = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 6, 28), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
  ring.rotation.x = Math.PI / 2;
  grp.add(ring);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const ray = new THREE.Mesh(new THREE.ConeGeometry(0.014, i % 2 ? 0.07 : 0.11, 4), new THREE.MeshBasicMaterial({ color: 0xffcf60 }));
    ray.position.set(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2);
    ray.rotation.set(0, -a, -Math.PI / 2);
    grp.add(ray);
  }
  const glow = glowSprite(0xffc860, 0.9);
  grp.add(glow);
  grp.position.set(0, 0.42, -0.03);
  return grp;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
