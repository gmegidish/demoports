// Part 2: a polar swirl of 2D3.GIF on the 8x8 grid, then thirty flares drifting over it.
// TEST.EXE 0x11909 and 0x12b34 (load), 0x12cc2 (run).

import { setDac, showBuffer, playStatus } from '../machine.js';
import { loadPicture } from '../engine/pictures.js';
import { createTrack, addKey, prepareTangents, evaluate } from '../engine/track.js';
import { drawScaledSprite } from '../engine/raster.js';
import { createRandom } from '../engine/math.js';
import { buildAdditiveTable } from '../tables.js';
import { buildPolarTables, createGrid, gridIndex, COLUMNS, ROWS, drawGrid } from '../grid.js';
import { whitenDac } from './common.js';

const FLARES = 30;
const FLARE_KEYS = 10;
const FLARE_HALF_SIZE = 18;
/** Spline frames per tick of timer A. 0x50543. */
const FLARE_SPEED = 0.007;
/** Radians per tick of timer B: the swirl's clock. 0x5052f. */
const SWIRL_SPEED = 0.0098;
const FADE_PER_TICK = 0.01;
const NO_TCB = [0, 0, 0, 0, 0];
const f = Math.fround;

export function loadPolarTables(demo) {
  demo.polar = buildPolarTables();
  demo.grid = createGrid();
}

export function loadKaleidoscope(demo) {
  const { machine, assets } = demo;
  const texture = loadPicture(machine, assets, '2d3.gif');
  // The C runtime's rand(), seed 1: these are the only two calls in the program.
  const rand = createRandom();
  const paths = [];
  for (let n = 0; n < FLARES; n++) {
    const track = createTrack();
    for (let key = 0; key < FLARE_KEYS; key++) {
      const y = (rand() % 280) - 40;
      const x = (rand() % 400) - 40;
      addKey(track, key, [x, y, 0], NO_TCB);
    }
    prepareTangents(track);
    paths.push(track);
  }
  const flare = loadPicture(machine, assets, 'sflare.gif');
  demo.kaleidoscope = {
    texture: texture.pixels,
    // 2D3.GIF and SFLARE.GIF carry the same palette; the second load is the one kept.
    palette: flare.palette,
    flare: flare.pixels,
    additive: buildAdditiveTable(machine.lastPalette),
    paths,
  };
}

/** The swirl: every corner's texel from its polar position, zoomed by sin of the music clock. */
export function computeSwirl(demo, ticks) {
  const { radius, angle } = demo.polar;
  const a = ticks * SWIRL_SPEED;
  const s = f(Math.sin(a));
  const c = f(Math.cos(a));
  for (let i = 0; i < COLUMNS; i++) {
    for (let j = 0; j < ROWS; j++) {
      const k = gridIndex(i, j);
      const turned = s - angle[k];
      const point = demo.grid[k];
      point.u = Math.trunc(radius[k] * Math.cos(turned) * 4 * s + (s * 512 + 256));
      point.v = Math.trunc(radius[k] * Math.sin(turned) * 4 * s + (c * 512 + 256));
    }
  }
}

/** Every phase opens with a second's fade from white (black on its very first frame: 64 wraps to 0). */
function fadeIn(machine, phase, palette) {
  const t = f(1 - machine.timerA.value * FADE_PER_TICK);
  if (t < 0) {
    if (phase.isFading) {
      setDac(machine, palette);
      phase.isFading = false;
    }
  } else if (phase.isFading) {
    whitenDac(machine, palette, t);
  }
}

function drawFlares(machine, part) {
  const t = f(machine.timerA.value * FLARE_SPEED);
  const point = new Float32Array(3);
  for (const path of part.paths) {
    evaluate(path, t, point, 0, 3);
    const x0 = Math.trunc(point[0] - FLARE_HALF_SIZE);
    const y0 = Math.trunc(point[1] - FLARE_HALF_SIZE);
    const x1 = Math.trunc(point[0] + FLARE_HALF_SIZE);
    const y1 = Math.trunc(point[1] + FLARE_HALF_SIZE);
    drawScaledSprite(machine.bufferA, part.flare, part.additive, (y0 << 16) + x0, (y1 << 16) + x1);
  }
}

function* phase(demo, firstPosition, lastPosition, withFlares) {
  const machine = demo.machine;
  const part = demo.kaleidoscope;
  const state = { isFading: true };
  machine.timerA.zeroAtRow(firstPosition, 0);
  // The loop tests the position of the previous poll, so it draws one frame of the next position.
  let position = playStatus(machine).position;
  while (position <= lastPosition) {
    position = playStatus(machine).position;
    fadeIn(machine, state, part.palette);
    computeSwirl(demo, machine.timerB.value);
    drawGrid(machine.bufferA, part.texture, demo.grid);
    if (withFlares) {
      drawFlares(machine, part);
    }
    showBuffer(machine, machine.bufferA);
    yield;
  }
}

export function* runKaleidoscope(demo) {
  yield* phase(demo, 6, 7, false);
  yield* phase(demo, 8, 9, true);
}
