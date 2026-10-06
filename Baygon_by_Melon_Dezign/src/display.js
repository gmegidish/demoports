// Denise and the copper: turns chip RAM into a picture, once per shown frame.
// The copper list is read from memory and run line by line. Bitplanes are fetched the way the AGA chipset
// does it (DDFSTRT/DDFSTOP/FMODE decide how many bytes a line takes), and looked up in the 24-bit palette.

import { LINES_PER_FRAME } from './machine.js';

/**
 * The part of the PAL frame put on the canvas, in lores pixels: the standard 320x256 window.
 * Several parts open their display window wider (352 or 384 pixels, up to 290 lines), but what they draw at
 * those edges is not meant to be seen: a monitor's bezel hides it, and captures of the real thing crop it.
 */
export const VIEW_X = 0x81;
export const VIEW_Y = 0x2c;
export const VIEW_WIDTH = 320;
export const VIEW_HEIGHT = 256;

const MAX_COPPER_MOVES_PER_LINE = 2000;
const LINE_END_HPOS = 0xe2;
/** A copper WAIT for a horizontal position up to here counts as "this line"; later ones as the next. */
const LINE_SPLIT_HPOS = 0x80;

export function createChip() {
  return {
    bplpt: new Uint32Array(8),
    bplcon0: 0, bplcon1: 0, bplcon2: 0, bplcon3: 0, bplcon4: 0,
    bpl1mod: 0, bpl2mod: 0,
    diwstrt: 0x2c81, diwstop: 0x2cc1, diwhigh: null,
    ddfstrt: 0x38, ddfstop: 0xd0, fmode: 0,
    /** AGA palette: high and low nibbles of each component, as two 12-bit words per colour. */
    colourHigh: new Uint16Array(256),
    colourLow: new Uint16Array(256),
    /** The same palette as ready-to-store canvas pixels (little-endian ABGR). */
    rgb: new Uint32Array(256).fill(0xff000000),
  };
}

function updateColour(chip, index) {
  const high = chip.colourHigh[index];
  const low = chip.colourLow[index];
  const r = ((high >> 4) & 0xf0) | ((low >> 8) & 0xf);
  const g = (high & 0xf0) | ((low >> 4) & 0xf);
  const b = ((high << 4) & 0xf0) | (low & 0xf);
  chip.rgb[index] = 0xff000000 | (b << 16) | (g << 8) | r;
}

/** Write a custom-chip register ($dff000 + reg). Used by the copper and by ported CPU code alike. */
export function custom(m, reg, value) {
  const chip = m.chip;
  if (reg >= 0x180 && reg < 0x1c0) {
    const index = (chip.bplcon3 >> 13) * 32 + ((reg - 0x180) >> 1);
    if (chip.bplcon3 & 0x200) {
      chip.colourLow[index] = value & 0xfff;
    } else {
      chip.colourHigh[index] = value & 0xfff;
      chip.colourLow[index] = value & 0xfff;
    }
    updateColour(chip, index);
    return;
  }
  if (reg >= 0xe0 && reg < 0x100) {
    const plane = (reg - 0xe0) >> 2;
    if (reg & 2) {
      chip.bplpt[plane] = (chip.bplpt[plane] & 0xffff0000) | (value & 0xfffe);
    } else {
      chip.bplpt[plane] = ((value & 0x1f) << 16) | (chip.bplpt[plane] & 0xffff);
    }
    return;
  }
  switch (reg) {
    case 0x80: m.cop1lc = ((value & 0x1f) << 16) | (m.cop1lc & 0xffff); break;
    case 0x82: m.cop1lc = (m.cop1lc & 0xffff0000) | (value & 0xfffe); break;
    case 0x84: m.cop2lc = ((value & 0x1f) << 16) | (m.cop2lc & 0xffff); break;
    case 0x86: m.cop2lc = (m.cop2lc & 0xffff0000) | (value & 0xfffe); break;
    case 0x8e: chip.diwstrt = value; chip.diwhigh = null; break;
    case 0x90: chip.diwstop = value; chip.diwhigh = null; break;
    case 0x92: chip.ddfstrt = value & 0xfe; break;
    case 0x94: chip.ddfstop = value & 0xfe; break;
    case 0x100: chip.bplcon0 = value; break;
    case 0x102: chip.bplcon1 = value; break;
    case 0x104: chip.bplcon2 = value; break;
    case 0x106: chip.bplcon3 = value; break;
    case 0x108: chip.bpl1mod = (value << 16) >> 16; break;
    case 0x10a: chip.bpl2mod = (value << 16) >> 16; break;
    case 0x10c: chip.bplcon4 = value; break;
    case 0x1e4: chip.diwhigh = value; break;
    case 0x1fc: chip.fmode = value; break;
    default: break;
  }
}

const HARD_DDF_START = 0x18;
const HARD_DDF_STOP = 0xd8;

/**
 * Where a line's bitplane fetch starts and stops. A DDFSTOP beyond the hard stop never matches, so the
 * fetch window is never closed: every line then fetches from the hard start to the hard stop.
 * (The very first line after such a DDFSTOP is written would still start at DDFSTRT; not modelled.)
 */
function dataFetchWindow(chip) {
  if (chip.ddfstop > HARD_DDF_STOP) {
    return { start: HARD_DDF_START, stop: HARD_DDF_STOP };
  }
  return { start: chip.ddfstrt, stop: chip.ddfstop };
}

/**
 * BPLCON1 scroll of one playfield in lores pixels. AGA adds two high bits (PFxH6-7, bits 10-11 / 14-15);
 * how many bits count depends on the fetch width: 16, 32 or 64 pixels.
 */
function scrollDelay(chip, isEvenPlane) {
  const value = isEvenPlane ? chip.bplcon1 >> 4 : chip.bplcon1;
  const fetchMode = chip.fmode & 3;
  const mask = fetchMode === 3 ? 0x3f : fetchMode === 0 ? 0x0f : 0x1f;
  return ((value & 0xf) | ((value >> 6) & 0x30)) & mask;
}

/** Bytes of bitplane data one line fetches per plane. FMODE widens the fetch unit from 16 to 32 or 64 bits. */
function fetchBytesPerLine(chip) {
  const fetchMode = chip.fmode & 3;
  const unitShift = (fetchMode === 3 ? 5 : fetchMode === 0 ? 3 : 4) - (chip.bplcon0 & 0x8000 ? 1 : 0);
  const unitClocks = 1 << unitShift;
  const fetch = dataFetchWindow(chip);
  const units = Math.ceil((fetch.stop - fetch.start) / unitClocks) + 1;
  return units * (fetchMode === 3 ? 8 : fetchMode === 0 ? 2 : 4);
}

function isWaitOver(line, hpos, first, second) {
  const mask = (second | 0x8000) & 0xfffe;
  return ((((line & 0xff) << 8) | hpos) & mask) >= (first & mask);
}

/** Run the copper up to the WAIT that holds it on this line. */
function runCopper(m, state, line) {
  const view = m.view;
  for (let moves = 0; moves < MAX_COPPER_MOVES_PER_LINE; moves++) {
    const first = view.getUint16(state.pc);
    const second = view.getUint16(state.pc + 2);
    if (first & 1) {
      const isSkip = (second & 1) !== 0;
      const hasPassedOnPreviousLine = line > 0 && isWaitOver(line - 1, LINE_END_HPOS, first, second);
      if (!isSkip && !hasPassedOnPreviousLine && !isWaitOver(line, LINE_SPLIT_HPOS, first, second)) {
        return;
      }
      state.pc += 4;
      continue;
    }
    const reg = first & 0x1fe;
    state.pc += 4;
    if (reg === 0x88) {
      state.pc = m.cop1lc;
    } else if (reg === 0x8a) {
      state.pc = m.cop2lc;
    } else {
      custom(m, reg, second);
    }
  }
}

function displayWindow(chip) {
  const high = chip.diwhigh;
  return {
    top: (chip.diwstrt >> 8) | (high === null ? 0 : (high & 7) << 8),
    bottom: (chip.diwstop >> 8) | (high === null ? (~chip.diwstop >> 7) & 0x100 : ((high >> 8) & 7) << 8),
    left: (chip.diwstrt & 0xff) | (high === null ? 0 : ((high >> 5) & 1) << 8),
    right: (chip.diwstop & 0xff) | (high === null ? 0x100 : ((high >> 13) & 1) << 8),
  };
}

function drawLine(m, line, pixels) {
  const chip = m.chip;
  const mem = m.mem;
  const row = (line - VIEW_Y) * VIEW_WIDTH;
  const isVisible = line >= VIEW_Y && line < VIEW_Y + VIEW_HEIGHT;
  const window = displayWindow(chip);
  const planes = ((chip.bplcon0 >> 12) & 7) | (chip.bplcon0 & 0x10 ? 8 : 0);
  const border = chip.rgb[0];
  if (line < window.top || line >= window.bottom || planes === 0) {
    if (isVisible) {
      pixels.fill(border, row, row + VIEW_WIDTH);
    }
    return;
  }
  const bytes = fetchBytesPerLine(chip);
  if (isVisible) {
    const isHires = (chip.bplcon0 & 0x8000) !== 0;
    const firstPixel = dataFetchWindow(chip).start * 2 + 17;
    const delayOdd = scrollDelay(chip, false);
    const delayEven = scrollDelay(chip, true);
    const xor = chip.bplcon4 >> 8;
    const bits = bytes * 8;
    for (let x = 0; x < VIEW_WIDTH; x++) {
      const hpos = VIEW_X + x;
      if (hpos < window.left || hpos >= window.right) {
        pixels[row + x] = border;
        continue;
      }
      let index = 0;
      for (let plane = 0; plane < planes; plane++) {
        let bit = hpos - firstPixel - (plane & 1 ? delayEven : delayOdd);
        if (isHires) {
          // ponytail: hires shown at half width (every other pixel); widen the canvas if a part needs the detail
          bit *= 2;
        }
        if (bit >= 0 && bit < bits && (mem[(chip.bplpt[plane] + (bit >> 3)) & 0x1fffff] >> (7 - (bit & 7))) & 1) {
          index |= 1 << plane;
        }
      }
      pixels[row + x] = chip.rgb[index ^ xor];
    }
  }
  for (let plane = 0; plane < planes; plane++) {
    chip.bplpt[plane] += bytes + (plane & 1 ? chip.bpl2mod : chip.bpl1mod);
  }
}

/** One frame: `pixels` is VIEW_WIDTH x VIEW_HEIGHT canvas pixels. */
export function renderFrame(m, pixels) {
  const copper = { pc: m.cop1lc };
  for (let line = 0; line < LINES_PER_FRAME; line++) {
    runCopper(m, copper, line);
    drawLine(m, line, pixels);
  }
}
