// Part 2: a mechanical hand takes the gem ("scene - steal", FIRSTS.3DS).
// KAHN.EXE 0x14899 (load), 0x149ba (run), 0x14730 (draw).

import { PALETTE_BYTES, setDac, showBuffer, clearBuffer } from '../machine.js';
import { loadScene, findMesh, findObject, MESH_DRAWN_BY_PART, FACE_SPECIAL, FACE_SPECIAL_2 } from '../engine/scene.js';
import { engine, activateScene, cullAndSort } from '../engine/frame.js';
import { drawFacePerspective, drawMeshUnsorted } from '../engine/faces.js';
import { buildWeightedTable } from '../tables.js';
import { drawTextShadowed } from '../font.js';
import { TICKS, loaderLog, setFrame, animateScene, fadeFromWhite, drawSortedFaces } from './common.js';

const DURATION = TICKS * 17;
const FADE_TICKS = TICKS;
const SECOND_CAMERA_FRAME = 170;
const THIRD_CAMERA_FRAME = 340;
const TEXT_COLOUR = 0x6f;
const TEXT_LEFT = 20;
/** Glass and the gem: 15% of the texture over 85% of what is behind it. */
const GLASS_TEXTURE_WEIGHT = 0.15;
const GLASS_SCREEN_WEIGHT = 0.85;
const ROOM_MESHES = ['Room', 'WallsX', 'Ceilig,Prs', 'Floor'];

export function* loadSteal(demo) {
  const machine = demo.machine;
  yield* loaderLog(demo, 'scene - steal');
  const scene = loadScene(machine, demo.assets, 'scenes\\firsts.3ds', 10);
  const palette = machine.palette.slice();
  yield* loaderLog(demo, 'searching cameras');
  const cameras = [findObject(scene, 'Camera02'), findObject(scene, 'Camera03')];
  yield* loaderLog(demo, 'searching objects');
  const room = ROOM_MESHES.map((name) => findMesh(scene, name));
  for (const mesh of room) {
    mesh.flags |= MESH_DRAWN_BY_PART;
  }
  const pyramid = findMesh(scene, 'pyr-cul');
  yield* loaderLog(demo, 'transparecy table');
  const glassTable = buildWeightedTable(palette, GLASS_TEXTURE_WEIGHT, GLASS_SCREEN_WEIGHT);
  demo.steal = {
    scene, palette, cameras, room, pyramid, glassTable,
    work: new Uint8Array(PALETTE_BYTES),
    isFadingIn: true,
    isSecondCameraPending: true,
    isThirdCameraPending: true,
    isFlashing: true,
    flashStart: null,
  };
}

/** The work buffer is never cleared in this part: the room covers the whole screen. */
function drawSteal(demo, frame) {
  const machine = demo.machine;
  const part = demo.steal;
  for (const mesh of part.room) {
    drawMeshUnsorted(mesh);
  }
  if (frame > SECOND_CAMERA_FRAME) {
    drawMeshUnsorted(part.pyramid);
  }
  drawSortedFaces((face, flags) => {
    if (flags & (FACE_SPECIAL | FACE_SPECIAL_2)) {
      drawFacePerspective(face, part.glassTable);
    } else {
      drawFacePerspective(face);
    }
  });

  const text = (y, line) => drawTextShadowed(demo.font, machine.bufferA, TEXT_LEFT, y, line, TEXT_COLOUR);
  if (frame < SECOND_CAMERA_FRAME) {
    text(170, 'An Energy Source Lies Within the Gem');
  }
  if (frame > SECOND_CAMERA_FRAME && frame < THIRD_CAMERA_FRAME) {
    text(160, '       The Gem Gives Life,');
    text(175, '        To Good And Evil');
  }
  if (frame > THIRD_CAMERA_FRAME) {
    text(170, 'Uh, Seems Like It Is About To Change.');
  }
  showBuffer(machine, machine.bufferA);
}

export function* runSteal(demo) {
  const machine = demo.machine;
  const timer = machine.timerA;
  const part = demo.steal;
  activateScene(part.scene);
  while (timer.value < DURATION) {
    const frame = setFrame(timer.value, DURATION);

    if (part.isFadingIn) {
      if (timer.value < FADE_TICKS) {
        fadeFromWhite(machine, part.palette, part.work, timer.value, FADE_TICKS);
      } else {
        setDac(machine, part.palette);
        part.isFadingIn = false;
      }
    }
    if (part.isSecondCameraPending && frame > SECOND_CAMERA_FRAME) {
      part.isSecondCameraPending = false;
      engine.camera = part.cameras[0];
      part.pyramid.flags |= MESH_DRAWN_BY_PART;
    }
    if (part.isThirdCameraPending && frame > THIRD_CAMERA_FRAME) {
      part.isThirdCameraPending = false;
      engine.camera = part.cameras[1];
    }
    // The cut to the second camera comes with a second fade from white.
    if (!part.isSecondCameraPending && part.isFlashing) {
      if (part.flashStart === null) {
        part.flashStart = timer.value;
      }
      if (part.flashStart + FADE_TICKS > timer.value) {
        fadeFromWhite(machine, part.palette, part.work, timer.value - part.flashStart, FADE_TICKS);
      } else {
        setDac(machine, part.palette);
        part.isFlashing = false;
      }
    }

    animateScene(demo);
    cullAndSort();
    drawSteal(demo, frame);
    yield;
  }
  timer.value -= DURATION;
  clearBuffer(machine.front);
}
