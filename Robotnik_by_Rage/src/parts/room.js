// Demo part 10: the cloth room. Part 9's last picture tumbles away with cl_pic.raw on its back
// (0x28168), then a cloth falls over an invisible table in an octagonal room under a recorded camera,
// casting a black shadow on the floor, while six light flares circle and the words "vectors",
// "burn", "flesh" flash over the picture; the last frame flies away (0x28038). Ports init 0x13128,
// run 0x1366c(0xc) and deinit 0x139fc; the cloth (0x14730 / 0x13df0) is in cloth.js, the scene
// objects in roomscene.js. See docs/disassembly/P10_room.md.
//
// The loop never waits for a tick, and the cloth takes (dt + 1) >> 1 steps per pass, dt = ticks since
// the previous pass: how far it has fallen depends on how many passes the machine managed. The port
// replays the passes of the reference recording (PASS_TICKS below, measured in demo.avi), so the
// cloth takes the same steps; a pass shows its picture when the next one starts.

import { frame, syncAdvance, resyncFrame, entryFrame, entryTime, setDac, SCREEN_BYTES } from '../machine.js';
import { RenderWorld, SetObjAngleY, playCameraRecord, cameraRecordCount } from '../engine/index.js';
import { computeObjectBounds } from '../engine/world.js';
import { shadeShifted } from '../gfx.js';
import { stepCloth, stepsForTicks, updateClothMesh, setExternalForce, GRID } from './cloth.js';
import { loadRoom, createRoomWorld } from './roomscene.js';
import { pictureIntro, flyAway } from './flyaway.js';

/**
 * Ticks from sync entry 11 (part 9's end) to the first frame of the intro: init loading its files.
 * demo.avi: part 9's last picture is held 21 ticks, the intro (one frame per tick, t = ticks since
 * its start) begins 287 ticks before the loop's start at entry 12.
 */
const LOADING_TICKS = 26;
/**
 * The passes of 0x1366c's loop in demo.avi (frames 389..1646, 229.55..247.49 s): the first pass
 * ends FIRST_PASS_TICKS after the loop starts (fitted: the camera record each picture shows matches
 * demo.avi exactly), then each digit is the ticks between two copies to
 * the screen (3..6: the machine slows down while the room fills the view). A pass reads the tick
 * counter where the previous one ended. Past the table, passes take DEFAULT_PASS_TICKS.
 */
const FIRST_PASS_TICKS = 5;
const PASS_TICKS = '455545554545454454455555555554545454545445444444434434434344343434434343443444444344444444444444'
  + '344444443444444345555555565555565555556555555555565555565556565656656665666666656665666566565655656'
  + '556555445445454455454545454544544454545555445444444344443444434443444344434444344433';
const DEFAULT_PASS_TICKS = 4;
/** The cloth hangs still while elapsed <= 90 ticks. */
const STILL_TICKS = 90;
/** Flares: AngleY = -5 per tick. */
const FLARE_SPIN = -5;
/** Wind phase: wt = elapsed * 0.02 (float32), used by the next pass. */
const WIND_RATE = 0.02;
/** [ (row, column), sine rate, amplitude ] of the four pushed corners, in the order 0x1366c sets them. */
const WINDS = [[0, 0, 1.4, 0.06], [0, GRID - 1, 1.3, 0.04], [GRID - 1, 0, 1.9, 0.04], [GRID - 1, GRID - 1, 1, 0.06]];
/** Word overlays: rows (of 0.14 s) since the loop started; 16-row windows 3, 4, 5. */
const ROWS_PER_WORD = 16;
const FIRST_WORD_WINDOW = 3;
const FULL_STRENGTH_ROWS = 2;
const WORD_ADD = 0x40;
const FRAMES_PER_ROW_NUMERATOR = 49;
const FRAMES_PER_ROW_DENOMINATOR = 5;
/** The rows counter the overlay reads lags the end of the pass by this many ticks (the copy). */
const OVERLAY_LAG_TICKS = 1;
/** 0x28038(0xf, 0, -2, 0, 15, 0, 0): slide 2 units up per tick (screen down), tilt 15 per tick about X. */
const FALL_VELOCITY = [0, -2, 0];
const FALL_SPIN = [15, 0, 0];
const FALL_LAST_ENTRY_AFTER_START = 3;

/** The tick counter value pass `k` reads (0 = the loop's start). */
function passTick(k) {
  let tick = k === 0 ? 0 : FIRST_PASS_TICKS;
  for (let i = 0; i < k - 1; i++) {
    tick += i < PASS_TICKS.length ? Number(PASS_TICKS[i]) : DEFAULT_PASS_TICKS;
  }
  return tick;
}

const PASS_START_TICKS = Array.from({ length: PASS_TICKS.length + 2 }, (_, k) => passTick(k));

function passStart(k) {
  if (k < PASS_START_TICKS.length) {
    return PASS_START_TICKS[k];
  }
  return PASS_START_TICKS[PASS_START_TICKS.length - 1] + (k - PASS_START_TICKS.length + 1) * DEFAULT_PASS_TICKS;
}

function* waitForEntry(m, entry) {
  while (syncAdvance(m) <= entry) {
    yield;
  }
}

/** The steps of 0x13df0 UpdateCloth(ticks); its mesh half runs before each render (drawPass). */
function stepClothFor(state, ticks) {
  for (let n = stepsForTicks(ticks); n > 0; n--) {
    stepCloth(state.cloth);
  }
}

/** The pushes on the four corners for the next pass, from the previous pass's phase. */
function setWind(state) {
  for (const [r, c, rate, amplitude] of WINDS) {
    setExternalForce(state.cloth, r, c, [0, 0, Math.fround(Math.sin(state.windPhase * rate) * amplitude)]);
  }
}

/** 0x119e0 over the back buffer when the rows counter is in a word's window. */
function overlayWord(demo, state, rows) {
  const word = rows >> 4;
  if (word < FIRST_WORD_WINDOW || word >= FIRST_WORD_WINDOW + state.words.length) {
    return;
  }
  const shift = Math.max((rows & (ROWS_PER_WORD - 1)) - FULL_STRENGTH_ROWS, 0);
  shadeShifted(state.words[word - FIRST_WORD_WINDOW], demo.offscreen, demo.blendTable, shift, WORD_ADD);
}

/** The camera record, the cloth's mesh, the flares, RenderWorld, the word, the copy to VGA (which clears the back buffer). */
function drawPass(demo, state, elapsed, rowsTick) {
  const m = demo.machine;
  playCameraRecord(state.world, state.camera, Math.min(elapsed, cameraRecordCount(state.camera) - 1));
  updateClothMesh(state.cloth, state.scene.cloth);
  computeObjectBounds(state.scene.cloth);
  SetObjAngleY(state.scene.flares, (FLARE_SPIN * elapsed) << 16 >> 16);
  RenderWorld(state.world, { target: demo.offscreen, colourTable: demo.blendTable });
  overlayWord(demo, state, Math.floor((rowsTick * FRAMES_PER_ROW_DENOMINATOR) / FRAMES_PER_ROW_NUMERATOR));
  m.front.set(demo.offscreen.subarray(0, SCREEN_BYTES));
  demo.offscreen.fill(0);
}

/**
 * One pass of 0x1366c's loop reading `elapsed` ticks; drawn only when `isShown` (passes a jump in
 * time skips still move the cloth).
 */
function runPass(demo, state, elapsed, isShown, rowsTick) {
  const dt = elapsed - state.elapsed;
  state.elapsed = elapsed;
  if (elapsed > STILL_TICKS) {
    stepClothFor(state, dt);
  }
  if (isShown) {
    drawPass(demo, state, elapsed, rowsTick);
  }
  setWind(state);
  state.windPhase = Math.fround(elapsed * WIND_RATE);
}

/** The main loop from sync entry `firstSync` until a pass sees entry firstSync + 1; returns the last pass's end tick. */
function* mainLoop(demo, state, firstSync) {
  const m = demo.machine;
  resyncFrame(m, entryTime(m, firstSync));
  const start = entryFrame(m, firstSync);
  const lastTick = entryFrame(m, firstSync + 1) - start;
  state.elapsed = 0;
  state.windPhase = 0;
  for (let k = 0; ; k++) {
    while (frame(m) - start < passStart(k + 1)) {
      yield;
    }
    const now = frame(m) - start;
    const elapsed = passStart(k);
    const isLast = elapsed >= lastTick;
    runPass(demo, state, elapsed, isLast || passStart(k + 2) > now, passStart(k + 1) - OVERLAY_LAG_TICKS);
    if (isLast) {
      return start + passStart(k + 1);
    }
  }
}

export const room = {
  /** 0x13128 up to the intro: files, tables, the cloth, the scene objects. */
  init(demo) {
    return loadRoom(demo);
  },

  /** The intro (end of 0x13128), 0x1366c(firstSync) and its fly-away. */
  *run(demo, state, firstSync) {
    const m = demo.machine;
    const introStart = entryFrame(m, firstSync - 1) + LOADING_TICKS;
    while (frame(m) < introStart && syncAdvance(m) <= firstSync) {
      yield;
    }
    yield* pictureIntro(demo, state.picture, introStart);
    setDac(m, state.palette);
    state.world = createRoomWorld(state.scene);
    stepClothFor(state, 1);
    yield* waitForEntry(m, firstSync);
    const fallStart = yield* mainLoop(demo, state, firstSync);
    yield;
    yield* flyAway(demo, firstSync + FALL_LAST_ENTRY_AFTER_START, FALL_VELOCITY, FALL_SPIN, fallStart);
    m.front.fill(0);
    demo.offscreen.fill(0);
  },
};
