// The frame pipeline of the engine (doobj.c / gfx3.c): 0x3a4e0 RenderWorld -> 0x3c710: per object
// 0x3c81c DoObject (matrix, 0x3cae0 bbox cull, 0x3a878 transform, face normals 0x3add4/0x3acfc/
// 0x3ae94, 0x3dd08 project, 0x3d0c4 / 0x3d468 build polygons), then 0x3dad8 near clip (0x3e4e4),
// 0x3dc10 project, 0x3dab0 sort (0x3da00 / 0x51e10 quicksort), 0x3dd98 draw. See E2 §1-2.
//
// Drawing calls `polygon.material.draw(polygon, context)` (the material's +0x2c routine); context =
// { world, vertices, faceNormals, target, colourTable } (see raster/routines.js).

import { f32, idiv, idiv64, imul } from './fixed.js';
import { fromFixed, multiply, rotateX, rotateY, rotateZ, translate, toFixed, identity } from './matrix.js';
import { FACE_INTS, V, VERTEX_INTS, SLOT_INTS, S } from './layout.js';
import { renderList } from './world.js';

/** Object flags (+0x84). */
export const FLAG = {
  FACE_NORMAL_Z_ONLY: 0x02,
  NO_BACKFACE_CULL: 0x04,
  KEY_AVERAGE_Z: 0x08,
  RESCALE_UV: 0x10,
  INVERT_BACKFACE: 0x20,
  KEY_MAX_Z: 0x40,
  NEVER_CULLED: 0x80,
  CORNER_NORMAL_Z_ONLY: 0x100,
  CORNER_NORMAL_XY_ONLY: 0x200,
  KEY_FURTHER: 0x400,
  KEY_NEARER: 0x800,
  HIDDEN: 0x1000,
  FAR_CUT: 0x2000,
  FACE_NORMAL_TRANSLATED: 0x4000,
};

const POINT_FACE = 1;
const NEAR_Z = 50;
const FAST_PATH_MIN_Z = 5;
const KEY_BIAS = 0x1000000;
const BACKFACE_KEEP = -1;
const NO_CULL_CROSS = 10000;
const FAST_POINT_CENTRE_X = 160;
const FAST_POINT_CENTRE_Y = 100;
const TWO_PI = 6.283185307179586;
const ONE_OVER_4096 = 0.000244140625;
const ONE_OVER_256 = 0.00390625;

/** Outcode bits of 0x3d7f4. */
const OUT = { NEAR: 1, TOP: 2, BOTTOM: 4, LEFT: 8, RIGHT: 0x10, FAR: 0x20 };

/** Per-frame counters [0x106c90] vertices, [0x106c88] face normals, [0x106c8c] polygons. */
export function createFrame(world, context) {
  return { world, context, vertexCount: 0, normalCount: 0, polygonCount: 0 };
}

/** The object -> camera matrix of 0x3c81c: parent ∘ T(pos/256) ∘ K ∘ Rz·Ry·Rx(angles). */
export function objectMatrix(object, parent) {
  const [ax, ay, az] = object.angles;
  let m;
  if (ax === 0 && ay === 0 && az === 0) {
    m = fromFixed(object.matrix);
  } else {
    m = identity();
    m = rotateX(m, objectAngle(ax));
    m = rotateY(m, objectAngle(ay));
    m = rotateZ(m, objectAngle(az));
    m = multiply(fromFixed(object.matrix), m);
  }
  const [x, y, z] = object.position;
  m = translate(m, f32(x * ONE_OVER_256), f32(y * ONE_OVER_256), f32(z * ONE_OVER_256));
  return multiply(parent, m);
}

function objectAngle(a) {
  return f32(f32((a & 0xffff) * TWO_PI) * ONE_OVER_4096);
}

/** 0x3d7f4: frustum outcode of a camera-space point (±155 x ±95 px at focal 256). */
export function outcode(x, y, z, far) {
  let code = 0;
  if (z < NEAR_Z) {
    code |= OUT.NEAR;
  }
  const y512 = y << 9;
  const x512 = x << 9;
  if (imul(190, z) < y512) {
    code |= OUT.TOP;
  }
  if (imul(-190, z) > y512) {
    code |= OUT.BOTTOM;
  }
  if (imul(310, z) < x512) {
    code |= OUT.RIGHT;
  }
  if (imul(-310, z) > x512) {
    code |= OUT.LEFT;
  }
  if (z > far) {
    code |= OUT.FAR;
  }
  return code;
}

/** P(): the 8.8 matrix applied to an int point, sum first then one sar 8 per row. */
export function transformRow(M, r, x, y, z) {
  return (imul(M[r], x) + imul(M[3 + r], y) + imul(M[6 + r], z)) >> 8;
}

/** 0x3cae0: true when the object's bbox is outside the frustum (the rule depends on the mode). */
export function isBoxCulled(object, M, world) {
  if (object.flags & FLAG.NEVER_CULLED) {
    return false;
  }
  const box = object.bbox;
  let all = 0xff;
  let any = 0;
  for (let corner = 0; corner < 8; corner++) {
    const x = box[corner & 1];
    const y = box[2 + ((corner >> 1) & 1)];
    const z = box[4 + (corner >> 2)];
    const code = outcode(
      transformRow(M, 0, x, y, z) + M[9],
      transformRow(M, 1, x, y, z) + M[10],
      transformRow(M, 2, x, y, z) + M[11],
      world.far,
    );
    all &= code;
    any |= code;
  }
  switch (world.mode) {
    case 3:
    case 2:
      return all !== 0;
    case 1:
      return (any & OUT.NEAR) !== 0 || all !== 0;
    case 0:
      return any !== 0;
    default:
      throw new Error('bbox cull: unknown mode');
  }
}

/** 0x3a878: points (and corner normals) into the vertex buffer; returns the first vertex index. */
export function transformPoints(frame, object, M) {
  const vertices = frame.world.vertices;
  const first = frame.vertexCount;
  const points = object.points;
  const count = points.length / 3;
  if (count === 0) {
    return first;
  }
  const normals = object.cornerNormals;
  if (normals && normals.length !== points.length) {
    throw new Error('gfx3.c: assert CornerNormal_Collection.n == Point_Collection.n');
  }
  for (let i = 0; i < count; i++) {
    const at = (first + i) * VERTEX_INTS;
    const x = points[3 * i];
    const y = points[3 * i + 1];
    const z = points[3 * i + 2];
    vertices[at + V.X] = transformRow(M, 0, x, y, z) + M[9];
    vertices[at + V.Y] = transformRow(M, 1, x, y, z) + M[10];
    vertices[at + V.Z] = transformRow(M, 2, x, y, z) + M[11];
    vertices[at + V.PROJECTED] = 0;
    if (normals) {
      const nx = normals[3 * i];
      const ny = normals[3 * i + 1];
      const nz = normals[3 * i + 2];
      if (object.flags & FLAG.CORNER_NORMAL_Z_ONLY) {
        vertices[at + V.NZ] = transformRow(M, 2, nx, ny, nz);
      } else if (object.flags & FLAG.CORNER_NORMAL_XY_ONLY) {
        vertices[at + V.NX] = transformRow(M, 0, nx, ny, nz);
        vertices[at + V.NY] = transformRow(M, 1, nx, ny, nz);
      } else {
        vertices[at + V.NX] = transformRow(M, 0, nx, ny, nz);
        vertices[at + V.NY] = transformRow(M, 1, nx, ny, nz);
        vertices[at + V.NZ] = transformRow(M, 2, nx, ny, nz);
      }
    }
  }
  frame.vertexCount += count;
  return first;
}

/**
 * Face normals into the normal buffer; returns the first index. 0x3add4 rotation only (all three),
 * 0x3acfc with translation (flag 0x4000), 0x3ae94 only z (flag 2; x, y keep stale values).
 */
export function transformFaceNormals(frame, object, M) {
  const isZOnly = (object.flags & FLAG.FACE_NORMAL_Z_ONLY) !== 0;
  const isTranslated = !isZOnly && (object.flags & FLAG.FACE_NORMAL_TRANSLATED) !== 0;
  return transformFaceNormalsAs(frame, object, M, isZOnly, isTranslated);
}

/** The three face-normal transforms by choice: z only (0x3ae94), with translation (0x3acfc) or neither (0x3add4). */
export function transformFaceNormalsAs(frame, object, M, isZOnly, isTranslated) {
  const out = frame.world.faceNormals;
  const first = frame.normalCount;
  const normals = object.faceNormals;
  for (let i = 0; i < normals.length; i += 3) {
    const at = (first * 3) + i;
    const x = normals[i];
    const y = normals[i + 1];
    const z = normals[i + 2];
    out[at + 2] = transformRow(M, 2, x, y, z) + (isTranslated ? M[11] : 0);
    if (!isZOnly) {
      out[at] = transformRow(M, 0, x, y, z) + (isTranslated ? M[9] : 0);
      out[at + 1] = transformRow(M, 1, x, y, z) + (isTranslated ? M[10] : 0);
    }
  }
  frame.normalCount += normals.length / 3;
  return first;
}

/** sx = cx + (x<<8)/z, sy = cy - (y<<8)/z. */
function projectVertex(vertices, at, cx, cy) {
  const z = vertices[at + V.Z];
  vertices[at + V.SX] = cx + idiv(vertices[at + V.X] << 8, z);
  vertices[at + V.SY] = cy - idiv(vertices[at + V.Y] << 8, z);
}

/** 0x3dd08: project every vertex from `first` on (modes 0/1; no projected flag, no z==0 guard). */
export function projectAll(frame, first) {
  const world = frame.world;
  if (world.projectionType !== 1) {
    throw new Error('doobj.c: assert projection type 1');
  }
  for (let i = first; i < frame.vertexCount; i++) {
    projectVertex(world.vertices, i * VERTEX_INTS, world.centreX, world.centreY);
  }
}

/** 0x3dc10 / 0x4663c: project the not-yet-projected vertices of every polygon (z==0: sx=x, sy=y). */
export function projectPolygons(world, polygonCount) {
  if (world.projectionType !== 1) {
    return;
  }
  const vertices = world.vertices;
  for (let p = 0; p < polygonCount; p++) {
    const polygon = world.polygons[p];
    for (let k = 0; k < polygon.n; k++) {
      const at = polygon.slots[k * SLOT_INTS] * VERTEX_INTS;
      if (vertices[at + V.PROJECTED] !== 0) {
        continue;
      }
      if (vertices[at + V.Z] !== 0) {
        projectVertex(vertices, at, world.centreX, world.centreY);
      } else {
        vertices[at + V.SX] = vertices[at + V.X];
        vertices[at + V.SY] = vertices[at + V.Y];
      }
      vertices[at + V.PROJECTED] = 1;
    }
  }
}

function keyBias(object) {
  if (object.flags & FLAG.KEY_FURTHER) {
    return KEY_BIAS;
  }
  if (object.flags & FLAG.KEY_NEARER) {
    return -KEY_BIAS;
  }
  return 0;
}

function vertexZ(vertices, index) {
  return vertices[index * VERTEX_INTS + V.Z];
}

function polygonMaterial(frame, object, face) {
  const materials = object.materials ?? frame.world.materials;
  return materials[face[1]];
}

function setFaceSlots(polygon, first, face) {
  const slots = polygon.slots;
  for (let k = 0; k < 3; k++) {
    slots[k * SLOT_INTS + S.VERTEX] = first + face[3 + k];
    slots[k * SLOT_INTS + S.U] = face[6 + 2 * k];
    slots[k * SLOT_INTS + S.V] = face[7 + 2 * k];
  }
}

function setPointSlots(polygon, first, face) {
  for (let k = 0; k < 3; k++) {
    polygon.slots[k * SLOT_INTS + S.VERTEX] = first + face[3];
  }
}

function maxZ(vertices, slots) {
  return Math.max(vertexZ(vertices, slots[0]), vertexZ(vertices, slots[SLOT_INTS]), vertexZ(vertices, slots[2 * SLOT_INTS]));
}

function averageZ(vertices, slots) {
  return idiv(vertexZ(vertices, slots[0]) + vertexZ(vertices, slots[SLOT_INTS]) + vertexZ(vertices, slots[2 * SLOT_INTS]), 3);
}

/** 0x3d0c4 BuildPolys: one polygon per face (normal path). */
export function buildPolygons(frame, object, firstVertex, firstNormal) {
  const world = frame.world;
  const vertices = world.vertices;
  const bias = keyBias(object);
  const faces = object.faces;
  for (let f = 0; f < faces.length; f += FACE_INTS) {
    const face = faces.subarray(f, f + FACE_INTS);
    const polygon = world.polygons[frame.polygonCount];
    polygon.flags = 0;
    polygon.object = object;
    polygon.normal = face[2] === -1 ? -1 : firstNormal + face[2];
    polygon.n = 3;
    if (face[0] === POINT_FACE) {
      polygon.flags |= 1;
      setPointSlots(polygon, firstVertex, face);
      polygon.key = (vertexZ(vertices, polygon.slots[0]) + bias) | 0;
    } else {
      setFaceSlots(polygon, firstVertex, face);
      if (object.flags & FLAG.KEY_AVERAGE_Z) {
        polygon.key = (averageZ(vertices, polygon.slots) + bias) | 0;
      } else if (object.flags & FLAG.KEY_MAX_Z) {
        polygon.key = (maxZ(vertices, polygon.slots) + bias) | 0;
      }
    }
    if ((object.flags & FLAG.FAR_CUT) && polygon.key >= world.far) {
      continue;
    }
    polygon.material = polygonMaterial(frame, object, face);
    frame.polygonCount++;
  }
}

/** 64-bit dividend (high dword = x >>> 24) / z of the fast path's point faces. */
function divideUnsignedHigh(x, z) {
  return idiv64((x >>> 24) * 4294967296 + ((x << 8) >>> 0), z);
}

/** 0x3cfe0 + flags 0x20 / 4: the signed area used by the backface test (visible iff >= -1). */
export function backfaceCross(vertices, polygon) {
  const object = polygon.object;
  if (object.flags & FLAG.NO_BACKFACE_CULL) {
    return NO_CULL_CROSS;
  }
  const a = polygon.slots[0] * VERTEX_INTS;
  const b = polygon.slots[SLOT_INTS] * VERTEX_INTS;
  const c = polygon.slots[2 * SLOT_INTS] * VERTEX_INTS;
  const cross = (imul(vertices[a + V.SX] - vertices[c + V.SX], vertices[b + V.SY] - vertices[c + V.SY])
    - imul(vertices[a + V.SY] - vertices[c + V.SY], vertices[b + V.SX] - vertices[c + V.SX])) | 0;
  return (object.flags & FLAG.INVERT_BACKFACE) ? -cross | 0 : cross;
}

export function isFrontFacing(vertices, polygon) {
  return backfaceCross(vertices, polygon) >= BACKFACE_KEEP;
}

/** 0x3d468 BuildPolysFast (world +0xb8): no near clip; projects now; rejects z<=5 and back faces. */
export function buildPolygonsFast(frame, object, firstVertex, firstNormal) {
  const world = frame.world;
  const vertices = world.vertices;
  const faces = object.faces;
  for (let f = 0; f < faces.length; f += FACE_INTS) {
    const face = faces.subarray(f, f + FACE_INTS);
    const polygon = world.polygons[frame.polygonCount];
    polygon.flags = 0;
    polygon.object = object;
    polygon.n = 3;
    if (face[0] === POINT_FACE) {
      polygon.flags |= 1;
      setPointSlots(polygon, firstVertex, face);
      const at = polygon.slots[0] * VERTEX_INTS;
      polygon.key = vertices[at + V.Z];
      if (vertices[at + V.PROJECTED] === 0) {
        vertices[at + V.SX] = divideUnsignedHigh(vertices[at + V.X], vertices[at + V.Z]) + FAST_POINT_CENTRE_X;
        vertices[at + V.SY] = FAST_POINT_CENTRE_Y - divideUnsignedHigh(vertices[at + V.Y], vertices[at + V.Z]);
        vertices[at + V.PROJECTED] = 1;
      }
      polygon.material = polygonMaterial(frame, object, face);
      frame.polygonCount++;
      continue;
    }
    for (let k = 0; k < 3; k++) {
      polygon.slots[k * SLOT_INTS] = firstVertex + face[3 + k];
    }
    if ([0, 1, 2].some((k) => vertexZ(vertices, polygon.slots[k * SLOT_INTS]) <= FAST_PATH_MIN_Z)) {
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const at = polygon.slots[k * SLOT_INTS] * VERTEX_INTS;
      if (vertices[at + V.PROJECTED] === 0) {
        projectVertex(vertices, at, world.centreX, world.centreY);
        vertices[at + V.PROJECTED] = 1;
      }
    }
    if (!isFrontFacing(vertices, polygon)) {
      continue;
    }
    setFaceSlots(polygon, firstVertex, face);
    polygon.normal = face[2] === -1 ? -1 : firstNormal + face[2];
    polygon.key = (object.flags & FLAG.KEY_MAX_Z) ? maxZ(vertices, polygon.slots) : averageZ(vertices, polygon.slots);
    polygon.material = polygonMaterial(frame, object, face);
    frame.polygonCount++;
  }
}

/** 0x3c81c DoObject: returns the object->camera float matrix its children inherit. */
function doObject(frame, object, parent) {
  const m = objectMatrix(object, parent);
  const M = toFixed(m);
  if (object.flags & FLAG.HIDDEN) {
    return m;
  }
  const world = frame.world;
  if (isBoxCulled(object, M, world)) {
    return m;
  }
  const firstVertex = transformPoints(frame, object, M);
  const firstNormal = transformFaceNormals(frame, object, M);
  if (world.mode !== 2 && world.mode !== 3) {
    projectAll(frame, firstVertex);
  }
  if (world.isFastPath) {
    buildPolygonsFast(frame, object, firstVertex, firstNormal);
  } else {
    buildPolygons(frame, object, firstVertex, firstNormal);
  }
  return m;
}

/** 0x3c7d8: siblings get the parent's matrix, children their own object's. */
function doTree(frame, object, parent, visit) {
  for (let o = object; o; o = o.next) {
    const m = visit(frame, o, parent);
    if (o.child) {
      doTree(frame, o.child, m, visit);
    }
  }
}

/** The 0x3c710 walk: every render-list object with the camera matrix, then its children. */
export function walkRenderList(frame, view, visit) {
  for (let o = renderList(); o; o = o.next) {
    const m = visit(frame, o, view);
    if (o.child) {
      doTree(frame, o.child, m, visit);
    }
  }
}

/** 0x3e074 + 0x3e4e4: Sutherland-Hodgman against z = 50 with the index-ordered interpolation. */
function clipEdge(frame, source, slotP, slotQ, distanceP, distanceQ, isPInside, out, outSlot) {
  const vertices = frame.world.vertices;
  let t;
  if (distanceP === distanceQ) {
    t = isPInside ? 0 : 0x400;
  } else {
    t = idiv(distanceP << 10, distanceP - distanceQ);
  }
  const p = source[slotP * SLOT_INTS] * VERTEX_INTS;
  const q = source[slotQ * SLOT_INTS] * VERTEX_INTS;
  const created = frame.vertexCount++;
  const at = created * VERTEX_INTS;
  for (let k = 0; k < 6; k++) {
    vertices[at + k] = vertices[p + k] + (imul(vertices[q + k] - vertices[p + k], t) >> 10);
  }
  vertices[at + V.PROJECTED] = 0;
  const base = outSlot * SLOT_INTS;
  out[base + S.VERTEX] = created;
  for (const field of [S.U, S.V]) {
    const from = source[slotP * SLOT_INTS + field];
    out[base + field] = from + (imul(source[slotQ * SLOT_INTS + field] - from, t) >> 10);
  }
}

/** 0x3e4e4: clips `n` slots of `source` into `out`; returns the new slot count (0..5). */
export function clipNear(frame, n, source, out) {
  const vertices = frame.world.vertices;
  const distance = (k) => vertices[source[k * SLOT_INTS] * VERTEX_INTS + V.Z] - NEAR_Z;
  const index = (k) => source[k * SLOT_INTS];
  let count = 0;
  for (let i = 0; i < n; i++) {
    const prev = (i + n - 1) % n;
    const next = (i + 1) % n;
    const di = distance(i);
    if (di >= 0) {
      out.set(source.subarray(i * SLOT_INTS, (i + 1) * SLOT_INTS), count * SLOT_INTS);
      count++;
      continue;
    }
    const dPrev = distance(prev);
    if (dPrev >= 0) {
      const [p, q] = index(i) > index(prev) ? [prev, i] : [i, prev];
      clipEdge(frame, source, p, q, distance(p), distance(q), distance(p) >= 0, out, count++);
    }
    const dNext = distance(next);
    if (dNext >= 0) {
      const [p, q] = index(i) < index(next) ? [i, next] : [next, i];
      clipEdge(frame, source, p, q, distance(p), distance(q), distance(p) >= 0, out, count++);
    }
  }
  return count;
}

function copyPolygonHeader(to, from) {
  to.flags = from.flags;
  to.n = from.n;
  to.material = from.material;
  to.normal = from.normal;
  to.key = from.key;
  to.object = from.object;
}

/**
 * 0x3dad8 NearClip (modes 2/3): polygon k lands in slot k-1, polygon 0 in slot `count` and is then
 * moved to `count-1`, so the buffer order before sorting is 1, 2, ..., count-1, 0.
 */
export function nearClip(frame) {
  const world = frame.world;
  const polygons = world.polygons;
  const count = frame.polygonCount;
  for (let i = 0; i < count; i++) {
    const destination = polygons[i === 0 ? count : i - 1];
    const source = polygons[i];
    copyPolygonHeader(destination, source);
    if (source.flags & 1) {
      destination.slots.set(source.slots.subarray(0, SLOT_INTS));
    } else {
      destination.n = clipNear(frame, source.n, source.slots, destination.slots);
    }
  }
  if (count > 0) {
    const last = polygons[count - 1];
    const moved = polygons[count];
    copyPolygonHeader(last, moved);
    last.slots.set(moved.slots);
    last.projectorFlags = moved.projectorFlags;
  }
}

/** 0x51e10: Hoare quicksort of {index, key} pairs, descending by key, middle pivot. */
function quickSort(keys, left, right) {
  let l = left;
  const r = right;
  while (r > l) {
    let i = l;
    let j = r;
    const pivot = keys[(((l + r) >> 1) << 1) + 1];
    do {
      while (pivot < keys[(i << 1) + 1]) {
        i++;
      }
      while (pivot > keys[(j << 1) + 1]) {
        j--;
      }
      if (i <= j) {
        const index = keys[i << 1];
        const key = keys[(i << 1) + 1];
        keys[i << 1] = keys[j << 1];
        keys[(i << 1) + 1] = keys[(j << 1) + 1];
        keys[j << 1] = index;
        keys[(j << 1) + 1] = key;
        i++;
        j--;
      }
    } while (i <= j);
    quickSort(keys, l, j);
    l = i;
    if (l >= r) {
      return;
    }
  }
}

/** 0x3dab0 / 0x3da00 Sort: polygon indices far to near. */
export function sortPolygons(world, count) {
  if (world.sortType !== 0 && world.sortType !== 1) {
    throw new Error('Error! Unknown sort type!');
  }
  const keys = world.sortKeys;
  for (let k = 0; k < count; k++) {
    keys[2 * k] = k;
    keys[2 * k + 1] = world.polygons[k].key;
  }
  if (count > 0) {
    quickSort(keys, 0, count - 1);
  }
}

/** flag 0x10: u = (u*W)>>8, v = ((256-v)*H)>>8, clamped to the texture. */
function rescaleTextureCoordinates(polygon) {
  const width = polygon.material.textureWidth;
  const height = polygon.material.textureHeight;
  for (let k = 0; k < polygon.n; k++) {
    const base = k * SLOT_INTS;
    let u = imul(polygon.slots[base + S.U], width) >> 8;
    let v = imul(256 - polygon.slots[base + S.V], height) >> 8;
    u = Math.max(u, 0);
    v = Math.max(v, 0);
    if (u >= width) {
      u = width - 1;
    }
    if (v >= height) {
      v = height - 1;
    }
    polygon.slots[base + S.U] = u;
    polygon.slots[base + S.V] = v;
  }
}

function drawIfVisible(context, polygon) {
  if (context.world.isFastPath || isFrontFacing(context.vertices, polygon)) {
    polygon.material.draw(polygon, context);
  }
}

/** 0x3dd98 Draw: in sort order; point faces as they are, n>3 as a fan (0,1,2), (0,2,3), (0,3,4). */
export function drawPolygons(context, count) {
  const world = context.world;
  const keys = world.sortKeys;
  for (let k = 0; k < count; k++) {
    const polygon = world.polygons[keys[2 * k]];
    if (polygon.flags & 1) {
      polygon.material.draw(polygon, context);
      continue;
    }
    if (polygon.object.flags & FLAG.RESCALE_UV) {
      rescaleTextureCoordinates(polygon);
    }
    const n = polygon.n;
    if (n === 3) {
      drawIfVisible(context, polygon);
    } else if (n > 3) {
      polygon.n = 3;
      for (let i = 2; i < n; i++) {
        drawIfVisible(context, polygon);
        polygon.slots.copyWithin(SLOT_INTS, 2 * SLOT_INTS, 5 * SLOT_INTS);
      }
    }
  }
}

/**
 * 0x3a4e0 RenderWorld(world, { target, colourTable, ...more }): draws the render list with the
 * world's camera into `target` (320 bytes per row; [0x89dcc]) through `colourTable` (the 0xfd0a0
 * table). Any further fields are passed on to the draw routines in their context.
 */
export function RenderWorld(world, targets) {
  const context = {
    ...targets,
    world,
    vertices: world.vertices,
    faceNormals: world.faceNormals,
  };
  const frame = createFrame(world, context);
  walkRenderList(frame, world.view, doObject);
  if ((world.mode === 2 || world.mode === 3) && !world.isFastPath) {
    nearClip(frame);
    projectPolygons(world, frame.polygonCount);
  }
  sortPolygons(world, frame.polygonCount);
  drawPolygons(context, frame.polygonCount);
  return frame;
}
