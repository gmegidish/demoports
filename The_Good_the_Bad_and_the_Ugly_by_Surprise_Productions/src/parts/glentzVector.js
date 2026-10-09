// The Glentz-Vector, 08d8:1625 and the clear after it, 08d8:16de (docs/disassembly/G4_water_glentz_wobbler.md,
// section 2): a cube inside a transparent star of four triangles (object 05ca:0000), drawn by the shared 08d8 engine
// in the 16-colour planar mode, flying in from the left, coming close, and leaving to the right. The angles it
// starts from are the ones the intro (08d8:275d) left in the engine's variables.
import * as engine from '../engine3d.js';

/** @typedef {import('../machine.js').Machine} Machine */

const { ENGINE, ENGINE_SEGMENT_BASE } = engine;
const OBJECT_SEGMENT = 0x05ca;
const SEQUENCER_INDEX = 0x3c4;
const Y_CENTRE = 0x64;
const START_DISTANCE = 0x1356;
const START_X = 0xffb0;
/** 1648..16ca: phases of [retraces, x speed (1578h), approach speed (157ah)]; the overshoot carries over. */
const PHASES = [
  [0x78, 2, 0x19],
  [0x6e, 0, 0],
  [0x12c, 0, 5],
  [0xfa, 0, 0],
  [0x82, 2, 0xffe2],
];
const SCREEN_WORDS = 0x1f40;

const address = (offset) => ENGINE_SEGMENT_BASE + offset;

/** 08d8:158f: show the last page, wait a tick, draw the next page, then one motion step per tick that passed. */
function* frame(m) {
  yield* engine.flipPageTick(m);
  engine.drawObjectFrame(m, OBJECT_SEGMENT);
  const ticks = engine.readFrameCounter(m);
  for (let i = 0; i < ticks; i++) {
    engine.stepAngles(m);
    m.set16(address(ENGINE.X_CENTRE), m.u16(address(ENGINE.X_CENTRE)) + m.u16(address(ENGINE.ROLL_SPEED)));
    m.set16(address(ENGINE.DISTANCE), m.u16(address(ENGINE.DISTANCE)) - m.u16(address(ENGINE.APPROACH_SPEED)));
  }
  return ticks;
}

/** 08d8:16de: all planes of a000:0000..3e7f cleared, start address 0. */
function clearScreen(m) {
  const vga = m.vga;
  vga.out16(SEQUENCER_INDEX, 0x0f02);
  for (const plane of vga.planes) {
    plane.fill(0, 0, SCREEN_WORDS * 2);
  }
  engine.setStartAddress(m, 0);
}

/** 08d8:1625 then 08d8:16de. */
export function* glentzVector(m) {
  m.set16(address(ENGINE.Y_CENTRE), Y_CENTRE);
  m.set16(address(ENGINE.DISTANCE), START_DISTANCE);
  m.set16(address(ENGINE.X_CENTRE), START_X);
  let remaining = 0;
  for (const [retraces, rollSpeed, approachSpeed] of PHASES) {
    m.set16(address(ENGINE.ROLL_SPEED), rollSpeed);
    m.set16(address(ENGINE.APPROACH_SPEED), approachSpeed);
    remaining += retraces;
    do {
      remaining -= yield* frame(m);
    } while (remaining > 0);
  }
  clearScreen(m);
}
