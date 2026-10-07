// The 2D parts draw the screen as a 40x25 grid of 8x8-pixel cells, each two affine triangles,
// with texture coordinates (and a shade level) computed only at the 41x26 corners.
// TEST.EXE 0x11909 (polar tables), 0x11fa1 and 0x11e2c (renderers), 0x11ac1 and 0x11a3c (triangles).

import { fillAffineTriangle, AFFINE_OPAQUE, AFFINE_SHADE_FULL } from './engine/raster.js';
import { DEMO_PI } from './engine/math.js';

export const COLUMNS = 41;
export const ROWS = 26;
const CELL = 8;
const CELL_LAST = CELL - 1;
const f = Math.fround;

/** The executable's pi (0x50430) and twice it (0x50438): not quite Math.PI. */
const DEMO_TWO_PI = 6.283185374;
const HALF_PI = f(1.5707963705062866);
const THREE_HALF_PI = f(4.71238899230957);
const RADIUS_SCALE = 8.17;

/** One corner of the grid: texture u, v and the shade level s (0x58578, 12 bytes each). */
export function createGrid() {
  return Array.from({ length: COLUMNS * ROWS }, () => ({ u: 0, v: 0, s: 0 }));
}

export function gridIndex(i, j) {
  return i * ROWS + j;
}

/**
 * 0x11909: distance and angle of every corner from the screen centre, in cells.
 * i is the column (dx = 20 - i), j the row (dy = 12.5 - j).
 * @returns {{radius: Float32Array, angle: Float32Array}} indexed by gridIndex(i, j)
 */
export function buildPolarTables() {
  const radius = new Float32Array(COLUMNS * ROWS);
  const angle = new Float32Array(COLUMNS * ROWS);
  for (let i = 0; i < COLUMNS; i++) {
    const dx = 20 - i;
    for (let j = 0; j < ROWS; j++) {
      const dy = 12.5 - j;
      radius[gridIndex(i, j)] = Math.sqrt(dy * dy + dx * dx + 1) * RADIUS_SCALE;
      const x = f(dx);
      const y = f(dy);
      let a;
      if (y >= 0) {
        if (x === 0) {
          a = HALF_PI;
        } else if (x > 0) {
          a = Math.atan(y / x);
        } else {
          a = Math.atan(y / x) + DEMO_PI;
        }
      } else if (x === 0) {
        a = THREE_HALF_PI;
      } else if (x < 0) {
        a = Math.atan(y / x) + DEMO_PI;
      } else {
        a = Math.atan(y / x) + DEMO_TWO_PI;
      }
      angle[gridIndex(i, j)] = a;
    }
  }
  return { radius, angle };
}

/** Texture coordinates reach the triangle filler as the low 16 bits of the int32s (movsx word). */
function corner(x, y, point) {
  return { x, y, u: (point.u << 16) >> 16, v: (point.v << 16) >> 16 };
}

function shadeCorner(x, y, point) {
  return { x, y, u: (point.s << 16) >> 16, v: (point.v << 16) >> 16 };
}

/**
 * 0x11fa1: every cell, columns left to right, top to bottom, lower-left triangle then upper-right.
 * Both edges of a span are drawn, so cells with corners 0..7 tile the screen exactly.
 */
export function drawGrid(target, texture, grid) {
  forEachCell(grid, (x, y, p00, p01, p10, p11) => {
    fillAffineTriangle(target, texture, corner(x, y, p00), corner(x, y + CELL_LAST, p01), corner(x + CELL_LAST, y + CELL_LAST, p11), AFFINE_OPAQUE);
    fillAffineTriangle(target, texture, corner(x, y, p00), corner(x + CELL_LAST, y, p10), corner(x + CELL_LAST, y + CELL_LAST, p11), AFFINE_OPAQUE);
  });
}

/**
 * 0x11e2c with 0x11a3c: like drawGrid, but each triangle is then redrawn through a 64K shade table
 * with the corners' shade levels: dst = table[dst << 8 | s].
 */
export function drawShadedGrid(target, texture, table, grid) {
  forEachCell(grid, (x, y, p00, p01, p10, p11) => {
    for (const [a, b, c] of [
      [[x, y, p00], [x, y + CELL_LAST, p01], [x + CELL_LAST, y + CELL_LAST, p11]],
      [[x, y, p00], [x + CELL_LAST, y, p10], [x + CELL_LAST, y + CELL_LAST, p11]],
    ]) {
      fillAffineTriangle(target, texture, corner(...a), corner(...b), corner(...c), AFFINE_OPAQUE);
      fillAffineTriangle(target, table, shadeCorner(...a), shadeCorner(...b), shadeCorner(...c), AFFINE_SHADE_FULL);
    }
  });
}

function forEachCell(grid, drawCell) {
  for (let i = 0; i < COLUMNS - 1; i++) {
    for (let j = 0; j < ROWS - 1; j++) {
      drawCell(
        i * CELL,
        j * CELL,
        grid[gridIndex(i, j)],
        grid[gridIndex(i, j + 1)],
        grid[gridIndex(i + 1, j)],
        grid[gridIndex(i + 1, j + 1)],
      );
    }
  }
}

/**
 * 0x1dfe4: rotation from three angles, row-major, with the original's float32 rounding points
 * (some products use the unrounded x87 sines, others their float32 copies).
 * @returns {Float32Array} 9 entries
 */
export function eulerMatrix(a, b, c) {
  const SA = Math.sin(a);
  const CA = Math.cos(a);
  const SB = Math.sin(b);
  const CB = Math.cos(b);
  const SC = Math.sin(c);
  const CC = Math.cos(c);
  const sa = f(SA);
  const ca = f(CA);
  const sb = f(SB);
  const cb = f(CB);
  const sc = f(SC);
  const sbsc = f(SB * sc);
  const sacc = f(SA * CC);
  const cacc = f(CA * CC);
  return Float32Array.of(
    sa * sbsc + cacc, CB * sc, sacc - ca * sbsc,
    sacc * sb - ca * sc, cb * CC, -cacc * sb - sa * sc,
    -sa * cb, sb, ca * cb,
  );
}

/** A screen point's ray (X - 160, Y - 100, 256) turned by m and normalised, float32 at each step. 0x1dd70, 0x1dbe4. */
export function rayDirection(m, X, Y) {
  const x = X - 160;
  const y = Y - 100;
  const z = 256;
  let d = [0, 1, 2].map((r) => f((m[3 * r + 1] * y + m[3 * r] * x) + m[3 * r + 2] * z));
  const lengthSquared = f((d[1] * d[1] + d[0] * d[0]) + d[2] * d[2]);
  if (lengthSquared > 0) {
    const inverse = 1 / Math.sqrt(lengthSquared);
    d = d.map((component) => f(component * inverse));
  }
  return d;
}

/** fistp after 0x199b2: truncation toward zero; out of range gives the x87's 0x80000000. */
export function toInt(x) {
  const t = Math.trunc(x);
  return Number.isFinite(t) && t >= -2147483648 && t <= 2147483647 ? t : -2147483648;
}
