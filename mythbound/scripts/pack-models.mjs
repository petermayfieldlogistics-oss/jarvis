// Packs the Blender model files for the download (a Vite plugin, used by
// `vite build`): weapons .glb files go out gzipped, and the creature and
// scenery files (.bin.gz) have their vertex positions and triangle indices
// delta-coded and split into byte planes before gzip, which squeezes them
// about a third smaller. src/engine/assets.ts undoes it (unpack); the files
// in src/assets stay as Blender wrote them, and the dev server sends them as
// they are.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

/** 'MBPK': a packed file (the original's bytes follow, with its regions recoded). */
const PACKED = 0x4b50424d;

/**
 * The stretches of a creatures/scenery file that get delta-coded: each
 * model's (or surface's) quantised positions (u16 x, y, z) at its start and
 * its triangle indices (u16, or u32 when big) at its end, found from the
 * JSON header. assets.ts finds them the same way.
 */
export function regions(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const hl = dv.getUint32(4, true);
  const heads = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + hl)));
  const out = [];
  let off = 8 + hl;
  for (const b of heads.flatMap((h) => (Array.isArray(h.surfaces) ? h.surfaces : [h]))) {
    const w = b.big ? 4 : 2;
    const pos = b.verts * 6, idx = b.tris * 3 * w;
    if (![pos, idx, b.bytes].every(Number.isSafeInteger) || pos + idx > b.bytes || off + b.bytes > buf.length) throw new Error('unexpected layout');
    out.push({ at: off, count: b.verts * 3, w: 2, stride: 3 }, { at: off + b.bytes - idx, count: b.tris * 3, w, stride: 1 });
    off += b.bytes;
  }
  return out;
}

/** Each value minus the one `stride` before it, zigzagged, then split into byte planes (low bytes first). */
function encode(buf, { at, count, w, stride }) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const zz = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const v = w === 2 ? dv.getUint16(at + i * 2, true) : dv.getUint32(at + i * 4, true);
    const p = i >= stride ? (w === 2 ? dv.getUint16(at + (i - stride) * 2, true) : dv.getUint32(at + (i - stride) * 4, true)) : 0;
    const d = w === 2 ? ((v - p) << 16) >> 16 : (v - p) | 0;
    zz[i] = w === 2 ? ((d << 1) ^ (d >> 31)) & 0xffff : ((d << 1) ^ (d >> 31)) >>> 0;
  }
  for (let k = 0; k < w; k++) for (let i = 0; i < count; i++) buf[at + k * count + i] = (zz[i] >>> (8 * k)) & 0xff;
}

/** A creatures or scenery file (unzipped), packed; null if it isn't laid out as expected. */
export function pack(raw) {
  try {
    const out = new Uint8Array(raw.length + 4);
    new DataView(out.buffer).setUint32(0, PACKED, true);
    out.set(raw, 4);
    const body = out.subarray(4);
    for (const r of regions(body)) encode(body, r);
    return out;
  } catch {
    return null;
  }
}

/** A file's bytes, and a gzipped file's bytes unzipped (for the tests; `file` a path or file: URL). */
export const readBytes = (file) => new Uint8Array(readFileSync(file));
export const gunzip = (file) => new Uint8Array(gunzipSync(readFileSync(file)));

/** A model file as it goes out: .glb gzipped; .bin.gz packed and gzipped (as it was, if it can't be packed). */
export function packFile(file) {
  if (typeof file !== 'string') file = fileURLToPath(file);
  const data = readFileSync(file);
  if (file.endsWith('.glb')) return gzipSync(data, { level: 9 });
  const packed = pack(new Uint8Array(gunzipSync(data)));
  return packed ? gzipSync(packed, { level: 9 }) : data;
}

/** The Vite plugin: model files imported with ?url are emitted packed (under names hashed from what goes out). */
export function packModels() {
  return {
    name: 'mythbound-pack-models',
    apply: 'build',
    enforce: 'pre',
    load(id) {
      const m = /([^/\\]+\.(glb|bin\.gz))\?url$/.exec(id);
      if (!m) return null;
      const file = id.slice(0, -'?url'.length);
      const ref = this.emitFile({ type: 'asset', name: m[2] === 'glb' ? `${m[1]}.gz` : m[1], source: packFile(file) });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
  };
}
