// Comprehensive unit tests for the pure binary parsers (no three.js, no canvas):
// assert the ACTUAL decoded values, endianness, ordering, bounds, and the
// large-file guards, plus round-trips against the committed sample fixtures.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseNpy, unzipNpz, colormap } from '../extension/render-array.js';
import { parseSafetensors, parseGguf } from '../extension/render-model.js';
import {
  parseSplatBin,
  parsePlySplat,
  isPlySplat,
  parseSplattie,
} from '../extension/splat-decode.js';
import { unzip } from '../extension/unzip.js';

const fixture = (name) => {
  const b = readFileSync(new URL('../samples/' + name, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

// Build a NumPy v1.0 .npy from a flat JS array of numbers.
function makeNpy(descr, shape, flat, fortran = false) {
  const SIZE = { f4: 4, f8: 8, i4: 4, i2: 2, u1: 1, u2: 2 };
  const size = SIZE[descr.slice(1)];
  const dict = `{'descr': '${descr}', 'fortran_order': ${fortran ? 'True' : 'False'}, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
  let pad = 64 - ((10 + dict.length + 1) % 64);
  if (pad === 64) pad = 0;
  const header = dict + ' '.repeat(pad) + '\n';
  const buf = new ArrayBuffer(10 + header.length + flat.length * size);
  const b = new Uint8Array(buf);
  b[0] = 0x93;
  b.set([0x4e, 0x55, 0x4d, 0x50, 0x59], 1); // NUMPY
  b[6] = 1;
  const dv = new DataView(buf);
  dv.setUint16(8, header.length, true);
  b.set(new TextEncoder().encode(header), 10);
  const little = descr[0] !== '>';
  const base = 10 + header.length;
  const put = {
    f4: 'setFloat32',
    f8: 'setFloat64',
    i4: 'setInt32',
    i2: 'setInt16',
    u1: 'setUint8',
    u2: 'setUint16',
  }[descr.slice(1)];
  flat.forEach((v, i) => dv[put](base + i * size, v, little));
  return buf;
}

describe('parseNpy', () => {
  it('reads a 2D little-endian float32 array row-major', () => {
    const { dims, descr, data } = parseNpy(makeNpy('<f4', [2, 3], [1, 2, 3, 4, 5, 6]));
    expect(dims).toEqual([2, 3]);
    expect(descr).toBe('<f4');
    expect([...data]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('reads float64, int32, and uint8 dtypes', () => {
    expect([...parseNpy(makeNpy('<f8', [2], [0.5, -1.5])).data]).toEqual([0.5, -1.5]);
    expect([...parseNpy(makeNpy('<i4', [3], [-7, 0, 2000000])).data]).toEqual([-7, 0, 2000000]);
    expect([...parseNpy(makeNpy('|u1', [3], [0, 128, 255])).data]).toEqual([0, 128, 255]);
  });

  it('honors big-endian byte order', () => {
    const { data } = parseNpy(makeNpy('>f4', [3], [1.25, 2.5, -3.75]));
    expect([...data]).toEqual([1.25, 2.5, -3.75]);
  });

  it('transposes Fortran (column-major) order to C for 2D', () => {
    // Column-major storage of [[1,2,3],[4,5,6]] is 1,4,2,5,3,6.
    const { data } = parseNpy(makeNpy('<f4', [2, 3], [1, 4, 2, 5, 3, 6], true));
    expect([...data]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('transposes Fortran order for 3D', () => {
    // C-order values 0..7 for shape (2,2,2); stored column-major.
    const c = [0, 1, 2, 3, 4, 5, 6, 7];
    const dims = [2, 2, 2];
    // Build the Fortran (column-major) storage from the C values.
    const f = new Array(8);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++)
        for (let k = 0; k < 2; k++) f[i + 2 * j + 4 * k] = c[i * 4 + j * 2 + k];
    const { data } = parseNpy(makeNpy('<f4', dims, f, true));
    expect([...data]).toEqual(c);
  });

  it('throws on a bad magic and on truncated data', () => {
    expect(() => parseNpy(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toThrow(/not a .npy/);
    const good = makeNpy('<f4', [4], [1, 2, 3, 4]);
    expect(() => parseNpy(good.slice(0, good.byteLength - 4))).toThrow(/truncated/);
  });

  it('round-trips the numpy-written sample fixture', () => {
    const { dims, descr } = parseNpy(fixture('array.npy'));
    expect(dims).toEqual([120, 180]);
    expect(descr).toBe('<f4');
  });
});

describe('unzipNpz / unzip', () => {
  it('extracts and parses every array in a compressed .npz', async () => {
    const arrays = await unzipNpz(fixture('array.npz'));
    const byName = Object.fromEntries(arrays.map((a) => [a.name, a]));
    expect(byName.field.dims).toEqual([64, 96]);
    expect(byName.signal.dims).toEqual([240]);
  });

  it('inflates DEFLATE zip entries (fflate) for a .splattie bundle', () => {
    const files = unzip(fixture('head.splattie'));
    expect(files.has('manifest.json')).toBe(true);
    expect(files.has('splat.ply')).toBe(true);
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
    expect(manifest.format).toBe('splattie');
  });
});

describe('colormap', () => {
  it('spans the viridis endpoints and clamps out-of-range input', () => {
    expect(colormap(0).map(Math.round)).toEqual([68, 1, 84]);
    expect(colormap(1).map(Math.round)).toEqual([253, 231, 37]);
    expect(colormap(-5)).toEqual(colormap(0));
    expect(colormap(9)).toEqual(colormap(1));
  });

  it('maps non-finite input to a safe color (all-NaN arrays do not throw)', () => {
    expect(colormap(NaN)).toEqual(colormap(0));
    expect(colormap(Infinity)).toEqual(colormap(0));
  });
});

describe('parseSafetensors', () => {
  it('reads the tensor list, shapes and metadata from the fixture', () => {
    const { format, tensors, meta } = parseSafetensors(fixture('model.safetensors'));
    expect(format).toBe('safetensors');
    expect(tensors).toHaveLength(4);
    const embed = tensors.find((t) => t.name === 'model.embed_tokens.weight');
    expect(embed.dtype).toBe('F32');
    expect(embed.shape).toEqual([512, 64]);
    expect(meta.producer).toBe('octoview-sample');
  });

  it('throws on a truncated header', () => {
    const buf = fixture('model.safetensors');
    expect(() => parseSafetensors(buf.slice(0, 12))).toThrow();
  });
});

describe('parseGguf', () => {
  it('reads version, metadata and tensor infos from the fixture', () => {
    const { format, meta, tensors } = parseGguf(fixture('model.gguf'));
    expect(format).toBe('GGUF v3');
    expect(meta['general.architecture']).toBe('llama');
    expect(meta['llama.context_length']).toBe(4096);
    expect(tensors.map((t) => t.name)).toContain('token_embd.weight');
    expect(tensors.find((t) => t.name === 'blk.0.attn_q.weight').dtype).toBe('Q8_0');
  });

  it('caps a huge metadata array but stays byte-aligned for later keys', () => {
    // magic, v3, 0 tensors, 2 KVs: a 200-int32 array then a string. If the array
    // skip is misaligned, the trailing string key/value will be garbage.
    const parts = [];
    const enc = new TextEncoder();
    const u32 = (v) => {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setUint32(0, v, true);
      parts.push(b);
    };
    const u64 = (v) => {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
      parts.push(b);
    };
    const gstr = (s) => {
      const e = enc.encode(s);
      u64(e.length);
      parts.push(e);
    };
    parts.push(enc.encode('GGUF'));
    u32(3);
    u64(0);
    u64(2);
    gstr('big.array');
    u32(9);
    u32(5);
    u64(200); // key, type=array, elem=int32, n=200
    for (let i = 0; i < 200; i++) u32(i);
    gstr('trailer');
    u32(8);
    gstr('ok'); // key, type=string, value
    const total = parts.reduce((a, p) => a + p.length, 0);
    const buf = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      buf.set(p, o);
      o += p.length;
    }
    const { meta } = parseGguf(buf.buffer);
    expect(meta['big.array'].n).toBe(200);
    expect(meta['big.array'].items).toHaveLength(64);
    expect(meta.trailer).toBe('ok'); // proves the array tail was skipped, not misread
  });

  it('throws on a non-GGUF buffer', () => {
    expect(() => parseGguf(new TextEncoder().encode('NOPE....').buffer)).toThrow(/not a GGUF/);
  });
});

describe('splat decoders', () => {
  it('parses antimatter15 .splat records', () => {
    const buf = new ArrayBuffer(64); // two splats
    const dv = new DataView(buf);
    dv.setFloat32(0, 1, true);
    dv.setFloat32(4, 2, true);
    dv.setFloat32(8, 3, true);
    dv.setFloat32(12, 0.1, true);
    dv.setFloat32(16, 0.1, true);
    dv.setFloat32(20, 0.1, true);
    dv.setUint8(24, 255);
    dv.setUint8(25, 0);
    dv.setUint8(26, 0);
    dv.setUint8(27, 128);
    const s = parseSplatBin(buf);
    expect(s.count).toBe(2);
    expect([s.pos[0], s.pos[1], s.pos[2]]).toEqual([1, 2, 3]);
    expect(s.col[0]).toBeCloseTo(1);
    expect(s.col[3]).toBeCloseTo(128 / 255);
  });

  it('detects a 3DGS ply vs a plain ply, and decodes the real head capture', () => {
    const splatPly = fixture('splat.ply');
    const pointPly = fixture('points.ply');
    expect(isPlySplat(splatPly)).toBe(true);
    expect(isPlySplat(pointPly)).toBe(false);
    const s = parsePlySplat(splatPly);
    expect(s.count).toBe(20018);
    // colors are sigmoid/SH-decoded into [0,1]
    for (let i = 0; i < s.col.length; i++) expect(s.col[i]).toBeGreaterThanOrEqual(0);
  });

  it('computes the data offset from bytes, not string length (multibyte header)', () => {
    // A non-ASCII comment makes the byte length exceed the string length; a
    // string-index offset would read the first vertex from the wrong place.
    const ply = makePlySplat([{ x: 1, y: 2, z: 3 }], 'café résumé señor');
    const s = parsePlySplat(ply);
    expect([s.pos[0], s.pos[1], s.pos[2]]).toEqual([1, 2, 3]);
  });

  it('does not treat a plain ply as a splat just because a comment names the fields', () => {
    const header =
      'ply\nformat binary_little_endian 1.0\ncomment f_dc_0 scale_0 rot_0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n';
    const buf = new Uint8Array(header.length + 12);
    buf.set(new TextEncoder().encode(header), 0);
    expect(isPlySplat(buf.buffer)).toBe(false);
  });

  it('rejects an ASCII ply', () => {
    const ascii = new TextEncoder().encode(
      'ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float f_dc_0\nproperty float scale_0\nproperty float rot_0\nend_header\n0 0 0 0\n'
    );
    expect(() => parsePlySplat(ascii.buffer)).toThrow(/ASCII/);
  });

  it('unzips a .splattie bundle and renders its base ply', async () => {
    const s = await parseSplattie(fixture('head.splattie'));
    expect(s.count).toBe(20018);
  });
});

// Build a tiny binary 3DGS ply from vertex records (float props), optional comment.
function makePlySplat(verts, comment) {
  const props = [
    'x',
    'y',
    'z',
    'f_dc_0',
    'f_dc_1',
    'f_dc_2',
    'opacity',
    'scale_0',
    'scale_1',
    'scale_2',
    'rot_0',
    'rot_1',
    'rot_2',
    'rot_3',
  ];
  const headerStr =
    'ply\nformat binary_little_endian 1.0\n' +
    (comment ? `comment ${comment}\n` : '') +
    `element vertex ${verts.length}\n` +
    props.map((p) => `property float ${p}`).join('\n') +
    '\nend_header\n';
  const head = new TextEncoder().encode(headerStr);
  const body = new ArrayBuffer(verts.length * props.length * 4);
  const dv = new DataView(body);
  verts.forEach((v, i) =>
    props.forEach((p, k) => dv.setFloat32((i * props.length + k) * 4, v[p] || 0, true))
  );
  const out = new Uint8Array(head.length + body.byteLength);
  out.set(head, 0);
  out.set(new Uint8Array(body), head.length);
  return out.buffer;
}
