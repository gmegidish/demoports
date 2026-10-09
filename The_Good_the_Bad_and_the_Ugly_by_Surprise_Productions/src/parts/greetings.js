// 0eb3:27e8, 0eb3:28ab, 0eb3:27d5: the Greetings-scroller (Peci). Video memory holds 8 one-bit text lines (plane 0,
// rows 1..8); each frame the CPU samples the next 8 lines from a scrolling texture through a horizontal zoom table
// ('ugu'), while at every row it rewrites the CRTC offset (vertical zoom) and DAC colour 1 (gradient) from 'ugu2'.
// docs/disassembly/G5_chesszoom_bars_eb3.md, "Greetings scroller".
import { setDacBlack } from '../library.js';
import { linear, waitTick } from '../machine.js';

/** Segment 0eb3: font, text, texture, line buffer and variables. */
const CODE = linear(0x0eb3, 0);
const UGU2_POINTER = 0x0002;
const UGU2_NAME = 0x0004;
const UGU_POINTER = 0x000d;
const UGU_NAME = 0x000f;
const LINE_BUFFER = 0x0018;
const LINE_BUFFER_BYTES = 0x140;
const FONT = 0x1698;
const GLYPH_BYTES = 64;
const FIRST_CHARACTER = 0x20;
const TEXTURE_POSITION = 0x2718;
const FRAMES_TO_CHARACTER = 0x27cc;
const TEXT_POINTER = 0x27cd;
const FRAME_TABLE_POINTER = 0x27d3;
const FRAME_TABLE_START = 0x2bdd;
const FRAME_TABLE_END = 0x3221;
/** Texture rows are 2a8h bytes apart; each character is also written 148h bytes further (the ring's copy). */
const TEXTURE_ROW = 0x2a8;
const TEXTURE_COPY = 0x148;
const RING_START = 0x158;
const RING_END = 0x2a0;
const INITIAL_CHARACTERS = 25;
const CHARACTER_WIDTH = 8;
const TEXT_LINES = 8;
const BYTES_PER_LINE_PAIR = 20;
const BLANK_ROWS = 40;
/** a000:0028: video memory row 1. */
const TEXT_IN_VIDEO = 0x28;
const CLEARED_WORDS = 0xc8;
const SEQUENCER_INDEX = 0x3c4;
const CRTC_INDEX = 0x3d4;
const DAC_WRITE_INDEX = 0x3c8;
const DAC_DATA = 0x3c9;
const INPUT_STATUS = 0x3da;
const TEXT_RED = 0x0a;
const TEXT_BLUE = 0x14;

function word(m, offset) {
  return m.u16(CODE + offset);
}

function setWord(m, offset, value) {
  m.set16(CODE + offset, value & 0xffff);
}

/** Wait until display, then until the next horizontal blank (3da bit 0). */
function waitHblank(vga) {
  vga.in8(INPUT_STATUS);
  vga.hblank();
}

/**
 * DOSBox draws a double-scanned row at its first scanline: a write in the hblank after that scanline (the blue
 * component that completes colour 1) only shows from the next row (the recording: row i has the green of pair i-1).
 */
function drawStartedRows(vga) {
  const scan = vga.beamScan;
  if (scan !== null) {
    scan.drawLinesTo(Math.ceil((vga.hblankWaits - 1) / scan.scanlinesPerLine));
  }
}

/** 0eb3:282d / 2b5c: glyph `character` into the 8 texture rows at `position` (and the ring copy 148h further). */
function putCharacter(m, position, character) {
  const mem = m.mem;
  const glyph = CODE + FONT + ((character - FIRST_CHARACTER) & 0xff) * GLYPH_BYTES;
  for (let row = 0; row < 8; row++) {
    const at = CODE + ((position + TEXTURE_ROW * row) & 0xffff);
    for (let column = 0; column < CHARACTER_WIDTH; column++) {
      const texel = mem[glyph + row + 8 * column];
      mem[at + column] = texel;
      mem[at + TEXTURE_COPY + column] = texel;
    }
  }
}

/** 0eb3:27e8: resources, black DAC, rows 0..9 cleared, the first 25 characters into the texture. */
function initialise(m) {
  const vga = m.vga;
  m.loadResource(CODE + UGU_NAME, CODE + UGU_POINTER);
  m.loadResource(CODE + UGU2_NAME, CODE + UGU2_POINTER);
  setDacBlack(vga);
  vga.out16(SEQUENCER_INDEX, 0x0f02);
  for (let offset = 0; offset < CLEARED_WORDS * 2; offset++) {
    vga.write(offset, 0);
  }
  vga.out16(SEQUENCER_INDEX, 0x0102);
  for (let i = 0; i < INITIAL_CHARACTERS; i++) {
    const textAt = word(m, TEXT_POINTER);
    setWord(m, TEXT_POINTER, textAt + 1);
    putCharacter(m, word(m, TEXTURE_POSITION), m.mem[CODE + textAt]);
    setWord(m, TEXTURE_POSITION, word(m, TEXTURE_POSITION) + CHARACTER_WIDTH);
  }
  setWord(m, TEXTURE_POSITION, word(m, TEXTURE_POSITION) - CHARACTER_WIDTH);
}

/**
 * The texel sampler of 0eb3:2920: 8 pixels (MSB = left) from texture row pointer `state.texel`, stepping through the
 * zoom table at `state.step`. A negative step jumps to cs:0 (always 0): the rest of the line is blank.
 */
function sampleByte(m, state, ugu) {
  const mem = m.mem;
  let value = 0;
  for (let bit = 0x80; bit !== 0; bit >>= 1) {
    let texel = mem[CODE + state.texel];
    let step = mem[ugu + state.step];
    state.step = (state.step + 1) & 0xffff;
    if (step & 0x80) {
      state.texel = 0;
      step = 0;
      texel = 0;
    }
    state.texel = (state.texel + step) & 0xffff;
    value |= texel & bit;
  }
  return value;
}

/** One screen row of the raster: CRTC offset, colour 1 = (10, green, 20) over two horizontal blanks. */
function rasterRow(m, ugu2, bp, sample) {
  const { vga, mem } = m;
  waitHblank(vga);
  vga.out16(CRTC_INDEX, (mem[ugu2 + bp] << 8) | 0x13);
  const next = (bp + 1) & 0xffff;
  sample();
  vga.out8(DAC_WRITE_INDEX, 1);
  vga.out8(DAC_DATA, TEXT_RED);
  vga.out8(DAC_DATA, mem[ugu2 + next]);
  waitHblank(vga);
  drawStartedRows(vga);
  vga.out8(DAC_DATA, TEXT_BLUE);
  sample();
  return (next + 1) & 0xffff;
}

/** 0eb3:28ab: one frame per timer tick until the text's terminating 0. */
function* scroll(m) {
  const vga = m.vga;
  const state = { texel: 0, step: 0 };
  for (;;) {
    yield* waitTick(m);
    for (let i = 0; i < LINE_BUFFER_BYTES; i++) {
      vga.write(TEXT_IN_VIDEO + i, m.mem[CODE + LINE_BUFFER + i]);
    }
    m.mem.fill(0, CODE + LINE_BUFFER, CODE + LINE_BUFFER + LINE_BUFFER_BYTES);
    const ugu = linear(word(m, UGU_POINTER), 0);
    const ugu2 = linear(word(m, UGU2_POINTER), 0);
    const tableAt = word(m, FRAME_TABLE_POINTER);
    let bp = word(m, tableAt);
    setWord(m, FRAME_TABLE_POINTER, tableAt + 2);
    const position = word(m, TEXTURE_POSITION);
    for (let line = 0; line < TEXT_LINES; line++) {
      state.texel = (position + CHARACTER_WIDTH + TEXTURE_ROW * line) & 0xffff;
      state.step = word(m, word(m, FRAME_TABLE_POINTER));
      let out = CODE + LINE_BUFFER + 40 * line;
      const sample = () => {
        m.mem[out++] = sampleByte(m, state, ugu);
      };
      for (let pair = 0; pair < BYTES_PER_LINE_PAIR; pair++) {
        bp = rasterRow(m, ugu2, bp, sample);
      }
    }
    for (let row = 0; row < BLANK_ROWS; row++) {
      bp = rasterRow(m, ugu2, bp, () => {});
    }
    let next = word(m, FRAME_TABLE_POINTER) + 2;
    if (next === FRAME_TABLE_END) {
      next = FRAME_TABLE_START;
    }
    setWord(m, FRAME_TABLE_POINTER, next);
    const countdown = (m.mem[CODE + FRAMES_TO_CHARACTER] - 1) & 0xff;
    m.mem[CODE + FRAMES_TO_CHARACTER] = countdown;
    if (countdown === 0) {
      m.mem[CODE + FRAMES_TO_CHARACTER] = CHARACTER_WIDTH;
      const textAt = word(m, TEXT_POINTER);
      const character = m.mem[CODE + textAt];
      if (character === 0) {
        return;
      }
      setWord(m, TEXT_POINTER, textAt + 1);
      putCharacter(m, word(m, TEXTURE_POSITION), character);
    }
    let texturePosition = word(m, TEXTURE_POSITION) + 1;
    if (texturePosition === RING_END) {
      texturePosition = RING_START;
    }
    setWord(m, TEXTURE_POSITION, texturePosition);
  }
}

/** 0eb3:27e8 (init), 0eb3:28ab (the scroller), 0eb3:27d5 (frees 'ugu' and 'ugu2'). */
export function* greetings(m) {
  initialise(m);
  yield* scroll(m);
  m.freeFrom(CODE + UGU_POINTER);
  m.freeFrom(CODE + UGU2_POINTER);
}
