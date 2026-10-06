// The end part ($be518, the loader jumps here and it never returns): an orange overscan screen. In the back,
// three huge words ("melon", "dezign", "baygon") made of grey dots melt into one another; in front, thirteen
// pages of small credits text, a new one every time "melon" comes round.
//
// The words are 44x32 "pixels" of 8x8 screen pixels each. A pixel is a brightness 0..5, drawn into bitplane 1
// as a dot of that size. Melting is done on the brightnesses: every step moves each one a notch towards the
// next word. The text is poked into bitplane 2, a byte per character per line. No blitter anywhere.
//
// The part has its own music: a ProTracker module at $c079c ("baygon end") and a second copy of the replayer
// ($bf5d8 mt_init, $bf66e mt_music), called from the part's own vertical-blank interrupt ($be714).
//
// After the last page the part resets the machine (`trap #0` into the ROM at $f800d2). The loader left a
// ColdCapture hook ($c6da8 installs $c6dd0) which the ROM calls on the way up: a green badge blinking on a
// red screen. Then Kickstart boots the disk again, so this generator returns where the demo starts over.
import { r8, r16, w8, w16, w32, waitLine, waitFrames, pokeCopperPointer } from '../machine.js';

const SCREEN = 0x180000;
/** $be522 clears $2328 longs: three buffers of $2ee0 bytes. */
const SCREEN_BYTES = 0x2328 * 4;
const DOT_PLANE = SCREEN;
const WORDS = SCREEN + 0x2ee0;
const TEXT_PLANE = SCREEN + 0x5dc0;
/** Where the part keeps those three pointers. */
const POINTERS = 0xbe52e;
const COPPER = 0xc071c;
const COPPER_SPRITES = 0xc074c;
const COPPER_DOT_PLANE = 0xc0786;
const COPPER_TEXT_PLANE = 0xc078e;
const BLANK_SPRITE = 0xc070c;
const SPR4PTH = 0x130;
/** 44 bytes a line: 352 pixels, overscan. */
const LINE_BYTES = 0x2c;
const COLUMNS = 0x2c;
const ROWS = 0x20;
const DOT_LINES = 8;

/** The words as packed on disk: three bitplanes of three pictures, 6 bytes (48 bits, 44 used) a row. */
const PACKED_WORDS = 0xc62cc;
const PACKED_WORD_BYTES = 0xcc;
const PACKED_PLANE_BYTES = 0x264;
const PACKED_ROW_BYTES = 6;
/** Brightness buffers, one byte a pixel, inside WORDS: the three words, then the one on screen. */
const WORD_BYTES = 0x660;
const SHOWN = 0x1320;
const WORD_COUNT = 3;
const BRIGHTNESS_STEP = 8;

/** Six dots of 8 lines, stored as words; $be5ca squeezes them to bytes so a brightness indexes them directly. */
const DOTS = 0xc69f8;
const DOT_TABLE_BYTES = 0x30;

/** Font: 8 lines of $5c bytes, indexed by the ASCII code itself. */
const FONT = 0xc6a48;
const FONT_LINE_BYTES = 0x5c;
const FONT_LINES = 8;
const TEXT = 0xbe7e0;
const TEXT_ROWS = 8;
const TEXT_COLUMNS = 0x20;
const TEXT_ORIGIN = 0x1136;
/** Ten screen lines from one text row to the next. */
const TEXT_ROW_BYTES = 10 * LINE_BYTES;

const WAIT_LINE = 0xf5;
const PAGE_FRAMES = 0x32 + 1;
const MELT_STEPS = 6;
const MELT_STEP_FRAMES = 5 + 1;
const HOLD_FRAMES = 0x64 + 1;

/**
 * Measured from the capture: drawing the 1408 dots takes the 68020 just under a frame, so the wait that
 * follows a redraw ends a frame later (melt steps are 7 frames apart, a full round is 534 frames, not 513).
 */
const DRAW_FRAMES = 1;
/** Measured from the capture: orange screen to first word, less the two beam waits and the draw. */
const UNPACK_FRAMES = 1;

/** The reset. Measured from the capture: the credits stay 9 frames, then Kickstart's dark screen for 30. */
const RESET_FRAMES = 9;
const KICKSTART_FRAMES = 30;
const KICKSTART_COLOUR = 0x111;
const LOADER_BLANK_COPPER = 0x21aa;
const LOADER_BLANK_COLOUR = 0x21bc;
const BADGE_COPPER = 0xc6e90;
const BADGE_COPPER_PLANE = 0xc6eaa;
const BADGE_COPPER_COLOUR = 0xc6ed6;
const BADGE_PICTURE = 0xc6ee4;
const BADGE_BLINKS = 0x19 + 1;
const BADGE_BLINK_FRAMES = 9 + 1;
const BADGE_HIDDEN = 0xf45;
const BADGE_GREEN = 0x9f0;

/** $bf57c: one packed word to a brightness (times 8) per pixel. */
function unpackWord(m, packed, destination) {
  for (let row = 0; row < ROWS; row++) {
    for (let x = 0; x < COLUMNS; x++) {
      const at = packed + row * PACKED_ROW_BYTES + (x >> 4) * 2;
      const bit = 15 - (x & 15);
      let brightness = 0;
      for (let plane = 0; plane < 3; plane++) {
        brightness |= ((r16(m, at + plane * PACKED_PLANE_BYTES) >> bit) & 1) << plane;
      }
      w8(m, destination + row * COLUMNS + x, brightness * BRIGHTNESS_STEP);
    }
  }
}

/** $bf4e2 */
function showWord(m, word) {
  m.mem.copyWithin(WORDS + SHOWN, WORDS + word * WORD_BYTES, WORDS + (word + 1) * WORD_BYTES);
}

/** $bf4fc: every brightness on screen one notch towards the given word. */
function meltTowards(m, word) {
  const target = WORDS + word * WORD_BYTES;
  for (let i = 0; i < WORD_BYTES; i++) {
    const wanted = r8(m, target + i);
    const shown = r8(m, WORDS + SHOWN + i);
    if (shown < wanted) {
      w8(m, WORDS + SHOWN + i, shown + BRIGHTNESS_STEP);
    } else if (shown > wanted) {
      w8(m, WORDS + SHOWN + i, shown - BRIGHTNESS_STEP);
    }
  }
}

/** $bf52c: the brightnesses as dots, eight lines of one byte each. */
function* drawDots(m) {
  for (let row = 0; row < ROWS; row++) {
    for (let x = 0; x < COLUMNS; x++) {
      const dot = DOTS + r8(m, WORDS + SHOWN + row * COLUMNS + x);
      const at = DOT_PLANE + row * DOT_LINES * LINE_BYTES + x;
      for (let line = 0; line < DOT_LINES; line++) {
        w8(m, at + line * LINE_BYTES, r8(m, dot + line));
      }
    }
  }
  yield* waitFrames(m, WAIT_LINE, DRAW_FRAMES);
}

/** $be768: the next page of text. Returns false when that was the last one. */
function drawPage(m, state) {
  for (let row = 0; row < TEXT_ROWS; row++) {
    for (let column = 0; column < TEXT_COLUMNS; column++) {
      const glyph = FONT + r8(m, state.text++);
      const at = TEXT_PLANE + TEXT_ORIGIN + row * TEXT_ROW_BYTES + column;
      for (let line = 0; line < FONT_LINES; line++) {
        w8(m, at + line * LINE_BYTES, r8(m, glyph + line * FONT_LINE_BYTES));
      }
    }
  }
  return r8(m, state.text) !== 0;
}

/** $be648: six steps towards the next word, then it stands for two seconds. */
function* meltInto(m, word) {
  for (let step = 0; step < MELT_STEPS; step++) {
    yield* waitFrames(m, WAIT_LINE, MELT_STEP_FRAMES);
    meltTowards(m, word);
    yield* drawDots(m);
  }
  yield* waitFrames(m, WAIT_LINE, HOLD_FRAMES);
}

function* setUp(m) {
  m.mem.fill(0, SCREEN, SCREEN + SCREEN_BYTES);
  w32(m, POINTERS, DOT_PLANE);
  w32(m, POINTERS + 4, WORDS);
  w32(m, POINTERS + 8, TEXT_PLANE);
  // $be744: sprites 4..7 onto an empty one.
  for (let i = 0; i < 8; i++) {
    w16(m, COPPER_SPRITES + i * 4, SPR4PTH + i * 2);
    w16(m, COPPER_SPRITES + i * 4 + 2, i & 1 ? BLANK_SPRITE & 0xffff : BLANK_SPRITE >>> 16);
  }
  m.cop1lc = COPPER;
  yield* waitLine(m, 0);
  yield* waitLine(m, 0xff);
  pokeCopperPointer(m, COPPER_DOT_PLANE, DOT_PLANE);
  pokeCopperPointer(m, COPPER_TEXT_PLANE, TEXT_PLANE);
  for (let i = 0; i < DOT_TABLE_BYTES; i++) {
    w8(m, DOTS + i, r8(m, DOTS + i * 2));
  }
  // $be5e0: the part's own vertical-blank interrupt, then mt_init on the module at $c079c.
  m.endMusicStartMs = m.time;
  for (let word = 0; word < WORD_COUNT; word++) {
    unpackWord(m, PACKED_WORDS + word * PACKED_WORD_BYTES, WORDS + word * WORD_BYTES);
  }
  yield* waitFrames(m, WAIT_LINE, UNPACK_FRAMES);
}

/**
 * $be7ce: `move.l #$f800d2,$80.w; trap #0`, a reset. Then $c6dd0, the ColdCapture hook: a one-bitplane
 * badge whose colour is switched between the background's and green every ten frames, 26 times.
 */
function* resetAndBadge(m) {
  yield* waitFrames(m, 0xff, RESET_FRAMES);
  m.endMusicStopMs = m.time;
  w16(m, LOADER_BLANK_COLOUR, KICKSTART_COLOUR);
  w16(m, LOADER_BLANK_COLOUR + 8, KICKSTART_COLOUR);
  m.cop1lc = LOADER_BLANK_COPPER;
  yield* waitFrames(m, 0xff, KICKSTART_FRAMES);

  pokeCopperPointer(m, BADGE_COPPER_PLANE, BADGE_PICTURE);
  m.cop1lc = BADGE_COPPER;
  for (let blink = 0; blink < BADGE_BLINKS; blink++) {
    yield* waitFrames(m, 0xff, BADGE_BLINK_FRAMES);
    w16(m, BADGE_COPPER_COLOUR, BADGE_HIDDEN);
    yield* waitFrames(m, 0xff, BADGE_BLINK_FRAMES);
    w16(m, BADGE_COPPER_COLOUR, BADGE_GREEN);
  }
}

export function* Credits(m) {
  yield* setUp(m);
  const state = { text: TEXT };
  for (;;) {
    for (let word = 0; word < WORD_COUNT; word++) {
      showWord(m, word);
      yield* drawDots(m);
      if (word === 0) {
        yield* waitFrames(m, WAIT_LINE, PAGE_FRAMES);
        if (!drawPage(m, state)) {
          yield* resetAndBadge(m);
          // Kickstart carries on and boots the disk: the demo starts from the top.
          return;
        }
        yield* waitFrames(m, WAIT_LINE, PAGE_FRAMES);
      }
      yield* meltInto(m, (word + 1) % WORD_COUNT);
    }
  }
}
