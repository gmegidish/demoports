// Part 3 ($a500): the end part. "Jelly stars" (a wobbling 3D starfield) behind a green text scroller.
//
// Dual playfield: playfield 1 is two planes of stars, double-buffered at $50000/$55000 and redrawn from scratch
// every frame; playfield 2 (in front) is the scroller, two planes 272 lines high at $5a000/$5f280 whose
// pointers move down one line a frame. Every 16 frames one row of 20 characters is blitted just below the
// visible window (and 272 lines higher, so the pointers can wrap). When the text's end marker is reached the
// scroller stops; the left mouse button starts the text again from the top.
//
// The 145 stars live in a table of (x, y, z) words. Each frame x and y drift and wrap in -256..255, z drifts
// and wraps in 0..1023, all by speeds read from three slowly-walked tables. Before the perspective divide,
// each coordinate gets an offset from a sine-like table indexed by the coordinate itself plus a phase: the
// space bends, and the starfield wobbles like jelly. The depth picks the colour.
//
// The interrupt that does all this is the copper's (line $12c). Its second half waits for line $fd of the
// next frame before calling the replayer and moving the scroller.
import { r8, r16, r32, s16, w16, w32, w8, nextFrame, isLeftButtonDown, pokeCopperPointer } from '../machine.js';
import { custom, custom32 } from '../display.js';
import { mtInit, mtMusic, PART3_REPLAYER } from '../replayer.js';

const COPPER = 0xa9a0;

// --- Entry ($a500) ---
const CLEARED_FROM = 0x50000;
/** `move.l #$513f,d0 / clr.l (a0)+ / dbra`: $5140 longs. */
const CLEARED_LONGS = 0x5140;
/** $a512: y * 40 for y = 0..255. */
const ROW_OFFSETS = 0xba22;
const ROWS = 0x100;
const ROW_BYTES = 0x28;
/** $a526: $fffe00 / (z + $200) for z = 0..2047: the perspective scale, 1.15 fixed point. */
const PERSPECTIVE = 0xaa22;
const PERSPECTIVE_ENTRIES = 0x800;
const PERSPECTIVE_NUMERATOR = 0xfffe00;
const NEAREST_DEPTH = 0x200;
/** $a542: a module whose first long is $abcdef means "no music". */
const MODULE_GUARD = 0xabcdef;

// --- The stars ---
const PLANE_A = 0x50000;
const PLANE_B = 0x55000;
/** $db0c: the buffer shown; $db10: the buffer drawn. */
const SHOWN = 0xdb0c;
const DRAWN = 0xdb10;
const PLANE_BYTES = 0x2800;
const COPPER_STAR_PLANE_1 = 0xa9c6;
const COPPER_STAR_PLANE_3 = 0xa9ce;
/** $a622: clear both planes of the drawn buffer: 512 lines of 20 words, D only, minterm 0. */
const CLEAR_SIZE = 0x8014;
const CLEAR_CON0 = 0x0100;

/** $aa1a: fade level, 0..64. */
const FADE = 0xaa1a;
const FADE_STEPS = 0x40;
/** $aa14: the three star colours at full brightness; $a9ea: COLOR01..03 in the copper list. */
const STAR_COLOURS = 0xaa14;
const COPPER_STAR_COLOURS = 0xa9ea;
const STAR_COLOUR_COUNT = 3;
const COPPER_MOVE_BYTES = 4;

/** $db00/$db02/$db04: positions in the three speed tables; $aa1c/$aa1e/$aa20: this frame's speeds. */
const X_SPEEDS = { table: 0xd3aa, position: 0xdb00, speed: 0xaa1c, wrap: 0x190 };
const Y_SPEEDS = { table: 0xd53a, position: 0xdb02, speed: 0xaa1e, wrap: 0x1c6 };
const Z_SPEEDS = { table: 0xd700, position: 0xdb04, speed: 0xaa20, mask: 0x3fe };
/** $db06/$db08/$db0a: phases of the wobble; $cfaa bends x and y, $d1aa bends z. */
const X_PHASE = 0xdb06;
const Y_PHASE = 0xdb08;
const Z_PHASE = 0xdb0a;
const XY_WOBBLE = 0xcfaa;
const Z_WOBBLE = 0xd1aa;
const WOBBLE_MASK = 0x1fe;
const PHASE_STEP = 4;
const SPEED_STEP = 2;

/** $bc22: x, y, z words per star. $c7da: the projected x, y words. */
const STARS = 0xbc22;
const STAR_COUNT = 0x91;
const STAR_BYTES = 6;
const PROJECTED = 0xc7da;
const XY_MASK = 0x1ff;
const XY_CENTRE = 0x100;
const Z_MASK = 0x3ff;
const CENTRE_X = 0xa0;
const CENTRE_Y = 0x80;
const LAST_X = 0x13f;
const LAST_Y = 0xff;
/** $a79c: stars nearer than this are colour 1, then colour 2 up to FAR_DEPTH, colour 3 beyond. */
const MIDDLE_DEPTH = 0x190;
const FAR_DEPTH = 0x2f8;

// --- The scroller ---
/** $112ec: set when the text has ended (the scroller stops); the left mouse button clears it. */
const SCROLLER_STOPPED = 0x112ec;
/** $ecde: the scroll position in lines, 0..271; $ece0: the offset of the next row in the text. */
const SCROLL_LINE = 0xecde;
const TEXT_POSITION = 0xece0;
const SCROLL_LINES = 0x110;
const TEXT = 0x100e2;
/** $ece2: 16x16 two-plane characters from space, 32 bytes per plane. */
const FONT = 0xece2;
const FIRST_CHARACTER = 0x20;
const CHARACTER_BYTES = 0x40;
const CHARACTER_SIZE = 0x401;
const ROW_HEIGHT = 16;
const COLUMNS = 0x14;
const SCROLLER_PLANE_2 = 0x5a000;
/** Rows are written 16 lines above the window's top and again 272 lines further on, just below its bottom. */
const ROW_ABOVE_WINDOW = 0x59d80;
const SCROLLER_WRAP_BYTES = 0x2a80;
const SCROLLER_PLANE_GAP = 0x5280;
const COPPER_SCROLLER_PLANE_2 = 0xa9d6;
const COPPER_SCROLLER_PLANE_4 = 0xa9de;
/** $a8ba: A to D copy: AMOD 0, DMOD $26 (one word of a 40-byte line). */
const CHARACTER_MODULOS = 0x26;
const CHARACTER_CON = 0x09f00000;
const ALL_BITS = 0xffffffff;

/** $a512 and $a526: the two tables the entry builds. */
function buildTables(m) {
  for (let y = 0; y < ROWS; y++) {
    w16(m, ROW_OFFSETS + y * 2, y * ROW_BYTES);
  }
  for (let z = 0; z < PERSPECTIVE_ENTRIES; z++) {
    w16(m, PERSPECTIVE + z * 2, Math.floor(PERSPECTIVE_NUMERATOR / (z + NEAREST_DEPTH)));
  }
}

const hasMusic = (m) => r32(m, PART3_REPLAYER.module) !== MODULE_GUARD;

/** $a5a6: swap the buffers and point the copper at the one to show. */
function swapStarBuffers(m) {
  const isAShown = r32(m, SHOWN) === PLANE_A;
  const shown = isAShown ? PLANE_B : PLANE_A;
  const drawn = isAShown ? PLANE_A : PLANE_B;
  w32(m, SHOWN, shown);
  w32(m, DRAWN, drawn);
  pokeCopperPointer(m, COPPER_STAR_PLANE_1, shown);
  pokeCopperPointer(m, COPPER_STAR_PLANE_3, shown + PLANE_BYTES);
  return drawn;
}

/** $a60e: the blitter clears the buffer to draw. */
function clearStarBuffer(m, drawn) {
  custom32(m, 0x54, drawn);
  custom(m, 0x66, 0);
  custom32(m, 0x40, CLEAR_CON0 << 16);
  custom(m, 0x58, CLEAR_SIZE);
}

/** $a628: one more step of the fade-in, each colour component scaled by level/64. */
function fadeStarColours(m) {
  if (r16(m, FADE) !== FADE_STEPS) {
    w16(m, FADE, r16(m, FADE) + 1);
  }
  const level = r16(m, FADE);
  for (let i = 0; i < STAR_COLOUR_COUNT; i++) {
    const colour = r16(m, STAR_COLOURS + i * 2);
    const red = (((colour >> 8) * level) << 2) & 0xf00;
    const green = ((((colour >> 4) & 0xf) * level) >> 2) & 0xf0;
    const blue = (((colour & 0xf) * level) >> 6) & 0xf;
    w16(m, COPPER_STAR_COLOURS + i * COPPER_MOVE_BYTES, red | green | blue);
  }
}

/** $a686: this frame's three speeds. */
function readSpeeds(m) {
  for (const axis of [X_SPEEDS, Y_SPEEDS, Z_SPEEDS]) {
    w16(m, axis.speed, r16(m, axis.table + r16(m, axis.position)));
  }
}

/** `add.w (aN,d4.w)` with d4 = (phase + coordinate) & $1fe: the bend for one coordinate. */
const wobble = (m, table, phase, coordinate) => s16(r16(m, table + ((r16(m, phase) + coordinate) & WOBBLE_MASK)));

/** `muls.w / lsl.l #1 / swap / addi.w`: a coordinate times a 1.15 scale, plus the centre, as a word. */
const project = (coordinate, scale, centre) => ((((s16(coordinate) * scale) << 1) >> 16) + centre) & 0xffff;

/** $a6bc: move every star and project it. */
function moveAndProjectStars(m) {
  const speedX = r16(m, X_SPEEDS.speed);
  const speedY = r16(m, Y_SPEEDS.speed);
  const speedZ = r16(m, Z_SPEEDS.speed);
  for (let i = 0; i < STAR_COUNT; i++) {
    const star = STARS + i * STAR_BYTES;
    const x = s16(((r16(m, star) + speedX) & XY_MASK) - XY_CENTRE);
    const y = s16(((r16(m, star + 2) + speedY) & XY_MASK) - XY_CENTRE);
    const z = (r16(m, star + 4) + speedZ) & Z_MASK;
    w16(m, star, x & 0xffff);
    w16(m, star + 2, y & 0xffff);
    w16(m, star + 4, z);
    const bentX = x + wobble(m, XY_WOBBLE, X_PHASE, x);
    const bentY = y + wobble(m, XY_WOBBLE, Y_PHASE, y);
    const bentZ = (z + r16(m, Z_WOBBLE + ((r16(m, Z_PHASE) + z) & WOBBLE_MASK))) & 0xffff;
    const scale = r16(m, PERSPECTIVE + s16((bentZ << 1) & 0xffff));
    w16(m, PROJECTED + i * 4, project(bentX, scale, CENTRE_X));
    w16(m, PROJECTED + i * 4 + 2, project(bentY, scale, CENTRE_Y));
  }
}

/** `bset.b d3,(aN,d1.w)`: d1 is a signed word offset. */
function setPixel(m, plane, offset, bit) {
  const address = plane + s16(offset);
  w8(m, address, r8(m, address) | (1 << bit));
}

/** $a758: plot the projected stars in the drawn buffer, the colour by depth. */
function plotStars(m, drawn) {
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = r16(m, PROJECTED + i * 4);
    const y = r16(m, PROJECTED + i * 4 + 2);
    if (x > LAST_X || y > LAST_Y) {
      continue;
    }
    const offset = ((x >> 3) + r16(m, ROW_OFFSETS + y * 2)) & 0xffff;
    const bit = 7 - (x & 7);
    const depth = r16(m, STARS + i * STAR_BYTES + 4);
    if (depth < MIDDLE_DEPTH || depth >= FAR_DEPTH) {
      setPixel(m, drawn, offset, bit);
    }
    if (depth >= MIDDLE_DEPTH) {
      setPixel(m, drawn + PLANE_BYTES, offset, bit);
    }
  }
}

/** $a7be: walk the speed tables and the wobble phases. */
function advancePhases(m) {
  for (const axis of [X_SPEEDS, Y_SPEEDS]) {
    const position = r16(m, axis.position) + SPEED_STEP;
    w16(m, axis.position, position === axis.wrap ? 0 : position);
  }
  w16(m, Z_SPEEDS.position, (r16(m, Z_SPEEDS.position) + SPEED_STEP) & Z_SPEEDS.mask);
  for (const phase of [X_PHASE, Y_PHASE, Z_PHASE]) {
    w16(m, phase, r16(m, phase) + PHASE_STEP);
  }
}

/** $a58c-$a804: the interrupt up to the replayer call. */
function interruptStars(m) {
  if (isLeftButtonDown(m)) {
    w16(m, SCROLLER_STOPPED, 0);
  }
  const drawn = swapStarBuffers(m);
  clearStarBuffer(m, drawn);
  fadeStarColours(m);
  readSpeeds(m);
  moveAndProjectStars(m);
  plotStars(m, drawn);
  advancePhases(m);
}

/** $a8b2: one character, both planes, to `top` and to `bottom` (the copy 272 lines further on). */
function blitCharacter(m, glyph, top, bottom) {
  custom32(m, 0x64, CHARACTER_MODULOS);
  custom32(m, 0x44, ALL_BITS);
  custom32(m, 0x40, CHARACTER_CON);
  for (const destination of [top, bottom]) {
    // BLTAPT runs on from the first plane of the glyph into its second.
    custom32(m, 0x50, glyph);
    custom32(m, 0x54, destination);
    custom(m, 0x58, CHARACTER_SIZE);
    custom32(m, 0x54, destination + SCROLLER_PLANE_GAP);
    custom(m, 0x58, CHARACTER_SIZE);
  }
}

/** $a846: blit the next row of text. A zero byte ends a line (the rest is spaces); a zero word is an empty row. */
function drawTextRow(m, scrollLine) {
  const above = ROW_ABOVE_WINDOW + scrollLine * ROW_BYTES;
  const below = above + SCROLLER_WRAP_BYTES;
  const top = scrollLine === 0 ? below : above;
  let position = r16(m, TEXT_POSITION);
  const isEmptyRow = r16(m, TEXT + position) === 0;
  for (let column = 0; column < COLUMNS; column++) {
    let character = r8(m, TEXT + position);
    if (character === 0) {
      character = FIRST_CHARACTER;
      position--;
    }
    position++;
    const glyph = FONT + s16(((character - FIRST_CHARACTER) * CHARACTER_BYTES) & 0xffff);
    blitCharacter(m, glyph, top + column * 2, below + column * 2);
  }
  if (isEmptyRow) {
    position += 2;
  }
  w16(m, TEXT_POSITION, position & 0xffff);
  if (r16(m, TEXT + position) & 0x8000) {
    w16(m, TEXT_POSITION, 0);
    w16(m, SCROLLER_STOPPED, 1);
  }
}

/** $a82e: unless stopped, a new row every 16 lines, and the window one line further down the planes. */
function scroll(m) {
  if (r16(m, SCROLLER_STOPPED) !== 0) {
    return;
  }
  if ((r16(m, SCROLL_LINE) & (ROW_HEIGHT - 1)) === 0) {
    drawTextRow(m, r16(m, SCROLL_LINE));
  }
  let line = r16(m, SCROLL_LINE) + 1;
  if (line === SCROLL_LINES) {
    line = 0;
  }
  w16(m, SCROLL_LINE, line);
  const window = SCROLLER_PLANE_2 + line * ROW_BYTES;
  pokeCopperPointer(m, COPPER_SCROLLER_PLANE_2, window);
  pokeCopperPointer(m, COPPER_SCROLLER_PLANE_4, window + SCROLLER_PLANE_GAP);
}

/** $a80a-$a996: wait for line $fd, the replayer, then the scroller. */
function interruptMusicAndScroller(m) {
  if (hasMusic(m)) {
    mtMusic(m, PART3_REPLAYER);
  }
  if (!m.isAudioOnly) {
    scroll(m);
  }
}

/** $a500. The part never returns: its main loop is `bra.b *`. It ignores the boot copper list it is given in A0. */
export function* part3(m, bootCopper) {
  m.mem.fill(0, CLEARED_FROM, CLEARED_FROM + CLEARED_LONGS * 4);
  buildTables(m);
  if (hasMusic(m)) {
    mtInit(m, PART3_REPLAYER);
  }
  custom(m, 0x96, 0x0020);
  custom(m, 0x96, 0x8400);
  m.cop1lc = COPPER;
  // The copper raises the interrupt at line $12c; the first one comes in this frame.
  yield* nextFrame(m);
  for (;;) {
    if (!m.isAudioOnly) {
      interruptStars(m);
    }
    yield* nextFrame(m);
    // The same interrupt, now at line $fd of the next frame: the star buffer drawn above is on screen.
    interruptMusicAndScroller(m);
  }
}
