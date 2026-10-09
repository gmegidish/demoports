// The Picture-Wobbler, 08a8:01f2 (docs/disassembly/G4_water_glentz_wobbler.md, section 3): the fractal picture,
// stored twice in a 320-byte-wide virtual screen, wobbled sideways by rewriting the CRTC offset at every row; then
// still, then dissolved into green bubble blocks whose palette shimmers until the music's 6th sync command.
import { linear } from '../machine.js';
import { unpackRle, interpolatePalette, setDac } from '../library.js';

/** @typedef {import('../machine.js').Machine} Machine */

const MODULE = linear(0x08a8, 0);
/** 08a8:0000 word: the sine phase (bytes into wave_sin's table). */
const SINE_PHASE = MODULE + 0x00;
const WAVE_SEGMENT = MODULE + 0x0a;
const PICTURE_SEGMENT = MODULE + 0x0c;
const SINE_SEGMENT = MODULE + 0x1e;
const RANDOM_SEGMENT = MODULE + 0x20;
const PALETTE_SEGMENT = MODULE + 0x4a;
/** 08a8:00a1 word: the fade pointer into the palette blocks (1680h = the darkest; 0 = fade over). */
const FADE_POINTER = MODULE + 0xa1;
/** 08a8:014d / 014f: the shimmer's random column and row. */
const SHIMMER_COLUMN = MODULE + 0x14d;
const SHIMMER_ROW = MODULE + 0x14f;

/** The chess module's random generators (0777:0401, 0777:03d9) and their state. */
const CHESS_MODULE = linear(0x0777, 0);
const P3_SIN_SEGMENT = CHESS_MODULE + 0x00;
const RANDOM_A_POINTER = CHESS_MODULE + 0x32;
const RANDOM_B_POINTER = CHESS_MODULE + 0x34;
const RANDOM_TABLE_END = 0x258;
/** 05ee:0000: the shimmer colours, 7 rows of 16 colours (reads run past the end, as in the original). */
const SHIMMER_COLOURS = linear(0x05ee, 0);
const SHIMMER_TABLE_SIZE = 0x150;
const SHIMMER_ROW_BYTES = 0x30;
const SHIMMER_FIRST_COLOUR = 0x28;

const SEQUENCER_INDEX = 0x3c4;
const CRTC_INDEX = 0x3d4;
const SCREEN_OFF = 0x20;
const PALETTE_PARAGRAPHS = 0x175;
const PICTURE_PARAGRAPHS = 0xfa0;
const PICTURE_SIZE = 64000;
const COLOURS = 0x20;
const BLOCK_BYTES = 0x60;
const BLACK_BLOCK = 0x1680;
const FADE_STEPS = 0x3c;
/** 0225..0230: the sine table starts after the 60h palette bytes; 198 rows get an offset. */
const SINE_TABLE = 0x60;
const WOBBLED_ROWS = 0xc6;
const FIRST_ROW_POSITION = 0x50;
const WIDE_OFFSET = 0xa0;
const SINE_STEP = 6;
const SINE_WRAP = 0xfa0;
const WOBBLE_FRAMES = 0x1e0;
const STILL_FRAMES = 0x64;
const DISSOLVE_FRAMES = 0x122;
const BLOCKS_PER_FRAME = 4;
const BLOCK_ROWS = 0x1c;
const BLOCK_FIRST_COLOUR = 0x20;
const BYTES_PER_LINE = 0x50;
const MUSIC_SYNC_TO_END = 6;
/**
 * Raster timing of the fade (measured in the recording, not in the code): the palette upload for the next frame
 * starts one scanline after the last row offset (the music tick in between) and the upload with the screen off
 * lasts two scanlines, so row 198 is black and row 199 already has the next palette.
 */
const SCANLINES_BEFORE_UPLOAD = 1;
const SCANLINES_OF_UPLOAD = 2;

function writeCrtc16(vga, index, value) {
  vga.out16(CRTC_INDEX, (value << 8) | index);
}

/** 08a8:004c: the palette blocks: block 0 the picture's 32 colours, block j (1..60) faded (j - 1) / 60 to black. */
function buildFadeBlocks(m) {
  const palette = linear(m.allocTo(PALETTE_SEGMENT, PALETTE_PARAGRAPHS), 0);
  const sine = linear(m.u16(SINE_SEGMENT), 0);
  m.mem.copyWithin(palette, sine, sine + BLOCK_BYTES);
  m.mem.fill(0, palette + BLACK_BLOCK, palette + BLACK_BLOCK + BLOCK_BYTES);
  let out = palette + BLOCK_BYTES;
  for (let step = 0; step < FADE_STEPS; step++) {
    // The last step writes over the black block it reads: block 60 is nearly, not quite, black.
    interpolatePalette(m, COLOURS, palette, palette + BLACK_BLOCK, out, step, FADE_STEPS);
    out += BLOCK_BYTES;
  }
}

/** 08a8:0022: the picture into video memory, plane by plane, rows 320 bytes apart from `address` on. */
function copyPicture(m, picture, address) {
  const vga = m.vga;
  for (let plane = 0; plane < 4; plane++) {
    vga.out16(SEQUENCER_INDEX, ((1 << plane) << 8) | 0x02);
    const target = vga.planes[plane];
    let di = address;
    let si = picture + plane;
    for (let row = 0; row < 200; row++) {
      for (let column = 0; column < 80; column++) {
        target[di & 0xffff] = m.mem[si];
        di++;
        si += 4;
      }
      di += 0xf0;
    }
  }
}

/** 08a8:00a3: palette blocks, the picture unpacked and stored at 0190h and at 0231h (one byte off the grid). */
function setUp(m) {
  buildFadeBlocks(m);
  const picture = linear(m.allocTo(PICTURE_SEGMENT, PICTURE_PARAGRAPHS), 0);
  unpackRle(m, linear(m.u16(WAVE_SEGMENT), 0), picture, PICTURE_SIZE);
  copyPicture(m, picture, 0x190);
  copyPicture(m, picture, 0x231);
}

/** 08a8:01bb: the next fade block (screen off around it), and the pointer to the next one. */
function fadeStep(m, isMidFrame) {
  const vga = m.vga;
  if (isMidFrame) {
    vga.hblank(SCANLINES_BEFORE_UPLOAD);
  }
  vga.out8(SEQUENCER_INDEX, 1);
  vga.out8(SEQUENCER_INDEX + 1, vga.sequencer[1] | SCREEN_OFF);
  if (isMidFrame) {
    vga.hblank(SCANLINES_OF_UPLOAD);
  }
  setDac(m, 0, COLOURS, linear(m.u16(PALETTE_SEGMENT), m.u16(FADE_POINTER)));
  m.set16(FADE_POINTER, (m.u16(FADE_POINTER) - BLOCK_BYTES) & 0xffff);
  vga.out8(SEQUENCER_INDEX, 1);
  vga.out8(SEQUENCER_INDEX + 1, vga.sequencer[1] & ~SCREEN_OFF);
}

/** 0777:0401: p3_sin[A] & 7, A += 3 (wraps to 0 at 258h). */
function randomA(m) {
  const pointer = m.u16(RANDOM_A_POINTER);
  const value = m.mem[linear(m.u16(P3_SIN_SEGMENT), pointer)];
  m.set16(RANDOM_A_POINTER, pointer + 3 >= RANDOM_TABLE_END ? 0 : pointer + 3);
  return value & 7;
}

/** 0777:03d9: p3_sin[B] & 7, B += 2 (wraps to 0 at 258h). */
function randomB(m) {
  const pointer = m.u16(RANDOM_B_POINTER);
  const value = m.mem[linear(m.u16(P3_SIN_SEGMENT), pointer)];
  m.set16(RANDOM_B_POINTER, pointer + 2 >= RANDOM_TABLE_END ? 0 : pointer + 2);
  return value & 7;
}

/** 08a8:0151: 7 rows of 8 shimmer colours to DAC 40, 72, ... 232, from a random column and row; new randoms. */
function shimmer(m) {
  let si = (m.u16(SHIMMER_COLUMN) & 7) * 3 + (m.u16(SHIMMER_ROW) & 7) * SHIMMER_ROW_BYTES;
  let first = SHIMMER_FIRST_COLOUR;
  for (let row = 0; row < 7; row++) {
    setDac(m, first, 8, SHIMMER_COLOURS + si);
    first += 0x20;
    si += SHIMMER_ROW_BYTES;
    if (si >= SHIMMER_TABLE_SIZE) {
      si -= SHIMMER_TABLE_SIZE;
    }
  }
  m.set16(SHIMMER_COLUMN, randomA(m));
  m.set16(SHIMMER_ROW, randomB(m));
}

/** 08a8:011e: an 8x28 block at `address`, colours 20h, 21h, ... one per pixel (rows 50h bytes apart). */
function drawBlock(m, address) {
  const vga = m.vga;
  let colour = BLOCK_FIRST_COLOUR;
  let di = address;
  for (let row = 0; row < BLOCK_ROWS; row++) {
    for (let byte = 0; byte < 2; byte++) {
      for (let plane = 0; plane < 4; plane++) {
        vga.out16(SEQUENCER_INDEX, ((1 << plane) << 8) | 0x02);
        vga.planes[plane][(di + byte) & 0xffff] = colour;
        colour = (colour + 1) & 0xff;
      }
    }
    di += BYTES_PER_LINE;
  }
}

/** 0201..024a: one wobbled frame; each row's offset makes the next row start at its sine position. */
function* wobbleFrame(m) {
  const vga = m.vga;
  const sine = linear(m.u16(SINE_SEGMENT), 0);
  yield; // 0210: waits for the retrace start, then for its end
  writeCrtc16(vga, 0x13, WIDE_OFFSET);
  let previous = FIRST_ROW_POSITION;
  let si = SINE_TABLE + m.u16(SINE_PHASE);
  for (let row = 0; row < WOBBLED_ROWS; row++) {
    const position = m.u16(sine + si);
    si += 2;
    const offset = (position - previous + WIDE_OFFSET) & 0xff;
    previous = position;
    vga.hblank(2); // 08a8:00f6: two scanline ends (one double-scanned row)
    writeCrtc16(vga, 0x13, offset);
  }
  let phase = m.u16(SINE_PHASE) + SINE_STEP;
  if (phase >= SINE_WRAP) {
    phase -= SINE_WRAP;
  }
  m.set16(SINE_PHASE, phase);
  m.tickMusic();
}

/** 08a8:01f2. */
export function* pictureWobbler(m) {
  const vga = m.vga;
  setUp(m);
  // 01fe 0731:0158: cli, wait for the retrace start, then int 8 = the BIOS before sti: the IRQ of that retrace
  // goes to the BIOS handler, so that frame gets no music tick (measured in the recording's audio, G1).
  m.setTimer('bios');
  yield;
  for (let frame = 0; frame < WOBBLE_FRAMES; frame++) {
    if (m.u16(FADE_POINTER) !== 0) {
      fadeStep(m, frame > 0);
    }
    yield* wobbleFrame(m);
  }
  writeCrtc16(vga, 0x0c, 0x00); // 026a: start address 50h, offset a0h, the picture still
  writeCrtc16(vga, 0x0d, FIRST_ROW_POSITION);
  vga.out16(CRTC_INDEX, (WIDE_OFFSET << 8) | 0x13);
  for (let i = 0; i < STILL_FRAMES; i++) {
    yield;
    m.tickMusic();
  }
  const blocks = linear(m.u16(RANDOM_SEGMENT), 0);
  let next = 0;
  for (let i = 0; i < DISSOLVE_FRAMES; i++) {
    yield;
    shimmer(m);
    m.tickMusic();
    for (let k = 0; k < BLOCKS_PER_FRAME; k++) {
      drawBlock(m, m.u16(blocks + next));
      next += 2;
    }
  }
  do {
    yield;
    shimmer(m);
    m.tickMusic();
  } while (m.musicSync < MUSIC_SYNC_TO_END); // 02ed 008e:18a4
}
