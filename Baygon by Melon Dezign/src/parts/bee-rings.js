// Part 2 ($50b68): the black "Baygon" bee logo over pulsing grey concentric rings, overscanned to 384x280.
//
// Nothing moves on screen; it is all palette. Seven bitplanes hold a picture in which every pixel's colour
// number is its distance from the centre (plotted once on entry, one quadrant mirrored into the other three).
// Each frame the 128 colours of those planes are refilled from a long table of grey ramps, walking through the
// table with steps taken from two sine waves, so the rings swell and shrink. The logo is the eighth bitplane:
// colours 128..255 are all the same and only ever fade from white to black.
import { r8, r16, r16s, w8, w16, s16, waitLine, waitFrames, pokeCopperPointer } from '../machine.js';
import { custom } from '../display.js';

const A5 = 0x168000;
const COPPER = 0x51272;
const COPPER_PLANES = 0x512a8;
/** COLOR00 of the first of four banks of 32; each bank is preceded by a BPLCON3 move. */
const COPPER_RING_COLOURS = 0x512ec;
const COPPER_LOGO_COLOURS = 0x5170c;
/** The same colours again, $210 bytes on: the low-nibble (LOCT) copy. */
const LOW_NIBBLES = 0x210;
const BANKS = 4;
const COLOURS_PER_BANK = 32;
const BANK_SELECT_BYTES = 4;
const COPPER_MOVE_BYTES = 4;
const LOGO_PLANE = 0x51b40;

const SCROLL = 0x50e88;
const SINE = 0x50e8a;
const SINE_BYTES = 0x3e8;
const PHASE_A = 0x51b36;
const PHASE_B = 0x51b38;
const FRAME_COUNTER = 0x51b3a;
const PHASE_A_PER_FRAME = 2;
const PHASE_B_PER_FRAME = 8;
const PHASE_A_PER_COLOUR = 8;
const PHASE_B_PER_COLOUR = 6;

const SQUARE_ROOTS = A5 - 0x7ffc;
const LARGEST_ROOT = 0xe5;
const RINGS = A5 + 0x10ea8;
const RING_PLANES = 7;
const ROW_BYTES = 0x30;
const PLANE_BYTES = 0x3660;
const LAST_ROW = PLANE_BYTES - ROW_BYTES;
const CENTRE_X = 0xc0;
const CENTRE_Y = 0x91;
const FIRST_COLUMN = 0x10;
const LAST_PIXEL = 0x17f;
/** Distance to colour number: 0.556 colours per pixel, so the 128 colours repeat every 230 pixels. */
const RING_SCALE = 0x8e78;

const GREYS = A5 + 0x4ea8;
/** Where in the grey table colour 0 starts when SCROLL is 0. */
const GREYS_ORIGIN = A5 + 0xa6a8;
const GREY_REPEATS = 32;
const GREY_RAMPS = 12;
const SCROLL_WRAP = 0x3000;

const FADE_IN_FRAMES = 0x20;
const FADE_OUT_START = 0x1f4;
const LAST_FRAME = 0x214;
const WHITE = 0xff;

/**
 * The plot of 145x176 pixels into 7 planes, four times each, takes a stock A1200 well over a second, with the
 * loader's white screen showing. Measured from the capture: the border turns white at 17.00 s and the first
 * frame of the fade-in is at 18.32 s.
 */
const PRECALC_FRAMES = 65;

/** $50b6c: table[n] = floor(sqrt(n)), built by writing each root 2*root+1 times. */
function buildSquareRoots(m) {
  let at = SQUARE_ROOTS;
  for (let root = 0; root <= LARGEST_ROOT; root++) {
    for (let i = 0; i <= root * 2; i++) {
      w8(m, at++, root);
    }
  }
}

function setPixel(m, plane, offset, x) {
  m.mem[plane + offset] |= 0x80 >> (x & 7);
}

/** $50b84: the top-left quadrant of the rings, mirrored into the other three as it is plotted. */
function plotRings(m) {
  m.mem.fill(0, RINGS, RINGS + RING_PLANES * PLANE_BYTES);
  for (let y = 0; y < CENTRE_Y; y++) {
    for (let x = FIRST_COLUMN; x < CENTRE_X; x++) {
      const distance = r8(m, SQUARE_ROOTS + (y - CENTRE_Y) ** 2 + (x - CENTRE_X) ** 2);
      const colour = ~((distance * RING_SCALE) >> 16) & 0x7f;
      const mirrorX = LAST_PIXEL - x;
      const row = y * ROW_BYTES;
      for (let bit = 0; colour >> bit !== 0; bit++) {
        if ((colour >> bit) & 1) {
          const plane = RINGS + bit * PLANE_BYTES;
          setPixel(m, plane, row + (x >> 3), x);
          setPixel(m, plane, LAST_ROW - row + (x >> 3), x);
          setPixel(m, plane, row + (mirrorX >> 3), mirrorX);
          setPixel(m, plane, LAST_ROW - row + (mirrorX >> 3), mirrorX);
        }
      }
    }
  }
}

/**
 * $50c8a: grey ramps as (high nibbles, low nibbles) pairs: 192 steps down from $ff to $40, then 192 steps
 * back up, 32 times over.
 */
function buildGreys(m) {
  let at = GREYS;
  const ramp = (high, low, step) => {
    for (let i = 0; i < GREY_RAMPS; i++) {
      for (let j = 0; j < 16; j++) {
        w16(m, at, (high + i * step) & 0xffff);
        w16(m, at + 2, (low + j * step) & 0xffff);
        at += 4;
      }
    }
  };
  for (let repeat = 0; repeat < GREY_REPEATS; repeat++) {
    ramp(0xfff, 0xfff, -0x111);
    ramp(0x444, 0x000, 0x111);
  }
}

const wrapPhase = (phase) => (phase >= SINE_BYTES ? phase - SINE_BYTES : phase);

/** $50ce4: refill the 128 ring colours from the grey table. The phases live in memory. */
function setRingColours(m) {
  let phaseA = wrapPhase(r16(m, PHASE_A) + PHASE_A_PER_FRAME);
  let phaseB = wrapPhase(r16(m, PHASE_B) + PHASE_B_PER_FRAME);
  w16(m, PHASE_A, phaseA);
  w16(m, PHASE_B, phaseB);
  const start = GREYS_ORIGIN + r16s(m, SCROLL);
  let scroll = s16(r16s(m, SCROLL) + 4 * r16s(m, SINE + phaseA));
  if (scroll >= SCROLL_WRAP) {
    scroll -= SCROLL_WRAP;
  }
  w16(m, SCROLL, scroll & 0xffff);

  let offset = 0;
  let colourAt = COPPER_RING_COLOURS;
  for (let bank = 0; bank < BANKS; bank++) {
    for (let i = 0; i < COLOURS_PER_BANK; i++) {
      const grey = start + s16(offset & 0xfffc);
      w16(m, colourAt, r16(m, grey));
      w16(m, colourAt + LOW_NIBBLES, r16(m, grey + 2));
      offset = (offset + r16s(m, SINE + phaseA) + r16s(m, SINE + phaseB)) & 0xffff;
      colourAt += COPPER_MOVE_BYTES;
      phaseA = wrapPhase(phaseA + PHASE_A_PER_COLOUR);
      phaseB = wrapPhase(phaseB + PHASE_B_PER_COLOUR);
    }
    colourAt += BANK_SELECT_BYTES;
  }
}

/** Run `shade` (8-bit grey in, 8-bit grey out) over four banks of colours in the copper list. */
function shadeColours(m, firstColour, shade) {
  let colourAt = firstColour;
  for (let bank = 0; bank < BANKS; bank++) {
    for (let i = 0; i < COLOURS_PER_BANK; i++) {
      const grey = shade((r16(m, colourAt) & 0xf0) | (r16(m, colourAt + LOW_NIBBLES) & 0x0f));
      w16(m, colourAt, ((grey >> 4) & 0xf) * 0x111);
      w16(m, colourAt + LOW_NIBBLES, (grey & 0xf) * 0x111);
      colourAt += COPPER_MOVE_BYTES;
    }
    colourAt += BANK_SELECT_BYTES;
  }
}

export function* BeeRings(m) {
  buildSquareRoots(m);
  plotRings(m);
  yield* waitFrames(m, 0xff, PRECALC_FRAMES);
  for (let plane = 0; plane < RING_PLANES; plane++) {
    pokeCopperPointer(m, COPPER_PLANES + plane * 8, RINGS + plane * PLANE_BYTES);
  }
  pokeCopperPointer(m, COPPER_PLANES + RING_PLANES * 8, LOGO_PLANE);
  custom(m, 0x80, COPPER >>> 16);
  custom(m, 0x82, COPPER & 0xffff);
  buildGreys(m);

  for (;;) {
    yield* waitLine(m, 0xff);
    setRingColours(m);
    const frame = r16(m, FRAME_COUNTER) + 1;
    w16(m, FRAME_COUNTER, frame);
    if (frame > LAST_FRAME) {
      return;
    }
    if (frame <= FADE_IN_FRAMES) {
      // The rings come out of white while the logo goes from white to black.
      shadeColours(m, COPPER_RING_COLOURS, (grey) => WHITE - (((WHITE - grey) * frame) >> 5));
      const logo = ((FADE_IN_FRAMES - frame) * WHITE) >> 5;
      shadeColours(m, COPPER_LOGO_COLOURS, () => logo);
    } else if (frame >= FADE_OUT_START) {
      const level = FADE_IN_FRAMES - (frame - FADE_OUT_START);
      shadeColours(m, COPPER_RING_COLOURS, (grey) => (grey * level) >> 5);
    }
  }
}
