// The sequencer 0x123f0: the intro (parts 0..6 on pullmax.xm), the "waiting for robotnik" screen while
// bergborr.xm loads, the demo (parts 7..15), then text mode. Each blocking routine of the original
// is a generator here that yields once per frame it shows; whoever drives it sets machine.time
// (seconds on the soundtrack) before each step.

import {
  createMachine, TICKS_PER_SECOND, setGraphicsMode, setDacEntry, syncAdvance, resyncFrame,
} from './machine.js';
import { rowTimeline } from './xm.js';
import { createTextScreen, print } from './textscreen.js';
import { readSyncTable, INTRO_SYNC_TABLE, DEMO_SYNC_TABLE } from './sync.js';
import { loadFont, drawSmallTextCentered } from './font.js';
import { PARTS } from './parts/index.js';

/**
 * Where each song starts on the soundtrack (assets/music.ogg), as in the reference recording:
 * the intro 0.221 s after the switch to mode 13h, the demo after the loading screen.
 */
export const SONG_STARTS = { intro: 0.221, demo: 124.792 };
/**
 * Where assets/music.ogg ends: just after demo entry 37 (402.83 s), where part 15 returns and main
 * stops the music and sets text mode. A cap, in case the audio clock stops first.
 */
export const END_TIME = 402.85;
/** First sync entry of each part, startSync at 0x80010. */
const START_SYNC = [0, 5, 8, 10, 13, 15, 18, 0, 5, 9, 12, 15, 18, 24, 27, 32];
/** The intro ends when part 6 has passed entry 20; the demo after part 15 has passed entry 37. */
const INTRO_LAST_SYNC = 20;
const DEMO_LAST_SYNC = 37;
const FIRST_DEMO_PART = 7;
const PARTS_COUNT = 16;
/** What main() prints in text mode while pullmax.xm loads (MIDAS's sound device description). */
const BOOT_TEXT = 'Using Sound Blaster series Sound Device v2.21\nSound Blaster 16 (DSP v4.00+), port 220, IRQ 7 and DMA 5\n';
const WAITING_GREYS = 32;
const WAITING_Y = [170, 180];

/** A part nobody has ported yet: the screen holds until the next part's first sync entry. */
function* waitForEntry(demo, entry) {
  while (syncAdvance(demo.machine) <= entry) {
    yield;
  }
}

function* runPart(demo, k) {
  const part = PARTS[k];
  demo.partIndex = k;
  const lastEntry = k === 6 ? INTRO_LAST_SYNC : k === 15 ? DEMO_LAST_SYNC : START_SYNC[k + 1] - 1;
  if (!part) {
    yield* waitForEntry(demo, lastEntry);
    return;
  }
  const state = part.init(demo);
  yield* part.run(demo, state, START_SYNC[k]);
  part.deinit?.(demo, state);
}

function* runDemoParts(demo) {
  for (let k = FIRST_DEMO_PART; k < PARTS_COUNT; k++) {
    yield* runPart(demo, k);
  }
}

function* play(demo) {
  const machine = demo.machine;
  print(machine.textScreen, BOOT_TEXT);
  yield;
  setGraphicsMode(machine);
  machine.song = 'intro';
  machine.syncTable = demo.syncTables.intro;
  machine.syncIndex = 0;
  resyncFrame(machine);
  for (let k = 0; k < FIRST_DEMO_PART; k++) {
    yield* runPart(demo, k);
  }
  // The intro song is stopped and freed. Entries 0..31 of the DAC become a grey ramp, the rest of
  // gl_pal stays, and the text goes onto the black screen part 6 left.
  machine.song = null;
  for (let i = 0; i < WAITING_GREYS; i++) {
    setDacEntry(machine, i, i, i, i);
  }
  drawSmallTextCentered(demo.font, machine.front, 'waiting for', WAITING_Y[0]);
  drawSmallTextCentered(demo.font, machine.front, 'robotnik{{{', WAITING_Y[1]);
  while (machine.time < SONG_STARTS.demo) {
    yield;
  }
  machine.song = 'demo';
  machine.syncTable = demo.syncTables.demo;
  machine.syncIndex = 0;
  machine.front.fill(0);
  resyncFrame(machine);
  // After part 15 returns (entry 37) main stops the music and sets text mode. On the real-hardware
  // clock that is 402.83 s; the recording got there 0.36 s earlier, its song running fast (machine.js).
  const demoParts = runDemoParts(demo);
  while (machine.time < END_TIME && !demoParts.next().done) {
    yield;
  }
  machine.song = null;
  machine.isTextMode = true;
  machine.textScreen = createTextScreen();
  // Mode 3 clears the screen; DOS prints its prompt.
  print(machine.textScreen, 'C:\\>');
  demo.isOver = true;
}


/**
 * @param {{exe: Uint8Array, image: object, archive: object}} files ROBOTNIK.EXE, its loaded program
 *   image (le.js) and its data archive (archive.js)
 */
export function createDemo(files) {
  const timelines = {
    intro: rowTimeline(files.archive.read('pullmax.xm')),
    demo: rowTimeline(files.archive.read('bergborr.xm')),
  };
  const demo = {
    machine: createMachine(timelines, SONG_STARTS),
    image: files.image.clone(),
    archive: files.archive,
    font: loadFont(files.archive.read('font.raw')),
    syncTables: {
      intro: readSyncTable(files.image, INTRO_SYNC_TABLE),
      demo: readSyncTable(files.image, DEMO_SYNC_TABLE),
    },
    /** Set after a jump in time, for parts that integrate per step and need to catch up. */
    isSeeking: false,
    /**
     * 0xe4d40: the 320x200 off-screen buffer many parts draw into; what one part leaves there is
     * what the next one finds (part 1's picture is zoomed by part 2, part 3's leftovers by part 4).
     */
    offscreen: new Uint8Array(64000),
    /**
     * [0x89f50] / [0x89f54]: the rows the triangle engine's edge walkers clip to. Part 12's init
     * (0x19ae0) sets 0..255 and nothing restores it, so the shatter of parts 13 and 15 runs with it.
     */
    triangleRowClip: { yMin: 0, yMax: 200 },
    /**
     * 0xfd0a0: the 64 KB colour x light blend table (row*256 + colour). Part 9's init fills rows
     * 0..127 (its shade table 0x1e420) and part 10 keeps using rows 1..127.
     */
    blendTable: new Uint8Array(0x10000),
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

/** A part shows at least one frame even when its time has passed; a jump steps through that many. */
const MAX_JUMP_STEPS = 64;
/** A seek replays this long before the part it lands in starts, so the part before ends as it would. */
const SEEK_LEAD_SECONDS = 2;
const FRAME_SECONDS = 1 / TICKS_PER_SECOND;

/** Where part k's first sync entry falls on the soundtrack. */
function partStartTime(demo, k) {
  const song = k < FIRST_DEMO_PART ? 'intro' : 'demo';
  const entry = demo.syncTables[song][START_SYNC[k]];
  const timeline = demo.machine.timelines[song];
  const reached = timeline.find((status) => status.position > entry.position
    || (status.position === entry.position && status.row >= entry.row)) ?? timeline[timeline.length - 1];
  return SONG_STARTS[song] + reached.time;
}

/**
 * Set the clock and step until a step leaves the same part running: parts whose last sync entry has
 * passed fall through. Parts are written so that a jump into the middle of one lands on the state
 * it would have reached.
 */
function jumpTo(demo, seconds) {
  demo.machine.time = seconds;
  demo.isSeeking = true;
  for (let i = 0; i < MAX_JUMP_STEPS && !demo.isOver; i++) {
    const before = demo.partIndex;
    demo.step();
    // The boot text screen comes before any part.
    if (demo.partIndex === before && before !== undefined) {
      break;
    }
  }
  demo.isSeeking = false;
}

/**
 * Seek forward. Some parts end with a transition of fixed length after their last sync entry (the
 * sunset's zoom, the fly-aways), which only plays out as the clock runs. So the seek jumps to a little
 * before the part playing at `seconds` starts, plays frames (70 per second) until that part has begun,
 * then jumps the rest of the way: inside a part, a jump lands where playing would.
 */
export function seekTo(demo, seconds) {
  let k = PARTS_COUNT - 1;
  while (k > 0 && partStartTime(demo, k) > seconds) {
    k--;
  }
  const lead = Math.min(seconds, partStartTime(demo, k) - SEEK_LEAD_SECONDS);
  if (lead > demo.machine.time) {
    jumpTo(demo, lead);
  }
  while (demo.partIndex !== k && demo.machine.time + FRAME_SECONDS <= seconds && !demo.isOver) {
    demo.machine.time += FRAME_SECONDS;
    demo.step();
  }
  jumpTo(demo, seconds);
}
