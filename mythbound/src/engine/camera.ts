// Third-person camera: damped orbit follow, terrain- and obstacle-aware boom, lock-on
// framing, shift lock (over-the-shoulder), sprint FOV kick and smooth shake.

import * as THREE from 'three';
import { heightAt, WATER_LEVEL } from './terrain';
import { followTurn } from '../rules/touch';
import type { Game } from './game';

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class CameraRig {
  yaw = Math.PI;
  pitch = 0.28;
  /** Wanted boom length (mouse wheel); the camera eases toward it. */
  dist = 6.5;
  /** Shift lock: the hero always faces where the camera looks; the camera sits over the shoulder. */
  shiftLock = false;
  private shakeAmt = 0;
  private shakeT = 0;
  private baseFov: number;
  private fov: number;
  private zoom = 6.5;
  private boom = 6.5;
  private side = 0.3;
  private over = 0;
  private lockK = 0;
  private fresh = true;
  private focus = new THREE.Vector3();
  private aim = new THREE.Vector3();
  private pivot = new THREE.Vector3();
  private back = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor(public camera: THREE.PerspectiveCamera) {
    this.baseFov = this.fov = camera.fov;
  }

  shake(a: number) {
    this.shakeAmt = Math.max(this.shakeAmt, a);
  }

  /** Whether the camera follows the hero round: touch only, while steering, not just after a finger turned it, not mid-swing. */
  private follows(g: Game): boolean {
    const input = g.input;
    const p = g.player;
    if (!input.touch || g.settings.camFollow === false || g.mode !== 'play' || this.shiftLock || input.looking) return false;
    if (performance.now() - input.lookedAt < 1200 || p.attack) return false;
    return input.move.x !== 0 || input.move.y !== 0 || p.riding || p.sailing;
  }

  /** Applies look input; called once per frame while playing. */
  look(g: Game) {
    const input = g.input;
    this.yaw -= input.look.dx;
    // The boom slides along the ground, so the view can tilt up a little further.
    this.pitch = Math.max(-0.55, Math.min(1.15, this.pitch + input.look.dy));
    if (!input.touch && input.wheel && g.mode === 'play' && !g.builder?.active && !g.player.c.spellSlots.some(Boolean)) this.dist = Math.max(2.5, Math.min(12, this.dist + input.wheel * 0.9));
  }

  update(dt: number, g: Game) {
    const p = g.player;
    const cam = this.camera;
    const target = p.lockTarget?.alive ? p.lockTarget : null;
    const snap = this.fresh || dt <= 0;
    this.fresh = false;

    // Lock-on: swing round behind the hero and frame the foe.
    let big = 0;
    if (target) {
      const dx = target.pos.x - p.pos.x, dz = target.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      big = Math.min(1, Math.max(0, (target.height - 2) / 6));
      if (d > 0.6) this.yaw += wrap(Math.atan2(dx, dz) - this.yaw) * damp(6, dt);
      // Look down on small foes, more level at big ones; higher when close.
      const want = 0.24 - 0.12 * big + Math.max(0, 4 - d) * 0.04;
      this.pitch += (want - this.pitch) * damp(3, dt);
    } else if (this.follows(g)) {
      // On a touch screen the camera swings in behind a running hero, so one
      // thumb can steer. Never round to face a hero running back at it.
      this.yaw += followTurn(wrap(p.yaw - this.yaw), Math.hypot(p.vel.x, p.vel.z), dt);
    }
    this.lockK += ((target ? 1 : 0) - this.lockK) * damp(5, dt);
    this.over += ((this.shiftLock || p.drawing > 0 ? 1 : 0) - this.over) * (snap ? 1 : damp(7, dt));
    this.zoom += (this.dist - this.zoom) * (snap ? 1 : damp(9, dt));

    // The point the camera orbits: above the hero, followed with damping.
    const h = p.swimming ? 0.6 : p.crouching ? 1.2 : p.sailing ? 1.9 : p.riding ? 2.5 : 1.55;
    const want = this.v.set(p.pos.x, p.pos.y + h + 0.08 * this.over, p.pos.z);
    if (snap || this.focus.distanceToSquared(want) > 400) this.focus.copy(want);
    else {
      const kx = damp(18, dt);
      this.focus.x += (want.x - this.focus.x) * kx;
      this.focus.z += (want.z - this.focus.z) * kx;
      this.focus.y += (want.y - this.focus.y) * damp(p.flying || p.swimming ? 6 : 10, dt);
      // Never lag more than a step behind (sprints, flights, knockbacks).
      const lx = this.focus.x - want.x, lz = this.focus.z - want.z;
      const lag = Math.hypot(lx, lz);
      if (lag > 0.9) (this.focus.x = want.x + (lx / lag) * 0.9), (this.focus.z = want.z + (lz / lag) * 0.9);
      if (Math.abs(this.focus.y - want.y) > 1.5) this.focus.y = want.y + Math.sign(this.focus.y - want.y) * 1.5;
    }

    // Over the right shoulder in shift lock and while aiming, and partly when
    // locked on so the hero doesn't hide the foe.
    const sideWant = 0.28 + 0.62 * Math.max(this.over, 0.75 * this.lockK);
    this.side += (sideWant - this.side) * (snap ? 1 : damp(8, dt));
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    const pivot = this.pivot.set(this.focus.x + rx * this.side, this.focus.y, this.focus.z + rz * this.side);

    // Where to look: past the hero toward a locked foe.
    const aim = this.aim.copy(pivot);
    if (this.lockK > 0.001 && p.lockTarget) {
      const lt = p.lockTarget;
      const tc = this.v.set(lt.pos.x, Math.min(lt.pos.y + lt.height * 0.55, pivot.y + 2.5), lt.pos.z);
      aim.lerp(tc, 0.28 * this.lockK);
      aim.y = Math.max(aim.y, pivot.y - 0.6);
    }

    // The boom: back along the view, shortened by terrain in the way.
    let len = this.zoom * (p.sailing ? 1.6 : 1) * (1 - 0.2 * this.over) * (1 + 0.25 * this.lockK * big) * (p.drawing > 0 ? 0.8 : 1);
    const cp = Math.cos(this.pitch);
    const back = this.back.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const free = this.clearance(pivot, back, len);
    len = Math.min(len, free);
    // Tree trunks, rocks and walls in the way.
    const hz = Math.hypot(back.x, back.z);
    if (hz > 0.05) len = Math.min(len, Math.max(0.8, g.world.rayHit(pivot.x, pivot.y, pivot.z, back.x / hz, back.y / hz, back.z / hz, len * hz, 0.35) / hz));
    // In a trial, stay inside the fog wall so the fight isn't seen through the fog.
    const arena = g.inTrial ? g.activeTrial : null;
    if (arena && hz > 0.05) {
      const px = pivot.x - arena.x, pz = pivot.z - arena.z;
      const r = arena.radius - 1.5;
      const b2 = hz * hz, pb = px * back.x + pz * back.z, c = px * px + pz * pz - r * r;
      const disc = pb * pb - b2 * c;
      if (disc >= 0) len = Math.min(len, Math.max(0.8, (-pb + Math.sqrt(disc)) / b2));
    }
    // Pull in at once, ease back out.
    this.boom = snap || len < this.boom ? len : this.boom + (len - this.boom) * damp(3.5, dt);
    const pos = cam.position.copy(pivot).addScaledVector(back, this.boom);
    const floor = Math.max(heightAt(pos.x, pos.z) + 0.3, p.swimming || p.pos.y > WATER_LEVEL - 0.5 ? WATER_LEVEL + 0.25 : -Infinity);
    if (pos.y < floor) pos.y = floor;

    // A wider view while sprinting or diving through a roll.
    const fovWant = this.baseFov + (p.sprinting ? 7 : 0) + (p.rollT >= 0 ? 3 : 0) + (p.flying ? 4 : 0) - 4 * (p.drawing > 0 ? p.drawing : 0);
    this.fov += (fovWant - this.fov) * (snap ? 1 : damp(4, dt));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }

    // Shake: smooth noise rather than per-frame jitter, with a little roll.
    let roll = 0;
    if (this.shakeAmt > 0) {
      this.shakeT += dt;
      const s = this.shakeAmt;
      const t = this.shakeT;
      const ox = s * 0.5 * (0.6 * Math.sin(t * 41.3) + 0.4 * Math.sin(t * 27.1 + 1.3));
      const oy = s * 0.5 * (0.6 * Math.sin(t * 37.7 + 2.1) + 0.4 * Math.sin(t * 23.9 + 0.4));
      pos.x += rx * ox;
      pos.z += rz * ox;
      pos.y += oy;
      aim.x += rx * ox * 0.4;
      aim.z += rz * ox * 0.4;
      aim.y += oy * 0.4;
      roll = s * 0.05 * Math.sin(t * 31.3 + 0.7);
      this.shakeAmt = Math.max(0, s - dt * (1.6 + s * 3));
    } else this.shakeT = 0;
    cam.lookAt(aim);
    if (roll) cam.rotateZ(roll);
  }

  /** How far the boom can reach from `from` along `dir` before it meets the ground. */
  private clearance(from: THREE.Vector3, dir: THREE.Vector3, len: number): number {
    const margin = 0.45;
    const step = 0.5;
    let prev = 0;
    for (let t = step; t <= len + 1e-3; t += step) {
      const x = from.x + dir.x * t, y = from.y + dir.y * t, z = from.z + dir.z * t;
      if (y < heightAt(x, z) + margin) {
        // Refine between the last clear sample and this one.
        let lo = prev, hi = t;
        for (let k = 0; k < 4; k++) {
          const m = (lo + hi) / 2;
          if (from.y + dir.y * m < heightAt(from.x + dir.x * m, from.z + dir.z * m) + margin) hi = m;
          else lo = m;
        }
        return Math.max(0.8, lo);
      }
      prev = t;
    }
    return len;
  }
}
