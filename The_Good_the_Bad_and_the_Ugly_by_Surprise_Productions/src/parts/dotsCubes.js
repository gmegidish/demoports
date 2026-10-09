// 3200-dots cubes (126e:13ea, Antibyte): two dotted cubes (1600 dots each, cube 1 in plane 0, cube 2 in plane 1)
// in the 16-colour planar mode with 64-byte rows, double buffered at 0 / 6400h. They zoom in and fade in, separate,
// morph through four vertex sets with a depth-sorted overlap colour, then zoom out and fade out.
// docs/disassembly/G8_cubes_dots.md, part 2.
import { waitTick } from '../machine.js';
import { setDac } from '../library.js';
import { CODE, DATA, rotate, separateAndRotateGlobally, project, drawDottedCube } from './dotsCubesGeometry.js';

const SEQUENCER_INDEX = 0x3c4;
const GRAPHICS_INDEX = 0x3ce;
const CRTC_INDEX = 0x3d4;
const ALL_PLANES = 0x0f02;
/** CRTC 13h = 20h: 64 bytes per row. */
const ROW_OFFSET_64 = 0x2013;
const ROW_BYTES = 64;
const VISIBLE_ROW_BYTES = 40;
const ROWS = 200;
const PIXELS_PER_ROW = 320;

// 126e variables
const SEPARATION = 0xbec;
const DISTANCE = 0xbee;
const DISTANCE_1 = 0xbf0;
const DISTANCE_2 = 0xbf2;
const CRTC_START = 0xbf4;
const DRAW_SEGMENT = 0xbf6;
const SPEEDS_1 = 0xbfe;
const ANGLES_1 = 0xc04;
const ANGLES_2 = 0xc0a;
const GLOBAL_ANGLE_3 = 0xc14;
const GLOBAL_SPEEDS = 0xc16;
const SPEEDS_2 = 0xc1c;
const COLOUR_A = 0xc28;
const COLOUR_B = 0xc2b;
const COUNTER = 0xc30;
const MORPH_ALWAYS = 0xc32;
const MORPH_STEPS = 0xc34;
const CUBE_1_Z = 0xc36;
const FADE_TICKS = 0xc38;
const FADE_LEVEL = 0xc3a;
const DAC_COLOURS = 0xc3b;
const COLOUR_1 = 0xc3e;
const COLOUR_2 = 0xc41;
const COLOUR_3 = 0xc44;
const MORPH_POINTER = 0x1d8;
const MORPH_TARGETS = 0x1da;
const CUBE_1 = 0x26;
const CUBE_2 = 0x56;
// 120e data
const CUBE_2_VERTEX_0_Z = 0x234;
const RAMP_1 = 0x280;
const RAMP_2 = 0x340;
const RAMP_STEPS = 32;
const MORPH_1 = 0x140;
const MORPH_2 = 0x1a0;
const ACCUMULATOR = 0x30;

const VGA_SEGMENT = 0xa000;
const PAGE_FLIP_START = 0x6400;
const PAGE_FLIP_SEGMENT = 0x640;
const FULL_LEVEL = 60;
const FADE_PERIOD = 7;
const ZOOM_STEP = 16;
const NEAREST_DISTANCE = -0x30;
const WIDEST_SEPARATION = 0x5a;
const MORPH_WAIT = 0x15e;
const MORPH_FRAMES = 0x80;
const MORPHING_TICKS = 0x7d0;
const QUARTER_TURN = 0x200;
const ANGLE_MASK = 0x7fe;
/** 08d8:157c, where 08d8:157e stores the frame counter it returns. */
const TICKS_SEEN = 0x8d80 + 0x157c;

/** Signed 8-bit `imul bl / idiv bh` with bh = 60: component * level / 60, truncated, as a byte. */
function scaleComponent(value, level) {
  const product = ((value << 24) >> 24) * ((level << 24) >> 24);
  return Math.trunc(product / FULL_LEVEL) & 0xff;
}

/** 126e:0cb3: CRTC offset 20h; ramps of colour A and B from 60/60 down to 29/60 and back (64 entries each). */
function setUpRowsAndRamps(m) {
  m.vga.out16(CRTC_INDEX, ROW_OFFSET_64);
  const mem = m.mem;
  let level = FULL_LEVEL;
  for (let i = 0; i < RAMP_STEPS; i++) {
    for (let k = 0; k < 3; k++) {
      mem[DATA + RAMP_1 + 3 * i + k] = scaleComponent(mem[CODE + COLOUR_A + k], level);
      mem[DATA + RAMP_2 + 3 * i + k] = scaleComponent(mem[CODE + COLOUR_B + k], level);
    }
    level--;
  }
  for (const ramp of [RAMP_1, RAMP_2]) {
    const mirror = ramp + 3 * RAMP_STEPS;
    for (let j = 0; j < RAMP_STEPS; j++) {
      for (let k = 0; k < 3; k++) {
        mem[DATA + mirror + 3 * j + k] = mem[DATA + mirror - 3 * (j + 1) + k];
      }
    }
  }
}

/** 126e:0d74: ds:0000..013f = the bit of x in its byte (80h >> (x & 7)). */
function buildMaskTable(m) {
  for (let x = 0; x < PIXELS_PER_ROW; x++) {
    m.mem[DATA + x] = 0x80 >> (x & 7);
  }
}

/** 126e:1282: one fade-in step every 7 frames; colour 3 = (colour 1 red, green, colour 2 blue). */
function fadeIn(m) {
  const mem = m.mem;
  const ticks = (m.u16(CODE + FADE_TICKS) - 1) & 0xffff;
  m.set16(CODE + FADE_TICKS, ticks);
  if (ticks !== 0) {
    return;
  }
  m.set16(CODE + FADE_TICKS, FADE_PERIOD);
  mem[CODE + FADE_LEVEL] = (mem[CODE + FADE_LEVEL] + 1) & 0xff;
  const level = mem[CODE + FADE_LEVEL];
  for (let k = 0; k < 3; k++) {
    mem[CODE + COLOUR_1 + k] = scaleComponent(mem[CODE + COLOUR_A + k], level);
    mem[CODE + COLOUR_2 + k] = scaleComponent(mem[CODE + COLOUR_B + k], level);
  }
  mem[CODE + COLOUR_3] = mem[CODE + COLOUR_1];
  mem[CODE + COLOUR_3 + 1] = mem[CODE + COLOUR_1 + 1];
  mem[CODE + COLOUR_3 + 2] = mem[CODE + COLOUR_2 + 2];
}

/** 126e:1254: every 7 frames the level drops by one; colours 1..3 are scaled by level/60 every frame. */
function fadeOut(m) {
  const mem = m.mem;
  const ticks = (m.u16(CODE + FADE_TICKS) - 1) & 0xffff;
  m.set16(CODE + FADE_TICKS, ticks);
  if (ticks === 0) {
    m.set16(CODE + FADE_TICKS, FADE_PERIOD);
    mem[CODE + FADE_LEVEL] = (mem[CODE + FADE_LEVEL] - 1) & 0xff;
  }
  const level = mem[CODE + FADE_LEVEL];
  for (let k = 0; k < 9; k++) {
    mem[CODE + COLOUR_1 + k] = scaleComponent(mem[CODE + COLOUR_1 + k], level);
  }
}

/** 126e:1300: colours from the ramps by the global angle; the overlap colour is the nearer cube's. */
function depthPalette(m) {
  const mem = m.mem;
  const angle = m.u16(CODE + GLOBAL_ANGLE_3);
  const index1 = (((angle - QUARTER_TURN) & ANGLE_MASK) >> 5) * 3;
  const index2 = (((angle + QUARTER_TURN) & ANGLE_MASK) >> 5) * 3;
  mem.copyWithin(CODE + COLOUR_1, DATA + RAMP_1 + index1, DATA + RAMP_1 + index1 + 3);
  mem.copyWithin(CODE + COLOUR_2, DATA + RAMP_2 + index2, DATA + RAMP_2 + index2 + 3);
  const front = m.s16(CODE + CUBE_1_Z) > m.s16(DATA + CUBE_2_VERTEX_0_Z) ? COLOUR_2 : COLOUR_1;
  mem.copyWithin(CODE + COLOUR_3, CODE + front, CODE + front + 3);
}

/** 126e:11bb: 350 frames of rest, then 128 frames of linear morph to the next pair of vertex sets. */
function morph(m) {
  if (m.u16(CODE + MORPH_STEPS) !== 0) {
    for (const [work, vertices] of [[MORPH_1, CUBE_1], [MORPH_2, CUBE_2]]) {
      for (let k = 0; k < 24; k++) {
        const accumulator = DATA + work + ACCUMULATOR + 2 * k;
        m.set16(accumulator, m.u16(accumulator) + m.u16(DATA + work + 2 * k));
        m.set16(CODE + vertices + 2 * k, m.s16(accumulator) >> 7);
      }
    }
    m.set16(CODE + MORPH_STEPS, m.u16(CODE + MORPH_STEPS) - 1);
    return;
  }
  if (m.u16(CODE + MORPH_ALWAYS) === 0) {
    const counter = (m.u16(CODE + COUNTER) - 1) & 0xffff;
    m.set16(CODE + COUNTER, counter);
    if (counter !== 0) {
      return;
    }
    m.set16(CODE + COUNTER, MORPH_WAIT);
  }
  let pointer = m.u16(CODE + MORPH_POINTER);
  if (m.u16(CODE + pointer) === 0xffff) {
    pointer = MORPH_TARGETS;
  }
  [[MORPH_1, CUBE_1], [MORPH_2, CUBE_2]].forEach(([work, vertices], cube) => {
    const target = m.u16(CODE + pointer + 2 * cube);
    for (let k = 0; k < 24; k++) {
      const start = (m.u16(CODE + vertices + 2 * k) << 7) & 0xffff;
      m.set16(DATA + work + ACCUMULATOR + 2 * k, start);
      const difference = (((m.u16(CODE + target + 2 * k) << 7) - start) << 16) >> 16;
      m.set16(DATA + work + 2 * k, difference >> 7);
    }
  });
  m.set16(CODE + MORPH_POINTER, pointer + 4);
  m.set16(CODE + MORPH_STEPS, MORPH_FRAMES);
}

/**
 * 126e:137a: one frame. Waits for the tick, uploads DAC 0..3, clears the drawing page (planes 0 and 1), draws
 * cube 1 into plane 0 and cube 2 into plane 1, then shows the page (126e:1151).
 * @param {{segment: number}} es the drawing segment (es)
 */
function* frame(m, es) {
  const vga = m.vga;
  yield* waitTick(m);
  setDac(m, 0, 4, CODE + DAC_COLOURS);
  const pageOffset = (es.segment - VGA_SEGMENT) * 16;
  // 1135: map mask 3, 200 rows of 40 zero bytes, stride 64
  vga.out16(SEQUENCER_INDEX, 0x0302);
  for (let row = 0; row < ROWS; row++) {
    const at = pageOffset + row * ROW_BYTES;
    for (let i = 0; i < VISIBLE_ROW_BYTES; i++) {
      vga.write(at + i, 0);
    }
  }
  vga.out16(GRAPHICS_INDEX, 0x0004);
  vga.out16(SEQUENCER_INDEX, 0x0102);
  rotate(m, ANGLES_1, SPEEDS_1, CUBE_1);
  separateAndRotateGlobally(m);
  m.set16(CODE + DISTANCE, m.u16(CODE + DISTANCE_1));
  m.set16(CODE + CUBE_1_Z, m.u16(DATA + CUBE_2_VERTEX_0_Z));
  project(m);
  drawDottedCube(m, pageOffset);
  vga.out16(GRAPHICS_INDEX, 0x0104);
  vga.out16(SEQUENCER_INDEX, 0x0202);
  rotate(m, ANGLES_2, SPEEDS_2, CUBE_2);
  separateAndRotateGlobally(m);
  m.set16(CODE + DISTANCE, m.u16(CODE + DISTANCE_2));
  project(m);
  drawDottedCube(m, pageOffset);
  // 1151
  const start = m.u16(CODE + CRTC_START);
  m.set16(CODE + CRTC_START, start ^ PAGE_FLIP_START);
  m.set16(CODE + DRAW_SEGMENT, m.u16(CODE + DRAW_SEGMENT) ^ PAGE_FLIP_SEGMENT);
  es.segment = m.u16(CODE + DRAW_SEGMENT);
  vga.out16(CRTC_INDEX, (start & 0xff00) | 0x0c);
  vga.out16(CRTC_INDEX, ((start & 0xff) << 8) | 0x0d);
}

/** Adds `delta` to both cube distances. */
function moveCubes(m, delta) {
  m.set16(CODE + DISTANCE_1, m.u16(CODE + DISTANCE_1) + delta);
  m.set16(CODE + DISTANCE_2, m.u16(CODE + DISTANCE_2) + delta);
}

/** 126e:13ea. */
export function* dotsCubes(m) {
  m.vga.out16(SEQUENCER_INDEX, ALL_PLANES);
  const es = { segment: VGA_SEGMENT };
  yield* waitTick(m);
  setUpRowsAndRamps(m);
  buildMaskTable(m);
  do { // zoom in, fade in
    yield* frame(m, es);
    fadeIn(m);
    moveCubes(m, -ZOOM_STEP);
  } while (m.s16(CODE + DISTANCE_1) !== NEAREST_DISTANCE);
  do { // hold
    yield* frame(m, es);
    m.set16(CODE + COUNTER, m.u16(CODE + COUNTER) - 1);
  } while (m.u16(CODE + COUNTER) !== 0);
  m.set16(CODE + SPEEDS_2, 8);
  m.set16(CODE + SPEEDS_2 + 2, 2);
  m.set16(CODE + SPEEDS_2 + 4, 6);
  do { // separate
    yield* frame(m, es);
    m.set16(CODE + SEPARATION, m.u16(CODE + SEPARATION) + 1);
  } while (m.u16(CODE + SEPARATION) !== WIDEST_SEPARATION);
  m.set16(CODE + GLOBAL_SPEEDS + 4, 2);
  m.set16(CODE + COUNTER, MORPH_WAIT);
  let ticksLeft = MORPHING_TICKS;
  do { // morph, counted in ticks (08d8:157e)
    yield* frame(m, es);
    morph(m);
    depthPalette(m);
    const ticks = m.frameCounter; // 08d8:157e, which also keeps it in 08d8:157c
    m.set16(TICKS_SEEN, ticks);
    ticksLeft -= ticks;
  } while (ticksLeft >= 0);
  m.set16(CODE + GLOBAL_SPEEDS, 2);
  m.mem[CODE + FADE_LEVEL] = FULL_LEVEL;
  m.set16(CODE + FADE_TICKS, 1);
  do { // zoom out, fade out
    yield* frame(m, es);
    morph(m);
    depthPalette(m);
    fadeOut(m);
    moveCubes(m, ZOOM_STEP);
  } while (m.mem[CODE + FADE_LEVEL] !== 0);
}
