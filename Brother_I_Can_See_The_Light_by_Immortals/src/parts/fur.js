// Part 6: two endless planes of FUR.GIF raytraced at the grid's corners, fogged with distance,
// then the title picture, held until position 29, fading out with the music.
// TEST.EXE 0x130bf (load), 0x130f7 (run).

import { setDac, clearBuffer, showBuffer, playStatus, TICKS_PER_SECOND } from '../machine.js';
import { loadPicture } from '../engine/pictures.js';
import { buildShadeTable } from '../tables.js';
import { COLUMNS, ROWS, gridIndex, drawShadedGrid, eulerMatrix, rayDirection, toInt } from '../grid.js';
import { whitenDac, scaleDac } from './common.js';

const f = Math.fround;
const FIRST_POSITION = 24;
const LAST_PLANES_POSITION = 27;
const TITLE_HOLD_POSITION = 29;
/** Radians per tick of timer B. */
const TURN_SPEED = 0.008;
/** The planes are y = -200 and y = +200; the eye drifts along x and -z by 350 units a radian. */
const PLANE_DISTANCE = 200;
const DRIFT = 350;
const DRIFT_X_START = 100;
const SHADE_MAX = 63;
const FOG_PER_UNIT = 0.02;
const FADE_PER_TICK = 0.01;
/** Picture and music fade out over 3 seconds ([0x58474] * 3). */
const FADE_OUT_TICKS = TICKS_PER_SECOND * 3;

export function loadFur(demo) {
  const { machine, assets } = demo;
  const fur = loadPicture(machine, assets, 'fur.gif');
  demo.fur = { texture: fur.pixels, palette: fur.palette, shade: buildShadeTable(fur.palette) };
}

function tracePlanes(demo, ticks) {
  const aDouble = ticks * TURN_SPEED;
  const a = f(aDouble);
  const m = eulerMatrix(a, f(-a * 0.6), f(aDouble * 0.2));
  const eyeX = f(a * DRIFT + DRIFT_X_START);
  const eyeZ = f(-a * DRIFT);
  for (let i = 0; i < COLUMNS; i++) {
    for (let j = 0; j < ROWS; j++) {
      const d = rayDirection(m, i * 8, j * 8);
      const t = PLANE_DISTANCE / Math.abs(d[1]);
      const x = d[0] * t + eyeX;
      const z = d[2] * t + eyeZ;
      const point = demo.grid[gridIndex(i, j)];
      point.u = toInt(Math.abs(x));
      point.v = toInt(Math.abs(z));
      const dz = f(z) - eyeZ;
      const dx = f(x) - eyeX;
      const shade = toInt(SHADE_MAX - Math.sqrt(dz * dz + dx * dx) * FOG_PER_UNIT);
      point.s = Math.min(Math.max(shade, 0), SHADE_MAX);
    }
  }
}

function* planes(demo) {
  const machine = demo.machine;
  const part = demo.fur;
  let isFading = true;
  machine.timerA.zeroAtRow(FIRST_POSITION, 0);
  let position = playStatus(machine).position;
  while (position <= LAST_PLANES_POSITION) {
    position = playStatus(machine).position;
    const fade = f(1 - machine.timerA.value * FADE_PER_TICK);
    if (fade < 0) {
      setDac(machine, part.palette);
      isFading = false;
    } else if (isFading) {
      whitenDac(machine, part.palette, fade);
    }
    tracePlanes(demo, machine.timerB.value);
    drawShadedGrid(machine.bufferA, part.texture, part.shade, demo.grid);
    showBuffer(machine, machine.bufferA);
    yield;
  }
}

function* title(demo) {
  const { machine, assets } = demo;
  // Video memory cleared and the DAC zeroed first, so the decode straight to the screen is unseen.
  clearBuffer(machine.front);
  setDac(machine, new Uint8Array(machine.dac.length));
  const picture = loadPicture(machine, assets, 'brother.gif');
  machine.front.set(picture.pixels.subarray(0, machine.front.length));
  setDac(machine, picture.palette);
  while (playStatus(machine).position < TITLE_HOLD_POSITION) {
    yield;
  }
  machine.timerA.zeroAtRow(TITLE_HOLD_POSITION, 0);
  const inverse = f(1 / FADE_OUT_TICKS);
  while (machine.timerA.value < FADE_OUT_TICKS) {
    const ticks = machine.timerA.value;
    // MIDAS master volume, 0..64: the music fades with the picture.
    machine.volume = toInt(machine.baseVolume - ((machine.baseVolume * ticks) >>> 0) * inverse);
    scaleDac(machine, picture.palette, f((FADE_OUT_TICKS - ticks) * inverse));
    yield;
  }
}

export function* runFur(demo) {
  // Timer B turns the view. Part 6 never resets it: part 5's last frame did, on seeing row 0 of
  // position 24. Done here too, so that a seek past that frame lands in the same place.
  demo.machine.timerB.zeroAtRow(FIRST_POSITION, 0);
  yield* planes(demo);
  yield* title(demo);
}
