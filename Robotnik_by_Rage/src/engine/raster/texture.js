// Library texture rasterisers on the triangle template: 0x331b4 affine texture and 0x35860
// texture x phong. See E2 §4.4, §4.5.

import { imul } from '../fixed.js';
import { V, VERTEX_INTS, SLOT_INTS, S } from '../layout.js';
import { triangleOf, rasterTemplate, packedChannel, packedIndex, clippedSpan } from './template.js';

/** Packed (u, v) channel of the slots' texture coordinates (×256). */
export function textureChannel(polygon, order) {
  const s = polygon.slots;
  const uv = order.flatMap((k) => [s[k * SLOT_INTS + S.U] << 8, s[k * SLOT_INTS + S.V] << 8]);
  return packedChannel(...uv);
}

/** Packed phong-map channel: ((n + 256) >> 2) << 8 of the vertices' corner normals nx, ny. */
export function phongChannel(vertices, polygon, order) {
  const uv = order.flatMap((k) => {
    const at = polygon.slots[k * SLOT_INTS + S.VERTEX] * VERTEX_INTS;
    return [((vertices[at + V.NX] + 256) >> 2) << 8, ((vertices[at + V.NY] + 256) >> 2) << 8];
  });
  return packedChannel(...uv);
}

function isOutsideHorizontally(xs) {
  return Math.max(...xs) < 0 || Math.min(...xs) >= 320;
}

/** 0x331b4 affine texture (inner loops 0x4fd9b / 0x4fdc9). */
export function drawTexture(polygon, context) {
  const triangle = triangleOf(context.vertices, polygon);
  const texture = polygon.material.texture;
  const target = context.target;
  rasterTemplate(triangle, [textureChannel(polygon, triangle.order)],
    (y, xLong, xShort, isLongLeft, values, dx) => clippedSpan(y, xLong, xShort, isLongLeft, values, dx,
      (at, v) => {
        target[at] = texture?.[packedIndex(v[0])] ?? 0;
      }),
    { rejectBox: isOutsideHorizontally });
}

/**
 * 0x35860 texture x phong: colourTable[R + map[pu, pv]*256 + texel], R = |nz * ambient| & 0x7f00
 * (inner loops 0x50002 / 0x50049; one pixel even when the span has zero length).
 */
export function drawTexturePhong(polygon, context) {
  const vertices = context.vertices;
  const triangle = triangleOf(vertices, polygon);
  const { texture, phongMap } = polygon.material;
  const nz = polygon.normal < 0 ? 0 : context.faceNormals[polygon.normal * 3 + 2];
  const row = Math.abs(imul(nz, polygon.material.ambient)) & 0x7f00;
  const target = context.target;
  const colourTable = context.colourTable;
  rasterTemplate(triangle, [textureChannel(polygon, triangle.order), phongChannel(vertices, polygon, triangle.order)],
    (y, xLong, xShort, isLongLeft, values, dx) => clippedSpan(y, xLong, xShort, isLongLeft, values, dx,
      (at, v) => {
        const light = phongMap[packedIndex(v[1])] ?? 0;
        target[at] = colourTable[row + light * 256 + (texture[packedIndex(v[0])] ?? 0)] ?? 0;
      }, true));
}
