// Kahn finds the gem and the villain demands it ("scene - return", BADGUY.3DS).
// KAHN.EXE 0x17221 (load), 0x17322 (run), 0x170a8 (draw).

import { PALETTE_BYTES, setDac, showBuffer, clearBuffer } from '../machine.js';
import { loadScene, findMesh, findObject, MESH_DRAWN_BY_PART, FACE_AFFINE, FACE_PERSPECTIVE } from '../engine/scene.js';
import { engine, activateScene, cullAndSort } from '../engine/frame.js';
import { drawFaceAffine, drawFacePerspective, drawMeshUnsorted } from '../engine/faces.js';
import { drawTextShadowed } from '../font.js';
import { TICKS, loaderLog, setFrame, animateScene, stepFadeIn, whiteDac, drawSortedFaces } from './common.js';

const DURATION = TICKS * 29;
const CAMERA_FRAMES = [90, 270, 340];
const TEXT_COLOUR = 0x10;
const VILLAIN_TEXT_COLOUR = 0x11;
const TEXT_LEFT = 20;
const ROOM_MESHES = ['Room,prs', 'Floor,prs', 'Ramp,prs'];

export function* loadReturn(demo) {
  const machine = demo.machine;
  yield* loaderLog(demo, 'scene - return');
  const scene = loadScene(machine, demo.assets, 'scenes\\badguy.3ds', 10);
  const palette = machine.palette.slice();
  yield* loaderLog(demo, 'searching cameras');
  const cameras = ['Camera02', 'Camera03', 'Camera04'].map((name) => findObject(scene, name));
  yield* loaderLog(demo, 'searching objects');
  const room = ROOM_MESHES.map((name) => findMesh(scene, name));
  for (const mesh of room) {
    mesh.flags |= MESH_DRAWN_BY_PART;
  }
  demo.return = {
    scene, palette, cameras, room,
    work: new Uint8Array(PALETTE_BYTES), isFadingIn: true, camerasPending: [true, true, true],
  };
}

function drawReturn(demo, frame) {
  const machine = demo.machine;
  clearBuffer(machine.bufferA);
  for (const mesh of demo.return.room) {
    drawMeshUnsorted(mesh);
  }
  drawSortedFaces((face, flags) => {
    if (flags & FACE_AFFINE) {
      drawFaceAffine(face);
    } else if (flags & FACE_PERSPECTIVE) {
      drawFacePerspective(face);
    }
  });
  const text = (y, line, colour = TEXT_COLOUR) => drawTextShadowed(demo.font, machine.bufferA, TEXT_LEFT, y, line, colour);
  if (frame > 240 && frame < 335) {
    text(170, '    The Gem, I Have Found It!');
  }
  if (frame > 345 && frame < 390) {
    text(170, '    It Is Ours Once Again...');
  }
  if (frame > 400 && frame < 435) {
    text(160, '    Hand Over The Gem, Kahn!', VILLAIN_TEXT_COLOUR);
  }
  if (frame > 440) {
    text(170, '             Never!');
  }
  showBuffer(machine, machine.bufferA);
}

export function* runReturn(demo) {
  const machine = demo.machine;
  const timer = machine.timerA;
  const part = demo.return;
  activateScene(part.scene);
  setDac(machine, part.palette);
  while (timer.value < DURATION) {
    stepFadeIn(machine, part, timer.value);
    const frame = setFrame(timer.value, DURATION);
    CAMERA_FRAMES.forEach((cutFrame, index) => {
      if (part.camerasPending[index] && frame > cutFrame) {
        part.camerasPending[index] = false;
        engine.camera = part.cameras[index];
      }
    });
    animateScene(demo);
    cullAndSort();
    drawReturn(demo, frame);
    yield;
  }
  timer.value -= DURATION;
  whiteDac(machine);
  clearBuffer(machine.front);
}
