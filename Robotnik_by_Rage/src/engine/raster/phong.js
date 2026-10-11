// Untextured phong rasterisers: 0x2c118 (diffuse == 256: the env map only) and 0x44354 (any n,
// env map + a flat term added with the original's 4-pixel carry quirk). The map coordinates are the
// corner normals: pu = (nx+256)>>2, pv = (ny+256)>>2 (0..128). See E2 §4.2, §4.3.

import { idiv, idiv64, imul } from '../fixed.js';
import { V, VERTEX_INTS, SLOT_INTS, S } from '../layout.js';
import { triangleOf } from './template.js';

const WIDTH = 320;

function vertexAt(vertices, polygon, k) {
  return polygon.slots[k * SLOT_INTS + S.VERTEX] * VERTEX_INTS;
}

/** 0x2c118 phong, untextured: triangles only, own edge walker (8.8 x, rows < 200). */
export function drawPhong(polygon, context) {
  const vertices = context.vertices;
  const { order, xs, ys } = triangleOf(vertices, polygon);
  const map = polygon.material.phongMap;
  const target = context.target;
  const pu = order.map((k) => (vertices[vertexAt(vertices, polygon, k) + V.NX] + 256) >> 2);
  const pv = order.map((k) => (vertices[vertexAt(vertices, polygon, k) + V.NY] + 256) >> 2);
  const [Tx, Mx, Bx] = xs;
  const [Ty, My, By] = ys;
  const dyS = My - Ty;
  const dyL = By - Ty;
  if (By < 0 || Ty >= 201 || dyL <= 0) {
    return;
  }
  const t = idiv(dyS << 8, dyL);
  const width = (imul(t, Bx - Tx) + ((Tx - Mx) << 8)) | 0;
  if (width === 0) {
    return;
  }
  let y = Ty;
  let xL = Tx << 8;
  let xS = Tx << 8;
  let u = pu[0] << 8;
  let v = pv[0] << 8;
  const dxL = idiv((Bx << 8) - xL, dyL);
  const duL = idiv((pu[2] << 8) - u, dyL);
  const dvL = idiv((pv[2] << 8) - v, dyL);
  const duX = idiv((imul(t, pu[2] - pu[0]) + ((pu[0] - pu[1]) << 8)) << 8, width);
  const dvX = idiv((imul(t, pv[2] - pv[0]) + ((pv[0] - pv[1]) << 8)) << 8, width);
  const span = (row, xl, xs0, u0, v0) => {
    let su = u0;
    let sv = v0;
    let xLong = xl;
    let xShort = xs0;
    if (width > 0) {
      const du = -duX;
      const dv = -dvX;
      if (xShort < 0) {
        xShort = 0;
      }
      if (xLong >= WIDTH + 1) {
        su += imul(du, xLong - WIDTH);
        sv += imul(dv, xLong - WIDTH);
        xLong = WIDTH;
      }
      for (let x = xLong - 1; x >= xShort; x--) {
        target[row * WIDTH + x] = map[((sv >> 8) & 255) * 256 + ((su >> 8) & 255)];
        su += du;
        sv += dv;
      }
      return;
    }
    if (xLong < 0) {
      su += imul(duX, -xLong);
      sv += imul(dvX, -xLong);
      xLong = 0;
    }
    if (xShort >= WIDTH + 1) {
      xShort = WIDTH;
    }
    for (let x = xLong; x < xShort; x++) {
      target[row * WIDTH + x] = map[((sv >> 8) & 255) * 256 + ((su >> 8) & 255)];
      su += duX;
      sv += dvX;
    }
  };
  if (dyS !== 0) {
    const dxS = idiv((Mx - Tx) << 8, dyS);
    for (; y < My && y < 200; y++) {
      if (y >= 0) {
        span(y, xL >> 8, xS >> 8, u, v);
      }
      xS += dxS;
      xL += dxL;
      u += duL;
      v += dvL;
    }
  }
  if (By > My) {
    xS = Mx << 8;
    const dxS = idiv((Bx - Mx) << 8, By - My);
    const yEnd = Math.min(By, 200);
    for (; y < yEnd; y++) {
      if (y >= 0) {
        span(y, xL >> 8, xS >> 8, u, v);
      }
      xS += dxS;
      xL += dxL;
      u += duL;
      v += dvL;
    }
  }
}

/** 0xf4d60: the row table of 0x44354 (x left/right 16.16 and packed uv at the left), never cleared. */
const rowTable = {
  left: new Int32Array(200),
  right: new Int32Array(200),
  uv: new Int32Array(200),
};

function addRightEdge(x0, y0, x1, y1) {
  const dy = y1 - y0;
  const slope = idiv((x1 - x0) << 16, dy);
  let x = ((x0 << 16) + 0x8000) | 0;
  let row = y0;
  let count = dy;
  if (y0 > 199) {
    return;
  }
  if (y0 < 0) {
    count += y0;
    if (count <= 0) {
      return;
    }
    x = (x + imul(-y0, slope)) | 0;
    row = 0;
  }
  if (y1 < 0 || y1 > 199) {
    if (y1 < 0) {
      return;
    }
    count = count - y1 + 199;
    if (count <= 0) {
      return;
    }
  }
  for (let k = 0; k <= count; k++, row++) {
    rowTable.right[row] = x;
    x = (x + slope) | 0;
  }
}

function addLeftEdge(x0, y0, x1, y1, u0, v0, u1, v1) {
  const dy = y0 - y1;
  const slope = idiv((x1 - x0) << 16, dy);
  let x = x0 << 16;
  const du = idiv((u1 - u0) << 8, dy);
  const dv = idiv((v1 - v0) << 8, dy);
  let uv = ((((v0 << 8) & 0xffff) << 16) | ((u0 << 8) & 0xffff)) | 0;
  const duv = (((dv & 0xffff) << 16) | (du & 0xffff)) | 0;
  let row = y0;
  let count = dy;
  if (y0 < 0 || y0 > 199) {
    if (y0 < 0) {
      return;
    }
    const k = y0 - 199;
    count -= k;
    if (count <= 0) {
      return;
    }
    uv = (uv + imul(duv, k)) | 0;
    x = (x + imul(slope, k)) | 0;
    row = 199;
  }
  if (y1 >= 200) {
    return;
  }
  if (y1 < 0) {
    count += 1 + y1;
    if (count <= 0) {
      return;
    }
  }
  for (let k = 0; k <= count; k++, row--) {
    rowTable.left[row] = x;
    rowTable.uv[row] = uv;
    x = (x + slope) | 0;
    uv = (uv + duv) | 0;
  }
}

/** Writes one span's pixels plus `shade`, the aligned groups of 4 as one dword (carries ripple). */
function writeShadedSpan(target, at, pixels, shade) {
  const count = pixels.length;
  if (count < 7) {
    for (let k = 0; k < count; k++) {
      target[at + k] = (pixels[k] + shade) & 255;
    }
    return;
  }
  let k = 0;
  while ((at + k) & 3) {
    target[at + k] = (pixels[k] + shade) & 255;
    k++;
  }
  const add = imul(shade, 0x01010101) >>> 0;
  for (; count - k >= 4; k += 4) {
    const word = ((pixels[k] | (pixels[k + 1] << 8) | (pixels[k + 2] << 16) | (pixels[k + 3] << 24)) >>> 0) + add;
    target[at + k] = word & 255;
    target[at + k + 1] = (word >>> 8) & 255;
    target[at + k + 2] = (word >>> 16) & 255;
    target[at + k + 3] = (word >>> 24) & 255;
  }
  for (; k < count; k++) {
    target[at + k] = (pixels[k] + shade) & 255;
  }
}

/**
 * 0x44354 prologue: copies slot 0's {vertex, u, v} into slot n of the polygon record itself. Draw
 * (0x3dd98) then shifts that copy into slot 2 when it fans an n > 3 polygon, so the original's second
 * fan triangle of a quad is (0, 2, 0) (degenerate: it only rewrites the row table) and its fourth
 * corner is never drawn.
 */
function closePolygonRecord(polygon) {
  polygon.slots.copyWithin(polygon.n * SLOT_INTS, 0, S.V + 1);
}

/** 0x44354 phong + flat term (diffuse != 256), any n. */
export function drawPhongFlat(polygon, context) {
  const vertices = context.vertices;
  const n = polygon.n;
  closePolygonRecord(polygon);
  const X = [];
  const Y = [];
  const U = [];
  const Vv = [];
  for (let i = 0; i <= n; i++) {
    const at = vertexAt(vertices, polygon, i);
    X.push(vertices[at + V.SX]);
    Y.push(vertices[at + V.SY]);
    U.push((vertices[at + V.NX] + 256) >>> 2);
    Vv.push((vertices[at + V.NY] + 256) >>> 2);
  }
  let minY = Math.min(...Y);
  let maxY = Math.max(...Y);
  if (minY >= 200) {
    return;
  }
  minY = Math.max(minY, 0);
  if (maxY < 0) {
    return;
  }
  maxY = Math.min(maxY, 199);
  if (minY >= maxY) {
    return;
  }
  for (let i = 0; i < n; i++) {
    const dy = Y[i + 1] - Y[i];
    if (dy > 0) {
      addRightEdge(X[i], Y[i], X[i + 1], Y[i + 1]);
    } else if (dy < 0) {
      addLeftEdge(X[i], Y[i], X[i + 1], Y[i + 1], U[i], Vv[i], U[i + 1], Vv[i + 1]);
    }
  }
  const area = (imul(X[0] - X[2], Y[1] - Y[2]) - imul(X[1] - X[2], Y[0] - Y[2])) | 0;
  if (area === 0) {
    return;
  }
  const gradient = (A) => idiv64(((imul(A[0] - A[2], Y[1] - Y[2]) - imul(A[1] - A[2], Y[0] - Y[2])) | 0) * 65536, area);
  const dudx = gradient(U);
  const dvdx = gradient(Vv);
  const duv = (((dvdx << 8) & 0xffff0000) | ((dudx >>> 8) & 0xffff)) | 0;
  const nz = polygon.normal < 0 ? 0 : context.faceNormals[polygon.normal * 3 + 2];
  const shade = (imul(Math.abs(nz), polygon.material.ambient) >> 8) & 0xff;
  const map = polygon.material.phongMap;
  const target = context.target;
  for (let y = minY; y <= maxY; y++) {
    let xr = rowTable.right[y] >> 16;
    if (xr < 0 || rowTable.left[y] >= (WIDTH << 16)) {
      continue;
    }
    if (xr >= WIDTH) {
      xr = WIDTH - 1;
    }
    let xl = rowTable.left[y] >> 16;
    let uv = rowTable.uv[y];
    if (xl < 0) {
      uv = (uv - imul(xl, duv)) | 0;
      xl = 0;
    }
    const count = xr - xl;
    if (count <= 0) {
      continue;
    }
    const pixels = new Uint8Array(count);
    for (let k = 0; k < count; k++) {
      pixels[k] = map[((uv >>> 16) & 0xff00) | ((uv >>> 8) & 0xff)];
      uv = (uv + duv) | 0;
    }
    writeShadedSpan(target, y * WIDTH + xl, pixels, shade);
  }
}
