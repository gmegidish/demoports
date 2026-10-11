// The projector / shadow renderer of the skull parts 3 and 5: 0x457f0 RenderWorldProjected(view,
// projector). Pass 1 (0x45930) transforms everything with the projector's camera (0x45c54, focal
// 512) and rasterises each lit face's 1/z into the light depth buffer (0x45b38 + 0x45d78 Depth),
// storing per face whether / how it is lit in the face's type field. Pass 2 (0x4671c) draws with the
// view camera (no near clip; 0x46994 builds polygons carrying the projector coordinates), and the
// material routine 0x46d08 (installed by the part with setTreeDraw) shades each pixel lit by the
// projector through the "film" (teeth.rap): fast path 0x46d48 / slow path 0x47ed0. See E2 §8.
//
// The part owns the projector state: createProjectorState() = { depth ([0x11a878], u32 per pixel,
// 320 per row), lightMap ([0x11a880], pixel -> film texel), film ([0x11a870]), frameId
// ([0x11a87c], 0..255, the part increments it) }, passed as RenderWorldProjected's `projector` and
// reachable from the draw routine as context.projector.

import { idiv, imul } from './fixed.js';
import { V, VERTEX_INTS, SLOT_INTS, S, FACE_INTS } from './layout.js';
import {
  FLAG, createFrame, objectMatrix, isBoxCulled, transformPoints, transformFaceNormalsAs, projectAll,
  transformRow,
  projectPolygons, sortPolygons, drawPolygons, walkRenderList,
} from './render.js';
import { toFixed } from './matrix.js';
import { rasterTemplate, triangleOf, scalarChannel, packedIndex, clippedSpan, TEMPLATE } from './raster/template.js';
import { drawTexture, textureChannel, phongChannel } from './raster/texture.js';

const WIDTH = 320;
const DEPTH_PIXELS = 0x10000;
const W_ONE = 0x100000;
const PROJECTOR_CENTRE_X = 128;
const PROJECTOR_CENTRE_Y = 80;
const DEPTH_Y_CAP = 199;
const FRAME_ID_SHIFT = 24;
const W_MASK = 0xffffff;

/** Projector flags (face +0 after pass 1, polygon +0x90). */
export const LIT = { SPANS: 1, NEAR_EDGE: 2, NX_NOT_POSITIVE: 4, NY_NOT_POSITIVE: 8 };
const MIN_LIT_NORMAL_Z = 1;

export function createProjectorState() {
  return {
    depth: new Uint32Array(DEPTH_PIXELS),
    lightMap: new Uint32Array(DEPTH_PIXELS),
    film: new Uint8Array(0x2800),
    frameId: 0,
  };
}

/** 0x45c54: points through the projector (into its vertex buffer): w = 0x100000/z, focal 512. */
function transformProjector(frame, object, M) {
  const vertices = frame.world.vertices;
  const first = frame.vertexCount;
  const points = object.points;
  for (let i = 0; i < points.length / 3; i++) {
    const at = (first + i) * VERTEX_INTS;
    const [x, y, z] = [points[3 * i], points[3 * i + 1], points[3 * i + 2]];
    vertices[at + V.PROJECTED] = 1;
    vertices[at + V.X] = transformRow(M, 0, x, y, z) + M[9];
    vertices[at + V.Y] = transformRow(M, 1, x, y, z) + M[10];
    const depth = transformRow(M, 2, x, y, z) + M[11];
    if (depth !== 0) {
      const w = idiv(W_ONE, depth);
      vertices[at + V.Z] = w;
      vertices[at + V.SX] = (imul(vertices[at + V.X], w) >> 11) + PROJECTOR_CENTRE_X;
      vertices[at + V.SY] = PROJECTOR_CENTRE_Y - (imul(vertices[at + V.Y], w) >> 11);
    } else {
      vertices[at + V.Z] = W_ONE;
      vertices[at + V.SX] = vertices[at + V.X];
      vertices[at + V.SY] = vertices[at + V.Y];
    }
  }
  frame.vertexCount += points.length / 3;
  return first;
}

/**
 * 0x45d78 Depth: rasterises the face's w<<12 (tagged with frameId in the top byte) into the depth
 * buffer keeping the maximum. Returns 0 (rejected), 3 (zero width) or LIT.SPANS | LIT.NEAR_EDGE.
 */
export function rasteriseDepth(polygon, vertices, projector) {
  const triangle = triangleOf(vertices, polygon);
  const w = triangle.order.map((k) => vertices[polygon.slots[k * SLOT_INTS + S.VERTEX] * VERTEX_INTS + V.Z] << 12);
  const depth = projector.depth;
  const frameTag = projector.frameId << FRAME_ID_SHIFT;
  let flags = 0;
  const rejectBox = (xs, ys) => {
    const maxX = Math.max(...xs);
    const minX = Math.min(...xs);
    if (maxX < 0 || minX > 319) {
      return true;
    }
    if (maxX > 318 || minX < 1 || ys[2] > 198 || ys[0] < 1) {
      flags |= LIT.NEAR_EDGE;
    }
    return false;
  };
  const channel = scalarChannel(w[0], w[1], w[2], 0, (start) => (start & W_MASK) | frameTag);
  const span = (y, xLong, xShort, isLongLeft, values, dx) => {
    const [xl0, xr0] = isLongLeft ? [xLong, xShort] : [xShort, xLong];
    if (xl0 > 319 || xr0 < 0) {
      return;
    }
    let value = values[0];
    const step = dx[0];
    let xl = xl0;
    let xr = xr0;
    if (isLongLeft) {
      if (xl < 0) {
        value = (value - imul(xl, step)) | 0;
        xl = 0;
      }
      xr = Math.min(xr, 319);
      for (let x = xl, n = Math.max(xr - xl, 0) + 1; n > 0; n--, x++) {
        keepNearest(depth, y * WIDTH + x, value);
        value = (value + step) | 0;
      }
    } else {
      if (xr > 319) {
        value = (value + imul(319 - xr, step)) | 0;
        xr = 319;
      }
      xl = Math.max(xl, 0);
      for (let x = xr, n = Math.max(xr - xl, 0) + 1; n > 0; n--, x--) {
        keepNearest(depth, y * WIDTH + x, value);
        value = (value - step) | 0;
      }
    }
    flags |= LIT.SPANS;
  };
  const result = rasterTemplate(triangle, [channel], span, { yReject: DEPTH_Y_CAP, yCap: DEPTH_Y_CAP, rejectBox });
  if (result === TEMPLATE.ZERO_WIDTH) {
    return 3;
  }
  return result === TEMPLATE.REJECTED ? 0 : flags;
}

function keepNearest(depth, at, value) {
  if (depth[at] < value >>> 0) {
    depth[at] = value >>> 0;
  }
}

/** 0x45b38: every face of the object: face+0 := lit flags (0 unless all three w > 0 and nz > 1). */
function lightFaces(frame, object, firstVertex, firstNormal, projector) {
  const { world } = frame;
  const vertices = world.vertices;
  const faces = object.faces;
  for (let f = 0; f < faces.length; f += FACE_INTS) {
    faces[f] = 0;
    const polygon = world.polygons[frame.polygonCount];
    polygon.flags = 0;
    polygon.object = object;
    polygon.n = 3;
    polygon.normal = firstNormal + faces[f + 2];
    for (let k = 0; k < 3; k++) {
      polygon.slots[k * SLOT_INTS + S.VERTEX] = firstVertex + faces[f + 3 + k];
    }
    const isInFront = [0, 1, 2].every((k) => vertices[polygon.slots[k * SLOT_INTS] * VERTEX_INTS + V.Z] > 0);
    if (!isInFront) {
      continue;
    }
    const normal = polygon.normal * 3;
    if (world.faceNormals[normal + 2] > MIN_LIT_NORMAL_Z) {
      let flags = rasteriseDepth(polygon, vertices, projector);
      if (world.faceNormals[normal] <= 0) {
        flags |= LIT.NX_NOT_POSITIVE;
      }
      if (world.faceNormals[normal + 1] <= 0) {
        flags |= LIT.NY_NOT_POSITIVE;
      }
      faces[f] = flags;
    }
    frame.polygonCount++;
  }
}

/** 0x459f0: one object of pass 1. */
function lightObject(frame, object, parent) {
  const m = objectMatrix(object, parent);
  const M = toFixed(m);
  const firstVertex = transformProjector(frame, object, M);
  object.projectorVertex = firstVertex;
  const firstNormal = transformFaceNormalsAs(frame, object, M, false, false);
  if (!(object.flags & FLAG.HIDDEN)) {
    lightFaces(frame, object, firstVertex, firstNormal, frame.context.projector);
  }
  return m;
}

/** 0x46994: polygons of faces in front of the camera with nz >= 0, carrying projector s, t, w. */
function buildProjectedPolygons(frame, object, firstVertex, firstNormal, projectorVertices) {
  const { world } = frame;
  const vertices = world.vertices;
  const faces = object.faces;
  for (let f = 0; f < faces.length; f += FACE_INTS) {
    const polygon = world.polygons[frame.polygonCount];
    polygon.flags = 0;
    polygon.object = object;
    polygon.n = 3;
    polygon.normal = firstNormal + faces[f + 2];
    for (let k = 0; k < 3; k++) {
      polygon.slots[k * SLOT_INTS + S.VERTEX] = firstVertex + faces[f + 3 + k];
    }
    const isInFront = [0, 1, 2].every((k) => vertices[polygon.slots[k * SLOT_INTS] * VERTEX_INTS + V.Z] > 0);
    if (!isInFront || world.faceNormals[polygon.normal * 3 + 2] <= -1) {
      continue;
    }
    let key = 0;
    for (let k = 0; k < 3; k++) {
      const slot = k * SLOT_INTS;
      const light = (object.projectorVertex + faces[f + 3 + k]) * VERTEX_INTS;
      polygon.slots[slot + S.U] = faces[f + 6 + 2 * k];
      polygon.slots[slot + S.V] = faces[f + 7 + 2 * k];
      polygon.slots[slot + S.S] = projectorVertices[light + V.SX] << 16;
      polygon.slots[slot + S.T] = projectorVertices[light + V.SY] << 16;
      polygon.slots[slot + S.W] = projectorVertices[light + V.Z] << 12;
      key = (key + vertices[polygon.slots[slot] * VERTEX_INTS + V.Z]) | 0;
    }
    polygon.key = key;
    polygon.material = (object.materials ?? world.materials)[faces[f + 1]];
    polygon.projectorFlags = faces[f];
    frame.polygonCount++;
  }
}

/** 0x46818: one object of pass 2 (no hidden test before the cull; hidden only skips the faces). */
function drawObjectProjected(frame, object, parent) {
  const m = objectMatrix(object, parent);
  const M = toFixed(m);
  const { world } = frame;
  if (isBoxCulled(object, M, world)) {
    return m;
  }
  const firstVertex = transformPoints(frame, object, M);
  const firstNormal = transformFaceNormalsAs(frame, object, M, (object.flags & FLAG.FACE_NORMAL_Z_ONLY) !== 0, false);
  if (world.mode !== 2 && world.mode !== 3) {
    projectAll(frame, firstVertex);
  }
  if (!(object.flags & FLAG.HIDDEN)) {
    buildProjectedPolygons(frame, object, firstVertex, firstNormal, frame.context.projectorVertices);
  }
  return m;
}

/**
 * 0x457f0 RenderWorldProjected(view, projectorWorld, { target, colourTable, projector }): pass 1
 * with the projector world's camera, vertex buffer and centre (polygon / normal buffers of `view`),
 * then pass 2 with `view`.
 */
export function RenderWorldProjected(view, projectorWorld, targets) {
  const lightWorld = {
    ...view,
    view: projectorWorld.view,
    cameraToWorld: projectorWorld.cameraToWorld,
    vertices: projectorWorld.vertices,
    centreX: projectorWorld.centreX,
    centreY: projectorWorld.centreY,
  };
  const context = {
    world: view,
    vertices: view.vertices,
    faceNormals: view.faceNormals,
    target: targets.target,
    colourTable: targets.colourTable,
    projector: targets.projector,
    projectorVertices: projectorWorld.vertices,
  };
  const lightFrame = createFrame(lightWorld, context);
  walkRenderList(lightFrame, lightWorld.view, lightObject);
  const frame = createFrame(view, context);
  walkRenderList(frame, view.view, drawObjectProjected);
  if (view.mode === 2 || view.mode === 3) {
    projectPolygons(view, frame.polygonCount);
  }
  sortPolygons(view, frame.polygonCount);
  drawPolygons(context, frame.polygonCount);
  return frame;
}

/** dwdy of 0x46d48: (wT-wB)(Mx-Bx) - (wM-wB)(Tx-Bx) over (Ty-By)(Mx-Bx) - (My-By)(Tx-Bx), 32-bit. */
function depthGradientDown(xs, ys, w) {
  const denominator = (imul(ys[0] - ys[2], xs[1] - xs[2]) - imul(ys[1] - ys[2], xs[0] - xs[2])) | 0;
  if (denominator === 0) {
    return 0;
  }
  return idiv((imul(w[0] - w[2], xs[1] - xs[2]) - imul(w[1] - w[2], xs[0] - xs[2])) | 0, denominator);
}

function slotValues(polygon, order, field) {
  return order.map((k) => polygon.slots[k * SLOT_INTS + field]);
}

/**
 * 0x46d08, the projector's material routine: plain 0x331b4 when the face is not lit (flags & 3 == 0),
 * else 0x46d48 (fast: buffer index wraps at 16 bits) or 0x47ed0 (flags & 2: per-pixel bounds).
 */
export function drawProjected(polygon, context) {
  const flags = polygon.projectorFlags;
  if ((flags & 3) === 0) {
    drawTexture(polygon, context);
    return;
  }
  drawLit(polygon, context, (flags & LIT.NEAR_EDGE) !== 0);
}

function drawLit(polygon, context, isSlow) {
  const vertices = context.vertices;
  const triangle = triangleOf(vertices, polygon);
  const { order, xs, ys } = triangle;
  const flags = polygon.projectorFlags;
  const material = polygon.material;
  const hasTexture = material.texture !== null;
  const texture = hasTexture ? material.texture : material.phongMap;
  const uv = hasTexture ? textureChannel(polygon, order) : phongChannel(vertices, polygon, order);
  const w = slotValues(polygon, order, S.W);
  const dwdy = depthGradientDown(xs, ys, w);
  const frameTag = context.projector.frameId << FRAME_ID_SHIFT;
  const channels = [
    uv,
    scalarChannel(...slotValues(polygon, order, S.S), (flags & LIT.NX_NOT_POSITIVE) ? 0xffff : -0x8000),
    scalarChannel(...slotValues(polygon, order, S.T), (flags & LIT.NY_NOT_POSITIVE) ? -0x8000 : 0x10000),
    scalarChannel(w[0], w[1], w[2], 0, (start, dwdx) => {
      const bias = (((Math.abs(dwdx) + Math.abs(dwdy)) << 2) + 0xf0) | 0;
      return ((start + bias) & W_MASK) | frameTag;
    }),
  ];
  const { depth, lightMap, film } = context.projector;
  const { target, colourTable } = context;
  const pixel = (at, v) => {
    const texel = texture?.[packedIndex(v[0])] ?? 0;
    const s = v[1];
    const t = v[2];
    let index;
    if (isSlow) {
      if (t < 0 || t > 0xc70000 || s < 0 || s > 0x13f0000) {
        target[at] = texel;
        return;
      }
      index = imul(t >>> 16, WIDTH) + (s >>> 16);
    } else {
      index = (imul(t >>> 16, WIDTH) + (s >>> 16)) & 0xffff;
    }
    if ((v[3] >>> 0) < depth[index]) {
      target[at] = texel;
      return;
    }
    target[at] = colourTable[(film[lightMap[index] & 0xffff] ?? 0) * 256 + texel] ?? 0;
  };
  rasterTemplate(triangle, channels, (y, xLong, xShort, isLongLeft, values, dx) =>
    clippedSpan(y, xLong, xShort, isLongLeft, values, dx, pixel));
}
