// The two mutant scenes.
import { f32, int, startAnim, startClock, ticksElapsed, show, cutToBlack, SetCol } from '../machine.js';
import { DepackILBM, ILBM_Palette, ILBM_GetXSize } from '../ilbm.js';
import { CopyLayerVert, DrawLayerVert, DrawLayerHor } from '../gfx.js';
import { file_offsets, aANGRY, gANGRY, gSEQ21_HEAD, aSEQ21_GUSH } from '../files.js';

/** Which of the 9 pictures to show at each step of the surprise. */
const anFrames = [0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 4, 5, 6, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8];

/** MutantSurprise (0xF820): 23 steps, six ticks each. */
export function* MutantSurprise(m) {
  const g = m.pGraphics;

  startAnim(m, 23, 6, 23);
  yield* cutToBlack(m);

  DepackILBM(g, file_offsets[gANGRY], m.pVspace, 0);
  ILBM_Palette(m, file_offsets[aANGRY], 64, 64, 0);
  ILBM_Palette(m, file_offsets[gANGRY], 64, 0, 0);

  while (!m.aDone) {
    CopyLayerVert(m, m.pVspace, 0);
    DepackILBM(g, file_offsets[aANGRY + anFrames[m.aFrame]], m.pLayer1, 64);
    DrawLayerVert(m, m.pLayer1, 0);
    yield* show(m);
  }
}

const HEAD_ROW = 140;
const HEAD_SCENE_END = 80;

/** MutantHead (0x10450): the severed head drifts diagonally across a looping gush animation. */
export function* MutantHead(m) {
  const g = m.pGraphics;
  const pHead = file_offsets[gSEQ21_HEAD];
  const nXSize = ILBM_GetXSize(g, pHead);

  startClock(m, 3);
  yield* cutToBlack(m);

  m.pVspace.fill(0, 0, 200000);
  DepackILBM(g, pHead, m.pVspace, 0, nXSize * HEAD_ROW);
  // Head and gush share the gush palette. Colour 0, the backdrop, is set by hand to dark blue.
  ILBM_Palette(m, file_offsets[aSEQ21_GUSH], 64, 0, 0);
  SetCol(m, 0, 0, 0, 8);

  let nXpos = 40;
  let nYpos = 100;
  let nFrameNumber = 0;

  ticksElapsed(m);

  while (m.clock < HEAD_SCENE_END) {
    DepackILBM(g, file_offsets[aSEQ21_GUSH + int(nFrameNumber)], m.screen, 0);
    DrawLayerHor(m, m.pVspace, int(nYpos) * nXSize + int(nXpos), nXSize, 0);
    ticksElapsed(m);
    yield* show(m);

    const elapsed = ticksElapsed(m);
    nXpos = f32(nXpos + elapsed * f32(1 / 3));
    nYpos = f32(nYpos - elapsed * f32(1 / 3));
    nFrameNumber = f32(nFrameNumber + elapsed * f32(1 / 9));
    if (nFrameNumber >= 4) {
      nFrameNumber = 0;
    }
  }
}
