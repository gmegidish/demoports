// Frames of the original, recorded in DOSBox (see README), that the port reproduces pixel for pixel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDemo, runToFrame, screenRgb, recordedFrame, countDifferentPixels } from './helpers.js';

/**
 * Port frames (retraces from the mode 13h switch, which is the recording's frame 0) with a recorded twin, in order:
 * the bubbles animation, the bouncing logo, the glass ball, the RAZOR text, the blur band, the snowball scroller,
 * the credits, the 640x480 RAZOR logo, the triangle, and the end screen with the cursor on and off.
 */
const RECORDED_FRAMES = [150, 600, 1700, 3000, 4400, 5200, 6300, 7472, 7972, 8051, 8056];
/** The first port frame in text mode: the end screen. */
const END_SCREEN_FRAME = 8051;

test('every part shows the recorded frame, pixel for pixel', () => {
  const demo = newDemo();
  let retraces = 0;
  for (const frame of RECORDED_FRAMES) {
    retraces = runToFrame(demo, frame, retraces);
    assert.equal(countDifferentPixels(screenRgb(demo), recordedFrame(frame)), 0, `at frame ${frame}`);
  }
});

test('the demo exits to DOS on the recorded frame', () => {
  const demo = newDemo();
  runToFrame(demo, END_SCREEN_FRAME - 1, 0);
  assert.equal(demo.state.vga.isTextMode, false);
  demo.step();
  assert.equal(demo.state.vga.isTextMode, true);
  assert.equal(demo.state.isOver, true);
});
