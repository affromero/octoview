// Pure Gaussian-splat decoders (no three.js, no DOM) so they can be unit-tested
// and reused. Each returns { count, pos:Float32[3n], col:Float32[4n] rgba [0,1],
// scale:Float32[3n] (linear world-space std dev), quat:Float32[4n] (xyzw,
// normalized) }. render-splat.js builds each splat's covariance R S^2 R^T from
// scale+quat and draws the oriented gaussian. Handles the antimatter15 .splat,
// the standard float 3DGS .ply, and the PlayCanvas/SuperSplat COMPRESSED .ply
// (chunk + packed_* uints, what splat-transform emits).
import { unzip } from './unzip.js';
import { zstdDecompress, Gunzip } from './vendor/fflate.esm.js';

const C0 = 0.28209479177387814; // SH band-0 factor, f_dc -> base color
const SQRT2 = Math.SQRT2; // smallest-three quaternion component scale

// PlayCanvas "smallest three" quaternion, packed in a uint32: top 2 bits index
// the omitted (largest) component; the other three are 10-bit signed, mapped to
// [-1/√2, 1/√2]. The compressed .ply (packed_rotation) and splat-transform .spz
// (4-byte rotation) both use it. Writes xyzw into out[o..o+3].
function unpackQuat(u, out, o) {
  const li = u >>> 30;
  const a = (((u >>> 20) & 1023) / 1023 - 0.5) * SQRT2;
  const b = (((u >>> 10) & 1023) / 1023 - 0.5) * SQRT2;
  const c = ((u & 1023) / 1023 - 0.5) * SQRT2;
  out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
  out[o + ((li + 1) & 3)] = a;
  out[o + ((li + 2) & 3)] = b;
  out[o + ((li + 3) & 3)] = c;
  out[o + li] = Math.sqrt(Math.max(0, 1 - a * a - b * b - c * c));
}
const MAX_SPLATS = 800000; // ponytail: subsample beyond this to keep the sort snappy
// Untrusted .spz files decompress on the main thread; cap the inflated size so a
// gzip/zstd bomb (a tiny file expanding to gigabytes) cannot OOM the tab. 256MiB
// is well past any real capture yet survivable.
const SPZ_MAX_BYTES = 256 * 1024 * 1024;

// gunzip with a running output cap: a bomb aborts mid-stream instead of after a
// multi-GB allocation. fflate's Gunzip calls ondata synchronously during push,
// so a throw here propagates out.
function gunzipCapped(raw, cap) {
  const chunks = [];
  let size = 0;
  const g = new Gunzip((chunk) => {
    size += chunk.length;
    if (size > cap) throw new Error('.spz gzip stream exceeds the ' + (cap >> 20) + 'MiB limit');
    chunks.push(chunk.slice()); // ondata may reuse its buffer; copy
  });
  g.push(raw, true);
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
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

// antimatter15 .splat: 32 bytes/splat — pos(3 f32), scale(3 f32, LINEAR), rgba(4
// u8), quat(4 u8, stored w,x,y,z as (byte-128)/128).
export function parseSplatBin(buf) {
  const total = Math.floor(buf.byteLength / 32);
  const step = Math.max(1, Math.ceil(total / MAX_SPLATS));
  const count = Math.floor(total / step);
  const dv = new DataView(buf);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  const scale = new Float32Array(count * 3);
  const quat = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const o = i * step * 32;
    pos[i * 3] = dv.getFloat32(o, true);
    pos[i * 3 + 1] = dv.getFloat32(o + 4, true);
    pos[i * 3 + 2] = dv.getFloat32(o + 8, true);
    scale[i * 3] = dv.getFloat32(o + 12, true);
    scale[i * 3 + 1] = dv.getFloat32(o + 16, true);
    scale[i * 3 + 2] = dv.getFloat32(o + 20, true);
    col[i * 4] = dv.getUint8(o + 24) / 255;
    col[i * 4 + 1] = dv.getUint8(o + 25) / 255;
    col[i * 4 + 2] = dv.getUint8(o + 26) / 255;
    col[i * 4 + 3] = dv.getUint8(o + 27) / 255;
    quat[i * 4] = (dv.getUint8(o + 29) - 128) / 128; // x
    quat[i * 4 + 1] = (dv.getUint8(o + 30) - 128) / 128; // y
    quat[i * 4 + 2] = (dv.getUint8(o + 31) - 128) / 128; // z
    quat[i * 4 + 3] = (dv.getUint8(o + 28) - 128) / 128; // w
  }
  return { count, pos, col, scale, quat };
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
  const scale = new Float32Array(count * 3);
  const quat = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const r = i * step;
    pos[i * 3] = get(r, 'x');
    pos[i * 3 + 1] = get(r, 'y');
    pos[i * 3 + 2] = get(r, 'z');
    col[i * 4] = clamp01(0.5 + C0 * get(r, 'f_dc_0'));
    col[i * 4 + 1] = clamp01(0.5 + C0 * get(r, 'f_dc_1'));
    col[i * 4 + 2] = clamp01(0.5 + C0 * get(r, 'f_dc_2'));
    col[i * 4 + 3] = sigmoid(get(r, 'opacity'));
    scale[i * 3] = Math.exp(get(r, 'scale_0'));
    scale[i * 3 + 1] = Math.exp(get(r, 'scale_1'));
    scale[i * 3 + 2] = Math.exp(get(r, 'scale_2'));
    quat[i * 4] = get(r, 'rot_1'); // x
    quat[i * 4 + 1] = get(r, 'rot_2'); // y
    quat[i * 4 + 2] = get(r, 'rot_3'); // z
    quat[i * 4 + 3] = get(r, 'rot_0'); // w
  }
  return { count, pos, col, scale, quat };
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
  const scale = new Float32Array(count * 3);
  const quat = new Float32Array(count * 4);
  const qq = [0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    const vi = i * step;
    const ci = vi >>> 8; // 256 splats per chunk
    const pp = vu(vi, 'packed_position');
    const pr = vu(vi, 'packed_rotation');
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
    scale[i * 3] = Math.exp((((ps >>> 21) & 2047) / 2047) * (cf(ci, 'max_scale_x', 0) - msx) + msx);
    scale[i * 3 + 1] = Math.exp(
      (((ps >>> 11) & 1023) / 1023) * (cf(ci, 'max_scale_y', 0) - msy) + msy
    );
    scale[i * 3 + 2] = Math.exp(((ps & 2047) / 2047) * (cf(ci, 'max_scale_z', 0) - msz) + msz);

    // packed_rotation: smallest-three quaternion — top 2 bits index the omitted
    // (largest) component; the other three are 10-bit signed, reconstructed in
    // [-1/√2, 1/√2]. (Verified against SuperSplat's own render.)
    const li = pr >>> 30;
    const a = (((pr >>> 20) & 1023) / 1023 - 0.5) * SQRT2;
    const b = (((pr >>> 10) & 1023) / 1023 - 0.5) * SQRT2;
    const c = ((pr & 1023) / 1023 - 0.5) * SQRT2;
    qq[(li + 1) & 3] = a;
    qq[(li + 2) & 3] = b;
    qq[(li + 3) & 3] = c;
    qq[li] = Math.sqrt(Math.max(0, 1 - a * a - b * b - c * c));
    quat[i * 4] = qq[0];
    quat[i * 4 + 1] = qq[1];
    quat[i * 4 + 2] = qq[2];
    quat[i * 4 + 3] = qq[3];

    const minr = cf(ci, 'min_r', 0);
    const ming = cf(ci, 'min_g', 0);
    const minb = cf(ci, 'min_b', 0);
    col[i * 4] = clamp01((((pc >>> 24) & 255) / 255) * (cf(ci, 'max_r', 1) - minr) + minr);
    col[i * 4 + 1] = clamp01((((pc >>> 16) & 255) / 255) * (cf(ci, 'max_g', 1) - ming) + ming);
    col[i * 4 + 2] = clamp01((((pc >>> 8) & 255) / 255) * (cf(ci, 'max_b', 1) - minb) + minb);
    col[i * 4 + 3] = (pc & 255) / 255;
  }
  return { count, pos, col, scale, quat };
}

// IEEE 754 half → float (spz v1 centers, ksplat level-1/2 scales).
function fromHalf(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

// Niantic .spz. v1-3: whole file gzipped; inside, a 16-byte header then
// struct-of-arrays. v4: plaintext 32-byte header + TOC + one independent zstd
// frame per attribute stream, fixed order positions/alphas/colors/scales/
// rotations/SH with empty streams omitted (per nianticlabs/spz load-spz.cc).
// The per-attribute encodings are IDENTICAL across v1-4 — only the container
// changed — so both paths feed one decode loop. The isotropic preview never
// touches rotations/SH; for v4 those frames aren't even decompressed.
export function parseSpz(buf) {
  const raw = new Uint8Array(buf);
  const plainMagic = new DataView(buf, 0, Math.min(8, buf.byteLength));
  const attrs =
    buf.byteLength >= 8 && plainMagic.getUint32(0, true) === 0x5053474e
      ? spzV4Streams(raw)
      : spzV13Streams(gunzipCapped(raw, SPZ_MAX_BYTES));
  const { total, fractionalBits, centers, centerBytes, alphas, colors, scales, rotations } = attrs;

  const step = Math.max(1, Math.ceil(total / MAX_SPLATS));
  const count = Math.floor(total / step);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  const scale = new Float32Array(count * 3);
  const quat = new Float32Array(count * 4);
  const fixed = 1 << fractionalBits;
  const colScale = C0 / 0.15; // Spark: c = (byte/255 - 0.5) * (C0/0.15) + 0.5
  const cdv = new DataView(centers.buffer, centers.byteOffset, centers.byteLength);
  const rdv = new DataView(rotations.buffer, rotations.byteOffset, rotations.byteLength);
  for (let i = 0; i < count; i++) {
    const r = i * step;
    if (centerBytes === 6) {
      const o = r * 6;
      pos[i * 3] = fromHalf(cdv.getUint16(o, true));
      pos[i * 3 + 1] = fromHalf(cdv.getUint16(o + 2, true));
      pos[i * 3 + 2] = fromHalf(cdv.getUint16(o + 4, true));
    } else {
      const o = r * 9;
      for (let d = 0; d < 3; d++) {
        const u =
          centers[o + d * 3] | (centers[o + d * 3 + 1] << 8) | (centers[o + d * 3 + 2] << 16);
        pos[i * 3 + d] = ((u << 8) >> 8) / fixed; // sign-extend 24-bit
      }
    }
    col[i * 4] = clamp01((colors[r * 3] / 255 - 0.5) * colScale + 0.5);
    col[i * 4 + 1] = clamp01((colors[r * 3 + 1] / 255 - 0.5) * colScale + 0.5);
    col[i * 4 + 2] = clamp01((colors[r * 3 + 2] / 255 - 0.5) * colScale + 0.5);
    col[i * 4 + 3] = alphas[r] / 255;
    scale[i * 3] = Math.exp(scales[r * 3] / 16 - 10);
    scale[i * 3 + 1] = Math.exp(scales[r * 3 + 1] / 16 - 10);
    scale[i * 3 + 2] = Math.exp(scales[r * 3 + 2] / 16 - 10);
    unpackQuat(rdv.getUint32(r * 4, true), quat, i * 4);
  }
  return { count, pos, col, scale, quat };
}

// v1-3 body: 16-byte header then contiguous struct-of-arrays.
function spzV13Streams(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== 0x5053474e) throw new Error('not an .spz file (bad magic)');
  const version = dv.getUint32(4, true);
  if (version < 1 || version > 3)
    throw new Error('.spz version ' + version + ' not supported here');
  const total = dv.getUint32(8, true);
  const centerBytes = version === 1 ? 6 : 9;
  const centersOff = 16;
  const alphasOff = centersOff + total * centerBytes;
  const colorsOff = alphasOff + total;
  const scalesOff = colorsOff + total * 3;
  const rotsOff = scalesOff + total * 3;
  if (rotsOff + total * 4 > b.length) throw new Error('.spz data truncated');
  return {
    total,
    fractionalBits: b[13],
    centerBytes,
    centers: b.subarray(centersOff, alphasOff),
    alphas: b.subarray(alphasOff, colorsOff),
    colors: b.subarray(colorsOff, scalesOff),
    scales: b.subarray(scalesOff, rotsOff),
    rotations: b.subarray(rotsOff, rotsOff + total * 4),
  };
}

// v4 container: 32-byte plaintext header, TOC of {u64 compressed, u64
// uncompressed} at tocByteOffset, then back-to-back zstd frames in attribute
// order with zero-size attributes omitted from both TOC and numStreams.
function spzV4Streams(raw) {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const version = dv.getUint32(4, true);
  if (version !== 4) throw new Error('.spz version ' + version + ' not supported (v1-4 only)');
  const total = dv.getUint32(8, true);
  // total is an unvalidated header field; the positions stream alone is total*9
  // bytes and gets allocated up front, so cap it before trusting it.
  if (total * 9 > SPZ_MAX_BYTES) throw new Error('.spz v4 declares too many points');
  const shDegree = raw[12];
  const fractionalBits = raw[13];
  const numStreams = raw[15];
  const toc = dv.getUint32(16, true);
  const SH_DIM = { 0: 0, 1: 3, 2: 8, 3: 15, 4: 24 };
  // expected uncompressed sizes, fixed attribute order; 0 = stream omitted
  const expected = [
    total * 9,
    total,
    total * 3,
    total * 3,
    total * 4,
    total * 3 * (SH_DIM[shDegree] ?? 0),
  ];
  const out = [];
  let entry = toc;
  let data = toc + numStreams * 16;
  let seen = 0;
  for (const size of expected) {
    if (size === 0) {
      out.push(null);
      continue;
    }
    if (seen++ >= numStreams) throw new Error('.spz v4 stream table truncated');
    if (entry + 16 > raw.length) throw new Error('.spz v4 TOC out of bounds');
    const compressed = Number(dv.getBigUint64(entry, true));
    const uncompressed = Number(dv.getBigUint64(entry + 8, true));
    if (uncompressed !== size) throw new Error('.spz v4 stream size mismatch');
    if (data + compressed > raw.length) throw new Error('.spz v4 stream out of bounds');
    // SH (stream index 5) is never used by the preview — skip its decompression
    // entirely; positions/alphas/colors/scales/rotations (0..4) are all decoded.
    out.push(
      out.length >= 5
        ? null
        : zstdDecompress(raw.subarray(data, data + compressed), new Uint8Array(size))
    );
    entry += 16;
    data += compressed;
  }
  return {
    total,
    fractionalBits,
    centerBytes: 9,
    centers: out[0],
    alphas: out[1],
    colors: out[2],
    scales: out[3],
    rotations: out[4],
  };
}

// mkkellogg .ksplat: 4096-byte header, 1024-byte section headers, then per
// section: partial-bucket sizes (u32 each), bucket centers (f32 x3 each), splat
// records. Levels 1/2 quantize centers as u16 relative to their bucket center;
// scales are stored LINEAR (f32 / half — no exp anywhere, unlike PLY/spz).
// Layout follows Spark's decodeKsplat. Rotations/SH are skipped (isotropic).
export function parseKsplat(buf) {
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== 0 || dv.getUint8(1) < 1) throw new Error('.ksplat version not supported');
  const maxSectionCount = dv.getUint32(4, true);
  const sectionCount = dv.getUint32(8, true);
  const total = dv.getUint32(16, true);
  const level = dv.getUint16(20, true);
  if (level > 2) throw new Error('.ksplat compression level ' + level + ' not supported');

  const step = Math.max(1, Math.ceil(total / MAX_SPLATS));
  const count = Math.floor(total / step);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  const scale = new Float32Array(count * 3);
  const quat = new Float32Array(count * 4);
  const SH_COMP = { 0: 0, 1: 9, 2: 24, 3: 45 };

  let sectionBase = 4096 + maxSectionCount * 1024;
  let emitted = 0;
  let seen = 0;
  for (let s = 0; s < sectionCount && emitted < count; s++) {
    const hb = 4096 + s * 1024;
    const secSplats = dv.getUint32(hb, true);
    const maxSplats = dv.getUint32(hb + 4, true);
    const bucketSize = dv.getUint32(hb + 8, true);
    const bucketCount = dv.getUint32(hb + 12, true);
    const bucketBlockSize = dv.getFloat32(hb + 16, true);
    const bucketStorage = dv.getUint16(hb + 20, true);
    const range = dv.getUint32(hb + 24, true) || 32767;
    const fullBuckets = dv.getUint32(hb + 32, true);
    const partialBuckets = dv.getUint32(hb + 36, true);
    const shComp = SH_COMP[dv.getUint16(hb + 40, true)] ?? 0;
    const stride = level === 0 ? 44 + shComp * 4 : level === 1 ? 24 + shComp * 2 : 24 + shComp;
    const factor = bucketBlockSize / 2 / range;

    const metaSize = partialBuckets * 4;
    const bucketsBase = sectionBase + metaSize;
    const dataBase = sectionBase + bucketStorage * bucketCount + metaSize;

    // Sequential walk so bucket boundaries (full buckets first, then partial
    // buckets with explicit sizes) stay in lockstep with the splat index.
    let bucket = 0;
    let inBucket = 0;
    let bucketCap = fullBuckets > 0 ? bucketSize : dv.getUint32(sectionBase, true);
    for (let j = 0; j < secSplats && emitted < count; j++, seen++) {
      const o = dataBase + j * stride;
      if (seen % step === 0) {
        const i = emitted++;
        if (level === 0) {
          pos[i * 3] = dv.getFloat32(o, true);
          pos[i * 3 + 1] = dv.getFloat32(o + 4, true);
          pos[i * 3 + 2] = dv.getFloat32(o + 8, true);
          scale[i * 3] = dv.getFloat32(o + 12, true);
          scale[i * 3 + 1] = dv.getFloat32(o + 16, true);
          scale[i * 3 + 2] = dv.getFloat32(o + 20, true);
          // rotation: 4 f32 at o+24, stored w,x,y,z (mkkellogg); write xyzw
          quat[i * 4] = dv.getFloat32(o + 28, true);
          quat[i * 4 + 1] = dv.getFloat32(o + 32, true);
          quat[i * 4 + 2] = dv.getFloat32(o + 36, true);
          quat[i * 4 + 3] = dv.getFloat32(o + 24, true);
          for (let c = 0; c < 4; c++) col[i * 4 + c] = dv.getUint8(o + 40 + c) / 255;
        } else {
          for (let d = 0; d < 3; d++)
            pos[i * 3 + d] =
              (dv.getUint16(o + d * 2, true) - range) * factor +
              dv.getFloat32(bucketsBase + (bucket * 3 + d) * 4, true);
          scale[i * 3] = fromHalf(dv.getUint16(o + 6, true));
          scale[i * 3 + 1] = fromHalf(dv.getUint16(o + 8, true));
          scale[i * 3 + 2] = fromHalf(dv.getUint16(o + 10, true));
          // rotation: 4 f16 at o+12, stored w,x,y,z (mkkellogg); write xyzw
          quat[i * 4] = fromHalf(dv.getUint16(o + 14, true));
          quat[i * 4 + 1] = fromHalf(dv.getUint16(o + 16, true));
          quat[i * 4 + 2] = fromHalf(dv.getUint16(o + 18, true));
          quat[i * 4 + 3] = fromHalf(dv.getUint16(o + 12, true));
          for (let c = 0; c < 4; c++) col[i * 4 + c] = dv.getUint8(o + 20 + c) / 255;
        }
      }
      if (++inBucket >= bucketCap) {
        bucket++;
        inBucket = 0;
        bucketCap =
          bucket < fullBuckets
            ? bucketSize
            : dv.getUint32(sectionBase + (bucket - fullBuckets) * 4, true);
      }
    }
    sectionBase = dataBase + maxSplats * stride;
  }
  return {
    count: emitted,
    pos: pos.subarray(0, emitted * 3),
    col: col.subarray(0, emitted * 4),
    scale: scale.subarray(0, emitted * 3),
    quat: quat.subarray(0, emitted * 4),
  };
}

// PlayCanvas .sog v2: a ZIP of meta.json + webp data textures. Positions split
// 16-bit across means_l/means_u then inverse-log; scales and colors index
// 256-entry codebooks; sh0 alpha IS the opacity byte. decodeImage(bytes) ->
// {data: Uint8ClampedArray rgba, width, height} is injected by the caller —
// webp decoding needs DOM APIs, and a plain 2D canvas would premultiply the
// alpha-carrying data channels (see render-splat.js for the WebGL2 readback).
export async function parseSog(buf, decodeImage) {
  const files = unzip(buf);
  const mf = files.get('meta.json');
  if (!mf) throw new Error('.sog is missing meta.json');
  const meta = JSON.parse(new TextDecoder().decode(mf));
  if (!('version' in meta)) throw new Error('.sog v1 (pre-codebook) not supported');
  if (meta.version !== 2) throw new Error('.sog version ' + meta.version + ' not supported');
  const total = meta.count;
  if (!Number.isInteger(total) || total < 0 || total > 100_000_000)
    throw new Error('.sog declares an implausible splat count');
  // Each data texture must hold one RGBA texel per splat; a file whose count
  // exceeds its images would index past the pixel arrays and read NaN garbage.
  const img = async (name) => {
    const entry = files.get(name);
    if (!entry) throw new Error('.sog is missing ' + name);
    const { data } = await decodeImage(entry);
    if (data.length < total * 4) throw new Error('.sog image ' + name + ' is smaller than count');
    return data;
  };
  const [lo, hi, scales, sh0, quats] = await Promise.all([
    img(meta.means.files[0]),
    img(meta.means.files[1]),
    img(meta.scales.files[0]),
    img(meta.sh0.files[0]),
    img(meta.quats.files[0]),
  ]);
  const { mins, maxs } = meta.means;
  const scaleLut = meta.scales.codebook.map((x) => Math.exp(x));
  const colLut = meta.sh0.codebook.map((x) => clamp01(C0 * x + 0.5));

  const step = Math.max(1, Math.ceil(total / MAX_SPLATS));
  const count = Math.floor(total / step);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  const scale = new Float32Array(count * 3);
  const quat = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const p = i * step * 4;
    for (let d = 0; d < 3; d++) {
      const f = (lo[p + d] + (hi[p + d] << 8)) / 65535;
      const v = mins[d] + (maxs[d] - mins[d]) * f;
      pos[i * 3 + d] = Math.sign(v) * (Math.exp(Math.abs(v)) - 1);
    }
    scale[i * 3] = scaleLut[scales[p]];
    scale[i * 3 + 1] = scaleLut[scales[p + 1]];
    scale[i * 3 + 2] = scaleLut[scales[p + 2]];
    // quats webp: RGB are the three smallest components ([-1/√2, 1/√2]), A the
    // index of the omitted (largest) component. Smallest-three, 8-bit per channel.
    const li = quats[p + 3] & 3;
    const qa = (quats[p] / 255 - 0.5) * SQRT2;
    const qb = (quats[p + 1] / 255 - 0.5) * SQRT2;
    const qc = (quats[p + 2] / 255 - 0.5) * SQRT2;
    quat[i * 4 + ((li + 1) & 3)] = qa;
    quat[i * 4 + ((li + 2) & 3)] = qb;
    quat[i * 4 + ((li + 3) & 3)] = qc;
    quat[i * 4 + li] = Math.sqrt(Math.max(0, 1 - qa * qa - qb * qb - qc * qc));
    col[i * 4] = colLut[sh0[p]];
    col[i * 4 + 1] = colLut[sh0[p + 1]];
    col[i * 4 + 2] = colLut[sh0[p + 2]];
    col[i * 4 + 3] = sh0[p + 3] / 255;
  }
  return { count, pos, col, scale, quat };
}

// XGRIDS LCC v1: metadata plus index.bin/data.bin companions. SH and
// environment payloads are intentionally omitted from this lightweight preview;
// the base colour and isotropic scale are enough for a useful scene thumbnail.
export function parseLcc(metaBytes, indexBytes, dataBytes) {
  metaBytes = bytes(metaBytes);
  indexBytes = bytes(indexBytes);
  dataBytes = bytes(dataBytes);
  let meta;
  try {
    meta = JSON.parse(new TextDecoder().decode(metaBytes));
  } catch {
    throw new Error('invalid LCC metadata JSON');
  }
  if (!Array.isArray(meta.attributes) || !Array.isArray(meta.splats) || !meta.totalLevel)
    throw new Error('invalid LCC metadata');
  const scale = Object.fromEntries(meta.attributes.map((attribute) => [attribute.name, attribute]));
  if (!scale.scale?.min || !scale.scale?.max)
    throw new Error('LCC metadata is missing scale bounds');

  const index = dataView(indexBytes);
  const stride = 4 + meta.totalLevel * 16;
  if (index.byteLength % stride) throw new Error('invalid LCC index.bin length');
  const records = [];
  for (let unit = 0; unit < index.byteLength / stride; unit++) {
    const base = unit * stride + 4;
    for (let lod = 0; lod < meta.totalLevel; lod++) {
      const offset = base + lod * 16;
      const count = index.getInt32(offset, true);
      const dataOffset = Number(index.getBigInt64(offset + 4, true));
      const size = index.getInt32(offset + 12, true);
      if (count < 0 || size < count * 32 || !Number.isSafeInteger(dataOffset))
        throw new Error('invalid LCC index entry');
      if (dataOffset + count * 32 > dataBytes.byteLength)
        throw new Error('LCC data.bin is truncated');
      records.push({ count, dataOffset });
    }
  }

  const total = records.reduce((sum, record) => sum + record.count, 0);
  // A record's count is bounds-checked against data.bin individually, but many
  // records can point at the SAME offset — so a crafted index.bin could sum to a
  // count far larger than data.bin holds and OOM the tab. Real (non-overlapping)
  // LODs can't sum past data.bin/32 splats; refuse anything beyond that, then
  // subsample to MAX_SPLATS like every other splat decoder.
  if (total > Math.floor(dataBytes.byteLength / 32))
    throw new Error('LCC index declares more splats than data.bin holds');
  const count = Math.min(total, MAX_SPLATS);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  // Per-axis scale (below) from the metadata's scale bounds. Rotation stays
  // identity: the LCC metadata declares only a `scale` attribute (no rotation),
  // and the committed sample's 10 trailing record bytes are all zero (identity),
  // so there is nothing to decode and no anisotropic LCC sample to verify a guess
  // against. Add rotation here if a real oriented LCC capture surfaces.
  const scaleArr = new Float32Array(count * 3);
  const quat = new Float32Array(count * 4);
  const data = dataView(dataBytes);
  let out = 0;
  for (const record of records) {
    if (out >= count) break;
    for (let i = 0; i < record.count && out < count; i++, out++) {
      const offset = record.dataOffset + i * 32;
      pos[out * 3] = data.getFloat32(offset, true);
      pos[out * 3 + 1] = data.getFloat32(offset + 4, true);
      pos[out * 3 + 2] = data.getFloat32(offset + 8, true);
      col[out * 4] = data.getUint8(offset + 12) / 255;
      col[out * 4 + 1] = data.getUint8(offset + 13) / 255;
      col[out * 4 + 2] = data.getUint8(offset + 14) / 255;
      col[out * 4 + 3] = data.getUint8(offset + 15) / 255;
      for (let d = 0; d < 3; d++)
        scaleArr[out * 3 + d] = Math.exp(
          lerp(
            scale.scale.min[d],
            scale.scale.max[d],
            data.getUint16(offset + 16 + d * 2, true) / 65535
          )
        );
      quat[out * 4 + 3] = 1;
    }
  }
  return { count, pos, col, scale: scaleArr, quat };
}

function lerp(min, max, t) {
  return min + (max - min) * t;
}

function bytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function dataView(value) {
  return new DataView(value.buffer, value.byteOffset, value.byteLength);
}
