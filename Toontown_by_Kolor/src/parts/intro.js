// The first four parts (docs/disassembly/A_intro_outro.md):
//   p01 0x10ed9f  the background fades to dark blue, then the spiral animation (spiral.js) runs backwards;
//   p02 0x10ecc1  the Kolor picture;
//   p03 0x10e813  the credits: a name picture wobbled by sine tables over a background picture;
//   p04 0x10eaa0  the "TOON town" picture fades in with a pulsing blue colour, gets its sprite, and fades out.
import { POSITION, ROW, RETRACES, copyToScreen, setPalette, waitRetrace } from '../machine.js';
import {
  SCREEN, SCREEN_BYTES, setColour, spiralBackwards, startSpiral, waitRetraces,
} from './spiral.js';

/** @typedef {import('../machine.js').Machine} Machine */

/** [0x12bd80], the 0x2ee00-byte work buffer main allocates at 0x100317 (before the loading). */
const WORK_BUFFER = 0x12bd80;
const SCREEN_WIDTH = 0x140;
const SCREEN_LINES = 0xc8;

// ---- p01 ----

/** 0x10ee35: colour 0 goes from (0, 0, 0) to (0, 0, 10), a step every 12 retraces. */
const FADE_STEPS = 0xb;
const RETRACES_PER_FADE_STEP = 12;

// ---- p02 ----

/** The Kolor picture and its palette. */
const KOLOR_PICTURE = 0x16dbe4;
const KOLOR_PALETTE = 0x16dbe8;

// ---- p03 ----

/** The background picture, the five name pictures and their palette. */
const CREDITS_BACKGROUND = 0x16d5d8;
const CREDITS_NAMES = [0x16d5c4, 0x16d5c8, 0x16d5cc, 0x16d5d0, 0x16d5d4];
const CREDITS_PALETTE = 0x16d5dc;
/** 0x10e81d copies the name pointers here; 0x10e6b1 writes its 256-entry sine table after them. */
const NAME_POINTERS = 0x170fd8;
const SINE_TABLE = 0x170fec;
const SINE_TABLE_SIZE = 0x100;
/** The colour 0x10e701 does not copy, and that 0x10e8bf paints the two bars with. */
const TRANSPARENT = 0x5c;
const LAST_SOURCE_OFFSET = 0xf9ff;
/** 0x10e75d: rows move by up to 5 lines, sin((a + b + y) * pi / 60). */
const ROW_WAVE_DIVISOR = 60;
const ROW_WAVE_AMPLITUDE = 5;
/** 0x10e8b2: two bars 6 pixels wide and 50 lines high at (0, 75) and (314, 75). */
const BAR_LEFT = 0x5dc0;
const BAR_RIGHT = 0x5efa;
const BAR_WIDTH = 6;
const BAR_LINES = 0x32;
/** 0x10e91d: in the third name's position, from row 0x21 the fourth name shows. */
const SKIPPED_NAME = 2;
const SKIP_ROW = 0x20;
/** 0x10e975: the sine table's amplitude, 22 + 10 cos(a pi / 128) - 10 sin(b pi / 128). */
const AMPLITUDE_CENTRE = 22;
const AMPLITUDE_SWING = 10;
const ANGLE_STEP = 1 / 128;

// ---- p04 ----

/** The picture, its palette, and the sprite drawn over it once it has faded in. */
const TOWN_PICTURE = 0x16d8dc;
const TOWN_PALETTE = 0x16d8e0;
const TOWN_SPRITE = 0x16dbe0;
/** 0x10eac4: the palette that fades from black to TOWN_PALETTE. */
const FADE_PALETTE = 0x1713ec;
const PALETTE_BYTES = 0x300;
/** 0x10eb6d: 63 fade steps (0x10ea68: 3 retraces each). */
const FADE_IN_STEPS = 0x3f;
const RETRACES_PER_FADE_IN_STEP = 3;
/** The colour that pulses blue: 20 - 7 cos(angle). */
const PULSING_COLOUR = 0x5c;
const FIRST_BLUE = 0x10;
const DEGREES = 0x168;
/** 0x10ebcb / 0x10ec8d: from row 0x2e of the last position the palette fades out. */
const FADE_OUT_ROW = 0x2d;

/** [0x12bd80] (allocated by loader.js). */
function workBuffer(m) {
  return m.u32(WORK_BUFFER);
}

/**
 * The x87 rounds a - b to 64 bits; doubles can round a tiny b away. Math.trunc of the exact difference
 * (TwoSum: s + err is exactly a - b).
 */
function truncDifference(a, b) {
  const s = a - b;
  const bVirtual = a - s;
  const err = (a - (s + bVirtual)) + (bVirtual - b);
  const n = Math.trunc(s);
  if (n === s && err < 0 && s > 0) {
    return n - 1;
  }
  if (n === s && err > 0 && s < 0) {
    return n + 1;
  }
  return n;
}

/** 0x10ed9f: p01, until position 2. */
export function* spiralIntro(m, lastPosition) {
  startSpiral(m);
  for (let blue = 0; blue < FADE_STEPS; blue++) {
    yield* waitRetraces(m, RETRACES_PER_FADE_STEP);
    setColour(m, 0, 0, 0, blue); // 0x10ee46
  }
  return yield* spiralBackwards(m, lastPosition);
}

/** 0x10ecc1: p02, the Kolor picture (the cosine it computes is not used). */
export function* kolorLogo(m, lastPosition) {
  setPalette(m, KOLOR_PALETTE);
  for (;;) {
    m.readPlayStatus();
    if (lastPosition <= m.u32(POSITION)) {
      return false;
    }
    yield* waitRetrace(m);
    copyToScreen(m, m.u32(KOLOR_PICTURE));
  }
}

/** 0x10e6b1: the table at 0x170fec, entry i = trunc(sin(i pi / 128) * amplitude). */
function buildSineTable(m, amplitude) {
  for (let i = 0; i < SINE_TABLE_SIZE; i++) {
    m.set32(SINE_TABLE + i * 4, Math.trunc(Math.sin(i * Math.PI * ANGLE_STEP) * amplitude));
  }
}

/**
 * 0x10e701: copies `picture` over the work buffer, skipping TRANSPARENT. Pixel (x, y) comes from
 * y * 320 + x + 320 * trunc(5 sin((a + b + y) pi / 60)) + T[(a + y + x) & 255] + T[(b + x) & 255], clamped to the
 * picture, with T the sine table for `amplitude`.
 */
function drawWobbledName(m, a, b, amplitude, picture) {
  buildSineTable(m, amplitude);
  const mem = m.mem;
  const buffer = m.u32(WORK_BUFFER);
  for (let y = 0; y < SCREEN_LINES; y++) {
    const shift = Math.trunc(Math.sin(((a + b + y) * Math.PI) / ROW_WAVE_DIVISOR) * ROW_WAVE_AMPLITUDE);
    const rowStart = y * SCREEN_WIDTH;
    const sourceRow = rowStart + shift * SCREEN_WIDTH;
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      let offset = sourceRow + x + m.s32(SINE_TABLE + ((a + y + x) & 0xff) * 4)
        + m.s32(SINE_TABLE + ((b + x) & 0xff) * 4);
      if (offset < 0) {
        offset = 0;
      }
      if (offset > LAST_SOURCE_OFFSET) {
        offset = LAST_SOURCE_OFFSET;
      }
      const pixel = mem[picture + offset];
      if (pixel !== TRANSPARENT) {
        mem[buffer + rowStart + x] = pixel;
      }
    }
  }
}

/** 0x10e8b2: the two bars at the sides. */
function drawBars(m) {
  const buffer = m.u32(WORK_BUFFER);
  for (const start of [BAR_LEFT, BAR_RIGHT]) {
    for (let line = 0; line < BAR_LINES; line++) {
      m.mem.fill(TRANSPARENT, buffer + start + line * SCREEN_WIDTH, buffer + start + line * SCREEN_WIDTH + BAR_WIDTH);
    }
  }
}

/** 0x10e975: the next frame's sine table amplitude. */
function creditsAmplitude(a, b) {
  const cosine = Math.cos((a & 0xff) * Math.PI * ANGLE_STEP) * AMPLITUDE_SWING + AMPLITUDE_CENTRE;
  const sine = Math.sin((b & 0xff) * Math.PI * ANGLE_STEP) * AMPLITUDE_SWING;
  return truncDifference(cosine, sine);
}

/** 0x10e813: p03, the credits, until position 8. */
export function* credits(m, lastPosition) {
  const buffer = workBuffer(m);
  CREDITS_NAMES.forEach((global, i) => m.set32(NAME_POINTERS + i * 4, m.u32(global)));
  setPalette(m, CREDITS_PALETTE);
  let a = 0; // ebp
  let b = 0; // [esp+0x20]
  let amplitude = 0; // [esp+0x18]
  let lastRetraces = m.u32(RETRACES);
  m.readPlayStatus();
  let name = 0;
  let namePosition = m.u32(POSITION);
  do {
    copyToScreen(m, m.u32(CREDITS_BACKGROUND), buffer); // 0x10e882
    drawWobbledName(m, a, b, amplitude, m.u32(NAME_POINTERS + name * 4));
    drawBars(m);
    yield* waitRetrace(m);
    copyToScreen(m, buffer);
    m.readPlayStatus();
    if (m.u32(POSITION) !== namePosition) {
      namePosition = m.u32(POSITION);
      name++;
    }
    if (m.u32(ROW) > SKIP_ROW && name === SKIPPED_NAME) {
      name++;
    }
    const retraces = m.u32(RETRACES);
    const passed = retraces - lastRetraces;
    lastRetraces = retraces;
    a += passed;
    b += passed;
    amplitude = creditsAmplitude(a, b);
  } while (lastPosition > m.u32(POSITION));
  return false;
}

/** 0x10eb3f: the pulsing colour's blue, trunc(12 - 7 cos(angle) + 8) in 80 bits. */
function pulseBlue(angle) {
  return truncDifference(20, Math.cos((angle / 180) * Math.PI) * 7);
}

/** 0x10ea68: three retraces, then FADE_PALETTE one step up towards TOWN_PALETTE. */
function* fadeInStep(m) {
  yield* waitRetraces(m, RETRACES_PER_FADE_IN_STEP);
  for (let i = 0; i < PALETTE_BYTES; i++) {
    if (m.mem[FADE_PALETTE + i] < m.mem[TOWN_PALETTE + i]) {
      m.mem[FADE_PALETTE + i]++;
    }
  }
}

/** 0x10ea43: TOWN_PALETTE one step down towards black. */
function fadeOutStep(m) {
  for (let i = 0; i < PALETTE_BYTES; i++) {
    if (m.mem[TOWN_PALETTE + i] > 0) {
      m.mem[TOWN_PALETTE + i]--;
    }
  }
}

/** 0x100a79: a 320x200 sprite onto a 320x200 picture, colour 0 transparent. */
function drawSprite(m, sprite, picture) {
  for (let i = 0; i < SCREEN_WIDTH * SCREEN_LINES; i++) {
    const pixel = m.mem[sprite + i];
    if (pixel !== 0) {
      m.mem[picture + i] = pixel;
    }
  }
}

/** 0x10eaa0: p04, the "TOON town" picture, until position 0xb. */
export function* toonTown(m, lastPosition) {
  let blue = FIRST_BLUE;
  let angle = 0;
  // 0x10eac4: the last byte is not cleared
  m.mem.fill(0, FADE_PALETTE, FADE_PALETTE + PALETTE_BYTES - 1);
  setPalette(m, FADE_PALETTE);
  copyToScreen(m, m.u32(TOWN_PICTURE));
  let lastRetraces = m.u32(RETRACES);
  m.readPlayStatus();
  for (let step = 0; step < FADE_IN_STEPS; step++) {
    yield* fadeInStep(m);
    setPalette(m, FADE_PALETTE);
    setColour(m, PULSING_COLOUR, 0, 0, blue);
    angle = (angle + 1) % DEGREES;
    blue = pulseBlue(angle);
  }
  m.readPlayStatus();
  drawSprite(m, m.u32(TOWN_SPRITE), m.u32(TOWN_PICTURE));
  const isFadingOut = () => lastPosition - 1 <= m.u32(POSITION) && m.u32(ROW) > FADE_OUT_ROW;
  while (lastPosition > m.u32(POSITION)) {
    yield* waitRetrace(m);
    if (isFadingOut() || lastPosition === m.u32(POSITION)) {
      setPalette(m, TOWN_PALETTE);
    } else {
      setColour(m, PULSING_COLOUR, 0, 0, blue);
    }
    copyToScreen(m, m.u32(TOWN_PICTURE));
    const retraces = m.u32(RETRACES);
    angle = (angle + retraces - lastRetraces) % DEGREES;
    lastRetraces = retraces;
    blue = pulseBlue(angle);
    m.readPlayStatus();
    if (isFadingOut()) {
      fadeOutStep(m);
    }
  }
  return false;
}
