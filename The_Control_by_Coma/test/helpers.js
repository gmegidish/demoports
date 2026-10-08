// Shared by the tests: the original files, and the demo run once from the start.
import { readFileSync } from 'node:fs';
import { createDemo } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';

export function readOriginal(name) {
  return new Uint8Array(readFileSync(new URL(`../${name}`, import.meta.url)));
}

export const originalFiles = { exe: readOriginal('CONTROL.EXE'), avi: readOriginal('DEMO.AVI'), fli: readOriginal('DEMO.FLI') };

/** A fresh demo with the ROM font for the text screen. */
export function newDemo() {
  const demo = createDemo(originalFiles);
  demo.machine.romFont = readOriginal('assets/vga8x16.bin');
  return demo;
}

/** What the screen shows, as RGB bytes. */
export function screenRgb(machine) {
  const { rgba, width, height } = renderFrame(machine);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return rgb;
}

export function countDifferentPixels(a, b) {
  let count = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
      count++;
    }
  }
  return count;
}
