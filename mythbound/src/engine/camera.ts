// Third-person camera: orbit, lock-on, shift lock and shake.

import * as THREE from 'three';
import { heightAt } from './terrain';
import type { Game } from './game';

export class CameraRig {
  yaw = Math.PI;
  pitch = 0.28;
  dist = 6.5;
  /** Shift lock: the hero always faces where the camera looks; the camera sits over the shoulder. */
  shiftLock = false;
  private shakeAmt = 0;
  private v = new THREE.Vector3();

  constructor(public camera: THREE.PerspectiveCamera) {}

  shake(a: number) {
    this.shakeAmt = Math.max(this.shakeAmt, a);
  }

  /** Applies look input; called once per frame while playing. */
  look(g: Game) {
    const input = g.input;
    this.yaw -= input.look.dx;
    this.pitch = Math.max(-0.35, Math.min(1.1, this.pitch + input.look.dy));
    if (!input.touch && input.wheel && g.mode === 'play' && !g.player.c.spellSlots.some(Boolean)) this.dist = Math.max(3, Math.min(12, this.dist + input.wheel));
  }

  update(dt: number, g: Game) {
    const p = g.player;
    const target = p.lockTarget;
    if (target) {
      const want = Math.atan2(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 6);
      this.pitch += (0.22 - this.pitch) * Math.min(1, dt * 3);
    }
    const dist = this.dist * (p.sailing ? 1.6 : 1) * (p.drawing > 0 ? 0.7 : 1);
    const focus = this.v.copy(p.pos).add(new THREE.Vector3(0, p.swimming ? 0.6 : 1.55, 0));
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    focus.addScaledVector(right, p.drawing > 0 || this.shiftLock ? -0.8 : -0.35);
    const cam = this.camera.position;
    cam.set(
      focus.x - Math.sin(this.yaw) * Math.cos(this.pitch) * dist,
      focus.y + Math.sin(this.pitch) * dist,
      focus.z - Math.cos(this.yaw) * Math.cos(this.pitch) * dist,
    );
    const ground = heightAt(cam.x, cam.z) + 0.5;
    if (cam.y < ground) cam.y = ground;
    if (this.shakeAmt > 0) {
      cam.x += (Math.random() - 0.5) * this.shakeAmt;
      cam.y += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2);
    }
    this.camera.lookAt(focus.x, focus.y + 0.1, focus.z);
  }
}
