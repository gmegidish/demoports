// The compiled-C "triangle template" shared by 0x331b4, 0x35860, 0x45d78, 0x46d48 (0x46d08) and
// 0x47ed0: vertices sorted by sy into top/middle/bottom, a long edge T->B and two short edges, any
// number of interpolants with constant x gradients. Spans start at the long-edge values with no
// sub-pixel correction. See E2 §3 (verified against the original for all five users).

import { idiv, imul } from '../fixed.js';
import { V, VERTEX_INTS, SLOT_INTS, S } from '../layout.js';

export const SCREEN_Y_CAP = 201;

/** E2 §3: the slot order (top, middle, bottom) by sy, ties as the original compares them. */
export function sortSlotsByY(sy0, sy1, sy2) {
  if (sy1 > sy0) {
    if (sy1 < sy2) {
      return [0, 1, 2];
    }
    return sy2 > sy0 ? [0, 2, 1] : [2, 0, 1];
  }
  if (sy0 < sy2) {
    return [1, 0, 2];
  }
  return sy2 > sy1 ? [1, 2, 0] : [2, 1, 0];
}

/** Screen x, y of the three slots of a triangle, and the T/M/B slot order. */
export function triangleOf(vertices, polygon) {
  const xs = [];
  const ys = [];
  for (let k = 0; k < 3; k++) {
    const at = polygon.slots[k * SLOT_INTS + S.VERTEX] * VERTEX_INTS;
    xs.push(vertices[at + V.SX]);
    ys.push(vertices[at + V.SY]);
  }
  const order = sortSlotsByY(ys[0], ys[1], ys[2]);
  return { order, xs: order.map((k) => xs[k]), ys: order.map((k) => ys[k]) };
}

/**
 * Interpolant setup. `packed`: an (u, v) pair of 8.8 values packed as v<<16 | u, whose u carry
 * spills into v; `scalar`: one 32-bit value. Values are given at T, M, B already in fixed point.
 */
export function packedChannel(uT, vT, uM, vM, uB, vB) {
  return { isPacked: true, values: [uT, vT, uM, vM, uB, vB], bias: 0 };
}

/** `startOf(start, dx)`, if given, replaces the start value once the x gradient is known. */
export function scalarChannel(aT, aM, aB, bias = 0, startOf = null) {
  return { isPacked: false, values: [aT, aM, aB], bias, startOf };
}

function gradientAcross(aT, aM, aB, t, width) {
  return idiv(imul((aB - aT) >> 8, t) - (aM - aT), width);
}

function setupChannel(channel, t, width, dyL) {
  if (channel.isPacked) {
    const [uT, vT, uM, vM, uB, vB] = channel.values;
    const du = gradientAcross(uT, uM, uB, t, width) & 0xffff;
    const dv = gradientAcross(vT, vM, vB, t, width);
    return {
      start: ((vT << 16) + uT) | 0,
      dx: ((dv << 16) | du) | 0,
      dy: ((idiv(vB - vT, dyL) << 16) + idiv(uB - uT, dyL)) | 0,
    };
  }
  const [aT, aM, aB] = channel.values;
  const dx = gradientAcross(aT, aM, aB, t, width);
  const start = (aT + channel.bias) | 0;
  return {
    start: channel.startOf ? channel.startOf(start, dx) | 0 : start,
    dx,
    dy: idiv(aB - aT, dyL),
  };
}

/** Result of rasterTemplate besides drawing. */
export const TEMPLATE = { REJECTED: 0, ZERO_WIDTH: 1, DRAWN: 2 };

/**
 * Rasterise one sorted triangle with `channels` (packedChannel / scalarChannel);
 * `span(y, xLong, xShort, isLongLeft, values, dx)` draws one row (values: the long-edge interpolant values, Int32Array; dx: their x gradients).
 * Options: yReject / yCap (201 for screen rasterisers, 199 for the projector), rejectBox(xs, ys)
 * returning true to reject (0x331b4's horizontal test, the projector's bbox).
 */
export function rasterTemplate(triangle, channels, span, options = {}) {
  const yReject = options.yReject ?? SCREEN_Y_CAP;
  const yCap = options.yCap ?? SCREEN_Y_CAP;
  const [Tx, Mx, Bx] = triangle.xs;
  const [Ty, My, By] = triangle.ys;
  if (Ty >= yReject || By < 0) {
    return TEMPLATE.REJECTED;
  }
  const dyL = By - Ty;
  if (dyL <= 0) {
    return TEMPLATE.REJECTED;
  }
  if (options.rejectBox?.(triangle.xs, triangle.ys)) {
    return TEMPLATE.REJECTED;
  }
  const t = idiv((My - Ty) << 8, dyL);
  const width = (imul(t, Bx - Tx) >> 8) - (Mx - Tx);
  if (width === 0) {
    return TEMPLATE.ZERO_WIDTH;
  }
  const setups = channels.map((channel) => setupChannel(channel, t, width, dyL));
  const values = Int32Array.from(setups, (s) => s.start);
  const dx = Int32Array.from(setups, (s) => s.dx);
  const dy = Int32Array.from(setups, (s) => s.dy);
  const advance = (rows) => {
    for (let i = 0; i < values.length; i++) {
      values[i] = (values[i] + imul(dy[i], rows)) | 0;
    }
  };
  const isLongLeft = width < 0;
  const dxL = idiv((Bx - Tx) << 16, dyL);
  let xL = Tx << 16;
  let y = Ty;
  const dyS = My - Ty;
  if (dyS !== 0 && My >= 0) {
    const dxS = idiv((Mx - Tx) << 16, dyS);
    let xS = Tx << 16;
    if (Ty < 0) {
      advance(-Ty);
      xL = ((Tx << 16) - imul(dxL, Ty)) | 0;
      xS = ((Tx << 16) - imul(dxS, Ty)) | 0;
      y = 0;
    }
    const yEnd = Math.min(My, yCap);
    for (; y < yEnd; y++) {
      span(y, xL >> 16, xS >> 16, isLongLeft, values, dx);
      xL = (xL + dxL) | 0;
      xS = (xS + dxS) | 0;
      advance(1);
    }
  } else if (dyS !== 0) {
    y = My;
    advance(dyS);
  }
  let xS = Mx << 16;
  const yEnd = Math.min(By, yCap);
  if (y >= yEnd) {
    return TEMPLATE.DRAWN;
  }
  const dxS = idiv((Bx - Mx) << 16, By - My);
  if (y < 0) {
    xL = (xL - imul(dxL, Ty)) | 0;
    xS = (xS - imul(dxS, My)) | 0;
    advance(-y);
    y = 0;
  }
  for (; y < yEnd; y++) {
    span(y, xL >> 16, xS >> 16, isLongLeft, values, dx);
    xL = (xL + dxL) | 0;
    xS = (xS + dxS) | 0;
    advance(1);
  }
  return TEMPLATE.DRAWN;
}

/** Texel of a 256-wide texture at packed 8.8 (u, v): both wrap at 256. */
export function packedIndex(uv) {
  return ((uv >>> 16) & 0xff00) | ((uv >>> 8) & 0xff);
}

/**
 * The span clipping of 0x331b4 (and the projector's plain path): calls pixel(x, values) for each
 * pixel, from the long edge towards the short one, stepping the values by ±dx. `isInclusiveOnly`:
 * 0x35860's variant without the "n <= 0" early out.
 */
export function clippedSpan(y, xLong, xShort, isLongLeft, values, dx, pixel, isWithoutEmptyCheck = false) {
  if (y >= 200) {
    return;
  }
  const v = Int32Array.from(values);
  if (isLongLeft) {
    let xl = xLong;
    let xr = xShort;
    if (!(xl < 320 && xr > 0)) {
      return;
    }
    if (xl < 0) {
      for (let i = 0; i < v.length; i++) {
        v[i] = (v[i] - imul(xl, dx[i])) | 0;
      }
      xl = 0;
    }
    if (xr > 319) {
      xr = 319;
    }
    if (!isWithoutEmptyCheck && xr - xl <= 0) {
      return;
    }
    for (let x = xl; x <= xr; x++) {
      pixel(y * 320 + x, v);
      for (let i = 0; i < v.length; i++) {
        v[i] = (v[i] + dx[i]) | 0;
      }
    }
    return;
  }
  let xr = xLong;
  let xl = xShort;
  if (!(xl < 320 && xr > 0)) {
    return;
  }
  if (xr > 319) {
    for (let i = 0; i < v.length; i++) {
      v[i] = (v[i] + imul(319 - xr, dx[i])) | 0;
    }
    xr = 319;
  }
  if (xl < 0) {
    xl = 0;
  }
  if (!isWithoutEmptyCheck && xr - xl <= 0) {
    return;
  }
  for (let x = xr; x >= xl; x--) {
    pixel(y * 320 + x, v);
    for (let i = 0; i < v.length; i++) {
      v[i] = (v[i] - dx[i]) | 0;
    }
  }
}
