// The Rotating-door, 08d8:3e3a with 3d90, 3d3c, 3d5c (docs/disassembly/G6_greets_tunnel_city.md, section 3.8):
// ten bars (two groups of five rectangles) slide towards each other while the whole set turns, drawn with the
// vector engine's clipped XOR lines into the screen2 buffer and filled into the page just left. First half in
// plane 3 (lilac bars over the pattern and city), second half in all planes (black and lilac).
import { waitTick } from '../machine.js';
import { setDac } from '../library.js';
import * as engine from '../engine3d.js';
import { SEGMENT_08D8, cyclePage, setColourSelect, showCurrentPage } from './surprisePages.js';

/** 08d8:3a3c: 40 points (x, y, z); 3ab4: the second group of 20. 3b2c: their projections. 3c6c: 40 edges. */
const POINTS = SEGMENT_08D8 + 0x3a3c;
const RIGHT_GROUP = SEGMENT_08D8 + 0x3ab4;
const PROJECTED = SEGMENT_08D8 + 0x3b2c;
const EDGES = SEGMENT_08D8 + 0x3c6c;
const GROUP_POINTS = 0x14;
const POINT_COUNT = 0x28;
const EDGE_COUNT = 0x28;
const SLIDE = 4;
/** 08d8:3d6e: the z-axis angle grows 4 bytes (1 degree) per frame, modulo 5a0h. */
const ANGLE_STEP = 4;
const ANGLE_TURN = 0x5a0;
/** 08d8:3d8c: the step count 3d90 returns (always 1). */
const STEP_COUNT = SEGMENT_08D8 + 0x3d8c;
/** 08d8:3900: the page the frame goes into. */
const DOOR_PAGE = SEGMENT_08D8 + 0x3900;
/** 08d8:000a: segment of the screen2 buffer (the door's ds). */
const SCREEN2_SEGMENT_VARIABLE = 0x000a;
/** 08d8:3258: black and lilac, the second half's palette. */
const PALETTE_DOOR = SEGMENT_08D8 + 0x3258;
const DOOR_COLOURS = 0x20;
const HALF_FRAMES = 0x61;
const SEQUENCER_INDEX = 0x3c4;

/** 08d8:3d3c: the left group slides right, the right group left. */
function slideBars(m) {
  for (let i = 0; i < GROUP_POINTS; i++) {
    m.set16(POINTS + i * 6, m.u16(POINTS + i * 6) + SLIDE);
    m.set16(RIGHT_GROUP + i * 6, m.u16(RIGHT_GROUP + i * 6) - SLIDE);
  }
}

/** 08d8:3d5c: rotate and project the points, then turn the z angle by a degree. */
function projectBars(m) {
  engine.projectVertices(m, POINTS, PROJECTED, POINT_COUNT);
  const angle = engine.ENGINE_SEGMENT_BASE + engine.ENGINE.ANGLE_A99;
  let value = (m.u16(angle) + ANGLE_STEP) & 0xffff;
  if (value >= ANGLE_TURN) {
    value -= ANGLE_TURN;
  }
  m.set16(angle, value);
}

/** 08d8:3d90: one door frame into the page just left. */
function* doorFrame(m) {
  engine.readFrameCounter(m);
  m.set16(STEP_COUNT, 1);
  slideBars(m);
  projectBars(m);
  m.set16(DOOR_PAGE, cyclePage(m));
  showCurrentPage(m);
  yield* waitTick(m);
  setColourSelect(m);
  m.set16(engine.ENGINE_SEGMENT_BASE + engine.ENGINE.FILL_ALL_SEGMENT, (m.u16(DOOR_PAGE) >> 4) + 0xa000);
  engine.selectBuffer(SCREEN2_SEGMENT_VARIABLE);
  for (let i = 0; i < EDGE_COUNT; i++) {
    const a = PROJECTED + m.u16(EDGES + i * 4);
    const b = PROJECTED + m.u16(EDGES + i * 4 + 2);
    engine.drawEdge(m, m.s16(a), m.s16(a + 2), m.s16(b), m.s16(b + 2));
  }
  engine.fillAll(m);
  engine.selectBuffer(engine.ENGINE.BUFFER_SEGMENT);
}

/** 08d8:3e3a. */
export function* rotatingDoor(m) {
  const vga = m.vga;
  const base = engine.ENGINE_SEGMENT_BASE;
  vga.out16(SEQUENCER_INDEX, 0x0802);
  m.set16(base + engine.ENGINE.DISTANCE, 0);
  const savedAngles = [engine.ENGINE.ANGLE_A95, engine.ENGINE.ANGLE_A97, engine.ENGINE.ANGLE_A99].map((v) => m.u16(base + v));
  for (const v of [engine.ENGINE.ANGLE_A95, engine.ENGINE.ANGLE_A97, engine.ENGINE.ANGLE_A99]) {
    m.set16(base + v, 0);
  }
  let remaining = HALF_FRAMES;
  do {
    yield* doorFrame(m);
    remaining -= m.u16(STEP_COUNT);
  } while (remaining >= 0);
  yield* waitTick(m);
  setDac(m, 0, DOOR_COLOURS, PALETTE_DOOR);
  vga.out16(SEQUENCER_INDEX, 0x0f02);
  remaining += HALF_FRAMES + 1;
  do {
    yield* doorFrame(m);
    remaining -= m.u16(STEP_COUNT);
  } while (remaining >= 0);
  m.set16(base + engine.ENGINE.ANGLE_A99, savedAngles[2]);
  m.set16(base + engine.ENGINE.ANGLE_A97, savedAngles[1]);
  m.set16(base + engine.ENGINE.ANGLE_A95, savedAngles[0]);
}
