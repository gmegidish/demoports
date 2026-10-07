// The graphics unit, second half (segment 186a:1d02-end): polygon fillers, the lighting table and
// the column-based affine texture mapper. Notes: docs/disassembly/L2_gfx_b.md.
// Polygons are arrays of 1-based vertices {x, y, c}: the screen buffer at DS:5ac2.
import { f32, int16, roundHalfEven } from './machine.js';
import { clipRun, solidSpan } from './gfx.js';

const NO_LEFT = 32000;
const NO_RIGHT = -32000;

function rowOffset(m, y) {
  return Math.imul(y, m.width);
}

// ---- spans called through the hook DS:911a (register convention DI=y, SI=x, CX=len, AL=colour) ----

export { solidSpan };

/** 186a:16c1: a colour ramp going down by gradStep/256 per pixel. Hard-coded stride 320. */
export function gradientSpan(m, y, x, len, color) {
  const c = m.clip;
  if (y < c.top || y > c.bottom) {
    return;
  }
  const run = clipRun(m, x, len);
  if (!run || run[1] < 1) {
    return;
  }
  let di = y * 320 + run[0];
  let ax = (color << 8) | color;
  for (let i = 0; i < run[1]; i++) {
    m.active[di++ & 0xffff] = ax >> 8;
    ax = (ax - m.gradStep) & 0xffff;
  }
}

/** 186a:16fa: additive, wrapping. Hard-coded stride 320. */
export function additiveSpan(m, y, x, len, color) {
  const c = m.clip;
  if (y < c.top || y > c.bottom) {
    return;
  }
  const run = clipRun(m, x, len);
  if (!run || run[1] < 1) {
    return;
  }
  let di = y * 320 + run[0];
  for (let i = 0; i < run[1]; i++) {
    const p = di++ & 0xffff;
    m.active[p] = (m.active[p] + color) & 0xff;
  }
}

// ---- the shared edge walk ----

function yRange(P, n) {
  let minY = P[1].y;
  let maxY = P[1].y;
  for (let i = 2; i <= n; i++) {
    minY = Math.min(minY, P[i].y);
    maxY = Math.max(maxY, P[i].y);
  }
  return [minY, maxY];
}

/** Edge i joins vertex i-1 (n for i=1) and vertex i; it starts at the upper end, 16.16. */
function buildEdges(P, n, withColor) {
  const edges = [];
  let j = n;
  for (let i = 1; i <= n; i++) {
    let dx = P[i].x - P[j].x;
    let dy = P[i].y - P[j].y;
    let dc = P[i].c - P[j].c;
    let x;
    let c;
    if (dy < 0) {
      dx = -dx;
      dy = -dy;
      dc = -dc;
      x = P[i].x;
      c = P[i].c;
    } else {
      x = P[j].x;
      c = P[j].c;
    }
    const edge = { x: x * 65536, dx: dy !== 0 ? Math.trunc((dx * 65536) / dy) | 0 : 0 };
    if (withColor) {
      edge.c = c * 65536;
      edge.dc = dy !== 0 ? Math.trunc((dc * 65536) / dy) | 0 : 0;
    }
    edges[i] = edge;
    j = j === n ? 1 : j + 1;
  }
  return edges;
}

/**
 * One scanline of the edge walk: edges are visited n, n-1, .. 1; edge cx joins vertex cx and vertex
 * cx-1 (n when cx=1). Both ends inclusive, horizontal edges skipped. Returns the leftmost and rightmost
 * edge (before their step).
 */
function scanline(P, n, edges, y, withColor) {
  const out = { xl: NO_LEFT, xr: NO_RIGHT, cl: 0, cr: 0 };
  let si = n - 1;
  for (let cx = n; cx >= 1; cx--) {
    const a = P[cx].y;
    const b = P[si === 0 ? n : si].y;
    if (a !== b && ((y >= a && y <= b) || (y >= b && y <= a))) {
      const e = edges[cx];
      const ix = e.x >> 16;
      if (ix <= out.xl) {
        out.xl = ix;
        if (withColor) {
          out.cl = e.c;
        }
      }
      if (ix >= out.xr) {
        out.xr = ix;
        if (withColor) {
          out.cr = e.c;
        }
      }
      e.x = (e.x + e.dx) | 0;
      if (withColor) {
        e.c = (e.c + e.dc) | 0;
      }
    }
    si--;
    if (si === 0) {
      si = n;
    }
  }
  return out;
}

function anyVertexInClip(m, P) {
  const c = m.clip;
  for (let i = 1; i <= 4; i++) {
    if (P[i].x >= c.left && P[i].x <= c.right && P[i].y >= c.top && P[i].y <= c.bottom) {
      return true;
    }
  }
  return false;
}

/** 186a:1d02: flat polygon, optional colour cycling between cycLo and cycHi, one step per scanline. */
export function flatPoly(m, P, n, cycLo, cycHi, color, span = solidSpan) {
  const [minY, maxY] = yRange(P, n);
  if (minY > m.clip.bottom || maxY < m.clip.top) {
    return;
  }
  const edges = buildEdges(P, n, false);
  let isCyclingDown = false;
  for (let y = minY; y <= maxY; y++) {
    let { xl, xr } = scanline(P, n, edges, y, false);
    xl = Math.max(xl, m.clip.left);
    xr = Math.min(xr, m.clip.right);
    if (xl > xr) {
      continue;
    }
    const spanColor = color;
    if (cycHi !== 0) {
      if (color <= cycLo) {
        isCyclingDown = false;
      } else if (color >= cycHi) {
        isCyclingDown = true;
      }
      if (isCyclingDown) {
        color = (color - 1) & 0xff;
        if (color === 0) {
          color = 255;
        }
      } else {
        color = (color + 1) & 0xff;
        if (color === 0) {
          color = 1;
        }
      }
    }
    span(m, y, xl, xr - xl + 1, spanColor);
  }
}

/**
 * 186a:2084: a gouraud span clamped to 10..255. The fraction accumulator lives in the high word of
 * EDI and is never initialised, so it carries over from span to span (m.gouraudFraction).
 */
function gouraudSpan(m, y, x, len, c0, c1) {
  const c = m.clip;
  if (y < c.top || y > c.bottom) {
    return;
  }
  let di = (rowOffset(m, y) + x) & 0xffff;
  const diff = int16(c1 - c0);
  const step = Math.trunc((diff * 65536) / len) | 0;
  const stepI = (step >>> 16) & 0xffff;
  const stepF = step & 0xffff;
  let ax = c0 & 0xffff;
  let fraction = m.gouraudFraction;
  for (let i = 0; i < len; i++) {
    const v = int16(ax);
    m.active[di] = v < 10 ? 10 : v > 255 ? 255 : v;
    di++;
    let carryFromDi = 0;
    if (di > 0xffff) {
      di &= 0xffff;
      carryFromDi = 1;
    }
    fraction += stepF + carryFromDi;
    const carry = fraction > 0xffff ? 1 : 0;
    fraction &= 0xffff;
    ax = (ax + stepI + carry) & 0xffff;
  }
  m.gouraudFraction = fraction;
}

/** 186a:21bf: gouraud polygon, vertex c = intensity. */
export function gouraudPoly(m, P, n, bias) {
  if (!anyVertexInClip(m, P)) {
    return;
  }
  const [minY, maxY] = yRange(P, n);
  if (minY > m.clip.bottom || maxY < m.clip.top) {
    return;
  }
  const edges = buildEdges(P, n, true);
  for (let y = minY; y <= maxY; y++) {
    let { xl, xr, cl, cr } = scanline(P, n, edges, y, true);
    xl = Math.max(xl, m.clip.left);
    xr = Math.min(xr, m.clip.right);
    if (xl <= xr) {
      gouraudSpan(m, y, xl, xr - xl + 1, ((cl >> 16) + bias) & 0xffff, ((cr >> 16) + bias) & 0xffff);
    }
  }
}

/** 186a:2170: per pixel litTab[acc >> 16]. Indices past 90 read the variables after the table. */
function phongSpan(m, y, x, len, left, right) {
  const c = m.clip;
  if (y < c.top || y > c.bottom) {
    return;
  }
  let di = (rowOffset(m, y) + x) & 0xffff;
  const step = Math.trunc((((right - left) | 0)) / len) | 0;
  let acc = left;
  for (let i = 0; i < len; i++) {
    m.active[di] = m.litTableAt((acc >>> 16) & 0xffff);
    acc = (acc + step) | 0;
    di = (di + 1) & 0xffff;
  }
}

/** 186a:2774: vertex c = angle 0..90, looked up in the lighting table. */
export function phongPoly(m, P, n) {
  if (!anyVertexInClip(m, P)) {
    return;
  }
  const [minY, maxY] = yRange(P, n);
  if (minY > m.clip.bottom || maxY < m.clip.top) {
    return;
  }
  const edges = buildEdges(P, n, true);
  let left = 0;
  let right = 0;
  for (let y = minY; y <= maxY; y++) {
    const s = scanline(P, n, edges, y, true);
    if (s.xl !== NO_LEFT) {
      left = s.cl;
    }
    if (s.xr !== NO_RIGHT) {
      right = s.cr;
    }
    const xl = Math.max(s.xl, m.clip.left);
    const xr = Math.min(s.xr, m.clip.right);
    if (xl <= xr) {
      phongSpan(m, y, xl, xr - xl + 1, left, right);
    }
  }
}

/** Real48 Power (1d45:0142): 0 for a zero base, else exp(e*ln|b|) with the sign of an odd integer power. */
function power(base, exponent) {
  if (base === 0) {
    return 0;
  }
  const magnitude = Math.exp(exponent * Math.log(Math.abs(base)));
  return base < 0 && Math.abs(exponent % 2) === 1 ? -magnitude : magnitude;
}

/** 186a:26a6: litTab[i] = min(255, amb + dif*cos(i) + spe*cos(i)^expo), i = 0..90 degrees. */
export function buildLitTable(m, amb, dif, spe, expo) {
  for (let i = 0; i <= 90; i++) {
    const a = f32(Math.cos((i * Math.PI) / 180));
    const p = f32(power(a, expo));
    let v = f32(amb + dif * a + spe * p);
    if (v > 255) {
      v = 255;
    }
    m.litTable[i] = roundHalfEven(v) & 0xff;
  }
}

// ---- the texture mapper ----

/** Edge-table x range: the original's buffer absorbs x in -319..638 (plain) or -320..640 (lit). */
const EDGE_X_BIAS = 320;
const EDGE_COLUMNS = 960;
const EMPTY_Y = -32768;

class EdgeTable {
  constructor() {
    this.y1 = new Int16Array(EDGE_COLUMNS).fill(EMPTY_Y);
    this.y2 = new Int16Array(EDGE_COLUMNS).fill(EMPTY_Y);
    this.u1 = new Uint8Array(EDGE_COLUMNS);
    this.u2 = new Uint8Array(EDGE_COLUMNS);
    this.v1 = new Uint8Array(EDGE_COLUMNS).fill(0x80);
    this.v2 = new Uint8Array(EDGE_COLUMNS).fill(0x80);
    this.s1 = new Uint8Array(EDGE_COLUMNS).fill(0x80);
    this.s2 = new Uint8Array(EDGE_COLUMNS).fill(0x80);
    this.minX = NO_LEFT;
    this.maxX = NO_RIGHT;
  }
}

/** Stepping one value 8.8 over n columns, as 2c2c/3031 do for u, v and the shade. */
function step88(from, to, n) {
  return Math.trunc((int16(to - from) * 256) / n) & 0xffff;
}

/**
 * 186a:2c2c / 3031: walks one edge along x; columns S.x .. E.x-1 get y, u, v (and the shade). The first
 * edge to reach a column fills slot 1, later ones slot 2.
 */
function texEdge(table, p, uP, vP, sP, r, uR, vR, sR) {
  let S = p;
  let E = r;
  let uS = uP;
  let vS = vP;
  let sS = sP;
  let uE = uR;
  let vE = vR;
  let sE = sR;
  if (r.x <= p.x) {
    S = r;
    E = p;
    [uS, vS, sS, uE, vE, sE] = [uR, vR, sR, uP, vP, sP];
  }
  table.minX = Math.min(table.minX, S.x);
  table.maxX = Math.max(table.maxX, E.x);
  const n = int16(E.x - S.x);
  if (n === 0) {
    return;
  }
  const yStep = Math.trunc((int16(E.y - S.y + 1) * 65536) / n) | 0;
  const yStepF = yStep & 0xffff;
  const yStepI = (yStep >>> 16) & 0xffff;
  const du = step88(uS, uE, n);
  const dv = step88(vS, vE, n);
  const ds = step88(sS, sE, n);
  let yI = S.y & 0xffff;
  let yF = 0;
  let U = (uS << 8) & 0xffff;
  let V = (vS << 8) & 0xffff;
  let Sh = (sS << 8) & 0xffff;
  for (let k = 0; k < n; k++) {
    const col = S.x + k + EDGE_X_BIAS;
    if (col >= 0 && col < EDGE_COLUMNS) {
      if (table.y1[col] === EMPTY_Y) {
        table.y1[col] = yI;
        table.u1[col] = U >> 8;
        table.v1[col] = V >> 8;
        table.s1[col] = Sh >> 8;
      } else {
        table.y2[col] = yI;
        table.u2[col] = U >> 8;
        table.v2[col] = V >> 8;
        table.s2[col] = Sh >> 8;
      }
    }
    const t = yF + yStepF;
    yF = t & 0xffff;
    yI = (yI + yStepI + (t >>> 16)) & 0xffff;
    U = (U + du) & 0xffff;
    V = (V + dv) & 0xffff;
    Sh = (Sh + ds) & 0xffff;
  }
}

/**
 * The packed v:u stepper of 2d20/316b, kept bit for bit: EBX holds v:u in its low word (8.8 each,
 * fractions elsewhere), stepped by add ecx,eax / adc ebx,esi / adc bh,dl.
 */
class TexelStepper {
  constructor(uT, vT, uB, vB, len) {
    const du = Math.trunc(((uB - uT) * 65536) / len) | 0;
    const dv = Math.trunc(((vB - vT) * 65536) / len) | 0;
    this.duF = du & 0xffff;
    this.esi = (((dv & 0xffff) << 16) | ((du >>> 16) & 0xffff)) >>> 0;
    this.dl = (dv >>> 16) & 0xff;
    this.ebx = ((vT << 8) | uT) >>> 0;
    this.ecxHi = 0;
  }

  step() {
    const t = this.ecxHi + this.duF;
    const c1 = t >>> 16;
    this.ecxHi = t & 0xffff;
    const s = this.ebx + this.esi + c1;
    const c2 = s >= 0x100000000 ? 1 : 0;
    this.ebx = s >>> 0;
    const bh = (((this.ebx >>> 8) & 0xff) + this.dl + c2) & 0xff;
    this.ebx = ((this.ebx & 0xffff00ff) | (bh << 8)) >>> 0;
  }

  addOffset(offset) {
    this.ebx = ((this.ebx & 0xffff0000) | ((this.ebx + offset) & 0xffff)) >>> 0;
  }
}

/** The column's top and bottom record, swapped so that top has the smaller y (equal: slot 2 on top). */
function columnEnds(table, col) {
  const y1 = table.y1[col];
  const y2 = table.y2[col];
  if (y2 > y1) {
    return { top: y1, uT: table.u1[col], vT: table.v1[col], sT: table.s1[col], bot: y2, uB: table.u2[col], vB: table.v2[col], sB: table.s2[col] };
  }
  return { top: y2, uT: table.u2[col], vT: table.v2[col], sT: table.s2[col], bot: y1, uB: table.u1[col], vB: table.v1[col], sB: table.s1[col] };
}

/** 186a:2d20 (plain) and 316b (lit): vertical spans; columns clipLeft and clipRight are never drawn. */
function drawColumns(m, table, texture, texOffset, isLit) {
  const c = m.clip;
  const W = m.width;
  for (let x = table.minX; x < table.maxX; x++) {
    if (!(x > c.left) || !(x < c.right)) {
      continue;
    }
    const col = x + EDGE_X_BIAS;
    if (col < 0 || col >= EDGE_COLUMNS) {
      continue;
    }
    const e = columnEnds(table, col);
    if (!(e.top < c.bottom) || !(e.bot > c.top)) {
      continue;
    }
    let len = int16(e.bot - e.top);
    if (len === 0) {
      continue;
    }
    const stepper = new TexelStepper(e.uT, e.vT, e.uB, e.vB, len);
    const dS = Math.trunc((int16(e.sB - e.sT) * 256) / len) & 0xffff;
    let shade = (e.sT << 8) & 0xffff;
    let di = (rowOffset(m, e.top) + x) & 0xffff;
    if (e.top < c.top) {
      const k = c.top - e.top;
      len -= k;
      for (let i = 0; i < k; i++) {
        stepper.step();
        shade = (shade + dS) & 0xffff;
      }
      di = x & 0xffff;
    }
    if (e.bot > c.bottom) {
      len -= e.bot - c.bottom;
    }
    stepper.addOffset(texOffset);
    for (let i = 0; i < len; i++) {
      stepper.step();
      let color = texture[stepper.ebx & 0xffff];
      if (isLit) {
        shade = (shade + dS) & 0xffff;
        color += m.litTableAt(shade >>> 8);
        if (color > 255) {
          color = 255;
        }
      }
      if (color !== 0) {
        m.active[di] = color;
      }
      di = (di + W) & 0xffff;
    }
  }
}

/** Texture descriptor (186a:39d3): w x h at (u0, v0) of a 256-stride view of a page. */
export function newTexture(page, u0, v0, w, h) {
  return { w, h, page, offset: ((v0 << 8) + u0) & 0xffff };
}

const QUAD_CORNERS = {
  normal: [[1, 0, 0, 4, 0, 1], [4, 0, 1, 3, 1, 1], [3, 1, 1, 2, 1, 0], [2, 1, 0, 1, 0, 0]],
  mirror: [[2, 0, 0, 3, 0, 1], [3, 0, 1, 4, 1, 1], [4, 1, 1, 1, 1, 0], [1, 1, 0, 2, 0, 0]],
};

/**
 * 186a:3343 / 34d7 (plain) and 366b / 381f (lit, vertex c = shade): a quad mapped onto the whole texture,
 * V1=(0,0) V2=(w-1,0) V3=(w-1,h-1) V4=(0,h-1), or mirrored in u.
 */
export function textureQuad(m, Q, texture, { isMirrored = false, isLit = false } = {}) {
  if (!texture) {
    return;
  }
  const page = m.getPage(texture.page);
  const table = new EdgeTable();
  const w1 = texture.w - 1;
  const h1 = texture.h - 1;
  for (const [a, ua, va, b, ub, vb] of QUAD_CORNERS[isMirrored ? 'mirror' : 'normal']) {
    const sa = isLit ? Q[a].c & 0xff : 0;
    const sb = isLit ? Q[b].c & 0xff : 0;
    texEdge(table, Q[a], ua * w1, va * h1, sa, Q[b], ub * w1, vb * h1, sb);
  }
  if (table.minX > m.clip.right || table.maxX < m.clip.left || table.minX === table.maxX) {
    return;
  }
  drawColumns(m, table, page, texture.offset, isLit);
}
