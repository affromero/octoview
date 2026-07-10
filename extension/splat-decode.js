// Pure Gaussian-splat decoders (no three.js, no DOM) so they can be unit-tested
// and reused. Each returns { count, pos:Float32[3n], col:Float32[4n] rgba,
// size:Float32[n] }. render-splat.js draws these; the tests assert the values.
import { unzip, toBuffer } from './unzip.js';

const C0 = 0.28209479177387814; // SH band-0 factor, f_dc -> base color
const MAX_SPLATS = 800000; // ponytail: subsample beyond this to keep the sort snappy
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Locate the PLY header end in BYTES (a header comment may hold multi-byte chars,
// so a decoded-string index would give the wrong binary data offset).
function readPlyHeader(buf) {
  const b = new Uint8Array(buf);
  const lim = Math.min(b.length, 65536);
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
    return { text: new TextDecoder().decode(b.subarray(0, i)), dataStart: k + 1 };
  }
  return null;
}

// Detect a 3DGS PLY (vs a mesh/point-cloud PLY): the gaussian fields must be
// declared PROPERTIES of the vertex element, not just strings in a comment.
export function isPlySplat(buf) {
  const h = readPlyHeader(buf);
  return (
    !!h &&
    /property\s+\S+\s+f_dc_0\b/.test(h.text) &&
    /property\s+\S+\s+scale_0\b/.test(h.text) &&
    /property\s+\S+\s+rot_0\b/.test(h.text)
  );
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
  const h = readPlyHeader(buf);
  if (!h) throw new Error('PLY header not found (or larger than 64KB)');
  const scan = h.text;
  const dataStart = h.dataStart;
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
  for (const line of scan.split('\n')) {
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
