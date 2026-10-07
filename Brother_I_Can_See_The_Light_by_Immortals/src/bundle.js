// The files bound into BROTHER.EXE. A PKLITE-packed DOS loader at the front of the file hooks
// int 21h and serves file opens from a table that follows its own image (see tools/re/extract.py):
// an 'XL' header, then 32-byte entries scrambled by subtracting each byte's index.
// Opens match on the basename, case-insensitively, so 'TEXTURES\SEA.GIF' opens SEA.GIF.

const ENTRY_BYTES = 32;
const NAME_BYTES = 16;

/**
 * @param {Uint8Array} exe the whole of BROTHER.EXE
 * @returns {Map<string, Uint8Array>} upper-case basename -> file contents (views into exe)
 */
export function readBundle(exe) {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const lastPageBytes = view.getUint16(2, true);
  const pages = view.getUint16(4, true);
  const base = (pages - 1) * 512 + lastPageBytes; // end of the loader's own MZ image
  if (exe[base] !== 0x58 || exe[base + 1] !== 0x4c) {
    throw new Error('BROTHER.EXE: no XL file table');
  }
  const count = view.getUint16(base + 8, true);
  const tableAt = base + view.getUint32(base + 12, true);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const entry = new Uint8Array(ENTRY_BYTES);
    for (let k = 0; k < ENTRY_BYTES; k++) {
      const index = i * ENTRY_BYTES + k;
      entry[k] = (exe[tableAt + index] - index) & 0xff;
    }
    const nameEnd = entry.indexOf(0);
    const name = String.fromCharCode(...entry.subarray(0, nameEnd < 0 || nameEnd > NAME_BYTES ? NAME_BYTES : nameEnd));
    const entryView = new DataView(entry.buffer);
    const size = entryView.getUint32(16, true);
    const offset = base + entryView.getUint32(20, true);
    files.set(name.toUpperCase(), exe.subarray(offset, offset + size));
  }
  return files;
}

/** @returns {{read: (name: string) => Uint8Array}} */
export function createAssets(files) {
  return {
    read(name) {
      const basename = name.split(/[\\/:]/).pop().toUpperCase();
      const bytes = files.get(basename);
      if (!bytes) {
        throw new Error(`Unable to load file : ${name}`);
      }
      return bytes;
    },
  };
}
