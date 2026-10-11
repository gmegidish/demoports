// Part 10's cloth: a 16x16 mass-spring grid (the Cloth object, ctor 0x14390, step 0x14730) draped
// over an invisible 8x8 table (BuildCloth 0x13a60), and the mesh the engine draws from it
// (UpdateCloth 0x13df0: points, face normals, corner normals). Every value the original stores is
// float32; the intermediates between stores are kept in double (x87 extended): this matched the
// original run in unicorn bit for bit, and reproduces demo.avi pixel for pixel after ~800 steps,
// where rounding every intermediate to 24 bits (main's precision control) drifts visibly.
// See docs/disassembly/P10_room.md §3.

import { roundToEven } from '../engine/index.js';

const f32 = Math.fround;
export const GRID = 16;
const PARTICLES = GRID * GRID;
const CENTRE = 8;
/** cl_heigh.raw: 0x20 = free, anything else pins the particle at height (32 - h) / 20. */
const FREE_HEIGHT = 0x20;
const HEIGHT_TOP = 32.0;
const HEIGHT_DIVISOR = 20.0;
/** The part's parameters (init 0x13128), set through 0x1576c..0x157cc. */
const PARAMETERS = { k0: 1.0, k1: 0.1, k2: 0.1, step: 0.99, mass: 2.0, gravity: 0.0015, drag: 0.02 };
/** (dr, dc, stiffness, rest length), in the order 0x14730 sums them. */
const SPRINGS = [
  [-1, 0, 'k0', 1], [1, 0, 'k0', 1], [0, -1, 'k0', 1], [0, 1, 'k0', 1],
  [-2, 0, 'k1', 2], [2, 0, 'k1', 2], [0, -2, 'k1', 2], [0, 2, 'k1', 2],
  [-1, -1, 'k2', Math.SQRT2], [1, -1, 'k2', Math.SQRT2], [-1, 1, 'k2', Math.SQRT2], [1, 1, 'k2', Math.SQRT2],
];
/** Grid spacing 1.0 becomes 512 * 0.0625 = 32 mesh units. */
const MESH_SCALE = 32;
const NORMAL_SCALE = 255;
const CELLS = GRID - 1;
export const TRIANGLES = CELLS * CELLS * 2;
const FACE_INTS = 12;

function vec3s(count) {
  return new Float32Array(count * 3);
}

/** 0x14390 + 0x13a60: the grid in its plane, the table block pinned above it. */
export function createCloth(heights) {
  const cloth = {
    next: vec3s(PARTICLES),
    position: vec3s(PARTICLES),
    velocity: vec3s(PARTICLES),
    external: vec3s(PARTICLES),
    isPinned: new Uint8Array(PARTICLES),
    parameters: Object.fromEntries(Object.entries(PARAMETERS).map(([k, v]) => [k, f32(v)])),
  };
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const i = r * GRID + c;
      cloth.position[3 * i] = c - CENTRE;
      cloth.position[3 * i + 1] = r - CENTRE;
      const h = heights[i];
      if (h !== FREE_HEIGHT) {
        cloth.isPinned[i] = 1;
        cloth.position[3 * i + 2] = (HEIGHT_TOP - h) / HEIGHT_DIVISOR;
      }
    }
  }
  return cloth;
}

/** 0x15814: the external force (wind) on particle (r, c). */
export function setExternalForce(cloth, r, c, force) {
  cloth.external.set(force, 3 * (r * GRID + c));
}

/** The sum of the spring forces on particle (r, c); each product and sum stored as float32. */
function springForce(cloth, r, c, force) {
  const p = cloth.position;
  const i = 3 * (r * GRID + c);
  const d = [0, 0, 0];
  for (const [dr, dc, stiffness, rest] of SPRINGS) {
    const r2 = r + dr;
    const c2 = c + dc;
    if (r2 < 0 || r2 >= GRID || c2 < 0 || c2 >= GRID) {
      continue;
    }
    const j = 3 * (r2 * GRID + c2);
    for (let t = 0; t < 3; t++) {
      d[t] = f32(p[j + t] - p[i + t]);
    }
    const length = f32(Math.sqrt(d[1] * d[1] + d[0] * d[0] + d[2] * d[2]));
    const stretch = (length - rest) * cloth.parameters[stiffness];
    for (let t = 0; t < 3; t++) {
      force[t] = f32(force[t] + f32(f32(d[t] / length) * stretch));
    }
  }
}

/** 0x14730: one explicit step, all forces from the current positions, then positions = next. */
export function stepCloth(cloth) {
  const { position, next, velocity, external } = cloth;
  const { step, mass, gravity, drag } = cloth.parameters;
  const force = [0, 0, 0];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const i = 3 * (r * GRID + c);
      next.set(position.subarray(i, i + 3), i);
      if (cloth.isPinned[r * GRID + c]) {
        continue;
      }
      force.fill(0);
      springForce(cloth, r, c, force);
      for (let t = 0; t < 3; t++) {
        force[t] = f32(force[t] + external[i + t]);
        force[t] = f32(force[t] - f32(velocity[i + t] * drag));
        force[t] = f32(force[t] / mass);
      }
      force[2] = f32(force[2] + gravity);
      for (let t = 0; t < 3; t++) {
        velocity[i + t] = f32(velocity[i + t] + f32(force[t] * step));
        next[i + t] = f32(next[i + t] + f32(velocity[i + t] * step));
      }
    }
  }
  position.set(next);
}

/** 0x13df0's step count for `ticks` since the previous pass: (ticks + 1) >> 1. */
export function stepsForTicks(ticks) {
  return (ticks + 1) >> 1;
}

function textureCoordinate(n) {
  return (n * 255) >> 4;
}

/**
 * 0x13a60's polygons: two triangles per grid cell, vertex r*16+c, the first texture coordinate
 * along the column; 12 ints per face (type, material, face normal, a, b, c, u0, v0, u1, v1, u2, v2).
 */
export function clothFaces() {
  const faces = new Int32Array(TRIANGLES * FACE_INTS);
  const vertex = (r, c) => r * GRID + c;
  let f = 0;
  for (let a = 0; a < CELLS; a++) {
    for (let b = 0; b < CELLS; b++) {
      const [u0, u1, v0, v1] = [textureCoordinate(a), textureCoordinate(a + 1), textureCoordinate(b), textureCoordinate(b + 1)];
      faces.set([0, 0, -1, vertex(b, a), vertex(b, a + 1), vertex(b + 1, a), u0, v0, u1, v0, u0, v1], f);
      faces.set([0, 0, -1, vertex(b, a + 1), vertex(b + 1, a + 1), vertex(b + 1, a), u1, v0, u1, v1, u0, v1], f + FACE_INTS);
      f += 2 * FACE_INTS;
    }
  }
  return faces;
}

/** The mesh points: position * 512 * 0.0625, rounded half to even (fistp). */
function updatePoints(cloth, points) {
  for (let k = 0; k < PARTICLES * 3; k++) {
    points[k] = roundToEven(cloth.position[k] * MESH_SCALE);
  }
}

/** Unnormalised face normals (e1 x e2 of the int points) as float32, and *255 as ints. */
function updateFaceNormals(points, faces, floatNormals, faceNormals) {
  for (let f = 0; f < TRIANGLES; f++) {
    const [a, b, c] = [faces[f * FACE_INTS + 3], faces[f * FACE_INTS + 4], faces[f * FACE_INTS + 5]];
    const e1 = [0, 1, 2].map((t) => points[3 * b + t] - points[3 * a + t]);
    const e2 = [0, 1, 2].map((t) => points[3 * c + t] - points[3 * a + t]);
    floatNormals[3 * f] = e1[1] * e2[2] - e1[2] * e2[1];
    floatNormals[3 * f + 1] = e1[2] * e2[0] - e1[0] * e2[2];
    floatNormals[3 * f + 2] = e1[0] * e2[1] - e1[1] * e2[0];
    for (let t = 0; t < 3; t++) {
      faceNormals[3 * f + t] = roundToEven(floatNormals[3 * f + t] * NORMAL_SCALE);
    }
  }
}

/**
 * Corner normals: the float32 sum of the face normals around each vertex, normalised (stored back
 * as float32) and *255; x is rounded from the unstored quotient, y and z from the stored ones.
 */
function updateCornerNormals(faces, floatNormals, cornerNormals) {
  const sums = vec3s(PARTICLES);
  for (let f = 0; f < TRIANGLES; f++) {
    for (let k = 0; k < 3; k++) {
      const v = faces[f * FACE_INTS + 3 + k];
      for (let t = 0; t < 3; t++) {
        sums[3 * v + t] = f32(sums[3 * v + t] + floatNormals[3 * f + t]);
      }
    }
  }
  for (let v = PARTICLES - 1; v >= 0; v--) {
    const [x, y, z] = sums.subarray(3 * v, 3 * v + 3);
    const length = Math.sqrt(y * y + x * x + z * z);
    cornerNormals[3 * v] = roundToEven((x / length) * NORMAL_SCALE);
    cornerNormals[3 * v + 1] = roundToEven(f32(y / length) * NORMAL_SCALE);
    cornerNormals[3 * v + 2] = roundToEven(f32(z / length) * NORMAL_SCALE);
  }
}

/** The mesh half of 0x13df0 (after its steps), into the engine object's arrays. */
export function updateClothMesh(cloth, object) {
  const floatNormals = vec3s(TRIANGLES);
  updatePoints(cloth, object.points);
  updateFaceNormals(object.points, object.faces, floatNormals, object.faceNormals);
  updateCornerNormals(object.faces, floatNormals, object.cornerNormals);
}
