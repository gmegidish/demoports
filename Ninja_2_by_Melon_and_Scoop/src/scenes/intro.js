// Intro (0xE350): three parallax layers scroll sideways past the standing ninja, with two lightning flashes.
import { f32, int, startRamp, startClock, ticksElapsed, show } from '../machine.js';
import { DepackILBM, ILBM_Palette, ILBM_GetXSize } from '../ilbm.js';
import { CopyLayerHor, DrawLayerHor, Sprite_Draw } from '../gfx.js';
import { file_offsets, gSEQ1_LAYER1, gSEQ1_LAYER2, gSEQ1_LAYER3, aSEQ1_NINJA } from '../files.js';

/** Brightness added to the palette, step by step, during a lightning flash. Zero padded to 35 like the C array. */
export const aFadeDown = Uint8Array.from({ length: 35 }, (_, i) => [0, 0, 0, 5, 14, 44, 44, 14, 5, 2, 5, 14, 44, 44, 14, 10, 5, 2, 1][i] ?? 0);

const SCENE_END = 480;

export function* Intro(m) {
  const g = m.pGraphics;
  const pIntroLayer1 = file_offsets[gSEQ1_LAYER1];
  const pIntroLayer2 = file_offsets[gSEQ1_LAYER2];
  const pIntroLayer3 = file_offsets[gSEQ1_LAYER3];
  // The ninja palette is loaded from file 9 inside the loop, not from aSEQ1_NINJA.
  const pNinjaPalette = file_offsets[9];
  const [layer1X, layer2X, layer3X] = m.ramps;

  const nLayer1XSize = ILBM_GetXSize(g, pIntroLayer1);
  const nLayer2XSize = ILBM_GetXSize(g, pIntroLayer2);
  const nLayer3XSize = ILBM_GetXSize(g, pIntroLayer3);
  const scrollEnd = nLayer3XSize - 355;

  startRamp(m, 0, 4.5, int(scrollEnd * 0.266667));
  startRamp(m, 1, 3.5, int(scrollEnd * 0.342857));
  startRamp(m, 2, 1.2, scrollEnd);
  startClock(m, 3.4);

  ILBM_Palette(m, pIntroLayer1, 64, 0, -64);
  ILBM_Palette(m, pIntroLayer2, 64, 64, -64);
  ILBM_Palette(m, pIntroLayer3, 64, 128, -64);
  ILBM_Palette(m, file_offsets[aSEQ1_NINJA], 64, 192, -64);

  DepackILBM(g, pIntroLayer1, m.pVspace, 0);
  DepackILBM(g, pIntroLayer2, m.pLayer1, 64);
  DepackILBM(g, pIntroLayer3, m.pLayer2, 128);

  /** Every colour bank takes its colours from layer 3. That is what the original does. */
  function setPalettes(fade0, fade64, fade128, fade192) {
    ILBM_Palette(m, pIntroLayer3, 64, 0, fade0);
    ILBM_Palette(m, pIntroLayer3, 64, 64, fade64);
    ILBM_Palette(m, pIntroLayer3, 64, 128, fade128);
    ILBM_Palette(m, pNinjaPalette, 64, 192, fade192);
  }

  let nFadePos = -64;
  let nFrameNumber = 0;

  function lightning(elapsed) {
    if (nFadePos <= 25) {
      const i = int(nFadePos);
      setPalettes(aFadeDown[i], aFadeDown[i + 1] >> 1, aFadeDown[i + 2] >> 2, aFadeDown[i + 2] >> 2);
    }
    nFadePos = f32(nFadePos + elapsed * f32(1 / 3));
  }

  ticksElapsed(m);

  while (m.clock < SCENE_END) {
    const elapsed = ticksElapsed(m);
    const clock = m.clock;

    if (clock <= 120) {
      if (nFadePos <= 0) {
        setPalettes(int(nFadePos), int(nFadePos), int(nFadePos), -int(nFadePos));
      }
      nFadePos = f32(nFadePos + elapsed * 0.25);
    }
    if (clock >= 150 && clock <= 180) {
      nFadePos = 0;
    }
    /* Lightning 1 */
    if (clock >= 180 && clock <= 210) {
      lightning(elapsed);
    }
    if (clock >= 250 && clock <= 340) {
      nFadePos = 0;
    }
    /* Lightning 2 */
    if (clock >= 365 && clock <= 400) {
      lightning(elapsed);
    }
    if (clock >= 400 && clock <= 410) {
      nFadePos = 0;
    }
    if (clock >= 420 && clock <= 455) {
      if (nFadePos <= 64) {
        setPalettes(-int(nFadePos), -int(nFadePos), -int(nFadePos), -int(nFadePos));
      }
      nFadePos = f32(nFadePos + elapsed);
    }

    CopyLayerHor(m, m.pVspace, int(layer1X.val), nLayer1XSize);
    DrawLayerHor(m, m.pLayer1, int(layer2X.val), nLayer2XSize, 0);
    DrawLayerHor(m, m.pLayer2, int(layer3X.val), nLayer3XSize, 56);

    DepackILBM(g, file_offsets[aSEQ1_NINJA + int(nFrameNumber)], m.pLayer3, 192);
    Sprite_Draw(m, m.pLayer3, 1080 - int(layer3X.val), 0);

    nFrameNumber = f32(nFrameNumber + elapsed * f32(0.2));
    if (nFrameNumber >= 15) {
      nFrameNumber = 0;
    }

    yield* show(m);

    // Once the far layer has stopped it drifts back.
    if (!layer1X.on) {
      layer1X.val = f32(layer1X.val - elapsed * 0.222222);
    }
  }
}
