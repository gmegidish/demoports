// main (0000:a3ef): the parts in order, each followed by a wait for an absolute tick of the 100 Hz
// clock that starts with the music. The soundtrack is played separately; see main.js.
import { Machine } from './machine.js';
import { readResources } from './resources.js';
import { Engine3d } from './engine3d.js';
import { waitUntil } from './parts/common.js';
import { creditsPart } from './parts/credits.js';
import { terrainPart } from './parts/terrain.js';
import { introPart, preload } from './parts/intro.js';
import { morphPart } from './parts/morph.js';
import { gemsPart } from './parts/gems.js';
import { endPart, exitScreen } from './parts/end.js';
import { logosPart, moonPart } from './parts/logos.js';
import { spacePart } from './parts/space.js';
import { hallPart } from './parts/hall.js';
import { shardsPart, torusPart } from './parts/shards.js';
import { rainbowPart } from './parts/rainbow.js';
import { rubikPart } from './parts/rubik.js';


/** [part, the tick main waits for after it]. */
const TIMELINE = [
  [introPart, 4615], // 0000:0cd6 intro
  [logosPart, 8225], // 0000:143e
  [moonPart, 10755], // 0000:1dab
  [morphPart, 13270], // 0a69:0620
  [gemsPart, 17300], // 0000:4ebc
  [spacePart, 29535], // 0000:3f83
  [hallPart, 40040], // 0000:60dc
  [shardsPart, 44345], // 0000:2aa9
  [torusPart, 49740], // 0000:3050
  [rainbowPart, 52750], // 0000:8768
  [rubikPart, 55460], // 0000:9178
  [terrainPart, 61865], // 0000:7d84
  [creditsPart, 70965], // 0000:9778
  [endPart, 0], // 0000:0073 the end
  [exitScreen, 0], // music fade-out, 0000:a616, the exit procedure's text screen
];

/** Start of each part in the reference run, for seeking. */
export const PART_STARTS = [0, 46.15, 85.16, 110.19, 132.7, 173.0, 296.08, 400.4, 443.45, 497.4, 527.5, 554.6, 618.65, 709.65, 724.65];

function* runMain(m, firstPart) {
  if (firstPart <= 1) {
    preload(m);
  } else {
    m.setMode(0);
  }
  for (let i = firstPart; i < TIMELINE.length; i++) {
    const [part, endTick] = TIMELINE[i];
    yield* part(m);
    yield* waitUntil(m, 0, endTick);
  }
  m.isOver = true;
}

/**
 * The demo, run on virtual time. `firstPart` starts at a later part (its start time in the
 * reference run), for seeking and tests.
 */
export function createDemo(exe, { firstPart = 0 } = {}) {
  const m = new Machine();
  m.resources = readResources(exe);
  m.engine = new Engine3d(m);
  m.randSeed = 0x1995;
  m.time = PART_STARTS[firstPart];
  m.isOver = false;
  const main = runMain(m, firstPart);
  return {
    machine: m,
    /**
     * Runs until machine time reaches `seconds` (or the demo ends), or until `isOutOfTime()` says to stop
     * for now (a browser keeps its frame budget this way while catching up after a seek).
     */
    runUntil(seconds, isOutOfTime = () => false) {
      while (!m.isOver && m.time < seconds && !isOutOfTime()) {
        const next = main.next();
        if (next.done) {
          m.isOver = true;
          break;
        }
        if (!(next.value > m.time)) {
          throw new Error(`a part yielded ${next.value} at ${m.time}: time must move forward`);
        }
        m.time = next.value;
      }
    },
  };
}

/** The part that is running at `seconds` in the reference run. */
export function partContaining(seconds) {
  let part = 0;
  PART_STARTS.forEach((start, i) => {
    if (start <= seconds) {
      part = i;
    }
  });
  return part;
}
