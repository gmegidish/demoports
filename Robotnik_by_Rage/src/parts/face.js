// Demo part 13: the screaming face (wa_pic.raw), bump-lit by a wandering spot, in a liquid whose level
// bobs and rings outwards from (160,20); where the liquid is above the picture (its bytes double as
// heights) the picture shows refracted and brighter. Then the screen shatters and the pieces fall.
// Ports init 0x1d7c0 (with 0x11280: bump offsets 0x10eb3, ripple field 0x10f46), run 0x1da10 (liquid
// 0x10ff0, light 0x110ca, compose 0x11152) and deinit 0x1d9e0. See docs/disassembly/P11_maze_face.md.

import { frame, syncAdvance, resyncFrame, entryTime, entryFrame, setDac } from '../machine.js';
import { sin, cos } from '../sine.js';
import { createShatter, runShatter, PART_13_PACE } from '../shatter.js';

const WIDTH = 320;
const HEIGHT = 200;
const PIXELS = WIDTH * HEIGHT;

/**
 * 0x11280: one malloc(0xbc700) holds every buffer; the picture's reads past its end land in the next
 * one, so the byte buffers are kept at their offsets in one block (the heap is zero, as DOSBox's was).
 */
const BLOCK_BYTES = 0xbc700;
const LIQUID_AT = 0;
const PICTURE_AT = 0xfa00;
const LIGHT_AT = 0x1f400;
const LIGHT_MAP_AT = 0x2f400;
const WRAP_PAD = 1536;

/** Light map 0x1d7c0: a spot of 30 * (1-r)^4.5, clamped to 27, so a shade stays inside its 32-ramp. */
const SPOT_RADIUS_SQUARED = 51200;
const SPOT_EXPONENT = 4.5;
const SPOT_SCALE = 30;
const SPOT_MAX = 27;

/** Ripple field 0x10f46: 255 - |p - (160,20)| * sqrt(128). */
const RIPPLE_X = 160;
const RIPPLE_Y = 20;
const RIPPLE_SHIFT = 7;

/** 0x10ff0: the level bobs by 2*clamp(cos, -250, 250) around 1024; rings travel 8 steps per tick. */
const LEVEL_SWING = 250;
const LEVEL_BASE = 1024;
const RING_SPEED = 8;
const PHASE_OFFSET = 100;

/** 0x11152 composes screen rows 6..194 in pixel pairs; the liquid is 4 shades brighter. */
const FIRST_PAIR = 1920;
const END_PAIR = 62400;
const RAMP_MASK = 0xe0;
const LIQUID_BRIGHTER = 0x0404;

/** The shatter at the end: 0x16f20(speed 0x8c, mode 0), then 0x17138 until entry 26 has passed. */
const SHATTER_SPEED = 0x8c;
const SHATTER_MODE = 0;

function int8(value) {
  return ((value & 0xff) << 24) >> 24;
}

/** Round half to even, as fistp does. */
function roundEven(value) {
  const r = Math.round(value);
  return r - value === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** 0x10eb3: 8 * horizontal + 2560 * vertical int8 slope of the picture (reads past its end). */
function buildBumpOffsets(block) {
  const offsets = new Int32Array(PIXELS);
  for (let i = 0; i < PIXELS; i++) {
    const p = block[PICTURE_AT + i];
    offsets[i] = 8 * int8(p - block[PICTURE_AT + i + 1]) + 2560 * int8(p - block[PICTURE_AT + i + WIDTH]);
  }
  return offsets;
}

function buildRippleField() {
  const field = new Int32Array(PIXELS);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const d = ((y - RIPPLE_Y) ** 2 + (x - RIPPLE_X) ** 2) << RIPPLE_SHIFT;
      field[y * WIDTH + x] = (255 - roundEven(Math.sqrt(d))) << 16 >> 16;
    }
  }
  return field;
}

function buildLightMap(block) {
  for (let y = -HEIGHT / 2; y < HEIGHT / 2; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const w = 1 - Math.sqrt(((x - RIPPLE_X) ** 2 + y * y) / SPOT_RADIUS_SQUARED);
      const v = w > 0 ? Math.trunc(SPOT_SCALE * w ** SPOT_EXPONENT) : 0;
      block[LIGHT_MAP_AT + (y + HEIGHT / 2) * WIDTH + x] = Math.max(0, Math.min(SPOT_MAX, v));
    }
  }
  block.copyWithin(LIGHT_MAP_AT + PIXELS, LIGHT_MAP_AT, LIGHT_MAP_AT + WRAP_PAD);
}

/** 0x10ff0: liquid height per pixel. */
function fillLiquid(state, dt) {
  const { block, ripples } = state;
  const level = 2 * Math.max(-LEVEL_SWING, Math.min(LEVEL_SWING, cos(dt))) + LEVEL_BASE;
  for (let p = 0; p < PIXELS; p++) {
    block[LIQUID_AT + p] = ((cos((ripples[p] + RING_SPEED * dt) & 511) + level) >> 3) & 0xff;
  }
}

/** 0x110ca: the spot, moved by `offset` and bent by the picture's slope, one row down (+320). */
function fillLight(state, dt) {
  const { block, bumps } = state;
  const offset = (sin(dt + PHASE_OFFSET) >> 3) * WIDTH + (sin(cos(dt + PHASE_OFFSET)) >> 2);
  for (let i = 0; i < PIXELS; i++) {
    block[LIGHT_AT + WIDTH + i] = block[LIGHT_MAP_AT + ((i + offset + bumps[i]) & 0xffff)];
  }
}

function byteAt(block, at) {
  return at >= 0 && at < BLOCK_BYTES ? block[at] : 0;
}

/** One pixel of the liquid: the picture's ramp + light, both read at the refracted position. */
function refracted(block, q, offset) {
  return ((byteAt(block, PICTURE_AT + q + offset) & RAMP_MASK) + byteAt(block, LIGHT_AT + q + offset)) & 0xff;
}

function liquidOffset(block, p) {
  const w = block[LIQUID_AT + p];
  return (int8(w - block[LIQUID_AT + p + 1]) >> 1) + int8(w - block[LIQUID_AT + p + WIDTH]) * WIDTH;
}

/** 0x11152: pixel pairs; the liquid test is made on the first pixel of each pair only. */
function compose(block, screen) {
  for (let p = FIRST_PAIR; p < END_PAIR; p += 2) {
    let word;
    if (block[LIQUID_AT + p] > block[PICTURE_AT + p]) {
      const lo = refracted(block, p, liquidOffset(block, p));
      const hi = refracted(block, p + 1, liquidOffset(block, p + 1));
      word = (((hi << 8) | lo) + LIQUID_BRIGHTER) & 0xffff;
    } else {
      const picture = ((block[PICTURE_AT + p + 1] << 8) | block[PICTURE_AT + p]) & ((RAMP_MASK << 8) | RAMP_MASK);
      word = (picture + ((block[LIGHT_AT + p + 1] << 8) | block[LIGHT_AT + p])) & 0xffff;
    }
    screen[p] = word & 0xff;
    screen[p + 1] = word >> 8;
  }
}

/** The face at tick dt of the part. */
export function renderFace(state, dt, screen) {
  fillLiquid(state, dt);
  fillLight(state, dt);
  compose(state.block, screen);
}

export const face = {
  /** 0x1d7c0 + 0x11280. */
  init(demo) {
    demo.machine.front.fill(0);
    const block = new Uint8Array(BLOCK_BYTES);
    setDac(demo.machine, demo.archive.read('wa_pal.col'));
    block.set(demo.archive.read('wa_pic.raw').subarray(0, PIXELS), PICTURE_AT);
    const bumps = buildBumpOffsets(block);
    buildLightMap(block);
    return { block, bumps, ripples: buildRippleField() };
  },

  /**
   * 0x1da10(24): from entry 24 the face, drawn straight to VGA as fast as the machine goes (the image
   * depends only on the tick, so once per tick here), until entry 25; then the shatter until 26.
   */
  *run(demo, state, firstSync) {
    const m = demo.machine;
    while (syncAdvance(m) <= firstSync) {
      yield;
    }
    // 0x121d4 on the first pass after the entry (as of the entry, so that a seek lands the same).
    resyncFrame(m, entryTime(m, firstSync));
    const start = entryFrame(m, firstSync);
    while (syncAdvance(m) <= firstSync + 1) {
      renderFace(state, frame(m) - start, m.front);
      yield;
    }
    // The screen the shatter breaks: the face of the tick before the entry (the same after a seek).
    const shatterFrame = entryFrame(m, firstSync + 1);
    renderFace(state, shatterFrame - 1 - start, m.front);
    const shatter = createShatter(demo.image, m.front, { speed: SHATTER_SPEED, mode: SHATTER_MODE });
    yield* runShatter(demo, shatter, { lastIndex: firstSync + 2, pace: PART_13_PACE, startFrame: shatterFrame });
  },
};
