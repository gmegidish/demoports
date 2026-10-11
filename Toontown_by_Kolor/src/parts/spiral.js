// The spiral animation shared by the first and the last parts (docs/disassembly/A_intro_outro.md): 39 small PCX
// pictures that main loads into blocks (pointers at 0x16def4..0x16df8c), decoded one per frame by 0x1011ec into the
// 64000-byte buffer at [0x1719ec]; and 0x10ed88, which sets one DAC colour.
import { POSITION, copyToScreen, setPalette, waitRetrace } from '../machine.js';

/** @typedef {import('../machine.js').Machine} Machine */

/** The 39 animation blocks (src/loader.js); [0x16df8c] is the last one. */
export const SPIRAL_BLOCKS = 0x16def4;
export const SPIRAL_LAST_FRAME = 0x26;
/** The buffer the parts decode into (0x1719ec) and the palette 0x1011ec writes (0x1719f0). */
export const SPIRAL_BUFFER = 0x1719ec;
export const SPIRAL_PALETTE = 0x1719f0;
/** malloc(0x10000) at the start of each spiral part. */
const SPIRAL_BUFFER_SIZE = 0x10000;
const PCX_HEADER_SIZE = 0x80;
const WIDTH = 0x140;
const LINES = 0xc8;
const PALETTE_BYTES = 0x300;
/** The spiral parts show a new frame every 4 retraces (four calls of 0x100056). */
export const RETRACES_PER_FRAME = 4;
export const SCREEN = 0xa0000;
export const SCREEN_BYTES = 0xfa00;

/** The part's malloc at its start (0x10edb7 / 0x10eefd / 0x10efd1). */
export function allocateSpiralBuffer(m) {
  m.set32(SPIRAL_BUFFER, m.malloc(SPIRAL_BUFFER_SIZE));
}

/**
 * 0x1011ec: decodes the PCX picture at `picture` (header skipped) into [0x1719ec], 200 lines of 320 pixels, and
 * its palette (after the 0x0c marker, 8 bits per component) shifted to 6 bits into `palette`.
 * Like the original, a run is not cut at the end of a line: the output is one stream, a line ends after the token
 * that reaches 320 pixels.
 */
export function decodeSpiralFrame(m, picture, palette = SPIRAL_PALETTE) {
  const mem = m.mem;
  let out = m.u32(SPIRAL_BUFFER);
  let i = picture + PCX_HEADER_SIZE;
  for (let line = 0; line < LINES; line++) {
    for (let x = 0; x < WIDTH;) {
      const b = mem[i++];
      if ((b & 0xc0) !== 0xc0) {
        mem[out++] = b;
        x++;
        continue;
      }
      const value = mem[i++];
      for (let n = b & 0x3f; n > 0; n--, x++) {
        mem[out++] = value;
      }
    }
  }
  // 0x101253: edi points one byte past the picture data, over the 0x0c marker
  for (let k = 0; k < PALETTE_BYTES; k++) {
    mem[palette + k] = mem[i + 1 + k] >> 2;
  }
}

/** Decodes animation frame `index` (0..38). */
export function decodeSpiralBlock(m, index) {
  decodeSpiralFrame(m, m.u32(SPIRAL_BLOCKS + index * 4));
}

/** 0x10ed88 (and its copy 0x10ea2c): DAC colour `index` = (red, green, blue). */
export function setColour(m, index, red, green, blue) {
  m.vga.out8(0x3c8, index);
  m.vga.out8(0x3c9, red);
  m.vga.out8(0x3c9, green);
  m.vga.out8(0x3c9, blue);
}

/** Waits `count` retraces (consecutive calls of 0x100056). */
export function* waitRetraces(m, count) {
  for (let i = 0; i < count; i++) {
    yield* waitRetrace(m);
  }
}

/**
 * The loop of 0x10ee60 (p01) and 0x10ef38 (p12): every 4 retraces the buffer goes to the screen and the next
 * frame of the spiral is decoded, going from frame 38 down to frame 0, which then stays.
 * The position is read after the decode (p01) or at the top of the loop (p12): the same thing here.
 */
export function* spiralBackwards(m, lastPosition, screen = SCREEN) {
  let remaining = SPIRAL_LAST_FRAME;
  let frame = SPIRAL_LAST_FRAME;
  for (;;) {
    m.readPlayStatus();
    if (lastPosition <= m.u32(POSITION)) {
      return false;
    }
    yield* waitRetraces(m, RETRACES_PER_FRAME);
    copyToScreen(m, m.u32(SPIRAL_BUFFER), screen, SCREEN_BYTES);
    if (remaining > 0) {
      remaining--;
      frame--;
    }
    decodeSpiralBlock(m, frame);
  }
}

/** The start of p01 and p12: frame 38 decoded and its palette to the DAC. */
export function startSpiral(m) {
  allocateSpiralBuffer(m);
  m.readPlayStatus();
  decodeSpiralBlock(m, SPIRAL_LAST_FRAME);
  setPalette(m, SPIRAL_PALETTE);
}
