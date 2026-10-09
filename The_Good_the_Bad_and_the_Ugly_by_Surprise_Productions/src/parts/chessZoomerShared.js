// Shared pieces of module 0777 (chess zoomer, parallax bars, 16x16 spheres): its variables, the VGA helpers it
// calls between scanlines, and the waits. docs/disassembly/G5_chesszoom_bars_eb3.md, "Module 0777".
import { linear } from '../machine.js';

/** Segment 0777: code, variables and resource pointers. */
export const CODE = linear(0x0777, 0);
/** Segment 05ee: the program's main data segment (ball pattern, bar tables, bar colours). */
export const DATA = linear(0x05ee, 0);

export const SEQUENCER_INDEX = 0x3c4;
export const GRAPHICS_INDEX = 0x3ce;
export const CRTC_INDEX = 0x3d4;
export const ATTRIBUTE_PORT = 0x3c0;
export const INPUT_STATUS = 0x3da;

/** Attribute index 14h (Color Select) and 13h (pel panning), with the PAS bit. */
const COLOUR_SELECT_INDEX = 0x34;
const PEL_PANNING_INDEX = 0x33;
const ATTRIBUTE_PAS = 0x20;

/** cs: variables of module 0777 (offsets from CODE). */
export const V = {
  P3_SIN: 0x00,
  P3_CHESS: 0x02,
  CHESS: 0x04,
  P3_ZOOM: 0x06,
  P3_OUTF: 0x08,
  WOBBLE_INDEX: 0x32,
  ROW_WOBBLE_INDEX: 0x34,
  PERIOD: 0x36,
  GROWTH_INDEX: 0x38,
  ROW_BASE: 0x3a,
  SHOWN_ROW: 0x3c,
  PAUSE: 0x3e,
  ROW_STEP: 0x40,
  PERIOD_STEP: 0x42,
  FIRST_COUNT: 0x44,
  SCROLL_BYTES: 0x46,
  PEL: 0x48,
  FIRST_PARITY: 0x49,
  SCROLL_PIXELS: 0x4b,
  UNUSED_VERTICAL: 0x4d,
  ROW_LIMIT: 0x4f,
  ZOOM_PHASE: 0x51,
  IS_DONE: 0x53,
  BUFFER: 0x54,
  PALETTE: 0x56,
  BAR_A_INDEX: 0x58,
  BAR_B_INDEX: 0x5a,
  FADE_IN: 0x43a,
  FADE_OUT_STEPS: 0x638,
  SCROLL_X_INDEX: 0x655,
  SCROLL_Y_INDEX: 0x657,
  BAR_FADE: 0x7b0,
  SEQUENCE_START: 0xa2d,
  SEQUENCE_INDEX: 0xa2f,
  PICTURE_ROW: 0xa31,
  PICTURE_ROW_STEP: 0xa33,
  SEQUENCE_PERIOD_STEP: 0xa35,
  SEQUENCE_INDEX_STEP: 0xa37,
  IS_SCROLL_FROZEN: 0xa92,
  SWEEP_DAC: 0x110f,
  SWEEP_SOURCE: 0x1111,
};

/** Word variable cs:[offset]. */
export function getWord(m, offset) {
  return m.u16(CODE + offset);
}

export function setWord(m, offset, value) {
  m.set16(CODE + offset, value & 0xffff);
}

export function getByte(m, offset) {
  return m.mem[CODE + offset];
}

export function setByte(m, offset, value) {
  m.mem[CODE + offset] = value & 0xff;
}

/** Linear address of offset `offset` in the block whose segment is cs:[pointer]. */
export function inBlock(m, pointer, offset) {
  return linear(getWord(m, pointer), offset & 0xffff);
}

/** 0777:02df: wait until display, then until the next horizontal blank (one scanline passed). */
export function waitHblank(vga) {
  vga.in8(INPUT_STATUS);
  vga.hblank();
}

/** A retrace poll that does not wait for a scanline (the bit is already set, or a wait for display enable). */
export function pollStatus(vga) {
  vga.in8(INPUT_STATUS);
}

/** 0777:02f0: Color Select = value (no 3da read: the flip-flop is wherever the last access left it). */
export function setColourSelect(vga, value) {
  vga.out8(ATTRIBUTE_PORT, COLOUR_SELECT_INDEX);
  vga.out8(ATTRIBUTE_PORT, value);
}

/** 0777:042b: pel panning = cs:[48h]. */
export function setPel(m) {
  const vga = m.vga;
  vga.out8(ATTRIBUTE_PORT, PEL_PANNING_INDEX);
  vga.out8(ATTRIBUTE_PORT, getByte(m, V.PEL));
  vga.out8(ATTRIBUTE_PORT, ATTRIBUTE_PAS);
}

/** CRTC 0ch/0dh = start address. */
export function setStart(vga, address) {
  vga.out16(CRTC_INDEX, (address & 0xff00) | 0x0c);
  vga.out16(CRTC_INDEX, ((address & 0xff) << 8) | 0x0d);
}

/** CRTC 13h (offset, in words). */
export function setRowOffset(vga, words) {
  vga.out16(CRTC_INDEX, (words << 8) | 0x13);
}

/** Sequencer register 1 bit 5 on/off (`out 3c4,1; in 3c5; or/and; out`). */
export function setScreenOff(vga, isOff) {
  vga.out8(SEQUENCER_INDEX, 1);
  const value = isOff ? vga.sequencer[1] | 0x20 : vga.sequencer[1] & 0xdf;
  vga.out8(SEQUENCER_INDEX + 1, value);
}

/**
 * The CPU spends at least a scanline here (a DAC upload with the screen off): in a raster frame, the line after
 * the last horizontal-retrace wait is drawn meanwhile, with the state of this moment (the recording's black line
 * 399 under the palette upload's screen-off).
 */
export function passScanline(vga) {
  if (vga.beamScan !== null) {
    vga.hblank();
  }
}

/**
 * DOSBox takes the pel panning for a frame at the start of its display, after the vertical retrace: a write made
 * between the retrace (the port's frame boundary) and line 0 applies to the frame about to be shown.
 */
export function latchPanningBeforeDisplay(vga) {
  vga.latchedPanning = vga.attribute[0x13];
}
