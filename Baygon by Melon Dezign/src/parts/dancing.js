// Part 6 ($58038): "Improve your dancing with Melon". An overscan (352x286) 16-colour picture of dance steps,
// laid over a two-colour pattern of which one bitplane scrolls upwards a line per frame.
//
// No blitter and no drawing at all: six bitplanes (plain 64 colours, EHB killed in BPLCON2) of which planes
// 3-6 are the picture and planes 1-2 are the pattern, a 26-line tile repeated down the screen. Plane 2 scrolls
// by moving its copper pointer one line further into the tile each frame. All the rest is palette: colours
// come in groups of four (one per picture colour), within a group colour 0 is the pattern's green and colours
// 1-3 its orange. First only the pattern fades in, then the picture's greys fade in out of the pattern's
// colours, and at the end everything fades to black.
import { r16, w16, waitLine, pokeCopperPointer } from '../machine.js';
import { fadeColour } from '../colour.js';

const A5 = 0x168000;
const COPPER = 0x5832a;
const COPPER_PICTURE_PLANES = 0x58344;
const COPPER_PATTERN_PLANES = 0x58364;
const COPPER_SCROLLING_PLANE = 0x5836c;
const COPPER_COLOURS = 0x58394;
/** The same 64 colours again, $108 bytes on: the low-nibble (LOCT) copy. */
const LOW_NIBBLES = 0x108;
const COLOUR_GROUPS = 16;
const GROUP_COLOURS = 4;
const GROUP_BYTES = 0x10;
/** A BPLCON3 move sits between the two banks of 32 colours. */
const GROUPS_PER_BANK = 8;
const BANK_SWITCH_BYTES = 4;
const PICTURE = 0x58e98;
const PICTURE_PLANES = 4;
/** 286 lines of 44 bytes. */
const PLANE_BYTES = 0x3128;
const LINE_BYTES = 0x2c;
const STILL_TILE = 0x585a8;
const SCROLLING_TILE = 0x58a20;
/** 26 lines. */
const TILE_BYTES = 0x478;
const TILE_LINES = 0x1a;
const TILES_PER_PLANE = 11;
const STILL_PLANE = A5 - 0x7ff8;
const SCROLLING_PLANE = A5 - 0x4ed0;
const SCROLL_LINE = 0x585a6;
/** The picture's colours 1-15; colour 0 is the pattern showing through. */
const PICTURE_PALETTE = 0x5826c;
const GREEN = 0x080;
const ORANGE = 0xf80;
const BLACK = 0x000;
const FULL_LEVEL = 0x100;
const PATTERN_IN_END = 0x20;
const PICTURE_IN_START = 0x84;
const PICTURE_IN_END = 0xa4;
const FADE_OUT_START = 0x1b0;
const LAST_FRAME = 0x1d0;
const WAIT_LINE = 0xff;

/** $58038: the pattern tile repeated down both pattern planes (one tile more for the one that scrolls). */
function buildPatternPlanes(m) {
  for (let tile = 0; tile < TILES_PER_PLANE; tile++) {
    m.mem.copyWithin(STILL_PLANE + tile * TILE_BYTES, STILL_TILE, STILL_TILE + TILE_BYTES);
  }
  for (let tile = 0; tile <= TILES_PER_PLANE; tile++) {
    m.mem.copyWithin(SCROLLING_PLANE + tile * TILE_BYTES, SCROLLING_TILE, SCROLLING_TILE + TILE_BYTES);
  }
}

/** One group of four copper colours: its colour 0, and its colours 1-3 which are always alike. */
function setGroup(m, group, first, rest) {
  const base = COPPER_COLOURS + group * GROUP_BYTES + (group >= GROUPS_PER_BANK ? BANK_SWITCH_BYTES : 0);
  for (let i = 0; i < GROUP_COLOURS; i++) {
    const colour = i === 0 ? first : rest;
    w16(m, base + i * 4, colour.high);
    w16(m, base + i * 4 + LOW_NIBBLES, colour.low);
  }
}

const pictureColour = (m, group) => r16(m, PICTURE_PALETTE + (group - 1) * 2);

/** $5811c: every group gets the pattern's green and orange, so the picture stays invisible. */
function fadePatternIn(m, level) {
  const green = fadeColour(BLACK, GREEN, level);
  const orange = fadeColour(BLACK, ORANGE, level);
  for (let group = 0; group < COLOUR_GROUPS; group++) {
    setGroup(m, group, green, orange);
  }
}

/** $5817a: groups 1-15 go from the pattern's colours to their picture colour. */
function fadePictureIn(m, level) {
  for (let group = 1; group < COLOUR_GROUPS; group++) {
    const target = pictureColour(m, group);
    setGroup(m, group, fadeColour(GREEN, target, level), fadeColour(ORANGE, target, level));
  }
}

/** $581d2 */
function fadeOut(m, level) {
  setGroup(m, 0, fadeColour(GREEN, BLACK, level), fadeColour(ORANGE, BLACK, level));
  for (let group = 1; group < COLOUR_GROUPS; group++) {
    const colour = fadeColour(pictureColour(m, group), BLACK, level);
    setGroup(m, group, colour, colour);
  }
}

export function* Dancing(m) {
  for (let plane = 0; plane < PICTURE_PLANES; plane++) {
    pokeCopperPointer(m, COPPER_PICTURE_PLANES + plane * 8, PICTURE + plane * PLANE_BYTES);
  }
  buildPatternPlanes(m);
  pokeCopperPointer(m, COPPER_PATTERN_PLANES, STILL_PLANE);
  pokeCopperPointer(m, COPPER_PATTERN_PLANES + 8, SCROLLING_PLANE);
  m.cop1lc = COPPER;

  for (let frame = 0; frame <= LAST_FRAME; frame++) {
    yield* waitLine(m, WAIT_LINE);
    const scrollLine = (r16(m, SCROLL_LINE) + 1) % TILE_LINES;
    w16(m, SCROLL_LINE, scrollLine);
    pokeCopperPointer(m, COPPER_SCROLLING_PLANE, SCROLLING_PLANE + scrollLine * LINE_BYTES);
    if (frame <= PATTERN_IN_END) {
      fadePatternIn(m, frame << 3);
      continue;
    }
    if (frame >= PICTURE_IN_START && frame <= PICTURE_IN_END) {
      fadePictureIn(m, (frame - PICTURE_IN_START) << 3);
    }
    if (frame >= FADE_OUT_START) {
      fadeOut(m, (frame - FADE_OUT_START) << 3);
    }
  }
  // The original restores DMACON and INTENA here; the port never changed them.
}
