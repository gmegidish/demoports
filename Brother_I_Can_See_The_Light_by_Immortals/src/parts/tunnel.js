// Part 4: flying down a textured tunnel, raytraced at the grid's corners and darkened with depth,
// with shrunken copies of the screen pasted into itself. Four phases, one per song position.
// TEST.EXE 0x1220a (load), 0x122b0 (run), 0x11b41 (trace a corner), 0x120e6 (sub-picture).

import { WIDTH, HEIGHT, setDac, showBuffer, playStatus } from '../machine.js';
import { loadPicture } from '../engine/pictures.js';
import { buildShadeTable } from '../tables.js';
import { COLUMNS, ROWS, gridIndex, drawShadedGrid, eulerMatrix, rayDirection, toInt } from '../grid.js';
import { whitenDac } from './common.js';

const f = Math.fround;
const TUNNEL_RADIUS_SQUARED = 70000;
/** Units the eye moves down the tunnel per second of timer B. 0x50440. */
const FLIGHT_SPEED = 270;
/** 0x50460: close to 1/pi, but not the double nearest to it. */
const ANGLE_SCALE = 0.318309882798629;
const SHADE_MAX = 63;
const FADE_PER_TICK = 0.01;

/** A copy of the whole screen at a third of its size: every third pixel of every third row. */
const SUB_WIDTH = 106;
const SUB_HEIGHT = 66;
const SUB_STEP = 3;

export function loadTunnel(demo) {
  const { machine, assets } = demo;
  const looks = ['2d2.gif', '2d5.gif', '2d6.gif'].map((name) => {
    const picture = loadPicture(machine, assets, name);
    return { texture: picture.pixels, palette: picture.palette, shade: buildShadeTable(picture.palette) };
  });
  demo.tunnel = { looks };
}

/** 0x11b41: the ray through screen point (X, Y) meets the tunnel wall behind the eye. */
function traceCorner(m, X, Y, T, point) {
  const d = rayDirection(m, X, Y);
  const eyeZ = f(-T * FLIGHT_SPEED);
  const a = d[0] * d[0] + d[1] * d[1];
  const discriminant = f(0 * f(0) - (a * 4) * (0 - TUNNEL_RADIUS_SQUARED));
  const root = Math.sqrt(discriminant);
  const inverse = 1 / (f(a) * 2);
  const t1 = f((-0 + root) * inverse);
  const t2 = f((-0 - root) * inverse);
  const t = t1 >= t2 ? t2 : t1;
  const px = f(d[0] * t);
  const py = f(d[1] * t);
  const pz = f(f(d[2] * t) + eyeZ);
  point.u = toInt(Math.abs(pz) * 0.2);
  point.v = toInt(Math.abs(Math.atan2(py, px) * 256 * ANGLE_SCALE));
  const shade = SHADE_MAX - toInt(Math.abs(pz - eyeZ) * 0.014);
  point.s = Math.min(Math.max(shade, 0), SHADE_MAX);
}

/**
 * 0x120e6: paste a third-size copy of the buffer into itself at (x, y), in place, so that later
 * rows read pixels this call already wrote. The first row drawn always reads source row 0, even
 * when the copy is clipped at the top: a bug kept.
 */
export function pasteSubPicture(buffer, x, y) {
  if (y > HEIGHT - 1 || x > WIDTH - 1 || x + SUB_WIDTH < 0 || y + SUB_HEIGHT < 0) {
    return;
  }
  const top = Math.max(y, 0);
  const bottom = Math.min(y + SUB_HEIGHT, HEIGHT);
  const left = Math.max(x, 0);
  const right = Math.min(x + SUB_WIDTH, WIDTH);
  for (let row = top; row < bottom; row++) {
    const sourceRow = row === top ? 0 : SUB_STEP * (row - y);
    let source = sourceRow * WIDTH + SUB_STEP * (left - x);
    for (let column = left; column < right; column++, source += SUB_STEP) {
      buffer[row * WIDTH + column] = buffer[source];
    }
  }
}

/** Angles of the camera per phase, from timer B in seconds: Td as a double, T as float32. */
const PHASES = [
  { look: 0, angles: (Td, T) => [T, f(-T * 0.6), f(Td * 0.2)], paste: () => [] },
  {
    look: 1,
    angles: (Td, T) => [0, f(Td * 0.9), f(-T * 0.2)],
    paste: (t) => Array(3).fill([150, toInt(t * 0.45 - 66)]),
  },
  {
    look: 2,
    angles: (Td, T) => [0, T, f(-Td * 0.2)],
    paste: (t) => {
      const a = [toInt(t * 0.7 - 106), 30];
      const b = [toInt(320 - t * 0.7), 120];
      return [a, b, a, b, a];
    },
  },
  {
    look: 0,
    angles: (Td) => [f(-Td * 1.2), 0, f(-Td * 0.3)],
    paste: (t) => {
      const a = toInt(t * 0.45 - 66);
      const b = toInt(200 - t * 0.45);
      return [[0, a], [107, b], [215, a], [0, a], [107, b], [215, a], [0, a], [107, b]];
    },
  },
];
const FIRST_POSITION = 14;

function* phase(demo, index) {
  const machine = demo.machine;
  const { look, angles, paste } = PHASES[index];
  const { texture, palette, shade } = demo.tunnel.looks[look];
  const lastPosition = FIRST_POSITION + index;
  let isFading = true;
  machine.timerA.zeroAtRow(lastPosition, 0);
  let position = playStatus(machine).position;
  while (position <= lastPosition) {
    position = playStatus(machine).position;
    const fade = f(1 - machine.timerA.value * FADE_PER_TICK);
    if (fade < 0) {
      setDac(machine, palette);
      isFading = false;
    } else if (isFading) {
      whitenDac(machine, palette, fade);
    }
    const Td = machine.timerB.value * 0.01;
    const T = f(Td);
    const m = eulerMatrix(...angles(Td, T));
    for (let i = 0; i < COLUMNS; i++) {
      for (let j = 0; j < ROWS; j++) {
        traceCorner(m, i * 8, j * 8, T, demo.grid[gridIndex(i, j)]);
      }
    }
    drawShadedGrid(machine.bufferA, texture, shade, demo.grid);
    for (const [x, y] of paste(machine.timerA.value)) {
      pasteSubPicture(machine.bufferA, x, y);
    }
    showBuffer(machine, machine.bufferA);
    yield;
  }
}

export function* runTunnel(demo) {
  // Timer B is the flight's clock. Part 4 never resets it: part 3's last frame did, on seeing row 0
  // of position 14. Done here too, so that a seek past that frame lands in the same place.
  demo.machine.timerB.zeroAtRow(FIRST_POSITION, 0);
  for (let index = 0; index < PHASES.length; index++) {
    yield* phase(demo, index);
  }
}
