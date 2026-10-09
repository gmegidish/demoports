// Two glentz cubes and the jelly cube (08d8:25f4, Erik), then the clear 08d8:16de. 16-colour planar, the shared
// 08d8 engine (engine3d.js) with pages 0 / 1f40h flipped at each timer tick. docs/disassembly/G8_cubes_dots.md, part 1.
import * as engine from '../engine3d.js';
import { setDac } from '../library.js';

const { ENGINE, ENGINE_SEGMENT_BASE: CS } = engine;

const TWO_CUBES = 0x5a1;
const SMALL_CUBE = 0x586;
const JELLY = 0x555;
const CUBE_0_VERTICES = 0x0c;
const CUBE_1_VERTICES = 0x3c;
const CUBE_VERTEX_COUNT = 8;
const VERTEX_COUNT = 8;

// 08d8 variables of this effect
const JELLY_DISTANCE = 0x00a5;
const SHAPE_INDEX = 0x1a12;
const WOBBLE_INDEX = 0x1a14;
const SHAPE_STEPS = 0x1ab8;
const SHAPES = 0x1a16;
const WOBBLE = 0x1eb7;
const BOUNCE_INDEX = 0x1fa6;
const BOUNCE = 0x1bf9;
const STATE = 0x21f6;
const COUNTDOWN = 0x21f7;
const SIZE = 0x21f8;
const SEPARATION = 0x21fc;
const APPROACH = 0x249d;
const FLY_SPEED = 0x2528;
const PALETTE_GLENTZ = 0x21c6;
const PALETTE_OPAQUE = 0x2196;

const VGA_SEGMENT = 0xa000;
const START_DISTANCE = 0x4e20;
const APPROACH_STEP = 0xc6;
const APPROACH_STEPS = 0x64;
const START_A97 = 0xdc;
const X_CENTRE = 0xa0;
const ANGLE_TURN = 0x5a0;
const JELLY_A97 = 0x64;
const JELLY_TICKS = 0x2bc;
const FLY_AWAY_TICKS = 0x64;
const FLY_START_SPEED = 0x32;
const FLY_ACCELERATION = 5;
const SPIN_STEP = 8;
const LAST_STATE = 12;
const SEQUENCER_INDEX = 0x3c4;
const BOTH_PAGES_WORDS = 0x1f40;

/** The order of the signs of a cube's 24 coordinates (206c, and 20f2 with "+" = `sub a`, "-" = `sub -a`). */
const CUBE_SIGNS = [-1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1];

function word(m, offset) {
  return m.s16(CS + offset);
}

function setWord(m, offset, value) {
  m.set16(CS + offset, value);
}

/** Vertices of cube 0 or 1 of the two-cube object. */
function cubeBase(cube) {
  return TWO_CUBES * 16 + (cube === 0 ? CUBE_0_VERTICES : CUBE_1_VERTICES);
}

/** 08d8:206c: the cube becomes the cube of half-size `size`. */
function setCubeSize(m, size, cube) {
  const base = cubeBase(cube);
  CUBE_SIGNS.forEach((sign, k) => m.set16(base + 2 * k, sign * size));
}

/** 08d8:20b2: y of the cube's 8 vertices += dy. */
function moveCubeY(m, dy, cube) {
  const base = cubeBase(cube) + 2;
  for (let k = 0; k < CUBE_VERTEX_COUNT; k++) {
    m.set16(base + 6 * k, m.u16(base + 6 * k) + dy);
  }
}

/** 08d8:20f2: every coordinate's magnitude grows by `delta` (negative shrinks). */
function growCube(m, delta, cube) {
  const base = cubeBase(cube);
  CUBE_SIGNS.forEach((sign, k) => m.set16(base + 2 * k, m.u16(base + 2 * k) + sign * delta));
}

/** Ends a state: next state, `countdown` steps until the next call. */
function nextState(m, countdown) {
  m.mem[CS + STATE] = (m.mem[CS + STATE] + 1) & 0xff;
  m.mem[CS + COUNTDOWN] = countdown;
}

/** Sizes the cube 0 toward `target` one per 5 steps (states 0..2); uses the size before the change. */
function resizeToward(m, target, direction) {
  const size = word(m, SIZE);
  if (size === target) {
    nextState(m, 0x50);
    return;
  }
  setWord(m, SIZE, size + direction);
  setCubeSize(m, size, 0);
  m.mem[CS + COUNTDOWN] = 5;
}

/** 08d8:21fd: the script of the two cubes, one state per call (called when the countdown runs out). */
function stepScript(m) {
  const mem = m.mem;
  const size = word(m, SIZE);
  switch (mem[CS + STATE]) {
    case 0: resizeToward(m, 0x50, 1); break;
    case 1: resizeToward(m, 0x28, -1); break;
    case 2: resizeToward(m, 0x3d, 1); break;
    case 3:
      if (mem[CS + SEPARATION] === 0x64) {
        nextState(m, 0x5a);
      } else {
        mem[CS + SEPARATION]++;
        moveCubeY(m, 1, 0);
        moveCubeY(m, -1, 1);
        mem[CS + COUNTDOWN] = 2;
      }
      break;
    case 4:
      if (mem[CS + SEPARATION] === 0) {
        nextState(m, 0x32);
      } else {
        mem[CS + SEPARATION]--;
        moveCubeY(m, -1, 0);
        moveCubeY(m, 1, 1);
        mem[CS + COUNTDOWN] = 2;
      }
      break;
    case 5:
      mem[CS + COUNTDOWN] = 1;
      if (word(m, ENGINE.ANGLE_A95) === 0 && word(m, ENGINE.ANGLE_A99) === 0) {
        setWord(m, ENGINE.ROLL_SPEED, 0);
        setWord(m, ENGINE.SPEED_A99, 0);
        nextState(m, 1);
      }
      break;
    case 6:
      if (word(m, ENGINE.Y_CENTRE) === 0) {
        nextState(m, 1);
      } else {
        setWord(m, ENGINE.Y_CENTRE, word(m, ENGINE.Y_CENTRE) - 1);
        moveCubeY(m, 2, 0);
        moveCubeY(m, 2, 1);
        mem[CS + COUNTDOWN] = 1;
      }
      break;
    case 7:
      if (size === 0x51) {
        nextState(m, 1);
      } else {
        growCube(m, 1, 0);
        growCube(m, 1, 1);
        moveCubeY(m, -1, 0);
        moveCubeY(m, -1, 1);
        setWord(m, SIZE, size + 1);
        mem[CS + COUNTDOWN] = 1;
      }
      break;
    case 8:
      mem[CS + COUNTDOWN] = 1;
      if (word(m, ENGINE.ANGLE_A97) === 0x64) {
        m.set16(TWO_CUBES * 16 + VERTEX_COUNT, 8); // cube 1 is no longer projected: it freezes
        nextState(m, 0x64);
      }
      break;
    case 9:
      if (size === 0x1e) {
        nextState(m, 1);
      } else {
        growCube(m, -1, 0);
        moveCubeY(m, -1, 0);
        setWord(m, SIZE, size - 1);
        mem[CS + COUNTDOWN] = 1;
      }
      break;
    case 10:
      if (size === -0x82) {
        nextState(m, 1);
        setDac(m, 0, 16, CS + PALETTE_OPAQUE);
      } else {
        moveCubeY(m, -1, 0);
        setWord(m, SIZE, size - 1);
        mem[CS + COUNTDOWN] = 1;
      }
      break;
    case 11:
      if (size < -0x1e) {
        moveCubeY(m, 6, 0);
        setWord(m, SIZE, size + 6);
        mem[CS + COUNTDOWN] = 1;
      } else {
        nextState(m, 1);
      }
      break;
    default:
      break;
  }
}

/** One frame of the engine: flip at the tick, clear the old box, save and reset the boxes. */
function* beginFrame(m) {
  yield* engine.flipPageTick(m);
  engine.clearPreviousBox(m);
  engine.saveBox(m);
  engine.resetFrameBox(m);
}

/** 08d8:249e: the two glentz cubes, until the script reaches state 12. */
function* twoCubes(m) {
  const mem = m.mem;
  setDac(m, 0, 16, CS + PALETTE_GLENTZ);
  setWord(m, ENGINE.ROLL_SPEED, 4);
  setWord(m, ENGINE.SPEED_A97, 8);
  setWord(m, ENGINE.SPEED_A99, 6);
  do {
    yield* beginFrame(m);
    engine.drawObject(m, TWO_CUBES);
    const ticks = engine.readFrameCounter(m);
    for (let t = 0; t < ticks; t++) {
      mem[CS + COUNTDOWN] = (mem[CS + COUNTDOWN] - 1) & 0xff;
      if (mem[CS + COUNTDOWN] === 0) {
        stepScript(m);
      }
      mem[CS + APPROACH] = (mem[CS + APPROACH] + 1) & 0xff;
      if (mem[CS + APPROACH] <= APPROACH_STEPS) {
        setWord(m, ENGINE.DISTANCE, word(m, ENGINE.DISTANCE) - APPROACH_STEP);
      } else {
        mem[CS + APPROACH]--;
      }
      engine.stepMotion(m);
    }
  } while (mem[CS + STATE] < LAST_STATE);
}

/** 08d8:1ec8: the jelly's next shape (height, bulge) and distance wobble. */
function shapeJelly(m) {
  const mem = m.mem;
  const base = JELLY * 16;
  const shape = 2 * mem[CS + SHAPE_STEPS + m.u16(CS + SHAPE_INDEX)];
  const bulge = (mem[CS + SHAPES + 1 + shape] + 5) & 0xff;
  m.set16(base + 0x3c, -bulge);
  m.set16(base + 0x40, bulge);
  m.set16(base + 0x42, bulge);
  m.set16(base + 0x46, bulge);
  m.set16(base + 0x48, bulge);
  m.set16(base + 0x4c, -bulge);
  const top = mem[CS + SHAPES + shape] + 10;
  for (const at of [0x0e, 0x14, 0x26, 0x2c]) {
    m.set16(base + at, top);
  }
  setWord(m, JELLY_DISTANCE, word(m, JELLY_DISTANCE) + m.s8(CS + WOBBLE + m.u16(CS + WOBBLE_INDEX)));
  let index = m.u16(CS + SHAPE_INDEX) + 2;
  if (index >= 0x140) {
    index -= 0x140;
  }
  setWord(m, SHAPE_INDEX, index);
  let wobble = m.u16(CS + WOBBLE_INDEX) + 1;
  if (wobble >= 0x10) {
    wobble -= 0x10;
  }
  setWord(m, WOBBLE_INDEX, wobble);
}

/** 08d8:1fa8: the small cube's next height (y of its 8 vertices: top, top, bottom, bottom, ...). */
function bounceSmallCube(m) {
  const base = SMALL_CUBE * 16 + 0x0e;
  const index = m.u16(CS + BOUNCE_INDEX);
  const top = m.s16(CS + BOUNCE + index) + 0x16;
  const bottom = top + 0x3c;
  [top, top, bottom, bottom, top, top, bottom, bottom].forEach((y, k) => m.set16(base + 6 * k, y));
  setWord(m, BOUNCE_INDEX, index + 4 >= 0x280 ? index + 4 - 0x280 : index + 4);
}

/** 08d8:1f59: the jelly at its own distance and a fixed view (a95 0, a97 64h, a99 0). */
function drawJelly(m) {
  const saved = [ENGINE.ANGLE_A95, ENGINE.ANGLE_A97, ENGINE.ANGLE_A99, ENGINE.DISTANCE].map((o) => m.u16(CS + o));
  setWord(m, ENGINE.DISTANCE, m.u16(CS + JELLY_DISTANCE));
  setWord(m, ENGINE.ANGLE_A95, 0);
  setWord(m, ENGINE.ANGLE_A97, JELLY_A97);
  setWord(m, ENGINE.ANGLE_A99, 0);
  engine.drawBendingObject(m, JELLY);
  [ENGINE.ANGLE_A95, ENGINE.ANGLE_A97, ENGINE.ANGLE_A99, ENGINE.DISTANCE].forEach((o, i) => setWord(m, o, saved[i]));
}

/** 08d8:252a: the jelly with the small bouncing cube (700 ticks), then the jelly alone flying away (100 ticks). */
function* jelly(m) {
  shapeJelly(m);
  bounceSmallCube(m);
  let ticksLeft = JELLY_TICKS;
  do {
    yield* beginFrame(m);
    engine.drawObject(m, SMALL_CUBE);
    drawJelly(m);
    const ticks = engine.readFrameCounter(m);
    for (let t = 0; t < ticks; t++) {
      let a97 = (m.u16(CS + ENGINE.ANGLE_A97) + SPIN_STEP) & 0xffff;
      if (a97 >= ANGLE_TURN) {
        a97 -= ANGLE_TURN;
      }
      setWord(m, ENGINE.ANGLE_A97, a97);
      shapeJelly(m);
      bounceSmallCube(m);
    }
    ticksLeft -= ticks;
  } while (ticksLeft > 0);
  setWord(m, FLY_SPEED, FLY_START_SPEED);
  ticksLeft += FLY_AWAY_TICKS;
  do {
    yield* beginFrame(m);
    const ticks = engine.readFrameCounter(m);
    for (let t = 0; t < ticks; t++) {
      drawJelly(m);
      setWord(m, FLY_SPEED, word(m, FLY_SPEED) + FLY_ACCELERATION);
      shapeJelly(m);
      setWord(m, JELLY_DISTANCE, word(m, JELLY_DISTANCE) + word(m, FLY_SPEED));
    }
    ticksLeft -= ticks;
  } while (ticksLeft > 0);
}

/** 08d8:16de: both pages cleared (all planes), start address 0. */
export function clearBothPages(m) {
  m.vga.out16(SEQUENCER_INDEX, 0x0f02);
  for (let offset = 0; offset < BOTH_PAGES_WORDS * 2; offset++) {
    m.vga.write(offset, 0);
  }
  engine.setStartAddress(m, 0);
}

/** 08d8:25f4, then 08d8:16de. */
export function* glentzCubes(m) {
  setWord(m, ENGINE.X_CENTRE, X_CENTRE);
  setWord(m, ENGINE.ANGLE_A95, 0);
  setWord(m, ENGINE.ANGLE_A97, START_A97);
  setWord(m, ENGINE.ANGLE_A99, 0);
  setWord(m, ENGINE.FILL_SEGMENT, VGA_SEGMENT);
  setWord(m, ENGINE.PAGE, 0);
  setWord(m, ENGINE.DISTANCE, START_DISTANCE);
  setWord(m, ENGINE.SPEED_DISTANCE, 0);
  yield* twoCubes(m);
  yield* jelly(m);
  clearBothPages(m);
}
