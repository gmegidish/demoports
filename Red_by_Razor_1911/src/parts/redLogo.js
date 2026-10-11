// Main script 0000:008a..010d: the RED graffiti logo on a stone wall, built piece by piece, then a red glass ball
// rolling over it, and the tiled wipe to the next part. docs/disassembly/B_redLogo.md.
import { DATA, linear, waitFrame } from '../machine.js';

/** @typedef {import('../machine.js').Machine} Machine */
/** @typedef {{ source: Int32Array, add: Uint8Array, dest: Int32Array }} RefractionTable */

const SCREEN_WIDTH = 320;
const SCREEN_BYTES = 0xfa00;
const DAC_WRITE_INDEX = 0x3c8;
const DAC_DATA = 0x3c9;

/** 4018: the pictures of the logo screen (palette, wall bar, pillar, pedestal, logo). */
const PICTURES = 0x4018;
const PALETTE_AT = 0x0000;
/** 095d: the 320x40 wall bar at rows 136..175. */
const BAR_AT = 0x0300;
const BAR_SCREEN = 0xaa00;
const BAR_ROWS = 0x28;
const BAR_START = 0x140;
const BAR_STEP = 4;
/** 092e: the 44x142 pillar at x 229, dropping from the top. */
const PILLAR_AT = 0x3500;
const PILLAR_SCREEN = 0xe5;
const PILLAR_WIDTH = 0x2c;
const PILLAR_ROWS = 0x8e;
const PILLAR_SOURCE_START = 0x183c;
const PILLAR_STEP_ROWS = 3;
/** 0908: the 91x23 pedestal at x 229, rising from the bottom. */
const PEDESTAL_AT = 0x4d68;
const PEDESTAL_WIDTH = 0x5b;
const PEDESTAL_SCREEN_START = 0xfc25;
const PEDESTAL_STEP = 0x3c0;
const PEDESTAL_FIRST_ROWS = 2;
const PEDESTAL_END_ROWS = 0x1a;
const PEDESTAL_STEP_ROWS = 3;
/** 08c7: the 229-wide logo picture, its window grows up and left from (229, 136). */
const LOGO_AT = 0x5595;
const LOGO_PITCH = 0xe5;
const LOGO_SCREEN_START = 0xa9a1;
const LOGO_SCREEN_STEP = 0x3c5;
const LOGO_FIRST_WIDTH = 4;
const LOGO_WIDTH_STEP = 5;
const LOGO_END_ROWS = 0x8b;
const LOGO_STEP_ROWS = 3;

/** 098a: 3028 keeps the finished screen as the ball's background, padded with colour 0x0f below. */
const BACKGROUND = 0x3028;
const BACKGROUND_COPY_BYTES = 0xaa00;
const BACKGROUND_PAD_BYTES = 0x4ec0;
const BACKGROUND_PAD = 0x0f;

/** 0aa4: the unrolled refraction routine 0000:1280..996d. */
const REFRACTION_CODE = 0x1280;
const OPCODE_LOAD = [0x8a, 0x84]; // mov al, [si + imm16]
const OPCODE_ADD = 0x04; // add al, imm8
const OPCODE_STORE = [0x26, 0x88, 0x85]; // mov es:[di + imm16], al
const OPCODE_RET = 0xc3;
const BLOCK_BYTES = 11;

/** The ball's variables in 16b2. */
const V = {
  X_INDEX: 0x5bfe,
  Y_INDEX: 0x5c00,
  SCREEN: 0x5c02,
  ROWS: 0x5c04,
  ROWS_BYTES: 0x5c06,
};
/** 16b2:5c08: the 72x72 ball buffer. */
const BALL_BUFFER = 0x5c08;
const BALL_SIZE = 0x48;
const BALL_LOOPS = 0x4ea;
const X_TABLE = 0x7048;
const Y_TABLE = 0x7448;
const ENTRY_TABLE = 0x7848;
const TABLE_MASK = 0x3ff;
const ENTER_UNTIL = 0x426;
const LEAVE_FROM = 0xc4;
const Y_BIAS = 4;
const Y_CLIP = 0x40;
const Y_BOTTOM = 0x84;
const ROWS_LIMIT = 0x88;
const X_BIAS = 0x10;

/** 07f1: the wipe. */
const WIPE_DARK = 0x20;
const WIPE_FILL = 0x21;
/** 07f2: colours 0x20 and 0x21, written in one run from 3c8 = 0x20. */
const WIPE_COLOURS = [0x00, 0x01, 0x0b, 0x05, 0x08, 0x08];
const TILES = 0x4d0c;
const TILE_AT = 0x2bf8;
const TILE_WIDTH = 0x28;
const TILE_LAST_LINE = 0x618;
const TILES_PER_ROW = 8;
const WIPE_FRAMES = 0x19;
const ROWS_PER_FRAME = 8;
const WIPE_BOTTOM_ROW = 0xf8c0;
const TILE_PALETTE_FRAMES = 8;
const FILL_START = 0xf000;
const FILL_BYTES = 0xa00;

/** @param {Machine} m */
function word(m, variable) {
  return m.u16(DATA + variable);
}

/** @param {Machine} m */
function setWord(m, variable, value) {
  m.set16(DATA + variable, value & 0xffff);
}

/** `rep movs` of `count` bytes from seg:offset to the screen at `di`. */
function copyToScreen(m, segment, si, di, count) {
  for (let i = 0; i < count; i++) {
    m.vga.write((di + i) & 0xffff, m.mem[linear(segment, (si + i) & 0xffff)]);
  }
}

/** 08ac: the 768-byte palette at 4018:0000 to the DAC. */
function loadPalette(m) {
  m.vga.dacLoad(0, m.mem, linear(PICTURES, PALETTE_AT), 0x300);
}

/** 095d: the wall bar, its left `320 - shift` columns at x = shift. */
function drawBar(m, shift) {
  let si = BAR_AT;
  let di = BAR_SCREEN + shift;
  for (let row = 0; row < BAR_ROWS; row++) {
    copyToScreen(m, PICTURES, si, di, SCREEN_WIDTH - shift);
    si += SCREEN_WIDTH;
    di += SCREEN_WIDTH;
  }
}

/** 092e: the bottom `rows` rows of the pillar (from 4018:3500 + source) at the top of the screen. */
function drawPillar(m, source, rows) {
  let si = PILLAR_AT + source;
  let di = PILLAR_SCREEN;
  for (let row = 0; row < rows; row++) {
    copyToScreen(m, PICTURES, si, di, PILLAR_WIDTH);
    si += PILLAR_WIDTH;
    di += SCREEN_WIDTH;
  }
}

/** 0908: the top `rows` rows of the pedestal at screen offset `di`. */
function drawPedestal(m, di, rows) {
  let si = PEDESTAL_AT;
  for (let row = 0; row < rows; row++) {
    copyToScreen(m, PICTURES, si, di + row * SCREEN_WIDTH, PEDESTAL_WIDTH);
    si += PEDESTAL_WIDTH;
  }
}

/** 08c7: the top-left `width` x `rows` of the logo picture at screen offset `di`. */
function drawLogo(m, di, rows, width) {
  let si = LOGO_AT;
  for (let row = 0; row < rows; row++) {
    copyToScreen(m, PICTURES, si, di + row * SCREEN_WIDTH, width);
    si += LOGO_PITCH;
  }
}

/** 008a..00e5: the palette, then the wall bar, the pillar, the pedestal and the logo slide in. */
function* buildScreen(m) {
  loadPalette(m); // 008a
  for (let shift = BAR_START - BAR_STEP; shift >= 0; shift -= BAR_STEP) { // 008d
    yield* waitFrame(m);
    drawBar(m, shift);
  }
  let source = PILLAR_SOURCE_START; // 009e
  for (let cx = PILLAR_ROWS - 1 - PILLAR_STEP_ROWS; cx >= 0; cx -= PILLAR_STEP_ROWS) {
    yield* waitFrame(m);
    source -= PILLAR_WIDTH * PILLAR_STEP_ROWS;
    drawPillar(m, source, PILLAR_ROWS - cx);
  }
  let pedestal = PEDESTAL_SCREEN_START; // 00b2
  for (let rows = PEDESTAL_FIRST_ROWS; rows !== PEDESTAL_END_ROWS; rows += PEDESTAL_STEP_ROWS) {
    yield* waitFrame(m);
    pedestal = (pedestal - PEDESTAL_STEP) & 0xffff;
    drawPedestal(m, pedestal, rows);
  }
  let logo = LOGO_SCREEN_START; // 00c6
  let width = LOGO_FIRST_WIDTH;
  for (let rows = 1; rows !== LOGO_END_ROWS; rows += LOGO_STEP_ROWS) {
    yield* waitFrame(m);
    drawLogo(m, logo, rows, width);
    logo -= LOGO_SCREEN_STEP;
    width += LOGO_WIDTH_STEP;
  }
}

/** 098a: the screen's first 136 rows to 3028:0000, then the padding. */
function saveBackground(m) {
  const at = linear(BACKGROUND, 0);
  for (let i = 0; i < BACKGROUND_COPY_BYTES; i++) {
    m.mem[at + i] = m.vga.read(i);
  }
  m.mem.fill(BACKGROUND_PAD, at + BACKGROUND_COPY_BYTES, at + BACKGROUND_COPY_BYTES + BACKGROUND_PAD_BYTES);
}

/**
 * 1280..996d is 3140 blocks `mov al, [si + source]; add al, add; mov es:[di + dest], al`: one ball pixel each,
 * the background pixel it refracts, shifted to the ball's palette band. Read from the code bytes.
 * @param {Machine} m
 * @returns {RefractionTable}
 */
function decodeRefraction(m) {
  const blocks = [];
  let at = REFRACTION_CODE;
  while (m.mem[at] !== OPCODE_RET) {
    const isBlock = m.mem[at] === OPCODE_LOAD[0] && m.mem[at + 1] === OPCODE_LOAD[1] && m.mem[at + 4] === OPCODE_ADD
      && m.mem[at + 6] === OPCODE_STORE[0] && m.mem[at + 7] === OPCODE_STORE[1] && m.mem[at + 8] === OPCODE_STORE[2];
    if (!isBlock) {
      throw new Error(`redLogo: unexpected instruction at 0000:${at.toString(16)}`);
    }
    blocks.push([m.u16(at + 2), m.mem[at + 5], m.u16(at + 9)]);
    at += BLOCK_BYTES;
  }
  return {
    source: Int32Array.from(blocks, (b) => b[0]),
    add: Uint8Array.from(blocks, (b) => b[1]),
    dest: Int32Array.from(blocks, (b) => b[2]),
  };
}

/** 09a8 part 1: the ball's y (16-bit), from the bounce table plus the entry/exit drop. */
function ballY(m, cx) {
  const index = (word(m, V.Y_INDEX) + 4) & TABLE_MASK;
  setWord(m, V.Y_INDEX, index);
  let y = m.u16(DATA + Y_TABLE + index);
  if (cx > ENTER_UNTIL) {
    y += m.u16(DATA + ENTRY_TABLE + (BALL_LOOPS - cx) * 2);
  } else if (cx < LEAVE_FROM) {
    y += m.u16(DATA + ENTRY_TABLE + cx * 2);
  }
  return (y + Y_BIAS) & 0xffff;
}

/** 09a8: moves the ball: its screen offset (5c02) and how many of its rows are above the bottom (5c04). */
function moveBall(m, cx) {
  setWord(m, V.ROWS, BALL_SIZE);
  setWord(m, V.ROWS_BYTES, BALL_SIZE * SCREEN_WIDTH);
  let y = ballY(m, cx);
  if (y >= Y_CLIP) {
    if (y >= Y_BOTTOM) {
      y = Y_BOTTOM;
      setWord(m, V.ROWS, 0);
      setWord(m, V.ROWS_BYTES, 0);
    } else {
      setWord(m, V.ROWS, ROWS_LIMIT - y);
      setWord(m, V.ROWS_BYTES, (ROWS_LIMIT - y) * SCREEN_WIDTH);
    }
  }
  const index = (word(m, V.X_INDEX) + 2) & TABLE_MASK;
  setWord(m, V.X_INDEX, index);
  setWord(m, V.SCREEN, y * SCREEN_WIDTH + m.u16(DATA + X_TABLE + index) + X_BIAS);
}

/** 0a43: the 72x72 background under the ball to the buffer 16b2:5c08. */
function copyBackground(m) {
  let si = word(m, V.SCREEN);
  let di = DATA + BALL_BUFFER;
  for (let row = 0; row < BALL_SIZE; row++) {
    for (let x = 0; x < BALL_SIZE; x++) {
      m.mem[di++] = m.mem[linear(BACKGROUND, (si + x) & 0xffff)];
    }
    si += SCREEN_WIDTH;
  }
}

/** 0a8f / 1280: the ball's pixels into the buffer, refracted from the background. */
function refract(m, table) {
  const si = word(m, V.SCREEN);
  for (let i = 0; i < table.source.length; i++) {
    const pixel = (m.mem[linear(BACKGROUND, (si + table.source[i]) & 0xffff)] + table.add[i]) & 0xff;
    m.mem[DATA + ((BALL_BUFFER + table.dest[i]) & 0xffff)] = pixel;
  }
}

/** 0a6b: the buffer's first 5c04 rows to the screen at 5c02. */
function drawBall(m) {
  const di = word(m, V.SCREEN);
  const rows = word(m, V.ROWS);
  for (let row = 0; row < rows; row++) {
    for (let x = 0; x < BALL_SIZE; x++) {
      m.vga.write((di + row * SCREEN_WIDTH + x) & 0xffff, m.mem[DATA + BALL_BUFFER + row * BALL_SIZE + x]);
    }
  }
}

/** 00e7..0106: the ball rolls for 0x4ea frames. */
function* rollBall(m) {
  saveBackground(m); // 00e7
  const table = decodeRefraction(m);
  moveBall(m, BALL_LOOPS); // 00f2
  for (let cx = BALL_LOOPS; cx > 0; cx--) {
    moveBall(m, cx); // 00f6
    copyBackground(m); // 00f9
    refract(m, table); // 00fc
    yield* waitFrame(m); // 00ff
    drawBall(m); // 0102
  }
}

/** 07f1 first half: black turns to colour 0x21, then 40x40 tiles cover the screen from the bottom, 8 rows a frame. */
function* tileScreen(m) {
  m.vga.dacLoad(WIPE_DARK, WIPE_COLOURS, 0, WIPE_COLOURS.length);
  yield* waitFrame(m);
  for (let i = 0; i < SCREEN_BYTES; i++) {
    if (m.vga.read(i) === 0) {
      m.vga.write(i, WIPE_FILL);
    }
  }
  let di = WIPE_BOTTOM_ROW;
  let line = TILE_LAST_LINE;
  for (let frame = 0; frame < WIPE_FRAMES; frame++) {
    yield* waitFrame(m);
    for (let row = 0; row < ROWS_PER_FRAME; row++) {
      for (let tile = 0; tile < TILES_PER_ROW; tile++) {
        copyToScreen(m, TILES, TILE_AT + line, di + tile * TILE_WIDTH, TILE_WIDTH);
      }
      line -= TILE_WIDTH;
      di -= SCREEN_WIDTH;
      if (line < 0) {
        line = TILE_LAST_LINE;
      }
    }
  }
}

/** 07f1 second half: colour 0 steps through 8 colours at 4d0c:0000, then colour 0x20 fills the screen bottom up. */
function* fadeOut(m) {
  for (let frame = 0; frame < TILE_PALETTE_FRAMES; frame++) {
    yield* waitFrame(m);
    m.vga.dacLoad(0, m.mem, linear(TILES, frame * 3), 3);
  }
  let di = FILL_START;
  for (let frame = 0; frame < WIPE_FRAMES; frame++) {
    yield* waitFrame(m);
    for (let i = 0; i < FILL_BYTES; i++) {
      m.vga.write(di + i, WIPE_DARK);
    }
    di -= FILL_BYTES;
  }
}

/** 0598: clears the screen. */
function clearScreen(m) {
  for (let i = 0; i < SCREEN_BYTES; i++) {
    m.vga.write(i, 0);
  }
}

/** Main script 0000:008a..010d. @param {Machine} m */
export function* redLogo(m) {
  yield* buildScreen(m);
  yield* rollBall(m);
  yield* tileScreen(m); // 0108
  yield* fadeOut(m);
  clearScreen(m); // 010b
}
