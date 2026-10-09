// Renders docs/poster.png: twenty-four moments of the demo, straight out of the port, no browser.
// The demo is run once from the start; 320x400 and 640x400 frames are scaled down to 320x200 by averaging.
// Moments are frames of the reference recording (70.086 Hz).
// Usage: node tools/poster.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDemo } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';
import { writeFramePng } from './png.mjs';

const COLUMNS = 4;
const CELL_WIDTH = 320;
const CELL_HEIGHT = 200;
/** Frames, in order: one per effect. */
const MOMENTS = [
  200, 1150, 2100, 2640,
  4405, 6000, 7200, 8300,
  9300, 10500, 11300, 12700,
  14200, 15500, 17000, 18300,
  19700, 20640, 21300, 22500,
  23800, 25400, 27500, 30300,
];

/** Copies a frame into a cell, averaging the block of source pixels that falls on each cell pixel. */
function pasteInto(poster, posterWidth, frame, cellX, cellY) {
  const stepX = frame.width / CELL_WIDTH;
  const stepY = frame.height / CELL_HEIGHT;
  for (let y = 0; y < CELL_HEIGHT; y++) {
    for (let x = 0; x < CELL_WIDTH; x++) {
      const d = ((cellY + y) * posterWidth + cellX + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let dy = 0; dy < stepY; dy++) {
          for (let dx = 0; dx < stepX; dx++) {
            sum += frame.rgba[((y * stepY + dy) * frame.width + x * stepX + dx) * 4 + channel];
          }
        }
        poster[d + channel] = Math.round(sum / (stepX * stepY));
      }
      poster[d + 3] = 255;
    }
  }
}

const exe = new Uint8Array(readFileSync(new URL('../GBU.EXE', import.meta.url)));
const font = new Uint8Array(readFileSync(new URL('../assets/vgafont.bin', import.meta.url)));
const demo = createDemo(exe, font);
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
