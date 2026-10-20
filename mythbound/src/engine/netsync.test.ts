import { describe, expect, it } from 'vitest';
import { applyWire, blankWire, encodeWire, MAX_DELAY, MIN_DELAY, PeerClock, SendBudget, W, WindowMin, type MirrorWire } from './netsync';

/** A tiny repeatable random source. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe('WindowMin', () => {
  it('keeps the smallest value of the window', () => {
    const w = new WindowMin(1000);
    w.push(0, 5);
    w.push(100, 3);
    w.push(200, 4);
    expect(w.value).toBe(3);
    w.push(1150, 9);
    expect(w.value).toBe(4);
    w.push(1300, 8);
    expect(w.value).toBe(8);
  });
});

describe('PeerClock', () => {
  /** Bundles every 83 ms over a line with `lat` ms delay, `jit` ms jitter, in order (one TCP stream). */
  function run(lat: number, jit: number, seconds = 20, queueGrowth = 0) {
    const c = new PeerClock();
    const r = rng(7);
    const stamps: number[] = [];
    let last = 0;
    const offset = 123_456; // their clock and ours differ
    for (let i = 0; i < seconds * 12; i++) {
      const ts = i * 83;
      const arrival = Math.max(last, ts + offset + lat + (r() * 2 - 1) * jit + i * queueGrowth);
      last = arrival;
      stamps.push(c.stamp(ts, arrival) * 1000);
      c.tick(1 / 12, arrival);
    }
    return { c, stamps, now: last };
  }

  it('places a jittery line on an even timeline', () => {
    const { stamps } = run(300, 100);
    const gaps = stamps.slice(40).map((s, i, a) => (i ? s - a[i - 1] : 83)).slice(1);
    for (const g of gaps) expect(Math.abs(g - 83)).toBeLessThan(5);
  });

  it('draws a clean line as far behind as before, and a jittery one further', () => {
    expect(run(40, 0).c.delay).toBeCloseTo(MIN_DELAY, 2);
    const bad = run(300, 100).c;
    expect(bad.delay).toBeGreaterThan(0.2);
    expect(bad.delay).toBeLessThanOrEqual(MAX_DELAY);
  });

  it('tells jitter from a queue building up', () => {
    const calm = run(300, 100);
    expect(calm.c.queue(calm.now)).toBeLessThan(80);
    const jammed = run(300, 100, 20, 4);
    expect(jammed.c.queue(jammed.now)).toBeGreaterThan(200);
  });

  it('works without send times (older games)', () => {
    const c = new PeerClock();
    let t = 1000;
    for (let i = 0; i < 50; i++) {
      t += i % 2 ? 40 : 126;
      expect(c.stamp(undefined, t)).toBeCloseTo(t / 1000, 3);
      c.tick(0.08, t);
    }
    expect(c.delay).toBeGreaterThanOrEqual(MIN_DELAY);
  });
});

describe('SendBudget', () => {
  it('backs off below what got through when a queue builds, and creeps back when it clears', () => {
    const b = new SendBudget();
    b.report(400, 30_000, 1000);
    expect(b.rate).toBe(SendBudget.START); // one report alone may be a hiccup
    b.report(400, 30_000, 1500);
    expect(b.rate).toBeLessThanOrEqual(24_000);
    const low = b.rate;
    b.report(400, 30_000, 1600);
    expect(b.rate).toBe(low); // waits for the queue to drain before backing off again
    for (let t = 2000; t < 6000; t += 500) b.report(10, low, t);
    // Back to what got through before, then only slowly beyond.
    expect(b.rate).toBeGreaterThanOrEqual(30_000);
    expect(b.rate).toBeLessThan(33_000);
    for (let t = 6000; t < 66_000; t += 500) b.report(10, low, t);
    expect(b.rate).toBeGreaterThan(60_000);
    expect(b.rate).toBeLessThanOrEqual(SendBudget.MAX);
  });

  it('never drops below its floor', () => {
    const b = new SendBudget();
    for (let t = 0; t < 30_000; t += 1000) b.report(5000, 100, t);
    expect(b.rate).toBe(SendBudget.MIN);
  });
});

describe('monster changes', () => {
  const STATUS = 6;
  const random = (r: () => number, base?: MirrorWire): MirrorWire => {
    const w = base ? { ...base, status: [...base.status] } : blankWire();
    const pick = () => r() < 0.4;
    if (!base || pick()) w.x += Math.round((r() - 0.5) * 80);
    if (!base || pick()) w.z += Math.round((r() - 0.5) * 80);
    if (pick()) w.y += Math.round((r() - 0.5) * 20);
    if (pick()) w.yaw = Math.round((r() - 0.5) * 628);
    if (pick()) w.hp = Math.round(r() * 5000);
    if (r() < 0.1) w.flags = Math.floor(r() * 8);
    if (pick()) [w.atk, w.win, w.style] = [r() < 0.5 ? -100 : Math.round(r() * 100), Math.round(r() * 100), Math.floor(r() * 50)];
    if (r() < 0.2) [w.draw, w.fury] = [Math.round(r() * 100), Math.round(r() * 100)];
    if (!base || r() < 0.1) w.status = Array.from({ length: STATUS }, () => (r() < 0.7 ? 0 : Math.round(r() * 80)));
    if (r() < 0.1) w.dmg += Math.round(r() * 50);
    return w;
  };

  it('a friend applying the changes ends up with exactly what the host has', () => {
    const r = rng(3);
    let host: MirrorWire | undefined;
    let friend: MirrorWire | undefined;
    let cur = random(r);
    for (let i = 0; i < 2000; i++) {
      const entry = encodeWire(42, host, cur, true);
      if (entry) {
        expect(entry[0]).toBe(42);
        host = applyWire(host, entry, STATUS)!.wire;
        // Through JSON, as on the wire.
        friend = applyWire(friend, JSON.parse(JSON.stringify(entry)), STATUS)!.wire;
        expect(friend).toEqual(host);
      }
      // Everything but a small turn arrived.
      expect([friend!.x, friend!.y, friend!.z, friend!.hp, friend!.atk]).toEqual([cur.x, cur.y, cur.z, cur.hp, cur.atk]);
      expect(Math.abs(friend!.yaw - cur.yaw)).toBeLessThan(2);
      cur = random(r, cur);
    }
  });

  it('sends whole values first, then only changes', () => {
    const a = { ...blankWire(), x: 12345, y: 200, z: -5000, hp: 1000, status: [0, 0, 0, 0, 0, 0] };
    const first = encodeWire(7, undefined, a, true)!;
    expect(first[1] & W.ABS).toBeTruthy();
    const host = applyWire(undefined, first, STATUS)!.wire;
    expect(encodeWire(7, host, a, true)).toBeNull();
    const moved = { ...a, x: a.x + 31, z: a.z - 12 };
    expect(encodeWire(7, host, moved, true)).toEqual([7, W.XZ, 31, -12]);
    // Changes without a known start cannot be applied.
    expect(applyWire(undefined, [7, W.XZ, 31, -12], STATUS)).toBeNull();
  });

  it('leaves effects out unless asked', () => {
    const a = { ...blankWire(), status: [0, 0, 0, 0, 0, 0] };
    const host = applyWire(undefined, encodeWire(1, undefined, a, true)!, STATUS)!.wire;
    const burning = { ...a, status: [30, 0, 0, 0, 0, 0] };
    expect(encodeWire(1, host, burning, false)).toBeNull();
    expect(encodeWire(1, host, burning, true)).toEqual([1, W.STATUS, [30, 0, 0, 0, 0, 0]]);
  });
});
