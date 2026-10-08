// The part-1 effects (ticks 1..2683): the red starburst feedback, the names, the three env-mapped objects and
// the captions. Notes: C1 §6, C3, C4.
import {
  workBuffer,
  backBuffer,
  isFirstCall,
  decay,
  feedbackAdd,
  toRamp,
  blit,
  buildStarburstTexture,
  setPaletteFromTexture,
  grainSaturate,
} from '../helpers.js';
import { TEXTURE_POINTER, RIX_PIXELS, OFFSET_X, OFFSET_Y, DISTANCE, GRAIN_LEVEL } from '../addresses.js';
import { aviItem } from '../tables.js';
import { drawText, TEXT_POINTER, TEXT_COLOUR_BASE } from '../text.js';
import { drawSpikyStar, drawPlant, drawSpider } from '../engine3d.js';

/**
 * Passes of the main loop per second, measured in the recording: the rows each captured frame changes, summed
 * over 2 s windows (a pass torn across two captured frames counts once), and for 0x528b2 the pure decay.
 * The rate follows each effect's cost: about one pass per tick for the starburst alone, fewer with an object.
 */
const PASSES_PER_SECOND = {
  starburst: 31,
  starburstWithName: 30,
  spikyStar: 18.5,
  plant: 21,
  spider: 15,
  order: 31,
  noOrder: 23.7,
  underControl: 70,
};

const DIRECT_BLIT_BYTES = 0xf8c0;
const COPY_BYTES = 0x3e30 * 4;
const TEXT_GREY = 0x80;
const FIRST_CALL = {
  starburst: 0x522f4,
  spikyStar: 0x52576,
  plant: 0x52649,
  spider: 0x526ef,
  order: 0x52772,
  noOrder: 0x5282d,
};
const ORDER_TEXT = 0x52773;
const NO_ORDER_TEXT = 0x52823;
const UNDER_CONTROL_TEXT = 0x52897;
/** Text positions: the names at (5, 5), the captions at row 160 x 180, "We are under control.." at row 70 x 70. */
const NAME_POSITION = 0x645;
const CAPTION_POSITION = 0xc8b4;
const UNDER_CONTROL_POSITION = 0x57c6;

/** decay + 0x5224c into `buffer`: the starburst feedback step every part-1 effect makes. */
function feedStarburst(m, buffer) {
  decay(m, buffer);
  feedbackAdd(m, buffer);
}

/** The scene layout of the objects: B2 holds the feedback, W the picture. */
function starburstIntoW(m) {
  feedStarburst(m, backBuffer(m));
  toRamp(m, backBuffer(m), workBuffer(m));
}

function placeObject(m, offsetX, offsetY, distance) {
  m.set32(OFFSET_Y, offsetY);
  m.set32(OFFSET_X, offsetX);
  m.set32(DISTANCE, distance);
}

function caption(m, buffer, textAddress) {
  m.set32(TEXT_POINTER, textAddress);
  drawText(m, buffer);
}

/** 0x52343: the starburst alone; W converted straight to A000 (rows 0..198). */
function starburstAlone(m) {
  if (isFirstCall(m, FIRST_CALL.starburst)) {
    buildStarburstTexture(m);
  }
  feedStarburst(m, workBuffer(m));
  toRamp(m, workBuffer(m), 0, DIRECT_BLIT_BYTES, m.screen);
}

/** 0x52441: the starburst + the name at [0x1baa7] in the grey ramp 0x80.., drawn on B2. */
function starburstWithName(m) {
  feedStarburst(m, workBuffer(m));
  toRamp(m, workBuffer(m), backBuffer(m));
  m.set8(TEXT_COLOUR_BASE, TEXT_GREY);
  drawText(m, backBuffer(m) + NAME_POSITION);
  blit(m, backBuffer(m));
}

/** 0x52577: the starburst + the spiky star; the feedback moves from W to B2 here. */
function starburstWithSpikyStar(m) {
  if (isFirstCall(m, FIRST_CALL.spikyStar)) {
    m.set32(TEXTURE_POINTER, aviItem(m, 9) + RIX_PIXELS);
    setPaletteFromTexture(m);
    placeObject(m, -340, 0, 0x36b0);
    m.mem.copyWithin(backBuffer(m), workBuffer(m), workBuffer(m) + COPY_BYTES);
  }
  starburstIntoW(m);
  drawSpikyStar(m);
  blit(m, workBuffer(m));
}

/** 0x5264a: the starburst + the plant. */
function starburstWithPlant(m) {
  if (isFirstCall(m, FIRST_CALL.plant)) {
    placeObject(m, 200, -20, 0x2580);
  }
  starburstIntoW(m);
  drawPlant(m);
  blit(m, workBuffer(m));
}

/** 0x526f0: the starburst + the spider. */
function starburstWithSpider(m) {
  if (isFirstCall(m, FIRST_CALL.spider)) {
    placeObject(m, -220, -10, 0x1f40);
  }
  starburstIntoW(m);
  drawSpider(m);
  blit(m, workBuffer(m));
}

/** 0x5277b: "order ?"; first call: DAC 0x80..0xbf back to the grey ramp (the RIX palette had them). */
function order(m) {
  if (isFirstCall(m, FIRST_CALL.order)) {
    m.dacGreyRamp(TEXT_GREY);
  }
  starburstIntoW(m);
  caption(m, workBuffer(m) + CAPTION_POSITION, ORDER_TEXT);
  blit(m, workBuffer(m));
}

/** 0x5282e: "NO order!"; the grain is added into the feedback buffer, so it decays with the rays. */
function noOrder(m) {
  if (isFirstCall(m, FIRST_CALL.noOrder)) {
    m.set8(GRAIN_LEVEL, 0x20);
  }
  feedStarburst(m, backBuffer(m));
  grainSaturate(m, backBuffer(m));
  toRamp(m, backBuffer(m), workBuffer(m));
  caption(m, workBuffer(m) + CAPTION_POSITION, NO_ORDER_TEXT);
  blit(m, workBuffer(m));
}

/** 0x528b2: no more rays: the feedback fades out under "We are under / control..". */
function underControl(m) {
  decay(m, backBuffer(m));
  toRamp(m, backBuffer(m), workBuffer(m));
  caption(m, workBuffer(m) + UNDER_CONTROL_POSITION, UNDER_CONTROL_TEXT);
  blit(m, workBuffer(m));
}

function partOne(draw, passesPerSecond) {
  return { draw, passesPerSecond };
}

export const PART1_EFFECTS = {
  0x52343: partOne(starburstAlone, PASSES_PER_SECOND.starburst),
  0x52441: partOne(starburstWithName, PASSES_PER_SECOND.starburstWithName),
  0x52577: partOne(starburstWithSpikyStar, PASSES_PER_SECOND.spikyStar),
  0x5264a: partOne(starburstWithPlant, PASSES_PER_SECOND.plant),
  0x526f0: partOne(starburstWithSpider, PASSES_PER_SECOND.spider),
  0x5277b: partOne(order, PASSES_PER_SECOND.order),
  0x5282e: partOne(noOrder, PASSES_PER_SECOND.noOrder),
  0x528b2: partOne(underControl, PASSES_PER_SECOND.underControl),
};
