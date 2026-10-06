// GIF87a decoder: first image only, which is all the demo's textures ever contain.
// Returns palette indices, not colours: the demo is 8-bit and does its own palette work.

const HEADER_BYTES = 13;
const IMAGE_SEPARATOR = 0x2c;
const EXTENSION_INTRODUCER = 0x21;
const TRAILER = 0x3b;
const MAX_CODE_BITS = 12;
const MAX_CODES = 1 << MAX_CODE_BITS;
const PALETTE_BYTES = 768;

/** Rows of an interlaced GIF arrive in four passes: every 8th from 0, every 8th from 4, every 4th from 2, every 2nd from 1. */
const INTERLACE_PASSES = [[0, 8], [4, 8], [2, 4], [1, 2]];

function readPalette(bytes, offset, entries) {
  const palette = new Uint8Array(PALETTE_BYTES);
  palette.set(bytes.subarray(offset, offset + entries * 3));
  return palette;
}

/** Image data is a chain of length-prefixed blocks ending with a zero length. */
function joinSubBlocks(bytes, offset) {
  let total = 0;
  for (let at = offset; bytes[at] !== 0; at += bytes[at] + 1) {
    if (at >= bytes.length) {
      throw new Error('GIF: image data runs past the end of the file');
    }
    total += bytes[at];
  }
  const joined = new Uint8Array(total);
  let filled = 0;
  for (let at = offset; bytes[at] !== 0; at += bytes[at] + 1) {
    joined.set(bytes.subarray(at + 1, at + 1 + bytes[at]), filled);
    filled += bytes[at];
  }
  return joined;
}

function skipSubBlocks(bytes, offset) {
  let at = offset;
  while (bytes[at] !== 0) {
    at += bytes[at] + 1;
  }
  return at + 1;
}

/** Variable-width LZW, least significant bit first, as GIF defines it. */
function unpackLzw(packed, minCodeBits, pixelCount) {
  const clearCode = 1 << minCodeBits;
  const endCode = clearCode + 1;
  const prefix = new Uint16Array(MAX_CODES);
  const suffix = new Uint8Array(MAX_CODES);
  const stack = new Uint8Array(MAX_CODES + 1);
  const pixels = new Uint8Array(pixelCount);

  let codeBits = minCodeBits + 1;
  let nextCode = endCode + 1;
  let previous = -1;
  let firstOfPrevious = 0;
  let bitBuffer = 0;
  let bitCount = 0;
  let readAt = 0;
  let written = 0;

  for (let i = 0; i < clearCode; i++) {
    suffix[i] = i;
  }

  while (written < pixelCount) {
    while (bitCount < codeBits && readAt < packed.length) {
      bitBuffer |= packed[readAt++] << bitCount;
      bitCount += 8;
    }
    if (bitCount < codeBits) {
      break;
    }
    const code = bitBuffer & ((1 << codeBits) - 1);
    bitBuffer >>>= codeBits;
    bitCount -= codeBits;

    if (code === clearCode) {
      codeBits = minCodeBits + 1;
      nextCode = endCode + 1;
      previous = -1;
      continue;
    }
    if (code === endCode) {
      break;
    }
    if (previous === -1) {
      pixels[written++] = suffix[code];
      previous = code;
      firstOfPrevious = suffix[code];
      continue;
    }

    let depth = 0;
    let walk = code;
    if (code >= nextCode) {
      // The code being defined right now: previous string plus its own first pixel.
      stack[depth++] = firstOfPrevious;
      walk = previous;
    }
    while (walk >= clearCode) {
      stack[depth++] = suffix[walk];
      walk = prefix[walk];
    }
    firstOfPrevious = suffix[walk];
    stack[depth++] = firstOfPrevious;

    while (depth > 0 && written < pixelCount) {
      pixels[written++] = stack[--depth];
    }

    if (nextCode < MAX_CODES) {
      prefix[nextCode] = previous;
      suffix[nextCode] = firstOfPrevious;
      nextCode++;
      if (nextCode === (1 << codeBits) && codeBits < MAX_CODE_BITS) {
        codeBits++;
      }
    }
    previous = code;
  }
  return pixels;
}

function deinterlace(pixels, width, height) {
  const ordered = new Uint8Array(pixels.length);
  let sourceRow = 0;
  for (const [first, step] of INTERLACE_PASSES) {
    for (let row = first; row < height; row += step) {
      ordered.set(pixels.subarray(sourceRow * width, (sourceRow + 1) * width), row * width);
      sourceRow++;
    }
  }
  return ordered;
}

/**
 * @param {Uint8Array} bytes a whole .GIF file
 * @returns {{width: number, height: number, pixels: Uint8Array, palette: Uint8Array}}
 *   pixels are palette indices; palette is 256 RGB triplets, 8 bits each, zero-padded
 */
export function decodeGif(bytes) {
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== 'GIF87a' && signature !== 'GIF89a') {
    throw new Error(`GIF: bad signature "${signature}"`);
  }

  const screenFlags = bytes[10];
  let palette = new Uint8Array(PALETTE_BYTES);
  let at = HEADER_BYTES;
  if (screenFlags & 0x80) {
    const entries = 2 << (screenFlags & 7);
    palette = readPalette(bytes, at, entries);
    at += entries * 3;
  }

  while (at < bytes.length) {
    const block = bytes[at++];
    if (block === EXTENSION_INTRODUCER) {
      at = skipSubBlocks(bytes, at + 1);
      continue;
    }
    if (block === TRAILER) {
      break;
    }
    if (block !== IMAGE_SEPARATOR) {
      throw new Error(`GIF: unexpected block 0x${block.toString(16)} at ${at - 1}`);
    }

    const width = bytes[at + 4] | (bytes[at + 5] << 8);
    const height = bytes[at + 6] | (bytes[at + 7] << 8);
    const imageFlags = bytes[at + 8];
    at += 9;
    if (imageFlags & 0x80) {
      const entries = 2 << (imageFlags & 7);
      palette = readPalette(bytes, at, entries);
      at += entries * 3;
    }
    const minCodeBits = bytes[at++];
    const unpacked = unpackLzw(joinSubBlocks(bytes, at), minCodeBits, width * height);
    const isInterlaced = (imageFlags & 0x40) !== 0;
    const pixels = isInterlaced ? deinterlace(unpacked, width, height) : unpacked;
    return { width, height, pixels, palette };
  }
  throw new Error('GIF: no image in file');
}
