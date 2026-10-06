// Part 1: the creature walks in ("scene - create", CREAT.3DS), then the title picture.
// KAHN.EXE 0x143ac (load), 0x14477 (run), 0x14348 (draw).

import { PALETTE_BYTES, setDac, showBuffer, clearBuffer } from '../machine.js';
import { loadScene, findMesh, MESH_DRAWN_BY_PART, FACE_AFFINE, FACE_PERSPECTIVE } from '../engine/scene.js';
import { loadPicture } from '../engine/pictures.js';
import { activateScene, cullAndSort } from '../engine/frame.js';
import { drawFaceAffine, drawFacePerspective, drawMeshUnsorted } from '../engine/faces.js';
import { TICKS, loaderLog, setFrame, animateScene, whiteDac, drawSortedFaces } from './common.js';

const WALK_TICKS = TICKS * 20;
const LOGO_BLACK_TICKS = TICKS;
const LOGO_FADE_TICKS = TICKS * 2;
const LOGO_HOLD_TICKS = TICKS * 5;
/** Faces of the "Immort" sign whose normal leans this little toward +z get the second texture. */
const FLAT_NORMAL_Z = 0.5;

export function* loadCreate(demo) {
  const machine = demo.machine;
  yield* loaderLog(demo, 'scene - create');
  const scene = loadScene(machine, demo.assets, 'scenes\\creat.3ds', 10);
  const palette = machine.palette.slice();
  yield* loaderLog(demo, 'xtra flat');
  const flatTexture = loadPicture(machine, demo.assets, 'textures\\immor2.gif');
  for (const face of findMesh(scene, 'Immort').faces) {
    if (face.normal[2] < FLAT_NORMAL_Z) {
      face.texture = flatTexture;
    }
  }
  const ground = findMesh(scene, 'objct-prs');
  ground.flags |= MESH_DRAWN_BY_PART;
  demo.create = { scene, palette, ground };
}

function drawCreate(demo) {
  const machine = demo.machine;
  clearBuffer(machine.bufferA);
  drawMeshUnsorted(demo.create.ground);
  drawSortedFaces((face, flags) => {
    if (flags & FACE_AFFINE) {
      drawFaceAffine(face);
    } else if (flags & FACE_PERSPECTIVE) {
      drawFacePerspective(face);
    }
  });
  showBuffer(machine, machine.bufferA);
}

/** The title: a second of black, two seconds up from black, five seconds held, then white. */
function* showLogo(demo) {
  const machine = demo.machine;
  const timer = machine.timerA;
  const work = new Uint8Array(PALETTE_BYTES);
  clearBuffer(machine.front);
  setDac(machine, work);
  // Decoded straight onto the visible screen, under a black palette.
  loadPicture(machine, demo.assets, 'textures\\logo.gif', { into: machine.front });

  while (timer.value < LOGO_BLACK_TICKS) {
    yield;
  }
  timer.value -= LOGO_BLACK_TICKS;

  while (timer.value < LOGO_FADE_TICKS) {
    for (let i = 0; i < PALETTE_BYTES; i++) {
      work[i] = Math.trunc((machine.palette[i] * timer.value) / LOGO_FADE_TICKS) & 0xff;
    }
    setDac(machine, work);
    yield;
  }
  timer.value -= LOGO_FADE_TICKS;
  setDac(machine, machine.palette);

  while (timer.value < LOGO_HOLD_TICKS) {
    clearBuffer(machine.bufferA);
    yield;
  }
  timer.value -= LOGO_HOLD_TICKS;
  whiteDac(machine);
  clearBuffer(machine.front);
}

export function* runCreate(demo) {
  const machine = demo.machine;
  const timer = machine.timerA;
  activateScene(demo.create.scene);
  setDac(machine, demo.create.palette);
  while (timer.value < WALK_TICKS) {
    setFrame(timer.value, WALK_TICKS);
    animateScene(demo);
    cullAndSort();
    drawCreate(demo);
    yield;
  }
  timer.value -= WALK_TICKS;
  yield* showLogo(demo);
}
