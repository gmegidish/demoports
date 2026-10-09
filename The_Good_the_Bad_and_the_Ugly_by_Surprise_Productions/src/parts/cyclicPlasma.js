// The cyclic plasma (Erik), 0cc5:0139. docs/disassembly/G3_plasma_morph_chess.md, section 2.
//
// Three windows of the 'plasma' picture (a radial field) are added byte by byte and drawn into the unchained page
// that is not shown (pages at 0 and 3e80h); each byte covers 2 pixels (map mask 3: planes 0-1, then map mask 0ch:
// planes 2-3 from the picture's right half). The windows move by the 'p75_data' tables, one step per elapsed
// retrace. The palette fades in from white, and after music sync 4 out to black.
import { linear, waitTick } from '../machine.js';
import { interpolatePalette, setDac } from '../library.js';

const SEGMENT = 0x0cc5;
const VARIABLES = linear(SEGMENT, 0);
const PICTURE_POINTER = VARIABLES + 0x00;
const TABLES_POINTER = VARIABLES + 0x02;
/** cs:[18],[1a],[1c]: X1..X3; cs:[1e],[20],[22]: Y1..Y3 times 320. */
const WINDOW_X = [0x18, 0x1a, 0x1c].map((offset) => VARIABLES + offset);
const WINDOW_Y = [0x1e, 0x20, 0x22].map((offset) => VARIABLES + offset);
/** cs:[24],[28],[2c]: X table indices; cs:[26],[2a],[2e]: Y table indices. */
const X_INDEX = [0x24, 0x28, 0x2c].map((offset) => VARIABLES + offset);
const Y_INDEX = [0x26, 0x2a, 0x2e].map((offset) => VARIABLES + offset);
const X_STEPS = [4, 4, 2];
const Y_STEPS = [4, 6, 4];
const PAGE = VARIABLES + 0x30;
const ELAPSED = VARIABLES + 0x132;
const BUFFER_POINTER = VARIABLES + 0x134;
const STATE = VARIABLES + 0x136;
const FADE_STEP = VARIABLES + 0x137;
const FADE_DIVIDER = VARIABLES + 0x138;

const X_TABLE = 0x180;
const Y_TABLE = 0x400;
const TABLE_WRAP = 0x280;
const PICTURE_STRIDE = 320;
const RIGHT_HALF = 0xa0;
const BUFFER_PARAGRAPHS = 0x64;
const PALETTE_BYTES = 0x180;
const WHITE_PALETTE = 0x180;
const BLACK_PALETTE = 0x300;
const WORK_PALETTE = 0x480;
const COLOURS = 0x80;
const FADE_STEPS = 0x46;
const PAGE_TOGGLE = 0x3e80;
const ROWS = 0x64;
const ROW_BYTES = 0x50;
const SOURCE_SKIP = 0xf0;
const STATE_FADE_IN = 1;
const STATE_FADE_OUT = 2;
const SYNC_TO_FADE_OUT = 4;
const WHITE = 0x3f;

const SEQUENCER_INDEX = 0x3c4;
const CRTC_INDEX = 0x3d4;
const DAC_WRITE_INDEX = 0x3c8;
const DAC_DATA = 0x3c9;
const MAP_MASK_LOW_PLANES = 0x0302;
const MAP_MASK_HIGH_PLANES = 0x0c02;

/** 0036: reads the six window positions, then advances the table indices. */
function stepWindows(m) {
  const tables = linear(m.u16(TABLES_POINTER), 0);
  for (let i = 0; i < 3; i++) {
    m.set16(WINDOW_X[i], m.u16(tables + X_TABLE + m.u16(X_INDEX[i])));
    m.set16(X_INDEX[i], (m.u16(X_INDEX[i]) + X_STEPS[i]) % TABLE_WRAP);
    const y = m.u16(tables + Y_TABLE + m.u16(Y_INDEX[i]));
    m.set16(WINDOW_Y[i], (y * PICTURE_STRIDE) & 0xffff);
    m.set16(Y_INDEX[i], (m.u16(Y_INDEX[i]) + Y_STEPS[i]) % TABLE_WRAP);
  }
}

/** 0222..02c1: one half of the page: 100 rows of 80 bytes, each the 8-bit sum of the three windows. */
function drawHalf(m, page, extra) {
  const vga = m.vga;
  const picture = linear(m.u16(PICTURE_POINTER), 0);
  const mem = m.mem;
  let si = (m.u16(WINDOW_Y[0]) + m.u16(WINDOW_X[0]) + extra) & 0xffff;
  let bx = (m.u16(WINDOW_Y[1]) + m.u16(WINDOW_X[1]) + extra) & 0xffff;
  let bp = (m.u16(WINDOW_Y[2]) + m.u16(WINDOW_X[2]) + extra) & 0xffff;
  let di = page;
  for (let row = 0; row < ROWS; row++) {
    for (let k = 0; k < ROW_BYTES; k++) {
      vga.write(di, (mem[picture + si] + mem[picture + bx] + mem[picture + bp]) & 0xff);
      di = (di + 1) & 0xffff;
      si = (si + 1) & 0xffff;
      bx = (bx + 1) & 0xffff;
      bp = (bp + 1) & 0xffff;
    }
    si = (si + SOURCE_SKIP) & 0xffff;
    bx = (bx + SOURCE_SKIP) & 0xffff;
    bp = (bp + SOURCE_SKIP) & 0xffff;
  }
}

/** 0cc5:0139. */
export function* cyclicPlasma(m) {
  const vga = m.vga;
  vga.out8(DAC_WRITE_INDEX, 0);
  for (let i = 0; i < 0x300; i++) {
    vga.out8(DAC_DATA, WHITE);
  }
  const buffer = linear(m.allocTo(BUFFER_POINTER, BUFFER_PARAGRAPHS), 0);
  const tables = linear(m.u16(TABLES_POINTER), 0);
  m.mem.copyWithin(buffer, tables, tables + PALETTE_BYTES);
  m.mem.fill(WHITE, buffer + WHITE_PALETTE, buffer + WHITE_PALETTE + PALETTE_BYTES);
  m.mem.fill(0, buffer + BLACK_PALETTE, buffer + BLACK_PALETTE + PALETTE_BYTES);
  vga.out8(CRTC_INDEX, 9);
  vga.out8(CRTC_INDEX + 1, (vga.in8(CRTC_INDEX + 1) & 0xe0) | 1);
  stepWindows(m);
  m.set8(STATE, STATE_FADE_IN);
  for (;;) {
    const page = m.u16(PAGE);
    vga.out16(CRTC_INDEX, (page & 0xff00) | 0x0c);
    vga.out16(CRTC_INDEX, ((page & 0xff) << 8) | 0x0d);
    const state = m.u8(STATE);
    if (state !== 0) {
      const from = state === STATE_FADE_IN ? buffer + WHITE_PALETTE : buffer;
      const to = state === STATE_FADE_IN ? buffer : buffer + BLACK_PALETTE;
      interpolatePalette(m, COLOURS, from, to, buffer + WORK_PALETTE, m.u8(FADE_STEP), FADE_STEPS);
    }
    yield* waitTick(m);
    if (state !== 0) {
      setDac(m, 0, COLOURS, buffer + WORK_PALETTE);
      setDac(m, COLOURS, COLOURS, buffer + WORK_PALETTE);
    }
    m.set16(PAGE, m.u16(PAGE) ^ PAGE_TOGGLE);
    vga.out16(SEQUENCER_INDEX, MAP_MASK_LOW_PLANES);
    drawHalf(m, m.u16(PAGE), 0);
    vga.out16(SEQUENCER_INDEX, MAP_MASK_HIGH_PLANES);
    drawHalf(m, m.u16(PAGE), RIGHT_HALF);
    // 02c3: int 21h ah=0Bh, a key ends the effect (not in the port).
    const elapsed = m.frameCounter; // 08d8:157e
    m.set16(ELAPSED, elapsed);
    for (let i = 0; i < elapsed; i++) {
      stepWindows(m);
      advanceFade(m);
    }
    if (m.musicSync >= SYNC_TO_FADE_OUT) {
      if (m.u8(STATE) === STATE_FADE_IN) {
        m.set8(STATE, STATE_FADE_OUT);
        m.set8(FADE_STEP, 0);
      }
      if (m.u8(FADE_STEP) === FADE_STEPS) {
        return;
      }
    }
  }
}

/** 02d9..0304: the fade step: every step while fading in, every 4th while fading out, up to 70. */
function advanceFade(m) {
  const state = m.u8(STATE);
  if (state === 0) {
    return;
  }
  if (state !== STATE_FADE_IN) {
    m.set8(FADE_DIVIDER, (m.u8(FADE_DIVIDER) + 1) & 3);
    if (m.u8(FADE_DIVIDER) !== 0) {
      return;
    }
  }
  if (m.u8(FADE_STEP) < FADE_STEPS) {
    m.set8(FADE_STEP, m.u8(FADE_STEP) + 1);
  }
}
