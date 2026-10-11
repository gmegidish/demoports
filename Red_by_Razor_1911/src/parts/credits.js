// Part D2, main script 01c6..020d: the "Coding by Performer" / "Gfx by Zebig" tiles
// (docs/disassembly/D_snowball_credits.md).
//
// A picture's top and bottom 44 rows frame a band of 112 rows. Every retrace a 320x32 texture is built from a
// 256x32 credit (stored as 32-byte columns) stretched horizontally by the zoom, and the band shows the texture's
// rows repeated vertically with the same zoom; the zoom follows a table of 512 values. After the first round the
// credit changes, after the second the picture's halves slide apart and colour 1 fades out.
import { DATA, linear, waitFrame } from '../machine.js';
import { sendPalette } from './snowball.js';

/** @typedef {import('../machine.js').Machine} Machine */

/** 16b2:139d, the palette the parts send to the DAC (0000:0673). */
const PALETTE = DATA + 0x139d;
const PALETTE_BYTES = 0x300;
/** 16b2:79e2, the picture's palette that 0000:0e61 fades PALETTE up to. */
const PICTURE_PALETTE = DATA + 0x79e2;
/** 16b2:79d8, the number of fade steps done (64 in all, one per retrace). */
const FADE_STEPS_DONE = DATA + 0x79d8;
const FADE_STEPS = 0x40;

/** Segment 2287: the picture, the zoom table, the credits, the texture and the round counter. */
const GRAPHICS_SEGMENT = 0x2287;
/** 2287:0002 (byte), the rounds of the zoom table done; the part ends after ROUNDS. */
const ROUND = linear(GRAPHICS_SEGMENT, 0x0002);
const ROUNDS = 2;
/** 2287:0004, the texture: 32 rows of 320 pixels. */
const TEXTURE_OFFSET = 0x0004;
const TEXTURE = linear(GRAPHICS_SEGMENT, TEXTURE_OFFSET);
const TEXTURE_ROWS = 0x20;
/** 2287:2804, the zoom table: 512 words, read at the zoom index. */
const ZOOM_TABLE = linear(GRAPHICS_SEGMENT, 0x2804);
/** 2287:bd50, the offset of the credit in segment 2287: "Coding by Performer" first, "Gfx by Zebig" second. */
const CREDIT_OFFSET = linear(GRAPHICS_SEGMENT, 0xbd50);
const FIRST_CREDIT = 0x2c04;
const SECOND_CREDIT = 0x4c04;
/** 0f4b: a credit column is 32 bytes. */
const CREDIT_COLUMN_SHIFT = 5;
/** 2287:6c04, the picture's top 44 rows, followed by its bottom 44 rows. */
const PICTURE = linear(GRAPHICS_SEGMENT, 0x6c04);
const PICTURE_HALF_BYTES = 0x3700;

/** 16b2:79da, the zoom index (a byte offset in the table, 2 to 0x3fe then 0). */
const ZOOM_INDEX = DATA + 0x79da;
const ZOOM_INDEX_MASK = 0x3ff;
/** 16b2:79dc, the zoom: 8.8 fixed-point texture pixels per screen pixel. */
const ZOOM = DATA + 0x79dc;
/** 16b2:79de / 79e0, the texture's horizontal / vertical origins (always 0). */
const ORIGIN_X = DATA + 0x79de;
const ORIGIN_Y = DATA + 0x79e0;
/** 0f2d / 0f1c: the texture is centred on column 160: 0x8000 - 160 * zoom. */
const CENTRE_X = 0x8000;
const HALF_WIDTH = 160;
/** 0ed4 / 0ec3: the band is centred on its row 56: 0x4000 - 56 * zoom, wrapping at 32 rows (0x1fff). */
const CENTRE_Y = 0x4000;
const HALF_BAND = 56;
const TEXTURE_Y_MASK = 0x1fff;

const SCREEN_WIDTH = 320;
/** 0eb7: the band, rows 44..155. */
const BAND_OFFSET = 0x3700;
const BAND_ROWS = 0x70;
/** 0e52: colour 1 between the picture's halves. */
const BAND_COLOUR = 1;
const BAND_BYTES = 0x8c00;

/** 0de6: the halves slide apart one row per retrace, 45 retraces, each followed by two rows of colour 1. */
const SLIDE_STEPS = 0x2d;
const SLIDE_EDGE_BYTES = 0x280;
/** 0db6: colour 1 (16b2:79e5) fades out one step every two retraces, 55 steps. */
const COLOUR_ONE = PICTURE_PALETTE + 3;
const COLOUR_FADE_STEPS = 0x37;
const RETRACES_PER_COLOUR_STEP = 2;

/** Writes `count` bytes from linear `source` to the screen at `offset`, returns the next offset. */
function copyToScreen(m, offset, source, count) {
  for (let i = 0; i < count; i++) {
    m.vga.write(offset + i, m.u8(source + i));
  }
  return offset + count;
}

/** Fills `count` screen bytes from `offset` with `colour`, returns the next offset. */
function fillScreen(m, offset, count, colour) {
  for (let i = 0; i < count; i++) {
    m.vga.write(offset + i, colour);
  }
  return offset + count;
}

/** 0000:0e3d: the picture's top and bottom with colour 1 between them. */
function drawPicture(m) {
  let di = copyToScreen(m, 0, PICTURE, PICTURE_HALF_BYTES);
  di = fillScreen(m, di, BAND_BYTES, BAND_COLOUR);
  copyToScreen(m, di, PICTURE + PICTURE_HALF_BYTES, PICTURE_HALF_BYTES);
}

/** 0000:0e61: every palette byte that differs from the picture's palette one up. */
function fadeUp(m) {
  for (let i = 0; i < PALETTE_BYTES; i++) {
    const current = m.u8(PALETTE + i);
    if (current !== m.u8(PICTURE_PALETTE + i)) {
      m.set8(PALETTE + i, current + 1);
    }
  }
  sendPalette(m);
}

/** 0000:0f0b: the texture's 320 columns, each a 32-byte column of the credit at the zoomed position. */
function buildTexture(m) {
  const zoom = m.u16(ZOOM);
  const credit = linear(GRAPHICS_SEGMENT, m.u16(CREDIT_OFFSET));
  let x = (CENTRE_X - HALF_WIDTH * zoom + m.u16(ORIGIN_X)) & 0xffff;
  for (let column = 0; column < SCREEN_WIDTH; column++) {
    const source = credit + ((x >> 8) << CREDIT_COLUMN_SHIFT); // 0f4b
    for (let row = 0; row < TEXTURE_ROWS; row++) {
      m.set8(TEXTURE + row * SCREEN_WIDTH + column, m.u8(source + row));
    }
    x = (x + zoom) & 0xffff;
  }
}

/** 0000:0eb2: the band's 112 rows, each a texture row at the zoomed position. */
function drawBand(m) {
  const zoom = m.u16(ZOOM);
  let y = (CENTRE_Y - HALF_BAND * zoom + m.u16(ORIGIN_Y)) & TEXTURE_Y_MASK;
  for (let row = 0; row < BAND_ROWS; row++) {
    copyToScreen(m, BAND_OFFSET + row * SCREEN_WIDTH, TEXTURE + (y >> 8) * SCREEN_WIDTH, SCREEN_WIDTH);
    y = (y + zoom) & TEXTURE_Y_MASK;
  }
}

/** 0000:0e7c: the next zoom from the table; when the index wraps to 0, the second credit and the next round. */
function nextZoom(m) {
  const index = (m.u16(ZOOM_INDEX) + 2) & ZOOM_INDEX_MASK;
  m.set16(ZOOM_INDEX, index);
  if (index === 0) {
    m.set16(CREDIT_OFFSET, SECOND_CREDIT);
    m.set8(ROUND, m.u8(ROUND) + 1);
  }
  m.set16(ZOOM, m.u16(ZOOM_TABLE + index));
}

/** 0000:0de3: the picture's halves slide apart (row by row), two rows of colour 1 at their inner edges. */
function* slideApart(m) {
  for (let step = 0; step < SLIDE_STEPS; step++) {
    yield* waitFrame(m);
    const shift = step * SCREEN_WIDTH;
    const halfBytes = PICTURE_HALF_BYTES - shift;
    let di = copyToScreen(m, 0, PICTURE + shift, halfBytes);
    di = fillScreen(m, di, SLIDE_EDGE_BYTES, BAND_COLOUR);
    di += BAND_BYTES - 2 * SLIDE_EDGE_BYTES + 2 * shift;
    di = fillScreen(m, di, SLIDE_EDGE_BYTES, BAND_COLOUR);
    copyToScreen(m, di, PICTURE + PICTURE_HALF_BYTES, halfBytes);
  }
}

/** 0000:0db1: colour 1 (in the picture's palette) one step down every two retraces, sent to the DAC. */
function* fadeColourOne(m) {
  for (let step = 0; step < COLOUR_FADE_STEPS; step++) {
    for (let i = 0; i < RETRACES_PER_COLOUR_STEP; i++) {
      yield* waitFrame(m);
    }
    m.vga.out8(0x3c8, BAND_COLOUR);
    for (let component = 0; component < 3; component++) {
      const value = m.u8(COLOUR_ONE + component);
      if (value !== 0) {
        m.set8(COLOUR_ONE + component, value - 1);
      }
      m.vga.out8(0x3c9, m.u8(COLOUR_ONE + component));
    }
  }
}

/**
 * Main script 01c6..020d.
 * @param {Machine} m
 */
export function* credits(m) {
  yield* waitFrame(m); // 01c6
  drawPicture(m); // 01c9 0000:0e3d
  m.set16(CREDIT_OFFSET, FIRST_CREDIT); // 01cc
  do {
    buildTexture(m); // 01de 0000:0f0b
    yield* waitFrame(m); // 01e1
    const fadeSteps = m.u16(FADE_STEPS_DONE);
    if (fadeSteps !== FADE_STEPS) {
      m.set16(FADE_STEPS_DONE, fadeSteps + 1);
      fadeUp(m); // 01f0 0000:0e61
    }
    drawBand(m); // 01f3 0000:0eb2
    nextZoom(m); // 01f6 0000:0e7c
  } while (m.u8(ROUND) !== ROUNDS); // 01f9
  yield* slideApart(m); // 0208 0000:0de3
  yield* fadeColourOne(m); // 020b 0000:0db1
}
