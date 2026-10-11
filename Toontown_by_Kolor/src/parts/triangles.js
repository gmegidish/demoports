// The texture-mapped triangle fillers 0x106574, 0x106d1a, 0x1074af and 0x107b7b (docs/disassembly/B_mesh.md).
//
// The four routines are one piece of code compiled four times with a different inner loop and different clipping:
// sort the corners by y, walk a left edge (x, u, v and a shade s) and a right edge (x) down the screen, and fill
// each row from the left edge's u, v, s with the triangle's constant gradients. A vertex is 20 bytes in memory:
// x, y, u, v, s (int32). The texture is 256x256; u and v are walked in 8.8 fixed point, s in 16.16.
//
// fillTriangle(m, variant, ...) is the shared walk; a variant names its inner loop and its clipping, as the
// original routines differ. 0x107b7b (part 9) is the same walk with its own edge globals (0x170680..): add its
// variant here.

/** @typedef {import('../machine.js').Machine} Machine */
/**
 * @typedef {object} TriangleVariant
 * @property {number} lastColumn the right clip: a row ends at min(right edge, lastColumn) (exclusive)
 * @property {(y: number) => boolean} isRowDrawn the rows the routine draws
 * @property {(m: Machine, at: number, texel: number, shade: number) => void} plot one pixel: `texel` is the
 *   texture's byte, `shade` the s value's integer part
 */

const SCREEN_WIDTH = 320;
const LAST_ROW = 199;
/** The smallest width (16.16) the gradients are divided by: a triangle is at least 1/16 pixel wide. */
const MIN_WIDTH = 0x1000;

const X = 0;
const Y = 4;
const U = 8;
const V = 0xc;
const S = 0x10;

/** idiv: the quotient truncated toward zero (exact for |a| < 2^53). */
function divide(a, b) {
  return Math.trunc(a / b);
}

/** 0x106d1a: shaded by the 64 KB table at 0x14c6a4 (texel * 256 + shade), no transparency; columns 0..319. */
export const SHADED_106D1A = {
  lastColumn: 0x140,
  isRowDrawn: (y) => y >= 0 && y <= LAST_ROW,
  plot(m, at, texel, shade) {
    m.mem[at] = m.mem[0x14c6a4 + (texel << 8) + shade];
  },
};

/** 0x106574: as 0x106d1a with the table at 0x13c6a4, texel 0 transparent, columns 0..318. */
export const SHADED_TRANSPARENT_106574 = {
  lastColumn: 0x13f,
  isRowDrawn: (y) => y >= 0 && y <= LAST_ROW,
  plot(m, at, texel, shade) {
    if (texel !== 0) {
      m.mem[at] = m.mem[0x13c6a4 + (texel << 8) + shade];
    }
  },
};

/** 0x1074af: the texel itself, 0 transparent; columns 0..318 and rows 1..198 only (its row test is `0 < y < 199`). */
export const TRANSPARENT_1074AF = {
  lastColumn: 0x13f,
  isRowDrawn: (y) => y > 0 && y < LAST_ROW,
  plot(m, at, texel) {
    if (texel !== 0) {
      m.mem[at] = texel;
    }
  },
};

/** One edge's walk: x (16.16) and, for the left edge, u, v, s (16.16). */
class Edge {
  constructor() {
    this.count = 0;
    this.x = 0;
    this.xStep = 0;
    this.u = 0;
    this.uStep = 0;
    this.v = 0;
    this.vStep = 0;
    this.s = 0;
    this.sStep = 0;
  }

  /** Starts the edge from `start` to `end`; returns its height (0: nothing set, as the original). */
  start(m, start, end, hasInterpolants) {
    const height = m.s32(end + Y) - m.s32(start + Y);
    if (height === 0) {
      return 0;
    }
    this.xStep = divide((m.s32(end + X) - m.s32(start + X)) << 16, height) | 0;
    this.x = m.s32(start + X) << 16;
    if (hasInterpolants) {
      this.uStep = divide((m.s32(end + U) - m.s32(start + U)) << 16, height) | 0;
      this.u = m.s32(start + U) << 16;
      this.vStep = divide((m.s32(end + V) - m.s32(start + V)) << 16, height) | 0;
      this.v = m.s32(start + V) << 16;
      this.sStep = divide((m.s32(end + S) - m.s32(start + S)) << 16, height) | 0;
      this.s = m.s32(start + S) << 16;
    }
    this.count = height;
    return height;
  }

  step(hasInterpolants) {
    this.x = (this.x + this.xStep) | 0;
    if (hasInterpolants) {
      this.u = (this.u + this.uStep) | 0;
      this.v = (this.v + this.vStep) | 0;
      this.s = (this.s + this.sStep) | 0;
    }
  }
}

const left = new Edge();
const right = new Edge();

/**
 * A gradient across the triangle: the field's difference between the long edge at the middle corner's height and
 * the middle corner, (in 16.16) over the width there.
 */
function gradient(m, a, b, c, field, t, width) {
  const across = (Math.imul(t, m.s32(c + field) - m.s32(a + field)) + ((m.s32(a + field) - m.s32(b + field)) << 16)) | 0;
  return divide(across * 0x10000, width) | 0;
}

/**
 * Fills the triangle with corners at the vertex addresses `p0`, `p1`, `p2` into the 320x200 buffer `dest`, from
 * the 256x256 texture at `texture`.
 * @param {Machine} m
 * @param {TriangleVariant} variant
 */
export function fillTriangle(m, variant, p0, p1, p2, dest, texture) {
  // sort by y: a top, b middle, c bottom (the swaps of the original, so equal y keep its order)
  let a = p0;
  let b = p1;
  let c = p2;
  if (m.s32(a + Y) > m.s32(b + Y)) {
    [a, b] = [b, a];
  }
  if (m.s32(a + Y) > m.s32(c + Y)) {
    [a, c] = [c, a];
  }
  if (m.s32(b + Y) > m.s32(c + Y)) {
    [b, c] = [c, b];
  }
  const top = m.s32(a + Y);
  if (top > LAST_ROW || m.s32(c + Y) < 0) {
    return;
  }
  const height = m.s32(c + Y) - top;
  if (height === 0) {
    return;
  }
  const t = divide((m.s32(b + Y) - top) << 16, height) | 0;
  let width = (Math.imul(t, m.s32(c + X) - m.s32(a + X)) + ((m.s32(a + X) - m.s32(b + X)) << 16)) | 0;
  if (width === 0) {
    return;
  }
  // the edge lists: edge k goes from list[k] to list[k - 1]
  let leftList;
  let rightList;
  let leftIndex;
  let rightIndex;
  if (width < 0) {
    // the long edge a-c is on the left
    leftList = [c, a];
    leftIndex = 1;
    rightList = [c, b, a];
    rightIndex = 2;
    left.start(m, a, c, true);
    if (right.start(m, a, b, false) <= 0) {
      rightIndex = 1;
      if (right.start(m, b, c, false) <= 0) {
        return;
      }
    }
    width = Math.min(width, -MIN_WIDTH);
  } else {
    rightList = [c, a];
    rightIndex = 1;
    leftList = [c, b, a];
    leftIndex = 2;
    right.start(m, a, c, false);
    if (left.start(m, a, b, true) <= 0) {
      leftIndex = 1;
      if (left.start(m, b, c, true) <= 0) {
        return;
      }
    }
    width = Math.max(width, MIN_WIDTH);
  }
  const uStep = gradient(m, a, b, c, U, t, width) >> 8;
  const vStep = gradient(m, a, b, c, V, t, width) >> 8;
  const sStep = gradient(m, a, b, c, S, t, width);
  const { lastColumn, isRowDrawn, plot } = variant;
  let y = top;
  let row = dest + top * SCREEN_WIDTH;
  for (;;) {
    let xLeft = left.x >> 16;
    let xRight = right.x >> 16;
    let u = left.u >> 8;
    let v = left.v >> 8;
    let s = left.s;
    if (xLeft <= lastColumn && xRight >= 0) {
      xRight = Math.min(xRight, lastColumn);
      if (xLeft < 0) {
        // the left clip moves u and v, not s
        u = (u + Math.imul(uStep, -xLeft)) | 0;
        v = (v + Math.imul(vStep, -xLeft)) | 0;
        xLeft = 0;
      }
      if (xRight - xLeft > 0 && isRowDrawn(y)) {
        const end = row + xRight;
        for (let at = row + xLeft; at < end; at++) {
          const texel = m.mem[texture + ((u & 0xff00) >> 8) + (v & 0xff00)];
          plot(m, at, texel, s >> 16);
          u = (u + uStep) | 0;
          v = (v + vStep) | 0;
          s = (s + sStep) | 0;
        }
      }
    }
    y++;
    row += SCREEN_WIDTH;
    left.count--;
    if (left.count > 0) {
      left.step(true);
    } else {
      leftIndex--;
      if (leftIndex <= 0 || left.start(m, leftList[leftIndex], leftList[leftIndex - 1], true) <= 0) {
        return;
      }
    }
    right.count--;
    if (right.count > 0) {
      right.step(false);
    } else {
      rightIndex--;
      if (rightIndex <= 0 || right.start(m, rightList[rightIndex], rightList[rightIndex - 1], false) <= 0) {
        return;
      }
    }
  }
}
