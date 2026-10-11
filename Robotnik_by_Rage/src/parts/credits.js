// Intro parts 2, 4 and 6: the "glod" credits (coding/hardware, artwork/is, music/pain). Each burns
// a picture away into smoke and flashes a second picture on a sync; they differ in how the picture
// arrives: out of a zoom into part 1's "presents" (run 0x22398), appearing out of black (0x223e4), or
// at once (0x22430). The engine is in glod.js; deinit 0x221c8 only frees memory.

import { syncAdvance, setDac, entryFrame, SCREEN_BYTES } from '../machine.js';
import { initGlod, burnLoop, glodZoom, glodBlack, PACES } from './glod.js';

const WIDTH = 320;
/** Part 6 copies rows 1..197 of its picture before the burn starts. */
const PART6_FIRST_ROW = 1;
const PART6_ROWS = 197;
/**
 * Frames init 0x221e8 takes in the recording (unpacking ~330 KB, eight blur passes). Part 6 starts
 * right after part 5 ends at entry 17, one row before its own entry, so its burn starts this long
 * after entry 17 rather than at entry 18. Parts 2 and 4 have time to spare.
 */
const INIT_FRAMES = 20;

function* waitForEntry(demo, entry) {
  while (syncAdvance(demo.machine) <= entry) {
    yield;
  }
}

/** 0x22398: glodzoom into "presents" at entry 8, the gl_pal palette, the burn with a flash at 9. */
export const codingCredits = {
  init: (demo) => initGlod(demo, 'coding.raw', 0, 1, 'hardware.raw'),
  *run(demo, glod, firstSync) {
    const m = demo.machine;
    yield* waitForEntry(demo, firstSync);
    const zoomEnd = yield* glodZoom(demo, glod, entryFrame(m, firstSync));
    setDac(m, glod.palette);
    yield* burnLoop(demo, glod, PACES.coding, firstSync + 1, zoomEnd + PACES.coding.startAfter);
    m.front.fill(0);
  },
};

/** 0x223e4: the gl_pal palette, glodblack at entry 13, the burn with a flash at 14. */
export const artworkCredits = {
  init: (demo) => initGlod(demo, 'artwork.raw', 1, 2, 'is.raw'),
  *run(demo, glod, firstSync) {
    const m = demo.machine;
    setDac(m, glod.palette);
    yield* waitForEntry(demo, firstSync);
    const revealEnd = yield* glodBlack(demo, glod, entryFrame(m, firstSync));
    yield* burnLoop(demo, glod, PACES.artwork, firstSync + 1, revealEnd + PACES.artwork.startAfter);
    m.front.fill(0);
  },
};

/** 0x22430: the picture at once, the burn from entry 18 with a flash at 19, black until entry 20. */
export const musicCredits = {
  init: (demo) => initGlod(demo, 'music.raw', 2, 0, 'pain.raw'),
  *run(demo, glod, firstSync) {
    const m = demo.machine;
    yield;
    setDac(m, glod.palette);
    const from = PART6_FIRST_ROW * WIDTH;
    m.front.set(glod.picture.subarray(from, from + PART6_ROWS * WIDTH), from);
    yield* waitForEntry(demo, firstSync);
    const burnStart = Math.max(entryFrame(m, firstSync), entryFrame(m, firstSync - 1) + INIT_FRAMES);
    yield* burnLoop(demo, glod, PACES.music, firstSync + 1, burnStart + PACES.music.startAfter);
    m.front.fill(0, 0, SCREEN_BYTES);
    yield* waitForEntry(demo, firstSync + 2);
  },
};
