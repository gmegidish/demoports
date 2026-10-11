// Float 3x4 matrices of the engine (0x50914..0x51000), column-major: m[0..2] = image of X, m[3..5] =
// Y, m[6..8] = Z, m[9..11] = translation, so p' = m[r]*x + m[3+r]*y + m[6+r]*z + m[9+r].
// The original keeps a "current" matrix [0x8bbb0] and pre-multiplies into it; here every operation
// returns a new Float32Array. Each product/sum is rounded to float32 (x87 precision 24 bits).

import { f32, trunc } from './fixed.js';

const MATRIX_SIZE = 12;
const FIXED_ONE = 256;

/** 0x50ad0 / 0x50bdc: identity. */
export function identity() {
  const m = new Float32Array(MATRIX_SIZE);
  m[0] = 1;
  m[4] = 1;
  m[8] = 1;
  return m;
}

/**
 * 0x50914 MatMul(A, B): A∘B (B applied first). Element = ((A[r]*B[3c] + A[3+r]*B[3c+1]) +
 * A[6+r]*B[3c+2]) (+ A[9+r] for the translation column), every step rounded to float32.
 */
export function multiply(a, b) {
  const out = new Float32Array(MATRIX_SIZE);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 3; r++) {
      let sum = f32(f32(f32(a[r] * b[3 * c]) + f32(a[3 + r] * b[3 * c + 1])) + f32(a[6 + r] * b[3 * c + 2]));
      if (c === 3) {
        sum = f32(sum + a[9 + r]);
      }
      out[3 * c + r] = sum;
    }
  }
  return out;
}

function rotation(angle, cosIndices, sinIndex, minusSinIndex) {
  const m = identity();
  const s = f32(Math.sin(angle));
  const c = f32(Math.cos(angle));
  m[cosIndices[0]] = c;
  m[cosIndices[1]] = c;
  m[sinIndex] = s;
  m[minusSinIndex] = -s;
  return m;
}

/** 0x50c74 RotX(a): Rx∘m; y' = c*y - s*z, z' = s*y + c*z. */
export function rotateX(m, angle) {
  return multiply(rotation(angle, [4, 8], 5, 7), m);
}

/** 0x50cc8 RotY(a): Ry∘m; x' = c*x + s*z, z' = -s*x + c*z. */
export function rotateY(m, angle) {
  return multiply(rotation(angle, [0, 8], 6, 2), m);
}

/** 0x50d18 RotZ(a): Rz∘m; x' = c*x - s*y, y' = s*x + c*y. */
export function rotateZ(m, angle) {
  return multiply(rotation(angle, [0, 4], 1, 3), m);
}

/** 0x50d6c Translate(x, y, z): the translation column += (x, y, z), float adds. */
export function translate(m, x, y, z) {
  const out = Float32Array.from(m);
  out[9] = f32(m[9] + x);
  out[10] = f32(m[10] + y);
  out[11] = f32(m[11] + z);
  return out;
}

/** 0x50a44 / 0x50d9c Invert: rigid inverse = Rᵀ ∘ T(-t), through MatMul. */
export function invert(m) {
  const transposed = new Float32Array(MATRIX_SIZE);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      transposed[3 * c + r] = m[3 * r + c];
    }
  }
  const back = identity();
  back[9] = -m[9];
  back[10] = -m[10];
  back[11] = -m[11];
  return multiply(transposed, back);
}

/** 0x50f34 FloatToFixedMatrix: 8.8 ints, trunc(e*256). */
export function toFixed(m) {
  const out = new Int32Array(MATRIX_SIZE);
  for (let i = 0; i < MATRIX_SIZE; i++) {
    out[i] = trunc(m[i] * FIXED_ONE);
  }
  return out;
}

/** 0x51000 FixedToFloatMatrix: e = i/256. */
export function fromFixed(fixed) {
  const out = new Float32Array(MATRIX_SIZE);
  for (let i = 0; i < MATRIX_SIZE; i++) {
    out[i] = f32(fixed[i] / FIXED_ONE);
  }
  return out;
}
