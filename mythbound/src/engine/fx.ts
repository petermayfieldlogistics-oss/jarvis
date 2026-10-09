// Visual effects: particles, spell shapes, ground telegraphs, lightning and
// floating damage numbers.

import * as THREE from 'three';
import { glowTexture, mat } from './models';
import { heightAt } from './terrain';

const PARTICLE_VERT = `
attribute float size;
attribute float alpha;
attribute vec3 tint;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vAlpha = alpha;
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const PARTICLE_FRAG = `
uniform sampler2D map;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vTint * t.rgb, t.a * vAlpha);
}`;

export interface EmitOptions {
  color: number;
  count: number;
  speed?: number;
  life?: number;
  size?: number;
  gravity?: number;
  spread?: number;
  up?: number;
  /** Extra velocity applied to every particle. */
  drift?: THREE.Vector3;
}

class Particles {
  readonly max: number;
  points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private baseSize: Float32Array;
  private alpha: Float32Array;
  private tint: Float32Array;
  private grav: Float32Array;
  private next = 0;
  private c = new THREE.Color();

  constructor(max: number) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.tint = new Float32Array(max * 3);
    this.grav = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        uniforms: { map: { value: glowTexture() } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
  }

  emit(at: THREE.Vector3, o: EmitOptions) {
    this.c.setHex(o.color);
    const speed = o.speed ?? 4;
    const spread = o.spread ?? 1;
    for (let n = 0; n < o.count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * spread * 0.5;
      this.pos[i * 3 + 1] = at.y + (Math.random() - 0.5) * spread * 0.5;
      this.pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * spread * 0.5;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.vel[i * 3] = Math.sin(ph) * Math.cos(th) * s + (o.drift?.x ?? 0);
      this.vel[i * 3 + 1] = Math.abs(Math.cos(ph)) * s * 0.6 + (o.up ?? 0) + (o.drift?.y ?? 0);
      this.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * s + (o.drift?.z ?? 0);
      this.maxLife[i] = this.life[i] = (o.life ?? 0.8) * (0.6 + Math.random() * 0.6);
      this.baseSize[i] = (o.size ?? 0.6) * (0.6 + Math.random() * 0.8);
      this.grav[i] = o.gravity ?? 0;
      this.tint[i * 3] = this.c.r;
      this.tint[i * 3 + 1] = this.c.g;
      this.tint[i * 3 + 2] = this.c.b;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = k;
      this.size[i] = this.baseSize[i] * (0.5 + 0.5 * k);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
    g.attributes.tint.needsUpdate = true;
  }
}

interface Timed {
  obj: THREE.Object3D;
  age: number;
  life: number;
  update?: (k: number, dt: number, obj: THREE.Object3D) => void;
}

export interface Telegraph {
  x: number;
  z: number;
  radius: number;
  delay: number;
  age: number;
  mesh: THREE.Mesh;
  fill: THREE.Mesh;
  done: boolean;
  onDone?: () => void;
}

export class Fx {
  particles: Particles;
  private timed: Timed[] = [];
  telegraphs: Telegraph[] = [];
  private flashes: THREE.PointLight[] = [];
  private numbers: { el: HTMLElement; pos: THREE.Vector3; age: number }[] = [];
  private v = new THREE.Vector3();
  private ringGeo = new THREE.RingGeometry(0.92, 1, 40);
  private discGeo = new THREE.CircleGeometry(1, 40);

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private numberLayer: HTMLElement, lowQuality: boolean) {
    this.particles = new Particles(lowQuality ? 1500 : 4000);
    scene.add(this.particles.points);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 30, 1.5);
      scene.add(l);
      this.flashes.push(l);
    }
    this.ringGeo.rotateX(-Math.PI / 2);
    this.discGeo.rotateX(-Math.PI / 2);
  }

  emit(at: THREE.Vector3, o: EmitOptions) {
    this.particles.emit(at, o);
  }

  add(obj: THREE.Object3D, life: number, update?: Timed['update']) {
    this.scene.add(obj);
    this.timed.push({ obj, age: 0, life, update });
  }

  flash(at: THREE.Vector3, color: number, intensity = 40, distance = 30) {
    const l = this.flashes.find((f) => f.intensity <= 0.1) ?? this.flashes[0];
    l.position.copy(at);
    l.color.setHex(color);
    l.intensity = intensity;
    l.distance = distance;
  }

  /** A red circle that fills up until the attack lands. */
  telegraph(x: number, z: number, radius: number, delay: number, color = 0xff3020, onDone?: () => void): Telegraph {
    const y = heightAt(x, z) + 0.12;
    const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(radius);
    const fill = new THREE.Mesh(this.discGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
    fill.position.set(x, y + 0.01, z);
    fill.scale.setScalar(0.01);
    this.scene.add(mesh, fill);
    const t: Telegraph = { x, z, radius, delay, age: 0, mesh, fill, done: false, onDone };
    this.telegraphs.push(t);
    return t;
  }

  lightning(from: THREE.Vector3, to: THREE.Vector3, color = 0xd8e8ff) {
    const pts: THREE.Vector3[] = [];
    const segs = 12;
    for (let i = 0; i <= segs; i++) {
      const p = from.clone().lerp(to, i / segs);
      if (i > 0 && i < segs) p.add(new THREE.Vector3((Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 2.2));
      pts.push(p);
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending }));
    this.add(line, 0.25, (k, _dt, o) => (((o as THREE.Line).material as THREE.LineBasicMaterial).opacity = 1 - k));
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, from.distanceTo(to), 5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending }));
    core.position.copy(from).lerp(to, 0.5);
    core.lookAt(to);
    core.rotateX(Math.PI / 2);
    this.add(core, 0.12, (k, _dt, o) => (((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 1 - k));
    this.flash(to, color, 80, 40);
    this.emit(to, { color, count: 30, speed: 10, life: 0.4, size: 0.6 });
  }

  /** Expanding ring of fire / shockwave. */
  ring(at: THREE.Vector3, radius: number, color: number, life = 0.6) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.25, 6, 32), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = Math.PI / 2;
    m.position.copy(at);
    this.add(m, life, (k, _dt, o) => {
      o.scale.setScalar(0.5 + radius * k);
      ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 1 - k;
    });
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      this.emit(at, { color, count: 2, speed: radius * 1.6, life, size: 1.2, drift: new THREE.Vector3(Math.cos(a) * radius * 1.4, 0.5, Math.sin(a) * radius * 1.4) });
    }
  }

  /** Spikes of water bursting out of the ground. */
  spikes(x: number, z: number, color = 0x60b0ff, count = 7, radius = 2.2) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random();
      const r = i === 0 ? 0 : radius * Math.random();
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.6, 6), mat(color, { emissive: color, emissiveIntensity: 0.6, transparent: 0.85, rough: 0.1 }));
      const y = heightAt(px, pz);
      s.position.set(px, y - 1.5, pz);
      s.rotation.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
      this.add(s, 0.9, (k, _dt, o) => (o.position.y = y - 1.5 + Math.sin(Math.min(1, k * 1.6) * Math.PI) * 2.2));
    }
    this.emit(new THREE.Vector3(x, heightAt(x, z) + 0.5, z), { color, count: 30, speed: 6, life: 0.7, size: 0.5, gravity: 12, up: 6 });
  }

  /** Pillar of light from above. */
  pillar(at: THREE.Vector3, color: number, radius = 1.4) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 40, 16, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(at).add(new THREE.Vector3(0, 20, 0));
    this.add(m, 0.6, (k, _dt, o) => {
      ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 1 - k;
      o.scale.set(1 - k * 0.6, 1, 1 - k * 0.6);
    });
    this.flash(at, color, 50, 25);
    this.emit(at, { color, count: 40, speed: 5, life: 0.8, size: 0.7, up: 4 });
  }

  damageNumber(at: THREE.Vector3, text: string, cls = '') {
    const el = document.createElement('div');
    el.className = `dmg ${cls}`;
    el.textContent = text;
    this.numberLayer.appendChild(el);
    this.numbers.push({ el, pos: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, 0)), age: 0 });
  }

  update(dt: number) {
    this.particles.update(dt);
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i];
      t.age += dt;
      const k = Math.min(1, t.age / t.life);
      t.update?.(k, dt, t.obj);
      if (k >= 1) {
        this.scene.remove(t.obj);
        t.obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          const material = m.material as THREE.Material | undefined;
          if (material && !(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) material.dispose();
        });
        this.timed.splice(i, 1);
      }
    }
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i];
      t.age += dt;
      t.fill.scale.setScalar(Math.max(0.01, t.radius * Math.min(1, t.age / t.delay)));
      if (t.age >= t.delay) {
        t.done = true;
        t.onDone?.();
        this.scene.remove(t.mesh, t.fill);
        (t.mesh.material as THREE.Material).dispose();
        (t.fill.material as THREE.Material).dispose();
        this.telegraphs.splice(i, 1);
      }
    }
    for (const f of this.flashes) f.intensity *= Math.pow(0.002, dt);
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.age += dt;
      n.pos.y += dt * 1.4;
      this.v.copy(n.pos).project(this.camera);
      if (n.age > 1.1 || this.v.z > 1) {
        n.el.remove();
        this.numbers.splice(i, 1);
        continue;
      }
      n.el.style.transform = `translate(${(this.v.x * 0.5 + 0.5) * w}px, ${(-this.v.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
      n.el.style.opacity = String(1 - Math.max(0, n.age - 0.6) * 2);
    }
  }

  clearTelegraphs() {
    for (const t of this.telegraphs) {
      this.scene.remove(t.mesh, t.fill);
    }
    this.telegraphs = [];
  }
}
