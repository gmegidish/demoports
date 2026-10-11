// Shared by the tests: the demo, what the screen shows, and the recorded frames of the original.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createDemo } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';
import { loadFiles } from '../tools/files.mjs';
import { runToRecordingFrame } from '../tools/run.mjs';

/** DOSBox played the module this much faster than its nominal tempo (README): with it, the parts start and end
 * where the recording's do. */
export const RECORDING_MUSIC_RATE = 1.0097;

export function newDemo(options = {}) {
  return createDemo(loadFiles(), options);
}

export function newDemoOnTheRecordingsClock() {
  return newDemo({ musicRate: RECORDING_MUSIC_RATE });
}

/** Runs the demo up to port frame `frame`: the state after frame + 1 retraces from the switch to mode 13h. */
export function runToFrame(demo, frame) {
  runToRecordingFrame(demo, frame);
}

/** What the screen shows, as RGB bytes. */
export function screenRgb(demo) {
  const { rgba, width, height } = renderFrame(demo.state.vga);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return rgb;
}

/** Frame `frame` of the original, recorded in DOSBox (see README), as RGB bytes. */
export function recordedFrame(frame) {
  return new Uint8Array(gunzipSync(readFileSync(new URL(`./fixtures/original-${frame}.rgb.gz`, import.meta.url))));
}

export function countDifferentPixels(a, b) {
  if (a.length !== b.length) {
    return Infinity;
  }
  let count = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
      count++;
    }
  }
  return count;
}
