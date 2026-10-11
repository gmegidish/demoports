// Part 6, 0x100cd5 (main runs it up to song position 0x14): a plasma made of a 256x256 picture looked up through
// a sine table, with Mickey and the "Die Super Maus" sign on top; at the end of the last pattern the screen goes
// black through a mask picture (docs/disassembly/C_plasma_rings.md).
import { RETRACES, POSITION, ROW, copyToScreen, setPalette, waitRetrace } from '../machine.js';

/** @typedef {import('../machine.js').Machine} Machine */

const SCREEN_WIDTH = 0x140;
const SCREEN_HEIGHT = 0xc8;
const SCREEN_BYTES = 0xfa00;
/** [0x12bd80], the frame buffer every part renders into. */
const BUFFER = 0x12bd80;

/** 0x16df90: 256 bytes, trunc(sin(i * pi / 128) * 30) (0x100bff). */
const SINE = 0x16df90;
const SINE_AMPLITUDE = 0x127268;
const SINE_STEP = 0x127260;
const PI = 0x127258;
/** [0x12c094]: the plasma's 256x256 picture; its palette at 0x12c098. */
const PLASMA_PICTURE = 0x12c094;
const PLASMA_PALETTE = 0x12c098;
const PLASMA_PICTURE_BYTES = 0x10000;
/** 0x100c50: the plasma picture moves up to colours 60.. ; its first 30 colours are copied there. */
const PLASMA_COLOUR_OFFSET = 0x3c;
const PLASMA_COLOUR_BYTES = 0x5a;
/** [0x12bd90]: Mickey and the sign, 320x200; its palette at 0x12bd94 (128 colours) goes to colours 127.. */
const MICKEY_PICTURE = 0x12bd90;
const MICKEY_PALETTE = 0x12bd94;
const MICKEY_COLOUR_OFFSET = 0x7f;
const MICKEY_COLOUR_BYTES = 0x180;
/** 0x100ecb: rows 75..199 of Mickey's picture, colour 0xff (0x80 before the move) transparent. */
const MICKEY_FIRST_ROW = 0x4b;
const MICKEY_ROWS = 0x7d;
/** [0x15c6a4]: the black-out mask, 320x200: a pixel goes black once its mask byte <= BLACKOUT_LEVEL. */
const BLACKOUT_MASK = 0x15c6a4;
const BLACKOUT_LEVEL = 0x16e09c;
const BLACKOUT_STEP = 2;
const BLACKOUT_LAST_LEVEL = 0xfe;
/** 0x100eff / 0x100f9a: the black-out starts at row 0x25 of the part's last pattern. */
const BLACKOUT_ROW = 0x25;
/** 0x16e0a0: an angle in degrees (mod 360), 0x16e0a4: the plasma's offset; both count retraces. */
const ANGLE = 0x16e0a0;
const OFFSET = 0x16e0a4;
const DEGREES = 0x168;
const PHASE_SCALE = 0x127278;
const DEGREES_HALF_TURN = 0x127280;
/** 0x100dc3: written and never read. */
const UNUSED_A = 0x16e094;
const UNUSED_B = 0x16e098;

/**
 * 0x100aa2: copies `rows` rows of `width` bytes from `from` to `to` + (y * 320 + x), skipping bytes 0xff.
 * (The source advances by `width` per row.)
 */
export function blitSkipFf(m, from, to, x, y, width, rows) {
  blitSkipping(m, from, to, x, y, width, rows, 0xff);
}

/** 0x100a79: the same, skipping bytes 0. */
export function blitSkipZero(m, from, to, x, y, width, rows) {
  blitSkipping(m, from, to, x, y, width, rows, 0);
}

function blitSkipping(m, from, to, x, y, width, rows, transparent) {
  const mem = m.mem;
  let source = from;
  let target = to + y * SCREEN_WIDTH + x;
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < width; i++) {
      const value = mem[source++];
      if (value !== transparent) {
        mem[target + i] = value;
      }
    }
    target += SCREEN_WIDTH;
  }
}

/** 0x100be8: one DAC colour. */
function setColour(m, index, red, green, blue) {
  m.vga.out8(0x3c8, index);
  m.vga.out8(0x3c9, red);
  m.vga.out8(0x3c9, green);
  m.vga.out8(0x3c9, blue);
}

/**
 * 0x100d0b / 0x100e1e: the plasma into the buffer. Every lookup goes through the sine table (bytes, indices mod
 * 256); the picture is indexed with a row stride of 255.
 */
function renderPlasma(m, phase) {
  const mem = m.mem;
  const offset = m.u32(OFFSET);
  const picture = m.u32(PLASMA_PICTURE);
  let out = m.u32(BUFFER);
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    let wave = phase - y; // ebx
    for (let x = 0; x < SCREEN_WIDTH; x++, wave++) {
      const a = mem[SINE + (x & 0xff)];
      const b = mem[SINE + ((y - offset + a) & 0xff)];
      const c = mem[SINE + ((x + offset) & 0xff)];
      const high = mem[SINE + ((c - (b + x + offset)) & 0xff)] * 0xff;
      const d = mem[SINE + (wave & 0xff)];
      const low = mem[SINE + ((offset + y - d) & 0xff)];
      mem[out++] = mem[picture + low + high];
    }
  }
}

/**
 * 0x100bff: the sine table, the pictures' colours moved apart (plasma at 60.., Mickey at 127..) with their
 * palettes merged into 0x12c098, then (after a retrace) that palette, the buffer on the screen, colour 0 black.
 */
function* setUp(m) {
  const step = m.f64(PI) * m.f64(SINE_STEP);
  const amplitude = m.f64(SINE_AMPLITUDE);
  for (let i = 0; i < 0x100; i++) {
    m.set8(SINE + i, Math.trunc(Math.sin(i * step) * amplitude));
  }
  const plasma = m.u32(PLASMA_PICTURE);
  for (let i = 0; i < PLASMA_PICTURE_BYTES; i++) {
    m.mem[plasma + i] += PLASMA_COLOUR_OFFSET;
  }
  m.mem.copyWithin(PLASMA_PALETTE + PLASMA_COLOUR_OFFSET * 3, PLASMA_PALETTE, PLASMA_PALETTE + PLASMA_COLOUR_BYTES);
  const mickey = m.u32(MICKEY_PICTURE);
  for (let i = 0; i < SCREEN_BYTES; i++) {
    m.mem[mickey + i] += MICKEY_COLOUR_OFFSET;
  }
  m.mem.copyWithin(PLASMA_PALETTE + MICKEY_COLOUR_OFFSET * 3, MICKEY_PALETTE, MICKEY_PALETTE + MICKEY_COLOUR_BYTES);
  yield* waitRetrace(m);
  setPalette(m, PLASMA_PALETTE);
  copyToScreen(m, m.u32(BUFFER));
  setColour(m, 0, 0, 0, 0);
}

/** 0x100f08: black where the mask byte is <= the level (the level's low byte). */
function blackOut(m) {
  const level = m.u8(BLACKOUT_LEVEL);
  const mask = m.u32(BLACKOUT_MASK);
  const out = m.u32(BUFFER);
  for (let i = 0; i < SCREEN_BYTES; i++) {
    if (m.mem[mask + i] <= level) {
      m.mem[out + i] = 0;
    }
  }
}

/**
 * 0x100fb8: the plasma's phase from the angle: trunc(cos(angle * pi / 180) * 128 + 128). The x87 computes this
 * in 80 bits; at 300 degrees cos is 0.49999999999999982 there and the sum 191.99999999999998, which a double
 * rounds up to 192: the only angle where JS doubles and the original differ.
 */
function phaseOf(m, angle) {
  if (angle === 300) {
    return 191;
  }
  const scale = m.f64(PHASE_SCALE);
  return Math.trunc(Math.cos((angle * m.f64(PI)) / m.f64(DEGREES_HALF_TURN)) * scale + scale);
}

/**
 * The phase of the first two pictures: [esp+0x14] is read before the code writes it, and holds what part 5
 * (0x103808, whose frame used the same stack) left there: at 0x1045b6 the address of the frame buffer,
 * [0x12bd80], in the original's heap. Only its low byte matters (the phase is used mod 256); 0x50 is the one that
 * makes the first picture of the loop (recording frame 5705) pixel-exact.
 */
const STALE_PHASE = 0x50;

/**
 * @param {Machine} m
 * @param {number} lastPosition the song position the part runs up to
 * @param {number} initialPhase see STALE_PHASE
 */
export function* plasma(m, lastPosition, initialPhase = STALE_PHASE) {
  let phase = initialPhase;
  renderPlasma(m, phase); // 0x100cff, before the sine table exists
  yield* setUp(m);
  let lastRetraces = m.u32(RETRACES);
  m.set32(UNUSED_A, 0x3c);
  m.set32(UNUSED_B, 0x28);
  m.readPlayStatus();
  const lastPattern = lastPosition - 1;
  while (lastPosition > m.u32(POSITION)) {
    renderPlasma(m, phase);
    blitSkipFf(m, m.u32(MICKEY_PICTURE) + MICKEY_FIRST_ROW * SCREEN_WIDTH, m.u32(BUFFER), 0, MICKEY_FIRST_ROW,
      SCREEN_WIDTH, MICKEY_ROWS);
    if (lastPattern <= m.u32(POSITION) && m.u32(ROW) >= BLACKOUT_ROW) {
      blackOut(m);
    }
    yield* waitRetrace(m);
    copyToScreen(m, m.u32(BUFFER));
    const retraces = m.u32(RETRACES);
    const passed = (retraces - lastRetraces) >>> 0;
    lastRetraces = retraces;
    const row = m.u32(ROW);
    for (let i = 1; i <= passed; i++) {
      m.set32(ANGLE, m.u32(ANGLE) + 1);
      m.set32(OFFSET, m.u32(OFFSET) + 1);
      const level = m.s32(BLACKOUT_LEVEL);
      if (m.u32(POSITION) >= lastPattern && row > BLACKOUT_ROW && level < BLACKOUT_LAST_LEVEL) {
        m.set32(BLACKOUT_LEVEL, level + BLACKOUT_STEP);
      }
    }
    m.set32(ANGLE, m.s32(ANGLE) % DEGREES);
    phase = phaseOf(m, m.s32(ANGLE));
    m.readPlayStatus();
  }
  return false;
}
