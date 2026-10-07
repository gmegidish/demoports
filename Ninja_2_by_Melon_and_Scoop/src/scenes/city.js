// City (0xF070): three layers scroll vertically down the skyline, then the chase animation plays over the final picture.
import { int, SCREEN_BYTES, startAnim, startRamp, startClock, show } from '../machine.js';
import { DepackILBM, ILBM_Palette } from '../ilbm.js';
import { DrawLayerVert } from '../gfx.js';
import { file_offsets, gSEQ3_LAYER1, gSEQ3_LAYER2, gSEQ3_LAYER3, aSEQ3_CHASE } from '../files.js';
import { AnimPlay } from './animplay.js';

const SCENE_END = 482;

export function* City(m) {
  const g = m.pGraphics;
  const pCityLayer1 = file_offsets[gSEQ3_LAYER1];
  const pCityLayer2 = file_offsets[gSEQ3_LAYER2];
  const pCityLayer3 = file_offsets[gSEQ3_LAYER3];
  const [farY, middleY, nearY] = m.ramps;

  function drawLayers() {
    DrawLayerVert(m, m.pVspace, int(farY.val));
    DrawLayerVert(m, m.pLayer1, int(middleY.val));
    DrawLayerVert(m, m.pLayer2, int(nearY.val));
  }

  startRamp(m, 2, 2.6, 344);
  startRamp(m, 1, 3.5, 256);
  startRamp(m, 0, 9.5, 94);
  startClock(m, 2);
  // The fade-in is a 64-step animation, two ticks a step.
  startAnim(m, 64, 2, 64);

  DepackILBM(g, pCityLayer1, m.pLayer2, 0);
  DepackILBM(g, pCityLayer2, m.pLayer1, 64);
  DepackILBM(g, pCityLayer3, m.pVspace, 128);

  while (m.clock < SCENE_END) {
    if (!m.aDone) {
      const fade = m.aFrame - 64;
      ILBM_Palette(m, pCityLayer1, 64, 0, fade);
      ILBM_Palette(m, pCityLayer2, 64, 64, fade);
      ILBM_Palette(m, pCityLayer3, 64, 128, fade);
    }
    drawLayers();
    yield* show(m);
  }

  drawLayers();
  m.pLayer3.set(m.screen.subarray(0, SCREEN_BYTES));
  yield* AnimPlay(m, aSEQ3_CHASE, 45, 7, 45, m.pLayer3, null, false, false);
}
