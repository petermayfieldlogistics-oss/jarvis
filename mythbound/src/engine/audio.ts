// Tiny synthesized sound effects and an ambient drone; no audio files needed.

export type Sfx =
  | 'swing' | 'hit' | 'bow' | 'draw' | 'spell' | 'holy' | 'devil' | 'roar' | 'slam' | 'windup' | 'roll'
  | 'pickup' | 'levelup' | 'death' | 'drink' | 'throw' | 'hurt' | 'block' | 'victory'
  | 'zap' | 'rune' | 'strum' | 'song' | 'horn';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private drone: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  volume = 0.6;
  muted = false;

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startDrone();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  private env(g: GainNode, t: number, a: number, peak: number, r: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + r);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, peak = 0.3, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    this.env(g, t, 0.01, peak, dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(dur: number, freq: number, q: number, peak = 0.3, type: BiquadFilterType = 'bandpass', sweepTo?: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, 0.01, peak, dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  play(s: Sfx) {
    if (!this.ctx || !this.master || this.muted) return;
    switch (s) {
      case 'swing': return this.hiss(0.18, 900, 1.2, 0.25, 'bandpass', 2400);
      case 'hit': this.hiss(0.12, 400, 0.8, 0.4); return this.tone('square', 140, 60, 0.12, 0.15);
      case 'block': return this.tone('triangle', 900, 700, 0.2, 0.25);
      case 'bow': return this.tone('triangle', 220, 90, 0.18, 0.3);
      case 'draw': return this.hiss(0.4, 300, 3, 0.08);
      case 'throw': return this.hiss(0.25, 600, 1, 0.25, 'bandpass', 1600);
      case 'spell': this.tone('sine', 300, 900, 0.35, 0.18); return this.hiss(0.35, 2000, 2, 0.08);
      case 'holy': [523, 659, 784].forEach((f, i) => this.tone('sine', f, f, 0.6, 0.12, i * 0.06)); return;
      case 'devil': this.tone('sawtooth', 70, 35, 1.8, 0.3); return this.hiss(1.5, 120, 0.7, 0.3, 'lowpass');
      case 'roar': this.tone('sawtooth', 110, 55, 0.9, 0.25); return this.hiss(0.9, 300, 0.6, 0.25, 'lowpass');
      case 'slam': this.tone('sine', 90, 30, 0.5, 0.6); return this.hiss(0.4, 200, 0.5, 0.4, 'lowpass');
      case 'windup': return this.hiss(0.5, 200, 1.5, 0.12, 'bandpass', 800);
      case 'roll': return this.hiss(0.3, 300, 0.8, 0.15, 'lowpass');
      case 'pickup': [880, 1320].forEach((f, i) => this.tone('sine', f, f, 0.25, 0.12, i * 0.08)); return;
      case 'levelup': [392, 523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.5, 0.12, i * 0.09)); return;
      case 'victory': [262, 330, 392, 523].forEach((f, i) => this.tone('sawtooth', f, f, 1.6, 0.08, i * 0.02)); return;
      case 'death': return this.tone('sawtooth', 220, 40, 2.5, 0.25);
      case 'drink': return this.tone('sine', 400, 200, 0.3, 0.15);
      case 'hurt': return this.tone('square', 220, 110, 0.15, 0.15);
      case 'zap': this.tone('sine', 900, 1800, 0.12, 0.12); return this.hiss(0.1, 3000, 2, 0.05);
      case 'rune': this.tone('sine', 220, 110, 0.5, 0.15); [660, 990, 1320].forEach((f, i) => this.tone('triangle', f, f, 0.35, 0.08, i * 0.05)); return;
      // A plucked G-major chord, low to high.
      case 'strum': [196, 247, 294, 392, 494].forEach((f, i) => this.tone('triangle', f, f * 0.995, 0.7, 0.12, i * 0.035)); return;
      case 'song': [392, 494, 587, 784, 587, 784, 988].forEach((f, i) => this.tone('triangle', f, f, 0.55, 0.11, i * 0.11)); return;
      case 'horn': this.tone('sawtooth', 110, 104, 1.1, 0.12); this.tone('triangle', 165, 160, 1.1, 0.22); return this.hiss(0.9, 380, 1, 0.07, 'lowpass');
    }
  }

  private startDrone() {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0.035;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const osc = [55, 82.4, 110.3].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      return o;
    });
    filter.connect(gain).connect(this.master!);
    this.drone = { osc, gain };
  }

  /** Shifts the ambient chord with mood: 0 calm, 1 boss fight. */
  setMood(mood: number, dark: boolean) {
    if (!this.drone || !this.ctx) return;
    const base = dark ? 49 : 55;
    const t = this.ctx.currentTime;
    this.drone.osc[0].frequency.setTargetAtTime(base, t, 1.5);
    this.drone.osc[1].frequency.setTargetAtTime(base * (dark ? 1.189 : 1.498), t, 1.5);
    this.drone.osc[2].frequency.setTargetAtTime(base * 2.003, t, 1.5);
    this.drone.gain.gain.setTargetAtTime(0.03 + mood * 0.05, t, 1);
  }
}
