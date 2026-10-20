import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RemoteHero } from './coop';

// A hero's state message leaves out values that every game (older ones too:
// RemoteHero.receive has always read them this way) takes as their defaults.
describe('hero state with defaults left out', () => {
  const full = {
    k: 'st', p: [1.5, 2, -3.25], v: [0, 0, 0], y: 0.5,
    a: [-1, 0, 0, -1, 0, 0, 0, 0, 0, -1, 0],
    hp: 80, mh: 120, al: 1, sf: 1, lv: 7, w: '', wr: '', it: 0, hc: -1, pt: [],
  };
  const short = { k: 'st', p: [1.5, 2, -3.25], y: 0.5, a: [-1], hp: 80, mh: 120, lv: 7 };
  const seen = (m: Record<string, unknown>) => {
    const r = new RemoteHero(1, 'Friend', new THREE.Scene());
    r.receive(m as never, 10);
    r.receive({ ...m, hp: undefined, mh: undefined, lv: undefined } as never, 10.1);
    const s = (r as unknown as { latest: Record<string, unknown> }).latest;
    return { ...s, t: 0, hp: r.hp, maxHp: r.maxHp, level: r.level, alive: r.alive, stealth: r.stealth, inTrial: r.inTrial, crouching: r.crouching, war: r.war, pos: r.pos.toArray() };
  };

  it('reads the same as the whole message', () => {
    expect(seen(short)).toEqual(seen(full));
  });

  it('keeps health, level and weapon from before when an update leaves them out', () => {
    const r = new RemoteHero(1, 'Friend', new THREE.Scene());
    r.receive({ ...full, hp: 42, mh: 99, lv: 12 } as never, 1);
    r.receive(short as never, 2);
    r.receive({ k: 'st', p: [0, 0, 0], y: 0, a: [-1] } as never, 3);
    expect([r.hp, r.maxHp, r.level, r.alive]).toEqual([80, 120, 7, true]);
  });
});
