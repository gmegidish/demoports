// Kahn runs through the tunnel with a car after him ("scene - hitcar", HITCAR.3DS).
// The only part with lights: their flares are added into the picture.
// KAHN.EXE 0x16743 (load), 0x1681a (run), 0x16658 (draw).

import { PALETTE_BYTES, setDac, showBuffer, clearBuffer } from '../machine.js';
import { loadScene, findMesh, findObject, MESH_DRAWN_BY_PART, FACE_AFFINE, FACE_PERSPECTIVE, FACE_FLARE } from '../engine/scene.js';
import { engine, activateScene, cullAndSort } from '../engine/frame.js';
import { drawFaceAffine, drawFacePerspective, drawFlare, drawMeshUnsorted } from '../engine/faces.js';
import { buildAdditiveTable } from '../tables.js';
import { drawTextShadowed } from '../font.js';
import { TICKS, loaderLog, setFrame, animateScene, stepFadeIn, whiteDac, drawSortedFaces } from './common.js';

const DURATION = TICKS * 24;
const CAMERA_FRAMES = [500, 545];
const TEXT_FROM_FRAME = 385;
const TEXT_UNTIL_FRAME = 520;
const TEXT_COLOUR = 0x4a;
const TEXT_LEFT = 20;
/** Half the side of a flare, in world units. */
const FLARE_SIZE = 20;

export function* loadHitcar(demo) {
  const machine = demo.machine;
  yield* loaderLog(demo, 'scene - hitcar');
  const scene = loadScene(machine, demo.assets, 'scenes\\hitcar.3ds', FLARE_SIZE);
  const palette = machine.palette.slice();
  yield* loaderLog(demo, 'addative table');
  const additiveTable = buildAdditiveTable(machine.palette);
  yield* loaderLog(demo, 'searching cameras');
  const cameras = [findObject(scene, 'Camera02'), findObject(scene, 'Camera03')];
  const tunnel = findMesh(scene, 'Tun,prs');
  const floor = findMesh(scene, 'Floor,prs');
  tunnel.flags |= MESH_DRAWN_BY_PART;
  floor.flags |= MESH_DRAWN_BY_PART;
  demo.hitcar = {
    scene, palette, additiveTable, cameras, tunnel, floor,
    work: new Uint8Array(PALETTE_BYTES), isFadingIn: true, camerasPending: [true, true],
  };
}

function drawHitcar(demo, frame) {
  const machine = demo.machine;
  const part = demo.hitcar;
  clearBuffer(machine.bufferA);
  drawMeshUnsorted(part.floor);
  drawMeshUnsorted(part.tunnel);
  // This part asks about perspective first.
  drawSortedFaces((face, flags) => {
    if (flags & FACE_PERSPECTIVE) {
      drawFacePerspective(face);
    } else if (flags & FACE_AFFINE) {
      drawFaceAffine(face);
    } else if (flags & FACE_FLARE) {
      drawFlare(face, machine.bufferA, part.additiveTable);
    }
  });
  if (frame > TEXT_FROM_FRAME && frame < TEXT_UNTIL_FRAME) {
    drawTextShadowed(demo.font, machine.bufferA, TEXT_LEFT, 160, '      Oh No, Somebody Is Trying', TEXT_COLOUR);
    drawTextShadowed(demo.font, machine.bufferA, TEXT_LEFT, 175, '            To Stop Me!', TEXT_COLOUR);
  }
  showBuffer(machine, machine.bufferA);
}

export function* runHitcar(demo) {
  const machine = demo.machine;
  const timer = machine.timerA;
  const part = demo.hitcar;
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
    drawHitcar(demo, frame);
    yield;
  }
  timer.value -= DURATION;
  whiteDac(machine);
  clearBuffer(machine.front);
}
