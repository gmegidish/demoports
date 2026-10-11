// Part 7, 0x108c6a (main runs it up to song position 0x18): two sets of rings, each a table of sin(r^2) over a
// 640x400 field, slide over each other along Lissajous paths and pick a colour from a 256x256 picture; a strip
// of the screen is cleared and a picture (the ball, bottom left) is drawn over it. From the next song position
// on, a randomly rotated and zoomed texture flashes over everything (docs/disassembly/C_plasma_rings.md).
import { RETRACES, POSITION, copyToScreen, setPalette, waitRetrace } from '../machine.js';
import { blitSkipZero } from './plasma.js';

/** @typedef {import('../machine.js').Machine} Machine */

const SCREEN_WIDTH = 0x140;
const SCREEN_HEIGHT = 0xc8;
/** [0x12bd80], the frame buffer every part renders into. */
const BUFFER = 0x12bd80;

/** 0x108a58: [0x170704] and [0x170708], 640x400 bytes each: a ring pattern around the centre. */
const RINGS_A = 0x170704;
const RINGS_B = 0x170708;
const RINGS_WIDTH = 0x280;
const RINGS_BYTES = 0x3e800;
const RINGS_FIRST_Y = -0xc7;
const RINGS_END_Y = 0xc9;
const RINGS_FIRST_X = -0x13f;
const RINGS_END_X = 0x141;
/** float32 12000 and 16000: the rings' scale; 127: their amplitude; 0x7f: their offset. */
const RINGS_A_SCALE = 0x12760c;
const RINGS_B_SCALE = 0x127610;
const RINGS_AMPLITUDE = 0x127604;
const RINGS_OFFSET = 0x7f;

/** [0x16cfb4]: the rings' 256x256 colour picture, then (+0x10000) the flash texture; palette at 0x16cfbc. */
const PICTURE = 0x16cfb4;
const PALETTE = 0x16cfbc;
const TEXTURE_OFFSET = 0x10000;
/** 0x108c54: texture colour 0x85 is transparent. */
const TEXTURE_TRANSPARENT = 0x85;
/** [0x16cfb8]: the ball's picture, 320x50, drawn at row 150 with colour 0 transparent (0x108e2d). */
const BALL_PICTURE = 0x16cfb8;
const BALL_ROW = 0x96;
const BALL_ROWS = 0x32;
/** 0x108e19: the buffer's first 0x1cc0 bytes (23 rows) are set to colour 1. */
const TOP_STRIP_BYTES = 0x1cc0;
const TOP_STRIP_COLOUR = 1;

/**
 * 0x108c83: four tables of 256 words (angle i * pi / 128): sin * 256, cos * 256, sin(+pi/2) * 307.2 and
 * cos(+pi/2) * 307.2. The last three use the angle rounded to float32 (fst dword); words before a table are the
 * previous table's last ones (the flash reads them for negative angles).
 */
const SINES = 0x17070c;
const COSINES = 0x17090c;
const SINES_SHIFTED = 0x170b0c;
const COSINES_SHIFTED = 0x170d0c;
const PI = 0x127614;
const ANGLE_STEP = 0x12761c;
const TABLE_SCALE = 0x127624;
const SHIFTED_SCALE = 0x12762c;
const QUARTER_TURN = 0x127644;

/** 0x108d71: the rings' centres, round(sin(t / period) * amplitude) + middle. */
const PATHS = [[0x12764c, 0x127634, 0xa0], [0x127654, 0x12763c, 0x64], [0x12765c, 0x127634, 0xa0],
  [0x127664, 0x12763c, 0x64]];

/** 0x170f0c..0x170f16: the flash's steps (u per column, v per column, u per row, v per row) and row start. */
const STEP_U_X = 0x170f0c;
const STEP_V_X = 0x170f0e;
const STEP_U_Y = 0x170f10;
const STEP_V_Y = 0x170f12;
const ROW_U = 0x170f14;
const ROW_V = 0x170f16;
/** 0x108e64: zoom = 0x94 + 20 - rand() % 40; angle = rand() % 16 - rand() % 16 (table steps). */
const ZOOM_BASE = 0x94 + 0x14;
const ZOOM_RANGE = 0x28;
const ANGLE_RANGE = 0x10;
/** 0x108f08: the texture's centre (128, 128 in 8.8 fixed point) at the screen's (160, 100). */
const TEXTURE_CENTRE = 0x8000;
const SCREEN_CENTRE_X = 0xa0;
const SCREEN_CENTRE_Y = 0x64;

/** 0x114f3f: Watcom's rand(), its state at 0x129bec (seed 1; this part is the first to call it). */
const RAND_STATE = 0x129bec;

/** x87 fistp in the default rounding mode: to nearest, ties to even. */
export function roundHalfEven(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction !== 0.5) {
    return Math.round(value);
  }
  return floor % 2 === 0 ? floor : floor + 1;
}

/** 0x114f3f rand(): 0..0x7fff. */
export function rand(m) {
  const state = (Math.imul(m.u32(RAND_STATE), 0x41c64e6d) + 0x3039) >>> 0;
  m.set32(RAND_STATE, state);
  return (state >>> 16) & 0x7fff;
}

/**
 * 0x108a58 (at load time): the two ring tables, byte(round(sin((x^2 + y^2) / scale) * 127)) + 0x7f for y from
 * -199 to 200 and x from -319 to 320.
 * @param {Machine} m
 */
export function buildRingTables(m) {
  const a = m.malloc(RINGS_BYTES);
  m.set32(RINGS_A, a);
  const b = m.malloc(RINGS_BYTES);
  m.set32(RINGS_B, b);
  const scaleA = m.f32(RINGS_A_SCALE);
  const scaleB = m.f32(RINGS_B_SCALE);
  const amplitude = m.f64(RINGS_AMPLITUDE);
  let i = 0;
  for (let y = RINGS_FIRST_Y; y !== RINGS_END_Y; y++) {
    for (let x = RINGS_FIRST_X; x !== RINGS_END_X; x++, i++) {
      const distance = x * x + y * y;
      m.mem[a + i] = roundHalfEven(Math.sin(distance / scaleA) * amplitude) + RINGS_OFFSET;
      m.mem[b + i] = roundHalfEven(Math.sin(distance / scaleB) * amplitude) + RINGS_OFFSET;
    }
  }
}

/** 0x108c83..0x108d35, see SINES. */
function buildAngleTables(m) {
  const step = m.f64(PI) * m.f64(ANGLE_STEP);
  const scale = m.f64(TABLE_SCALE);
  const shiftedScale = m.f64(SHIFTED_SCALE);
  const quarterTurn = m.f64(QUARTER_TURN);
  for (let i = 0; i < 0x100; i++) {
    const angle = i * step;
    const angle32 = Math.fround(angle);
    m.set16(SINES + i * 2, Math.trunc(Math.sin(angle) * scale));
    m.set16(COSINES + i * 2, Math.trunc(Math.cos(angle32) * scale));
    m.set16(SINES_SHIFTED + i * 2, Math.trunc(Math.sin(angle32 + quarterTurn) * shiftedScale));
    m.set16(COSINES_SHIFTED + i * 2, Math.trunc(Math.cos(angle32 + quarterTurn) * shiftedScale));
  }
}

/**
 * 0x108b21: every pixel is the picture at (ringsA[y1 + y][x1 + x], ringsB[y2 + y][x2 + x]).
 */
function renderRings(m, x1, y1, x2, y2) {
  const mem = m.mem;
  const picture = m.u32(PICTURE);
  let a = m.u32(RINGS_A) + y1 * RINGS_WIDTH + x1;
  let b = m.u32(RINGS_B) + y2 * RINGS_WIDTH + x2;
  let out = m.u32(BUFFER);
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      mem[out++] = mem[picture + (mem[a + x] << 8) + mem[b + x]];
    }
    a += RINGS_WIDTH;
    b += RINGS_WIDTH;
  }
}

/**
 * 0x108e64: a random zoom and angle, and the flash's steps from them.
 *
 * For angles below 0 this build of the demo reads SINES[angle] and COSINES[angle] below the tables: the end of the
 * previous table and heap pointers, which draws a stretched, streaked smear for every other flash, in DOSBox and in
 * 86Box alike (the demo's own bug). The YouTube capture (youtube.com/watch?v=jcFiRrdicj0) never shows it: every
 * flash there is the logo, upright or turned counter-clockwise, as for the positive angles. The port turns a
 * negative angle into its positive twin, which keeps the random sequence and looks like the hardware.
 */
function setUpFlash(m) {
  const zoom = ZOOM_BASE - (rand(m) % ZOOM_RANGE);
  const first = rand(m) % ANGLE_RANGE;
  const angle = Math.abs(first - (rand(m) % ANGLE_RANGE));
  const scaled = (table) => (m.s16(table + angle * 2) * zoom) >> 8;
  const stepUX = scaled(COSINES);
  const stepVX = scaled(SINES);
  const stepUY = scaled(COSINES_SHIFTED);
  const stepVY = scaled(SINES_SHIFTED);
  m.set16(STEP_U_X, stepUX);
  m.set16(STEP_V_X, stepVX);
  m.set16(STEP_U_Y, stepUY);
  m.set16(STEP_V_Y, stepVY);
  m.set16(ROW_U, TEXTURE_CENTRE - stepUX * SCREEN_CENTRE_X - stepUY * SCREEN_CENTRE_Y);
  m.set16(ROW_V, TEXTURE_CENTRE - stepVX * SCREEN_CENTRE_X - stepVY * SCREEN_CENTRE_Y);
}

/**
 * 0x108bac: the texture over the buffer, u and v in 8.8 fixed point (16-bit, wrapping). The texel is at
 * (v & 0xff00) + (u >> 8) with u's integer part signed: u from 0x8000 reads up to 128 bytes before the texture.
 */
function renderFlash(m) {
  const mem = m.mem;
  const texture = m.u32(PICTURE) + TEXTURE_OFFSET;
  const stepUX = m.u16(STEP_U_X);
  const stepVX = m.u16(STEP_V_X);
  let out = m.u32(BUFFER);
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    let u = m.u16(ROW_U);
    let v = m.u16(ROW_V);
    for (let x = 0; x < SCREEN_WIDTH; x++, out++) {
      const texel = mem[texture + (((u << 16) >> 24) + (v & 0xff00))];
      if (texel !== TEXTURE_TRANSPARENT) {
        mem[out] = texel;
      }
      u = (u + stepUX) & 0xffff;
      v = (v + stepVX) & 0xffff;
    }
    m.set16(ROW_U, m.u16(ROW_U) + m.u16(STEP_U_Y));
    m.set16(ROW_V, m.u16(ROW_V) + m.u16(STEP_V_Y));
  }
}

/**
 * The original draws a new random flash every rendered frame; the port renders every retrace but keeps each flash
 * for as long as the reference recording did: 270 flashes in 1072 retraces.
 */
const RETRACES_PER_FLASH = 1072 / 270;

/**
 * @param {Machine} m
 * @param {number} lastPosition the song position the part runs up to
 */
export function* rings(m, lastPosition) {
  buildAngleTables(m);
  setPalette(m, PALETTE);
  let time = 0;
  let lastRetraces = m.u32(RETRACES);
  m.readPlayStatus();
  const firstPosition = m.u32(POSITION);
  let sinceFlash = RETRACES_PER_FLASH;
  let flashRows = null;
  for (;;) {
    const [x1, y1, x2, y2] = PATHS.map(([period, amplitude, middle]) =>
      roundHalfEven(Math.sin(time / m.f64(period)) * m.f64(amplitude)) + middle);
    renderRings(m, x1, y1, x2, y2);
    m.mem.fill(TOP_STRIP_COLOUR, m.u32(BUFFER), m.u32(BUFFER) + TOP_STRIP_BYTES);
    blitSkipZero(m, m.u32(BALL_PICTURE), m.u32(BUFFER), 0, BALL_ROW, SCREEN_WIDTH, BALL_ROWS);
    m.readPlayStatus();
    if (firstPosition < m.u32(POSITION)) {
      if (sinceFlash >= RETRACES_PER_FLASH) {
        sinceFlash -= RETRACES_PER_FLASH;
        setUpFlash(m);
        flashRows = [m.u16(ROW_U), m.u16(ROW_V)];
      }
      m.set16(ROW_U, flashRows[0]);
      m.set16(ROW_V, flashRows[1]);
      renderFlash(m);
    }
    yield* waitRetrace(m);
    copyToScreen(m, m.u32(BUFFER));
    const retraces = m.u32(RETRACES);
    time += (retraces - lastRetraces) >>> 0;
    sinceFlash += (retraces - lastRetraces) >>> 0;
    lastRetraces = retraces;
    if (lastPosition <= m.u32(POSITION)) {
      return false;
    }
  }
}
