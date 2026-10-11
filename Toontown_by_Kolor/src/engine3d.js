// The 3D engine of parts 8 and 9 ("scavenger did the object"), 0x108ff4..0x10e6xx
// (docs/disassembly/D1_engine3d.md). Fillers: src/raster3d.js.
//
// API (Watcom register arguments in order, then the stack arguments; the engine's state stays in m.mem at the
// original addresses, so a part reads it the way the original does):
//   sub_10900c(m, count)                     allocates `count` objects (all disabled) and the z-buffer
//   sub_109083(m)                            frees them (nothing to do)
//   sub_109097(m, object, isDisabled)        object +0x20: 0 = drawn
//   sub_1090b2(m, object, datOffset)         loads an object from TOONTOWN.DAT
//   sub_109725(m, object)                    builds the 12-vertex box with its texture coordinates (part 8)
//   sub_109efc(m, object)                    frees an object's arrays (nothing to do)
//   sub_10af2c(m, object, mode, scale, base, texture, extra)
//                                            draw mode (10, 11, 12 are ported), shading scale and base, texture
//   sub_10b21a(m, object, x, y, z, angle1, angle2, angle3)   position and rotation (degrees)
//   sub_10b278(m, x, y, z)                   light direction (normalised to length 256)
//   sub_10b2ce(m, object, factor)            scales the vertices once (factor: a float32)
//   sub_10b356(m, value)                     the z-buffer's clear value
//   sub_10b055(m, dst)                       clears the z-buffer, draws every enabled object into dst (320x200)
//
// Object (0x52 bytes, array at [0x170f1c]):
//   +0x00 vertices (x, y, z dwords)      +0x04 rotated vertices        +0x08 projected vertices (24 bytes each:
//   x, y, z, shade, u, v)                +0x0c face normals (3 dwords) +0x10 vertex normals  +0x14 rotated normals
//   +0x18 faces (3 words)                +0x1c face sort keys (8 bytes; the sorted modes only)
//   +0x20 disabled flag  +0x24 draw routine (address)  +0x28 vertex count  +0x2c face count
//   +0x30/+0x34/+0x38 angles  +0x3c/+0x40/+0x44 position  +0x48 shade scale (byte)  +0x49 shade base (byte)
//   +0x4a texture  +0x4e second texture (the sorted modes only)
import { FILLER_10CCAF, FILLER_10D497, FILLER_10DD95, ZBUFFER, fillTriangle } from './raster3d.js';

export const OBJECTS = 0x170f1c;
export const OBJECT_COUNT = 0x170f6c;
export const OBJECT_SIZE = 0x52;
/** The light direction (0x10b278) and the same in the current object's frame (0x10b055). */
export const LIGHT = 0x170f20;
export const OBJECT_LIGHT = 0x170f2c;
/** The view direction in the current object's frame, for back-face culling (0x10b055). */
export const OBJECT_VIEW = 0x170f38;
/** The rotation matrix, 9 dwords in 16.16, row by row (0x109f7c). */
export const MATRIX = 0x170f48;
/** The view direction (0, 0, -256) and the z-buffer's clear value (a word). */
const VIEW = 0x12851c;
const Z_CLEAR = 0x128528;

const Z_BUFFER_BYTES = 0x1f400;
const PROJECTED_SIZE = 0x18;
/** The rotation's constants: pi as 3.141592, 180 and 65536 (a float32). */
const PI = 0x1276f3;
const HALF_TURN = 0x1276fb;
const FIXED_ONE = 0x127703;
const PROJECTION_SHIFT = 9;
const CENTRE_X = 0xa0;
const CENTRE_Y = 0x64;

/** The object's base address. */
export function objectAt(m, object) {
  return m.u32(OBJECTS) + object * OBJECT_SIZE;
}

/** 0x10900c */
export function sub_10900c(m, count) {
  m.set32(ZBUFFER, m.malloc(Z_BUFFER_BYTES));
  m.set32(OBJECT_COUNT, count);
  m.set32(OBJECTS, m.malloc(count * OBJECT_SIZE));
  for (let i = 0; i < count; i++) {
    m.set32(objectAt(m, i) + 0x20, 1);
  }
}

/** 0x109083: frees the objects and the z-buffer. */
export function sub_109083() {}

/** 0x109097 */
export function sub_109097(m, object, isDisabled) {
  m.set32(objectAt(m, object) + 0x20, isDisabled);
}

/** Allocates the object's arrays for `vertices` and `faces`. */
function allocateArrays(m, o, vertices, faces) {
  m.set32(o + 0x28, vertices);
  m.set32(o + 0x2c, faces);
  m.set32(o + 0x00, m.malloc(vertices * 12));
  m.set32(o + 0x04, m.malloc(vertices * 12));
  m.set32(o + 0x10, m.malloc(vertices * 12));
  m.set32(o + 0x14, m.malloc(vertices * 12));
  m.set32(o + 0x08, m.malloc(vertices * PROJECTED_SIZE));
  m.set32(o + 0x18, m.malloc(faces * 6));
  m.set32(o + 0x0c, m.malloc(faces * 12));
  m.set32(o + 0x1c, m.malloc(faces * 8));
}

/**
 * 0x1090b2: the object at `datOffset` in TOONTOWN.DAT: 2 bytes skipped, the vertex count, the vertices (3 words
 * each), the face count, 1 byte skipped, the faces (3 vertex indices), the face normals and the vertex normals
 * (3 words each). Words are signed and widened to dwords, except the faces'.
 */
export function sub_1090b2(m, object, datOffset) {
  const d = m.dat;
  let at = datOffset + 2;
  const word = () => {
    const value = ((d[at] | (d[at + 1] << 8)) << 16) >> 16;
    at += 2;
    return value;
  };
  const o = objectAt(m, object);
  const vertices = word();
  const readVectors = (to, count) => {
    for (let i = 0; i < count * 3; i++) {
      m.set32(to + i * 4, word());
    }
  };
  // the face count is read after the vertices: allocate with a peek
  const faces = ((d[at + vertices * 6] | (d[at + vertices * 6 + 1] << 8)) << 16) >> 16;
  allocateArrays(m, o, vertices, faces);
  readVectors(m.u32(o), vertices);
  at += 2 + 1;
  for (let i = 0; i < faces * 3; i++) {
    m.set16(m.u32(o + 0x18) + i * 2, word());
  }
  readVectors(m.u32(o + 0x0c), faces);
  readVectors(m.u32(o + 0x10), vertices);
}

/** 0x109725's box: 12 vertices, their texture coordinates, and 12 faces. */
const BOX_VERTICES = [
  [-160, -100, -100], [160, -100, -100], [160, 100, -100], [-160, 100, -100],
  [-160, -100, 100], [160, -100, 100], [160, 100, 100], [-160, 100, 100],
  [-160, -100, 100], [-160, 100, 100], [160, -100, 100], [160, 100, 100],
];
const BOX_UV = [
  [2, 159], [253, 159], [253, 2], [2, 2], [2, 2], [253, 2],
  [253, 159], [2, 159], [253, 159], [253, 2], [2, 159], [2, 2],
];
const BOX_FACES = [
  [0, 2, 3], [0, 1, 2], [4, 5, 6], [4, 7, 6], [0, 4, 1], [4, 5, 1],
  [3, 7, 2], [7, 6, 2], [0, 8, 9], [0, 3, 9], [1, 10, 11], [1, 2, 11],
];

/** 0x109725: the box (part 8). Face normals are the cross products of the faces' edges. */
export function sub_109725(m, object) {
  const o = objectAt(m, object);
  allocateArrays(m, o, BOX_VERTICES.length, BOX_FACES.length);
  const vertices = m.u32(o);
  BOX_VERTICES.forEach((vertex, i) => vertex.forEach((value, k) => m.set32(vertices + i * 12 + k * 4, value)));
  BOX_UV.forEach(([u, v], i) => {
    m.set32(m.u32(o + 8) + i * PROJECTED_SIZE + 0x10, u);
    m.set32(m.u32(o + 8) + i * PROJECTED_SIZE + 0x14, v);
  });
  BOX_FACES.forEach((face, i) => {
    face.forEach((index, k) => m.set16(m.u32(o + 0x18) + i * 6 + k * 2, index));
    const [p0, p1, p2] = face.map((index) => BOX_VERTICES[index]);
    const e1 = p1.map((value, k) => value - p0[k]);
    const e2 = p2.map((value, k) => value - p0[k]);
    const normal = m.u32(o + 0x0c) + i * 12;
    m.set32(normal, Math.imul(e1[1], e2[2]) - Math.imul(e1[2], e2[1]));
    m.set32(normal + 4, Math.imul(e1[2], e2[0]) - Math.imul(e1[0], e2[2]));
    m.set32(normal + 8, Math.imul(e1[0], e2[1]) - Math.imul(e1[1], e2[0]));
  });
}

/** 0x109efc: frees the object's arrays. */
export function sub_109efc() {}

/**
 * 0x109f7c: the rotation matrix for three angles in degrees (a, b, c), each element truncated to 16.16.
 * Some products go through float32 locals, as in the original.
 */
export function sub_109f7c(m, a, b, c) {
  const toRadians = (degrees) => (degrees * m.f64(PI)) / m.f64(HALF_TURN);
  const one = m.f32(FIXED_ONE);
  const fixed = (value) => Math.trunc(value * one);
  const sa = Math.sin(toRadians(a));
  const ca = Math.cos(toRadians(a));
  const sb = Math.sin(toRadians(b));
  const cb = Math.cos(toRadians(b));
  const sc = Math.sin(toRadians(c));
  const cc = Math.cos(toRadians(c));
  const saF = Math.fround(sa);
  const saScF = Math.fround(sa * sc);
  const ccSaF = Math.fround(cc * saF);
  const minusScF = Math.fround(-sc);
  const values = [
    sa * sc * sb + cc * cb,
    cc * saF * sb + minusScF * cb,
    ca * sb,
    sc * ca,
    cc * ca,
    -saF,
    saScF * cb + cc * -sb,
    ccSaF * cb + -sb * minusScF,
    cb * ca,
  ];
  values.forEach((value, i) => m.set32(MATRIX + i * 4, fixed(value)));
}

/** One row of the matrix times (x, y, z), >> 16 (32-bit products and sums). */
function rotateRow(m, row, x, y, z) {
  const r = MATRIX + row * 12;
  return (Math.imul(m.s32(r + 4), y) + Math.imul(m.s32(r), x) + Math.imul(m.s32(r + 8), z)) >> 16;
}

/** 0x10a0dc: rotates `count` vectors from `from` to `to` and adds the object's position. */
export function sub_10a0dc(m, from, to, count, object) {
  const o = objectAt(m, object);
  for (let i = 0; i < count; i++) {
    const x = m.s32(from + i * 12);
    const y = m.s32(from + i * 12 + 4);
    const z = m.s32(from + i * 12 + 8);
    for (let row = 0; row < 3; row++) {
      m.set32(to + i * 12 + row * 4, rotateRow(m, row, x, y, z) + m.s32(o + 0x3c + row * 4));
    }
  }
}

/** 0x10a1b4: rotates `count` vectors from `from` to `to`. */
export function sub_10a1b4(m, from, to, count) {
  for (let i = 0; i < count; i++) {
    const x = m.s32(from + i * 12);
    const y = m.s32(from + i * 12 + 4);
    const z = m.s32(from + i * 12 + 8);
    for (let row = 0; row < 3; row++) {
      m.set32(to + i * 12 + row * 4, rotateRow(m, row, x, y, z));
    }
  }
}

/**
 * 0x10a25b: perspective: x = (x << 9) / z + 160, y = 100 - (y << 9) / z, and z, into the 24-byte projected
 * vertices. z = 0 is not divided by.
 */
export function sub_10a25b(m, from, to, count) {
  for (let i = 0; i < count; i++) {
    const x = m.s32(from + i * 12) << PROJECTION_SHIFT;
    const y = m.s32(from + i * 12 + 4) << PROJECTION_SHIFT;
    const z = m.s32(from + i * 12 + 8);
    const p = to + i * PROJECTED_SIZE;
    m.set32(p, (z === 0 ? x : (x / z) | 0) + CENTRE_X);
    m.set32(p + 4, CENTRE_Y - (z === 0 ? y : (y / z) | 0));
    m.set32(p + 8, z);
  }
}

/** 0x10a2d5: the length of the vector at `at`, truncated. */
export function sub_10a2d5(m, at) {
  const x = m.s32(at);
  const y = m.s32(at + 4);
  const z = m.s32(at + 8);
  return Math.trunc(Math.sqrt((Math.imul(x, x) + Math.imul(y, y) + Math.imul(z, z)) | 0));
}

/**
 * 0x10a4d6: each vertex's shade: (normal . light >> 8) * scale >> 8 + base, at least base, with the unrotated
 * normals and the light in the object's frame.
 */
export function sub_10a4d6(m, object) {
  const o = objectAt(m, object);
  const normals = m.u32(o + 0x10);
  const projected = m.u32(o + 8);
  const scale = m.u8(o + 0x48);
  const base = m.u8(o + 0x49);
  for (let i = 0; i < m.s32(o + 0x28); i++) {
    const n = normals + i * 12;
    const dot = (Math.imul(m.s32(OBJECT_LIGHT + 4), m.s32(n + 4)) + Math.imul(m.s32(OBJECT_LIGHT), m.s32(n))
      + Math.imul(m.s32(OBJECT_LIGHT + 8), m.s32(n + 8))) >> 8;
    const shade = (Math.imul(dot, scale) >> 8) + base;
    m.set32(projected + i * PROJECTED_SIZE + 0xc, Math.max(shade, base));
  }
}

/** Environment mapping: u = (nx >> 1) + 128, v = 128 - (ny >> 1) from the normals at object + `normalsField`. */
function mapNormalsToUv(m, object, normalsField) {
  const o = objectAt(m, object);
  const normals = m.u32(o + normalsField);
  const projected = m.u32(o + 8);
  for (let i = 0; i < m.s32(o + 0x28); i++) {
    m.set32(projected + i * PROJECTED_SIZE + 0x10, (m.s32(normals + i * 12) >> 1) + 0x80);
    m.set32(projected + i * PROJECTED_SIZE + 0x14, 0x80 - (m.s32(normals + i * 12 + 4) >> 1));
  }
}

/** 0x10a57d: texture coordinates from the rotated normals. */
export function sub_10a57d(m, object) {
  mapNormalsToUv(m, object, 0x14);
}

/** 0x10a5e4: texture coordinates from the unrotated normals (draw modes 5 and 6, at setup). */
export function sub_10a5e4(m, object) {
  mapNormalsToUv(m, object, 0x10);
}

/** Whether face `face` looks towards the viewer: face normal . view direction (object frame) >> 8 > 0. */
function isFaceVisible(m, o, face) {
  const n = m.u32(o + 0x0c) + face * 12;
  return ((Math.imul(m.s32(OBJECT_VIEW + 4), m.s32(n + 4)) + Math.imul(m.s32(OBJECT_VIEW), m.s32(n))
    + Math.imul(m.s32(OBJECT_VIEW + 8), m.s32(n + 8))) >> 8) > 0;
}

/** Draws face `face` with filler `filler`: its three projected vertices in the face's order. */
function drawFace(m, o, face, filler, dst) {
  const indices = m.u32(o + 0x18) + face * 6;
  const projected = m.u32(o + 8);
  const vertex = (k) => projected + m.s16(indices + k * 2) * PROJECTED_SIZE;
  fillTriangle(m, filler, vertex(0), vertex(1), vertex(2), dst, m.u32(o + 0x4a));
}

/** 0x10ac24 (mode 11): every face, plain texture with the projected vertices' own u, v (0x10ccaf). */
export function sub_10ac24(m, object, dst) {
  const o = objectAt(m, object);
  for (let face = 0; face < m.s32(o + 0x2c); face++) {
    drawFace(m, o, face, FILLER_10CCAF, dst);
  }
}

/** The environment-mapped, shaded modes 10 and 12: rotate the normals, u, v from them, shades, visible faces. */
function drawShadedEnvironmentMapped(m, object, dst, filler) {
  const o = objectAt(m, object);
  sub_10a1b4(m, m.u32(o + 0x10), m.u32(o + 0x14), m.s32(o + 0x28));
  sub_10a57d(m, object);
  sub_10a4d6(m, object);
  for (let face = 0; face < m.s32(o + 0x2c); face++) {
    if (isFaceVisible(m, o, face)) {
      drawFace(m, o, face, filler, dst);
    }
  }
}

/** 0x10ad4b (mode 10): through the shade table at 0x15cfb4 (0x10d497). */
export function sub_10ad4b(m, object, dst) {
  drawShadedEnvironmentMapped(m, object, dst, FILLER_10D497);
}

/** 0x10ae23 (mode 12): through the shade table at 0x12c6a4 (0x10dd95). */
export function sub_10ae23(m, object, dst) {
  drawShadedEnvironmentMapped(m, object, dst, FILLER_10DD95);
}

/** The draw routines 0x10af2c installs, by mode. The others are not used by the demo and not ported. */
const DRAW_MODES = new Map([[10, 0x10ad4b], [11, 0x10ac24], [12, 0x10ae23]]);
const DRAW_ROUTINES = new Map([[0x10ad4b, sub_10ad4b], [0x10ac24, sub_10ac24], [0x10ae23, sub_10ae23]]);

/**
 * 0x10af2c: the object's shading scale and base, textures and draw routine. Modes 1..12 select 0x10a649,
 * 0x10a6bd, 0x10a913, 0x10aaa5, 0x10ab76, 0x10ac93, none, 0x10a7c6, 0x10a9c6, 0x10ad4b, 0x10ac24, 0x10ae23.
 */
export function sub_10af2c(m, object, mode, scale, base, texture, extra) {
  const o = objectAt(m, object);
  m.set8(o + 0x49, base);
  m.set8(o + 0x48, scale);
  m.set32(o + 0x4a, texture);
  m.set32(o + 0x4e, extra);
  if (!DRAW_MODES.has(mode)) {
    throw new Error(`draw mode ${mode} is not ported`);
  }
  m.set32(o + 0x24, DRAW_MODES.get(mode));
}

/** A vector times the transposed matrix, >> 16: from the world's frame to the object's. */
function toObjectFrame(m, x, y, z, column) {
  const c = MATRIX + column * 4;
  return (Math.imul(y, m.s32(c + 12)) + Math.imul(x, m.s32(c)) + Math.imul(z, m.s32(c + 24))) >> 16;
}

/**
 * 0x10b055: clears the z-buffer to [0x128528], then for each enabled object: matrix, rotate and translate,
 * project, the light and the view direction in its frame, and its draw routine into `dst`.
 */
export function sub_10b055(m, dst) {
  const zClear = m.u16(Z_CLEAR);
  const zBuffer = m.u32(ZBUFFER);
  for (let i = 0; i < Z_BUFFER_BYTES; i += 2) {
    m.set16(zBuffer + i, zClear);
  }
  for (let object = 0; object < m.s32(OBJECT_COUNT); object++) {
    const o = objectAt(m, object);
    if (m.u32(o + 0x20) !== 0) {
      continue;
    }
    sub_109f7c(m, m.s32(o + 0x30), m.s32(o + 0x34), m.s32(o + 0x38));
    sub_10a0dc(m, m.u32(o), m.u32(o + 4), m.s32(o + 0x28), object);
    sub_10a25b(m, m.u32(o + 4), m.u32(o + 8), m.s32(o + 0x28));
    for (let k = 0; k < 3; k++) {
      m.set32(OBJECT_LIGHT + k * 4, toObjectFrame(m, m.s32(LIGHT), m.s32(LIGHT + 4), m.s32(LIGHT + 8), k));
    }
    for (let k = 0; k < 3; k++) {
      m.set32(OBJECT_VIEW + k * 4, toObjectFrame(m, m.s32(VIEW), m.s32(VIEW + 4), m.s32(VIEW + 8), k));
    }
    const draw = DRAW_ROUTINES.get(m.u32(o + 0x24));
    if (draw === undefined) {
      throw new Error(`object ${object} has no ported draw routine`);
    }
    draw(m, object, dst);
  }
}

/** 0x10b21a: the object's position and angles. */
export function sub_10b21a(m, object, x, y, z, angle1, angle2, angle3) {
  const o = objectAt(m, object);
  [x, y, z].forEach((value, k) => m.set32(o + 0x3c + k * 4, value));
  [angle1, angle2, angle3].forEach((value, k) => m.set32(o + 0x30 + k * 4, value));
}

/** 0x10b278: the light direction, scaled to length 256. */
export function sub_10b278(m, x, y, z) {
  m.set32(LIGHT, x);
  m.set32(LIGHT + 4, y);
  m.set32(LIGHT + 8, z);
  const length = sub_10a2d5(m, LIGHT);
  for (let k = 0; k < 3; k++) {
    m.set32(LIGHT + k * 4, ((m.s32(LIGHT + k * 4) << 8) / length) | 0);
  }
}

/** 0x10b2ce: multiplies the object's vertices by `factor` (a float32), truncated. */
export function sub_10b2ce(m, object, factor) {
  const o = objectAt(m, object);
  const vertices = m.u32(o);
  for (let i = 0; i < m.s32(o + 0x28) * 3; i++) {
    m.set32(vertices + i * 4, Math.trunc(m.s32(vertices + i * 4) * Math.fround(factor)));
  }
}

/** 0x10b356: the z-buffer's clear value. */
export function sub_10b356(m, value) {
  m.set16(Z_CLEAR, value);
}
