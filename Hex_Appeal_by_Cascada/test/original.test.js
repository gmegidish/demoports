// Frames of the original, recorded in DOSBox (see README), that the port reproduces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDemo, screenRgb, recordedFrame, countDifferentPixels } from './helpers.js';

/** One moment in each part: the intro text, the HEX APPEAL logo, the morphs (320x400), Eevi (640x400), the cube, the slime. */
const RECORDED_MOMENTS = [25.01, 47.01, 90.01, 135.01, 175.01, 260.01];
const DEMO_LENGTH_SECONDS = 334.3;

test('every part shows the recorded frame, pixel for pixel', () => {
  const demo = newDemo();
  for (const seconds of RECORDED_MOMENTS) {
    demo.runUntil(seconds);
    assert.equal(countDifferentPixels(screenRgb(demo), recordedFrame(seconds)), 0, `at ${seconds} s`);
  }
});

test('the demo runs through all five parts and ends with the soundtrack', () => {
  const demo = newDemo();
  demo.runUntil(400);
  assert.ok(demo.state.isOver);
  assert.equal(demo.state.partIndex, 4);
  assert.ok(Math.abs(demo.time - DEMO_LENGTH_SECONDS) < 0.1, `ended at ${demo.time} s`);
});
