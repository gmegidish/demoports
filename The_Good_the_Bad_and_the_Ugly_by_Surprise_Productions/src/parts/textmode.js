// The opening (Peci's "Textmode-routines" and the 08d8 cube): 11d6:000a, 08d8:196e, 11d6:032c.
// docs/disassembly/G2_textmode_intro_credits.md sections 1 and 2.
//
// 11d6:000a fades the DOS screen to gray and copies the text into plane 3 of a 640x400 16-colour mode before demo
// time 0; the recording never shows that plane again (G2 notes), so the port starts at the mode switch with the
// fade's end state and an empty plane 3. The cubes are drawn by the shared engine with 40-byte lines into a mode
// that shows 80-byte lines: two half-size cubes side by side, as in the recording.
import { linear } from '../machine.js';
import * as lib from '../library.js';
import * as engine from '../engine3d.js';

const TEXT_SEGMENT = 0x11d6;
const FONT_BUFFER_POINTER = 0x0006;
const PALETTE_BUFFER_POINTER = 0x0008;
const FONT_BUFFER_PARAGRAPHS = 0x400;
const PALETTE_BUFFER_PARAGRAPHS = 0x24;
/** 11d6:0323: DAC 1..3 for the cube faces. */
const CUBE_COLOURS = 0x0323;
const FADED_COLOURS = 0x3f;
const FADE_STEPS = 0x46;
const GRAY = 0x14;
/** int 10h ah=3 in DOSBox: cursor lines 6..7; the row is overwritten with 64h, so the cursor lands at 0xf5e0. */
const CURSOR_START_LINE = 6;
const CURSOR_END_LINE = 7;
const CURSOR_ROW_BUG = 0x64;
/** b800:(col + 100*160 + 1): DOSBox fills b800 with 0720h, so the cursor colour is 7. */
const CURSOR_COLOUR = 0x07;
const CURSOR_SAVE = 0xffdc;
const ROW_BYTES = 80;

const SEQUENCER_INDEX = 0x3c4;
const GRAPHICS_INDEX = 0x3ce;
const CRTC_INDEX = 0x3d4;
const ATTRIBUTE_PORT = 0x3c0;
const MISC_READ = 0x3cc;
const MISC_WRITE = 0x3c2;

/** `out 3ce, 5` then read-modify-write of the mode register: write mode `mode`. */
function setWriteMode(vga, mode) {
  vga.out8(GRAPHICS_INDEX, 5);
  vga.out8(GRAPHICS_INDEX + 1, (vga.graphics[5] & 0xf4) | mode);
}

function setSequencer1(vga, value) {
  vga.out8(SEQUENCER_INDEX, 1);
  vga.out8(SEQUENCER_INDEX + 1, value);
}

/** The DAC read and target of 11d6:000a, and the last of its 70 fade steps (the fade runs before demo time 0). */
function applyGrayFade(m) {
  const vga = m.vga;
  const buffer = linear(m.u16(linear(TEXT_SEGMENT, PALETTE_BUFFER_POINTER)), 0);
  vga.out8(0x3c7, 0);
  for (let i = 0; i < 0xc0; i++) {
    m.mem[buffer + i] = vga.in8(0x3c9);
  }
  m.mem.fill(0, buffer + 0xc0, buffer + 0xc3);
  m.mem.fill(GRAY, buffer + 0xc3, buffer + 0x180);
  lib.interpolatePalette(m, FADED_COLOURS, buffer, buffer + 0xc0, buffer + 0x180, FADE_STEPS, FADE_STEPS);
  lib.setDac(m, 0, FADED_COLOURS, buffer + 0x180);
}

/** 11d6:000a from the switch to 640x400 graphics: the register writes after the second retrace wait, the cursor. */
export function* textToGraphics(m) {
  const vga = m.vga;
  m.allocTo(linear(TEXT_SEGMENT, FONT_BUFFER_POINTER), FONT_BUFFER_PARAGRAPHS);
  m.allocTo(linear(TEXT_SEGMENT, PALETTE_BUFFER_POINTER), PALETTE_BUFFER_PARAGRAPHS);
  applyGrayFade(m);
  m.set16(linear(TEXT_SEGMENT, 0), ((CURSOR_ROW_BUG * 16 + CURSOR_START_LINE) * ROW_BYTES) & 0xffff);
  m.set16(linear(TEXT_SEGMENT, 2), CURSOR_END_LINE - CURSOR_START_LINE + 1);
  m.set8(linear(TEXT_SEGMENT, 5), CURSOR_COLOUR & 0x0f);
  // 0179..019d: the 25 MHz clock and 8-dot characters; start address 8000h.
  vga.out8(MISC_WRITE, vga.in8(MISC_READ) & 0xf3);
  vga.out16(SEQUENCER_INDEX, 0x0100);
  vga.out16(SEQUENCER_INDEX, 0x0101);
  vga.out16(SEQUENCER_INDEX, 0x0300);
  engine.setStartAddress(m, 0x8000);
  // 01c7..021d: graphics mode, byte mode, one scan line per row: 640x400x16.
  setSequencer1(vga, vga.sequencer[1] | 0x20);
  vga.out16(GRAPHICS_INDEX, 0x0506);
  vga.in8(0x3da);
  vga.out8(ATTRIBUTE_PORT, 0x30);
  vga.out8(ATTRIBUTE_PORT, 0x01);
  vga.isTextMode = false;
  vga.out16(CRTC_INDEX, 0xe317);
  vga.out8(CRTC_INDEX, 9);
  vga.out8(CRTC_INDEX + 1, vga.crtc[9] & 0xe0);
  setSequencer1(vga, vga.sequencer[1] & 0xdf);
  setWriteMode(vga, 1);
  vga.out16(SEQUENCER_INDEX, 0x0f02);
  for (let offset = 0; offset < 0x7d00; offset++) {
    vga.read(0x8000 + offset);
    vga.write(offset, 0);
  }
  setWriteMode(vga, 0);
  engine.setStartAddress(m, 0);
  setWriteMode(vga, 1);
  yield; // 0269: the blink loop's retrace wait (it runs once)
  drawCursor(m);
  setWriteMode(vga, 0);
  m.freeFrom(linear(TEXT_SEGMENT, FONT_BUFFER_POINTER));
  m.freeFrom(linear(TEXT_SEGMENT, PALETTE_BUFFER_POINTER));
  lib.setDac(m, 1, 3, linear(TEXT_SEGMENT, CUBE_COLOURS));
}

/** 029f..02e8: saves the cursor cells (latch copy) and draws the cursor in colour [5]. */
function drawCursor(m) {
  const vga = m.vga;
  m.set8(linear(TEXT_SEGMENT, 4), 0xff);
  const cursor = m.u16(linear(TEXT_SEGMENT, 0));
  const lines = m.u16(linear(TEXT_SEGMENT, 2));
  let source = cursor;
  let destination = CURSOR_SAVE;
  for (let i = 0; i < lines; i++) {
    vga.read(source);
    vga.write(destination, 0);
    source = (source + ROW_BYTES) & 0xffff;
    destination = (destination + ROW_BYTES) & 0xffff;
  }
  setWriteMode(vga, 0);
  const colour = m.u8(linear(TEXT_SEGMENT, 5));
  let at = cursor;
  for (let i = 0; i < lines; i++) {
    vga.out16(SEQUENCER_INDEX, 0x0f02);
    vga.write(at, 0);
    vga.out16(SEQUENCER_INDEX, 0x0002 | (colour << 8));
    vga.write(at, 0xff);
    at = (at + ROW_BYTES) & 0xffff;
  }
}

const CUBE_OBJECT = 0x05ca;
const CUBE_PLANES = 2;
const LATER_PLANES = 4;
const CUBE_DISTANCE = 0x7530;
const CUBE_X_CENTRE = 0xa0;
const CUBE_Y_CENTRE = 0x64;
const Y_DOUBLED = 2;
const CLEAR_PLANES_0_1 = 0x0302;
const CLEAR_ALL_PLANES = 0x0f02;
const APPROACH = 0xe1;
/** 196e: (frames, distance step) of the three phases. */
const CUBE_PHASES = [[0x78, APPROACH], [0xc8, 0], [0x78, -APPROACH]];

/** 08d8:196e: the two blue cubes. */
export function* blueCubes(m) {
  const at = (offset) => engine.ENGINE_SEGMENT_BASE + offset;
  const E = engine.ENGINE;
  m.set16(at(E.Y_CENTRE), CUBE_Y_CENTRE);
  m.set16(at(E.CLEAR_MAP_MASK), CLEAR_PLANES_0_1);
  m.set16(at(E.DISTANCE), CUBE_DISTANCE);
  m.set16(at(E.X_CENTRE), CUBE_X_CENTRE);
  m.set16(at(E.ROLL_SPEED), 0);
  m.set16(at(E.APPROACH_SPEED), 0);
  m.set8(at(E.Y_MODE), Y_DOUBLED);
  m.set16(linear(CUBE_OBJECT, 0), CUBE_PLANES);
  for (const [frames, approach] of CUBE_PHASES) {
    m.set16(at(E.APPROACH_SPEED), approach);
    for (let i = 0; i < frames; i++) {
      yield* cubeFrame(m);
    }
  }
  m.set8(at(E.Y_MODE), 0);
  m.set16(at(E.FILL_SEGMENT), 0xa000);
  m.set16(linear(CUBE_OBJECT, 0), LATER_PLANES);
  m.set16(at(E.CLEAR_MAP_MASK), CLEAR_ALL_PLANES);
}

/** 08d8:15db: one frame: flip (14e6), clear, boxes, draw, then 1535 and the x/distance steps. */
function* cubeFrame(m) {
  const at = (offset) => engine.ENGINE_SEGMENT_BASE + offset;
  const E = engine.ENGINE;
  yield* engine.flipPageRetrace(m);
  engine.drawObjectFrame(m, CUBE_OBJECT);
  engine.stepAngles(m);
  m.set16(at(E.X_CENTRE), m.u16(at(E.X_CENTRE)) + m.u16(at(E.ROLL_SPEED)));
  m.set16(at(E.DISTANCE), m.u16(at(E.DISTANCE)) - m.u16(at(E.APPROACH_SPEED)));
}

/** 11d6:032c: DAC 0..62 from the current palette to black in 70 retraces. */
export function* fadeTextPart(m) {
  const vga = m.vga;
  const buffer = linear(m.allocTo(linear(TEXT_SEGMENT, PALETTE_BUFFER_POINTER), PALETTE_BUFFER_PARAGRAPHS), 0);
  vga.out8(0x3c7, 0);
  for (let i = 0; i < 0xc0; i++) {
    m.mem[buffer + i] = vga.in8(0x3c9);
  }
  m.mem.fill(0, buffer + 0xc0, buffer + 0x180);
  yield* lib.fadePalette(m, {
    colours: FADED_COLOURS, from: buffer, to: buffer + 0xc0, work: buffer + 0x180, steps: FADE_STEPS, first: 0,
  });
  m.freeFrom(linear(TEXT_SEGMENT, PALETTE_BUFFER_POINTER));
}
