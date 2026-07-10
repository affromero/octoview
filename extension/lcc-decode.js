// XGRIDS LCC v1 decoder. An LCC scene is a metadata file accompanied by
// index.bin and data.bin (plus optional shcoef.bin/environment.bin). The preview
// uses the base colour and scale data from every LOD; SH is intentionally left to
// full LCC viewers because the lightweight renderer has no SH shader.
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

  const index = view(indexBytes);
  const stride = 4 + meta.totalLevel * 16;
  if (index.byteLength % stride) throw new Error('invalid LCC index.bin length');
  const units = index.byteLength / stride;
  const records = [];
  for (let unit = 0; unit < units; unit++) {
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

  const count = records.reduce((total, record) => total + record.count, 0);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  const size = new Float32Array(count);
  const data = view(dataBytes);
  let out = 0;
  for (const record of records) {
    for (let i = 0; i < record.count; i++, out++) {
      const offset = record.dataOffset + i * 32;
      pos[out * 3] = data.getFloat32(offset, true);
      pos[out * 3 + 1] = data.getFloat32(offset + 4, true);
      pos[out * 3 + 2] = data.getFloat32(offset + 8, true);
      col[out * 4] = data.getUint8(offset + 12) / 255;
      col[out * 4 + 1] = data.getUint8(offset + 13) / 255;
      col[out * 4 + 2] = data.getUint8(offset + 14) / 255;
      col[out * 4 + 3] = data.getUint8(offset + 15) / 255;
      const sx = lerp(
        scale.scale.min[0],
        scale.scale.max[0],
        data.getUint16(offset + 16, true) / 65535
      );
      const sy = lerp(
        scale.scale.min[1],
        scale.scale.max[1],
        data.getUint16(offset + 18, true) / 65535
      );
      const sz = lerp(
        scale.scale.min[2],
        scale.scale.max[2],
        data.getUint16(offset + 20, true) / 65535
      );
      size[out] = Math.max(Math.exp(sx), Math.exp(sy), Math.exp(sz));
    }
  }
  return { count, pos, col, size };
}

function lerp(min, max, t) {
  return min + (max - min) * t;
}

function bytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function view(value) {
  return new DataView(value.buffer, value.byteOffset, value.byteLength);
}
