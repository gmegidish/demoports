// The 40x25 vertex grid the film parts bend (0x10305a, 0x102fe9, 0x1032ac, 0x10334a, 0x1033eb;
// docs/disassembly/B_mesh.md).
//
// 0x10305a allocates three blocks: the grid's points (x, y, z: 12 bytes each, x -160..152 and y -100..92 in steps
// of 8, z 0x200), the screen vertices the triangle fillers read (x, y, u, v, s: 20 bytes each; u, v the texture
// coordinates of the point, s the shade) and the triangles (3 vertex indices each, two per grid cell). It also
// fills the sine and cosine tables at 0x16f710 and 0x16fb10 (256 entries, amplitude 200) the parts bend z with.
// A part moves z (and s), projects the points (perspective divide by z) and fills every triangle.

/** @typedef {import('../machine.js').Machine} Machine */
/** @typedef {import('./triangles.js').TriangleVariant} TriangleVariant */

import { fillTriangle } from './triangles.js';

/** Pointers to the three blocks, and the triangle count. */
export const POINTS = 0x16f704;
export const VERTICES = 0x16f708;
export const TRIANGLES = 0x16f70c;
export const TRIANGLE_COUNT = 0x16ff10;
/** 256 int32 sines and cosines of i * pi / 128. */
export const SINES = 0x16f710;
export const COSINES = 0x16fb10;

export const COLUMNS = 40;
export const ROWS = 25;
export const POINT_BYTES = 0xc;
export const VERTEX_BYTES = 0x14;
const TRIANGLE_BYTES = 0xc;
const GRID_STEP = 8;
const LEFT = -160;
const TOP = -100;
const DEPTH = 0x200;
/** The perspective: x << 9 / z, centred on (160, 100). */
const PROJECTION_SHIFT = 9;
const CENTRE_X = 0xa0;
const CENTRE_Y = 0x64;
const INITIAL_SHADE = 0x80;
const TABLE_AMPLITUDE = 200;

/**
 * Fills SINES and COSINES with trunc(sin(i * pi / 128) * amplitude), trunc(cos(...) * amplitude)
 * (0x10323c; part 5 refills them with 170 at 0x10395b).
 */
export function fillSineTables(m, amplitude) {
  for (let i = 0; i < 0x100; i++) {
    const angle = i * Math.PI * 0.0078125;
    m.set32(SINES + i * 4, Math.trunc(Math.sin(angle) * amplitude));
    m.set32(COSINES + i * 4, Math.trunc(Math.cos(angle) * amplitude));
  }
}

/**
 * 0x10305a: allocates and fills the grid. `isVShrunk` (eax) picks v = (y + 100) / 1.28 instead of * 1.28.
 * @param {Machine} m
 */
export function buildMesh(m, isVShrunk = false) {
  const points = m.malloc(COLUMNS * ROWS * POINT_BYTES);
  const vertices = m.malloc(COLUMNS * ROWS * VERTEX_BYTES);
  const triangles = m.malloc(0x5dc0);
  m.set32(POINTS, points);
  m.set32(VERTICES, vertices);
  m.set32(TRIANGLES, triangles);
  let i = 0;
  for (let y = TOP; y < -TOP; y += GRID_STEP) {
    for (let x = LEFT; x < -LEFT; x += GRID_STEP, i++) {
      const point = points + i * POINT_BYTES;
      const vertex = vertices + i * VERTEX_BYTES;
      m.set32(point, x);
      m.set32(point + 4, y);
      m.set32(point + 8, DEPTH);
      m.set32(vertex + 8, Math.trunc((x + m.f64(0x1273b4)) * m.f64(0x12738c)));
      const v = isVShrunk ? (y + m.f64(0x1273bc)) / m.f64(0x127394) : (y + m.f64(0x1273bc)) * m.f64(0x127394);
      m.set32(vertex + 0xc, Math.trunc(v));
      m.set32(vertex + 0x10, INITIAL_SHADE);
    }
  }
  let count = 0;
  for (let row = 0; row < ROWS - 1; row++) {
    for (let column = 0; column < COLUMNS - 1; column++) {
      const corner = row * COLUMNS + column;
      const corners = [
        [corner, corner + 1, corner + COLUMNS],
        [corner + 1, corner + COLUMNS + 1, corner + COLUMNS],
      ];
      for (const triangle of corners) {
        for (let k = 0; k < 3; k++) {
          m.set32(triangles + count * TRIANGLE_BYTES + k * 4, triangle[k]);
        }
        count++;
      }
    }
  }
  m.set32(TRIANGLE_COUNT, count);
  fillSineTables(m, TABLE_AMPLITUDE);
}

/** 0x102fe9: scales every point's x and y by `factor` (a float32), truncated. */
export function scaleMesh(m, factor) {
  const points = m.u32(POINTS);
  const f = Math.fround(factor);
  for (let i = 0; i < COLUMNS * ROWS; i++) {
    const point = points + i * POINT_BYTES;
    m.set32(point, Math.trunc(m.s32(point) * f));
    m.set32(point + 4, Math.trunc(m.s32(point + 4) * f));
  }
}

function project(m, xOffset, yOffset) {
  const points = m.u32(POINTS);
  const vertices = m.u32(VERTICES);
  for (let i = 0; i < COLUMNS * ROWS; i++) {
    const point = points + i * POINT_BYTES;
    const vertex = vertices + i * VERTEX_BYTES;
    const z = m.s32(point + 8);
    const x = (m.s32(point) + xOffset) << PROJECTION_SHIFT;
    const y = (m.s32(point + 4) + yOffset) << PROJECTION_SHIFT;
    m.set32(vertex, (z === 0 ? x : Math.trunc(x / z)) + CENTRE_X);
    m.set32(vertex + 4, (z === 0 ? y : Math.trunc(y / z)) + CENTRE_Y);
  }
}

/** 0x1032ac: projects the points to the screen vertices, the grid moved down by `yOffset`. */
export function projectMesh(m, yOffset) {
  project(m, 0, yOffset);
}

/** 0x10334a: as 0x1032ac, the grid moved right by `xOffset`. */
export function projectMeshMovedRight(m, xOffset) {
  project(m, xOffset, 0);
}

/** The parts' triangle loop: every triangle of the grid into `dest` from `texture`. */
export function drawMesh(m, variant, dest, texture) {
  const vertices = m.u32(VERTICES);
  const triangles = m.u32(TRIANGLES);
  const count = m.s32(TRIANGLE_COUNT);
  for (let i = 0; i < count; i++) {
    const triangle = triangles + i * TRIANGLE_BYTES;
    fillTriangle(
      m,
      variant,
      vertices + m.s32(triangle) * VERTEX_BYTES,
      vertices + m.s32(triangle + 4) * VERTEX_BYTES,
      vertices + m.s32(triangle + 8) * VERTEX_BYTES,
      dest,
      texture,
    );
  }
}

/**
 * The parts' wave: z of point (column, row) = SINES[(start + column * columnStep) & 255] + depth +
 * SINES[(rowStart + row * rowStep) & 255], and its vertex's shade from z. Parts 5 and 13 inline this with
 * different steps and shades (`shadeOf(z - depth)`).
 */
export function waveMesh(m, { start, columnStep, rowStart, rowStep, depth, shadeOf }) {
  const points = m.u32(POINTS);
  const vertices = m.u32(VERTICES);
  for (let row = 0; row < ROWS; row++) {
    const rowSine = m.s32(SINES + ((rowStart + row * rowStep) & 0xff) * 4);
    for (let column = 0; column < COLUMNS; column++) {
      const i = row * COLUMNS + column;
      const z = (m.s32(SINES + ((start + column * columnStep) & 0xff) * 4) + depth + rowSine) | 0;
      m.set32(points + i * POINT_BYTES + 8, z);
      m.set32(vertices + i * VERTEX_BYTES + 0x10, shadeOf(z - depth));
    }
  }
}
