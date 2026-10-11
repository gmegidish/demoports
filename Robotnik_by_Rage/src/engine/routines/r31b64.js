// 0x31b64: a point face drawn as a glowing square sprite (part 10's six light flares). The 64x64
// texture (material +0x10, values 0x40..0x7f) is scaled to a square of half-size
// h = (0x10000 / z) >> material +0x28 around the projected point and added to the picture through
// the colour table: pixel = table[texel * 256 + pixel]. Nothing when z <= 50. See P10_room.md §4.

import { V, VERTEX_INTS, S } from '../layout.js';
import { idiv } from '../fixed.js';

const NEAR_Z = 50;
const SIZE_NUMERATOR = 0x10000;
/** 64 texels in 8.8. */
const TEXTURE_SPAN = 0x4000;
const TEXTURE_SIZE = 64;
const WIDTH = 320;
const HEIGHT = 200;

/** 0x31b64 */
export function drawFlare(polygon, context) {
  const at = polygon.slots[S.VERTEX] * VERTEX_INTS;
  const vertices = context.vertices;
  const z = vertices[at + V.Z];
  if (z <= NEAR_Z) {
    return;
  }
  const half = idiv(SIZE_NUMERATOR, z) >> (polygon.material.subdivision ?? 0);
  if (half === 0) {
    return; // the original divides by zero here (never at the room's depths)
  }
  const step = idiv(TEXTURE_SPAN, 2 * half);
  const sx = vertices[at + V.SX];
  const sy = vertices[at + V.SY];
  let left = sx - half;
  let right = sx + half;
  let top = sy - half;
  let bottom = sy + half;
  if (top >= HEIGHT || bottom < 0 || left >= WIDTH || right < 0) {
    return;
  }
  let v = 0;
  let u0 = 0;
  if (top < 0) {
    v = -top * step;
    top = 0;
  }
  if (left < 0) {
    u0 = -left * step;
    left = 0;
  }
  right = Math.min(right, WIDTH - 1);
  bottom = Math.min(bottom, HEIGHT - 1);
  const texture = polygon.material.texture;
  const table = context.colourTable;
  const target = context.target;
  for (let y = top; y < bottom; y++, v += step) {
    const row = (v >> 8) * TEXTURE_SIZE;
    for (let x = left, u = u0; x < right; x++, u += step) {
      const p = y * WIDTH + x;
      target[p] = table[texture[row + (u >> 8)] * 256 + target[p]];
    }
  }
}
