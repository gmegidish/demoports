// main() of TEST.EXE (0x100fe): load everything in text mode, set 320x200, start the music, then
// play the six parts in order. Each blocking routine of the original is a generator here that
// yields once per frame it shows; whoever drives it sets machine.time before each step.

import { createMachine, setDac, clearBuffer, PALETTE_BYTES } from './machine.js';
import { rowTimeline } from './xm.js';
import { createTextScreen, print } from './textscreen.js';
import { loadIntro, runIntro } from './parts/intro.js';
import { loadPolarTables, loadKaleidoscope, runKaleidoscope } from './parts/kaleidoscope.js';
import { loadShpitz, runShpitz, loadTennis, runTennis } from './parts/scenes.js';
import { loadTunnel, runTunnel } from './parts/tunnel.js';
import { loadFur, runFur } from './parts/fur.js';

/** In main's order: 0x110fb, 0x11909, 0x12b34, 0x134da, 0x1220a, 0x130bf, 0x138b4. */
const LOADERS = [loadIntro, loadPolarTables, loadKaleidoscope, loadShpitz, loadTunnel, loadFur, loadTennis];
/** 0x1128f, 0x12cc2, 0x13559, 0x122b0, 0x13933, 0x130f7. */
const PARTS = [runIntro, runKaleidoscope, runShpitz, runTunnel, runTennis, runFur];

/** What main() prints before the graphics, one cout at a time (0x50004..0x501d5). 0xfe is a small square. */
const BOOT_LOG = [
  '\n]  Brother I Can See The Light,\n   1st Place at The Movement97 Demo Competition,\n   31/12/97 ISRAEL\n\n',
  '\n]  Immortals Demo System V 1.08\n',
  '\n]  Initializing\n',
  '\n]  Allocating Aligned Memory',
  '\n]  Initializing Vesa 2 System',
  '\n]  Kicking MIDAS  -  ',
  'Hmm, It Looks Alive',
  '\n]  Telling MIDAS about our module',
  '\n]  Installing Keyboard Handler.',
  "\n\xfe  Use the '+' and '-' keys to adjust the volume\n",
  '\n]  Loading Data',
  '\n\n]  Hack IDS, load data be4 entering mode, Bpp=1',
  '\n]  Hang on, loading/calculating/doing magic',
];
/** After the music stops: back to mode 3, the goodbye, and DOS's prompt (0x50199..0x50245). */
const GOODBYE = '\nThe End!Brother I can see the light, Immortals 1997\nA 6 Hours production\nFinal Version (I hope :)\n\n\nC:\\>';

function* play(demo) {
  const machine = demo.machine;
  for (const line of BOOT_LOG) {
    print(machine.textScreen, line);
    yield;
  }
  for (const load of LOADERS) {
    load(demo);
  }
  // 0x104b0(320, 200, 8): mode 13h, a black screen with the BIOS palette until a part sets one.
  machine.isTextMode = false;
  clearBuffer(machine.front);
  setDac(machine, new Uint8Array(PALETTE_BYTES));
  // 0x10d84: MIDASplayModule, both tick counters zeroed.
  machine.isMusicStarted = true;
  machine.timerA.value = 0;
  machine.timerB.value = 0;
  yield;
  for (const run of PARTS) {
    yield* run(demo);
  }
  // Back in main(): the music stops, mode 3, "The End!", and DOS.
  machine.isTextMode = true;
  machine.textScreen = createTextScreen();
  print(machine.textScreen, GOODBYE);
  demo.isOver = true;
}

/**
 * @param {{read: (name: string) => Uint8Array}} assets the files bound into BROTHER.EXE
 * @param {Uint8Array} music BICSTL.XM, for the song's row timing
 * @returns the demo, not yet started: call step() until machine.isMusicStarted, then keep
 *   machine.time in time with the music and call step() once per frame shown
 */
export function createDemo(assets, music) {
  const machine = createMachine(rowTimeline(music));
  const demo = {
    machine,
    assets,
    /** Set after a jump in time; the next frame lets the keyframer catch up before drawing. */
    isSettling: false,
    isOver: false,
  };
  const generator = play(demo);
  demo.step = () => {
    if (!demo.isOver) {
      generator.next();
    }
  };
  return demo;
}

/** Run the loaders to their end. */
export function finishLoading(demo) {
  while (!demo.machine.isMusicStarted) {
    demo.step();
  }
}

/** Jump forward to a moment of the music. Parts that are over fall through at once. */
export function seekTo(demo, seconds) {
  demo.machine.time = seconds;
  demo.isSettling = true;
  demo.step();
}
