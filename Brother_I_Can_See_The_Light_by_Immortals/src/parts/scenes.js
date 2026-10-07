// Parts 3 and 5, the two 3D Studio scenes. Both play the scene over 26 seconds of timer A, cut
// between the scene's two cameras on row 0 of every new song position with a flash from white,
// and draw into work buffer A with flares mixed in through an additive table.
// Part 3: SHPITZ.3DS, the spiked star. TEST.EXE 0x134da (load), 0x13559 (run).
// Part 5: TENNISB.3DS, the player drawn as a cloud of flares. TEST.EXE 0x138b4 (load), 0x13933 (run).

import { setDac, clearBuffer, showBuffer, playStatus, TICKS_PER_SECOND } from '../machine.js';
import { loadScene, findObject, FACE_AFFINE, FACE_PERSPECTIVE, FACE_FLARE, NODE_MESH } from '../engine/scene.js';
import { engine, activateScene, animate, cullAndSort } from '../engine/frame.js';
import { view } from '../engine/triangle.js';
import { drawFaceAffine, drawFacePerspective, drawFlare, drawFlareAt } from '../engine/faces.js';
import { loadPicture } from '../engine/pictures.js';
import { buildAdditiveTable } from '../tables.js';
import { whitenDac } from './common.js';

/** Both scenes run their animation over 26 seconds of timer A ([0x58474] * 26). */
const DURATION = TICKS_PER_SECOND * 26;
/** Flare half-size in world units: the loader's user word. */
const FLARE_HALF_SIZE = 0x14;
const FADE_PER_TICK = 0.01;
/** How many extra times to evaluate the keyframer after a jump in time: its cursors move one key a call. */
const SETTLE_PASSES = 96;
const f = Math.fround;

function loadScenePart(demo, sceneFile, flareFile) {
  const { machine, assets } = demo;
  const scene = loadScene(machine, assets, sceneFile, FLARE_HALF_SIZE);
  const flare = loadPicture(machine, assets, flareFile);
  return {
    scene,
    flare: flare.pixels,
    // The scene's pictures and its flare share one palette; the table is built from the flare's.
    additive: buildAdditiveTable(machine.lastPalette),
    cameras: [findObject(scene, 'Camera01'), findObject(scene, 'Camera02')],
  };
}

export function loadShpitz(demo) {
  demo.shpitz = loadScenePart(demo, 'shpitz.3ds', 'flare2.gif');
}

export function loadTennis(demo) {
  demo.tennis = loadScenePart(demo, 'tennisb.3ds', 'flare3.gif');
}

/** Part 3's draw loop: by flag, affine first, then perspective, then the lights' flares. 0x1370c. */
function drawShpitz(machine, part) {
  const sorted = engine.sorted;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const face = sorted[i];
    if (face.flags & FACE_AFFINE) {
      drawFaceAffine(face);
    } else if (face.flags & FACE_PERSPECTIVE) {
      drawFacePerspective(face);
    } else if (face.flags & FACE_FLARE) {
      face.texture = part.flare;
      drawFlare(face, machine.bufferA, part.additive);
    }
  }
}

/**
 * Part 5's: every sorted face in perspective, no flag test (only the room and the light are in the
 * list: every other mesh is hidden), then a flare on every vertex of every mesh, hidden or not.
 */
function drawTennis(machine, part) {
  const sorted = engine.sorted;
  for (let i = sorted.length - 1; i >= 0; i--) {
    // The light's flare face goes to the perspective drawer too, but its three corners are the
    // same point: nothing is drawn.
    if (!(sorted[i].flags & FACE_FLARE)) {
      drawFacePerspective(sorted[i]);
    }
  }
  for (const node of engine.scene.nodes) {
    if (node.type !== NODE_MESH) {
      continue;
    }
    const positions = node.object.view;
    for (let at = 0; at < positions.length; at += 3) {
      drawFlareAt(positions, at, part.flare, machine.bufferA, part.additive);
    }
  }
}

/**
 * @param {boolean} isFirstCutTaken whether the first frame still sees row 0 of the first position,
 *   so that the cut fires at once. It depends on how long the previous part's last frame took: in
 *   the recording it does for part 3 (which starts on Camera02) and not for part 5 (Camera01).
 */
function* runScene(demo, part, firstPosition, lastPosition, isFirstCutTaken, draw) {
  const machine = demo.machine;
  const scene = part.scene;
  activateScene(scene);
  setDac(machine, scene.palette);
  view.target = machine.bufferA;
  let isFadingIn = true;
  let isFlashing = false;
  let lastSeen = 0;
  machine.timerA.zeroAtRow(firstPosition, 0);
  let position = playStatus(machine).position;
  while (position <= lastPosition) {
    const fade = f(1 - machine.timerA.value * FADE_PER_TICK);
    if (fade < 0) {
      setDac(machine, scene.palette);
      isFadingIn = false;
    } else if (isFadingIn) {
      whitenDac(machine, scene.palette, fade);
    }
    if (isFlashing) {
      const flash = f(1 - machine.timerB.value * FADE_PER_TICK);
      if (flash < 0) {
        setDac(machine, scene.palette);
        isFlashing = false;
      } else {
        whitenDac(machine, scene.palette, flash);
      }
    }
    position = playStatus(machine).position;
    engine.frame = f((machine.timerA.value * engine.span) / DURATION + engine.firstFrame);
    // The original cuts when it sees row 0 of a new position; a frame can miss row 0, so the port
    // cuts on the new position and dates the cut back to its row 0.
    if (position !== lastSeen) {
      for (let p = lastSeen + 1; p <= position; p++) {
        if (p > firstPosition || (p === firstPosition && isFirstCutTaken)) {
          engine.camera = engine.camera === part.cameras[0] ? part.cameras[1] : part.cameras[0];
        }
      }
      lastSeen = position;
      isFlashing = true;
      machine.timerB.zeroAtRow(position, 0);
    }
    if (demo.isSettling) {
      for (let pass = 0; pass < SETTLE_PASSES; pass++) {
        animate();
      }
      demo.isSettling = false;
    }
    animate();
    cullAndSort();
    clearBuffer(machine.bufferA);
    draw(machine, part);
    showBuffer(machine, machine.bufferA);
    yield;
  }
}

export function* runShpitz(demo) {
  yield* runScene(demo, demo.shpitz, 10, 13, true, drawShpitz);
}

export function* runTennis(demo) {
  yield* runScene(demo, demo.tennis, 18, 23, false, drawTennis);
}
