// Lookup tables the engine builds: the phong/environment map 0x316c4 (cached) / 0x314c0 that shaded
// materials index by their corner normals, and the 1024-step sine table of the small triangle engine
// (obj2 0x71054). See E1 §1.5, E2 §5.

import { f32, trunc } from './fixed.js';

const PHONG_SIZE = 0x80;
const PHONG_PITCH = 0x100;

/** [0x84c6c]: the cache of generated maps, keyed by their parameters. */
let phongCache = new Map();

/** 0x315f0: forget every cached map. */
export function clearPhongMaps() {
  phongCache = new Map();
}

/** Watcom pow 0x44e36 with an integer exponent: square-and-multiply, each product in float32. */
function powByIntegerExponent(x, exponent) {
  let result = 1;
  let base = x;
  for (let n = exponent; n > 0; n >>= 1) {
    if (n & 1) {
      result = f32(result * base);
    }
    base = f32(base * base);
  }
  return result;
}

/**
 * 0x314c0: an N x N radial map with row stride `pitch` (columns past N stay 0):
 * k = trunc(pow(1 - sqrt(((x-h)^2 + (y-h)^2) / (2h^2)), exponent) * scale), clamped to [lo, hi],
 * plus `colour`.
 */
export function generatePhongMap(exponent, lo, hi, scale, colour, size = PHONG_SIZE, pitch = PHONG_PITCH) {
  if (!Number.isInteger(exponent)) {
    throw new Error(`phong map: non-integer exponent ${exponent} not ported`);
  }
  const map = new Uint8Array(size * pitch);
  const half = size * 0.5;
  const denominator = half * 2 * half;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const squared = (x - half) * (x - half) + (y - half) * (y - half);
      const distance = f32(Math.sqrt(f32(squared / denominator)));
      let k = trunc(f32(powByIntegerExponent(f32(1 - distance), exponent) * scale));
      if (k > hi) {
        k = hi;
      }
      if (k < lo) {
        k = lo;
      }
      map[y * pitch + x] = (k + colour) & 0xff;
    }
  }
  return map;
}

/** 0x316c4: generatePhongMap through the cache (identical parameters share one map). */
export function phongMap(exponent, lo, hi, scale, colour) {
  const key = [exponent, lo, hi, scale, colour].join(',');
  if (!phongCache.has(key)) {
    phongCache.set(key, generatePhongMap(exponent, lo, hi, scale, colour));
  }
  return phongCache.get(key);
}

const SINE_TABLE = 0x71054;
const SINE_ENTRIES = 1280;

/** obj2 0x71054: SIN[i] ≈ 1024*sin(2πi/1024), 1280 dwords so cos(i) = SIN[i+256]. */
export function triangleSineTable(image) {
  const table = new Int32Array(SINE_ENTRIES);
  for (let i = 0; i < SINE_ENTRIES; i++) {
    table[i] = image.i32(SINE_TABLE + 4 * i);
  }
  return table;
}
