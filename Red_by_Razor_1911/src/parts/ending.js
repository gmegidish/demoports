// Part E, main script 0211..0276: the ending (docs/disassembly/E_ending.md).
//
// Mode 12h (640x480x16): the RAZOR graffiti logo on lilac fades in from black, stays 500 retraces and fades out;
// the small triangle logo fades in through white, stays 150 retraces and fades out with the music's volume. Then
// the music stops, mode 3, the TheDraw end screen, and the exit to DOS (whose prompt and cursor end the recording).
// The timer IRQ is gone (0000:0365), so every wait is 0000:05be, one vertical retrace at 59.94 Hz.
import { DATA, linear, waitRetrace } from '../machine.js';

/** @typedef {import('../machine.js').Machine} Machine */
/** @typedef {Record<number, number>} LateSteps fade step -> retraces it waits more than the code says */

const SEQUENCER_INDEX = 0x3c4;
const ATTRIBUTE_PORT = 0x3c0;
const INPUT_STATUS = 0x3da;
const DAC_WRITE_INDEX = 0x3c8;
const DAC_DATA = 0x3c9;
/** Sequencer register 2, the map mask: `out 3c4, ax` with al = 2, ah = the planes written. */
const MAP_MASK = 2;
const PLANE_0 = 0x01;
const ALL_PLANES = 0x0f;
/** Attribute index bit 5: palette address source, the screen on again after the palette registers. */
const ATTRIBUTE_PAS = 0x20;
const COLOURS = 16;
/** 04e2: colour c takes entry `si + c * 0x30` of a 256-entry table (every 16th entry from si). */
const COLOUR_STRIDE = 0x30;
/** 0426/0441/...: each fade step moves si by one entry (3 bytes) up or down the table. */
const FADE_STEP = 3;
const FADE_STEPS = 0x10;
const PLANES = 4;
const SCREEN_BYTES = 0x9600;
const ROW_BYTES = 80;

/** 16b2:174a: all black; si moves down from here to 171d, the RAZOR logo's colours (0222 / 0426). */
const LOGO_FADE_IN = 0x174a;
/** 16b2:171d: the logo's colours; si moves up to 174a, black again (022d / 0441). */
const LOGO_FADE_OUT = 0x171d;
const LOGO_RETRACES_PER_STEP = 3;
/** 0225: the logo stays this many retraces. */
const LOGO_HOLD = 0x1f4;
/** 743a:0000, the RAZOR logo: 180 lines of 80 bytes per plane, planes 0..3 one after the other (0510). */
const LOGO = linear(0x743a, 0);
const LOGO_PLANE_BYTES = 0x1c20 * 2;
/** 053b: line 150. */
const LOGO_SCREEN_OFFSET = 0x2ee0;

/** 16b2:0209, the triangle logo: 54 lines of 10 bytes per plane (054f). */
const TRIANGLE = DATA + 0x209;
const TRIANGLE_LINES = 0x36;
const TRIANGLE_LINE_BYTES = 5 * 2;
/** 057d: line 213, byte 35 (pixel 280). */
const TRIANGLE_SCREEN_OFFSET = 0x42b3;
/** 0477: 16b2:171d is rewritten as a grey ramp table: colour 0 black, colours 1..15 grey 4k at entry k. */
const WHITE_FADE = 0x171d;
const WHITE_FADE_GREY_STEP = 4;
const WHITE_FADE_RETRACES_PER_STEP = 2;
/** 16b2:0aa6: white; si moves down to 0a79, the triangle logo's colours (0236 / 045c). */
const TRIANGLE_FADE_IN = 0xaa6;
const TRIANGLE_RETRACES_PER_STEP = 2;
/** 0239: the triangle logo stays this many retraces. */
const TRIANGLE_HOLD = 0x96;
/**
 * Retraces the recording loses that the code does not explain (fitted, see E_ending.md), as extra retraces before
 * a fade step: step 8 of the RAZOR logo's fade-out lasts 4 retraces instead of 3; the triangle logo's fade-out
 * (04b6, which calls the player every retrace) shows its first step 2 retraces late (the hold or step 0 or 1: a
 * still picture cannot tell) and its next to last colours 6 retraces instead of 4. 0000:05be catches a retrace
 * only during the 2-line (64 us) retrace pulse; an interrupt (the GUS player) running across it makes it miss one.
 */
const LOGO_FADE_OUT_LATE_STEPS = { 8: 1 };
const TRIANGLE_FADE_OUT_LATE_STEPS = { 0: 2, 15: 2 };
const NO_LATE_STEPS = {};
/** 16b2:0d79 (= 0a79's colours); si moves up to 0da6, black (0241 / 04b6). */
const TRIANGLE_FADE_OUT = 0xd79;
const TRIANGLE_FADE_OUT_RETRACES_PER_STEP = 4;

/** 16b2:0004, the end screen in TheDraw's crunched format, 0x1fa bytes (0255..0263). */
const END_SCREEN = DATA + 0x0004;
const END_SCREEN_BYTES = 0x1fa;
const TEXT_ROW_BYTES = 0xa0;
/** 03bc's control codes: < 10h foreground, 10h..17h background, 18h new line, 19h spaces, 1ah a run, 1bh blink. */
const CODE_BACKGROUND = 0x10;
const CODE_NEW_LINE = 0x18;
const CODE_SPACES = 0x19;
const CODE_RUN = 0x1a;
const CODE_BLINK = 0x1b;
const CODE_FIRST_CHARACTER = 0x20;
/** Text attribute bits: 7 blink, 4-6 background, 0-3 foreground. */
const BLINK = 0x80;
const KEEP_FOREGROUND_AND_BLINK = 0x8f;
const KEEP_BLINK_AND_BACKGROUND = 0xf0;
const SPACE = 0x20;

/**
 * What DOS (COMMAND.COM) prints after the exit, by BIOS teletype from the cursor, which nothing moved from row 0
 * column 0: a new line, then the prompt; teletype writes characters only, the cells keep mode 3's attribute 07h.
 */
const DOS_PROMPT_ROW = 1;
const DOS_PROMPT = 'C:\\>';
const TEXT_COLUMNS = 80;
const CRTC_INDEX = 0x3d4;
/** CRTC 0eh/0fh: the cursor's cell, high and low byte. */
const CRTC_CURSOR_HIGH = 0x0e;
const CRTC_CURSOR_LOW = 0x0f;

/** 0000:04e2: attribute registers 0..15 = 0..15, then DAC 0..15 from every 16th entry of the table at si. */
function setColours(m, si) {
  const vga = m.vga;
  for (let i = 0; i < COLOURS; i++) {
    vga.in8(INPUT_STATUS);
    vga.out8(ATTRIBUTE_PORT, i);
    vga.out8(ATTRIBUTE_PORT, i);
  }
  vga.out8(ATTRIBUTE_PORT, ATTRIBUTE_PAS);
  vga.out8(DAC_WRITE_INDEX, 0);
  let at = DATA + si;
  for (let colour = 0; colour < COLOURS; colour++) {
    vga.out8(DAC_DATA, m.u8(at));
    vga.out8(DAC_DATA, m.u8(at + 1));
    vga.out8(DAC_DATA, m.u8(at + 2));
    at += COLOUR_STRIDE;
  }
}

/**
 * 0426 / 0441 / 045c / 049b / 04b6: 16 steps; each waits `retraces` retraces (plus `late[step]`, retraces the
 * recording missed), then sets the colours at si and moves si by `direction` entries. 04b6 also calls the player
 * (ah=28h) after each retrace with a volume bx from 100h down by 2: the soundtrack has that fade rendered in.
 * @param {Machine} m
 * @param {number} si
 * @param {number} direction
 * @param {number} retraces
 * @param {LateSteps} late
 */
function* fade(m, si, direction, retraces, late = NO_LATE_STEPS) {
  let at = si;
  for (let step = 0; step < FADE_STEPS; step++) {
    yield* waitRetraces(m, retraces + (late[step] ?? 0));
    setColours(m, at);
    at += direction * FADE_STEP;
  }
}

function* waitRetraces(m, count) {
  for (let i = 0; i < count; i++) {
    yield* waitRetrace(m);
  }
}

/** `rep stosb` of the whole screen to a000:0, into `planes` (map mask). */
function fillScreen(m, planes, value) {
  const vga = m.vga;
  vga.out16(SEQUENCER_INDEX, (planes << 8) | MAP_MASK);
  for (let offset = 0; offset < SCREEN_BYTES; offset++) {
    vga.write(offset, value);
  }
}

/** 0000:0510: plane 0 filled (colour 1, the lilac), then the RAZOR logo's four planes at line 150. */
function drawRazorLogo(m) {
  const vga = m.vga;
  fillScreen(m, PLANE_0, 0xff);
  let source = LOGO;
  for (let plane = 0; plane < PLANES; plane++) {
    vga.out16(SEQUENCER_INDEX, ((PLANE_0 << plane) << 8) | MAP_MASK); // 0538, 0539 shl ah, 1
    for (let i = 0; i < LOGO_PLANE_BYTES; i++) {
      vga.write(LOGO_SCREEN_OFFSET + i, m.u8(source++));
    }
  }
  vga.out16(SEQUENCER_INDEX, (ALL_PLANES << 8) | MAP_MASK);
}

/** 0000:054f: the screen cleared, the triangle logo's four planes at line 213, byte 35. */
function drawTriangleLogo(m) {
  const vga = m.vga;
  fillScreen(m, ALL_PLANES, 0);
  let source = TRIANGLE;
  for (let plane = 0; plane < PLANES; plane++) {
    vga.out16(SEQUENCER_INDEX, ((PLANE_0 << plane) << 8) | MAP_MASK); // 0577, 0578 shl ah, 1
    let destination = TRIANGLE_SCREEN_OFFSET;
    for (let line = 0; line < TRIANGLE_LINES; line++) {
      for (let i = 0; i < TRIANGLE_LINE_BYTES; i++) {
        vga.write(destination + i, m.u8(source++));
      }
      destination += ROW_BYTES;
    }
  }
  vga.out16(SEQUENCER_INDEX, (ALL_PLANES << 8) | MAP_MASK);
}

/** 0000:0477..0499: 16b2:171d = 16 black entries, then 15 rows of 16 greys 0, 4, .. 60. */
function buildWhiteFade(m) {
  let at = DATA + WHITE_FADE;
  m.mem.fill(0, at, at + COLOUR_STRIDE);
  at += COLOUR_STRIDE;
  for (let row = 1; row < COLOURS; row++) {
    for (let entry = 0; entry < COLOURS; entry++) {
      const grey = entry * WHITE_FADE_GREY_STEP;
      m.mem.fill(grey, at, at + 3);
      at += 3;
    }
  }
}

/**
 * 0000:03bc: TheDraw's crunched text from ds:si (cx bytes) to es:di = b800:di. Characters >= 20h are stored with
 * the current attribute (ah, 0 at the start); the control codes change it, start a new line (dx += 160) or store
 * runs of count + 1 characters.
 */
function drawCrunchedText(m, si, di, count) {
  const text = m.vga.textScreen;
  let source = si;
  let at = di;
  let lineStart = di;
  let attribute = 0;
  let remaining = count;
  const store = (character) => {
    text[at] = character;
    text[at + 1] = attribute;
    at += 2;
  };
  while (remaining > 0) {
    const code = m.u8(source++);
    remaining--;
    if (code >= CODE_FIRST_CHARACTER) {
      store(code);
    } else if (code < CODE_BACKGROUND) {
      attribute = (attribute & KEEP_BLINK_AND_BACKGROUND) | code;
    } else if (code < CODE_NEW_LINE) {
      attribute = (attribute & KEEP_FOREGROUND_AND_BLINK) | ((code - CODE_BACKGROUND) << 4);
    } else if (code === CODE_NEW_LINE) {
      lineStart += TEXT_ROW_BYTES;
      at = lineStart;
    } else if (code === CODE_SPACES || code === CODE_RUN) {
      // 0408..041d: the count byte (and the character for 1ah) count against cx too.
      const runLength = m.u8(source++) + 1;
      remaining--;
      let character = SPACE;
      if (code === CODE_RUN) {
        character = m.u8(source++);
        remaining--;
      }
      for (let i = 0; i < runLength; i++) {
        store(character);
      }
    } else if (code === CODE_BLINK) {
      attribute ^= BLINK;
    } // 1ch..1fh: ignored (0401)
  }
}

/** After int 21h ax=4c00h: DOS's prompt on row 1, and the cursor after it (int 10h ah=2 programs CRTC 0eh/0fh). */
function printDosPrompt(m) {
  const vga = m.vga;
  const start = DOS_PROMPT_ROW * TEXT_COLUMNS;
  for (let i = 0; i < DOS_PROMPT.length; i++) {
    vga.textScreen[(start + i) * 2] = DOS_PROMPT.charCodeAt(i);
  }
  const cursor = start + DOS_PROMPT.length;
  vga.out8(CRTC_INDEX, CRTC_CURSOR_HIGH);
  vga.out8(CRTC_INDEX + 1, cursor >> 8);
  vga.out8(CRTC_INDEX, CRTC_CURSOR_LOW);
  vga.out8(CRTC_INDEX + 1, cursor & 0xff);
}

/** @param {Machine} m */
export function* ending(m) {
  m.vga.setMode12(); // 0211 int 10h ax=12h
  yield* waitRetrace(m); // 0216
  setColours(m, LOGO_FADE_IN); // 021c
  drawRazorLogo(m); // 021f
  yield* fade(m, LOGO_FADE_IN, -1, LOGO_RETRACES_PER_STEP); // 0222
  yield* waitRetraces(m, LOGO_HOLD); // 0225
  yield* fade(m, LOGO_FADE_OUT, 1, LOGO_RETRACES_PER_STEP, LOGO_FADE_OUT_LATE_STEPS); // 022d
  drawTriangleLogo(m); // 0230
  buildWhiteFade(m); // 0233
  yield* fade(m, WHITE_FADE, 1, WHITE_FADE_RETRACES_PER_STEP);
  yield* fade(m, TRIANGLE_FADE_IN, -1, TRIANGLE_RETRACES_PER_STEP); // 0236
  yield* waitRetraces(m, TRIANGLE_HOLD); // 0239
  yield* fade(m, TRIANGLE_FADE_OUT, 1, TRIANGLE_FADE_OUT_RETRACES_PER_STEP, TRIANGLE_FADE_OUT_LATE_STEPS); // 0241
  // 0244: player ah=0bh stops the music; the soundtrack ends there by itself.
  m.vga.setMode3(); // 0250
  drawCrunchedText(m, END_SCREEN, 0, END_SCREEN_BYTES); // 0255..0263
  // 0266: the BIOS keyboard buffer emptied (head = tail), then int 21h ax=4c00h.
  printDosPrompt(m);
}
