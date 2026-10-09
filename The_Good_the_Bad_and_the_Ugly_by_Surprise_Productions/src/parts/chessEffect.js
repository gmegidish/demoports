// The chess effect (Erik), 08d8:18d4. docs/disassembly/G3_plasma_morph_chess.md, section 4.
//
// Each frame: lines from 22 border points to two moving centres are XORed (one pixel per row) into a 1-bit buffer
// (the 'scr_data' block), which is then even-odd filled row by row into one plane of the 16-colour screen at
// a000:1f40 (the plane changes every frame). The colour select register makes the newest plane white and the 3
// older ones grey (cheffect's palette): a motion trail. The picture slides down into view by the start address;
// at music sync 5 the line compare 0 shows memory from address 0 (all colour 15): a white frame.
import { linear, waitTick } from '../machine.js';
import { setDac, setP54S, setLineCompare } from '../library.js';

const MODULE = linear(0x08d8, 0);
const BUFFER_POINTER = MODULE + 0x00;
const TABLES_POINTER = MODULE + 0x18;
const CENTRE_1_X = MODULE + 0x25;
const CENTRE_1_Y = MODULE + 0x27;
const CENTRE_2_X = MODULE + 0x29;
const CENTRE_2_Y = MODULE + 0x2b;
const TABLE_INDICES = [0x2d, 0x2f, 0x31, 0x33].map((offset) => MODULE + offset);
const TABLE_STEPS = [4, 6, 6, 4];
const TABLE_WRAP = 0x280;
const CENTRE_2_X_OFFSET = 0x64;
const BORDER_POINTS = MODULE + 0x36;
const BORDER_POINT_COUNT = 0x16;
const WINDOW_TOP = MODULE + 0xa7;
const WINDOW_BOTTOM = MODULE + 0xa9;
const WINDOW_LEFT = MODULE + 0xab;
const WINDOW_RIGHT = MODULE + 0xad;
const UNUSED_23 = MODULE + 0x23;
/** The immediate of `mov bx, 0a000h` at 0f2c: the fill's screen segment. */
const FILL_SEGMENT = MODULE + 0xf2d;
const FILL_SEGMENT_VALUE = 0xa1f4;
const ELAPSED = MODULE + 0x157c;
const MAP_MASK = MODULE + 0x1796;
const COLOUR_SELECT = MODULE + 0x1797;
const START_ADDRESS = MODULE + 0x1798;
const LINE_COMPARE = MODULE + 0x179a;

const PALETTE = 0x280;
const PALETTE_COLOURS = 0x40;
const WHITE_PAGE_WORDS = 0xfa0;
const SCROLL_STEP = 0xa0;
const SCROLL_END = 0x1f40;
const LINE_COMPARE_STEP = 0x0c;
const SYNC_TO_END = 5;
const ROW_BYTES = 0x28;
/** 0f41/0f49/2049 in the 'scr_data' block: prefix-XOR fill tables (the second one inverted). */
const FILL_TABLE = 0x1f49;
const INVERTED_FILL_TABLE = 0x2049;
const WINDOW = { top: 8, bottom: 0xbf, left: 8, right: 0x137 };

const SEQUENCER_INDEX = 0x3c4;
const CRTC_INDEX = 0x3d4;
const ATTRIBUTE_PORT = 0x3c0;
const INPUT_STATUS = 0x3da;
const COLOUR_SELECT_INDEX = 0x34;
const WORD = 0xffff;

const signed16 = (v) => ((v & WORD) << 16) >> 16;

/** 1706: the two centres from the cheffect tables, then the table indices advance. */
function stepCentres(m) {
  const tables = linear(m.u16(TABLES_POINTER), 0);
  const values = TABLE_INDICES.map((index) => m.u16(tables + m.u16(index)));
  m.set16(CENTRE_1_X, values[0]);
  m.set16(CENTRE_1_Y, values[1]);
  m.set16(CENTRE_2_X, (values[2] + CENTRE_2_X_OFFSET) & WORD);
  m.set16(CENTRE_2_Y, values[3]);
  TABLE_INDICES.forEach((index, i) => {
    let value = m.u16(index) + TABLE_STEPS[i];
    if (value >= TABLE_WRAP) {
      value -= TABLE_WRAP;
    }
    m.set16(index, value);
  });
}

/** 097f: XORs one pixel per row from (x1, y1) up to (x2, y2) (the rows y2+1..y1 of the lower end's). */
function xorEdge(mem, buffer, y1In, x1In, y2In, x2In) {
  let y1 = y1In;
  let x1 = x1In;
  let y2 = y2In;
  let x2 = x2In;
  if (y1 === y2) {
    return;
  }
  if (y1 < y2) {
    [y1, x1, y2, x2] = [y2, x2, y1, x1];
  }
  const dy = y1 - y2;
  let di = (y1 * ROW_BYTES) & WORD;
  const plot = (x) => {
    mem[buffer + ((di + (x >> 3)) & WORD)] ^= 0x80 >> (x & 7);
  };
  const dx = x2 - x1;
  let x = x1;
  if (dx === 0) {
    for (let i = 0; i < dy; i++) {
      plot(x);
      di -= ROW_BYTES;
    }
    return;
  }
  const direction = dx < 0 ? -1 : 1;
  const absDx = Math.abs(dx);
  if (absDx === dy) {
    for (let i = 0; i < dy; i++) {
      plot(x);
      di -= ROW_BYTES;
      x += direction;
    }
    return;
  }
  let error = 0;
  if (absDx > dy) {
    let rows = dy;
    plot(x);
    for (;;) {
      x += direction;
      error += 2 * dy;
      if (error > absDx) {
        di -= ROW_BYTES;
        rows--;
        if (rows === 0) {
          return;
        }
        error -= 2 * absDx;
        plot(x);
      }
    }
  }
  for (let i = 0; i < dy; i++) {
    plot(x);
    di -= ROW_BYTES;
    error += 2 * absDx;
    if (error > dy) {
      error -= 2 * dy;
      x += direction;
    }
  }
}

/** 0ecc: even-odd fill of the window, row by row, into the current plane at the fill segment; clears the buffer. */
function fill(m, buffer) {
  const mem = m.mem;
  const top = m.u16(WINDOW_TOP);
  const rows = m.u16(WINDOW_BOTTOM) - top + 1;
  if (rows <= 0) {
    return;
  }
  const firstByte = m.u16(WINDOW_LEFT) >> 3;
  const bytes = (m.u16(WINDOW_RIGHT) >> 3) + 1 - firstByte;
  const screen = ((m.u16(FILL_SEGMENT) - 0xa000) * 16) & WORD;
  let time = FILL_START_SCANLINE * 100 + top * FILL_SCANLINES_PER_100_ROWS;
  for (let row = 0; row < rows; row++) {
    passBeamTo(m.vga, Math.floor(time / 100));
    time += FILL_SCANLINES_PER_100_ROWS;
    const rowStart = ((top + row) * ROW_BYTES + firstByte) & WORD;
    let isInside = false;
    for (let k = 0; k < bytes; k++) {
      const at = (rowStart + k) & WORD;
      const bits = mem[buffer + at];
      const table = isInside ? INVERTED_FILL_TABLE : FILL_TABLE;
      m.vga.write((screen + at) & WORD, mem[buffer + table + bits]);
      if (bits !== 0) {
        if (parityIsOdd(bits)) {
          isInside = !isInside;
        }
        mem[buffer + at] = 0;
      }
    }
  }
}

/**
 * The beam while the fill runs: DOSBox draws the screen while the CPU fills, so screen rows the beam reaches before
 * the fill has written their picture row show the plane's old content. Only visible while the picture slides in
 * (7689..7717): measured from those frames. The fill of picture row r is done at scanline FILL_START_SCANLINE +
 * r * FILL_SCANLINES_PER_100_ROWS / 100 of the frame (negative: before the first visible line).
 */
const FILL_START_SCANLINE = -24;
const FILL_SCANLINES_PER_100_ROWS = 40;

function passBeamTo(vga, scanline) {
  const waits = scanline + 1 - vga.hblankWaits;
  if (scanline >= 0 && waits > 0) {
    vga.hblank(waits);
  }
}

function parityIsOdd(value) {
  let v = value;
  v ^= v >> 4;
  v ^= v >> 2;
  v ^= v >> 1;
  return (v & 1) !== 0;
}

/** 1846: one plane of the chessboard. */
function drawFrame(m) {
  const mem = m.mem;
  m.vga.out16(SEQUENCER_INDEX, (mem[MAP_MASK] << 8) | 2);
  mem[MAP_MASK] = (mem[MAP_MASK] << 1) & 0xff;
  if (mem[MAP_MASK] >= 0x10) {
    mem[MAP_MASK] = 1;
  }
  stepCentres(m);
  const buffer = linear(m.u16(BUFFER_POINTER), 0);
  for (const [centreX, centreY] of [[CENTRE_1_X, CENTRE_1_Y], [CENTRE_2_X, CENTRE_2_Y]]) {
    for (let i = 0; i < BORDER_POINT_COUNT; i++) {
      const y = m.s16(BORDER_POINTS + 4 * i);
      const x = m.s16(BORDER_POINTS + 4 * i + 2);
      xorEdge(mem, buffer, y, x, m.s16(centreY), m.s16(centreX));
    }
  }
  setWindow(m);
  fill(m, buffer);
}

function setWindow(m) {
  m.set16(WINDOW_LEFT, WINDOW.left);
  m.set16(WINDOW_RIGHT, WINDOW.right);
  m.set16(WINDOW_TOP, WINDOW.top);
  m.set16(WINDOW_BOTTOM, WINDOW.bottom);
}

/** Colour select (attribute 14h) = the next of 0..3. */
function stepColourSelect(m) {
  // The retrace IRQ 0731:007a read 3dah during the wait: the attribute flip-flop expects an index again.
  m.vga.in8(INPUT_STATUS);
  m.vga.out8(ATTRIBUTE_PORT, COLOUR_SELECT_INDEX);
  m.vga.out8(ATTRIBUTE_PORT, m.u8(COLOUR_SELECT));
  m.set8(COLOUR_SELECT, (m.u8(COLOUR_SELECT) + 1) & 3);
}

/** 179c: wait, start address and colour select; the start address slides down to 1f40h. */
function* showAndScroll(m) {
  const elapsed = m.frameCounter;
  m.set16(ELAPSED, elapsed);
  yield* waitTick(m);
  const start = m.u16(START_ADDRESS);
  m.vga.out16(CRTC_INDEX, (start & 0xff00) | 0x0c);
  m.vga.out16(CRTC_INDEX, ((start & 0xff) << 8) | 0x0d);
  stepColourSelect(m);
  m.set16(START_ADDRESS, (m.u16(START_ADDRESS) - SCROLL_STEP * elapsed) & WORD);
  if (m.u16(START_ADDRESS) <= SCROLL_END) {
    m.set16(START_ADDRESS, SCROLL_END);
  }
}

/** 17f6: wait, line compare and colour select; the line compare goes down to 0. */
function* showAndCompare(m) {
  const elapsed = m.frameCounter;
  m.set16(ELAPSED, elapsed);
  yield* waitTick(m);
  setLineCompare(m.vga, m.u16(LINE_COMPARE));
  stepColourSelect(m);
  m.set16(LINE_COMPARE, (m.u16(LINE_COMPARE) - LINE_COMPARE_STEP * elapsed) & WORD);
  if (signed16(m.u16(LINE_COMPARE)) <= 0) {
    m.set16(LINE_COMPARE, 0);
  }
}

/** 08d8:18d4. */
export function* chessEffect(m) {
  const vga = m.vga;
  setDac(m, 0, PALETTE_COLOURS, linear(m.u16(TABLES_POINTER), PALETTE));
  vga.in8(INPUT_STATUS);
  setP54S(vga);
  vga.out16(SEQUENCER_INDEX, 0x0f02);
  for (let offset = 0; offset < WHITE_PAGE_WORDS * 2; offset++) {
    vga.write(offset, 0xff);
  }
  yield* waitTick(m);
  m.set16(UNUSED_23, 0);
  m.set16(FILL_SEGMENT, FILL_SEGMENT_VALUE);
  setWindow(m);
  do {
    drawFrame(m);
    yield* showAndScroll(m);
  } while (m.musicSync < SYNC_TO_END);
  m.set16(LINE_COMPARE, 0);
  do {
    drawFrame(m);
    yield* showAndCompare(m);
  } while (m.u16(LINE_COMPARE) !== 0);
  yield* waitTick(m);
  setLineCompare(vga, 0);
}
