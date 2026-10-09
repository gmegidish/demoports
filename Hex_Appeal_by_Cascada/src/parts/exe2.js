// exe2, the intro (notes: H2_intro.md). Five two-line messages in Robban's soft font, wobbled and faded in
// mode 13h, drawn straight into the displayed screen; then the HEX APPEAL logo slides in and out on an unchained,
// 640-pixel-wide virtual screen. Everything is driven by music triggers polled in the retrace callback.
//
// The image is loaded at segment 0; the code segment is 0c48 and every variable lives in it (CS + offset).
// Tables are read from the image, at their original addresses.
//
// Timing: the main loop waits for the frame counter to change after its work, so on a fast machine it runs one
// iteration per retrace. The new recording (DOSBox, 200000 cycles) does exactly that in both phases (the old
// recording's 8 iterations per 9 retraces were CPU starvation).

/** @typedef {import('../machine.js').Machine} Machine */

const CS = 0xc480;
const TEXT_BUFFER = 0x100; // 0010:0000, 35 rows of 320
const FONT = 0x2cc0; // 02cc:0000, 16x16 glyphs
const TEXT_PALETTE = 0x2cc0 + 0x3100; // 02cc:3100
const HEX_PICTURE = 0x60c0; // 060c:0000, 240x80 chunky
const LOGO_PALETTE = 0x60c0 + 0x4b00; // 060c:4b00
const APPEAL_SPRITE = 0xaec0; // 0aec:0000, 232x24 chunky

// Tables and variables in the code segment.
const COS = CS + 0x0000; // 256 words
const ROWY = CS + 0x0200; // 32 words
const YWAVE = CS + 0x0240; // 256 words, signed
const LOGOY = CS + 0x0440; // bytes
const LOGODX = CS + 0x0581; // bytes
const SCRIPT = CS + 0x06c2;
const FONTIDX = CS + 0x079e;
const PHASE = CS + 0x083c; // C: byte, +1 per iteration
const PHASE2 = CS + 0x083e; // +2 per iteration, dead
const PREV_TOP = CS + 0x0840;
const BLOCK_ORIGIN = CS + 0x0842; // 0x7080 = 90 * 320
const BLOCK_ORIGIN2 = CS + 0x0844; // 0
const STATE = CS + 0x0846;
const TEXT_POS = CS + 0x0848;
const TEXT_X = CS + 0x084a;
const TEXT_Y = CS + 0x084c;
const GO = CS + 0x084e;
const GLYPH_SOURCE = CS + 0x0b51;
const FADE = CS + 0x0b53; // two equal bytes
const SCRIPT_PARAM = CS + 0x0b55;
const IS_LAST = CS + 0x0b57;
const COLSHIFT = CS + 0x0b59; // 320 bytes
const COUNTER_149F = CS + 0x149f; // dead
const PAN_X = CS + 0x14a1;
const PAN_Y = CS + 0x14a3;
const SPRITE_X = CS + 0x14a5;
const SPRITE_Y = CS + 0x14a7;
const OLD_X = CS + 0x14a9;
const OLD_Y = CS + 0x14ab;
const SLIDE_POS = CS + 0x14ad;
const TRIGGER_INDEX = CS + 0x14b3;
const TRIGGERS = CS + 0x14b5; // (order + 1, row + 1) byte pairs

// The unrolled column generator 1f31..7071: one block per screen column, the immediates read from the code.
const LEFT_BLOCKS = CS + 0x1f31;
const LEFT_BLOCK_SIZE = 0x42;
const RIGHT_BLOCKS = CS + 0x4874;
const RIGHT_BLOCK_SIZE = 0x40;
const BLOCK_K = 0x01; // mov bx, k
const BLOCK_M = 0x12; // mov ax, M

const STATE_FADE_OUT = 1;
const STATE_FADE_IN = 2;
const STATE_LOGO_SETUP = 3;
const STATE_LOGO_HIDDEN = 4;
const STATE_SLIDE_IN = 5;
const STATE_SLIDE_OUT = 7;
const STATE_EXIT = 8;

const WIDTH = 320;
const TEXT_ROWS = 32;
const FADE_ROW = 0x2940; // buffer row 33
const SHIFTED_FADE_ROW = 0x2a80; // buffer row 34
const LINE_BYTES = 0x1400; // 16 rows of the buffer
const SCRIPT_END = 0xdc;
const FADE_INVISIBLE = 0x20;
const PLANE_WORDS = 0x8000;
const ROW_BYTES_LOGO = 160;
const SPRITE_ROWS = 24;
const SPRITE_ROW_BYTES = 0x3b;
const SPRITE_PLANE_BYTES = 0x3a;
const SPRITE_COPIES = 0xe678; // 4 pre-shifted copies, 0x588 bytes each
const SPRITE_COPY_SIZE = 0x588;
/** 1e1b..1e3c: the copy for each sprite x & 3. */
const SPRITE_COPY_OFFSETS = [0, SPRITE_COPY_SIZE, SPRITE_COPY_SIZE * 2, SPRITE_COPY_SIZE * 3];
const HEX_DEST = 0x131a; // 30 * 160 + 90
const HEX_ROWS = 0x50;
const HEX_PLANE_BYTES = 0x3c;
const SLIDE_END = 0x140;
const ESCAPE = 1;

/** Per-column source x for this frame: the displacements 1f2e patches into the drawing code at 77db... */
const sourceColumn = new Uint16Array(WIDTH);
/** The column blocks' constants: k (distance from the centre) and M, read once from the code. */
const columnK = new Uint16Array(WIDTH);
const columnM = new Uint16Array(WIDTH);

/** @param {Machine} m */
function readColumnConstants(m) {
  for (let p = 0; p < WIDTH; p++) {
    const block = p < 160 ? LEFT_BLOCKS + p * LEFT_BLOCK_SIZE : RIGHT_BLOCKS + (p - 160) * RIGHT_BLOCK_SIZE;
    columnK[p] = m.u16(block + BLOCK_K);
    columnM[p] = m.u16(block + BLOCK_M);
  }
}

/** A byte write to A000:offset in chained mode 13h (plane a & 3, offset a >> 2). */
function writeChained(planes, offset, value) {
  const a = offset & 0xffff;
  planes[a & 3][a >> 2] = value;
}

/** 0c48:828f: mode 13h retimed to 528 lines (about 60 Hz), 400 double-scanned lines. */
function tweak60Hz(vga) {
  vga.out8(0x3d4, 0x11);
  vga.out8(0x3d5, vga.in8(0x3d5) & 0x7f);
  vga.out8(0x3c2, vga.in8(0x3cc) | 0xc0);
  for (const value of [0x0e06, 0x3e07, 0x4109, 0xc510, 0xac11, 0x9c15, 0x0016]) {
    vga.out16(0x3d4, value);
  }
}

/** 0c48:82c8: chain-4 off, byte mode: mode X. */
function unchain(vga) {
  vga.out16(0x3d4, 0x0011);
  vga.out8(0x3c4, 4);
  vga.out8(0x3c5, vga.sequencer[4] & 0xf6);
  vga.out8(0x3d4, 0x14);
  vga.out8(0x3d5, vga.in8(0x3d5) & 0xbf);
  vga.out16(0x3d4, 0xe317);
}

/** 0c48:82f2: CRTC 13h = width in pixels >> 3. */
function setOffset(vga, ax) {
  vga.out16(0x3d4, 0x13 | ((ax >> 3) << 8));
}

/** `rep stosw` of 0x8000 zero words at A000:0 with all four planes enabled. */
function clearVideoMemory(vga) {
  vga.out16(0x3c4, 0x0f02);
  for (let offset = 0; offset < PLANE_WORDS * 2; offset++) {
    vga.write(offset, 0);
  }
}

/** 0c48:8340: CRTC start and pel panning from PANX/PANY, then the music triggers. Once per retrace. */
function retraceCallback(m) {
  const vga = m.vga;
  const start = ((m.u16(PAN_X) >> 2) + m.u16(PAN_Y) * ROW_BYTES_LOGO) & 0xffff;
  vga.out16(0x3d4, 0x0d | ((start & 0xff) << 8));
  vga.out16(0x3d4, 0x0c | (start & 0xff00));
  // `in al, 3dah; test al, 8; jnz` waits for the end of the retrace; the read resets the attribute flip-flop.
  vga.in8(0x3da);
  vga.out8(0x3c0, 0x33);
  vga.out8(0x3c0, (m.u16(PAN_X) & 3) << 1);
  const order = m.musicOrder() & 0xff;
  const row = m.musicRow() & 0xff;
  const entry = TRIGGERS + m.u16(TRIGGER_INDEX) * 2;
  if (order < m.u8(entry) || row < m.u8(entry + 1)) {
    return;
  }
  if (m.u16(STATE) < STATE_LOGO_SETUP) {
    m.set16(TRIGGER_INDEX, m.u16(TRIGGER_INDEX) + 1);
    m.set16(GO, 1);
    return;
  }
  m.set16(STATE, m.u16(STATE) + 1);
  m.set16(TRIGGER_INDEX, m.u16(TRIGGER_INDEX) + 1);
}

/** 1518..1885: ROWY[i] = YWAVE[(C + i) & 0xff]. */
function copyRowOffsets(m) {
  const phase = m.u16(PHASE);
  for (let i = 0; i < TEXT_ROWS; i++) {
    m.set16(ROWY + i * 2, m.u16(YWAVE + ((phase + i) & 0xff) * 2));
  }
}

/** 1f2e..7071: the per-column warp (source x) and the per-source-column brightness shift. */
function buildColumnWarp(m) {
  const mem = m.mem;
  const twoPhase = (m.u16(PHASE) << 1) & 0xffff;
  for (let p = 0; p < WIDTH; p++) {
    const k = columnK[p];
    const M = columnM[p];
    const bx = ((k << 3) + twoPhase) & 0x1ff;
    const w = mem[COS + bx] | (mem[COS + bx + 1] << 8);
    const dx = (Math.floor((M * w) / 0x10000) - M) & 0xffff;
    const h = Math.floor((dx * k) / 0x10000);
    const sx = p < 160 ? (0x9f - h) & 0xffff : (h + 0xa0) & 0xffff;
    sourceColumn[p] = sx;
    mem[COLSHIFT + sx] = mem[COS + bx + 1] >> 4;
  }
}

/** 7074..7760: row 34 = row 33 (the fade) + COLSHIFT, as 160 word adds. */
function buildShiftedFadeRow(m) {
  for (let j = 0; j < WIDTH; j += 2) {
    m.set16(TEXT_BUFFER + SHIFTED_FADE_ROW + j, m.u16(COLSHIFT + j) + m.u16(TEXT_BUFFER + FADE_ROW + j));
  }
}

/** 7763..828e: clear the two rows the block uncovered, then draw 32 warped rows into the displayed screen. */
function drawWobbleRows(m) {
  const mem = m.mem;
  const planes = m.vga.planes;
  const origin = (m.u16(BLOCK_ORIGIN) + m.u16(BLOCK_ORIGIN2)) & 0xffff;
  const previousTop = m.u16(PREV_TOP);
  const top = (m.u16(ROWY) + m.u16(BLOCK_ORIGIN)) & 0xffff;
  m.set16(PREV_TOP, top);
  // rep stosw of 0x140 zero words: the rows just above the block (moved down) or just below row 31's slot.
  const clearAt = top > previousTop ? top - 0x140 : m.u16(ROWY + 0x3e) + m.u16(BLOCK_ORIGIN) + 0x2800;
  for (let i = 0; i < 0x280; i++) {
    writeChained(planes, clearAt + i, 0);
  }
  const shiftedRow = TEXT_BUFFER + SHIFTED_FADE_ROW;
  for (let r = 0; r < TEXT_ROWS; r++) {
    const rowSource = TEXT_BUFFER + r * WIDTH;
    const destination = origin + r * WIDTH + m.u16(ROWY + r * 2);
    for (let p = 0; p < WIDTH; p++) {
      const sx = sourceColumn[p];
      writeChained(planes, destination + p, (mem[rowSource + sx] + mem[shiftedRow + sx]) & 0xff);
    }
  }
}

/** 0c48:1f20: the wobbling text block. */
function renderWobbleText(m) {
  buildColumnWarp(m);
  buildShiftedFadeRow(m);
  drawWobbleRows(m);
}

/** 1a24 / 1a5e: buffer row 33 = the fade word, 0xa0 times. */
function fillFadeRow(m) {
  const fade = m.u16(FADE);
  for (let j = 0; j < WIDTH; j += 2) {
    m.set16(TEXT_BUFFER + FADE_ROW + j, fade);
  }
}

/** 18c0..19f8: type one script token: a glyph, a newline plus a glyph, or the end of a message. */
function typeToken(m) {
  let b = m.u8(SCRIPT + m.u16(TEXT_POS));
  if (b <= 0x0e) {
    m.set16(TEXT_POS, m.u16(TEXT_POS) + 1);
    m.set16(TEXT_Y, m.u16(TEXT_Y) + LINE_BYTES);
    if (b !== 0x0d) {
      m.set16(SCRIPT_PARAM, m.u16(SCRIPT + m.u16(TEXT_POS)));
      m.set16(TEXT_POS, m.u16(TEXT_POS) + 2);
      m.set16(STATE, STATE_FADE_IN);
      m.set16(TEXT_Y, 0);
      m.set16(TEXT_X, 0);
      m.set16(IS_LAST, m.u16(TEXT_POS) >= SCRIPT_END ? 1 : 0);
      return;
    }
    m.set16(TEXT_X, 0);
    b = m.u8(SCRIPT + m.u16(TEXT_POS));
  }
  m.set16(GLYPH_SOURCE, m.u8(FONTIDX + b) << 8);
  m.set16(TEXT_POS, m.u16(TEXT_POS) + 1);
  const destination = TEXT_BUFFER + ((m.u16(TEXT_Y) + m.u16(TEXT_X)) & 0xffff);
  const source = FONT + m.u16(GLYPH_SOURCE);
  for (let r = 0; r < 16; r++) {
    m.mem.copyWithin(destination + r * WIDTH, source + r * 16, source + r * 16 + 16);
  }
  m.set16(TEXT_X, m.u16(TEXT_X) + 16);
}

/** 189f..1a6d: the text state machine, only while GO is set. */
function textStep(m) {
  const state = m.u16(STATE);
  if (state === STATE_FADE_OUT) {
    m.set8(FADE, m.u8(FADE) + 1);
    m.set8(FADE + 1, m.u8(FADE + 1) + 1);
    if (m.u8(FADE) >= FADE_INVISIBLE) {
      m.set16(STATE, 0);
      if (m.u16(IS_LAST) === 1) {
        m.set16(STATE, STATE_LOGO_SETUP);
      }
    }
    fillFadeRow(m);
    return;
  }
  if (state === STATE_FADE_IN) {
    m.set8(FADE, m.u8(FADE) - 1);
    m.set8(FADE + 1, m.u8(FADE + 1) - 1);
    if (m.u8(FADE) === 0) {
      m.set16(STATE, STATE_FADE_OUT);
      m.set16(GO, 0);
    }
    fillFadeRow(m);
    return;
  }
  typeToken(m);
}

/** 1ad8..1b47: the 240x80 HEX picture, plane by plane: pixel (360 + x, 30 + y) of the virtual screen. */
function copyHexPicture(m) {
  const vga = m.vga;
  vga.out8(0x3c4, 2);
  for (let plane = 0; plane < 4; plane++) {
    vga.out8(0x3c5, 1 << plane);
    let si = HEX_PICTURE + plane;
    let di = HEX_DEST;
    for (let row = 0; row < HEX_ROWS; row++) {
      for (let i = 0; i < HEX_PLANE_BYTES; i++) {
        vga.write(di, m.u8(si));
        di++;
        si += 4;
      }
      di += 0x64;
    }
  }
}

/** 1b50..1b9c: four pre-shifted copies of the APPEAL sprite past the visible area, for latch copies. */
function copyAppealSprite(m) {
  const vga = m.vga;
  vga.out8(0x3c4, 2);
  let mask = 0x11;
  let di = SPRITE_COPIES;
  for (let copy = 0; copy < 4; copy++) {
    let si = APPEAL_SPRITE;
    for (let row = 0; row < SPRITE_ROWS; row++) {
      const rowStart = di;
      for (let plane = 0; plane < 4; plane++) {
        vga.out8(0x3c5, mask);
        for (let i = 0; i < SPRITE_PLANE_BYTES; i++) {
          vga.write(di, m.u8(si));
          di++;
          si += 4;
        }
        si -= 0xe7;
        di -= SPRITE_PLANE_BYTES;
        const carry = mask >> 7;
        mask = ((mask << 1) | carry) & 0xff; // rol al, 1
        di += carry; // adc di, 0
      }
      di = rowStart + SPRITE_ROW_BYTES;
      si += 0xe4;
    }
    mask = ((mask << 1) | (mask >> 7)) & 0xff;
  }
}

/** 1a7a..1bba: switch to the unchained 640-wide screen, load the logo palette and pictures. */
function logoSetup(m) {
  const vga = m.vga;
  vga.in8(0x3da);
  vga.out8(0x3c0, 0); // attribute index 0, PAS off: display off
  vga.out8(0x3c0, 0);
  unchain(vga);
  setOffset(vga, 0x280);
  clearVideoMemory(vga);
  vga.in8(0x3da);
  vga.out8(0x3c0, 0x20); // PAS on: display on
  vga.out8(0x3c0, 0x20);
  vga.dacLoad(0, m.mem, LOGO_PALETTE, 768);
  copyHexPicture(m);
  m.set16(STATE, STATE_LOGO_HIDDEN);
  copyAppealSprite(m);
  m.set16(PAN_Y, 0x6e);
  m.set16(SPRITE_X, 0x16d);
  m.set16(SPRITE_Y, 0x136);
  m.set16(SLIDE_POS, 0);
}

/** 1c0d / 1c7d: the sprite's old position to erase, its new y with twice the vertical parallax. */
function moveSprite(m, bx) {
  m.set16(OLD_X, m.u16(SPRITE_X));
  m.set16(OLD_Y, m.u16(SPRITE_Y));
  m.set16(SPRITE_Y, m.u8(LOGOY + bx) * 2 + 0x73);
}

/** 1bc4: slide in from the right, decelerating. */
function slideIn(m) {
  let bx = m.u16(SLIDE_POS);
  const step = m.u8(LOGODX + bx);
  m.set16(SLIDE_POS, m.u16(SLIDE_POS) + step);
  m.set16(PAN_X, m.u16(PAN_X) + step);
  m.set16(PAN_Y, m.u8(LOGOY + bx));
  if (m.u16(SLIDE_POS) >= SLIDE_END) {
    m.set16(PAN_X, SLIDE_END);
    m.set16(SLIDE_POS, SLIDE_END);
    bx = SLIDE_END;
    m.set16(PAN_Y, m.u8(LOGOY + bx));
    m.set16(STATE, 6);
  }
  moveSprite(m, bx);
}

/** 1c35: slide out to the left. */
function slideOut(m) {
  let bx = m.u16(SLIDE_POS);
  const step = m.u8(LOGODX + bx);
  m.set16(SLIDE_POS, (m.u16(SLIDE_POS) - step) & 0xffff);
  m.set16(PAN_X, m.u16(PAN_X) + step);
  m.set16(PAN_Y, m.u8(LOGOY + bx));
  if (m.s16(SLIDE_POS) <= 0) {
    m.set16(PAN_X, 0x280);
    m.set16(SLIDE_POS, 0);
    bx = 0;
    m.set16(PAN_Y, m.u8(LOGOY + bx));
    m.set16(STATE, STATE_EXIT);
  }
  moveSprite(m, bx);
}

/** 0c48:1d0c: erase the APPEAL sprite at its old position, latch-copy the right pre-shifted copy to the new one. */
function drawAppealSprite(m) {
  const vga = m.vga;
  vga.out16(0x3ce, 0x4005);
  vga.out16(0x3c4, 0x0f02);
  let di = (m.u16(OLD_X) >> 2) + m.u16(OLD_Y) * ROW_BYTES_LOGO;
  for (let row = 0; row < SPRITE_ROWS; row++) {
    for (let i = 0; i < SPRITE_ROW_BYTES; i++) {
      vga.write(di++, 0);
    }
    di += 0x65;
  }
  vga.out16(0x3ce, 0x4105);
  vga.out16(0x3c4, 0x0f02);
  di = (m.u16(SPRITE_X) >> 2) + m.u16(SPRITE_Y) * ROW_BYTES_LOGO;
  let si = SPRITE_COPIES + SPRITE_COPY_OFFSETS[m.u16(SPRITE_X) & 3];
  for (let row = 0; row < SPRITE_ROWS; row++) {
    for (let i = 0; i < SPRITE_ROW_BYTES; i++) {
      vga.read(si++);
      vga.write(di++, 0);
    }
    di += 0x65;
  }
  vga.out16(0x3ce, 0x4005);
}

/** One main-loop iteration's work, 150d..1ca9. */
function iterate(m) {
  const state = m.u16(STATE);
  if (state >= STATE_LOGO_HIDDEN) {
    drawAppealSprite(m);
  }
  copyRowOffsets(m);
  if (m.u16(STATE) <= STATE_FADE_IN) {
    renderWobbleText(m);
    if (m.u16(GO) === 1) {
      textStep(m);
    }
  }
  if (m.u16(STATE) === STATE_LOGO_SETUP) {
    logoSetup(m);
  } else {
    if (m.u16(STATE) === STATE_SLIDE_IN) {
      slideIn(m);
    }
    if (m.u16(STATE) === STATE_SLIDE_OUT) {
      slideOut(m);
    }
  }
  m.set8(PHASE, m.u8(PHASE) + 1);
  m.set8(PHASE2, m.u8(PHASE2) + 2);
  m.set16(COUNTER_149F, (m.u16(COUNTER_149F) + 0x100) % 0x400);
}

/**
 * 0c48:14c7: the intro.
 * @param {Machine} m
 */
export function* runIntro(m) {
  const vga = m.vga;
  // fn 0x1d, int 10h ax=13h, retiming, fn 0x1d: the music pauses around the mode set.
  vga.setMode13();
  tweak60Hz(vga);
  m.pauseMusic();
  vga.dacLoad(0, m.mem, TEXT_PALETTE, 768);
  readColumnConstants(m);
  m.callback = retraceCallback;
  let exitCode = 1;
  for (;;) {
    const counter = m.frameCounter;
    while (m.frameCounter === counter) {
      yield;
    }
    m.frameCounter = 0; // fn 0x1a
    iterate(m);
    if (m.u16(STATE) === STATE_EXIT) {
      exitCode = 0;
      break;
    }
    if (m.readKeyboard() === ESCAPE) {
      break;
    }
  }
  m.callback = null; // fn 0x1c
  // es = a000 here: write mode 0, all planes cleared.
  clearVideoMemory(vga);
  setOffset(vga, 0x140);
  vga.out8(0x3c0, 0x33); // no 3dah read first; the callback left the flip-flop on the index
  vga.out8(0x3c0, 0);
  m.exitCode = exitCode;
}
