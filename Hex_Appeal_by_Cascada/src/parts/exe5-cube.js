// exe5's cube (texture code by Iceman): the rotation matrix, the perspective projection, the per-face texture
// coordinates and the affine texture mapper (docs: H5_cube.md sections 6 to 8).
//
// Everything lives in the part's memory at its original address, in the code segment 0403: the vertices, the face
// records, the projected vertices, the texture coordinates and the six edge tables. `codeDwords` is an Int32Array
// over that 64 KB segment, so a dword at cs:off is codeDwords[off >> 2] (all of them are 4-aligned), and an
// address that wraps at 16 bits wraps the index at 0x4000 dwords, as the 16-bit `di`/`si` did.

/** @typedef {import('../machine.js').Machine} Machine */

/** Linear address of the code segment 0403. */
export const CODE = 0x4030;
/** The off-screen 320x200 buffer, segment 2c11. */
export const BUFFER = 0x2c110;

const SEGMENT_DWORD_MASK = 0x3fff;

// cs offsets
const VERTEX_COUNT = 0x3160;
const VERTICES = 0x3162;
const FACES = 0x31a2;
const FACE_RECORD_BYTES = 0xe6;
const FACE_COUNT = 6;
const PROJECTED_VERTICES = 0x3708;
const PROJECTED_VERTEX_BYTES = 12;
const TEXTURE_COORDINATES = 0x86c0;
const PERSPECTIVE_DISTANCE = 0x71d2;
const MASKED_ANGLES = 0x728e;
const SINE_TABLE = 0x72ca;

// face record fields
const FACE_ANGLE = 0;
const FACE_POINTS = 4;
const FACE_FLAG = 6;
const FACE_SCALE = 8;
const FACE_U_OFFSET = 0xc;
const FACE_V_OFFSET = 0xe;
const FACE_TEXTURE_SEGMENT = 0xd0;
const FACE_POLYGON = 0xd2;

// the edge tables (256 dwords each); in the span loop they are reached from L's pointer plus these
const LEFT_X = 0x3b14;
const RIGHT_X = 0x3f14;
const LEFT_U = 0x4314;
const RIGHT_U = 0x4714;
const LEFT_V = 0x4b14;
const RIGHT_V = 0x4f14;
const RIGHT_FROM_LEFT = 0x400;
const LEFT_U_FROM_LEFT = 0x800;
const RIGHT_U_FROM_LEFT = 0xc00;
const LEFT_V_FROM_LEFT = 0x1000;
const RIGHT_V_FROM_LEFT = 0x1400;

/** The y range immediates at 0403:5353 and 5361, reset for every face. */
const Y_MIN_START = 0x75300000;
const Y_MAX_START = 0x8ad00000 | 0;
/** 0x8c * 0x10000: the projection's focal factor, idiv'ed by the depth (0403:719b). */
const FOCAL = 0x008c0000;
const CENTRE_X = 0x00a00000;
const CENTRE_Y = 0x00640000;
/** imul eax, eax, 0xd5 then sar 8: the 213/256 aspect correction. */
const ASPECT = 0xd5;
/** The quarter turn of the 2048-entry table, in bytes. */
const QUARTER_TURN_BYTES = 0x400;
const ROW_BYTES = 320;
/** The odd-start bug reads [bx + 0xc] (0403:617f). */
const ODD_PIXEL_BUG_OFFSET = 0x0c;

function s16(v) {
  return (v << 16) >> 16;
}

/** The cube table T (cs:72ca), by byte offset masked with 0xffe. */
function sineAt(m, byteOffset) {
  return m.s16(CODE + SINE_TABLE + (byteOffset & 0xffe));
}

/**
 * 0403:6fdc transformCube: 6ff8 (sin/cos of the three angles), 703e (the matrix), 719b (rotate and project the 8
 * vertices into cs:3708, 12 bytes each: x and y in 16.16, then the rotated z).
 */
export function transformCube(m, codeDwords) {
  // 6ff8: the table byte offset is (angle * 2) & 0xffe; the second value is a quarter turn back
  const angles = [0, 1, 2].map((i) => m.u16(CODE + MASKED_ANGLES + 2 * i));
  const [a, b, c, d, e, f] = angles.flatMap((angle) => [sineAt(m, angle * 2), sineAt(m, angle * 2 - QUARTER_TURN_BYTES)]);
  // 703e: 32-bit imuls, "x2" is add r,r (wrapping), then sar 16
  const t = ((c * b * 2) | 0) >> 16;
  const mxx = (((e * a - Math.imul(t, f)) * 2) | 0) >> 16;
  const mxy = (((-f * a - Math.imul(t, e)) * 2) | 0) >> 16;
  const mxz = ((d * b * 2) | 0) >> 16;
  const t2 = ((c * a * 2) | 0) >> 16;
  const myx = (((e * b + Math.imul(t2, f)) * 2) | 0) >> 16;
  const myy = (((-f * b + Math.imul(t2, e)) * 2) | 0) >> 16;
  const myz = ((-d * a * 2) | 0) >> 16;
  const mzx = ((f * d * 2) | 0) >> 16;
  const mzy = ((e * d * 2) | 0) >> 16;
  const mzz = c;
  // 719b: the depth D is the immediate at cs:71d2; the 16-bit add wraps (the mirrored cube of the fly-in)
  const distance = m.u16(CODE + PERSPECTIVE_DISTANCE);
  const count = m.u16(CODE + VERTEX_COUNT);
  for (let i = 0; i < count; i++) {
    const x = m.s16(CODE + VERTICES + 6 * i);
    const y = m.s16(CODE + VERTICES + 6 * i + 2);
    const z = m.s16(CODE + VERTICES + 6 * i + 4);
    const rotatedZ = ((x * mzx + y * mzy + z * mzz) * 2) | 0;
    const depth = s16((rotatedZ >> 16) + distance);
    const k = (FOCAL / depth) | 0;
    const rx = (((x * mxx + y * mxy + z * mxz) * 2) | 0) >> 16;
    const ry = (((x * myx + y * myy + z * myz) * 2) | 0) >> 16;
    const sx = ((Math.imul(rx, k) << 1) + CENTRE_X) | 0;
    const sy = ((Math.imul(Math.imul(ry, k) << 1, ASPECT) >> 8) + CENTRE_Y) | 0;
    const at = (PROJECTED_VERTICES + PROJECTED_VERTEX_BYTES * i) >> 2;
    codeDwords[at] = sx;
    codeDwords[at + 1] = sy;
    codeDwords[at + 2] = rotatedZ;
  }
}

/**
 * 0403:6eea faceTexCoords: rotates and scales each face's 4 texture-space points into u,v (16.16) at
 * cs:86c0 + 32k. The original patches P, Q, the scale and the offsets into its own immediates.
 */
export function faceTexCoords(m, codeDwords) {
  for (let k = 0; k < FACE_COUNT; k++) {
    const face = CODE + FACES + k * FACE_RECORD_BYTES;
    const angle = m.u16(face + FACE_ANGLE) & 0xffe;
    const p = sineAt(m, angle);
    const q = sineAt(m, angle + QUARTER_TURN_BYTES);
    // a dword whose high word is 0 for every face, so the 64-bit product stays exact in a double
    const scale = m.u32(face + FACE_SCALE);
    const uOffset = m.u16(face + FACE_U_OFFSET) << 16;
    const vOffset = m.u16(face + FACE_V_OFFSET) << 16;
    const points = CODE + m.u16(face + FACE_POINTS);
    const out = (TEXTURE_COORDINATES + 32 * k) >> 2;
    for (let j = 0; j < 4; j++) {
      const x = m.s16(points + 4 * j);
      const y = m.s16(points + 4 * j + 2);
      // imul ecx: bits 16..47 of the 64-bit product, then add ecx, imm32 (wrapping)
      const ru = ((x * p - y * q) * 2) | 0;
      codeDwords[out + 2 * j] = (Math.floor((ru * scale) / 0x10000) + uOffset) | 0;
      const rv = ((y * p + x * q) * 2) | 0;
      codeDwords[out + 2 * j + 1] = (Math.floor((rv * scale) / 0x10000) + vOffset) | 0;
    }
  }
}

/**
 * 0403:30ee drawVisibleFaces with 3106 faceFacing: a face is drawn when the 2D cross product of its first three
 * projected vertices is positive. No sorting: culling is enough for a convex cube. (After the loop the code falls
 * into 3106 once more and writes a word into projected vertex 0, which is recomputed before it is used again.)
 */
export function drawVisibleFaces(m, codeDwords) {
  for (let k = 0; k < FACE_COUNT; k++) {
    const face = CODE + FACES + k * FACE_RECORD_BYTES;
    const v0 = m.u16(face + FACE_POLYGON) >> 2;
    const v1 = m.u16(face + FACE_POLYGON + 4) >> 2;
    const v2 = m.u16(face + FACE_POLYGON + 8) >> 2;
    const x0 = codeDwords[v0] >> 16;
    const y0 = codeDwords[v0 + 1] >> 16;
    const x1 = codeDwords[v1] >> 16;
    const y1 = codeDwords[v1 + 1] >> 16;
    const x2 = codeDwords[v2] >> 16;
    const y2 = codeDwords[v2 + 1] >> 16;
    const cross = (s16(x1 - x0) * s16(y2 - y0) - s16(x2 - x0) * s16(y1 - y0)) | 0;
    const isFacing = cross > 0;
    m.set16(face + FACE_FLAG, isFacing ? 1 : 0);
    if (isFacing) {
      drawTexturedQuad(m, codeDwords, face);
    }
  }
}

/**
 * One edge pass of 0403:5314: for each of the 4 polygon edges, interpolates a value (x, u or v) down the edge
 * into the left or the right table, one dword per screen row, without sub-pixel correction. valueOffsets[i] and
 * yOffsets[i] are the dword indices of polygon entry i's value and projected y (16.16).
 */
function scanEdges(codeDwords, valueOffsets, yOffsets, leftTable, rightTable) {
  for (let i = 0; i < 4; i++) {
    const ya = codeDwords[yOffsets[i]];
    const yb = codeDwords[yOffsets[i + 1]];
    const ia = ya >> 16;
    const ib = yb >> 16;
    if (ia === ib) {
      continue;
    }
    let table;
    let yBottom;
    let yTop;
    let valueBottom;
    let valueTop;
    if (ia > ib) {
      table = leftTable;
      yBottom = ya;
      yTop = yb;
      valueBottom = codeDwords[valueOffsets[i]];
      valueTop = codeDwords[valueOffsets[i + 1]];
    } else {
      table = rightTable;
      yBottom = yb;
      yTop = ya;
      valueBottom = codeDwords[valueOffsets[i + 1]];
      valueTop = codeDwords[valueOffsets[i]];
    }
    const dy = (yBottom - yTop) | 0;
    // the integer part of dy, not int(bottom) - int(top); the unrolled 200 stosd are entered at 199 - n
    const rows = (dy >>> 16) & 0xffff;
    const start = (table >> 2) + ((yTop >>> 16) & 0xffff);
    const slope = Math.trunc((((valueBottom - valueTop) | 0) * 0x10000) / dy) | 0;
    let value = valueTop;
    for (let j = 0; j <= rows; j++) {
      codeDwords[(start + j) & SEGMENT_DWORD_MASK] = value;
      value = (value + slope) | 0;
    }
  }
}

/** Scratch arrays for the polygon's dword indices (5 entries: the last repeats the first). */
const xIndices = new Int32Array(5);
const yIndices = new Int32Array(5);
const uIndices = new Int32Array(5);
const vIndices = new Int32Array(5);

/**
 * 0403:5314 drawTexturedQuad: three edge passes (x, u, v) then the affine spans (60af) into the buffer. No
 * clipping. Texels come from the 64 KB window at the face's segment: bx = (v_int << 8) | u_int.
 */
function drawTexturedQuad(m, codeDwords, face) {
  let yMin = Y_MIN_START;
  let yMax = Y_MAX_START;
  for (let i = 0; i < 5; i++) {
    const vertex = m.u16(face + FACE_POLYGON + 4 * i) >> 2;
    const point = m.u16(face + FACE_POLYGON + 4 * i + 2) >> 2;
    xIndices[i] = vertex;
    yIndices[i] = vertex + 1;
    uIndices[i] = point;
    vIndices[i] = point + 1;
    // first pass only: the range of the start vertices (signed 32-bit, jg/jl)
    if (i < 4) {
      const y = codeDwords[vertex + 1];
      if (y <= yMin) {
        yMin = y;
      }
      if (y >= yMax) {
        yMax = y;
      }
    }
  }
  scanEdges(codeDwords, xIndices, yIndices, LEFT_X, RIGHT_X);
  scanEdges(codeDwords, uIndices, yIndices, LEFT_U, RIGHT_U);
  scanEdges(codeDwords, vIndices, yIndices, LEFT_V, RIGHT_V);
  const texture = m.u16(face + FACE_TEXTURE_SEGMENT) * 16;
  drawSpans(m.mem, codeDwords, texture, yMin >> 16, yMax >> 16);
}

/**
 * 0403:60af the spans, with both bugs of the original:
 * - an odd start address draws its first pixel from tex[(bx & 0xff00 | tex[bx]) + 0xc] (0403:617d);
 * - after the unrolled pairs, 6 stray bytes (0403:6ec4: mov al,[si]; sub dx,bx; sbb si,cx) take bx from dx, so
 *   the odd last pixel is fetched with a damaged v.
 * The u,v fractions at the span ends are dropped; u,v step in 8.8 in 16-bit registers.
 */
function drawSpans(mem, codeDwords, texture, y0, y1) {
  const count = s16(y1 - y0);
  if (count <= 0) {
    return;
  }
  let left = (LEFT_X + (y0 << 2)) & 0xffff;
  let rowOffset = ((y0 << 2) * 0x50) & 0xffff;
  for (let j = 0; j < count; j++) {
    drawSpan(mem, codeDwords, texture, left, rowOffset);
    left = (left + 4) & 0xffff;
    rowOffset = (rowOffset + ROW_BYTES) & 0xffff;
  }
}

function tableAt(codeDwords, left, delta) {
  return codeDwords[((left + delta) & 0xffff) >> 2];
}

/** One row of 60af..6ed8; `left` is the cs offset of this row's entry in the left x table. */
function drawSpan(mem, codeDwords, texture, left, rowOffset) {
  const xLeft = tableAt(codeDwords, left, 0) >> 16;
  const xRight = tableAt(codeDwords, left, RIGHT_FROM_LEFT) >> 16;
  const width = s16(xRight - xLeft);
  if (width < 0) {
    return;
  }
  let n = width + 1;
  let di = (xLeft + rowOffset) & 0xffff;
  const uLeft = tableAt(codeDwords, left, LEFT_U_FROM_LEFT) & 0xffff0000;
  const uRight = tableAt(codeDwords, left, RIGHT_U_FROM_LEFT) & 0xffff0000;
  const du = (Math.trunc(((uRight - uLeft) | 0) / n) >> 8) & 0xffff;
  let cx = (uLeft >>> 8) & 0xffff;
  const vLeft = tableAt(codeDwords, left, LEFT_V_FROM_LEFT) & 0xffff0000;
  const vRight = tableAt(codeDwords, left, RIGHT_V_FROM_LEFT) & 0xffff0000;
  const dv = (Math.trunc(((vRight - vLeft) | 0) / n) >> 8) & 0xffff;
  let dx = (vLeft >>> 8) & 0xffff;
  let bx;
  if (di & 1) {
    bx = (dx & 0xff00) | (cx >> 8);
    cx = (cx + du) & 0xffff;
    dx = (dx + dv) & 0xffff;
    const texel = mem[texture + bx];
    mem[BUFFER + di] = mem[texture + ((((bx & 0xff00) | texel) + ODD_PIXEL_BUG_OFFSET) & 0xffff)];
    di = (di + 1) & 0xffff;
    n--;
    if (n === 0) {
      return;
    }
  }
  const pairs = n >> 1;
  if (pairs) {
    // 0403:61a4: 160 unrolled 21-byte blocks, entered at 160 - pairs
    for (let p = 0; p < pairs; p++) {
      bx = (dx & 0xff00) | (cx >> 8);
      cx = (cx + du) & 0xffff;
      dx = (dx + dv) & 0xffff;
      const first = mem[texture + bx];
      bx = (dx & 0xff00) | (cx >> 8);
      cx = (cx + du) & 0xffff;
      dx = (dx + dv) & 0xffff;
      mem[BUFFER + di] = first;
      mem[BUFFER + ((di + 1) & 0xffff)] = mem[texture + bx];
      di = (di + 2) & 0xffff;
    }
    // the stray bytes at 0403:6ec4
    dx = (dx - bx) & 0xffff;
  }
  if (n & 1) {
    mem[BUFFER + di] = mem[texture + ((dx & 0xff00) | (cx >> 8))];
  }
}
