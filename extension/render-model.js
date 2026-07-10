// octoview model renderer, lazy-imported inline for .safetensors/.gguf. Both keep
// a structured header at the front of the file, so a pure-JS parse (no workers,
// WebKit safe) yields the useful preview GitHub cannot: the tensor list (name,
// dtype, shape, params) and the metadata. No Netron: it relies on workers.

const GGML_TYPES = {
  0: 'F32',
  1: 'F16',
  2: 'Q4_0',
  3: 'Q4_1',
  6: 'Q5_0',
  7: 'Q5_1',
  8: 'Q8_0',
  9: 'Q8_1',
  10: 'Q2_K',
  11: 'Q3_K',
  12: 'Q4_K',
  13: 'Q5_K',
  14: 'Q6_K',
  15: 'Q8_K',
  16: 'IQ2_XXS',
  17: 'IQ2_XS',
  20: 'IQ4_NL',
  28: 'BF16',
};

export function renderModel(buf, mount, ext) {
  mount.textContent = '';
  try {
    const model = ext === '.gguf' ? parseGguf(buf) : parseSafetensors(buf);
    draw(model, mount);
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'ov-msg';
    p.textContent = 'Model preview failed: ' + ((e && e.message) || e);
    mount.appendChild(p);
  }
}

export function parseSafetensors(buf) {
  const dv = new DataView(buf);
  const n = Number(dv.getBigUint64(0, true));
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n)));
  const meta = header.__metadata__ || {};
  const tensors = [];
  for (const [name, t] of Object.entries(header)) {
    if (name === '__metadata__') continue;
    tensors.push({ name, dtype: t.dtype, shape: t.shape || [] });
  }
  return { format: 'safetensors', meta, tensors };
}

// GGUF v2/v3: uint64 counts/lengths, little-endian typed metadata KVs.
class Reader {
  constructor(buf) {
    this.dv = new DataView(buf);
    this.u8 = new Uint8Array(buf);
    this.p = 0;
  }
  u32() {
    const v = this.dv.getUint32(this.p, true);
    this.p += 4;
    return v;
  }
  u64() {
    const v = Number(this.dv.getBigUint64(this.p, true));
    this.p += 8;
    return v;
  }
  str() {
    const n = this.u64();
    const s = new TextDecoder().decode(this.u8.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
  value(type) {
    const dv = this.dv;
    const p = this.p;
    switch (type) {
      case 0:
        this.p += 1;
        return this.u8[p];
      case 1:
        this.p += 1;
        return dv.getInt8(p);
      case 2:
        this.p += 2;
        return dv.getUint16(p, true);
      case 3:
        this.p += 2;
        return dv.getInt16(p, true);
      case 4:
        this.p += 4;
        return dv.getUint32(p, true);
      case 5:
        this.p += 4;
        return dv.getInt32(p, true);
      case 6:
        this.p += 4;
        return dv.getFloat32(p, true);
      case 7:
        this.p += 1;
        return this.u8[p] !== 0;
      case 8:
        return this.str();
      case 9: {
        // Metadata arrays can be huge (a tokenizer vocab is 100k+ entries). Keep a
        // small sample for display and skip the rest so we stay aligned without
        // allocating the whole thing.
        const et = this.u32();
        const n = this.u64();
        const CAP = 64;
        const items = [];
        const m = Math.min(n, CAP);
        for (let i = 0; i < m; i++) items.push(this.value(et));
        for (let i = m; i < n; i++) this.skip(et);
        return { type: 'array', n, items };
      }
      case 10:
        this.p += 8;
        return Number(dv.getBigUint64(p, true));
      case 11:
        this.p += 8;
        return Number(dv.getBigInt64(p, true));
      case 12:
        this.p += 8;
        return dv.getFloat64(p, true);
      default:
        throw new Error('bad gguf value type ' + type);
    }
  }
  // Advance past a value without allocating it (used to skip long array tails).
  skip(type) {
    const FIXED = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
    if (type === 8) {
      this.p += this.u64();
    } else if (type === 9) {
      const et = this.u32();
      const n = this.u64();
      for (let i = 0; i < n; i++) this.skip(et);
    } else {
      this.p += FIXED[type];
    }
  }
}

export function parseGguf(buf) {
  const r = new Reader(buf);
  if (r.u32() !== 0x46554747) throw new Error('not a GGUF file');
  const version = r.u32();
  if (version < 2) throw new Error('GGUF v' + version + ' unsupported');
  const tensorCount = r.u64();
  const kvCount = r.u64();
  const meta = {};
  for (let i = 0; i < kvCount; i++) {
    const key = r.str();
    const type = r.u32();
    meta[key] = r.value(type);
  }
  const tensors = [];
  for (let i = 0; i < tensorCount; i++) {
    const name = r.str();
    const nDims = r.u32();
    const shape = [];
    for (let d = 0; d < nDims; d++) shape.push(r.u64());
    const type = r.u32();
    r.u64(); // data offset, unused for the preview
    tensors.push({ name, dtype: GGML_TYPES[type] || 'type ' + type, shape });
  }
  return { format: 'GGUF v' + version, meta, tensors };
}

function draw(model, mount) {
  const params = model.tensors.reduce((a, t) => a + t.shape.reduce((x, d) => x * d, 1), 0);
  const info = document.createElement('div');
  info.className = 'ov-mdl-meta';
  info.textContent = `${model.format}  ·  ${model.tensors.length} tensors  ·  ${humanParams(params)} params`;
  mount.appendChild(info);

  const metaEntries = Object.entries(model.meta);
  if (metaEntries.length) {
    const kv = document.createElement('table');
    kv.className = 'ov-tbl';
    for (const [k, v] of metaEntries) {
      const tr = kv.insertRow();
      tr.insertCell().textContent = k;
      tr.insertCell().textContent = short(v);
    }
    const wrap = section('metadata', kv);
    mount.appendChild(wrap);
  }

  const tt = document.createElement('table');
  tt.className = 'ov-tbl';
  const head = tt.createTHead().insertRow();
  ['tensor', 'dtype', 'shape', 'params'].forEach((h) => (head.insertCell().textContent = h));
  const body = tt.createTBody();
  for (const t of model.tensors) {
    const tr = body.insertRow();
    tr.insertCell().textContent = t.name;
    tr.insertCell().textContent = t.dtype;
    tr.insertCell().textContent = '[' + t.shape.join(', ') + ']';
    const pc = tr.insertCell();
    pc.textContent = humanParams(t.shape.reduce((x, d) => x * d, 1));
    pc.className = 'ov-tbl-idx';
  }
  mount.appendChild(section(`tensors (${model.tensors.length})`, tt));
}

function section(title, table) {
  const wrap = document.createElement('div');
  const h = document.createElement('div');
  h.className = 'ov-mdl-h';
  h.textContent = title;
  const scroll = document.createElement('div');
  scroll.className = 'ov-tbl-scroll';
  scroll.appendChild(table);
  wrap.append(h, scroll);
  return wrap;
}

function humanParams(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function short(v) {
  if (v && typeof v === 'object' && v.type === 'array')
    return `[${v.n}] ` + v.items.slice(0, 6).join(', ') + (v.n > 6 ? ' …' : '');
  const s = String(v);
  return s.length > 120 ? s.slice(0, 120) + ' …' : s;
}
