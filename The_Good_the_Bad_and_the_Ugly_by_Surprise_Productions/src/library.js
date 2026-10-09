// The shared library routines: the video library (segment 0299), the palette fades in the water module (0749:0153,
// 0749:0192) and the two DAC helpers of the main script (segment 0000). docs/disassembly/G1_framework.md, section 5.
// Addresses are linear (machine.js); `m` is the Machine. Generators (fades) are run with `yield*`.
import { linear } from './machine.js';

const SEQUENCER_INDEX = 0x3c4;
const CRTC_INDEX = 0x3d4;
const ATTRIBUTE_PORT = 0x3c0;
const DAC_WRITE_INDEX = 0x3c8;
const DAC_DATA = 0x3c9;
const GRAPHICS_INDEX = 0x3ce;
const INPUT_STATUS = 0x3da;
const SCREEN_OFF = 0x20;

/** 0299:00dc and 0299:015c: 320x200 unchained, 80 bytes per line, double scan, line compare 3ffh. */
const CRTC_UNCHAINED = [0x5f, 0x4f, 0x50, 0x82, 0x54, 0x80, 0xbf, 0x1f, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x9c, 0x8e, 0x8f, 0x28, 0x00, 0x96, 0xb9, 0xe3, 0xff];
/** 0299:01b3: EGA mode 0Dh timings, 320x200 planar, 40 bytes per line. */
const CRTC_EGA_PLANAR = [0x2d, 0x27, 0x28, 0x90, 0x2b, 0x80, 0xbf, 0x1f, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x9c, 0x2e, 0x8f, 0x14, 0x00, 0x96, 0xb9, 0xe3, 0xff];

/** 0299:0000: RLE unpack `count` bytes from `source` to `destination` (linear addresses in m.mem). Returns the source end. */
export function unpackRle(m, source, destination, count) {
  const mem = m.mem;
  let si = source;
  let di = destination;
  let remaining = count;
  while (remaining > 0) {
    const code = mem[si++];
    if (code <= 0x7f) {
      const n = code + 1;
      mem.copyWithin(di, si, si + n);
      si += n;
      di += n;
      remaining -= n;
    } else {
      const n = 0x101 - code;
      mem.fill(mem[si++], di, di + n);
      di += n;
      remaining -= n;
    }
  }
  return si;
}

/**
 * 0299:0023: for each of 3 * colours bytes, out = from + trunc((int8)(to - from) * (int8)step / (int8)steps), with
 * 8-bit imul and idiv (the quotient truncates toward 0).
 */
export function interpolatePalette(m, colours, from, to, out, step, steps) {
  const mem = m.mem;
  const signedStep = (step << 24) >> 24;
  const signedSteps = (steps << 24) >> 24;
  for (let i = 0; i < colours * 3; i++) {
    const delta = ((mem[to + i] - mem[from + i]) << 24) >> 24;
    const product = (delta * signedStep) << 16 >> 16;
    mem[out + i] = (mem[from + i] + Math.trunc(product / signedSteps)) & 0xff;
  }
}

/** 0299:0045: attribute registers 0..15 = the 16 bytes at `source`. */
export function setAttributePalette(m, source) {
  const vga = m.vga;
  vga.in8(INPUT_STATUS);
  for (let i = 0; i < 16; i++) {
    vga.out8(ATTRIBUTE_PORT, i);
    vga.out8(ATTRIBUTE_PORT, m.mem[source + i]);
  }
  vga.out8(ATTRIBUTE_PORT, 0x20);
}

/** 0299:005e: attribute registers i = i. */
export function setIdentityAttributes(vga) {
  vga.in8(INPUT_STATUS);
  for (let i = 0; i < 16; i++) {
    vga.out8(ATTRIBUTE_PORT, i);
    vga.out8(ATTRIBUTE_PORT, i);
  }
  vga.out8(ATTRIBUTE_PORT, 0x20);
}

/** 0299:0076: DAC entries first..first+count-1 = 3 * count bytes at `source`, with the screen off (SR1 bit 5) meanwhile. */
export function setDac(m, first, count, source) {
  const vga = m.vga;
  vga.out8(SEQUENCER_INDEX, 1);
  vga.out8(SEQUENCER_INDEX + 1, vga.sequencer[1] | SCREEN_OFF);
  vga.out8(DAC_WRITE_INDEX, first);
  for (let i = 0; i < count * 3; i++) {
    vga.out8(DAC_DATA, m.mem[source + i]);
  }
  vga.out8(SEQUENCER_INDEX, 1);
  vga.out8(SEQUENCER_INDEX + 1, vga.sequencer[1] & ~SCREEN_OFF);
}

/** 0299:009c: attribute mode control |= 80h (P54S). */
export function setP54S(vga) {
  writeAttribute(vga, 0x10, vga.attribute[0x10] | 0x80);
}

/** 0299:00b0: attribute mode control &= 7fh. */
export function clearP54S(vga) {
  writeAttribute(vga, 0x10, vga.attribute[0x10] & 0x7f);
}

/** 0299:00c4: CRTC 9 &= 7fh (double scan off). */
export function clearDoubleScan(vga) {
  writeCrtc(vga, 9, vga.crtc[9] & 0x7f);
}

/** 0299:00d0: CRTC 11h &= 7fh (unlock CRTC 0..7). */
export function unlockCrtc(vga) {
  writeCrtc(vga, 0x11, vga.crtc[0x11] & 0x7f);
}

/** 0299:00f5: mode 13h, chain-4 off, border 0, the unchained CRTC table, all 256 KB of video memory cleared. */
export function* setModeX(m) {
  const vga = m.vga;
  vga.setMode13();
  yield; // waits for the retrace, then for its end
  vga.out16(SEQUENCER_INDEX, 0x0604);
  writeAttribute(vga, 0x10, 0x61);
  writeAttribute(vga, 0x11, 0x00);
  loadCrtc(vga, CRTC_UNCHAINED);
  vga.out16(SEQUENCER_INDEX, 0x0f02);
  vga.clearPlanes();
}

/** 0299:0175: unchained 256 colours without a BIOS call; video memory is kept. */
export function setUnchained256(vga) {
  writeAttribute(vga, 0x10, 0x41);
  vga.out16(GRAPHICS_INDEX, 0x4005);
  vga.out16(SEQUENCER_INDEX, 0x0101);
  vga.out16(SEQUENCER_INDEX, 0x0604);
  loadCrtc(vga, CRTC_UNCHAINED);
}

/** 0299:01cc: EGA 320x200x16 planar (mode 0Dh registers); video memory is kept. The main script's blank mode. */
export function setEgaPlanar(vga) {
  writeAttribute(vga, 0x10, 0x01);
  vga.out16(GRAPHICS_INDEX, 0x0005);
  vga.out16(SEQUENCER_INDEX, 0x0901);
  vga.out16(SEQUENCER_INDEX, 0x0604);
  loadCrtc(vga, CRTC_EGA_PLANAR);
}

/** 0299:020a: border (attribute 11h) = ffh, DAC 255 = black. */
export function setBlackBorder(vga) {
  writeAttribute(vga, 0x11, 0xff);
  vga.out8(DAC_WRITE_INDEX, 0xff);
  vga.out8(DAC_DATA, 0);
  vga.out8(DAC_DATA, 0);
  vga.out8(DAC_DATA, 0);
}

/** 0299:0227: line compare = bx (bit 8 to CRTC 7 bit 4, bit 9 to CRTC 9 bit 6). */
export function setLineCompare(vga, line) {
  writeCrtc(vga, 0x18, line & 0xff);
  writeCrtc(vga, 7, (vga.crtc[7] & ~0x10) | ((line >> 4) & 0x10));
  writeCrtc(vga, 9, (vga.crtc[9] & ~0x40) | ((line >> 3) & 0x40));
}

/** 0000:001b: DAC 0..99 = white (300 bytes of 63). */
export function setDacWhite100(vga) {
  vga.out8(DAC_WRITE_INDEX, 0);
  for (let i = 0; i < 300; i++) {
    vga.out8(DAC_DATA, 0x3f);
  }
}

/** 0000:002b: all 256 DAC entries black. */
export function setDacBlack(vga) {
  vga.out8(DAC_WRITE_INDEX, 0);
  for (let i = 0; i < 768; i++) {
    vga.out8(DAC_DATA, 0);
  }
}

/**
 * 0749:0192: fades `colours` DAC entries from `first` on, from the palette at `from` to the one at `to`, in `steps`
 * steps through the work buffer `work`: per step interpolate, wait for the retrace, upload. 0749:0153 is the same
 * with a music tick after each upload (`isTickingMusic`), for effects that run under the BIOS timer.
 */
export function* fadePalette(m, { colours, from, to, work, steps, first, isTickingMusic = false }) {
  for (let step = 1; step <= steps; step++) {
    interpolatePalette(m, colours, from, to, work, step, steps);
    yield;
    m.vga.in8(INPUT_STATUS); // the retrace poll (in al, 3dah) also resets the attribute flip-flop
    setDac(m, first, colours, work);
    if (isTickingMusic) {
      m.tickMusic();
    }
  }
}

/** A linear address inside the program image: seg:off. */
export const at = linear;

function writeAttribute(vga, index, value) {
  vga.in8(INPUT_STATUS);
  vga.out8(ATTRIBUTE_PORT, index);
  vga.out8(ATTRIBUTE_PORT, value);
  vga.out8(ATTRIBUTE_PORT, 0x20);
}

function writeCrtc(vga, index, value) {
  vga.out8(CRTC_INDEX, index);
  vga.out8(CRTC_INDEX + 1, value);
}

function loadCrtc(vga, table) {
  writeCrtc(vga, 0x11, vga.crtc[0x11] & 0x7f);
  table.forEach((value, index) => writeCrtc(vga, index, value));
}
