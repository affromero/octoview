// Generic ZIP reader used by the .npz and .splattie renderers. Uses fflate's
// pure-JS unzipSync (no Worker, no DecompressionStream) so it is WebKit safe on
// every Safari version and handles store, deflate, data descriptors and ZIP64.
import { unzipSync } from './vendor/fflate.esm.js';

const CAP = 64 * 1024 * 1024; // refuse if a single entry, or the total, inflates past 64 MiB

// Returns a name -> Uint8Array map of the ZIP's entries.
export function unzip(buf) {
  let total = 0;
  const files = unzipSync(new Uint8Array(buf), {
    filter: (f) => {
      total += f.originalSize;
      if (f.originalSize > CAP || total > CAP) throw new Error('zip too large to preview');
      return true;
    },
  });
  return new Map(Object.entries(files));
}

// Turn a Uint8Array view into a standalone ArrayBuffer (parsers take an
// ArrayBuffer whose offset 0 is the start of the file).
export function toBuffer(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}
