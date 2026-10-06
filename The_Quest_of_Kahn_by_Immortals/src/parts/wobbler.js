// The "wobbler": a picture stretched over a 40x25 grid of 8x8 cells whose texture coordinates
// swim. Three pictures, three ways of moving the grid, shown between the 3D parts.
// KAHN.EXE 0x1541e (tables), 0x15637 / 0x157b0 / 0x1592b (grids), 0x154d4 (draw),
// 0x15acc / 0x15c8e / 0x15f4e (the three parts).

import { PALETTE_BYTES, showBuffer, clearBuffer } from '../machine.js';
import { loadPicture } from '../engine/pictures.js';
import { fillAffineTriangle, AFFINE_OPAQUE } from '../engine/raster.js';
import { TICKS, loaderLog, stepFadeIn, whiteDac } from './common.js';

const f = Math.fround;

const COLUMNS = 41;
const ROWS = 26;
const CELL = 8;
const CELLS_ACROSS = COLUMNS - 1;
const CELLS_DOWN = ROWS - 1;
const PI = 3.14159265358979;
const TWO_PI = 6.28318530717959;

const FIRST_TICKS = Math.trunc(TICKS * 5.7);
const SECOND_CALM_TICKS = TICKS * 4;
const SECOND_WILD_TICKS = TICKS * 11;
const THIRD_TICKS = Math.trunc(TICKS * 10.5);
/** The two phases of the motion, in radians per tick. */
const PHASE_PER_TICK = 0.01;
const SLOW_PHASE_PER_TICK = 0.003;

/** atan2 folded into 0..2*pi, as the original's helper computes it. 0x1535e. */
function angleOf(x, y) {
  if (y >= 0) {
    if (x === 0) {
      return f(1.5707964);
    }
    return x > 0 ? f(Math.atan(y / x)) : f(Math.atan(y / x) + PI);
  }
  if (x === 0) {
    return f(4.712389);
  }
  return x < 0 ? f(Math.atan(y / x) + PI) : f(Math.atan(y / x) + TWO_PI);
}

function nodeAt(column, row) {
  return column * ROWS + row;
}

/** Distance and angle of every grid node from the middle of the screen. 0x1541e. */
function createGrid() {
  const distance = new Float32Array(COLUMNS * ROWS);
  const angle = new Float32Array(COLUMNS * ROWS);
  for (let column = 0; column < COLUMNS; column++) {
    for (let row = 0; row < ROWS; row++) {
      const dy = 12.5 - row;
      const dx = 20 - column;
      distance[nodeAt(column, row)] = Math.sqrt(dy * dy + dx * dx + 1.0) * 8.17;
      angle[nodeAt(column, row)] = angleOf(dx, f(dy));
    }
  }
  return { distance, angle, u: new Int16Array(COLUMNS * ROWS), v: new Int16Array(COLUMNS * ROWS) };
}

/** First picture: the grid looks at the picture from a point that circles, and turns with it. 0x15637. */
function swirl(grid, phase) {
  const turn = f(Math.sin(phase));
  for (let column = 0; column < COLUMNS; column++) {
    for (let row = 0; row < ROWS; row++) {
      const node = nodeAt(column, row);
      const a = f(Math.cos(3.5 * phase) * 42.0 + 128.0 - column * 6.4);
      const b = f(Math.sin(3.5 * phase) * 42.0 + 128.0 - row * 10.24);
      const reach = f(Math.sqrt(a * a + b * b + 1.0));
      const direction = f(turn - grid.angle[node]);
      grid.u[node] = Math.trunc(Math.sin(phase * 0.5) * 128.0 * 5.0 + Math.cos(direction) * reach);
      grid.v[node] = Math.trunc(Math.cos(phase * 0.5) * 128.0 * 5.0 + Math.sin(direction) * reach);
    }
  }
}

/** Second picture: the picture drifts and ripples in place. 0x157b0. */
function ripple(grid, phase, slowPhase) {
  const turn = f(Math.sin(phase));
  const swing = f(Math.sin(slowPhase) * 80.0);
  for (let column = 0; column < COLUMNS; column++) {
    for (let row = 0; row < ROWS; row++) {
      const node = nodeAt(column, row);
      const drift = swing * Math.sin(1.5 * phase);
      const fx = f(column * CELL) / f(50);
      const fy = f(row * CELL) / f(50);
      grid.u[node] = Math.trunc(Math.cos(2.5 * phase) * drift * 2.34 + column * CELL
        + (Math.sin(fx) + Math.sin(fy)) * (Math.cos(1.5 * phase) * 65.0));
      grid.v[node] = Math.trunc(Math.sin(2.5 * phase) * drift * 2.34 + row * CELL
        + (Math.cos(fy) + Math.cos(fx)) * (turn * 35));
    }
  }
}

/** Third picture: rings breathing out from the middle. 0x1592b. */
function breathe(grid, phase, slowPhase) {
  const turn = f(Math.sin(phase));
  for (let column = 0; column < COLUMNS; column++) {
    for (let row = 0; row < ROWS; row++) {
      const node = nodeAt(column, row);
      const far = grid.distance[node];
      const reach = f((Math.cos(far * 0.01 + phase) + 1.3) * far * 3.0
        + Math.cos(far * 0.07 + phase) * 82.0 * Math.sin(slowPhase + PI));
      const direction = f(turn - grid.angle[node]);
      grid.u[node] = Math.trunc(Math.sin(phase * 0.6) * 128.0 * 5.0 + Math.cos(direction) * reach);
      grid.v[node] = Math.trunc(Math.cos(phase * 0.6) * 128.0 * 5.0 + Math.sin(direction) * reach);
    }
  }
}

const corner = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, u: 0, v: 0 }));

function setCorner(target, grid, x, y, column, row) {
  const node = nodeAt(column, row);
  target.x = x;
  target.y = y;
  target.u = grid.u[node] & 0xffff;
  target.v = grid.v[node] & 0xffff;
}

/**
 * Every cell as two affine triangles. A cell's corners are 7 pixels apart while its texture
 * coordinates are those of nodes 8 apart; the filler's inclusive edges close the gap. 0x154d4.
 */
function drawGrid(target, grid, picture) {
  const [topLeft, topRight, bottomRight, bottomLeft] = corner;
  for (let column = 0; column < CELLS_ACROSS; column++) {
    for (let row = 0; row < CELLS_DOWN; row++) {
      const x = column * CELL;
      const y = row * CELL;
      setCorner(topLeft, grid, x, y, column, row);
      setCorner(topRight, grid, x + CELL - 1, y, column + 1, row);
      setCorner(bottomRight, grid, x + CELL - 1, y + CELL - 1, column + 1, row + 1);
      setCorner(bottomLeft, grid, x, y + CELL - 1, column, row + 1);
      fillAffineTriangle(target, picture, topLeft, topRight, bottomRight, AFFINE_OPAQUE);
      fillAffineTriangle(target, picture, topLeft, bottomLeft, bottomRight, AFFINE_OPAQUE);
    }
  }
}

function* loadWobblerPicture(demo, index) {
  const names = ['2dtest.gif', '2dtest2.gif', '2dtest3.gif'];
  yield* loaderLog(demo, `wobbler image${index + 1}`);
  const picture = loadPicture(demo.machine, demo.assets, `TEXTURES\\${names[index]}`);
  demo.wobbler.pictures[index] = { picture, palette: demo.machine.palette.slice() };
}

export function* loadWobblerTables(demo) {
  yield* loaderLog(demo, 'wobbler init');
  demo.wobbler = { grid: createGrid(), pictures: [], work: new Uint8Array(PALETTE_BYTES), slowPhase: 0 };
}

export function* loadWobbler1(demo) {
  yield* loadWobblerPicture(demo, 0);
}

export function* loadWobbler2(demo) {
  yield* loadWobblerPicture(demo, 1);
}

export function* loadWobbler3(demo) {
  yield* loadWobblerPicture(demo, 2);
}

/**
 * One run of the effect: fade in from white, move the grid by the timer, draw, show.
 * @param {(grid: object, phase: number, slowPhase: number) => void} moveGrid
 * @param {boolean} hasSlowPhase false leaves the slow phase where the previous run left it
 */
function* wobble(demo, index, duration, moveGrid, hasSlowPhase) {
  const machine = demo.machine;
  const timer = machine.timerA;
  const wobbler = demo.wobbler;
  const { picture, palette } = wobbler.pictures[index];
  const fade = { palette, work: wobbler.work, isFadingIn: true };
  while (timer.value < duration) {
    const ticks = timer.value;
    stepFadeIn(machine, fade, ticks);
    if (hasSlowPhase) {
      wobbler.slowPhase = f(ticks * SLOW_PHASE_PER_TICK);
    }
    moveGrid(wobbler.grid, f(ticks * PHASE_PER_TICK), wobbler.slowPhase);
    drawGrid(machine.bufferA, wobbler.grid, picture);
    showBuffer(machine, machine.bufferA);
    yield;
  }
  timer.value -= duration;
}

function leaveOnWhite(machine) {
  whiteDac(machine);
  clearBuffer(machine.front);
}

export function* runWobbler1(demo) {
  yield* wobble(demo, 0, FIRST_TICKS, swirl, false);
  leaveOnWhite(demo.machine);
}

/** Two runs back to back: four calm seconds, then eleven with the slow swing added. */
export function* runWobbler2(demo) {
  yield* wobble(demo, 1, SECOND_CALM_TICKS, ripple, false);
  yield* wobble(demo, 1, SECOND_WILD_TICKS, ripple, true);
  leaveOnWhite(demo.machine);
}

export function* runWobbler3(demo) {
  yield* wobble(demo, 2, THIRD_TICKS, breathe, true);
  leaveOnWhite(demo.machine);
}
