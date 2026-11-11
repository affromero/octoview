// octoview array renderer, lazy-imported inline for .npy/.npz. Pure JS: parses the
// NumPy header and draws the data as a false-color heatmap (2D) or an image (H,W,3).
// No workers, no deps -> WebKit safe. .npz is a ZIP of .npy entries (see unzip.js).
import { unzip, toBuffer } from './unzip.js';

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
export function colormap(t) {
  if (!isFinite(t)) t = 0; // NaN/Inf (e.g. an all-NaN array) map to the low color
  const x = Math.max(0, Math.min(1, t)) * (VIRIDIS.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = VIRIDIS[i];
  const b = VIRIDIS[Math.min(i + 1, VIRIDIS.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

const DTYPE = {
  f2: [null, 2],
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
const TNAME = {
  Float64Array: 'Float64',
  Float32Array: 'Float32',
  Int32Array: 'Int32',
  Int16Array: 'Int16',
  Int8Array: 'Int8',
  Uint32Array: 'Uint32',
  Uint16Array: 'Uint16',
  Uint8Array: 'Uint8',
};
const MAX_DIM = 2000; // cap the rendered canvas; larger arrays are stride-downsampled
const MAX_HALF_ELEMENTS = 16 * 1024 * 1024;
const MAX_FORTRAN_WORK = 64 * 1024 * 1024;

// Parse one .npy buffer -> { dims, descr, data } (data is an array-like, row-major).
export function parseNpy(buf) {
  const b = new Uint8Array(buf);
  if (b[0] !== 0x93 || String.fromCharCode(b[1], b[2], b[3], b[4], b[5]) !== 'NUMPY')
    throw new Error('not a .npy file');
  const dv = new DataView(buf);
  const major = b[6];
  const hlen = major >= 2 ? dv.getUint32(8, true) : dv.getUint16(8, true);
  const hstart = major >= 2 ? 12 : 10;
  const header = new TextDecoder().decode(b.subarray(hstart, hstart + hlen));
  const descr = /'descr':\s*'([^']+)'/.exec(header)[1];
  const fortran = /'fortran_order':\s*True/.test(header);
  const dims = /'shape':\s*\(([^)]*)\)/
    .exec(header)[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);

  if (dims.length > 64 || dims.some((dim) => !Number.isSafeInteger(dim) || dim < 0)) {
    throw new Error('invalid array shape');
  }

  const endian = descr[0];
  const spec = DTYPE[descr.slice(1)];
  if (!spec) throw new Error('unsupported dtype ' + descr);
  const [Arr, size] = spec;
  const count = dims.reduce((a, d) => a * d, 1) || 0;
  const dataStart = hstart + hlen;
  if (descr.slice(1) === 'f2' && count > MAX_HALF_ELEMENTS)
    throw new Error('float16 array is too large to preview');
  if (fortran && count * dims.length > MAX_FORTRAN_WORK)
    throw new Error('Fortran-order array requires too much work to preview');
  if (!Number.isSafeInteger(count) || dataStart + count * size > buf.byteLength)
    throw new Error('.npy data is truncated or shape is too large');

  const little = endian !== '>';
  const is64 = Arr === BigInt64Array || Arr === BigUint64Array;
  const isHalf = descr.slice(1) === 'f2';
  let data;
  if (little && !is64 && !isHalf) {
    // Fast path: view the bytes as the native typed array (slice guarantees
    // alignment). Avoids a per-element DataView loop on large arrays.
    data = new Arr(buf.slice(dataStart, dataStart + count * size));
  } else {
    data = isHalf ? new Float32Array(count) : is64 ? new Arr(count) : new Float64Array(count);
    const getBig = Arr === BigInt64Array ? 'getBigInt64' : 'getBigUint64';
    for (let i = 0; i < count; i++) {
      const o = dataStart + i * size;
      data[i] = isHalf
        ? halfFloat(dv.getUint16(o, little))
        : is64
          ? dv[getBig](o, little)
          : dv['get' + TNAME[Arr.name]](o, little);
    }
  }
  return { dims, descr, data: fortran && dims.length > 1 ? fortranToC(data, dims) : data };
}

function halfFloat(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 31;
  const fraction = bits & 1023;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

// Reorder column-major (Fortran) data to row-major (C) for any dimensionality.
function fortranToC(data, dims) {
  const nd = dims.length;
  const cStride = new Array(nd);
  const fStride = new Array(nd);
  cStride[nd - 1] = 1;
  for (let i = nd - 2; i >= 0; i--) cStride[i] = cStride[i + 1] * dims[i + 1];
  fStride[0] = 1;
  for (let i = 1; i < nd; i++) fStride[i] = fStride[i - 1] * dims[i - 1];
  const out = new data.constructor(data.length);
  for (let c = 0; c < data.length; c++) {
    let rem = c;
    let f = 0;
    for (let d = 0; d < nd; d++) {
      const k = Math.floor(rem / cStride[d]);
      rem -= k * cStride[d];
      f += k * fStride[d];
    }
    out[c] = data[f];
  }
  return out;
}

// .npz: a ZIP of `name.npy` entries.
export function unzipNpz(buf) {
  const files = unzip(buf);
  const out = [];
  for (const [name, bytes] of files) {
    if (name.endsWith('.npy'))
      out.push({ name: name.replace(/\.npy$/, ''), ...parseNpy(toBuffer(bytes)) });
  }
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
    const v = data[i];
    if (typeof v === 'bigint' || Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (lo === Infinity) {
    lo = 0;
    hi = 1;
  } // empty or all-non-finite
  const meta = document.createElement('div');
  meta.className = 'ov-arr-meta';
  meta.textContent =
    (showName && a.name ? a.name + '  ·  ' : '') +
    `shape (${dims.join(', ')})  ·  ${descr}  ·  min ${fmt(lo)}  max ${fmt(hi)}`;
  mount.appendChild(meta);

  if (!data.length) {
    const p = document.createElement('p');
    p.className = 'ov-msg';
    p.textContent = 'Empty array.';
    mount.appendChild(p);
    return;
  }

  if (!dims.length) {
    const p = document.createElement('p');
    p.textContent = `Value: ${fmt(data[0])}`;
    mount.appendChild(p);
    return;
  }

  const rgb = dims.length === 3 && (dims[2] === 3 || dims[2] === 4);
  if (dims.length > 2 && !rgb) {
    drawSlices(a, mount, lo, hi);
    return;
  }

  drawViews(dims, descr, data, lo, hi, mount);
}

function drawSlices({ dims, descr, data }, mount, lo, hi) {
  const leading = dims.slice(0, -2);
  const shape = dims.slice(-2);
  const controls = document.createElement('div');
  const views = document.createElement('div');
  const state = { selected: 'image' };
  const inputs = leading.map((size, axis) => {
    const label = document.createElement('label');
    label.textContent = `Axis ${axis} index (0–${size - 1}): `;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = String(size - 1);
    input.value = '0';
    label.appendChild(input);
    controls.appendChild(label);
    return input;
  });
  const update = () => {
    let index = 0;
    for (let i = 0; i < inputs.length; i++) {
      const value = Number(inputs[i].value);
      if (inputs[i].value === '' || !Number.isInteger(value) || value < 0 || value >= leading[i]) {
        views.textContent = 'Choose a valid index for each axis.';
        return;
      }
      index = index * leading[i] + value;
    }
    const count = shape[0] * shape[1];
    const slice = data.subarray(index * count, (index + 1) * count);
    views.replaceChildren();
    drawViews(shape, descr, slice, lo, hi, views, state);
  };
  inputs.forEach((input) => input.addEventListener('change', update));
  mount.append(controls, views);
  update();
}

function drawViews(dims, descr, data, lo, hi, mount, state = { selected: 'image' }) {
  const image = buildImage(dims, descr, data, lo, hi);
  const numbers = buildNumbers(dims, data);
  image.style.display = state.selected === 'image' ? '' : 'none';
  numbers.style.display = state.selected === 'numbers' ? '' : 'none';

  const tabs = document.createElement('div');
  tabs.className = 'ov-arr-tabs';
  const bImg = tab('Image', state.selected === 'image');
  const bNum = tab('Numbers', state.selected === 'numbers');
  const show = (on, onBtn, off, offBtn) => {
    on.style.display = '';
    off.style.display = 'none';
    onBtn.classList.add('on');
    offBtn.classList.remove('on');
  };
  bImg.onclick = () => {
    state.selected = 'image';
    show(image, bImg, numbers, bNum);
  };
  bNum.onclick = () => {
    state.selected = 'numbers';
    show(numbers, bNum, image, bImg);
  };
  tabs.append(bImg, bNum);
  mount.append(tabs, image, numbers);
}

function tab(label, on) {
  const b = document.createElement('button');
  b.className = 'ov-arr-tab' + (on ? ' on' : '');
  b.textContent = label;
  return b;
}

function buildImage(dims, descr, data, lo, hi) {
  const isRGB = dims.length === 3 && (dims[2] === 3 || dims[2] === 4);
  const srcH = dims.length === 1 ? 1 : dims[0];
  const srcW = dims.length === 1 ? dims[0] : dims[1];
  const ds = Math.max(1, Math.ceil(Math.max(srcW, srcH) / MAX_DIM));
  const w = Math.max(1, Math.ceil(srcW / ds));
  const h = Math.max(1, Math.ceil(srcH / ds));

  const canvas = document.createElement('canvas');
  canvas.className = 'ov-arr-canvas';
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const low = Number(lo);
  const span = Number(hi) - low || 1;
  const c = isRGB ? dims[2] : 1;
  const floatRGB = isRGB && (descr.includes('f') || hi <= 1.01);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = y * ds * srcW + x * ds;
      const o = (y * w + x) * 4;
      if (isRGB) {
        const base = src * c;
        const s = floatRGB ? 255 : 1;
        img.data[o] = Number(data[base]) * s;
        img.data[o + 1] = Number(data[base + 1]) * s;
        img.data[o + 2] = Number(data[base + 2]) * s;
        img.data[o + 3] = c === 4 ? Number(data[base + 3]) * s : 255;
      } else {
        const [r, g, bl] = colormap((Number(data[src]) - low) / span);
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = bl;
        img.data[o + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  canvas.style.width = Math.min(Math.max(w, 240), 900) + 'px';
  canvas.style.imageRendering = w < 200 ? 'pixelated' : 'auto';
  return canvas;
}

function buildNumbers(dims, data) {
  const nd = dims.length;
  const H = nd === 1 ? 1 : dims[0];
  const W = nd === 1 ? dims[0] : dims[1];
  const C = nd === 3 ? dims[2] : 1;
  const CAP = 100;
  const rows = Math.min(H, CAP);
  const cols = Math.min(W, CAP);

  const box = document.createElement('div');
  if (H > rows || W > cols) {
    const note = document.createElement('div');
    note.className = 'ov-arr-meta';
    note.textContent = `showing first ${rows} × ${cols} of ${H} × ${W}`;
    box.appendChild(note);
  }
  const scroll = document.createElement('div');
  scroll.className = 'ov-tbl-scroll';
  const table = document.createElement('table');
  table.className = 'ov-tbl';
  const head = table.createTHead().insertRow();
  head.insertCell();
  for (let x = 0; x < cols; x++) head.insertCell().textContent = x;
  const body = table.createTBody();
  for (let y = 0; y < rows; y++) {
    const tr = body.insertRow();
    const ri = tr.insertCell();
    ri.textContent = y;
    ri.className = 'ov-tbl-idx';
    for (let x = 0; x < cols; x++) {
      const base = (y * W + x) * C;
      tr.insertCell().textContent =
        C === 1
          ? fmt(data[base])
          : Array.from({ length: C }, (_, k) => fmt(data[base + k])).join(', ');
    }
  }
  scroll.appendChild(table);
  box.appendChild(scroll);
  return box;
}

function fmt(v) {
  if (typeof v === 'bigint') return v.toString();
  if (!isFinite(v)) return String(v);
  return Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)
    ? v.toExponential(2)
    : +v.toFixed(3);
}
