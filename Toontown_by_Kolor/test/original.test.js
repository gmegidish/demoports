// Frames of the original, recorded in DOSBox (see README), that the port reproduces pixel for pixel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newDemo, newDemoOnTheRecordingsClock, runToFrame, screenRgb, recordedFrame, countDifferentPixels,
} from './helpers.js';

/**
 * [recording frame, port frame showing the same picture]. The original renders a picture every few retraces and
 * DOSBox shows it later than the port, which renders on every retrace: the recorded picture is an earlier port
 * frame. The spiral, the credits, the TOON town logo, the plasma, the rings, the kaleidoscope, the silhouette,
 * the FakeMode picture (320x400), the swaying logo and the last spiral.
 */
const RECORDED_PICTURES = [
  [150, 147], [1650, 1646], [3400, 3395], [6400, 6380], [7400, 7388], [9150, 9122], [13150, 13135],
  [14650, 14628], [16150, 16150], [17150, 17147],
];

test('every part shows the recorded picture, pixel for pixel', () => {
  const demo = newDemoOnTheRecordingsClock();
  for (const [recordingFrame, portFrame] of RECORDED_PICTURES) {
    runToFrame(demo, portFrame);
    assert.equal(countDifferentPixels(screenRgb(demo), recordedFrame(recordingFrame)), 0, `at frame ${recordingFrame}`);
  }
});

test('the demo exits to DOS when the music reaches position 0x32', () => {
  const demo = newDemo();
  while (!demo.state.isOver) {
    demo.step();
  }
  assert.equal(demo.state.vga.isTextMode, true);
  const SECONDS_OF_MUSIC_BEFORE_THE_EXIT = 256.06;
  const LOADING_SCREEN_SECONDS = 134 / 70.086;
  assert.ok(Math.abs(demo.time - LOADING_SCREEN_SECONDS - SECONDS_OF_MUSIC_BEFORE_THE_EXIT) < 0.05, `at ${demo.time}`);
});
