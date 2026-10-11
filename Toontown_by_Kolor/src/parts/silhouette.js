// Part 10, 0x1049fe: Mickey's head, a flat-coloured picture on the bending grid, waving over a still background;
// colour 3 runs through a red-yellow gradient (docs/disassembly/B_film.md).
//
// The grid (mesh.js) is drawn with 0x1074af: the texel itself, colour 0 transparent. Its depth is
// 0x200 + sin(column * 4.5 deg) * sin(row * 7.2 deg) * amplitude, the amplitude a product of two slow waves.
import { POSITION, RETRACES, copyToScreen, setPalette, waitRetrace } from '../machine.js';
import { COLUMNS, POINTS, POINT_BYTES, ROWS, buildMesh, drawMesh, projectMesh } from './mesh.js';
import { TRANSPARENT_1074AF } from './triangles.js';

/** @typedef {import('../machine.js').Machine} Machine */

const TEXTURE = 0x16d2bc;
const BACKGROUND = 0x16d2c0;
const PALETTE = 0x16d2c4;
const BACK_BUFFER = 0x12bd80;
const SCREEN_PIXELS = 0xfa00;
/** 0x1048f1 builds 256 RGB entries here; colour 3 takes entry [esp+0x2a0] every frame. */
const GRADIENT = 0x16ff18;
const CYCLED_COLOUR = 3;
/** 0x104b35: colour 3 before the first frame. */
const FIRST_COLOUR = [0, 0x17, 0x39];
const DEPTH = 0x200;
const AMPLITUDE = 300;
/** The grid's sine tables: 80 floats each, sin(i * 4.5 deg) across, sin(i * 7.2 deg) down. */
const TABLE_SIZE = 0x50;
const COLUMN_DEGREES = 4.5;
const ROW_DEGREES = 7.2;

/** 0x104a0b: the gradient's runs [from RGB, to RGB, first entry, last entry]. */
const GRADIENT_RUNS = [
  [[0x14, 0, 0], [0x3f, 0, 0], 0x00, 0x2b],
  [[0x3f, 0, 0], [0x3f, 0x37, 0], 0x2c, 0x63],
  [[0x3f, 0x37, 0], [0x3f, 0x37, 0x25], 0x64, 0x7f],
  [[0x3f, 0x37, 0x25], [0x3f, 0x37, 0], 0x80, 0x9b],
  [[0x3f, 0x37, 0], [0x3f, 0, 0], 0x9c, 0xd3],
  [[0x3f, 0, 0], [0x14, 0, 0], 0xd4, 0xff],
];

/**
 * 0x1048f1: entries `first`..`last` of the RGB table at `at`, from `from` towards `to` in 8.8 steps of
 * ((to - from) * 256 + 256) / (last - first + 1) (so a run overshoots `to` slightly), truncated.
 */
function buildGradient(m, at, from, to, first, last) {
  const count = last - first + 1;
  const steps = from.map((value, k) => Math.trunc(((to[k] - value) * 0x100 + 0x100) / count));
  const values = from.map((value) => value << 8);
  for (let entry = first; entry <= last; entry++) {
    for (let k = 0; k < 3; k++) {
      m.mem[at + entry * 3 + k] = Math.trunc(values[k] / 0x100);
      values[k] += steps[k];
    }
  }
}

function setColour(m, index, [red, green, blue]) {
  m.vga.out8(0x3c8, index);
  m.vga.out8(0x3c9, red);
  m.vga.out8(0x3c9, green);
  m.vga.out8(0x3c9, blue);
}

/** fistp to a word: round to nearest, ties to even. */
function roundHalfEven(x) {
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** A float32 between -1 and 1 that is not tiny, times 2^30: an exact integer. */
const FIXED_ONE = 2 ** 30;

/**
 * float32 * float32 * int rounded as the FPU does (the 80-bit product is exact): the double product can round a
 * near tie the wrong way, so near ties are done in integers.
 */
function roundProduct(a, b, amplitude) {
  const x = a * b * amplitude;
  if (Math.abs(Math.abs(x - Math.trunc(x)) - 0.5) > 1e-6) {
    return Math.round(x);
  }
  const exact = BigInt(a * FIXED_ONE) * BigInt(b * FIXED_ONE) * BigInt(amplitude);
  const unit = BigInt(FIXED_ONE) * BigInt(FIXED_ONE);
  const sign = exact < 0n ? -1n : 1n;
  const magnitude = exact * sign;
  let q = magnitude / unit;
  const twice = (magnitude % unit) * 2n;
  if (twice > unit || (twice === unit && q % 2n === 1n)) {
    q++;
  }
  return Number(q * sign);
}

/** 0x104c14: the grid's depths. */
function waveSilhouette(m, across, down, amplitude) {
  const points = m.u32(POINTS);
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const z = (roundProduct(across[column], down[row], amplitude) << 16) >> 16;
      m.set32(points + (row * COLUMNS + column) * POINT_BYTES + 8, z + DEPTH);
    }
  }
}

/** @param {Machine} m */
export function* mickeySilhouette(m, lastPosition) {
  for (const [from, to, first, last] of GRADIENT_RUNS) {
    buildGradient(m, GRADIENT, from, to, first, last);
  }
  yield* waitRetrace(m);
  for (let i = 0; i < SCREEN_PIXELS; i++) {
    m.vga.write(i, 0);
  }
  setPalette(m, PALETTE);
  setColour(m, CYCLED_COLOUR, FIRST_COLOUR);
  buildMesh(m);
  let lastRetraces = m.u32(RETRACES);
  m.readPlayStatus();
  const across = new Float32Array(TABLE_SIZE);
  const down = new Float32Array(TABLE_SIZE);
  for (let i = 0; i < TABLE_SIZE; i++) {
    across[i] = Math.sin((i * COLUMN_DEGREES * Math.PI) / 180);
    down[i] = Math.sin((i * ROW_DEGREES * Math.PI) / 180);
  }
  const back = m.u32(BACK_BUFFER);
  m.mem.fill(0, back, back + SCREEN_PIXELS);
  /** [esp+0x29c], [esp+0x2a0]: the amplitude's two wave phases; the second also picks colour 3. */
  let slowPhase = 0;
  let colourPhase = 0;
  let amplitude = 0;
  do {
    m.readPlayStatus();
    copyToScreen(m, m.u32(BACKGROUND), back);
    waveSilhouette(m, across, down, amplitude);
    projectMesh(m, 0);
    drawMesh(m, TRANSPARENT_1074AF, back, m.u32(TEXTURE));
    yield* waitRetrace(m);
    const entry = GRADIENT + colourPhase * 3;
    setColour(m, CYCLED_COLOUR, [m.mem[entry], m.mem[entry + 1], m.mem[entry + 2]]);
    copyToScreen(m, back);
    const now = m.u32(RETRACES);
    const passed = now - lastRetraces;
    lastRetraces = now;
    slowPhase = (slowPhase + 2 * passed) & 0xff;
    colourPhase = (colourPhase + passed) & 0xff;
    const cosine = Math.cos(slowPhase * Math.PI * 0.0078125);
    amplitude = Math.trunc(Math.sin(colourPhase * Math.PI * 0.0078125) * cosine * AMPLITUDE);
  } while (lastPosition > m.u32(POSITION));
  return false;
}
