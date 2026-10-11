// Effects everyone in a co-op game should see: monster and boss attacks, and
// the heroes' own blows and spells. Each call plays here and, when playing
// with friends, is sent to them too. Alone, it is just the local effect.

import * as THREE from 'three';
import type { Sfx } from './audio';
import type { EmitOptions } from './fx';
import type { Game } from './game';

type V3 = [number, number, number];

const r2 = (n: number) => Math.round(n * 100) / 100;
const vec = (v: THREE.Vector3): V3 => [r2(v.x), r2(v.y), r2(v.z)];
const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const str = (x: unknown) => (typeof x === 'string' ? x : '');
const SOUNDS = new Set<Sfx>(['swing', 'hit', 'bow', 'draw', 'spell', 'holy', 'devil', 'roar', 'slam', 'windup', 'roll', 'pickup', 'levelup', 'death', 'drink', 'throw', 'hurt', 'block', 'victory']);

export class SharedFx {
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(private g: Game) {}

  /** Only build messages when someone will receive them. */
  private get on() {
    return this.g.coop.sharing;
  }

  private share(f: string, args: unknown[], x: number, z: number) {
    this.g.coop.shareFx(f, args, x, z);
  }

  /** A filling ground circle; `onDone` (the damage) only runs here, where the attack is decided. */
  telegraph(x: number, z: number, radius: number, delay: number, color = 0xff3020, onDone?: () => void) {
    if (this.on) this.share('tg', [r2(x), r2(z), r2(radius), r2(delay), color], x, z);
    return this.g.fx.telegraph(x, z, radius, delay, color, onDone);
  }

  magicCircle(at: THREE.Vector3, color: number, radius: number, seconds: number) {
    if (this.on) this.share('mc', [vec(at), color, r2(radius), r2(seconds)], at.x, at.z);
    this.g.fx.magicCircle(at, color, radius, seconds);
  }

  ring(at: THREE.Vector3, radius: number, color: number, life = 0.6) {
    if (this.on) this.share('rg', [vec(at), r2(radius), color, r2(life)], at.x, at.z);
    this.g.fx.ring(at, radius, color, life);
  }

  impact(at: THREE.Vector3, color: number, strength: number) {
    if (this.on) this.share('im', [vec(at), color, r2(strength)], at.x, at.z);
    this.g.fx.impact(at, color, strength);
  }

  dust(at: THREE.Vector3, count: number, color = 0xa89878) {
    if (this.on) this.share('du', [vec(at), Math.round(count), color], at.x, at.z);
    this.g.fx.dust(at, count, color);
  }

  lightning(from: THREE.Vector3, to: THREE.Vector3, color = 0xd8e8ff) {
    if (this.on) this.share('li', [vec(from), vec(to), color], to.x, to.z);
    this.g.fx.lightning(from, to, color);
  }

  spikes(x: number, z: number, color = 0x60b0ff, count = 7, radius = 2.2) {
    if (this.on) this.share('sp', [r2(x), r2(z), color, count, r2(radius)], x, z);
    this.g.fx.spikes(x, z, color, count, radius);
  }

  pillar(at: THREE.Vector3, color: number, radius = 1.4) {
    if (this.on) this.share('pi', [vec(at), color, r2(radius)], at.x, at.z);
    this.g.fx.pillar(at, color, radius);
  }

  flash(at: THREE.Vector3, color: number, intensity = 40, distance = 30) {
    if (this.on) this.share('fl', [vec(at), color, r2(intensity), r2(distance)], at.x, at.z);
    this.g.fx.flash(at, color, intensity, distance);
  }

  shockwave(at: THREE.Vector3, radius: number, color: number, life = 0.35) {
    if (this.on) this.share('sw', [vec(at), r2(radius), color, r2(life)], at.x, at.z);
    this.g.fx.shockwave(at, radius, color, life);
  }

  emit(at: THREE.Vector3, o: EmitOptions) {
    if (this.on) {
      const opts: Record<string, unknown> = { ...o };
      if (o.drift) opts.drift = vec(o.drift);
      this.share('em', [vec(at), opts], at.x, at.z);
    }
    this.g.fx.emit(at, o);
  }

  damageNumber(at: THREE.Vector3, text: string, cls = '') {
    if (this.on) this.share('dn', [vec(at), text, cls], at.x, at.z);
    this.g.fx.damageNumber(at, text, cls);
  }

  /** Shakes the camera of everyone close enough to feel it. */
  shake(at: THREE.Vector3, amount: number) {
    if (this.on) this.share('sh', [r2(at.x), r2(at.z), r2(amount)], at.x, at.z);
    this.localShake(at.x, at.z, amount);
  }

  /** A sound heard by everyone within `range` metres. */
  sound(name: Sfx, at: THREE.Vector3, range = 60) {
    if (this.on) this.share('so', [name, r2(at.x), r2(at.z), range], at.x, at.z);
    this.localSound(name, at.x, at.z, range);
  }

  /** A message for everyone close by (a boss growing enraged). */
  toast(text: string, kind: string, at: THREE.Vector3) {
    if (this.on) this.share('to', [text, kind, r2(at.x), r2(at.z)], at.x, at.z);
    this.localToast(text, kind, at.x, at.z);
  }

  private near(x: number, z: number, range: number) {
    const p = this.g.player.pos;
    return Math.hypot(p.x - x, p.z - z) < range;
  }

  private localShake(x: number, z: number, amount: number) {
    const p = this.g.player.pos;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < 60) this.g.shake(amount * Math.min(1, 1.4 - d / 50));
  }

  private localSound(name: Sfx, x: number, z: number, range: number) {
    if (this.near(x, z, range)) this.g.audio.play(name);
  }

  private localToast(text: string, kind: string, x: number, z: number) {
    if (this.near(x, z, 80)) this.g.hud.toast(text, kind);
  }

  /** Plays an effect another player sent. Bad data is ignored. */
  play(f: string, args: unknown[]) {
    const fx = this.g.fx;
    const v = (x: unknown, out: THREE.Vector3) => {
      const a = Array.isArray(x) ? x : [];
      return out.set(num(a[0]), num(a[1]), num(a[2]));
    };
    const A = args;
    switch (f) {
      case 'tg':
        fx.telegraph(num(A[0]), num(A[1]), num(A[2], 1), num(A[3], 1), num(A[4], 0xff3020));
        break;
      case 'mc':
        fx.magicCircle(v(A[0], this.a), num(A[1]), num(A[2], 1), num(A[3], 1));
        break;
      case 'rg':
        fx.ring(v(A[0], this.a), num(A[1], 1), num(A[2]), num(A[3], 0.6));
        break;
      case 'im':
        fx.impact(v(A[0], this.a), num(A[1]), num(A[2], 0.5));
        break;
      case 'du':
        fx.dust(v(A[0], this.a), Math.min(40, num(A[1], 4)), num(A[2], 0xa89878));
        break;
      case 'li':
        fx.lightning(v(A[0], this.a), v(A[1], this.b), num(A[2], 0xd8e8ff));
        break;
      case 'sp':
        fx.spikes(num(A[0]), num(A[1]), num(A[2], 0x60b0ff), Math.min(20, num(A[3], 7)), num(A[4], 2.2));
        break;
      case 'pi':
        fx.pillar(v(A[0], this.a), num(A[1]), num(A[2], 1.4));
        break;
      case 'fl':
        fx.flash(v(A[0], this.a), num(A[1]), num(A[2], 40), num(A[3], 30));
        break;
      case 'sw':
        fx.shockwave(v(A[0], this.a), num(A[1], 1), num(A[2]), num(A[3], 0.35));
        break;
      case 'em': {
        const o = (A[1] && typeof A[1] === 'object' ? A[1] : {}) as Record<string, unknown>;
        const opts: EmitOptions = { color: num(o.color, 0xffffff), count: Math.min(120, num(o.count, 10)) };
        for (const k of ['speed', 'life', 'size', 'gravity', 'spread', 'up', 'grow', 'drag', 'opacity'] as const) if (typeof o[k] === 'number') opts[k] = o[k] as number;
        if (Array.isArray(o.drift)) opts.drift = v(o.drift, new THREE.Vector3());
        fx.emit(v(A[0], this.a), opts);
        break;
      }
      case 'dn':
        fx.damageNumber(v(A[0], this.a), str(A[1]).slice(0, 24), str(A[2]).replace(/[^a-z ]/g, ''));
        break;
      case 'sh':
        this.localShake(num(A[0]), num(A[1]), Math.min(1, num(A[2])));
        break;
      case 'so': {
        const name = str(A[0]) as Sfx;
        if (SOUNDS.has(name)) this.localSound(name, num(A[1]), num(A[2]), num(A[3], 60));
        break;
      }
      case 'to':
        this.localToast(str(A[0]).slice(0, 80), str(A[1]).replace(/[^a-z]/g, ''), num(A[2]), num(A[3]));
        break;
    }
  }
}
