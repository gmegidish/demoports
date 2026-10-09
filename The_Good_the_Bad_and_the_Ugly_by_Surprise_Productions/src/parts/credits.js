// The credits (Antibyte): 0db5:07b0. Five pages of 16x16 text masked over a gradient (planes 1-3 from 'ugur'),
// each page flying into the next as moving pixels over 64 frames. docs/disassembly/G2_textmode_intro_credits.md
// section 5.
import { linear, waitTick } from '../machine.js';
import * as lib from '../library.js';
import { readFrameCounter } from '../engine3d.js';

const CODE = 0x0db5;
const at = (offset) => linear(CODE, offset);

const MASK_TABLE = 0x0000;
const ROW_TABLE = 0x0140;
const SCREEN_WIDTH = 0x140;
const PAGE_ROWS = 0x60;
const ROW_BYTES = 0x28;
const FONT_POINTER = 0x0200;
const WORK_POINTER = 0x0202;
const WORK_PARAGRAPHS = 0x0ffd;
const PAGE_FLAG = 0x020c;
const TEXT_START = 0x020d;
const TEXT_POINTER = 0x0318;
const PALETTE = 0x031a;
const PALETTE_SOURCE = 0x034a;
const PALETTE_BYTES = 0x30;
const OLD_LIST_START = 0x0464;
const OLD_LIST_END = 0x0466;
const NEW_LIST_END = 0x0468;
const NEW_COUNT = 0x04b3;
const OLD_COUNT = 0x04b5;
const FRAME_INDEX = 0x0706;
const FRAME_POINTERS = [0x0708, 0x070a, 0x070c, 0x070e];
const FRAME_PARAGRAPHS = 0x0f00;
const FRAMES_PER_SEGMENT = 16;
const FRAME_PARAGRAPH_STEP = 0xf0;
const PAGE_BYTES = 0xf00;
const SECOND_PAGE = 0x0f00;
const LIST_BASE = 0x1e00;
const SCREEN_AT = 0x0820;
const MORPH_FRAMES = 0x40;
const GRADIENT_PLANES = [[0x0202, 0x0c00], [0x0402, 0x1b00], [0x0802, 0x2a00]];
const SEQUENCER_INDEX = 0x3c4;
const GRAPHICS_INDEX = 0x3ce;
const END_OF_PAGE = 0x00;
const END_OF_TEXT = 0xff;
const NEW_LINE = 0x0a;
const LINE_ADVANCE = 0x0280;

const toS16 = (v) => (v << 16) >> 16;

/** 037a: DAC 0..15 from 0db5:031a; the x bit-mask table and the row offset table. */
function setPaletteAndTables(m) {
  lib.setDac(m, 0, 16, at(PALETTE));
  let mask = 0x80;
  for (let x = 0; x < SCREEN_WIDTH; x++) {
    m.mem[at(MASK_TABLE + x)] = mask;
    mask = ((mask >> 1) | (mask << 7)) & 0xff;
  }
  for (let y = 0; y < PAGE_ROWS; y++) {
    m.set16(at(ROW_TABLE + 2 * y), y * ROW_BYTES);
  }
}

/** 0758 (fade in, level 1..64) and 0784 (fade out, 63..0): palette = source * level >> 6, one level per tick. */
function* fadeCredits(m, levels) {
  for (const level of levels) {
    for (let i = 0; i < PALETTE_BYTES; i++) {
      m.mem[at(PALETTE + i)] = ((m.s8(at(PALETTE_SOURCE + i)) * level) >> 6) & 0xff;
    }
    yield* waitTick(m);
    setPaletteAndTables(m);
  }
}

/** Copies `words` words from `source` (linear) to a000:`offset` with the current map mask. */
function copyToVideo(m, source, offset, words) {
  const vga = m.vga;
  for (let i = 0; i < words * 2; i++) {
    vga.write(offset + i, m.mem[source + i]);
  }
}

/** 0710: the gradient into planes 1, 2, 3 at rows 52..147; read map 0; map mask 1. */
function drawGradient(m) {
  const font = linear(m.u16(at(FONT_POINTER)), 0);
  for (const [mapMask, source] of GRADIENT_PLANES) {
    m.vga.out16(SEQUENCER_INDEX, mapMask);
    copyToVideo(m, font + source, SCREEN_AT, PAGE_BYTES / 2);
  }
  m.vga.out16(GRAPHICS_INDEX, 0x0004);
  m.vga.out16(SEQUENCER_INDEX, 0x0102);
}

/** 03b1: renders the next text page into the work buffer (half 0 or f00h by the flag, which then flips). */
function renderPage(m) {
  const work = linear(m.u16(at(WORK_POINTER)), 0);
  const font = linear(m.u16(at(FONT_POINTER)), 0);
  const page = m.mem[at(PAGE_FLAG)] !== 0 ? SECOND_PAGE : 0;
  m.mem[at(PAGE_FLAG)] ^= 0xff;
  m.mem.fill(0, work + page, work + page + PAGE_BYTES);
  let lineStart = page;
  let dx = page;
  let bx = m.u16(at(TEXT_POINTER));
  for (;;) {
    const character = m.mem[at(bx)];
    bx++;
    if (character === END_OF_TEXT) {
      bx = TEXT_START;
      break;
    }
    if (character === END_OF_PAGE) {
      break;
    }
    if (character === NEW_LINE) {
      lineStart += LINE_ADVANCE;
      dx = lineStart;
      continue;
    }
    let si = font + (((character - 0x20) & 0xff) << 5);
    let di = dx;
    for (let row = 0; row < 16; row++) {
      m.mem[work + (di & 0xffff)] = m.mem[si];
      m.mem[work + ((di + 1) & 0xffff)] = m.mem[si + 1];
      si += 2;
      di += ROW_BYTES;
    }
    dx += 2;
  }
  m.set16(at(TEXT_POINTER), bx);
}

/**
 * 046a: the set pixels of a page (the half not selected by the flag... as the flag is at the call) as 4-byte
 * records (x word, y byte, 0) in raster order, at `destination`; returns the end offset.
 */
function listPixels(m, destinationBase, destination) {
  const work = linear(m.u16(at(WORK_POINTER)), 0);
  let si = m.mem[at(PAGE_FLAG)] !== 0 ? 0 : SECOND_PAGE;
  let di = destination;
  let x = 0;
  let y = 0;
  for (;;) {
    const word = (m.mem[work + si] << 8) | m.mem[work + si + 1];
    si += 2;
    let mask = 0x8000;
    for (let bit = 0; bit < 16; bit++) {
      if (word & mask) {
        m.set16(destinationBase + di, x);
        m.mem[destinationBase + di + 2] = y;
        m.mem[destinationBase + di + 3] = 0;
        di += 4;
      }
      mask >>= 1;
      x++;
      if (x === SCREEN_WIDTH) {
        x = 0;
        y++;
        if (y === PAGE_ROWS) {
          return di;
        }
      }
    }
  }
}

/** One position/velocity pair of 04b7: position = old << 6, velocity = (old << 6) - (new << 6) >> 6. */
function pairWord(m, work, si, di, newWord) {
  const old = toS16(m.u16(work + si) << 6);
  m.set16(work + si, old);
  m.set16(work + di, toS16(old - toS16(newWord << 6)) >> 6);
}

/** 04b7: matches the old pixel list (extended by ping-pong copies) with the new one (indexed by ping-pong). */
function matchLists(m) {
  const work = linear(m.u16(at(WORK_POINTER)), 0);
  const targets = linear(m.u16(at(FRAME_POINTERS[0])), 0);
  const oldBytes = (m.u16(at(OLD_LIST_END)) - m.u16(at(OLD_LIST_START))) & 0xffff;
  const newBytes = m.u16(at(NEW_LIST_END));
  const newCount = newBytes >> 2;
  const oldCount = oldBytes >> 2;
  m.set16(at(NEW_COUNT), newCount);
  m.set16(at(OLD_COUNT), oldCount);
  if (toS16(oldBytes) < toS16(newBytes)) {
    let di = m.u16(at(OLD_LIST_END));
    m.set16(at(OLD_LIST_END), m.u16(at(OLD_LIST_START)) + newBytes);
    let missing = newCount - oldCount;
    let si = di;
    const copy = () => {
      m.mem.copyWithin(work + di, work + si, work + si + 4);
      di += 4;
      missing--;
      return missing === 0;
    };
    outer: for (;;) {
      for (let i = 0; i < oldCount; i++) {
        si -= 4;
        if (copy()) {
          break outer;
        }
      }
      for (let i = 0; i < oldCount; i++) {
        if (copy()) {
          break outer;
        }
        si += 4;
      }
    }
    let si2 = LIST_BASE;
    let di2 = m.u16(at(OLD_LIST_END));
    for (let i = 0; i < newCount; i++) {
      pairWord(m, work, si2, di2, m.u16(targets + 4 * i));
      pairWord(m, work, si2 + 2, di2 + 2, m.u16(targets + 4 * i + 2));
      si2 += 4;
      di2 += 4;
    }
    return;
  }
  let si = LIST_BASE;
  let di = m.u16(at(OLD_LIST_END));
  let left = oldCount;
  let bp = 0;
  for (;;) {
    for (let i = 0; i < newCount; i++) {
      pairWord(m, work, si, di, m.u16(targets + bp));
      pairWord(m, work, si + 2, di + 2, m.u16(targets + bp + 2));
      si += 4;
      di += 4;
      bp += 4;
      left--;
      if (left === 0) {
        return;
      }
    }
    for (let i = 0; i < newCount; i++) {
      bp -= 4;
      pairWord(m, work, si, di, m.u16(targets + bp));
      pairWord(m, work, si + 2, di + 2, m.u16(targets + bp + 2));
      si += 4;
      di += 4;
      left--;
      if (left === 0) {
        return;
      }
    }
  }
}

/** 0668: moves every pixel by -velocity (1/64 pixel units) and ORs it into the frame at `frame` (linear). */
function drawMorphFrame(m, frame) {
  const work = linear(m.u16(at(WORK_POINTER)), 0);
  const count = ((m.u16(at(OLD_LIST_END)) - m.u16(at(OLD_LIST_START))) & 0xffff) >> 2;
  let si = work + LIST_BASE;
  let bx = work + m.u16(at(OLD_LIST_END));
  const mem = m.mem;
  for (let i = 0; i < count; i++) {
    const x = (m.u16(si) - m.u16(bx)) & 0xffff;
    m.set16(si, x);
    const y = (m.u16(si + 2) - m.u16(bx + 2)) & 0xffff;
    m.set16(si + 2, y);
    si += 4;
    bx += 4;
    const column = x >> 6;
    const row = y >> 6;
    const mask = mem[at(MASK_TABLE) + column];
    const offset = ((column >> 3) + m.u16(at(ROW_TABLE + 2 * row))) & 0xffff;
    mem[frame + offset] |= mask;
  }
}

/** 06ae: lists both pages, matches them and renders the 64 morph frames into the four frame segments. */
function prepareMorph(m) {
  const work = linear(m.u16(at(WORK_POINTER)), 0);
  m.set16(at(OLD_LIST_START), LIST_BASE);
  m.set16(at(OLD_LIST_END), listPixels(m, work, LIST_BASE));
  renderPage(m);
  m.set16(at(NEW_LIST_END), listPixels(m, linear(m.u16(at(FRAME_POINTERS[0])), 0), 0));
  matchLists(m);
  for (const pointer of FRAME_POINTERS) {
    const base = linear(m.u16(at(pointer)), 0);
    m.mem.fill(0, base, base + 0xf000);
  }
  for (const pointer of FRAME_POINTERS) {
    for (let f = 0; f < FRAMES_PER_SEGMENT; f++) {
      drawMorphFrame(m, linear(m.u16(at(pointer)) + f * FRAME_PARAGRAPH_STEP, 0));
    }
  }
}

/** Polls 08d8:157e until the tick count exceeds `limit`. */
function* waitForCounterAbove(m, limit) {
  while (readFrameCounter(m) <= limit) {
    yield;
  }
}

/** 0db5:07b0. */
export function* credits(m) {
  const vga = m.vga;
  m.allocTo(at(WORK_POINTER), WORK_PARAGRAPHS);
  for (const pointer of FRAME_POINTERS) {
    m.allocTo(at(pointer), FRAME_PARAGRAPHS);
  }
  vga.out16(SEQUENCER_INDEX, 0x0502);
  for (let i = 0; i < 0x1f40; i++) {
    vga.write(i, 0);
  }
  vga.out16(SEQUENCER_INDEX, 0x0102);
  yield* waitTick(m);
  setPaletteAndTables(m);
  drawGradient(m);
  renderPage(m);
  copyToVideo(m, linear(m.u16(at(WORK_POINTER)), 0), SCREEN_AT, PAGE_BYTES / 2);
  yield* fadeCredits(m, Array.from({ length: 64 }, (_, i) => i + 1));
  yield* waitTick(m);
  yield* waitForCounterAbove(m, 0x5a);
  for (let page = 0; page < 4; page++) {
    prepareMorph(m);
    yield* waitForCounterAbove(m, 0xc8);
    for (let frame = 0; frame < MORPH_FRAMES; frame++) {
      m.set16(at(FRAME_INDEX), frame);
      yield* waitTick(m);
      const segment = m.u16(at(FRAME_POINTERS[frame >> 4]));
      copyToVideo(m, linear(segment, 0) + (frame & 0x0f) * PAGE_BYTES, SCREEN_AT, PAGE_BYTES / 2);
    }
  }
  yield* waitForCounterAbove(m, 0xd2);
  yield* fadeCredits(m, Array.from({ length: 64 }, (_, i) => 63 - i));
  for (const pointer of [...FRAME_POINTERS, WORK_POINTER]) {
    m.freeFrom(at(pointer));
  }
}
