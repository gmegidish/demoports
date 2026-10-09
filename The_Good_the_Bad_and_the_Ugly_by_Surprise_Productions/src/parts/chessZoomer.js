// 0777:0995: Chess-Paralax-zoomer, Paralax-Bars-with-chessplane and Zooming-16x16-pictures (Erik), one far call.
// 320x400 16 colours planar with CRTC offset 0: every scanline shows the same row, recoloured per line by the
// Color Select register. docs/disassembly/G5_chesszoom_bars_eb3.md, "Module 0777".
import { clearDoubleScan, setDac, setP54S, unlockCrtc } from '../library.js';
import { runBars } from './chessBars.js';
import { isMusicTickSlow } from './chessBeam.js';
import { runSpheres } from './chessSpheres.js';
import { buildPaletteBuffer, initVideo, paletteBufferAt, setGreyPalette } from './chessZoomerSetup.js';
import {
  V, getByte, getWord, inBlock, passScanline, setByte, setColourSelect, setPel, setRowOffset, setScreenOff, setStart, setWord,
  waitHblank,
} from './chessZoomerShared.js';

const LINE_PAIRS = 200;
const BALL_FIELD_FRAMES = 250;
const GROWTH_FRAMES = 199;
const STATIC_CHESS_FRAMES = 0x32;
const BARS_FADE_IN_FRAMES = 0x320;
const BARS_FADE_OUT_FRAMES = 0x122;
/** p3_sin: the byte wobble tables wrap at 600, the word scroll table spans 0x31f..0x512. */
const WOBBLE_WRAP = 600;
const SCROLL_TABLE_START = 0x31f;
const SCROLL_TABLE_END = 0x513;
const FADE_IN_LAST = 0x62d4;
const PALETTE_BLOCK = 0x180;
const ROW_ONE = 0x28;
const CHESS_SQUARE = 40;
const NORMAL_ROW_OFFSET = 0x14;

/** 0777:0401 (far, also called by the wave effect 08a8): pel/palette wobble, p3_sin byte & 7. */
export function wobbleColumns(m) {
  const index = getWord(m, V.WOBBLE_INDEX);
  const value = m.mem[inBlock(m, V.P3_SIN, index)];
  setWord(m, V.WOBBLE_INDEX, index + 3 >= WOBBLE_WRAP ? 0 : index + 3);
  return value & 7;
}

/** 0777:03d9 (far, also called by 08a8): vertical wobble, p3_sin byte & 7. */
export function wobbleRows(m) {
  const index = getWord(m, V.ROW_WOBBLE_INDEX);
  const value = m.mem[inBlock(m, V.P3_SIN, index)];
  setWord(m, V.ROW_WOBBLE_INDEX, index + 2 >= WOBBLE_WRAP ? 0 : index + 2);
  return value & 7;
}

/** 0777:043c: the ball palette, rotated by (columns - pel) & 7, into the 15 DAC blocks; fade-in step. */
function uploadBallPalette(m, columns) {
  const vga = m.vga;
  setScreenOff(vga, true);
  passScanline(vga);
  const rotation = (columns - getByte(m, V.PEL)) & 7;
  let si = (getWord(m, V.PALETTE) + 3 * rotation + getWord(m, V.FADE_IN)) & 0xffff;
  setPel(m);
  let di = 0;
  for (let row = 0; row < 8; row++) {
    setDac(m, di, 8, paletteBufferAt(m, si));
    si = (si + 0x30) & 0xffff;
    di += 0x10;
  }
  di += 8;
  si = (si - 0x180) & 0xffff;
  for (let row = 0; row < 7; row++) {
    setDac(m, di, 8, paletteBufferAt(m, si));
    si = (si + 0x30) & 0xffff;
    di += 0x10;
  }
  setDac(m, di, 7, paletteBufferAt(m, si));
  setScreenOff(vga, false);
  const fadeIn = getWord(m, V.FADE_IN);
  if (fadeIn > FADE_IN_LAST) {
    const next = fadeIn - PALETTE_BLOCK;
    setWord(m, V.FADE_IN, next <= FADE_IN_LAST ? 0 : next);
  }
}

/** 0777:04da: palette for this frame; returns the ball row of the first line pair. */
function framePalette(m) {
  uploadBallPalette(m, wobbleColumns(m));
  return wobbleRows(m);
}

/** 0777:04ea: `pairs` line pairs of balls only (Color Select = ball row). */
function ballLines(vga, pairs, firstRow) {
  let row = firstRow;
  for (let i = 0; i < pairs; i++) {
    waitHblank(vga);
    setColourSelect(vga, row);
    waitHblank(vga);
    row = (row + 1) & 7;
  }
  return row;
}

/** 0777:0601: 250 frames of the green-ball field (row 1: no chess), fading in from white. */
function* ballField(m) {
  const vga = m.vga;
  setStart(vga, ROW_ONE);
  for (let frame = 0; frame < BALL_FIELD_FRAMES; frame++) {
    const firstRow = framePalette(m);
    m.tickMusic();
    // The first frame follows 0995's retrace wait directly (still in that vertical blank); later frames cross the
    // retrace between the previous frame's lines and these.
    if (frame > 0) {
      yield;
    }
    ballLines(vga, LINE_PAIRS, firstRow);
  }
  setStart(vga, 0);
}

/** 0777:053b: 199 frames, the chessboard (row 0) grows down over the balls (row 1). */
function* chessGrowth(m) {
  const vga = m.vga;
  for (let frame = 0; frame < GROWTH_FRAMES; frame++) {
    if (isMusicTickSlow(m)) {
      passScanline(vga); // line 399 is drawn before the palette upload blanks the screen
    }
    m.tickMusic();
    uploadBallPalette(m, wobbleColumns(m));
    const growthIndex = getWord(m, V.GROWTH_INDEX);
    setWord(m, V.GROWTH_INDEX, growthIndex + 1);
    const height = m.mem[inBlock(m, V.P3_SIN, growthIndex)];
    let parity = ((height / CHESS_SQUARE) | 0) & 1 ? 0 : 8;
    let count = height % CHESS_SQUARE;
    setWord(m, V.PERIOD, CHESS_SQUARE);
    let row = wobbleRows(m);
    yield;
    for (let left = height; left > 0; left--) {
      waitHblank(vga);
      setColourSelect(vga, row + parity);
      count--;
      if (left === 1) {
        setRowOffset(vga, NORMAL_ROW_OFFSET);
        waitHblank(vga);
        setColourSelect(vga, row);
        setRowOffset(vga, 0);
      } else {
        waitHblank(vga);
      }
      if (count <= 0) {
        count = getWord(m, V.PERIOD);
        parity ^= 8;
      }
      row = (row + 1) & 7;
    }
    if (LINE_PAIRS - height > 0) {
      ballLines(vga, LINE_PAIRS - height, row);
    }
  }
  setStart(vga, getWord(m, V.ROW_BASE));
  setRowOffset(vga, 0);
}

/** 0777:04fc: `frames` frames of the full board at row 40 (40-pixel squares). */
function* staticChess(m, frames) {
  const vga = m.vga;
  for (let frame = 0; frame < frames; frame++) {
    let row = framePalette(m);
    m.tickMusic();
    let parity = 8;
    let count = getWord(m, V.FIRST_COUNT);
    setWord(m, V.PERIOD, count);
    yield;
    for (let pair = 0; pair < LINE_PAIRS; pair++) {
      waitHblank(vga);
      setColourSelect(vga, row + parity);
      count = (count - 1) << 16 >> 16;
      waitHblank(vga);
      if (count <= 0) {
        count = getWord(m, V.PERIOD);
        parity ^= 8;
      }
      row = (row + 1) & 7;
    }
  }
}

/** 0777:0639: one step of the fade to black, then the done flag. */
function fadeStep(m) {
  const left = getByte(m, V.FADE_OUT_STEPS);
  if (left === 0) {
    setByte(m, V.IS_DONE, 1);
    return;
  }
  setWord(m, V.PALETTE, getWord(m, V.PALETTE) + PALETTE_BLOCK);
  setByte(m, V.FADE_OUT_STEPS, left - 1);
}

/** Reads the p3_sin scroll word at cs:[indexVariable] and advances the index (wrap 513h -> 31fh). */
function nextScrollWord(m, indexVariable) {
  const index = getWord(m, indexVariable);
  const value = m.u16(inBlock(m, V.P3_SIN, index));
  setWord(m, indexVariable, index + 2 >= SCROLL_TABLE_END ? SCROLL_TABLE_START : index + 2);
  return value;
}

/** 0777:06f6: shows the row (start address, next frame) and moves/zooms it after the pause. */
function moveRows(m) {
  const rowBase = getWord(m, V.ROW_BASE);
  setWord(m, V.SHOWN_ROW, rowBase);
  setStart(m.vga, rowBase + getWord(m, V.SCROLL_BYTES));
  const pause = getWord(m, V.PAUSE);
  if (pause !== 0) {
    setWord(m, V.PAUSE, pause - 1);
    return;
  }
  const limit = getWord(m, V.ROW_LIMIT);
  setWord(m, V.ROW_BASE, rowBase + getWord(m, V.ROW_STEP));
  setWord(m, V.PERIOD, getWord(m, V.PERIOD) + getWord(m, V.PERIOD_STEP));
  setWord(m, V.FIRST_COUNT, getWord(m, V.PERIOD));
  if (getWord(m, V.PERIOD) <= 2 || getWord(m, V.ROW_BASE) >= limit) {
    setWord(m, V.ROW_STEP, -getWord(m, V.ROW_STEP));
    setWord(m, V.PERIOD_STEP, -getWord(m, V.PERIOD_STEP));
    if (getWord(m, V.ROW_BASE) >= limit) {
      setWord(m, V.ZOOM_PHASE, getWord(m, V.ZOOM_PHASE) + 1);
      setWord(m, V.PAUSE, 250);
    }
  }
}

/** 0777:0659: scroll, zoom and the chess phase of the next frame (in the vertical blank). */
export function zoomUpdate(m) {
  if (getWord(m, V.ZOOM_PHASE) === 3) {
    fadeStep(m);
  }
  const scrollX = nextScrollWord(m, V.SCROLL_X_INDEX);
  setWord(m, V.SCROLL_PIXELS, scrollX);
  setWord(m, V.SCROLL_BYTES, scrollX >> 3);
  setByte(m, V.PEL, scrollX & 7);
  moveRows(m);
  const period = getWord(m, V.PERIOD);
  setWord(m, V.FIRST_COUNT, period);
  if (period >= 0xc8) {
    setWord(m, V.FIRST_PARITY, 0);
    return;
  }
  const scrollY = nextScrollWord(m, V.SCROLL_Y_INDEX);
  setWord(m, V.UNUSED_VERTICAL, scrollY);
  const divisor = period & 0xff;
  const quotient = (scrollY / divisor) | 0;
  setWord(m, V.FIRST_PARITY, quotient & 1 ? 8 : 0);
  setWord(m, V.FIRST_COUNT, scrollY % divisor);
}

/** 0777:076d: the zoomer, one frame per pass, until the done flag. */
function* zoomer(m) {
  const vga = m.vga;
  do {
    let row = framePalette(m);
    m.tickMusic();
    let parity = getWord(m, V.FIRST_PARITY);
    let count = getWord(m, V.FIRST_COUNT);
    // Written before the first wait: the attribute flip-flop is in the data state (042b), so this first write
    // only blanks the screen until the next one (as in the recording: lines 399 and 0 are black).
    setColourSelect(vga, row + parity);
    yield;
    for (let pair = 0; pair < LINE_PAIRS; pair++) {
      if (pair > 0) {
        setColourSelect(vga, row + parity);
      }
      waitHblank(vga);
      count = (count - 1) << 16 >> 16;
      waitHblank(vga);
      if (count <= 0) {
        count = getWord(m, V.PERIOD);
        parity ^= 8;
      }
      row = (row + 1) & 7;
    }
    zoomUpdate(m);
  } while (getByte(m, V.IS_DONE) !== 1);
}

/** 0777:0995. */
export function* chessZoomer(m) {
  const vga = m.vga;
  // 0731:0120 waits for the retrace start; the IRQ of that retrace already runs the new handler.
  m.setTimer('music');
  yield;
  initVideo(m);
  buildPaletteBuffer(m);
  // 0731:0158 waits for the retrace start; the IRQ of that retrace goes to the BIOS handler (no tick).
  m.setTimer('bios');
  yield;
  setRowOffset(vga, 0);
  yield; // 3da bit 3 edge
  m.tickMusic();
  setP54S(vga);
  unlockCrtc(vga);
  clearDoubleScan(vga);
  yield;
  m.tickMusic();
  yield* ballField(m);
  passScanline(vga); // the DAC writes of 094c outlast the last line of the ball field
  setGreyPalette(vga);
  yield* chessGrowth(m);
  setWord(m, V.SCROLL_BYTES, 0x14);
  setByte(m, V.PEL, 0);
  yield* staticChess(m, STATIC_CHESS_FRAMES);
  yield* zoomer(m);
  yield* zoomer(m);
  setByte(m, V.BAR_FADE, 0xff);
  setWord(m, V.PALETTE, 0x6120);
  yield* runBars(m, BARS_FADE_IN_FRAMES);
  setWord(m, V.PALETTE, 0x5b80);
  setByte(m, V.BAR_FADE, 1);
  yield* runBars(m, BARS_FADE_OUT_FRAMES);
  yield* runSpheres(m);
}

