// 0777:0829: Paralax-Bars-with-chessplane. Two 7-pixel sine bars are written into the very row the CRTC is
// displaying, one per scanline, so every bar leaves a trail below its curve; the row is cleared once per frame.
// docs/disassembly/G5_chesszoom_bars_eb3.md, "Part B".
import { setDac } from '../library.js';
import { paletteBufferAt } from './chessZoomerSetup.js';
import { zoomUpdate } from './chessZoomer.js';
import { BEAM_COSTS, BeamClock, musicTickCost } from './chessBeam.js';
import {
  DATA, GRAPHICS_INDEX, SEQUENCER_INDEX, V, getByte, getWord, latchPanningBeforeDisplay, setByte, setColourSelect, setPel, setWord,
} from './chessZoomerShared.js';

const LINE_PAIRS = 200;
/** 05ee: bar x tables (words) and the bar bitmaps (3 or 6 bytes per pixel phase). */
const BAR_A_TABLE = 0x1f4;
const BAR_B_TABLE = 0x9c4;
const BAR_A_BITMAP = 0x190;
const BAR_B_BITMAP = 0x1ba;
const BAR_INDEX_WRAP = 0x500;
/** The jump table cases 0777:005c..01ec: source offset and bit masks per pixel phase x & 7. */
const CASE_SOURCE = [0x00, 0x03, 0x06, 0x0c, 0x12, 0x18, 0x1e, 0x24];
const FIRST_MASK = [0xfe, 0x7f, 0x3f, 0x1f, 0x0f, 0x07, 0x03, 0x01];
const SECOND_MASK = [0, 0, 0x80, 0xc0, 0xe0, 0xf0, 0xf8, 0xfc];
const CLEARED_BYTES = 80;
const FADE_IN = 0xff;
const FADE_STOP_IN = 0x5b80;
const FADE_STOP_OUT = 0x6138;
const COLOUR_STEP = 0x18;

/** `out 3c4, mapMask << 8 | 2`. */
function setMapMask(vga, mapMask) {
  vga.out16(SEQUENCER_INDEX, (mapMask << 8) | 0x02);
}

/** `out 3ce, mask << 8 | 8`. */
function setBitMask(vga, mask) {
  vga.out16(GRAPHICS_INDEX, (mask << 8) | 0x08);
}

/**
 * 0777:022c and its 8 cases: the bar bitmap at 05ee:`bitmap` at pixel x of the shown row (latch read, masked
 * writes plane by plane), with the case's wait for display enable. Cases 2..7 write their first byte through
 * whatever map mask is left (normally plane 0).
 */
function* drawBar(m, clock, x, bitmap) {
  const { vga, mem } = m;
  const pixel = (x + getWord(m, V.SCROLL_PIXELS)) & 0xffff;
  const di = ((pixel >> 3) + getWord(m, V.SHOWN_ROW)) & 0xffff;
  const phase = pixel & 7;
  const source = DATA + bitmap + CASE_SOURCE[phase];
  clock.mark();
  vga.read(di);
  setBitMask(vga, FIRST_MASK[phase]);
  if (phase < 2) {
    setMapMask(vga, 2);
    vga.write(di, mem[source]);
    setMapMask(vga, 4);
    vga.write(di, mem[source + 1]);
    setMapMask(vga, 1);
    vga.write(di, mem[source + 2]);
    yield* clock.spend(BEAM_COSTS.barDraw);
    yield* clock.waitDisplay();
    return;
  }
  vga.write(di, mem[source]);
  setMapMask(vga, 2);
  vga.write(di, mem[source + 1]);
  setMapMask(vga, 4);
  vga.write(di, mem[source + 2]);
  yield* clock.spend(BEAM_COSTS.barDraw);
  yield* clock.waitDisplay();
  clock.mark();
  const next = (di + 1) & 0xffff;
  vga.read(next);
  setBitMask(vga, SECOND_MASK[phase]);
  vga.write(next, mem[source + 3]);
  setMapMask(vga, 2);
  vga.write(next, mem[source + 4]);
  setMapMask(vga, 1);
  vga.write(next, mem[source + 5]);
  yield* clock.spend(BEAM_COSTS.barDraw);
}

/** 0777:0296 / 02bd after their wait: the next x of the bar's table, then the bar. */
function* barLine(m, clock, tableVariable, table, step, bitmap) {
  const index = getWord(m, tableVariable);
  const x = m.u16(DATA + ((table + index) & 0xffff));
  setWord(m, tableVariable, index + step);
  yield* drawBar(m, clock, x, bitmap);
}

/** 0777:07b1: bar colours (DAC 0..7 and 88h..8fh) and one fade step; the upload costs time with the screen off. */
function* barPalette(m, clock) {
  const direction = getByte(m, V.BAR_FADE);
  if (direction === 0) {
    return;
  }
  const vga = m.vga;
  clock.mark();
  vga.out8(SEQUENCER_INDEX, 1);
  vga.out8(SEQUENCER_INDEX + 1, vga.sequencer[1] | 0x20);
  yield* clock.spend(BEAM_COSTS.fade);
  clock.mark();
  const at = paletteBufferAt(m, getWord(m, V.PALETTE));
  setDac(m, 0, 8, at);
  setDac(m, 0x88, 8, at);
  vga.out8(SEQUENCER_INDEX, 1);
  vga.out8(SEQUENCER_INDEX + 1, vga.sequencer[1] & 0xdf);
  if (direction === FADE_IN) {
    const value = (getWord(m, V.PALETTE) - COLOUR_STEP) & 0xffff;
    setWord(m, V.PALETTE, value);
    if (value === FADE_STOP_IN) {
      setByte(m, V.BAR_FADE, 0);
    }
    return;
  }
  const value = (getWord(m, V.PALETTE) + COLOUR_STEP) & 0xffff;
  setWord(m, V.PALETTE, value);
  if (value === FADE_STOP_OUT) {
    setByte(m, V.BAR_FADE, 0);
  }
}

/** 0777:0269: the bar phases of the next frame. */
function advanceBars(m) {
  let a = getWord(m, V.BAR_A_INDEX) + 12;
  if (a >= BAR_INDEX_WRAP) {
    a -= BAR_INDEX_WRAP;
  }
  setWord(m, V.BAR_A_INDEX, a);
  let b = getWord(m, V.BAR_B_INDEX) + 18;
  if (b >= BAR_INDEX_WRAP) {
    b -= BAR_INDEX_WRAP;
  }
  setWord(m, V.BAR_B_INDEX, b);
}

/** 0777:0249: planes 0-2 of the 80 bytes at the shown row = 0. */
function clearRow(m) {
  const vga = m.vga;
  setBitMask(vga, 0xff);
  setMapMask(vga, 7);
  const row = getWord(m, V.SHOWN_ROW);
  for (let i = 0; i < CLEARED_BYTES; i++) {
    vga.write((row + i) & 0xffff, 0);
  }
  setMapMask(vga, 1);
}

/** The bars' beam clock of each machine: it runs on from the first call (fade in) to the second (fade out). */
const CLOCKS = new WeakMap();

/** Where the bars' beam clock starts: the zoomer's loop ended at the horizontal blank of line 399. */
const ZOOMER_LOOP_END = 399.9;

/** 0777:0829: `frames` passes of the bars loop (on the beam clock, not one per frame). */
export function* runBars(m, frames) {
  const vga = m.vga;
  if (!CLOCKS.has(m)) {
    CLOCKS.set(m, new BeamClock(vga, ZOOMER_LOOP_END));
  }
  const clock = CLOCKS.get(m);
  for (let frame = 0; frame < frames; frame++) {
    clock.mark();
    setPel(m);
    if (clock.time < 0) {
      latchPanningBeforeDisplay(vga);
    }
    const cost = musicTickCost(m);
    m.tickMusic();
    yield* clock.spend(cost);
    yield* barPalette(m, clock);
    let parity = getWord(m, V.FIRST_PARITY);
    let count = getWord(m, V.FIRST_COUNT);
    const savedA = getWord(m, V.BAR_A_INDEX);
    const savedB = getWord(m, V.BAR_B_INDEX);
    for (let pair = 0; pair < LINE_PAIRS; pair++) {
      yield* clock.waitBlank(); // 0296
      clock.mark();
      setColourSelect(vga, parity);
      yield* barLine(m, clock, V.BAR_A_INDEX, BAR_A_TABLE, 2, BAR_A_BITMAP);
      yield* clock.waitBlank(); // 02bd
      yield* barLine(m, clock, V.BAR_B_INDEX, BAR_B_TABLE, 6, BAR_B_BITMAP);
      count = (count - 1) << 16 >> 16;
      if (count <= 0) {
        count = getWord(m, V.PERIOD);
        parity ^= 8;
      }
    }
    setWord(m, V.BAR_A_INDEX, savedA);
    setWord(m, V.BAR_B_INDEX, savedB);
    advanceBars(m);
    clock.mark();
    zoomUpdate(m);
    clearRow(m);
    yield* clock.spend(BEAM_COSTS.loopEnd);
  }
}
