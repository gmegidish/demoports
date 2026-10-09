// The Dot-tunnel (Antibyte), 0e40:063b (docs/disassembly/G6_greets_tunnel_city.md, section 2): rings of 64 dots
// fly towards the viewer in the 16-colour planar mode with 64-byte rows, double buffered, drawn with write mode 3.
// The original compiles each of its 300 ring shapes into x86 code (0e40:01c9); the port keeps the dot coordinates
// that code plots instead. Everything else (ring records, counters, the colour table) lives in memory as in the
// original.
import { linear, waitTick } from '../machine.js';
import { readFrameCounter } from '../engine3d.js';
import { setDac, setDacBlack } from '../library.js';

const MODULE = linear(0x0e40, 0);
/** 0e40:0000 / 0002: the two blocks of compiled shapes (0xca3 paragraphs each). */
const CODE_BLOCK_0 = MODULE + 0x00;
const CODE_BLOCK_1 = MODULE + 0x02;
const CODE_BLOCK_PARAGRAPHS = 0xca3;
/** 0e40:0004: segment of dot_data. */
const DATA_SEGMENT = MODULE + 0x04;
/** 0e40:000e ring count, 0010 countdown to the next ring add/remove, 0012/0014 wobble table pointers. */
const RING_COUNT = MODULE + 0x0e;
const COUNTDOWN = MODULE + 0x10;
const X_POINTER = MODULE + 0x12;
const Y_POINTER = MODULE + 0x14;
/** 0e40:002c: 16 DAC colours (black, 13 greys, black, black). */
const PALETTE = MODULE + 0x2c;
/** 0e40:0446: CRTC start of the page being drawn; 0448: its segment. */
const DRAW_START = MODULE + 0x446;
const DRAW_SEGMENT = MODULE + 0x448;
/** 0e40:0534: pointer to the (colour, size) pair of ring 0. */
const COLOUR_POINTER = MODULE + 0x534;

/** dot_data offsets: ring 0's record (rings go down by 6), the wobble tables, the sine table. */
const RING_0 = 0x96;
const RING_RECORD = 6;
const X_TABLE = 0x1086;
const Y_TABLE = 0x1114;
const TABLE_END = 0x4142;
const SINE = 0x11a2;
const COSINE = 0x13a2;

const SHAPES = 300;
const DOTS = 64;
const MAX_RINGS = 25;
const FRAMES_PER_RING = 12;
/** 0e40:051d: the farthest shape, times 4 (a far pointer index). */
const FARTHEST_SHAPE = 0x4ac;
const PHASE1_TICKS = 0x578;
const ROW_BYTES = 64;
const PAGE_FLIP_START = 0x9600;
const PAGE_FLIP_SEGMENT = 0x0960;
const VISIBLE_ROWS = 200;
const VISIBLE_BYTES = 40;
/**
 * Retraces the precalculation (0e40:023d: 300 shapes rotated, projected and compiled) takes on the reference
 * machine: CPU bound. The greetings (with their black tail) end on frame 18881; the first dots are on frame 18887
 * (start, clear, first tick, this many retraces, the loop's tick).
 */
const PRECALC_RETRACES = 3;

const SEQUENCER_INDEX = 0x3c4;
const GRAPHICS_INDEX = 0x3ce;
const CRTC_INDEX = 0x3d4;

const s16 = (v) => (v << 16) >> 16;
const trunc16 = (a, b) => s16(Math.trunc(a / b));

/** High word of (value * 2) for a signed 32-bit value: `shl ax,1 ; adc dx,dx` (0e40:0140). */
function doubledHighWord(value) {
  return s16(Number((BigInt.asIntN(32, BigInt(value)) * 2n) >> 16n) & 0xffff);
}

/** 0e40:0125: rotates (x, y) by the sine-table byte offset `angle`. */
function rotate(m, data, x, y, angle) {
  const sine = m.s16(data + SINE + angle);
  const cosine = m.s16(data + COSINE + angle);
  return [doubledHighWord(x * cosine - y * sine), doubledHighWord(x * sine + y * cosine)];
}

/**
 * 0e40:023d..02c4 (with 00f2, 0125, 01a7, 00b5): the 300 ring shapes as screen offsets (X, Y) of 64 dots.
 * @returns {Int16Array} SHAPES * DOTS * 2 words
 */
function precalculateShapes(m, data) {
  const circle = [];
  for (let i = 0; i < DOTS; i++) {
    circle.push(rotate(m, data, 0, s16(0xffb0 << 5), 0x20 * i));
  }
  const shapes = new Int16Array(SHAPES * DOTS * 2);
  let angle = 0;
  let z = s16(0xfede);
  for (let shape = 0; shape < SHAPES; shape++) {
    angle = (angle + 2) & 0x7fe;
    const denominator = s16(z + 500);
    for (let i = 0; i < DOTS; i++) {
      let [x, y] = rotate(m, data, circle[i][0], circle[i][1], angle);
      x = trunc16(x * 5, 4);
      const screenX = s16((-trunc16(x * -500, denominator) >> 5) + 0xa0);
      const screenY = s16((trunc16(y * -500, denominator) >> 5) + 0x64);
      shapes[(shape * DOTS + i) * 2] = screenX;
      shapes[(shape * DOTS + i) * 2 + 1] = screenY;
    }
    z = s16(z + 5);
  }
  return shapes;
}

/** 0e40:049c: every 12th call a new ring at the far end (all records move down one). */
function addRing(m, data) {
  const countdown = m.u16(COUNTDOWN) - 1;
  m.set16(COUNTDOWN, countdown);
  if (countdown !== 0) {
    return;
  }
  m.set16(COUNTDOWN, FRAMES_PER_RING);
  let count = m.u16(RING_COUNT);
  if (count !== MAX_RINGS) {
    count++;
    m.set16(RING_COUNT, count);
  }
  const records = data + RING_0 - count * RING_RECORD;
  m.mem.copyWithin(records, records + RING_RECORD, records + RING_RECORD + count * RING_RECORD);
  m.set16(data + RING_0, nextWobble(m, data, X_POINTER, X_TABLE));
  m.set16(data + RING_0 + 2, nextWobble(m, data, Y_POINTER, Y_TABLE));
  m.set16(data + RING_0 + 4, FARTHEST_SHAPE);
}

/** 0e40:04e4: the next word of a wobble table; the 'BA' end marker restarts it. */
function nextWobble(m, data, pointerAddress, table) {
  let pointer = m.u16(pointerAddress);
  let value = m.u16(data + pointer);
  if (value === TABLE_END) {
    pointer = table;
    value = m.u16(data + pointer);
  }
  m.set16(pointerAddress, pointer + 2);
  return value;
}

/** 0e40:0523: every ring one shape (depth step) closer. */
function advanceRings(m, data) {
  let record = data + RING_0 + 4;
  for (let i = m.u16(RING_COUNT); i > 0; i--) {
    m.set16(record, m.u16(record) - 4);
    record -= RING_RECORD;
  }
}

/** 0e40:0470: every 12th call the oldest ring goes, the colour table moves on (a 0 colour inherits the previous). */
function removeRing(m) {
  const countdown = m.u16(COUNTDOWN) - 1;
  m.set16(COUNTDOWN, countdown);
  if (countdown !== 0) {
    return;
  }
  m.set16(COUNTDOWN, FRAMES_PER_RING);
  m.set16(RING_COUNT, m.u16(RING_COUNT) - 1);
  const pointer = m.u16(COLOUR_POINTER) + 2;
  m.set16(COLOUR_POINTER, pointer);
  if (m.mem[MODULE + pointer] === 0) {
    m.mem[MODULE + pointer] = m.mem[MODULE + pointer - 2];
  }
}

/** 0e40:0429: set/reset 0, then 200 rows of 40 bytes 0xff at stride 64 (write mode 3: colour 0). */
function clearPage(m) {
  const vga = m.vga;
  vga.out16(GRAPHICS_INDEX, 0x0000);
  const base = (m.u16(DRAW_SEGMENT) - 0xa000) * 16;
  for (let row = 0; row < VISIBLE_ROWS; row++) {
    for (let column = 0; column < VISIBLE_BYTES; column++) {
      writeMode3Byte(vga, base + row * ROW_BYTES + column, 0xff, false);
    }
  }
}

/**
 * A CPU write in write mode 3 at plane offset `offset`: the bit mask is the data AND the bit mask register, the
 * masked bits take the set/reset colour, the others the latches. `isOr` is `or es:[x], reg`: the read before it
 * loads the latches and returns the read-map plane, which is or-ed into the data.
 */
function writeMode3Byte(vga, offset, data, isOr) {
  const planes = vga.planes;
  let value = data;
  if (isOr) {
    for (let p = 0; p < 4; p++) {
      vga.latches[p] = planes[p][offset];
    }
    value |= vga.latches[vga.graphics[4] & 3];
  }
  const mask = value & vga.graphics[8];
  const setReset = vga.graphics[0];
  const mapMask = vga.sequencer[2];
  // DOSBox's EGA write handler also updates its pixel copy (vga.egaView) in a 16-colour mode.
  const egaView = vga.isEgaMemoryMode ? vga.egaView : null;
  for (let p = 0; p < 4; p++) {
    if (mapMask & (1 << p)) {
      const colour = setReset & (1 << p) ? 0xff : 0;
      const data = (colour & mask) | (vga.latches[p] & ~mask & 0xff);
      planes[p][offset] = data;
      if (egaView !== null) {
        egaView[p][offset] = data;
      }
    }
  }
}

/** Pixel offsets of the dot sizes 0..3 (0e40:0576: 1, 2, 3 or 4 calls of 040c). */
const DOT_OFFSETS = [[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]]];

/** 0e40:0576 (with 040c, the jump table 02c5 and the compiled shapes): all rings into the page being drawn. */
function drawRings(m, data, shapes) {
  const vga = m.vga;
  const base = (m.u16(DRAW_SEGMENT) - 0xa000) * 16;
  let colourPointer = MODULE + m.u16(COLOUR_POINTER);
  let record = data + RING_0;
  for (let i = m.u16(RING_COUNT); i > 0; i--) {
    const colour = m.mem[colourPointer];
    if (colour !== 0) {
      vga.out16(GRAPHICS_INDEX, colour << 8);
    }
    const size = m.mem[colourPointer + 1];
    colourPointer += 2;
    const ringX = m.s16(record);
    const ringY = m.s16(record + 2);
    const shape = (m.u16(record + 4) >> 2) * DOTS * 2;
    const offsets = DOT_OFFSETS[size > 3 ? 3 : size];
    for (const [dx, dy] of offsets) {
      for (let dot = 0; dot < DOTS; dot++) {
        const x = ringX + dx + shapes[shape + dot * 2];
        const y = ringY + dy + shapes[shape + dot * 2 + 1];
        const offset = base + (((y << 6) + (x >> 3)) & 0xffff);
        if (offset < 0x10000) {
          writeMode3Byte(vga, offset, 0x80 >> (x & 7), true);
        }
      }
    }
    record -= RING_RECORD;
  }
}

/** 0e40:044a: show the page just drawn, draw into the other one. */
function flipPages(m) {
  const vga = m.vga;
  const shown = m.u16(DRAW_START);
  m.set16(DRAW_START, shown ^ PAGE_FLIP_START);
  m.set16(DRAW_SEGMENT, m.u16(DRAW_SEGMENT) ^ PAGE_FLIP_SEGMENT);
  vga.out16(CRTC_INDEX, (shown & 0xff00) | 0x0c);
  vga.out16(CRTC_INDEX, ((shown & 0xff) << 8) | 0x0d);
}


/** 0e40:063b. */
export function* dotTunnel(m) {
  const vga = m.vga;
  vga.out16(SEQUENCER_INDEX, 0x0f02);
  for (let offset = 0; offset < 0xfa00; offset++) {
    vga.write(offset, 0);
  }
  m.allocTo(CODE_BLOCK_0, CODE_BLOCK_PARAGRAPHS);
  m.allocTo(CODE_BLOCK_1, CODE_BLOCK_PARAGRAPHS);
  vga.out16(SEQUENCER_INDEX, 0x0f02);
  vga.out8(GRAPHICS_INDEX, 5);
  vga.out8(GRAPHICS_INDEX + 1, (vga.graphics[5] & 0xfc) | 3);
  const data = linear(m.u16(DATA_SEGMENT), 0);
  yield* waitTick(m);
  setDac(m, 0, 0x10, PALETTE); // 0e40:005c
  vga.out16(CRTC_INDEX, 0x2013);
  const shapes = precalculateShapes(m, data);
  for (let i = 0; i < PRECALC_RETRACES; i++) {
    yield;
  }
  addRing(m, data);
  let remaining = PHASE1_TICKS;
  do {
    yield* waitTick(m);
    clearPage(m);
    addRing(m, data);
    drawRings(m, data, shapes);
    advanceRings(m, data);
    const ticks = readFrameCounter(m);
    for (let i = ticks - 1; i > 0; i--) {
      addRing(m, data);
      advanceRings(m, data);
    }
    flipPages(m);
    remaining -= ticks;
  } while (remaining >= 0);
  addRing(m, data);
  for (;;) {
    yield* waitTick(m);
    clearPage(m);
    drawRings(m, data, shapes);
    advanceRings(m, data);
    flipPages(m);
    removeRing(m);
    if (m.u16(RING_COUNT) === 0) {
      break;
    }
    let isOver = false;
    for (let i = readFrameCounter(m) - 1; i > 0; i--) {
      removeRing(m);
      if (m.u16(RING_COUNT) === 0) {
        isOver = true;
        break;
      }
      advanceRings(m, data);
    }
    if (isOver) {
      break;
    }
  }
  m.freeFrom(CODE_BLOCK_0);
  m.freeFrom(CODE_BLOCK_1);
  setDacBlack(vga);
}
