// The ninja scenes: climbing, jumping, flying, landing, attacking, walking off into the fog.
import {
  f32, int, SCREEN_BYTES, startAnim, stopAnim, startRamp, startClock, ticksElapsed,
  retrace, show, cutToBlack, ResetPalette,
} from '../machine.js';
import { DepackILBM, ILBM_Palette, ILBM_GetXSize } from '../ilbm.js';
import { CopyLayerVert, DrawLayerVert, DrawFog, Sprite_Draw } from '../gfx.js';
import {
  file_offsets, gSEQ7_BACK, gSEQ7_NINJA, aSEQ7_HEAD, aSEQ7_BODY,
  gSEQ9_LAYER1, gSEQ9_LAYER2, gSEQ9_FOG, aSEQ9_NINJA,
  gSEQ11_MBLURR, gSEQ11_MEND, gSEQ11_CLOUDS, aSEQ11_NINJA, aSEQ12_NINJA,
  gSEQ18_ATTACK, gSEQ22_LAYER1, aSEQ22_NINJA,
} from '../files.js';
import { aFadeDown } from './intro.js';

const ROW = 320;

/** NinjaScrollUp (0xF300): the camera climbs a tall building; head and body are looping sprites pinned to the wall. */
export function* NinjaScrollUp(m) {
  const g = m.pGraphics;
  const pBack = file_offsets[gSEQ7_BACK];
  const pNinja = file_offsets[gSEQ7_NINJA];
  let nFadePos = 0;
  let nHeadAnim = 0;
  let nBodyAnim = 0;
  let isScrolling = true;

  startClock(m, 4);
  yield* cutToBlack(m);

  ILBM_Palette(m, pBack, 64, 0, 0);
  DepackILBM(g, pBack, m.pVspace, 0);
  ILBM_Palette(m, pNinja, 64, 64, 0);
  DepackILBM(g, pNinja, m.pLayer1, 64);

  let nBackY = 544;
  let nNinjaY = 544;

  ticksElapsed(m);

  while (m.clock < 167) {
    const elapsed = ticksElapsed(m);

    if (m.clock >= 135 && m.clock <= 162) {
      if (nFadePos <= 25) {
        ILBM_Palette(m, pBack, 64, 0, aFadeDown[int(nFadePos)]);
        ILBM_Palette(m, pNinja, 64, 64, aFadeDown[int(nFadePos)] >> 2);
      }
      nFadePos = f32(nFadePos + elapsed * 0.434783);
    }

    CopyLayerVert(m, m.pVspace, int(nBackY));
    DrawLayerVert(m, m.pLayer1, int(nNinjaY));

    DepackILBM(g, file_offsets[aSEQ7_HEAD + int(nHeadAnim)], m.pLayer3, 64);
    Sprite_Draw(m, m.pLayer3, 0, int(-nNinjaY));

    DepackILBM(g, file_offsets[aSEQ7_BODY + int(nBodyAnim)], m.pLayer2, 64);
    Sprite_Draw(m, m.pLayer2, 67, int(189 - nNinjaY));

    yield* show(m);

    nHeadAnim = f32(nHeadAnim + elapsed * 0.25);
    if (nHeadAnim >= 8) {
      nHeadAnim = 0;
    }
    nBodyAnim = f32(nBodyAnim + elapsed * 0.25);
    if (nBodyAnim >= 6) {
      nBodyAnim = 0;
    }

    if (isScrolling) {
      const step = elapsed * 0.833333;
      nNinjaY = f32(nNinjaY - step);
      if (nNinjaY >= 350) {
        nBackY = f32(nBackY - step);
      }
      if (nNinjaY <= 350 && nNinjaY >= 300) {
        nBackY = f32(nBackY - elapsed * 0.555556);
      }
      if (nNinjaY <= 300) {
        nBackY = f32(nBackY - elapsed * 0.454545);
      }
      if (nBackY <= 0) {
        nBackY = 0;
      }
      if (nNinjaY <= 60) {
        nNinjaY = 60;
        isScrolling = false;
      }
    }
  }
}

/** NinjaJumpUp (0xF950): rooftop with drifting fog. Four frames twice, then fourteen more. */
export function* NinjaJumpUp(m) {
  const g = m.pGraphics;
  const nFogXSize = ILBM_GetXSize(g, file_offsets[gSEQ9_FOG]);
  const fogX = m.ramps[0];
  let firstFrame = 0;
  let isCrouching = true;

  startAnim(m, 4, 5, 8);
  startClock(m, 5);
  startRamp(m, 0, 4, nFogXSize);
  yield* cutToBlack(m);

  DepackILBM(g, file_offsets[gSEQ9_LAYER1], m.pVspace, 0);
  DepackILBM(g, file_offsets[gSEQ9_FOG], m.pLayer1, 0);
  DepackILBM(g, file_offsets[gSEQ9_LAYER2], m.pLayer2, 64);
  ILBM_Palette(m, file_offsets[gSEQ9_LAYER1], 64, 0, 0);
  ILBM_Palette(m, file_offsets[gSEQ9_LAYER2], 64, 64, 0);
  ILBM_Palette(m, file_offsets[aSEQ9_NINJA], 64, 128, 0);

  while (m.clock < 18) {
    CopyLayerVert(m, m.pVspace, 0);
    DrawFog(m, m.pLayer1, int(fogX.val), nFogXSize, 0);
    DrawLayerVert(m, m.pLayer2, 0);
    DepackILBM(g, file_offsets[aSEQ9_NINJA + m.aFrame + firstFrame], m.pLayer3, 128);
    DrawLayerVert(m, m.pLayer3, 0);
    yield* show(m);

    if (isCrouching && m.aDone) {
      startAnim(m, 14, 4, 14);
      firstFrame = 4;
      isCrouching = false;
    }
  }
  stopAnim(m);
}

const SPEED_LINE_PASSES = 20;
/** Rows per tick the speed lines move on passes 0..3. The switch falls through, so pass 0 gets all of them. */
const SPEED_LINE_STEPS = [2.8, 5.9, 10, 12.8];

/** NinjaInAir (0xFBA0): speed lines race past 20 times, then scroll away to reveal clouds and the ninja falls out of frame. */
export function* NinjaInAir(m) {
  const g = m.pGraphics;
  let nPass = 0;
  let nLoops = 0;
  let isMBlurr = true;

  startAnim(m, 100, 7, 100);
  startRamp(m, 0, 1, 1000);
  startClock(m, 1);
  ticksElapsed(m);
  yield* cutToBlack(m);

  m.pVspace.fill(0, 0, 0x50000);
  m.pLayer2.fill(0, 0, 0x50000);

  DepackILBM(g, file_offsets[gSEQ11_MBLURR], m.pVspace, 0, ROW * 512);
  DepackILBM(g, file_offsets[gSEQ11_MEND], m.pLayer1, 0);
  ILBM_Palette(m, file_offsets[gSEQ11_MBLURR], 64, 0, 0);

  m.pVspace.copyWithin(ROW * 768, ROW * 512, ROW * 512 + SCREEN_BYTES);
  m.pVspace.set(m.pLayer1.subarray(0, ROW * 189), ROW * 323);

  DepackILBM(g, file_offsets[gSEQ11_CLOUDS], m.pLayer1, 64);
  ILBM_Palette(m, file_offsets[gSEQ11_CLOUDS], 64, 64, 0);
  ILBM_Palette(m, file_offsets[aSEQ11_NINJA], 64, 128, 0);

  let nLinesY = 768;
  let nCloudsY = 64;
  // Never initialised in the executable. Zero puts the ninja where the capture shows him.
  let nNinjaY = 0;

  while (m.clock < 540) {
    const elapsed = ticksElapsed(m);

    DepackILBM(g, file_offsets[aSEQ11_NINJA + m.aFrame], m.pLayer2, 128, ROW * 60);

    if (nLoops <= 10 && m.aFrame >= 3) {
      nLoops++;
      m.aFrame = 0;
    }
    if (nLoops <= 20 && m.aFrame >= 29) {
      m.aFrame = 24;
      nLoops++;
    }

    CopyLayerVert(m, m.pLayer1, int(nCloudsY));
    if (isMBlurr) {
      DrawLayerVert(m, m.pVspace, int(nLinesY));
    }
    DrawLayerVert(m, m.pLayer2, int(nNinjaY));

    if (nPass >= SPEED_LINE_PASSES) {
      nCloudsY = f32(nCloudsY - elapsed * 0.222222);
    }
    if (nLoops >= 13) {
      nNinjaY = f32(nNinjaY - elapsed * 0.5);
    }

    if (isMBlurr) {
      if (nPass === SPEED_LINE_PASSES) {
        nLinesY = 256;
      }
      if (nPass >= SPEED_LINE_PASSES) {
        nLinesY = f32(nLinesY - elapsed * 20);
        if (nLinesY <= 80) {
          isMBlurr = false;
        }
      }
      if (nPass <= 4) {
        nNinjaY = f32(nNinjaY + elapsed);
      }
      if (nPass <= SPEED_LINE_PASSES) {
        for (const rows of SPEED_LINE_STEPS.slice(Math.min(nPass, 4))) {
          nLinesY = f32(nLinesY - elapsed * rows);
        }
        nLinesY = f32(nLinesY - elapsed * 16);
        if (nLinesY <= 512) {
          nLinesY = 768;
          nPass++;
        }
      }
    }

    // ShowScreen(0): the original does not wait for the retrace here and spins until the next tick.
    yield* show(m);
  }
  stopAnim(m);
}

const YPOS = ROW * 20;

/** Byte offsets added to the layer pointers to shake the screen when the ninja lands. */
const aYshake = [0, -10, 10, -7, 7, -5, 5, -3, 3, -2, 2, -1, 1, 0].map((rows) => rows * ROW);

/** NinjaFallDown (0xFF50): the ninja drops into the rooftop scene, the screen shakes, he gets up. */
export function* NinjaFallDown(m) {
  const g = m.pGraphics;
  const nFogXSize = ILBM_GetXSize(g, file_offsets[gSEQ9_FOG]);
  let firstFrame = 0;
  let isShaking = true;
  let hasStarted = false;
  let nShake = 0;
  let nFogX = 40;

  startClock(m, 2.2);
  ticksElapsed(m);
  yield* cutToBlack(m);

  m.pVspace.fill(0, 0, ROW * 286);
  m.pLayer1.fill(0, 0, ROW * 286);
  m.pLayer2.fill(0, 0, ROW * 286);
  m.pLayer3.fill(0, 0, ROW * 286);

  DepackILBM(g, file_offsets[gSEQ9_LAYER1], m.pVspace, 0, YPOS);
  ILBM_Palette(m, file_offsets[gSEQ9_LAYER1], 64, 0, 0);
  DepackILBM(g, file_offsets[gSEQ9_FOG], m.pLayer1, 0);
  DepackILBM(g, file_offsets[gSEQ9_LAYER2], m.pLayer2, 64, YPOS);
  ILBM_Palette(m, file_offsets[gSEQ9_LAYER2], 64, 64, 0);
  ILBM_Palette(m, file_offsets[aSEQ12_NINJA], 64, 128, 0);

  // No animation is running yet: the picture holds on frame 0 until the scene clock reaches 90.
  m.aFrame = 0;

  while (m.clock < 250) {
    const elapsed = ticksElapsed(m);
    const shake = aYshake[int(nShake)] + YPOS;

    CopyLayerVert(m, m.pVspace, 0, shake);
    DrawFog(m, m.pLayer1, int(nFogX), nFogXSize, 0);
    DrawLayerVert(m, m.pLayer2, 0, shake);
    DepackILBM(g, file_offsets[aSEQ12_NINJA + m.aFrame + firstFrame], m.pLayer3, 128, YPOS);
    DrawLayerVert(m, m.pLayer3, 0, shake);
    yield* show(m);

    nFogX = f32(nFogX + elapsed * 0.25);

    if (!hasStarted && m.clock >= 90) {
      hasStarted = true;
      startAnim(m, 100, 5, 100);
    }

    if (isShaking && m.aFrame >= 11) {
      nShake = f32(nShake + elapsed * f32(1 / 3));
      if (nShake >= 14) {
        isShaking = false;
        nShake = 0;
      }
    }

    if (hasStarted && m.aFrame >= 31) {
      firstFrame = 31;
      startAnim(m, 4, 5, 50);
    }
  }

  yield* retrace(m);
  ResetPalette(m);
  stopAnim(m);
}

/** NinjaAttack (0x102E0): speed lines loop behind the attacking ninja, who slides up the screen. */
export function* NinjaAttack(m) {
  const g = m.pGraphics;
  const ninjaY = m.ramps[1];

  startRamp(m, 1, 1.6, 38);
  yield* cutToBlack(m);

  DepackILBM(g, file_offsets[gSEQ11_MBLURR], m.pVspace, 0);
  DepackILBM(g, file_offsets[gSEQ18_ATTACK], m.pLayer1, 64);
  m.pVspace.copyWithin(SCREEN_BYTES, 0, SCREEN_BYTES);
  ILBM_Palette(m, file_offsets[gSEQ11_MBLURR], 64, 0, 0);
  ILBM_Palette(m, file_offsets[gSEQ18_ATTACK], 64, 64, 0);

  let nLinesY = 256;

  ticksElapsed(m);

  while (ninjaY.on) {
    const elapsed = ticksElapsed(m);

    CopyLayerVert(m, m.pVspace, int(nLinesY));
    DrawLayerVert(m, m.pLayer1, int(ninjaY.val));

    nLinesY = f32(nLinesY - elapsed * 20);
    if (nLinesY <= 0) {
      nLinesY = 256;
    }
    yield* show(m);
  }
}

/** NinjaIntoFog (0x10640): the ninja stands in the fog, turns, walks off, and the picture fades out. */
export function* NinjaIntoFog(m) {
  const g = m.pGraphics;
  const nFogXSize = ILBM_GetXSize(g, file_offsets[gSEQ9_FOG]);
  const fogX = m.ramps[2];
  let nFade = 0;
  let nFrameNumber = 0;
  let isAnimating = false;
  let isGone = false;

  startRamp(m, 2, 4, nFogXSize);
  yield* cutToBlack(m);

  DepackILBM(g, file_offsets[gSEQ9_LAYER1], m.pVspace, 0);
  DepackILBM(g, file_offsets[gSEQ9_FOG], m.pLayer1, 0);
  DepackILBM(g, file_offsets[gSEQ22_LAYER1], m.pLayer2, 64);
  DepackILBM(g, file_offsets[aSEQ22_NINJA], m.pLayer3, 128);
  ILBM_Palette(m, file_offsets[gSEQ9_LAYER1], 64, 0, 0);
  ILBM_Palette(m, file_offsets[gSEQ22_LAYER1], 64, 64, 0);
  ILBM_Palette(m, file_offsets[aSEQ22_NINJA], 64, 128, 0);

  ticksElapsed(m);

  while (true) {
    const elapsed = ticksElapsed(m);

    CopyLayerVert(m, m.pVspace, 0);
    DrawFog(m, m.pLayer1, int(fogX.val), nFogXSize, 0);
    DrawLayerVert(m, m.pLayer2, 0);

    if (isAnimating) {
      DepackILBM(g, file_offsets[aSEQ22_NINJA + int(nFrameNumber)], m.pLayer3, 128);
    }
    if (!isGone) {
      DrawLayerVert(m, m.pLayer3, 0);
    }

    if (fogX.val >= 160) {
      ILBM_Palette(m, file_offsets[gSEQ9_LAYER1], 64, 0, -int(nFade));
      ILBM_Palette(m, file_offsets[gSEQ22_LAYER1], 64, 64, -int(nFade));
      ILBM_Palette(m, file_offsets[aSEQ22_NINJA], 64, 128, -int(nFade));
      nFade = f32(nFade + elapsed * 0.294118);
      if (nFade >= 64) {
        break;
      }
    }

    yield* show(m);

    if (fogX.val >= 100 && fogX.val <= 145 && !isGone) {
      isAnimating = true;
    }
    if (isAnimating) {
      nFrameNumber = f32(nFrameNumber + elapsed * 0.117647);
    }
    if (nFrameNumber >= 27) {
      isGone = true;
      isAnimating = false;
    }
  }

  yield* retrace(m);
  ResetPalette(m);
}
