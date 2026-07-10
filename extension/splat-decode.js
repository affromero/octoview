// Pure Gaussian-splat decoders (no three.js, no DOM) so they can be unit-tested
// and reused. Each returns { count, pos:Float32[3n], col:Float32[4n] rgba,
// size:Float32[n] }. render-splat.js draws these; the tests assert the values.
import { unzip, toBuffer } from './unzip.js';

const C0 = 0.28209479177387814; // SH band-0 factor, f_dc -> base color
const MAX_SPLATS = 800000; // ponytail: subsample beyond this to keep the sort snappy
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Detect a 3DGS PLY (vs a mesh/point-cloud PLY) from its header text. A full-SH
// PLY lists ~45 f_rest_* before scale/rot, so scan a generous window.
export function isPlySplat(buf) {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(8192, buf.byteLength)));
  return /f_dc_0/.test(head) && /scale_0/.test(head) && /rot_0/.test(head);
}

// antimatter15 .splat: 32 bytes/splat — pos(3 f32), scale(3 f32), rgba(4 u8), quat(4 u8).
// Sample during parse (stride first) so a huge file never allocates the full set.
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

// 3DGS PLY (binary_little_endian): x y z … f_dc_0..2 … opacity scale_0..2 rot_0..3.
export function parsePlySplat(buf) {
  const bytes = new Uint8Array(buf);
  const scan = new TextDecoder().decode(bytes.subarray(0, Math.min(65536, bytes.length)));
  const end = scan.indexOf('end_header');
  if (end < 0) throw new Error('PLY header not found (or larger than 64KB)');
  const dataStart = scan.indexOf('\n', end) + 1;
  const total = +/element vertex (\d+)/.exec(scan)[1];
  const little = /binary_little_endian/.test(scan);
  if (!/format\s+binary/.test(scan)) throw new Error('ASCII PLY splats not supported');

  // Collect properties of the `vertex` element only (ignore any other element).
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
  const props = [];
  let inVertex = false;
  for (const line of scan.slice(0, end).split('\n')) {
    const t = line.trim();
    if (t.startsWith('element ')) inVertex = /^element\s+vertex\b/.test(t);
    else if (inVertex && t.startsWith('property ')) {
      const m = /^property\s+(\S+)\s+(\S+)/.exec(t);
      if (m) props.push({ type: m[1], name: m[2] });
    }
  }
  const idx = {};
  let stride = 0;
  for (const p of props) {
    const sz = TSIZE[p.type];
    if (sz == null) throw new Error('unsupported PLY property type ' + p.type);
    idx[p.name] = { off: stride, type: p.type };
    stride += sz;
  }
  if (dataStart + total * stride > buf.byteLength) throw new Error('PLY data truncated');

  const dv = new DataView(buf, dataStart);
  const get = (row, name) => {
    const f = idx[name];
    if (!f) return 0;
    const o = row * stride + f.off;
    return f.type === 'double' || f.type === 'float64'
      ? dv.getFloat64(o, little)
      : dv.getFloat32(o, little);
  };
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  // Sample during parse so a multi-million-splat PLY never allocates the full set.
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
