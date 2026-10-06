// What every part of the demo does the same way: the loader's log, frame numbers from the timer,
// fades from white, and the walk over the engine's sorted faces.

import { PALETTE_BYTES, TICKS_PER_SECOND, setDac, showBuffer } from '../machine.js';
import { drawTextShadowed } from '../font.js';
import { engine, animate } from '../engine/frame.js';

const f = Math.fround;

/** One "second" of the 100 Hz timer; every duration in the demo is a multiple of it. 0x593d4. */
export const TICKS = TICKS_PER_SECOND;
export const DAC_WHITE = 63;

const LOG_LINES = 8;
const LOG_LEFT = 30;
const LOG_TOP = 46;
const LOG_LINE_HEIGHT = 16;
const LOG_COLOUR = 0x1c;

/** How many extra times to evaluate the keyframer after a jump in time: its cursors move one key a call. */
const SETTLE_PASSES = 96;

/**
 * The loading screen: the picture with the last eight messages over it, newest at the bottom.
 * Yields so the page can show it. 0x1418c.
 */
export function* loaderLog(demo, message) {
  const machine = demo.machine;
  demo.logLines.shift();
  demo.logLines.push(message);
  machine.bufferA.set(machine.bufferB);
  demo.logLines.forEach((line, index) => {
    drawTextShadowed(demo.font, machine.bufferA, LOG_LEFT, index * LOG_LINE_HEIGHT + LOG_TOP, line, LOG_COLOUR);
  });
  showBuffer(machine, machine.bufferA);
  yield;
}

export function createLog() {
  return new Array(LOG_LINES).fill('');
}

/** Where a part is in its scene: the timer scaled to the scene's frames. Written by every part loop. */
export function setFrame(ticks, duration) {
  engine.frame = f((ticks * engine.span) / duration + engine.firstFrame);
  return engine.frame;
}

/** Evaluate the keyframer; after a seek, enough times for its one-key-per-call cursors to catch up. */
export function animateScene(demo) {
  if (demo.isSettling) {
    for (let pass = 0; pass < SETTLE_PASSES; pass++) {
      animate();
    }
    demo.isSettling = false;
  }
  animate();
}

/** Every part but the first opens like this: white, falling to the part's palette over a second. */
export function fadeFromWhite(machine, palette, work, elapsed, duration) {
  for (let i = 0; i < PALETTE_BYTES; i++) {
    work[i] = (DAC_WHITE - Math.trunc(((DAC_WHITE - palette[i]) * elapsed) / duration)) & 0xff;
  }
  setDac(machine, work);
}

/**
 * The opening second of a part, as nearly every part loop does it: fade from white while the
 * part's flag is up, then set the real palette once and drop the flag.
 * @param {{palette: Uint8Array, work: Uint8Array, isFadingIn: boolean}} part
 */
export function stepFadeIn(machine, part, ticks) {
  if (!part.isFadingIn) {
    return;
  }
  if (ticks < TICKS) {
    fadeFromWhite(machine, part.palette, part.work, ticks, TICKS);
  } else {
    setDac(machine, part.palette);
    part.isFadingIn = false;
  }
}

/** A palette of nothing but white: how most parts hand over to the next. */
export function whiteDac(machine) {
  setDac(machine, new Uint8Array(PALETTE_BYTES).fill(DAC_WHITE));
}

/** Far to near over what the engine left visible; each part brings its own choice of drawer. */
export function drawSortedFaces(drawFace) {
  const sorted = engine.sorted;
  for (let i = sorted.length - 1; i >= 0; i--) {
    drawFace(sorted[i], sorted[i].flags);
  }
}
