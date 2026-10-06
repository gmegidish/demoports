// Part 3 ($551a0): the word "melon" as a sheet of 18 scanlines that tumbles like a piece of paper, while a
// wall of grey space invaders marches in from the right, zigzags down twice and leaves on the left.
//
// The logo is not a bitmap. Every scanline of it is one straight line between two points that ride on sine
// tables, and a run-length table says where along that line the colour changes; the runs are drawn
// alternately into bitplanes 1 and 3 with the blitter's line mode. The invaders are a 368x88 one-plane
// picture (two frames of animation) copied into every other row of bitplane 2 with a clipped, shifted blit.
// Two sets of buffers are swapped every frame, and only the logo's bounding box is cleared.
import { r16, r16s, w16, w32, s16, waitLine, pokeCopperPointer } from '../machine.js';
import { blit } from '../blitter.js';
import { fadeColour } from '../colour.js';

const A5 = 0x168000;
const WORKSPACE = A5 - 0x8000;
const WORKSPACE_LONGS = 0x3c0f;
const COPPER = 0x55fc4;
const COPPER_PLANES = 0x55fde;
/** COLOR00's value word in the copper list; the low-nibble (LOCT) copy of each colour is 0x24 bytes on. */
const COPPER_COLOURS = 0x56016;
const LOW_NIBBLES = 0x24;
const LOGO_DARK_COLOURS = [1, 3, 7];
const LOGO_LIGHT_COLOURS = [4, 5, 6];
const LOGO_DARK = 0x789;
const LOGO_LIGHT = 0xfff;

/** Logo buffers: planes 1 and 3 interleaved, 40 bytes each. The 8 bytes in front hold the bounding box. */
const LOGO_BUFFER_A = A5 - 0x7fe0;
const LOGO_BUFFER_B = A5 - 0x2fd8;
const LOGO_LINE_BYTES = 0x50;
const PLANE_BYTES = 0x28;
const BOX_MIN_X = -8;
const BOX_MAX_X = -6;
const BOX_MIN_Y = -4;
const BOX_MAX_Y = -2;
const SCREEN_RIGHT = 0x13f;
const SCREEN_BOTTOM = 0xff;
const INVADER_BUFFER_A = A5 + 0x2030;
const INVADER_BUFFER_B = A5 + 0x4838;

/** Sine tables of words, amplitude 0x35, each with a flat lead-in. Offsets into them wrap by one period. */
const SINE_X = 0x555f2;
const SINE_X_END = 0x244;
const SINE_X_PERIOD = 0x190;
const SINE_Y = 0x55836;
const SINE_Y_END = 0x2bc;
const SINE_Y_PERIOD = 0x208;

/** Per logo scanline: a count, then count+1 run ends in 26ths of the line. */
const LOGO_RUNS = 0x55af2;
const LOGO_ROWS = 0x12;
const RUN_UNITS = 0x1a;
const LOGO_LEFT = 0x6c;
const LOGO_RIGHT = 0xd4;
const LOGO_BOTTOM = 0x8e;
const LOGO_ROW_STEP = 2;

const INVADERS_FRAME_A = 0x57036;
const INVADERS_FRAME_B = 0x56066;
const INVADERS_WIDTH = 0x170;
const INVADERS_LINE_BYTES = 0x2e;
const INVADERS_ROWS = 0x58;
const SCREEN_WIDTH = 0x140;
/** Timeline, in frames. The counter starts negative: that is the fade in. */
const FADE_FRAMES = 0x20;
const ZIGZAG_START = 0x140;
const ZIGZAG_END = 0x224;
const ZIGZAG_FRAMES = 0x72;
const ZIGZAG_LEFT_END = 0x30;
const ZIGZAG_DOWN_END = 0x39;
const ZIGZAG_RIGHT_END = 0x69;
const INVADERS_GONE = 0x394;
const FADE_OUT_START = 0x3b8;
const LAST_FRAME = 0x3d8;

const wrapX = (offset) => (offset >= SINE_X_END ? offset - SINE_X_PERIOD : offset);
const wrapY = (offset) => (offset >= SINE_Y_END ? offset - SINE_Y_PERIOD : offset);

/** $55f18 with the fade level in d2: 0 shows the logo colours, $100 is black. */
function setLogoColours(m, level) {
  const store = (index, colour) => {
    w16(m, COPPER_COLOURS + index * 4, colour.high);
    w16(m, COPPER_COLOURS + index * 4 + LOW_NIBBLES, colour.low);
  };
  LOGO_DARK_COLOURS.forEach((index) => store(index, fadeColour(LOGO_DARK, 0, level)));
  LOGO_LIGHT_COLOURS.forEach((index) => store(index, fadeColour(LOGO_LIGHT, 0, level)));
}

function showBuffers(m, logo, invaders) {
  pokeCopperPointer(m, COPPER_PLANES, logo);
  pokeCopperPointer(m, COPPER_PLANES + 8, logo + PLANE_BYTES);
  pokeCopperPointer(m, COPPER_PLANES + 16, invaders);
  m.cop1lc = COPPER;
}

/** Wipe the rectangle the logo covered the last time this buffer was drawn into, both planes at once. */
function clearLogoBox(m, buffer) {
  const firstWord = r16(m, buffer + BOX_MIN_X) >> 4;
  const bytes = ((r16(m, buffer + BOX_MAX_X) >> 4) + 1 - firstWord) * 2;
  const top = r16(m, buffer + BOX_MIN_Y);
  const rows = (r16(m, buffer + BOX_MAX_Y) - top + 1) & 0xffff;
  const b = m.blt;
  b.con0 = 0x0100;
  b.con1 = 0;
  b.dmod = PLANE_BYTES - bytes;
  b.dpt = buffer + firstWord * 2 + top * LOGO_LINE_BYTES;
  blit(m, ((rows << 7) + (bytes >> 1)) & 0xffff);
  w16(m, buffer + BOX_MAX_X, 0);
  w16(m, buffer + BOX_MAX_Y, 0);
  w16(m, buffer + BOX_MIN_X, SCREEN_RIGHT);
  w16(m, buffer + BOX_MIN_Y, SCREEN_BOTTOM);
}

function growLogoBox(m, buffer, x, y) {
  if (x < r16s(m, buffer + BOX_MIN_X)) { w16(m, buffer + BOX_MIN_X, x); }
  if (x > r16s(m, buffer + BOX_MAX_X)) { w16(m, buffer + BOX_MAX_X, x); }
  if (y < r16s(m, buffer + BOX_MIN_Y)) { w16(m, buffer + BOX_MIN_Y, y); }
  if (y > r16s(m, buffer + BOX_MAX_Y)) { w16(m, buffer + BOX_MAX_Y, y); }
}

/** BLTCON1 for a line: bit 0 line mode, bit 4 x is the long axis, bit 2 / bit 3 the long / short axis runs backwards. */
function lineOctant(dx, dy) {
  const isSteep = Math.abs(dy) > Math.abs(dx);
  if (isSteep) {
    return 0x01 | (dy < 0 ? 0x04 : 0) | (dx < 0 ? 0x08 : 0);
  }
  return 0x11 | (dx < 0 ? 0x04 : 0) | (dy < 0 ? 0x08 : 0);
}

/** $55ea2: one run of a logo scanline, OR-ed into a plane as a blitter line `major` dots long. */
function drawRun(m, plane, x, y, major, minor, octant) {
  if (major === 0 && minor === 0) {
    return;
  }
  if (minor > major) {
    [major, minor] = [minor, major];
    octant ^= 0x10;
  }
  const error = s16(4 * minor - 2 * major);
  const b = m.blt;
  b.bmod = s16(4 * minor);
  b.amod = s16(4 * minor - 4 * major);
  b.cpt = plane + (((x >> 4) * 2 + y * LOGO_LINE_BYTES) & 0xffff);
  b.dpt = b.cpt;
  b.con0 = ((x & 15) << 12) | 0x0bfa;
  b.con1 = error < 0 ? octant | 0x40 : octant;
  b.apt = error >>> 0;
  blit(m, ((major << 6) + 2) & 0xffff);
}

/**
 * $55cae: one scanline of the logo, from (x1,y1) to (x2,y2) once each end has been pushed around by the sine
 * tables. `runs` points at the scanline's run table; the address of the next scanline's table is returned.
 */
function drawLogoRow(m, buffer, runs, phase, x1, y1, x2, y2) {
  phase.x1 = wrapX(phase.x1 + 6);
  phase.y1 = wrapY(phase.y1 + 4);
  phase.x2 = wrapX(phase.x2 + 8);
  phase.y2 = wrapY(phase.y2 + 6);
  x1 += r16s(m, SINE_X + phase.x1);
  y1 += r16s(m, SINE_Y + phase.y1);
  x2 += r16s(m, SINE_X + phase.x2);
  y2 += r16s(m, SINE_Y + phase.y2);
  growLogoBox(m, buffer, x1, y1);
  growLogoBox(m, buffer, x2, y2);

  const octant = lineOctant(x2 - x1, y2 - y1);
  const major = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  const minor = Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1));
  const majorStep = octant & 0x04 ? -1 : 1;
  const minorStep = octant & 0x08 ? -1 : 1;
  const isXMajor = (octant & 0x10) !== 0;
  const runCount = r16(m, runs) + 1;
  let x = x1;
  let y = y1;
  let majorDone = 0;
  let minorDone = 0;
  for (let run = 0; run < runCount; run++) {
    const end = r16(m, runs + 2 + run * 2);
    const majorRun = Math.floor((major * end) / RUN_UNITS) - majorDone;
    const minorRun = Math.floor((minor * end) / RUN_UNITS) - minorDone;
    majorDone += majorRun;
    minorDone += minorRun;
    drawRun(m, buffer + (run & 1 ? PLANE_BYTES : 0), x, y, majorRun, minorRun, octant);
    x += isXMajor ? majorStep * majorRun : minorStep * minorRun;
    y += isXMajor ? minorStep * minorRun : majorStep * majorRun;
  }
  return runs + 2 + runCount * 2;
}

function drawLogo(m, buffer, phase) {
  const b = m.blt;
  b.afwm = 0xffff;
  b.alwm = 0xffff;
  b.cmod = LOGO_LINE_BYTES;
  b.dmod = LOGO_LINE_BYTES;
  b.bdat = 0xffff;
  b.adat = 0x8000;
  let runs = LOGO_RUNS;
  for (let row = 0; row < LOGO_ROWS; row++) {
    const y = LOGO_BOTTOM - row * LOGO_ROW_STEP;
    runs = drawLogoRow(m, buffer, runs, phase, LOGO_LEFT, y, LOGO_RIGHT, y);
  }
}

/** Only every other row of the invaders' plane is ever drawn into, so only those are cleared. */
function clearInvaders(m, buffer) {
  const b = m.blt;
  b.con0 = 0x0100;
  b.con1 = 0;
  b.dpt = buffer;
  b.dmod = PLANE_BYTES;
  blit(m, 0x2014);
}

function copyInvaders(m, source, destination, shift, firstWordMask, lastWordMask, words) {
  const b = m.blt;
  b.con0 = (shift << 12) | 0x09f0;
  b.con1 = 0;
  b.afwm = firstWordMask;
  b.alwm = lastWordMask;
  b.amod = INVADERS_LINE_BYTES - words * 2;
  b.dmod = LOGO_LINE_BYTES - words * 2;
  b.apt = source;
  b.dpt = destination;
  blit(m, (INVADERS_ROWS << 6) | words);
}

/** $554b0: the picture hangs off the left edge. Skip the hidden words, mask the hidden bits of the first one. */
function drawInvadersCutLeft(m, frame, line, x) {
  const hidden = -x;
  const hiddenBits = hidden & 15;
  const firstWordMask = hiddenBits === 0 ? 0xffff : (1 << (16 - hiddenBits)) - 1;
  let lastWordMask = ~firstWordMask & 0xffff;
  let width = x + INVADERS_WIDTH;
  if (width >= SCREEN_WIDTH) {
    width = SCREEN_WIDTH;
  } else if (width & 15) {
    width += 16;
    lastWordMask = 0;
  }
  const destination = hiddenBits === 0 ? line : line - 2;
  copyInvaders(m, frame + (hidden >> 4) * 2, destination, x & 15, firstWordMask, lastWordMask, (width >> 4) + 1);
}

/** $55554: the picture starts on screen and is cut off by the right edge. */
function drawInvadersCutRight(m, frame, line, x) {
  const width = SCREEN_WIDTH - x;
  const lastWordMask = (-(1 << (~width & 15)) << 1) & 0xffff;
  copyInvaders(m, frame, line + (x >> 4) * 2, x & 15, 0xffff, lastWordMask, (width >> 4) + 1);
}

/** Left across the screen, two zigzags down like the arcade game, then left again until they are gone. */
function marchInvaders(position, frame) {
  if (frame < ZIGZAG_START || frame >= ZIGZAG_END) {
    position.x -= 1;
    return;
  }
  const step = (frame - ZIGZAG_START) % ZIGZAG_FRAMES;
  if (step < ZIGZAG_LEFT_END) {
    position.x -= 1;
  } else if (step < ZIGZAG_DOWN_END) {
    position.y += 2;
  } else if (step < ZIGZAG_RIGHT_END) {
    position.x += 1;
  } else {
    position.y += 2;
  }
}

function drawInvaders(m, buffer, position, frame) {
  if (frame >= INVADERS_GONE) {
    return;
  }
  marchInvaders(position, frame);
  const picture = frame & 0x20 ? INVADERS_FRAME_B : INVADERS_FRAME_A;
  const line = buffer + position.y * PLANE_BYTES;
  if (position.x >= SCREEN_WIDTH || position.x <= -INVADERS_WIDTH) {
    return;
  }
  if (position.x < 0) {
    drawInvadersCutLeft(m, picture, line, position.x);
  } else {
    drawInvadersCutRight(m, picture, line, position.x);
  }
}

/** The logo's four sine offsets move on every frame, except during the fade in. */
function tumble(phase) {
  phase.x1 = wrapX(phase.x1 + 2);
  phase.x2 = wrapX(phase.x2 + 4);
  phase.y1 = wrapY(phase.y1 + 6);
  phase.y2 = wrapY(phase.y2 + 2);
}

export function* Invaders(m) {
  for (let i = 0; i < WORKSPACE_LONGS; i++) {
    w32(m, WORKSPACE + i * 4, 0);
  }
  let logo = LOGO_BUFFER_A;
  let invaders = INVADER_BUFFER_A;
  const phase = { x1: 0, y1: 0, x2: 0, y2: 0 };
  const position = { x: r16s(m, 0x56060), y: r16s(m, 0x56062) };

  for (let frame = -FADE_FRAMES; ; frame++) {
    yield* waitLine(m, 0xff);
    showBuffers(m, logo, invaders);
    logo = logo === LOGO_BUFFER_A ? LOGO_BUFFER_B : LOGO_BUFFER_A;
    invaders = invaders === INVADER_BUFFER_A ? INVADER_BUFFER_B : INVADER_BUFFER_A;
    clearLogoBox(m, logo);
    drawLogo(m, logo, { ...phase });
    clearInvaders(m, invaders);
    if (frame > LAST_FRAME) {
      return;
    }
    if (frame < 0) {
      setLogoColours(m, -frame << 3);
      continue;
    }
    tumble(phase);
    if (frame >= FADE_OUT_START) {
      setLogoColours(m, (frame - FADE_OUT_START) << 3);
      continue;
    }
    drawInvaders(m, invaders, position, frame);
  }
}
