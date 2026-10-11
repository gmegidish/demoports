// Intro part 1: "presents" zooms out of the middle of presents.raw, then the 3D "robotnik" logo
// (logo.eob) flies over the picture. Ports init 0x21db4 (with the table 0x21d7c main builds), run
// 0x21f44 and deinit 0x2215c. The logo is drawn by the 3D engine (src/engine): its one material
// (0x29994) brightens the picture under each face by the face's texture v.

import { frame, syncAdvance, setDac, entryFrame, SCREEN_BYTES } from '../machine.js';
import { zoomBlit, buildBrightenTable } from '../gfx.js';
import {
  LoadObject, CreateWorld, AddObject, ComputeBounds, SetRenderMode, SetCameraPos, CameraPitchLocal,
  CameraMoveLocalZ, CameraMoveLocalY, SetObjPos, SetObjAngleX, SetObjAngleY, SetObjAngleZ, ScalePoints,
  ScaleKeys, RenderWorld,
} from '../engine/index.js';

const WIDTH = 320;
const HEIGHT = 200;
const PALETTE_BYTES = 0x300;
/** 0x21d7c: 32 levels of the presents palette towards white, doubled into the 64 rows of 0xfd0a0. */
const BRIGHTEN_LEVELS = 32;
const SHADE_LEVELS = 64;

/** Zoom out: 409/256 px across and 1 px down per frame, from the centre to the whole picture. */
const ZOOM_X_STEP = 409;
const CENTRE_X = 160;
const CENTRE_Y = 100;

/** The logo's camera (units of 1/256): x and z move per frame from where 0x21f44 starts them. */
const CAMERA_START_X = -2150;
const CAMERA_X_PER_FRAME = 23;
const CAMERA_Y = 1250;
const CAMERA_START_Z = 2350;
const CAMERA_Z_PER_FRAME = -3;
/** Frames between the frame counter a logo pass reads and the moment its picture shows. */
const RENDER_LAG_FRAMES = 1;
/** Init 0x21db4: the camera's start pose and the logo's position, units of 1/256. */
const CAMERA_PITCH = 0x400;
const CAMERA_BACK = -5000;
const CAMERA_UP = 3000;
const CAMERA_START = [-2500, 1250, 2350];
const LOGO_POSITION = [0, 0, 2000];
/** camera_create(30, 1900, 2700, 2700) as every part calls it; mode 3 = near clipping. */
const WORLD_SIZES = [30, 1900, 2700, 2700];
const RENDER_MODE = 3;

function* waitForEntry(demo, entry) {
  while (syncAdvance(demo.machine) <= entry) {
    yield;
  }
}

/**
 * The setup half of init 0x21db4: camera_create, rotate about X by 0x400, move along its own Z by
 * -5000 and Y by 3000, position (-2500,1250,2350); logo.eob at (0,0,2000), angles 0, points scaled
 * twice by 1/256 (0x39ad0) and keys by 1/256 (0x39bfc), bounding boxes (0x3a598), render mode 3.
 * See docs/disassembly/P1_presents_credits.md.
 */
export function createLogoScene(demo) {
  const world = CreateWorld(...WORLD_SIZES);
  CameraPitchLocal(world, CAMERA_PITCH);
  CameraMoveLocalZ(world, CAMERA_BACK);
  CameraMoveLocalY(world, CAMERA_UP);
  SetCameraPos(world, ...CAMERA_START);
  const logo = LoadObject(demo.archive, 'logo.eob');
  SetObjPos(logo, ...LOGO_POSITION);
  SetObjAngleX(logo, 0);
  SetObjAngleY(logo, 0);
  SetObjAngleZ(logo, 0);
  AddObject(world, logo);
  ScalePoints(logo, 1);
  ScalePoints(logo, 1);
  ScaleKeys(logo, 1);
  ComputeBounds(world);
  SetRenderMode(world, RENDER_MODE);
  return { world, logo };
}

/**
 * One pass of part B of 0x21f44: camera_set_position (0x3a114) at (x, y, z) in 1/256 units, then
 * render_world (0x3a4e0) into `target` (the off-screen buffer 0xe4d40, which holds presents.raw),
 * shaded through `shade` (64 x 256, 0xfd0a0).
 */
export function renderLogo(scene, target, shade, x, y, z) {
  SetCameraPos(scene.world, x, y, z);
  RenderWorld(scene.world, { target, colourTable: shade });
}

export const presents = {
  /** 0x21db4 (+ 0x21d7c from main): the picture, its palette on the DAC, the shade table, the scene. */
  init(demo) {
    const file = demo.archive.read('presents.raw');
    const palette = file.subarray(0, PALETTE_BYTES);
    setDac(demo.machine, palette);
    const brighten = buildBrightenTable(BRIGHTEN_LEVELS, palette);
    const shade = new Uint8Array(SHADE_LEVELS * 256);
    for (let j = 0; j < SHADE_LEVELS; j++) {
      shade.set(brighten.subarray((j >> 1) * 256, ((j >> 1) + 1) * 256), j * 256);
    }
    return {
      picture: file.subarray(PALETTE_BYTES, PALETTE_BYTES + SCREEN_BYTES),
      shade,
      scene: createLogoScene(demo),
    };
  },

  /** 0x21f44(5): the zoom from entry 5, the logo from entry 6 until entry 7 has passed. */
  *run(demo, state, firstSync) {
    yield* waitForEntry(demo, firstSync);
    yield* zoomOut(demo, state, entryFrame(demo.machine, firstSync));
    yield* waitForEntry(demo, firstSync + 1);
    yield* flyLogo(demo, state, entryFrame(demo.machine, firstSync + 1), firstSync + 2);
  },
};

/**
 * Part A: one pass per tick; a pass reads the frame counter, waits for the tick and draws, so the
 * picture of frame f shows at f + 1. It ends with the exact picture once the top edge reaches row 0.
 */
function* zoomOut(demo, state, startFrame) {
  const m = demo.machine;
  for (;;) {
    const elapsed = Math.min(Math.max(frame(m) - 1 - startFrame, 0), CENTRE_Y);
    const across = elapsed * 256 * ZOOM_X_STEP;
    const top = (CENTRE_Y - elapsed) << 16;
    const bottom = (CENTRE_Y + elapsed) << 16;
    zoomBlit(state.picture, m.front, ((CENTRE_X << 16) - across) >> 16, top >> 16, ((CENTRE_X << 16) + across) >> 16, bottom >> 16);
    if (top <= 0) {
      m.front.set(state.picture);
      return;
    }
    yield;
  }
}

/**
 * Part B: no tick wait, one render per pass (DOSBox showed one about every second frame; the motion
 * is per frame). The screen gets the off-screen buffer, which is then reset to the clean picture, so
 * the first pass shows whatever the buffer held. Rows 0 and 199 are cleared at the end.
 * A pass reads the frame counter before it renders and copies, so what is on screen at frame f was
 * computed a little earlier: matched against the recording (31.4-33.6 s), the shown camera lags
 * by 0..3 frames, about one on average (RENDER_LAG_FRAMES).
 */
function* flyLogo(demo, state, startFrame, lastEntry) {
  const m = demo.machine;
  const target = demo.offscreen;
  for (;;) {
    const elapsed = Math.max(frame(m) - RENDER_LAG_FRAMES - startFrame, 0);
    const isLast = syncAdvance(m) > lastEntry;
    renderLogo(state.scene, target, state.shade,
      CAMERA_START_X + CAMERA_X_PER_FRAME * elapsed, CAMERA_Y, CAMERA_START_Z + CAMERA_Z_PER_FRAME * elapsed);
    m.front.set(target);
    target.set(state.picture);
    if (isLast) {
      break;
    }
    yield;
  }
  m.front.fill(0, 0, WIDTH);
  m.front.fill(0, (HEIGHT - 1) * WIDTH, HEIGHT * WIDTH);
}
