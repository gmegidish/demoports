// The spiral parts at the end (docs/disassembly/A_intro_outro.md):
//   p12 0x10eeea  the spiral animation runs backwards (frame 38 down to 0), as in p01 without the fade;
//   p14 0x10efc2  it runs forwards (frame 0 up to 37), then the screen is filled with colour 0x5b.
import { POSITION, ROW, copyToScreen, setPalette, waitRetrace } from '../machine.js';
import {
  RETRACES_PER_FRAME, SCREEN, SCREEN_BYTES, SPIRAL_BUFFER, SPIRAL_LAST_FRAME, SPIRAL_PALETTE,
  allocateSpiralBuffer, decodeSpiralBlock, spiralBackwards, startSpiral, waitRetraces,
} from './spiral.js';

/** @typedef {import('../machine.js').Machine} Machine */

/** 0x10f0ac: the colour the buffer is filled with after the last frame. */
const FINAL_COLOUR = 0x5b;

/** 0x10eeea: p12, until position 0x2d. */
export function* spiralReturn(m, lastPosition) {
  startSpiral(m);
  return yield* spiralBackwards(m, lastPosition);
}

/**
 * 0x10efc2: p14. Main passes `lastRow` = 0 (edx): the part ends at row `lastRow` of position lastPosition - 1, i.e.
 * as soon as position 0x32 starts.
 */
export function* spiralEnd(m, lastPosition, lastRow = 0) {
  allocateSpiralBuffer(m);
  m.readPlayStatus();
  decodeSpiralBlock(m, 0);
  yield* waitRetrace(m);
  setPalette(m, SPIRAL_PALETTE);
  copyToScreen(m, m.u32(SPIRAL_BUFFER));
  m.readPlayStatus();
  let frame = 0;
  for (;;) {
    const position = m.u32(POSITION);
    if (lastPosition <= position) {
      return false;
    }
    if (position === lastPosition - 1 && lastRow <= m.u32(ROW)) {
      return false;
    }
    yield* waitRetraces(m, RETRACES_PER_FRAME);
    copyToScreen(m, m.u32(SPIRAL_BUFFER), SCREEN, SCREEN_BYTES);
    if (frame < SPIRAL_LAST_FRAME) {
      frame++;
    }
    if (frame === SPIRAL_LAST_FRAME) {
      const buffer = m.u32(SPIRAL_BUFFER);
      m.mem.fill(FINAL_COLOUR, buffer, buffer + SCREEN_BYTES);
    } else {
      decodeSpiralBlock(m, frame);
    }
    m.readPlayStatus();
  }
}
