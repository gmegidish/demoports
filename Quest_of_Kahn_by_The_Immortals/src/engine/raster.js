// The demo's hand-written assembly rasteriser, KAHN.EXE 0x10f60..0x13cfe: everything that
// actually writes pixels. Transliterated from models that were checked byte for byte against the
// original machine code running in an emulator, so the odd corners are deliberate:
// the 32-bit carry chains, the zero-width span that draws sixteen pixels, the sheared sprite streak.
//
// Nothing here clips in x; callers hand over coordinates that are already on screen.

import { WIDTH, HEIGHT } from '../machine.js';

const f = Math.fround;
const TWO_32 = 0x100000000;
const TWO_24 = 0x1000000;
const HALF = 0x8000;
/** A 16.16 edge step includes one row of the buffer, so stepping an edge steps an address. */
const ROW_STEP = WIDTH << 16;
const SPAN = 16;

function s16(value) {
  return (value << 16) >> 16;
}

function s8(value) {
  return (value << 24) >> 24;
}

/** Round to nearest, ties to even. */
function rint(x) {
  const rounded = Math.round(x);
  if (rounded - x === 0.5 && (rounded & 1)) {
    return rounded - 1;
  }
  return rounded;
}

/** The x87's fistp to a dword: out of range and NaN store the "integer indefinite". */
function fist32(x) {
  if (!(x >= -2147483648.5 && x < 2147483647.5)) {
    return 0x80000000;
  }
  return rint(x) >>> 0;
}

/** fistp to a word. */
function fist16(x) {
  if (!Number.isFinite(x)) {
    return -32768;
  }
  const rounded = rint(x);
  return rounded >= -32768 && rounded <= 32767 ? rounded : -32768;
}

/**
 * The parameter block of the perspective fillers: a triangle already clipped, sorted and cut
 * into a top and a bottom part. One block is reused for every triangle.
 * @typedef {object} Trapezoids
 * @property {number} left offset in the buffer of the first scanline's left end
 * @property {number} right offset of its right end
 * @property {number} leftStep1 16.16 step per scanline of the left edge in the top part
 * @property {number} leftStep2 ... and in the bottom part
 * @property {number} rightStep1
 * @property {number} rightStep2
 * @property {number} zPerSpan change of 1/z across sixteen pixels
 * @property {number} uPerSpan change of 256 * u/z across sixteen pixels
 * @property {number} vPerSpan
 * @property {number} zPerRow1 change of 1/z per scanline down the left edge, top part
 * @property {number} zPerRow2
 * @property {number} uPerRow1
 * @property {number} uPerRow2
 * @property {number} vPerRow1
 * @property {number} vPerRow2
 * @property {number} z 1/z at the left end of the first scanline
 * @property {number} u 256 * u/z there
 * @property {number} v 256 * v/z there
 * @property {number} rows1 scanlines in the top part
 * @property {number} rows2 the bottom part draws one more than this, or nothing when it is zero
 */

/** @returns {Trapezoids} */
export function createTrapezoids() {
  return {
    left: 0, right: 0, leftStep1: 0, leftStep2: 0, rightStep1: 0, rightStep2: 0,
    zPerSpan: 0, uPerSpan: 0, vPerSpan: 0,
    zPerRow1: 0, zPerRow2: 0, uPerRow1: 0, uPerRow2: 0, vPerRow1: 0, vPerRow2: 0,
    z: 0, u: 0, v: 0, rows1: 0, rows2: 0,
  };
}

/**
 * Perspective-correct texture fill: the divide is done every sixteen pixels and texels step
 * linearly in 8.8 between. 0x1255b, or with a table 0x119c2: target = table[texel << 8 | target].
 * @param {Uint8Array} target
 * @param {Uint8Array} texture 256x256
 * @param {Uint8Array|null} table
 * @param {Trapezoids} s
 */
export function fillTrapezoids(target, texture, table, s) {
  const isBlended = table !== null;
  const zPerSpan = s.zPerSpan;
  const uPerSpan = s.uPerSpan;
  const vPerSpan = s.vPerSpan;
  let inverseZ = s.z;
  let uOverZ = s.u;
  let vOverZ = s.v;
  let zPerRow = s.zPerRow1;
  let uPerRow = s.uPerRow1;
  let vPerRow = s.vPerRow1;
  let leftStep = s.leftStep1;
  let rightStep = s.rightStep1;
  let left = isBlended ? s.left : s.left - 2;
  let right = isBlended ? s.right + 1 : s.right - 1;
  let leftFraction = isBlended ? HALF + 1 : HALF;
  let rightFraction = HALF;
  let z = 1.0 / inverseZ;
  let at = 0;

  /** Linear run between two exact texel positions a span apart. */
  const run = (u0, v0, u1, v1, count) => {
    // One 32-bit accumulator: v as 8.8 in the low word, the u fraction in the top byte. The byte
    // between collects the carries of v, and when it overflows it nudges u: kept, as the original does.
    let accumulator = (v0 & 0xffffff) + (u0 & 0xff) * TWO_24;
    const du = (u1 - u0) >>> 0;
    const step = ((du >>> 4) & 0xff) * TWO_24 + ((s16(v1 - v0) >> 4) & 0xffff);
    const uStep = (du >>> 12) & 0xff;
    let uTexel = (u0 >>> 8) & 0xff;
    for (let i = 0; i < count; i++) {
      const texel = texture[(accumulator & 0xff00) | uTexel];
      target[at] = isBlended ? table[(texel << 8) | target[at]] : texel;
      at++;
      accumulator += step;
      let carry = 0;
      if (accumulator >= TWO_32) {
        accumulator -= TWO_32;
        carry = 1;
      }
      uTexel = (uTexel + uStep + carry) & 0xff;
    }
  };

  const scanline = () => {
    let v0 = fist32(vOverZ * z);
    let u0 = fist32(uOverZ * z);
    let nextU = f(uOverZ + uPerSpan);
    let nextV = f(vOverZ + vPerSpan);
    // The reciprocal is of the sum before it is rounded to a float.
    let sum = inverseZ + zPerSpan;
    let nextInverseZ = f(sum);
    z = 1.0 / sum;

    const width = (right - left) >>> 0;
    let chunks = (width >>> 4) & 0xff;
    let remainder = width & 15;
    if (isBlended) {
      if (remainder === 0) {
        chunks = (chunks - 1) & 0xff;
        if (s8(chunks) >= 0) {
          remainder = SPAN;
        }
      }
    } else if (remainder === 0) {
      // An empty span comes out as sixteen pixels here: the opaque filler has no guard.
      remainder = SPAN;
      chunks = (chunks - 1) & 0xff;
    }
    const blocks = s8(chunks - 1) + 1;
    at = isBlended ? left : left + 2;

    for (let block = 0; block < blocks; block++) {
      const v1 = fist32(nextV * z);
      nextV = f(nextV + vPerSpan);
      const u1 = fist32(nextU * z);
      nextU = f(nextU + uPerSpan);
      sum = nextInverseZ + zPerSpan;
      nextInverseZ = f(sum);
      const nextZ = 1.0 / sum;
      run(u0, v0, u1, v1, SPAN);
      u0 = u1;
      v0 = v1;
      z = nextZ;
    }
    const v1 = fist32(nextV * z);
    const u1 = fist32(nextU * z);
    uOverZ = f(uOverZ + uPerRow);
    vOverZ = f(vOverZ + vPerRow);
    sum = inverseZ + zPerRow;
    inverseZ = f(sum);
    z = 1.0 / sum;
    run(u0, v0, u1, v1, remainder);

    leftFraction += leftStep & 0xffff;
    left += (leftStep >> 16) + (leftFraction >> 16);
    leftFraction &= 0xffff;
    rightFraction += rightStep & 0xffff;
    right += (rightStep >> 16) + (rightFraction >> 16);
    rightFraction &= 0xffff;
  };

  for (let row = 0; row < s.rows1; row++) {
    scanline();
  }
  if (s.rows2 > 0) {
    leftStep = s.leftStep2;
    rightStep = s.rightStep2;
    zPerRow = s.zPerRow2;
    uPerRow = s.uPerRow2;
    vPerRow = s.vPerRow2;
    for (let row = 0; row < s.rows2 + 1; row++) {
      scanline();
    }
  }
}

export const AFFINE_OPAQUE = 0;
/** Texel 0 is transparent. */
export const AFFINE_KEYED = 1;
/** No texture: target = table[target << 8 | u], with u interpolated across the triangle. */
export const AFFINE_SHADE = 2;

function truncatedDivide(a, b) {
  return Math.trunc(a / b);
}

/** Per-scanline 8.8 step of u or v down an edge. */
function edgeStep(delta, rows) {
  return ((truncatedDivide(delta * 65536, rows) >>> 0) >>> 8) & 0xffff;
}

function sortKey(vertex) {
  return ((vertex.y & 0xffff) << 16) | (vertex.x & 0xffff);
}

/**
 * Affine triangle with integer vertices, clipped in y only. 0x12962, 0x11e8c, 0x12fe1.
 * Only the low byte of a vertex's u and v places the texel; differences use the whole word.
 * @param {Uint8Array} target
 * @param {Uint8Array} source 256x256 texture, or the 64K table of the shade variant
 * @param {{x: number, y: number, u: number, v: number}} a
 * @param {{x: number, y: number, u: number, v: number}} b
 * @param {{x: number, y: number, u: number, v: number}} c
 * @param {number} variant AFFINE_OPAQUE, AFFINE_KEYED or AFFINE_SHADE
 */
export function fillAffineTriangle(target, source, a, b, c, variant) {
  const keyA = sortKey(a);
  const keyB = sortKey(b);
  const keyC = sortKey(c);
  if (keyA === keyB || keyA === keyC || keyB === keyC) {
    return;
  }
  // Top, middle, bottom: y first, then x.
  let top = a;
  let middle = b;
  let bottom = c;
  let swap;
  if (sortKey(middle) < sortKey(top)) {
    swap = top; top = middle; middle = swap;
  }
  if (sortKey(bottom) < sortKey(middle)) {
    swap = middle; middle = bottom; bottom = swap;
  }
  if (sortKey(middle) < sortKey(top)) {
    swap = top; top = middle; middle = swap;
  }
  if (sortKey(bottom) < 0 || sortKey(top) >= HEIGHT << 16) {
    return;
  }
  if ((bottom.y & 0xffff) === (top.y & 0xffff)) {
    return;
  }

  const dxLong = s16(bottom.x - top.x);
  const dxTop = s16(middle.x - top.x);
  const dyLong = s16(bottom.y - top.y);
  const dyTop = s16(middle.y - top.y);
  const dyBottom = dyLong - dyTop;
  const duLong = s16(bottom.u - top.u);
  const duTop = s16(middle.u - top.u);
  const dvLong = s16(bottom.v - top.v);
  const dvTop = s16(middle.v - top.v);

  // Constant horizontal gradients of u and v, 8.8.
  const determinant = dxLong * dyTop - dxTop * dyLong;
  const gradient = (long, short) => {
    if (determinant === 0) {
      return -32768;
    }
    return fist16((long * 256 * dyTop - short * 256 * dyLong) * (1.0 / determinant));
  };
  const uPerPixel = gradient(duLong, duTop) & 0xffff;
  const vPerPixel = gradient(dvLong, dvTop) & 0xffff;

  const longSlope = truncatedDivide(dxLong * 65536, dyLong);
  // The span's width is tracked as its own 16.16 accumulator, wrapping at 32 bits.
  let width = 0;
  let rows1;
  let rows2 = 0;
  let topSlope = 0;
  let isMiddleOnLeft = false;
  if (dyTop === 0) {
    width = ((dxTop & 0xffff) << 16) >>> 0;
    rows1 = 0;
  } else {
    topSlope = truncatedDivide(dxTop * 65536, dyTop);
    rows1 = dyTop;
    isMiddleOnLeft = topSlope < longSlope;
  }

  let widthStep1;
  let widthStep2 = 0;
  let leftStep1;
  let leftStep2 = null;
  let uStep1;
  let vStep1;
  let uStep2 = 0;
  let vStep2 = 0;
  if (isMiddleOnLeft) {
    widthStep1 = (longSlope - topSlope) >>> 0;
    leftStep1 = (topSlope + ROW_STEP) >>> 0;
    uStep1 = edgeStep(duTop, dyTop);
    vStep1 = edgeStep(dvTop, dyTop);
    if (dyBottom === 0) {
      // Flat bottom: the textured variants draw its row too, the shade variant does not.
      if (variant !== AFFINE_SHADE) {
        rows1 += 1;
      }
    } else {
      const bottomSlope = truncatedDivide(s16(bottom.x - middle.x) * 65536, dyBottom);
      widthStep2 = (longSlope - bottomSlope) >>> 0;
      leftStep2 = (bottomSlope + ROW_STEP) >>> 0;
      uStep2 = edgeStep(s16(bottom.u - middle.u), dyBottom);
      vStep2 = edgeStep(s16(bottom.v - middle.v), dyBottom);
      rows2 = dyBottom + 1;
    }
  } else {
    widthStep1 = (topSlope - longSlope) >>> 0;
    uStep1 = edgeStep(duLong, dyLong);
    vStep1 = edgeStep(dvLong, dyLong);
    uStep2 = uStep1;
    vStep2 = vStep1;
    const bottomSlope = truncatedDivide(s16(bottom.x - middle.x) * 65536, dyBottom);
    widthStep2 = (bottomSlope - longSlope) >>> 0;
    rows2 = dyBottom + 1;
    leftStep1 = (longSlope + ROW_STEP) >>> 0;
    leftStep2 = leftStep1;
  }

  // Bottom clip: the last row drawn is the screen's last.
  if (s16(bottom.y) >= HEIGHT) {
    rows2 = s16(rows2 - (s16(bottom.y) - (HEIGHT - 1)));
    if (rows2 < 0) {
      rows1 = s16(rows1 + rows2);
      rows2 = 0;
    }
  }

  let u = top.u & 0xff;
  let v = top.v & 0xff;
  let vCarry = 0;
  let at;
  let leftFraction;
  const topY = s16(top.y);
  if (topY >= 0) {
    at = (top.x & 0xffff) + topY * WIDTH;
    leftFraction = HALF;
  } else {
    // Top clip: skip the rows above the screen.
    const skipped = -topY;
    if (rows1 - skipped >= 0) {
      rows1 -= skipped;
      const advance = skipped * ((leftStep1 - ROW_STEP) | 0);
      const fraction = (advance & 0xffff) + HALF;
      at = (top.x & 0xffff) + Math.floor(advance / 65536) + (fraction >> 16);
      leftFraction = fraction & 0xffff;
      u = (((u << 8) + skipped * uStep1) & 0xffff) >> 8;
      v = (((v << 8) + skipped * vStep1) & 0xffff) >> 8;
      width = (width + skipped * widthStep1) >>> 0;
    } else {
      const intoBottom = skipped - rows1;
      rows2 = s16(rows2 + rows1 - skipped);
      if (leftStep1 === leftStep2) {
        const advance = skipped * ((leftStep1 - ROW_STEP) | 0);
        const fraction = (advance & 0xffff) + HALF;
        at = (top.x & 0xffff) + Math.floor(advance / 65536) + (fraction >> 16);
        leftFraction = fraction & 0xffff;
        u = (u + (((skipped * uStep1) & 0xffff) >> 8)) & 0xff;
        v = (v + (((skipped * vStep1) & 0xffff) >> 8)) & 0xff;
      } else {
        const advance = intoBottom * ((leftStep2 - ROW_STEP) | 0);
        const fraction = (advance & 0xffff) + HALF;
        at = (middle.x & 0xffff) + Math.floor(advance / 65536) + (fraction >> 16);
        leftFraction = fraction & 0xffff;
        const combined = (((middle.v & 0xff) << 16) | (middle.u & 0xff))
          + ((((intoBottom * vStep2) & 0xffff) << 8) | (((intoBottom * uStep2) & 0xffff) >> 8));
        u = combined & 0xff;
        v = (combined >> 16) & 0xff;
        vCarry = (combined >> 24) & 0xff;
      }
      width = (-(widthStep2 * (rows2 & 0xffff))) >>> 0;
      rows1 = 0;
    }
  }
  at >>>= 0;

  // u and v both start half a texel in.
  let uFraction = 0x80;
  let v16 = (v << 8) | 0x80 | vCarry;
  if (variant === AFFINE_OPAQUE) {
    width = (width + 1) >>> 0;
  } else if (variant === AFFINE_SHADE) {
    width = (width + 0xffff0001) >>> 0;
  }
  const pixelStep = (uPerPixel & 0xff) * TWO_24 + vPerPixel;
  const uTexelStep = (uPerPixel >> 8) & 0xff;

  const fillRows = (count, leftStep, widthStep, uStep, vStep) => {
    for (let row = 0; row < count; row++) {
      const total = (width + leftFraction) | 0;
      const whole = total >> 16;
      let pixels;
      if (variant === AFFINE_SHADE) {
        pixels = total < 0 ? 0 : whole + 1;
      } else {
        pixels = Math.max(whole, 0) + 1;
      }
      let accumulator = uFraction * TWO_24 + v16;
      let uTexel = u;
      let offset = at | 0;
      for (let i = 0; i < pixels; i++) {
        if (variant === AFFINE_SHADE) {
          target[offset] = source[(target[offset] << 8) | uTexel];
        } else {
          const texel = source[(accumulator & 0xff00) | uTexel];
          if (variant === AFFINE_OPAQUE || texel !== 0) {
            target[offset] = texel;
          }
        }
        offset++;
        accumulator += pixelStep;
        let carry = 0;
        if (accumulator >= TWO_32) {
          accumulator -= TWO_32;
          carry = 1;
        }
        uTexel = (uTexel + uTexelStep + carry) & 0xff;
      }

      leftFraction += leftStep & 0xffff;
      at = (at + (leftStep >>> 16) + (leftFraction >> 16)) >>> 0;
      leftFraction &= 0xffff;
      let edge = uFraction * TWO_24 + v16 + (uStep & 0xff) * TWO_24 + vStep;
      let carry = 0;
      if (edge >= TWO_32) {
        edge -= TWO_32;
        carry = 1;
      }
      uFraction = Math.floor(edge / TWO_24) & 0xff;
      v16 = edge & 0xffff;
      u = (u + (uStep >> 8) + carry) & 0xff;
      width = (width + widthStep) >>> 0;
    }
  };

  if (rows1 > 0) {
    fillRows(rows1, leftStep1, widthStep1, uStep1, vStep1);
  }
  if (rows2 > 0) {
    fillRows(rows2, leftStep2, widthStep2, uStep2, vStep2);
  }
}

const LAST_ROW_PACKED = (HEIGHT - 1) << 16;
const SCREEN_END_PACKED = HEIGHT << 16;

/**
 * A whole 256x256 texture scaled into a rectangle and mixed with what is there through a table:
 * the flares. Corners arrive packed as (y << 16) + x, built with a plain 32-bit add, so a negative
 * x borrows from y; the routine works on the halves of that sum. 0x10f60.
 */
export function drawScaledSprite(target, texture, table, corner0, corner1) {
  const p0 = corner0 >>> 0;
  const p1 = corner1 >>> 0;
  const x0 = s16(p0);
  const x1 = s16(p1);
  const y0 = s16(p0 >>> 16);
  if (x0 >= WIDTH || x1 < 0 || (p0 | 0) >= SCREEN_END_PACKED || (p1 | 0) < 0) {
    return;
  }
  const size = (p1 - p0) >>> 0;
  let width = s16(size);
  let height = s16(size >>> 16);
  if (width < 2 || height < 2) {
    return;
  }
  const uStep = Math.floor(0x10000 / width);
  const vStep = Math.floor(0x10000 / height);
  let at = 0;
  let u = 0;
  let v = 0;
  if ((p0 | 0) < 0) {
    height = s16(height + y0);
    v = (-y0 * vStep) & 0xffff;
  } else {
    at += y0 * WIDTH;
  }
  const pastLastRow = (p1 - LAST_ROW_PACKED) >>> 0;
  if ((pastLastRow | 0) >= 0) {
    height = s16(height - (pastLastRow >>> 16));
  }
  if (x0 < 0) {
    width = s16(width + x0);
    u = (-x0 * uStep) & 0xffff;
  } else {
    at += x0;
  }
  if (x1 - (WIDTH - 1) >= 0) {
    width = s16(width - (x1 - (WIDTH - 1)));
  }

  // Clipped down to nothing, it still draws a pair of pixels per row and at least one row.
  const rows = Math.max(height, 1);
  const isWideEnough = width - 2 >= 0;
  const pixels = isWideEnough ? width : ((width - 2) & 1 ? 3 : 2);
  const rowAdvance = isWideEnough ? WIDTH : pixels + WIDTH - width;
  for (let row = 0; row < rows; row++) {
    let uAt = u;
    for (let i = 0; i < pixels; i++) {
      const texel = texture[(v & 0xff00) | (uAt >> 8)];
      const under = target[at + i];
      // The index order alternates from pixel to pixel; invisible with a symmetric table.
      target[at + i] = i & 1 ? table[(under << 8) | texel] : table[(texel << 8) | under];
      uAt = (uAt + uStep) & 0xffff;
    }
    at += rowAdvance;
    v = (v + vStep) & 0xffff;
  }
}
