// The effects, one generator each, called by the main script (demo.js) in this order. A generator runs the effect's
// code until it waits for the next vertical retrace (`yield`). Effects not ported yet are stubs that only wait for
// the number of retraces the effect takes in the reference recording, so the timeline stays right.

import { dotsCubes } from './dotsCubes.js';
import { glentzCubes } from './glentzCubes.js';
import { textToGraphics, blueCubes, fadeTextPart } from './textmode.js';
import { intro } from './intro.js';
import { credits } from './credits.js';
import { water } from './water.js';
import { glentzVector } from './glentzVector.js';
import { pictureWobbler } from './pictureWobbler.js';
import { pictureZoomer } from './pictureZoomer.js';
import { fractalZoomer } from './fractalZoomer.js';
import { dotTunnel } from './dotTunnel.js';
import { motorcycleToDoor } from './motorcycleToDoor.js';
import { chessZoomer } from './chessZoomer.js';
import { greetings } from './greetings.js';
import { glentzChessCube } from './glentzChessCube.js';
import { plasma } from './plasma.js';
import { cyclicPlasma } from './cyclicPlasma.js';
import { morphingLines } from './morphingLines.js';
import { chessEffect } from './chessEffect.js';

/** A stand-in: `retraces` retraces of whatever is on screen. */
function stub(retraces) {
  return function* waitLikeTheOriginal() {
    for (let i = 0; i < retraces; i++) {
      yield;
    }
  };
}

export const EFFECTS = {
  /** 11d6:000a from its switch to 640x400 graphics (demo time 0). */
  textToGraphics,
  /** 08d8:196e: the two blue cubes. */
  blueCubes,
  /** 11d6:032c: DAC 0..62 to black in 70 retraces. */
  fadeTextPart,
  /** 08d8:275d. */
  intro,
  /** 0db5:07b0. */
  credits,
  /** 0cf9:01dd. */
  plasma,
  /** 0cc5:0139. */
  cyclicPlasma,
  /** 0d2e:0010. */
  morphingLines,
  /** 08d8:18d4. */
  chessEffect,
  /** 0749:01cc. */
  water,
  /** 08d8:1625 (and 08d8:16de, the clear after it). */
  glentzVector,
  /** 08a8:01f2. */
  pictureWobbler,
  /** 0777:0995: chess zoomer, parallax bars, 16x16 spheres. */
  chessZoomer,
  /** 08d8:2dc1. */
  glentzChessCube,
  /** 0eb3:27e8, 0eb3:28ab, 0eb3:27d5. */
  greetings,
  /** 0e40:063b. */
  dotTunnel,
  /** 08d8:396c, 3041, 346a(150), 35f6, 39d4, 346a(50), 3e3a, 39b1. */
  motorcycleToDoor,
  /** 0d97:013c (after main's mode 13h). */
  pictureZoomer,
  /** 0d34:04e1. */
  fractalZoomer,
  /** 08d8:25f4 (and 08d8:16de). */
  glentzCubes,
  /** 126e:13ea. */
  dotsCubes,
};
