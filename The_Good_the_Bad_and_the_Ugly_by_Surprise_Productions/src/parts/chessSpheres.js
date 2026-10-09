// 0777:1258 and 0777:1113: Zooming-16x16-pictures. The shown row is a row of the p3_zoom picture (pixel = x in a
// 16x16 sphere at some horizontal zoom); Color Select per scanline from p3_outf is the sphere's y; the sphere bitmap
// is the 256-colour palette. Then the palette is swept to orange/teal and the 'chess' picture is shown.
// docs/disassembly/G5_chesszoom_bars_eb3.md, "Part C".
import { setDac, setEgaPlanar } from '../library.js';
import { linear } from '../machine.js';
import {
  CODE, GRAPHICS_INDEX, SEQUENCER_INDEX, V, getByte, getWord, inBlock, latchPanningBeforeDisplay, passScanline, pollStatus, setByte, setColourSelect, setPel,
  setStart, setWord, waitHblank,
} from './chessZoomerShared.js';

const SPHERE_FRAMES = 1000;
const END_FRAMES = 0xf0;
const SCANLINES = 400;
const PICTURE_AT = 0x3e80;
const CHESS_PICTURE_AT = 0x5dc0;
const PICTURE_PLANE_BYTES = 0x1f40;
const ZOOM_TOP_ROW = 0x1ef0;
const LAST_SWEEP_ENTRY = 0xf0;
const SPHERE_PALETTE = 0x0b3f;
const CHESS_COLOURS = 0x0e3f;
const STOP_SEQUENCE_INDEX = 0xb4;
const SCROLL_TABLE_START = 0x31f;
const SCROLL_TABLE_END = 0x513;
const FROZEN_X_INDEX = 0x32b;
const FROZEN_Y_INDEX = 0x329;
/** 08d8:2d91: the 16 colours of the 'chess' picture. */
const CHESS_PICTURE_PALETTE = linear(0x08d8, 0x2d91);

/** Two more DAC entries of the sweep from cs:`table` (0777:126f / 112a). */
function sweepPalette(m, table) {
  const entry = getWord(m, V.SWEEP_DAC);
  if (entry > LAST_SWEEP_ENTRY) {
    return;
  }
  setDac(m, entry, 2, CODE + table + getWord(m, V.SWEEP_SOURCE));
  setWord(m, V.SWEEP_SOURCE, getWord(m, V.SWEEP_SOURCE) + 6);
  setWord(m, V.SWEEP_DAC, entry + 2);
}

/** 0777:0a39: zoom step after the pause; bounces between rows 0 and 198. */
function zoomStep(m) {
  const pause = getWord(m, V.PAUSE);
  if (pause !== 0) {
    setWord(m, V.PAUSE, pause - 1);
    return;
  }
  setWord(m, V.PICTURE_ROW, getWord(m, V.PICTURE_ROW) + getWord(m, V.PICTURE_ROW_STEP));
  setWord(m, V.FIRST_COUNT, getWord(m, V.FIRST_COUNT) + getWord(m, V.SEQUENCE_PERIOD_STEP));
  setWord(m, V.SEQUENCE_INDEX, getWord(m, V.SEQUENCE_INDEX) + getWord(m, V.SEQUENCE_INDEX_STEP));
  const row = getWord(m, V.PICTURE_ROW);
  if (row === ZOOM_TOP_ROW || row === 0) {
    if (row === 0) {
      setWord(m, V.PAUSE, 1);
    }
    setWord(m, V.PICTURE_ROW_STEP, -getWord(m, V.PICTURE_ROW_STEP));
    setWord(m, V.SEQUENCE_INDEX_STEP, -getWord(m, V.SEQUENCE_INDEX_STEP));
    setWord(m, V.SEQUENCE_PERIOD_STEP, -getWord(m, V.SEQUENCE_PERIOD_STEP));
  }
}

/** Advances a p3_sin scroll index unless it is frozen at `frozenAt` (0777:0a93). */
function advanceScroll(m, variable, frozenAt) {
  const index = getWord(m, variable);
  if (index === frozenAt && getByte(m, V.IS_SCROLL_FROZEN) === 1) {
    return;
  }
  setWord(m, variable, index + 2 >= SCROLL_TABLE_END ? SCROLL_TABLE_START : index + 2);
}

/**
 * 0777:0a93: horizontal scroll (cs:46h/48h) and the start of the Color Select sequence for this frame.
 * Returns { position, count }: the next sequence byte (linear) and the lines left before it restarts.
 */
function scrollSpheres(m) {
  const scrollX = m.u16(inBlock(m, V.P3_SIN, getWord(m, V.SCROLL_X_INDEX)));
  advanceScroll(m, V.SCROLL_X_INDEX, FROZEN_X_INDEX);
  setWord(m, V.SCROLL_BYTES, scrollX >> 3);
  setByte(m, V.PEL, scrollX & 7);
  const scrollY = m.u16(inBlock(m, V.P3_SIN, getWord(m, V.SCROLL_Y_INDEX)));
  advanceScroll(m, V.SCROLL_Y_INDEX, FROZEN_Y_INDEX);
  const period = getWord(m, V.FIRST_COUNT);
  const remainder = ((scrollY << 1) & 0xffff) % period;
  const start = m.u16(inBlock(m, V.P3_OUTF, getWord(m, V.SEQUENCE_INDEX)));
  setWord(m, V.SEQUENCE_START, start);
  if (remainder === 0) {
    return { position: start, count: period };
  }
  return { position: (start + period - remainder) & 0xffff, count: remainder };
}

/** One frame of spheres: start address, wait for the retrace, pel panning, 400 Color Select lines. */
function* spheresFrame(m) {
  const vga = m.vga;
  const sequence = scrollSpheres(m);
  setStart(vga, getWord(m, V.PICTURE_ROW) + getWord(m, V.SCROLL_BYTES) + PICTURE_AT);
  yield; // 3da bit 3 edge
  setPel(m);
  latchPanningBeforeDisplay(vga);
  let { position, count } = sequence;
  for (let line = 0; line < SCANLINES; line++) {
    const value = m.mem[inBlock(m, V.P3_OUTF, position)];
    position = (position + 1) & 0xffff;
    // Waits for 3da bit 0 = 1: already set in the vertical retrace for the first line.
    if (line > 0) {
      waitHblank(vga);
    } else {
      pollStatus(vga);
    }
    setColourSelect(vga, value);
    pollStatus(vga); // wait for display enable
    count--;
    if (count === 0) {
      position = getWord(m, V.SEQUENCE_START);
      count = getWord(m, V.FIRST_COUNT);
    }
  }
}

/** 0777:1113: 240 frames: palette sweep to the chess colours, zoom to sequence 90 and frozen scroll; the picture. */
function* spheresEnd(m) {
  const vga = m.vga;
  setWord(m, V.SWEEP_DAC, 0);
  setWord(m, V.SWEEP_SOURCE, 0);
  for (let frame = 0; frame < END_FRAMES; frame++) {
    m.tickMusic();
    sweepPalette(m, CHESS_COLOURS);
    if (getWord(m, V.SEQUENCE_INDEX) !== STOP_SEQUENCE_INDEX) {
      zoomStep(m);
    }
    setByte(m, V.IS_SCROLL_FROZEN, 1);
    yield* spheresFrame(m);
  }
  setStart(vga, CHESS_PICTURE_AT);
  setDac(m, 0, 0x10, CHESS_PICTURE_PALETTE);
  setEgaPlanar(vga);
  setStart(vga, CHESS_PICTURE_AT);
  m.tickMusic();
  pollStatus(vga);
  setColourSelect(vga, 0);
  // 0731:013c waits for the retrace start; the IRQ of that retrace already runs the new handler (a tick).
  m.setTimer('retrace');
  yield;
  vga.out16(GRAPHICS_INDEX, 0x0105);
  vga.out16(SEQUENCER_INDEX, 0x0f02);
  for (const target of [0, PICTURE_AT]) {
    for (let i = 0; i < PICTURE_PLANE_BYTES; i++) {
      vga.read(CHESS_PICTURE_AT + i);
      vga.write(target + i, 0);
    }
  }
  vga.out16(GRAPHICS_INDEX, 0x0005);
}

/** 0777:1258: 1000 frames of spheres (palette sweep in, pause, zoom bouncing), then 0777:1113. */
export function* runSpheres(m) {
  setWord(m, V.FIRST_COUNT, 0x20);
  setWord(m, V.PAUSE, 250);
  for (let frame = 0; frame < SPHERE_FRAMES; frame++) {
    m.tickMusic();
    sweepPalette(m, SPHERE_PALETTE);
    zoomStep(m);
    yield* spheresFrame(m);
  }
  yield* spheresEnd(m);
}
