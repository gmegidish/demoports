// Routines used only by the part-2 mode-13h effects: the RLE picture decoder (0x1c504 / 0x1c558), the 160x100
// video (0x28b2a), the additive rotozoomer (0x2879f + its rotation 0x2d540), the opaque 256-wide font
// (0x1bb5c / 0x1bbac) and the map renderer 0x55121. Notes: C2 (pictures, font), C4 (video), C5 + C6 (rotozoomer,
// with C6's corner correction), C6 (0x55121). Everything works on the flat memory at the original addresses.
import { decodeRle, RLE_LIMIT, OBJECT_BUFFERS } from '../morph.js';
import { drawString, TEXTURE_LAYOUT } from '../text.js';
import { rotateZ } from '../engine3d.js';
import { workBuffer } from '../helpers.js';
import {
  TEXTURE_BUFFER_POINTER,
  ROTOZOOM_BUFFER_POINTER,
  SINE_DWORDS,
  COSINE_DWORDS,
  SINE_BYTES,
  SCRATCH_X,
  SCRATCH_Y,
  TEXTURE_SCROLL_U,
  TEXTURE_SCROLL_V,
} from '../addresses.js';

const ROW = 320;

// ---- 0x1c504 / 0x1c558: RLE pictures ----

const PICTURE_OPERATIONS = 0x1c502;
const PACKED_COUNT = 0x1c501;
const PACKED_BIT_CLOCK = 0x1c3ed;
const PACKED_PALETTE = 0x1c3ee;
const PACKED_BITS = 0x1c4ee;
const PACKED_MASK = 0x1c4f0;
const POWERS_OF_TWO = 0x1c4f1;
const BIT_CLOCK_STEP = 0x20;

/**
 * 0x1c558: `count` pixels of `bits` bits each, LSB first, through the local palette 0x1c3ee (reloaded when the
 * header byte is < 0x80, else kept from the previous run). Returns the new source/destination.
 */
function decodePackedRun(m, count, source, destination) {
  const mem = m.mem;
  let s = source;
  let d = destination;
  mem[PACKED_COUNT] = count;
  mem[PACKED_BIT_CLOCK] = 0;
  const header = mem[s++];
  if (header < 0x80) {
    mem.copyWithin(PACKED_PALETTE, s, s + header);
    s += header;
  }
  const colours = header & 0x7f;
  let index = 0;
  while (m.u16(POWERS_OF_TWO + index) < colours) {
    index += 2;
  }
  mem[PACKED_MASK] = (m.u16(POWERS_OF_TWO + index) - 1) & 0xff;
  const bits = (index >> 1) + 1;
  m.set16(PACKED_BITS, bits);
  // mul byte / div 8: the byte length of the run, rounded up
  const product = (count * bits) & 0xffff;
  let length = Math.floor(product / 8) & 0xff;
  if (product % 8 !== 0) {
    length = (length + 1) & 0xff;
  }
  const end = s + length;
  let dx = m.u16(s);
  s += 2;
  for (let i = 0; i < count; i++) {
    mem[d++] = mem[PACKED_PALETTE + (dx & 0xff & mem[PACKED_MASK])];
    for (let k = 0; k < bits; k++) {
      dx >>= 1;
      if (m.addByte(PACKED_BIT_CLOCK, BIT_CLOCK_STEP)) {
        dx = (dx & 0xff) | (mem[s++] << 8);
      }
    }
  }
  return { source: end, destination: d };
}

/** 0x1c504: a 320x200 picture from `source` to `destination`; returns the bytes written. */
export function decodePicture(m, source, destination) {
  const mem = m.mem;
  let s = source;
  let d = destination;
  m.set16(PICTURE_OPERATIONS, m.u16(s));
  s += 2;
  do {
    const b = mem[s++];
    const n = b & 0x3f;
    if (!(b & 0x80)) {
      if (!(b & 0x40)) {
        const v = mem[s++];
        mem.fill(v, d, d + n);
        d += n;
      } else {
        const low = mem[s];
        const high = mem[s + 1];
        s += 2;
        for (let i = 0; i < n; i++) {
          mem[d++] = low;
          mem[d++] = high;
        }
      }
    } else if (!(b & 0x40)) {
      mem.copyWithin(d, s, s + n);
      s += n;
      d += n;
    } else {
      ({ source: s, destination: d } = decodePackedRun(m, n, s, d));
    }
    m.set16(PICTURE_OPERATIONS, m.u16(PICTURE_OPERATIONS) - 1);
  } while (!(m.u16(PICTURE_OPERATIONS) & 0x8000));
  return d - destination;
}

// ---- 0x28b2a: the 160x100 video ----

const VIDEO_FRAME = 0x28b25;
const VIDEO_ITEM = 0x1b17c;
const VIDEO_FRAME_OFFSETS = 0x28a31;
/** 0x28b88: the video decodes into the first object buffer. */
const VIDEO_BUFFER = OBJECT_BUFFERS[0];
const VIDEO_FRAME_BYTES = 0x3e80;
const VIDEO_WIDTH = 160;
const VIDEO_HEIGHT = 100;

/** 0x28b2a: video frame [0x28b25] decoded (RLE limit patched to 0x3e80), doubled into W as v << 1. */
export function drawVideoFrame(m) {
  m.set32(RLE_LIMIT, VIDEO_FRAME_BYTES);
  const frame = m.u32(VIDEO_FRAME);
  const source = (m.u32(VIDEO_FRAME_OFFSETS + 4 * frame) + m.u32(VIDEO_ITEM)) >>> 0;
  decodeRle(m, source, m.u32(VIDEO_BUFFER));
  const mem = m.mem;
  let s = m.u32(VIDEO_BUFFER);
  let d = workBuffer(m);
  for (let y = 0; y < VIDEO_HEIGHT; y++) {
    for (let x = 0; x < VIDEO_WIDTH; x++) {
      const v = (mem[s++] << 1) & 0xff;
      mem[d] = v;
      mem[d + 1] = v;
      mem[d + ROW] = v;
      mem[d + ROW + 1] = v;
      d += 2;
    }
    d += ROW;
  }
}

// ---- 0x2879f: the additive rotozoomer ----

export const ZOOM_INDEX = 0x28769;
/** The imm8 of `shr al, 3` at 0x28916: patched to 1 by 0x5486d / 0x54a2c for the text texture. */
export const TEXEL_SHIFT = 0x28918;
const CORNERS = [0x2872d, 0x28735, 0x2873d];
const WIDTH_DIVISOR = 0x2876d;
const HEIGHT_DIVISOR = 0x28771;
const ROW_START = 0x28775;
const ROW_FRACTION = 0x28778;
const OFFSET_U = 0x28783;
const OFFSET_V_INDEX = 0x28787;
/** 8.8 steps: the fraction byte and the integer dword of each quotient. */
const STEP_U_X = [0x28745, 0x28749];
const STEP_V_X = [0x2874d, 0x28751];
const STEP_U_Y = [0x28755, 0x28759];
const STEP_V_Y = [0x2875d, 0x28761];
const ZOOM_BIAS = 0x800;
const ZOOM_SHIFT = 5;
const ZOOM_BASE = 0x32;
const CENTRE_OFFSET = 0x1e;
const TEXTURE_CENTRE = 0x80;
const ROTOZOOM_WIDTH = 0xa0;
const ROTOZOOM_ROWS = 0x64;
const ROTOZOOM_SATURATION = 0x40;
const ROTOZOOM_MAXIMUM = 0x3f;

function rotateCorner(m, x, y, corner) {
  m.set32(SCRATCH_X, x);
  m.set32(SCRATCH_Y, y);
  rotateZ(m);
  m.set32(corner, m.s32(SCRATCH_X));
  m.set32(corner + 4, m.s32(SCRATCH_Y));
}

/** idiv of (difference << 8) by the dword divisor: fraction byte and integer part stored as the code does. */
function storeStep(m, difference, divisorAddress, [fractionAddress, integerAddress]) {
  const quotient = Math.trunc((difference << 8) / m.s32(divisorAddress)) | 0;
  m.set8(fractionAddress, quotient & 0xff);
  m.set32(integerAddress, quotient >> 8);
}

/** `add lo, fraction; adc hi, integer` on one 8.8 byte pair (hi << 8 | lo), 16-bit. */
function stepPair(m, pair, [fractionAddress, integerAddress]) {
  const low = (pair & 0xff) + m.u8(fractionAddress);
  const high = ((pair >> 8) + m.u8(integerAddress) + (low >> 8)) & 0xff;
  return (high << 8) | (low & 0xff);
}

/** One step of the (u, v) integer bytes and their fractions: bx = v:u, dx = vFraction:uFraction. */
function stepPosition(m, bx, dx, stepU, stepV) {
  const u = stepPair(m, ((bx & 0xff) << 8) | (dx & 0xff), stepU);
  const v = stepPair(m, (bx & 0xff00) | (dx >> 8), stepV);
  return { bx: (v & 0xff00) | (u >> 8), dx: ((v & 0xff) << 8) | (u & 0xff) };
}

/**
 * 0x2879f: the 256x256 texture at `texture`, rotated by [0x2d460] and zoomed by SIN[[0x28769]], each texel
 * >> [0x28918], added with saturation at 0x3f into the 160x100 buffer [0x1b262]. Corners (C6): P0 = rot(c, 30-c),
 * P1 = rot(-c, 30-c) (top-left), P2 = rot(c, c+30); x steps P1 -> P0 over 160, y P0 -> P2 over 120.
 */
export function rotozoom(m, texture) {
  const mem = m.mem;
  let c = m.s32((SINE_DWORDS + m.u32(ZOOM_INDEX) * 4) >>> 0);
  c = ((c + ZOOM_BIAS) >> ZOOM_SHIFT) + ZOOM_BASE;
  rotateCorner(m, c, -c + CENTRE_OFFSET, CORNERS[0]);
  rotateCorner(m, -c, -c + CENTRE_OFFSET, CORNERS[1]);
  rotateCorner(m, c, c + CENTRE_OFFSET, CORNERS[2]);
  const [x0, y0, x1, y1, x2, y2] = [0, 4, 8, 12, 16, 20].map((k) => m.s32(CORNERS[0] + k));
  storeStep(m, x0 - x1, WIDTH_DIVISOR, STEP_U_X);
  storeStep(m, y0 - y1, WIDTH_DIVISOR, STEP_V_X);
  storeStep(m, x2 - x0, HEIGHT_DIVISOR, STEP_U_Y);
  storeStep(m, y2 - y0, HEIGHT_DIVISOR, STEP_V_Y);
  let d = m.u32(ROTOZOOM_BUFFER_POINTER);
  m.set32(ROW_FRACTION, 0);
  const v0 = (mem[CORNERS[1] + 4] + TEXTURE_CENTRE + mem[(SINE_BYTES + m.u32(OFFSET_V_INDEX)) >>> 0]) & 0xff;
  const u0 = (mem[CORNERS[1]] + TEXTURE_CENTRE + mem[OFFSET_U]) & 0xff;
  let rowStart = (v0 << 8) | u0;
  const shift = mem[TEXEL_SHIFT] & 31;
  for (let row = 0; row < ROTOZOOM_ROWS; row++) {
    m.set16(ROW_START, rowStart);
    let bx = rowStart;
    let dx = 0;
    for (let x = 0; x < ROTOZOOM_WIDTH; x++) {
      let p = (mem[d] + (mem[texture + bx] >>> shift)) & 0xff;
      if (p >= ROTOZOOM_SATURATION) {
        p = ROTOZOOM_MAXIMUM;
      }
      mem[d++] = p;
      ({ bx, dx } = stepPosition(m, bx, dx, STEP_U_X, STEP_V_X));
    }
    const next = stepPosition(m, m.u16(ROW_START), m.u16(ROW_FRACTION), STEP_U_Y, STEP_V_Y);
    m.set16(ROW_FRACTION, next.dx);
    rowStart = next.bx;
  }
}

// ---- 0x1bb5c / 0x1bbac: the opaque font into the 256-wide texture ----

const TEXT_LEFT = 2;

/** 0x1bb5c: the string [0x1baa7] into the texture [0x1b25a] + 2, opaque, pixels << 2 (no colour base). */
export function drawTextIntoTexture(m) {
  drawString(m, m.u32(TEXTURE_BUFFER_POINTER) + TEXT_LEFT, TEXTURE_LAYOUT);
}

// ---- 0x55121: the map renderer of "system divines" / "nature" ----

const MAP_PHASE_U = 0x55119;
const MAP_PHASE_V = 0x5511a;
const MAP_X = 0x5511b;
const MAP_OFFSET_X = 0x5511c;
const MAP_Y = 0x5511d;
const MAP_OFFSET_Y = 0x5511e;
const MAP_ADD_U = 0x5511f;
const MAP_ADD_V = 0x55120;
/** The imm8 of the two `shr al/ah, 0` (0x55194, 0x551a3). */
const MAP_SHIFT_U = 0x55194;
const MAP_SHIFT_V = 0x551a3;
const MAP_SECOND_HALF = 0xff00;
const MAP_SINE_SHIFT = 6;
const MAP_BASE_X = 0x20;
const MAP_BASE_Y = 0x30;
const MAP_WIDTH = 0xa0;
const MAP_ROWS = 0x64;

/** 0x55121: T[(M2[i] + v) : (M1[i] + u)] doubled into `destination`; u, v and both phases advance per call. */
export function renderMap(m, map, destination, texture) {
  const mem = m.mem;
  mem[MAP_OFFSET_X] = ((m.s32(SINE_DWORDS + mem[MAP_PHASE_U] * 4) >> MAP_SINE_SHIFT) + MAP_BASE_X) & 0xff;
  mem[MAP_OFFSET_Y] = ((m.s32(COSINE_DWORDS + mem[MAP_PHASE_V] * 4) >> MAP_SINE_SHIFT) + MAP_BASE_Y) & 0xff;
  let d = destination;
  for (mem[MAP_Y] = 0; mem[MAP_Y] < MAP_ROWS; mem[MAP_Y]++) {
    for (mem[MAP_X] = 0; mem[MAP_X] < MAP_WIDTH; mem[MAP_X]++) {
      const cl = (mem[MAP_X] + mem[MAP_OFFSET_X]) & 0xff;
      let ch = (mem[MAP_Y] + mem[MAP_OFFSET_Y]) & 0xff;
      if (ch === 0xff) {
        ch = 0;
      }
      const i = (ch << 8) | cl;
      const low = ((((mem[map + i] + mem[TEXTURE_SCROLL_U]) & 0xff) >> (mem[MAP_SHIFT_U] & 31)) + mem[MAP_ADD_U]) & 0xff;
      const high = ((((mem[map + i + MAP_SECOND_HALF] + mem[TEXTURE_SCROLL_V]) & 0xff) >> (mem[MAP_SHIFT_V] & 31)) + mem[MAP_ADD_V]) & 0xff;
      const p = mem[texture + ((high << 8) | low)];
      mem[d] = p;
      mem[d + 1] = p;
      mem[d + ROW] = p;
      mem[d + ROW + 1] = p;
      d += 2;
    }
    d += ROW;
  }
  m.addByte(TEXTURE_SCROLL_U, 1);
  m.addByte(TEXTURE_SCROLL_V, 1);
  m.addByte(MAP_PHASE_U, 3);
  m.addByte(MAP_PHASE_V, 2);
}
