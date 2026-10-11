// Demo part 11: the lab5 maze, a texture-mapped floor seen from a camera that flies over it, lit by a
// light blob whose lookup is bent by the map's gradient (a fake bump). Texels whose texture nibble is 0
// copy the low nibble of the pixel above them, which extrudes the maze walls downwards. Words from the
// big font are added through lab2.lut, and a LUT fade (flash to white, back, to black) ends the part.
// Ports init 0x1b860 (gradient 0x1b7a0, light blob 0x314c0), run 0x1b9fc, the camera 0x1055c (0x104fc),
// the floor setup 0x100a8 and the self-modified floor renderer 0x102f0 (patched by 0x1022d).
// See docs/disassembly/P11_maze_face.md.

import { frame, frameRow, syncAdvance, resyncFrame, entryTime, entryFrame, setDac } from '../machine.js';
import { drawBigTextCentered } from '../font.js';
import { sin, cos } from '../sine.js';

const WIDTH = 320;
const PALETTE_BYTES = 0x300;
const MAP_SIZE = 256;
const MAP_CELLS = MAP_SIZE * MAP_SIZE;

/** Palette: 16 light levels of the 16 base colours (the first 48 bytes of lab5.raw). */
const BASE_COLOUR_BYTES = 48;
const LIGHT_LEVELS = 16;
const LIGHT_STEP = 4;
const DAC_MAX = 63;

/** 0x314c0(2.5, 16, 255, 256.0, 0, 256, 256): a disc of light, then &0xf0 in init. */
const BLOB_EXPONENT = 2.5;
const BLOB_MIN = 16;
const BLOB_MAX = 255;
const BLOB_RADIUS_SQUARED = 32768;
const LIGHT_MASK = 0xf0;

/** Rows of the back buffer the floor is drawn into; rows 8..159 are shown at screen rows 24..175. */
const FLOOR_ROWS = 160;
const SETUP_ROWS = 200;
const SHOWN_FROM = 0xa00;
const SHOWN_BYTES = 0xbe00;
const SCREEN_AT = 0x1e00;
/** For dt < 76 only the top 2*dt rows show, at the bottom of the window: the picture slides up. */
const REVEAL_TICKS = 76;
const REVEAL_ROW_BYTES = 640;

/** 0x10010: the eye and the four corners of the view plane, 16.16. */
const EYE = [0, 0, 70 << 16];
const CORNERS = [[-160 << 16, -100 << 16, 0], [-160 << 16, 100 << 16, 0], [160 << 16, -100 << 16, 0], [160 << 16, 100 << 16, 0]];
const PITCH = -42 & 0x1ff;
const HEIGHT_BASE = 90;

/** 0x102f0: the u byte of pixel k of an 8-pixel group comes from accumulator UACC[k] (instruction order). */
const UACC = [1, 2, 2, 4, 4, 6, 6, 8];
const GROUP = 8;

/** 0x81854 word pointers (by song row / 8), 0x818b8 their back-buffer rows. */
const WORDS_TABLE = 0x81854;
const WORD_ROWS_TABLE = 0x818b8;
const FIRST_WORD = 4;
const LAST_WORD = 24;
const ROWS_PER_WORD = 8;
const GLYPH_CLAMP_STEP = 4;

/** The fade: 64 down to 0, one step per 2 ticks; LUT rows 32..63 darken, 0..31 brighten. */
const FADE_START = 64;
const LUT_HALF = 32;
const LUT_LAST_ROW = 63;
const LUT_FROM = 0xa00;
const LUT_TO = 0xc800;

function readCString(image, address) {
  let text = '';
  for (let at = address; image.u8(at) !== 0; at++) {
    text += String.fromCharCode(image.u8(at));
  }
  return text;
}

/** Signed division truncating toward zero, exact for any integers below 2^53. */
function idiv(a, b) {
  let q = Math.trunc(a / b);
  const r = a - q * b;
  if (r !== 0 && Math.sign(r) !== Math.sign(a)) {
    q += Math.sign(a) === Math.sign(b) ? -1 : 1;
  }
  return q;
}

/** Low 32 bits of (a * b) >> shift, the 64-bit product of two int32. */
function mulShift(a, b, shift) {
  const product = a * b;
  if (Math.abs(product) < Number.MAX_SAFE_INTEGER) {
    return Math.floor(product / 2 ** shift) | 0;
  }
  return Number(BigInt.asIntN(32, (BigInt(a) * BigInt(b)) >> BigInt(shift)));
}

/** 0x1b7a0: word table, low byte = 4 * vertical difference 2 apart, high byte = horizontal. */
function buildGradient(heights) {
  const gradient = new Uint16Array(MAP_CELLS);
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const h = heights[y * MAP_SIZE + x];
      const lo = ((h - heights[((y - 2) & 255) * MAP_SIZE + x]) * 4) & 0xff;
      const hi = ((h - heights[y * MAP_SIZE + ((x - 2) & 255)]) * 4) & 0xff;
      gradient[y * MAP_SIZE + x] = lo | (hi << 8);
    }
  }
  return gradient;
}

/** 0x314c0 with the arguments init passes, then the high nibble only. */
function buildLightBlob() {
  const blob = new Uint8Array(MAP_CELLS);
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const w = 1 - Math.sqrt(((x - 128) ** 2 + (y - 128) ** 2) / BLOB_RADIUS_SQUARED);
      const v = w > 0 ? Math.trunc(256 * w ** BLOB_EXPONENT) : 0;
      blob[y * MAP_SIZE + x] = Math.max(BLOB_MIN, Math.min(BLOB_MAX, v)) & LIGHT_MASK;
    }
  }
  return blob;
}

/** Texture nibble: 0 stays 0 (a wall), anything else becomes max(1, h >> 3). */
function buildTexture(heights) {
  return heights.map((h) => (h === 0 ? 0 : Math.max(1, h >> 3)));
}

/** Level k = base + 4k (clamped), level 0 = base * 0.75. */
function buildPalette(file) {
  const palette = file.slice(0, PALETTE_BYTES);
  for (let k = 1; k < LIGHT_LEVELS; k++) {
    for (let i = 0; i < BASE_COLOUR_BYTES; i++) {
      palette[k * BASE_COLOUR_BYTES + i] = Math.min(file[i] + LIGHT_STEP * k, DAC_MAX);
    }
  }
  for (let i = 0; i < BASE_COLOUR_BYTES; i++) {
    palette[i] = (file[i] * 12) >> 4;
  }
  return palette;
}

/** 0x104fc: rotate v in the plane of components i0, i1 (8.8 sine, 64-bit products >> 8). */
function rotate(v, a, i0, i1) {
  const c = cos(a);
  const s = sin(a);
  const out = [...v];
  out[i0] = (mulShift(v[i0], c, 8) - mulShift(v[i1], s, 8)) | 0;
  out[i1] = (mulShift(v[i0], s, 8) + mulShift(v[i1], c, 8)) | 0;
  return out;
}

/** 0x1055c: eye and corners pitched, yawed by a cosine used as an angle, flown +1 unit/tick along y. */
function placeCamera(dt) {
  const yaw = cos(dt >> 1) & 0x1ff;
  return [EYE, ...CORNERS].map((model) => {
    const v = rotate(rotate(model, PITCH, 1, 2), yaw, 0, 1);
    v[1] = (v[1] + (dt << 16)) | 0;
    return v;
  });
}

/** One side of a row record: where the ray through view-plane point `corner` meets the floor. */
function floorPoint(eye, depthScale, corner) {
  const t = idiv(depthScale, corner[2]);
  return [((eye[0] >> 8) - mulShift(t, corner[0], 16)) | 0, ((eye[1] >> 8) - mulShift(t, corner[1], 16)) | 0];
}

/**
 * 0x100a8: 200 row records {pos, step}: 8.8 u in the low word (+0x8000), 8.8 v in the high word,
 * stepping across 320 pixels; and the light offset of this frame.
 */
function setupFloor(vectors, dt, height) {
  const [eye, ...corners] = vectors;
  const relative = corners.map((c) => c.map((value, k) => value - eye[k]));
  const leftStep = [0, 1, 2].map((k) => idiv(relative[1][k] - relative[0][k], SETUP_ROWS));
  const rightStep = [0, 1, 2].map((k) => idiv(relative[3][k] - relative[2][k], SETUP_ROWS));
  const depthScale = eye[2] * height;
  const pos = new Int32Array(FLOOR_ROWS);
  const step = new Int32Array(FLOOR_ROWS);
  let left = relative[0];
  let right = relative[2];
  for (let r = 0; r < FLOOR_ROWS; r++) {
    const [u0, v0] = floorPoint(eye, depthScale, left);
    const [u1, v1] = floorPoint(eye, depthScale, right);
    pos[r] = ((u0 + 0x8000) & 0xffff) | ((v0 & 0xffff) << 16);
    step[r] = (idiv((u1 - u0) | 0, WIDTH) & 0xffff) | ((idiv((v1 - v0) | 0, WIDTH) & 0xffff) << 16);
    left = left.map((value, k) => value + leftStep[k]);
    right = right.map((value, k) => value + rightStep[k]);
  }
  const a = dt & 511;
  const lightOffset = ((sin(a) & 0xff) << 8) | ((cos(a >> 1) + 0x32) & 0xff);
  return { pos, step, lightOffset };
}

/** 0x102f0: rows 0..159 of the back buffer, 8 pixels per accumulator group. */
function drawFloor(state, rows, target) {
  const { texture, light, gradient } = state;
  const accumulators = new Int32Array(GROUP + 1);
  for (let y = 0; y < FLOOR_ROWS; y++) {
    let acc = rows.pos[y];
    const step = rows.step[y];
    const line = y * WIDTH;
    for (let x = 0; x < WIDTH; x += GROUP) {
      for (let k = 0; k <= GROUP; k++) {
        accumulators[k] = acc + k * step;
      }
      for (let k = 0; k < GROUP; k++) {
        const index = ((accumulators[k] >>> 16) & 0xff00) | ((accumulators[UACC[k]] >>> 8) & 0xff);
        const lit = (((index + gradient[index]) & 0xffff) + rows.lightOffset) & 0xffff;
        let c = (texture[index] + light[lit]) & 0xff;
        if ((c & 0x0f) === 0) {
          c = y === 0 ? 0 : target[line + x + k - WIDTH] & 0x0f;
        }
        target[line + x + k] = c;
      }
      acc = accumulators[GROUP];
    }
  }
}

/** 0x1055c + 0x100a8 + 0x102f0 as the run loop calls them: the floor of tick dt into rows 0..159. */
export function renderFloor(state, dt, target) {
  drawFloor(state, setupFloor(placeCamera(dt), dt, (sin(3 * dt) >> 3) + HEIGHT_BASE), target);
}

/** 0x1de4c for the word of song row t: each word lasts 8 rows and fades out over them. */
function drawWord(demo, state, target, t) {
  const w = t >> 3;
  if (w < FIRST_WORD || w > LAST_WORD) {
    return;
  }
  const clamp = (ROWS_PER_WORD - (t & 7)) * GLYPH_CLAMP_STEP;
  drawBigTextCentered(demo.font, target, state.words[w], state.wordRows[(w - FIRST_WORD) & 7], state.lut, clamp);
}

function fadeRow(fade) {
  return fade >= LUT_HALF ? fade - LUT_HALF : LUT_LAST_ROW - fade;
}

function applyFade(state, target, fade) {
  const table = state.lut.subarray(fadeRow(fade) * 256);
  for (let i = LUT_FROM; i < LUT_TO; i++) {
    target[i] = table[target[i]];
  }
}

/** The copy after the tick: back-buffer rows 8..159 to screen rows 24..175, sliding up at first. */
function present(source, screen, dt) {
  if (dt >= REVEAL_TICKS) {
    screen.set(source.subarray(SHOWN_FROM, SHOWN_FROM + SHOWN_BYTES), SCREEN_AT);
    return;
  }
  if (dt > 0) {
    screen.set(source.subarray(SHOWN_FROM, SHOWN_FROM + dt * REVEAL_ROW_BYTES), SCREEN_AT + SHOWN_BYTES - dt * REVEAL_ROW_BYTES);
  }
}

export const maze = {
  /** 0x1b860. */
  init(demo) {
    const file = demo.archive.read('lab5.raw');
    const heights = file.subarray(PALETTE_BYTES, PALETTE_BYTES + MAP_CELLS);
    setDac(demo.machine, buildPalette(file));
    return {
      texture: buildTexture(heights),
      gradient: buildGradient(heights),
      light: buildLightBlob(),
      lut: demo.archive.read('lab2.lut'),
      words: Array.from({ length: LAST_WORD + 1 }, (_, w) => (w < FIRST_WORD ? '' : readCString(demo.image, demo.image.u32(WORDS_TABLE + 4 * w)))),
      wordRows: Array.from({ length: 8 }, (_, k) => demo.image.i32(WORD_ROWS_TABLE + 4 * k)),
    };
  },

  /** 0x1b9fc(15): from entry 15 until entry 17 has passed; the fade starts at entry 16. */
  *run(demo, state, firstSync) {
    const m = demo.machine;
    const target = demo.offscreen;
    while (syncAdvance(m) <= firstSync) {
      yield;
    }
    let index = syncAdvance(m);
    // 0x121d4 on the first pass after the entry (as of the entry, so that a seek lands the same).
    resyncFrame(m, entryTime(m, firstSync));
    const start = entryFrame(m, firstSync);
    const lastIndex = firstSync + 2;
    // The first pass draws dt 0 (or, after a seek, the tick before now).
    let dt = Math.max(frame(m) - 1 - start, 0);
    let fade = 0;
    let fadeStart = null;
    while (index <= lastIndex) {
      renderFloor(state, dt, target);
      drawWord(demo, state, target, frameRow(m));
      dt = frame(m) - start;
      index = syncAdvance(m);
      if (fade === 0 && index === lastIndex) {
        fade = FADE_START;
        // The loop notices the entry on its next pass, a tick after the song reaches it. Should the
        // fade run out before entry 17 (it never does), it starts again from now.
        fadeStart = fadeStart === null ? Math.max(entryFrame(m, lastIndex - 1) + 1, start) : frame(m);
      }
      if (fade) {
        fade = Math.max(FADE_START - ((frame(m) - fadeStart) >>> 1), 0);
        applyFade(state, target, fade);
      }
      yield;
      present(target, m.front, dt);
    }
    m.front.fill(0);
    target.fill(0);
  },
};
