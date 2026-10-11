// Main script 010e..0180: the blue "RAZOR" logo and the three pages of text (docs/disassembly/C_razorText.md).
//
// The "RAZOR" logo slides in from the right on a black-blue screen, the triangle pattern appears around it, the logo
// wobbles while the pattern's two colours brighten, then three pages of text are wiped in over the screen along a
// wavy edge. The text under the logo is removed, a 32-pixel blur slides across the logo, and four white bars wipe the
// screen.
//
// Everything stays at its original address: the work buffer 3028:0000 (64 KB), the saved screen 5cfa:0000, the
// logo, background and wobble table in 4d0c, the palette, font and variables in 16b2.
import { DATA, linear, waitFrame } from '../machine.js';

/** @typedef {import('../machine.js').Machine} Machine */
/** @typedef {{ a: number, b: number }} WavePhases the wipe edge's two wave phases (ax, dx in 0000:0d17) */

/** The work buffer: the background picture, then the screen before / after the text (0000:0b62). */
const WORK = 0x3028;
/** The screen without text, saved by 0000:0c12 (overwrites the bubble animation's data there). */
const SAVED = 0x5cfa;
/** The logo, the background picture and the wobble table. */
const GFX = 0x4d0c;

const SCREEN_WIDTH = 0x140;
const SCREEN_BYTES = 0xfa00;

/** 16b2:1bf8: the palette, 0x2fd bytes from colour 0 (0000:0c00). */
const PALETTE = 0x1bf8;
const PALETTE_BYTES = 0x2fd;

/** 4d0c:3238: the background picture, 2 bits per pixel (0000:0af1). */
const BACKGROUND_PACKED = 0x3238;
const BACKGROUND_PACKED_BYTES = 0x3e80;
/** The colours of a 2-bit background pixel: 0 -> 0, 1 -> 0e, 2 and 3 -> 0f (0000:0aa9). */
const BACKGROUND_COLOURS = [0x00, 0x0e, 0x0f, 0x0f];

/** 4d0c:1b18: the logo, 160x27. */
const LOGO = 0x1b18;
const LOGO_WIDTH = 0xa0;
const LOGO_HEIGHT = 0x1b;
/** The logo's rows on screen: 86..112 (a000:6b80). */
const LOGO_TOP = 0x6b80;
/** 16b2:1a1f: the logo's x, 0x13e at start, minus 4 per slide frame. */
const LOGO_X = 0x1a1f;
const SLIDE_FRAMES = 0x37;
const SLIDE_STEP = 4;
/** 0000:1232: the wobbling logo copies 0x3d words per row from x + table byte - 0x23. */
const WOBBLE_BYTES = 0x7a;
const WOBBLE_BASE = 0x6b5d;
/** 4d0c:0018 + 16b2:1a1d: the wobble table, one byte per logo row; 16b2:1a1d moves by a frame's 27 rows. */
const WOBBLE_TABLE = 0x18;
const WOBBLE_INDEX = 0x1a1d;
const WOBBLE_FRAMES = 0xfc;

/** The background's rows above the logo (0000:0b0a), below it (0b21) and those around the logo (0b3d). */
const TOP_BYTES = 0x6b80;
const BOTTOM_START = 0x8d40;
const BOTTOM_BYTES = 0x6cc0;
const MIDDLE_BYTES = 0x21c0;

/** 0000:0c12: the text area, rows 49..150 of the screen (a000:3d40), and its copy in the work buffer. */
const TEXT_AREA = 0x3d40;
const TEXT_AREA_BYTES = 0x7f80;
const TEXT_ROWS = 0x66;
/** The work buffer's second half: the text area with the text, made by 0000:0d4e and 0c81. */
const TEXT_PICTURE = 0x7f80;
const TEXT_LINES = 6;
const TEXT_COLUMNS = 0x13;
/** The text starts 8 pixels in; each text line is 17 screen rows below the previous one. */
const TEXT_LEFT = 8;
const TEXT_LINE_SKIP = 0x1410;
const CHAR_SIZE = 0x10;
/** 16b2:1ef8: the font, 16x16 characters at the offsets of 16b2:1b80 (demo.js buildBlockOffsets). */
const FONT = 0x1ef8;
const BLOCK_OFFSETS = 0x1b80;
const FIRST_CHAR = 0x20;
/** 16b2:1a28: the next character of the text (16b2:1a2a at start). */
const TEXT_POINTER = 0x1a28;
/** 16b2:1a27: added to the text's colour (shifted to the high nibble): 0x40, then 0, then 0x40. */
const TEXT_COLOUR = 0x1a27;
const TEXT_COLOUR_TOGGLE = 0x40;
const WIPE_FRAMES = 0x154;
const PAGE_HOLD_FRAMES = 0xe6;

/** 16b2:1a21, 1a23: the phases of the wipe edge's two waves; 1a25: the frames since the wipe started. */
const WAVE_A = 0x1a21;
const WAVE_B = 0x1a23;
const WIPE_FRAME = 0x1a25;
/** 16b2:5af8, 16b2:5b78: the two waves, 64 signed words each. */
const WAVE_A_TABLE = 0x5af8;
const WAVE_B_TABLE = 0x5b78;
const WAVE_MASK = 0x7f;
const WAVE_A_FRAME_STEP = 2;
const WAVE_B_FRAME_STEP = -2;
const WAVE_A_ROW_STEP = 2;
const WAVE_B_ROW_STEP = 6;
const WIPE_DELAY = 0x20;
const WIPE_LEFT = 4;
const WIPE_RIGHT = 0x13f;

/** 0000:0158: rows 85..115 lose the text (its high nibble). */
const UNTEXT_START = 0x6a40;
const UNTEXT_BYTES = 0x26c0;
const LOW_NIBBLE = 0x0f;

/** 0000:1147: the blur band, 16b2:5bf8 its step, 5bfa its screen offset, 5bfc its width (0: none). */
const BLUR_STEP = 0x5bf8;
const BLUR_AT = 0x5bfa;
const BLUR_WIDTH = 0x5bfc;
const BLUR_FRAMES = 0xde;
const BLUR_BAND = 0x20;
const BLUR_ENTER = 0x43;
const BLUR_FULL = 0x63;
const BLUR_LEAVE = 0xbd;
const BLUR_GONE = 0xdd;

/** 0000:0797: colour 4 turns white and four bars of it, 4x50, sweep across the screen. */
const BAR_COLOUR = 4;
const WHITE = 0x3f;
const BAR_FRAMES = 0x50;
const BAR_HEIGHT = 0x32;
const BAR_WIDTH = 4;
const BAR_ROWS = [0, 0x3e80, 0x7d00, 0xbb80];
const BAR_RIGHT = 0x13c;

/** A byte of segment:offset, the offset wrapping at 64 KB as in real mode. */
function at(segment, offset) {
  return linear(segment, offset & 0xffff);
}

/**
 * 0000:0b62 clears the work buffer, 0c00 loads the palette, 0af1 unpacks the background into the work buffer.
 * @param {Machine} m
 */
function prepare(m) {
  m.mem.fill(0, at(WORK, 0), at(WORK, 0) + SCREEN_BYTES);
  m.vga.dacLoad(0, m.mem, DATA + PALETTE, PALETTE_BYTES);
  let to = at(WORK, 0);
  for (let i = 0; i < BACKGROUND_PACKED_BYTES; i++) {
    const packed = m.u8(at(GFX, BACKGROUND_PACKED + i));
    for (let shift = 6; shift >= 0; shift -= 2) {
      m.mem[to++] = BACKGROUND_COLOURS[(packed >> shift) & 3];
    }
  }
}

/**
 * Copies `rows` rows of `width` bytes from linear `from` (stride `fromStride`) to a000:`to` (stride 320).
 * @param {Machine} m
 */
function copyToScreen(m, from, fromStride, to, width, rows) {
  for (let row = 0; row < rows; row++) {
    for (let x = 0; x < width; x++) {
      m.vga.write(to + x, m.mem[from + x]);
    }
    from += fromStride;
    to += SCREEN_WIDTH;
  }
}

/**
 * 0000:11ed: the logo 4 pixels further left, clipped at the screen's right edge. `width` is bx, which keeps its
 * value when the logo is whole: 0x9e from the last clipped frame, so the logo's last 2 columns are never drawn.
 * @param {Machine} m
 * @param {number} width
 * @returns {number} the width drawn
 */
function slideLogo(m, width) {
  const x = (m.u16(DATA + LOGO_X) - SLIDE_STEP) & 0xffff;
  m.set16(DATA + LOGO_X, x);
  const newWidth = x + LOGO_WIDTH > SCREEN_WIDTH ? SCREEN_WIDTH - x : width;
  copyToScreen(m, at(GFX, LOGO), LOGO_WIDTH, LOGO_TOP + x, newWidth, LOGO_HEIGHT);
  return newWidth;
}

/**
 * 0000:1232: the logo, each row shifted by the wobble table.
 * @param {Machine} m
 */
function wobbleLogo(m) {
  let table = WOBBLE_TABLE + m.u16(DATA + WOBBLE_INDEX);
  m.set16(DATA + WOBBLE_INDEX, m.u16(DATA + WOBBLE_INDEX) + LOGO_HEIGHT);
  let rowStart = WOBBLE_BASE + m.u16(DATA + LOGO_X);
  let from = LOGO;
  for (let row = 0; row < LOGO_HEIGHT; row++) {
    const to = m.u8(at(GFX, table)) + rowStart;
    table++;
    rowStart += SCREEN_WIDTH;
    for (let x = 0; x < WOBBLE_BYTES; x++) {
      m.vga.write((to + x) & 0xffff, m.u8(at(GFX, from + x)));
    }
    from += LOGO_WIDTH;
  }
}

/**
 * 0000:0b3d: the background around the logo, its colour-0 pixels transparent.
 * @param {Machine} m
 */
function drawBackgroundAroundLogo(m) {
  for (let i = 0; i < MIDDLE_BYTES; i++) {
    const colour = m.u8(at(WORK, LOGO_TOP + i));
    if (colour !== 0) {
      m.vga.write(LOGO_TOP + i, colour);
    }
  }
}

/** 0000:0b90: at these loop counts colours 14 and 15 (the background) change: [count, blue 14, blue 15]. */
const BACKGROUND_BRIGHTENING = [
  [0xfa, 0x0c, 0x0d],
  [0xf5, 0x0d, 0x0e],
  [0xf0, 0x0e, 0x0f],
  [0xeb, 0x0e, 0x10],
  [0xe6, 0x0f, 0x11],
];

/**
 * 0000:0b90.
 * @param {Machine} m
 * @param {number} count the loop counter cx, 0xfc down to 1
 */
function brightenBackground(m, count) {
  m.vga.out8(0x3c8, 0x0e);
  for (const [atCount, blue14, blue15] of BACKGROUND_BRIGHTENING) {
    if (count === atCount) {
      for (const component of [0, 0, blue14, 0, 0, blue15]) {
        m.vga.out8(0x3c9, component);
      }
    }
  }
}

/**
 * 0000:0c5f: the text area of the screen to `segment`:0000.
 * @param {Machine} m
 */
function saveTextArea(m, segment) {
  const to = at(segment, 0);
  for (let i = 0; i < TEXT_AREA_BYTES; i++) {
    m.mem[to + i] = m.vga.read(TEXT_AREA + i);
  }
}

/**
 * 0000:0d4e: 6 lines of 19 characters of the text, from 16b2:1a28 on, into the cleared work buffer's second half.
 * @param {Machine} m
 */
function drawTextLines(m) {
  let text = m.u16(DATA + TEXT_POINTER);
  let to = TEXT_PICTURE + TEXT_LEFT;
  for (let line = 0; line < TEXT_LINES; line++) {
    for (let column = 0; column < TEXT_COLUMNS; column++) {
      const index = (m.u8(DATA + text) - FIRST_CHAR) & 0xff;
      const from = (FONT + m.u16(DATA + ((BLOCK_OFFSETS + index * 2) & 0xffff))) & 0xffff;
      for (let row = 0; row < CHAR_SIZE; row++) {
        for (let x = 0; x < CHAR_SIZE; x++) {
          m.mem[at(WORK, to + row * SCREEN_WIDTH + x)] = m.u8(DATA + ((from + row * SCREEN_WIDTH + x) & 0xffff));
        }
      }
      to += CHAR_SIZE;
      text++;
    }
    to += TEXT_LINE_SKIP;
  }
  m.set16(DATA + TEXT_POINTER, text);
}

/**
 * 0000:0c1c..0c2b: the screen's text area becomes the "before" picture, then the "after" picture is the text in the
 * high nibble plus 16b2:1a27, xor the screen saved without text.
 * @param {Machine} m
 */
function prepareTextPage(m) {
  saveTextArea(m, WORK); // 0c22
  m.mem.fill(0, at(WORK, TEXT_PICTURE), at(WORK, TEXT_PICTURE) + TEXT_AREA_BYTES); // 0c71
  drawTextLines(m); // 0d4e
  const add = m.u8(DATA + TEXT_COLOUR); // 0c81
  for (let i = 0; i < TEXT_AREA_BYTES; i++) {
    const to = at(WORK, TEXT_PICTURE + i);
    m.mem[to] = (((m.mem[to] << 4) + add) & 0xff) ^ m.u8(at(SAVED, i));
  }
}

/**
 * 0000:0d17: the wipe edge's x on the next row (ax, dx: the two wave phases).
 * @param {Machine} m
 * @param {WavePhases} waves
 */
function wipeEdge(m, waves) {
  waves.a = (waves.a + WAVE_A_ROW_STEP) & WAVE_MASK;
  waves.b = (waves.b + WAVE_B_ROW_STEP) & WAVE_MASK;
  const sum = m.u16(DATA + WAVE_B_TABLE + waves.b) + m.u16(DATA + WAVE_A_TABLE + waves.a) + m.u16(DATA + WIPE_FRAME);
  const edge = (((sum - WIPE_DELAY) & 0xffff) << 16) >> 16;
  if (edge <= WIPE_LEFT) {
    return WIPE_LEFT;
  }
  return edge > WIPE_RIGHT ? WIPE_RIGHT : edge;
}

/**
 * 0000:0ca8: one frame of the wipe: on each row, 8 pixels at the edge from the "before" picture, then the 4 left of
 * the edge from the "after" one.
 * @param {Machine} m
 */
function wipeText(m) {
  m.set16(DATA + WIPE_FRAME, m.u16(DATA + WIPE_FRAME) + 1); // 0cf5
  const waves = {
    a: (m.u16(DATA + WAVE_A) + WAVE_A_FRAME_STEP) & WAVE_MASK,
    b: (m.u16(DATA + WAVE_B) + WAVE_B_FRAME_STEP) & WAVE_MASK,
  };
  m.set16(DATA + WAVE_A, waves.a);
  m.set16(DATA + WAVE_B, waves.b);
  for (let row = 0; row < TEXT_ROWS; row++) {
    const x = wipeEdge(m, waves) - 4;
    const offset = row * SCREEN_WIDTH + x;
    for (let i = 0; i < 8; i++) {
      m.vga.write(TEXT_AREA + offset + i, m.u8(at(WORK, offset + i)));
    }
    for (let i = 0; i < 4; i++) {
      m.vga.write(TEXT_AREA + offset + i, m.u8(at(WORK, TEXT_PICTURE + offset + i)));
    }
  }
}

/**
 * 0000:0c1c..0c3b: prepare a page, then wipe it in over 0x154 frames.
 * @param {Machine} m
 */
function* textPage(m) {
  prepareTextPage(m);
  for (let i = 0; i < WIPE_FRAMES; i++) {
    yield* waitFrame(m);
    wipeText(m);
  }
}

/**
 * 0000:0c3d: hold the page, then wipe the next one with the other text colour.
 * @param {Machine} m
 */
function* nextTextPage(m) {
  for (let i = 0; i < PAGE_HOLD_FRAMES; i++) {
    yield* waitFrame(m);
  }
  m.set16(DATA + WIPE_FRAME, 0);
  m.set8(DATA + TEXT_COLOUR, m.u8(DATA + TEXT_COLOUR) === TEXT_COLOUR_TOGGLE ? 0 : TEXT_COLOUR_TOGGLE);
  yield* textPage(m);
}

/**
 * 0000:11b7: a screen pixel blurred: center * 254/256 plus a quarter of its 8 neighbours' byte sum, over 256.
 * @param {Machine} m
 */
function blurredPixel(m, offset) {
  let sum = 0;
  for (const neighbour of [-0x141, -0x140, -0x13f, -1, 1, 0x13f, 0x140, 0x141]) {
    sum = (sum + m.vga.read((offset + neighbour) & 0xffff)) & 0xff;
  }
  const centre = m.vga.read(offset);
  return ((centre * 254 + (sum >> 2)) >> 8) & 0xff;
}

/**
 * 0000:1147: the next position of the blur band (it enters at the logo's x 0x63, grows to 32 pixels, moves right,
 * shrinks and leaves at 0xdd); blurs the screen under it into the work buffer.
 * @param {Machine} m
 */
function blurBand(m) {
  const step = (m.u16(DATA + BLUR_STEP) + 1) & 0xffff;
  m.set16(DATA + BLUR_STEP, step);
  m.set16(DATA + BLUR_WIDTH, 0);
  if (step <= BLUR_ENTER || step >= BLUR_GONE) {
    return;
  }
  let x = step;
  let width = BLUR_BAND;
  if (step < BLUR_FULL) {
    width = step - BLUR_ENTER;
    x = BLUR_FULL;
  } else if (step > BLUR_LEAVE) {
    width = BLUR_GONE - step;
  }
  const start = LOGO_TOP + x;
  m.set16(DATA + BLUR_AT, start);
  m.set16(DATA + BLUR_WIDTH, width);
  let to = at(WORK, 0);
  for (let row = 0; row < LOGO_HEIGHT; row++) {
    for (let i = 0; i < width; i++) {
      m.mem[to++] = blurredPixel(m, start + row * SCREEN_WIDTH + i);
    }
  }
}

/**
 * 0000:1119: the blurred band to the screen.
 * @param {Machine} m
 */
function drawBlurBand(m) {
  const width = m.u16(DATA + BLUR_WIDTH);
  if (width === 0) {
    return;
  }
  copyToScreen(m, at(WORK, 0), width, m.u16(DATA + BLUR_AT), width, LOGO_HEIGHT);
}

/**
 * 0000:07e2: a 4x50 bar of colour 4.
 * @param {Machine} m
 */
function drawBar(m, offset) {
  for (let row = 0; row < BAR_HEIGHT; row++) {
    for (let x = 0; x < BAR_WIDTH; x++) {
      m.vga.write((offset + row * SCREEN_WIDTH + x) & 0xffff, BAR_COLOUR);
    }
  }
}

/**
 * 0000:0797: colour 4 turns white; bars sweep right on rows 0 and 100, left on rows 50 and 150.
 * @param {Machine} m
 */
function* whiteBars(m) {
  m.vga.out8(0x3c8, BAR_COLOUR);
  for (let i = 0; i < 3; i++) {
    m.vga.out8(0x3c9, WHITE);
  }
  for (let i = 0; i < BAR_FRAMES; i++) {
    yield* waitFrame(m);
    const right = i * BAR_WIDTH;
    const left = BAR_RIGHT - i * BAR_WIDTH;
    BAR_ROWS.forEach((rowStart, bar) => drawBar(m, rowStart + (bar % 2 === 0 ? right : left)));
  }
}

/**
 * 0000:010e..0124: the logo slides in.
 * @param {Machine} m
 */
function* logoEntrance(m) {
  prepare(m);
  let width = 0;
  for (let i = 0; i < SLIDE_FRAMES; i++) {
    yield* waitFrame(m); // 011b
    width = slideLogo(m, width);
  }
}

/**
 * 0000:0124..014d: the background appears in three bands, then the logo wobbles while it brightens.
 * @param {Machine} m
 */
function* logoWobble(m) {
  const work = at(WORK, 0);
  const bands = [
    () => copyToScreen(m, work, TOP_BYTES, 0, TOP_BYTES, 1), // 0b0a
    () => copyToScreen(m, work + BOTTOM_START, BOTTOM_BYTES, BOTTOM_START, BOTTOM_BYTES, 1), // 0b21
    () => drawBackgroundAroundLogo(m), // 0b3d
  ];
  for (const drawBand of bands) {
    yield* waitFrame(m);
    wobbleLogo(m);
    drawBand();
  }
  for (let count = WOBBLE_FRAMES; count > 0; count--) {
    yield* waitFrame(m); // 0143
    brightenBackground(m, count);
    wobbleLogo(m);
  }
}

/**
 * 0000:0158: the text's high nibble off on rows 85..115.
 * @param {Machine} m
 */
function removeTextAroundLogo(m) {
  for (let i = 0; i < UNTEXT_BYTES; i++) {
    m.vga.write(UNTEXT_START + i, m.vga.read(UNTEXT_START + i) & LOW_NIBBLE);
  }
}

/**
 * Main script 010e..0180.
 * @param {Machine} m
 */
export function* razorText(m) {
  yield* logoEntrance(m);
  yield* logoWobble(m);
  saveTextArea(m, SAVED); // 0c19
  yield* textPage(m); // 0c12
  yield* nextTextPage(m); // 0c3d
  yield* nextTextPage(m); // 0c3d
  removeTextAroundLogo(m);
  for (let i = 0; i < BLUR_FRAMES; i++) {
    blurBand(m); // 016f
    yield* waitFrame(m);
    drawBlurBand(m); // 0175
    yield* waitFrame(m);
  }
  yield* whiteBars(m); // 017e
}
