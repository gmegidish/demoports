// Part 2's two oscilloscopes. Both listen to two of the replayer's channels (the structures at $66654 and
// $666e4), play the samples back themselves at the note's pitch, and draw what they "hear" into a
// double-buffered plane:
// - scope1 ($d1c6, script effect 8): a jagged line across a 352-pixel wide lores screen, 44 blitter lines from
//   left to right, over a static second plane; colours 1 and 3 flash from a table.
// - scope2 ($d4e2, script effect 9): a symmetric shape, mirrored around the middle of a 320-pixel screen,
//   plotted as dots with the CPU and filled with the blitter, as the 5th plane over a 4-plane picture whose two
//   16-colour palettes rotate in opposite directions every frame.
// Each is called by part 2's dispatcher ($ce48) and returns where the original does `jmp $d956` (the
// dispatcher runs that common tail itself). Everything is read and written in chip RAM at the original
// addresses; the replayer's channel structures are only read (and their "new note" flags cleared), never called.
//
// The dispatcher enters both with D0 and D1 holding the main loop's values in their upper words (zero: mt_init
// ends with moveq #0,d0 and leaves d1 = 0), which the original's `move.w` + `divu.w` / `addi.l` rely on.
import { r8, r16, r32, w8, w16, w32, s8, s16, pokeCopperPointer } from '../machine.js';
import { custom, custom32 } from '../display.js';

/**
 * @typedef {object} EffectRegisters
 * @property {number} a0 on an entry's first frame: the address of its parameter words in the script
 * @property {number} a1 on an entry's first frame: the effect table entry's parameters (entry + 8)
 */

/**
 * Where one scope keeps its own playback of the two channels: per channel the step (sample bytes per drawn
 * point), the play position, and the position saved at the start of the frame.
 * @typedef {object} PlaybackState
 * @property {number} stepA
 * @property {number} stepB
 * @property {number} positionA
 * @property {number} positionB
 * @property {number} savedA
 * @property {number} savedB
 */

/** Set by the dispatcher on the first frame of a script entry, cleared by the $d956 tail. */
const FIRST_FRAME = 0xa6bc;
const SCRIPT_INDEX = 0xa6ee;

// ---- the replayer's channel structures ($66654 = channel 1, $666e4 = channel 2) --------------------------------
const CHANNEL_A = 0x66654;
const CHANNEL_B = 0x666e4;
const CHANNEL_SAMPLE = 0x04;
/** In words. */
const CHANNEL_LENGTH = 0x08;
/** The repeat length in words: 1 means "no loop". */
const CHANNEL_REPEAT = 0x0e;
const CHANNEL_PERIOD = 0x10;
const CHANNEL_VOLUME = 0x13;
/** Set by the replayer when a note starts; the scopes restart their playback and clear it. */
const CHANNEL_NEW_NOTE = 0x2a;
const NO_LOOP = 1;
/** Sample bytes Paula plays in one frame, times the period: 3546895 / 50. */
const BYTES_PER_FRAME_TIMES_PERIOD = 0x117a7;

// ---- the custom chips ---------------------------------------------------------------------------------------
const BLTCON0 = 0x40;
const BLTAFWM = 0x44;
const BLTCPT = 0x48;
const BLTAPT = 0x50;
const BLTAPTL = 0x52;
const BLTDPT = 0x54;
const BLTSIZE = 0x58;
const BLTCMOD = 0x60;
const BLTBMOD = 0x62;
const BLTAMOD = 0x64;
const BLTDMOD = 0x66;
const BLTBDAT = 0x72;
const BLTADAT = 0x74;
/** `move.l #$1000000,$40(a5)`: D only, minterm 0. */
const CLEAR_CON = 0x01000000;

// ---- scope1 ($d1c6) -------------------------------------------------------------------------------------------
/** Colour words, ended by a negative one; one per frame. */
const FLASH_TABLE = 0x562f4;
const FLASH_INDEX = 0x562f2;
/** The values of the copper list's COLOR01 and COLOR03 moves (the list starts at $4de92). */
const COLOUR1_VALUE = 0x4dec4;
const COLOUR3_VALUE = 0x4decc;
/** BPL1PTH/BPL1PTL values in the copper list. */
const SCOPE1_PLANE_COPPER = 0x4deb4;
const SCOPE1_FRONT = 0x536ea;
const SCOPE1_BACK = 0x536ee;
const SCOPE1_BUFFER_A = 0x4deea;
const SCOPE1_BUFFER_B = 0x50aea;
/** 256 lines of 22 words: 352 pixels, 44 bytes a line. */
const SCOPE1_CLEAR_SIZE = 0x4016;
const SCOPE1_BYTES_PER_LINE = 0x2c;
const SCOPE1_STEP_NUMERATOR = 0x83a;
/** @type {PlaybackState} */
const SCOPE1_PLAYBACK = {
  stepA: 0x4dede, stepB: 0x4dee0, positionA: 0x4dee2, positionB: 0x4dee4, savedA: 0x4dee6, savedB: 0x4dee8,
};
const SCOPE1_SEGMENTS = 0x2b;
const SCOPE1_SEGMENT_WIDTH = 8;
const SCOPE1_MIDDLE = 0x7f;
const SCOPE1_ZERO_LEVEL = 0x80;
/** $d4da: BLTCON1 octant codes (with LINE set), by (up << 2) | (left << 1) | (x is the major axis). */
const OCTANTS = [0x01, 0x11, 0x09, 0x15, 0x05, 0x19, 0x0d, 0x1d];
const SIGN = 0x40;
/** A, C and D, minterm $ca: D = A | C with an all-ones texture. */
const LINE_CON0 = 0x0bca;
const LINE_POINT = 0x8000;
const LINE_TEXTURE = 0xffff;
const LINE_WIDTH = 2;

// ---- scope2 ($d4e2) -------------------------------------------------------------------------------------------
/** The copper list starts at $56436. These are the values of its moves. */
const BPL1MOD_VALUE = 0x56450;
const BPL2MOD_VALUE = 0x56454;
const PICTURE_PLANES_COPPER = 0x56458;
const SCOPE2_PLANE_COPPER = 0x56478;
/** COLOR00..COLOR15 and COLOR16..COLOR31 values, one move (4 bytes) apart. */
const PALETTE_LOW = 0x56480;
const PALETTE_HIGH = 0x564c0;
const COPPER_MOVE_BYTES = 4;
const PALETTE_COLOURS = 16;
/** Set from the fourth script parameter: the dots are 4 lines high instead of 2. */
const THICK_DOTS = 0x56516;
const PICTURE = 0x5b520;
const PLANE_BYTES = 0x2800;
const PICTURE_PLANES = 4;
/** 16-colour palettes, 32 bytes each. */
const PALETTES = 0x65520;
const PALETTE_SHIFT = 5;
/** The first byte of the last line: the start when the picture is shown upside down. */
const LAST_LINE = 0x27d8;
/** -80: back one line after each line. */
const UPSIDE_DOWN_MODULO = 0xffb0;
const SCOPE2_PARAMETER_BYTES = 8;
const SCOPE2_FRONT = 0x5b518;
const SCOPE2_BACK = 0x5b51c;
const SCOPE2_BUFFER_A = 0x56518;
const SCOPE2_BUFFER_B = 0x58d18;
/** 256 lines of 20 words. */
const SCOPE2_SIZE = 0x4014;
const SCOPE2_STEP_NUMERATOR = 0x8be;
/** @type {PlaybackState} */
const SCOPE2_PLAYBACK = {
  stepA: 0x5650a, stepB: 0x5650c, positionA: 0x5650e, positionB: 0x56510, savedA: 0x56512, savedB: 0x56514,
};
const SCOPE2_ROWS = 0x20;
const SCOPE2_CENTRE = 0x9f;
const SCOPE2_WIDTH = 0x140;
/** The first row's offset in the plane: line 4. */
const SCOPE2_FIRST_ROW = 0xa0;
/** 8 lines of 40 bytes. */
const SCOPE2_ROW_BYTES = 0x140;
const LINE_BYTES = 0x28;
/** `move.l #$9f0000a,$40(a5)`: A to D, descending, inclusive fill. */
const FILL_CON = 0x09f0000a;
const FILL_START = 0x27fe;

// ---- the playback both scopes share -------------------------------------------------------------------------

/** `move.w #n,d1 / divu.w period,d1` with a period of 0 taken as 1. */
function stepFor(m, channel, numerator) {
  const period = r16(m, channel + CHANNEL_PERIOD) || 1;
  return Math.floor(numerator / period) & 0xffff;
}

/** $d264..$d2d8 / $d6de..$d752: steps from the periods, restart on a new note, remember where the frame starts. */
function startPlayback(m, state, numerator) {
  w16(m, state.stepA, stepFor(m, CHANNEL_A, numerator));
  w16(m, state.stepB, stepFor(m, CHANNEL_B, numerator));
  if (r16(m, CHANNEL_A + CHANNEL_NEW_NOTE)) {
    w16(m, state.positionA, 0);
  }
  if (r16(m, CHANNEL_B + CHANNEL_NEW_NOTE)) {
    w16(m, state.positionB, 0);
  }
  w16(m, state.savedA, r16(m, state.positionA));
  w16(m, state.savedB, r16(m, state.positionB));
  w16(m, CHANNEL_A + CHANNEL_NEW_NOTE, 0);
  w16(m, CHANNEL_B + CHANNEL_NEW_NOTE, 0);
}

/**
 * One channel's next sample times its volume ($d308..$d338). Past the sample's end it is silent, and the
 * position is stepped back so that the advance after it leaves it where it is.
 */
function channelLevel(m, channel, positionAt, stepAt) {
  const position = r16(m, positionAt);
  const remaining = ((r16(m, channel + CHANNEL_LENGTH) << 1) - position) & 0xffff;
  if (remaining & 0x8000) {
    w16(m, positionAt, position - r16(m, stepAt));
    return 0;
  }
  const sample = s8(r8(m, r32(m, channel + CHANNEL_SAMPLE) + s16(position)));
  return sample * r8(m, channel + CHANNEL_VOLUME);
}

/** Both channels mixed, `asr.l #7`, as the low word; the positions step on. */
function nextLevel(m, state) {
  const levelA = channelLevel(m, CHANNEL_A, state.positionA, state.stepA);
  const levelB = channelLevel(m, CHANNEL_B, state.positionB, state.stepB);
  w16(m, state.positionA, r16(m, state.positionA) + r16(m, state.stepA));
  w16(m, state.positionB, r16(m, state.positionB) + r16(m, state.stepB));
  return ((levelA + levelB) >> 7) & 0xffff;
}

/** `divu.w period,d0` of $117a7: on overflow the 68000 leaves d0 alone, and `add.w` takes its low word. */
function bytesPlayedInAFrame(period) {
  const quotient = Math.floor(BYTES_PER_FRAME_TIMES_PERIOD / period);
  return quotient > 0xffff ? BYTES_PER_FRAME_TIMES_PERIOD & 0xffff : quotient;
}

/** $d3d0..$d404 for one channel: what Paula played this frame; at the end, stop there (no loop) or restart. */
function advanceChannel(m, channel, positionAt) {
  const period = r16(m, channel + CHANNEL_PERIOD);
  if (!period) {
    return;
  }
  const position = (r16(m, positionAt) + bytesPlayedInAFrame(period)) & 0xffff;
  w16(m, positionAt, position);
  const end = (r16(m, channel + CHANNEL_LENGTH) << 1) & 0xffff;
  if (end > position) {
    return;
  }
  w16(m, positionAt, r16(m, channel + CHANNEL_REPEAT) === NO_LOOP ? end : 0);
}

/** $d3b4..$d43a / $d840..$d8c6: back to where the frame started, then on by one frame's worth. */
function endPlayback(m, state) {
  w16(m, state.positionA, r16(m, state.savedA));
  w16(m, state.positionB, r16(m, state.savedB));
  advanceChannel(m, CHANNEL_A, state.positionA);
  advanceChannel(m, CHANNEL_B, state.positionB);
}

/** `move.l` the two buffers' roles: the one shown last frame is drawn into now. Returns the new back buffer. */
function swapBuffers(m, frontAt, backAt, bufferA, bufferB) {
  const isAShown = r32(m, frontAt) === bufferA;
  w32(m, frontAt, isAShown ? bufferB : bufferA);
  w32(m, backAt, isAShown ? bufferA : bufferB);
  return r32(m, backAt);
}

function clearWithBlitter(m, address, size) {
  custom32(m, BLTDPT, address);
  custom32(m, BLTCON0, CLEAR_CON);
  custom(m, BLTDMOD, 0);
  custom(m, BLTSIZE, size);
}

// ---- scope1 -------------------------------------------------------------------------------------------------

/** Signed 16-bit comparison, as `bge` after a `sub.w` (or `cmp.w`) tests it. */
const isLessSigned = (a, b) => s16(a) < s16(b);

/**
 * $d442: a blitter line from (x0, y0) to (x1, y1) in the 352x256 plane at `plane`, OR-ed in. It plots the
 * long delta's count of pixels, so the end point is left for the next segment.
 */
function drawLine(m, x0, y0, x1, y1, plane) {
  const product = (SCOPE1_BYTES_PER_LINE * (y0 & 0xffff)) >>> 0;
  const start = (((product & 0xffff0000) | ((product + ((x0 & 0xfff0) >> 3)) & 0xffff)) + plane) >>> 0;
  const isUp = (y1 & 0xffff) < (y0 & 0xffff);
  let dy = (y1 - y0) & 0xffff;
  if (dy & 0x8000) {
    dy = -dy & 0xffff;
  }
  const isLeft = (x1 & 0xffff) < (x0 & 0xffff);
  let dx = (x1 - x0) & 0xffff;
  if (dx & 0x8000) {
    dx = -dx & 0xffff;
  }
  const isXMajor = dy < dx;
  let shortDelta = dx;
  let longDelta = dy;
  if (isLessSigned(dy, dx)) {
    shortDelta = dy;
    longDelta = dx;
  }
  let con1 = OCTANTS[(Number(isUp) << 2) | (Number(isLeft) << 1) | Number(isXMajor)];
  const twiceShort = (shortDelta * 2) & 0xffff;
  custom(m, BLTBMOD, twiceShort);
  if (isLessSigned(twiceShort, longDelta)) {
    con1 |= SIGN;
  }
  custom(m, BLTAPTL, twiceShort - longDelta);
  custom(m, BLTAMOD, twiceShort - 2 * longDelta);
  custom(m, BLTADAT, LINE_POINT);
  custom(m, BLTBDAT, LINE_TEXTURE);
  custom(m, BLTAFWM, 0xffff);
  custom(m, BLTCON0, ((x0 & 0xf) << 12) | LINE_CON0);
  custom(m, BLTCON0 + 2, con1);
  custom32(m, BLTCPT, start);
  custom32(m, BLTDPT, start);
  custom(m, BLTCMOD, SCOPE1_BYTES_PER_LINE);
  custom(m, BLTDMOD, SCOPE1_BYTES_PER_LINE);
  custom(m, BLTSIZE, (longDelta << 6) + LINE_WIDTH);
}

/** $d1c6..$d1f0: COLOR01 takes last frame's COLOR03, COLOR03 the table's next colour. */
function flashColours(m) {
  let index = r16(m, FLASH_INDEX);
  if (r16(m, FLASH_TABLE + s16(index)) & 0x8000) {
    index = 0;
  }
  w16(m, FLASH_INDEX, index + 2);
  w16(m, COLOUR1_VALUE, r16(m, COLOUR3_VALUE));
  w16(m, COLOUR3_VALUE, r16(m, FLASH_TABLE + s16(index)));
}

/** $d1c6, script effect 8. @param {EffectRegisters} args */
export function scope1(m, args) {
  flashColours(m);
  const plane = swapBuffers(m, SCOPE1_FRONT, SCOPE1_BACK, SCOPE1_BUFFER_A, SCOPE1_BUFFER_B);
  pokeCopperPointer(m, SCOPE1_PLANE_COPPER, r32(m, SCOPE1_FRONT));
  clearWithBlitter(m, plane, SCOPE1_CLEAR_SIZE);
  startPlayback(m, SCOPE1_PLAYBACK, SCOPE1_STEP_NUMERATOR);
  let x0 = 0;
  let y0 = SCOPE1_MIDDLE;
  let x1 = SCOPE1_SEGMENT_WIDTH;
  for (let segment = 0; segment < SCOPE1_SEGMENTS; segment++) {
    const y1 = (SCOPE1_ZERO_LEVEL - nextLevel(m, SCOPE1_PLAYBACK)) & 0xffff;
    drawLine(m, x0, y0, x1, y1, plane);
    x0 = x1;
    y0 = y1;
    x1 = (x1 + SCOPE1_SEGMENT_WIDTH) & 0xffff;
  }
  drawLine(m, x0, y0, x1 - 1, SCOPE1_MIDDLE, plane);
  endPlayback(m, SCOPE1_PLAYBACK);
}

// ---- scope2 -------------------------------------------------------------------------------------------------

/** `bset.b` on memory: the bit number is taken modulo 8. */
function setBit(m, address, bit) {
  w8(m, address, r8(m, address) | (1 << (bit & 7)));
}

/**
 * $d8fc: the dots of one side of one row. At x (lines 4-5 of the row, 4-7 when thick) and at the middle of
 * the previous x and this one (lines 0-1, 0-3 when thick; the line above carries it to the row before).
 */
function plotDots(m, plane, previousX, x, rowOffset) {
  const isThick = r16(m, THICK_DOTS) !== 0;
  const at = plane + s16((rowOffset + (x >>> 3)) & 0xffff);
  const bit = 7 - x;
  setBit(m, at, bit);
  setBit(m, at + LINE_BYTES, bit);
  if (isThick) {
    setBit(m, at + 2 * LINE_BYTES, bit);
    setBit(m, at + 3 * LINE_BYTES, bit);
  }
  const middle = ((previousX + x) & 0xffff) >>> 1;
  const middleAt = plane + s16((rowOffset + (middle >>> 3)) & 0xffff);
  const middleBit = 7 - middle;
  setBit(m, middleAt - 3 * LINE_BYTES, middleBit);
  setBit(m, middleAt - 4 * LINE_BYTES, middleBit);
  if (isThick) {
    setBit(m, middleAt - LINE_BYTES, middleBit);
    setBit(m, middleAt - 2 * LINE_BYTES, middleBit);
  }
}

/** $d4ec..$d5a4, on an entry's first frame: the four script parameters. */
function takeParameters(m, parameters) {
  w16(m, SCRIPT_INDEX, r16(m, SCRIPT_INDEX) + SCOPE2_PARAMETER_BYTES);
  const isUpsideDown = r16(m, parameters) !== 0;
  w16(m, BPL1MOD_VALUE, isUpsideDown ? UPSIDE_DOWN_MODULO : 0);
  w16(m, BPL2MOD_VALUE, isUpsideDown ? UPSIDE_DOWN_MODULO : 0);
  const firstLine = PICTURE + (isUpsideDown ? LAST_LINE : 0);
  for (let plane = 0; plane < PICTURE_PLANES; plane++) {
    pokeCopperPointer(m, PICTURE_PLANES_COPPER + plane * 2 * COPPER_MOVE_BYTES, firstLine + plane * PLANE_BYTES);
  }
  const lowPalette = PALETTES + s16((r16(m, parameters + 2) << PALETTE_SHIFT) & 0xffff);
  const highPalette = PALETTES + s16((r16(m, parameters + 4) << PALETTE_SHIFT) & 0xffff);
  w16(m, THICK_DOTS, r16(m, parameters + 6));
  for (let colour = 0; colour < PALETTE_COLOURS; colour++) {
    w16(m, PALETTE_LOW + colour * COPPER_MOVE_BYTES, r16(m, lowPalette + colour * 2));
    w16(m, PALETTE_HIGH + colour * COPPER_MOVE_BYTES, r16(m, highPalette + colour * 2));
  }
}

/** $d5a8..$d660: colours 1-15 move one place down, colours 17-31 one place up (colours 0 and 16 stay). */
function rotatePalettes(m) {
  const low = [];
  const high = [];
  for (let colour = 1; colour < PALETTE_COLOURS; colour++) {
    low.push(r16(m, PALETTE_LOW + colour * COPPER_MOVE_BYTES));
    high.push(r16(m, PALETTE_HIGH + colour * COPPER_MOVE_BYTES));
  }
  const rotatedLow = [...low.slice(1), low[0]];
  const rotatedHigh = [high[high.length - 1], ...high.slice(0, -1)];
  for (let i = 0; i < low.length; i++) {
    w16(m, PALETTE_LOW + (i + 1) * COPPER_MOVE_BYTES, rotatedLow[i]);
    w16(m, PALETTE_HIGH + (i + 1) * COPPER_MOVE_BYTES, rotatedHigh[i]);
  }
}

/** $d8c8..$d8f0: fill between each line's pairs of dots, from the plane's last word backwards. */
function fillWithBlitter(m, plane) {
  custom32(m, BLTAPT, plane + FILL_START);
  custom32(m, BLTDPT, plane + FILL_START);
  custom32(m, BLTCON0, FILL_CON);
  custom32(m, BLTAFWM, 0xffffffff);
  custom32(m, BLTAMOD, 0);
  custom(m, BLTSIZE, SCOPE2_SIZE);
}

/** $d4e2, script effect 9. @param {EffectRegisters} args */
export function scope2(m, args) {
  if (r16(m, FIRST_FRAME)) {
    takeParameters(m, args.a0);
  }
  rotatePalettes(m);
  const plane = swapBuffers(m, SCOPE2_FRONT, SCOPE2_BACK, SCOPE2_BUFFER_A, SCOPE2_BUFFER_B);
  const isUpsideDown = (r16(m, BPL1MOD_VALUE) & 0x8000) !== 0;
  pokeCopperPointer(m, SCOPE2_PLANE_COPPER, r32(m, SCOPE2_FRONT) + (isUpsideDown ? LAST_LINE : 0));
  clearWithBlitter(m, plane, SCOPE2_SIZE);
  startPlayback(m, SCOPE2_PLAYBACK, SCOPE2_STEP_NUMERATOR);
  let previousX = SCOPE2_CENTRE;
  let rowOffset = SCOPE2_FIRST_ROW;
  for (let row = 0; row < SCOPE2_ROWS; row++) {
    let level = nextLevel(m, SCOPE2_PLAYBACK);
    if (!(level & 0x8000)) {
      level = -level & 0xffff;
    }
    const x = (level + SCOPE2_CENTRE) & 0xffff;
    plotDots(m, plane, previousX, x, rowOffset);
    plotDots(m, plane, (SCOPE2_WIDTH - previousX) & 0xffff, (SCOPE2_WIDTH - x) & 0xffff, rowOffset);
    previousX = x;
    rowOffset = (rowOffset + SCOPE2_ROW_BYTES) & 0xffff;
  }
  endPlayback(m, SCOPE2_PLAYBACK);
  fillWithBlitter(m, plane);
}
