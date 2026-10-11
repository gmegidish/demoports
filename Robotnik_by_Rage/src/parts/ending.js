// Demo part 14: the end scene. The camera recording end_cam.rec flies over the robot lying in pieces
// on the flesh floor next to the skull and the "RAGE" box; at sync entries 28, 29 and 30 the words
// "rage", "punished" and "robotnik" light up the picture for 95 ticks. Ports init 0x15ab4
// (endingscene.js), run 0x16180 and deinit 0x164d8 (frees only). See docs/disassembly/P14_ending.md.
//
// The loop has no frame wait: it renders as fast as the CPU allows (DOSBox showed a new picture about
// every 5 ticks) and everything moves by the ticks elapsed since the part started (the camera record
// index, the word's fade), so the port renders once per tick.

import { frame, syncAdvance, resyncFrame, entryTime, entryFrame, setDac, PALETTE_BYTES } from '../machine.js';
import { RenderWorld, playCameraRecord, cameraRecordCount } from '../engine/index.js';
import { shadeClamped } from '../gfx.js';
import { createEndingScene } from './endingscene.js';

/** A word lights up for 95 ticks, its level a triangle 0 -> 31 -> 0 over 2/3 of the remaining ticks. */
const WORD_TICKS = 95;
const WORD_LEVEL_PEAK = 31;
const WORD_LEVEL_FOLD = 63;
/** Entries first+2 .. first+4 (28, 29, 30 reached) start the words; first+5 (31) ends the part. */
const FIRST_WORD_ENTRY_OFFSET = 2;
const LAST_ENTRY_OFFSET = 4;

/** 0x16180: level of the word overlay with `remaining` ticks to go. */
export function wordLevel(remaining) {
  const level = Math.trunc((2 * remaining) / 3);
  return level > WORD_LEVEL_PEAK ? WORD_LEVEL_FOLD - level : level;
}

function* waitForEntry(demo, entry) {
  while (syncAdvance(demo.machine) <= entry) {
    yield;
  }
}

/** One pass of 0x16180: camera record `elapsed`, the world into the back buffer, the word on top. */
function drawPass(demo, state, elapsed, overlay) {
  const { world, camera } = state.scene;
  const back = demo.offscreen;
  playCameraRecord(world, camera, Math.min(elapsed, cameraRecordCount(camera) - 1));
  RenderWorld(world, { target: back, colourTable: demo.blendTable });
  const remaining = overlay.endFrame - frame(demo.machine);
  if (overlay.word >= 0 && remaining > 0) {
    shadeClamped(state.scene.words[overlay.word], back, state.scene.addLight, wordLevel(remaining));
  }
  demo.machine.front.set(back);
  back.fill(0);
}

export const ending = {
  /** 0x15ab4: the scene; the DAC gets end_pal.col. */
  init(demo) {
    setDac(demo.machine, demo.archive.read('end_pal.col').subarray(0, PALETTE_BYTES));
    return { scene: createEndingScene(demo) };
  },

  /**
   * 0x16180(27): from entry 27 until the pass in which entry 31 is reached; that last picture stays.
   * A word starts on the first pass after its entry, when no word is showing; its 95 ticks are
   * counted from the entry's frame (the original counts from that pass, a tick or so later), so that
   * a seek lands on the same level.
   */
  *run(demo, state, firstSync) {
    const m = demo.machine;
    yield* waitForEntry(demo, firstSync);
    resyncFrame(m, entryTime(m, firstSync));
    const start = entryFrame(m, firstSync);
    const lastEntry = firstSync + LAST_ENTRY_OFFSET;
    const firstWordEntry = firstSync + FIRST_WORD_ENTRY_OFFSET;
    const overlay = { word: -1, endFrame: 0 };
    let index = firstSync + 1;
    for (;;) {
      const previousIndex = index;
      index = syncAdvance(m);
      const isNewWord = index !== previousIndex && index >= firstWordEntry && index <= lastEntry
        && frame(m) >= overlay.endFrame;
      if (isNewWord) {
        overlay.word = index - firstWordEntry;
        overlay.endFrame = entryFrame(m, index - 1) + WORD_TICKS;
      }
      drawPass(demo, state, Math.max(frame(m) - start, 0), overlay);
      if (index > lastEntry) {
        return;
      }
      yield;
    }
  },
};
