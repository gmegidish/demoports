// Renders docs/poster.png: sixteen moments of the demo, straight out of the port, no browser.
// The demo is run once from the start; the 640x480 and text frames are scaled down to 320x200 by averaging.
// Moments are port frames: retraces from the mode 13h switch, the reference recording's frame numbers.
// Usage: node tools/poster.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDemo } from '../src/demo.js';
import { unpackRed } from '../src/pklite.js';
import { renderFrame } from '../src/screen.js';
import { writeFramePng } from './png.mjs';

const COLUMNS = 4;
const CELL_WIDTH = 320;
const CELL_HEIGHT = 200;
/** Frames, in order. */
const MOMENTS = [
  120, 300, 520, 790,
  1000, 1500, 2100, 2700,
  3500, 4000, 4800, 5400,
  6200, 6900, 7472, 8060,
];

/** Copies a frame into a cell, averaging the block of source pixels that falls on each cell pixel. */
function pasteInto(poster, posterWidth, frame, cellX, cellY) {
  const stepX = frame.width / CELL_WIDTH;
  const stepY = frame.height / CELL_HEIGHT;
  for (let y = 0; y < CELL_HEIGHT; y++) {
    const y0 = Math.floor(y * stepY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * stepY));
    for (let x = 0; x < CELL_WIDTH; x++) {
      const x0 = Math.floor(x * stepX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * stepX));
      const d = ((cellY + y) * posterWidth + cellX + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let sy = y0; sy < y1; sy++) {
          for (let sx = x0; sx < x1; sx++) {
            sum += frame.rgba[(sy * frame.width + sx) * 4 + channel];
          }
        }
        poster[d + channel] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
      }
      poster[d + 3] = 255;
    }
  }
}

const { image } = unpackRed(new Uint8Array(readFileSync(new URL('../RED.EXE', import.meta.url))));
const font = new Uint8Array(readFileSync(new URL('../assets/vgafont.bin', import.meta.url)));
const demo = createDemo(image, font);
let retraces = 0;
const rows = Math.ceil(MOMENTS.length / COLUMNS);
const width = CELL_WIDTH * COLUMNS;
const height = CELL_HEIGHT * rows;
const rgba = new Uint8ClampedArray(width * height * 4);
MOMENTS.forEach((frame, cell) => {
  for (; retraces < frame + 1; retraces++) {
    demo.step();
  }
  pasteInto(rgba, width, renderFrame(demo.state.vga), (cell % COLUMNS) * CELL_WIDTH, Math.floor(cell / COLUMNS) * CELL_HEIGHT);
});
writeFramePng(fileURLToPath(new URL('../docs/poster.png', import.meta.url)), { width, height, rgba });
