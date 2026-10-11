// The screen-on-a-quad world of the transitions (0x27cac QuadWorld, P0 §8 / P10 §8): the picture
// on VGA resampled to a 256x256 texture on the static 320x200 quad 0x835b8 (two triangles, flags
// 0xc4), seen from 256 units back so that it exactly covers the screen, drawn with the perspective
// mapper 0x36890. With a back picture, the quad gets the child 0x8366c (same corners, reversed
// winding, material 0xe2cc0) and both faces lose the "no backface culling" flag (permanently, as
// they are static data). The loops that move it (0x27e28, 0x27f30, 0x28038, 0x28168, 0x282a0) set
// its position / angles per frame and call RenderWorld into the off-screen buffer.

import { scale } from '../gfx.js';
import { CreateWorld, AddObject, ComputeBounds, SetRenderMode, SetCameraAngles, CameraMoveLocalZ, SetObjPos, SetObjAngleX, SetObjAngleY, SetObjAngleZ } from './world.js';
import { clearTreeFlags } from './eob.js';
import { staticObject, staticMaterial } from './statics.js';
import { drawRoutine } from './raster/routines.js';

const QUAD = 0x835b8;
const QUAD_BACK = 0x8366c;
const FRONT_MATERIAL = 0xe2c90;
const BACK_MATERIAL = 0xe2cc0;
const PERSPECTIVE_TEXTURE = 0x36890;
const NO_BACKFACE_CULL = 4;
const SCREEN_WIDTH = 320;
const SCREEN_HEIGHT = 200;
export const QUAD_TEXTURE_SIZE = 256;
const CAMERA_DISTANCE = -256;
const WORLD_SIZES = [30, 1900, 2700, 2700];
const RENDER_MODE = 3;

/** 0x1d1a0 as 0x27cac uses it: 320x200 -> 256x256. */
export function grabTexture(screen) {
  const texture = new Uint8Array(QUAD_TEXTURE_SIZE * QUAD_TEXTURE_SIZE);
  scale(screen, SCREEN_WIDTH, SCREEN_HEIGHT, texture, QUAD_TEXTURE_SIZE, QUAD_TEXTURE_SIZE);
  return texture;
}

function useTexture(material, texture) {
  material.texture = texture;
  material.subdivision = 1; // +0x28
  material.drawAddress = PERSPECTIVE_TEXTURE;
  material.draw = drawRoutine(PERSPECTIVE_TEXTURE);
}

/**
 * 0x27cac QuadWorld(withBack): `screen` = what VGA shows now; `backTexture` ([0x83464], 256x256)
 * or null. Returns { world, quad }; render with RenderWorld(world, { target, colourTable }).
 */
export function createQuadWorld(image, screen, backTexture = null) {
  const quad = staticObject(image, QUAD);
  const front = grabTexture(screen);
  if (backTexture) {
    quad.child = staticObject(image, QUAD_BACK);
    clearTreeFlags(quad, NO_BACKFACE_CULL);
    useTexture(staticMaterial(image, BACK_MATERIAL), backTexture);
  }
  const world = CreateWorld(...WORLD_SIZES);
  useTexture(staticMaterial(image, FRONT_MATERIAL), front);
  SetObjPos(quad, 0, 0, 0);
  SetObjAngleX(quad, 0);
  SetObjAngleY(quad, 0);
  SetObjAngleZ(quad, 0);
  SetCameraAngles(world, [0, 0, 0]);
  CameraMoveLocalZ(world, CAMERA_DISTANCE);
  AddObject(world, quad);
  ComputeBounds(world);
  SetRenderMode(world, RENDER_MODE);
  return { world, quad, front };
}
