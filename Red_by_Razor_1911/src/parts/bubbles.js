// Part A, main script 0050..0089: the RAZOR bubble logo (docs/disassembly/A_bubbles.md).
//
// A two-colour RLE animation (bubbles growing into the RAZOR logo) plays at 35 Hz, the logo's own picture replaces
// its last frame and its palette fades in, the logo bounces off the screen, then a rectangle of colour 1 grows from
// the centre while colour 1 cycles through red, and the screen is cleared for part B.
import { DATA, linear, waitFrame } from '../machine.js';

/** @typedef {import('../machine.js').Machine} Machine */

/** 16b2:139d, the palette the parts send to the DAC (0000:0673). */
const PALETTE = DATA + 0x139d;
/** 16b2:109d, the logo's palette that 0000:0626 fades PALETTE to. */
const LOGO_PALETTE = DATA + 0x109d;
const PALETTE_BYTES = 0x300;
/** 16b2:1099, the RLE animation's read pointer (an offset in ANIMATION_SEGMENTS). */
const ANIMATION_POINTER = DATA + 0x1099;
/** 16b2:109b, 0 while the animation reads segment 5cfa, then 4d0c. */
const ANIMATION_SEGMENT_FLAG = DATA + 0x109b;
/** 05d8 / 05dd: the animation's two segments. */
const ANIMATION_SEGMENT_FIRST = 0x5cfa;
const ANIMATION_SEGMENT_SECOND = 0x4d0c;
/** 061b: where the animation continues in segment 4d0c after a zero word ends segment 5cfa's frames. */
const ANIMATION_SECOND_START = 0x70b8;
/** 0059: the first frame starts at 5cfa:0001. */
const ANIMATION_START = 1;
/** 005c / 0060: 91 frames, two retraces each. */
const ANIMATION_FRAMES = 0x5b;
const RETRACES_PER_ANIMATION_FRAME = 2;
/** RLE word: bit 15 is the colour (0 or 1), bits 0-14 the run length in pixels. */
const RUN_COLOUR_BIT = 15;
const RUN_LENGTH_MASK = 0x7fff;
const SCREEN_BYTES = 0xfa00;
const SCREEN_WIDTH = 320;

/** 4d0c:9a3c, the logo picture: 85 rows of 303 pixels, right after the animation's last frame. */
const LOGO = linear(0x4d0c, 0x9a3c);
const LOGO_WIDTH = 0x97 * 2 + 1;
const LOGO_HEIGHT = 0x55;
/** 0634: the logo's place on screen, row 73, column 10. */
const LOGO_SCREEN_OFFSET = 0x5b4a;
/** 0648: 64 steps of the fade, one per retrace. */
const FADE_STEPS = 0x40;
/** 0073: the pause with the logo shown. */
const LOGO_PAUSE_RETRACES = 0xc8;

/** 16b2:1097, the index into BOUNCE_ROWS. */
const BOUNCE_INDEX = DATA + 0x1097;
/** 16b2:169d, the logo's row per retrace (its top is row - 1); BOUNCE_OFF_SCREEN means nothing to draw. */
const BOUNCE_ROWS = DATA + 0x169d;
const BOUNCE_RETRACES = 0x78;
const BOUNCE_OFF_SCREEN = 0xc8;
/** 06a8: the logo's first cleared row is 5 rows above its row, at column 10. */
const BOUNCE_ORIGIN = 0x636;
/** 06bb: 4 rows cleared above (and below) the logo, as it moves at most 4 rows per retrace. */
const BOUNCE_CLEAR_BYTES = 0x280 * 2;
/** 06c2: below this row the logo is cut at the screen's bottom. */
const BOUNCE_LAST_FULL_ROW = 0x72;
/** 06de: the rows below are cleared only while the logo ends above this offset. */
const BOUNCE_CLEAR_BELOW_LIMIT = 0xc800;

/** 16b2:1095, the rectangle's divisor, 1200 down to 25 in steps of 5. */
const RECTANGLE_DIVISOR = DATA + 0x1095;
/** 16b2:1093 / 1091: the rectangle's half height (rows) and half width (pixels; also its words per row). */
const RECTANGLE_HALF_HEIGHT = DATA + 0x1093;
const RECTANGLE_HALF_WIDTH = DATA + 0x1091;
const RECTANGLE_STEPS = 0xf0;
const RECTANGLE_LAST_DIVISOR = 0x19;
const RECTANGLE_DIVISOR_STEP = 5;
const RECTANGLE_HEIGHT_NUMERATOR = 0x960;
const RECTANGLE_WIDTH_NUMERATOR = 0xf00;
/** 072b: the screen's centre, row 100, column 160. */
const SCREEN_CENTRE = 0x7da0;
const RECTANGLE_COLOUR = 1;
/** 16b2:1079, colour 1 during the rectangle's first 112 steps: 8 RGB triples, one per 16 steps. */
const RECTANGLE_COLOURS = DATA + 0x1079;
const RECTANGLE_COLOUR_LAST_STEP = 0x80;
const RECTANGLE_COLOUR_STEPS_SHIFT = 4;
/** 075e: colour 0 after the rectangle, part B's background. */
const BACKGROUND_COLOUR = [5, 8, 8];

/** 0000:0673: sends the 768-byte palette buffer to the DAC from colour 0. */
export function sendPalette(m) {
  m.vga.dacLoad(0, m.mem, PALETTE, PALETTE_BYTES);
}

/** 0000:0598: clears the screen to colour 0. */
export function clearScreen(m) {
  for (let offset = 0; offset < SCREEN_BYTES; offset++) {
    m.vga.write(offset, 0);
  }
}

/** Fills `count` bytes of the screen from `offset` with `colour` (rep stosw / stosb), returns the next offset. */
function fill(m, offset, count, colour) {
  for (let i = 0; i < count; i++) {
    m.vga.write(offset + i, colour);
  }
  return (offset + count) & 0xffff;
}

/**
 * 0000:05cf: draws one animation frame, RLE words until the screen is full, then moves the pointer to the next
 * frame; a zero word after a frame moves it on to segment 4d0c.
 * Quirk (05f9 `sar cx,1; ja`): a run of length 0 still writes one pixel.
 */
function drawAnimationFrame(m) {
  const segment = m.u16(ANIMATION_SEGMENT_FLAG) !== 0 ? ANIMATION_SEGMENT_SECOND : ANIMATION_SEGMENT_FIRST;
  const word = (offset) => m.u8(linear(segment, offset & 0xffff)) | (m.u8(linear(segment, (offset + 1) & 0xffff)) << 8);
  let si = m.u16(ANIMATION_POINTER);
  let di = 0;
  while (di !== SCREEN_BYTES) {
    const run = word(si);
    si = (si + 2) & 0xffff;
    const length = run & RUN_LENGTH_MASK;
    const pixels = length === 0 ? 1 : length;
    di = fill(m, di, pixels, run >> RUN_COLOUR_BIT);
  }
  m.set16(ANIMATION_POINTER, si);
  if (word(si) === 0) {
    m.set16(ANIMATION_POINTER, ANIMATION_SECOND_START);
    m.set16(ANIMATION_SEGMENT_FLAG, m.u16(ANIMATION_SEGMENT_FLAG) + 1);
  }
}

/** Copies `rows` rows of the logo to the screen from `offset` (0638 / 06d1), returns the next offset. */
function drawLogoRows(m, offset, rows) {
  let di = offset;
  let si = LOGO;
  for (let row = 0; row < rows; row++) {
    for (let x = 0; x < LOGO_WIDTH; x++) {
      m.vga.write(di + x, m.u8(si + x));
    }
    si += LOGO_WIDTH;
    di = (di + SCREEN_WIDTH) & 0xffff;
  }
  return di;
}

/** One step of 0626's fade: every palette byte one closer to the logo's palette. */
function fadeStep(m) {
  for (let i = 0; i < PALETTE_BYTES; i++) {
    const current = m.s8(PALETTE + i);
    const target = m.s8(LOGO_PALETTE + i);
    if (current > target) {
      m.set8(PALETTE + i, current - 1);
    } else if (current < target) {
      m.set8(PALETTE + i, current + 1);
    }
  }
}

/** 0000:0626: the logo picture over the animation's last frame, then its palette fades in. */
function* showLogo(m) {
  drawLogoRows(m, LOGO_SCREEN_OFFSET, LOGO_HEIGHT);
  for (let step = 0; step < FADE_STEPS; step++) {
    fadeStep(m);
    yield* waitFrame(m);
    sendPalette(m);
  }
}

/** 0000:0685: the logo bounces up once, then falls off the screen's bottom. */
function* bounceLogo(m) {
  for (let step = 0; step < BOUNCE_RETRACES; step++) {
    yield* waitFrame(m);
    const index = m.u16(BOUNCE_INDEX);
    m.set16(BOUNCE_INDEX, index + 1);
    const row = m.u8(BOUNCE_ROWS + index);
    if (row === BOUNCE_OFF_SCREEN) {
      continue;
    }
    let di = fill(m, (row * SCREEN_WIDTH - BOUNCE_ORIGIN) & 0xffff, BOUNCE_CLEAR_BYTES, 0);
    di = drawLogoRows(m, di, row > BOUNCE_LAST_FULL_ROW ? 200 - row : LOGO_HEIGHT);
    if (di < BOUNCE_CLEAR_BELOW_LIMIT) {
      fill(m, di, BOUNCE_CLEAR_BYTES, 0);
    }
  }
}

/** 0000:076f: colour 1 from RECTANGLE_COLOURS while the step counter (240 down) is at least 128. */
function setRectangleColour(m, counter) {
  if (counter < RECTANGLE_COLOUR_LAST_STEP) {
    return;
  }
  const entry = (RECTANGLE_STEPS - counter) >> RECTANGLE_COLOUR_STEPS_SHIFT;
  m.vga.dacLoad(RECTANGLE_COLOUR, m.mem, RECTANGLE_COLOURS + entry * 3, 3);
}

/** 071e: the rectangle of colour 1, 2 * half height rows of 2 * half width pixels around the centre. */
function drawRectangle(m) {
  const halfHeight = m.u16(RECTANGLE_HALF_HEIGHT);
  const halfWidth = m.u16(RECTANGLE_HALF_WIDTH);
  let di = (SCREEN_CENTRE - halfHeight * SCREEN_WIDTH - halfWidth) & 0xffff;
  for (let row = 0; row < halfHeight * 2; row++) {
    fill(m, di, halfWidth * 2, RECTANGLE_COLOUR);
    di = (di + SCREEN_WIDTH) & 0xffff;
  }
}

/** 0000:06f0: the rectangle grows (its size is 1/divisor) while colour 1 cycles; then colour 0 for part B. */
function* growRectangle(m) {
  for (let counter = RECTANGLE_STEPS; counter > 0; counter--) {
    const divisor = m.u16(RECTANGLE_DIVISOR);
    if (divisor === RECTANGLE_LAST_DIVISOR) {
      continue;
    }
    const next = divisor - RECTANGLE_DIVISOR_STEP;
    m.set16(RECTANGLE_DIVISOR, next);
    m.set16(RECTANGLE_HALF_HEIGHT, Math.floor(RECTANGLE_HEIGHT_NUMERATOR / next));
    m.set16(RECTANGLE_HALF_WIDTH, Math.floor(RECTANGLE_WIDTH_NUMERATOR / next));
    yield* waitFrame(m);
    setRectangleColour(m, counter);
    drawRectangle(m);
  }
  yield* waitFrame(m); // 075b
  m.vga.out8(0x3c8, 0);
  BACKGROUND_COLOUR.forEach((component) => m.vga.out8(0x3c9, component));
}

/**
 * Main script 0050..0089.
 * @param {Machine} m
 */
export function* bubbles(m) {
  yield* waitFrame(m); // 0050
  sendPalette(m); // 0053: black and grey 48
  m.set16(ANIMATION_POINTER, ANIMATION_START); // 0056
  for (let frame = 0; frame < ANIMATION_FRAMES; frame++) {
    for (let i = 0; i < RETRACES_PER_ANIMATION_FRAME; i++) {
      yield* waitFrame(m); // 0064
    }
    drawAnimationFrame(m); // 006a 0000:05cf
  }
  yield* showLogo(m); // 0070 0000:0626
  for (let i = 0; i < LOGO_PAUSE_RETRACES; i++) {
    yield* waitFrame(m); // 0076
  }
  yield* bounceLogo(m); // 007b 0000:0685
  yield* growRectangle(m); // 007e 0000:06f0
  yield* waitFrame(m); // 0081
  clearScreen(m); // 0084 0000:0598
  yield* waitFrame(m); // 0087
}
