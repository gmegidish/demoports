// The chrome sphere of part 12: material 6's draw routine 0x34f6c (P9's affine panel fetch: two
// 320x200 images read through a window 32 columns in, the light map choosing the row of the
// 0xfd0a0 table) and the lightning streak 0x1a654 that run 0x1a850 draws into that light map every
// frame, with its path tables. See docs/disassembly/P12_tunnel.md §2.2, §4 and P9_robot.md §5.

import { triangleOf, rasterTemplate, packedChannel, clippedSpan, SLOT_INTS, S } from '../engine/index.js';
import { sin, cos } from '../sine.js';

const WIDTH = 320;
const HEIGHT = 200;
/** 0x34f6c adds 0x20 to both image pointers: u = 0..255 reads columns 32..287. */
const WINDOW_LEFT = 0x20;
/** Row table 0x90e5c: rows past 199 read row 200 (the bytes after the image). */
const LAST_ROW = HEIGHT;

const PATH_ENTRIES = 256;
const PATH_MASK = PATH_ENTRIES - 1;
const PATH_CENTRE = 0x50;
/** D1350[i] = (sin(32i) >> 6) + 0x50; D0F50[i] = ((cos(6i) * sin(8i)) >> 13) + 0x50 (but see below). */
const SWAY_STEP = 32;
const SWAY_SHIFT = 6;
const WOBBLE_COS_STEP = 6;
const WOBBLE_SIN_STEP = 8;
const WOBBLE_SHIFT = 13;
/** LUTs 0xd1d58 / 0xd2158: light p = 64..127 brightened by 32 (sides) or 52 (centre), max 127. */
const LIGHT_FROM = 64;
const LIGHT_MAX = 127;
const SIDE_BOOST = 32;
const CENTRE_BOOST = 52;
const LUT_ENTRIES = 256;
const STREAK_BYTES = 4;

/**
 * 0x34f6c: the 0x331b4 triangle template (no horizontal reject), spans 0x4fef6 / 0x4ff39:
 * off = rowTable[v] + u + 0x20, pixel = shade[lightMap[off]*256 + image[off]].
 * `image` and `lightMap` are 64 KB blocks holding a 320x200 picture.
 */
export function drawChrome(polygon, context) {
  const triangle = triangleOf(context.vertices, polygon);
  const { texture: image, phongMap: lightMap } = polygon.material;
  const shade = context.colourTable;
  const target = context.target;
  const s = polygon.slots;
  const uv = triangle.order.flatMap((k) => [s[k * SLOT_INTS + S.U] << 8, s[k * SLOT_INTS + S.V] << 8]);
  rasterTemplate(triangle, [packedChannel(...uv)],
    (y, xLong, xShort, isLongLeft, values, dx) => clippedSpan(y, xLong, xShort, isLongLeft, values, dx,
      (at, value) => {
        const row = Math.min((value[0] >>> 24) & 0xff, LAST_ROW);
        const offset = row * WIDTH + ((value[0] >>> 8) & 0xff) + WINDOW_LEFT;
        target[at] = shade[(lightMap[offset] << 8) + image[offset]];
      }));
}

/** The lightning's state: the path tables built at the start of run 0x1a850, the LUTs, the saved bytes. */
export function createLightning() {
  const sway = new Int32Array(PATH_ENTRIES);
  const wobble = new Int32Array(PATH_ENTRIES);
  for (let i = 0; i < PATH_ENTRIES; i++) {
    sway[i] = (sin(SWAY_STEP * i) >> SWAY_SHIFT) + PATH_CENTRE;
    wobble[i] = (Math.imul(cos(WOBBLE_COS_STEP * i), sin(WOBBLE_SIN_STEP * i)) >> WOBBLE_SHIFT) + PATH_CENTRE;
  }
  // The same loop clears 256 entries of the 200-row table D0C30, which ends where D0F50 begins: the
  // first 56 wobble entries end up 0 (sic), so part of the time the streak runs at x ~ 80.
  wobble.fill(0, 0, PATH_ENTRIES - HEIGHT);
  const sides = new Uint8Array(LUT_ENTRIES);
  const centre = new Uint8Array(LUT_ENTRIES);
  for (let p = LIGHT_FROM; p <= LIGHT_MAX; p++) {
    sides[p] = Math.min(p + SIDE_BOOST, LIGHT_MAX);
    centre[p] = Math.min(p + CENTRE_BOOST, LIGHT_MAX);
  }
  return {
    sway,
    wobble,
    sides,
    centre,
    /** D0C30 / D1750: where each row's streak was and the 4 bytes it covered. */
    savedAt: new Int32Array(HEIGHT),
    saved: new Uint8Array(HEIGHT * STREAK_BYTES),
  };
}

/**
 * 0x1a654(lightMap, t): per row, put back the 4 bytes saved last time, then brighten 3 pixels at
 * o = wobble[(2t + i) & 255] + sway[(t + i) & 255] (and save the 4 bytes there first).
 */
export function drawLightning(lightning, lightMap, t) {
  const { sway, wobble, sides, centre, savedAt, saved } = lightning;
  for (let i = 0; i < HEIGHT; i++) {
    const row = WIDTH * i;
    lightMap.set(saved.subarray(STREAK_BYTES * i, STREAK_BYTES * (i + 1)), row + savedAt[i]);
    const o = wobble[(2 * t + i) & PATH_MASK] + sway[(t + i) & PATH_MASK];
    savedAt[i] = o;
    saved.set(lightMap.subarray(row + o, row + o + STREAK_BYTES), STREAK_BYTES * i);
    lightMap[row + o] = sides[lightMap[row + o]];
    lightMap[row + o + 1] = centre[lightMap[row + o + 1]];
    lightMap[row + o + 2] = sides[lightMap[row + o + 2]];
  }
}
