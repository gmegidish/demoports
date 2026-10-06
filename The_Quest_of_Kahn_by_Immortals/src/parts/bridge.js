// Kahn crosses the rope bridge ("scene - bridge", BRIDGE.3DS), in two halves with the villain
// cut in between. Frames 385..445 of the scene are never shown.
// KAHN.EXE 0x16bf5 (load), 0x16cdd (run), 0x16acc (draw).

import { PALETTE_BYTES, setDac, showBuffer, clearBuffer } from '../machine.js';
import { loadScene, findMesh, findObject, MESH_DRAWN_BY_PART, FACE_AFFINE, FACE_PERSPECTIVE } from '../engine/scene.js';
import { engine, activateScene, cullAndSort } from '../engine/frame.js';
import { drawFaceAffine, drawFacePerspective, drawMeshUnsorted } from '../engine/faces.js';
import { drawTextShadowed } from '../font.js';
import { TICKS, loaderLog, setFrame, animateScene, stepFadeIn, drawSortedFaces } from './common.js';
import { runBadguy2 } from './badguy.js';

const FIRST_HALF_TICKS = TICKS * 15;
const SECOND_HALF_TICKS = TICKS * 10;
const FIRST_HALF_FRAMES = 385;
const SECOND_HALF_START_FRAME = 445;
const SECOND_CAMERA_FRAME = 250;
const FOURTH_CAMERA_FRAME = 590;
const TEXT_COLOUR = 0x6c;
const TEXT_LEFT = 20;
/** Drawn first, in this order. */
const LAND_MESHES = ['Ground,prs', 'Cliff2,prs', 'Cliff1,prs'];

export function* loadBridge(demo) {
  const machine = demo.machine;
  yield* loaderLog(demo, 'scene - bridge');
  const scene = loadScene(machine, demo.assets, 'scenes\\bridge.3ds', 10);
  const palette = machine.palette.slice();
  yield* loaderLog(demo, 'searching cameras');
  const cameras = ['Camera02', 'Camera03', 'Camera04'].map((name) => findObject(scene, name));
  const land = LAND_MESHES.map((name) => findMesh(scene, name));
  for (const mesh of land) {
    mesh.flags |= MESH_DRAWN_BY_PART;
  }
  demo.bridge = {
    scene, palette, cameras, land,
    work: new Uint8Array(PALETTE_BYTES), isFadingIn: true,
    isSecondCameraPending: true, isFourthCameraPending: true,
  };
}

function drawBridge(demo, frame) {
  const machine = demo.machine;
  clearBuffer(machine.bufferA);
  for (const mesh of demo.bridge.land) {
    drawMeshUnsorted(mesh);
  }
  drawSortedFaces((face, flags) => {
    if (flags & FACE_AFFINE) {
      drawFaceAffine(face);
    } else if (flags & FACE_PERSPECTIVE) {
      drawFacePerspective(face);
    }
  });
  const text = (y, line) => drawTextShadowed(demo.font, machine.bufferA, TEXT_LEFT, y, line, TEXT_COLOUR);
  // As coded: shown before the first camera cut, not between it and the end of the half.
  if (frame < SECOND_CAMERA_FRAME && frame < FIRST_HALF_FRAMES) {
    text(160, ' My Destiny Lies Beyond This Bridge,');
    text(175, '        The Gem Enlightens.');
  }
  if (frame > SECOND_HALF_START_FRAME && frame < FOURTH_CAMERA_FRAME) {
    text(170, '        I Must Reach The Gem');
  }
  showBuffer(machine, machine.bufferA);
}

function* playHalf(demo, duration, onFrame) {
  const machine = demo.machine;
  const timer = machine.timerA;
  const part = demo.bridge;
  while (timer.value < duration) {
    stepFadeIn(machine, part, timer.value);
    const frame = setFrame(timer.value, duration);
    onFrame(frame);
    animateScene(demo);
    cullAndSort();
    drawBridge(demo, frame);
    yield;
  }
  timer.value -= duration;
}

export function* runBridge(demo) {
  const machine = demo.machine;
  const part = demo.bridge;

  activateScene(part.scene);
  setDac(machine, part.palette);
  engine.span = FIRST_HALF_FRAMES;
  yield* playHalf(demo, FIRST_HALF_TICKS, (frame) => {
    if (part.isSecondCameraPending && frame > SECOND_CAMERA_FRAME) {
      part.isSecondCameraPending = false;
      engine.camera = part.cameras[0];
    }
  });

  yield* runBadguy2(demo);

  part.isFadingIn = true;
  activateScene(part.scene);
  engine.span = engine.lastFrame - SECOND_HALF_START_FRAME;
  engine.firstFrame = SECOND_HALF_START_FRAME;
  engine.camera = part.cameras[1];
  yield* playHalf(demo, SECOND_HALF_TICKS, (frame) => {
    if (part.isFourthCameraPending && frame > FOURTH_CAMERA_FRAME) {
      part.isFourthCameraPending = false;
      engine.camera = part.cameras[2];
    }
  });
  // No white here: the palette is left as it is.
  clearBuffer(machine.front);
}
