// octoview array renderer, lazy-imported inline for .npy/.npz. Pure JS: parses the
// NumPy header and draws the data as a false-color heatmap (2D) or an image (H,W,3).
// No workers, no deps -> WebKit safe. .npz is a ZIP of .npy entries; DEFLATE ones
// are inflated with the native DecompressionStream (Safari 16.4+), also main-thread.

// viridis control points, linear-interpolated -> readable heatmaps.
const VIRIDIS = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [109, 205, 89],
  [180, 222, 44],
  [253, 231, 37],
];
function colormap(t) {
  const x = Math.max(0, Math.min(1, t)) * (VIRIDIS.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = VIRIDIS[i];
  const b = VIRIDIS[Math.min(i + 1, VIRIDIS.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

const DTYPE = {
  f8: [Float64Array, 8],
  f4: [Float32Array, 4],
  i8: [BigInt64Array, 8],
  i4: [Int32Array, 4],
  i2: [Int16Array, 2],
  i1: [Int8Array, 1],
  u8: [BigUint64Array, 8],
  u4: [Uint32Array, 4],
  u2: [Uint16Array, 2],
  u1: [Uint8Array, 1],
  b1: [Uint8Array, 1],
};

// Parse one .npy buffer -> { shape, dtype, data:Float64Array (row-major) }.
function parseNpy(buf) {
  const b = new Uint8Array(buf);
  if (b[0] !== 0x93 || String.fromCharCode(b[1], b[2], b[3], b[4], b[5]) !== 'NUMPY')
    throw new Error('not a .npy file');
  const major = b[6];
  let hlen, hstart;
  const dv = new DataView(buf);
  if (major >= 2) {
    hlen = dv.getUint32(8, true);
    hstart = 12;
  } else {
    hlen = dv.getUint16(8, true);
    hstart = 10;
  }
  const header = new TextDecoder().decode(b.subarray(hstart, hstart + hlen));
  const descr = /'descr':\s*'([^']+)'/.exec(header)[1];
  const fortran = /'fortran_order':\s*True/.test(header);
  const shapeStr = /'shape':\s*\(([^)]*)\)/.exec(header)[1];
  const dims = shapeStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);

  const endian = descr[0];
  const key = descr.slice(1);
  const spec = DTYPE[key];
  if (!spec) throw new Error('unsupported dtype ' + descr);
  const [Arr, size] = spec;
  const count = dims.reduce((a, d) => a * d, 1) || 0;
  const dataStart = hstart + hlen;

  // Decode to Float64 row-major, honoring endianness and fortran order.
  const out = new Float64Array(count);
  const little = endian !== '>';
  const read =
    Arr === BigInt64Array || Arr === BigUint64Array
      ? (o) => Number(dv[Arr === BigInt64Array ? 'getBigInt64' : 'getBigUint64'](o, little))
      : (o) => dv['get' + typeName(Arr)](o, little);
  for (let i = 0; i < count; i++) out[i] = read(dataStart + i * size);

  return { dims, descr, data: fortran && dims.length === 2 ? toC(out, dims) : out, fortran };
}

function typeName(Arr) {
  return {
    Float64Array: 'Float64',
    Float32Array: 'Float32',
    Int32Array: 'Int32',
    Int16Array: 'Int16',
    Int8Array: 'Int8',
    Uint32Array: 'Uint32',
    Uint16Array: 'Uint16',
    Uint8Array: 'Uint8',
  }[Arr.name];
}

function toC(data, [h, w]) {
  const out = new Float64Array(data.length);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out[r * w + c] = data[c * h + r];
  return out;
}

export async function renderArray(buf, mount, ext) {
  mount.textContent = '';
  try {
    const arrays = ext === '.npz' ? await unzipNpz(buf) : [{ name: '', ...parseNpy(buf) }];
    if (!arrays.length) throw new Error('no arrays found');
    for (const a of arrays) drawArray(a, mount, arrays.length > 1);
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'ov-msg';
    p.textContent = 'Array preview failed: ' + ((e && e.message) || e);
    mount.appendChild(p);
  }
}

function drawArray(a, mount, showName) {
  const { dims, descr, data } = a;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < lo) lo = data[i];
    if (data[i] > hi) hi = data[i];
  }
  const meta = document.createElement('div');
  meta.className = 'ov-arr-meta';
  meta.textContent =
    (showName && a.name ? a.name + '  ·  ' : '') +
    `shape (${dims.join(', ')})  ·  ${descr}  ·  min ${fmt(lo)}  max ${fmt(hi)}`;
  mount.appendChild(meta);

  const isRGB = dims.length === 3 && (dims[2] === 3 || dims[2] === 4);
  const h = dims.length === 1 ? 1 : dims[0];
  const w = dims.length === 1 ? dims[0] : dims[1];
  const canvas = document.createElement('canvas');
  canvas.className = 'ov-arr-canvas';
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const span = hi - lo || 1;
  const floatRGB = isRGB && (descr.includes('f') || hi <= 1.01);

  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (isRGB) {
      const c = dims[2];
      const base = i * c;
      const s = floatRGB ? 255 : 1;
      img.data[o] = data[base] * s;
      img.data[o + 1] = data[base + 1] * s;
      img.data[o + 2] = data[base + 2] * s;
      img.data[o + 3] = c === 4 ? data[base + 3] * s : 255;
    } else {
      const [r, g, bl] = colormap((data[i] - lo) / span);
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = bl;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Scale up small arrays crisply; scale down big ones to fit.
  canvas.style.width = Math.min(Math.max(w, 240), 900) + 'px';
  canvas.style.imageRendering = w < 200 ? 'pixelated' : 'auto';
  mount.appendChild(canvas);
}

function fmt(v) {
  if (!isFinite(v)) return String(v);
  return Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)
    ? v.toExponential(2)
    : +v.toFixed(3);
}

// Iterate a ZIP's local file headers (numpy writes sizes in-header, seekable).
async function unzipNpz(buf) {
  const dv = new DataView(buf);
  const b = new Uint8Array(buf);
  const out = [];
  let p = 0;
  while (p + 4 <= b.length && dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true);
    const compSize = dv.getUint32(p + 18, true);
    const nameLen = dv.getUint16(p + 26, true);
    const extraLen = dv.getUint16(p + 28, true);
    const nameStart = p + 30;
    const name = new TextDecoder().decode(b.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    let bytes = b.subarray(dataStart, dataStart + compSize);
    if (method === 8) bytes = new Uint8Array(await inflateRaw(bytes));
    if (name.endsWith('.npy'))
      out.push({
        name: name.replace(/\.npy$/, ''),
        ...parseNpy(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      });
    p = dataStart + compSize;
  }
  return out;
}

function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).arrayBuffer();
}
