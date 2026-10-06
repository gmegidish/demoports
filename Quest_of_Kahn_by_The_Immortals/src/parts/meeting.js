// Part 3: the creatures meet around the lamp and decide to call Kahn ("scene - meeting", SECONDS.3DS).
// KAHN.EXE 0x14fed (load), 0x15162 (run), 0x14e4f (draw).

import { setDac, showBuffer, clearBuffer } from '../machine.js';
import { loadScene, findMesh, findObject, MESH_DRAWN_BY_PART, FACE_AFFINE, FACE_PERSPECTIVE, FACE_SPECIAL } from '../engine/scene.js';
import { engine, activateScene, cullAndSort } from '../engine/frame.js';
import { drawFaceAffine, drawFacePerspective, drawFaceShade, drawMeshUnsorted } from '../engine/faces.js';
import { buildBrightenTable } from '../tables.js';
import { drawTextShadowed } from '../font.js';
import { TICKS, loaderLog, setFrame, animateScene, whiteDac, drawSortedFaces } from './common.js';

const DURATION = Math.trunc(TICKS * 27.8);
const CAMERA_FRAMES = [220, 345, 500];
/** Until this frame the room covers the screen and the work buffer is not cleared. */
const CLEAR_AFTER_FRAME = 370;
const TEXT_COLOUR = 0x6b;
const KAHN_TEXT_COLOUR = 0x29;
const TEXT_LEFT = 20;
const TEXT_TOP = 170;
/** Drawn first, in this order. */
const ROOM_MESHES = ['WallsX,prs', 'Wallsy,prs', 'DoorX,prs', 'Floot-prs', 'Ceil-prs'];
/** The lamp's cone is not textured: its vertices carry a brightness, full at the lamp end. */
const CONE_LEVEL = 50;

export function* loadMeeting(demo) {
  const machine = demo.machine;
  yield* loaderLog(demo, 'scene - meeting');
  const scene = loadScene(machine, demo.assets, 'scenes\\seconds.3ds', 10);
  const palette = machine.palette.slice();
  yield* loaderLog(demo, 'searching cameras');
  const cameras = ['Camera02', 'Camera03', 'Camera04'].map((name) => findObject(scene, name));
  yield* loaderLog(demo, 'searching objects');
  const room = ROOM_MESHES.map((name) => findMesh(scene, name));
  for (const mesh of room) {
    mesh.flags |= MESH_DRAWN_BY_PART;
  }
  const cone = findMesh(scene, 'cul-spc');
  yield* loaderLog(demo, 'shade table');
  const coneTable = buildBrightenTable(palette);
  yield* loaderLog(demo, 'update cone');
  for (let vertex = 0; vertex < cone.vertexCount; vertex++) {
    // The mapping's v, undone from texel units, splits the cone into its bright and dark ends.
    const fileV = (cone.uv[vertex * 2 + 1] + -8192.0) / -256.0;
    cone.uv[vertex * 2] = fileV >= 0.5 ? CONE_LEVEL : 0;
  }
  demo.meeting = { scene, palette, cameras, room, coneTable, camerasPending: [true, true, true] };
}

function drawMeeting(demo, frame) {
  const machine = demo.machine;
  const part = demo.meeting;
  if (frame > CLEAR_AFTER_FRAME) {
    clearBuffer(machine.bufferA);
  }
  for (const mesh of part.room) {
    drawMeshUnsorted(mesh);
  }
  drawSortedFaces((face, flags) => {
    if (flags & FACE_SPECIAL) {
      drawFaceShade(face, part.coneTable);
    } else if (flags & FACE_AFFINE) {
      drawFaceAffine(face);
    } else if (flags & FACE_PERSPECTIVE) {
      drawFacePerspective(face);
    }
  });

  const text = (line, colour) => drawTextShadowed(demo.font, machine.bufferA, TEXT_LEFT, TEXT_TOP, line, colour);
  if (frame < 219) {
    text(' The Gem Is Gone, We Are Doomed!', TEXT_COLOUR);
  }
  if (frame > 221 && frame < 282) {
    text('   We Have Only One Option Left...', TEXT_COLOUR);
  }
  if (frame > 283 && frame < 345) {
    text('           Call Kahn', TEXT_COLOUR);
  }
  if (frame > 500) {
    text('     I Will Reclaim Our Power.', KAHN_TEXT_COLOUR);
  }
  showBuffer(machine, machine.bufferA);
}

export function* runMeeting(demo) {
  const machine = demo.machine;
  const timer = machine.timerA;
  const part = demo.meeting;
  activateScene(part.scene);
  setDac(machine, part.palette);
  while (timer.value < DURATION) {
    const frame = setFrame(timer.value, DURATION);
    CAMERA_FRAMES.forEach((cutFrame, index) => {
      if (part.camerasPending[index] && frame > cutFrame) {
        part.camerasPending[index] = false;
        engine.camera = part.cameras[index];
      }
    });
    animateScene(demo);
    cullAndSort();
    drawMeeting(demo, frame);
    yield;
  }
  timer.value -= DURATION;
  whiteDac(machine);
  clearBuffer(machine.front);
}
