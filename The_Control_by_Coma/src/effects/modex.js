// The part-2 scenes in the unchained 320x400 RGB-scanline mode: three MORPH objects (R, G, B) per frame,
// each upscaled to 320x132 and written to every third line of the back page, a caption or scroller into
// B2 copied onto the planes, then the page shown and flipped. Notes: C1 §8, C2 (RGB mode), C6.
//
// The recording does not show these as intended: DOSBox mirrors port 3d3 onto the CRTC, so CRTC[9] = 6 and
// each memory line is repeated 7 times (only lines 0..56 are visible). The port shows the intended 400 lines.
import { aviItem, fliItem } from '../tables.js';
import { grain, workBuffer, backBuffer, isFirstCall } from '../helpers.js';
import { GRAIN_LEVEL, GRAIN_COUNT, GRAIN_ADD } from '../addresses.js';
import { drawText, TEXT_POINTER, TEXT_COLOUR_BASE } from '../text.js';
import {
  MORPH_ITEM,
  MORPH_GREEN_ITEM,
  MORPH_BLUE_ITEM,
  OBJECT_BUFFERS,
  UPSCALE_SHIFT,
  UPSCALE_ADD,
  SCROLLER_POSITION,
  TEXT_PLANE_OFFSET,
  resetAnimation,
  stepObjects,
  upscale4x,
  writeComponentToPlanes,
  flipPage,
  copyTextToPlanes,
  drawScroller,
  drawAloneScroller,
  drawSystemScroller,
} from '../morph.js';

const B2_CLEAR_BYTES = 0xfa0 * 4;
const MODE_X_PALETTE = 0x54b0b;
const MODE_X_PALETTE_BYTES = 0x240;
const OBJECT_SHIFT = 2;
const CAPTION_COLOUR_BASE = 0xc0;
const GREY_RAMP_FIRST = 0xc0;

const FROZEN_GRAIN_COUNT = 0xa640;
const FROZEN_START_LEVEL = 0x40;
const FROZEN_SYSTEM_LEVEL = 0x0c;

/**
 * Drawn frames per second, from the decoded frame number matched against the recording's visible band:
 * 0x54ec3 decodes 14.2 frames/s from 174.90 s, below the 23.4 requests/s of its scene, so its loop ran at
 * 14.2 passes/s. Every other object scene decodes exactly at its request rate (9.4 or 14.1/s, frames never
 * missed), so it ran faster than that; 20 keeps one pass between any two requests.
 */
const SUPERMARKET_PASSES_PER_SECOND = 14.2;
const OBJECT_PASSES_PER_SECOND = 20;
/** 0x54f64 and 0x5543c skip the decode and the text: about 12 and 18 changed frames/s in the recording (C6). */
const FROZEN_PASSES_PER_SECOND = 12;
const FROZEN_SYSTEM_PASSES_PER_SECOND = 18;

/** 0x54e0b: unchained mode, 400 lines, all four planes cleared, DAC 0..191 = the R, G, B ramps at 0x54b0b. */
function modeXInit(m) {
  m.dacMask = 0;
  m.setModeX();
  m.mapMask = 0x0f;
  m.dacLoad(0, MODE_X_PALETTE, MODE_X_PALETTE_BYTES);
  m.dacMask = 0xff;
}

function selectObjects(m, items) {
  m.set32(MORPH_ITEM, items[0]);
  m.set32(MORPH_GREEN_ITEM, items[1]);
  m.set32(MORPH_BLUE_ITEM, items[2]);
  m.set8(UPSCALE_SHIFT, OBJECT_SHIFT);
  m.set8(UPSCALE_ADD, 0);
}

function clearB2(m) {
  const b2 = backBuffer(m);
  m.mem.fill(0, b2, b2 + B2_CLEAR_BYTES);
}

/** A fixed caption into B2 and onto the planes at `planeOffset` (0x55621 ... 0x55e3d). */
function drawCaption(m, text, planeOffset) {
  m.set32(TEXT_POINTER, text);
  m.set32(TEXT_PLANE_OFFSET, planeOffset);
  m.set8(TEXT_COLOUR_BASE, CAPTION_COLOUR_BASE);
  drawText(m, backBuffer(m));
  copyTextToPlanes(m);
}

/**
 * The common shape of the object effects: one-shot init, the three objects, then `overlay` (text), show + flip.
 * `items(m)` gives the R, G, B items; `init(m)` runs once (after the flag is set).
 */
function objectsEffect({ flag, init, items, overlay, passesPerSecond = OBJECT_PASSES_PER_SECOND }) {
  return {
    draw(m) {
      if (isFirstCall(m, flag)) {
        init(m);
      }
      selectObjects(m, items(m));
      stepObjects(m);
      overlay(m);
      flipPage(m);
    },
    passesPerSecond,
  };
}

function captionOverlay(text, planeOffset) {
  return (m) => {
    clearB2(m);
    drawCaption(m, text, planeOffset);
  };
}

function scrollerOverlay(draw) {
  return (m) => {
    clearB2(m);
    draw(m);
  };
}

function resetScroller(m) {
  m.set32(SCROLLER_POSITION, 0);
}

function avi(first) {
  return (m) => [aviItem(m, first), aviItem(m, first + 1), aviItem(m, first + 2)];
}

function fli(first) {
  return (m) => [fliItem(m, first), fliItem(m, first + 1), fliItem(m, first + 2)];
}

/**
 * 0x54f64 / 0x5543c: the last decoded objects again (0x28623 with the 33 rows 0x1afc4 left), grain added to
 * each component with 0x53815 patched to 133 rows and no +0xc0 (values clamped to 0x3f).
 */
function drawFrozenObjectsWithGrain(m) {
  m.set32(GRAIN_COUNT, FROZEN_GRAIN_COUNT);
  m.set8(GRAIN_ADD, 0);
  for (let k = 0; k < 3; k++) {
    upscale4x(m, m.u32(OBJECT_BUFFERS[k]));
    grain(m, workBuffer(m));
    writeComponentToPlanes(m, k);
  }
}

const SCREAM = 0x5561a;
const BUT_HOW_CAN_YOU_SCREAM = 0x55c54;
const WITH_MASK_ON = 0x55d50;
const TAKE_IT_OFF = 0x55e31;

export const MODEX_EFFECTS = {
  /** 0x54ec3: AVI[14,15,16], the supermarket video, with the (invisible in DOSBox) scroller 0x1bddc. */
  0x54ec3: objectsEffect({
    flag: 0x54e76,
    init(m) {
      resetAnimation(m);
      modeXInit(m);
    },
    items: avi(14),
    overlay: scrollerOverlay(drawScroller),
    passesPerSecond: SUPERMARKET_PASSES_PER_SECOND,
  }),
  /** 0x54f64: the frozen video with growing grain (the level falls in scene 0x54f41). */
  0x54f64: {
    draw(m) {
      if (isFirstCall(m, 0x54f63)) {
        m.set8(GRAIN_LEVEL, FROZEN_START_LEVEL);
      }
      drawFrozenObjectsWithGrain(m);
      flipPage(m);
    },
    passesPerSecond: FROZEN_PASSES_PER_SECOND,
  },
  /** 0x552f4: AVI[19,20,21] with the scroller 0x1be99. */
  0x552f4: objectsEffect({
    flag: 0x552f3,
    init(m) {
      resetAnimation(m);
      modeXInit(m);
      resetScroller(m);
    },
    items: avi(19),
    overlay: scrollerOverlay(drawAloneScroller),
  }),
  /** 0x5539b: AVI[22,23,24], no text and no B2 clear. */
  0x5539b: objectsEffect({
    flag: 0x5539a,
    init(m) {
      resetAnimation(m);
      resetScroller(m);
    },
    items: avi(22),
    overlay() {},
  }),
  /** 0x5543c: the current objects frozen, grain level 0x0c, the scroller 0x1c086. */
  0x5543c: {
    draw(m) {
      if (isFirstCall(m, 0x5543b)) {
        resetScroller(m);
      }
      m.set8(GRAIN_LEVEL, FROZEN_SYSTEM_LEVEL);
      drawFrozenObjectsWithGrain(m);
      clearB2(m);
      drawSystemScroller(m);
      flipPage(m);
    },
    passesPerSecond: FROZEN_SYSTEM_PASSES_PER_SECOND,
  },
  /** 0x55621: FLI[0,1,2] + "SCREAM" at plane offset 0x67a2 (line 331). */
  0x55621: objectsEffect({
    flag: 0x55619,
    init(m) {
      resetAnimation(m);
      modeXInit(m);
      resetScroller(m);
    },
    items: fli(0),
    overlay: captionOverlay(SCREAM, 0x67a2),
  }),
  /** 0x556ee: FLI[3,4,5] + "SCREAM" at 0x2594 (line 120). */
  0x556ee: objectsEffect({
    flag: 0x556ed,
    init: resetAnimation,
    items: fli(3),
    overlay: captionOverlay(SCREAM, 0x2594),
  }),
  /** 0x557ac: FLI[6,7,8] + "SCREAM" at 0xfb4 (line 50, x 80). */
  0x557ac: objectsEffect({
    flag: 0x557ab,
    init: resetAnimation,
    items: fli(6),
    overlay: captionOverlay(SCREAM, 0xfb4),
  }),
  /** 0x55c6d: FLI[12,13,14] + "but how can you / scream ?" at 0xfa2; DAC 0xc0..0xff = grey ramp once. */
  0x55c6d: objectsEffect({
    flag: 0x55c53,
    init(m) {
      resetAnimation(m);
      modeXInit(m);
      m.dacGreyRamp(GREY_RAMP_FIRST);
      resetScroller(m);
    },
    items: fli(12),
    overlay: captionOverlay(BUT_HOW_CAN_YOU_SCREAM, 0xfa2),
  }),
  /** 0x55d69: FLI[15,16,17] + "with mask on / your face ?" at 0x4e20 (line 250). */
  0x55d69: objectsEffect({
    flag: 0x55d4f,
    init(m) {
      resetAnimation(m);
      resetScroller(m);
    },
    items: fli(15),
    overlay: captionOverlay(WITH_MASK_ON, 0x4e20),
  }),
  /** 0x55e3d: FLI[9,10,11] + "take it off" at 0x64a (line 20, x 40). */
  0x55e3d: objectsEffect({
    flag: 0x55e30,
    init(m) {
      resetAnimation(m);
      resetScroller(m);
    },
    items: fli(9),
    overlay: captionOverlay(TAKE_IT_OFF, 0x64a),
  }),
};
