// The material draw (span) routines by address: what material +0x2c points at. A routine is called
// as draw(polygon, context):
//   polygon: { flags, n, slots (Int32Array, 6 ints per slot: vertex, u, v, s, t, w), material,
//              normal (face-normal record index or -1), key, object, projectorFlags }
//   context: { world, vertices (Int32Array, 9 ints per vertex: x, y, z, nx, ny, nz, sx, sy,
//              projected), faceNormals (Int32Array, 3 per record), target (Uint8Array 320 per row),
//              colourTable (Uint8Array, the 0xfd0a0 table the part filled) }
// Parts install their own routines with setObjectDraw / setTreeDraw (eob.js) or by assigning
// material.draw; this table holds the library's (0x36890 is never chosen by the material pass but
// installed by many parts).

import { drawFlat, drawShadedByV } from './edgetable.js';
import { drawPhong, drawPhongFlat } from './phong.js';
import { drawTexture, drawTexturePhong } from './texture.js';
import { drawPerspectiveTexture } from './perspective.js';
import { drawDepthCuedTexture } from '../routines/r38440.js';
import { storeShadowPlane, storeShadowLight, drawShadowedTexturePhong, drawShadowedPhong } from '../routines/r328a0.js';
import { drawFlare } from '../routines/r31b64.js';

function notPorted(address) {
  return () => {
    throw new Error(`draw routine 0x${address.toString(16)} is not ported (no shipped material selects it)`);
  };
}

const ROUTINES = new Map([
  [0x28b60, drawFlat],
  [0x29994, drawShadedByV],
  [0x2c118, drawPhong],
  [0x44354, drawPhongFlat],
  [0x331b4, drawTexture],
  [0x35860, drawTexturePhong],
  [0x36890, drawPerspectiveTexture],
  [0x38440, drawDepthCuedTexture],
  [0x32788, storeShadowPlane],
  [0x32714, storeShadowLight],
  [0x33170, drawShadowedTexturePhong],
  [0x3315c, drawShadowedPhong],
  [0x31b64, drawFlare],
]);

/** The library routine at `address` (0x29710, 0x2a9fc, 0x2b1a4 throw when called: unused). */
export function drawRoutine(address) {
  return ROUTINES.get(address) ?? notPorted(address);
}
