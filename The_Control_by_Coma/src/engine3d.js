// The textured 3D engine: object setup (0x518e4, 0x5198e, 0x51a38, 0x51ace, 0x51b74), transform (0x51c2f),
// rotations (0x2d540, 0x2d464, 0x2d4d1), projection (0x2d5ad), sphere-map uv (0x2d61b), cull/sort/paint
// (0x402d6) and the affine textured triangle (0x2dc83). Notes: C3 "3D engine", C6 (gear).
// Every array and scratch variable lives in memory at its original address, so stale reads (order[-1],
// depth[count], the triangle's vertex selection) behave as in the original.
import { drawTriangle, TRIANGLE_X, TRIANGLE_Y, TRIANGLE_U, TRIANGLE_V, OR_MASK } from './triangle.js';
import { SCRATCH_X, SCRATCH_Y, ANGLE_Z, OFFSET_X, OFFSET_Y, DISTANCE, SINE_DWORDS, COSINE_DWORDS } from './addresses.js';

// scratch "registers" of the math routines
const SCREEN_X = 0x2d418;
const SCREEN_Y = 0x2d41c;
const VIEW_Z = 0x2d420;
const X = SCRATCH_X;
const Y = SCRATCH_Y;
const Z = 0x2d42c;
/** 0x2d540 copies its inputs x, y here. */
const SAVED_X = 0x2d430;
const SAVED_Y = 0x2d434;
const ANGLE_X = 0x2d458;
const ANGLE_Y = 0x2d45c;
const SIN = SINE_DWORDS;
const COS = COSINE_DWORDS;
const ROTATION_SHIFT = 11;
const PROJECTION_BIAS = 0x258;
const CENTRE_X = 0xa0;
const CENTRE_Y = 0x64;
// sphere map
const ENV_U0 = 0x2d619;
const ENV_V0 = 0x2d61a;
const ENV_DISTANCE = 0x2e95d;
const ENV_CENTRE = 0x80;
const SHADE_MODE = 0x2e965;
// the current object
const VERTEX_COUNT = 0x51885;
const FACE_COUNT = 0x51889;
/** 0x518bc..0x518e0: vx, vy, vz, vnx, vny, vnz, fnx, fny, fnz, faces. */
const BLOCKS = 0x518bc;
const FACES_POINTER = 0x518e0;
// transformed arrays (1000 dwords each)
const PROJECTED_X = 0x327ed;
const ROTATED_X = 0x3378d;
const PROJECTED_Y = 0x3472d;
const ROTATED_Y = 0x356cd;
const DEPTH = 0x3666d;
const NORMAL_X = 0x2f90d;
const NORMAL_Y = 0x308ad;
const NORMAL_Z = 0x3184d;
const FACE_NORMAL_X = 0x385ad;
const FACE_NORMAL_Y = 0x3954d;
const FACE_NORMAL_Z = 0x3a4ed;
// cull and sort
const VISIBLE = 0x3b48d;
const VISIBLE_COUNT = 0x402d2;
const FACE_DEPTH = 0x2e969;
const ORDER = 0x3f30d;
const SORT_PREVIOUS = 0x402b6;
/** The bounds of the depth sort (the triangle's corner sort by y uses others). */
const DEPTH_SORT_FLOOR = -0x7d0000;
const DEPTH_SORT_CEILING = 0x7d0000;
const MAX_SHADE = 15;
// shadeMode 1 reads the gear's own vertex blocks, hard-wired
const GEAR_VERTEX_X = 0x500d9;
const GEAR_VERTEX_Y = 0x50649;
const PLANAR_FIRST_SHIFT = 6;
const PLANAR_FIRST_ADD = 5;
const PLANAR_SHIFT = 5;
const PLANAR_ADD = 0x40;
const ENV_DISTANCE_OBJECTS = 0x4e20;
const GEAR_DISTANCE = 0x2ee0;
const PULSING_GEAR_DISTANCE = 0x7530;
const GEAR_PULSE = 0x55ef2;

/** `imul` keeping the low 32 bits, then `sar 11`, as the rotations do. */
function rotatedSum(a, cosOrSin, b, sinOrCos, sign) {
  const product = sign < 0 ? (Math.imul(a, cosOrSin) - Math.imul(b, sinOrCos)) | 0 : (Math.imul(a, cosOrSin) + Math.imul(b, sinOrCos)) | 0;
  return product >> ROTATION_SHIFT;
}

function sinOf(m, angle) {
  return m.s32((SIN + angle * 4) >>> 0);
}

function cosOf(m, angle) {
  return m.s32((COS + angle * 4) >>> 0);
}

/** 0x2d540: rotate (X, Y) by [0x2d460]; the inputs are also copied to 0x2d430 / 0x2d434. Used by the rotozoomer too. */
export function rotateZ(m) {
  const a = m.u32(ANGLE_Z);
  const x = m.s32(X);
  const y = m.s32(Y);
  m.set32(SAVED_X, x);
  m.set32(SAVED_Y, y);
  m.set32(X, rotatedSum(x, cosOf(m, a), y, sinOf(m, a), -1));
  m.set32(Y, rotatedSum(x, sinOf(m, a), y, cosOf(m, a), 1));
}

/** 0x2d464: rotate (Y, Z) by [0x2d458]. */
function rotateX(m) {
  const a = m.u32(ANGLE_X);
  const y = m.s32(Y);
  const z = m.s32(Z);
  m.set32(Y, rotatedSum(y, cosOf(m, a), z, sinOf(m, a), -1));
  m.set32(Z, rotatedSum(y, sinOf(m, a), z, cosOf(m, a), 1));
}

/** 0x2d4d1: rotate (X, Z) by [0x2d45c]; z' uses -x. */
function rotateY(m) {
  const a = m.u32(ANGLE_Y);
  const x = m.s32(X);
  const z = m.s32(Z);
  m.set32(X, rotatedSum(x, cosOf(m, a), z, sinOf(m, a), 1));
  m.set32(Z, rotatedSum(-x | 0, sinOf(m, a), z, cosOf(m, a), 1));
}

function rotate(m) {
  rotateZ(m);
  rotateX(m);
  rotateY(m);
}

/**
 * `mov eax, v; cdq; shl eax, 8; idiv d`: edx holds the sign of v from BEFORE the shift, so the 64-bit
 * dividend is sign(v):(v << 8 as 32 bits). The quotient truncates toward zero.
 */
function divideShifted(v, divisor) {
  const dividend = (v < 0 ? -0x100000000 : 0) + ((v << 8) >>> 0);
  return Math.trunc(dividend / divisor) | 0;
}

/** 0x2d5ad: perspective projection of (X, Y, Z) into [0x2d418], [0x2d41c]; z + dist into [0x2d420]. */
function project(m) {
  const viewZ = (m.s32(Z) + m.s32(DISTANCE)) | 0;
  m.set32(VIEW_Z, viewZ);
  let divisor = (viewZ + PROJECTION_BIAS) | 0;
  if (divisor === 0) {
    divisor = 1;
  }
  const x = m.s32(X);
  const y = m.s32(Y);
  m.set32(SCREEN_X, (divideShifted(x, divisor) + m.s32(OFFSET_X) + CENTRE_X + (x < 0 ? 0 : 1)) | 0);
  m.set32(SCREEN_Y, (divideShifted(y, divisor) + m.s32(OFFSET_Y) + CENTRE_Y + (y < 0 ? 0 : 1)) | 0);
}

/** `add eax, 0x80; shr al, 1; add al, [base]`: only the low byte changes. */
function sphereCoordinate(quotient, base) {
  const eax = (quotient + ENV_CENTRE) | 0;
  return ((eax & ~0xff) | ((((eax & 0xff) >> 1) + base) & 0xff)) | 0;
}

/** 0x2d61b: the rotated normal (X, Y, Z) to sphere-map (u, v) in [0x2d418], [0x2d41c]. */
function sphereMap(m) {
  let divisor = (m.s32(Z) + m.s32(ENV_DISTANCE)) | 0;
  if (divisor === 0) {
    divisor = 1;
  }
  m.set32(SCREEN_X, sphereCoordinate(divideShifted(m.s32(X), divisor), m.u8(ENV_U0)));
  m.set32(SCREEN_Y, sphereCoordinate(divideShifted(m.s32(Y), divisor), m.u8(ENV_V0)));
}

function block(m, index) {
  return m.u32(BLOCKS + 4 * index);
}

function loadScratch(m, xBlock, yBlock, zBlock, i) {
  m.set32(X, m.u32(block(m, xBlock) + 4 * i));
  m.set32(Y, m.u32(block(m, yBlock) + 4 * i));
  m.set32(Z, m.u32(block(m, zBlock) + 4 * i));
}

/** 0x51c2f: rotate and project the vertices, rotate the vertex and face normals, then draw (0x402d6). */
function transformAndDraw(m) {
  const vertexCount = m.u32(VERTEX_COUNT);
  let i = 0;
  do {
    loadScratch(m, 0, 1, 2, i);
    rotate(m);
    project(m);
    m.set32(PROJECTED_X + 4 * i, m.u32(SCREEN_X));
    m.set32(ROTATED_X + 4 * i, m.u32(X));
    m.set32(PROJECTED_Y + 4 * i, m.u32(SCREEN_Y));
    m.set32(ROTATED_Y + 4 * i, m.u32(Y));
    m.set32(DEPTH + 4 * i, m.u32(VIEW_Z));
    loadScratch(m, 3, 4, 5, i);
    rotate(m);
    m.set32(NORMAL_X + 4 * i, m.u32(X));
    m.set32(NORMAL_Y + 4 * i, m.u32(Y));
    m.set32(NORMAL_Z + 4 * i, m.u32(Z));
    i++;
  } while (i < vertexCount);
  const faceCount = m.u32(FACE_COUNT);
  i = 0;
  do {
    loadScratch(m, 6, 7, 8, i);
    rotate(m);
    m.set32(FACE_NORMAL_X + 4 * i, m.u32(X));
    m.set32(FACE_NORMAL_Y + 4 * i, m.u32(Y));
    m.set32(FACE_NORMAL_Z + 4 * i, m.u32(Z));
    i++;
  } while (i < faceCount);
  cullSortAndPaint(m);
}

/** 0x402d6 part 1: faces whose normal faces the camera go to VISIBLE as {dot, v0, v1, v2}. */
function cullFaces(m) {
  const faces = m.u32(FACES_POINTER);
  const faceCount = m.u32(FACE_COUNT);
  let out = VISIBLE;
  m.set32(VISIBLE_COUNT, 0);
  let f = 0;
  do {
    const corner = faces + 12 * f;
    const v0 = m.u32(corner);
    let dot = Math.imul(m.s32(FACE_NORMAL_X + 4 * f), m.s32((ROTATED_X + v0 * 4) >>> 0));
    dot = (dot + Math.imul(m.s32(FACE_NORMAL_Y + 4 * f), m.s32((ROTATED_Y + v0 * 4) >>> 0))) | 0;
    dot = (Math.imul(m.s32(FACE_NORMAL_Z + 4 * f), m.s32((DEPTH + v0 * 4) >>> 0)) + dot) | 0;
    if (dot >= 0) {
      m.set32(out, dot);
      m.set32(out + 4, m.u32(corner));
      m.set32(out + 8, m.u32(corner + 4));
      m.set32(out + 12, m.u32(corner + 8));
      out += 16;
      m.set32(VISIBLE_COUNT, m.u32(VISIBLE_COUNT) + 1);
    }
    f++;
  } while (f < faceCount);
}

function depthOf(m, vertex) {
  return m.s32((DEPTH + vertex * 4) >>> 0);
}

/** 0x402d6 part 2: depth = the sum of the three view depths (do-while: entry 0 even with no face). */
function measureDepths(m) {
  const count = m.u32(VISIBLE_COUNT);
  let lastVertex = 0;
  let c = 0;
  do {
    const entry = VISIBLE + 16 * c + 4;
    lastVertex = m.u32(entry + 8);
    const sum = (depthOf(m, m.u32(entry)) + depthOf(m, m.u32(entry + 4)) + depthOf(m, lastVertex)) | 0;
    m.set32(FACE_DEPTH + 4 * c, sum);
    c++;
  } while (c < count);
  return lastVertex;
}

/**
 * 0x402d6 part 3: selection sort into ORDER, ascending depth, equal depths in index order. The equal-depth
 * scan runs to count inclusive (a stale entry), and `e` (ebp) keeps its value when nothing qualifies:
 * at first the last vertex index the depth loop read.
 */
function sortByDepth(m, selectedBefore) {
  const count = m.u32(VISIBLE_COUNT);
  let k = 0;
  let selected = selectedBefore;
  m.set32(SORT_PREVIOUS, DEPTH_SORT_FLOOR);
  do {
    let best = DEPTH_SORT_CEILING;
    let c = 0;
    do {
      const depth = m.s32(FACE_DEPTH + 4 * c);
      if (depth < best && depth > m.s32(SORT_PREVIOUS)) {
        best = depth;
        selected = c;
      }
      c++;
    } while (c < count);
    m.set32(SORT_PREVIOUS, best);
    m.set32((ORDER + 4 * k) >>> 0, selected);
    if (selected >>> 0 < (count - 1) >>> 0) {
      for (let e = selected + 1; e <= count; e++) {
        if (m.s32(FACE_DEPTH + 4 * e) === m.s32(SORT_PREVIOUS)) {
          k++;
          m.set32((ORDER + 4 * k) >>> 0, e);
        }
      }
    }
    k++;
  } while (k < count);
}

/** shadeMode 1: u, v from the gear's unrotated x, y; the first corner uses (x >> 6) + 5. */
function planarCorner(m, j, vertex) {
  const shift = j === 0 ? PLANAR_FIRST_SHIFT : PLANAR_SHIFT;
  const add = j === 0 ? PLANAR_FIRST_ADD : PLANAR_ADD;
  m.set8(TRIANGLE_U + j, ((m.s32((GEAR_VERTEX_X + vertex * 4) >>> 0) >> shift) + add) & 0xff);
  m.set8(TRIANGLE_V + j, ((m.s32((GEAR_VERTEX_Y + vertex * 4) >>> 0) >> PLANAR_SHIFT) + PLANAR_ADD) & 0xff);
}

/** shadeMode 0: u, v from the rotated vertex normal through the sphere map. */
function sphereCorner(m, j, vertex) {
  m.set32(X, m.u32((NORMAL_X + vertex * 4) >>> 0));
  m.set32(Y, m.u32((NORMAL_Y + vertex * 4) >>> 0));
  m.set32(Z, m.u32((NORMAL_Z + vertex * 4) >>> 0));
  sphereMap(m);
  m.set8(TRIANGLE_U + j, m.u8(SCREEN_X));
  m.set8(TRIANGLE_V + j, m.u8(SCREEN_Y));
}

/** 0x402d6 part 4: paint far to near (do-while: with no visible face it paints the stale order[-1]). */
function paint(m) {
  let i = (m.u32(VISIBLE_COUNT) - 1) | 0;
  do {
    const entry = (VISIBLE + (m.u32((ORDER + 4 * i) >>> 0) << 4)) >>> 0;
    const isPlanar = m.u32(SHADE_MODE) !== 0;
    if (isPlanar) {
      let shade = m.s32(entry) >> 23;
      if (shade < 0) {
        shade = 0;
      }
      if (shade > MAX_SHADE) {
        shade = MAX_SHADE;
      }
      m.set8(OR_MASK, (shade << 4) & 0xff);
    }
    for (let j = 0; j < 3; j++) {
      const vertex = m.u32(entry + 4 + 4 * j);
      m.set32(TRIANGLE_X + 4 * j, m.u32((PROJECTED_X + vertex * 4) >>> 0));
      m.set32(TRIANGLE_Y + 4 * j, m.u32((PROJECTED_Y + vertex * 4) >>> 0));
      if (isPlanar) {
        planarCorner(m, j, vertex);
      } else {
        sphereCorner(m, j, vertex);
      }
    }
    drawTriangle(m);
    i--;
  } while (i >= 0);
}

function cullSortAndPaint(m) {
  cullFaces(m);
  sortByDepth(m, measureDepths(m));
  paint(m);
}

// ---- the objects ----

/** Header address (N, F) and the ten block pointers, in the order 0x518bc..0x518e0. */
const SPIKY_STAR = { header: 0x4aed9, blocks: [0x4aee1, 0x4c151, 0x4d3c1, 0x4b3a9, 0x4d889, 0x4d889, 0x4b871, 0x4cae1, 0x4dd51, 0x4e631] };
const PLANT = { header: 0x40651, blocks: [0x40659, 0x41261, 0x41e69, 0x40971, 0x42181, 0x42181, 0x40c89, 0x41891, 0x42499, 0x42a71] };
const SPIDER = { header: 0x43bf9, blocks: [0x43c01, 0x455c9, 0x46f91, 0x442a5, 0x47635, 0x47635, 0x44949, 0x46311, 0x47cd9, 0x48959] };
const GEAR = { header: 0x500d1, blocks: [0x500d9, 0x50649, 0x50bb9, 0x50259, 0x50d39, 0x50d39, 0x503d9, 0x50949, 0x50eb9, 0x51129] };

/** The vertex normals' y pointer is the z block (both 0x518cc and 0x518d0), as in the original. */
function selectObject(m, object) {
  m.set32(VERTEX_COUNT, m.u32(object.header));
  m.set32(FACE_COUNT, m.u32(object.header + 4));
  object.blocks.forEach((address, index) => m.set32(BLOCKS + 4 * index, address));
}

function setSphereMap(m, u0, v0) {
  m.set32(ENV_DISTANCE, ENV_DISTANCE_OBJECTS);
  m.set8(ENV_U0, u0);
  m.set8(ENV_V0, v0);
}

/** 0x5198e: the spiky star, texture quadrant (0x80, 0x80). */
export function drawSpikyStar(m) {
  setSphereMap(m, 0x80, 0x80);
  m.set32(SCREEN_X, 0);
  m.set32(SCREEN_Y, 0);
  selectObject(m, SPIKY_STAR);
  transformAndDraw(m);
}

/** 0x518e4: the plant, texture quadrant (0, 0x80). */
export function drawPlant(m) {
  setSphereMap(m, 0, 0x80);
  m.set32(SCREEN_X, 0);
  m.set32(SCREEN_Y, 0);
  selectObject(m, PLANT);
  transformAndDraw(m);
}

/** 0x51a38: the spider, texture quadrant (0x80, 0). */
export function drawSpider(m) {
  setSphereMap(m, 0x80, 0);
  selectObject(m, SPIDER);
  transformAndDraw(m);
}

/** 0x51ace: the gear, centred at distance 12000, planar texture with shading (shadeMode 1). */
export function drawGear(m) {
  m.set32(OFFSET_X, 0);
  m.set32(OFFSET_Y, 0);
  m.set32(DISTANCE, GEAR_DISTANCE);
  m.set32(SHADE_MODE, 1);
  selectObject(m, GEAR);
  transformAndDraw(m);
}

/** 0x51b74: the gear at distance 30000 + SIN[[0x55ef2]] * 8 (it breathes). */
export function drawPulsingGear(m) {
  m.set32(DISTANCE, PULSING_GEAR_DISTANCE);
  const pulse = m.s32((SIN + m.u32(GEAR_PULSE) * 4) >>> 0);
  m.set32(DISTANCE, (m.s32(DISTANCE) + (pulse << 3)) | 0);
  m.set32(SHADE_MODE, 1);
  m.set32(OFFSET_X, 0);
  m.set32(OFFSET_Y, 0);
  selectObject(m, GEAR);
  transformAndDraw(m);
}
