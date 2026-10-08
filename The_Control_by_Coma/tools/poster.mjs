// Renders docs/poster.png: twenty-four moments of the demo, straight out of the port, no browser.
// The demo is run once from the start (effects keep state from frame to frame); 320x400 frames are halved.
// Usage: node tools/poster.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDemo } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';
import { writeFramePng } from './png.mjs';

const COLUMNS = 4;
const CELL_WIDTH = 320;
const CELL_HEIGHT = 200;
/** Seconds into the demo, in order. */
const MOMENTS = [
  12, 22, 30, 40,
  55, 70, 85, 92,
  99, 104, 116, 130,
  140, 150, 158, 163,
  185, 220, 230, 251,
  265, 296, 320, 360,
];

const read = (name) => new Uint8Array(readFileSync(new URL(`../${name}`, import.meta.url)));

/**
 * Copies a frame into a cell. A 400-line frame (red, green and blue scanlines) is halved by taking, per
 * channel, the brightest of three neighbouring lines: the colour a CRT blends them into.
 */
function pasteInto(poster, posterWidth, frame, cellX, cellY) {
  const rowStep = frame.height / CELL_HEIGHT;
  const span = rowStep > 1 ? 3 : 1;
  for (let y = 0; y < CELL_HEIGHT; y++) {
    const first = Math.floor(y * rowStep);
    for (let x = 0; x < CELL_WIDTH; x++) {
      const d = ((cellY + y) * posterWidth + cellX + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        let value = 0;
        for (let k = 0; k < span; k++) {
          const row = Math.min(first + k, frame.height - 1);
          value = Math.max(value, frame.rgba[(row * frame.width + x) * 4 + channel]);
        }
        poster[d + channel] = value;
      }
      poster[d + 3] = 255;
    }
  }
}

const demo = createDemo({ exe: read('CONTROL.EXE'), avi: read('DEMO.AVI'), fli: read('DEMO.FLI') });
demo.machine.romFont = read('assets/vga8x16.bin');
const rows = Math.ceil(MOMENTS.length / COLUMNS);
const width = CELL_WIDTH * COLUMNS;
const height = CELL_HEIGHT * rows;
const rgba = new Uint8ClampedArray(width * height * 4);
MOMENTS.forEach((seconds, cell) => {
  demo.runUntil(seconds);
  pasteInto(rgba, width, renderFrame(demo.machine), (cell % COLUMNS) * CELL_WIDTH, Math.floor(cell / COLUMNS) * CELL_HEIGHT);
});
writeFramePng(fileURLToPath(new URL('../docs/poster.png', import.meta.url)), { width, height, rgba });
