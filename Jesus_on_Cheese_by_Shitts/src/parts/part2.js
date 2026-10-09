// Part 2 ($a500): the main part. A script of 9280 frames (3 min 5.6 s) that loops until the left mouse button:
// two oscilloscopes over pictures, a moiré of colour-cycled rings, and scanned pictures (the "Jesus on Cheese"
// logo, faces, a dog, a rainbow) flashed in pairs of colours.
//
// The entry builds a few copper-list pieces, starts the music and hands everything to a level-3 interrupt that
// the copper raises itself: every effect's copper list ends with WAIT line $12c / COPJMP2, and COP2LC ($d996)
// writes INTREQ = COPER. The handler $ce48 walks the script at $a6f2, one entry being
//   frames.w, effect.w, [parameter words the effect takes on the entry's first frame]
// and the effect table at $a6be gives each effect its routine, its copper list and its parameters. Every routine
// ends in the common tail $d956: wait for line $e8, then mt_music.
//
// The effects never draw with the CPU (only the oscilloscopes, in part2-scopes.js, use the blitter): they poke
// pointers, scroll values and colours into their copper lists.
import { r16, r32, w16, w32, s16, nextFrame, isLeftButtonDown, pokeCopperPointer } from '../machine.js';
import { custom, custom32 } from '../display.js';
import { mtInit, mtMusic, mtEnd, PART2_REPLAYER } from '../replayer.js';
import { scope1, scope2 } from './part2-scopes.js';

/**
 * @typedef {object} EffectRegisters what the dispatcher leaves in A0/A1 when it jumps to an effect routine
 * @property {number} a0 on an entry's first frame: the address of its parameter words in the script
 * @property {number} a1 on an entry's first frame: the effect table entry's parameters (entry + 8)
 */

// The script and its dispatcher's variables.
const SCRIPT = 0xa6f2;
/** Byte offset of the current entry in the script. Effects step it over the parameter words they take. */
const SCRIPT_INDEX = 0xa6ee;
const FRAMES_LEFT = 0xa6f0;
/** Set by the dispatcher on an entry's first frame, cleared by the common tail. */
const FIRST_FRAME = 0xa6bc;
const EFFECT_TABLE = 0xa6be;
/** The current entry's routine: the dispatcher jumps to it every frame (`move.l $ce44,-(a7) / rts`). */
const ROUTINE = 0xce44;
const ENTRY_HEADER_BYTES = 4;
/** An effect table entry: routine.l, copper list.l, then the effect's own parameters. */
const EFFECT_COPPER = 4;
const EFFECT_PARAMETERS = 8;
/**
 * A0 and A1 as the interrupted main loop has them: what mt_init left (`lea $66794(pc),a1`, `lea $dff000,a0`).
 * Routines see these on every frame but an entry's first; none of them looks.
 */
const MAIN_LOOP_REGISTERS = { a0: 0xdff000, a1: 0x66794 };

// The entry's copper lists.
const PLAIN_COPPER = 0xd97e;
/** COP2LC: INTREQ = $8010, the copper interrupt that runs the handler. */
const INTERRUPT_COPPER = 0xd996;
/** `move.l a0,$d992`: the boot block's copper list, put back on the way out. */
const SAVED_COPPER = 0xd992;
/** $d9de: 16 copper moves for COLOR00-COLOR15 in the rings' list, filled in by the colour cycling. */
const RINGS_COLOUR_MOVES = 0xd9de;
const COLOUR00 = 0x180;
const COPPER_MOVE_BYTES = 4;
const RING_COLOURS = 16;
/** Effect 7's copper list (no script entry uses it): a 3-plane picture at $3cb56 and its 8 colours. */
const UNUSED_PICTURE = 0x3cb56;
const UNUSED_PICTURE_COLOURS = 8;
const UNUSED_COPPER_COLOURS = 0x4de68;
const UNUSED_COPPER_PLANES = 0x4de50;
const UNUSED_PICTURE_PLANE_BYTES = 0xdec;
const UNUSED_PICTURE_PLANES = 3;
const COPPER_POINTER_BYTES = 8;
/** $d4e2's copper list: 32 colour moves, all black for now. */
const SCOPE2_COLOUR_MOVES = 0x5647e;
const SCOPE2_COLOURS = 32;
/** $d1c6's copper list: its plane pointer, and the buffer that goes there first. */
const SCOPE1_COPPER_PLANE = 0x4debc;
const SCOPE1_FIRST_PLANE = 0x536f2;

// Custom-chip registers.
const COP1LC = 0x80;
const COP2LC = 0x84;
const DMACON = 0x96;
const INTENA = 0x9a;
const SPRITE_DMA_OFF = 0x0020;
const ALL_LEVEL3_OFF = 0x0060;
const COPPER_INTERRUPT_ON = 0x8010;
const COPPER_INTERRUPT_OFF = 0x0010;

// Effect 0 ($ceca): a plain background.
const PLAIN_COLOUR = 0xd984;

// Effect 1 ($cee6): the rings.
/** Four tables of words, each ending in a negative word, and the byte index each is read at. */
const RING_TABLES = [
  { table: 0xdab4, index: 0xdb7e, value: 0xdaac },
  { table: 0xdb80, index: 0xdc94, value: 0xdaae },
  { table: 0xdc96, index: 0xddc6, value: 0xdab0 },
  { table: 0xddc8, index: 0xde78, value: 0xdab2 },
];
const RINGS_X1 = 0xdaac;
const RINGS_Y1 = 0xdaae;
const RINGS_X2 = 0xdab0;
const RINGS_Y2 = 0xdab2;
/** The rings: two planes 640 pixels (80 bytes) wide, the second $a000 after the first; both sets scroll over them. */
const RINGS_PICTURE = 0xde7a;
const RINGS_ROW_BYTES = 0x50;
const RINGS_PLANE_BYTES = 0xa000;
const RINGS_BPLCON1 = 0xd9b4;
const RINGS_BPL1PT = 0xd9c0;
const RINGS_BPL2PT = 0xd9c8;
const RINGS_BPL3PT = 0xd9d0;
const RINGS_BPL4PT = 0xd9d8;
const SCROLL_MASK = 0xf;
const PIXELS_PER_BYTE = 8;
/** Four banks of 16 colours, one shown per frame, in turn. */
const RINGS_PALETTES = 0xda2a;
const RINGS_PALETTE_NUMBER = 0xdaaa;
const RINGS_PALETTE_MASK = 3;
const RINGS_PALETTE_BYTES = 0x20;
const COPPER_VALUE = 2;

// Effects 2-6, 10, 11 ($d076): a centred 16-colour picture, its colours a ramp between two script colours.
const PICTURE_PLANE_BYTES = 0xd072;
const PICTURE_DIWSTRT = 0x21e7c;
const PICTURE_DIWSTOP = 0x21e80;
const PICTURE_DDFSTRT = 0x21e84;
const PICTURE_DDFSTOP = 0x21e88;
const PICTURE_BPL1PT = 0x21e9c;
const PICTURE_PLANES = 4;
const PICTURE_COLOURS = 0x21ebc;
const PICTURE_PARAMETER_BYTES = 4;
const SCREEN_WIDTH = 0x140;
const SCREEN_HEIGHT = 0x100;
const WINDOW_LEFT = 0x81;
const WINDOW_RIGHT = 0xc1;
const WINDOW_TOP = 0x2c;
const WINDOW_BOTTOM = 0x2b;
const FETCH_START = 0x38;
const FETCH_STOP = 0xd0;
const LAST_RAMP_STEP = 15;
/**
 * The copper takes its colours at the top of the frame, 12 lines after the interrupt at line $12c. In that time
 * $d076 reaches its colour loop and computes only the first few of the 16 colours (some 860 CPU cycles each:
 * three `muls`/`divs` pairs), so on an entry's first frame the picture shows the new COLOR00-05 and the copper
 * list's previous COLOR06-15; the one-frame picture entries never show more than that. Measured in the capture:
 * over 223 first frames of picture entries, 6 fits best (5 and 7 nearly as well; 0 and 16 are far off).
 */
const COLOURS_BEFORE_THE_COPPER = 6;

/** $ceca: on the first frame, COLOR00 of the plain copper list from the script's one parameter word. */
function plainColour(m, { a0 }) {
  if (!r16(m, FIRST_FRAME)) {
    return;
  }
  w16(m, SCRIPT_INDEX, r16(m, SCRIPT_INDEX) + 2);
  w16(m, PLAIN_COLOUR, r16(m, a0));
}

/** Byte address of pixel (x, y) of the rings' pictures, as $cee6 computes it (an `add.w` for the column). */
function ringsAddress(x, y) {
  const row = y * RINGS_ROW_BYTES;
  const column = (x >>> 3) & 0xfffe;
  return ((row & 0xffff0000) | ((row + column) & 0xffff)) + RINGS_PICTURE;
}

/** The scroll value for BPLCON1 that moves a picture fetched at a word boundary to pixel x. */
function ringsScroll(x) {
  return (SCROLL_MASK - x) & SCROLL_MASK;
}

function stepRingTable(m, { table, index }) {
  const next = r16(m, index) + 2;
  w16(m, index, next);
  if (s16(r16(m, table + next)) < 0) {
    w16(m, index, 0);
  }
}

/**
 * $cee6: odd planes and even planes show two sets of rings at positions read from four tables: each set's
 * picture is 640 pixels wide, so moving its pointer and scroll moves it over the screen; where they overlap
 * their bits make a 16-colour moiré, and the 16 colours cycle through four banks.
 */
function rings(m) {
  for (const { table, index, value } of RING_TABLES) {
    w16(m, value, r16(m, table + r16(m, index)));
  }
  const odd = ringsAddress(r16(m, RINGS_X1), r16(m, RINGS_Y1));
  const even = ringsAddress(r16(m, RINGS_X2), r16(m, RINGS_Y2));
  pokeCopperPointer(m, RINGS_BPL1PT, odd);
  pokeCopperPointer(m, RINGS_BPL3PT, odd + RINGS_PLANE_BYTES);
  w16(m, RINGS_BPLCON1, ringsScroll(r16(m, RINGS_X1)) | (ringsScroll(r16(m, RINGS_X2)) << 4));
  pokeCopperPointer(m, RINGS_BPL2PT, even);
  pokeCopperPointer(m, RINGS_BPL4PT, even + RINGS_PLANE_BYTES);
  for (const ringTable of RING_TABLES) {
    stepRingTable(m, ringTable);
  }

  const bank = r16(m, RINGS_PALETTE_NUMBER);
  w16(m, RINGS_PALETTE_NUMBER, (bank + 1) & RINGS_PALETTE_MASK);
  const palette = RINGS_PALETTES + bank * RINGS_PALETTE_BYTES;
  for (let i = 0; i < RING_COLOURS; i++) {
    w16(m, RINGS_COLOUR_MOVES + COPPER_VALUE + i * COPPER_MOVE_BYTES, r16(m, palette + i * 2));
  }
}

/** One 4-bit component `step` fifteenths of the way from `from` to `to` (`muls`, `divs #15`: rounds towards 0). */
function rampComponent(from, to, step) {
  return (Math.trunc((step * s16((to - from) & 0xffff)) / LAST_RAMP_STEP) + from) & 0xffff;
}

/** Colour `step` of the ramp: 15 is `to`, 0 is `from`. Red is the colour's top byte, unmasked, as the original. */
function rampColour(from, to, step) {
  const red = rampComponent(from >> 8, to >> 8, step) << 8;
  const green = rampComponent((from >> 4) & 0xf, (to >> 4) & 0xf, step) << 4;
  const blue = rampComponent(from & 0xf, to & 0xf, step);
  return (red | green | blue) & 0xffff;
}

/** $d076 on an entry's first frame: four planes of the picture one after the other, centred by DIW/DDF. */
function showPicture(m, picture, width, height) {
  const planeBytes = ((width & 0xffff) >>> 3) * (height & 0xffff);
  w32(m, PICTURE_PLANE_BYTES, planeBytes);
  for (let plane = 0; plane < PICTURE_PLANES; plane++) {
    pokeCopperPointer(m, PICTURE_BPL1PT + plane * COPPER_POINTER_BYTES, picture + plane * planeBytes);
  }
  const sideMargin = ((SCREEN_WIDTH - width) & 0xffff) >>> 1;
  const topMargin = ((SCREEN_HEIGHT - height) & 0xffff) >>> 1;
  const fetchMargin = ((SCREEN_WIDTH - width) & 0xffff) >>> 2;
  const left = (WINDOW_LEFT + sideMargin) & 0xffff;
  const right = (WINDOW_RIGHT - sideMargin) & 0xffff;
  const top = ((WINDOW_TOP + topMargin) << 8) & 0xffff;
  const bottom = ((WINDOW_BOTTOM - topMargin) << 8) & 0xffff;
  w16(m, PICTURE_DIWSTRT, left | top);
  w16(m, PICTURE_DIWSTOP, right | bottom);
  w16(m, PICTURE_DDFSTRT, (FETCH_START + fetchMargin) & 0xffff);
  w16(m, PICTURE_DDFSTOP, (FETCH_STOP - fetchMargin) & 0xffff);
}

/**
 * $d076: the effect table gives the picture (address, width, height); the script two colours. Colour 0 is the
 * second colour, colour 15 the first, the others in between. Nothing happens after the first frame.
 */
function picture(m, { a0, a1 }) {
  if (!r16(m, FIRST_FRAME)) {
    return;
  }
  showPicture(m, r32(m, a1), r32(m, a1 + 4), r32(m, a1 + 8));
  w16(m, SCRIPT_INDEX, r16(m, SCRIPT_INDEX) + PICTURE_PARAMETER_BYTES);
  const first = r16(m, a0);
  const second = r16(m, a0 + 2);
  for (let step = LAST_RAMP_STEP, i = 0; step >= 0; step--, i++) {
    const at = PICTURE_COLOURS + i * COPPER_MOVE_BYTES;
    if (i < COLOURS_BEFORE_THE_COPPER) {
      w16(m, at, rampColour(first, second, step));
    } else {
      m.part2LateWrites.push([at, rampColour(first, second, step)]);
    }
  }
}

/**
 * Copper-list words the CPU wrote after the copper had read them this frame: they reach memory here, at the
 * next interrupt (or for a memory comparison, right after the interrupt that wrote them).
 */
export function flushLateCopperWrites(m) {
  for (const [address, value] of m.part2LateWrites) {
    w16(m, address, value);
  }
  m.part2LateWrites = [];
}

/** The effect routines by address. $d956 itself is effect 7's routine: the tail alone. */
const ROUTINES = new Map([
  [0xceca, plainColour],
  [0xcee6, rings],
  [0xd076, picture],
  [0xd1c6, scope1],
  [0xd4e2, scope2],
  [0xd956, () => {}],
]);

/** $ce48-$cebc: when the current entry has run its frames, start the next one (from the top after a 0 word). */
function startNextEntryIfDue(m) {
  if (r16(m, FRAMES_LEFT)) {
    return MAIN_LOOP_REGISTERS;
  }
  let index = r16(m, SCRIPT_INDEX);
  if (!r16(m, SCRIPT + index)) {
    index = 0;
    w16(m, SCRIPT_INDEX, 0);
  }
  w16(m, SCRIPT_INDEX, r16(m, SCRIPT_INDEX) + ENTRY_HEADER_BYTES);
  w16(m, FRAMES_LEFT, r16(m, SCRIPT + index));
  const effect = r32(m, EFFECT_TABLE + ((r16(m, SCRIPT + index + 2) << 2) & 0xffff));
  w32(m, ROUTINE, r32(m, effect));
  custom32(m, COP1LC, r32(m, effect + EFFECT_COPPER));
  w16(m, FIRST_FRAME, 1);
  return { a0: SCRIPT + index + ENTRY_HEADER_BYTES, a1: effect + EFFECT_PARAMETERS };
}

/** $d956: wait for line $e8 (no need here), clear the first-frame flag, play the music. */
function commonTail(m) {
  w16(m, FIRST_FRAME, 0);
  mtMusic(m, PART2_REPLAYER);
}

/**
 * $ce48: the level-3 (copper) interrupt, once a frame. While the left button is down it does nothing at all
 * (`btst #6,$bfe001 / beq $d974`), not even the music.
 */
export function part2Interrupt(m) {
  flushLateCopperWrites(m);
  if (isLeftButtonDown(m)) {
    return;
  }
  const registers = startNextEntryIfDue(m);
  w16(m, FRAMES_LEFT, r16(m, FRAMES_LEFT) - 1);
  const routine = ROUTINES.get(r32(m, ROUTINE));
  if (!routine) {
    throw new Error(`part 2: no effect routine at $${r32(m, ROUTINE).toString(16)}`);
  }
  routine(m, registers);
  commonTail(m);
}

/** $a500-$a5d6: copper-list pieces, the music, and the copper interrupt. The old $6c vector is not needed here. */
export function enterPart2(m, bootCopper) {
  m.part2LateWrites = [];
  w32(m, SAVED_COPPER, bootCopper);
  for (let i = 0; i < RING_COLOURS; i++) {
    w16(m, RINGS_COLOUR_MOVES + i * COPPER_MOVE_BYTES, COLOUR00 + i * 2);
    w16(m, RINGS_COLOUR_MOVES + i * COPPER_MOVE_BYTES + COPPER_VALUE, 0);
  }
  for (let i = 0; i < UNUSED_PICTURE_COLOURS; i++) {
    w16(m, UNUSED_COPPER_COLOURS + i * COPPER_MOVE_BYTES, r16(m, UNUSED_PICTURE + i * 2));
  }
  for (let plane = 0; plane < UNUSED_PICTURE_PLANES; plane++) {
    pokeCopperPointer(m, UNUSED_COPPER_PLANES + plane * COPPER_POINTER_BYTES,
      UNUSED_PICTURE + plane * UNUSED_PICTURE_PLANE_BYTES);
  }
  for (let i = 0; i < SCOPE2_COLOURS; i++) {
    w16(m, SCOPE2_COLOUR_MOVES + i * COPPER_MOVE_BYTES, COLOUR00 + i * 2);
    w16(m, SCOPE2_COLOUR_MOVES + i * COPPER_MOVE_BYTES + COPPER_VALUE, 0);
  }
  pokeCopperPointer(m, SCOPE1_COPPER_PLANE, SCOPE1_FIRST_PLANE);
  mtInit(m, PART2_REPLAYER);
  custom(m, INTENA, ALL_LEVEL3_OFF);
  custom(m, INTENA, COPPER_INTERRUPT_ON);
  custom(m, DMACON, SPRITE_DMA_OFF);
  custom32(m, COP2LC, INTERRUPT_COPPER);
  custom32(m, COP1LC, PLAIN_COPPER);
}

/** $a5e8: mt_end, the boot block's copper list back, the copper interrupt off. */
function leavePart2(m) {
  flushLateCopperWrites(m);
  mtEnd(m, PART2_REPLAYER);
  custom32(m, COP1LC, r32(m, SAVED_COPPER));
  custom(m, INTENA, COPPER_INTERRUPT_OFF);
}

/**
 * The main loop only polls the left button. The interrupt comes at line $12c, after the frame it changes the copper
 * lists for has been shown, so a frame shows what the previous frame's interrupt left. The effects are a few
 * copper-list words each, so they run even when only the music is wanted (the script must keep walking).
 */
export function* part2(m, bootCopper) {
  enterPart2(m, bootCopper);
  for (;;) {
    yield* nextFrame(m);
    if (isLeftButtonDown(m)) {
      break;
    }
    part2Interrupt(m);
  }
  leavePart2(m);
}
