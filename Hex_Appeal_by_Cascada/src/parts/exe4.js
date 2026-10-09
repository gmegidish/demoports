// exe4: the Eevi picture by Delsion (docs/disassembly/H4_eevi.md). Mode 12h retimed to 640x400 (527 lines,
// 59.71 Hz), a 16-grey picture copied plane by plane into video memory, then 512 retraces of palette fade:
// in, hold, out. The whole program is one routine, sub_1a43_0000; its copy and its palette scaling are fully
// unrolled in the original, and are ported here as the loops they unroll.
//
// Image layout (load segment 0): 0010:0000 the fade table, 0010:0200 the frame index, 0010:0205 the picture's
// palette, 0010:0235 the palette sent to the DAC, 0037 and 0fdb two raw RIX3 chunks (lines 0..199, 200..332).
import { linear } from '../machine.js';

const DATA_SEGMENT = 0x0010;
const FADE_TABLE = linear(DATA_SEGMENT, 0x0000);
const FRAME_INDEX = linear(DATA_SEGMENT, 0x0200);
const SOURCE_PALETTE = linear(DATA_SEGMENT, 0x0205);
const SHOWN_PALETTE = linear(DATA_SEGMENT, 0x0235);
const PALETTE_BYTES = 0x30;

/** The two RIX3 chunks: the palette is at +0x0a, the pixel data at +0x3a. */
const CHUNK_A_SEGMENT = 0x0037;
const CHUNK_B_SEGMENT = 0x0fdb;
const RIX_PALETTE_OFFSET = 0x000a;
const RIX_PIXELS_OFFSET = 0x003a;
/** The copy switches to chunk B before this line. */
const CHUNK_B_FIRST_LINE = 200;
const PICTURE_LINES = 333;
const PLANES = 4;
const BYTES_PER_PLANE_LINE = 0x50;
/** Map mask value for plane 0; rotated left once per plane (0x11, 0x22, 0x44, 0x88: the high nibble is ignored). */
const FIRST_MAP_MASK = 0x11;

/** 1a43:000a: the CRTC retiming written after mode 12h, as `out dx, ax` words (low byte = index). */
const CRTC_TWEAKS = [0x0e11, 0x0d06, 0x3e07, 0xc010, 0xac11, 0x8f12, 0x9815, 0x0616];
const ATTRIBUTE_PALETTE_REGISTERS = 16;
/** int 10h ax=1000h ends by setting bit 5 of the attribute index (palette address source: video on). */
const ATTRIBUTE_VIDEO_ON = 0x20;

const FADE_FRAMES = 0x200;
const FADE_SHIFT = 6;
const SCAN_CODE_ESCAPE = 1;
const SEQUENCER_INDEX = 0x3c4;
const SEQUENCER_DATA = 0x3c5;
const SEQUENCER_MAP_MASK = 2;
const CRTC_INDEX = 0x3d4;
const ATTRIBUTE_PORT = 0x3c0;
const INPUT_STATUS = 0x3da;

function rotateLeft8(value) {
  return ((value << 1) | (value >> 7)) & 0xff;
}

/** int 10h ax=1000h (BIOS): attribute palette register `index` = `value`. */
function setAttributePaletteRegister(vga, index, value) {
  vga.in8(INPUT_STATUS);
  vga.out8(ATTRIBUTE_PORT, index);
  vga.out8(ATTRIBUTE_PORT, value);
  vga.in8(INPUT_STATUS);
  vga.out8(ATTRIBUTE_PORT, ATTRIBUTE_VIDEO_ON);
}

/** 1a43:0000..003d: mode 12h, 400 visible lines, identity attribute palette. */
function setEeviMode(m) {
  const vga = m.vga;
  // int 0x80 fn 0x1d before the mode set and again after the palette loop: one off/on pair.
  m.pauseMusic();
  vga.setMode12();
  for (const word of CRTC_TWEAKS) {
    vga.out16(CRTC_INDEX, word);
  }
  // cx = 16..1: bl = bh = 16 - cx.
  for (let cx = ATTRIBUTE_PALETTE_REGISTERS; cx >= 1; cx--) {
    const register = ATTRIBUTE_PALETTE_REGISTERS - cx;
    setAttributePaletteRegister(vga, register, register);
  }
}

/** 1a43:0044 and 1a43:3dc3: out 3c8, 0; rep outsb 48 bytes of the shown palette. */
function sendShownPalette(m) {
  m.vga.dacLoad(0, m.mem, SHOWN_PALETTE, PALETTE_BYTES);
}

/**
 * 1a43:0061..3d9c: the unrolled copy. For each line, for each plane: out 3c5 mask; rol al, 1; rep movsb 80 bytes
 * to A000:di; sub di, 0x50. Then add di, 0x50. Before line 200 ds:si moves to the second chunk.
 */
function copyPicture(m) {
  const vga = m.vga;
  const mem = m.mem;
  vga.out8(SEQUENCER_INDEX, SEQUENCER_MAP_MASK);
  let mapMask = FIRST_MAP_MASK;
  let source = linear(CHUNK_A_SEGMENT, RIX_PIXELS_OFFSET);
  let destination = 0;
  for (let line = 0; line < PICTURE_LINES; line++) {
    if (line === CHUNK_B_FIRST_LINE) {
      source = linear(CHUNK_B_SEGMENT, RIX_PIXELS_OFFSET);
    }
    for (let plane = 0; plane < PLANES; plane++) {
      vga.out8(SEQUENCER_DATA, mapMask);
      mapMask = rotateLeft8(mapMask);
      for (let i = 0; i < BYTES_PER_PLANE_LINE; i++) {
        vga.write(destination + i, mem[source + i]);
      }
      source += BYTES_PER_PLANE_LINE;
    }
    destination += BYTES_PER_PLANE_LINE;
  }
}

/** 1a43:3dd7: bl = fadeTable[frameIndex]; 48 x (lodsb; mul bl; shr ax, 6; stosb). */
function computeShownPalette(m) {
  const mem = m.mem;
  const brightness = mem[FADE_TABLE + m.u16(FRAME_INDEX)];
  for (let i = 0; i < PALETTE_BYTES; i++) {
    mem[SHOWN_PALETTE + i] = ((mem[SOURCE_PALETTE + i] * brightness) >> FADE_SHIFT) & 0xff;
  }
}

/** 1a43:0000 (entry point): the whole part. */
export function* runEevi(m) {
  setEeviMode(m);
  sendShownPalette(m);
  copyPicture(m);
  // 1a43:3d9f: rep movsb 48 bytes 0037:000a -> 0010:0205.
  const chunkPalette = linear(CHUNK_A_SEGMENT, RIX_PALETTE_OFFSET);
  m.mem.copyWithin(SOURCE_PALETTE, chunkPalette, chunkPalette + PALETTE_BYTES);

  // 1a43:3db4: the fade loop. It shows the palette computed in the previous iteration, so the first retrace
  // is black and fadeTable[511] is never shown.
  do {
    while (m.frameCounter === 0) {
      yield;
    }
    m.frameCounter = 0;
    sendShownPalette(m);
    computeShownPalette(m);
    m.set16(FRAME_INDEX, (m.u16(FRAME_INDEX) + 1) & 0xffff);
    m.exitCode = 1;
    if (m.readKeyboard() === SCAN_CODE_ESCAPE) {
      return;
    }
    m.exitCode = 0;
  } while (m.u16(FRAME_INDEX) < FADE_FRAMES);
}
