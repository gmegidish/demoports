// main() of NINJA2.EXE (file offset 0xD860): the order of everything, plus the runner that turns
// the generator into a clock-driven demo.
import { createMachine, SCREEN_BYTES, startAnim, retrace, retraces, show, waitTicks, ResetPalette } from './machine.js';
import { DepackILBM, ILBM_Palette } from './ilbm.js';
import { DrawLayerVert } from './gfx.js';
import {
  file_offsets, gMELONSCOOP, g2035, aSEQ4_CHASE, gSEQ4_LAYER1, gSEQ4_LAYER2, aSEQ5_MKID, gSEQ5_BACK,
  aSEQ6_LEGS, gSEQ6_BACK, aSEQ8, gSEQ8_BACK, aSEQ13, gSEQ13_BACK, aSEQ14, aSEQ15, aSEQ16, aSEQ17,
  aSEQ19, gSEQ20_STAND, aSEQ21_LAUGH, aSEQ21_CUT,
} from './files.js';
import { AnimPlay } from './scenes/animplay.js';
import { Intro } from './scenes/intro.js';
import { Logo } from './scenes/logo.js';
import { City } from './scenes/city.js';
import { MutantSurprise, MutantHead } from './scenes/mutant.js';
import { NinjaScrollUp, NinjaJumpUp, NinjaInAir, NinjaFallDown, NinjaAttack, NinjaIntoFog } from './scenes/ninja.js';
import { Credits } from './scenes/credits.js';

/**
 * The music is heard this long after PlayModule() in the reference capture: the sound card's mixing buffer.
 * Zero would be a card with no buffer.
 */
const MUSIC_LATENCY_MS = 720;
const FADE_STEPS = 65;

/** One of the two silent pictures before the music: fade up over 130 retraces, hold, fade back down. */
function* openingLogo(m, picture, holdRetraces) {
  DepackILBM(m.pGraphics, picture, m.screen, 0);
  ILBM_Palette(m, picture, 64, 0, -64);
  yield* show(m);

  for (let fade = -64; fade < -64 + FADE_STEPS; fade++) {
    yield* retraces(m, 2);
    ILBM_Palette(m, picture, 64, 0, fade);
  }
  yield* retraces(m, holdRetraces);
  for (let fade = 0; fade > -FADE_STEPS; fade--) {
    yield* retraces(m, 2);
    ILBM_Palette(m, picture, 64, 0, fade);
  }
}

export function* demo(m) {
  const g = m.pGraphics;
  const at = (index) => file_offsets[index];

  yield* retrace(m);
  ResetPalette(m);
  m.screen.fill(0);
  yield* show(m);
  yield* openingLogo(m, at(gMELONSCOOP), 140);
  yield* retraces(m, 210);
  yield* openingLogo(m, at(g2035), 70);

  // PlayModule()
  m.gTick = 0;
  m.musicStartMs = m.time + MUSIC_LATENCY_MS;

  yield* Intro(m);
  yield* Logo(m);
  yield* City(m);

  yield* AnimPlay(m, aSEQ4_CHASE, 28, 6, 28, at(gSEQ4_LAYER1), at(gSEQ4_LAYER2), true, true);
  yield* AnimPlay(m, aSEQ5_MKID, 6, 5, 47, at(gSEQ5_BACK), null, true, true);
  yield* AnimPlay(m, aSEQ6_LEGS, 16, 8, 16, at(gSEQ6_BACK), null, true, true);
  yield* waitTicks(m, 20);

  yield* NinjaScrollUp(m);
  yield* MutantSurprise(m);

  yield* AnimPlay(m, aSEQ8, 4, 8, 12, at(gSEQ8_BACK), null, true, true);

  yield* NinjaJumpUp(m);
  yield* NinjaInAir(m);
  yield* NinjaFallDown(m);

  yield* AnimPlay(m, aSEQ13, 4, 11, 4, at(gSEQ13_BACK), null, true, true);
  yield* AnimPlay(m, aSEQ13 + 2, 2, 8, 8, at(gSEQ13_BACK), null, false, true);
  yield* AnimPlay(m, aSEQ14, 6, 5, 25, null, null, true, true);
  yield* AnimPlay(m, aSEQ15, 2, 5, 20, null, null, true, true);
  yield* AnimPlay(m, aSEQ16, 6, 5, 26, null, null, true, true);
  yield* AnimPlay(m, aSEQ17, 2, 5, 20, null, null, true, true);

  yield* NinjaAttack(m);

  yield* AnimPlay(m, aSEQ19, 17, 3, 17, null, null, true, true);

  // Flash to white over 22 ticks...
  startAnim(m, 22, 1, 22);
  yield* retrace(m);
  ResetPalette(m);
  m.screen.fill(0);
  yield* show(m);
  while (!m.aDone) {
    yield* retrace(m);
    const fade = m.aFrame * 3;
    ILBM_Palette(m, at(aSEQ19), 64, 0, fade);
    ILBM_Palette(m, at(gSEQ20_STAND), 64, 0, fade);
    ILBM_Palette(m, at(gSEQ6_BACK), 64, 64, fade);
  }
  yield* waitTicks(m, 6);

  // ...and back down onto the standing ninja over 32.
  startAnim(m, 32, 1, 32);
  DepackILBM(g, at(gSEQ20_STAND), m.pLayer1, 0);
  DepackILBM(g, at(gSEQ6_BACK), m.pVspace, 64);
  m.screen.set(m.pVspace.subarray(0, SCREEN_BYTES));
  DrawLayerVert(m, m.pLayer1, 0);
  yield* show(m);
  while (!m.aDone) {
    yield* retrace(m);
    const fade = 64 - 2 * m.aFrame;
    ILBM_Palette(m, at(gSEQ20_STAND), 64, 0, fade);
    ILBM_Palette(m, at(gSEQ6_BACK), 64, 64, fade);
  }
  yield* waitTicks(m, 205);

  yield* AnimPlay(m, aSEQ21_LAUGH, 2, 6, 21, at(gSEQ13_BACK), null, true, true);
  yield* AnimPlay(m, aSEQ21_CUT, 9, 10, 9, at(gSEQ13_BACK), null, false, true);
  yield* AnimPlay(m, aSEQ21_CUT + 9, 2, 6, 14, at(gSEQ13_BACK), null, false, true);

  yield* retrace(m);
  ResetPalette(m);
  yield* waitTicks(m, 25);

  yield* MutantHead(m);
  yield* NinjaIntoFog(m);

  m.creditsStartMs = m.time;
  yield* Credits(m);
}

/** Drives the demo generator from a clock. advanceTo(t) runs logic until t ms of demo time are consumed. */
export function createRunner(pGraphics) {
  const m = createMachine(pGraphics);
  const sequence = demo(m);
  let consumed = 0;
  return {
    m,
    advanceTo(timeMs) {
      while (consumed <= timeMs) {
        m.time = consumed;
        const step = sequence.next();
        if (step.done) {
          return;
        }
        consumed += step.value;
      }
    },
  };
}
