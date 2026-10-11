// Visual effects: particles, spell shapes, ground telegraphs, lightning,
// floating damage numbers, and the combat hooks (weapon trails, auras, rune
// circles, hit impacts and dust).

import * as THREE from 'three';
import { glowTexture, mat } from './models';
import { mulberry32 } from './noise';
import { heightAt, normalAt, WATER_LEVEL } from './terrain';

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
uniform float light;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vTint * t.rgb * light, t.a * vAlpha);
}`;

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(0xffffff);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Catmull-Rom between p1 and p2. */
const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);

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
  /** Size change over the lifetime: -0.5 (default) shrinks to half, 1 doubles. */
  grow?: number;
  /** Fraction of speed lost per second. */
  drag?: number;
  /** Peak opacity (default 1). */
  opacity?: number;
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
  private grow: Float32Array;
  private drag: Float32Array;
  private amul: Float32Array;
  private next = 0;
  private live = 0;
  private dirty = false;
  private c = new THREE.Color();

  constructor(max: number, map: THREE.Texture, blending: THREE.Blending, private fadeIn = false) {
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
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.amul = new Float32Array(max);
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
        uniforms: { map: { value: map }, light: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending,
      }),
    );
    this.points.frustumCulled = false;
  }

  emit(at: THREE.Vector3, o: EmitOptions) {
    this.c.setHex(o.color);
    const speed = o.speed ?? 4;
    const spread = o.spread ?? 1;
    const dx = o.drift?.x ?? 0, dy = o.drift?.y ?? 0, dz = o.drift?.z ?? 0;
    for (let n = 0; n < o.count; n++) {
      const th = Math.random() * TAU;
      const ph = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.spawn(
        at.x + (Math.random() - 0.5) * spread * 0.5,
        at.y + (Math.random() - 0.5) * spread * 0.5,
        at.z + (Math.random() - 0.5) * spread * 0.5,
        Math.sin(ph) * Math.cos(th) * s + dx,
        Math.abs(Math.cos(ph)) * s * 0.6 + (o.up ?? 0) + dy,
        Math.sin(ph) * Math.sin(th) * s + dz,
        (o.life ?? 0.8) * (0.6 + Math.random() * 0.6),
        (o.size ?? 0.6) * (0.6 + Math.random() * 0.8),
        this.c,
        o.gravity ?? 0,
        o.grow ?? -0.5,
        o.drag ?? 0,
        o.opacity ?? 1,
      );
    }
  }

  /** One fully specified particle (no allocation). */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: THREE.Color, grav: number, grow: number, drag: number, amul: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.maxLife[i] = this.life[i] = Math.max(0.01, life);
    this.baseSize[i] = size;
    this.grav[i] = grav;
    this.grow[i] = grow;
    this.drag[i] = drag;
    this.amul[i] = amul;
    this.tint[i3] = color.r;
    this.tint[i3 + 1] = color.g;
    this.tint[i3 + 2] = color.b;
    this.dirty = true;
  }

  update(dt: number) {
    if (!this.live && !this.dirty) {
      this.points.visible = false;
      return;
    }
    this.points.visible = true;
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      live++;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const i3 = i * 3;
      const dr = this.drag[i] > 0 ? Math.max(0, 1 - this.drag[i] * dt) : 1;
      this.vel[i3] *= dr;
      this.vel[i3 + 1] = (this.vel[i3 + 1] - this.grav[i] * dt) * dr;
      this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.alpha[i] = this.amul[i] * k * (this.fadeIn ? Math.min(1, (1 - k) * 7) : 1);
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * (1 - k));
    }
    this.live = live;
    this.dirty = false;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
    g.attributes.tint.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- trails --

const TRAIL_N = 48;
const MAX_TRAILS = 12;
const TRAIL_VERT = `
attribute vec2 fade;
varying vec2 vF;
void main() {
  vF = fade;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const TRAIL_FRAG = `
uniform vec3 color;
uniform float opacity;
varying vec2 vF;
void main() {
  float a = vF.x;
  float across = vF.y;
  float body = smoothstep(0.0, 0.6, across) * (0.25 + 0.75 * across * across);
  float core = a * a * a * smoothstep(0.7, 1.0, across);
  gl_FragColor = vec4(mix(color, vec3(1.0), core * 0.7), a * a * body * opacity);
}`;

let trailIndex: THREE.BufferAttribute | null = null;

/** One ribbon: a strip of (base, tip) samples, newest first. */
class Trail {
  key: object | null = null;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  pos = new Float32Array(TRAIL_N * 6);
  fade = new Float32Array(TRAIL_N * 4);
  age = new Float32Array(TRAIL_N);
  count = 0;
  life = 0.2;
  idle = 0;
  private posAttr: THREE.BufferAttribute;
  private fadeAttr: THREE.BufferAttribute;

  constructor() {
    if (!trailIndex) {
      const idx = new Uint16Array((TRAIL_N - 1) * 6);
      for (let i = 0; i < TRAIL_N - 1; i++) {
        const v = i * 2;
        idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
      }
      trailIndex = new THREE.BufferAttribute(idx, 1);
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.fadeAttr = new THREE.BufferAttribute(this.fade, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('fade', this.fadeAttr);
    geo.setIndex(trailIndex);
    geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      uniforms: { color: { value: new THREE.Color() }, opacity: { value: 0.8 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  push(bx: number, by: number, bz: number, tx: number, ty: number, tz: number, age: number) {
    this.pos.copyWithin(6, 0, (TRAIL_N - 1) * 6);
    this.age.copyWithin(1, 0, TRAIL_N - 1);
    this.pos[0] = bx;
    this.pos[1] = by;
    this.pos[2] = bz;
    this.pos[3] = tx;
    this.pos[4] = ty;
    this.pos[5] = tz;
    this.age[0] = age;
    this.count = Math.min(TRAIL_N, this.count + 1);
  }

  /** Ages the samples; false once the ribbon has faded out. */
  update(dt: number): boolean {
    let alive = 0;
    const n = this.count;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      const fresh = 1 - this.age[i] / this.life;
      if (fresh > 0) alive = i + 1;
      // Soften the oldest end so it never stops on a hard edge.
      const along = Math.max(0, fresh) * Math.min(1, (n - 1 - i) / 3);
      const f = i * 4;
      this.fade[f] = along;
      this.fade[f + 1] = 0;
      this.fade[f + 2] = along;
      this.fade[f + 3] = 1;
    }
    if (!alive) {
      this.count = 0;
      this.mesh.visible = false;
      return false;
    }
    if (n < 2) {
      this.mesh.visible = false;
      return true;
    }
    this.mesh.geometry.setDrawRange(0, (Math.min(n, alive + 1) - 1) * 6);
    this.posAttr.needsUpdate = true;
    this.fadeAttr.needsUpdate = true;
    this.mesh.visible = true;
    return true;
  }
}

// ---------------------------------------------------------------- auras --

interface AuraFx {
  target: THREE.Object3D;
  color: THREE.Color;
  hot: THREE.Color;
  left: number;
  out: number;
  h: number;
  r: number;
  acc: number;
  t: number;
  glow: THREE.Sprite;
}

// --------------------------------------------------------- rune circles --

interface Circle {
  a: THREE.Mesh;
  b: THREE.Mesh;
  ma: THREE.MeshBasicMaterial;
  mb: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  radius: number;
  angle: number;
  spin: number;
  tilt: THREE.Quaternion;
  color: THREE.Color;
  at: THREE.Vector3;
  acc: number;
  active: boolean;
}

interface Flash {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  r0: number;
  r1: number;
  peak: number;
  flat: boolean;
}

const texCache = new Map<string, THREE.Texture>();

/** A white rune circle (outer) or sigil (inner), drawn once and tinted by materials. */
function circleTexture(kind: 'outer' | 'inner', size: number): THREE.Texture {
  const key = `${kind}${size}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const c = size / 2;
  const rnd = mulberry32(kind === 'outer' ? 7 : 11);
  g.strokeStyle = g.fillStyle = '#fff';
  g.lineCap = g.lineJoin = 'round';
  g.shadowColor = 'rgba(255,255,255,0.9)';
  g.shadowBlur = size / 70;
  const ring = (r: number, w: number) => {
    g.lineWidth = w;
    g.beginPath();
    g.arc(c, c, r * c, 0, TAU);
    g.stroke();
  };
  const poly = (r: number, n: number, start: number, step = 1) => {
    g.beginPath();
    for (let k = 0; k <= n; k++) {
      const a = start + ((k * step) / n) * TAU;
      const x = c + Math.cos(a) * r * c, y = c + Math.sin(a) * r * c;
      if (k) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
  };
  // A rune: strokes between points of a 3x3 grid.
  const glyph = (s: number) => {
    g.lineWidth = s * 0.24;
    g.beginPath();
    if (rnd() < 0.7) (g.moveTo(0, -s), g.lineTo(0, s));
    const strokes = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < strokes; k++) {
      g.moveTo((Math.floor(rnd() * 3) - 1) * s * 0.6, (Math.floor(rnd() * 3) - 1) * s);
      g.lineTo((Math.floor(rnd() * 3) - 1) * s * 0.6, (Math.floor(rnd() * 3) - 1) * s);
    }
    g.stroke();
    if (rnd() < 0.3) {
      g.beginPath();
      g.arc(0, (rnd() - 0.5) * s, s * 0.22, 0, TAU);
      g.stroke();
    }
  };
  const w = size / 512;
  if (kind === 'outer') {
    ring(0.97, 7 * w);
    ring(0.9, 2.5 * w);
    const n = 30;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      g.save();
      g.translate(c + Math.cos(a) * c * 0.835, c + Math.sin(a) * c * 0.835);
      g.rotate(a + Math.PI / 2);
      glyph(size * 0.032);
      g.restore();
    }
    ring(0.77, 2.5 * w);
    ring(0.73, 5 * w);
    g.lineWidth = 3.5 * w;
    poly(0.73, 3, -Math.PI / 2);
    poly(0.73, 3, Math.PI / 2);
    for (let k = 0; k < 6; k++) {
      const a = -Math.PI / 2 + (k / 6) * TAU;
      g.lineWidth = 3 * w;
      g.beginPath();
      g.arc(c + Math.cos(a) * c * 0.73, c + Math.sin(a) * c * 0.73, c * 0.055, 0, TAU);
      g.stroke();
    }
    ring(0.37, 3 * w);
    g.lineWidth = 2 * w;
    g.beginPath();
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * TAU;
      const r0 = 0.37, r1 = k % 4 ? 0.41 : 0.45;
      g.moveTo(c + Math.cos(a) * r0 * c, c + Math.sin(a) * r0 * c);
      g.lineTo(c + Math.cos(a) * r1 * c, c + Math.sin(a) * r1 * c);
    }
    g.stroke();
  } else {
    ring(0.95, 6 * w);
    ring(0.84, 2 * w);
    g.lineWidth = 3 * w;
    poly(0.84, 4, 0);
    poly(0.84, 4, Math.PI / 4);
    poly(0.84, 8, 0, 3);
    ring(0.4, 4 * w);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + Math.PI / 8;
      g.save();
      g.translate(c + Math.cos(a) * c * 0.62, c + Math.sin(a) * c * 0.62);
      g.rotate(a + Math.PI / 2);
      glyph(size * 0.045);
      g.restore();
    }
    const grad = g.createRadialGradient(c, c, 0, c, c, c * 0.3);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(c, c, c * 0.3, 0, TAU);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

/** A soft cloud blob for dust and blood mist. */
function puffTexture(): THREE.Texture {
  const hit = texCache.get('puff');
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const rnd = mulberry32(5);
  for (let k = 0; k < 7; k++) {
    const x = 32 + (rnd() - 0.5) * 18, y = 32 + (rnd() - 0.5) * 18, r = 12 + rnd() * 12;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.42)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(cv);
  texCache.set('puff', tex);
  return tex;
}

// ------------------------------------------------------------------- fx --

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
  /** Normal-blended puffs: dust, blood, smoke. They are unlit, so they follow the daylight. */
  soft: Particles;
  private sun: THREE.Light | null = null;
  private hemi: THREE.Light | null = null;
  private timed: Timed[] = [];
  telegraphs: Telegraph[] = [];
  private flashes: THREE.PointLight[] = [];
  private numbers: { el: HTMLElement; pos: THREE.Vector3; age: number }[] = [];
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private col = new THREE.Color();
  private col2 = new THREE.Color();
  private q = new THREE.Quaternion();
  private box = new THREE.Box3();
  private ringGeo = new THREE.RingGeometry(0.92, 1, 40);
  private discGeo = new THREE.CircleGeometry(1, 40);
  private planeGeo = new THREE.PlaneGeometry(2, 2);
  private flashGeo = new THREE.RingGeometry(0.84, 1, 40);
  private torusGeo = new THREE.TorusGeometry(1, 0.09, 6, 48);
  private trails: Trail[] = [];
  /** Length of the last frame, so trail gaps are judged against the frame rate. */
  private frameDt = 1 / 60;
  private trailMap = new Map<object, Trail>();
  private trailTmp = new Float32Array(6 * 8);
  private trailNew = new Float32Array(6);
  private auras: AuraFx[] = [];
  private circles: Circle[] = [];
  private rings: Flash[] = [];
  private texSize: number;

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private numberLayer: HTMLElement, private lowQuality: boolean) {
    this.particles = new Particles(lowQuality ? 1500 : 4000, glowTexture(), THREE.AdditiveBlending);
    this.particles.points.renderOrder = 2;
    this.soft = new Particles(lowQuality ? 500 : 1200, puffTexture(), THREE.NormalBlending, true);
    this.soft.points.renderOrder = 1;
    scene.add(this.particles.points, this.soft.points);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 30, 1.5);
      scene.add(l);
      this.flashes.push(l);
    }
    this.ringGeo.rotateX(-Math.PI / 2);
    this.discGeo.rotateX(-Math.PI / 2);
    this.planeGeo.rotateX(-Math.PI / 2);
    this.texSize = lowQuality ? 256 : 512;
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
    const m = new THREE.Mesh(this.torusGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.userData.sharedGeo = true;
    m.rotation.x = Math.PI / 2;
    m.position.copy(at);
    this.add(m, life, (k, _dt, o) => {
      // Fast out, slowing as it spreads; the tube stays slim.
      const s = 0.5 + radius * (1 - (1 - k) * (1 - k));
      o.scale.set(s, s, 1 + s * 0.15);
      ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - k) * (1 - k);
    });
    this.ringFlash(at, color, 0.4, radius * 1.1, life * 0.8, 0.7, true);
    const c = this.col.setHex(color);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU + Math.random() * 0.15;
      const sp = (radius / life) * (0.75 + Math.random() * 0.4);
      this.col2.copy(c).lerp(WHITE, Math.random() * 0.4);
      this.particles.spawn(at.x, at.y, at.z, Math.cos(a) * sp, 0.4 + Math.random() * 1.2, Math.sin(a) * sp, life * (0.7 + Math.random() * 0.4), 0.5 + Math.random() * 0.5, this.col2, 0, -0.5, 0.6, 1);
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

  // ------------------------------------------------------------- hooks --
  // Gameplay code calls these; they are the contract for combat effects.

  /**
   * Weapon trail: call every frame while a blade is swinging, with the
   * blade's base and tip in world space. `key` identifies the trail (use the
   * weapon object). The ribbon fades once points stop arriving. `width`
   * scales the ribbon from the tip toward the base; `life` is how long each
   * sample glows (longer for sweeping moves like a spin).
   */
  trailPoint(key: object, base: THREE.Vector3, tip: THREE.Vector3, color: number, width = 1, life = 0.2): void {
    let tr = this.trailMap.get(key);
    if (!tr) tr = this.claimTrail(key);
    tr.mat.uniforms.color.value.setHex(color);
    tr.life = Math.max(0.05, life);
    // A pause in feeding means a new swing: start a fresh ribbon instead of
    // bridging from the last swing's follow-through to this one's wind-up.
    if (tr.idle > Math.max(0.08, this.frameDt * 1.6)) tr.count = 0;
    tr.idle = 0;
    const w = Math.max(0.1, Math.min(3, width));
    const bx = tip.x + (base.x - tip.x) * w, by = tip.y + (base.y - tip.y) * w, bz = tip.z + (base.z - tip.z) * w;
    const p = tr.pos;
    if (tr.count >= 1) {
      // At low frame rates, bridge big gaps with a curve through the last samples.
      const gap = Math.hypot(tip.x - p[3], tip.y - p[4], tip.z - p[5]);
      const extra = Math.min(8, Math.floor(gap / 0.16));
      if (extra > 0) {
        const o = tr.count >= 2 ? 6 : 0;
        const tmp = this.trailTmp;
        const nw = this.trailNew;
        nw[0] = bx;
        nw[1] = by;
        nw[2] = bz;
        nw[3] = tip.x;
        nw[4] = tip.y;
        nw[5] = tip.z;
        const age1 = tr.age[0];
        for (let k = 1; k <= extra; k++) {
          const t = k / (extra + 1);
          for (let c = 0; c < 6; c++) {
            const p1 = p[c], p0 = p[o + c], p2 = nw[c];
            tmp[(k - 1) * 6 + c] = cr(p0, p1, p2, 2 * p2 - p1, t);
          }
        }
        for (let k = 0; k < extra; k++) {
          const s = k * 6;
          tr.push(tmp[s], tmp[s + 1], tmp[s + 2], tmp[s + 3], tmp[s + 4], tmp[s + 5], age1 * (1 - (k + 1) / (extra + 1)));
        }
      }
    }
    tr.push(bx, by, bz, tip.x, tip.y, tip.z, 0);
  }

  private claimTrail(key: object): Trail {
    let tr = this.trails.find((t) => !t.key);
    if (!tr && this.trails.length < MAX_TRAILS) {
      tr = new Trail();
      this.trails.push(tr);
      this.scene.add(tr.mesh);
    }
    if (!tr) {
      tr = this.trails.reduce((a, b) => (b.idle > a.idle ? b : a));
      this.trailMap.delete(tr.key!);
    }
    tr.key = key;
    tr.count = 0;
    this.trailMap.set(key, tr);
    return tr;
  }

  /** A flickering aura (flames, sparks) that follows `target` for `seconds`. Returns a handle to stop it early. */
  aura(target: THREE.Object3D, color: number, seconds: number): { stop(): void } {
    // Size it from where the joints are (skinned meshes make mesh bounds unreliable).
    target.updateWorldMatrix(true, true);
    const box = this.box.makeEmpty();
    target.traverse((o) => void box.expandByPoint(o.getWorldPosition(this.v2)));
    target.getWorldPosition(this.v);
    const given = target.userData.height as number | undefined;
    const h = Math.max(0.5, Math.min(14, given ?? box.max.y - this.v.y + 0.3));
    const r = Math.max(0.3, Math.min(4, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.4));
    const c = new THREE.Color(color);
    const hot = c.clone().lerp(WHITE, 0.45);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: hot, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    const ws = target.getWorldScale(this.v2);
    const sc = 1 / Math.max(1e-3, ws.x);
    glow.scale.set(r * 4.5 * sc, h * 1.5 * sc, 1);
    glow.position.y = h * 0.5 * sc;
    glow.renderOrder = 2;
    target.add(glow);
    const a: AuraFx = { target, color: c, hot, left: seconds, out: 0, h, r, acc: 0, t: 0, glow };
    this.auras.push(a);
    return { stop: () => void (a.left = Math.min(a.left, 0)) };
  }

  /** A glowing rune circle on the ground, for spell casting and boss summons. */
  magicCircle(at: THREE.Vector3, color: number, radius: number, seconds: number): void {
    let c = this.circles.find((x) => !x.active);
    if (!c) {
      if (this.circles.length >= 8) c = this.circles.reduce((a, b) => (b.age / b.life > a.age / a.life ? b : a));
      else {
        const opts = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0 } as const;
        const ma = new THREE.MeshBasicMaterial({ ...opts, map: circleTexture('outer', this.texSize) });
        const mb = new THREE.MeshBasicMaterial({ ...opts, map: circleTexture('inner', this.texSize) });
        const a = new THREE.Mesh(this.planeGeo, ma);
        const b = new THREE.Mesh(this.planeGeo, mb);
        a.renderOrder = b.renderOrder = 1;
        a.frustumCulled = b.frustumCulled = false;
        this.scene.add(a, b);
        c = { a, b, ma, mb, age: 0, life: 1, radius: 1, angle: 0, spin: 1, tilt: new THREE.Quaternion(), color: new THREE.Color(), at: new THREE.Vector3(), acc: 0, active: false };
        this.circles.push(c);
      }
    }
    const ground = heightAt(at.x, at.z);
    const onGround = at.y - ground < 0.6;
    const y = Math.max(at.y, ground, onGround && ground < WATER_LEVEL ? WATER_LEVEL : -Infinity) + 0.06 + radius * 0.012;
    c.at.set(at.x, y, at.z);
    if (onGround && ground >= WATER_LEVEL) c.tilt.setFromUnitVectors(UP, normalAt(at.x, at.z, this.v));
    else c.tilt.identity();
    c.active = true;
    c.age = 0;
    c.life = Math.max(0.3, seconds);
    c.radius = radius;
    c.angle = Math.random() * TAU;
    c.spin = (0.5 + 0.9 / Math.max(1, radius)) * (Math.random() < 0.5 ? -1 : 1);
    c.color.setHex(color);
    c.ma.color.copy(c.color);
    c.mb.color.copy(c.color).lerp(WHITE, 0.25);
    c.acc = 0;
    c.a.position.copy(c.at);
    c.b.position.copy(c.at).addScaledVector(UP, 0.01);
    c.a.visible = c.b.visible = true;
    this.updateCircle(c, 0);
    if (radius >= 3) this.flash(this.v.copy(c.at).addScaledVector(UP, 1.5), color, 14 + radius * 2, radius * 3);
  }

  /** A hit landing: sparks or blood, a small flash. `strength` 0..1. */
  impact(at: THREE.Vector3, color: number, strength: number): void {
    const s = clamp01(strength);
    const c = this.col.setHex(color);
    const blood = c.r > 0.25 && c.g < c.r * 0.35 && c.b < c.r * 0.35;
    const lowK = this.lowQuality ? 0.6 : 1;
    if (blood) {
      const n = Math.round((8 + 16 * s) * lowK);
      for (let i = 0; i < n; i++) {
        const th = Math.random() * TAU;
        const sp = (2.5 + 5 * s) * (0.4 + Math.random() * 0.6);
        this.col2.copy(c).multiplyScalar(0.55 + Math.random() * 0.5);
        this.soft.spawn(at.x, at.y, at.z, Math.cos(th) * sp, 1.5 + Math.random() * 3, Math.sin(th) * sp, 0.45 + Math.random() * 0.3, 0.16 + Math.random() * 0.14, this.col2, 16, -0.2, 0.6, 0.95);
      }
      this.col2.copy(c).multiplyScalar(0.6);
      for (let i = 0; i < 2 + Math.round(2 * s); i++) {
        this.soft.spawn(at.x + (Math.random() - 0.5) * 0.3, at.y + (Math.random() - 0.5) * 0.3, at.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 1.5, 0.4, (Math.random() - 0.5) * 1.5, 0.35 + 0.15 * s, 0.7 + 0.7 * s, this.col2, 0, 1.2, 3, 0.45);
      }
      this.col2.setHex(0xffb0a0);
      for (let i = 0; i < 3; i++) this.particles.spawn(at.x, at.y, at.z, (Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6, 0.18, 0.18, this.col2, 10, -0.6, 1, 1);
    } else {
      const n = Math.round((7 + 16 * s) * lowK);
      for (let i = 0; i < n; i++) {
        const th = Math.random() * TAU;
        const ph = Math.acos(2 * Math.random() - 1);
        const sp = (5 + 9 * s) * (0.35 + Math.random() * 0.65);
        this.col2.copy(c).lerp(WHITE, 0.3 + Math.random() * 0.5);
        this.particles.spawn(at.x, at.y, at.z, Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp * 0.7 + 1.5, Math.sin(ph) * Math.sin(th) * sp, 0.16 + Math.random() * 0.24, 0.14 + Math.random() * 0.14, this.col2, 18, -0.6, 1.5, 1);
      }
    }
    // White-hot core and a quick ring.
    this.col2.copy(WHITE).lerp(c, blood ? 0.5 : 0.25);
    for (let i = 0; i < 2; i++) this.particles.spawn(at.x, at.y, at.z, 0, 0, 0, 0.08 + 0.04 * s, (0.7 + 1.1 * s) * (i ? 0.6 : 1), this.col2, 0, -0.4, 0, blood ? 0.5 : 0.9);
    this.ringFlash(at, blood ? 0xffc8b8 : color, 0.1, 0.45 + 0.75 * s, 0.12 + 0.06 * s, blood ? 0.3 : 0.6);
    if (s > 0.6 && !blood) this.flash(at, color, 4 + 10 * s, 6);
  }

  /** A puff of ground dust (rolls, landings, charges, slams). */
  dust(at: THREE.Vector3, count: number, color = 0xa89878): void {
    const ground = heightAt(at.x, at.z);
    const wet = ground < WATER_LEVEL - 0.2 && at.y < WATER_LEVEL + 0.6;
    const c = this.col.setHex(wet ? 0xd8eef8 : color);
    const n = Math.max(1, Math.round(count * (this.lowQuality ? 0.6 : 1)));
    const y = (wet ? Math.max(at.y, WATER_LEVEL) : at.y) + 0.15;
    for (let i = 0; i < n; i++) {
      const th = Math.random() * TAU;
      const sp = 1.1 + Math.random() * 2.2;
      this.col2.copy(c).multiplyScalar(0.85 + Math.random() * 0.3);
      this.soft.spawn(
        at.x + Math.cos(th) * 0.3, y + Math.random() * 0.2, at.z + Math.sin(th) * 0.3,
        Math.cos(th) * sp, (wet ? 1.6 : 0.3) + Math.random() * 0.7, Math.sin(th) * sp,
        0.6 + Math.random() * 0.6, 0.45 + Math.random() * 0.6, this.col2, wet ? 3 : -0.25, 1.6, 2.8, wet ? 0.55 : 0.42,
      );
    }
  }

  /** A thin ring racing out along the ground (spins, slams, roars). */
  shockwave(at: THREE.Vector3, radius: number, color: number, life = 0.35) {
    this.ringFlash(at, color, 0.3, radius, life, 0.85, true);
  }

  /** A quick ring that expands and fades: facing the camera (hit flashes) or lying flat. */
  private ringFlash(at: THREE.Vector3, color: number, r0: number, r1: number, life: number, peak: number, flat = false) {
    let f = this.rings.find((x) => x.age >= x.life);
    if (!f) {
      if (this.rings.length >= 10) f = this.rings.reduce((a, b) => (b.age / b.life > a.age / a.life ? b : a));
      else {
        const m = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(this.flashGeo, m);
        mesh.renderOrder = 3;
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        f = { mesh, mat: m, age: 0, life: 0, r0, r1, peak, flat };
        this.rings.push(f);
      }
    }
    f.mesh.position.copy(at);
    f.mat.color.setHex(color);
    f.age = 0;
    f.life = life;
    f.r0 = r0;
    f.r1 = r1;
    f.peak = peak;
    f.flat = flat;
    if (flat) f.mesh.quaternion.setFromAxisAngle(this.v2.set(1, 0, 0), -Math.PI / 2);
    f.mesh.visible = true;
  }

  private updateCircle(c: Circle, dt: number) {
    c.age += dt;
    const k = c.age / c.life;
    if (k >= 1) {
      c.active = false;
      c.a.visible = c.b.visible = false;
      return;
    }
    const fin = smooth(0, Math.min(0.22, c.life * 0.3), c.age);
    const fout = 1 - smooth(Math.max(0.5, 1 - 0.45 / c.life), 1, k);
    const grow = 1 - Math.pow(1 - fin, 3);
    const o = fin * fout;
    c.angle += dt * c.spin;
    const s = c.radius * (0.55 + 0.45 * grow);
    c.a.scale.setScalar(s);
    c.b.scale.setScalar(s * 0.6);
    c.a.quaternion.copy(c.tilt).multiply(this.q.setFromAxisAngle(UP, c.angle));
    c.b.quaternion.copy(c.tilt).multiply(this.q.setFromAxisAngle(UP, -c.angle * 1.7));
    c.ma.opacity = 0.95 * o;
    c.mb.opacity = 0.75 * o * (0.85 + 0.15 * Math.sin(c.age * 9));
    // Motes rising from the rim.
    if (dt > 0 && fout > 0.3) {
      c.acc += dt * (this.lowQuality ? 10 : 22) * Math.min(4, 0.6 + c.radius * 0.5);
      while (c.acc >= 1) {
        c.acc -= 1;
        const th = Math.random() * TAU;
        const rr = s * (0.75 + Math.random() * 0.25);
        this.col2.copy(c.color).lerp(WHITE, Math.random() * 0.4);
        this.particles.spawn(c.at.x + Math.cos(th) * rr, c.at.y + 0.05, c.at.z + Math.sin(th) * rr, 0, 0.8 + Math.random() * 1.6, 0, 0.5 + Math.random() * 0.5, 0.18 + Math.random() * 0.22, this.col2, -0.6, -0.5, 0.5, 0.9);
      }
    }
  }

  damageNumber(at: THREE.Vector3, text: string, cls = '') {
    const el = document.createElement('div');
    el.className = `dmg ${cls}`;
    el.textContent = text;
    this.numberLayer.appendChild(el);
    this.numbers.push({ el, pos: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, 0)), age: 0 });
  }

  update(dt: number) {
    this.frameDt = dt;
    this.particles.update(dt);
    this.soft.update(dt);
    // Shade the unlit puffs like the lit world around them.
    if (!this.sun) {
      this.sun = this.scene.children.find((o): o is THREE.DirectionalLight => (o as THREE.DirectionalLight).isDirectionalLight) ?? null;
      this.hemi = this.scene.children.find((o): o is THREE.HemisphereLight => (o as THREE.HemisphereLight).isHemisphereLight) ?? null;
    }
    const lit = (this.sun?.intensity ?? 2.6) * 0.12 + (this.hemi?.intensity ?? 1.1) * 0.45;
    (this.soft.points.material as THREE.ShaderMaterial).uniforms.light.value = Math.max(0.3, Math.min(0.85, lit));
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i];
      t.age += dt;
      const k = Math.min(1, t.age / t.life);
      t.update?.(k, dt, t.obj);
      if (k >= 1) {
        this.scene.remove(t.obj);
        t.obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry && !m.userData.sharedGeo) m.geometry.dispose();
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

    // Trails: age the samples; free ribbons nobody has fed for a while.
    for (const tr of this.trails) {
      if (!tr.key) continue;
      tr.idle += dt;
      if (tr.count) tr.update(dt);
      if (tr.idle > 1.5) {
        this.trailMap.delete(tr.key);
        tr.key = null;
        tr.count = 0;
        tr.mesh.visible = false;
      }
    }

    // Auras.
    for (let i = this.auras.length - 1; i >= 0; i--) {
      const a = this.auras[i];
      a.t += dt;
      a.left -= dt;
      const on = a.left > 0 && !!a.target.parent;
      a.out += ((on ? 1 : 0) - a.out) * (1 - Math.exp(-(on ? 6 : 5) * dt));
      const gm = a.glow.material;
      if (!on && a.out < 0.03) {
        a.glow.removeFromParent();
        gm.dispose();
        this.auras.splice(i, 1);
        continue;
      }
      gm.opacity = a.out * (0.2 + 0.07 * Math.sin(a.t * 17) + 0.05 * Math.sin(a.t * 29 + 1));
      if (!on || dt <= 0) continue;
      a.target.getWorldPosition(this.v);
      a.acc += dt * (this.lowQuality ? 26 : 55) * Math.min(3, 0.6 + a.r / 0.75);
      while (a.acc >= 1) {
        a.acc -= 1;
        const th = Math.random() * TAU;
        const spark = Math.random() < 0.22;
        const rr = a.r * (0.45 + Math.random() * 0.65);
        const y = this.v.y + Math.pow(Math.random(), 1.3) * a.h * 0.9;
        const sk = Math.min(2.5, a.r / 0.45);
        if (spark) {
          this.particles.spawn(this.v.x + Math.cos(th) * rr, y, this.v.z + Math.sin(th) * rr, (Math.random() - 0.5) * 2.2, 2.5 + Math.random() * 2.5, (Math.random() - 0.5) * 2.2, 0.5 + Math.random() * 0.5, 0.12 + Math.random() * 0.1, a.hot, 1.5, -0.3, 0.6, 1);
        } else {
          this.col2.copy(a.color).lerp(a.hot, Math.random() * 0.7);
          this.particles.spawn(this.v.x + Math.cos(th) * rr, y, this.v.z + Math.sin(th) * rr, -Math.cos(th) * 0.35, 1.2 + Math.random() * 1.6, -Math.sin(th) * 0.35, 0.3 + Math.random() * 0.35, (0.32 + Math.random() * 0.38) * sk, this.col2, -2, -0.75, 1.2, 0.75);
        }
      }
    }

    for (const c of this.circles) if (c.active) this.updateCircle(c, dt);
    for (const f of this.rings) {
      if (f.age >= f.life) continue;
      f.age += dt;
      const k = Math.min(1, f.age / f.life);
      if (k >= 1) {
        f.mesh.visible = false;
        continue;
      }
      if (!f.flat) f.mesh.quaternion.copy(this.camera.quaternion);
      f.mesh.scale.setScalar(f.r0 + (f.r1 - f.r0) * (1 - (1 - k) * (1 - k)));
      f.mat.opacity = f.peak * (1 - k) * (1 - k);
    }

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
