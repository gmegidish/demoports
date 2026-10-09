// Shared by the tests: GBU.EXE, the demo, and what the screen shows.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createDemo } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';

export const gbuExe = new Uint8Array(readFileSync(new URL('../GBU.EXE', import.meta.url)));
const font = new Uint8Array(readFileSync(new URL('../assets/vgafont.bin', import.meta.url)));

export function newDemo() {
  return createDemo(gbuExe, font);
}

/** Runs the demo up to recording frame `frame`: the state after frame + 1 retraces. */
export function runToFrame(demo, frame, retracesDone) {
  for (let r = retracesDone; r < frame + 1; r++) {
    demo.step();
  }
  return frame + 1;
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
