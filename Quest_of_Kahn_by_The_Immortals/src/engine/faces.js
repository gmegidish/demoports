// Drawing faces of the current scene. The engine only sorts; each part of the demo walks the
// sorted list from the far end and picks one of these per face, by the face's flags.

import { view, drawPerspectiveTriangle, drawAffineTriangle, drawShadeTriangle } from './triangle.js';
import { drawScaledSprite } from './raster.js';
import { engine, isFaceVisible } from './frame.js';

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

/** Perspective-correct texture; with a table, mixed into the screen through it. 0x27670, 0x29510. */
export function drawFacePerspective(face, table = null, texture = face.texture) {
  loadCorners(face);
  drawPerspectiveTriangle(corners[0], corners[1], corners[2], texture, table);
}

/** Affine texture. 0x24b54. */
export function drawFaceAffine(face) {
  loadCorners(face);
  drawAffineTriangle(corners[0], corners[1], corners[2], face.texture);
}

/** The vertices' u is a level, the screen is re-coloured through a table. 0x2b3c0. */
export function drawFaceShade(face, table) {
  loadCorners(face);
  drawShadeTriangle(corners[0], corners[1], corners[2], table);
}

/**
 * A light's flare: its texture as a screen-aligned square around the light, sized by the scene's
 * user word in world units, mixed into the target through a table. 0x27434.
 */
export function drawFlare(face, target, table) {
  const position = face.light.view;
  const halfSize = engine.scene.userWord;
  const scaleX = view.scaleX * (1.0 / position[2]);
  const scaleY = view.scaleY * (1.0 / position[2]);
  const left = Math.trunc((position[0] - halfSize) * scaleX + view.centreX);
  const top = Math.trunc(view.centreY - (position[1] + halfSize) * scaleY);
  const right = Math.trunc((position[0] + halfSize) * scaleX + view.centreX);
  const bottom = Math.trunc(view.centreY - (position[1] - halfSize) * scaleY);
  drawScaledSprite(target, face.texture, table, ((top << 16) + left) | 0, ((bottom << 16) + right) | 0);
}

/**
 * The big flat meshes (floors, walls, ceilings) are kept out of the sorted list and drawn first,
 * whole, last face first, with the perspective drawer. Seven identical copies of this loop exist
 * in the original, one per part: 0x14294, 0x1467c, 0x14d9c, 0x16084, 0x165a4, 0x16a18, 0x16ff4.
 */
export function drawMeshUnsorted(mesh) {
  const faces = mesh.faces;
  for (let i = faces.length - 1; i >= 0; i--) {
    if (isFaceVisible(faces[i], false)) {
      drawFacePerspective(faces[i]);
    }
  }
}
