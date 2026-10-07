// Logo (0xEBE0): the NINJA 2 logo zooms in from far too large, with motion blur, then shrinks away while fading.
import { f32, int, SCREEN_BYTES, startClock, ticksElapsed, show, cutToBlack } from '../machine.js';
import { DepackILBM, ILBM_Palette } from '../ilbm.js';
import { BitmapZoom, MotionBlurr } from '../gfx.js';
import { file_offsets, gSEQ2_LOGO, aSEQ2_LOGO } from '../files.js';

const ZOOM = 8000;
const SCENE_END = 11;
const CLEAR_BYTES = 0x1f400;
const LOGO_ANIM_COLOURS = 20;

export function* Logo(m) {
  const g = m.pGraphics;
  const pLogo = file_offsets[gSEQ2_LOGO];

  startClock(m, 30);
  yield* cutToBlack(m);

  m.pVspace.fill(0, 0, CLEAR_BYTES);
  m.pLayer1.fill(0, 0, CLEAR_BYTES);
  m.pLayer2.fill(0, 0, CLEAR_BYTES);

  DepackILBM(g, pLogo, m.pVspace, 0);
  ILBM_Palette(m, pLogo, 64, 0, 0);

  let nXzoom = ZOOM;
  let nYzoom = ZOOM;
  let isAnimating = false;
  let vFrameNumber = 0;
  let vFadeValue = 0;

  function shrink(amount) {
    nXzoom = f32(nXzoom - amount);
    nYzoom = f32(nYzoom - amount);
  }

  ticksElapsed(m);

  while (m.clock < SCENE_END) {
    const elapsed = ticksElapsed(m);

    if (nXzoom <= 120) {
      ILBM_Palette(m, pLogo, 64, 0, -int(vFadeValue));
      vFadeValue = f32(vFadeValue + elapsed * f32(1 / 3));
    }

    m.screen.fill(0);

    const sZoom = { nScaleX: int(nXzoom), nScaleY: int(nYzoom) };
    if (nXzoom >= 320) {
      sZoom.nXpos = (int(nXzoom) - 320) >> 1;
      sZoom.nSXpos = 0;
    } else {
      sZoom.nXpos = 0;
      sZoom.nSXpos = 160 - (int(nXzoom) >> 1);
    }
    if (nYzoom >= 256) {
      sZoom.nYpos = (int(nYzoom) - 256) >> 1;
      sZoom.nSYpos = 0;
    } else {
      sZoom.nYpos = 0;
      sZoom.nSYpos = 128 - (int(nYzoom) >> 1);
    }

    BitmapZoom(m, m.pLayer2, sZoom);
    BitmapZoom(m, m.pVspace, sZoom);

    if (nXzoom >= 2560) {
      shrink(elapsed * 100);
    }
    if (nXzoom >= 1280 && nXzoom <= 2559) {
      shrink(elapsed * 90);
    }
    if (nXzoom <= 1279 && nXzoom >= 320) {
      shrink(elapsed * 75);
    }
    if (nXzoom <= 600) {
      isAnimating = true;
    }
    if (nXzoom <= 319) {
      shrink(elapsed);
    }

    if (isAnimating) {
      DepackILBM(g, file_offsets[aSEQ2_LOGO + int(vFrameNumber)], m.pLayer2, LOGO_ANIM_COLOURS);
      vFrameNumber = f32(vFrameNumber + elapsed * f32(1 / 6));
      if (vFrameNumber >= 8) {
        DepackILBM(g, file_offsets[aSEQ2_LOGO + 7], m.pLayer2, LOGO_ANIM_COLOURS);
        vFrameNumber = 7;
        isAnimating = false;
      }
    }

    MotionBlurr(m, m.pLayer1);
    m.pLayer1.set(m.screen.subarray(0, SCREEN_BYTES));
    yield* show(m);
  }
}
