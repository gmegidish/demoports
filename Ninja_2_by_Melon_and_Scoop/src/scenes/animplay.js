// The animation player of NINJA2.EXE (file offset 0xD480). An animation is a run of full-screen
// pictures in pGraphics on colours 192..255. Which one is on screen is decided by the timer interrupt.
import { SCREEN_BYTES, startAnim, retrace, show, ResetPalette } from '../machine.js';
import { DepackILBM, ILBM_Palette } from '../ilbm.js';
import { DrawLayerVert } from '../gfx.js';
import { file_offsets } from '../files.js';

const ANIM_COLOURS = 0xc0;
const FOREGROUND_COLOURS = 0x40;

/**
 * @param nNumber      first picture of the animation
 * @param nFrames      pictures in one loop
 * @param nTicks       ticks per picture
 * @param nTotal       picture changes until the animation ends
 * @param pBackground  offset of a packed picture, a raw 320x256 buffer when isPacked is false, or null
 * @param pForeground  offset of a packed picture drawn over the animation on colours 64..127, or null
 * @param startsBlack  cut to black before the first picture
 * @param isPacked     background and foreground are packed pictures and bring their palette
 */
export function* AnimPlay(m, nNumber, nFrames, nTicks, nTotal, pBackground, pForeground, startsBlack, isPacked) {
  const g = m.pGraphics;
  const background = isPacked ? m.pVspace : pBackground;

  function draw(frame) {
    DepackILBM(g, file_offsets[nNumber + frame], m.pLayer1, ANIM_COLOURS);
    if (pBackground !== null) {
      m.screen.set(background.subarray(0, SCREEN_BYTES));
      DrawLayerVert(m, m.pLayer1, 0);
    } else {
      m.screen.set(m.pLayer1.subarray(0, SCREEN_BYTES));
    }
    if (pForeground !== null) {
      DrawLayerVert(m, m.pLayer2, 0);
    }
  }

  startAnim(m, nFrames, nTicks, nTotal);

  if (startsBlack) {
    yield* retrace(m);
    ResetPalette(m);
    m.screen.fill(0);
    yield* show(m);
  }

  if (isPacked && pBackground !== null) {
    DepackILBM(g, pBackground, m.pVspace, 0);
  }
  if (pForeground !== null) {
    DepackILBM(g, pForeground, m.pLayer2, FOREGROUND_COLOURS);
  }
  draw(0);
  if (pBackground === null) {
    // With no background the first picture shown is whatever the previous scene left in pLayer3.
    m.screen.set(m.pLayer3.subarray(0, SCREEN_BYTES));
  }
  yield* show(m);

  if (isPacked && pBackground !== null) {
    ILBM_Palette(m, pBackground, 64, 0, 0);
    if (pForeground !== null) {
      // The foreground's colours are loaded from the background picture. Both carry the same palette.
      ILBM_Palette(m, pBackground, 64, FOREGROUND_COLOURS, 0);
    }
  }
  ILBM_Palette(m, file_offsets[nNumber], 64, ANIM_COLOURS, 0);

  while (!m.aDone) {
    draw(m.aFrame);
    yield* show(m);
  }
}
