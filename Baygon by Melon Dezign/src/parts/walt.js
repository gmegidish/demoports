// Part 4 ($c96e8, crunched on disk): a still picture in 15 shades, 352x290 overscan, on a two-tone orange
// background, with a one-bitplane animation of 51 frames playing forwards and backwards behind it.
//
// Five bitplanes. Plane 0 is the animation: every frame the CPU copies 30x192 bytes of the next animation frame
// into the middle of it. Planes 1-4 are the picture. The palette is laid out in pairs so that plane 0 only shows
// where the picture is empty: colours 0/1 are the two oranges, and colours 2n/2n+1 both hold picture shade n.
// The part fades the oranges up from black, then fades the picture in out of them, holds, and fades all to black.
import { r16, w8, w16, waitLine, pokeCopperPointer } from '../machine.js';
import { fadeColour } from '../colour.js';

const A5 = 0x168000;
const COPPER = 0xc99ce;
const COPPER_PLANES = 0xc99e8;
/** Value word of COLOR00 in the high-nibble block; a colour is 4 bytes on. */
const COPPER_COLOURS = 0xc9a30;
/** The same 32 colours again, 0x84 bytes on: the low-nibble (LOCT) copy. */
const LOW_NIBBLES = 0x84;
const COPPER_COLOUR_BYTES = 4;
const PICTURE = 0xc9b40;
const PLANES = 5;
/** 290 lines of 44 bytes. */
const PLANE_BYTES = 0x31d8;
const LINE_BYTES = 0x2c;
/** The animation window in plane 0: 240x192 pixels at (48, 56). */
const ANIMATION_WINDOW = PICTURE + 0x9a6;
const ANIMATION_FRAMES = PICTURE + 0xf938;
const ANIMATION_FRAME_BYTES = 0x1680;
const ANIMATION_ROW_BYTES = 0x1e;
const ANIMATION_ROWS = 0xc0;
const FIRST_FRAME = 0x19;
const LAST_FRAME = 0x32;
/** The 15 shades of the picture, for colour pairs 2/3 .. 30/31. */
const PICTURE_PALETTE = 0xc99b0;
const PICTURE_SHADES = 15;
const BACKGROUND_PAIRS = 16;
const LIGHT_ORANGE = 0xfa7;
const DARK_ORANGE = 0xf76;
const BLACK = 0;
/** Fades run over 33 frames, level 0 to $100 in steps of 8. */
const FADE_STEPS = 0x20;
const FADE_LEVEL_SHIFT = 3;
/** The frame counter starts here, so the oranges are held 100 frames before the picture fades in... */
const HOLD_BEFORE_PICTURE = -100;
/** ...and the fade to black starts when it gets here, 600 frames later. */
const FADE_OUT_AT = 0x1f4;
const FRAME_NUMBER = A5 - 0x8000;
const FRAME_DIRECTION = A5 - 0x7ffe;

function setColourHigh(m, index, colour) {
  w16(m, COPPER_COLOURS + index * COPPER_COLOUR_BYTES, colour.high);
}

function setColour(m, index, colour) {
  setColourHigh(m, index, colour);
  w16(m, COPPER_COLOURS + index * COPPER_COLOUR_BYTES + LOW_NIBBLES, colour.low);
}

/** $c9742: with the picture colours still unset, every even colour is the light orange and every odd one the dark. */
function fadeBackgroundIn(m, level) {
  const dark = fadeColour(BLACK, DARK_ORANGE, level);
  const light = fadeColour(BLACK, LIGHT_ORANGE, level);
  for (let pair = 0; pair < BACKGROUND_PAIRS; pair++) {
    setColour(m, pair * 2, light);
    setColour(m, pair * 2 + 1, dark);
  }
}

/** $c980a: each pair of picture colours leaves its orange for its shade, so the picture grows out of the background. */
function fadePictureIn(m, level) {
  for (let shade = 0; shade < PICTURE_SHADES; shade++) {
    const target = r16(m, PICTURE_PALETTE + shade * 2);
    setColour(m, 2 + shade * 2, fadeColour(LIGHT_ORANGE, target, level));
    setColour(m, 3 + shade * 2, fadeColour(DARK_ORANGE, target, level));
  }
}

/** $c9856: everything to black. */
function fadeOut(m, level) {
  setColour(m, 0, fadeColour(LIGHT_ORANGE, BLACK, level));
  // The original stores this low-nibble word one colour too far ($88 instead of $84), where the loop below
  // overwrites it: the dark orange keeps its low nibbles ($f76) all the way down, and ends on $0f0706, not black.
  setColourHigh(m, 1, fadeColour(DARK_ORANGE, BLACK, level));
  for (let shade = 0; shade < PICTURE_SHADES; shade++) {
    const colour = fadeColour(r16(m, PICTURE_PALETTE + shade * 2), BLACK, level);
    setColour(m, 2 + shade * 2, colour);
    setColour(m, 3 + shade * 2, colour);
  }
}

/** $c979a: copy the current animation frame into plane 0, then step to the next one, turning round at both ends. */
function showNextAnimationFrame(m, animation) {
  const source = ANIMATION_FRAMES + animation.frame * ANIMATION_FRAME_BYTES;
  for (let row = 0; row < ANIMATION_ROWS; row++) {
    for (let column = 0; column < ANIMATION_ROW_BYTES; column++) {
      w8(m, ANIMATION_WINDOW + row * LINE_BYTES + column, m.mem[source + row * ANIMATION_ROW_BYTES + column]);
    }
  }
  animation.frame += animation.direction;
  if (animation.frame < 0) {
    animation.direction = 1;
    animation.frame = 1;
  }
  if (animation.frame > LAST_FRAME) {
    animation.frame = LAST_FRAME;
    animation.direction = -1;
  }
  w16(m, FRAME_NUMBER, animation.frame);
  w16(m, FRAME_DIRECTION, animation.direction & 0xffff);
}

export function* Walt(m) {
  for (let plane = 0; plane < PLANES; plane++) {
    pokeCopperPointer(m, COPPER_PLANES + plane * 8, PICTURE + plane * PLANE_BYTES);
  }
  const animation = { frame: FIRST_FRAME, direction: 1 };
  m.cop1lc = COPPER;

  for (let step = 0; step <= FADE_STEPS; step++) {
    yield* waitLine(m, 0xff);
    fadeBackgroundIn(m, step << FADE_LEVEL_SHIFT);
  }

  for (let counter = HOLD_BEFORE_PICTURE + 1; counter <= FADE_OUT_AT; counter++) {
    yield* waitLine(m, 0xff);
    showNextAnimationFrame(m, animation);
    if (counter >= 0 && counter <= FADE_STEPS) {
      fadePictureIn(m, counter << FADE_LEVEL_SHIFT);
    }
  }

  for (let step = 0; step <= FADE_STEPS; step++) {
    yield* waitLine(m, 0xe0);
    fadeOut(m, step << FADE_LEVEL_SHIFT);
    showNextAnimationFrame(m, animation);
  }
}
