// exe3's scenes: the 3D rotation, the stars and cubes, the IFS fractals and the dot morph
// (docs/disassembly/H3_ifs_morphs.md). Everything reads and writes the part's variables in memory, at their
// original addresses, with the original 16-bit arithmetic.
/** @typedef {import('../machine.js').Machine} Machine */
import {
  ANGLE_Z, ANGLE_Y, ANGLE_X, STAR_ANGLE_Z, STAR_ANGLE_Y, STAR_ANGLE_X, POINT_X, POINT_Y, POINT_Z, ROTATED_X1,
  ROTATED_X, ROTATED_Y1, ROTATED_Y, ROTATED_Z1, ROTATED_Z, SCREEN_X, SCREEN_Y, TRANSLATE_X, TRANSLATE_Y,
  TRANSLATE_Z, PERSPECTIVE, SIN_TABLE, COS_TABLE, CUBE_SPIN, CUBE_ANGLES, CUBE_POSITIONS, FACE_COLOURS,
  CUBE_VERTICES, PROJECTED_VERTICES, FACE_POINTS, BACKFACE_VECTORS, CUBE_FACES, IS_BACKFACE, VERTEX_INDEX,
  FACE_NUMBER, STARS, STAR_MOTION, CUBE_MOTION, CUBE_Y_OFFSET, DOT_LIST_INDEX, MORPH_FRAMES, IFS_WEIGHT,
  MORPH_WEIGHT, PLOT_X, PLOT_Y, PLOT_SEGMENT, PLOT_COLOUR, PAGE_FLAG, IS_CUBES_DONE, LOGO_STATE,
  RANDOM_MULTIPLIER, RANDOM_STATE, IFS_DIVISOR, FERN_SCALE, IFS_OUT_X, IFS_OUT_Y, IFS_OUT_Z, IFS_TERM,
  RANDOM_VALUE, BLEND_A_X, BLEND_A_Y, BLEND_B_X, BLEND_B_Y, BLEND_A_Z, BLEND_B_Z, BLEND_WEIGHT, IFS_BLEND_DIVISOR,
  MORPH_BLEND_DIVISOR, IFS_FIRST, IFS_SECOND, FERN_SHAPE_INDEX, IFS_X_OFFSET_A,
  IFS_X_OFFSET_B, FERN_SHAPE, MORPH_POINTS, MORPH_STEP, IS_FERN_SHAPE_MADE, SHAPE_A_PATCHES, SHAPE_B_PATCHES,
  POLYGON, DATA, s16, idiv16,
} from './exe3-memory.js';
import { plot, rememberDot, eraseDots, fillPolygon, PAGE0_SEGMENT, PAGE1_SEGMENT } from './exe3-video.js';

/**
 * One IFS function of 07d9/0865/08f1/097d: map thresholds (int8), the six coefficient tables (A..F, one int16
 * per map), its persistent point and the x offset it returns in bx.
 * @typedef {{ thresholds: number, a: number, b: number, c: number, d: number, e: number, f: number,
 *   stateX: number, stateY: number, xOffset: number }} IfsFunction
 */

const D = DATA;
/** The four IFS functions by code address (what [2286] / [2288] hold). */
const IFS_FUNCTIONS = new Map([
  [0x07d9, { thresholds: D + 0x1e76, a: D + 0x1e52, b: D + 0x1e58, c: D + 0x1e5e, d: D + 0x1e64, e: D + 0x1e6a, f: D + 0x1e70, stateX: D + 0x1168, stateY: D + 0x116a, xOffset: 0x3c }],
  [0x0865, { thresholds: D + 0x1e9f, a: D + 0x1e7b, b: D + 0x1e81, c: D + 0x1e87, d: D + 0x1e8d, e: D + 0x1e93, f: D + 0x1e99, stateX: D + 0x116c, stateY: D + 0x116e, xOffset: 0x32 }],
  [0x08f1, { thresholds: D + 0x1ed4, a: D + 0x1ea4, b: D + 0x1eac, c: D + 0x1eb4, d: D + 0x1ebc, e: D + 0x1ec4, f: D + 0x1ecc, stateX: D + 0x1170, stateY: D + 0x1172, xOffset: 0x8c }],
  [0x097d, { thresholds: D + 0x1f09, a: D + 0x1ed9, b: D + 0x1ee1, c: D + 0x1ee9, d: D + 0x1ef1, e: D + 0x1ef9, f: D + 0x1f01, stateX: D + 0x1174, stateY: D + 0x1176, xOffset: 0x8c }],
]);

const STAR_COUNT = 64;
const CUBE_COUNT = 7;
const CUBE_VERTEX_COUNT = 8;
const CUBE_FACE_COUNT = 6;
const IFS_DOTS = 900;
const MORPH_DOTS = 400;
const FERN_SHAPE_POINTS = 400;
const RANDOM_RANGE = 0x63;
const ERASE_IFS_FRAMES = 2;
const MORPH_ERASE_COUNT = 401;

/** The high word of the signed product int16(2a) * t: `shl ax,1; imul dx` then dx. */
function scaled(a, t) {
  return (s16(a << 1) * t) >> 16;
}

/** 0000:0f11 rotate_project: [f02..f0e] rotated by angles [0],[2],[4], translated, projected to [f14],[f16]. */
export function rotateProject(m) {
  let c = m.s16(COS_TABLE + m.u16(ANGLE_Z) * 2);
  let s = m.s16(SIN_TABLE + m.u16(ANGLE_Z) * 2);
  const x = m.u16(POINT_X);
  const y = m.u16(POINT_Y);
  const z = m.u16(POINT_Z);
  m.set16(ROTATED_X1, scaled(x, c) - scaled(y, s));
  m.set16(ROTATED_Y1, scaled(y, c) + scaled(x, s));
  c = m.s16(COS_TABLE + m.u16(ANGLE_Y) * 2);
  s = m.s16(SIN_TABLE + m.u16(ANGLE_Y) * 2);
  const x1 = m.u16(ROTATED_X1);
  m.set16(ROTATED_Z1, scaled(z, c) - scaled(x1, s));
  m.set16(ROTATED_X, scaled(x1, c) + scaled(z, s));
  c = m.s16(COS_TABLE + m.u16(ANGLE_X) * 2);
  s = m.s16(SIN_TABLE + m.u16(ANGLE_X) * 2);
  const y1 = m.u16(ROTATED_Y1);
  const z1 = m.u16(ROTATED_Z1);
  m.set16(ROTATED_Z, scaled(z1, c) - scaled(y1, s));
  m.set16(ROTATED_Y, scaled(y1, c) + scaled(z1, s));
  m.set16(ROTATED_X, m.u16(ROTATED_X) + m.u16(TRANSLATE_X));
  m.set16(ROTATED_Y, m.u16(ROTATED_Y) + m.u16(TRANSLATE_Y));
  m.set16(ROTATED_Z, m.u16(ROTATED_Z) + m.u16(TRANSLATE_Z));
  const half = m.u16(PERSPECTIVE) >>> 1;
  m.set16(SCREEN_X, idiv16(m.s16(ROTATED_X) * s16(half), s16(m.u16(ROTATED_Z) + half)) + 0xa0);
  const distance = m.u16(PERSPECTIVE);
  m.set16(SCREEN_Y, idiv16(m.s16(ROTATED_Y) * s16(distance), s16(m.u16(ROTATED_Z) + distance)) + 0xc8);
}

/** 0000:0a09 seed_rng: the original takes dl ^ dh ^ ch ^ cl of the DOS time, | 1, & 0xfd. */
export function seedRandom(m, seed) {
  m.set16(RANDOM_STATE, seed);
}

/** 0000:0a1f rand_mod: state = state * 5421 (16 bits); returns state % range. */
function randomBelow(m, range) {
  const state = (m.u16(RANDOM_STATE) * m.u16(RANDOM_MULTIPLIER)) & 0xffff;
  m.set16(RANDOM_STATE, state);
  return state % range;
}

/** One IFS step (07d9 etc.) with the random number [1180]: the new point to its state and [1178], [117a]. */
function ifsStep(m, address) {
  const fn = IFS_FUNCTIONS.get(address);
  const r = m.s8(RANDOM_VALUE);
  let map = 4;
  for (let k = 0; k < 4; k++) {
    if (r <= m.s8(fn.thresholds + k)) {
      map = k;
      break;
    }
  }
  const divisor = m.s16(IFS_DIVISOR);
  const x = m.s16(fn.stateX);
  const y = m.s16(fn.stateY);
  const offset = map * 2;
  let t1 = idiv16(m.s16(fn.a + offset) * x, divisor);
  let t2 = idiv16(m.s16(fn.b + offset) * y, divisor);
  m.set16(IFS_TERM, t1);
  const nx = (t1 + t2 + m.u16(fn.e + offset) + ((t1 + t2) >>> 16)) & 0xffff;
  t1 = idiv16(m.s16(fn.c + offset) * x, divisor);
  t2 = idiv16(m.s16(fn.d + offset) * y, divisor);
  m.set16(IFS_TERM, t1);
  const ny = (t1 + t2 + m.u16(fn.f + offset) + ((t1 + t2) >>> 16)) & 0xffff;
  m.set16(IFS_OUT_X, nx);
  m.set16(IFS_OUT_Y, ny);
  m.set16(fn.stateX, nx);
  m.set16(fn.stateY, ny);
  return fn.xOffset;
}

// ---- cube phase ----

/** 0000:0d24 draw_stars: 64 rotating stars flying away, clipped to the screen. */
export function drawStars(m) {
  const STAR_DISTANCE = 0xa5a;
  const STAR_DEPTH = 0x708;
  const STAR_WRAP = 0xe10;
  m.set16(ANGLE_Z, m.u16(STAR_ANGLE_Z));
  m.set16(ANGLE_Y, m.u16(STAR_ANGLE_Y));
  m.set16(ANGLE_X, m.u16(STAR_ANGLE_X));
  m.set16(TRANSLATE_X, 0);
  m.set16(TRANSLATE_Y, 0);
  m.set16(TRANSLATE_Z, STAR_DISTANCE);
  m.set16(DOT_LIST_INDEX, 0);
  for (let i = 0; i < STAR_COUNT; i++) {
    const star = STARS + i * 6;
    m.set16(POINT_X, m.u16(star));
    m.set16(POINT_Y, m.u16(star + 2));
    let z = s16(m.u16(star + 4) + m.u16(STAR_MOTION));
    if (z >= STAR_DEPTH) {
      z -= STAR_WRAP;
    } else if (z <= -STAR_DEPTH) {
      z += STAR_WRAP;
    }
    m.set16(star + 4, z);
    m.set16(POINT_Z, z);
    rotateProject(m);
    if (m.u16(SCREEN_X) > 0x13f) {
      continue;
    }
    m.set16(PLOT_X, m.u16(SCREEN_X));
    if (m.u16(SCREEN_Y) > 0x18f) {
      continue;
    }
    m.set16(PLOT_Y, m.u16(SCREEN_Y));
    m.set8(PLOT_COLOUR, ((((m.u16(ROTATED_Z) - m.u16(TRANSLATE_Z) + 0x1f4) & 0xffff) >>> 7) + 0x4c) & 0xff);
    rememberDot(m, plot(m));
  }
  m.set16(STAR_MOTION, 0);
}

/** 0000:101d backface_test: [fbc] = 1 when the face at [fb0..fba] (P0, P2, P1 as given) turns away. */
function testBackface(m) {
  const v = BACKFACE_VECTORS;
  const ax = m.u16(v + 8);
  const ay = m.u16(v + 10);
  m.set16(v, m.u16(v) - ax);
  m.set16(v + 2, m.u16(v + 2) - ay);
  m.set16(v + 4, m.u16(v + 4) - ax);
  m.set16(v + 6, m.u16(v + 6) - ay);
  const cross = m.s16(v) * m.s16(v + 6) - m.s16(v + 2) * m.s16(v + 4);
  m.set8(IS_BACKFACE, cross > 0 ? 1 : 0);
}

/** 05b6..062d: the screen points of one face into [f88..f96] (x0..x3, y0..y3) and the backface vectors. */
function loadFace(m, face) {
  const vertexX = (n) => m.u16(PROJECTED_VERTICES + m.u8(CUBE_FACES + face * 4 + n) * 4);
  const vertexY = (n) => m.u16(PROJECTED_VERTICES + m.u8(CUBE_FACES + face * 4 + n) * 4 + 2);
  const backfaceSlots = [0, 8, 4];
  for (let n = 0; n < 4; n++) {
    m.set16(FACE_POINTS + n * 2, vertexX(n));
    m.set16(FACE_POINTS + 8 + n * 2, vertexY(n));
    if (n < 3) {
      m.set16(BACKFACE_VECTORS + backfaceSlots[n], vertexX(n));
      m.set16(BACKFACE_VECTORS + backfaceSlots[n] + 2, vertexY(n));
    }
  }
}

/** 0000:04a6 draw_cubes: 7 spinning cubes, nearer each retrace; ends the cube phase at z <= 6200. */
export function drawCubes(m) {
  const CUBE_NEAREST = 0x1838;
  const ANGLE_WRAP = 0x7cf;
  m.set16(TRANSLATE_Z, 0x1194);
  m.set16(PERSPECTIVE, 0x12c);
  for (let i = 0; i < CUBE_COUNT; i++) {
    const position = CUBE_POSITIONS + i * 6 + 4;
    let z = (m.u16(position) + m.u16(CUBE_MOTION)) & 0xffff;
    if (z <= CUBE_NEAREST) {
      z = (z + m.u16(CUBE_MOTION)) & 0xffff;
      m.set8(IS_CUBES_DONE, 1);
      m.set8(LOGO_STATE, 1);
    }
    m.set16(position, z);
  }
  m.set16(CUBE_MOTION, 0);
  m.set8(FACE_NUMBER, 0);
  const angleSlots = [ANGLE_Z, ANGLE_Y, ANGLE_X];
  const translationSlots = [TRANSLATE_X, TRANSLATE_Y, TRANSLATE_Z];
  for (let i = 0; i < CUBE_COUNT; i++) {
    for (let a = 0; a < 3; a++) {
      const k = (i * 3 + a) * 2;
      let angle = (m.u16(CUBE_SPIN + k) + m.u16(CUBE_ANGLES + k)) & 0xffff;
      if (angle >= ANGLE_WRAP) {
        angle -= ANGLE_WRAP;
      }
      m.set16(CUBE_ANGLES + k, angle);
      m.set16(angleSlots[a], angle);
      m.set16(translationSlots[a], m.u16(CUBE_POSITIONS + k));
    }
    m.set8(VERTEX_INDEX, 0);
    for (let v = 0; v < CUBE_VERTEX_COUNT; v++) {
      m.set16(POINT_X, m.u16(CUBE_VERTICES + v * 6));
      m.set16(POINT_Y, m.u16(CUBE_VERTICES + v * 6 + 2));
      m.set16(POINT_Z, m.u16(CUBE_VERTICES + v * 6 + 4));
      rotateProject(m);
      const slot = PROJECTED_VERTICES + m.u8(VERTEX_INDEX);
      m.set16(slot, m.u16(SCREEN_X));
      m.set16(slot + 2, m.u16(SCREEN_Y));
      m.set8(VERTEX_INDEX, m.u8(VERTEX_INDEX) + 4);
    }
    for (let face = 0; face < CUBE_FACE_COUNT; face++) {
      loadFace(m, face);
      m.set8(FACE_NUMBER, m.u8(FACE_NUMBER) + 1);
      testBackface(m);
      if (m.u8(IS_BACKFACE) !== 0) {
        continue;
      }
      drawFace(m);
    }
  }
}

/** 0640..0694: the visible face as a 4-point polygon, raised by the y offset at cs:04a4. */
function drawFace(m) {
  const yOffset = m.u16(CUBE_Y_OFFSET);
  m.set8(POLYGON, 4);
  m.set8(POLYGON + 1, m.u8(FACE_COLOURS + m.u8(FACE_NUMBER)));
  for (let n = 0; n < 4; n++) {
    m.set16(POLYGON + 2 + n * 4, m.u16(FACE_POINTS + n * 2));
    m.set16(POLYGON + 4 + n * 4, m.u16(FACE_POINTS + 8 + n * 2) - yOffset);
  }
  fillPolygon(m);
}

// ---- IFS phase ----

/** sar [1178], 1 (done with rcr and an `or 0x8000`), plus the function's x offset. */
function halveAndShift(m, xOffset) {
  m.set16(IFS_OUT_X, m.s16(IFS_OUT_X) >> 1);
  return (m.u16(IFS_OUT_X) + xOffset) & 0xffff;
}

/** dx:ax = a * w + (limit - w) * b (unsigned), divided by `divisor`: 07a4..0798's blend. */
function blendUnsigned(a, b, weight, limit, divisor) {
  return Math.floor((a * weight + ((limit - weight) & 0xffff) * b) / divisor) & 0xffff;
}

/** 0000:06ad draw_ifs: 900 dots, a blend of the IFS functions [2286] and [2288] with weight [f28]. */
export function drawIfs(m) {
  const IFS_BASELINE = 0x163;
  const IFS_TOP = 0x28;
  const MAX_ROW = 0x190;
  const weight = m.u16(IFS_WEIGHT);
  m.set16(BLEND_WEIGHT, weight);
  const isPage1 = m.u8(PAGE_FLAG) !== 0;
  m.set16(PLOT_SEGMENT, isPage1 ? PAGE1_SEGMENT : PAGE0_SEGMENT);
  eraseDots(m, isPage1, IFS_DOTS);
  m.set16(DOT_LIST_INDEX, 0);
  const divisor = m.u16(IFS_BLEND_DIVISOR);
  for (let i = 0; i < IFS_DOTS; i++) {
    m.set16(RANDOM_VALUE, randomBelow(m, RANDOM_RANGE));
    m.set16(IFS_X_OFFSET_A, ifsStep(m, m.u16(IFS_FIRST)));
    m.set16(BLEND_A_X, halveAndShift(m, m.u16(IFS_X_OFFSET_A)));
    m.set16(BLEND_A_Y, m.u16(IFS_OUT_Y));
    m.set16(IFS_X_OFFSET_B, ifsStep(m, m.u16(IFS_SECOND)));
    m.set16(BLEND_B_X, halveAndShift(m, m.u16(IFS_X_OFFSET_B)));
    m.set16(BLEND_B_Y, m.u16(IFS_OUT_Y));
    const blendWeight = m.u16(BLEND_WEIGHT);
    m.set16(IFS_OUT_X, blendUnsigned(m.u16(BLEND_A_X), m.u16(BLEND_B_X), blendWeight, 0x3f, divisor));
    m.set16(IFS_OUT_Y, blendUnsigned(m.u16(BLEND_A_Y), m.u16(BLEND_B_Y), blendWeight, 0x3f, divisor));
    m.set16(PLOT_X, m.u16(IFS_OUT_X));
    const row = s16(IFS_BASELINE - m.u16(IFS_OUT_Y));
    if (row > MAX_ROW) {
      continue;
    }
    m.set16(PLOT_Y, row + IFS_TOP);
    rememberDot(m, plot(m));
  }
}

// ---- morph phase ----

/** 0000:0cb5 make_fern_shape: 400 more steps of the fern [2286] as flat 3D points at [2c02]. */
function makeFernShape(m) {
  const FERN_TOP = 0x960;
  const FERN_LEFT = 0x28a;
  m.set16(MORPH_STEP, 0xe6);
  for (let i = 0; i < FERN_SHAPE_POINTS; i++) {
    m.set16(RANDOM_VALUE, randomBelow(m, RANDOM_RANGE));
    ifsStep(m, m.u16(IFS_FIRST));
    m.set16(IFS_OUT_X, m.s8(IFS_OUT_X) * m.s8(FERN_SCALE));
    m.set16(IFS_OUT_Y, FERN_TOP - ((m.u16(IFS_OUT_Y) * m.u16(FERN_SCALE)) & 0xffff));
    const index = m.u16(FERN_SHAPE_INDEX);
    m.set16(FERN_SHAPE + index, m.u16(IFS_OUT_X) - FERN_LEFT);
    m.set16(FERN_SHAPE + index + 2, m.u16(IFS_OUT_Y));
    m.set16(FERN_SHAPE + index + 4, 0);
    m.set16(FERN_SHAPE_INDEX, index + 6);
  }
}

/** a * w + (255 - w) * b, signed, `idiv` by [1f1e] (255): 0b7c..0c3b's blend. */
function blendSigned(a, b, weight, divisor) {
  return idiv16(a * weight + s16((0xff - weight) & 0xffff) * b, divisor);
}

/** 0000:0b09 draw_morph: 400 dots blended between shape A and shape B, rotated about Y. */
export function drawMorph(m) {
  const MORPH_DISTANCE = 0x1194;
  const MORPH_ROW_OFFSET = 0x2d;
  const weight = m.u16(MORPH_WEIGHT);
  m.set16(BLEND_WEIGHT, weight);
  if (m.u8(IS_FERN_SHAPE_MADE) !== 1) {
    m.set8(IS_FERN_SHAPE_MADE, 1);
    makeFernShape(m);
  }
  const isPage1 = m.u8(PAGE_FLAG) !== 0;
  m.set16(PLOT_SEGMENT, isPage1 ? PAGE1_SEGMENT : PAGE0_SEGMENT);
  const eraseCount = m.u16(MORPH_FRAMES) < ERASE_IFS_FRAMES ? IFS_DOTS : MORPH_ERASE_COUNT;
  m.set16(MORPH_FRAMES, m.u16(MORPH_FRAMES) + 1);
  eraseDots(m, isPage1, eraseCount);
  m.set16(TRANSLATE_X, 0);
  m.set16(TRANSLATE_Y, 0);
  m.set16(TRANSLATE_Z, MORPH_DISTANCE);
  const shapeA = D + m.u16(SHAPE_A_PATCHES[0]);
  const shapeB = D + m.u16(SHAPE_B_PATCHES[0]);
  const blendWeight = m.s16(BLEND_WEIGHT);
  const divisor = m.s16(MORPH_BLEND_DIVISOR);
  const outputs = [IFS_OUT_X, IFS_OUT_Y, IFS_OUT_Z];
  const aSlots = [BLEND_A_X, BLEND_A_Y, BLEND_A_Z];
  const bSlots = [BLEND_B_X, BLEND_B_Y, BLEND_B_Z];
  for (let i = 0; i < MORPH_DOTS; i++) {
    for (let c = 0; c < 3; c++) {
      m.set16(aSlots[c], m.u16(shapeA + i * 6 + c * 2));
      m.set16(bSlots[c], m.u16(shapeB + i * 6 + c * 2));
    }
    for (let c = 0; c < 3; c++) {
      m.set16(outputs[c], blendSigned(m.s16(aSlots[c]), m.s16(bSlots[c]), blendWeight, divisor));
      m.set16(MORPH_POINTS + i * 6 + c * 2, m.u16(outputs[c]));
    }
  }
  m.set16(DOT_LIST_INDEX, 0);
  for (let i = 0; i < MORPH_DOTS; i++) {
    m.set16(POINT_X, m.u16(MORPH_POINTS + i * 6));
    m.set16(POINT_Y, m.u16(MORPH_POINTS + i * 6 + 2));
    m.set16(POINT_Z, m.u16(MORPH_POINTS + i * 6 + 4));
    rotateProject(m);
    m.set16(PLOT_X, m.u16(SCREEN_X));
    m.set16(PLOT_Y, m.u16(SCREEN_Y) + MORPH_ROW_OFFSET);
    m.set8(PLOT_COLOUR, ((((m.u16(ROTATED_Z) - m.u16(TRANSLATE_Z) + 0x1f4) & 0xffff) >>> 7) + 0x4f) & 0xff);
    rememberDot(m, plot(m));
  }
}

