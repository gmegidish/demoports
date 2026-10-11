// The edge-table rasterisers built on the row table at 0xf59e0 (0x98 bytes per row: left x and two
// interpolants, right x and two interpolants) with [0x83894] minY / [0x83898] maxY:
// 0x2895c reset, 0x289e8 edge, 0x28c50 edge with two interpolants, 0x28b60 flat fill (+ 0x28ac0),
// 0x29994 "shade the background by v" (+ span 0x2985c). The table persists between polygons, as in
// the original: the reset only clears the rows the previous polygon used. See E2 §4.1.

import { idiv, imul } from '../fixed.js';
import { V, VERTEX_INTS, SLOT_INTS, S } from '../layout.js';

const WIDTH = 320;
const ROWS = 200;
const LAST_ROW = 199;
const ROW_CAP = 200;
const EMPTY = 0x7fff;

/** Row table: left x, left a, left b, right x, right a, right b per row (rows 0..200). */
const table = {
  left: new Int32Array(ROWS + 1).fill(EMPTY),
  leftA: new Int32Array(ROWS + 1),
  leftB: new Int32Array(ROWS + 1),
  right: new Int32Array(ROWS + 1).fill(EMPTY),
  rightA: new Int32Array(ROWS + 1),
  rightB: new Int32Array(ROWS + 1),
  minY: 0,
  maxY: LAST_ROW,
};

/** 0x2895c: empties the rows minY..maxY (clamped to the screen), then minY = 199, maxY = 0. */
export function resetEdgeTable() {
  if (table.minY < 0) {
    table.minY = 0;
  }
  if (table.maxY >= ROWS) {
    table.maxY = LAST_ROW;
  }
  for (let y = table.minY; y <= table.maxY; y++) {
    table.left[y] = EMPTY;
    table.right[y] = EMPTY;
  }
  table.minY = LAST_ROW;
  table.maxY = 0;
}

/**
 * 0x28c50 (and 0x289e8 without interpolants): walks one edge top to bottom (top-inclusive,
 * bottom-exclusive, rows < 200), putting x (floor of 8.8) into the row's left or right end.
 */
export function addEdge(x0, y0, x1, y1, a0 = 0, b0 = 0, a1 = 0, b1 = 0) {
  if (y0 === y1) {
    return;
  }
  if (y1 < y0) {
    [x0, y0, a0, b0, x1, y1, a1, b1] = [x1, y1, a1, b1, x0, y0, a0, b0];
  }
  if (y0 < 0) {
    const t = idiv((-y0) << 8, y1 - y0);
    x0 += imul(x1 - x0, t) >> 8;
    a0 += imul(a1 - a0, t) >> 8;
    b0 += imul(b1 - b0, t) >> 8;
    y0 = 0;
  }
  const dy = y1 - y0;
  if (y1 > ROW_CAP) {
    y1 = ROW_CAP;
  }
  let count = y1 - y0;
  if (count <= 0) {
    return;
  }
  table.minY = Math.min(table.minY, y0);
  table.maxY = Math.max(table.maxY, y1);
  const dx = idiv((x1 - x0) << 8, dy);
  const da = idiv((a1 - a0) << 8, dy);
  const db = idiv((b1 - b0) << 8, dy);
  let x = x0 << 8;
  let a = a0 << 8;
  let b = b0 << 8;
  for (let y = y0; count > 0; count--, y++) {
    const xi = x >> 8;
    if (xi < table.left[y]) {
      table.right[y] = table.left[y];
      table.rightA[y] = table.leftA[y];
      table.rightB[y] = table.leftB[y];
      table.left[y] = xi;
      table.leftA[y] = a;
      table.leftB[y] = b;
    } else {
      table.right[y] = xi;
      table.rightA[y] = a;
      table.rightB[y] = b;
    }
    x = (x + dx) | 0;
    a = (a + da) | 0;
    b = (b + db) | 0;
  }
}

function screenOf(context, polygon, k) {
  const at = polygon.slots[k * SLOT_INTS + S.VERTEX] * VERTEX_INTS;
  return [context.vertices[at + V.SX], context.vertices[at + V.SY]];
}

/** 0x28ac0: fills rows minY..maxY-1 from max(left,0) to min(right,320)-1 with one colour. */
function fillRows(target, colour) {
  for (let y = table.minY; y < table.maxY; y++) {
    const from = Math.max(table.left[y], 0);
    const to = Math.min(table.right[y], WIDTH);
    if (to > from) {
      target.fill(colour, y * WIDTH + from, y * WIDTH + to);
    }
  }
}

/** 0x28b60 flat: any n; colour = colourTable[min(|nz|/2, 127)*256 + base] (nz of the face normal). */
export function drawFlat(polygon, context) {
  resetEdgeTable();
  const n = polygon.n;
  for (let k = 0; k < n; k++) {
    const [x0, y0] = screenOf(context, polygon, k);
    const [x1, y1] = screenOf(context, polygon, (k + 1) % n);
    addEdge(x0, y0, x1, y1);
  }
  const nz = polygon.normal < 0 ? 0 : context.faceNormals[polygon.normal * 3 + 2];
  const level = Math.min(Math.abs(nz) >> 1, 0x7f);
  const colour = context.colourTable[(level << 8) + polygon.material.colourBase] ?? 0;
  fillRows(context.target, colour);
}

/**
 * 0x29994 (textured material with flag 8; the logo): triangles. The texture is not read: each pixel
 * of the polygon becomes colourTable[(v >> 3)*256 + pixel], v interpolated from the slots (the
 * span routine 0x2985c, which clips and steps v per span).
 */
export function drawShadedByV(polygon, context) {
  resetEdgeTable();
  for (let k = 0; k < 3; k++) {
    const next = (k + 1) % 3;
    const [x0, y0] = screenOf(context, polygon, k);
    const [x1, y1] = screenOf(context, polygon, next);
    const s = polygon.slots;
    addEdge(x0, y0, x1, y1, s[k * SLOT_INTS + S.U], s[k * SLOT_INTS + S.V], s[next * SLOT_INTS + S.U], s[next * SLOT_INTS + S.V]);
  }
  shadeSpansByB(context.target, context.colourTable);
}

/** 0x2985c: spans [left, right) of rows minY..maxY-1, interpolating the second interpolant. */
function shadeSpansByB(target, colourTable) {
  for (let y = table.minY; y < table.maxY; y++) {
    let xl = table.left[y];
    let xr = table.right[y];
    if (xl >= xr) {
      continue;
    }
    let bl = table.leftB[y];
    let br = table.rightB[y];
    if (xl < 0) {
      const t = idiv((-xl) << 8, xr - xl);
      bl += imul(br - bl, t) >> 8;
      xl = 0;
    }
    if (xr >= WIDTH + 1) {
      const t = idiv((WIDTH - xl) << 8, xr - xl);
      br = bl + (imul(br - bl, t) >> 8);
      xr = WIDTH;
    }
    const count = xr - xl;
    if (count <= 0) {
      continue;
    }
    const db = idiv(br - bl, count);
    let b = bl;
    const row = y * WIDTH;
    for (let x = xl; x < xr; x++) {
      const at = row + x;
      target[at] = colourTable[((b >> 11) << 8) + target[at]] ?? 0;
      b = (b + db) | 0;
    }
  }
}
