// The perspective-correct texture mapper 0x36890 (not in E2's notes; read from the code): u/z, v/z
// and 1/z interpolated in single precision along the left edge of each row (the long edge when it is
// on the left, else the two short edges), x in 20.12 along the edges; each span (0x4f891) divides
// every 16 pixels (fistp, round to nearest even) and steps a packed 8.8 (u, v) linearly in between
// (0x4f800). Rows < 201 (row 200 is past the screen and dropped), x clipped to 0..319 with both span
// ends drawn. Used by parts 0 (cube), 9, 10 (floor, walls), 12, 14 and the fly-away quads; 0x37668
// (part 9's panel) has the same setup with its own span, hence `perspectiveTriangle(..., span)`.

import { f32, idiv, imul } from '../fixed.js';
import { V, VERTEX_INTS, SLOT_INTS, S } from '../layout.js';
import { sortSlotsByY, packedIndex } from './template.js';

const WIDTH = 320;
const Y_CAP = 201;
const BLOCK = 16;
const SHORT_RUN = 7;

/** fistp in the default rounding mode: to nearest, ties to even. */
export function roundToEven(x) {
  const r = Math.round(x);
  if (Math.abs(x % 1) === 0.5 && r % 2 !== 0) {
    return (r - 1) | 0;
  }
  return r | 0;
}

function vertexOf(context, polygon, k) {
  const at = polygon.slots[k * SLOT_INTS + S.VERTEX] * VERTEX_INTS;
  const v = context.vertices;
  return {
    sx: v[at + V.SX],
    sy: v[at + V.SY],
    iz: f32(1 / v[at + V.Z]),
    u8: polygon.slots[k * SLOT_INTS + S.U] << 8,
    v8: polygon.slots[k * SLOT_INTS + S.V] << 8,
  };
}

/** The values of one interpolation step (1/z, u/z, v/z) over `delta` with factor `inverse`. */
function gradients(a, b, inverse) {
  return [f32(f32(b[0] - a[0]) * inverse), f32(f32(b[1] - a[1]) * inverse), f32(f32(b[2] - a[2]) * inverse)];
}

/** Values at y = 0 from values at row `from` (< 0) with per-row steps: value - from*step. */
function backToRowZero(values, steps, from) {
  return values.map((value, i) => f32(value - f32(from * steps[i])));
}

/**
 * 0x36890's setup and row walk. `span(state, rowOffset, x, count)` draws one row from its left end
 * (x may be < 0; count = right - left) with state = { values: [iz, uz, vz] at the left end, inverse
 * = 1/iz, perPixel: the x gradients of iz, uz, vz (negated, as the original keeps them), perBlock:
 * 16 x the true gradients, texture }.
 */
export function perspectiveTriangle(polygon, context, span) {
  const [ti, mi, bi] = (() => {
    const ys = [0, 1, 2].map((k) => context.vertices[polygon.slots[k * SLOT_INTS] * VERTEX_INTS + V.SY]);
    return sortSlotsByY(ys[0], ys[1], ys[2]);
  })();
  const T = vertexOf(context, polygon, ti);
  if (T.sy >= Y_CAP) {
    return;
  }
  const M = vertexOf(context, polygon, mi);
  const B = vertexOf(context, polygon, bi);
  if (B.sy < 0) {
    return;
  }
  const dyL = B.sy - T.sy;
  if (dyL <= 0) {
    return;
  }
  const inverseDyL = f32(1 / dyL);
  const dyS = M.sy - T.sy;
  const t = f32(dyS * inverseDyL);
  const atT = [T.iz, f32(T.u8 * T.iz), f32(T.v8 * T.iz)];
  const atM = [M.iz, f32(M.u8 * M.iz), f32(M.v8 * M.iz)];
  const atB = [B.iz, f32(B.u8 * B.iz), f32(B.v8 * B.iz)];
  const dxL = B.sx - T.sx;
  const dxS = M.sx - T.sx;
  const width = f32(f32(dxL * t) - dxS);
  if (width === 0) {
    return;
  }
  const bMinusT = [0, 1, 2].map((i) => f32(atB[i] - atT[i]));
  const mMinusT = [0, 1, 2].map((i) => f32(atM[i] - atT[i]));
  const across = [0, 1, 2].map((i) => f32(f32(t * bMinusT[i]) - mMinusT[i]));
  const longStep = idiv(dxL << 12, dyL);
  const inverseWidth = f32(1 / width);
  const perPixel = across.map((a) => f32(-a * inverseWidth));
  const state = {
    values: atT.slice(),
    inverse: 0,
    perPixel,
    perBlock: perPixel.map((g) => f32(g * -BLOCK)),
    texture: polygon.material.texture,
  };
  let y = T.sy;
  let xLong = T.sx << 12;
  let xShort = T.sx << 12;
  const longAtRowZero = ((T.sx << 12) - imul(longStep, T.sy)) | 0;
  const isLongLeft = width < 0;

  const walk = (yEnd, steps, shortStep) => {
    state.inverse = f32(1 / state.values[0]);
    for (; y < yEnd; y++) {
      const a = xLong >> 12;
      const b = xShort >> 12;
      const [left, right] = isLongLeft ? [a, b] : [b, a];
      const count = right - left;
      if (left < WIDTH && right > 0 && count > 0) {
        span(state, y * WIDTH, left, count);
      }
      state.values[0] = f32(state.values[0] + steps[0]);
      state.inverse = f32(1 / state.values[0]);
      state.values[1] = f32(state.values[1] + steps[1]);
      state.values[2] = f32(state.values[2] + steps[2]);
      xLong = (xLong + longStep) | 0;
      xShort = (xShort + shortStep) | 0;
    }
  };

  // Rows T..M: the left end follows the long edge (long edge left) or the short edge T->M.
  const longSteps = bMinusT.map((d) => f32(d * inverseDyL));
  const upperSteps = isLongLeft ? longSteps : mMinusT.map((d) => f32(d * f32(1 / dyS)));
  if (dyS !== 0 && M.sy >= 0) {
    const shortStep = idiv((dxS << 12), dyS);
    if (T.sy < 0) {
      state.values = backToRowZero(atT, upperSteps, T.sy);
      xLong = longAtRowZero;
      xShort = ((T.sx << 12) - imul(T.sy, shortStep)) | 0;
      y = 0;
    }
    walk(Math.min(M.sy, Y_CAP), upperSteps, shortStep);
  } else if (dyS !== 0) {
    y = M.sy;
  }

  // Rows M..B: the short edge restarts at M (and so do the values when they follow it).
  xShort = M.sx << 12;
  const yEnd = Math.min(B.sy, Y_CAP);
  if (yEnd <= y) {
    return;
  }
  const dyS2 = B.sy - M.sy;
  const shortStep2 = idiv((B.sx - M.sx) << 12, dyS2);
  let lowerSteps = longSteps;
  if (!isLongLeft) {
    state.values = atM.slice();
    lowerSteps = [0, 1, 2].map((i) => f32(f32(atB[i] - atM[i]) * f32(1 / dyS2)));
  }
  if (y < 0) {
    xLong = (xLong - imul(longStep, T.sy)) | 0;
    state.values = backToRowZero(state.values, lowerSteps, isLongLeft ? T.sy : y);
    xShort = (xShort - imul(y, shortStep2)) | 0;
    y = 0;
  }
  walk(yEnd, lowerSteps, shortStep2);
}

/**
 * 0x4f891: one row from x (clipped at 0 by moving the values), `count + 1` pixels capped at x = 319,
 * a perspective divide every 16 pixels; `run(at, n, uv, duv, zStart, zEnd)` writes n pixels from
 * offset `at` stepping the packed (v<<16 | u) 8.8 pair; zStart / zEnd are the depths (1 / (1/z)) at
 * the block's two ends, for the depth-cued 0x38440.
 */
export function perspectiveSpan(state, rowOffset, x0, count0, run) {
  let [iz, uz, vz] = state.values;
  let inverse = state.inverse;
  let x = x0;
  let count = count0;
  if (x < 0) {
    vz = f32(vz + f32(state.perPixel[2] * x));
    uz = f32(uz + f32(state.perPixel[1] * x));
    iz = f32(iz + f32(state.perPixel[0] * x));
    inverse = f32(1 / iz);
    count += x;
    x = 0;
  }
  let v0 = roundToEven(f32(vz * inverse));
  let u0 = roundToEven(f32(uz * inverse));
  let izAhead = f32(iz + state.perBlock[0]);
  let inverseAhead = f32(1 / izAhead);
  if (x + count > WIDTH - 1) {
    count = WIDTH - 1 - x;
  }
  let remaining = count + 1;
  if (remaining < 0) {
    return;
  }
  let inverseAtBlock = inverse;
  do {
    const uv = ((v0 << 16) + u0) | 0;
    vz = f32(vz + state.perBlock[2]);
    uz = f32(uz + state.perBlock[1]);
    const v1 = roundToEven(f32(vz * inverseAhead));
    const u1 = roundToEven(f32(uz * inverseAhead));
    const inverseAtBlockEnd = inverseAhead;
    izAhead = f32(izAhead + state.perBlock[0]);
    inverseAhead = f32(1 / izAhead);
    const duv = ((((v1 - v0) >> 4) << 16) + ((u1 - u0) >> 4)) | 0;
    const n = Math.min(BLOCK, remaining);
    run(rowOffset + x, n, uv, duv, inverseAtBlock, inverseAtBlockEnd);
    inverseAtBlock = inverseAtBlockEnd;
    u0 = u1;
    v0 = v1;
    x += n;
    remaining -= n;
  } while (remaining > 0);
}

/** 0x4f800: n texels of a 256-wide texture (at least one pixel when n < 7). */
function textureRun(target, texture, at, n, uv0, duv) {
  let uv = uv0;
  const pixels = n < SHORT_RUN ? Math.max(n, 1) : n;
  for (let k = 0; k < pixels; k++) {
    if (at + k < target.length) {
      target[at + k] = texture?.[packedIndex(uv)] ?? 0;
    }
    uv = (uv + duv) | 0;
  }
}

/** 0x36890: perspective-correct, unshaded, 256-wide texture (material +0x10). */
export function drawPerspectiveTexture(polygon, context) {
  const target = context.target;
  perspectiveTriangle(polygon, context, (state, rowOffset, x, count) =>
    perspectiveSpan(state, rowOffset, x, count, (at, n, uv, duv) => textureRun(target, state.texture, at, n, uv, duv)));
}
