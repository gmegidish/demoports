// Key-frame animation and point/key rescaling of object.c: 0x39e08 AnimateTree, 0x39e30 AnimLength,
// 0x39d50 AnimateObject, 0x39ca8 InterpKeys, 0x513a0 LerpAngle, 0x396e8 LerpVec3f, 0x39ad0 ScalePoints,
// 0x39bfc ScaleKeys. Times are frame*256. See E1 §2.

import { f32, trunc, imul } from './fixed.js';
import { identity, rotateX, rotateY, rotateZ, toFixed } from './matrix.js';

const ANGLE_MASK = 0xfff;
const HALF_TURN = 0x800;
const FULL_TURN = 0x1000;
const ONE_OVER_PI = 0.3183098861837907; // 0x8f67d
const PI = 3.141592653589793; // 0x8f685
const FRAME_SHIFT = 8;

/**
 * 0x513a0 LerpAngle(a, b, t): shortest-path interpolation of two angles (radians), quantised to
 * 4096 steps per turn and t to 1/256.
 */
export function LerpAngle(a, b, t) {
  const it = trunc(f32(t * 256));
  const ia = trunc(f32(f32(a * 2048) * ONE_OVER_PI)) & ANGLE_MASK;
  const ib = trunc(f32(f32(b * 2048) * ONE_OVER_PI)) & ANGLE_MASK;
  const d = (ib - ia) & ANGLE_MASK;
  let r;
  if (d < HALF_TURN) {
    r = ia + (imul(it, d) >> 8);
  } else {
    r = ia - (imul(it, (FULL_TURN - d) & ANGLE_MASK) >> 8);
  }
  return f32(f32((r & ANGLE_MASK) * PI) / 2048);
}

/** 0x396e8 LerpVec3f: a + (b - a)*t, float32 steps. */
export function LerpVec3f(a, b, t) {
  return Float32Array.from([0, 1, 2], (i) => f32(f32(f32(b[i] - a[i]) * t) + a[i]));
}

/** 0x39ca8 InterpKeys(A, B, t): Rz·Ry·Rx of the interpolated angles, lerped position. */
export function InterpKeys(a, b, t) {
  const rx = LerpAngle(a.euler[0], b.euler[0], t);
  const ry = LerpAngle(a.euler[1], b.euler[1], t);
  const rz = LerpAngle(a.euler[2], b.euler[2], t);
  const m = rotateZ(rotateY(rotateX(identity(), rx), ry), rz);
  m.set(LerpVec3f(a.position, b.position, t), 9);
  return m;
}

/** 0x39d50 AnimateObject(obj, time): K = the key segment holding `time`, interpolated, as 8.8. */
export function AnimateObject(object, time) {
  const keys = object.keys;
  if (!keys) {
    return;
  }
  let k = 0;
  while (k + 1 < keys.length) {
    const isInside = time >= keys[k].frame << FRAME_SHIFT && time <= keys[k + 1].frame << FRAME_SHIFT;
    if (isInside) {
      break;
    }
    k++;
  }
  if (k + 1 >= keys.length) {
    throw new Error('object.c: assert keyf && keyf->Next (time out of range)');
  }
  const from = keys[k];
  const to = keys[k + 1];
  const t = f32((time - (from.frame << FRAME_SHIFT)) / ((to.frame - from.frame) << FRAME_SHIFT));
  object.matrix = toFixed(InterpKeys(from, to, t));
}

/** 0x39e08 AnimateTree(obj, time): siblings' subtrees, children's, then the object itself. */
export function AnimateTree(object, time) {
  if (!object) {
    return;
  }
  AnimateTree(object.next, time);
  AnimateTree(object.child, time);
  AnimateObject(object, time);
}

/** 0x39e30 AnimLength(obj): last key frame << 8, 0 without keys. */
export function AnimLength(object) {
  if (!object.keys) {
    return 0;
  }
  return object.keys[object.keys.length - 1].frame << FRAME_SHIFT;
}

/** 0x39ad0 ScalePoints(obj, s): every point component c = (c*s) >> 8, whole tree. Normals untouched. */
export function ScalePoints(object, scale) {
  for (let o = object; o; o = o.child) {
    const points = o.points;
    for (let i = 0; i < points.length; i++) {
      points[i] = imul(points[i], scale) >> 8;
    }
    if (o.next) {
      ScalePoints(o.next, scale);
    }
  }
}

/** 0x39bfc ScaleKeys(obj, s): K's translation = (v*s) >> 8, key positions *= s/256, whole tree. */
export function ScaleKeys(object, scale) {
  if (!object) {
    return;
  }
  ScaleKeys(object.next, scale);
  ScaleKeys(object.child, scale);
  for (let i = 9; i < 12; i++) {
    object.matrix[i] = imul(object.matrix[i], scale) >> 8;
  }
  const factor = scale / 256;
  for (const key of object.keys ?? []) {
    for (let i = 0; i < 3; i++) {
      key.position[i] = f32(key.position[i] * factor);
    }
  }
}
