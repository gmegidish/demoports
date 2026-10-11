// The triangle fillers of the 3D engine (docs/disassembly/D1_engine3d.md) and their sibling in part 9 (0x107b7b).
//
// All four are the same routine assembled with small differences: sort the three vertices by y, walk a left edge
// list ("A", which carries the attributes) and a right edge list ("B", x only), and draw spans with the attributes
// stepped by gradients computed once per triangle. The fixed-point arithmetic is the original's, 32-bit wrapping
// included. A vertex is 24 bytes in memory (the engine's projected vertex, 0x10a25b):
//   +0 x, +4 y, +8 z, +0xc shade, +0x10 u, +0x14 v   (signed dwords)
// The texture is 256 x 256 bytes: a span reads texel ((u >> 8) & 0xff) + (v & 0xff00) with u, v in 8.8.
// A shaded filler maps (texel, shade) through a 256-byte-per-texel table: table[texel * 256 + (shade >> 16)].
// A z-buffered filler draws a pixel only where the 16-bit z-buffer word ([0x170f44], 640 bytes a line) is greater
// than z >> 16, and writes z >> 16 there.

/** The z-buffer pointer (set by 0x10900c). */
export const ZBUFFER = 0x170f44;
/** The shade tables of 0x10d497 / 0x107b7b and of 0x10dd95 (64 KB pictures copied there by main). */
export const SHADE_TABLE = 0x15cfb4;
export const SHADE_TABLE_2 = 0x12c6a4;

const WIDTH = 0x140;
const Z_LINE_BYTES = 0x280;
/** The x-span numerator ("w") is clamped away from 0 to at least this magnitude. */
const MIN_SPAN_WIDTH = 0x1000;
const LAST_LINE = 0xc7;

/**
 * How the fillers differ.
 * - isZBuffered: compares and writes the z-buffer.
 * - shadeTable: 0 for a plain texture, otherwise the shade table's address.
 * - stopsBelowScreen: returns at the first line below 199 (0x10ccaf); the others step on, drawing nothing.
 * - lastLeft: a span is skipped when its left x is above this.
 * - rightClampAbove / rightClampTo: a right x above the first becomes the second.
 * - firstLine / lastLine: spans are drawn on these lines only.
 * @typedef {{ isZBuffered: boolean, shadeTable: number, stopsBelowScreen: boolean, lastLeft: number,
 *   rightClampAbove: number, rightClampTo: number, firstLine: number, lastLine: number }} Filler
 */

/** 0x10ccaf: texture, z-buffer. */
export const FILLER_10CCAF = {
  isZBuffered: true, shadeTable: 0, stopsBelowScreen: true, lastLeft: 320, rightClampAbove: 320, rightClampTo: 320,
  firstLine: 0, lastLine: Infinity,
};
/** 0x10d497: texture through the shade table at 0x15cfb4, z-buffer. A right x above 320 becomes 319. */
export const FILLER_10D497 = {
  isZBuffered: true, shadeTable: SHADE_TABLE, stopsBelowScreen: false, lastLeft: 320, rightClampAbove: 320,
  rightClampTo: 319, firstLine: 0, lastLine: 199,
};
/** 0x10dd95: as 0x10d497 with the table at 0x12c6a4, x up to 319 and lines 1..198 only. */
export const FILLER_10DD95 = {
  isZBuffered: true, shadeTable: SHADE_TABLE_2, stopsBelowScreen: false, lastLeft: 319, rightClampAbove: 319,
  rightClampTo: 319, firstLine: 1, lastLine: 198,
};
/** 0x107b7b (part 9's tunnel): texture through the shade table at 0x15cfb4, no z. */
export const FILLER_107B7B = {
  isZBuffered: false, shadeTable: SHADE_TABLE, stopsBelowScreen: false, lastLeft: 320, rightClampAbove: 320,
  rightClampTo: 320, firstLine: 0, lastLine: 199,
};

/** idiv of a 32-bit dividend. */
function idiv(n, d) {
  return (n / d) | 0;
}

/**
 * cdq; shld edx, eax, 16; shl eax, 16; idiv: n * 65536 / d with a 48-bit dividend. The double division is exact
 * enough here: |n * 65536| < 2^47, so the quotient cannot round across an integer.
 */
function idiv48(n, d) {
  return Math.trunc((n * 65536) / d) | 0;
}

/** The A edge: x, u, v, z, shade in 16.16 and their steps per line, and the lines left. */
function newEdgeA() {
  return { x: 0, dx: 0, u: 0, du: 0, v: 0, dv: 0, z: 0, dz: 0, s: 0, ds: 0, lines: 0 };
}

/**
 * Starts the A edge from vertex `from` to vertex `to` (when it has a height). Returns its height.
 * The original sets each attribute the filler has; setting all of them changes nothing.
 */
function startEdgeA(m, edge, from, to) {
  const dy = m.s32(to + 4) - m.s32(from + 4);
  if (dy !== 0) {
    edge.dx = idiv((m.s32(to) - m.s32(from)) << 16, dy);
    edge.x = m.s32(from) << 16;
    edge.du = idiv((m.s32(to + 0x10) - m.s32(from + 0x10)) << 16, dy);
    edge.u = m.s32(from + 0x10) << 16;
    edge.dv = idiv((m.s32(to + 0x14) - m.s32(from + 0x14)) << 16, dy);
    edge.v = m.s32(from + 0x14) << 16;
    edge.dz = idiv((m.s32(to + 8) - m.s32(from + 8)) << 16, dy);
    edge.z = m.s32(from + 8) << 16;
    edge.ds = idiv((m.s32(to + 0xc) - m.s32(from + 0xc)) << 16, dy);
    edge.s = m.s32(from + 0xc) << 16;
    edge.lines = dy;
  }
  return dy;
}

/** Starts the B edge (x only). Returns its height. */
function startEdgeB(m, edge, from, to) {
  const dy = m.s32(to + 4) - m.s32(from + 4);
  if (dy !== 0) {
    edge.dx = idiv((m.s32(to) - m.s32(from)) << 16, dy);
    edge.x = m.s32(from) << 16;
    edge.lines = dy;
  }
  return dy;
}

/**
 * Fills the triangle (a, b, c) into the 320-byte-per-line buffer `dst` with `texture`, as filler `f` does.
 * a, b, c are vertex addresses (24-byte vertices, see above).
 * @param {import('./machine.js').Machine} m
 * @param {Filler} f
 */
export function fillTriangle(m, f, a, b, c, dst, texture) {
  // sort by y: top, middle, bottom (the original's three compare-and-swaps)
  let top = a;
  let mid = b;
  let bot = c;
  if (m.s32(a + 4) > m.s32(b + 4)) {
    top = b;
    mid = a;
  }
  if (m.s32(top + 4) > m.s32(bot + 4)) {
    [top, bot] = [bot, top];
  }
  if (m.s32(mid + 4) > m.s32(bot + 4)) {
    [mid, bot] = [bot, mid];
  }
  const y0 = m.s32(top + 4);
  if (y0 > LAST_LINE || m.s32(bot + 4) < 0) {
    return;
  }
  const height = m.s32(bot + 4) - y0;
  if (height === 0) {
    return;
  }
  // where the middle vertex's line crosses the long edge, as a fraction of the height (16.16)
  const t = idiv((m.s32(mid + 4) - y0) << 16, height);
  let w = (((m.s32(top) - m.s32(mid)) << 16) + Math.imul(t, m.s32(bot) - m.s32(top))) | 0;
  if (w === 0) {
    return;
  }
  const edgeA = newEdgeA();
  const edgeB = { x: 0, dx: 0, lines: 0 };
  // The edge lists (0x170f6c.. and 0x170f78..): an edge is [from, to], a list is walked from its end, and the
  // one with two edges skips a first edge without height. w < 0: the long edge is on the left.
  const isLongEdgeLeft = w < 0;
  const listA = isLongEdgeLeft ? [[top, bot]] : [[mid, bot], [top, mid]];
  const listB = isLongEdgeLeft ? [[mid, bot], [top, mid]] : [[top, bot]];
  let indexA = listA.length;
  let indexB = listB.length;
  if (isLongEdgeLeft) {
    startEdgeA(m, edgeA, top, bot);
    if (startEdgeB(m, edgeB, top, mid) <= 0) {
      indexB--;
      if (startEdgeB(m, edgeB, mid, bot) <= 0) {
        return;
      }
    }
  } else {
    startEdgeB(m, edgeB, top, bot);
    if (startEdgeA(m, edgeA, top, mid) <= 0) {
      indexA--;
      if (startEdgeA(m, edgeA, mid, bot) <= 0) {
        return;
      }
    }
  }
  w = isLongEdgeLeft ? Math.min(w, -MIN_SPAN_WIDTH) : Math.max(w, MIN_SPAN_WIDTH);
  const gradient = (offset) => idiv48(
    (((m.s32(top + offset) - m.s32(mid + offset)) << 16) + Math.imul(t, m.s32(bot + offset) - m.s32(top + offset))) | 0,
    w,
  );
  const dudx = gradient(0x10) >> 8;
  const dvdx = gradient(0x14) >> 8;
  const dzdx = f.isZBuffered ? gradient(8) : 0;
  const dsdx = f.shadeTable !== 0 ? gradient(0xc) : 0;
  let y = y0;
  let row = dst + y * WIDTH;
  let zRow = m.u32(ZBUFFER) + y * Z_LINE_BYTES;
  for (;;) {
    if (f.stopsBelowScreen && y > LAST_LINE) {
      return;
    }
    drawSpan(m, f, y, row, zRow, edgeA, edgeB.x >> 16, dudx, dvdx, dzdx, dsdx, texture);
    y++;
    row += WIDTH;
    zRow += Z_LINE_BYTES;
    edgeA.lines--;
    if (edgeA.lines > 0) {
      stepEdgeA(edgeA);
    } else {
      indexA--;
      if (indexA <= 0 || startEdgeA(m, edgeA, ...listA[indexA - 1]) <= 0) {
        return;
      }
    }
    edgeB.lines--;
    if (edgeB.lines > 0) {
      edgeB.x = (edgeB.x + edgeB.dx) | 0;
    } else {
      indexB--;
      if (indexB <= 0 || startEdgeB(m, edgeB, ...listB[indexB - 1]) <= 0) {
        return;
      }
    }
  }
}

function stepEdgeA(edge) {
  edge.x = (edge.x + edge.dx) | 0;
  edge.u = (edge.u + edge.du) | 0;
  edge.v = (edge.v + edge.dv) | 0;
  edge.z = (edge.z + edge.dz) | 0;
  edge.s = (edge.s + edge.ds) | 0;
}

/**
 * One span from the A edge to x = `right`. Only u and v are moved to the screen's left border when the span
 * starts left of it: z and the shade keep their values at the edge (the original's quirk).
 */
function drawSpan(m, f, y, row, zRow, edgeA, right, dudx, dvdx, dzdx, dsdx, texture) {
  let left = edgeA.x >> 16;
  if (left > f.lastLeft || right < 0) {
    return;
  }
  if (right > f.rightClampAbove) {
    right = f.rightClampTo;
  }
  let u = edgeA.u >> 8;
  let v = edgeA.v >> 8;
  if (left < 0) {
    u = (u + Math.imul(dudx, -left)) | 0;
    v = (v + Math.imul(dvdx, -left)) | 0;
    left = 0;
  }
  let count = right - left;
  if (count <= 0 || y < f.firstLine || y > f.lastLine) {
    return;
  }
  const mem = m.mem;
  const table = f.shadeTable;
  let z = edgeA.z;
  let s = edgeA.s;
  let out = row + left;
  let zAt = zRow + left * 2;
  for (; count > 0; count--) {
    const zz = z >> 16;
    if (!f.isZBuffered || (((mem[zAt] | (mem[zAt + 1] << 8)) << 16) >> 16) > zz) {
      const texel = mem[texture + (((u & 0xff00) >> 8) + (v & 0xff00))];
      mem[out] = table === 0 ? texel : mem[table + texel * 256 + (s >> 16)];
      if (f.isZBuffered) {
        mem[zAt] = zz;
        mem[zAt + 1] = zz >> 8;
      }
    }
    z = (z + dzdx) | 0;
    u = (u + dudx) | 0;
    v = (v + dvdx) | 0;
    s = (s + dsdx) | 0;
    out++;
    zAt += 2;
  }
}
