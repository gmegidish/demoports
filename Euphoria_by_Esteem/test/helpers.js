// Shared by the tests: the executable, the ROM font, and the demo rendered at a moment.
import { readFileSync } from 'node:fs';
import { createDemo, partContaining } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';

export const exe = new Uint8Array(readFileSync(new URL('../EUPHORIA.EXE', import.meta.url)));
const romFont = new Uint8Array(readFileSync(new URL('../assets/vga8x16.bin', import.meta.url)));

/** The demo run from the start of the part that contains `seconds`, up to `seconds`. */
export function demoAt(seconds) {
  const demo = createDemo(exe, { firstPart: partContaining(seconds) });
  demo.machine.romFont = romFont;
  demo.runUntil(seconds);
  return demo;
}

/** What the screen shows at `seconds`, as RGB bytes. */
export function screenAt(seconds) {
  const { rgba, width, height } = renderFrame(demoAt(seconds).machine);
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
