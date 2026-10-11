// The depth-cued perspective texture mapper 0x38440 (the floor and box of part 14, the cave of part 0):
// 0x36890's setup and row walk (perspectiveTriangle) with its own span 0x4fb9b, which besides u and v
// also takes the depth z = round(1 / (1/z)) at both ends of each 16-pixel block, shifted left by
// material +0x28. The inner loop 0x4fb6f steps c = 0x7fff - z linearly (by (z1 - z0) >> 4 per pixel)
// and writes colourTable[(c >> 8 & 0xff) * 256 + texel]: near is bright, depth 0x4000 >> shift is
// row 64 (identity in part 14's table), far wraps into rows >= 128. The parts' tables hold 128 rows;
// the bss after them is zero, so rows past the table give colour 0.
// Checked against the original in unicorn: test/r38440.test.js (tools/re/r38440_fixtures.py).

import { perspectiveTriangle, perspectiveSpan, roundToEven } from '../raster/perspective.js';
import { packedIndex } from '../raster/template.js';

const START = 0x7fff;
const BLOCK_SHIFT = 4;

/** 0x4fb6f: n pixels (at least one), texel through the colour-table row of the stepped depth. */
function depthCuedRun(target, texture, colourTable, at, n, uv0, duv, depth0, depthStep) {
  let uv = uv0;
  let cue = (START - depth0) | 0;
  const pixels = Math.max(n, 1);
  for (let k = 0; k < pixels; k++) {
    if (at + k < target.length) {
      const texel = texture?.[packedIndex(uv)] ?? 0;
      target[at + k] = colourTable[((cue >> 8) & 0xff) * 256 + texel] ?? 0;
    }
    uv = (uv + duv) | 0;
    cue = (cue - depthStep) | 0;
  }
}

/** 0x38440: material.texture (256 wide), material.depthShift (+0x28), context.colourTable (0xfd0a0). */
export function drawDepthCuedTexture(polygon, context) {
  const { target, colourTable } = context;
  const shift = polygon.material.depthShift ?? 0;
  perspectiveTriangle(polygon, context, (state, rowOffset, x, count) =>
    perspectiveSpan(state, rowOffset, x, count, (at, n, uv, duv, zStart, zEnd) => {
      const depth0 = roundToEven(zStart) << shift;
      const depth1 = roundToEven(zEnd) << shift;
      depthCuedRun(target, state.texture, colourTable, at, n, uv, duv, depth0, ((depth1 - depth0) | 0) >> BLOCK_SHIFT);
    }));
}
