// Triangles from view space to the rasteriser: near-plane clip, projection, screen clip.
// Same in TEST.EXE (0x22324, 0x24fe0: only struct offsets differ). KAHN.EXE compiles one clipping skeleton many times: 0x27670 (perspective texture), 0x29510 (the
// same through a blend table), 0x24b54 (affine texture), 0x2b3c0 (shade through a table), and
// 0x1880d/0x1a5be for the last parts. They differ in what is interpolated and what fills.
//
// A vertex here is five floats: x, y, z, u, v. Before projection they are view-space position and
// texel coordinates; after it, screen x, screen y, 1/z and, for the perspective drawers, u/z, v/z.

import { WIDTH, HEIGHT } from '../machine.js';
import { fillTrapezoids, createTrapezoids, fillAffineTriangle, AFFINE_OPAQUE } from './raster.js';

const f = Math.fround;

const X = 0;
const Y = 1;
const Z = 2;
const U = 3;
const V = 4;
const VERTEX_FLOATS = 5;

const NEAR_PLANE = 1;
/** The filler does the perspective divide once per this many pixels; gradients are scaled to match. */
const SPAN = 16;

const STAGE_FULL = 0;
const STAGE_CLIP_X = 1;
const STAGE_CLIP_Y = 2;
const STAGE_DRAW = 3;

const OUTSIDE_LOW = 1;
const OUTSIDE_HIGH = 2;

/**
 * Where triangles go and how they are projected. Parts point `target` at a work buffer; making a
 * scene current sets the scales. 0x53e18, 0x5c99c, 0x5c9a0, 0x5938c, 0x59390.
 */
export const view = {
  target: null,
  scaleX: 0,
  scaleY: 0,
  centreX: WIDTH * 0.5 - 0.5,
  centreY: HEIGHT * 0.5 - 0.5,
};

/** Each level of the clip recursion owns four scratch vertices. Depth never exceeds z, x, y, draw. */
const MAX_DEPTH = 4;
const scratch = [];
for (let depth = 0; depth < MAX_DEPTH; depth++) {
  scratch.push([0, 1, 2, 3].map(() => new Float32Array(VERTEX_FLOATS)));
}

/** Plane gradients, computed once per face from its first piece to reach the rasteriser. */
const gradient = {
  isValid: false,
  zPerSpan: 0,
  uPerSpan: 0,
  vPerSpan: 0,
  zPerRow: 0,
  uPerRow: 0,
  vPerRow: 0,
};

const trapezoids = createTrapezoids();

let texture = null;
/** False for the shadows part's table drawer (0x1a5be), which keeps the opaque drawer's edges. */
let trimsSharedEdges = true;
/** True while one of the affine drawers is running. */
let isAffine = false;
/** What a fully clipped triangle is handed to. */
let emit = null;
/** Blend table of the translucent variant, or null for the opaque one. */
let blendTable = null;

function project(out, vertex) {
  const inverseZ = f(1 / vertex[Z]);
  const x = vertex[X] * view.scaleX * inverseZ + view.centreX + 0.5;
  const y = view.centreY - vertex[Y] * view.scaleY * inverseZ + 0.5;
  // The perspective drawers interpolate u/z and v/z; the affine ones keep texels as they are.
  const u = isAffine ? vertex[U] : vertex[U] * inverseZ;
  const v = isAffine ? vertex[V] : vertex[V] * inverseZ;
  out[X] = x;
  out[Y] = y;
  out[Z] = inverseZ;
  out[U] = u;
  out[V] = v;
}

/** Point where edge a-b crosses the plane `axis = at`; every other component interpolated linearly. */
function clipEdgeLinear(a, b, out, axis, at) {
  const t = (at - b[axis]) / (a[axis] - b[axis]);
  for (let i = 0; i < VERTEX_FLOATS; i++) {
    out[i] = i === axis ? at : (a[i] - b[i]) * t + b[i];
  }
}

/**
 * The affine drawers' screen clip: 1/z and position are linear on screen, and the new vertex gets
 * perspective-correct texels by interpolating u/z and v/z and dividing back. 0x24a0c, 0x24ab0.
 */
function clipEdgeUndivided(a, b, out, axis, at) {
  const other = axis === X ? Y : X;
  const t = (at - b[axis]) / (a[axis] - b[axis]);
  const w = b[Z] + (a[Z] - b[Z]) * t;
  const along = (a[other] - b[other]) * t + b[other];
  const inverse = 1.0 / w;
  const u = (b[U] * b[Z] + (a[U] * a[Z] - b[U] * b[Z]) * t) * inverse;
  const v = (b[V] * b[Z] + (a[V] * a[Z] - b[V] * b[Z]) * t) * inverse;
  out[Z] = w;
  out[axis] = at;
  out[other] = along;
  out[U] = u;
  out[V] = v;
}

/**
 * Near plane. Returns false when nothing is in front of it. A triangle with one vertex behind
 * becomes a quad: its extra half is drawn straight away, before the rest.
 */
function clipNearAndProject(points, own, depth) {
  const z0 = points[0][Z];
  const z1 = points[1][Z];
  const z2 = points[2][Z];
  if (z0 >= NEAR_PLANE && z1 >= NEAR_PLANE && z2 >= NEAR_PLANE) {
    for (let i = 0; i < 3; i++) {
      project(own[i], points[i]);
      points[i] = own[i];
    }
    return true;
  }

  let low;
  let middle;
  let high;
  if (z0 < z1) {
    if (z0 > z2) {
      low = 2; middle = 0; high = 1;
    } else if (z1 > z2) {
      low = 0; high = 1; middle = 2;
    } else {
      low = 0; high = 2; middle = 1;
    }
  } else if (z0 < z2) {
    low = 1; middle = 0; high = 2;
  } else if (z1 > z2) {
    high = 0; middle = 1; low = 2;
  } else {
    high = 0; middle = 2; low = 1;
  }

  if (points[high][Z] <= NEAR_PLANE) {
    return false;
  }
  if (points[middle][Z] < NEAR_PLANE) {
    clipEdgeLinear(points[high], points[middle], own[middle], Z, NEAR_PLANE);
    clipEdgeLinear(points[high], points[low], own[low], Z, NEAR_PLANE);
    points[middle] = own[middle];
    points[low] = own[low];
    project(own[high], points[high]);
    points[high] = own[high];
    project(own[low], own[low]);
    project(own[middle], own[middle]);
    return true;
  }

  const extra = own[3];
  clipEdgeLinear(points[low], points[middle], extra, Z, NEAR_PLANE);
  clipEdgeLinear(points[low], points[high], own[low], Z, NEAR_PLANE);
  project(own[middle], points[middle]);
  points[middle] = own[middle];
  project(extra, extra);
  project(own[low], own[low]);
  points[low] = own[low];
  drawPiece(own[middle], extra, own[low], STAGE_CLIP_X, depth + 1);
  project(own[high], points[high]);
  points[high] = own[high];
  return true;
}

/**
 * Clip against both edges of the screen on one axis. A vertex is outside at `< 0` or `>= size`,
 * but the far clip line is size - 0.5. Pieces split off are drawn before the remainder.
 * Returns false when the whole triangle is off one side.
 */
function clipToScreen(points, own, axis, size, nextStage, depth) {
  const code = [0, 0, 0];
  let outside = 0;
  for (let i = 0; i < 3; i++) {
    const position = points[i][axis];
    if (position < 0) {
      code[i] = OUTSIDE_LOW;
      outside++;
    } else if (!(size > position)) {
      code[i] = OUTSIDE_HIGH;
      outside++;
    }
  }
  const isSplitAcrossBothSides = code[0] + code[1] + code[2] - 3 === 0;
  const lineOf = (index) => (code[index] === OUTSIDE_LOW ? 0 : f(size - 0.5));
  const clipEdge = isAffine ? clipEdgeUndivided : clipEdgeLinear;

  if (outside === 3 || (outside === 2 && !isSplitAcrossBothSides)) {
    const firstTwoMatch = code[0] === code[1];
    const outerTwoMatch = code[0] === code[2];
    if (firstTwoMatch && outerTwoMatch) {
      return false;
    }
    let odd;
    let p;
    let q;
    if (firstTwoMatch) {
      odd = 2; p = 0; q = 1;
    } else if (outerTwoMatch) {
      odd = 1; p = 0; q = 2;
    } else {
      odd = 0; p = 1; q = 2;
    }
    const line = lineOf(p);
    clipEdge(points[odd], points[p], own[p], axis, line);
    clipEdge(points[odd], points[q], own[q], axis, line);
    points[p] = own[p];
    points[q] = own[q];
    if (outside === 3) {
      code[p] = 0;
      code[q] = 0;
      outside = 1;
    }
  }

  if (outside === 2 && isSplitAcrossBothSides) {
    let out;
    let inside;
    let otherOut;
    if (code[0] !== 0) {
      out = 0;
      if (code[1] === 0) {
        inside = 1; otherOut = 2;
      } else {
        inside = 2; otherOut = 1;
      }
    } else {
      inside = 0; out = 1; otherOut = 2;
    }
    const line = lineOf(out);
    clipEdge(points[out], points[inside], own[3], axis, line);
    clipEdge(points[out], points[otherOut], own[out], axis, line);
    points[out] = own[out];
    drawPiece(own[3], own[out], points[inside], nextStage, depth + 1);
    code[out] = 0;
    outside = 1;
  }

  if (outside === 1) {
    let out;
    let a;
    let b;
    if (code[0] !== 0) {
      out = 0; a = 1; b = 2;
    } else if (code[1] !== 0) {
      out = 1; a = 0; b = 2;
    } else {
      out = 2; a = 0; b = 1;
    }
    const line = lineOf(out);
    clipEdge(points[out], points[a], own[3], axis, line);
    clipEdge(points[out], points[b], own[out], axis, line);
    points[out] = own[out];
    drawPiece(own[3], own[out], points[a], nextStage, depth + 1);
  }
  return true;
}

/** 16.16 step of an edge per scanline. It includes one row of the buffer, so it steps an address. */
function edgeSlope(dxPerRow) {
  return Math.trunc((dxPerRow + WIDTH) * 65536);
}

/**
 * Sort the vertices, set up the edges and hand the two trapezoids to the filler. Vertices are
 * truncated to whole pixels and there is no sub-pixel correction: the top vertex's attributes are
 * used as they are at its truncated position.
 */
function rasterise(a, b, c) {
  let v0 = a;
  let v1 = b;
  let v2 = c;
  let swap;

  const firstRowDelta = Math.trunc(v1[Y]) - Math.trunc(v0[Y]);
  if (firstRowDelta < 0) {
    swap = v0; v0 = v1; v1 = swap;
  } else if (firstRowDelta === 0) {
    const dx = Math.trunc(v1[X]) - Math.trunc(v0[X]);
    if (dx < 0) {
      swap = v0; v0 = v1; v1 = swap;
    }
    if (dx === 0) {
      return;
    }
  }
  let delta = Math.trunc(v2[Y]) - Math.trunc(v0[Y]);
  if (delta < 0) {
    swap = v0; v0 = v2; v2 = swap;
  } else if (delta === 0) {
    if (firstRowDelta === 0) {
      return;
    }
    const dx = Math.trunc(v2[X]) - Math.trunc(v0[X]);
    if (dx < 0) {
      swap = v0; v0 = v2; v2 = swap;
    }
    if (dx === 0) {
      return;
    }
  }
  delta = Math.trunc(v2[Y]) - Math.trunc(v1[Y]);
  if (delta < 0) {
    swap = v1; v1 = v2; v2 = swap;
  } else if (delta === 0) {
    const dx = Math.trunc(v2[X]) - Math.trunc(v1[X]);
    if (dx < 0) {
      swap = v1; v1 = v2; v2 = swap;
    }
    if (dx === 0) {
      return;
    }
  }

  const y0 = Math.trunc(v0[Y]);
  const y1 = Math.trunc(v1[Y]);
  const y2 = Math.trunc(v2[Y]);
  const topRows = y1 - y0;
  const bottomRows = y2 - y1;

  if (!gradient.isValid) {
    const dy02 = f(v2[Y] - v0[Y]);
    const dx01 = f(v1[X] - v0[X]);
    const dy01 = f(v1[Y] - v0[Y]);
    const dx02 = f(v2[X] - v0[X]);
    const determinant = f(dx01 * dy02 - dx02 * dy01);
    if (determinant === 0) {
      return;
    }
    const inverse = f(1 / determinant);
    const inversePerSpan = f((1 / determinant) * SPAN);
    const texelPerSpan = f(inversePerSpan * 256);
    const negativeTexel = f(-f(inverse * 256));
    const dz01 = v1[Z] - v0[Z];
    const dz02 = v2[Z] - v0[Z];
    const du01 = f(v1[U] - v0[U]);
    const du02 = f(v2[U] - v0[U]);
    const dv01 = f(v1[V] - v0[V]);
    const dv02 = f(v2[V] - v0[V]);
    gradient.zPerSpan = f((dy02 * dz01 - dy01 * dz02) * inversePerSpan);
    gradient.uPerSpan = f((dy02 * du01 - dy01 * du02) * texelPerSpan);
    gradient.vPerSpan = f((dy02 * dv01 - dy01 * dv02) * texelPerSpan);
    gradient.zPerRow = f((dz01 * dx02 - dz02 * dx01) * -inverse);
    gradient.uPerRow = f((du01 * dx02 - du02 * dx01) * negativeTexel);
    gradient.vPerRow = f((dv01 * dx02 - dv02 * dx01) * negativeTexel);
    gradient.isValid = true;
  }

  const x0 = Math.trunc(v0[X]);
  const x1 = Math.trunc(v1[X]);
  const x2 = Math.trunc(v2[X]);
  const totalRows = topRows + bottomRows;
  const dxLong = x2 - x0;
  const dxTop = x1 - x0;
  const dxBottom = f(dxLong - dxTop);
  const perTotalRow = f(1 / totalRows);
  const longSlope = edgeSlope(dxLong * perTotalRow);

  // Per-scanline steps of 1/z, u/z and v/z down the left edge, for the top and bottom sections.
  const leftStep = new Float32Array(6);
  const setLeftStep = (at, dx, rows, perRow) => {
    const spans = f(dx * 0.0625);
    leftStep[at] = (spans * gradient.zPerSpan + rows * gradient.zPerRow) * perRow;
    leftStep[at + 1] = (spans * gradient.uPerSpan + rows * gradient.uPerRow) * perRow;
    leftStep[at + 2] = (spans * gradient.vPerSpan + rows * gradient.vPerRow) * perRow;
  };
  const TOP = 0;
  const BOTTOM = 3;

  let left = x0 + y0 * WIDTH;
  let right = left;
  let leftSlopeTop = longSlope;
  let leftSlopeBottom = longSlope;
  let rightSlopeTop = longSlope;
  let rightSlopeBottom = longSlope;

  if (topRows !== 0) {
    const perTopRow = f(1 / topRows);
    const topSlope = edgeSlope(dxTop * perTopRow);
    if (longSlope < topSlope) {
      // The long edge is on the left.
      rightSlopeTop = topSlope;
      if (bottomRows !== 0) {
        rightSlopeBottom = edgeSlope(dxBottom / bottomRows);
      }
      setLeftStep(BOTTOM, dxLong, totalRows, perTotalRow);
      leftStep.copyWithin(TOP, BOTTOM, BOTTOM + 3);
    } else {
      setLeftStep(TOP, dxTop, topRows, perTopRow);
      leftSlopeTop = topSlope;
      if (bottomRows !== 0) {
        const perBottomRow = f(1 / bottomRows);
        setLeftStep(BOTTOM, dxBottom, bottomRows, perBottomRow);
        leftSlopeBottom = edgeSlope(dxBottom * perBottomRow);
      }
    }
  } else {
    // Flat top: v0 is its left end, v1 its right end.
    setLeftStep(BOTTOM, dxLong, totalRows, perTotalRow);
    leftStep.copyWithin(TOP, BOTTOM, BOTTOM + 3);
    right = y0 * WIDTH + x1;
    rightSlopeBottom = edgeSlope(dxBottom / bottomRows);
  }

  const block = trapezoids;
  block.left = left;
  block.right = right;
  block.leftStep1 = leftSlopeTop;
  block.leftStep2 = leftSlopeBottom;
  block.rightStep1 = rightSlopeTop;
  block.rightStep2 = rightSlopeBottom;
  block.zPerSpan = gradient.zPerSpan;
  block.uPerSpan = gradient.uPerSpan;
  block.vPerSpan = gradient.vPerSpan;
  block.zPerRow1 = leftStep[TOP];
  block.uPerRow1 = leftStep[TOP + 1];
  block.vPerRow1 = leftStep[TOP + 2];
  block.zPerRow2 = leftStep[BOTTOM];
  block.uPerRow2 = leftStep[BOTTOM + 1];
  block.vPerRow2 = leftStep[BOTTOM + 2];
  block.z = v0[Z];
  block.u = f(256 * v0[U]);
  block.v = f(v0[V] * 256);
  block.rows1 = topRows;
  block.rows2 = bottomRows;
  if (blendTable !== null && trimsSharedEdges) {
    // The translucent variant leaves out the right edge pixel and the last row of a flat bottom,
    // so that shared edges are not blended twice.
    block.right -= 1;
  } else if (bottomRows === 0) {
    block.rows1++;
  }
  fillTrapezoids(view.target, texture, blendTable, block);
}

function drawPiece(a, b, c, stage, depth) {
  const own = scratch[depth];
  const points = [a, b, c];
  if (stage === STAGE_FULL && !clipNearAndProject(points, own, depth)) {
    return;
  }
  if (stage < STAGE_CLIP_Y && !clipToScreen(points, own, X, WIDTH, STAGE_CLIP_Y, depth)) {
    return;
  }
  if (stage < STAGE_DRAW && !clipToScreen(points, own, Y, HEIGHT, STAGE_DRAW, depth)) {
    return;
  }
  emit(points[0], points[1], points[2]);
}

const corners = [0, 1, 2].map(() => ({ x: 0, y: 0, u: 0, v: 0 }));

/** Whole pixels and whole texels from here on: texture mapping is affine inside the triangle. */
function toIntegerCorner(corner, vertex) {
  corner.x = Math.trunc(vertex[X]);
  corner.y = Math.trunc(vertex[Y]);
  corner.u = Math.trunc(vertex[U] + 0.5) & 0xffff;
  corner.v = Math.trunc(vertex[V] + 0.5) & 0xffff;
}

function emitAffine(a, b, c) {
  toIntegerCorner(corners[0], a);
  toIntegerCorner(corners[1], b);
  toIntegerCorner(corners[2], c);
  fillAffineTriangle(view.target, texture, corners[0], corners[1], corners[2], AFFINE_OPAQUE);
}

/**
 * Draw one triangle given in view space with a perspective-correct texture. 0x27670; with a
 * table, 0x29510.
 * @param {Float32Array} a x, y, z, u, v with u and v in texels (256 = the texture's width)
 * @param {Float32Array} b
 * @param {Float32Array} c
 * @param {Uint8Array} texels 256x256 palette indices
 * @param {Uint8Array|null} table null to store texels as they are, or a 64K table for
 *   screen = table[texel << 8 | screen]
 * @param {boolean} trimShared with a table: leave out the right edge and a flat bottom's last row
 */
export function drawPerspectiveTriangle(a, b, c, texels, table = null, trimShared = true) {
  texture = texels;
  blendTable = table;
  trimsSharedEdges = trimShared;
  isAffine = false;
  emit = rasterise;
  gradient.isValid = false;
  drawPiece(a, b, c, STAGE_FULL, 0);
}

/**
 * Same clipping, but the texture is mapped affinely between the clipped corners: cheaper, and
 * what most objects use. 0x24b54. (Its integer x clipper, 0x23cf0, never has anything to do
 * after the float clip and is left out.)
 */
export function drawAffineTriangle(a, b, c, texels) {
  texture = texels;
  isAffine = true;
  emit = emitAffine;
  drawPiece(a, b, c, STAGE_FULL, 0);
}
