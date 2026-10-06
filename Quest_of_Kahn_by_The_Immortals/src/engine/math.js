// Vectors, 3x3 matrices and quaternions of the 3D engine. KAHN.EXE 0x23aa0..0x23cbc, 0x312b0..0x31513,
// 0x3ce10..0x3d230. Matrices are 9 floats, row-major, applied to column vectors.

const f = Math.fround;

/** The engine's own value of pi (a double at 0x51d2c): close, not exact. */
export const KAHN_PI = 3.141592687;
export const DEGREES_TO_RADIANS = KAHN_PI * 0.005555555555555555;

export function dot(a, b) {
  return a[1] * b[1] + a[0] * b[0] + a[2] * b[2];
}

export function cross(a, b, out) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
}

/** Normalize in place; a zero vector is left alone. 0x23bc8. */
export function normalize(v) {
  const squared = f(v[1] * v[1] + v[0] * v[0] + v[2] * v[2]);
  if (squared <= 0) {
    return;
  }
  const scale = 1 / Math.sqrt(squared);
  v[0] *= scale;
  v[1] *= scale;
  v[2] *= scale;
}

/** out = m * v, reading v at an offset so vertex arrays can be transformed in place. 0x312b0. */
export function transform(m, v, vAt, out, outAt) {
  const x = v[vAt];
  const y = v[vAt + 1];
  const z = v[vAt + 2];
  out[outAt] = m[1] * y + m[0] * x + m[2] * z;
  out[outAt + 1] = m[4] * y + m[3] * x + m[5] * z;
  out[outAt + 2] = m[7] * y + m[6] * x + m[8] * z;
}

/** out = a * b; out must not be a or b. 0x31340. */
export function multiply(a, b, out) {
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      out[row * 3 + column] = a[row * 3] * b[column] + a[row * 3 + 1] * b[3 + column] + a[row * 3 + 2] * b[6 + column];
    }
  }
}

/** m = m * diag(s): each column scaled. 0x31428. */
export function scaleColumns(m, s) {
  for (let row = 0; row < 3; row++) {
    m[row * 3] *= s[0];
    m[row * 3 + 1] *= s[1];
    m[row * 3 + 2] *= s[2];
  }
}

/** asin the way the engine computes it. 0x2fbfe. */
export function asin(x) {
  return Math.atan2(x, Math.sqrt(1 - x * x));
}

/** Axis and angle (x, y, z, angle) to a quaternion (x, y, z, w), in place. 0x3cec4. */
export function quaternionFromAxisAngle(q) {
  const half = q[3] * 0.5;
  const sine = Math.sin(half);
  q[0] *= sine;
  q[1] *= sine;
  q[2] *= sine;
  q[3] = Math.cos(half);
}

/** Hamilton product a * b; out must not be a or b. 0x3d17c. */
export function quaternionMultiply(a, b, out) {
  out[3] = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2];
  out[0] = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1];
  out[1] = a[3] * b[1] + a[1] * b[3] + a[2] * b[0] - a[0] * b[2];
  out[2] = a[3] * b[2] + a[2] * b[3] + a[0] * b[1] - a[1] * b[0];
}

/**
 * The engine's "normalize": divides by the squared length, no square root. 0x3ce38.
 * quaternionToMatrix undoes the difference, so the pair always yields the rotation of q/|q|.
 */
export function quaternionDivideBySquaredLength(q) {
  const squared = f(q[1] * q[1] + q[0] * q[0] + q[2] * q[2] + q[3] * q[3]);
  if (squared <= 0) {
    q[0] = 0;
    q[1] = 0;
    q[2] = 0;
    q[3] = 1;
    return;
  }
  const scale = 1 / squared;
  q[0] *= scale;
  q[1] *= scale;
  q[2] *= scale;
  q[3] *= scale;
}

/** Quaternion of any length to its rotation matrix. 0x3cf08. */
export function quaternionToMatrix(q, m) {
  const x = q[0];
  const y = q[1];
  const z = q[2];
  const w = q[3];
  const squared = y * y + x * x + z * z + w * w;
  const s = squared === 0 ? 1 : f(2 / squared);
  const ys = f(y * s);
  const zs = f(s * z);
  const xs = x * s;
  m[0] = 1 - y * ys - z * zs;
  m[1] = x * ys - w * zs;
  m[2] = w * ys + x * zs;
  m[3] = x * ys + w * zs;
  m[4] = 1 - xs * x - z * zs;
  m[5] = y * zs - w * xs;
  m[6] = x * zs - w * ys;
  m[7] = y * zs + w * xs;
  m[8] = 1 - xs * x - y * ys;
}

/**
 * View matrix of a camera looking from position to target, rolled. Row 2 is the view direction,
 * so view z is the distance in front of the camera and view y is up. 0x2f2f0.
 */
export function lookAt(position, target, roll, m) {
  const dx = target[0] - position[0];
  const dy = target[1] - position[1];
  const dz = target[2] - position[2];
  const length = Math.sqrt(dy * dy + dx * dx + dz * dz);
  const yaw = -Math.atan2(dx, dz);
  const pitch = asin(dy / length);
  const sa = Math.sin(yaw);
  const ca = Math.cos(yaw);
  const sp = f(Math.sin(pitch));
  const cp = f(Math.cos(pitch));
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  const sasp = f(sa * sp);
  m[0] = cr * ca + sr * sasp;
  m[1] = cp * sr;
  m[2] = sa * cr - ca * sp * sr;
  m[3] = sasp * cr - ca * sr;
  m[4] = cp * cr;
  m[5] = -ca * sp * cr - sa * sr;
  m[6] = -sa * cp;
  m[7] = sp;
  m[8] = ca * cp;
}

/** The C runtime's rand(), seeded with 1 at program start; only the tunnel and the scroller use it. 0x2fbc9. */
export function createRandom() {
  let seed = 1;
  return () => {
    seed = (Math.imul(seed, 0x41c64e6d) + 0x3039) >>> 0;
    return (seed >>> 16) & 0x7fff;
  };
}
