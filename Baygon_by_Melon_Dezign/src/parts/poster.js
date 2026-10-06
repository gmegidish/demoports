// Part 8 ($65338): the "Melon versus Godzilla" poster. A 16-colour picture (a woman's face and Japanese
// lettering, greys) fades in over a red background on which jagged pink rays turn around the centre of the screen.
//
// Eight bitplanes. The top four are the picture. The bottom four are a ring of five one-bit buffers: every
// frame the buffer that is not on screen is cleared, gets two or four wedges drawn into it (blitter lines from
// the centre to the screen edge, each with a kink, then one blitter fill) and becomes plane 1, pushing the
// older ones up a plane. So the low four colour bits are the last four frames of rays, and the 16 background
// colours $f00..$f0f turn that history into pink trails. The picture's 15 colours are each 16 copper colours
// (one per ray history), faded from the background colours to grey and at the end, with the background, to black.
//
// The original takes its random numbers (wedge widths, kinks) from the beam position at the moment it asks.
// That depends on how long the CPU and blitter took, so this port keeps an estimate of the beam: the rays have
// the same statistics as the original but not the same shapes on the same frame.
import { r16, w16, s16, waitLine, pokeCopperPointer } from '../machine.js';
import { blit } from '../blitter.js';
import { custom } from '../display.js';
import { fadeColour } from '../colour.js';

const A5 = 0x168000;
const COPPER = 0x6570a;
const COPPER_RAY_PLANES = 0x65724;
const COPPER_PICTURE_PLANES = 0x65744;
const COPPER_POINTER_BYTES = 8;
/** Value word of COLOR00 in the first of the eight 32-colour banks. */
const COPPER_COLOURS = 0x65784;
/** The same eight banks again, $420 bytes on: the low-nibble (LOCT) copies. */
const LOW_NIBBLES = 0x420;
const COPPER_COLOUR_BYTES = 4;
/** 16 colours of one picture colour or of the background, one per ray history. */
const SHADES = 16;
const PICTURE_COLOURS = 15;
const PICTURE_PALETTE = 0x656cc;
const BACKGROUND_PALETTE = 0x656ea;
const PICTURE = 0x66110;
const RING = A5 - 0x7fa0;
const PLANE_BYTES = 0x2800;
const RING_BYTES = 0xc800;
const PLANES_SHOWN = 4;
const ROW_BYTES = 0x28;
/** 256 rows of 20 words. */
const WHOLE_PLANE = 0x4014;
const PLANE_WORDS = 0x1400;
const LAST_WORD = 0x27fe;
const CENTRE_X = 0xa0;
const CENTRE_Y = 0x80;
const RIGHT_EDGE = 0x13f;
const BOTTOM_EDGE = 0xff;
/** The way round the screen edge, clockwise from the top left corner: an angle word is scaled to 0..$47b. */
const PERIMETER = 0x47c;
const TOP_RIGHT = 0x13f;
const BOTTOM_RIGHT = 0x23e;
const BOTTOM_LEFT = 0x37d;
const KINK_BIT = 0x20;
const TWO_WEDGES_BIT = 0x100;
const HALF_TURN = 0x8000;
const FIRST_ANGLE = 0x3502;
const ANGLE_STEP = 0x601;
const FADE_IN_START = 0x64;
const FADE_OUT_START = 0x2bc;
const FADE_FRAMES = 0x20;
const WAIT_LINE = 0xff;
const BPLCON3 = 0x106;

// The beam estimate, in colour clocks (227 to a line). Rough figures for a stock A1200.
const CLOCKS_PER_LINE = 227;
const LINES_PER_FRAME = 312;
const CLOCKS_PER_BLIT_WORD = 2;
const CLOCKS_PER_LINE_DOT = 4;
const CLOCKS_LINE_SETUP = 60;
const CLOCKS_EDGE_MATH = 25;

/** `move.w $dff006,d5; ror.w #8,d5`: horizontal position in the high byte, line in the low byte, signed. */
function beamNoise(beam) {
  beam.clocks = Math.max(beam.clocks, beam.blitStart) + CLOCKS_EDGE_MATH;
  const line = (WAIT_LINE + Math.floor(beam.clocks / CLOCKS_PER_LINE)) % LINES_PER_FRAME;
  return s16(((beam.clocks % CLOCKS_PER_LINE) << 8) | (line & 0xff));
}

/** The CPU waits for the blitter, sets it up, and starts it. */
function startBlit(beam, blitClocks) {
  beam.clocks = Math.max(beam.clocks, beam.blitEnd) + CLOCKS_LINE_SETUP;
  beam.blitStart = beam.clocks;
  beam.blitEnd = beam.clocks + blitClocks;
}

/** $65fc6: a one-dot-per-row blitter line, top to bottom, xor-ed into the plane ready for filling. */
function drawLine(m, beam, plane, x1, y1, x2, y2) {
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
  b.cpt = plane + y1 * ROW_BYTES + (x1 >> 4) * 2;
  b.dpt = b.cpt;
  startBlit(beam, (major + 1) * CLOCKS_PER_LINE_DOT);
  blit(m, ((major << 6) + 0x42) & 0xffff);
}

/** Where a ray at `angle` leaves the screen: the angle walks the edge clockwise from the top left corner. */
function edgePoint(angle) {
  const along = (angle * PERIMETER) >>> 16;
  if (along <= TOP_RIGHT) {
    return { x: along, y: 0 };
  }
  if (along <= BOTTOM_RIGHT) {
    return { x: RIGHT_EDGE, y: along - TOP_RIGHT };
  }
  if (along <= BOTTOM_LEFT) {
    return { x: RIGHT_EDGE + 1 - (along - BOTTOM_RIGHT), y: BOTTOM_EDGE };
  }
  return { x: 0, y: BOTTOM_EDGE + 1 - (along - BOTTOM_LEFT) };
}

/**
 * $65652: one side of a wedge, from the centre to the edge. If the angle has the kink bit set the line only
 * goes half way, the angle is nudged at random and the rest is aimed at the new edge point.
 * Leaves the nudged angle in `ray.angle` and returns the edge point reached.
 */
function drawSide(m, beam, plane, ray) {
  let x = CENTRE_X;
  let y = CENTRE_Y;
  for (;;) {
    const edge = edgePoint(ray.angle);
    if (!(ray.angle & KINK_BIT)) {
      drawLine(m, beam, plane, edge.x, edge.y, x, y);
      return edge;
    }
    const middleX = (edge.x + x) >> 1;
    const middleY = (edge.y + y) >> 1;
    drawLine(m, beam, plane, middleX, middleY, x, y);
    ray.angle = (ray.angle + (beamNoise(beam) >> 2)) & 0xffff & ~KINK_BIT;
    x = middleX;
    y = middleY;
  }
}

/**
 * $655e0: one or two wedges starting at `angle`, each up to a quarter turn wide either way. A wedge that ends
 * on the right edge needs that edge closed for the fill, which works right to left: note it in `closures`.
 */
function drawWedges(m, beam, plane, angle, closures) {
  const ray = { angle };
  const wedges = ray.angle & TWO_WEDGES_BIT ? 2 : 1;
  for (let i = 0; i < wedges; i++) {
    const first = drawSide(m, beam, plane, ray);
    ray.angle = (ray.angle + Math.floor((beamNoise(beam) * 0x7fff) / 0x10000)) & 0xffff;
    const second = drawSide(m, beam, plane, ray);
    if (first.x === RIGHT_EDGE || second.x === RIGHT_EDGE) {
      closures.push(first.y, second.y);
    }
    ray.angle = (ray.angle + (beamNoise(beam) >> 2)) & 0xffff;
  }
}

/**
 * Clear the plane, draw this frame's wedges as outlines and fill them.
 * The right edge is closed by xor-ing a vertical line from each end point down to row 319: the two lines
 * cancel below the lower point, including the 63 rows by which they overrun into the next plane of the ring.
 */
function drawRays(m, beam, plane, angle) {
  const b = m.blt;
  b.con0 = 0x0100;
  b.con1 = 0;
  b.dpt = plane;
  b.dmod = 0;
  startBlit(beam, PLANE_WORDS * CLOCKS_PER_BLIT_WORD);
  blit(m, WHOLE_PLANE);
  b.cmod = ROW_BYTES;
  b.dmod = ROW_BYTES;
  b.afwm = 0xffff;
  b.alwm = 0xffff;
  b.bdat = 0xffff;
  b.adat = 0x8000;
  const closures = [];
  drawWedges(m, beam, plane, angle, closures);
  drawWedges(m, beam, plane, (angle + HALF_TURN) & 0xffff, closures);
  for (const y of closures) {
    drawLine(m, beam, plane, RIGHT_EDGE, RIGHT_EDGE, RIGHT_EDGE, y);
  }
  b.con0 = 0x09f0;
  b.con1 = 0x0012;
  b.afwm = 0xffff;
  b.alwm = 0xffff;
  b.apt = plane + LAST_WORD;
  b.dpt = plane + LAST_WORD;
  b.amod = 0;
  b.dmod = 0;
  blit(m, WHOLE_PLANE);
}

/** Where the copper sets shade `shade` of picture colour `colour` (0 is the background). */
function copperColour(colour, shade) {
  const bank = colour >> 1;
  const moves = bank * (2 * SHADES + 1) + (colour & 1) * SHADES + shade;
  return COPPER_COLOURS + moves * COPPER_COLOUR_BYTES;
}

function pokeColour(m, at, colour) {
  w16(m, at, colour.high);
  w16(m, at + LOW_NIBBLES, colour.low);
}

/** $65518: the picture's colours appear out of the background shades. `level` runs 0..$20. */
function fadePictureIn(m, level) {
  for (let colour = 1; colour <= PICTURE_COLOURS; colour++) {
    const target = r16(m, PICTURE_PALETTE + (colour - 1) * 2);
    for (let shade = 0; shade < SHADES; shade++) {
      const background = r16(m, BACKGROUND_PALETTE + shade * 2);
      pokeColour(m, copperColour(colour, shade), fadeColour(background, target, level * 8));
    }
  }
}

/** $65578: background and picture to black. */
function fadeAllOut(m, level) {
  for (let shade = 0; shade < SHADES; shade++) {
    const background = r16(m, BACKGROUND_PALETTE + shade * 2);
    pokeColour(m, copperColour(0, shade), fadeColour(background, 0, level * 8));
  }
  for (let colour = 1; colour <= PICTURE_COLOURS; colour++) {
    const faded = fadeColour(r16(m, PICTURE_PALETTE + (colour - 1) * 2), 0, level * 8);
    for (let shade = 0; shade < SHADES; shade++) {
      pokeColour(m, copperColour(colour, shade), faded);
    }
  }
}

function nextInRing(plane) {
  return plane + PLANE_BYTES >= RING + RING_BYTES ? plane + PLANE_BYTES - RING_BYTES : plane + PLANE_BYTES;
}

function previousInRing(plane) {
  return plane - PLANE_BYTES < RING ? plane - PLANE_BYTES + RING_BYTES : plane - PLANE_BYTES;
}

export function* Poster(m) {
  for (let plane = 0; plane < PLANES_SHOWN; plane++) {
    pokeCopperPointer(m, COPPER_RAY_PLANES + plane * COPPER_POINTER_BYTES, RING + plane * PLANE_BYTES);
    pokeCopperPointer(m, COPPER_PICTURE_PLANES + plane * COPPER_POINTER_BYTES, PICTURE + plane * PLANE_BYTES);
  }
  let newest = RING;
  let angle = FIRST_ANGLE;
  const beam = { clocks: 0, blitStart: 0, blitEnd: 0 };

  for (let frame = 1; ; frame++) {
    yield* waitLine(m, WAIT_LINE);
    beam.clocks = 0;
    beam.blitStart = 0;
    beam.blitEnd = 0;
    let shown = newest;
    for (let plane = 0; plane < PLANES_SHOWN; plane++) {
      pokeCopperPointer(m, COPPER_RAY_PLANES + plane * COPPER_POINTER_BYTES, shown);
      shown = nextInRing(shown);
    }
    newest = previousInRing(newest);
    drawRays(m, beam, newest, angle);

    if (frame >= FADE_IN_START && frame <= FADE_IN_START + FADE_FRAMES) {
      fadePictureIn(m, frame - FADE_IN_START);
    } else if (frame > FADE_OUT_START + FADE_FRAMES) {
      return;
    } else if (frame >= FADE_OUT_START) {
      fadeAllOut(m, frame - FADE_OUT_START);
    }
    angle = (angle + ANGLE_STEP) & 0xffff;
    custom(m, BPLCON3, 0);
    m.cop1lc = COPPER;
  }
}
