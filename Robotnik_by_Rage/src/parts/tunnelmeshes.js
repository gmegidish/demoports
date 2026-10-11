// Part 12's geometry, all built in code: the tunnel segment (0x17e04 on a copy of the template
// 0x817a4), the chrome sphere (0x17ae0), the "bucket" tube (0x177a0), the pod root's static spikes
// (0x81588), and the normals they get: corner normals 0x17584 (face normals by 0x24b4c summed per
// vertex) and face normals 0x24d58 (0x247d4). See docs/disassembly/P12_tunnel.md §2.4-2.8.

import { createObject, staticObject } from '../engine/index.js';
import { sin, cos } from '../sine.js';

const RING_POINTS = 8;
/** One step of the 8 lathe directions: 64 of the 512-per-turn sine. */
const DIRECTION_STEP = 64;
const POINT_FACE_TYPE = 0;
const NO_NORMAL = -1;

/** Corner normals are 256 long; the tube's face normals 65536, the pod's 256. */
export const NORMAL_LENGTH = 256;
export const TUBE_FACE_NORMAL_LENGTH = 65536;

/** Object flags (+0x84) init gives each mesh (E2 §1.4). */
export const POD_FLAGS = 0x1208;
export const SPHERE_FLAGS = 0x1208;
export const TUBE_FLAGS = 0x120c;
export const SEGMENT_FLAGS = 0x208;

const POD_ADDRESS = 0x81588;

/** Material numbers (P12 §2.3). */
export const MATERIAL = { FLESH: 0, TUBE_END: 1, PHONG: 2, WALL: 3, SPIKE: 4, IRIS: 5, CHROME: 6 };

function face(material, normal, a, b, c, uvs) {
  return [POINT_FACE_TYPE, material, normal, a, b, c, ...uvs];
}

/** Point r of ring k: index 8k + (j & 7). */
function ringPoint(k, j) {
  return RING_POINTS * k + (j & (RING_POINTS - 1));
}

/** The two faces of band b, direction j (P12 §2.4), with the uv triples of each. */
function bandFaces(b, j, material, normals, evenUvs, oddUvs) {
  const j1 = j + 1;
  return [
    face(material, normals[0], ringPoint(b, j), ringPoint(b, j1), ringPoint(b + 1, j1), evenUvs),
    face(material, normals[1], ringPoint(b, j), ringPoint(b + 1, j1), ringPoint(b + 1, j), oddUvs),
  ];
}

/** A ring of 8 points around the z axis: ((dx*s) >> shift, (dy*s) >> shift, z). */
function ring(radius, z, scale, shift) {
  const points = [];
  for (let j = 0; j < RING_POINTS; j++) {
    const dx = scale * cos(DIRECTION_STEP * j);
    const dy = scale * sin(DIRECTION_STEP * j);
    points.push((dx * radius) >> shift, (dy * radius) >> shift, z);
  }
  return points;
}

// --- normals --------------------------------------------------------------------------------------

function pointOf(points, i) {
  return [points[3 * i], points[3 * i + 1], points[3 * i + 2]];
}

/** 0x24b4c: the cross product of B-A and C-A, each component >> 8 (ints), scaled to `length`. */
function integerFaceNormal(points, a, b, c, length) {
  const [A, B, C] = [pointOf(points, a), pointOf(points, b), pointOf(points, c)];
  const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
  const cross = [
    (Math.imul(e1[1], e2[2]) - Math.imul(e1[2], e2[1])) >> 8,
    (Math.imul(e1[2], e2[0]) - Math.imul(e1[0], e2[2])) >> 8,
    (Math.imul(e1[0], e2[1]) - Math.imul(e1[1], e2[0])) >> 8,
  ];
  return scaledToLength(cross, length);
}

/** x87: trunc(c * length / sqrt(|c|²)) per component, |c|² a 32-bit int sum. */
function scaledToLength(c, length) {
  const squared = (Math.imul(c[0], c[0]) + Math.imul(c[1], c[1]) + Math.imul(c[2], c[2])) | 0;
  const norm = (Math.sqrt(squared));
  return c.map((x) => Math.trunc(((x * length) / norm)) | 0);
}

/** 0x17584(obj, L): per vertex, the sum of the normals of every face using it, scaled to L. */
export function buildCornerNormals(object, length) {
  const { points, faces } = object;
  const count = points.length / 3;
  const normals = new Int32Array(points.length);
  for (let i = 0; i < count; i++) {
    const sum = [0, 0, 0];
    for (let f = 0; f < faces.length; f += 12) {
      if (faces[f + 3] === i || faces[f + 4] === i || faces[f + 5] === i) {
        const n = integerFaceNormal(points, faces[f + 3], faces[f + 4], faces[f + 5], NORMAL_LENGTH);
        sum[0] += n[0];
        sum[1] += n[1];
        sum[2] += n[2];
      }
    }
    normals.set(scaledToLength(sum, length), 3 * i);
  }
  object.cornerNormals = normals;
}

/** 0x247d4: the cross product of B-A and C-A (x87), normalised, times L, truncated. */
function floatFaceNormal(points, a, b, c, length) {
  const [A, B, C] = [pointOf(points, a), pointOf(points, b), pointOf(points, c)];
  const e1 = [0, 1, 2].map((k) => (B[k] - A[k]));
  const e2 = [0, 1, 2].map((k) => (C[k] - A[k]));
  const n = [
    ((e1[1] * e2[2]) - (e1[2] * e2[1])),
    ((e1[2] * e2[0]) - (e1[0] * e2[2])),
    ((e1[0] * e2[1]) - (e1[1] * e2[0])),
  ];
  const norm = (Math.sqrt((((n[0] * n[0]) + (n[1] * n[1])) + (n[2] * n[2]))));
  return n.map((x) => Math.trunc(((x * length) / norm)) | 0);
}

/** 0x24d58(obj, L): face i gets face normal i (+8 = i), one per face-normal slot of the object. */
export function buildFaceNormals(object, count, length) {
  const { points, faces } = object;
  const normals = new Int32Array(3 * count);
  for (let i = 0; i < count; i++) {
    const f = 12 * i;
    faces[f + 2] = i;
    normals.set(floatFaceNormal(points, faces[f + 3], faces[f + 4], faces[f + 5], length), 3 * i);
  }
  object.faceNormals = normals;
}

// --- the sphere 0x816f0 (0x17ae0) -----------------------------------------------------------------

const SPHERE_RINGS = 9;
const SPHERE_MIN_RADIUS = 20;
const SPHERE_RING_STEP = 32;
const SPHERE_Z0 = -256;
const SPHERE_Z_STEP = 64;
/** u = 32 per direction, v = 33 per band (rows of the 320x200 environment image). */
const SPHERE_U_STEP = 32;
const SPHERE_V_STEP = 33;

/** 72 points, 128 faces; bands 1..6 are the chrome (material 6), the end caps grey phong. */
export function buildSphere() {
  const points = [];
  for (let k = 0; k < SPHERE_RINGS; k++) {
    const radius = Math.max(sin(SPHERE_RING_STEP * k), SPHERE_MIN_RADIUS);
    points.push(...ring(radius, SPHERE_Z0 + SPHERE_Z_STEP * k, 1, 8));
  }
  const faces = [];
  for (let b = 0; b < SPHERE_RINGS - 1; b++) {
    const material = b >= 1 && b <= 6 ? MATERIAL.CHROME : MATERIAL.PHONG;
    const v0 = SPHERE_V_STEP * (b - 1);
    const v1 = SPHERE_V_STEP * b;
    for (let j = 0; j < RING_POINTS; j++) {
      const [u0, u1] = [SPHERE_U_STEP * j, SPHERE_U_STEP * (j + 1)];
      faces.push(...bandFaces(b, j, material, [NO_NORMAL, NO_NORMAL], [u0, v0, u1, v0, u1, v1], [u0, v0, u1, v1, u0, v1]));
    }
  }
  const sphere = createObject({ points: Int32Array.from(points), faces: Int32Array.from(faces.flat()), flags: SPHERE_FLAGS });
  buildCornerNormals(sphere, NORMAL_LENGTH);
  return sphere;
}

// --- the tube 0x8163c (0x177a0) -------------------------------------------------------------------

/** Dword table 0x17470: the z of the tube's 8 rings. */
const TUBE_Z = [-255, -213, -171, -128, 128, 171, 213, 255];
const TUBE_RING_ANGLE0 = 0x10;
const TUBE_RING_STEP = 0x20;
const TUBE_FLESH_BAND = 3;
const TUBE_U_STEP = 64;
const TUBE_V0 = 2;
const TUBE_V1 = 125;

/** 64 points, 112 faces; band 3 is the "flesh" (material 0), the rest a grey phong bowl. */
export function buildTube() {
  const points = [];
  for (let k = 0; k < TUBE_Z.length; k++) {
    points.push(...ring(sin(TUBE_RING_ANGLE0 + TUBE_RING_STEP * k), TUBE_Z[k], 1, 8));
  }
  const faces = [];
  for (let b = 0; b < TUBE_Z.length - 1; b++) {
    const material = b === TUBE_FLESH_BAND ? MATERIAL.FLESH : MATERIAL.PHONG;
    for (let j = 0; j < RING_POINTS; j++) {
      const n = 2 * (RING_POINTS * b + j);
      const [u0, u1] = [TUBE_U_STEP * j, TUBE_U_STEP * (j + 1)];
      faces.push(...bandFaces(b, j, material, [n, n + 1], [u0, TUBE_V0, u1, TUBE_V0, u1, TUBE_V1], [u0, TUBE_V0, u1, TUBE_V1, u0, TUBE_V1]));
    }
  }
  const tube = createObject({ points: Int32Array.from(points), faces: Int32Array.from(faces.flat()), flags: TUBE_FLAGS });
  buildCornerNormals(tube, NORMAL_LENGTH);
  buildFaceNormals(tube, tube.faces.length / 12, TUBE_FACE_NORMAL_LENGTH);
  return tube;
}

// --- the pod root 0x81588 (static spikes) ---------------------------------------------------------

/** The data-segment object with its two cones; init gives it corner and face normals of length 256. */
export function buildPod(image) {
  const pod = staticObject(image, POD_ADDRESS);
  pod.faces = Int32Array.from(pod.faces);
  buildCornerNormals(pod, NORMAL_LENGTH);
  buildFaceNormals(pod, pod.faceNormals.length / 3, NORMAL_LENGTH);
  pod.flags = POD_FLAGS;
  return pod;
}

// --- the tunnel segment (0x17e04 on a copy of 0x817a4) --------------------------------------------

const SEGMENT_RINGS = 8;
const SEGMENT_RING_ANGLE0 = 0x10;
const SEGMENT_RING_STEP = 0x20;
const SEGMENT_Z0 = -0x380;
const SEGMENT_Z_STEP = 0x100;
/** double 0x8d8bc: the bend of the end pieces, ~30 degrees. */
const BEND_ANGLE = 0.5230874486690036;
const BEND_OFFSET = 910;
/** ScalePoints(seg, 0x200): every coordinate doubled. */
const SEGMENT_SCALE = 0x200;
/** Points 64..71 / 72..79: the bent ends; 80..87 / 88..95: the iris centres; 96, 97: the hatch. */
export const MINUS_END = 64;
export const PLUS_END = 72;
export const MINUS_IRIS = 80;
export const PLUS_IRIS = 88;
export const HATCH_A = 96;
export const HATCH_B = 97;
/** The hatch quad 10-11-19-18: 96 slides from 10 towards 11, 97 from 19 towards 18. */
export const HATCH_A_FROM = 10;
export const HATCH_A_TO = 11;
export const HATCH_B_FROM = 19;
export const HATCH_B_TO = 18;
/** The closed irises: all 8 points on the axis. */
export const IRIS_DEPTH = 0x700;
const SEGMENT_POINTS = 98;
const SEGMENT_U_STEP = 0x33;
const END_U_STEP = 32;
const END_V = 64;
const DOOR_CENTRE = 32;
const DOOR_RADIUS_SHIFT = 3;
const LAST_RING = 56;

/** 0x1777c: the v of direction j (mirrored for the hatch side). */
function segmentV(j, d) {
  const r = j > 5 || j < 2 ? j + d : 8 - j - d;
  return (r << 6) & 255;
}

/** The bent end points k = 0..7 of the raw ring at `first` (x87, trunc). */
function bentEnd(points, first, zShift, sign) {
  const cosine = (Math.cos(BEND_ANGLE));
  const sine = (Math.sin(BEND_ANGLE));
  const out = [];
  for (let k = 0; k < RING_POINTS; k++) {
    const [x, y, z] = pointOf(points, first + k);
    const shifted = z + zShift;
    out.push(Math.trunc((x * cosine)), y, Math.trunc((shifted + sign * (x * sine))));
  }
  return out;
}

function segmentPoints() {
  const raw = [];
  for (let r = 0; r < SEGMENT_RINGS; r++) {
    raw.push(...ring(sin(SEGMENT_RING_ANGLE0 + SEGMENT_RING_STEP * r), SEGMENT_Z0 + SEGMENT_Z_STEP * r, 2, 7));
  }
  const points = new Int32Array(3 * SEGMENT_POINTS);
  points.set(raw);
  points.set(bentEnd(raw, 0, -BEND_OFFSET, -1), 3 * MINUS_END);
  points.set(bentEnd(raw, LAST_RING, BEND_OFFSET, 1), 3 * PLUS_END);
  points.set(pointOf(raw, HATCH_A_FROM), 3 * HATCH_A);
  points.set(pointOf(raw, HATCH_B_FROM), 3 * HATCH_B);
  for (let i = 0; i < points.length; i++) {
    points[i] = Math.imul(points[i], SEGMENT_SCALE) >> 8;
  }
  for (let k = 0; k < RING_POINTS; k++) {
    points.set([0, 0, -IRIS_DEPTH], 3 * (MINUS_IRIS + k));
    points.set([0, 0, IRIS_DEPTH], 3 * (PLUS_IRIS + k));
  }
  return points;
}

function segmentFaces() {
  const faces = [];
  const add = (material, a, b, c, uvs) => faces.push(face(material, faces.length, a, b, c, uvs));
  for (let b = 0; b < SEGMENT_RINGS - 1; b++) {
    const material = b >= 1 && b <= 5 ? MATERIAL.WALL : MATERIAL.TUBE_END;
    const [u0, u1] = [SEGMENT_U_STEP * (b - 1), SEGMENT_U_STEP * b];
    for (let j = 0; j < RING_POINTS; j++) {
      const isHatch = b === 1 && j === 2;
      const [v0, v1] = [segmentV(j, 0), segmentV(j, 1)];
      add(material, isHatch ? HATCH_A : ringPoint(b, j), ringPoint(b, j + 1), ringPoint(b + 1, j + 1), [u0, v0, u0, v1, u1, v1]);
      add(material, ringPoint(b, j), isHatch ? HATCH_B : ringPoint(b + 1, j + 1), ringPoint(b + 1, j), [u0, v0, u1, v1, u1, v0]);
    }
  }
  for (let j = 0; j < RING_POINTS; j++) {
    const j1 = (j + 1) & 7;
    const [u0, u1] = [END_U_STEP * j, END_U_STEP * (j + 1)];
    add(MATERIAL.TUBE_END, j, MINUS_END + j, j1, [u0, 0, u0, END_V, u1, 0]);
    add(MATERIAL.TUBE_END, MINUS_END + j, MINUS_END + j1, j1, [u0, END_V, u1, END_V, u1, 0]);
    add(MATERIAL.TUBE_END, LAST_RING + j, LAST_RING + j1, PLUS_END + j1, [u0, 0, u1, 0, u1, END_V]);
    add(MATERIAL.TUBE_END, LAST_RING + j, PLUS_END + j1, PLUS_END + j, [u0, 0, u1, END_V, u0, END_V]);
  }
  const doorPoint = (j) => [DOOR_CENTRE + (cos(DIRECTION_STEP * j) >> DOOR_RADIUS_SHIFT), DOOR_CENTRE + (sin(DIRECTION_STEP * j) >> DOOR_RADIUS_SHIFT)];
  for (const [base, centre] of [[0, MINUS_IRIS], [LAST_RING, PLUS_IRIS]]) {
    for (let j = 0; j < RING_POINTS; j++) {
      const j1 = (j + 1) & 7;
      add(MATERIAL.IRIS, base + j, centre + j, base + j1, [...doorPoint(j), DOOR_CENTRE, DOOR_CENTRE, ...doorPoint(j1)]);
      add(MATERIAL.IRIS, base + j, base + j1, centre + j, [...doorPoint(j), ...doorPoint(j1), DOOR_CENTRE, DOOR_CENTRE]);
    }
  }
  return Int32Array.from(faces.flat());
}

/** 98 points (already scaled x2), 176 faces; no normals. */
export function buildSegment() {
  return createObject({ points: segmentPoints(), faces: segmentFaces(), flags: SEGMENT_FLAGS });
}
