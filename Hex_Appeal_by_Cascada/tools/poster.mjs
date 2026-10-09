// Renders docs/poster.png: twenty-four moments of the demo, straight out of the port, no browser.
// The demo is run once from the start; 320x400 and 640x400 frames are scaled down to 320x200 by averaging.
// Usage: node tools/poster.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDemo } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';
import { writeFramePng } from './png.mjs';

const COLUMNS = 4;
const CELL_WIDTH = 320;
const CELL_HEIGHT = 200;
/** Soundtrack seconds, in order. */
const MOMENTS = [
  4.5, 15.6, 25, 34,
  44, 47, 52, 55.5,
  60, 75, 100, 125,
  135, 145, 160, 175,
  185, 193.5, 215, 240,
  260, 285, 310, 330,
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

const demo = createDemo(new Uint8Array(readFileSync(new URL('../appeal.exe', import.meta.url))));
const rows = Math.ceil(MOMENTS.length / COLUMNS);
const width = CELL_WIDTH * COLUMNS;
const height = CELL_HEIGHT * rows;
const rgba = new Uint8ClampedArray(width * height * 4);
MOMENTS.forEach((seconds, cell) => {
  demo.runUntil(seconds);
  pasteInto(rgba, width, renderFrame(demo.state.vga), (cell % COLUMNS) * CELL_WIDTH, Math.floor(cell / COLUMNS) * CELL_HEIGHT);
});
writeFramePng(fileURLToPath(new URL('../docs/poster.png', import.meta.url)), { width, height, rgba });
