// The engine's small "triangle engine" (E2 §6): integer rotation 0x43450 with the 1024-step sine
// table of obj2, projection 0x435e8 ([0x89f18] = eye distance), and the affine textured triangle
// 0x43654 (edges 0x439cc, span filler obj2 0x764a2, row table set by 0x76a3c), plus part 12's
// variant 0x437c4 / 0x43cf8 whose rows carry five interpolants and are filled by the part itself.
//
// src/shatter.js (the screen shatter of parts 5, 13, 15) carries its own private copy of 0x43450's
// matrix and of 0x43654 / 0x439cc / 0x764a2 with the same vertex layout as here; both are checked
// against the original (test/engine.test.js for this one).
//
// Vertices are a struct of arrays (one Int32Array per field of the 0x40-byte record):
//   x, y, z (+0, +4, +8 model), rx, ry, rz (+0xc.. rotated, x1024), sx, sy (+0x18, +0x1c screen),
//   row (+0x20, texture row), column (+0x24, texture column), extra0, extra1 (+0x28, +0x2c).
// Rows tables A (0x11283c, right ends) and B (0x11683c, left ends) hold per row:
//   x (+0), a4 (+4), row (+8), column (+0xc), a10 (+0x10), a14 (+0x14).

import { idiv, imul, sext16 } from './fixed.js';

const QUARTER_TURN = 256;
const DEFAULT_EYE_DISTANCE = 0x200000;
const TABLE_ROWS = 512;
const RIGHT_EMPTY = 0x82d48b00 | 0;
const LEFT_EMPTY = 0x7d2b7500;
const WIDTH = 320;
const DEFAULT_Y_MAX = 200;

const VERTEX_FIELDS = ['x', 'y', 'z', 'rx', 'ry', 'rz', 'sx', 'sy', 'row', 'column', 'extra0', 'extra1'];
const ROW_FIELDS = ['x', 'a4', 'row', 'column', 'a10', 'a14'];

export function createTriangleVertices(count) {
  return Object.fromEntries(VERTEX_FIELDS.map((field) => [field, new Int32Array(count)]));
}

function createRowTable() {
  return Object.fromEntries(ROW_FIELDS.map((field) => [field, new Int32Array(TABLE_ROWS)]));
}

/**
 * The triangle engine's globals: the two row tables, [0x89f40] first row / [0x89f44] last row,
 * [0x89f48] / [0x89f4c] min / max x (0x43cf8 only), [0x89f50] yMin / [0x89f54] yMax (part 12 changes
 * them), [0x89f18] eye distance, and the target of 0x76a3c.
 */
export function createTriangleEngine(sine) {
  return {
    sine,
    right: createRowTable(),
    left: createRowTable(),
    top: 0,
    bottom: DEFAULT_Y_MAX,
    minX: 0,
    maxX: 0,
    yMin: 0,
    yMax: DEFAULT_Y_MAX,
    eyeDistance: DEFAULT_EYE_DISTANCE,
    target: null,
    pitch: WIDTH,
  };
}

/** 0x76a3c(pitch, rows, base): where 0x764a2 draws (row y at y*pitch). */
export function setTriangleTarget(engine, target, pitch = WIDTH) {
  engine.target = target;
  engine.pitch = pitch;
}

/** The 3x3 matrix of 0x43450 for angles a, b, c (0..1023), entries x1024. */
export function rotationMatrix(sine, a, b, c) {
  const sa = sine[a];
  const ca = sine[a + QUARTER_TURN];
  const sb = sine[b];
  const cb = sine[b + QUARTER_TURN];
  const sc = sine[c];
  const cc = sine[c + QUARTER_TURN];
  const cbcc = imul(cb, cc);
  const nscb = imul(-sc, cb);
  return [
    ((imul(cbcc, ca) >> 10) - imul(sc, sa)) >> 10,
    ((imul(cbcc, sa) >> 10) + imul(sc, ca)) >> 10,
    imul(-cc, sb) >> 10,
    ((imul(nscb, ca) >> 10) - imul(cc, sa)) >> 10,
    (imul(cc, ca) + (imul(nscb, sa) >> 10)) >> 10,
    imul(sc, sb) >> 10,
    imul(ca, sb) >> 10,
    imul(sa, sb) >> 10,
    cb,
  ];
}

/** 0x43450 Rotate(verts, n, a, b, c): rx,ry,rz = M·(x,y,z), no shift (x1024). */
export function rotateVertices(engine, v, first, count, a, b, c) {
  const m = rotationMatrix(engine.sine, a, b, c);
  for (let k = first; k < first + count; k++) {
    const { x, y, z } = { x: v.x[k], y: v.y[k], z: v.z[k] };
    v.rx[k] = (imul(x, m[0]) + imul(y, m[1]) + imul(z, m[2])) | 0;
    v.ry[k] = (imul(x, m[3]) + imul(y, m[4]) + imul(z, m[5])) | 0;
    v.rz[k] = (imul(x, m[6]) + imul(y, m[7]) + imul(z, m[8])) | 0;
  }
}

/** 0x435e8 Project(verts, n, cx, cy): sx = (rx<<10)/(rz+D) + cx (y not negated); rz <= -D: unchanged. */
export function projectVertices(engine, v, first, count, cx, cy) {
  const d = engine.eyeDistance;
  for (let k = first; k < first + count; k++) {
    if (-d < v.rz[k]) {
      v.sx[k] = (idiv(v.rx[k] << 10, (v.rz[k] + d) | 0) + cx) | 0;
      v.sy[k] = (idiv(v.ry[k] << 10, (v.rz[k] + d) | 0) + cy) | 0;
    }
  }
}

/** 0x43960: forget the previous triangle's rows; the x range starts empty. */
function resetRows(engine) {
  for (let y = engine.top; y < engine.bottom; y++) {
    engine.right.x[y] = RIGHT_EMPTY;
    engine.left.x[y] = LEFT_EMPTY;
  }
  engine.bottom = 0;
  engine.top = DEFAULT_Y_MAX;
  engine.minX = LEFT_EMPTY;
  engine.maxX = RIGHT_EMPTY;
}

/** First-row / last-row bookkeeping shared by 0x439cc and 0x43cf8; returns the clipped [y0, y1). */
function clipRows(engine, y0, y1, skip) {
  let from = y0;
  let to = y1;
  if (from < engine.yMin) {
    skip(from - engine.yMin);
    from = 0;
    engine.top = 0;
  } else if (from < engine.top) {
    engine.top = from;
  }
  if (to > engine.yMax) {
    engine.bottom = engine.yMax;
    to = engine.yMax;
  } else if (to > engine.bottom) {
    engine.bottom = to;
  }
  return [from, to];
}

/** 0x439cc: edge p->q (top to bottom) into `table`: x, row and column in 8.8. */
export function walkEdge(engine, table, v, p, q) {
  if (v.sy[q] - v.sy[p] < 0) {
    [p, q] = [q, p];
  }
  const dy = v.sy[q] - v.sy[p];
  if (dy === 0 || v.sy[p] > DEFAULT_Y_MAX || v.sy[q] < 0) {
    return;
  }
  const dx = idiv((v.sx[q] - v.sx[p]) << 8, dy);
  const dRow = idiv((v.row[q] - v.row[p]) << 8, dy);
  const dColumn = idiv((v.column[q] - v.column[p]) << 8, dy);
  let x = v.sx[p] << 8;
  let row = v.row[p] << 8;
  let column = v.column[p] << 8;
  const [from, to] = clipRows(engine, v.sy[p], v.sy[q], (k) => {
    row = (row - imul(dRow, k)) | 0;
    column = (column - imul(dColumn, k)) | 0;
    x = (x - imul(k, dx)) | 0;
  });
  for (let y = from; y < to; y++) {
    table.x[y] = x >> 8;
    table.row[y] = row;
    table.column[y] = column;
    x = (x + dx) | 0;
    row = (row + dRow) | 0;
    column = (column + dColumn) | 0;
  }
}

/** 0x43cf8(side, table, P, Q): part 12's edge, one row longer at both ends, x pushed out by `side`. */
export function walkSidedEdge(engine, side, table, v, p, q) {
  while (v.sy[q] - v.sy[p] < 0) {
    [p, q] = [q, p];
  }
  if (v.sy[q] === v.sy[p]) {
    return;
  }
  const y0 = v.sy[p] - 1;
  const y1 = v.sy[q] + 1;
  const n = y1 - y0;
  if (y0 >= DEFAULT_Y_MAX || y1 < 0) {
    return;
  }
  for (const x of [v.sx[p], v.sx[q]]) {
    if (x < engine.minX) {
      engine.minX = x;
    } else if (x > engine.maxX) {
      engine.maxX = x;
    }
  }
  const fields = ['rz', 'row', 'column', 'extra0', 'extra1'];
  const values = fields.map((f) => v[f][p] << 8);
  const steps = fields.map((f) => idiv((v[f][q] - v[f][p]) << 8, n));
  const dx = idiv((v.sx[q] - v.sx[p]) << 8, n);
  let x = (side + v.sx[p]) << 8;
  const [from, to] = clipRows(engine, y0, y1, (k) => {
    for (let i = 0; i < values.length; i++) {
      values[i] = (values[i] - imul(steps[i], k)) | 0;
    }
    x = (x - imul(dx, k)) | 0;
  });
  for (let y = from; y < to; y++) {
    table.x[y] = x >> 8;
    table.a4[y] = values[0];
    table.row[y] = values[1];
    table.column[y] = values[2];
    table.a10[y] = values[3];
    table.a14[y] = values[4];
    x = (x + dx) | 0;
    for (let i = 0; i < values.length; i++) {
      values[i] = (values[i] + steps[i]) | 0;
    }
  }
}

function isRightOfAndBelow(engine, v, k) {
  return (v.sx[k] >>> 0) >= WIDTH && engine.yMax <= (v.sy[k] >>> 0);
}

/**
 * 0x43654 SetupTri(a, b, c, edge) / 0x437c4 (part 12, edge = walkSidedEdge with sides +1 for A, -1
 * for B): sort by y, two edges into one table and the long one into the other. A triangle whose
 * three vertices are all right of and below the screen (unsigned) leaves the tables untouched, so
 * the next span fill redraws the previous triangle's rows (sic).
 */
export function setupTriangle(engine, v, a, b, c, isSided = false) {
  if (isRightOfAndBelow(engine, v, a) && isRightOfAndBelow(engine, v, b) && isRightOfAndBelow(engine, v, c)) {
    return;
  }
  resetRows(engine);
  const ids = [a, b, c];
  let low = 0;
  let high = 0;
  let minY = v.sy[a];
  let maxY = minY;
  for (let i = 1; i < 3; i++) {
    const y = v.sy[ids[i]];
    if (minY > y) {
      low = i;
      minY = y;
    } else if (maxY < y) {
      high = i;
      maxY = y;
    }
  }
  const middle = 3 - low - high;
  if (middle < 0 || middle > 2) {
    return;
  }
  const top = ids[low];
  const mid = ids[middle];
  const bottom = ids[high];
  const bend = imul(minY - v.sy[mid], v.sx[top] - v.sx[bottom]);
  const cross = imul(minY - maxY, v.sx[top] - v.sx[mid]);
  const isTwoOnRight = cross > bend;
  const edge = (isRight, p, q) => {
    const table = isRight ? engine.right : engine.left;
    if (isSided) {
      walkSidedEdge(engine, isRight ? 1 : -1, table, v, p, q);
    } else {
      walkEdge(engine, table, v, p, q);
    }
  };
  edge(isTwoOnRight, top, mid);
  edge(isTwoOnRight, mid, bottom);
  edge(!isTwoOnRight, top, bottom);
}

/**
 * obj2 0x764a2(texture): rows top..bottom inclusive, from the right end leftwards, both ends
 * included; texel = texture[(row & ~0xff) | (column >> 8 & 0xff)] (row unmasked), 16-bit steps.
 * x = 320 is not clipped (it lands on the next row's first pixel), x > 320 is clipped to 319.
 */
export function fillTriangleSpans(engine, texture) {
  if (engine.top >= engine.bottom) {
    return;
  }
  const target = engine.target;
  for (let y = engine.top; y <= engine.bottom; y++) {
    let right = engine.right.x[y];
    let left = engine.left.x[y];
    if (right < 0 || left >= WIDTH) {
      continue;
    }
    const width = right - left;
    if (width <= 0) {
      continue;
    }
    const dRow = sext16(idiv((engine.left.row[y] - engine.right.row[y]) | 0, width));
    const dColumn = sext16(idiv((engine.left.column[y] - engine.right.column[y]) | 0, width));
    let row = engine.right.row[y];
    let column = engine.right.column[y];
    if (right > WIDTH) {
      row = (row + sext16(imul(right - WIDTH, dRow))) | 0;
      column = (column + sext16(imul(right - WIDTH, dColumn))) | 0;
      right = WIDTH - 1;
    }
    if (left <= 0) {
      left = 0;
    }
    const line = y * engine.pitch;
    for (let x = right; x >= left; x--) {
      const at = line + x;
      if (at < target.length) {
        target[at] = texture[((row & ~0xff) | ((column >> 8) & 0xff)) >>> 0] ?? 0;
      }
      row = (row + dRow) | 0;
      column = (column + dColumn) | 0;
    }
  }
}
