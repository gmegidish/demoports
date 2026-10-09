// 08d8:2dc1: Glentz-chess-cube (Erik). The XOR-filled checker cube of object 0463 on the shared 08d8 engine: the
// board spins in the image plane, the view zooms out to the cube, it tumbles, then slides down. Phases are tick
// budgets; the overshoot carries over. docs/disassembly/G5_chesszoom_bars_eb3.md, "08d8:2dc1".
import * as engine from '../engine3d.js';

const { ENGINE, ENGINE_SEGMENT_BASE: CS } = engine;

/** The checker cube object (segment 0463). */
const CHESS_CUBE = 0x0463;
const X_CENTRE = 0xa0;
const START_DISTANCE = 0x96;
const Y_CENTRE = 0x64;
const SPIN_SPEED = 4;
const TUMBLE_SPEED = 2;
const SLIDE_SPEED = 2;

/** Tick budgets of the phases and what changes before each: [ticks, distance speed, roll speed, y speed]. */
const PHASES = [
  { ticks: 0x12c, distance: 0 },
  { ticks: 0x46, distance: 0x0a },
  { ticks: 0x32, distance: 0x0a, roll: TUMBLE_SPEED },
  { ticks: 0x32, distance: 0x0a },
  { ticks: 0x1e, distance: 8 },
  { ticks: 0x0a, distance: 6 },
  { ticks: 0x0a, distance: 4 },
  { ticks: 0x0a, distance: 2 },
  { ticks: 0x320, distance: 0 },
  { ticks: 0x78, slide: SLIDE_SPEED },
];

function setWord(m, offset, value) {
  m.set16(CS + offset, value & 0xffff);
}

/** 2d48: frames until `budget` ticks are used; returns the (zero or negative) rest. */
function* runPhase(m, budget) {
  let rest = budget;
  do {
    yield* engine.flipPageTick(m);
    engine.clearPreviousBox(m);
    engine.saveBox(m);
    engine.resetFrameBox(m);
    engine.drawObject(m, CHESS_CUBE);
    const ticks = engine.readFrameCounter(m);
    for (let i = 0; i < (ticks === 0 ? 0x10000 : ticks); i++) {
      engine.stepMotion(m);
    }
    rest = (rest - ticks) << 16 >> 16;
  } while (rest > 0);
  return rest;
}

/** 08d8:2dc1. */
export function* glentzChessCube(m) {
  setWord(m, ENGINE.ANGLE_A95, 0);
  setWord(m, ENGINE.ANGLE_A97, 0);
  setWord(m, ENGINE.ANGLE_A99, 0);
  setWord(m, ENGINE.X_CENTRE, X_CENTRE);
  setWord(m, ENGINE.DISTANCE, START_DISTANCE);
  setWord(m, ENGINE.ROLL_SPEED, 0);
  setWord(m, ENGINE.SPEED_A97, 0);
  setWord(m, ENGINE.SPEED_A99, SPIN_SPEED);
  setWord(m, ENGINE.SPEED_DISTANCE, 0);
  let budget = 0;
  for (const phase of PHASES) {
    if (phase.distance !== undefined) {
      setWord(m, ENGINE.SPEED_DISTANCE, phase.distance);
    }
    if (phase.roll !== undefined) {
      setWord(m, ENGINE.ROLL_SPEED, phase.roll);
    }
    budget = (budget + phase.ticks) << 16 >> 16;
    if (phase.slide !== undefined) {
      setWord(m, ENGINE.SPEED_Y_CENTRE, phase.slide);
    }
    budget = yield* runPhase(m, budget);
  }
  setWord(m, ENGINE.SPEED_Y_CENTRE, 0);
  setWord(m, ENGINE.Y_CENTRE, Y_CENTRE);
}
