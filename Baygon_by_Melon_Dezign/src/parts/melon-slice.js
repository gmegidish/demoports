// Part 5 ($b9ea8): a white picture of three black silhouettes with "melon" lettering, and a slice of melon
// tumbling in front of it for ten seconds.
//
// The picture is a single bitplane (plane 4) that never changes. The slice is a 28-point solid drawn into
// planes 1-3: its faces come in three groups, one per plane (rind, pale flesh, pink flesh), so a face needs no
// colour, only a plane. Faces are convex polygons filled by the CPU, one longword span per row, with the edge
// slopes looked up in a 256x256 table of dx/dy that is built on entry. No hidden-surface sorting: back faces
// are dropped and the planes simply overlap. Three screens are cycled: one shown, one drawn, one being cleared
// by the blitter.
import { r16, r16s, r32, w16, w32, s8, s16, waitLine, pokeCopperPointer } from '../machine.js';
import { blit } from '../blitter.js';
import { fadeColour } from '../colour.js';

const A5 = 0x168000;
const COPPER = 0xba5de;
const COPPER_PLANES = 0xba618;
const COPPER_COLOURS = 0xba63c;
/** The same 16 colours again, 0x44 bytes on: the low-nibble (LOCT) copy. */
const LOW_NIBBLES = 0x44;
const PICTURE = 0xbbd18;
const PICTURE_PLANE = 3;
const PICTURE_COLOUR = 8;
const LAST_COLOUR = 15;
/** Colours 0-7 are the slice over white paper, 8-15 the slice over a silhouette. */
const PALETTE = [0xfff, 0x0a9, 0x0cb, 0x0a9, 0xf08, 0x967, 0x967, 0x967, 0x100, 0x0a9, 0x0cb, 0x0a9, 0x806, 0x967, 0x967, 0x967];
const BLACK = 0x000;
const FADE_STEPS = 0x20;
const FADE_LEVELS_PER_STEP = 8;
const LAST_FRAME = 0x1f4;
const FADE_OUT_FRAME = 0x1d4;

const SINE = 0xba6c6;
const COSINE = 0xbaac6;
const ANGLE_MASK = 0xffe;
const ANGLE_SPEEDS = [0x1e, 0x10, 0x18];
const VERTICES = 0xbbad6;
const FACES = 0xbbb80;
/** The solid is modelled around z = -200; this puts its middle on the axes it turns about. */
const DEPTH_OFFSET = 0xc8;
const EYE_DISTANCE = 0x3e80000;
const ZOOM = 0x4b00000;
const CENTRE_X = 0xa00000;
const CENTRE_Y = 0x800000;
const HALF = 0x8000;

const FRAME_COUNTER = A5 - 0x8000;
const ANGLES = A5 - 0x7ff4;
const MATRIX = A5 - 0x7fea;
const ROTATED = A5 - 0x7fd8;
const PROJECTED = A5 - 0x7e84;
const POLYGON = A5 - 0x7d30;
const EDGE_LIST = A5 - 0x7c90;
const SCREENS = A5 - 0x7c38;
const LAST_SCREEN = A5 + 0x73c8;
const SCREEN_BYTES = 0x7800;
const PLANE_BYTES = 0x2800;
const ROW_BYTES = 0x28;
const CLEAR_SCREEN_BLTSIZE = 0xc014;
const WORKSPACE_LONGS = (0xad78 + 1) * 2;
/** dx/dy as 16.16 for dx and dy in -128..127, one longword each; SLOPES_CENTRE is the entry for 0/0. */
const SLOPES = A5 + 0xebc8;
const SLOPES_CENTRE = A5 + 0x2edc8;
const SLOPE_RANGE = 0x80;

/**
 * The real machine needs this long to build the slope table (65536 software divisions), with the faded-in
 * picture standing still. Measured from the capture: frames between the end of the fade to white and the
 * slice's first appearance.
 */
const SLOPE_TABLE_FRAMES = 37;

const r32s = (m, a) => m.view.getInt32(a);
const colourAddress = (index) => COPPER_COLOURS + index * 4;

/** $ba31a and the two stores that follow each call: one colour, faded, into both halves of the copper list. */
function setColour(m, index, from, to, step) {
  const colour = fadeColour(from, to, step * FADE_LEVELS_PER_STEP);
  w16(m, colourAddress(index), colour.high);
  w16(m, colourAddress(index) + LOW_NIBBLES, colour.low);
}

/** $b9f8a: the slice appears out of the paper (and out of the silhouettes, where it is in front of one). */
function fadeSliceIn(m, step) {
  for (let index = 1; index < PICTURE_COLOUR; index++) {
    setColour(m, index, PALETTE[0], PALETTE[index], step);
    setColour(m, index + PICTURE_COLOUR, PALETTE[PICTURE_COLOUR], PALETTE[index + PICTURE_COLOUR], step);
  }
}

/** $ba054: everything to black. */
function fadeAllOut(m, step) {
  for (let index = 0; index < PALETTE.length; index++) {
    setColour(m, index, BLACK, PALETTE[index], step);
  }
}

/** $bbcbc: sign-and-magnitude division, so slopes round towards zero. */
function buildSlopeTable(m) {
  let entry = SLOPES;
  for (let dx = -SLOPE_RANGE; dx < SLOPE_RANGE; dx++) {
    for (let dy = -SLOPE_RANGE; dy < SLOPE_RANGE; dy++) {
      const slope = dy === 0 ? dx * 0x10000 : Math.trunc((dx * 0x10000) / dy);
      w32(m, entry, slope >>> 0);
      entry += 4;
    }
  }
}

/** Product of two 2.14 numbers, rounded, as the word the original keeps. */
const round14 = (product) => s16(((product << 2) + HALF) >> 16);

/** $ba3c8: the rotation matrix for the three angles, nine 2.14 words. */
function buildMatrix(m) {
  const [cosA, cosB, cosC] = [0, 2, 4].map((offset) => r16s(m, COSINE + r16(m, ANGLES + offset)));
  const [sinA, sinB, sinC] = [0, 2, 4].map((offset) => r16s(m, SINE + r16(m, ANGLES + offset)));
  const sinAsinB = round14(sinA * sinB);
  const cosAsinB = round14(cosA * sinB);
  const matrix = [
    round14(cosB * cosC),
    -round14(cosB * sinC),
    sinB,
    round14(cosA * sinC + sinAsinB * cosC),
    round14(cosA * cosC - sinAsinB * sinC),
    -round14(sinA * cosB),
    round14(sinA * sinC - cosAsinB * cosC),
    round14(sinA * cosC + cosAsinB * sinC),
    round14(cosA * cosB),
  ];
  matrix.forEach((value, i) => w16(m, MATRIX + i * 2, value));
}

/** $ba1fe: rotate every vertex. */
function rotateVertices(m) {
  const count = r16(m, VERTICES) + 1;
  for (let vertex = 0; vertex < count; vertex++) {
    const from = VERTICES + 2 + vertex * 6;
    const x = r16s(m, from);
    const y = r16s(m, from + 2);
    const z = s16(r16s(m, from + 4) + DEPTH_OFFSET);
    for (let row = 0; row < 3; row++) {
      const at = MATRIX + row * 6;
      w32(m, ROTATED + vertex * 12 + row * 4, (r16s(m, at) * x + r16s(m, at + 2) * y + r16s(m, at + 4) * z) >>> 0);
    }
  }
}

/** $ba232: perspective, a 64-bit multiply and divide per coordinate. Leaves (y, x) as 16.16 screen positions. */
function projectVertices(m) {
  const count = r16(m, VERTICES) + 1;
  for (let vertex = 0; vertex < count; vertex++) {
    const from = ROTATED + vertex * 12;
    const depth = (EYE_DISTANCE - r32s(m, from + 8)) | 0;
    const x = Math.trunc((r32s(m, from) * ZOOM) / depth);
    const y = Math.trunc((r32s(m, from + 4) * ZOOM) / depth);
    w32(m, PROJECTED + vertex * 8, (y + CENTRE_Y) >>> 0);
    w32(m, PROJECTED + vertex * 8 + 4, (x + CENTRE_X) >>> 0);
  }
}

/** $ba588: one row of a polygon, from leftX to rightX inclusive (16.16), a longword at a time. */
function drawSpan(m, row, leftX, rightX) {
  const left = leftX >>> 16;
  const right = rightX >>> 16;
  const leftMask = 0xffffffff >>> (left & 31);
  const rightMask = ~(0x7fffffff >>> (right & 31)) >>> 0;
  let at = row + (left >> 5) * 4;
  const longsApart = s8(((left >> 5) - (right >> 5)) & 0xff);
  if (longsApart > 0) {
    return;
  }
  if (longsApart === 0) {
    w32(m, at, (r32(m, at) | (leftMask & rightMask)) >>> 0);
    return;
  }
  w32(m, at, (r32(m, at) | leftMask) >>> 0);
  at += 4;
  for (let i = longsApart + 1; i < 0; i++) {
    w32(m, at, 0xffffffff);
    at += 4;
  }
  w32(m, at, (r32(m, at) | rightMask) >>> 0);
}

/**
 * The start of an edge: x at the middle of its first row, and the slope from the table. The original builds x
 * by swapping the integer into the high word, which leaves whatever the register's high word held as fraction.
 */
function startEdge(m, staleX, from, to) {
  const x = r16(m, from + 2);
  const index = s16(((r16(m, to + 2) - x) << 8) + r16(m, to));
  const step = r32s(m, SLOPES_CENTRE + index * 4);
  const swapped = (x << 16) | (staleX >>> 16);
  return { x: (((swapped << 1) + step) >>> 0) >>> 1, step };
}

/**
 * $ba4c6: fill the convex polygon in POLYGON, a count and (y, x) words, into the plane at `plane`.
 * The points are copied to EDGE_LIST starting from the topmost, with y made relative to the current row; one
 * pointer walks the list forwards (the right edge), one backwards from a copy of the top point (the left edge).
 */
function fillPolygon(m, plane, staleLeft, staleRight) {
  const count = r16(m, POLYGON) + 1;
  const points = POLYGON + 2;
  let top = 0;
  for (let i = 1; i < count; i++) {
    if (r16s(m, points + i * 4) < r16s(m, points + top * 4)) {
      top = i;
    }
  }
  const topY = r16(m, points + top * 4);
  for (let i = 0; i <= count; i++) {
    const from = points + ((top + i) % count) * 4;
    w16(m, EDGE_LIST + i * 4, r16(m, from) - topY);
    w16(m, EDGE_LIST + i * 4 + 2, r16(m, from + 2));
  }
  let row = plane + topY * ROW_BYTES;
  let rightPoint = EDGE_LIST;
  let leftPoint = EDGE_LIST + count * 4;
  let right = { x: staleRight, step: 0 };
  let left = { x: staleLeft, step: 0 };
  for (;;) {
    if (r16(m, rightPoint) === 0) {
      let from;
      do {
        from = rightPoint;
        right = { x: (right.x & 0xffff0000) | r16(m, from + 2), step: 0 };
        rightPoint += 4;
        if (leftPoint < rightPoint) {
          return;
        }
      } while (r16(m, rightPoint) === 0);
      right = startEdge(m, right.x, from, rightPoint);
    }
    if (r16(m, leftPoint) === 0) {
      let from;
      do {
        from = leftPoint;
        left = { x: (left.x & 0xffff0000) | r16(m, from + 2), step: 0 };
        leftPoint -= 4;
        if (leftPoint < rightPoint) {
          return;
        }
      } while (r16(m, leftPoint) === 0);
      left = startEdge(m, left.x, from, leftPoint);
    }
    const rows = Math.min(r16s(m, rightPoint), r16s(m, leftPoint));
    for (let point = rightPoint; point <= leftPoint; point += 4) {
      const remaining = s16(r16s(m, point) - rows);
      w16(m, point, remaining);
      if (remaining < 0) {
        return;
      }
    }
    if (rows <= 0) {
      return;
    }
    for (let i = 0; i < rows; i++) {
      drawSpan(m, row, left.x, right.x);
      left.x = (left.x + left.step) >>> 0;
      right.x = (right.x + right.step) >>> 0;
      row += ROW_BYTES;
    }
  }
}

const highLong = (product) => Math.floor(product / 0x100000000);
const lowLong = (product) => ((product % 0x100000000) + 0x100000000) % 0x100000000;

/**
 * $ba28a: one face. Collect its projected points, drop it if it faces away (the test compares only the high
 * longwords of the two 64-bit cross-product halves), round the points to pixels and fill.
 */
function drawFace(m, face, pointCount, plane) {
  w16(m, POLYGON, pointCount - 1);
  for (let i = 0; i < pointCount; i++) {
    const vertex = PROJECTED + r16s(m, face + i * 2) * 8;
    w32(m, POLYGON + 2 + i * 8, r32(m, vertex));
    w32(m, POLYGON + 6 + i * 8, r32(m, vertex + 4));
  }
  const [y0, x0, y1, x1, y2, x2] = [0, 1, 2, 3, 4, 5].map((i) => r32s(m, POLYGON + 2 + i * 4));
  const down2 = (y2 - y0) | 0;
  const clockwise = ((x1 - x0) | 0) * down2;
  const anticlockwise = ((x2 - x0) | 0) * ((y1 - y0) | 0);
  if (highLong(clockwise) <= highLong(anticlockwise)) {
    return;
  }
  for (let i = 0; i < pointCount * 2; i++) {
    w16(m, POLYGON + 2 + i * 2, (r32(m, POLYGON + 2 + i * 4) + HALF) >>> 16);
  }
  // The fill starts with d4/d5 as this test left them; their high words end up as sub-pixel fractions.
  fillPolygon(m, plane, lowLong(clockwise), down2 >>> 0);
}

/** $ba27e: three groups of faces, the first into plane 3, the last into plane 1. */
function drawSlice(m, screen) {
  let at = FACES + 2;
  for (let plane = r16(m, FACES); plane >= 0; plane--) {
    const faceCount = r16(m, at) + 1;
    at += 2;
    for (let face = 0; face < faceCount; face++) {
      const pointCount = r16(m, at) + 1;
      drawFace(m, at + 2, pointCount, screen + plane * PLANE_BYTES);
      at += 2 + pointCount * 2;
    }
  }
}

const nextScreen = (screen) => (screen + SCREEN_BYTES > LAST_SCREEN ? SCREENS : screen + SCREEN_BYTES);

/** $ba130: show the screen drawn last frame, start clearing the one after next, and return the one to draw. */
function cycleScreens(m, shown) {
  for (let plane = 0; plane < PICTURE_PLANE; plane++) {
    pokeCopperPointer(m, COPPER_PLANES + plane * 8, shown + plane * PLANE_BYTES);
  }
  pokeCopperPointer(m, COPPER_PLANES + PICTURE_PLANE * 8, PICTURE);
  const drawn = nextScreen(shown);
  const b = m.blt;
  b.con0 = 0x0100;
  b.con1 = 0;
  b.dpt = nextScreen(drawn);
  b.dmod = 0;
  blit(m, CLEAR_SCREEN_BLTSIZE);
  return drawn;
}

function turn(m) {
  ANGLE_SPEEDS.forEach((speed, i) => {
    w16(m, ANGLES + i * 2, (r16(m, ANGLES + i * 2) + speed) & ANGLE_MASK);
  });
}

export function* MelonSlice(m) {
  m.mem.fill(0, A5 - 0x8000, A5 - 0x8000 + WORKSPACE_LONGS * 4);
  for (let plane = 0; plane <= PICTURE_PLANE; plane++) {
    pokeCopperPointer(m, COPPER_PLANES + plane * 8, PICTURE);
  }
  m.cop1lc = COPPER;

  // The paper fades from black to white. The original also fades colour 15, not the silhouettes' colour 8.
  for (let step = 0; step <= FADE_STEPS; step++) {
    yield* waitLine(m, 0xff);
    setColour(m, 0, BLACK, PALETTE[0], step);
    setColour(m, LAST_COLOUR, BLACK, PALETTE[PICTURE_COLOUR], step);
  }

  buildSlopeTable(m);
  for (let i = 0; i < SLOPE_TABLE_FRAMES; i++) {
    yield* waitLine(m, 0xff);
  }

  let screen = SCREENS;
  w16(m, FRAME_COUNTER, 0);
  for (;;) {
    yield* waitLine(m, 0xff);
    const frame = r16(m, FRAME_COUNTER) + 1;
    if (frame > LAST_FRAME) {
      return;
    }
    w16(m, FRAME_COUNTER, frame);
    if (frame <= FADE_STEPS) {
      fadeSliceIn(m, frame);
    }
    if (frame >= FADE_OUT_FRAME) {
      fadeAllOut(m, LAST_FRAME - frame);
    }
    screen = cycleScreens(m, screen);
    // The right mouse button would freeze the rotation here ($ba1c0).
    turn(m);
    buildMatrix(m);
    rotateVertices(m);
    projectVertices(m);
    drawSlice(m, screen);
  }
}
