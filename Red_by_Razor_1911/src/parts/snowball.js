// Part D1, main script 0181..01c3: the kid throwing a snowball, with text flying along the snowball's path
// (docs/disassembly/D_snowball_credits.md).
//
// The kid's picture is shown on a white palette that fades to the picture's own. Then a text scroller is written
// character by character into a buffer (segment 3028), and two huge unrolled routines (0997:0000 and 11d9:0000) copy
// that buffer's bytes to fixed screen pixels along the curve; buffer bytes 0x94 (empty) show the kid's picture
// instead in the second routine. The routines are not copied here: their instruction bytes are decoded at load time
// into a small list of operations (decodeUnrolled) and run every frame. When the text has been written once, the
// palette fades to black.
import { DATA, linear, waitFrame } from '../machine.js';

/** @typedef {import('../machine.js').Machine} Machine */
/** @typedef {{ si: number, al: number, bl: number, isZero: boolean }} UnrolledRegisters */

/** 16b2:139d, the palette the parts send to the DAC (0000:0673). */
const PALETTE = DATA + 0x139d;
const PALETTE_BYTES = 0x300;
/** 0186: colour 0 stays black, every other colour white. */
const BLACK_BYTES = 3;
const WHITE = 0x3f;
/** 16b2:7ce2, the kid's palette that 0000:1004 fades PALETTE down to (cleared to black at 01b4). */
const FADE_TARGET = DATA + 0x7ce2;
/** 1004: 64 fade steps, one per retrace. */
const FADE_STEPS = 0x40;

const SCREEN_BYTES = 0xfa00;
const SCREEN_WIDTH = 320;
/** 1034: the background colour around the picture. */
const BACKGROUND_COLOUR = 1;
/** 6c1f:0000, the kid's picture: 200 rows of 166 pixels, at column 51 (1046). */
const KID_PICTURE_SEGMENT = 0x6c1f;
const KID_PICTURE = linear(KID_PICTURE_SEGMENT, 0);
const KID_WIDTH = 0x53 * 2;
const KID_HEIGHT = 0xc8;
const KID_COLUMN = 0x33;

/** Segment 3028, the scroller buffer the unrolled routines read: 0x45c0 bytes, EMPTY where there is no text. */
const TEXT_BUFFER_SEGMENT = 0x3028;
const TEXT_BUFFER_BYTES = 0x45c0;
/** 1063 / 11d9:0011: an empty buffer byte. */
const EMPTY = 0x94;
/** 16b2:7fe2, set to 1 when the text's terminating zero has been read: the scroller loop ends. */
const TEXT_DONE = DATA + 0x7fe2;
/** 16b2:7fe4, the index of the next character in TEXT. */
const TEXT_INDEX = DATA + 0x7fe4;
/** 16b2:7fe6, where the next character goes in the buffer (and where the routines start reading). */
const BUFFER_POSITION = DATA + 0x7fe6;
/** 16b2:7fe8 (byte), retraces until the next character. */
const CHARACTER_COUNTDOWN = DATA + 0x7fe8;
/** 16b2:7fe9, the text, zero-terminated. */
const TEXT = DATA + 0x7fe9;
/** 10a0: a character every 15 retraces; the buffer moves 15 bytes per retrace. */
const RETRACES_PER_CHARACTER = 0xf;
const BUFFER_STEP = 0xf;
/** 10d8 / 10dd: the position wraps from 0x12c0 back to 0xf0. */
const BUFFER_POSITION_END = 0x12c0;
const BUFFER_POSITION_START = 0xf0;
/** 10c1 / 10c9: each character is written twice, one slot before the position and 18 slots after it. */
const FIRST_COPY_OFFSET = -0xf0;
const SECOND_COPY_OFFSET = 0x10e0;
/** 16b2:1b80 (0000:0b72), the font's character offsets, from ' '; 16b2:803c the font, 320 pixels per row. */
const CHARACTER_OFFSETS = DATA + 0x1b80;
const FIRST_CHARACTER = 0x20;
const FONT = DATA + 0x803c;
const FONT_STRIDE = 0x140;
/** 10e4: a character is 15x16 pixels, stored as 240 consecutive bytes in the buffer. */
const CHARACTER_WIDTH = 0xf;
const CHARACTER_HEIGHT = 0x10;

/** 10fa: the two unrolled routines, far-called one after the other with the registers carried over. */
const UNROLLED_ROUTINES = [linear(0x0997, 0), linear(0x11d9, 0)];

// Operations of the unrolled code (decodeUnrolled).
const OP_LODSB = 0;
const OP_ADD_SI = 1;
const OP_STORE_AL = 2;
const OP_STORE_BL = 3;
const OP_CMP_AL = 4;
const OP_JNE = 5;
const OP_JMP = 6;
const OP_LOAD_BL_PICTURE = 7;
const OP_ADD_AL_BL = 8;
const OP_MOV_BL = 9;
const OP_RETF = 10;

/**
 * The instructions the unrolled routines are made of: opcode bytes, operand size, operation (null: a no-op here,
 * the segment register setup of 0997:0000..0005 and the nops). Operands are little-endian immediates.
 */
const UNROLLED_INSTRUCTIONS = [
  { bytes: [0xac], size: 0, op: OP_LODSB }, // lodsb
  { bytes: [0x83, 0xc6], size: 1, op: OP_ADD_SI, isSigned: true }, // add si, imm8
  { bytes: [0x81, 0xc6], size: 2, op: OP_ADD_SI }, // add si, imm16
  { bytes: [0x26, 0xa2], size: 2, op: OP_STORE_AL }, // mov es:[imm16], al
  { bytes: [0x26, 0x88, 0x1e], size: 2, op: OP_STORE_BL }, // mov es:[imm16], bl
  { bytes: [0x3c], size: 1, op: OP_CMP_AL }, // cmp al, imm8
  { bytes: [0x75], size: 1, op: OP_JNE, isJump: true }, // jne rel8
  { bytes: [0xeb], size: 1, op: OP_JMP, isJump: true }, // jmp rel8
  { bytes: [0x64, 0x8a, 0x9d], size: 2, op: OP_LOAD_BL_PICTURE }, // mov bl, fs:[di + imm16] (di = 0)
  { bytes: [0x02, 0xc3], size: 0, op: OP_ADD_AL_BL }, // add al, bl
  { bytes: [0xb3], size: 1, op: OP_MOV_BL }, // mov bl, imm8
  { bytes: [0xcb], size: 0, op: OP_RETF }, // retf
  { bytes: [0x90], size: 0, op: null }, // nop
  { bytes: [0x8e, 0xd8], size: 0, op: null }, // mov ds, ax (ax = 3028)
  { bytes: [0x8e, 0xc0], size: 0, op: null }, // mov es, ax (ax = a000)
  { bytes: [0xb8], size: 2, op: null }, // mov ax, a000
];

/** The instruction at `at`, or an error: the decoder only knows the instructions the routines use. */
function matchInstruction(mem, at) {
  const found = UNROLLED_INSTRUCTIONS.find(({ bytes }) => bytes.every((b, i) => mem[at + i] === b));
  if (!found) {
    throw new Error(`unrolled code: unknown instruction at ${at.toString(16)}`);
  }
  return found;
}

/** A little-endian operand of `size` bytes at `at`. */
function readOperand(mem, at, size, isSigned) {
  if (size === 1) {
    return isSigned ? (mem[at] << 24) >> 24 : mem[at];
  }
  return size === 2 ? mem[at] | (mem[at + 1] << 8) : 0;
}

/**
 * Decodes an unrolled routine from its first byte to its retf into pairs [operation, operand] (an Int32Array);
 * jump operands become operation indexes.
 */
function decodeUnrolled(mem, start) {
  const ops = [];
  const indexAt = new Map();
  const jumps = [];
  let at = start;
  for (;;) {
    const instruction = matchInstruction(mem, at);
    const operandAt = at + instruction.bytes.length;
    const next = operandAt + instruction.size;
    indexAt.set(at, ops.length / 2);
    if (instruction.op !== null) {
      const operand = readOperand(mem, operandAt, instruction.size, instruction.isJump || instruction.isSigned);
      if (instruction.isJump) {
        jumps.push({ index: ops.length + 1, target: next + operand });
      }
      ops.push(instruction.op, operand);
    }
    if (instruction.op === OP_RETF) {
      break;
    }
    at = next;
  }
  jumps.forEach(({ index, target }) => {
    ops[index] = indexAt.get(target);
  });
  return Int32Array.from(ops);
}

/**
 * Runs one decoded routine on the registers (ds = 3028, es = a000, fs = 6c1f, di = 0); leaves them as the routine
 * does, for the next one.
 * @param {Machine} m
 * @param {Int32Array} ops decodeUnrolled's operations
 * @param {UnrolledRegisters} registers
 */
function runUnrolled(m, ops, registers) {
  const buffer = linear(TEXT_BUFFER_SEGMENT, 0);
  const { mem, vga } = m;
  let { si, al, bl, isZero } = registers;
  let pc = 0;
  for (;;) {
    const operand = ops[pc * 2 + 1];
    switch (ops[pc * 2]) {
      case OP_LODSB:
        al = mem[buffer + si];
        si = (si + 1) & 0xffff;
        break;
      case OP_ADD_SI:
        si = (si + operand) & 0xffff;
        break;
      case OP_STORE_AL:
        vga.write(operand, al);
        break;
      case OP_STORE_BL:
        vga.write(operand, bl);
        break;
      case OP_CMP_AL:
        isZero = al === operand;
        break;
      case OP_JNE:
        if (!isZero) {
          pc = operand;
          continue;
        }
        break;
      case OP_JMP:
        pc = operand;
        continue;
      case OP_LOAD_BL_PICTURE:
        bl = mem[KID_PICTURE + operand];
        break;
      case OP_ADD_AL_BL:
        al = (al + bl) & 0xff;
        break;
      case OP_MOV_BL:
        bl = operand;
        break;
      default:
        Object.assign(registers, { si, al, bl, isZero });
        return;
    }
    pc++;
  }
}

/** 0000:0673: sends the 768-byte palette buffer to the DAC from colour 0. */
export function sendPalette(m) {
  m.vga.dacLoad(0, m.mem, PALETTE, PALETTE_BYTES);
}

/**
 * 0000:1004: 64 steps, one per retrace, each moving every palette byte that differs from its target one down
 * (1016: only down, so a byte below its target would wrap; none is).
 */
export function* fadeDown(m, target) {
  for (let step = 0; step < FADE_STEPS; step++) {
    for (let i = 0; i < PALETTE_BYTES; i++) {
      const current = m.u8(PALETTE + i);
      if (current !== m.u8(target + i)) {
        m.set8(PALETTE + i, current - 1);
      }
    }
    yield* waitFrame(m);
    sendPalette(m);
  }
}

/** 0000:1029: the screen in colour 1, the kid's picture at column 51. */
function drawKid(m) {
  for (let offset = 0; offset < SCREEN_BYTES; offset++) {
    m.vga.write(offset, BACKGROUND_COLOUR);
  }
  for (let row = 0; row < KID_HEIGHT; row++) {
    const di = row * SCREEN_WIDTH + KID_COLUMN;
    for (let x = 0; x < KID_WIDTH; x++) {
      m.vga.write(di + x, m.u8(KID_PICTURE + row * KID_WIDTH + x));
    }
  }
}

/** 10e4: copies a 15x16 character from the font to the buffer at `offset` (240 consecutive bytes). */
function copyCharacter(m, font, offset) {
  const buffer = linear(TEXT_BUFFER_SEGMENT, 0);
  for (let row = 0; row < CHARACTER_HEIGHT; row++) {
    for (let x = 0; x < CHARACTER_WIDTH; x++) {
      m.set8(buffer + ((offset + row * CHARACTER_WIDTH + x) & 0xffff), m.u8(font + row * FONT_STRIDE + x));
    }
  }
}

/** 107a: the next character of the text; at the terminating zero the text restarts and TEXT_DONE is set. */
function nextCharacter(m) {
  const index = m.u16(TEXT_INDEX);
  m.set16(TEXT_INDEX, index + 1);
  const character = m.u8(TEXT + index);
  if (character !== 0) {
    return character;
  }
  m.set16(TEXT_INDEX, 1);
  m.set16(TEXT_DONE, 1);
  return m.u8(TEXT);
}

/** 0000:106b: every 15 retraces a character into the buffer; the buffer position moves on 15 bytes. */
function scrollText(m) {
  const countdown = (m.u8(CHARACTER_COUNTDOWN) - 1) & 0xff;
  m.set8(CHARACTER_COUNTDOWN, countdown);
  if (countdown === 0) {
    const character = nextCharacter(m);
    m.set8(CHARACTER_COUNTDOWN, RETRACES_PER_CHARACTER);
    const font = FONT + m.u16(CHARACTER_OFFSETS + ((character - FIRST_CHARACTER) & 0xff) * 2);
    const position = m.u16(BUFFER_POSITION);
    copyCharacter(m, font, position + FIRST_COPY_OFFSET);
    copyCharacter(m, font, position + SECOND_COPY_OFFSET);
  }
  const position = m.u16(BUFFER_POSITION) + BUFFER_STEP;
  m.set16(BUFFER_POSITION, position === BUFFER_POSITION_END ? BUFFER_POSITION_START : position);
}

/** Builds 0000:10fa, the text along the snowball's path: both unrolled routines from the buffer position. */
function createTextDrawer(m) {
  const routines = UNROLLED_ROUTINES.map((start) => decodeUnrolled(m.mem, start));
  return () => {
    const registers = { si: m.u16(BUFFER_POSITION), al: 0, bl: 0, isZero: false };
    routines.forEach((ops) => runUnrolled(m, ops, registers));
  };
}

/**
 * Main script 0181..01c3.
 * @param {Machine} m
 */
export function* snowball(m) {
  m.mem.fill(0, PALETTE, PALETTE + BLACK_BYTES); // 0181
  m.mem.fill(WHITE, PALETTE + BLACK_BYTES, PALETTE + PALETTE_BYTES);
  sendPalette(m); // 0197
  drawKid(m); // 019a 0000:1029
  yield* fadeDown(m, FADE_TARGET); // 019d 0000:1004
  m.mem.fill(EMPTY, linear(TEXT_BUFFER_SEGMENT, 0), linear(TEXT_BUFFER_SEGMENT, TEXT_BUFFER_BYTES)); // 01a0 0000:105b
  const drawText = createTextDrawer(m);
  do {
    scrollText(m); // 01a3 0000:106b
    yield* waitFrame(m); // 01a6
    drawText(); // 01a9 0000:10fa
  } while (m.u16(TEXT_DONE) !== 1);
  m.mem.fill(0, FADE_TARGET, FADE_TARGET + PALETTE_BYTES); // 01b4
  yield* fadeDown(m, FADE_TARGET); // 01c3 0000:1004
}
