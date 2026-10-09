// The Water-effect, 0749:01cc (docs/disassembly/G4_water_glentz_wobbler.md, section 1): the dragon picture in
// 320x400 unchained mode fades in from white, then a ripple table rewrites the CRTC offset register at every
// scanline (repeat / normal / skip a line), and at the end the picture scrolls down off the screen.
import { linear } from '../machine.js';
import { unpackRle, setUnchained256, fadePalette } from '../library.js';

/** @typedef {import('../machine.js').Machine} Machine */

const MODULE = linear(0x0749, 0);
/** 0749:0000 word: the ripple phase, an index into watr_dat. */
const RIPPLE_PHASE = MODULE + 0x00;
/** 0749:0002 byte: set when the 910 ripple frames are over; the picture then scrolls away. */
const IS_ENDING = MODULE + 0x02;
/** 0749:0003 word: the CRTC start address. */
const START_ADDRESS = MODULE + 0x03;
/** 0749:0005 word: how many scanlines from the top get a ripple value. */
const RIPPLED_LINES = MODULE + 0x05;
/** 0749:0017 / 0749:0019 / 0749:0112: segments of watr_dat, watr_pic and the 64000-byte work buffer. */
const RIPPLE_SEGMENT = MODULE + 0x17;
const PICTURE_SEGMENT = MODULE + 0x19;
const BUFFER_SEGMENT = MODULE + 0x112;

const SEQUENCER_INDEX = 0x3c4;
const CRTC_INDEX = 0x3d4;
const DAC_WRITE_INDEX = 0x3c8;
const DAC_DATA = 0x3c9;
const PICTURE_PALETTE_BYTES = 0xc0;
const PICTURE_SIZE = 64000;
const BUFFER_PARAGRAPHS = 0xfa0;
/** 01e0: 162 bytes of 3fh, DAC 0..53 white. */
const WHITE_BYTES = 0xa2;
/** 0230: the picture in video memory, 400 lines of 80 bytes. */
const PICTURE_ADDRESS = 0x5dc0;
const BYTES_PER_LINE = 0x50;
const SCANLINES = 400;
const NORMAL_OFFSET = 0x28;
const RIPPLE_TABLE_LENGTH = 0x280;
/** 0285: the fade covers DAC 0..59 only, in 60 steps. */
const FADE_COLOURS = 0x3c;
const FADE_STEPS = 0x3c;
const STILL_FRAMES = 0x96;
const RIPPLE_FRAMES = 0x38e;

function writeCrtc16(vga, index, value) {
  vga.out16(CRTC_INDEX, (value << 8) | index);
}

/** 0749:004c: CRTC start address = bx. */
function setStartAddress(vga, address) {
  writeCrtc16(vga, 0x0c, address >> 8);
  writeCrtc16(vga, 0x0d, address & 0xff);
}

/** `rep stosw` of zero words at a000:0000 on all planes (the offset wraps at 64 KB). */
function clearAllPlanes(m, words) {
  const vga = m.vga;
  vga.out16(SEQUENCER_INDEX, 0x0f02);
  const bytes = Math.min(words * 2, 0x10000);
  for (const plane of vga.planes) {
    plane.fill(0, 0, bytes);
  }
}

/** 0749:0114: plane by plane, each picture row to two consecutive 80-byte lines from PICTURE_ADDRESS on. */
function copyPictureDoubled(m, picture) {
  const vga = m.vga;
  const mem = m.mem;
  for (let plane = 0; plane < 4; plane++) {
    vga.out16(SEQUENCER_INDEX, ((1 << plane) << 8) | 0x02);
    const target = vga.planes[plane];
    for (let row = 0; row < 200; row++) {
      const line = PICTURE_ADDRESS + row * 2 * BYTES_PER_LINE;
      for (let column = 0; column < 80; column++) {
        const value = mem[picture + row * 320 + column * 4 + plane];
        target[line + column] = value;
        target[line + BYTES_PER_LINE + column] = value;
      }
    }
  }
}

/** 0749:0067: 150 still frames, then the ripple loop, then the scroll; under the BIOS timer (music by hand). */
function* rippleAndScroll(m) {
  const vga = m.vga;
  const ripples = linear(m.u16(RIPPLE_SEGMENT), 0);
  for (let i = 0; i < STILL_FRAMES; i++) {
    yield;
    m.tickMusic();
  }
  m.set16(RIPPLED_LINES, 1);
  let count = RIPPLE_FRAMES;
  for (;;) {
    m.tickMusic();
    if (m.u8(IS_ENDING) !== 0) {
      m.set16(START_ADDRESS, (m.u16(START_ADDRESS) - BYTES_PER_LINE) & 0xffff);
      if (m.u16(START_ADDRESS) === 0) {
        break;
      }
    }
    if (m.u16(RIPPLED_LINES) < SCANLINES) {
      m.set16(RIPPLED_LINES, m.u16(RIPPLED_LINES) + 1);
    }
    setStartAddress(vga, m.u16(START_ADDRESS));
    yield; // 004c: waits for the retrace start
    // 0749:0033 per line: wait for the horizontal blank, CRTC 13h = value, wait for the display. The first wait falls
    // in the vertical blank (no line passes); each later one ends a scanline.
    let index = m.u16(RIPPLE_PHASE);
    const rippled = m.u16(RIPPLED_LINES);
    for (let line = 0; line < rippled; line++) {
      const value = m.mem[ripples + index];
      index++;
      if (index >= RIPPLE_TABLE_LENGTH) {
        index -= RIPPLE_TABLE_LENGTH;
      }
      if (line > 0) {
        vga.hblank();
      }
      writeCrtc16(vga, 0x13, value);
    }
    for (let line = rippled; line < SCANLINES; line++) {
      vga.hblank(); // 0749:001b
      writeCrtc16(vga, 0x13, NORMAL_OFFSET);
    }
    let phase = m.u16(RIPPLE_PHASE) + 2;
    if (phase >= RIPPLE_TABLE_LENGTH) {
      phase -= RIPPLE_TABLE_LENGTH;
    }
    m.set16(RIPPLE_PHASE, phase);
    count = (count - 1) & 0xffff;
    if (count === 0) {
      m.set8(IS_ENDING, 1);
    }
  }
  vga.out16(CRTC_INDEX, 0x0013); // 010d: offset 0
}

/** 0749:01cc. */
export function* water(m) {
  const vga = m.vga;
  yield; // 01cc: waits for the retrace start
  vga.out8(DAC_WRITE_INDEX, 0);
  for (let i = 0; i < WHITE_BYTES; i++) {
    vga.out8(DAC_DATA, 0x3f);
  }
  clearAllPlanes(m, 0x1f40);
  setUnchained256(vga); // 01ff 0299:0175
  const buffer = linear(m.allocTo(BUFFER_SEGMENT, BUFFER_PARAGRAPHS), 0);
  const pictureFile = linear(m.u16(PICTURE_SEGMENT), 0);
  unpackRle(m, pictureFile + PICTURE_PALETTE_BYTES, buffer, PICTURE_SIZE);
  copyPictureDoubled(m, buffer);
  vga.out8(CRTC_INDEX, 9); // 0239: double scan off, 400 lines
  vga.out8(CRTC_INDEX + 1, vga.in8(CRTC_INDEX + 1) & 0x60);
  m.set16(START_ADDRESS, PICTURE_ADDRESS);
  setStartAddress(vga, PICTURE_ADDRESS);
  // 0259: the buffer's first 384 bytes become the two palettes: the picture's, then all white.
  m.mem.copyWithin(buffer, pictureFile, pictureFile + PICTURE_PALETTE_BYTES);
  m.mem.fill(0x3f, buffer + PICTURE_PALETTE_BYTES, buffer + 2 * PICTURE_PALETTE_BYTES);
  // 027a 0731:0158: cli, wait for the retrace start, then int 8 = the BIOS before sti: the IRQ of that retrace
  // goes to the BIOS handler, so that frame gets no music tick (measured in the recording's audio, G1).
  m.setTimer('bios');
  yield;
  yield* fadePalette(m, {
    colours: FADE_COLOURS,
    from: buffer + PICTURE_PALETTE_BYTES,
    to: buffer,
    work: buffer + 2 * PICTURE_PALETTE_BYTES,
    steps: FADE_STEPS,
    first: 0,
    isTickingMusic: true,
  }); // 0297 0749:0153
  yield* rippleAndScroll(m); // 029c 0749:0067
  yield; // 029f 0731:0120 waits for the retrace start
  m.setTimer('music');
  clearAllPlanes(m, 0xfde8); // 02a4: 65000 words from 0 wrap over the whole 64 KB
  vga.out8(CRTC_INDEX, 9);
  vga.out8(CRTC_INDEX + 1, vga.in8(CRTC_INDEX + 1) | 0x80);
  setStartAddress(vga, 0);
}
