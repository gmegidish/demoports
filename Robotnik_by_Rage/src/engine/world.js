// Worlds (camera + render buffers), the global render list and the object/camera API the parts
// call. Names follow the original entry points (addresses in the comments). See E1 §3.3, §4.
//
// The render list is global, as in the original ([0x89e04], linked through object.next): CreateWorld
// clears it, AddObject pushes onto it (objects added later are drawn first in list order, but the
// sort decides the final order anyway).

import { f32, trunc } from './fixed.js';
import { identity, invert, multiply, rotateX, rotateY, rotateZ, translate } from './matrix.js';
import { objectsOf } from './eob.js';
import { VERTEX_INTS, NORMAL_INTS, SLOT_INTS, MAX_SLOTS } from './layout.js';

const SCREEN_CENTRE_X = 159;
const SCREEN_CENTRE_Y = 99;
const FAR_DISTANCE = 100000;
const ONE_OVER_256 = 1 / 256;
const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;

/** [0x89e04] head of the render list. */
let renderListHead = null;

export function renderList() {
  return renderListHead;
}

/** The render list, head first. */
export function* renderListObjects() {
  for (let o = renderListHead; o; o = o.next) {
    yield o;
  }
}

/**
 * 0x39e68 CreateWorld(a1, maxVerts, maxPolys, maxFaceNormals): a camera at the origin looking down
 * +z, and the per-frame buffers. Clears the render list. (All parts: (30, 1900, 2700, 2700).)
 */
export function CreateWorld(a1, maxVerts, maxPolys, maxFaceNormals) {
  renderListHead = null;
  const view = identity();
  return {
    materials: null, // +0x00 used by objects without their own
    cameraPosition: new Int32Array(3), // +0x04 ints (as last set)
    cameraAngles: new Int16Array(3), // +0x10
    projectionType: 1, // +0x1c
    centreX: SCREEN_CENTRE_X, // +0x20
    centreY: SCREEN_CENTRE_Y, // +0x24
    sortType: 0, // +0x28
    mode: 1, // +0x29 clip/cull mode
    vertices: new Int32Array(maxVerts * VERTEX_INTS), // +0x2c
    polygons: Array.from({ length: maxPolys }, createPolygon), // +0x30
    faceNormals: new Int32Array(maxFaceNormals * NORMAL_INTS), // +0x34
    sortKeys: new Int32Array(maxPolys * 2), // +0x38 {index, key}
    view, // +0x3c world -> camera
    cameraToWorld: invert(view), // +0x6c; its translation +0x90 = camera position / 256
    far: FAR_DISTANCE, // +0x9c
    a1, // +0xa4
    maxPolys, // +0xa8
    isFastPath: false, // +0xb8: no near clip, project while building (part 9, skull world)
  };
}

/** A polygon record (0xa4 bytes): up to 6 slots of {vertex, u, v, s, t, w}. */
export function createPolygon() {
  return {
    flags: 0, // +0x00 bit0 = point face
    n: 0, // +0x04
    slots: new Int32Array(MAX_SLOTS * SLOT_INTS), // +0x08 + 0x18*k
    material: null, // +0x80
    normal: -1, // +0x84 face-normal record index, -1 = none
    key: 0, // +0x88
    object: null, // +0x8c
    projectorFlags: 0, // +0x90
  };
}

/** 0x39fd8 DestroyWorld: frees the buffers; the render list stays. */
export function DestroyWorld(world) {
  world.vertices = null;
  world.polygons = null;
  world.faceNormals = null;
  world.sortKeys = null;
}

/** 0x3a590 / 0x3c02c AddObject(world, obj): obj.next = head; head = obj (world ignored). */
export function AddObject(world, object) {
  object.next = renderListHead;
  renderListHead = object;
}

/** 0x3c18c: bbox, centre ((min+max)/2 rounding toward zero) and radius of one object. */
export function computeObjectBounds(object) {
  const points = object.points;
  const box = new Int32Array(6);
  if (points.length > 0) {
    box.set([points[0], points[0], points[1], points[1], points[2], points[2]]);
    for (let i = 3; i < points.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        box[2 * axis] = Math.min(box[2 * axis], points[i + axis]);
        box[2 * axis + 1] = Math.max(box[2 * axis + 1], points[i + axis]);
      }
    }
  }
  object.bbox = box;
  object.centre = Int32Array.from([0, 1, 2], (axis) => ((box[2 * axis] + box[2 * axis + 1]) / 2) | 0);
  let radius = 0;
  for (let corner = 0; corner < 8; corner++) {
    const dx = box[corner & 1] - object.centre[0];
    const dy = box[2 + ((corner >> 1) & 1)] - object.centre[1];
    const dz = box[4 + (corner >> 2)] - object.centre[2];
    const squared = (Math.imul(dx, dx) + Math.imul(dy, dy) + Math.imul(dz, dz)) | 0;
    radius = Math.max(radius, trunc(f32(Math.sqrt(squared))));
  }
  object.radius = radius;
}

/** 0x3a598 ComputeBounds(world): 0x3c18c for every object reachable from the render list. */
export function ComputeBounds(world) {
  for (const object of objectsOf(renderListHead)) {
    computeObjectBounds(object);
  }
}

/** 0x3a5b4 SetRenderMode(world, mode): +0x29 (parts use 3: near clipping, AND-of-outcodes culling). */
export function SetRenderMode(world, mode) {
  world.mode = mode;
}

// --- camera -----------------------------------------------------------------------------------

/** 0x3a114 SetCameraPos(w, x, y, z): moves the camera, keeping its orientation. */
export function SetCameraPos(world, x, y, z) {
  world.cameraPosition.set([x, y, z]);
  const cameraToWorld = Float32Array.from(world.cameraToWorld);
  cameraToWorld[9] = f32(x * ONE_OVER_256);
  cameraToWorld[10] = f32(y * ONE_OVER_256);
  cameraToWorld[11] = f32(z * ONE_OVER_256);
  world.cameraToWorld = cameraToWorld;
  world.view = invert(cameraToWorld);
}

function negatedAngle(a) {
  return f32(f32(-a * PI) / 2048);
}

/**
 * 0x3a2bc SetCameraAngles(w, [ax, ay, az]): view = Rz(-az)·Rx(-ax)·Ry(-ay)·T(-pos), with pos the
 * current camera translation.
 */
export function SetCameraAngles(world, angles) {
  world.cameraAngles.set(angles);
  const [ax, ay, az] = world.cameraAngles;
  const position = world.cameraToWorld;
  let m = translate(identity(), -position[9], -position[10], -position[11]);
  m = rotateY(m, negatedAngle(ay));
  m = rotateX(m, negatedAngle(ax));
  m = rotateZ(m, negatedAngle(az));
  world.view = m;
  world.cameraToWorld = invert(m);
}

/** 0x3a178 GetCameraPos: trunc(translation * 256). */
export function GetCameraPos(world) {
  return Int32Array.from([9, 10, 11], (i) => trunc(world.cameraToWorld[i] * 256));
}

/** 0x3a250 / 0x3a288 GetCameraAngles. */
export function GetCameraAngles(world) {
  return Int16Array.from(world.cameraAngles);
}

function updateCameraLocally(world, local) {
  world.cameraToWorld = multiply(world.cameraToWorld, local);
  world.view = invert(world.cameraToWorld);
}

/** 0x3a66c CameraPitchLocal(w, a): rotate about the camera's own X by a (4096 per turn). */
export function CameraPitchLocal(world, angle) {
  const a = (angle << 16) >> 16;
  updateCameraLocally(world, rotateX(identity(), f32(f32(a * TWO_PI) / 4096)));
}

/** 0x3a764 / 0x3a7b4 / 0x3a714 CameraMoveLocalX/Y/Z(w, d): move along the camera's own axis by d/256. */
export function CameraMoveLocalX(world, d) {
  updateCameraLocally(world, translate(identity(), f32(d * ONE_OVER_256), 0, 0));
}

export function CameraMoveLocalY(world, d) {
  updateCameraLocally(world, translate(identity(), 0, f32(d * ONE_OVER_256), 0));
}

export function CameraMoveLocalZ(world, d) {
  updateCameraLocally(world, translate(identity(), 0, 0, f32(d * ONE_OVER_256)));
}

// --- objects ----------------------------------------------------------------------------------

/** 0x39a2c SetObjPos(obj, x, y, z) (+0x58). */
export function SetObjPos(object, x, y, z) {
  object.position.set([x, y, z]);
}

/** 0x39a58 / 0x39a64 SetObjZ / GetObjZ. */
export function SetObjZ(object, z) {
  object.position[2] = z;
}

export function GetObjZ(object) {
  return object.position[2];
}

/** 0x39b04 GetObjPos. */
export function GetObjPos(object) {
  return Int32Array.from(object.position);
}

/** 0x39a70 / 0x39a78 / 0x39a80 SetObjAngleX/Y/Z (words +0x64/+0x66/+0x68, 4096 per turn). */
export function SetObjAngleX(object, a) {
  object.angles[0] = a;
}

export function SetObjAngleY(object, a) {
  object.angles[1] = a;
}

export function SetObjAngleZ(object, a) {
  object.angles[2] = a;
}

/** 0x39b30 / 0x39b50 SetObjAngles / GetObjAngles. */
export function SetObjAngles(object, angles) {
  object.angles.set(angles);
}

export function GetObjAngles(object) {
  return Int16Array.from(object.angles);
}
