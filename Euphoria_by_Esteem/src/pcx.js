// 8-bit PCX (version 5, RLE) as shipped inside EUPHORIA.EXE.
const PCX_HEADER_SIZE = 128;
const PCX_PALETTE_SIZE = 768;

/** Decodes to { width, height, pixels (palette indices), palette (768 bytes, 8-bit as stored) }. */
export function decodePcx(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(8, true) - view.getUint16(4, true) + 1;
  const height = view.getUint16(10, true) - view.getUint16(6, true) + 1;
  const bytesPerLine = view.getUint16(66, true);
  const pixels = new Uint8Array(width * height);
  let src = PCX_HEADER_SIZE;
  const line = new Uint8Array(bytesPerLine);
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < bytesPerLine) {
      let value = bytes[src++];
      let count = 1;
      if ((value & 0xc0) === 0xc0) {
        count = value & 0x3f;
        value = bytes[src++];
      }
      while (count-- > 0 && x < bytesPerLine) {
        line[x++] = value;
      }
    }
    pixels.set(line.subarray(0, width), y * width);
  }
  const palette = bytes.slice(bytes.length - PCX_PALETTE_SIZE);
  return { width, height, pixels, palette };
}
