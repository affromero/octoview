// Adversarial-input tests for the DoS hardening and URL sanitizer from the
// security audit: crafted files must THROW quickly, never hang or OOM the tab.
import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import { parseGguf } from '../extension/render-model.js';
import { parseSpz, parseSog, parseLcc } from '../extension/splat-decode.js';

const u8 = (arr) => new Uint8Array(arr).buffer;

describe('parser DoS hardening', () => {
  it('GGUF: a metadata array with a huge count throws instead of spinning', () => {
    // GGUF, v3, tensorCount=0, kvCount=1; one KV whose value is a fixed-type
    // array of ~2^53 elements. The old skip loop advanced a pointer that many
    // times with no read → infinite main-thread hang.
    const b = [];
    const push32 = (v) => b.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
    const push64 = (lo, hi = 0) => {
      push32(lo);
      push32(hi);
    };
    b.push(0x47, 0x47, 0x55, 0x46); // "GGUF"
    push32(3); // version
    push64(0); // tensorCount
    push64(1); // kvCount
    push64(0); // key length 0
    push32(9); // value type = array
    push32(6); // elem type = f32 (fixed width, no per-element read)
    push64(0xffffffff, 0x001fffff); // n ~ 2^53
    const t0 = Date.now();
    expect(() => parseGguf(u8(b))).toThrow();
    expect(Date.now() - t0).toBeLessThan(1000); // fails fast, no hang
  });

  it('SPZ v4: a header declaring too many points is rejected before allocating', () => {
    const b = new Uint8Array(64);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, 0x5053474e, true); // NGSP
    dv.setUint32(4, 4, true); // version 4
    dv.setUint32(8, 0x0fffffff, true); // total ~2.7e8 -> positions ~2.4GB
    expect(() => parseSpz(b.buffer)).toThrow(/too many points/);
  });

  it('ONNX: a run of varint continuation bytes throws instead of blowing up BigInt', async () => {
    const { parseOnnx } = await import('../extension/render-onnx.js');
    const bomb = new Uint8Array(4096).fill(0xff); // never-terminating varint
    const t0 = Date.now();
    expect(() => parseOnnx(bomb.buffer)).toThrow();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('LCC: overlapping index records that sum past data.bin are rejected', () => {
    const meta = new TextEncoder().encode(
      JSON.stringify({
        totalLevel: 1,
        splats: [{}],
        attributes: [{ name: 'scale', min: [0, 0, 0], max: [1, 1, 1] }],
      })
    );
    // data.bin holds 2 splats (64 bytes); two index units each claim both, at
    // the same offset — summed count 4 > 2, so it must throw, not allocate.
    const data = new Uint8Array(64);
    const stride = 4 + 1 * 16; // 20
    const index = new Uint8Array(2 * stride);
    const dv = new DataView(index.buffer);
    for (let u = 0; u < 2; u++) {
      const o = u * stride + 4;
      dv.setInt32(o, 2, true); // count = 2
      dv.setBigInt64(o + 4, 0n, true); // dataOffset = 0 (overlap)
      dv.setInt32(o + 12, 64, true); // size >= count*32
    }
    expect(() => parseLcc(meta, index, data)).toThrow(/more splats than data\.bin/);
  });

  it('SOG: a count larger than the data images is rejected, not read OOB', async () => {
    const meta = {
      version: 2,
      count: 1000, // lies: the images below hold only 1 texel
      means: { mins: [0, 0, 0], maxs: [1, 1, 1], files: ['means_l.webp', 'means_u.webp'] },
      scales: { codebook: [0], files: ['scales.webp'] },
      sh0: { codebook: [0], files: ['sh0.webp'] },
    };
    const one = new Uint8Array(4); // one RGBA texel
    const zip = zipSync({
      'meta.json': new TextEncoder().encode(JSON.stringify(meta)),
      'means_l.webp': one,
      'means_u.webp': one,
      'scales.webp': one,
      'sh0.webp': one,
    });
    const decodeImage = async (bytes) => ({
      data: new Uint8ClampedArray(bytes),
      width: 1,
      height: 1,
    });
    await expect(parseSog(zip.buffer, decodeImage)).rejects.toThrow(/smaller than count/);
  });
});

describe('sanitize() scheme check blocks obfuscated dangerous URLs', () => {
  // Mirror core.js sanitize()'s normalize-then-scheme-test on href values.
  // eslint-disable-next-line no-control-regex -- stripping C0 control chars is the intent
  const CONTROL = /[\u0000-\u0020]+/g;
  const isDangerous = (raw) =>
    /^(javascript|data|vbscript):/.test(raw.replace(CONTROL, '').toLowerCase());
  const TAB = String.fromCharCode(9);
  const NUL1 = String.fromCharCode(1);

  it('flags control-char-prefixed and whitespace-split dangerous schemes', () => {
    expect(isDangerous('javascript:alert(1)')).toBe(true);
    expect(isDangerous('java' + TAB + 'script:alert(1)')).toBe(true);
    expect(isDangerous(NUL1 + 'javascript:alert(1)')).toBe(true); // C0-prefixed bypass
    expect(isDangerous('JAVASCRIPT:alert(1)')).toBe(true);
    expect(isDangerous('data:text/html,x')).toBe(true);
    expect(isDangerous('vbscript:msgbox')).toBe(true);
    expect(isDangerous('https://github.com/ok')).toBe(false);
    expect(isDangerous('#anchor')).toBe(false);
  });
});
