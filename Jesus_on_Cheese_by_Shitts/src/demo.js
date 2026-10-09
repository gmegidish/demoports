// The boot block: a one-plane screen of messages while the disk loads, and the three parts called one after
// the other. Plus the runner that turns it into a clock-driven demo.
import { createMachine, r16, w16, nextFrame, waitFrames } from './machine.js';
import { createChip, custom } from './display.js';
import { readDisk, tracksTouched } from './disk.js';
import { part1 } from './parts/part1.js';
import { part2 } from './parts/part2.js';
import { part3 } from './parts/part3.js';

/**
 * @typedef {object} RunnerOptions
 * @property {boolean} [isAudioOnly]  run for the sound only: parts skip their drawing
 * @property {number[]} [clicks]      frames at which the left mouse button goes down
 */

/** Kickstart loads the boot block anywhere; its code copies itself from byte $2e to $7f000. */
const BOOT_COPY_FROM = 0x2e;
const BOOT_ADDRESS = 0x7f000;
const bootAddress = (fileOffset) => BOOT_ADDRESS + fileOffset - BOOT_COPY_FROM;
const BOOT_COPPER = bootAddress(0x1b8);
const BOOT_COLOUR0 = bootAddress(0x1da);
const BOOT_COLOUR1 = bootAddress(0x1de);
const BOOT_PLANE_LOW = bootAddress(0x1e6);
/** The three messages, 16 lines of 40 bytes each, read from byte $400 of the disk. */
const MESSAGES = { offset: 0x400, length: 0x800, address: 0x7f400 };
const MESSAGE_BYTES = 0x280;
const PART_ADDRESS = 0xa500;
/**
 * Part 2 only ends when the viewer presses the left mouse button. Its script is 9280 frames long and then starts
 * again; if nobody has clicked by the end of the first pass, the port clicks for them, a few frames before the
 * script restarts.
 */
const PART2_SCRIPT_FRAMES = 9280;
const AUTO_CLICK_MARGIN = 5;
const PARTS = [
  { offset: 0xc00, length: 0x19600, run: part1 },
  { offset: 0x1a200, length: 0x72000, run: part2, scriptFrames: PART2_SCRIPT_FRAMES },
  { offset: 0x8c200, length: 0x44a00, run: part3 },
];
const RED_STEP = 0x100;
const WHITE = 0xfff;
const GREY_STEP = 0x111;
/**
 * Frames trackdisk.device takes per track-side, measured in the reference capture: 1218 frames for the 83
 * tracks of part 2, 743 for the 50 of part 3. Part 1's load happened before the capture started.
 */
const FRAMES_PER_TRACK = 14.7;

/** `move.b $bfe801,d0 / cmp.b $bfe801,d0 / beq`: wait for the CIA's time-of-day counter, which counts frames. */
function* waitTick(m) {
  yield* nextFrame(m);
}

function* fadeRedIn(m) {
  do {
    yield* waitTick(m);
    w16(m, BOOT_COLOUR1, r16(m, BOOT_COLOUR1) + RED_STEP);
  } while (r16(m, BOOT_COLOUR1) !== 0xf00);
}

function* fadeRedOut(m) {
  do {
    yield* waitTick(m);
    w16(m, BOOT_COLOUR1, r16(m, BOOT_COLOUR1) - RED_STEP);
  } while (r16(m, BOOT_COLOUR1) !== 0);
}

/** Read a part to $a500, wait for the drive, fade the message out and `jsr $a500` with A0 = the boot copper list. */
function* loadAndCallPart(m, adf, part) {
  readDisk(m, adf, part.offset, part.length, PART_ADDRESS);
  yield* waitFrames(m, Math.round(tracksTouched(part.offset, part.length) * FRAMES_PER_TRACK));
  yield* fadeRedOut(m);
  const autoClick = part.scriptFrames ? m.frame + part.scriptFrames - AUTO_CLICK_MARGIN : null;
  if (autoClick !== null) {
    m.clicks.push(autoClick);
  }
  yield* part.run(m, BOOT_COPPER);
  // If the viewer clicked first, the port's click must not land in the next part.
  m.clicks = m.clicks.filter((frame) => frame !== autoClick || frame <= m.frame);
}

export function* demo(m, adf) {
  readDisk(m, adf, BOOT_COPY_FROM, 0x400, BOOT_ADDRESS);
  readDisk(m, adf, MESSAGES.offset, MESSAGES.length, MESSAGES.address);
  m.cop1lc = BOOT_COPPER;
  custom(m, 0x96, 0x0420);
  custom(m, 0x96, 0x8380);

  // A white flash fading to black, both colours together, one step per frame.
  for (let grey = WHITE; grey >= 0; grey -= GREY_STEP) {
    yield* waitTick(m);
    w16(m, BOOT_COLOUR0, grey);
    w16(m, BOOT_COLOUR1, grey);
  }
  yield* fadeRedIn(m);
  yield* loadAndCallPart(m, adf, PARTS[0]);

  for (const part of PARTS.slice(1)) {
    w16(m, BOOT_PLANE_LOW, r16(m, BOOT_PLANE_LOW) + MESSAGE_BYTES);
    yield* fadeRedIn(m);
    yield* loadAndCallPart(m, adf, part);
  }
  // Part 3 never returns. Were it to, the boot block flashes yellow and blue forever.
}

/**
 * Drives the demo generator from a clock. advanceTo(t) runs logic until t ms of demo time are consumed.
 * @param {Uint8Array} adf
 * @param {RunnerOptions} [options]
 */
export function createRunner(adf, { isAudioOnly = false, clicks = [] } = {}) {
  const m = createMachine();
  m.chip = createChip();
  m.isAudioOnly = isAudioOnly;
  m.clicks = [...clicks];
  const sequence = demo(m, adf);
  let consumed = 0;
  const runner = {
    m,
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
