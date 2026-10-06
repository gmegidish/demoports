// The loader at $2000: shows a screen of noise while the disk loads, starts the music, then calls the parts
// one after the other. Plus the runner that turns the generator into a clock-driven demo.
import { createMachine, w16, waitLine, waitFrames, pokeCopperPointer, FRAME_MS } from './machine.js';
import { createChip, custom } from './display.js';
import { loadDisk, decrunch } from './disk.js';
import { fadeColour } from './colour.js';
import { Mushrooms } from './parts/mushrooms.js';
import { BeeRings } from './parts/bee-rings.js';
import { Invaders } from './parts/invaders.js';
import { Walt } from './parts/walt.js';
import { MelonSlice } from './parts/melon-slice.js';
import { Dancing } from './parts/dancing.js';
import { Sketches } from './parts/sketches.js';
import { Poster } from './parts/poster.js';
import { Credits } from './parts/credits.js';

const NOISE_COPPER = 0x21f0;
const NOISE_COPPER_PLANES = 0x220a;
const NOISE_COPPER_COLOURS = 0x224e;
const NOISE_LOW_NIBBLES = 0x44;
const NOISE_PICTURE = 0x37a0;
const NOISE_PLANE_BYTES = 0x2800;
const BLANK_COPPER = 0x21aa;
const BLANK_COLOUR = 0x21bc;
/** How long the real disk drive needs for 845 KB. The noise screen is all there is to see meanwhile. */
const MAX_VOLUME = 0x40;
const LOADING_FRAMES = Math.round(3700 / FRAME_MS);
/**
 * The two crunched parts unpack themselves when called, on a black screen. Frames that takes on an A1200,
 * counted in the reference capture (80 KB and 360 KB of output).
 */
const UNPACK_FRAMES = { 0xd3a68: 11, 0xc96e8: 33 };

/** `bsr $21ca`: every part starts on the loader's blank copper list. */
function* callPart(m, part) {
  m.cop1lc = BLANK_COPPER;
  yield* part(m);
}

/** A crunched part: the loader's call lands in the decruncher first. */
function* callCrunchedPart(m, entry, part) {
  m.cop1lc = BLANK_COPPER;
  decrunch(m, entry);
  yield* waitFrames(m, 0xff, UNPACK_FRAMES[entry]);
  yield* part(m);
}

function setBlankColour(m, colour) {
  w16(m, BLANK_COLOUR, colour);
  w16(m, BLANK_COLOUR + 8, colour);
}

export function* demo(m) {
  for (let plane = 0; plane < 4; plane++) {
    pokeCopperPointer(m, NOISE_COPPER_PLANES + plane * 8, NOISE_PICTURE + plane * NOISE_PLANE_BYTES);
  }
  m.cop1lc = NOISE_COPPER;
  yield* waitFrames(m, 0xff, LOADING_FRAMES);

  // mt_init, and the vertical-blank interrupt starts calling mt_music.
  m.musicStartMs = m.time;

  for (let step = 0; step <= 0x20; step++) {
    yield* waitLine(m, 0xff);
    for (let i = 0; i < 16; i++) {
      const colour = fadeColour(i * 0x111, 0, step * 8);
      w16(m, NOISE_COPPER_COLOURS + i * 4, colour.high);
      w16(m, NOISE_COPPER_COLOURS + i * 4 + NOISE_LOW_NIBBLES, colour.low);
    }
  }

  yield* callCrunchedPart(m, 0xd3a68, Mushrooms);
  // The next part precalculates on entry; the blank screen it does that on is white.
  setBlankColour(m, 0xfff);
  yield* callPart(m, BeeRings);
  setBlankColour(m, 0);
  yield* callPart(m, Invaders);
  yield* callCrunchedPart(m, 0xc96e8, Walt);
  yield* callPart(m, MelonSlice);
  yield* callPart(m, Dancing);
  yield* callPart(m, Sketches);
  yield* callPart(m, Poster);

  // Fade the music out: one step of the four AUDxVOL registers per frame, then mt_end.
  custom(m, 0x106, 0);
  m.cop1lc = BLANK_COPPER;
  for (let volume = MAX_VOLUME; volume >= 0; volume--) {
    yield* waitLine(m, 0xff);
    m.musicVolume = volume / MAX_VOLUME;
  }
  m.musicStopMs = m.time;

  // `jmp $be518`: the end part has its own tune, and leaves by resetting the machine.
  yield* Credits(m);
}

/** Drives the demo generator from a clock. advanceTo(t) runs logic until t ms of demo time are consumed. */
export function createRunner(adf, unpacked) {
  const m = createMachine();
  m.chip = createChip();
  m.unpacked = unpacked;
  loadDisk(m, adf);
  const sequence = demo(m);
  let consumed = 0;
  const runner = {
    m,
    /** True once the end part has reset the machine: the disk would boot again from here. */
    isOver: false,
    advanceTo(timeMs) {
      while (!runner.isOver && consumed <= timeMs) {
        m.time = consumed;
        const step = sequence.next();
        if (step.done) {
          runner.isOver = true;
          return;
        }
        consumed += step.value;
      }
    },
  };
  return runner;
}
