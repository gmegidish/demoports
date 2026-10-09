// Shared by the tests: APPEAL.EXE, the demo, and what the screen shows.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createDemo } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';

export const appealExe = new Uint8Array(readFileSync(new URL('../appeal.exe', import.meta.url)));

export function newDemo() {
  return createDemo(appealExe);
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

/** The frame the original showed at `seconds` of the soundtrack (recorded in DOSBox), as RGB bytes. */
export function recordedFrame(seconds) {
  return new Uint8Array(gunzipSync(readFileSync(new URL(`./fixtures/original-${seconds.toFixed(2)}.rgb.gz`, import.meta.url))));
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
