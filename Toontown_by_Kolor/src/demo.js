// The main program (0x10028d, docs/disassembly/README.md) and the frame loop.
//
// Time is the soundtrack's time. 0 is the start of the text screen the demo prints its setup and loading
// messages on; then mode 13h, the retrace callbacks and the music start, and the parts run one after the other.
// The frame loop steps one vertical retrace at a time. At each retrace the timer callback runs (0x100006: the
// retrace counter), then the demo's code runs until it waits for the next retrace: a part is a generator and
// `yield` is that wait (0x100056).
import { Vga } from './vga.js';
import { Machine } from './machine.js';
import { rowTimeline, rowAt } from './xm.js';
import { loadData } from './loader.js';
import { printLoadingScreen, printExitMessage } from './dos.js';
import { PARTS, skipPart } from './parts/index.js';

/** Mode 13h's refresh: 25.175 MHz / 800 dots / 449 lines. */
export const REFRESH_RATE = 25175000 / 800 / 449;
/**
 * The module's time at the first retrace after the callbacks are installed (MIDASplayModule follows at once).
 * Fitted to the recording.
 */
export const MUSIC_LEAD_SECONDS = 0;

/**
 * The player's state after `retraces` retraces since the callbacks were installed.
 * `musicRate` is 1 for the port; the DOSBox recording played the module about 0.9 % fast (tools: musicRate).
 */
export function musicClock(xm, musicRate = 1) {
  const timeline = rowTimeline(xm);
  return (retraces) => {
    const seconds = (retraces / REFRESH_RATE) * musicRate + MUSIC_LEAD_SECONDS;
    return seconds < 0 ? { position: 0, pattern: 0, row: 0, syncs: 0 } : rowAt(timeline, seconds);
  };
}

/**
 * The main program from the loading screen to the exit to DOS.
 * `firstPart` (development only) skips the parts before it: they only wait for their song positions, so the
 * retraces and the music stay where they are in a whole run.
 */
function* mainScript(m, firstPart) {
  yield* printLoadingScreen(m);
  loadData(m); // 0x1003a3..0x100826
  m.vga.setMode13(); // 0x100829 int 10h ax=13h
  m.mode13Retrace = m.vga.frameCount; // tools: the recordings' frame 0
  m.installTimer(); // 0x100840 MIDASsetTimerCallbacks, 0x100868 MIDASplayModule
  const first = Math.max(0, PARTS.findIndex(([name]) => name === firstPart));
  m.partStarts = []; // tools: the retrace each part starts at
  for (const [index, [, part, lastPosition]] of PARTS.entries()) {
    m.partStarts.push(m.vga.frameCount - m.mode13Retrace);
    const isAborted = yield* (index < first ? skipPart : part)(m, lastPosition);
    if (isAborted) {
      break;
    }
  }
  m.vga.setMode3(); // 0x100985
  printExitMessage(m); // 0x1009c6
}

/**
 * The demo on soundtrack time.
 * @param {{exe: Uint8Array, dat: Uint8Array, xm: Uint8Array, font: Uint8Array}} files
 * @param {{ firstPart?: string, musicRate?: number }} options development only
 */
export function createDemo({ exe, dat, xm, font }, { firstPart, musicRate } = {}) {
  const vga = new Vga();
  vga.font = font;
  vga.setMode3();
  const m = new Machine(exe, dat, musicClock(xm, musicRate), vga);
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
