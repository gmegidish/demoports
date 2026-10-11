// Demo part 9: the robot dancing in an octagonal room with a "rage mirror" (a second render of the
// scene from the mirror's centre) and a "rage tv" (the previous frame), while two "RAGE" blocks sink
// from the ceiling and finally slide together; then the robot loses its head and sinks through the
// floor. Ports init 0x1f064, run 0x1ea28(9) and deinit 0x1f008; the scene is built in
// robotscene.js, the panels and the mirror camera are in robotpanels.js. The camera plays
// cy_cam1.rec, one record per tick. See docs/disassembly/P9_robot.md.
//
// Init also fills rows 0..127 of the blend table 0xfd0a0 (demo.blendTable), which part 10 relies on;
// the sequencer always runs init, even when the part is skipped.

import { frame, syncAdvance, resyncFrame, entryFrame, setDac, SCREEN_BYTES } from '../machine.js';
import {
  AnimLength, AnimateTree, RenderWorld, SetObjPos, SetObjAngleZ, setTreeFlags, FLAG,
  readCameraRecording, cameraRecordCount, playCameraRecord,
} from '../engine/index.js';
import { sext16 } from '../engine/fixed.js';
import { buildScene } from './robotscene.js';
import { renderMirror } from './robotpanels.js';

/**
 * The run loop never waits: each pass reads the tick counter, renders the mirror and the room and
 * copies the result to the screen. demo.avi shows a new picture about every 5 ticks over the whole
 * part (5.04 on average, 2..7 depending on what is in view). The port renders on every 5th tick
 * since the loop started and shows the picture 5 ticks later, when the original's copy ends.
 */
const RENDER_TICKS = 5;
/** Phase A: the blocks sink 1 unit per tick from 2000 above their rest (y 4500) to it. */
const BLOCK_DROP = 2000;
const BLOCK_REST_Y = 4500;
const BLOCK_Z = -950;
/** Phase B (from entry 10): they slide together 64 units per tick until they touch (1400). */
const BLOCK_START_DISTANCE = 3500;
const BLOCK_TOUCH_DISTANCE = 1400;
const BLOCK_SLIDE_SPEED = 64;
/** The dance: 40 animation units per tick, 200 once the blocks touch; the spin is 4 units per tick. */
const DANCE_SPEED = 40;
const END_DANCE_SPEED = 200;
const SPIN_PER_TICK = 4;
/** In the end the lower body (and all above it) sinks 30 units per tick along the model's z (up). */
const SINK_PER_TICK = 30;

function blockPositions(scene, distance, drop) {
  const [blockA, blockB] = scene.blocks;
  const base = scene.root.position;
  const y = base[1] + drop + BLOCK_REST_Y;
  SetObjPos(blockA, base[0] + distance - BLOCK_TOUCH_DISTANCE, y, base[2] + BLOCK_Z);
  SetObjPos(blockB, base[0] - BLOCK_TOUCH_DISTANCE - distance, y, base[2] + BLOCK_Z);
}

/** One pass of 0x1ea28's loop up to the renders: phases, blocks, camera, dance. */
function advance(state, elapsed, isSliding) {
  const { scene, motion } = state;
  const delta = elapsed - motion.elapsed;
  motion.elapsed = elapsed;
  if (!isSliding) {
    motion.drop = Math.max(motion.drop - delta, 0);
  } else {
    motion.distance = Math.max(motion.distance - BLOCK_SLIDE_SPEED * delta, BLOCK_TOUCH_DISTANCE);
  }
  blockPositions(scene, motion.distance, motion.drop);
  // No bounds check in the original (it reads past the file); the port holds the last record.
  playCameraRecord(scene.world, state.camera, Math.min(elapsed, cameraRecordCount(state.camera) - 1));
  const isTouching = motion.distance === BLOCK_TOUCH_DISTANCE;
  motion.time += delta * (isTouching ? END_DANCE_SPEED : DANCE_SPEED);
  while (motion.time >= state.length) {
    motion.time -= state.length;
  }
  if (!isTouching) {
    SetObjAngleZ(scene.lowerBody, sext16(elapsed * SPIN_PER_TICK));
  } else {
    setTreeFlags(scene.head, FLAG.HIDDEN);
    scene.lowerBody.position[2] -= SINK_PER_TICK * delta;
  }
  AnimateTree(scene.root, motion.time);
}

/** RenderMirror into the mirror's picture, then the room into 0xe4d40. */
function render(demo, scene) {
  renderMirror(scene.world, scene.buffers.mirror, scene, demo.blendTable);
  RenderWorld(scene.world, { target: demo.offscreen, colourTable: demo.blendTable });
}

/** The copy of 0xe4d40 to the TV's picture and to the screen. */
function present(demo, scene) {
  scene.buffers.tv.set(demo.offscreen);
  demo.machine.front.set(demo.offscreen.subarray(0, SCREEN_BYTES));
}

export const robot = {
  /** 0x1f064: the scene, the blend table, cy_pal.col straight to the DAC, the camera path. */
  init(demo) {
    const scene = buildScene(demo);
    setDac(demo.machine, demo.archive.read('cy_pal.col'));
    return {
      scene,
      camera: readCameraRecording(demo.archive.read('cy_cam1.rec')),
      length: AnimLength(scene.root),
      motion: { elapsed: 0, drop: BLOCK_DROP, distance: BLOCK_START_DISTANCE, time: 0 },
    };
  },

  /**
   * 0x1ea28(9): from entry 9 until a pass sees entry 11, which is still drawn. Phase A (the blocks
   * sink) until entry 10, then phase B. A pass at tick t shows its picture at t + RENDER_TICKS.
   */
  *run(demo, state, firstSync) {
    const m = demo.machine;
    while (syncAdvance(m) <= firstSync) {
      yield;
    }
    resyncFrame(m);
    const start = entryFrame(m, firstSync);
    const slidingFrom = entryFrame(m, firstSync + 1) - start;
    const lastFrom = entryFrame(m, firstSync + 2) - start;
    for (;;) {
      const ticks = Math.max(frame(m) - start, 0);
      const elapsed = ticks - (ticks % RENDER_TICKS);
      // After a jump in time, the passes the original would have made in between (unrendered).
      for (let missed = state.motion.elapsed + RENDER_TICKS; missed < elapsed; missed += RENDER_TICKS) {
        advance(state, missed, missed >= slidingFrom);
      }
      advance(state, elapsed, elapsed >= slidingFrom);
      render(demo, state.scene);
      while (frame(m) - start < elapsed + RENDER_TICKS) {
        yield;
      }
      present(demo, state.scene);
      if (elapsed >= lastFrom) {
        return;
      }
    }
  },

  /** 0x1f008: frees buffers and the world; nothing visible. The blend table stays for part 10. */
  deinit() {},
};
