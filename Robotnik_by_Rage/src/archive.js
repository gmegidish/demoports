// The data files appended to ROBOTNIK.EXE behind the DOS/4GW program.
// The last dword of the file is the size of a directory that ends the file: 26-byte entries of
// name (13 bytes), method (1 byte), size, offset counted back from the end of the file, packed size.
// Method 0 is stored, method 1 is the LZSS of the compression library at 0x4a360 (init 0x550f0,
// decode 0x5528c): a flag byte per 8 items, LSB first; a set bit is a big-endian word w that copies
// (w >> 12) + 2 bytes from (w & 0xfff) + 1 bytes back, a clear bit is a literal byte.

const ENTRY_SIZE = 26;
const METHOD_STORED = 0;
const METHOD_LZSS = 1;

export function readDirectory(exe) {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const dirSize = view.getUint32(exe.length - 4, true);
  const dirStart = exe.length - dirSize;
  const files = new Map();
  for (let at = dirStart; at + ENTRY_SIZE <= exe.length - 4; at += ENTRY_SIZE) {
    const nameBytes = exe.subarray(at, at + 13);
    const name = String.fromCharCode(...nameBytes.subarray(0, nameBytes.indexOf(0)));
    files.set(name, {
      name,
      method: exe[at + 13],
      size: view.getUint32(at + 14, true),
      offset: exe.length - view.getUint32(at + 18, true),
      packedSize: view.getUint32(at + 22, true),
    });
  }
  return files;
}

export function unpackLzss(src, size) {
  const out = new Uint8Array(size);
  let s = 0;
  let d = 0;
  let flags = 0;
  let bit = 8;
  while (d < size) {
    if (bit === 8) {
      flags = src[s++];
      bit = 0;
    }
    if (flags & (1 << bit)) {
      const w = (src[s] << 8) | src[s + 1];
      s += 2;
      let from = d - (w & 0xfff) - 1;
      for (let n = (w >> 12) + 2; n > 0 && d < size; n--) {
        out[d++] = out[from++];
      }
    } else {
      out[d++] = src[s++];
    }
    bit++;
  }
  return out;
}

export function openArchive(exe) {
  const files = readDirectory(exe);
  return {
    files,
    read(name) {
      const f = files.get(name);
      if (!f) {
        throw new Error(`no file ${name} in ROBOTNIK.EXE`);
      }
      const packed = exe.subarray(f.offset, f.offset + f.packedSize);
      if (f.method === METHOD_STORED) {
        return packed.slice(0, f.size);
      }
      if (f.method === METHOD_LZSS) {
        return unpackLzss(packed, f.size);
      }
      throw new Error(`${name}: unknown method ${f.method}`);
    },
  };
}
