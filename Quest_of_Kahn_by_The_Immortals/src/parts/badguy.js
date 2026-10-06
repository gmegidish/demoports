// The villain at his console, twice: "The Power Must Remain Mine" (BADDY.3DS) as its own part,
// and "He Will Never Make It" (BADDY2.3DS) cut into the middle of the bridge.
// KAHN.EXE 0x1622e (load), 0x162c2 / 0x16452 (run), 0x16138 / 0x161bf (draw).

import { PALETTE_BYTES, setDac, showBuffer, clearBuffer } from '../machine.js';
import { loadScene, findMesh, MESH_DRAWN_BY_PART, FACE_AFFINE, FACE_PERSPECTIVE } from '../engine/scene.js';
import { activateScene, cullAndSort } from '../engine/frame.js';
import { drawFaceAffine, drawFacePerspective, drawMeshUnsorted } from '../engine/faces.js';
import { drawTextShadowed } from '../font.js';
import { TICKS, loaderLog, setFrame, animateScene, stepFadeIn, whiteDac, drawSortedFaces } from './common.js';

const DURATION = Math.trunc(TICKS * 5.75);
const TEXT_COLOUR = 0x44;
const TEXT_LEFT = 20;
const TEXT_TOP = 170;

export function* loadBadguy(demo) {
  const machine = demo.machine;
  yield* loaderLog(demo, 'scene - badguy');
  const first = loadScene(machine, demo.assets, 'scenes\\baddy.3ds', 10);
  // Saved once, after the first scene; both use it.
  const palette = machine.palette.slice();
  const panel = findMesh(first, 'panel,prs');
  panel.flags |= MESH_DRAWN_BY_PART;
  const second = loadScene(machine, demo.assets, 'scenes\\baddy2.3ds', 10);
  findMesh(second, 'panel,prs').flags |= MESH_DRAWN_BY_PART;
  demo.badguy = { scenes: [first, second], palette, panel, work: new Uint8Array(PALETTE_BYTES) };
}

function drawBadguy(demo, line) {
  const machine = demo.machine;
  clearBuffer(machine.bufferA);
  // Both scenes draw the first scene's panel: in the second, it stands where the first left it.
  drawMeshUnsorted(demo.badguy.panel);
  drawSortedFaces((face, flags) => {
    if (flags & FACE_AFFINE) {
      drawFaceAffine(face);
    } else if (flags & FACE_PERSPECTIVE) {
      drawFacePerspective(face);
    }
  });
  drawTextShadowed(demo.font, machine.bufferA, TEXT_LEFT, TEXT_TOP, line, TEXT_COLOUR);
  showBuffer(machine, machine.bufferA);
}

function* play(demo, line) {
  const machine = demo.machine;
  const timer = machine.timerA;
  const fade = { palette: demo.badguy.palette, work: demo.badguy.work, isFadingIn: true };
  while (timer.value < DURATION) {
    stepFadeIn(machine, fade, timer.value);
    setFrame(timer.value, DURATION);
    animateScene(demo);
    cullAndSort();
    drawBadguy(demo, line);
    yield;
  }
  timer.value -= DURATION;
  whiteDac(machine);
  clearBuffer(machine.front);
}

export function* runBadguy(demo) {
  activateScene(demo.badguy.scenes[0]);
  yield* play(demo, '     The Power Must Remain Mine');
}

/** Not a part of its own: the bridge calls it between its two halves. */
export function* runBadguy2(demo) {
  activateScene(demo.badguy.scenes[1]);
  setDac(demo.machine, demo.badguy.palette);
  yield* play(demo, '      He Will Never Make It');
}
