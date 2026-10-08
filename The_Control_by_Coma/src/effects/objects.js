// The part-2 effects that only draw the 3D gear in mode 13h: 0x55be8, 0x55b6c, 0x55f1e. Notes: C1 §8, C6.
import { workBuffer, blit, clearW, isFirstCall } from '../helpers.js';
import { TEXTURE_POINTER, RIX_PIXELS, PALETTE_PULSE_OFF } from '../addresses.js';
import { fliItem } from '../tables.js';
import { drawGear, drawPulsingGear } from '../engine3d.js';

/**
 * Passes per second while the gear is drawn. The picture is redrawn from scratch every pass (nothing
 * accumulates), so only the sampling of the tick-driven rotation depends on it; the recording changes
 * 42..52 times a second in these scenes.
 */
const GEAR_PASSES_PER_SECOND = 45;

/** 0x5586c: the gear's DAC, 16 shade blocks of 16 colours. */
const GEAR_PALETTE = 0x5586c;
const FULL_PALETTE_BYTES = 0x300;
const GEAR_TEXTURE_ITEM = 18;
/** [0x1b7ff] = 0x8d: any non-zero value stops the part-2 palette pulse. */
const PULSE_STOPPED = 0x8d;
const FIRST_CALL = { gear: 0x55be7, gearAfterModeX: 0x5586b, pulsingGear: 0x55f1d };

/** The gear's palette and texture (DEMO.FLI item 18, a RIX; only its pixels are used). */
function loadGearLook(m) {
  m.dacLoad(0, GEAR_PALETTE, FULL_PALETTE_BYTES);
  m.set32(TEXTURE_POINTER, fliItem(m, GEAR_TEXTURE_ITEM) + RIX_PIXELS);
}

/** 0x55be8: gear #1 (mode 13h is already set at tick 2457). */
function gear(m) {
  if (isFirstCall(m, FIRST_CALL.gear)) {
    loadGearLook(m);
    m.set8(PALETTE_PULSE_OFF, 1);
  }
  clearW(m);
  drawGear(m);
  blit(m, workBuffer(m));
}

/** 0x55b6c: gear #2, after mode X: int 10h ax=13h first. */
function gearAfterModeX(m) {
  if (isFirstCall(m, FIRST_CALL.gearAfterModeX)) {
    m.setMode13();
    loadGearLook(m);
    m.set8(PALETTE_PULSE_OFF, 1);
  }
  clearW(m);
  drawGear(m);
  blit(m, workBuffer(m));
}

/** 0x55f1e: the breathing gear; its flag is re-armed by the scene 0x55f77, so the second run sets the mode again. */
function pulsingGear(m) {
  if (isFirstCall(m, FIRST_CALL.pulsingGear)) {
    m.setMode13();
    loadGearLook(m);
  }
  m.set8(PALETTE_PULSE_OFF, PULSE_STOPPED);
  clearW(m);
  drawPulsingGear(m);
  blit(m, workBuffer(m));
}

function gearEffect(draw) {
  return { draw, passesPerSecond: GEAR_PASSES_PER_SECOND };
}

export const OBJECT_EFFECTS = {
  0x55be8: gearEffect(gear),
  0x55b6c: gearEffect(gearAfterModeX),
  0x55f1e: gearEffect(pulsingGear),
};
