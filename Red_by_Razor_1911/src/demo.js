// The main script (0000:0000..0276, docs/disassembly/README.md) and the frame loop.
//
// Time is the soundtrack's time, which is the reference recording's time: 0 is the recording's first frame, the
// switch to mode 13h (0000:004b) after the music player has loaded the module. The frame loop steps one vertical
// retrace at a time. At each retrace the timer interrupt runs (0000:0278: the frame counter), then the demo's code
// runs until it waits for the next retrace: a part is a generator and `yield` is that wait.
import { Vga } from './vga.js';
import { Machine, DATA } from './machine.js';
import { bubbles } from './parts/bubbles.js';
import { redLogo } from './parts/redLogo.js';
import { razorText } from './parts/razorText.js';
import { snowball } from './parts/snowball.js';
import { credits } from './parts/credits.js';
import { ending } from './parts/ending.js';

/**
 * 0000:02b7 measures one frame with the PIT between two retrace starts, then installs the timer IRQ.
 * Fitted against the recording: it returns in the retrace after the mode set, and the IRQ's first count is the
 * retrace after that (part A's first animation frame is then recording frame 4, as in the recording).
 */
const TIMER_MEASURE_RETRACES = 1;

/**
 * 0000:0b72: 16b2:1b80 = 60 words, three rows of 20 screen offsets 16 pixels apart, 0x1400 (16 lines) between rows.
 */
function buildBlockOffsets(m) {
  let offset = 0;
  let at = DATA + 0x1b80;
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 20; column++) {
      m.set16(at, offset);
      at += 2;
      offset += 0x10;
    }
    offset += 0x12c0;
  }
}

/** The parts of the main script, in order. */
const PARTS = [
  ['bubbles', bubbles], // 0050..0089
  ['redLogo', redLogo], // 008a..010d
  ['razorText', razorText], // 010e..0180
  ['snowball', snowball], // 0181..01c3
  ['credits', credits], // 01c6..020d
];

/**
 * The main script from 0000:0048 (mode 13h) to the exit to DOS.
 * `firstPart` (development only) skips the parts before it.
 */
function* mainScript(m, firstPart) {
  buildBlockOffsets(m); // 0045 0000:0b72
  m.vga.setMode13(); // 0048 int 10h ax=13h
  for (let i = 0; i < TIMER_MEASURE_RETRACES; i++) {
    yield; // 004d 0000:02b7
  }
  m.isTimerInstalled = true;
  const first = firstPart === 'ending' ? PARTS.length : Math.max(0, PARTS.findIndex(([name]) => name === firstPart));
  for (const [, part] of PARTS.slice(first)) {
    yield* part(m);
  }
  m.isTimerInstalled = false; // 020e 0000:0365
  yield* ending(m); // 0211..0276
}

/**
 * The demo on soundtrack time.
 * @param {Uint8Array} image RED.EXE unpacked and rebased to segment 0 (pklite.js)
 * @param {Uint8Array} font the VGA BIOS 8x16 font (assets/vgafont.bin)
 * @param {{ firstPart?: string }} options development only: start at a part ('ending' skips them all)
 */
export function createDemo(image, font, { firstPart } = {}) {
  const vga = new Vga();
  vga.font = font;
  vga.setMode3();
  const m = new Machine(image, vga);
  const state = {
    vga,
    machine: m,
    time: 0,
    isOver: false,
    hasFailed: false,
  };
  const main = mainScript(m, firstPart);

  function* retraces() {
    for (;;) {
      vga.beginFrame();
      m.timerInterrupt();
      if (main.next().done) {
        return;
      }
      yield;
    }
  }

  const frames = retraces();

  /** One retrace. After the exit to DOS the screen keeps refreshing (the text cursor blinks). */
  function stepRetrace() {
    state.time += 1 / vga.refreshRate;
    if (state.isOver) {
      vga.beginFrame();
    } else if (frames.next().done) {
      state.isOver = true;
    }
  }

  return {
    state,
    get time() {
      return state.time;
    },
    /** Runs exactly one retrace (tools). */
    step: stepRetrace,
    /** Runs retraces until the time reaches `seconds` (or isOutOfTime says stop for this browser frame). */
    runUntil(seconds, isOutOfTime = () => false) {
      while (state.time + 1 / vga.refreshRate <= seconds && !isOutOfTime()) {
        stepRetrace();
      }
    },
  };
}
