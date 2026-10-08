// 0x2dc83: the affine textured triangle into W (through the row table 0x1b3bd), no z-buffer.
// Notes: C3 "0x2dc83 drawTriangle". Inputs in memory: X[3] 0x2dbef, Y[3] 0x2dbfb (dwords), U[3] 0x2dc1f,
// V[3] 0x2dc22 (bytes); texture [0x2d708]; span mode [0x2d6d9]; OR mask [0x2d6da]. The edge tables EX/EU/EV
// stay in memory (rows written for negative y land below them, as in the original).
import { ROW_TABLE, TEXTURE_POINTER } from './addresses.js';

/** The inputs, written by the 3D engine's painter. */
export const TRIANGLE_X = 0x2dbef;
export const TRIANGLE_Y = 0x2dbfb;
export const TRIANGLE_U = 0x2dc1f;
export const TRIANGLE_V = 0x2dc22;
const SORTED = 0x2dc25;
const EDGE_X = 0x2d72e;
const EDGE_U = 0x2da4e;
const EDGE_V = 0x2db16;
const SPAN_MODE = 0x2d6d9;
/** 0x2d6da: OR-ed into every opaque texel (the gear's shade). */
export const OR_MASK = 0x2d6da;
/** The bounds of the corner sort by y (the depth sort of 0x402d6 uses others). */
const Y_SORT_FLOOR = -2000000;
const Y_SORT_CEILING = 2000000;
const LAST_ROW = 199;
const SCREEN_ROWS = 200;
const SCREEN_WIDTH = 320;
const FRACTION_BITS = 16;
const FRACTION_MASK = 0xffff;

/** `shl eax, 16; cdq; idiv divisor`, as a 16.16 step: { fraction (low word), whole (high part, sar) }. */
function step(delta, divisor) {
  if (divisor === 0) {
    return { fraction: 0, whole: 0 };
  }
  const quotient = Math.trunc(((delta << FRACTION_BITS) | 0) / divisor) | 0;
  return { fraction: quotient & FRACTION_MASK, whole: quotient >> FRACTION_BITS };
}

/**
 * Sorts the three corners by Y (stable on ties) into SORTED, the way the original does it. The selection
 * register (edi) keeps its value between calls when no vertex qualifies: m.triangleSelectedCorner.
 */
function sortCorners(m) {
  let lastSelected = m.triangleSelectedCorner;
  let previous = Y_SORT_FLOOR;
  let k = 0;
  do {
    let best = Y_SORT_CEILING;
    for (let c = 0; c < 3; c++) {
      const y = m.s32(TRIANGLE_Y + 4 * c);
      if (y < best && y > previous) {
        lastSelected = c;
        best = y;
      }
    }
    previous = best;
    m.set32(SORTED + 4 * k, lastSelected);
    if (lastSelected < 2) {
      for (let c = lastSelected + 1; c < 3; c++) {
        if (m.s32(TRIANGLE_Y + 4 * c) === previous) {
          k++;
          m.set32(SORTED + 4 * k, c);
        }
      }
    }
    k++;
  } while (k < 3);
  m.triangleSelectedCorner = lastSelected;
}

function corner(m, sortedIndex) {
  const c = m.u32(SORTED + 4 * sortedIndex);
  return { x: m.s32(TRIANGLE_X + 4 * c), y: m.s32(TRIANGLE_Y + 4 * c), u: m.u8(TRIANGLE_U + c), v: m.u8(TRIANGLE_V + c) };
}

/** An edge walker: x as a 16.16 accumulator (adc into a dword), u and v as bytes with a 16-bit fraction. */
function edgeWalker(p, q) {
  const dy = (q.y - p.y) | 0;
  const sx = step((q.x - p.x) | 0, dy);
  const su = step(q.u - p.u, dy);
  const sv = step(q.v - p.v, dy);
  const walker = { x: p.x, u: p.u, v: p.v, fx: 0, fu: 0, fv: 0 };
  walker.advance = () => {
    walker.fx += sx.fraction;
    walker.x = (walker.x + sx.whole + (walker.fx >> FRACTION_BITS)) | 0;
    walker.fx &= FRACTION_MASK;
    walker.fu += su.fraction;
    walker.u = (walker.u + su.whole + (walker.fu >> FRACTION_BITS)) & 0xff;
    walker.fu &= FRACTION_MASK;
    walker.fv += sv.fraction;
    walker.v = (walker.v + sv.whole + (walker.fv >> FRACTION_BITS)) & 0xff;
    walker.fv &= FRACTION_MASK;
  };
  return walker;
}

/** A short edge into the tables EX/EU/EV (do-while: at least one row; skipped if it starts below row 199). */
function walkShortEdge(m, p, q) {
  if (p.y > LAST_ROW) {
    return;
  }
  const walker = edgeWalker(p, q);
  const end = Math.min(q.y, LAST_ROW);
  let y = p.y;
  do {
    if (y >= 0) {
      m.set32(EDGE_X + 4 * y, walker.x);
    }
    m.mem[EDGE_U + y] = walker.u;
    m.mem[EDGE_V + y] = walker.v;
    walker.advance();
    y++;
  } while (y < end);
}

/** One span: max(n, 1) pixels from xStart, clipped per pixel by an unsigned x < 320 test. */
function drawSpan(m, destination, xStart, n, us, vs, ue, ve) {
  const du = step(ue - us, n);
  const dv = step(ve - vs, n);
  const mem = m.mem;
  const texture = m.u32(TEXTURE_POINTER);
  const isOpaque = m.u8(SPAN_MODE) === 0;
  const orMask = m.u8(OR_MASK);
  let u = us;
  let v = vs;
  let fu = 0;
  let fv = 0;
  let x = xStart;
  let count = n;
  let address = destination;
  for (;;) {
    if (x >>> 0 < SCREEN_WIDTH) {
      const texel = mem[texture + ((v << 8) | u)];
      if (isOpaque) {
        mem[address] = texel | orMask;
      } else if (texel >> 2 !== 0) {
        mem[address] = texel >> 2;
      }
    }
    address++;
    fu += du.fraction;
    u = (u + du.whole + (fu >> FRACTION_BITS)) & 0xff;
    fu &= FRACTION_MASK;
    fv += dv.fraction;
    v = (v + dv.whole + (fv >> FRACTION_BITS)) & 0xff;
    fv &= FRACTION_MASK;
    x = (x + 1) | 0;
    count--;
    if (count <= 0) {
      return;
    }
  }
}

/** The long edge a -> c, drawing each row against the tables. */
function walkLongEdge(m, a, c) {
  const walker = edgeWalker(a, c);
  const end = Math.min(c.y, LAST_ROW);
  let y = a.y;
  do {
    if (y >= 0) {
      const row = m.u32(ROW_TABLE + 4 * y);
      const edgeX = m.s32(EDGE_X + 4 * y);
      const edgeU = m.mem[EDGE_U + y];
      const edgeV = m.mem[EDGE_V + y];
      const n = (edgeX - walker.x) | 0;
      if (n >= 0) {
        drawSpan(m, row + walker.x, walker.x, n, walker.u, walker.v, edgeU, edgeV);
      } else {
        drawSpan(m, row + edgeX, edgeX, -n | 0, edgeU, edgeV, walker.u, walker.v);
      }
    }
    walker.advance();
    y++;
  } while (y < end);
}

/** 0x2dc83. */
export function drawTriangle(m) {
  sortCorners(m);
  const a = corner(m, 0);
  if (a.y >= SCREEN_ROWS) {
    return;
  }
  const b = corner(m, 1);
  const c = corner(m, 2);
  walkShortEdge(m, a, b);
  walkShortEdge(m, b, c);
  walkLongEdge(m, a, c);
}
