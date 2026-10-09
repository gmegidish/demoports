// Picture-zoomer (Erik / Maestro), 0d97:013c with the code overlay zoomcde2. docs/disassembly/G7_zoomers.md.
// Mode 13h, drawn straight into the visible page. Four pictures (try4c, xla02, titcha08, frak2) grow from the
// centre over the previous one, alternating palette halves; between the third and the fourth the robot wobbles
// (every scanline scaled by its own entry of a scrolling table).
import { linear, waitTick } from '../machine.js';
import { unpackRle, setDac } from '../library.js';
import { runScaler } from './zoomScalers.js';

const SEGMENT = 0x0d97;
const at = (offset) => linear(SEGMENT, offset);

// 0d97 variables and resource pointers
const ZOOMPAL_NAME = at(0x00);
const OVERLAY_POINTER = at(0x08);
const OVERLAY_NAME = at(0x0a);
const ZOOMPAL_POINTER = at(0x12);
const STEP_COUNTDOWN = at(0x14);
const BUFFER_POINTER = at(0x16);
const PICTURE_NAMES = [0x18, 0x20, 0x28, 0x30].map(at);
const PICTURE_POINTERS = [0x38, 0x3a, 0x3c, 0x3e].map(at);
const PALETTE_HALF = at(0x48);
const PICTURE_LIST_POINTER = at(0x49);
const ZOOMPAL_OFFSET = at(0x4b);
const OVERLAY_FAR_SEGMENT = at(0xc6);
const WOBBLE_TICKS = at(0x139);

const BUFFER_PARAGRAPHS = 0xfa0;
const PICTURE_BYTES = 0xfa00;
const ROW_BYTES = 320;
const SCREEN_ROWS = 200;
const PALETTE_HALF_TOGGLE = 0x80;
const PALETTE_COLOURS = 0x80;
const PALETTE_BLOCK_BYTES = 0x300;
/** 0d97:00d3: the first picture of the first call is not held. */
const FIRST_PICTURE_COUNT = 3;
/** 0d97:00dd: ticks the old picture stays before the next one grows. */
const HOLD_TICKS = 0xa0;
const ZOOM_STEPS = 0x64;
/** 0d97:00f6: row 99. */
const ZOOM_START_ROW = 0x7bc0;
const WOBBLE_BUDGET = 0x302;

// zoomcde2 overlay tables (offsets in its segment)
const ROW_LIST_POINTERS = 0xa630;
const ROW_TABLE = 0xa6f8;
const WOBBLE_TABLE = 0xa888;
const RIGHT_EDGES = 0xb4a6;
const WOBBLE_POSITION = 0xb63a;
const WOBBLE_STEP = 3;

/**
 * Retraces between main's mode set and 0d97's first WaitTick: loading six resources and the second mode set.
 * DOSBox file I/O, measured in the recording: the rotating door (08d8:3e3a, a fixed 197 ticks from frame 22788)
 * ends on frame 22984, so main's 07a0 tick and mode set fall on 22985; zoom 1 step 0 is on 22989.
 */
const LOAD_RETRACES = 1;

/** zoomcde2 AH=0 (b667): the row table y * 320. */
function initRowTable(m, overlay) {
  for (let y = 0; y < SCREEN_ROWS; y++) {
    m.set16(overlay + ROW_TABLE + y * 2, y * ROW_BYTES);
  }
}

/** zoomcde2 AH=1 (b63c): `rows` lines of scaler bx/2 from the row list bx/2, from screen offset di down. */
function drawZoomRect(m, overlay, buffer, bx, rows, di) {
  const index = bx >> 1;
  let list = m.u16(overlay + ROW_LIST_POINTERS + bx);
  let destination = di;
  for (let k = 0; k < rows; k++) {
    const sourceRow = m.mem[overlay + list];
    list++;
    const si = m.u16(overlay + ROW_TABLE + sourceRow * 2);
    runScaler(m.vga, m.mem, index, buffer + si, destination);
    destination = (destination + ROW_BYTES) & 0xffff;
  }
}

/** `rep stosb` of zeros on the mode 13h screen. */
function clearSpan(vga, offset, count) {
  for (let i = 0; i < count; i++) {
    const address = (offset + i) & 0xffff;
    vga.planes[address & 3][address >> 2] = 0;
  }
}

/** zoomcde2 AH=2 (b67c): each row scaled by its wobble entry, the leftovers of narrower rows erased. */
function drawWobble(m, overlay, buffer, ticks) {
  const position = (m.u16(overlay + WOBBLE_POSITION) + WOBBLE_STEP * ticks) & 0xffff;
  m.set16(overlay + WOBBLE_POSITION, position);
  let mirrorBase = ROW_BYTES; // b638
  for (let row = 0; row < SCREEN_ROWS; row++) {
    const rowStart = row * ROW_BYTES;
    const index = m.mem[overlay + position + WOBBLE_TABLE + row * WOBBLE_STEP] - 1;
    const di = runScaler(m.vga, m.mem, index, buffer + rowStart, rowStart) & 0xffff;
    const edgeAddress = overlay + RIGHT_EDGES + row * 2;
    const oldEdge = m.u16(edgeAddress);
    m.set16(edgeAddress, di);
    if (oldEdge > di) {
      const count = (oldEdge - di + 1) & 0xffff;
      clearSpan(m.vga, di, count);
      clearSpan(m.vga, (mirrorBase - (di + count)) & 0xffff, count);
    }
    mirrorBase += 2 * ROW_BYTES;
  }
}

/** 0d97:004d: unpack the next picture into the buffer, move it to the other palette half, upload its colours. */
function* loadNextPicture(m) {
  const listPointer = m.u16(PICTURE_LIST_POINTER);
  const picture = linear(m.u16(at(listPointer)), 0);
  const buffer = linear(m.u16(BUFFER_POINTER), 0);
  unpackRle(m, picture, buffer, PICTURE_BYTES);
  const half = m.u8(PALETTE_HALF) ^ PALETTE_HALF_TOGGLE;
  m.set8(PALETTE_HALF, half);
  m.set16(PICTURE_LIST_POINTER, listPointer + 2);
  for (let i = 0; i < PICTURE_BYTES; i++) {
    m.mem[buffer + i] = (m.mem[buffer + i] + half) & 0xff;
  }
  yield; // 0d97:0096 waits for the end of a retrace, then the start of the next
  const paletteOffset = m.u16(ZOOMPAL_OFFSET);
  setDac(m, half, PALETTE_COLOURS, linear(m.u16(ZOOMPAL_POINTER), paletteOffset));
  m.set16(ZOOMPAL_OFFSET, paletteOffset + PALETTE_BLOCK_BYTES);
}

/** 0d97:00c8: zoom in `count` pictures, one step per tick (more if ticks were missed). */
function* zoomInPictures(m, overlay, count) {
  for (let n = count; n > 0; n--) {
    yield* waitTick(m);
    yield* loadNextPicture(m);
    if (n !== FIRST_PICTURE_COUNT) {
      while (m.frameCounter < HOLD_TICKS) {
        yield;
      }
    }
    const buffer = linear(m.u16(BUFFER_POINTER), 0);
    let bx = 0;
    let rows = 2;
    let di = ZOOM_START_ROW;
    let bp = 0;
    m.set16(STEP_COUNTDOWN, ZOOM_STEPS);
    let isDone = false;
    while (!isDone) {
      yield* waitTick(m);
      drawZoomRect(m, overlay, buffer, bx, rows, di);
      bp = rows; // the overlay returns with bp = the row count it was given
      const ticks = m.frameCounter;
      for (let t = 0; t < ticks && !isDone; t++) {
        bp += 2;
        bx += 2;
        di = (di - ROW_BYTES) & 0xffff;
        const left = (m.u16(STEP_COUNTDOWN) - 1) & 0xffff;
        m.set16(STEP_COUNTDOWN, left);
        isDone = left === 0;
      }
      rows = bp;
    }
    copyBufferToScreen(m.vga, m.mem, buffer); // 0d97:0128
  }
}

function copyBufferToScreen(vga, mem, buffer) {
  for (let i = 0; i < PICTURE_BYTES; i++) {
    vga.planes[i & 3][i >> 2] = mem[buffer + i];
  }
}

/** 0d97:013c. */
export function* pictureZoomer(m) {
  m.loadResource(ZOOMPAL_NAME, ZOOMPAL_POINTER);
  m.loadResource(OVERLAY_NAME, OVERLAY_POINTER);
  m.set16(OVERLAY_FAR_SEGMENT, m.u16(OVERLAY_POINTER));
  m.allocTo(BUFFER_POINTER, BUFFER_PARAGRAPHS);
  PICTURE_NAMES.forEach((name, i) => m.loadResource(name, PICTURE_POINTERS[i]));
  for (let i = 0; i < LOAD_RETRACES; i++) {
    yield;
  }
  m.vga.setMode13();
  const overlay = linear(m.u16(OVERLAY_FAR_SEGMENT), 0);
  initRowTable(m, overlay);
  yield* zoomInPictures(m, overlay, FIRST_PICTURE_COUNT);
  m.set16(WOBBLE_TICKS, 0);
  let remaining = WOBBLE_BUDGET;
  do {
    yield* waitTick(m);
    drawWobble(m, overlay, linear(m.u16(BUFFER_POINTER), 0), m.u16(WOBBLE_TICKS));
    const ticks = m.frameCounter;
    m.set16(WOBBLE_TICKS, ticks);
    remaining = (remaining - ticks) << 16 >> 16;
  } while (remaining >= 0);
  yield* zoomInPictures(m, overlay, 1);
}
