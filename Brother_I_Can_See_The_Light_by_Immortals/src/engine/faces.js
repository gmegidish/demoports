// Drawing faces of the current scene. The engine only sorts; each part of the demo walks the
// sorted list from the far end and picks one of these per face, by the face's flags.

import { view, drawPerspectiveTriangle, drawAffineTriangle } from './triangle.js';
import { drawScaledSprite } from './raster.js';
import { engine } from './frame.js';

const corners = [new Float32Array(5), new Float32Array(5), new Float32Array(5)];

/** Copy a face's three vertices out of its mesh: view-space position, then texel coordinates. */
function loadCorners(face) {
  const mesh = face.mesh;
  const positions = mesh.view;
  const texels = mesh.uv;
  const indices = [face.a, face.b, face.c];
  for (let i = 0; i < 3; i++) {
    const vertex = indices[i];
    const corner = corners[i];
    corner[0] = positions[vertex * 3];
    corner[1] = positions[vertex * 3 + 1];
    corner[2] = positions[vertex * 3 + 2];
    corner[3] = texels[vertex * 2];
    corner[4] = texels[vertex * 2 + 1];
  }
}

/** Perspective-correct texture; with a table, mixed into the screen through it. 0x24fe0 (Kahn 0x27670, 0x29510). */
export function drawFacePerspective(face, table = null, texture = face.texture) {
  loadCorners(face);
  drawPerspectiveTriangle(corners[0], corners[1], corners[2], texture, table);
}

/** Affine texture. 0x22324 (Kahn 0x24b54). */
export function drawFaceAffine(face) {
  loadCorners(face);
  drawAffineTriangle(corners[0], corners[1], corners[2], face.texture);
}

/**
 * A light's flare: a texture as a screen-aligned square around the light, sized by the scene's
 * user word in world units, mixed into the target through a table. 0x24da4 (Kahn 0x27434).
 */
export function drawFlare(face, target, table) {
  drawFlareAt(face.light.view, 0, face.texture, target, table);
}

/**
 * The same square around any view-space point; the tennis part inlines it for every vertex
 * (0x13b49). No depth test: behind the camera the corners cross and the sprite is rejected.
 */
export function drawFlareAt(positions, at, texture, target, table) {
  const x = positions[at];
  const y = positions[at + 1];
  const z = positions[at + 2];
  const halfSize = engine.scene.userWord;
  const scaleX = view.scaleX * (1.0 / z);
  const scaleY = view.scaleY * (1.0 / z);
  const left = Math.trunc((x - halfSize) * scaleX + view.centreX);
  const top = Math.trunc(view.centreY - (y + halfSize) * scaleY);
  const right = Math.trunc((x + halfSize) * scaleX + view.centreX);
  const bottom = Math.trunc(view.centreY - (y - halfSize) * scaleY);
  drawScaledSprite(target, texture, table, ((top << 16) + left) | 0, ((bottom << 16) + right) | 0);
}
