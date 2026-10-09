// The Transforming-objects (08d8:35f6 with 350b) and the Contour-City (08d8:39d4 with 3902, 383b, 3878, 38ea,
// 38bf), docs/disassembly/G6_greets_tunnel_city.md sections 3.6 and 3.7. Both draw into plane 2 of the eight-page
// cycle over the "Surprise!" pattern.
import { waitTick } from '../machine.js';
import { setDac } from '../library.js';
import * as engine from '../engine3d.js';
import { SEGMENT_08D8, SHOWN_PAGE, cyclePage, setColourSelect, showCurrentPage, showPages } from './surprisePages.js';
import { CITYDATA, CITYDAT2, CITYDAT3, ROW_TABLE } from './motorcycle.js';

/** 08d8:35ae: (shape A, shape B) offset pairs in segment 02ef, ffffh at the end; 35f0 the current pair. */
const MORPH_TABLE = SEGMENT_08D8 + 0x35ae;
const MORPH_POINTER = SEGMENT_08D8 + 0x35f0;
const MORPH_A = SEGMENT_08D8 + 0x35f2;
const MORPH_B = SEGMENT_08D8 + 0x35f4;
const TABLE_END = 0xffff;
const SHAPES_BASE = 0x02ef * 16;
const MORPH_PAIRS = 0x10;
const MORPH_FRAMES = 0x3c;
const POLYLINE_SEGMENTS = 0x33;
/** 08d8:353e: t runs 1..50 (then stays 50) over 50ths. */
const MORPH_STEPS = 0x32;
/** 35f6: the fill box of the shapes (x 90..230, y 40..160). */
const MORPH_BOX = { minX: 0x5a, maxX: 0xe6, minY: 0x28, maxY: 0xa0 };

/** 08d8:31f8: the city's 32 colours. */
const PALETTE_CITY = SEGMENT_08D8 + 0x31f8;
const CITY_COLOURS = 0x20;
/** 08d8:3900 word: the page the city frame goes into. */
const CITY_PAGE = SEGMENT_08D8 + 0x3900;
const BAND_START = 0x1ef0;
const BAND_STEPS = 0x1e;
const BAND_BYTES = 0x50;
const PAGES = 8;
const PAGE_BYTES = 0x1f40;
const COLUMNS = 0x28;
const FILL_ROWS = 0x8c;
const EMPTY_COLUMN = 0xff;
const CONTOUR_BYTES_PER_FRAME = 320;

const SEQUENCER_INDEX = 0x3c4;
const s16 = (v) => (v << 16) >> 16;

function setBox(m, box) {
  const base = engine.ENGINE_SEGMENT_BASE;
  m.set16(base + engine.ENGINE.PLANE_MIN_X, box.minX);
  m.set16(base + engine.ENGINE.PLANE_MAX_X, box.maxX);
  m.set16(base + engine.ENGINE.PLANE_MIN_Y, box.minY);
  m.set16(base + engine.ENGINE.PLANE_MAX_Y, box.maxY);
}

/** 08d8:350b: `segments` XOR lines between consecutive points of shapes A and B, interpolated at t/50. */
function drawMorphPolyline(m, shapeA, shapeB, segments, t) {
  let a = shapeA;
  let b = shapeB;
  const value = (offset) => {
    const from = m.s16(a + offset);
    return s16(from + Math.trunc(s16(m.s16(b + offset) - from) * t / MORPH_STEPS));
  };
  for (let i = 0; i < segments; i++) {
    engine.xorLine(m, value(0), value(2), value(4), value(6));
    a += 4;
    b += 4;
  }
  return [a, b];
}

/** 08d8:35f6: 16 morphs of 60 frames between the outline shapes. */
export function* transformingObjects(m) {
  const vga = m.vga;
  const fillAllSegment = engine.ENGINE_SEGMENT_BASE + engine.ENGINE.FILL_ALL_SEGMENT;
  setBox(m, MORPH_BOX);
  vga.out16(SEQUENCER_INDEX, 0x0402);
  for (let pair = 0; pair < MORPH_PAIRS; pair++) {
    const entry = SEGMENT_08D8 + m.u16(MORPH_POINTER);
    m.set16(MORPH_A, m.u16(entry));
    m.set16(MORPH_B, m.u16(entry + 2));
    let t = 1;
    for (let frame = 0; frame < MORPH_FRAMES; frame++) {
      const [a, b] = drawMorphPolyline(m, SHAPES_BASE + m.u16(MORPH_A), SHAPES_BASE + m.u16(MORPH_B), POLYLINE_SEGMENTS, t);
      drawMorphPolyline(m, a + 4, b + 4, POLYLINE_SEGMENTS, t);
      engine.fillAll(m);
      for (let ticks = engine.readFrameCounter(m); ticks > 0; ticks--) {
        cyclePage(m);
      }
      showCurrentPage(m);
      m.set16(fillAllSegment, (m.u16(SHOWN_PAGE) >> 4) + 0xa000);
      yield* waitTick(m);
      setColourSelect(m);
      t = t + 1 < MORPH_STEPS ? t + 1 : MORPH_STEPS;
    }
    let pointer = m.u16(MORPH_POINTER) + 4;
    m.set16(MORPH_POINTER, pointer);
    if (m.u16(SEGMENT_08D8 + pointer) === TABLE_END) {
      pointer = MORPH_TABLE - SEGMENT_08D8;
      m.set16(MORPH_POINTER, pointer);
    }
  }
}

/** 08d8:383b: one frame of heights (320 bytes from `source`) as single pixels into the XOR buffer. */
function plotContour(m, source) {
  const mem = m.mem;
  const buffer = engine.bufferBase(m);
  let si = source;
  for (let column = 0; column < COLUMNS; column++) {
    let mask = 0x80;
    let zeros = 0;
    for (let bit = 0; bit < 8; bit++) {
      const height = mem[si++];
      if (height !== 0) {
        mem[buffer + ((m.u16(ROW_TABLE + height * 2) + column) & 0xffff)] |= mask;
      } else {
        zeros++;
      }
      mask >>= 1;
    }
    if (zeros === 8) {
      mem[buffer + column] = EMPTY_COLUMN;
    }
  }
  return si;
}

/** 08d8:3878: vertical XOR fill of the buffer's rows 1..140 into rows 0..139 of the page at `page` (plane 2). */
function fillContour(m, page) {
  const mem = m.mem;
  const vga = m.vga;
  const buffer = engine.bufferBase(m);
  for (let column = 0; column < COLUMNS; column++) {
    let video = page + column;
    if (mem[buffer + column] === EMPTY_COLUMN) {
      mem[buffer + column] = 0;
      for (let row = 0; row < FILL_ROWS; row++) {
        vga.write(video, 0);
        video += COLUMNS;
      }
      continue;
    }
    let state = 0;
    let at = buffer + column + COLUMNS;
    for (let row = 0; row < FILL_ROWS; row++) {
      const value = mem[at];
      if (value !== 0) {
        state ^= value;
        mem[at] = 0;
      }
      at += COLUMNS;
      vga.write(video, state);
      video += COLUMNS;
    }
  }
}

/** 08d8:3902: one city frame into the page just left; returns the ticks it took and the next source byte. */
function* cityFrame(m, source, out) {
  const ticks = engine.readFrameCounter(m);
  let left = 0;
  for (let i = 0; i < ticks; i++) {
    left = cyclePage(m);
  }
  m.set16(CITY_PAGE, left);
  showCurrentPage(m);
  yield* waitTick(m);
  setColourSelect(m);
  const next = plotContour(m, source);
  fillContour(m, m.u16(CITY_PAGE));
  out.ticks = ticks;
  out.next = next;
}

/** `si = 0 ; cx = frames - 1 ; repeat cityFrame while (cx -= ticks) >= 0` (38ea, 38bf, 3a1b). */
function* playCity(m, pointer, frames) {
  let source = m.u16(pointer) * 16;
  const out = { ticks: 0, next: 0 };
  let remaining = frames - 1;
  do {
    yield* cityFrame(m, source, out);
    source = out.next;
    remaining -= out.ticks;
  } while (remaining >= 0);
}

/** 08d8:39d4: the city palette, the grey band rising 2 rows per 2 frames, then the city animations. */
export function* contourCity(m) {
  const vga = m.vga;
  setDac(m, 0, CITY_COLOURS, PALETTE_CITY);
  vga.out16(SEQUENCER_INDEX, 0x0402);
  let row = BAND_START;
  for (let step = 0; step < BAND_STEPS; step++) {
    yield* showPages(m, 1);
    let at = row;
    for (let page = 0; page < PAGES; page++) {
      for (let i = 0; i < BAND_BYTES; i++) {
        vga.write(at + i, 0xff);
      }
      at += PAGE_BYTES;
    }
    row -= BAND_BYTES;
  }
  yield* playCity(m, CITYDAT3, 0xa0); // 38ea
  for (let i = 0; i < 2; i++) {
    yield* playCity(m, CITYDATA, 0xc8);
  }
  yield* playCity(m, CITYDATA, 0xa5); // 38bf
  yield* playCity(m, CITYDAT2, 0x5a);
}
