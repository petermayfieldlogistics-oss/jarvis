import { describe, expect, it } from 'vitest';
import { gunzip, pack, packFile, readBytes } from '../../scripts/pack-models.mjs';
import { unpack } from './assets';

const copy = (b: Uint8Array) => b.slice().buffer;
/** Where two byte arrays first differ (-1 if they're the same). */
function firstDiff(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

describe('packed model files', () => {
  for (const name of ['creatures.bin.gz', 'world.bin.gz']) {
    it(`${name} unpacks to exactly what Blender wrote, and packs smaller`, () => {
      const file = new URL(`../assets/${name}`, import.meta.url);
      const raw = gunzip(file);
      const packed = pack(raw);
      expect(packed).not.toBeNull();
      expect(firstDiff(new Uint8Array(unpack(copy(packed!))), raw)).toBe(-1);
      expect(packFile(file).length).toBeLessThan(readBytes(file).length * 0.85);
    }, 30000);
  }

  it('leaves files that are not packed alone', () => {
    const plain = new Uint8Array([0x4d, 0x42, 0x43, 0x33, 1, 2, 3]);
    expect(new Uint8Array(unpack(copy(plain)))).toEqual(plain);
  });

  it('round-trips big (u32) indices and wrapping deltas', () => {
    const head = new TextEncoder().encode(JSON.stringify([{ verts: 3, tris: 2, big: true, bytes: 3 * 6 + 2 * 3 * 4 }]));
    const raw = new Uint8Array(8 + head.length + 18 + 24);
    const dv = new DataView(raw.buffer);
    dv.setUint32(0, 0x3157424d, true);
    dv.setUint32(4, head.length, true);
    raw.set(head, 8);
    const at = 8 + head.length;
    [0, 65535, 1, 65535, 0, 32768, 7, 32767, 65534].forEach((v, i) => dv.setUint16(at + i * 2, v, true));
    [0, 4294967295, 2147483648, 1, 2147483647, 5].forEach((v, i) => dv.setUint32(at + 18 + i * 4, v, true));
    const packed = pack(raw)!;
    expect(packed).not.toBeNull();
    expect(new Uint8Array(unpack(copy(packed)))).toEqual(raw);
  });
});
