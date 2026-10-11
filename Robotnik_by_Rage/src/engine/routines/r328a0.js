// The planar shadow of parts 0 (spider) and 10 (cloth): three per-polygon routines that talk through
// globals of the original, drawn in the engine's sort order within one frame.
//   0x32788 PlanePrep: the plane equation of its (invisible) triangle, camera space -> [0x1062f0..08]
//   0x32714 LightPos:  the camera-space position of its (invisible) point -> [0x106310..18]
//   0x328a0 Shadow:    projects a triangle from the light onto the plane and darkens the covered
//                      pixels of the back buffer through row 0 of the colour table (flat fill)
//   0x33170 = 0x328a0 then 0x35860 (texture x phong, part 10's cloth)
//   0x3315c = 0x328a0 then 0x2c118 (phong, part 0's spider)
// The globals keep their values from frame to frame, as in the original. See P0_spider.md §5 and
// P10_room.md §4 (the FPU sequences were read from the listing: n = (v1-v0) x (v2-v0), D = -(n.v1);
// a corner V is projected as S = L*den + (V-L)*num with num = n.L + D, den = n.(L-V)).

import { V, VERTEX_INTS, SLOT_INTS, S } from '../layout.js';
import { idiv, imul } from '../fixed.js';
import { roundToEven } from '../raster/perspective.js';
import { drawTexturePhong } from '../raster/texture.js';
import { drawPhong } from '../raster/phong.js';

const FOCAL = 256;
/** The shadow projection hard-codes the screen centre (160, 100); the engine itself uses (159, 99). */
const CENTRE_X = 160;
const CENTRE_Y = 100;
const WIDTH = 320;
/** Rows 0..200 are walked (row 200 lies past the 64000-byte buffer; dropped here). */
const ROW_CAP = 201;
const VISIBLE_ROWS = 200;
const LAST_COLUMN = 319;

/** [0x1062f0] n.x, n.y, n.z, [0x106308] D (doubles); [0x106310] light x, y, z (ints). */
export const shadowGlobals = {
  plane: [0, 0, 0, 0],
  light: [0, 0, 0],
};

function cornerOf(context, polygon, k) {
  const at = polygon.slots[k * SLOT_INTS + S.VERTEX] * VERTEX_INTS;
  const v = context.vertices;
  return [v[at + V.X], v[at + V.Y], v[at + V.Z]];
}

/** 0x32788: the plane through the polygon's first three corners. Draws nothing. */
export function storeShadowPlane(polygon, context) {
  const [v0, v1, v2] = [0, 1, 2].map((k) => cornerOf(context, polygon, k));
  const a = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const b = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
  const nx = a[1] * b[2] - a[2] * b[1];
  const ny = a[2] * b[0] - a[0] * b[2];
  const nz = a[0] * b[1] - a[1] * b[0];
  shadowGlobals.plane = [nx, ny, nz, -(v1[1] * ny + v1[0] * nx + v1[2] * nz)];
}

/** 0x32714: the light at the polygon's first vertex. Draws nothing. */
export function storeShadowLight(polygon, context) {
  shadowGlobals.light = cornerOf(context, polygon, 0);
}

/** One corner projected from the light onto the plane, then onto the screen (fistp: half to even). */
function projectShadowCorner(corner) {
  const [nx, ny, nz, d] = shadowGlobals.plane;
  const [lx, ly, lz] = shadowGlobals.light;
  const [x, y, z] = corner;
  const numerator = nx * lx + ny * ly + nz * lz + d;
  const denominator = nx * (lx - x) + ny * (ly - y) + nz * (lz - z);
  const k = FOCAL / ((z - lz) * numerator + lz * denominator);
  const sx = (x - lx) * numerator + lx * denominator;
  const sy = (y - ly) * numerator + ly * denominator;
  return [roundToEven(sx * k) + CENTRE_X, CENTRE_Y - roundToEven(sy * k)];
}

/** Top, middle, bottom by y, the order of the engine's triangle template. */
function sortedByY(p) {
  const [y0, y1, y2] = [p[0][1], p[1][1], p[2][1]];
  let order;
  if (y0 < y1) {
    order = y1 < y2 ? [0, 1, 2] : y0 < y2 ? [0, 2, 1] : [2, 0, 1];
  } else {
    order = y0 < y2 ? [1, 0, 2] : y1 < y2 ? [1, 2, 0] : [2, 1, 0];
  }
  return order.map((k) => p[k]);
}

/** The span loop: pixels left..right inclusive, nothing when right - left <= 0. */
function darkenSpan(target, darken, y, left, right) {
  if (left >= WIDTH || right <= 0 || y >= VISIBLE_ROWS) {
    return;
  }
  const from = Math.max(left, 0);
  const to = Math.min(right, LAST_COLUMN);
  if (to - from <= 0) {
    return;
  }
  const row = y * WIDTH;
  for (let x = from; x <= to; x++) {
    target[row + x] = darken[target[row + x]];
  }
}

/** 0x328a0: the shadow of one triangle, flat-filled with 16.16 edges (long edge T->B). */
export function drawShadow(polygon, context) {
  const corners = [0, 1, 2].map((k) => projectShadowCorner(cornerOf(context, polygon, k)));
  const [T, M, B] = sortedByY(corners);
  if (T[1] >= ROW_CAP || B[1] < 0) {
    return;
  }
  const heightLong = B[1] - T[1];
  if (heightLong <= 0) {
    return;
  }
  const t = idiv((M[1] - T[1]) << 16, heightLong);
  const width = (imul(t, B[0] - T[0]) >> 16) - (M[0] - T[0]);
  if (width === 0) {
    return;
  }
  const isLongLeft = width < 0;
  const darken = context.colourTable.subarray(0, 256);
  const target = context.target;
  const span = (y, xLong, xShort) => {
    if (isLongLeft) {
      darkenSpan(target, darken, y, xLong >> 16, xShort >> 16);
    } else {
      darkenSpan(target, darken, y, xShort >> 16, xLong >> 16);
    }
  };
  const dxLong = idiv((B[0] - T[0]) << 16, heightLong);
  let xLong = T[0] << 16;
  let xShort = T[0] << 16;
  let y = T[1];
  if (M[1] !== T[1] && M[1] >= 0) {
    const dxShort = idiv((M[0] - T[0]) << 16, M[1] - T[1]);
    if (T[1] < 0) {
      xShort = (xShort - imul(T[1], dxShort)) | 0;
      xLong = ((T[0] << 16) - imul(dxLong, T[1])) | 0;
      y = 0;
    }
    for (const end = Math.min(M[1], ROW_CAP); y < end; y++) {
      span(y, xLong, xShort);
      xLong = (xLong + dxLong) | 0;
      xShort = (xShort + dxShort) | 0;
    }
  } else if (M[1] !== T[1]) {
    y = M[1];
  }
  xShort = M[0] << 16;
  const end = Math.min(B[1], ROW_CAP);
  if (y >= end) {
    return;
  }
  const dxShort = idiv((B[0] - M[0]) << 16, B[1] - M[1]);
  if (y < 0) {
    xLong = (xLong - imul(dxLong, T[1])) | 0;
    xShort = (xShort - imul(y, dxShort)) | 0;
    y = 0;
  }
  for (; y < end; y++) {
    span(y, xLong, xShort);
    xLong = (xLong + dxLong) | 0;
    xShort = (xShort + dxShort) | 0;
  }
}

/** 0x33170: shadow, then the cloth itself (0x35860). */
export function drawShadowedTexturePhong(polygon, context) {
  drawShadow(polygon, context);
  drawTexturePhong(polygon, context);
}

/** 0x3315c: shadow, then the phong-shaded polygon (0x2c118). */
export function drawShadowedPhong(polygon, context) {
  drawShadow(polygon, context);
  drawPhong(polygon, context);
}
