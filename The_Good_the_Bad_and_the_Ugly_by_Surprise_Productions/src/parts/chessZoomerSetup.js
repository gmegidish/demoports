// Module 0777 set-up: the video memory layout (0777:02fa), the palette work buffer (0777:0895) and the grey
// chess palette (0777:094c). docs/disassembly/G5_chesszoom_bars_eb3.md.
import { interpolatePalette } from '../library.js';
import { linear } from '../machine.js';
import { CODE, DATA, SEQUENCER_INDEX, V, getWord, inBlock } from './chessZoomerShared.js';

/** Bytes per plane filled with the 0..7 ramp (402 rows of 40 bytes). */
const RAMP_BYTES = 0x3ed0;
/** Planes 0, 1, 2 of the ramp: pixel x of every byte gets colour x & 7. */
const RAMP_PATTERN = [0x55, 0x33, 0x0f, 0x00];
const ROW_BYTES = 40;
/** p3_chess unpacks to plane 3 from row 2 (16000 bytes = 400 rows). */
const CHESS_PLANE_AT = 0x50;
const CHESS_PLANE_BYTES = 0x3e80;
/** p3_zoom: 4 raw planes of 8000 bytes, at row 400. */
const ZOOM_PICTURE_AT = 0x3e80;
const PICTURE_PLANE_BYTES = 0x1f40;
/** 'chess': 200 rows x 4 planes x 40 bytes, RLE, at row 600. */
const CHESS_PICTURE_AT = 0x5dc0;
const PICTURE_ROWS = 200;
const PALETTE_BUFFER_PARAGRAPHS = 0x83d;
/** DAC value of the grey squares (0777:094c). */
const GREY = 0x16;

/** 0299:0000 into video memory: the RLE stream at linear `source` -> `count` bytes at a000:`offset`. */
function unpackRleToVideo(m, source, offset, count) {
  const { mem, vga } = m;
  let si = source;
  let di = offset;
  let remaining = count;
  while (remaining > 0) {
    const code = mem[si++];
    if (code <= 0x7f) {
      for (let i = 0; i <= code; i++) {
        vga.write(di++, mem[si++]);
      }
      remaining -= code + 1;
    } else {
      const value = mem[si++];
      for (let i = 0; i < 0x101 - code; i++) {
        vga.write(di++, value);
      }
      remaining -= 0x101 - code;
    }
  }
  return si;
}

/** The plane 3 pattern of row 0 (0777:033a..036d): 40-pixel squares starting with 20 set pixels. */
function drawRowZeroPattern(vga) {
  let di = 0;
  const put = (value) => {
    vga.write(di++, value);
  };
  put(0xff);
  put(0xff);
  put(0xf0);
  for (let i = 0; i < 3; i++) {
    di += 4;
    put(0x0f);
    for (let j = 0; j < 4; j++) {
      put(0xff);
    }
    put(0xf0);
  }
  di += 4;
  put(0x0f);
  put(0xff);
  put(0xff);
}

/** 0777:02fa: ramp, chess patterns, the p3_zoom picture and the 'chess' picture in video memory. */
export function initVideo(m) {
  const vga = m.vga;
  for (let plane = 0; plane < 4; plane++) {
    vga.out16(SEQUENCER_INDEX, ((1 << plane) << 8) | 0x02);
    for (let offset = 0; offset < RAMP_BYTES; offset++) {
      vga.write(offset, RAMP_PATTERN[plane]);
    }
  }
  vga.out16(SEQUENCER_INDEX, 0x0802);
  drawRowZeroPattern(vga);
  unpackRleToVideo(m, inBlock(m, V.P3_CHESS, 0), CHESS_PLANE_AT, CHESS_PLANE_BYTES);
  let source = inBlock(m, V.P3_ZOOM, 0);
  for (let plane = 0; plane < 4; plane++) {
    vga.out16(SEQUENCER_INDEX, ((1 << plane) << 8) | 0x02);
    for (let i = 0; i < PICTURE_PLANE_BYTES; i++) {
      vga.write(ZOOM_PICTURE_AT + i, m.mem[source++]);
    }
  }
  source = inBlock(m, V.CHESS, 0);
  for (let row = 0; row < PICTURE_ROWS; row++) {
    for (let plane = 0; plane < 4; plane++) {
      vga.out16(SEQUENCER_INDEX, ((1 << plane) << 8) | 0x02);
      source = unpackRleToVideo(m, source, CHESS_PICTURE_AT + row * ROW_BYTES, ROW_BYTES);
    }
  }
}

/** 0777:0895: allocates the palette work buffer (cs:[54h]) and fills its fade tables. */
export function buildPaletteBuffer(m) {
  const segment = m.allocTo(CODE + V.BUFFER, PALETTE_BUFFER_PARAGRAPHS);
  const buffer = linear(segment, 0);
  const { mem } = m;
  mem.copyWithin(buffer, DATA, DATA + 0x180);
  mem.fill(0, buffer + 0x5a00, buffer + 0x5b80);
  mem.copyWithin(buffer + 0x5b80, DATA + 0x13c4, DATA + 0x13c4 + 0x18);
  mem.fill(0, buffer + 0x6120, buffer + 0x6138);
  mem.copyWithin(buffer + 0x62d4, DATA, DATA + 0x180);
  mem.fill(0x3f, buffer + 0x80d4, buffer + 0x80d4 + 0x180);
  // Each step reads its "to" block before overwriting it (the last step lands on it): same as reading it intact.
  for (let step = 0; step < 60; step++) {
    interpolatePalette(m, 0x80, buffer, buffer + 0x5a00, buffer + 0x180 + 0x180 * step, step, 60);
  }
  for (let step = 0; step < 60; step++) {
    interpolatePalette(m, 8, buffer + 0x5b80, buffer + 0x6120, buffer + 0x5b98 + 0x18 * step, step, 60);
  }
  for (let step = 0; step < 20; step++) {
    interpolatePalette(m, 0x80, buffer + 0x62d4, buffer + 0x80d4, buffer + 0x6454 + 0x180 * step, step, 20);
  }
}

/** 0777:094c: DAC 8..15, 24..31, ..., 120..127 and 128..135, ..., 240..247 = grey. */
export function setGreyPalette(vga) {
  const writeBlocks = (first) => {
    for (let block = 0; block < 8; block++) {
      vga.out8(0x3c8, first + block * 16);
      for (let i = 0; i < 8 * 3; i++) {
        vga.out8(0x3c9, GREY);
      }
    }
  };
  writeBlocks(8);
  writeBlocks(128);
}

/** The palette buffer's linear address + offset (segment cs:[54h]). */
export function paletteBufferAt(m, offset) {
  return linear(getWord(m, V.BUFFER), offset & 0xffff);
}
