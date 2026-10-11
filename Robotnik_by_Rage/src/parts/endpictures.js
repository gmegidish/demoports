// Demo part 15: the end pictures. The frozen last picture of part 14 flips over to "punish", then to
// "your" and "machine" (the screen on the transitions' quad, 0x282a0); "machine" shatters into
// triangles that fly at the viewer over endlogo (src/shatter.js), and endlogo fades to black.
// Ports init 0x1d898, run 0x1db88 and deinit 0x1d9e8 (frees only). See docs/disassembly/P14_ending.md
// §5..§7.

import {
  frame, syncAdvance, resyncFrame, entryTime, entryFrame, setDac, TICKS_PER_SECOND,
  PALETTE_BYTES, SCREEN_BYTES,
} from '../machine.js';
import { RenderWorld, DestroyWorld, SetObjPos, SetObjAngles, createQuadWorld, QUAD_TEXTURE_SIZE } from '../engine/index.js';
import { scale, mirrorRows } from '../gfx.js';
import { sin } from '../sine.js';
import { createShatter, runShatter } from '../shatter.js';

const WIDTH = 320;
const HEIGHT = 200;

/** Picture colours moved into the ramps of the en_pal palette (machine also brightened by 5). */
const PUNISH_BASE = 0xc0;
const YOUR_BASE = 0x80;
const MACHINE_BASE = 0xa0;
const MACHINE_BRIGHTER = 5;
const RAMP_TOP = 31;
const RAMP_MASK = 0xe0;
/** Colours 0xc0..0xdf come from end_pal.col (part 14's palette), so "punish" looks the same in both. */
const KEPT_COLOURS_FROM = 0x240;
const KEPT_COLOURS_TO = 0x2a0;

/** 0x282a0: t = ticks * 0x1400 / 49; the flip ends with the pass that reaches t = 0x3f00 (155 ticks). */
const FLIP_SPEED = 0x1400;
const FLIP_DIVISOR = 49;
const FLIP_END = 0x3f00;
const FLIP_TICKS = Math.ceil((FLIP_END * FLIP_DIVISOR) / FLIP_SPEED);
const DEPTH_SHIFT = 6;
const ANGLE_SHIFT = 8;
/** Turn rates (kx, ky, kz) of the three flips, 4096 per turn at t >> 8. */
const PUNISH_TURN = [0x20, 0, 0x60];
const YOUR_TURN = [0x40, 0x20, 0];
const MACHINE_TURN = [0x20, 0, 0x20];

/** 0x16f20(0x8c, 1): the pieces fly at the viewer. */
const SHATTER_SPEED = 0x8c;
const SHATTER_MODE = 1;
/**
 * How long a shatter pass took in the recording (src/shatter.js's pace model): fitted on demo.avi
 * frames 27673..27746, every pass pixel-exact: passes 2..8 (65783..44348 pixels) took 3 ticks,
 * 9..28 (42747..13057) 2 ticks, the rest 1 tick. The pieces fly at the viewer here, so a pass costs
 * a little more per pixel than in part 13.
 */
export const PART_15_PACE = { baseTicks: 0.6667, pixelsPerTick: 32600 };

/** The fade: 128 rows, row k darkens each ramp by (127 - k) >> 2; one row per tick from 127. */
const FADE_ROWS = 128;
const FADE_TOP = FADE_ROWS - 1;

function* waitForEntry(demo, entry) {
  while (syncAdvance(demo.machine) <= entry) {
    yield;
  }
}

function picture(demo, name, recolour) {
  return demo.archive.read(name).slice(PALETTE_BYTES, PALETTE_BYTES + SCREEN_BYTES).map(recolour);
}

/** en_pal.col with colours 0xc0..0xdf of end_pal.col. */
function endPalette(archive) {
  const palette = archive.read('en_pal.col').slice(0, PALETTE_BYTES);
  palette.set(archive.read('end_pal.col').subarray(KEPT_COLOURS_FROM, KEPT_COLOURS_TO), KEPT_COLOURS_FROM);
  return palette;
}

/** 0x1d898: rows 0..127 of 0xfd0a0, row k = each ramp darkened by (127 - k) >> 2. */
export function fillFadeRows(table) {
  for (let k = 0; k < FADE_ROWS; k++) {
    const darker = (FADE_TOP - k) >> 2;
    for (let b = 0; b < 256; b++) {
      table[k * 256 + b] = (b & RAMP_MASK) + Math.max((b & RAMP_TOP) - darker, 0);
    }
  }
}

/** [0x91260] the way 0x121d4 sets it at song second `seconds` (frame counter at that moment). */
function resyncAt(m, seconds) {
  resyncFrame(m, seconds);
  return m.frameBase + Math.floor(seconds * TICKS_PER_SECOND) - m.frameOrigin;
}

/** The flip angle and depth at `t`: SetObjPos(0, 0, S[t >> 6]), angles (k * t) >> 8 as words. */
function poseFlip(quad, turn, t) {
  SetObjPos(quad, 0, 0, sin(t >> DEPTH_SHIFT));
  SetObjAngles(quad, turn.map((k) => (k * t) >> ANGLE_SHIFT));
}

/**
 * 0x282a0 flipTo(picture, kx, ky, kz): the screen (front face) turns over to show the picture
 * (back face, mirrored); no frame wait, so one pass per tick; the exact picture is put on screen at
 * the end. `startSeconds`: song second the flip starts at (its resync), so seeks land on the same pass.
 * @returns the song second at which the flip ended
 */
function* flipTo(demo, image, turn, startSeconds) {
  const m = demo.machine;
  const back = demo.offscreen;
  const texture = new Uint8Array(QUAD_TEXTURE_SIZE * QUAD_TEXTURE_SIZE);
  scale(image, WIDTH, HEIGHT, texture, QUAD_TEXTURE_SIZE, QUAD_TEXTURE_SIZE);
  mirrorRows(texture, QUAD_TEXTURE_SIZE, QUAD_TEXTURE_SIZE);
  const { world, quad } = createQuadWorld(demo.image, m.front, texture);
  const start = resyncAt(m, startSeconds);
  for (;;) {
    const t = Math.trunc(((frame(m) - start) * FLIP_SPEED) / FLIP_DIVISOR);
    poseFlip(quad, turn, t);
    RenderWorld(world, { target: back, colourTable: demo.blendTable });
    m.front.set(back);
    back.fill(0);
    if (t >= FLIP_END) {
      break;
    }
    yield;
  }
  m.front.set(image);
  DestroyWorld(world);
  return startSeconds + FLIP_TICKS / TICKS_PER_SECOND;
}

/**
 * The end of 0x1db88: VGA = fade row k of the back buffer (endlogo) after each tick, k from 127 down
 * by the ticks elapsed (127 twice), until k < 0; then a black screen.
 */
function* fadeOut(demo, startFrame) {
  const m = demo.machine;
  const back = demo.offscreen;
  const table = demo.blendTable;
  let previous = 0;
  let row = FADE_TOP;
  do {
    const elapsed = Math.max(frame(m) - startFrame, 0);
    const ticks = elapsed - previous;
    previous = elapsed;
    yield;
    const offset = row * 256;
    for (let i = 0; i < SCREEN_BYTES; i++) {
      m.front[i] = table[offset + back[i]];
    }
    row -= ticks;
  } while (row >= 0);
  m.front.fill(0);
}

export const endPictures = {
  /** 0x1d898: the four pictures, the palette (set after the first flip) and the fade table. */
  init(demo) {
    fillFadeRows(demo.blendTable);
    return {
      punish: picture(demo, 'punish.raw', (b) => (b + PUNISH_BASE) & 0xff),
      your: picture(demo, 'your.raw', (b) => (b + YOUR_BASE) & 0xff),
      machine: picture(demo, 'machine.raw', (b) => Math.min(b + MACHINE_BRIGHTER, RAMP_TOP) + MACHINE_BASE),
      endlogo: picture(demo, 'endlogo.raw', (b) => b),
      palette: endPalette(demo.archive),
    };
  },

  /** 0x1db88(32): flips at entries 32 and 33, the shatter at 35 until 36, the fade, black until 37. */
  *run(demo, state, firstSync) {
    const m = demo.machine;
    yield* waitForEntry(demo, firstSync);
    yield* flipTo(demo, state.punish, PUNISH_TURN, entryTime(m, firstSync));
    setDac(m, state.palette);
    yield* waitForEntry(demo, firstSync + 1);
    const yourEnd = yield* flipTo(demo, state.your, YOUR_TURN, entryTime(m, firstSync + 1));
    yield* flipTo(demo, state.machine, MACHINE_TURN, yourEnd);
    const shatter = createShatter(demo.image, m.front, { speed: SHATTER_SPEED, mode: SHATTER_MODE });
    yield* waitForEntry(demo, firstSync + 3);
    yield* runShatter(demo, shatter, {
      lastIndex: firstSync + 4, background: state.endlogo, pace: PART_15_PACE, startFrame: entryFrame(m, firstSync + 3),
    });
    yield* fadeOut(demo, entryFrame(m, firstSync + 4));
    yield* waitForEntry(demo, firstSync + 5);
  },
};
