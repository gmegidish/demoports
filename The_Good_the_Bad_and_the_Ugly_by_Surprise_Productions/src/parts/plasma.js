// The plasma (Erik), 0cf9:01dd. docs/disassembly/G3_plasma_morph_chess.md, section 1.
//
// A 960x271 plasma is drawn once into unchained video memory (in the credits' 16-colour mode, before the mode
// change). Then a loop that is NOT locked to the retrace shows a 320x100 window of it: per iteration the start
// address and 128 cycling DAC colours change, and the CRTC offset is rewritten before every 4-scanline row, timed
// by horizontal retrace waits (4 per row, 99 rows: 396 waits). The music runs on the BIOS timer meanwhile; the loop
// ticks the player itself once per iteration. Because 396 waits are slightly less than a frame, the loop drifts up
// the screen and every frame shows a tear between two iterations, as in the recording.
import { linear } from '../machine.js';
import { setDac, interpolatePalette, setUnchained256 } from '../library.js';

const PLASMA_SEGMENT = 0x0cf9;
const VARIABLES = linear(PLASMA_SEGMENT, 0);
/** cs:[0] kp3_sin, cs:[2] kp3_sin2, cs:[1c] the fade buffer. */
const SINE_POINTER = VARIABLES + 0x00;
const TABLES_POINTER = VARIABLES + 0x02;
const START_INDEX = VARIABLES + 0x14;
const OFFSET_INDEX = VARIABLES + 0x16;
const FADE_BUFFER_POINTER = VARIABLES + 0x1c;
const FADE_OFFSET = VARIABLES + 0x8b;
const CYCLE_OFFSET = VARIABLES + 0x1da;
const FADE_DIVIDER = VARIABLES + 0x1dc;

/** kp3_sin2: row offsets (words), start addresses (500 words), target palette. */
const START_TABLE = 0x156e;
const TARGET_PALETTE = 0x1a20;
const START_INDEX_WRAP = 0x3e8;
const OFFSET_INDEX_STEP = 4;
const OFFSET_INDEX_WRAP = 0x11f8;
const FADE_BUFFER_PARAGRAPHS = 0xe11;
const FADE_TARGET = 0xd500;
const PALETTE_BYTES = 0x300;
const FADE_STEPS = 0x46;
const FADE_LAST = 0xd200;
const CYCLE_STEP = 12;
const CYCLE_WRAP = 0x180;
const CYCLED_COLOURS = 0x80;

/** 0165/008d: the virtual screen, 960 x 271 pixels from byte 400 on. */
const VIRTUAL_WIDTH = 960;
const VIRTUAL_ROWS = 0x10f;
const VIRTUAL_START = 0x190;
const SINE_MASK = 0x3ff;
const COLOUR_MASK = 0x7f;

const SEQUENCER_INDEX = 0x3c4;
const CRTC_INDEX = 0x3d4;
const MAP_MASK_INDEX = 2;
const SCREEN_OFF = 0x20;
const CRTC_OFFSET = 0x13;
/** The offset written around the rows: 160 words. */
const OFFSET_OUTSIDE_ROWS = 0xa0;
/** Offset of one virtual row (240 bytes) plus the row's table delta. */
const OFFSET_ONE_ROW = 0x78;
const FIRST_DI = 0x28;
const ROWS = 0x63;
const HBLANKS_PER_ROW = 4;
const SYNC_TO_START = 2;
const SYNC_TO_END = 3;

/**
 * DOSBox's 3da bit 0 is set in horizontal and vertical blanking alike, so a horizontal retrace wait counts the
 * end of each of the 400 displayed lines and the vertical blank is part of the wait after line 399: 400 waits
 * per frame. (Measured: the loop's tear climbs 4 scanlines per frame, 396 waits per iteration.)
 */
const HBLANK_WAITS_PER_FRAME = 400;
/**
 * The precalculation (0165 render + 0036 fade table) is CPU-bound: retraces from the effect's start until the
 * music check, measured so that the loop starts at the retrace before frame 3720 (G3 its.json).
 */
const PRECALC_RETRACES = 28;
/**
 * The music tick (008e:1f63) of some iterations takes longer than the rest of the scanline it starts in: the loop
 * then loses 2 horizontal retraces (iteration length 398 instead of 396). In the recording this happens on 80 of
 * the 81 ticks that start notes on 3 or more GUS voices, on about a third of the rows with 1 or 2 notes and on a
 * few ticks without a row; the GUS/DOSBox I/O timing behind it cannot be derived from the code. So the iterations
 * measured in the recording (G3 its.json: the tear position of every iteration 13..1438) are listed here, and
 * the rule "a row with 3 or more notes" covers the iterations outside that range.
 */
const ROW_TICK_LOST_HBLANKS = 2;
/**
 * Horizontal retraces between the retrace the loop starts at (0217..0222) and its first wait's count: the tear
 * positions of the recording are 2 scanlines lower than a loop starting at the first wait of the frame.
 */
const LOOP_START_HBLANKS = 2;
/**
 * When an iteration's rows start in the middle of a 4-scanline row (the screen-off at hblank wait count = 2 mod
 * 4), the recording shows the black band 2 scanlines longer: the screen-on (and only it) is shown 2 scanlines later.
 * Measured; the order of the writes in the row is otherwise kept.
 */
const MID_ROW_PHASE = 2;
const MID_ROW_SCREEN_ON_DELAY = 2;
const MEASURED_FIRST = 13;
const MEASURED_LAST = 1438;
const SLOW_TICK_ITERATIONS = new Set([
  31, 42, 53, 64, 75, 97, 104, 108, 119, 130, 141, 152, 163, 185, 196, 207, 210, 229, 240, 251, 262, 273, 284, 295,
  306, 317, 328, 339, 350, 361, 383, 394, 405, 416, 419, 426, 438, 449, 460, 471, 493, 504, 515, 523, 537, 548, 559,
  581, 592, 603, 614, 625, 627, 636, 647, 669, 680, 691, 713, 724, 731, 735, 757, 779, 790, 812, 823, 835, 845, 867,
  878, 900, 911, 933, 938, 955, 966, 977, 988, 999, 1021, 1032, 1042, 1065, 1087, 1098, 1109, 1120, 1131, 1142, 1147,
  1153, 1164, 1175, 1186, 1197, 1208, 1219, 1230, 1241, 1252, 1263, 1274, 1285, 1296, 1307, 1318, 1329, 1340, 1351,
  1357, 1362, 1373, 1384, 1395, 1406, 1417
]);
const NOTES_FOR_SLOW_TICK = 3;

/** Waits for `count` horizontal retraces, crossing into the next frame (a retrace) when the beam passes line 399. */
function* waitHblanks(vga, count) {
  for (let i = 0; i < count; i++) {
    if (vga.hblankWaits >= HBLANK_WAITS_PER_FRAME) {
      yield;
    }
    vga.hblank();
  }
}

/** 0165 / 008d / 0120 / 00f8: the plasma, one OUT to the map mask per pixel, written in the current (16-colour) mode. */
function drawVirtualScreen(m) {
  const vga = m.vga;
  const sine = linear(m.u16(SINE_POINTER), 0);
  const mem = m.mem;
  const constantTerm = mem[sine];
  let address = VIRTUAL_START;
  for (let y = 0; y < VIRTUAL_ROWS; y++) {
    const rowTerm = mem[sine + ((4 * y) & SINE_MASK)];
    for (let x = 0; x < VIRTUAL_WIDTH; x++) {
      const colour = ((mem[sine + ((x + y) & SINE_MASK)] + constantTerm + rowTerm) & COLOUR_MASK) + 1;
      const plane = x & 3;
      vga.out16(SEQUENCER_INDEX, ((1 << plane) << 8) | MAP_MASK_INDEX);
      vga.write(address, colour);
      if (plane === 3) {
        address++;
      }
    }
  }
  m.set16(VARIABLES + 0xf4, 0x0102);
}

/** 0036: the fade buffer: palette m at 300h*m, m = 1..70 the target times (m-1)/70, m = 71 the target. */
function buildFadeTable(m) {
  const buffer = linear(m.allocTo(FADE_BUFFER_POINTER, FADE_BUFFER_PARAGRAPHS), 0);
  const tables = linear(m.u16(TABLES_POINTER), 0);
  m.mem.copyWithin(buffer + FADE_TARGET, tables + TARGET_PALETTE, tables + TARGET_PALETTE + PALETTE_BYTES);
  m.mem.fill(0, buffer, buffer + PALETTE_BYTES);
  let out = buffer + PALETTE_BYTES;
  for (let step = 0; step < FADE_STEPS; step++) {
    interpolatePalette(m, 0x100, buffer, buffer + FADE_TARGET, out, step, FADE_STEPS);
    out += PALETTE_BYTES;
  }
}

function setStartAddress(vga, address) {
  vga.out16(CRTC_INDEX, (address & 0xff00) | 0x0c);
  vga.out16(CRTC_INDEX, ((address & 0xff) << 8) | 0x0d);
}

function setScreenOff(vga, isOff) {
  vga.out8(SEQUENCER_INDEX, 1);
  const value = vga.sequencer[1];
  vga.out8(SEQUENCER_INDEX + 1, isOff ? value | SCREEN_OFF : value & ~SCREEN_OFF);
}

/** Whether the music tick of loop iteration `iteration` (0 = the first) costs 2 horizontal retraces. */
function isTickSlow(m, iteration) {
  if (iteration >= MEASURED_FIRST && iteration <= MEASURED_LAST) {
    return SLOW_TICK_ITERATIONS.has(iteration);
  }
  return m.song !== null && m.song.tickInRow === 0 && m.song.notesInNextRow() >= NOTES_FOR_SLOW_TICK;
}

/** 0224..0291: start address, cycled DAC colours, fade step, music tick (the work before the row waits). */
function* runIterationWork(m, tables, buffer, iteration) {
  const vga = m.vga;
  setStartAddress(vga, m.u16(tables + START_TABLE + m.u16(START_INDEX)));
  setDac(m, 1, CYCLED_COLOURS, buffer + m.u16(FADE_OFFSET) + m.u16(CYCLE_OFFSET));
  let cycle = m.u16(CYCLE_OFFSET) + CYCLE_STEP;
  if (cycle >= CYCLE_WRAP) {
    cycle -= CYCLE_WRAP;
  }
  m.set16(CYCLE_OFFSET, cycle);
  if (m.u16(FADE_OFFSET) <= FADE_LAST) {
    m.set8(FADE_DIVIDER, (m.u8(FADE_DIVIDER) + 1) & 3);
    if (m.u8(FADE_DIVIDER) === 0) {
      m.set16(FADE_OFFSET, m.u16(FADE_OFFSET) + PALETTE_BYTES);
    }
  }
  const isSlowTick = isTickSlow(m, iteration);
  m.tickMusic(); // 0292 008e:1f63
  if (isSlowTick) {
    yield* waitHblanks(vga, ROW_TICK_LOST_HBLANKS);
  }
  let startIndex = m.u16(START_INDEX) + 2;
  if (startIndex >= START_INDEX_WRAP) {
    startIndex -= START_INDEX_WRAP;
  }
  m.set16(START_INDEX, startIndex);
}

/** 02ad..0333: the 99 rows, each offset written right before its 4 horizontal retrace waits. */
function* runRows(m, tables) {
  const vga = m.vga;
  const isMidRowStart = vga.hblankWaits % HBLANKS_PER_ROW === MID_ROW_PHASE;
  vga.out16(CRTC_INDEX, (OFFSET_OUTSIDE_ROWS << 8) | CRTC_OFFSET);
  let di = FIRST_DI;
  let si = tables + m.u16(OFFSET_INDEX);
  setScreenOff(vga, true);
  for (let row = 0; row < ROWS; row++) {
    const bp = m.u16(si);
    si += 2;
    const offset = (bp - di + OFFSET_ONE_ROW) & 0xff;
    di = bp;
    vga.out16(CRTC_INDEX, (offset << 8) | CRTC_OFFSET);
    let waits = HBLANKS_PER_ROW;
    if (row === 1) {
      // 02ec: the screen comes back on after the first row's 4 waits (shown later when that is mid-row, see above).
      if (isMidRowStart) {
        yield* waitHblanks(vga, MID_ROW_SCREEN_ON_DELAY);
        waits -= MID_ROW_SCREEN_ON_DELAY;
      }
      setScreenOff(vga, false);
    }
    yield* waitHblanks(vga, waits);
  }
  let offsetIndex = m.u16(OFFSET_INDEX) + OFFSET_INDEX_STEP;
  if (offsetIndex >= OFFSET_INDEX_WRAP) {
    offsetIndex -= OFFSET_INDEX_WRAP;
  }
  m.set16(OFFSET_INDEX, offsetIndex);
  vga.out16(CRTC_INDEX, (OFFSET_OUTSIDE_ROWS << 8) | CRTC_OFFSET);
}

/** 0cf9:01dd. */
export function* plasma(m) {
  const vga = m.vga;
  drawVirtualScreen(m); // 0165
  buildFadeTable(m); // 0036
  for (let i = 0; i < PRECALC_RETRACES; i++) {
    yield;
  }
  setStartAddress(vga, 0);
  setUnchained256(vga); // 0299:0175
  vga.out8(CRTC_INDEX, 9);
  vga.out8(CRTC_INDEX + 1, (vga.in8(CRTC_INDEX + 1) & 0xe0) | 1);
  while (m.musicSync < SYNC_TO_START) {
    yield;
  }
  // 0731:0158 waits for the retrace start with interrupts off and then restores the BIOS timer: the retrace IRQ of
  // that retrace does not tick the music any more (the recording's plasma ends one music tick later than with it).
  m.setTimer('bios');
  yield;
  yield; // 0217..0222: the next vertical retrace start
  yield* waitHblanks(vga, LOOP_START_HBLANKS);
  const tables = linear(m.u16(TABLES_POINTER), 0);
  const buffer = linear(m.u16(FADE_BUFFER_POINTER), 0);
  for (let iteration = 0; ; iteration++) {
    yield* runIterationWork(m, tables, buffer, iteration);
    yield* runRows(m, tables);
    if (m.musicSync === SYNC_TO_END) {
      return;
    }
  }
}
