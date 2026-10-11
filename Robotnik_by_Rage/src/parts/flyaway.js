// The screen-on-a-quad transitions, drawn by the 3D engine (src/engine/quad.js = 0x27cac QuadWorld:
// the picture on VGA resampled to 256x256 on the 320x200 quad 0x835b8, seen from 256 units back so
// that it exactly covers the screen, perspective texture 0x36890):
//   0x28038 FlyAway(endIdx, vx, vy, vz, ax, ay, az): the grab moves t*(vx, vy, vz) and turns by
//           t*(ax, ay, az) until a sync entry has passed (end of parts 7, 10, ...)
//   0x28168 PictureIntro(pic): the grab tumbles away and back for 256 ticks with `pic` on its back,
//           then `pic` is shown flat (start of part 10)
// Neither loop waits for a tick: one render per frame shown, into the off-screen block 0xe4d40,
// copied to VGA, which clears the block. t = ticks since the setup.

import { frame, syncAdvance, SCREEN_BYTES } from '../machine.js';
import { sin } from '../sine.js';
import { scale } from '../gfx.js';
import {
  createQuadWorld, staticMaterial, RenderWorld, SetObjPos, SetObjAngleX, SetObjAngleY, SetObjAngleZ,
} from '../engine/index.js';
import { grabTexture, QUAD_TEXTURE_SIZE } from '../engine/quad.js';

const WIDTH = 320;
const HEIGHT = 200;
/** The back face's material; its texture is 0x28168's [0x83464]. */
const BACK_MATERIAL = 0xe2cc0;
/** 0x28168: 256 ticks; z = 4 * sin(t) (512 per turn), 24 and 16 angle units per tick about X and Z. */
const INTRO_TICKS = 256;
const INTRO_DEPTH = 4;
const INTRO_SPIN_X = 24;
const INTRO_SPIN_Z = 16;

/** 0x27cac's grab: the screen resampled to the 256x256 texture (0x1d1a0). */
export function grabScreen(screen) {
  return grabTexture(screen);
}

function toShort(value) {
  return (value << 16) >> 16;
}

/** RenderWorld into the off-screen block, copy it to VGA and clear it. */
function present(demo, world) {
  const target = demo.offscreen;
  RenderWorld(world, { target, colourTable: demo.blendTable });
  demo.machine.front.set(target.subarray(0, SCREEN_BYTES));
  target.fill(0);
}

/**
 * Once a part has given the quad a back face (0x28168), the child stays linked and its texture is the
 * freed back picture; the recording shows black where it would turn up, so it gets an empty texture.
 */
function forgetBackPicture(demo, quad) {
  if (quad.child) {
    staticMaterial(demo.image, BACK_MATERIAL).texture = new Uint8Array(QUAD_TEXTURE_SIZE * QUAD_TEXTURE_SIZE);
  }
}

/**
 * 0x28038 FlyAway(endIdx, vx, vy, vz, ax, ay, az): per frame t (ticks since the setup) the quad is
 * at t*(vx, vy, vz) and turned by (short)(t*ax), (short)(t*ay), (short)(t*az). Runs until entry
 * `endIndex` has passed (that frame is still drawn). `startFrame` is [0x91260] at the setup (after a
 * seek, the frame the original would have started at).
 */
export function* flyAway(demo, endIndex, velocity, spin, startFrame = frame(demo.machine)) {
  const m = demo.machine;
  const { world, quad } = createQuadWorld(demo.image, m.front);
  forgetBackPicture(demo, quad);
  if (syncAdvance(m) > endIndex) {
    return;
  }
  for (;;) {
    const t = frame(m) - startFrame;
    const index = syncAdvance(m);
    SetObjPos(quad, velocity[0] * t, velocity[1] * t, velocity[2] * t);
    SetObjAngleX(quad, toShort(spin[0] * t));
    SetObjAngleY(quad, toShort(spin[1] * t));
    SetObjAngleZ(quad, toShort(spin[2] * t));
    present(demo, world);
    if (index > endIndex) {
      return;
    }
    yield;
  }
}

/**
 * 0x28168 PictureIntro(pic): `picture` (320x200) goes on the back of the grabbed screen, which
 * tumbles for 256 ticks from `startFrame`; the last frame drawn has t >= 256. Then `picture` is
 * copied to VGA as it is.
 */
export function* pictureIntro(demo, picture, startFrame = frame(demo.machine)) {
  const m = demo.machine;
  const back = new Uint8Array(QUAD_TEXTURE_SIZE * QUAD_TEXTURE_SIZE);
  scale(picture, WIDTH, HEIGHT, back, QUAD_TEXTURE_SIZE, QUAD_TEXTURE_SIZE);
  const { world, quad } = createQuadWorld(demo.image, m.front, back);
  for (;;) {
    const t = frame(m) - startFrame;
    SetObjPos(quad, 0, 0, INTRO_DEPTH * sin(t));
    SetObjAngleX(quad, toShort(t * INTRO_SPIN_X));
    SetObjAngleZ(quad, toShort(t * INTRO_SPIN_Z));
    present(demo, world);
    if (t >= INTRO_TICKS) {
      break;
    }
    yield;
  }
  m.front.set(picture.subarray(0, SCREEN_BYTES));
}
