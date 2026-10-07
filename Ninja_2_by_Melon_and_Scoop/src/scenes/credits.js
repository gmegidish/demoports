// Credits: the only part outside 320x256. The original switches to VGA mode 12h (640x480, 16 colours,
// planar) and writes bitplanes straight to video memory: the logo on planes 1 and 2, the text on plane 4.
// It loops until a key is pressed, so this generator never returns.
import { ResetPalette, SetCol } from '../machine.js';
import { DepackILBM } from '../ilbm.js';
import { file_offsets, gCREDITSLOGO, gCREDITS1 } from '../files.js';

const WIDTH = 640;
const HEIGHT = 480;
const ROW_BYTES = WIDTH / 8;
const PLANE_BYTES = ROW_BYTES * HEIGHT;
const CREDIT_PAGES = 8;
/** Mode 12h refreshes at the standard 59.94 Hz, not at the demo's 57.6. */
const VBLANK = 1000 / 59.94;

function* waitBlanks(count) {
  for (let i = 0; i < count; i++) {
    yield VBLANK;
  }
}

function enterMode12h(m) {
  m.width = WIDTH;
  m.height = HEIGHT;
  m.screen = new Uint8Array(WIDTH * HEIGHT);
  m.front = new Uint8Array(WIDTH * HEIGHT);
  ResetPalette(m);
  // BIOS defaults for the colours the demo never sets. They only show where text overlaps the logo.
  SetCol(m, 5, 42, 0, 42);
  SetCol(m, 6, 42, 21, 0);
  SetCol(m, 7, 42, 42, 42);
}

/** Turn the three bitplanes into the picture the monitor shows. */
function showPlanes(m, plane1, plane2, plane4) {
  const front = m.front;
  let d = 0;
  for (let i = 0; i < PLANE_BYTES; i++) {
    const a = plane1[i];
    const b = plane2[i];
    const c = plane4[i];
    for (let bit = 7; bit >= 0; bit--) {
      front[d++] = ((a >> bit) & 1) | (((b >> bit) & 1) << 1) | (((c >> bit) & 1) << 2);
    }
  }
}

export function* Credits(m) {
  const g = m.pGraphics;
  const plane1 = new Uint8Array(PLANE_BYTES);
  const plane2 = new Uint8Array(PLANE_BYTES);
  const plane4 = new Uint8Array(PLANE_BYTES);
  const show = () => showPlanes(m, plane1, plane2, plane4);

  enterMode12h(m);

  m.pLayer1.fill(0, 0, 64000);
  DepackILBM(g, file_offsets[gCREDITSLOGO], m.pVspace, 0);
  DepackILBM(g, file_offsets[gCREDITS1], m.pLayer1, 0);

  SetCol(m, 0, 0, 0, 0);
  SetCol(m, 1, 3, 6, 9);
  SetCol(m, 2, 63, 63, 63);
  SetCol(m, 3, 19 >> 2, 25 >> 2, 33 >> 2);
  SetCol(m, 4, 0, 0, 0);

  // The logo has three planes per row; the third is ignored.
  for (let i = 0; i < HEIGHT; i++) {
    const k = i * ROW_BYTES * 3;
    plane1.set(m.pVspace.subarray(k, k + ROW_BYTES), i * ROW_BYTES);
    plane2.set(m.pVspace.subarray(k + ROW_BYTES, k + 2 * ROW_BYTES), i * ROW_BYTES);
  }
  show();

  yield* waitBlanks(70 * 3);

  plane4.set(m.pLayer1.subarray(ROW_BYTES * 28, ROW_BYTES * 28 + PLANE_BYTES));
  show();

  let nCredits = 0;
  let isFadeUp = true;
  let nFade = 0;

  while (true) {
    yield VBLANK;
    yield VBLANK;

    if (isFadeUp) {
      SetCol(m, 4, nFade, nFade, nFade);
      nFade++;

      if (nFade === 63) {
        yield* waitBlanks(70);
        if (nCredits === 7) {
          yield* waitBlanks(70 * 5);
        }
        isFadeUp = false;
      }
    }

    if (!isFadeUp) {
      SetCol(m, 4, nFade, nFade, nFade);
      nFade--;

      if (nFade === 0) {
        yield* waitBlanks(30);
        isFadeUp = true;
        nCredits++;
        if (nCredits >= CREDIT_PAGES) {
          nCredits = 0;
        }

        DepackILBM(g, file_offsets[gCREDITS1 + nCredits], m.pLayer1, 0);
        plane4.set(m.pLayer1.subarray(ROW_BYTES * 32, ROW_BYTES * 32 + PLANE_BYTES));
        show();
      }
    }
  }
}
