// Part 1 ($d3a68, crunched on disk): a 7-bitplane picture of mushrooms. A little character walks down the
// middle of it, stops, the lights flicker, and a white star grows out of the centre until it covers the screen.
//
// Everything is the blitter: the character is a cookie-cut blit over a saved strip of background,
// the star is ten blitter lines and one fill, drawn into a spare bitplane whose 64 colours are all white.
import { r16, r16s, w16, s16, waitLine, waitFrames, pokeCopperPointer } from '../machine.js';
import { blit } from '../blitter.js';
import { fadeColour } from '../colour.js';

const A5 = 0x168000;
const COPPER = 0xd4454;
const COPPER_PLANES = 0xd446e;
const COPPER_STAR_PLANE = 0xd449e;
const COPPER_COLOURS = 0xd44c6;
/** The same 32 colours again, 0x210 bytes on: the low-nibble (LOCT) copy. */
const LOW_NIBBLES = 0x210;
const PALETTE = 0xd43d4;
const SINE = 0xd41e0;
const SINE_BYTES = 0x190;
const QUARTER_TURN = 0x64;
const PICTURE = 0xd6be8;
/** Seven interleaved planes of 40 bytes. */
const LINE_BYTES = 0x118;
const PLANE_BYTES = 0x28;
/** The 32-pixel column the character walks in. */
const COLUMN = PICTURE + 0x12;
const SAVED_COLUMN = A5 - 0x7ff8;
const WALK_FRAME_A = 0xd48e8;
const WALK_FRAME_B = 0xd51a8;
const STAND_FRAME = 0xd5a68;
const DARK_FRAME = 0xd6328;
const SPRITE_ROWS = 0x28;
/** A sprite line is 7 planes of 4 bytes; the mask follows the 40 lines of image. */
const SPRITE_LINE_BYTES = 0x1c;
const SPRITE_MASK = 0x460;
const STAR_BUFFER_A = A5 - 0x6cc8;
const STAR_BUFFER_B = A5 - 0x6ca0;
const STAR_POINTS = A5 - 0x6cf0;
const SCREEN_ROWS = 0xf2;
const RIGHT_EDGE = 0x13b;

function setPalette(m, level) {
  for (let i = 0; i < 32; i++) {
    const colour = fadeColour(0, r16(m, PALETTE + i * 2), level);
    w16(m, COPPER_COLOURS + i * 4, colour.high);
    w16(m, COPPER_COLOURS + i * 4 + LOW_NIBBLES, colour.low);
  }
}

/** Copy the character's column between the picture and a packed buffer, in two blits of 609 rows. */
function copyColumn(m, isSaving) {
  const b = m.blt;
  b.con0 = 0x09f0;
  b.con1 = 0;
  b.afwm = 0xffff;
  b.alwm = 0xffff;
  b.apt = isSaving ? COLUMN : SAVED_COLUMN;
  b.dpt = isSaving ? SAVED_COLUMN : COLUMN;
  b.amod = isSaving ? 0x24 : 0;
  b.dmod = isSaving ? 0 : 0x24;
  blit(m, 0x9842);
  b.apt = isSaving ? COLUMN + 0x5f28 : SAVED_COLUMN + 0x984;
  b.dpt = isSaving ? SAVED_COLUMN + 0x984 : COLUMN + 0x5f28;
  blit(m, 0x9842);
}

function drawCharacter(m, frame, destination, size) {
  const b = m.blt;
  b.con0 = 0x2ff2;
  b.con1 = 0x2000;
  b.afwm = 0xffff;
  b.alwm = 0xffff;
  b.apt = frame;
  b.bpt = frame + SPRITE_MASK;
  b.dpt = destination;
  b.cpt = destination;
  b.cmod = 0x24;
  b.bmod = 0;
  b.amod = 0;
  b.dmod = 0x24;
  blit(m, size);
}

function drawStanding(m, frame, level) {
  setPalette(m, level);
  copyColumn(m, false);
  drawCharacter(m, frame, COLUMN + 0x9290, 0x4602);
}

function flipColumn(m, address) {
  m.mem[address + 0x27] ^= 0x10;
}

/** $d3f50: one edge of the star, clipped to the screen, as a one-dot-per-row blitter line ready for filling. */
function drawEdge(m, buffer, x1, y1, x2, y2, growth) {
  const centreY = 0xa3 - (((growth * growth) & 0xffff) >> 7);
  x1 += 0xa0;
  x2 += 0xa0;
  y1 += centreY;
  y2 += centreY;
  if (y2 === y1) {
    return;
  }
  if (y2 < y1) {
    [x1, x2, y1, y2] = [x2, x1, y2, y1];
  }
  if (y2 <= 0 || y1 >= SCREEN_ROWS) {
    return;
  }
  if (y1 < 0) {
    x1 -= s16(Math.trunc(((x2 - x1) * y1) / (y2 - y1)));
    y1 = 0;
  }
  if (y2 > SCREEN_ROWS) {
    x2 -= s16(Math.trunc(((x2 - x1) * (y2 - SCREEN_ROWS)) / (y2 - y1)));
    y2 = SCREEN_ROWS;
  }
  if (x2 <= x1) {
    [x1, x2, y1, y2] = [x2, x1, y2, y1];
  }
  if (x1 >= RIGHT_EDGE) {
    // Entirely off the right: the fill still needs an edge, so flip the last column on every row it spans.
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    for (let y = top; y < bottom; y++) {
      flipColumn(m, buffer + y * LINE_BYTES);
    }
    return;
  }
  if (x2 <= 0) {
    return;
  }
  if (x2 > RIGHT_EDGE) {
    const cut = s16(Math.trunc(((y2 - y1) * (x2 - (RIGHT_EDGE + 1))) / (x2 - x1)));
    y2 -= cut;
    x2 = RIGHT_EDGE;
    if (cut < 0) {
      for (let i = 1; i <= -cut; i++) {
        flipColumn(m, buffer + (y2 - i) * LINE_BYTES);
      }
    } else {
      for (let i = 0; i < cut; i++) {
        flipColumn(m, buffer + (y2 + i) * LINE_BYTES);
      }
    }
  }
  if (x1 < 0) {
    y1 -= s16(Math.trunc(((y2 - y1) * x1) / (x2 - x1)));
    x1 = 0;
  }
  if (y2 === y1) {
    return;
  }
  if (y2 < y1) {
    [x1, x2, y1, y2] = [x2, x1, y2, y1];
  }
  let major = x2 - x1;
  let minor = y2 - y1;
  let octant;
  if (major >= 0) {
    if (minor > major) {
      [major, minor] = [minor, major];
      octant = 0x03;
    } else {
      octant = 0x13;
    }
  } else {
    major = -major;
    if (minor > major) {
      [major, minor] = [minor, major];
      octant = 0x0b;
    } else {
      octant = 0x17;
    }
  }
  major -= 1;
  minor -= 1;
  const b = m.blt;
  const error = s16(4 * minor - 2 * major);
  b.bmod = s16(4 * minor);
  b.amod = s16(4 * minor - 4 * major);
  b.apt = error >>> 0;
  b.con0 = ((x1 & 15) << 12) | 0x0b4a;
  b.con1 = error < 0 ? octant | 0x40 : octant;
  b.cpt = buffer + y1 * LINE_BYTES + (x1 >> 4) * 2;
  b.dpt = b.cpt;
  blit(m, ((major << 6) + 0x42) & 0xffff);
}

function sine(m, offset) {
  return r16s(m, SINE + offset);
}

/** Ten points on two circles, lines between them, one fill: a five-pointed star `growth` steps old. */
function drawStar(m, buffer, growth) {
  const radius = ((growth * growth) & 0xffff) >> 4;
  let angle = growth * 4 + 4;
  const nextAngle = () => {
    angle += 0x28;
  };
  for (let i = 0; i < 5; i++) {
    if (angle >= SINE_BYTES) { angle -= SINE_BYTES; }
    w16(m, STAR_POINTS + i * 8, (sine(m, angle) * radius) >> 8);
    w16(m, STAR_POINTS + i * 8 + 2, (sine(m, angle + QUARTER_TURN) * radius) >> 8);
    nextAngle();
    if (angle >= SINE_BYTES) { angle -= SINE_BYTES; }
    w16(m, STAR_POINTS + i * 8 + 4, (s16((sine(m, angle) * radius) >> 5) * 0x16) >> 8);
    w16(m, STAR_POINTS + i * 8 + 6, (s16((sine(m, angle + QUARTER_TURN) * radius) >> 5) * 0x16) >> 8);
    nextAngle();
  }
  const b = m.blt;
  b.con0 = 0x0100;
  b.con1 = 0;
  b.dpt = buffer;
  b.dmod = 0xf0;
  blit(m, 0x3c94);
  b.cmod = LINE_BYTES;
  b.dmod = LINE_BYTES;
  b.bdat = 0xffff;
  b.adat = 0x8000;
  for (let i = 0; i < 10; i++) {
    const from = STAR_POINTS + i * 4;
    const to = STAR_POINTS + ((i + 1) % 10) * 4;
    drawEdge(m, buffer, r16s(m, from), r16s(m, from + 2), r16s(m, to), r16s(m, to + 2), growth);
  }
  b.con0 = 0x09f0;
  b.con1 = 0x0012;
  b.afwm = 0xffff;
  b.alwm = 0xffff;
  b.apt = buffer + 0x107be;
  b.dpt = buffer + 0x107be;
  b.amod = 0xf0;
  b.dmod = 0xf0;
  blit(m, 0x3c94);
}

export function* Mushrooms(m) {
  for (let plane = 0; plane < 7; plane++) {
    pokeCopperPointer(m, COPPER_PLANES + plane * 8, PICTURE + plane * PLANE_BYTES);
  }
  m.cop1lc = COPPER;
  let starBuffer = STAR_BUFFER_A;
  copyColumn(m, true);

  for (let level = 4; level <= 0x100; level += 4) {
    yield* waitLine(m, 0xff);
    setPalette(m, level);
  }

  // Walk down: two pixels every fourth frame, alternating two frames of animation.
  for (let y = -38; ; y += 2) {
    yield* waitFrames(m, 0xff, 4);
    copyColumn(m, false);
    const frame = y & 4 ? WALK_FRAME_A : WALK_FRAME_B;
    const hidden = y < 0 ? -y : 0;
    const rows = SPRITE_ROWS - hidden;
    const top = y < 0 ? 0 : y;
    drawCharacter(m, frame + hidden * SPRITE_LINE_BYTES, COLUMN + top * LINE_BYTES, ((rows * 7) << 6) + 2);
    if (y >= 0x86) {
      break;
    }
  }

  for (let step = 0; ; step++) {
    yield* waitLine(m, 0x48);
    if (step < 0x8c) {
      if (step >= 0x64 && step < 0x6e) {
        drawStanding(m, DARK_FRAME, 0);
      } else {
        drawStanding(m, STAND_FRAME, 0x100);
      }
      continue;
    }
    drawStar(m, starBuffer, step - 0x8c);
    pokeCopperPointer(m, COPPER_STAR_PLANE, starBuffer);
    starBuffer = starBuffer === STAR_BUFFER_A ? STAR_BUFFER_B : STAR_BUFFER_A;
    yield* waitLine(m, 0xff);
    if (step < 0xa0) {
      drawStanding(m, DARK_FRAME, 0);
    } else if (step < 0xd4) {
      drawStanding(m, STAND_FRAME, 0x100);
    } else {
      return;
    }
  }
}
