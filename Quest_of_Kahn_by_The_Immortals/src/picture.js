// The demo's picture loader goes by content, not by extension: two of its ".GIF" textures are PCX files.
import { decodeGif } from './gif.js';

const PCX_MANUFACTURER = 0x0a;
const PCX_HEADER_BYTES = 128;
const PCX_PALETTE_MARKER = 0x0c;
const PCX_RUN_FLAG = 0xc0;
const PALETTE_BYTES = 768;

function readU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

/** 8-bit, single-plane, run-length-encoded PCX with a 256-colour palette at the end of the file. */
function decodePcx(bytes) {
  const bitsPerPixel = bytes[3];
  const planes = bytes[65];
  if (bitsPerPixel !== 8 || planes !== 1) {
    throw new Error(`PCX: only 8-bit single-plane pictures are supported (got ${bitsPerPixel} bits, ${planes} planes)`);
  }
  const width = readU16(bytes, 8) - readU16(bytes, 4) + 1;
  const height = readU16(bytes, 10) - readU16(bytes, 6) + 1;
  const bytesPerLine = readU16(bytes, 66);

  // Runs are decoded a scanline at a time; a line may be padded past the picture's width.
  const pixels = new Uint8Array(width * height);
  const line = new Uint8Array(bytesPerLine);
  let at = PCX_HEADER_BYTES;
  for (let row = 0; row < height; row++) {
    let filled = 0;
    while (filled < bytesPerLine) {
      let value = bytes[at++];
      let count = 1;
      if ((value & PCX_RUN_FLAG) === PCX_RUN_FLAG) {
        count = value & ~PCX_RUN_FLAG;
        value = bytes[at++];
      }
      line.fill(value, filled, filled + count);
      filled += count;
    }
    pixels.set(line.subarray(0, width), row * width);
  }

  const paletteAt = bytes.length - PALETTE_BYTES;
  if (bytes[paletteAt - 1] !== PCX_PALETTE_MARKER) {
    throw new Error('PCX: no 256-colour palette at the end of the file');
  }
  const palette = bytes.slice(paletteAt, paletteAt + PALETTE_BYTES);
  return { width, height, pixels, palette };
}

/**
 * @param {Uint8Array} bytes a whole picture file, GIF or PCX
 * @returns {{width: number, height: number, pixels: Uint8Array, palette: Uint8Array}}
 *   pixels are palette indices; palette is 256 RGB triplets, 8 bits each
 */
export function decodePicture(bytes) {
  if (bytes[0] === PCX_MANUFACTURER) {
    return decodePcx(bytes);
  }
  return decodeGif(bytes);
}
