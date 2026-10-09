// Part 1 ($a500): the intro. Black for nine seconds while the music starts, then three one-plane pictures,
// "PREPARE YOURSELF", "FOR" and "A BORING WAIT WHILE IT LOADS", each arriving with a white flash that fades
// to black and blue, and a last white flash fading to black.
//
// The pictures are 320x44 one-bit images (40 bytes x 44 lines, $6e0 bytes each) at $a756, $ae36 and $b516,
// shown between lines $96 and $c2. The copper list feeds the same picture to two planes, and BPLCON1 delays
// plane 2 by one pixel: so the letters (colour 3) get a one-pixel fringe of colour 1 on their left edge
// and colour 2 on their right. Until frame $1c0, and again from frame $300, both modulos are -40, which
// repeats the picture's first line (blank) down the whole band.
//
// There is no vertical-blank interrupt: the copper list ends with a write to INTREQ ($8010, COPER) at line
// $c2, and the part's level-3 handler at $a5ae runs from that. It is still once a frame, and it runs after
// the band has been shown, so what it sets is seen on the next frame, as in this port.
import { r16, r32, w16, w32, nextFrame, pokeCopperPointer, isLeftButtonDown } from '../machine.js';
import { custom32 } from '../display.js';
import { mtInit, mtMusic, mtEnd, PART1_REPLAYER } from '../replayer.js';

const COPPER = 0xa6f6;
/** $a752: where the entry stores A0, the boot block's copper list, to restore it on the way out. */
const SAVED_COPPER = 0xa752;
/** Value words of BPL1PTH and BPL2PTH in the copper list (each PTL is 4 bytes on). */
const PLANE1_POINTER = 0xa734;
const PLANE2_POINTER = 0xa73c;
const BPL1MOD_VALUE = 0xa714;
const BPL2MOD_VALUE = 0xa718;
const COLOUR0_VALUE = 0xa71c;
const COLOUR3_VALUE = 0xa720;
const COLOUR2_VALUE = 0xa724;
const COLOUR1_VALUE = 0xa728;
/** $a6f4: the handler's frame counter. */
const FRAME_COUNTER = 0xa6f4;
const PREPARE_YOURSELF = 0xa756;
const FOR = 0xae36;
const A_BORING_WAIT = 0xb516;
const PREPARE_YOURSELF_AT = 0x1c0;
const FOR_AT = 0x230;
const A_BORING_WAIT_AT = 0x2a0;
const LAST_FLASH_AT = 0x300;
const LAST_FRAME = 0x310;
const WHITE = 0xfff;
/** Per frame of a fade: colour 0 goes white to black, colour 3 white to blue. */
const COLOUR0_STEP = 0x111;
const COLOUR3_STEP = 0x110;
/** -40: each line fetches 40 bytes and steps back over them. */
const REPEAT_LINE = 0xffd8;
/** `cmpi.l #$abcdef,$cdc0`: with this as the module's first long the part runs without music. */
const NO_MUSIC_MARK = 0xabcdef;
const COP1LC = 0x80;

function isMusicPresent(m) {
  return r32(m, PART1_REPLAYER.module) !== NO_MUSIC_MARK;
}

/** $a506 / $a63e / $a670: both planes show one picture. */
function showPicture(m, picture) {
  pokeCopperPointer(m, PLANE1_POINTER, picture);
  pokeCopperPointer(m, PLANE2_POINTER, picture);
}

function flashWhite(m) {
  w16(m, COLOUR0_VALUE, WHITE);
  w16(m, COLOUR3_VALUE, WHITE);
}

function setModulos(m, modulo) {
  w16(m, BPL1MOD_VALUE, modulo);
  w16(m, BPL2MOD_VALUE, modulo);
}

/** $a5d2: one step of the fade, while colour 0 is not black. */
function fadeStep(m) {
  if (r16(m, COLOUR0_VALUE) === 0) {
    return;
  }
  w16(m, COLOUR0_VALUE, r16(m, COLOUR0_VALUE) - COLOUR0_STEP);
  w16(m, COLOUR3_VALUE, (r16(m, COLOUR3_VALUE) - COLOUR3_STEP) & 0xffff);
}

/** $a5ea: the timeline. */
function cue(m, frame) {
  switch (frame) {
    case PREPARE_YOURSELF_AT:
      setModulos(m, 0);
      flashWhite(m);
      break;
    case FOR_AT:
      showPicture(m, FOR);
      flashWhite(m);
      break;
    case A_BORING_WAIT_AT:
      showPicture(m, A_BORING_WAIT);
      flashWhite(m);
      break;
    case LAST_FLASH_AT:
      flashWhite(m);
      setModulos(m, REPEAT_LINE);
      break;
    default:
      break;
  }
}

/**
 * $a6c8: colours 1 and 2, the fringes, from colour 3. Colour 2 = colour 3 / 2; colour 1 ORs colour 3 with that
 * half shifted up one and two nibbles (word arithmetic; Denise keeps the low 12 bits).
 */
function deriveFringeColours(m) {
  const colour3 = r16(m, COLOUR3_VALUE);
  let half = colour3 >> 1;
  w16(m, COLOUR2_VALUE, half);
  let colour1 = colour3;
  half = (half << 4) & 0xffff;
  colour1 |= half;
  half = (half << 4) & 0xffff;
  colour1 |= half;
  w16(m, COLOUR1_VALUE, colour1);
}

/** $a5ae: the copper interrupt, once a frame at line $c2. It ends by jumping to the system's handler. */
function interrupt(m) {
  if (isMusicPresent(m)) {
    mtMusic(m, PART1_REPLAYER);
  }
  fadeStep(m);
  const frame = r16(m, FRAME_COUNTER);
  cue(m, frame);
  w16(m, FRAME_COUNTER, (frame + 1) & 0xffff);
  deriveFringeColours(m);
}

export function* part1(m, bootCopper) {
  w32(m, SAVED_COPPER, bootCopper);
  showPicture(m, PREPARE_YOURSELF);
  if (isMusicPresent(m)) {
    mtInit(m, PART1_REPLAYER);
  }
  // $a538: DMACON sprites off, blitter-nasty on; INTENA blitter and vertical blank off, then the handler at
  // $6c and the copper interrupt on; COP1LC = $a6f6 (the copper starts there at the next vertical blank).
  custom32(m, COP1LC, COPPER);
  // $a56e: until frame $310, or the left button.
  for (;;) {
    yield* nextFrame(m);
    interrupt(m);
    if (r16(m, FRAME_COUNTER) === LAST_FRAME || isLeftButtonDown(m)) {
      break;
    }
  }
  if (isMusicPresent(m)) {
    mtEnd(m, PART1_REPLAYER);
  }
  // $a594: back to the boot copper list and the old level-3 vector; copper interrupt off. `moveq #0,d0 / rts`.
  custom32(m, COP1LC, r32(m, SAVED_COPPER));
}
