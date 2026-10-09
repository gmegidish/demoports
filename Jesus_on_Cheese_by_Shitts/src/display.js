// Denise and the copper: turns chip RAM into a picture, once per shown frame.
// The copper list is read from memory and run line by line; bitplanes are fetched the way the OCS
// chipset does it (DDFSTRT/DDFSTOP decide how many words a line takes) and looked up in the 12-bit palette.

import { LINES_PER_FRAME, CHIP_MASK } from './machine.js';
import { paulaWrite } from './paula.js';
import { blitterWrite } from './blitter.js';

/** The part of the PAL frame put on the canvas, in lores pixels: the standard 320x256 window. */
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
    bplpt: new Uint32Array(6),
    bplcon0: 0, bplcon1: 0, bplcon2: 0,
    bpl1mod: 0, bpl2mod: 0,
    diwstrt: 0x2c81, diwstop: 0x2cc1,
    ddfstrt: 0x38, ddfstop: 0xd0,
    dmacon: 0,
    colour: new Uint16Array(32),
    /** The same palette as ready-to-store canvas pixels (little-endian ABGR), 64 entries for extra half-brite. */
    rgb: new Uint32Array(64).fill(0xff000000),
  };
}

function toPixel(colour) {
  const r = ((colour >> 8) & 0xf) * 0x11;
  const g = ((colour >> 4) & 0xf) * 0x11;
  const b = (colour & 0xf) * 0x11;
  return 0xff000000 | (b << 16) | (g << 8) | r;
}

function setColour(chip, index, value) {
  chip.colour[index] = value & 0xfff;
  chip.rgb[index] = toPixel(value);
  // Extra half-brite: colours 32-63 are 0-31 at half brightness.
  chip.rgb[index + 32] = toPixel((value >> 1) & 0x777);
}

/** Write a custom-chip register ($dff000 + reg). Used by the copper and by ported CPU code alike. */
export function custom(m, reg, value) {
  const chip = m.chip;
  value &= 0xffff;
  if (reg >= 0x180 && reg < 0x1c0) {
    setColour(chip, (reg - 0x180) >> 1, value);
    return;
  }
  if (reg >= 0xe0 && reg < 0xf8) {
    const plane = (reg - 0xe0) >> 2;
    if (reg & 2) {
      chip.bplpt[plane] = (chip.bplpt[plane] & 0xffff0000) | (value & 0xfffe);
    } else {
      chip.bplpt[plane] = ((value & 7) << 16) | (chip.bplpt[plane] & 0xffff);
    }
    return;
  }
  if (reg >= 0x40 && reg < 0x76) {
    blitterWrite(m, reg, value);
    return;
  }
  if (reg >= 0xa0 && reg < 0xe0) {
    paulaWrite(m, reg, value);
    return;
  }
  switch (reg) {
    case 0x80: m.cop1lc = ((value & 7) << 16) | (m.cop1lc & 0xffff); break;
    case 0x82: m.cop1lc = (m.cop1lc & 0xffff0000) | (value & 0xfffe); break;
    case 0x84: m.cop2lc = ((value & 7) << 16) | (m.cop2lc & 0xffff); break;
    case 0x86: m.cop2lc = (m.cop2lc & 0xffff0000) | (value & 0xfffe); break;
    case 0x8e: chip.diwstrt = value; break;
    case 0x90: chip.diwstop = value; break;
    case 0x92: chip.ddfstrt = value & 0xfc; break;
    case 0x94: chip.ddfstop = value & 0xfc; break;
    case 0x96: {
      chip.dmacon = value & 0x8000 ? chip.dmacon | (value & 0x7fff) : chip.dmacon & ~value;
      paulaWrite(m, reg, value);
      break;
    }
    case 0x100: chip.bplcon0 = value; break;
    case 0x102: chip.bplcon1 = value; break;
    case 0x104: chip.bplcon2 = value; break;
    case 0x108: chip.bpl1mod = (value << 16) >> 16; break;
    case 0x10a: chip.bpl2mod = (value << 16) >> 16; break;
    default: break;
  }
}

/** Write a 32-bit register pair, as `move.l #x,$dff0xx` does. */
export function custom32(m, reg, value) {
  custom(m, reg, value >>> 16);
  custom(m, reg + 2, value & 0xffff);
}

/** Bytes of bitplane data one lores line fetches per plane: one word per 8 colour clocks, plus one. */
function fetchBytesPerLine(chip) {
  const isHires = (chip.bplcon0 & 0x8000) !== 0;
  const unit = isHires ? 4 : 8;
  return ((((chip.ddfstop - chip.ddfstrt) / unit) | 0) + 1) * (isHires ? 4 : 2);
}

function isWaitOver(line, hpos, first, second) {
  const mask = (second | 0x8000) & 0xfffe;
  return ((((line & 0xff) << 8) | hpos) & mask) >= (first & mask);
}

/** Run the copper up to the WAIT that holds it on this line. */
function runCopper(m, state, line) {
  const view = m.view;
  if (state.isStopped) {
    return;
  }
  for (let moves = 0; moves < MAX_COPPER_MOVES_PER_LINE; moves++) {
    const first = view.getUint16(state.pc & CHIP_MASK);
    const second = view.getUint16((state.pc + 2) & CHIP_MASK);
    if (first & 1) {
      if (first === 0xffff && second === 0xfffe) {
        state.isStopped = true;
        return;
      }
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
  return {
    top: chip.diwstrt >> 8,
    bottom: (chip.diwstop >> 8) | ((~chip.diwstop >> 7) & 0x100),
    left: chip.diwstrt & 0xff,
    right: (chip.diwstop & 0xff) | 0x100,
  };
}

/** Colour index of one pixel from its plane bits, as BPLCON0/BPLCON2 combine them. */
function colourIndex(chip, bits, planes) {
  if (chip.bplcon0 & 0x400) {
    // Dual playfield: odd planes make playfield 1 (colours 0-7), even planes playfield 2 (colours 8-15).
    const pf1 = (bits & 1) | ((bits >> 1) & 2) | ((bits >> 2) & 4);
    const pf2 = ((bits >> 1) & 1) | ((bits >> 2) & 2) | ((bits >> 3) & 4);
    const isPf2First = (chip.bplcon2 & 0x40) !== 0;
    if (isPf2First) {
      return pf2 ? pf2 + 8 : pf1;
    }
    return pf1 ? pf1 : pf2 ? pf2 + 8 : 0;
  }
  if (planes === 6 && !(chip.bplcon0 & 0x800)) {
    return bits;
  }
  return bits & 31;
}

function drawLine(m, line, pixels) {
  const chip = m.chip;
  const mem = m.mem;
  const row = (line - VIEW_Y) * VIEW_WIDTH;
  const isVisible = line >= VIEW_Y && line < VIEW_Y + VIEW_HEIGHT;
  const window = displayWindow(chip);
  const planes = Math.min((chip.bplcon0 >> 12) & 7, 6);
  const isBitplaneDma = (chip.dmacon & 0x300) === 0x300;
  const border = chip.rgb[0];
  if (line < window.top || line >= window.bottom || planes === 0 || !isBitplaneDma) {
    if (isVisible) {
      pixels.fill(border, row, row + VIEW_WIDTH);
    }
    return;
  }
  const bytes = fetchBytesPerLine(chip);
  if (isVisible) {
    const isHires = (chip.bplcon0 & 0x8000) !== 0;
    const firstPixel = chip.ddfstrt * 2 + 17;
    const delayOdd = chip.bplcon1 & 0xf;
    const delayEven = (chip.bplcon1 >> 4) & 0xf;
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
          // ponytail: hires shown at half width (every other pixel); nothing in this demo is hires
          bit *= 2;
        }
        if (bit >= 0 && bit < bits && (mem[(chip.bplpt[plane] + (bit >> 3)) & CHIP_MASK] >> (7 - (bit & 7))) & 1) {
          index |= 1 << plane;
        }
      }
      pixels[row + x] = chip.rgb[colourIndex(chip, index, planes)];
    }
  }
  for (let plane = 0; plane < planes; plane++) {
    chip.bplpt[plane] += bytes + (plane & 1 ? chip.bpl2mod : chip.bpl1mod);
  }
}

/** One frame: `pixels` is VIEW_WIDTH x VIEW_HEIGHT canvas pixels. The copper restarts at COP1LC. */
export function renderFrame(m, pixels) {
  const copper = { pc: m.cop1lc, isStopped: false };
  for (let line = 0; line < LINES_PER_FRAME; line++) {
    runCopper(m, copper, line);
    drawLine(m, line, pixels);
  }
}
