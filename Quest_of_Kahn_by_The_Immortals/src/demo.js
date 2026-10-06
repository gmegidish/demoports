// main() of KAHN.EXE (0x100ef): load everything behind the loading screen, start the music, then
// play the parts in order. Each blocking routine of the original is a generator here that yields
// once per frame it shows; whoever drives it sets the machine's tick count before each step.

import { createMachine, setDac, clearBuffer, PALETTE_BYTES } from './machine.js';
import { loadFont } from './font.js';
import { loadPicture } from './engine/pictures.js';
import { view } from './engine/triangle.js';
import { createLog, loaderLog } from './parts/common.js';
import { loadCreate, runCreate } from './parts/create.js';
import { loadSteal, runSteal } from './parts/steal.js';
import { loadMeeting, runMeeting } from './parts/meeting.js';
import { loadWobblerTables, loadWobbler1, loadWobbler2, loadWobbler3, runWobbler1, runWobbler2, runWobbler3 } from './parts/wobbler.js';
import { loadBadguy, runBadguy } from './parts/badguy.js';
import { loadHitcar, runHitcar } from './parts/hitcar.js';
import { loadBridge, runBridge } from './parts/bridge.js';
import { loadReturn, runReturn } from './parts/return.js';
import { loadRoller, runRoller } from './parts/roller.js';
import { loadShadows, runShadows } from './parts/shadows.js';
import { createRandom } from './engine/math.js';

function* load(demo) {
  const machine = demo.machine;
  clearBuffer(machine.front);
  // The loading picture stays in buffer B; every log line redraws it with the text on top.
  loadPicture(machine, demo.assets, 'textures\\loading.gif', { showPalette: true, into: machine.bufferB });
  yield* loaderLog(demo, 'loader initialized');
  yield* loaderLog(demo, "initializing Silvatar's fonts");
  yield* loadCreate(demo);
  yield* loadSteal(demo);
  yield* loadMeeting(demo);
  yield* loaderLog(demo, 'formating hard-disk');
  yield* loadWobblerTables(demo);
  yield* loadWobbler1(demo);
  yield* loadWobbler2(demo);
  yield* loaderLog(demo, 'uploading virus');
  yield* loadWobbler3(demo);
  yield* loadBadguy(demo);
  yield* loadHitcar(demo);
  yield* loaderLog(demo, 'burning screen');
  yield* loadBridge(demo);
  yield* loadReturn(demo);
  yield* loaderLog(demo, "corrupting irq's");
  yield* loadRoller(demo);
  yield* loadShadows(demo);
}

function* play(demo) {
  const machine = demo.machine;
  yield* load(demo);

  clearBuffer(machine.front);
  setDac(machine, new Uint8Array(PALETTE_BYTES));
  // PlayModule: the music and both tick counters start here.
  machine.isMusicStarted = true;
  machine.ticks = 0;
  machine.timerA.value = 0;
  machine.timerB.value = 0;
  yield;

  yield* runCreate(demo);
  yield* runSteal(demo);
  yield* runMeeting(demo);
  yield* runWobbler1(demo);
  yield* runBadguy(demo);
  yield* runHitcar(demo);
  yield* runWobbler2(demo);
  yield* runBridge(demo);
  yield* runReturn(demo);
  yield* runWobbler3(demo);
  yield* runRoller(demo);
  yield* runShadows(demo);

  // Back in main(): a black screen, then the music stops and DOS returns with "The End!".
  clearBuffer(machine.front);
  setDac(machine, new Uint8Array(PALETTE_BYTES));
  demo.isOver = true;
}

/**
 * @param {{read: (name: string) => Uint8Array}} assets the demo's files
 * @returns the demo, not yet started: call step() until machine.isMusicStarted, then keep
 *   machine.ticks in time with the music and call step() once per frame shown
 */
export function createDemo(assets) {
  const machine = createMachine();
  const demo = {
    machine,
    assets,
    font: loadFont(assets.read('textures\\standard.aft')),
    logLines: createLog(),
    /** The C runtime's rand(): only the tunnel and the scroller's text positions draw from it. */
    rand: createRandom(),
    /** Set after a jump in time; the next frame lets the keyframer catch up before drawing. */
    isSettling: false,
    isOver: false,
  };
  // Every triangle goes to work buffer A; parts copy it to the screen when a frame is done.
  view.target = machine.bufferA;
  const generator = play(demo);
  demo.step = () => {
    if (!demo.isOver) {
      generator.next();
    }
  };
  return demo;
}

/** Run the loading screen to its end without showing it. */
export function finishLoading(demo) {
  while (!demo.machine.isMusicStarted) {
    demo.step();
  }
}

/** Jump to a moment of the music. Parts that are over fall through at once: each subtracts its own length. */
export function seekTo(demo, ticks) {
  demo.machine.ticks = ticks;
  demo.isSettling = true;
  demo.step();
}
