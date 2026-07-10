// Pure Gaussian-splat decoders (no three.js, no DOM) so they can be unit-tested
// and reused. Each returns { count, pos:Float32[3n], col:Float32[4n] rgba [0,1],
// size:Float32[n] }. Handles the antimatter15 .splat, the standard float 3DGS
// .ply, the PlayCanvas/SuperSplat COMPRESSED .ply (chunk + packed_* uints, what
// splat-transform emits), and the .splattie bundle.
import { unzip, toBuffer } from './unzip.js';

const C0 = 0.28209479177387814; // SH band-0 factor, f_dc -> base color
const MAX_SPLATS = 800000; // ponytail: subsample beyond this to keep the sort snappy
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const TSIZE = {
  char: 1,
  uchar: 1,
  int8: 1,
  uint8: 1,
  short: 2,
  ushort: 2,
  int16: 2,
  uint16: 2,
  int: 4,
  uint: 4,
  int32: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

// Locate the PLY header end in BYTES (a comment may hold multi-byte chars, so a
// decoded-string index would give a wrong binary offset), and parse the
// element/property structure with each element's byte offset.
function readPlyHeader(buf) {
  const b = new Uint8Array(buf);
  const lim = Math.min(b.length, 1 << 20);
  const M = [0x65, 0x6e, 0x64, 0x5f, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72]; // "end_header"
  for (let i = 0; i + M.length <= lim; i++) {
    let hit = true;
    for (let j = 0; j < M.length; j++)
      if (b[i + j] !== M[j]) {
        hit = false;
        break;
      }
    if (!hit) continue;
    let k = i + M.length;
    while (k < lim && b[k] !== 0x0a) k++;
    const dataStart = k + 1;
    const text = new TextDecoder().decode(b.subarray(0, i));
    const elements = [];
    let cur = null;
    for (const line of text.split('\n')) {
      const t = line.trim();
      const em = /^element\s+(\S+)\s+(\d+)/.exec(t);
      if (em) {
        cur = { name: em[1], count: +em[2], idx: {}, stride: 0 };
        elements.push(cur);
        continue;
      }
      const pm = /^property\s+(\S+)\s+(\S+)/.exec(t);
      if (pm && cur) {
        const sz = TSIZE[pm[1]];
        if (sz == null) throw new Error('unsupported PLY property type ' + pm[1]);
        cur.idx[pm[2]] = { off: cur.stride, type: pm[1] };
        cur.stride += sz;
      }
    }
    let off = dataStart;
    for (const e of elements) {
      e.offset = off;
      off += e.stride * e.count;
    }
    return {
      elements,
      little: /binary_little_endian/.test(text),
      binary: /format\s+binary/.test(text),
    };
  }
  return null;
}

const el = (h, name) => h.elements.find((e) => e.name === name);

// Detect a 3DGS PLY (standard float or compressed) vs a mesh/point-cloud PLY.
export function isPlySplat(buf) {
  const h = readPlyHeader(buf);
  const v = h && el(h, 'vertex');
  if (!v) return false;
  const has = (n) => n in v.idx;
  return (has('f_dc_0') && has('scale_0') && has('rot_0')) || has('packed_position');
}

// antimatter15 .splat: 32 bytes/splat — pos(3 f32), scale(3 f32), rgba(4 u8), quat(4 u8).
export function parseSplatBin(buf) {
  const total = Math.floor(buf.byteLength / 32);
  const step = Math.max(1, Math.ceil(total / MAX_SPLATS));
  const count = Math.floor(total / step);
  const dv = new DataView(buf);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * step * 32;
    pos[i * 3] = dv.getFloat32(o, true);
    pos[i * 3 + 1] = dv.getFloat32(o + 4, true);
    pos[i * 3 + 2] = dv.getFloat32(o + 8, true);
    size[i] =
      (dv.getFloat32(o + 12, true) + dv.getFloat32(o + 16, true) + dv.getFloat32(o + 20, true)) / 3;
    col[i * 4] = dv.getUint8(o + 24) / 255;
    col[i * 4 + 1] = dv.getUint8(o + 25) / 255;
    col[i * 4 + 2] = dv.getUint8(o + 26) / 255;
    col[i * 4 + 3] = dv.getUint8(o + 27) / 255;
  }
  return { count, pos, col, size };
}

export function parsePlySplat(buf) {
  const h = readPlyHeader(buf);
  if (!h) throw new Error('PLY header not found (or larger than 1MB)');
  if (!h.binary) throw new Error('ASCII PLY splats not supported');
  const v = el(h, 'vertex');
  if (!v) throw new Error('PLY has no vertex element');
  return 'packed_position' in v.idx ? parseCompressedPly(buf, h) : parseStandardPly(buf, h);
}

// Standard 3DGS PLY: float x y z … f_dc_0..2 … opacity scale_0..2 rot_0..3.
function parseStandardPly(buf, h) {
  const v = el(h, 'vertex');
  if (v.offset + v.count * v.stride > buf.byteLength) throw new Error('PLY data truncated');
  const dv = new DataView(buf);
  const get = (row, name) => {
    const f = v.idx[name];
    if (!f) return 0;
    const o = v.offset + row * v.stride + f.off;
    return f.type === 'double' || f.type === 'float64'
      ? dv.getFloat64(o, h.little)
      : dv.getFloat32(o, h.little);
  };
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));
  const total = v.count;
  const step = Math.max(1, Math.ceil(total / MAX_SPLATS));
  const count = Math.floor(total / step);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = i * step;
    pos[i * 3] = get(r, 'x');
    pos[i * 3 + 1] = get(r, 'y');
    pos[i * 3 + 2] = get(r, 'z');
    col[i * 4] = clamp01(0.5 + C0 * get(r, 'f_dc_0'));
    col[i * 4 + 1] = clamp01(0.5 + C0 * get(r, 'f_dc_1'));
    col[i * 4 + 2] = clamp01(0.5 + C0 * get(r, 'f_dc_2'));
    col[i * 4 + 3] = sigmoid(get(r, 'opacity'));
    size[i] = Math.exp((get(r, 'scale_0') + get(r, 'scale_1') + get(r, 'scale_2')) / 3);
  }
  return { count, pos, col, size };
}

// PlayCanvas/SuperSplat compressed PLY: per-256-splat `chunk` records hold min/max
// bounds; each vertex packs position/scale/color into uints (see splat-transform).
// Color and opacity are stored as the FINAL [0,1] values (no SH decode / sigmoid).
function parseCompressedPly(buf, h) {
  const chunk = el(h, 'chunk');
  const vert = el(h, 'vertex');
  if (!chunk) throw new Error('compressed PLY missing chunk element');
  if (vert.offset + vert.count * vert.stride > buf.byteLength)
    throw new Error('PLY data truncated');
  const dv = new DataView(buf);
  const cf = (ci, name, def) =>
    chunk.idx[name]
      ? dv.getFloat32(chunk.offset + ci * chunk.stride + chunk.idx[name].off, h.little)
      : def;
  const vu = (vi, name) =>
    dv.getUint32(vert.offset + vi * vert.stride + vert.idx[name].off, h.little);

  const total = vert.count;
  const step = Math.max(1, Math.ceil(total / MAX_SPLATS));
  const count = Math.floor(total / step);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const vi = i * step;
    const ci = vi >>> 8; // 256 splats per chunk
    const pp = vu(vi, 'packed_position');
    const ps = vu(vi, 'packed_scale');
    const pc = vu(vi, 'packed_color');

    const minx = cf(ci, 'min_x', 0);
    const miny = cf(ci, 'min_y', 0);
    const minz = cf(ci, 'min_z', 0);
    pos[i * 3] = (((pp >>> 21) & 2047) / 2047) * (cf(ci, 'max_x', 1) - minx) + minx;
    pos[i * 3 + 1] = (((pp >>> 11) & 1023) / 1023) * (cf(ci, 'max_y', 1) - miny) + miny;
    pos[i * 3 + 2] = ((pp & 2047) / 2047) * (cf(ci, 'max_z', 1) - minz) + minz;

    const msx = cf(ci, 'min_scale_x', 0);
    const msy = cf(ci, 'min_scale_y', 0);
    const msz = cf(ci, 'min_scale_z', 0);
    const sx = Math.exp((((ps >>> 21) & 2047) / 2047) * (cf(ci, 'max_scale_x', 0) - msx) + msx);
    const sy = Math.exp((((ps >>> 11) & 1023) / 1023) * (cf(ci, 'max_scale_y', 0) - msy) + msy);
    const sz = Math.exp(((ps & 2047) / 2047) * (cf(ci, 'max_scale_z', 0) - msz) + msz);
    size[i] = (sx + sy + sz) / 3;

    const minr = cf(ci, 'min_r', 0);
    const ming = cf(ci, 'min_g', 0);
    const minb = cf(ci, 'min_b', 0);
    col[i * 4] = clamp01((((pc >>> 24) & 255) / 255) * (cf(ci, 'max_r', 1) - minr) + minr);
    col[i * 4 + 1] = clamp01((((pc >>> 16) & 255) / 255) * (cf(ci, 'max_g', 1) - ming) + ming);
    col[i * 4 + 2] = clamp01((((pc >>> 8) & 255) / 255) * (cf(ci, 'max_b', 1) - minb) + minb);
    col[i * 4 + 3] = (pc & 255) / 255;
  }
  return { count, pos, col, size };
}

// .splattie: a ZIP bundle. manifest.json points at the base splat (a 3DGS .ply);
// the LBS weights/skeleton drive animation, which a static preview ignores.
export async function parseSplattie(buf) {
  const files = unzip(buf);
  const mf = files.get('manifest.json');
  if (!mf) throw new Error('.splattie is missing manifest.json');
  const manifest = JSON.parse(new TextDecoder().decode(mf));
  const splat = manifest.avatar && manifest.avatar.splat;
  if (!splat || !splat.file) throw new Error('.splattie manifest has no base splat');
  const entry = files.get(splat.file);
  if (!entry)
    throw new Error('.splattie references "' + splat.file + '" but it is not in the bundle');
  if (splat.format === 'spz') throw new Error('compressed .spz base splats are not supported yet');
  return parsePlySplat(toBuffer(entry));
}
