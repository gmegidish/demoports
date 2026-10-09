// The eight-page cycle shared by the motorcycle, the transforming objects, the contour city and the rotating door
// (docs/disassembly/G6_greets_tunnel_city.md, section 3.2): eight 320x200 16-colour pages at 1f40h steps, shown in
// turn; the Color Select register flips at every wrap, so with P54S on the cycle alternates between DAC 0..15 and
// DAC 16..31 (a 16-frame animation from 8 pages).
import { linear, waitTick } from '../machine.js';
import { interpolatePalette, setDac } from '../library.js';
import { setStartAddress } from '../engine3d.js';

export const SEGMENT_08D8 = linear(0x08d8, 0);
/** 08d8:303e word: the page shown (and being cycled). */
export const SHOWN_PAGE = SEGMENT_08D8 + 0x303e;
/** 08d8:2ea8 byte: flips at every wrap of the cycle. */
const CYCLE_HALF = SEGMENT_08D8 + 0x2ea8;
/** 08d8:3040 byte: 2 for the first half, 1 for the second (selects the Color Select value). */
const COLOUR_HALF = SEGMENT_08D8 + 0x3040;
/** 08d8:3468 byte: the palette fade of showPages is on; 3469: its step. */
const FADE_ON = SEGMENT_08D8 + 0x3468;
const FADE_STEP = SEGMENT_08D8 + 0x3469;
/** 08d8 palettes: 32b8 black, 3198 the pattern colours, 3378 the work buffer. */
export const PALETTE_BLACK = SEGMENT_08D8 + 0x32b8;
const PALETTE_PATTERN = SEGMENT_08D8 + 0x3198;
export const PALETTE_WORK = SEGMENT_08D8 + 0x3378;

export const PAGE_BYTES = 0x1f40;
const CYCLE_END = 0xfa00;
const FADE_COLOURS = 0x20;
const FADE_STEPS = 0x46;
const FADE_LAST_STEP = 0x47;
const ATTRIBUTE_PORT = 0x3c0;
/** Attribute index 14h (Color Select) with PAS set. */
const COLOUR_SELECT_INDEX = 0x34;

/** 08d8:3161: the next page; returns the page left (ax). */
export function cyclePage(m) {
  const left = m.u16(SHOWN_PAGE);
  let page = (left + PAGE_BYTES) & 0xffff;
  if (page === CYCLE_END) {
    page = 0;
    m.mem[CYCLE_HALF] = ~m.mem[CYCLE_HALF] & 0xff;
  }
  m.set16(SHOWN_PAGE, page);
  m.mem[COLOUR_HALF] = m.mem[CYCLE_HALF] === 0 ? 2 : 1;
  return left;
}

/** The `out 3c0, 34h ; out 3c0, bl` after each tick: Color Select 1 in the second half of the cycle, else 0. */
export function setColourSelect(m) {
  const value = m.mem[COLOUR_HALF] === 1 ? 1 : 0;
  m.vga.out8(ATTRIBUTE_PORT, COLOUR_SELECT_INDEX);
  m.vga.out8(ATTRIBUTE_PORT, value);
}

/** CRTC start = the shown page (08d8:34a2 and the same code in the other loops). */
export function showCurrentPage(m) {
  setStartAddress(m, m.u16(SHOWN_PAGE));
}

/**
 * 08d8:346a: cx + 1 frames of the page cycle; while [3468] is set, the 32-colour fade from black to the pattern
 * colours runs one step per frame (its last step is computed but never shown: the flag is cleared first).
 */
export function* showPages(m, cx) {
  let remaining = cx;
  do {
    cyclePage(m);
    if (m.mem[FADE_ON] !== 0) {
      interpolatePalette(m, FADE_COLOURS, PALETTE_BLACK, PALETTE_PATTERN, PALETTE_WORK, m.mem[FADE_STEP], FADE_STEPS);
      m.mem[FADE_STEP] = (m.mem[FADE_STEP] + 1) & 0xff;
      if (m.mem[FADE_STEP] === FADE_LAST_STEP) {
        m.mem[FADE_ON] = 0;
      }
    }
    showCurrentPage(m);
    yield* waitTick(m);
    if (m.mem[FADE_ON] === 1) {
      setDac(m, 0, FADE_COLOURS, PALETTE_WORK);
    }
    setColourSelect(m);
    remaining -= 1;
  } while (remaining >= 0);
}
