// Renders docs/poster.png: twenty-four moments of the demo, straight out of the port, no browser.
// 640x480 frames are halved to 320x240; 320x200 frames are centred in the 320x240 cell.
// Usage: node tools/poster.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDemo, partContaining } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';
import { writeFramePng } from './png.mjs';

const COLUMNS = 4;
const CELL_WIDTH = 320;
const CELL_HEIGHT = 240;
/** Seconds into the demo, in order. */
const MOMENTS = [
  14, 42, 66, 90,
  102, 116, 150, 186,
  222, 276, 306, 354,
  414, 426, 438, 474,
  510, 546, 580, 600,
  632, 656, 716, 727.9,
];

const exe = new Uint8Array(readFileSync(new URL('../EUPHORIA.EXE', import.meta.url)));
const romFont = new Uint8Array(readFileSync(new URL('../assets/vga8x16.bin', import.meta.url)));

function frameAt(seconds) {
  const demo = createDemo(exe, { firstPart: partContaining(seconds) });
  demo.machine.romFont = romFont;
  demo.runUntil(seconds);
  return renderFrame(demo.machine);
}

/** Copies a frame into a cell, scaling down by an integer factor so it fits. */
function pasteInto(poster, posterWidth, frame, cellX, cellY) {
  const step = Math.ceil(Math.max(frame.width / CELL_WIDTH, frame.height / CELL_HEIGHT));
  const w = Math.floor(frame.width / step);
  const h = Math.floor(frame.height / step);
  const left = cellX + ((CELL_WIDTH - w) >> 1);
  const top = cellY + ((CELL_HEIGHT - h) >> 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * step * frame.width + x * step) * 4;
      const d = ((top + y) * posterWidth + left + x) * 4;
      poster.set(frame.rgba.subarray(s, s + 4), d);
    }
  }
}

const rows = Math.ceil(MOMENTS.length / COLUMNS);
const width = CELL_WIDTH * COLUMNS;
const height = CELL_HEIGHT * rows;
const rgba = new Uint8ClampedArray(width * height * 4);
MOMENTS.forEach((seconds, cell) => {
  pasteInto(rgba, width, frameAt(seconds), (cell % COLUMNS) * CELL_WIDTH, Math.floor(cell / COLUMNS) * CELL_HEIGHT);
});
writeFramePng(fileURLToPath(new URL('../docs/poster.png', import.meta.url)), { width, height, rgba });
