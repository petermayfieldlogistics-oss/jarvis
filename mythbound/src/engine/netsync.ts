// Co-op on weak connections: the pieces that keep a friend's view smooth and
// the host's updates within what each friend's line can carry.
//
// - PeerClock: every bundle a newer game sends carries its send time (`ts`).
//   The receiver learns the fastest delivery it has seen, so it can tell how
//   late each bundle is (jitter, or a queue building up on a slow line), place
//   updates on an even timeline and pick how far behind to draw others.
// - SendBudget: how many bytes a second the host may send one friend; it backs
//   off when that friend reports a queue and creeps back up when it clears.
// - MirrorWire: a compact form of one monster's state, sent as changes only.

/** Minimum of the values pushed in the last `span` ms (monotonic deque). */
export class WindowMin {
  private ts: number[] = [];
  private vs: number[] = [];
  constructor(private span: number) {}
  push(t: number, v: number) {
    while (this.vs.length && this.vs[this.vs.length - 1] >= v) {
      this.vs.pop();
      this.ts.pop();
    }
    this.ts.push(t);
    this.vs.push(v);
    this.trim(t);
  }
  trim(t: number) {
    while (this.ts.length > 1 && this.ts[0] < t - this.span) {
      this.ts.shift();
      this.vs.shift();
    }
  }
  get value() {
    return this.vs.length ? this.vs[0] : NaN;
  }
}

/** The `q`-th quantile (0-1) of a list (the list is not changed). */
export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
}

/** How far behind others are drawn: never less than before (a good line looks as it always did), never more than this. */
export const MIN_DELAY = 0.13;
export const MAX_DELAY = 0.5;

/** One sender's updates as this game receives them (times in ms unless noted). */
export class PeerClock {
  /** Fastest delivery seen lately: arrival minus their send time (their clock and ours differ by a constant). */
  private fastest = new WindowMin(30_000);
  private fixed = NaN;
  /** Lateness of recent bundles beyond the fastest (jitter and queueing). */
  private late: { t: number; v: number }[] = [];
  /** Gaps between their updates on the timeline. */
  private gaps: number[] = [];
  private lastStamp = NaN;
  private lastTs = NaN;
  /** Their latest send time and when it reached us (echoed back so they can measure the round trip). */
  heardTs = NaN;
  heardAt = 0;
  /** Bytes from them, for the rate they deliver to us. */
  private bytes: { t: number; n: number }[] = [];
  /** How far behind their updates are drawn, in seconds (eases toward `target`). */
  delay = MIN_DELAY;
  target = MIN_DELAY;
  private nextPlan = 0;

  /**
   * A bundle arrived at `arrival` (ms, our clock), sent at `ts` (ms, their
   * clock; undefined from older games). Returns its place on our timeline (s):
   * when it would have arrived with no jitter or queue. `trusted` false: our
   * own game was busy (a long frame), so the arrival time says nothing about
   * the line and is not counted.
   */
  stamp(ts: number | undefined, arrival: number, trusted = true): number {
    let at = arrival;
    if (typeof ts === 'number' && Number.isFinite(ts) && (trusted || Number.isFinite(this.fixed))) {
      this.heardTs = ts;
      this.heardAt = arrival;
      const off = arrival - ts;
      // A clock that jumped (their game restarted, or slept): start over.
      if (Number.isFinite(this.lastTs) && (ts < this.lastTs - 10_000 || ts > this.lastTs + 60_000)) this.reset();
      this.lastTs = Number.isFinite(this.lastTs) ? Math.max(this.lastTs, ts) : ts;
      if (trusted) {
        this.fastest.push(arrival, off);
        // The timeline anchor eases (2 ms per bundle at most) so a new fastest delivery does not bunch updates up.
        const best = this.fastest.value;
        this.fixed = Number.isFinite(this.fixed) ? Math.min(this.fixed + 2, Math.max(this.fixed - 2, best)) : best;
        this.late.push({ t: arrival, v: Math.max(0, off - best) });
      }
      at = ts + this.fixed;
    } else if (trusted) this.late.push({ t: arrival, v: 0 });
    while (this.late.length > 1 && this.late[0].t < arrival - 6000) this.late.shift();
    if (Number.isFinite(this.lastStamp) && at > this.lastStamp) {
      this.gaps.push(at - this.lastStamp);
      if (this.gaps.length > 40) this.gaps.shift();
    }
    // Updates never go back in time (a bundle that came quickly after a slow one).
    if (Number.isFinite(this.lastStamp)) at = Math.max(at, this.lastStamp + 1);
    this.lastStamp = at;
    return at / 1000;
  }

  /** Counts the bytes of a message from them. */
  received(n: number, now: number) {
    this.bytes.push({ t: now, n });
    while (this.bytes.length > 1 && this.bytes[0].t < now - 2000) this.bytes.shift();
  }

  /** Bytes a second they delivered over the last two seconds. */
  rate(now: number): number {
    let n = 0;
    for (const b of this.bytes) if (b.t >= now - 2000) n += b.n;
    return n / 2;
  }

  /** A queue on the line: the least lateness over the last second (jitter alone leaves some bundles on time). */
  queue(now: number): number {
    let q = Infinity;
    for (const l of this.late) if (l.t >= now - 1000) q = Math.min(q, l.v);
    return Number.isFinite(q) ? q : 0;
  }

  /** How late the latest bundles were (95th percentile), ms. */
  jitter(): number {
    return quantile(this.late.map((l) => l.v), 0.95);
  }

  /** Eases the drawing delay toward what the line needs: one gap between updates plus the lateness most bundles stay under. */
  tick(dt: number, now: number) {
    if (now >= this.nextPlan) {
      this.nextPlan = now + 500;
      const gap = this.gaps.length >= 4 ? quantile(this.gaps, 0.9) : 1000 / 12;
      this.target = Math.max(MIN_DELAY, Math.min(MAX_DELAY, (gap + this.jitter() + 25) / 1000));
    }
    // Catching up slowly keeps motion even; falling behind faster avoids stalls.
    const d = this.target - this.delay;
    this.delay += Math.max(-0.05 * dt, Math.min(0.2 * dt, d));
  }

  private reset() {
    this.fastest = new WindowMin(30_000);
    this.fixed = NaN;
    this.late = [];
    this.gaps = [];
    this.lastStamp = NaN;
  }
}

/** Bytes a second the host may send one friend. */
export class SendBudget {
  static readonly START = 48_000;
  static readonly MIN = 3_000;
  static readonly MAX = 400_000;
  rate = SendBudget.START;
  /** Bytes it may send right now (refills at `rate`, holds a quarter second's worth). */
  tokens = SendBudget.START / 4;
  private last = 0;
  private holdUntil = 0;
  /** Reports in a row that saw a queue (one alone may be a hiccup). */
  private high = 0;
  /** What got through when the line last filled up: above it the budget only creeps. */
  private ceiling = Infinity;
  /** Round trip to the friend and back, ms (0 until measured). */
  rtt = 0;
  /** Their latest report: queue (ms) and jitter (ms) on our line to them. */
  queue = 0;
  jitter = 0;

  /** A friend's report about our line to them: its queue (ms) and the bytes a second they got from us. */
  report(queue: number, got: number, now: number) {
    this.queue = queue;
    this.high = queue > 200 ? this.high + 1 : 0;
    if (this.high >= 2) {
      // A queue is building (two reports running: one alone may be a hiccup on their side):
      // send less than actually got through (a deep queue drains faster).
      if (now >= this.holdUntil) {
        const through = got > 0 ? Math.min(this.rate, got) : this.rate;
        this.ceiling = Math.max(SendBudget.MIN, through);
        this.rate = Math.max(SendBudget.MIN, through * (queue > 600 ? 0.5 : 0.8));
        this.holdUntil = now + Math.max(700, this.rtt + 200);
      }
    } else if (queue < 80 && now >= this.holdUntil) {
      // Quickly back up to what the line carried before, then feel for more more gently.
      this.rate = Math.min(SendBudget.MAX, this.rate < this.ceiling ? Math.min(this.ceiling, this.rate * 1.2 + 1000) : this.rate * 1.05 + 300);
    }
  }

  /** Refills the allowance; returns what may be sent now. */
  refill(now: number): number {
    const dt = this.last ? Math.min(0.5, (now - this.last) / 1000) : 0;
    this.last = now;
    this.tokens = Math.min(this.rate / 4, this.tokens + this.rate * dt);
    return this.tokens;
  }

  spend(n: number) {
    this.tokens -= n;
  }

  /** True when the line to this friend is the limit (send less: fewer and rarer updates). */
  get tight() {
    return this.rate < SendBudget.START * 0.9;
  }
}

// -------------------------------------------------------- monster changes --

/**
 * One monster as last told to a friend, in whole units: centimetres,
 * hundredths of a radian, tenths of a hit point, hundredths of a move.
 */
export interface MirrorWire {
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  flags: number;
  /** Move progress (-100: none), wind-up, move style. */
  atk: number;
  win: number;
  style: number;
  draw: number;
  fury: number;
  /** Effects on it (tenths of a second each). */
  status: number[];
  dmg: number;
}

/** Which parts an entry carries, in this order after [id, mask]. New parts go at the end. */
export const W = {
  XZ: 1,
  Y: 2,
  YAW: 4,
  HP: 8,
  FLAGS: 16,
  MOVE: 32,
  POSE: 64,
  STATUS: 128,
  DMG: 256,
  /** x, y, z as they are (a first sight or a resync), instead of changes. */
  ABS: 512,
} as const;

export const blankWire = (): MirrorWire => ({ x: 0, y: 0, z: 0, yaw: 0, hp: 0, flags: 0, atk: -100, win: 0, style: 0, draw: 0, fury: 0, status: [], dmg: 0 });

const sameList = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The entry that brings `prev` (what the friend has; undefined: nothing yet)
 * up to `cur`. `parts` adds parts to send even if unchanged; `status` says
 * whether the effects changed enough to send. Returns null when nothing changed.
 */
export function encodeWire(nid: number, prev: MirrorWire | undefined, cur: MirrorWire, status: boolean): number[] | null {
  const out: (number | number[])[] = [nid, 0];
  let mask = 0;
  if (!prev) {
    mask = W.ABS | W.YAW | W.HP | W.FLAGS | W.MOVE | W.POSE | W.STATUS | W.DMG;
    out.push(cur.x, cur.y, cur.z);
  } else {
    if (cur.x !== prev.x || cur.z !== prev.z) {
      mask |= W.XZ;
      out.push(cur.x - prev.x, cur.z - prev.z);
    }
    if (cur.y !== prev.y) {
      mask |= W.Y;
      out.push(cur.y - prev.y);
    }
  }
  const yaw = !prev || Math.abs(cur.yaw - prev.yaw) >= 2;
  if (yaw) mask |= W.YAW;
  if (!prev || cur.hp !== prev.hp) mask |= W.HP;
  if (!prev || cur.flags !== prev.flags) mask |= W.FLAGS;
  if (!prev || cur.atk !== prev.atk || cur.win !== prev.win || cur.style !== prev.style) mask |= W.MOVE;
  if (!prev || cur.draw !== prev.draw || cur.fury !== prev.fury) mask |= W.POSE;
  if (!prev || (status && !sameList(cur.status, prev.status))) mask |= W.STATUS;
  if (!prev || cur.dmg !== prev.dmg) mask |= W.DMG;
  if (!mask) return null;
  if (mask & W.YAW) out.push(cur.yaw);
  if (mask & W.HP) out.push(cur.hp);
  if (mask & W.FLAGS) out.push(cur.flags);
  if (mask & W.MOVE) out.push(cur.atk, cur.win, cur.style);
  if (mask & W.POSE) out.push(cur.draw, cur.fury);
  if (mask & W.STATUS) out.push(cur.status.some((v) => v > 0) ? [...cur.status] : 0);
  if (mask & W.DMG) out.push(cur.dmg);
  out[1] = mask;
  return out as number[];
}

/** What the friend now has after an entry (also what the host keeps as sent). */
export function applyWire(prev: MirrorWire | undefined, entry: readonly unknown[], statusKeys: number): { wire: MirrorWire; mask: number } | null {
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  const mask = num(entry[1]);
  if (!(mask & W.ABS) && !prev) return null;
  const w: MirrorWire = prev ? { ...prev, status: prev.status } : blankWire();
  let i = 2;
  if (mask & W.ABS) {
    w.x = num(entry[i++]);
    w.y = num(entry[i++]);
    w.z = num(entry[i++]);
  } else {
    if (mask & W.XZ) {
      w.x += num(entry[i++]);
      w.z += num(entry[i++]);
    }
    if (mask & W.Y) w.y += num(entry[i++]);
  }
  if (mask & W.YAW) w.yaw = num(entry[i++]);
  if (mask & W.HP) w.hp = num(entry[i++]);
  if (mask & W.FLAGS) w.flags = num(entry[i++]);
  if (mask & W.MOVE) {
    w.atk = num(entry[i++]);
    w.win = num(entry[i++]);
    w.style = num(entry[i++]);
  }
  if (mask & W.POSE) {
    w.draw = num(entry[i++]);
    w.fury = num(entry[i++]);
  }
  if (mask & W.STATUS) {
    const s = entry[i++];
    // 0: no effects at all.
    w.status = Array.from({ length: statusKeys }, (_, k) => (Array.isArray(s) ? num(s[k]) : 0));
  }
  if (mask & W.DMG) w.dmg = num(entry[i++]);
  return { wire: w, mask };
}
