// Part 12's material 0, the bump-mapped "flesh" band of the tube: draw routine 0x19160 with the
// extruder 0x18c5c and the transparent affine mapper 0x33ae0, plus the bump table init builds
// (loop 0x19c9e). Each triangle is turned so that the screen direction of its face normal points
// along +x of a 256x256 scratch image; there every texel of the height map H becomes a run of pixels
// ("spike") along x, shaded through the part's 0xfd0a0 table by a light map bent by the bump table.
// The scratch image is then mapped back onto the screen, turned back, as two triangles with colour 0
// transparent. The scratch keeps whatever a triangle does not clear (sic). The row tables come from
// the engine's triangle setup 0x437c4 / 0x43cf8 with the rows clipped to 0..255 ([0x89f50] /
// [0x89f54], set by init 0x19ae0). See docs/disassembly/P12_tunnel.md §6.

import {
  V, VERTEX_INTS, SLOT_INTS, S, createTriangleVertices, setupTriangle, rasterTemplate, packedChannel,
  packedIndex, clippedSpan, sortSlotsByY,
} from '../engine/index.js';

const imul = Math.imul;
const SCRATCH_SIZE = 256;
const SCRATCH_BYTES = SCRATCH_SIZE * SCRATCH_SIZE;
/** [0xd3774] = [0xd3768] + 0x8000: writes left of column 0 land in the row above (or before row 0). */
const SCRATCH_MARGIN = 0x8000;
const SCRATCH_BLOCK = 0x20000;
const SCRATCH_CENTRE = 0x80;
const SCRATCH_LAST = 255;
/** obj2 0x71054: 1024 steps per turn, cosine 256 entries on. */
const QUARTER_TURN = 256;
const ANGLE_MASK = 0x3ff;
const ANGLES_PER_PI = 512;
/** A face whose normal's screen direction is this short and points away is skipped. */
const FACING_LIMIT = 0x4000;
/** Big triangles are drawn at 1/2 or 1/4 scale in the scratch: [0x81258] / [0x81254] shifts. */
const HALF_SCALE_ABOVE = 0x80;
const QUARTER_SCALE_ABOVE = 0x100;
const SHIFTS = { full: [10, 10], half: [9, 11], quarter: [8, 12] };
/** Spikes: lut[i] = i * (spike / 6); 64 samples per row of the scratch. */
const SPIKE_DIVISOR = 6;
const SAMPLES_PER_ROW = 64;
const SAMPLE_SHIFT = 6;
const NORMAL_BIAS = 0x100;
const SCREEN_RIGHT = 319;
const SCREEN_BOTTOM = 199;
const BUMP_SIZE = 256;
const BUMP_X_SHIFT = 9;
const BUMP_STEP = 2;

/**
 * Loop 0x19c9e: B[y*256+x] = ((h(y,x) - h(y,x+2)) << 9) + 2*(h(y,x) - h(y+2,x)) with h the signed
 * bytes of hy_bukt.raw (256 wide, wrapping). Rows 128..255 of h read past the 128-row file into the
 * next heap block, which is empty at init: 0 here.
 */
export function buildBumpTable(heights) {
  const h = (y, x) => {
    const at = (y & (BUMP_SIZE - 1)) * BUMP_SIZE + (x & (BUMP_SIZE - 1));
    return at < heights.length ? (heights[at] << 24) >> 24 : 0;
  };
  const table = new Int32Array(BUMP_SIZE * BUMP_SIZE);
  for (let y = 0; y < BUMP_SIZE; y++) {
    for (let x = 0; x < BUMP_SIZE; x++) {
      const here = h(y, x);
      table[y * BUMP_SIZE + x] = ((here - h(y, x + BUMP_STEP)) << BUMP_X_SHIFT) + BUMP_STEP * (here - h(y + BUMP_STEP, x));
    }
  }
  return table;
}

/**
 * The state the original keeps in globals: the scratch image [0xd3774], the four corner records at
 * 0xd2568 (+0x40 each, triangle-engine layout), the triangle engine with its row tables, the
 * 1024-step sine table (obj2 0x71054) and the bump table [0xd3758].
 */
export function createFleshRenderer(engine, sine, bumps) {
  return {
    engine,
    sine,
    bumps,
    scratchBlock: new Uint8Array(SCRATCH_BLOCK),
    scratch: null,
    corners: createTriangleVertices(4),
  };
}

function scratchOf(flesh) {
  flesh.scratch ??= flesh.scratchBlock.subarray(SCRATCH_MARGIN, SCRATCH_MARGIN + SCRATCH_BYTES);
  return flesh.scratch;
}

function clamp(value, low, high) {
  return value > high ? high : value < low ? low : value;
}

/** The scale of the scratch image for a triangle w x h pixels on screen: [inverse shift, forward shift]. */
function scratchShifts(width, height) {
  if (width > HALF_SCALE_ABOVE || height > HALF_SCALE_ABOVE) {
    return width > QUARTER_SCALE_ABOVE || height > QUARTER_SCALE_ABOVE ? SHIFTS.quarter : SHIFTS.half;
  }
  return SHIFTS.full;
}

/** fpatan * 512.0 / pi (x87 extended), fistp (nearest, ties to even), & 0x3ff. */
function normalAngle(nx, ny) {
  const turned = (Math.atan2(ny, nx) * ANGLES_PER_PI) / Math.PI;
  const r = Math.round(turned);
  const nearest = r - turned === 0.5 && r % 2 !== 0 ? r - 1 : r;
  return nearest & ANGLE_MASK;
}

/** C's int division (idiv). */
function idiv(a, b) {
  return (a / b) | 0;
}

/** 0x19160(poly): material 0's draw routine. */
export function drawFlesh(flesh, polygon, context) {
  const n = context.faceNormals;
  const at = polygon.normal * 3;
  const [nx, ny, nz] = [n[at], n[at + 1], n[at + 2]];
  if (Math.abs(nx) < FACING_LIMIT && Math.abs(ny) < FACING_LIMIT && nz > 0) {
    return;
  }
  const vertices = context.vertices;
  const ids = [0, 1, 2].map((k) => polygon.slots[k * SLOT_INTS + S.VERTEX] * VERTEX_INTS);
  const xs = ids.map((v) => vertices[v + V.SX]);
  const ys = ids.map((v) => vertices[v + V.SY]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (minX > SCREEN_RIGHT || maxX < 0 || minY > SCREEN_BOTTOM || maxY < 0) {
    return;
  }
  const cx = (maxX + minX + 1) >> 1;
  const cy = (minY + maxY + 1) >> 1;
  const [inverseShift, forwardShift] = scratchShifts(maxX - minX, maxY - minY);
  const angle = normalAngle(nx, ny);
  const sine = flesh.sine[angle];
  const cosine = flesh.sine[angle + QUARTER_TURN];
  const rounding = 1 << (forwardShift - 1);
  const c = flesh.corners;
  for (let k = 0; k < 3; k++) {
    const dx = xs[k] - cx;
    const dy = ys[k] - cy;
    c.sx[k] = ((imul(dx, cosine) - imul(dy, sine) + rounding) >> forwardShift) + SCRATCH_CENTRE;
    c.sy[k] = ((imul(dx, sine) + imul(dy, cosine) + rounding) >> forwardShift) + SCRATCH_CENTRE;
    c.rz[k] = vertices[ids[k] + V.Z];
    c.row[k] = polygon.slots[k * SLOT_INTS + S.U];
    c.column[k] = polygon.slots[k * SLOT_INTS + S.V];
    c.extra0[k] = (vertices[ids[k] + V.NX] + NORMAL_BIAS) >> 1;
    c.extra1[k] = (vertices[ids[k] + V.NY] + NORMAL_BIAS) >> 1;
  }
  const depth = polygon.key !== 0 ? polygon.key : 1;
  const a = idiv(nx << 2, depth);
  const b = idiv(-(ny << 2) | 0, depth);
  const spike = (imul(a, cosine) - imul(b, sine)) >> forwardShift;
  const { texture, phongMap, heightMap } = polygon.material;
  extrude(flesh, context.colourTable, spike, heightMap, texture, phongMap);
  for (let k = 0; k < 4; k++) {
    const u = c.row[k];
    const v = c.column[k];
    c.sy[k] = ((imul(cosine, u) - imul(v, sine) + rounding) >> inverseShift) + cy;
    c.sx[k] = ((imul(sine, u) + imul(v, cosine) + rounding) >> inverseShift) + cx;
    c.column[k] = v + SCRATCH_CENTRE;
    c.row[k] = u + SCRATCH_CENTRE;
  }
  const scratch = scratchOf(flesh);
  drawTransparentTriangle(c, [0, 1, 2], scratch, context.target);
  drawTransparentTriangle(c, [0, 2, 3], scratch, context.target);
}

/**
 * 0x18c5c Extrude(H, C, Ph): scan-convert corners 0..2 with 0x437c4, then per scratch row walk 64
 * samples from the nearer edge to the farther one; each sample's spike reaches
 * ((lut[H] + X) >> 8) + 1 and is filled back to the furthest point so far. Sets corners 0..3 to the
 * rectangle the rows covered (in scratch coordinates around the centre) and clears past the tips.
 */
function extrude(flesh, shade, spike, heights, colours, lightMap) {
  const { engine, bumps } = flesh;
  const scratchBlock = flesh.scratchBlock;
  const c = flesh.corners;
  const step = idiv(spike, SPIKE_DIVISOR);
  setupTriangle(engine, c, 0, 1, 2, true);
  const middle = (engine.top + engine.bottom) >> 1;
  const isLeftNearer = !(engine.left.a4[middle] > engine.right.a4[middle]);
  const start = isLeftNearer ? engine.left : engine.right;
  const end = isLeftNearer ? engine.right : engine.left;
  let furthest = 0;
  for (let row = engine.top; row < engine.bottom; row++) {
    const line = SCRATCH_MARGIN + (row << 8);
    const dX = ((end.x[row] - start.x[row]) << 8) >> SAMPLE_SHIFT;
    let u = start.row[row];
    let v = start.column[row];
    let pu = start.a10[row];
    let pv = start.a14[row];
    const du = (end.row[row] - u) >> SAMPLE_SHIFT;
    const dv = (end.column[row] - v) >> SAMPLE_SHIFT;
    const dpu = (end.a10[row] - pu) >> SAMPLE_SHIFT;
    const dpv = (end.a14[row] - pv) >> SAMPLE_SHIFT;
    const x0 = clamp(start.x[row], 0, SCRATCH_LAST);
    for (let x = engine.minX; x < x0; x++) {
      scratchBlock[line + x] = 0;
    }
    let X = x0 << 8;
    for (let k = 0; k < SAMPLES_PER_ROW; k++) {
      const index = (v & 0xff00) + (u >> 8);
      const tip = clamp(((imul(heights[index] ?? 0, step) + X) >> 8) + 1, 0, SCRATCH_LAST);
      const reached = start.x[row];
      if (tip > reached) {
        const from = clamp(reached, 0, SCRATCH_LAST);
        start.x[row] = tip;
        const light = lightMap[(((pv & 0xff00) | ((pu >> 8) & 0xff)) + (bumps[index] ?? 0)) & 0xffff];
        const pixel = shade[(light << 8) + (colours[index] ?? 0)];
        for (let x = tip; x >= from; x--) {
          scratchBlock[line + x] = pixel;
        }
      }
      X = (X + dX) | 0;
      u = (u + du) | 0;
      v = (v + dv) | 0;
      pu = (pu + dpu) | 0;
      pv = (pv + dpv) | 0;
    }
    furthest = Math.max(furthest, start.x[row]);
  }
  c.column[0] = engine.minX - SCRATCH_CENTRE;
  c.row[0] = engine.top - (SCRATCH_CENTRE - 1);
  c.column[1] = c.column[0];
  c.row[1] = engine.bottom - (SCRATCH_CENTRE + 1);
  c.column[2] = furthest - SCRATCH_CENTRE;
  c.row[2] = c.row[1];
  c.column[3] = c.column[2];
  c.row[3] = c.row[0];
  for (let row = engine.top; row < engine.bottom; row++) {
    const line = SCRATCH_MARGIN + (row << 8);
    for (let x = start.x[row]; x <= furthest; x++) {
      scratchBlock[line + x] = 0;
    }
  }
}

/**
 * 0x33ae0(a, b, c, texture): the 0x331b4 triangle template on triangle-engine records (+0x18 x,
 * +0x1c y, texel (row +0x20, column +0x24)), spans 0x4fdf7 / 0x4fe29 skipping colour 0.
 */
function drawTransparentTriangle(c, ids, texture, target) {
  const order = sortSlotsByY(c.sy[ids[0]], c.sy[ids[1]], c.sy[ids[2]]).map((k) => ids[k]);
  const triangle = { order, xs: order.map((k) => c.sx[k]), ys: order.map((k) => c.sy[k]) };
  const uv = order.flatMap((k) => [c.column[k] << 8, c.row[k] << 8]);
  rasterTemplate(triangle, [packedChannel(...uv)],
    (y, xLong, xShort, isLongLeft, values, dx) => clippedSpan(y, xLong, xShort, isLongLeft, values, dx,
      (at, value) => {
        const texel = texture[packedIndex(value[0])];
        if (texel !== 0) {
          target[at] = texel;
        }
      }),
    { rejectBox: (x) => Math.max(...x) < 0 || Math.min(...x) >= 320 });
}
